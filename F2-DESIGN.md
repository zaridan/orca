# F2 design: Coordinator creates lineage-visible worktrees (issue #13)

> **Status: DESIGN-FIRST proposal. No production code changed in this pass.**
> Part of epic #5. Builds on F1 (#12, per-run isolation — commit `2c2058f48`).
> Reviewer + human green-light required before implementation.

## 1. The problem F2 closes

Two systems don't compose today:

- **The coordinator** (`src/main/runtime/orchestration/coordinator.ts`) dispatches each
  ready task to a **bare terminal inside one shared worktree** (`opts.worktree`) via
  `dispatchReadyTasks` → `getAvailableTerminals` / `createTerminal(this.opts.worktree)`.
  It **never creates worktrees**.
- **Mission Control** (`OrchestratorMissionControl.tsx` → `selectSpawnedWorktreeIds`,
  `src/renderer/src/lib/orchestrator-mission-control-data.ts`) discovers a director's
  workers **only by worktree lineage**: `lineage.parentWorktreeId === directorWorktreeId`.

A coordinator-driven run therefore produces **zero lineage edges** → Mission Control shows
"No worktrees yet" forever. F2 makes the coordinator create **child worktrees whose lineage
parent is the director worktree**, so its work shows up with **no Mission Control change**.

## 2. What already exists (verified — reuse, don't reinvent)

The keystone is already 90% built; F2 is mostly wiring.

| Capability | Location | Notes |
|---|---|---|
| `git worktree add` | `addWorktree` — `src/main/git/worktree.ts:613` | Battle-tested. `--no-track -b`, base-ref resolution, `push.autoSetupRemote`. |
| **High-level managed create** | `OrcaRuntimeService.createManagedWorktree` — `orca-runtime.ts:11878` | Wraps `addWorktree`, records lineage, links symlinks, runs setup hooks, **and can launch a startup agent in the new worktree**. Returns `CreateWorktreeResult`. |
| **Lineage input already models orchestration** | `WorktreeLineageInput.orchestrationContext` — `orca-runtime.ts:1650` | `{ parentWorktreeId?, orchestrationRunId?, taskId?, coordinatorHandle? }`. Resolved at `orca-runtime.ts:16031` into a lineage edge. |
| Lineage write | `recordCreatedWorktreeLineage` — `orca-runtime.ts:11637` | Writes `lineage.parentWorktreeId` from the orchestration context. |
| MC discovery (no change needed) | `selectSpawnedWorktreeIds` — `orchestrator-mission-control-data.ts:9` | Filters `parentWorktreeId === directorWorktreeId`, live-only, oldest-first. |
| Agent-in-worktree launch | `createManagedWorktree({ startup / startupAgent, startupPrompt })` → `CreateWorktreeResult.startupTerminal.handle` | This is how a worker gets launched **in** the worktree instead of a bare terminal. |
| Coordinator wiring | `new Coordinator(db, runtime, …)` — `orchestration-gates.ts:99` | `runtime` IS the `OrcaRuntimeService`. Adding a method to the service + the `CoordinatorRuntime` interface is enough. |
| Run target identity (F1) | `coordinator_runs.target_key = worktree:<directorWorktreeId>` | Resolved by `resolveOrchestrationTargetKey` (`orca-runtime.ts:2466`). |

**Takeaway:** `createManagedWorktree` already produces a lineage-visible worktree *and* an
agent terminal handle. F2's new `createWorktree` is a thin, orchestration-shaped adapter over
it — not new git machinery.

## 3. The core decision — how do tasks map to worktrees?

A worktree = a checkout = a branch = (eventually) a PR. The question is the unit of that
mapping. The brief frames three options; the issue "leans shared-per-recipe."

### 3.1 The two hard constraints that decide it

