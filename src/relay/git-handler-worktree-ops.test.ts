import { describe, expect, it, vi } from 'vitest'
import type { GitExec } from './git-handler-ops'
import { removeWorktreeOp } from './git-handler-worktree-ops'

function worktreeList(...entries: { path: string; branch?: string }[]): string {
  return entries
    .map((entry, index) =>
      [
        `worktree ${entry.path}`,
        `HEAD ${index}`,
        ...(entry.branch ? [`branch refs/heads/${entry.branch}`] : [])
      ].join('\n')
    )
    .join('\n\n')
}

describe('removeWorktreeOp', () => {
  it('deletes the now-unused branch after removing an SSH worktree', async () => {
    const calls: string[] = []
    let listCount = 0
    const git = vi.fn<GitExec>(async (args, cwd) => {
      calls.push(`${cwd}$ ${args.join(' ')}`)
      if (args[0] === 'rev-parse') {
        return { stdout: '/repo/.git\n', stderr: '' }
      }
      if (args[0] === 'worktree' && args[1] === 'list') {
        listCount += 1
        return {
          stdout:
            listCount === 1
              ? worktreeList(
                  { path: '/repo', branch: 'main' },
                  { path: '/repo-feature', branch: 'feature/test' }
                )
              : worktreeList({ path: '/repo', branch: 'main' }),
          stderr: ''
        }
      }
      return { stdout: '', stderr: '' }
    })

    await removeWorktreeOp(git, { worktreePath: '/repo-feature' })

    expect(calls).toEqual([
      '/repo-feature$ rev-parse --git-common-dir',
      '/repo$ worktree list --porcelain',
      '/repo-feature$ status --porcelain --untracked-files=all',
      '/repo$ worktree remove /repo-feature',
      '/repo$ worktree prune',
      '/repo$ worktree list --porcelain',
      '/repo$ branch -D feature/test'
    ])
  })

  it('preserves the branch when removing an SSH worktree for an existing local branch', async () => {
    const calls: string[] = []
    const git = vi.fn<GitExec>(async (args, cwd) => {
      calls.push(`${cwd}$ ${args.join(' ')}`)
      if (args[0] === 'rev-parse') {
        return { stdout: '/repo/.git\n', stderr: '' }
      }
      if (args[0] === 'worktree' && args[1] === 'list') {
        return {
          stdout: worktreeList(
            { path: '/repo', branch: 'main' },
            { path: '/repo-feature', branch: 'feature/test' }
          ),
          stderr: ''
        }
      }
      return { stdout: '', stderr: '' }
    })

    await removeWorktreeOp(git, { worktreePath: '/repo-feature', deleteBranch: false })

    expect(calls).toEqual([
      '/repo-feature$ rev-parse --git-common-dir',
      '/repo$ worktree list --porcelain',
      '/repo-feature$ status --porcelain --untracked-files=all',
      '/repo$ worktree remove /repo-feature',
      '/repo$ worktree prune'
    ])
  })

  it('removes disposable metadata before removing an SSH worktree', async () => {
    const calls: string[] = []
    let listCount = 0
    let statusCount = 0
    const git = vi.fn<GitExec>(async (args, cwd) => {
      calls.push(`${cwd}$ ${args.join(' ')}`)
      if (args[0] === 'rev-parse') {
        return { stdout: '/repo/.git\n', stderr: '' }
      }
      if (args[0] === 'worktree' && args[1] === 'list') {
        listCount += 1
        return {
          stdout:
            listCount === 1
              ? worktreeList(
                  { path: '/repo', branch: 'main' },
                  { path: '/repo-feature', branch: 'feature/test' }
                )
              : worktreeList({ path: '/repo', branch: 'main' }),
          stderr: ''
        }
      }
      if (args[0] === 'status') {
        statusCount += 1
        return {
          stdout: statusCount === 1 ? '?? .DS_Store\n?? nested/.DS_Store\n' : '',
          stderr: ''
        }
      }
      return { stdout: '', stderr: '' }
    })

    await removeWorktreeOp(git, { worktreePath: '/repo-feature' })

    expect(calls).toEqual([
      '/repo-feature$ rev-parse --git-common-dir',
      '/repo$ worktree list --porcelain',
      '/repo-feature$ status --porcelain --untracked-files=all',
      '/repo-feature$ clean -f -q -- .DS_Store :(glob)**/.DS_Store Thumbs.db :(glob)**/Thumbs.db Desktop.ini :(glob)**/Desktop.ini',
      '/repo-feature$ status --porcelain --untracked-files=all',
      '/repo$ worktree remove /repo-feature',
      '/repo$ worktree prune',
      '/repo$ worktree list --porcelain',
      '/repo$ branch -D feature/test'
    ])
  })

  it('does not remove disposable metadata when real untracked files block SSH deletion', async () => {
    const calls: string[] = []
    const git = vi.fn<GitExec>(async (args, cwd) => {
      calls.push(`${cwd}$ ${args.join(' ')}`)
      if (args[0] === 'rev-parse') {
        return { stdout: '/repo/.git\n', stderr: '' }
      }
      if (args[0] === 'worktree' && args[1] === 'list') {
        return {
          stdout: worktreeList(
            { path: '/repo', branch: 'main' },
            { path: '/repo-feature', branch: 'feature/test' }
          ),
          stderr: ''
        }
      }
      if (args[0] === 'status') {
        return { stdout: '?? .DS_Store\n?? scratch.txt\n', stderr: '' }
      }
      return { stdout: '', stderr: '' }
    })

    await expect(removeWorktreeOp(git, { worktreePath: '/repo-feature' })).rejects.toMatchObject({
      message: 'Worktree has uncommitted or untracked changes.',
      stdout: '?? .DS_Store\n?? scratch.txt\n'
    })
    expect(calls).toEqual([
      '/repo-feature$ rev-parse --git-common-dir',
      '/repo$ worktree list --porcelain',
      '/repo-feature$ status --porcelain --untracked-files=all'
    ])
  })

  it('skips disposable metadata cleanup for forced SSH worktree removal', async () => {
    const calls: string[] = []
    let listCount = 0
    const git = vi.fn<GitExec>(async (args, cwd) => {
      calls.push(`${cwd}$ ${args.join(' ')}`)
      if (args[0] === 'rev-parse') {
        return { stdout: '/repo/.git\n', stderr: '' }
      }
      if (args[0] === 'worktree' && args[1] === 'list') {
        listCount += 1
        return {
          stdout:
            listCount === 1
              ? worktreeList(
                  { path: '/repo', branch: 'main' },
                  { path: '/repo-feature', branch: 'feature/test' }
                )
              : worktreeList({ path: '/repo', branch: 'main' }),
          stderr: ''
        }
      }
      return { stdout: '', stderr: '' }
    })

    await removeWorktreeOp(git, { worktreePath: '/repo-feature', force: true })

    expect(calls).toEqual([
      '/repo-feature$ rev-parse --git-common-dir',
      '/repo$ worktree list --porcelain',
      '/repo$ worktree remove --force /repo-feature',
      '/repo$ worktree prune',
      '/repo$ worktree list --porcelain',
      '/repo$ branch -D feature/test'
    ])
  })

  it('keeps the branch when another SSH worktree still uses it', async () => {
    let listCount = 0
    const git = vi.fn<GitExec>(async (args, _cwd) => {
      if (args[0] === 'rev-parse') {
        return { stdout: '/repo/.git\n', stderr: '' }
      }
      if (args[0] === 'worktree' && args[1] === 'list') {
        listCount += 1
        return {
          stdout:
            listCount === 1
              ? worktreeList(
                  { path: '/repo', branch: 'main' },
                  { path: '/repo-feature', branch: 'feature/test' }
                )
              : worktreeList(
                  { path: '/repo', branch: 'main' },
                  { path: '/repo-other', branch: 'feature/test' }
                ),
          stderr: ''
        }
      }
      return { stdout: '', stderr: '' }
    })

    await removeWorktreeOp(git, { worktreePath: '/repo-feature' })

    expect(git).not.toHaveBeenCalledWith(['branch', '-D', 'feature/test'], expect.any(String))
  })
})
