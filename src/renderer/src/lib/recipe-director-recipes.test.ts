import { describe, it, expect } from 'vitest'
import {
  compileRecipe,
  getRecipes,
  IMPLEMENT_THEN_REVIEW,
  REPRO_FIX_VERIFY,
  SINGLE_WORKER_PR,
  type Recipe
} from './recipe-director-recipes'

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

  it('compiles single_worker_pr to one task with its own per-task track and no deps', () => {
    const compiled = compileRecipe(SINGLE_WORKER_PR)

    expect(compiled.map((t) => t.key)).toEqual(['deliver'])
    expect(compiled[0].dependsOn).toEqual([])
    // No explicit track → track defaults to the task key → its own worktree/PR.
    expect(trackHintOf(compiled[0].spec)).toBe('deliver')
  })

  it('compiles repro_fix_verify to three same-track tasks chained repro→fix→verify', () => {
    const compiled = compileRecipe(REPRO_FIX_VERIFY)

    expect(compiled.map((t) => t.key)).toEqual(['repro', 'fix', 'verify'])

    const [repro, fix, verify] = compiled
    expect(repro.dependsOn).toEqual([])
    expect(fix.dependsOn).toEqual(['repro'])
    expect(verify.dependsOn).toEqual(['fix'])

    // All three share one track → one worktree, one branch, one PR.
    const tracks = compiled.map((t) => trackHintOf(t.spec))
    expect(tracks.every((t) => t !== null)).toBe(true)
    expect(new Set(tracks).size).toBe(1)
  })

  it('repro_fix_verify deps form a total order on its single track', () => {
    const compiled = compileRecipe(REPRO_FIX_VERIFY)

    // The coordinator refuses same-track tasks that are not totally ordered by
    // deps. Verify the chain is a strict total order: each task (after the first)
    // transitively depends on every earlier same-track task, with no ties.
    const indexByKey = new Map(compiled.map((t, i) => [t.key, i]))
    const depsByKey = new Map(compiled.map((t) => [t.key, t.dependsOn]))

    const dependsTransitively = (from: string, on: string): boolean => {
      const stack = [...(depsByKey.get(from) ?? [])]
      while (stack.length > 0) {
        const next = stack.pop()!
        if (next === on) {
          return true
        }
        stack.push(...(depsByKey.get(next) ?? []))
      }
      return false
    }

    // For every ordered pair (earlier, later), the later one must depend on the
    // earlier one — that is exactly what "totally ordered by deps" means.
    for (let i = 0; i < compiled.length; i++) {
      for (let j = i + 1; j < compiled.length; j++) {
        const earlier = compiled[i].key
        const later = compiled[j].key
        expect(dependsTransitively(later, earlier)).toBe(true)
      }
    }
    // Sanity: compile order matches dependency order.
    expect(indexByKey.get('repro')).toBeLessThan(indexByKey.get('fix')!)
    expect(indexByKey.get('fix')).toBeLessThan(indexByKey.get('verify')!)
  })
})

describe('getRecipes', () => {
  it('returns all three built-in recipes by name', () => {
    const names = getRecipes().map((r) => r.name)
    expect(names).toEqual(['implement_then_review', 'single_worker_pr', 'repro_fix_verify'])
  })

  it('exposes a name and a non-empty description per recipe (picker shape)', () => {
    for (const recipe of getRecipes()) {
      expect(recipe.name.length).toBeGreaterThan(0)
      expect(recipe.description.trim().length).toBeGreaterThan(0)
    }
  })

  it('returns a fresh array so callers cannot mutate the registry', () => {
    const first = getRecipes()
    first.pop()
    expect(getRecipes()).toHaveLength(3)
  })
})
