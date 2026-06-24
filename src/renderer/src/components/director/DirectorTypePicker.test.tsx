// @vitest-environment happy-dom

import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { DirectorTypePicker } from './DirectorTypePicker'
import { getRecipes } from '@/lib/recipe-director-recipes'

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string) => fallback
}))

// Render the Radix Select as plain inline markup so its items are assertable
// without opening the portal (the picker only needs the option list to be present).
vi.mock('@/components/ui/select', () => ({
  Select: ({ children }: { children: ReactNode }) => <div data-select>{children}</div>,
  SelectContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectItem: ({ value, children }: { value: string; children: ReactNode }) => (
    <div data-recipe-item={value}>{children}</div>
  ),
  SelectTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectValue: ({ placeholder }: { placeholder?: string }) => <span>{placeholder}</span>
}))

const noop = (): void => {}

function render(props: Partial<Parameters<typeof DirectorTypePicker>[0]>): string {
  return renderToStaticMarkup(
    <DirectorTypePicker
      kind="llm"
      onKindChange={noop}
      showRecipeOption={false}
      recipes={getRecipes()}
      selectedRecipeName={getRecipes()[0]?.name ?? null}
      onRecipeChange={noop}
      {...props}
    />
  )
}

describe('DirectorTypePicker', () => {
  it('always offers the Smart director option', () => {
    const html = render({ showRecipeOption: false })
    expect(html).toContain('Smart director')
  })

  it('hides the Recipe director option when the experimental flag is off', () => {
    const html = render({ showRecipeOption: false })
    expect(html).not.toContain('Recipe director')
  })

  it('offers the Recipe director option only when the flag is on', () => {
    const html = render({ showRecipeOption: true })
    expect(html).toContain('Smart director')
    expect(html).toContain('Recipe director')
    // The copy hook that justifies a token-free director.
    expect(html).toContain('No director LLM; runs a fixed workflow.')
  })

  it('does not render the recipe dropdown while Smart is selected', () => {
    const html = render({ kind: 'llm', showRecipeOption: true })
    expect(html).not.toContain('data-select')
  })

  it('lists every recipe from getRecipes() when Recipe is selected', () => {
    const recipes = getRecipes()
    expect(recipes.length).toBeGreaterThan(0)
    const html = render({ kind: 'recipe', showRecipeOption: true, recipes })
    for (const recipe of recipes) {
      expect(html).toContain(`data-recipe-item="${recipe.name}"`)
      expect(html).toContain(recipe.name)
    }
  })
})
