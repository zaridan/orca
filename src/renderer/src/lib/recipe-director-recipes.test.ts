import { describe, it, expect } from 'vitest'
import { compileRecipe, IMPLEMENT_THEN_REVIEW, type Recipe } from './recipe-director-recipes'

// Mirror the coordinator's track-hint contract (parseTrackFromSpec): a leading
// `track: <key>` line on its own line. Kept local so this renderer test does not
// import main-side code across the layer boundary.
function trackHintOf(spec: string): string | null {
  const match = spec.match(/^[ \t]*track:[ \t]*(\S+)[ \t]*$/im)
  return match ? match[1] : null
}

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
    const implementTrack = trackHintOf(implement.spec)
    const reviewTrack = trackHintOf(review.spec)
    expect(implementTrack).not.toBeNull()
    expect(implementTrack).toBe(reviewTrack)
  })

  it('puts the track hint on the first line so the worker spec follows it', () => {
    const compiled = compileRecipe(IMPLEMENT_THEN_REVIEW)
    for (const task of compiled) {
      // First line is the hint; the body (worker instructions) follows after it.
      expect(task.spec).toMatch(/^track: \S+\n/)
      const body = task.spec.replace(/^track: \S+\n+/, '')
      expect(body).not.toMatch(/^track:/m)
      expect(body.trim().length).toBeGreaterThan(0)
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
