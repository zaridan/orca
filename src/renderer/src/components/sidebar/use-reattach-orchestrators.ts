import { useEffect } from 'react'
import { useAppStore } from '@/store'

// Why: director worktrees outlive the in-memory registry, so rebuild it from
// them on load and whenever worktrees OR their tabs change. This lives at the
// sidebar root (not inside the collapsible Orcastrators section, which only
// mounts when the sidebar is open) so a closed sidebar can't skip reattach and
// leave `useIsOrchestratorActiveWorktree` consumers with stale state. Keyed on
// `tabsByWorktree` too: an entry skipped because its tab hadn't hydrated yet is
// reattached the instant the tab appears, not only on the next worktree change.
export function useReattachOrchestrators(): void {
  const enabled = useAppStore((s) => s.settings?.experimentalOrchestrators ?? false)
  const worktreesByRepo = useAppStore((s) => s.worktreesByRepo)
  const tabsByWorktree = useAppStore((s) => s.tabsByWorktree)
  const reattachOrchestrators = useAppStore((s) => s.reattachOrchestrators)
  useEffect(() => {
    if (enabled) {
      reattachOrchestrators()
    }
  }, [enabled, worktreesByRepo, tabsByWorktree, reattachOrchestrators])
}
