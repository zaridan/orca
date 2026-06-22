import { describe, expect, it } from 'vitest'
import { parseOrchestrateLogOutcomes, selectShippedWork } from './orcastrate-log-shipped-work'

const LOG = [
  JSON.stringify({
    type: 'plan',
    id: 'p-1',
    repo: 'gtm',
    worktrees: [
      { name: 'chore/gtm-e2e-ci', becomes_pr: 'Wire split E2E into ci.yml' },
      { name: 'fix/gtm-brand-copy-audit', becomes_pr: 'brand-review sweep' },
      { name: 'feat/gtm-cf-web-analytics', becomes_pr: 'Add CF Web Analytics beacon' }
    ]
  }),
  '   ', // blank-ish line is skipped
  '{ not valid json', // unparseable line is skipped
  JSON.stringify({
    type: 'outcome',
    plan_id: 'p-1',
    results: [
      { name: 'chore/gtm-e2e-ci', tag: 'shipped' },
      { name: 'fix/gtm-brand-copy-audit', tag: 'shipped' },
      { name: 'feat/gtm-cf-web-analytics', tag: 'over_split' }
    ]
  }),
  // a later outcome with no matching plan → no description
  JSON.stringify({
    type: 'outcome',
    plan_id: 'p-2',
    results: [{ name: 'fix/gtm-content-launch-polish', tag: 'shipped' }]
  })
].join('\n')

describe('parseOrchestrateLogOutcomes', () => {
  it('joins each outcome to its plan description by name', () => {
    const items = parseOrchestrateLogOutcomes(LOG)
    expect(items).toEqual([
      {
        name: 'chore/gtm-e2e-ci',
        tag: 'shipped',
        description: 'Wire split E2E into ci.yml'
      },
      { name: 'fix/gtm-brand-copy-audit', tag: 'shipped', description: 'brand-review sweep' },
      {
        name: 'feat/gtm-cf-web-analytics',
        tag: 'over_split',
        description: 'Add CF Web Analytics beacon'
      },
      { name: 'fix/gtm-content-launch-polish', tag: 'shipped' }
    ])
  })

  it('takes the latest tag when a name appears in multiple outcomes', () => {
    const log = [
      JSON.stringify({ type: 'outcome', results: [{ name: 'a', tag: 'over_split' }] }),
      JSON.stringify({ type: 'outcome', results: [{ name: 'a', tag: 'shipped' }] })
    ].join('\n')
    expect(parseOrchestrateLogOutcomes(log)).toEqual([{ name: 'a', tag: 'shipped' }])
  })

  it('returns nothing for an empty log', () => {
    expect(parseOrchestrateLogOutcomes('')).toEqual([])
  })
})

describe('selectShippedWork', () => {
  it('keeps only shipped outcomes', () => {
    const shipped = selectShippedWork(parseOrchestrateLogOutcomes(LOG))
    expect(shipped.map((item) => item.name)).toEqual([
      'chore/gtm-e2e-ci',
      'fix/gtm-brand-copy-audit',
      'fix/gtm-content-launch-polish'
    ])
  })
})
