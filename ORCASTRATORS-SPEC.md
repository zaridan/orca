# Orcastrators in Orca — Feature Spec

> **Status:** Draft / proposal · captured from a working session · prototype branch: `feat/orcastrators-sidebar`

## TL;DR

Make the **Orcastrate** coordinator workflow a first-class object in Orca. Add an **"Orcastrators" section to the sidebar (above Projects)** with a **`+`** button. Clicking `+` picks a repo and launches a coordinator chat — your default LLM, with the `/orcastrate` skill pre-loaded — ready to brief. Run several at once (one per repo) and watch all their worktrees in the sidebar.

This is a **native packaging layer over capability that already exists** (Orca's `orca orchestration` engine + the `/orcastrate` skill) — **not** a new orchestration engine.

---

## Revised model (v2 — the Orcastrator is a *director*)

Design feedback from the working session reframed the Orcastrator: it is **not a worktree agent**, it is a persistent **director** that lives above the repo.

**Decisions (locked):**

- **Lives in the ORCASTRATORS section.** Once launched, an Orcastrator is a persistent entry in the ORCASTRATORS sidebar section — **not** shown as an agent under Projects. No worktree/branch is displayed for it (irrelevant to a director).
- **Run model:** runs in the repo's **primary checkout** (so it loads `CLAUDE.md` and can call the `orca` CLI), but is **display-decoupled** — rendered in ORCASTRATORS, hidden from the project's worktree list.
- **Write philosophy — disposition, not a sandbox.** The Orcastrator is the ultimate responsible party, so it is **not** hard write-blocked (that could leave it stuck and could break the `orca` commands it relies on). Instead it has **full tools** with a **strong disposition to delegate**: it plans, spins up worktrees/worker agents, runs adversarial reviews (incl. other LLMs), and **decides when work is "done"** — and only writes repo code as a deliberate last resort. Enforced in the coordinator **skill/prompt**, not via per-agent permissions.
- **Persistence:** an open Orcastrator **survives an Orca restart** and reattaches its session.
- **Multiplicity:** **several Orcastrators per project** are allowed (multi-coordinator isolation rules in `orcastrate-coordinator.md` keep them from colliding).

**What this changes vs. Phase 1 (current branch):** Phase 1 opens the coordinator as a tab *in the primary worktree*, so it appears under Projects like a normal agent. v2 requires (a) a persistent Orcastrator registry (survives restart), (b) display-decoupling (show in ORCASTRATORS, hide from the worktree list), and (c) a robust launch that always spawns a fresh director session. The director *behavior* (delegate / decide-done / adversarial review) lives in the skill, not the UI.

---

## Why

Today an Orcastrator is a manual ritual: open a Claude Code chat in a repo's base workspace → type `/orcastrate` → brief it. It works (it plans, spins up worktrees + worker agents, and they appear in the sidebar), but:

- There's no first-class "Orcastrator" object — it's a terminal chat you set up by hand.
- Running several across repos means juggling separate sessions/terminals.
- The behavior knobs (coordinator **TUNABLES**) and the pre-dispatch review gate live in a markdown spec on the honor system, not in the UI.

The `+`-button version removes the setup ritual and makes "three Orcastrators across three repos" a one-click-each reality.

## What an Orcastrator is (recap)

A **coordinator** = a Claude Code session running the `/orcastrate` skill. You brief it; it plans how work splits into worktrees (branch → PR), spins them up, dispatches worker agents, supervises, and logs decisions. The engine underneath is Orca's existing `orca orchestration` CLI/runtime.

---

## The feature

**A new "Orcastrators" sidebar section, above Projects, with a `+` button.**

**`+` flow:**
1. Click `+` → pick which **repo** the Orcastrator runs in (it makes that repo's worktrees and loads its `CLAUDE.md`).
2. Orca opens a coordinator chat in that repo's **primary workspace**, using the **default LLM**, with the `/orcastrate` skill auto-loaded.
3. Brief it and go — no manual `/orcastrate` typing.

**Result:** each Orcastrator is a labelled entry (e.g. "Orcastrator · resonantiq-gtm"). The worktrees/worker-agents it creates show under their project in the sidebar with live status, exactly as they do today.

**Multiple at once:** one coordinator per repo, several repos in parallel. Isolation so they don't fight is handled in the coordinator spec (see Isolation).

---

## Build phases

| Phase | Scope |
| --- | --- |
| **Phase 1 — Capability** | Orcastrators sidebar section + `+` → repo picker → launches a coordinator chat (default LLM, `/orcastrate` pre-loaded). The whole capability; ship this first. |
| **Phase 2 — Settings** | A per-Orcastrator settings panel exposing the tuning knobs below. Polish; layer on after Phase 1 works. |

## Settings (Phase 2)

Most of these already exist as **TUNABLES** in `~/.claude/orcastrate-coordinator.md` — the panel surfaces them in the UI rather than inventing new behavior.

| Setting | Controls |
| --- | --- |
| **Gate mode** | approve every plan / auto-run single-worktree plans / just go |
| **Parallel bias** | conservative ↔ balanced ↔ aggressive when a split is ambiguous |
| **Max parallel** | how many worktrees run at once |
| **Worker agent** | which LLM the worker agents run (coordinator may differ) |
| **Adversarial reviews from external LLMs** | on/off · which external LLM (e.g. Codex/GPT, Gemini) · # of rounds — runs the pre-dispatch critique gate |

**Note:** the adversarial-review setting **closes a known gap** — today the pre-dispatch review gate (two Codex `/critique` rounds) is on the honor system on the Orca path. Making it an Orcastrator setting turns it into an enforced step.

---

## Isolation (running 3 without collisions)

Multiple coordinators share one Orca orchestration DB, so without discipline they poach each other's workers and wipe each other's state — this is Orca bug [#4389](https://github.com/stablyai/orca/issues/4389). Mitigated at the **skill level** (already added to `~/.claude/orcastrate-coordinator.md`): each coordinator touches **only its own repo's worktrees** — explicit handles or `@worktree:<id>` only, never the global `@idle`/`@all`/`@claude` pools, and never a bare/`--all` reset. A native Orca fix for #4389 would formalize this; until then the scoping discipline lets N coordinators coexist.

## Open design decisions

- **Repo selection** — resolved at `+`-click via a repo picker (decided).
- **Default LLM** — inherit the user's global default model (decided).
- **Settings scope** — global defaults with per-Orcastrator override, vs. per-Orcastrator only (TBD).
- **Lifecycle / teardown** — should the Orcastrator auto-clean its worktrees (`orca worktree rm`) when a job ships? (Desired, not yet in the coordinator spec.)
- **Continuous monitoring** — lean on `orca orchestration run` + `orca worktree ps` so it supervises rather than fire-and-forget (addresses the "task stuck in dispatched" symptom).

---

## Build & contribution notes

- **Build target:** real Orca source feature. Prototype in this fork (`zaridan/orca`) behind an **experimental flag** (Settings → Experimental), for our own use first.
- **Integration points** (from codebase recon):
  - `src/renderer/src/components/sidebar/SidebarNav.tsx` — the new "Orcastrators" section
  - `src/renderer/src/store/slices/ui.ts` — view/launch state
  - the agent-launch path (`createTerminal` + skill preload) in the runtime
  - `src/renderer/src/components/settings/ExperimentalPane.tsx` + `GlobalSettings` (`src/shared/types.ts`) — the experimental flag
- **Upstream caveat:** orchestration is the maintainers' **active P1 epic** ([#5700](https://github.com/stablyai/orca/issues/5700) / [#5707](https://github.com/stablyai/orca/issues/5707)); the orchestration UI is thin but tracked ([#4374](https://github.com/stablyai/orca/issues/4374)), and multi-coordinator collision is a known bug ([#4389](https://github.com/stablyai/orca/issues/4389)). A from-scratch UI PR risks colliding with internal work — so **prototype for ourselves first**; upstreaming is a separate conversation with maintainers (or contribute to the existing assigned issues instead).

## Launch mechanism (verified against the codebase)

The hard part — how `+` actually spawns a coordinator in a repo's existing **primary** worktree with `/orcastrate` seeded. Traced and confirmed real (renderer-side):

1. **Repo → primary worktree:** `getProjectDefaultCheckout(state.worktreesByRepo[repoId] ?? [])` → the worktree with `isMainWorktree === true` (`src/renderer/src/components/sidebar/project-added-default-checkout.ts`). A `Project` (`s.projects`) maps to repos via `Project.sourceRepoIds`.
2. **Agent type:** `TuiAgent` literal for Claude Code is `'claude'` (`src/shared/types.ts:2208`). Prefer `settings.defaultTuiAgent` when set (≠ `'blank'`), else `'claude'`.
3. **Open the tab:** `state.createTab(worktreeId, undefined, undefined, { activate: true, launchAgent: agent })` → returns a `TerminalTab` with `.id`. NOTE: `launchAgent` is metadata only — it does **not** start the agent process.
4. **Start the agent + seed prompt:** the agent *command* is delivered via the worktree-activation **startup payload**, and the prompt via `ensureAgentStartupInTerminal({ worktreeId, primaryTabId: tab.id, startup })` (`src/renderer/src/lib/new-workspace.ts:237`), which polls for the PTY then bracketed-pastes `startup.draftPrompt` via `pasteDraftWhenAgentReady` (`src/renderer/src/lib/agent-paste-draft.ts:72`). Both fed by `buildAgentStartupPlan({ agent, prompt: '/orcastrate', … })` (`src/renderer/src/lib/tui-agent-startup.ts`).

**Two args still to nail before writing the helper** (copy from the composer submit path in `useComposerState.ts` ~2866–3102): the exact `buildAgentStartupPlan` argument set (`cmdOverrides`, `agentArgs`, `agentEnv`, `platform`) and how its output maps onto the `activateAndRevealWorktree(worktreeId, { startup })` payload. Everything else above is confirmed.

**Do NOT use** `launchWorkItemDirect` — it creates a *new* worktree from an issue/PR; the Orcastrator runs in the *existing* primary.

## v2 build plan (the director rearchitect)

> **Status — BUILT (on `feat/orcastrators-sidebar`, behind `experimentalOrchestrators`).** All steps below are implemented, unit-tested (`orchestrators.test.ts`, 7 tests), and live-verified except where noted:
> - ✅ **Experimental flag + Settings toggle** — verified.
> - ✅ **Launch** — verified: spawns a director and `/orcastrate` auto-runs (paste timeout raised to 90s for cold boots).
> - ✅ **Registry + navigator** — verified: directors listed in ORCASTRATORS, active entry highlighted with the worktree card's exact active surface (shared `.orcastrator-active-surface` CSS rule), status via shared `AgentStateDot`.
> - ✅ **Dedicated worktree (C)** — verified: director runs in its *own* worktree (`createWorktree`, skip-setup), **hidden from Projects** via the registry filter in `WorktreeList`.
> - ✅ **Reattach (persistence)** — *code-complete + unit-tested; pending live verification.* On load, `reattachOrchestrators` detects director worktrees by the `ORCASTRATOR_DISPLAY_PREFIX` displayName marker and rebuilds the in-memory registry, so directors survive a reload.
> - ✅ **Close + cleanup** — *code-complete + unit-tested; pending live verification.* X-on-hover → `closeOrchestrator` tears down the director's worktree (`removeWorktree`, force) and drops the registry entry.
>
> **Design note:** the director runs in a dedicated worktree (not the primary checkout) — the cleaner of the two run-models, decided mid-build because sharing `main` kept coupling the director to the project's worktree. Write philosophy stays disposition-based (in the coordinator skill), not a permission sandbox.
>
> **Known follow-ups:** if `buildAgentStartupPlan` returns null (agent unresolvable) the worktree is created without an agent; multi-director-per-project works but isn't yet stress-tested live.

The original ordered plan (now implemented) follows.

Concrete, ordered steps to take the current Phase-1 launch → the v2 director model. Sequenced low-risk first.

1. **Launch robustness (carries into v2).** Current `orchestrator-launch.ts` relies on `activateAndRevealWorktree({ startup })`, which **no-ops when the worktree is already active** (relaunch spawns nothing) and whose paste loses to the first-run trust gate. Fix: explicitly `createTab(worktreeId, undefined, undefined, { activate: true, launchAgent })` to force a fresh tab, deliver the startup command to *that* tab, and make the prompt paste **wait through** the trust gate (retry/extend `pasteDraftWhenAgentReady` timeout, or detect the trust prompt and answer/raise the budget). Verify: relaunch into an open worktree spawns a fresh director and `/orcastrate` lands on a trusted folder.

2. **Orcastrator registry (state).** New store slice: `orchestrators: { id, projectId, projectName, agentTabId, worktreeId, launchedAt, status }[]`. `launchOrchestratorForProject` records an entry. The ORCASTRATORS sidebar section renders **registry entries** (clickable → focus that tab), not just the `+`. Status mirrors the agent's idle/working state via the existing agent-status store.

3. **Persistence + reattach (locked: survive restart).** Persist the registry through Orca's session writer (same path as other persisted slices — see `createSessionWriteSubscriber` in `App.tsx`). On startup, restore entries and re-bind each to its still-living agent tab (Orca already retains agent sessions — see `RetainedAgentsSyncGate`); drop entries whose tab is gone.

4. **Display-decoupling (the hard UI bit).** The director runs in the primary worktree but must **not** appear under Projects. Approaches, in preference order: (a) tag the agent tab as an Orcastrator and **filter it out** of `WorktreeList` agent rendering by tab id; (b) if filtering proves too invasive, run the director in a dedicated hidden/virtual worktree. Render it **only** in the ORCASTRATORS section with no worktree/branch shown.

5. **Director behavior (DONE — in the skill, not the UI).** `~/.claude/orcastrate-coordinator.md` now carries "The director's role": delegate by default, decide "done", run adversarial reviews, write only as a last resort. No per-agent permission wiring needed.

6. **Multiplicity (locked: several per project).** Registry already supports N entries per `projectId`; the isolation rules in the coordinator spec keep concurrent directors from colliding on orchestration state.

**Risk note:** steps 2–4 touch Orca-internal store/persistence/sidebar-rendering that isn't runtime-verified yet — build behind the existing `experimentalOrchestrators` flag and verify each in the dev build before committing, so `main`/the branch never breaks.

## Related Orca issues

- [#5700](https://github.com/stablyai/orca/issues/5700) — Agent Control Surface Parity (epic)
- [#5707](https://github.com/stablyai/orca/issues/5707) — structured multi-agent orchestration
- [#4374](https://github.com/stablyai/orca/issues/4374) — Inconsistent orchestration UI
- [#4376](https://github.com/stablyai/orca/issues/4376) — Improved orchestration (worker → coordinator signalling)
- [#4389](https://github.com/stablyai/orca/issues/4389) — Multiple orchestrators in a single workspace kill each other
