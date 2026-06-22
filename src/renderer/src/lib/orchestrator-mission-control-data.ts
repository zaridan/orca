import type { WorktreeLineage } from '../../../shared/types'

// Why: a director's workers are the worktrees whose lineage parent is the
// director's own worktree. `orca worktree create`, run by the director inside
// its checkout, captures that checkout as the parent (cwd-context, or
// orchestration-context when dispatched) — so the renderer can list a director's
// workers from the synced `worktreeLineageById` map with no backend changes.
// Filtered to still-live worktrees so torn-down workers drop off; oldest first.
export function selectSpawnedWorktreeIds(
  directorWorktreeId: string,
  worktreeLineageById: Record<string, WorktreeLineage>,
  isLive: (worktreeId: string) => boolean
): string[] {
  return Object.values(worktreeLineageById)
    .filter(
      (lineage) => lineage.parentWorktreeId === directorWorktreeId && isLive(lineage.worktreeId)
    )
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((lineage) => lineage.worktreeId)
}
