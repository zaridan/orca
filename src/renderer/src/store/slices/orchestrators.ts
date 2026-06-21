import type { StateCreator } from 'zustand'
import type { AppState } from '../types'

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
  removeOrchestrator: (id: string) => void
}

export const createOrchestratorsSlice: StateCreator<AppState, [], [], OrchestratorsSlice> = (
  set
) => ({
  orchestrators: [],
  registerOrchestrator: (entry) =>
    set((s) => ({
      orchestrators: [...s.orchestrators.filter((e) => e.id !== entry.id), entry]
    })),
  removeOrchestrator: (id) =>
    set((s) => ({ orchestrators: s.orchestrators.filter((e) => e.id !== id) }))
})
