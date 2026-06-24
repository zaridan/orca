import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Project } from '../../../shared/types'

const harness = vi.hoisted(() => ({
  launchOrchestrator: vi.fn(),
  launchRecipe: vi.fn()
}))

vi.mock('@/lib/orchestrator-launch', () => ({
  launchOrchestratorForProject: (...args: unknown[]) => harness.launchOrchestrator(...args)
}))

vi.mock('@/lib/recipe-director-launch', () => ({
  launchRecipeDirector: (...args: unknown[]) => harness.launchRecipe(...args)
}))

import { LlmDirectorBackend, RecipeDirectorBackend } from './director-backend'
import type { Recipe } from './recipe-director-recipes'

const PROJECT: Project = { id: 'proj_1', displayName: 'Demo' } as unknown as Project
const RECIPE: Recipe = { name: 'implement_then_review', description: 'desc', tasks: [] }

beforeEach(() => {
  vi.clearAllMocks()
  harness.launchOrchestrator.mockResolvedValue(true)
  harness.launchRecipe.mockResolvedValue(true)
})

describe('LlmDirectorBackend', () => {
  it('is the llm kind and dispatches to launchOrchestratorForProject', async () => {
    const backend = new LlmDirectorBackend()
    expect(backend.kind).toBe('llm')

    const opts = { name: 'My director', agent: 'codex' as const, prompt: 'do the thing' }
    const ok = await backend.launch(PROJECT, opts)

    expect(ok).toBe(true)
    expect(harness.launchOrchestrator).toHaveBeenCalledTimes(1)
    expect(harness.launchOrchestrator).toHaveBeenCalledWith(PROJECT, opts)
    expect(harness.launchRecipe).not.toHaveBeenCalled()
  })
})

describe('RecipeDirectorBackend', () => {
  it('is the recipe kind and dispatches to launchRecipeDirector with its recipe', async () => {
    const backend = new RecipeDirectorBackend(RECIPE)
    expect(backend.kind).toBe('recipe')

    const opts = { name: 'My recipe director' }
    const ok = await backend.launch(PROJECT, opts)

    expect(ok).toBe(true)
    expect(harness.launchRecipe).toHaveBeenCalledTimes(1)
    expect(harness.launchRecipe).toHaveBeenCalledWith(PROJECT, RECIPE, opts)
    expect(harness.launchOrchestrator).not.toHaveBeenCalled()
  })

  it('carries the specific recipe it was constructed with', async () => {
    const other: Recipe = { name: 'ship_it', description: 'other', tasks: [] }
    await new RecipeDirectorBackend(other).launch(PROJECT)
    expect(harness.launchRecipe).toHaveBeenCalledWith(PROJECT, other, undefined)
  })
})