1. **Git-artifact handoff (#5):** the canonical recipe is `implement → review` **on the same
   branch** — review must read and comment on the implement PR, not open a second PR. So an
   implement task and its review successor **must share one worktree/branch**.
2. **Collision safety:** two agents running `git`/edits in the *same checkout* concurrently
   corrupt each other (index locks, conflicting writes, half-staged trees). So two tasks that
   run *at the same time* **must not share a worktree**.

### 3.2 Scoring the three options

| Option | implement→review handoff | Concurrency safety | Cost |
|---|---|---|---|
| **One worktree per run** (all tasks → 1 branch → 1 PR) | ✅ shares a branch | ❌ `maxConcurrent > 1` collides on one checkout; unrelated features conflate into one PR | Lowest |
| **One worktree per task** (each task → own branch/PR) | ❌ review opens a *second* PR, breaking the handoff | ✅ fully parallel-safe | Low |
| **Worktree per "track"** (task declares which track = worktree = PR) | ✅ review continues implement's track | ✅ distinct tracks run concurrently; same-track tasks serialize | Needs a `track` concept the DAG lacks |

Per-run fails constraint #2. Per-task fails constraint #1. **Only per-track satisfies both.**

### 3.3 Recommendation — adopt the **worktree-per-track** model

A **track** is the unit of `worktree = branch = PR`. A task maps to a track; tasks in the same
track share one worktree (and serialize against each other); distinct tracks get distinct
worktrees and run concurrently up to `maxConcurrent`.

**Why this is not over-building:** per-run and per-task are the two *degenerate cases* of
per-track —

- "everything in one track" **= per-run**,
- "every task its own track" **= per-task**.

So adopting the track abstraction lets us **ship a degenerate default now and generalize with
zero rework**. We are not building a third thing; we are choosing the abstraction whose special
cases are the other two options.

**Track identity (minimal, additive, no DAG schema change in the first slices):**

- A task may carry an optional `track: <trackKey>` hint **in its spec text** — the same
  low-friction channel F1 already uses for `allow-stale-base: true`
  (`parseAllowStaleBaseFromSpec`, `coordinator.ts:52`). Parsed and **stripped** out of the
  worker's `--- TASK ---` block exactly like that flag.
- **Default when unset:** the task's own id is its track key → per-task behavior (collision-free,
  the safe default). A review task opts into its predecessor's track by declaring
  `track: <implement-task-id-or-key>`.
- The coordinator holds an in-memory `Map<trackKey, TrackWorktree>` for the run. First dispatch
  of a track **lazily creates** the worktree; later same-track tasks **reuse** it.

This keeps the DAG untouched (a typed `track` column / dependency-derived tracks can come later
without changing this model — only where the key comes from).

## 4. `createWorktree` — signature, placement, target_key relation

### 4.1 Interface addition (`CoordinatorRuntime`, `coordinator.ts:6`)

