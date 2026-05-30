import { describe, expect, it } from 'vitest'
import type { GlobalSettings, Repo } from './types'
import { buildKnownOrcaWorkspaceLayouts } from './worktree-ownership'

describe('buildKnownOrcaWorkspaceLayouts', () => {
  it('handles workspace directory history larger than the JavaScript argument limit', () => {
    const workspaceDirHistory = Array.from({ length: 130_000 }, (_, index) => ({
      path: `/old/workspaces/${index}`,
      nestWorkspaces: index % 2 === 0
    }))
    const settings = {
      workspaceDir: '/orca/workspaces',
      nestWorkspaces: true,
      workspaceDirHistory
    } satisfies Pick<GlobalSettings, 'workspaceDir' | 'nestWorkspaces' | 'workspaceDirHistory'>
    const repo = {
      path: '/repos/app'
    } satisfies Pick<Repo, 'path' | 'connectionId'>

    const layouts = buildKnownOrcaWorkspaceLayouts(settings, repo)

    expect(layouts).toHaveLength(workspaceDirHistory.length + 1)
    expect(layouts.at(-1)).toEqual({ path: '/old/workspaces/129999', nestWorkspaces: false })
  })
})
