import { describe, it, expect } from 'vitest'
import { compileRecipe, IMPLEMENT_THEN_REVIEW, type Recipe } from './recipe-director-recipes'
import { parseTrackFromSpec } from '../../../main/runtime/orchestration/coordinator'

describe('compileRecipe', () => {
  it('compiles implement_then_review to two same-track tasks with review after implement', () => {
    const compiled = compileRecipe(IMPLEMENT_THEN_REVIEW)

    expect(compiled.map((t) => t.key)).toEqual(['implement', 'review'])

    const implement = compiled[0]
    const review = compiled[1]

    // Review waits on implement → one ordered chain (satisfies the coordinator's
    // same-track safe-ordering guard) and a real implement→review handoff.
    expect(implement.dependsOn).toEqual([])
    expect(review.dependsOn).toEqual(['implement'])

    // Both carry a `track:` hint the coordinator parses, and it is the SAME track
    // → one worktree, one branch, one PR.
    const implementTrack = parseTrackFromSpec(implement.spec).trackKey
    const reviewTrack = parseTrackFromSpec(review.spec).trackKey
    expect(implementTrack).not.toBeNull()
    expect(implementTrack).toBe(reviewTrack)
  })

  it('strips the track hint cleanly so the worker spec survives', () => {
    const compiled = compileRecipe(IMPLEMENT_THEN_REVIEW)
    for (const task of compiled) {
      const { strippedSpec } = parseTrackFromSpec(task.spec)
      expect(strippedSpec).not.toMatch(/^track:/m)
      expect(strippedSpec.trim().length).toBeGreaterThan(0)
    }
  })

  it('emits dependencies before dependents regardless of declaration order', () => {
    const recipe: Recipe = {
      name: 'r',
      description: 'd',
      tasks: [
        { key: 'b', spec: 'b', dependsOn: ['a'] },
        { key: 'a', spec: 'a' }
      ]
    }
    expect(compileRecipe(recipe).map((t) => t.key)).toEqual(['a', 'b'])
  })

  it('rejects an unknown dependency', () => {
    const recipe: Recipe = {
      name: 'r',
      description: 'd',
      tasks: [{ key: 'a', spec: 'a', dependsOn: ['missing'] }]
    }
    expect(() => compileRecipe(recipe)).toThrow(/unknown task 'missing'/)
  })

  it('rejects a dependency cycle', () => {
    const recipe: Recipe = {
      name: 'r',
      description: 'd',
      tasks: [
        { key: 'a', spec: 'a', dependsOn: ['b'] },
        { key: 'b', spec: 'b', dependsOn: ['a'] }
      ]
    }
    expect(() => compileRecipe(recipe)).toThrow(/cycle/)
  })

  it('rejects a self-dependency', () => {
    const recipe: Recipe = {
      name: 'r',
      description: 'd',
      tasks: [{ key: 'a', spec: 'a', dependsOn: ['a'] }]
    }
    expect(() => compileRecipe(recipe)).toThrow(/depends on itself/)
  })

  it('rejects duplicate task keys', () => {
    const recipe: Recipe = {
      name: 'r',
      description: 'd',
      tasks: [
        { key: 'a', spec: 'a' },
        { key: 'a', spec: 'a2' }
      ]
    }
    expect(() => compileRecipe(recipe)).toThrow(/duplicate task keys/)
  })
})
