import { describe, expect, it } from 'vitest'
import { selectSpawnedWorktreeIds } from './orchestrator-mission-control-data'
import type { WorktreeLineage } from '../../../shared/types'

function lineage(
  over: Partial<WorktreeLineage> & Pick<WorktreeLineage, 'worktreeId'>
): WorktreeLineage {
  return {
    worktreeInstanceId: `${over.worktreeId}-inst`,
    parentWorktreeId: 'director',
    parentWorktreeInstanceId: 'director-inst',
    origin: 'orchestration',
    capture: { source: 'cwd-context', confidence: 'explicit' },
    createdAt: 0,
    ...over
  }
}

const byId = (entries: WorktreeLineage[]): Record<string, WorktreeLineage> =>
  Object.fromEntries(entries.map((entry) => [entry.worktreeId, entry]))

describe('selectSpawnedWorktreeIds', () => {
  it('returns only worktrees whose lineage parent is the director, oldest first', () => {
    const map = byId([
      lineage({ worktreeId: 'w2', createdAt: 200 }),
      lineage({ worktreeId: 'w1', createdAt: 100 }),
      lineage({ worktreeId: 'other', parentWorktreeId: 'someone-else', createdAt: 150 })
    ])
    expect(selectSpawnedWorktreeIds('director', map, () => true)).toEqual(['w1', 'w2'])
  })

  it('drops worktrees that are no longer live', () => {
    const map = byId([
      lineage({ worktreeId: 'w1', createdAt: 100 }),
      lineage({ worktreeId: 'w2', createdAt: 200 })
    ])
    const live = new Set(['w1'])
    expect(selectSpawnedWorktreeIds('director', map, (id) => live.has(id))).toEqual(['w1'])
  })

  it('returns an empty list when the director has spawned nothing', () => {
    const map = byId([lineage({ worktreeId: 'w1', parentWorktreeId: 'another-director' })])
    expect(selectSpawnedWorktreeIds('director', map, () => true)).toEqual([])
  })

  // Why (F2 #13): the consumer half of the bridge. The coordinator's
  // createWorktree records lineage with origin 'orchestration', capture source
  // 'orchestration-context', and parentWorktreeId = the director worktree.
  // This asserts Mission Control's selector discovers such a worker with no MC
  // change — the producing half (coordinator emits this edge) is asserted in
  // src/main/runtime/orchestration/coordinator.test.ts.
  it('discovers a coordinator-created worktree-backed worker (F2 bridge)', () => {
    const directorWorktreeId = 'director-wt'
    const map = byId([
      {
        worktreeId: 'wt_child_0',
        worktreeInstanceId: 'wt_child_0-inst',
        parentWorktreeId: directorWorktreeId,
        parentWorktreeInstanceId: `${directorWorktreeId}-inst`,
        origin: 'orchestration',
        capture: { source: 'orchestration-context', confidence: 'explicit' },
        orchestrationRunId: 'run_abc',
        taskId: 'task_abc',
        coordinatorHandle: 'coordinator-deadbeef',
        createdAt: 0
      }
    ])
    expect(selectSpawnedWorktreeIds(directorWorktreeId, map, () => true)).toEqual(['wt_child_0'])
  })
})
