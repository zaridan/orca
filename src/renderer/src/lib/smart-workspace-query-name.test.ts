import { describe, expect, it } from 'vitest'
import {
  getManualWorkspaceNameFromSmartInput,
  isSmartWorkspaceLinearSourceIntent,
  isSmartWorkspaceSourceIntent
} from './smart-workspace-query-name'

describe('getManualWorkspaceNameFromSmartInput', () => {
  it('uses visible plain smart-field text before a stale explicit name', () => {
    expect(
      getManualWorkspaceNameFromSmartInput({
        name: 'custom name',
        smartSourceQuery: 'search text'
      })
    ).toBe('search text')
  })

  it('treats plain smart-field text as an explicit workspace name', () => {
    expect(
      getManualWorkspaceNameFromSmartInput({
        name: '',
        smartSourceQuery: 'billing cleanup'
      })
    ).toBe('billing cleanup')
  })

  it('does not treat source-looking smart-field text as a workspace name', () => {
    for (const smartSourceQuery of [
      '#2049',
      'https://github.com/stablyai/orca/pull/2049',
      'https://gitlab.com/group/project/-/merge_requests/42',
      'ENG-123'
    ]) {
      expect(getManualWorkspaceNameFromSmartInput({ name: '', smartSourceQuery })).toBe('')
    }
  })

  it('falls back to explicit name when smart-field text is empty or source-looking', () => {
    expect(
      getManualWorkspaceNameFromSmartInput({
        name: 'custom name',
        smartSourceQuery: ''
      })
    ).toBe('custom name')
    expect(
      getManualWorkspaceNameFromSmartInput({
        name: 'custom name',
        smartSourceQuery: '#2049'
      })
    ).toBe('custom name')
  })
})

describe('isSmartWorkspaceSourceIntent', () => {
  it('leaves plain numbers, GitLab shorthand, and prose available as names', () => {
    expect(isSmartWorkspaceSourceIntent('2049')).toBe(false)
    expect(isSmartWorkspaceSourceIntent('!42')).toBe(false)
    expect(isSmartWorkspaceSourceIntent('billing cleanup')).toBe(false)
    expect(isSmartWorkspaceSourceIntent('release-2026')).toBe(false)
    expect(isSmartWorkspaceSourceIntent('abc-123')).toBe(false)
  })

  it('leaves Linear identifiers available as names when Linear is unavailable', () => {
    expect(
      getManualWorkspaceNameFromSmartInput({
        name: '',
        smartSourceQuery: 'ENG-123',
        linearEnabled: false
      })
    ).toBe('ENG-123')
    expect(isSmartWorkspaceSourceIntent('ENG-123', { linearEnabled: false })).toBe(false)
  })
})

describe('isSmartWorkspaceLinearSourceIntent', () => {
  it('only treats Linear-style identifiers as Linear source intent', () => {
    expect(isSmartWorkspaceLinearSourceIntent('ENG-123')).toBe(true)
    expect(isSmartWorkspaceLinearSourceIntent('abc-123')).toBe(false)
    expect(isSmartWorkspaceLinearSourceIntent('release-2026')).toBe(false)
    expect(isSmartWorkspaceLinearSourceIntent('plain-smart-name')).toBe(false)
    expect(isSmartWorkspaceLinearSourceIntent('billing cleanup')).toBe(false)
  })
})
