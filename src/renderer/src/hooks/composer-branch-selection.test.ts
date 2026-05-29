import { describe, expect, it } from 'vitest'
import { resolveComposerBranchSelection } from './composer-branch-selection'

describe('resolveComposerBranchSelection', () => {
  it('keeps selected remote ref as base without creating a name override', () => {
    expect(
      resolveComposerBranchSelection({
        refName: 'origin/feature/something',
        localBranchName: 'feature/something'
      })
    ).toEqual({
      baseBranch: 'origin/feature/something'
    })
  })

  it('keeps a local branch as base without deriving workspace naming state', () => {
    expect(
      resolveComposerBranchSelection({
        refName: 'origin/feature/something',
        localBranchName: 'feature/something'
      })
    ).toEqual({ baseBranch: 'origin/feature/something' })
  })

  it('keeps a typed branch prefix out of selected-ref resolution', () => {
    expect(
      resolveComposerBranchSelection({
        refName: 'fix/bug-0',
        localBranchName: 'fix/bug-0'
      })
    ).toEqual({ baseBranch: 'fix/bug-0' })
  })
})
