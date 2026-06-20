import type { GitPushTarget, WorktreeMeta } from '../shared/types'
import { splitWorktreeId } from '../shared/worktree-id'
import { areWorktreePathsEqual } from './ipc/worktree-logic'

type WorktreeMetaReader = {
  getAllWorktreeMeta(): Record<string, WorktreeMeta>
  getWorktreeMeta(worktreeId: string): WorktreeMeta | undefined
}

export function getEquivalentWorktreeIdsForRemoval(
  store: WorktreeMetaReader,
  repoId: string,
  requestedWorktreeId: string,
  canonicalWorktreePath: string
): string[] {
  // Why: Windows Git can report the same registered worktree with different
  // separators or drive casing than the renderer's path-derived worktree ID.
  const equivalentIds = new Set([`${repoId}::${canonicalWorktreePath}`, requestedWorktreeId])
  for (const worktreeId of Object.keys(store.getAllWorktreeMeta())) {
    const parsed = splitWorktreeId(worktreeId)
    if (!parsed || parsed.repoId !== repoId) {
      continue
    }
    if (areWorktreePathsEqual(parsed.worktreePath, canonicalWorktreePath)) {
      equivalentIds.add(worktreeId)
    }
  }
  return [...equivalentIds]
}

export function getWorktreeRemovalMetadata(
  store: WorktreeMetaReader,
  worktreeIds: readonly string[]
): { preserveBranchOnDelete: boolean; pushTarget?: GitPushTarget } {
  let preserveBranchOnDelete = false
  let pushTarget: GitPushTarget | undefined
  for (const worktreeId of worktreeIds) {
    const meta = store.getWorktreeMeta(worktreeId)
    if (meta?.preserveBranchOnDelete === true) {
      preserveBranchOnDelete = true
    }
    if (!pushTarget && meta?.pushTarget) {
      pushTarget = meta.pushTarget
    }
  }
  return { preserveBranchOnDelete, ...(pushTarget ? { pushTarget } : {}) }
}

export function omitWorktreeMetaIds(
  store: WorktreeMetaReader,
  omittedWorktreeIds: readonly string[]
): Pick<WorktreeMetaReader, 'getAllWorktreeMeta'> {
  const omitted = new Set(omittedWorktreeIds)
  return {
    getAllWorktreeMeta: () =>
      Object.fromEntries(
        Object.entries(store.getAllWorktreeMeta()).filter(
          ([worktreeId]) => !omitted.has(worktreeId)
        )
      )
  }
}
