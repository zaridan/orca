import type { StateCreator } from 'zustand'
import type { AppState } from '../types'

// Why: a director worktree is created with this displayName prefix (see
// orchestrator-launch.ts). It is the durable, restart-surviving marker used to
// reattach directors after a reload — the in-memory registry does not persist,
// but the worktree (and its name) does.
export const ORCASTRATOR_DISPLAY_PREFIX = 'Orcastrator · '

// Why: an Orcastrator is a persistent "director" session. We track the launched
// ones in their own registry so the ORCASTRATORS sidebar section can render
// them (and so its agent tab can be hidden from the project's worktree list).
// Keyed by the agent tab id — an Orcastrator *is* its tab.
export type OrchestratorEntry = {
  id: string
  projectId: string
  projectName: string
  worktreeId: string
  tabId: string
  launchedAt: number
}

export type OrchestratorsSlice = {
  orchestrators: OrchestratorEntry[]
  registerOrchestrator: (entry: OrchestratorEntry) => void
  /** Optimistic in-memory rename of a director's display name. The durable
   *  source of truth is the worktree displayName (prefixed) — callers must also
   *  persist via updateWorktreeMeta so reattachOrchestrators reconstructs it. */
  updateOrchestrator: (id: string, updates: Partial<Pick<OrchestratorEntry, 'projectName'>>) => void
  removeOrchestrator: (id: string) => void
  /** Close a director: tear down its dedicated worktree (git + checkout) and
   *  drop it from the registry. */
  closeOrchestrator: (id: string) => Promise<void>
  /** Rebuild the registry from existing director worktrees (detected by the
   *  displayName prefix). Idempotent — called on load so directors survive a
   *  reload even though the registry itself is in-memory. */
  reattachOrchestrators: () => void
}

export const createOrchestratorsSlice: StateCreator<AppState, [], [], OrchestratorsSlice> = (
  set,
  get
) => ({
  orchestrators: [],
  registerOrchestrator: (entry) =>
    set((s) => ({
      orchestrators: [...s.orchestrators.filter((e) => e.id !== entry.id), entry]
    })),
  updateOrchestrator: (id, updates) =>
    set((s) => ({
      orchestrators: s.orchestrators.map((e) => (e.id === id ? { ...e, ...updates } : e))
    })),
  removeOrchestrator: (id) =>
    set((s) => ({ orchestrators: s.orchestrators.filter((e) => e.id !== id) })),
  closeOrchestrator: async (id) => {
    const entry = get().orchestrators.find((e) => e.id === id)
    if (!entry) {
      return
    }
    // Why: drop the registry entry first so the UI removes it immediately; the
    // worktree teardown (force — a director branch is a throwaway) runs after.
    set((s) => ({ orchestrators: s.orchestrators.filter((e) => e.id !== id) }))
    try {
      await get().removeWorktree(entry.worktreeId, true)
    } catch {
      // Why: teardown failed, so the worktree likely still exists — restore the
      // registry entry so the sidebar stays consistent with the actual worktree
      // state instead of dropping a director that's still live.
      set((s) => ({
        orchestrators: [...s.orchestrators.filter((e) => e.id !== entry.id), entry]
      }))
    }
  },
  reattachOrchestrators: () => {
    const state = get()
    const registered = new Set(state.orchestrators.map((e) => e.worktreeId))
    const additions: OrchestratorEntry[] = []
    for (const [repoId, worktrees] of Object.entries(state.worktreesByRepo)) {
      for (const worktree of worktrees) {
        if (
          registered.has(worktree.id) ||
          !worktree.displayName.startsWith(ORCASTRATOR_DISPLAY_PREFIX)
        ) {
          continue
        }
        const project = state.projects.find((p) => p.sourceRepoIds.includes(repoId))
        // Why: the prefixed worktree displayName is the durable source of truth,
        // so a user's rename survives reattach. At launch it's `prefix +
        // project.displayName`, so un-renamed directors reconstruct the same
        // name; fall back to the project/repo only if no name survived the prefix.
        const persistedName = worktree.displayName.slice(ORCASTRATOR_DISPLAY_PREFIX.length).trim()
        additions.push({
          id: worktree.id,
          projectId: project?.id ?? repoId,
          projectName: persistedName || project?.displayName || repoId,
          worktreeId: worktree.id,
          tabId: state.tabsByWorktree[worktree.id]?.[0]?.id ?? '',
          launchedAt: Date.now()
        })
      }
    }
    if (additions.length > 0) {
      set((s) => ({ orchestrators: [...s.orchestrators, ...additions] }))
    }
  }
})
