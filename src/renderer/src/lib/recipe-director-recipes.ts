// Built-in recipes for the token-free recipe director (#9). A recipe is a fixed,
// deterministic task DAG the director compiles into orchestration.taskCreate calls
// — no director LLM tokens are spent (the worker agents do the coding). User-
// editable recipes (YAML), the full starter set (#10), and the DirectorBackend
// abstraction (#8) are deliberately out of scope: this module ships the concrete
// `implement_then_review` recipe and the pure compiler the launch path uses.

import type { TuiAgent } from '../../../shared/types'

/** A single unit of work in a recipe. Compiled 1:1 into an orchestration task. */
export type RecipeTask = {
  /** Stable, recipe-local key. Used to wire `dependsOn` to created task ids and
   *  (when no explicit `track`) as the worktree-track hint. */
  key: string
  /** The worker's task instructions — the `--- TASK ---` block they receive. */
  spec: string
  /** Worktree-track hint. Same-track tasks share one worktree/branch/PR (the
   *  implement→review handoff). Defaults to `key` (per-task track) when unset. */
  track?: string
  /** Recipe-local keys of tasks that must FINISH before this one runs. Same-track
   *  tasks MUST be totally ordered by deps or the coordinator refuses the run. */
  dependsOn?: string[]
  /** Per-task worker agent override; defaults to the run's `workerAgent`. */
  agent?: TuiAgent
}

/** A fixed, deterministic task DAG the director runs without spending LLM tokens. */
export type Recipe = {
  name: string
  description: string
  tasks: RecipeTask[]
}

// Why: implement and review share ONE track so they run in the same worktree —
// review continues implement's branch → one PR, a real handoff. review.dependsOn
// = [implement] both encodes that handoff AND satisfies the coordinator's
// same-track safe-ordering guard (two unordered same-track tasks are refused
// because they would race into one checkout).
const IMPLEMENT_THEN_REVIEW_TRACK = 'implement-review'

/** The one canonical recipe this PR ships: implement, then review, on a single
 *  track (one worktree → one PR) with review gated on implement finishing. */
export const IMPLEMENT_THEN_REVIEW: Recipe = {
  name: 'implement_then_review',
  description:
    'Implement the change, then review it on the same branch — one worktree, one PR, ' +
    'with the reviewer handed the implementer’s finished work.',
  tasks: [
    {
      key: 'implement',
      track: IMPLEMENT_THEN_REVIEW_TRACK,
      spec:
        'Implement the requested change end to end. Make focused commits, keep the ' +
        'build/tests green, and open a PR for your branch. When done, report what you ' +
        'changed and call out anything the reviewer should scrutinize.'
    },
    {
      key: 'review',
      track: IMPLEMENT_THEN_REVIEW_TRACK,
      dependsOn: ['implement'],
      spec:
        'Review the implementation on this branch. Check correctness, tests, and ' +
        'adherence to the repo’s conventions. Apply small fixes directly; for larger ' +
        'concerns, leave clear review notes. Confirm the PR is ready (or say why not).'
    }
  ]
}

/** A recipe task lowered to the inputs `orchestration.taskCreate` needs, minus the
 *  resolved dependency ids (those exist only after each create returns, so the
 *  launch path resolves `dependsOn` keys → ids as it goes). */
export type CompiledRecipeTask = {
  key: string
  /** Final spec including the `track:` hint line the coordinator parses + strips. */
  spec: string
  /** Recipe-local keys this task waits on (resolved to task ids at launch). */
  dependsOn: string[]
  agent?: TuiAgent
}

// Why (slice 2 / coordinator §3.3): a task declares its track in the spec text via
// a leading `track: <key>` line — the same low-friction channel the coordinator
// parses (and strips before the worker sees the spec). Put it on its own first
// line so parseTrackFromSpec matches it.
function prependTrackHint(spec: string, track: string): string {
  return `track: ${track}\n\n${spec}`
}

/**
 * Compile a recipe into dependency-ordered taskCreate inputs. Pure and
 * deterministic: the launch path walks the result in order, calling taskCreate
 * for each and mapping `key → created id` so later tasks' `dependsOn` keys resolve
 * to real ids. Throws on an unknown/self/cyclic dependency so a malformed recipe
 * fails fast at compile time rather than producing a stuck run.
 */
export function compileRecipe(recipe: Recipe): CompiledRecipeTask[] {
  const byKey = new Map(recipe.tasks.map((task) => [task.key, task]))
  if (byKey.size !== recipe.tasks.length) {
    throw new Error(`Recipe '${recipe.name}' has duplicate task keys`)
  }

  // Why: same-track tasks must be totally ordered for the coordinator, and deps
  // drive that order — so emit tasks in a topological order. A stable DFS keeps
  // the output deterministic (tests can assert exact ordering).
  const ordered: CompiledRecipeTask[] = []
  const state = new Map<string, 'visiting' | 'done'>()

  const visit = (key: string): void => {
    const phase = state.get(key)
    if (phase === 'done') {
      return
    }
    if (phase === 'visiting') {
      throw new Error(`Recipe '${recipe.name}' has a dependency cycle at task '${key}'`)
    }
    const task = byKey.get(key)
    if (!task) {
      throw new Error(`Recipe '${recipe.name}' references unknown task '${key}'`)
    }
    state.set(key, 'visiting')
    for (const dep of task.dependsOn ?? []) {
      if (dep === key) {
        throw new Error(`Recipe '${recipe.name}' task '${key}' depends on itself`)
      }
      visit(dep)
    }
    state.set(key, 'done')
    ordered.push({
      key: task.key,
      spec: prependTrackHint(task.spec, task.track ?? task.key),
      dependsOn: [...(task.dependsOn ?? [])],
      ...(task.agent ? { agent: task.agent } : {})
    })
  }

  for (const task of recipe.tasks) {
    visit(task.key)
  }
  return ordered
}
