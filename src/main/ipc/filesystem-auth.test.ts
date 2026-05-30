import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Store } from '../persistence'
import { listRepoWorktrees } from '../repo-worktrees'
import {
  invalidateAuthorizedRootsCache,
  rebuildAuthorizedRootsCache,
  resolveRegisteredWorktreePath
} from './filesystem-auth'

vi.mock('../repo-worktrees', () => ({
  isRepoRoot: vi.fn(() => false),
  listRepoWorktrees: vi.fn()
}))

const listRepoWorktreesMock = vi.mocked(listRepoWorktrees)

function createStore(repoPath: string): Store {
  return {
    getRepos: () => [{ id: 'repo-1', path: repoPath }],
    getSettings: () => ({ workspaceDir: '' })
  } as unknown as Store
}

afterEach(() => {
  invalidateAuthorizedRootsCache()
  listRepoWorktreesMock.mockReset()
  vi.restoreAllMocks()
})

describe('filesystem auth registered worktree roots', () => {
  it('registers very large worktree lists during cache rebuild', async () => {
    const repoPath = '/repo/main'
    const targetWorktreePath = '/linked-worktrees/worktree-129999'
    const worktrees = Array.from({ length: 130_000 }, (_, index) => ({
      path: `/linked-worktrees/worktree-${index}`
    }))
    listRepoWorktreesMock.mockResolvedValue(
      worktrees as Awaited<ReturnType<typeof listRepoWorktrees>>
    )
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    await rebuildAuthorizedRootsCache(createStore(repoPath))

    await expect(
      resolveRegisteredWorktreePath(targetWorktreePath, createStore(repoPath))
    ).resolves.toBe(resolve(targetWorktreePath))
  })
})