Make it **optional** so existing implementers (notably the test mock at
`coordinator.test.ts:17`) keep compiling — the coordinator guards on its presence and falls back
to the legacy bare-terminal path. This is what keeps the change additive for upstream (#6201).

```ts
export type CoordinatorRuntime = {
  // …existing: sendTerminal / listTerminals / createTerminal / waitForTerminal / probeWorktreeDrift
  createWorktree?(opts: {
    parentWorktree: string          // director worktree selector → lineage parent edge
    name: string                    // worktree name == branch name (Orca convention); track identity
    baseBranch?: string             // defaults to the repo's default base ref when omitted
    orchestrationRunId?: string     // stamped on lineage for provenance
    taskId?: string                 // stamped on lineage for provenance
    coordinatorHandle?: string      // stamped on lineage for provenance
    startup?: { agent: TuiAgent; prompt?: string }  // launches the worker agent IN the worktree
  }): Promise<{
    worktreeId: string              // new child worktree id (lineage-visible)
    branch: string
    terminalHandle?: string         // startup agent terminal; dispatch target (undefined if no startup)
  }>
}
```

### 4.2 Implementation on `OrcaRuntimeService` (thin adapter over `createManagedWorktree`)

```ts
async createWorktree(opts): Promise<{ worktreeId; branch; terminalHandle? }> {
  const parent = await this.resolveWorktreeSelector(opts.parentWorktree) // selector → stable id
  const result = await this.createManagedWorktree({
    repoSelector: `id:${parent.repoId}`,         // same repo as the director
    name: opts.name,                              // == branch (Orca: worktree name IS branch)
    baseBranch: opts.baseBranch,
    telemetrySource: 'unknown',                   // or add an additive 'orchestration' value to
                                                  // WORKSPACE_SOURCE_VALUES (workspace-source.ts) — minor open q
    lineage: {
      orchestrationContext: {
        parentWorktreeId: parent.id,              // ← the lineage edge MC keys on
        orchestrationRunId: opts.orchestrationRunId,
        taskId: opts.taskId,
        coordinatorHandle: opts.coordinatorHandle,
      },
    },
    ...(opts.startup ? { startupAgent: opts.startup.agent, startupPrompt: opts.startup.prompt } : {}),
  })
  return {
    worktreeId: result.worktree.id,
    branch: result.worktree.git?.branch ?? opts.name,
    terminalHandle: result.startupTerminal?.handle,
  }
}
```

Everything in this body already exists; F2 adds only the method and the interface entry.

### 4.3 Relationship to F1's `target_key`

`target_key` is the **run-isolation** key — it scopes which DB rows (tasks/dispatches/gates)
belong to which run. For a worktree-backed run it is `worktree:<directorWorktreeId>` (the
coordinator's *own* worktree). The new **track worktrees are children with their own ids; they
do NOT change `target_key`.** The director worktree plays two roles at once, and they stay
consistent:

- **lineage parent** of every track worktree (what MC discovers on), and
- **run target** (what F1 isolates DB rows on).

Tasks created mid-run are still stamped with the run's `target_key` (the director worktree, via
`resolveOrchestrationTargetKeyForTerminal`) — **not** the track worktree id. So task ownership
stays anchored to the director and F1's isolation guarantees are untouched. No schema change.

## 5. Reconciling the dispatch path

Today `dispatchReadyTasks` (`coordinator.ts:479`) pairs ready tasks with idle terminals in
`opts.worktree` and `dispatchTask` sends the preamble to a bare terminal handle. The
worktree-backed path replaces *where the terminal lives*, not the dispatch mechanics:

1. For each ready task, compute its `trackKey` (spec hint → default = task id).
2. **`maxConcurrent` interaction:** concurrency is now bounded by **two** limits — the existing
   `maxConcurrent` *and* a new **one-active-dispatch-per-track** rule (same-track tasks must
   serialize, per §3.1 constraint #2). Effective parallelism = `min(maxConcurrent, #distinct
   ready tracks with no in-flight dispatch)`. A second ready task on a busy track simply waits;
   it stays `ready` and re-evaluates next tick (same shape as the existing "no idle terminal"
   wait).
3. Resolve the track worktree:
   - **miss** → `runtime.createWorktree({ parentWorktree: opts.worktree, name: branchFor(track),
     orchestrationRunId, taskId, coordinatorHandle, startup })`. The returned `terminalHandle`
     (the startup agent) is the dispatch target. Cache `{worktreeId, terminalHandle}` in the
     track map.
   - **hit** → reuse the cached worktree; dispatch into a terminal in it (reuse the startup
     handle if idle, else `createTerminal('id:'+worktreeId)`).
4. `dispatchTask(task, terminalHandle)` is otherwise **unchanged** — same preamble, same
   `createDispatchContext`, same drift pre-flight. The drift probe now targets the **track
   worktree** (`id:<worktreeId>`) instead of `opts.worktree`.

This is how "workers run as agents in their worktree (lineage-visible) rather than bare
terminals in `opts.worktree`" lands without rewriting the dispatch core.

**Additivity / behavior-change flag (for upstream #6201):** gate the new path behind the
presence of `runtime.createWorktree` *and* an explicit opt-in (e.g. a `worktreeBacked` coordinator
option, default `false`). When off, the coordinator behaves exactly as today (bare terminals in
`opts.worktree`). This is the one place F2 changes existing coordinator behavior, so it must be
opt-in, not silent.

## 6. Branch / worktree naming

Orca's convention: **the worktree name IS the branch name.** The coordinator needs deterministic,
collision-free, provider-neutral names (GitLab/GitHub/etc. — no GitHub-only assumptions):

- `name = orch-<run8>/<trackSlug>` where `<run8>` is the first 8 chars of the run id (namespaces
  against other runs / re-runs) and `<trackSlug>` is a sanitized slug of the track's lead task
  title (or the explicit `track` key). Reuse `createManagedWorktree`'s existing
  sanitize/branch-conflict handling — no new git logic.
- Determinism matters for **F3 resume** (§7): the same track must resolve to the same branch
  name so a resumed coordinator can re-discover an existing worktree instead of forking a new one.

## 7. Smallest end-to-end first slice (proves the bridge, defers the track model)

**Goal of slice 1:** a coordinator run's worker worktree shows up in Mission Control. Nothing more.

1. Add `createWorktree?` to `CoordinatorRuntime` + implement it on `OrcaRuntimeService` (§4) —
   pure adapter over `createManagedWorktree`.
2. Add the opt-in `worktreeBacked` coordinator option (default off → zero behavior change).
3. When on, `dispatchReadyTasks` creates **one worktree per task** (trackKey = task id — the
   safe degenerate default; the track *map* exists but each task trivially gets its own entry),
   launches the worker agent in it, and dispatches the existing preamble into the returned handle.
4. Lineage parent = `opts.worktree` (director) → `selectSpawnedWorktreeIds` finds it →
   **MC renders the worker with no MC change.** ✅
5. Tests: a coordinator-run integration test asserting the created worktree's
   `lineage.parentWorktreeId === directorWorktreeId` and that `selectSpawnedWorktreeIds` returns it.

Because the smallest provable scenario is a **single task**, per-task and per-run are
indistinguishable here — slice 1 commits to **no** multi-task track policy, so it can't be wrong.

**Slice 2 (not in the bridge proof):** spec `track:` hint + track reuse so `review` continues
`implement`'s worktree (the #5 handoff), plus the one-active-dispatch-per-track serialization
lock and multi-track concurrency under `maxConcurrent`.

## 8. Cleanup / teardown

**Recommendation: F2 does NOT auto-remove track worktrees.** They are real, user-facing
branches/PRs (often unmerged) — deleting them on run-end would destroy work in flight. Teardown
stays the human's call through Orca's existing worktree-delete UI, identical to any manually
created worktree. (Auto-cleanup-on-merge can be a later, separate policy once F2's PRs are real.)

**F3 (resume) interaction — must be designed-for now even though F3 owns it:** a resumed
coordinator must **re-discover** existing track worktrees rather than recreate them. Two enablers
land cheaply here: (a) **deterministic branch naming** (§6) so the same track → same branch, and
(b) on resume, seed the track map by scanning children of the director worktree via the same
lineage data MC uses (`parentWorktreeId === directorWorktreeId`) and matching branch names. So
`createWorktree` should treat an existing-branch/worktree as **adopt, not fail** (it already has
`checkoutExistingBranch` semantics underneath). Flagged for F3; not implemented in F2.

**F4 (renderer run binding):** no direct dependency. F4 binds a run to a renderer/stop control;
the track worktrees it would surface are exactly the lineage children F2 creates.

## 9. Upstream-friendliness (discussion #6201)

- **Additive by construction:** `createWorktree?` is an *optional* interface method; the test
  mock and any other implementer keep compiling. The new dispatch path is **opt-in** behind a
  default-off `worktreeBacked` flag.
- **One behavior change, explicitly gated:** worker-in-track-worktree vs bare-terminal-in-
  `opts.worktree`. Off by default → upstream's existing coordinator semantics are byte-for-byte
  preserved unless a caller opts in.
- **No git logic forked:** F2 routes entirely through `createManagedWorktree` → `addWorktree`,
  so the SSH/relay parity state machine (`git-handler-worktree-ops.ts`) and base-ref handling are
  inherited, not duplicated. SSH/headless work because `createManagedWorktree` already does.
- **No schema change:** lineage + `orchestrationContext` already exist; `target_key` semantics
  unchanged.

## 10. Open questions (for reviewer + human)

1. **Track key source.** Spec-text `track:` hint (low-friction, matches F1's `allow-stale-base`)
   vs a typed task field / dependency-derived tracks. Recommend the hint for slices 1–2, typed
   field later. Agree?
2. **Slice-1 default.** Confirm per-task default (collision-free) for the bridge proof, with
   implement→review reuse deferred to slice 2 — vs forcing single-track-per-run earlier to match
   #5 sooner.
3. **Worker startup agent.** Which agent does `createWorktree({ startup })` launch, and is the
   dispatch preamble delivered as the startup prompt or as a follow-up `sendTerminal` (current
   behavior)? Leaning: spawn the agent, then `sendTerminal` the preamble — keeps `dispatchTask`
   unchanged.
4. **Reuse vs fresh terminal on same-track re-dispatch.** Reuse the idle startup terminal, or
   always `createTerminal` a fresh one in the track worktree? Affects whether a worker's prior
   context bleeds into the next same-track task.
5. **Base ref per track.** All tracks branch from the run's base (`origin/main`)? Or can a
   continuation track branch from its predecessor's tip (true handoff)? The latter is needed for
   review-on-implement to see implement's commits — likely slice 2, but it shapes §6 naming and
   §8 resume.
6. **`maxConcurrent` semantics under tracks.** Confirm it bounds concurrent *tracks*, with
   same-track serialization layered on top (§5.2).

## 11. Summary

Adopt **worktree-per-track** (per-run and per-task are its degenerate cases, so it is the
abstraction not a third option). Add an **optional, additive** `createWorktree` to
`CoordinatorRuntime`, implemented on `OrcaRuntimeService` as a thin adapter over the existing
`createManagedWorktree`, passing `orchestrationContext.parentWorktreeId = directorWorktreeId` so
`selectSpawnedWorktreeIds` discovers the workers **with no Mission Control change**. Ship the
bridge in a **single-task, opt-in, default-off** first slice that only has to make one worker
visible; defer the track-reuse/serialization machinery to slice 2. Keep `target_key` and the DB
schema untouched, and gate the one behavior change behind a default-off flag for upstream.
</content>
</invoke>
