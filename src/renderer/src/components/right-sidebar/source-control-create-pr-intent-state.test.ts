import { describe, expect, it } from 'vitest'
import { resolveVisibleCreatePrHeaderAction } from './source-control-create-pr-intent-state'
import type { PrimaryAction } from './source-control-primary-action-types'

const createPrIntentAction: PrimaryAction = {
  kind: 'create_pr_intent',
  label: 'Create PR',
  title: 'Preparing branch for review…',
  disabled: true
}

const createPrAction: PrimaryAction = {
  kind: 'create_pr',
  label: 'Create PR',
  title: 'Create a pull request for this branch',
  disabled: false
}

describe('resolveVisibleCreatePrHeaderAction', () => {
  it('keeps the header visible when direct Create PR is available and the branch has changes', () => {
    expect(
      resolveVisibleCreatePrHeaderAction({
        createPrHeaderAction: createPrAction,
        directCreatePrAction: createPrAction,
        isCreatePrIntentInFlight: false,
        primaryActionKind: 'create_pr',
        hasBranchChanges: true
      })
    ).toEqual(createPrAction)
  })

  it('hides the header when the empty state owns direct Create PR on an unchanged branch', () => {
    expect(
      resolveVisibleCreatePrHeaderAction({
        createPrHeaderAction: createPrAction,
        directCreatePrAction: createPrAction,
        isCreatePrIntentInFlight: false,
        primaryActionKind: 'create_pr',
        hasBranchChanges: false
      })
    ).toBeNull()
  })

  it('hides the header while Create PR intent is in flight on the commit-area primary', () => {
    expect(
      resolveVisibleCreatePrHeaderAction({
        createPrHeaderAction: createPrIntentAction,
        directCreatePrAction: null,
        isCreatePrIntentInFlight: true,
        primaryActionKind: 'create_pr_intent'
      })
    ).toBeNull()
  })

  it('keeps the header visible when intent is in flight but the primary is a prerequisite action', () => {
    expect(
      resolveVisibleCreatePrHeaderAction({
        createPrHeaderAction: createPrIntentAction,
        directCreatePrAction: null,
        isCreatePrIntentInFlight: true,
        primaryActionKind: 'publish'
      })
    ).toEqual(createPrIntentAction)
  })
})
