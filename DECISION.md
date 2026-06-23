# F1 design decision: Approach B (`coordinator_run_id` column), not Approach A (per-run DB files)

Issue: #12 / Orca bug #4389 — two coordinator runs share one orchestration SQLite
DB and poach each other's work (global task DAG + dispatch/message namespace).

The brief prefers **Approach A** (a per-run DB file, `orchestration-<runId>.db`, via a
`getOrchestrationDb(runId?)` overload) and requires this written note before
falling back to **Approach B** (`coordinator_run_id` on the run-scoped tables).

After reading the full backend, A is **clearly worse for this codebase**. Three
concrete, code-level reasons:

## 1. Tasks are created *before* a run exists — A would have to move rows between files

The supported flow is `orchestration.taskCreate` (RPC) → … → `orchestration.run`
(RPC). The coordinator's `decompose()` (`coordinator.ts`) *requires* tasks to
already exist ("Create tasks with orchestration.taskCreate before running the
coordinator"). At task-creation time there is **no runId**. Under per-run files,
those rows live in the wrong file and would have to be physically migrated into
`orchestration-<runId>.db` at run-start (export/import across DB connections).
Under a `coordinator_run_id` column, run-start simply **adopts** unowned rows with
one `UPDATE … WHERE coordinator_run_id IS NULL`.

## 2. The whole worker/runtime surface is handle-addressed with no runId in scope

Every worker RPC (`send`, `check`, `reply`, `taskUpdate`, `ask`) and every runtime
path that touches the DB keys off a **terminal handle**, never a runId:
- `deliverPendingMessages` (push-on-idle) — `orca-runtime.ts`, by handle
- `failActiveDispatchOnExit` — by handle
- `getAgentStatusOrchestrationContextForHandle` / agent-status UI — by handle

For per-run files, each of these would need a reliable **handle → run → DB-file**
resolver. RPC calls are self-identified by a `--from`/`--terminal` param with no
enforced run context, so the resolver would be a net-new shared registry (in-memory
map, lost on restart → orphaned runs = F3 territory) plus multi-DB fan-out and
connection-lifecycle management. That **re-introduces shared routing state** — the
exact thing A was supposed to remove — at strictly more surface and risk than a
column, for identical isolation.

## 3. Atomic run-start *and* cross-run supervision both want one shared table

The atomic run-start guard only gives **cross-process** mutual exclusion if every
run shares one `coordinator_runs` table. (The current in-memory
`getActiveCoordinatorRun()` check does not span processes — that is *why* two
coordinators clash: separate runtimes, same DB file.) Per-run files force a
**separate shared registry DB** anyway, so A is really "per-run files + a shared
registry" — a two-tier schema that is more complex than B's single file, not the
clean structural win the brief imagines. The same applies to the supervisor
enumerations (`listCoordinatorRuns`, `getActiveDispatchForTerminal`) which must see
across runs.

## What Approach B does here

- Add nullable `coordinator_run_id` to `tasks`, `dispatch_contexts`, `decision_gates`
  (schema v5 → v6). Run-scoped coordinator reads filter by it; run-start adopts
  unowned tasks; `taskCreate` stamps the active run.
- **Per-run coordinator handle**: `orchestration.run` derives a unique
  `coordinator-<hex>` handle instead of defaulting to the literal `'coordinator'`.
  This is the message-inbox isolation mechanism — worker→coordinator mail is routed
  to a unique handle, so two runs can't consume each other's `worker_done`/`heartbeat`.
  (Worker→coordinator messages can't carry a runId — the worker never learns one —
  so a `coordinator_run_id` column on `messages` would have no reliable writer;
  unique handles are the correct fix for message routing.)
- **Atomic, per-target run-start** (schema v6 → v7): concurrent Orcastrators in
  different repos/worktrees are a supported product feature, so the guard must
  block only a *duplicate run on the same target*, not all concurrency.
  `coordinator_runs.target_key` identifies the run's repo/worktree.
  `startCoordinatorRun` wraps the check+insert in **`BEGIN IMMEDIATE`** and rejects
  only when a `status='running'` row exists **for the same `target_key`**, throwing
  `CoordinatorRunConflictError` (mapped to a friendly RPC error). `BEGIN IMMEDIATE`
  (not a partial unique index) is the mechanism: it takes the write lock up front so
  the check+insert is serialized across connections/processes, while leaving the
  table free to hold multiple concurrent `running` rows on *different* targets — a
  global `WHERE status='running'` unique index could not.
- **Per-target task ownership** (schema v7 → v8): the target boundary must reach
  task ownership, or concurrent runs poach each other's tasks. `tasks.target_key`
  is stamped at `taskCreate` (resolved from the creating terminal's worktree);
  `adoptUnownedTasks(runId, targetKey)` claims only same-target unowned tasks; and
  `taskCreate`'s mid-run stamping uses `getActiveCoordinatorRunForTarget` (not the
  global latest run). So run A (target X) and run B (target Y) adopt disjoint sets.
- **Stable target identity / fail-closed resolution**: `target_key` must be the
  *same* string for a target everywhere, or the guard can't see a duplicate.
  `resolveOrchestrationTargetKey` resolves a worktree selector to `worktree:<id>`
  and **fails closed** (throws → the run is refused) if it can't, rather than
  guessing a divergent key that would let two coordinators share a target. Runs
  with no `--worktree` resolve to `null` and share one slot. Tasks resolve their
  key from the creating terminal's worktree id (the same stable id), falling back
  to `null` only when the handle can't resolve (the task then shares the null slot).
- Cross-run supervisor queries (push-on-idle, exit attribution, activity dots)
  stay handle-based / fan over `listCoordinatorRuns` — the minimal cross-run surface.

Isolation guarantee is identical to A for the leaking tables (tasks, dispatches,
gates) and the message inbox, with far less plumbing and no new shared routing layer.

### Known limitations (acknowledged, out of F1 scope)

- Runs started with **no `--worktree`** share a single null-target slot, so two
  no-selector Orcastrators in different repos can't run concurrently (the second
  is blocked). Safe-by-default; pass `--worktree` to run them in parallel.
- `failActiveDispatchOnExit` routes the exit escalation to the dispatch's own run;
  for a **legacy dispatch with NULL `coordinator_run_id`** (pre-v6) it falls back
  to the global latest running run, which under concurrency may misroute. Narrow
  (only un-stamped rows — new dispatches always carry their run).
- `orchestration.runStop` stops the most-recently-started run (single module-scope
  `activeCoordinator`); per-run stop selection is **F4**'s job.
- Orphaned `status='running'` rows after a crash are **F3**'s reconcile job.
