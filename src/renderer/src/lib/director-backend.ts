import {
  launchOrchestratorForProject,
  type LaunchOrchestratorOptions
} from '@/lib/orchestrator-launch'
import {
  launchRecipeDirector,
  type LaunchRecipeDirectorOptions
} from '@/lib/recipe-director-launch'
import type { Recipe } from '@/lib/recipe-director-recipes'
import type { Project } from '../../../shared/types'

// Why (#8): the director-type picker (#11) dispatches the user's choice through a
// single abstraction instead of branching on a string at the call site. This is
// deliberately THIN — it wraps the two existing launch functions, it does not
// reimplement them — and earns its keep only because the picker dispatches through
// it. No Hybrid backend yet: add a kind when there's a launch path to wrap.

export type DirectorKind = 'llm' | 'recipe'

/** Superset of both launchers' options so the picker can pass one bag of fields;
 *  each backend forwards only the ones its launcher understands. */
export type DirectorLaunchOptions = LaunchOrchestratorOptions & LaunchRecipeDirectorOptions

export type DirectorBackend = {
  readonly kind: DirectorKind
  /** Launch the director for `project`. Resolves true on success (mirrors the
   *  wrapped launchers). */
  launch(project: Project, options?: DirectorLaunchOptions): Promise<boolean>
}

/** The Smart director: a coordinator LLM that plans via `/orcastrate`. Wraps the
 *  existing `launchOrchestratorForProject` unchanged. */
export class LlmDirectorBackend implements DirectorBackend {
  readonly kind = 'llm' as const

  launch(project: Project, options?: DirectorLaunchOptions): Promise<boolean> {
    return launchOrchestratorForProject(project, options)
  }
}

/** The Recipe director: a fixed, token-free workflow (no director LLM). Carries the
 *  chosen recipe and wraps `launchRecipeDirector`. */
export class RecipeDirectorBackend implements DirectorBackend {
  readonly kind = 'recipe' as const

  constructor(private readonly recipe: Recipe) {}

  launch(project: Project, options?: DirectorLaunchOptions): Promise<boolean> {
    return launchRecipeDirector(project, this.recipe, options)
  }
}
