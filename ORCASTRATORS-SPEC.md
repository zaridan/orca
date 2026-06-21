# Orcastrators in Orca — Feature Spec

> **Status:** Draft / proposal · captured from a working session · prototype branch: `feat/orcastrators-sidebar`

## TL;DR

Make the **Orcastrate** coordinator workflow a first-class object in Orca. Add an **"Orcastrators" section to the sidebar (above Projects)** with a **`+`** button. Clicking `+` picks a repo and launches a coordinator chat — your default LLM, with the `/orcastrate` skill pre-loaded — ready to brief. Run several at once (one per repo) and watch all their worktrees in the sidebar.

This is a **native packaging layer over capability that already exists** (Orca's `orca orchestration` engine + the `/orcastrate` skill) — **not** a new orchestration engine.

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

## Related Orca issues

- [#5700](https://github.com/stablyai/orca/issues/5700) — Agent Control Surface Parity (epic)
- [#5707](https://github.com/stablyai/orca/issues/5707) — structured multi-agent orchestration
- [#4374](https://github.com/stablyai/orca/issues/4374) — Inconsistent orchestration UI
- [#4376](https://github.com/stablyai/orca/issues/4376) — Improved orchestration (worker → coordinator signalling)
- [#4389](https://github.com/stablyai/orca/issues/4389) — Multiple orchestrators in a single workspace kill each other
