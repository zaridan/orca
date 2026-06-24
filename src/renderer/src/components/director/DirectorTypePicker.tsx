import type React from 'react'
import { ListChecks, Sparkles } from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { translate } from '@/i18n/i18n'
import type { DirectorKind } from '@/lib/director-backend'
import type { Recipe } from '@/lib/recipe-director-recipes'

// Why (#11): the `+` in ORCASTRATORS now picks the DIRECTOR TYPE first, then
// dispatches through the DirectorBackend (#8). Smart is the existing LLM
// coordinator; Recipe is the token-free fixed workflow. The Recipe option is the
// gate for `experimentalOrchestrators` — `launchRecipeDirector` is ungated by
// design, so the picker is where the flag is enforced (option hidden when off).

type DirectorOption = {
  kind: DirectorKind
  icon: React.ReactNode
  title: string
  caption: string
}

type DirectorTypePickerProps = {
  kind: DirectorKind
  onKindChange: (kind: DirectorKind) => void
  /** Gate: when false the Recipe option is hidden and only Smart is offered
   *  (the pre-#11 behavior). Driven by `experimentalOrchestrators`. */
  showRecipeOption: boolean
  recipes: Recipe[]
  selectedRecipeName: string | null
  onRecipeChange: (recipeName: string) => void
}

export function DirectorTypePicker({
  kind,
  onKindChange,
  showRecipeOption,
  recipes,
  selectedRecipeName,
  onRecipeChange
}: DirectorTypePickerProps): React.JSX.Element {
  // Smart is always available; Recipe only under the experimental gate.
  const options: DirectorOption[] = [
    {
      kind: 'llm',
      icon: <Sparkles className="size-4" strokeWidth={1.75} />,
      title: translate('auto.components.director.DirectorTypePicker.smart_title', 'Smart director'),
      caption: translate(
        'auto.components.director.DirectorTypePicker.smart_caption',
        'Uses your default LLM and /orcastrate to plan and run the work.'
      )
    }
  ]
  if (showRecipeOption) {
    options.push({
      kind: 'recipe',
      icon: <ListChecks className="size-4" strokeWidth={1.75} />,
      title: translate(
        'auto.components.director.DirectorTypePicker.recipe_title',
        'Recipe director'
      ),
      // Why: this framing answers "why spend tokens on a director?" up front.
      caption: translate(
        'auto.components.director.DirectorTypePicker.recipe_caption',
        'No director LLM; runs a fixed workflow.'
      )
    })
  }

  // Arrow keys move the radio selection across the visible options.
  const moveSelection = (direction: 1 | -1): void => {
    const index = options.findIndex((option) => option.kind === kind)
    const next = options[(index + direction + options.length) % options.length]
    if (next) {
      onKindChange(next.kind)
    }
  }

  return (
    <div className="space-y-3">
      <div
        role="radiogroup"
        aria-label={translate(
          'auto.components.director.DirectorTypePicker.group_label',
          'Director type'
        )}
        className="grid gap-2"
      >
        {options.map((option) => {
          const selected = option.kind === kind
          return (
            <button
              key={option.kind}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={selected ? 0 : -1}
              onClick={() => onKindChange(option.kind)}
              onKeyDown={(event) => {
                if (
                  event.key === 'ArrowDown' ||
                  event.key === 'ArrowRight' ||
                  event.key === 'ArrowUp' ||
                  event.key === 'ArrowLeft'
                ) {
                  event.preventDefault()
                  moveSelection(event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : -1)
                } else if (event.key === ' ' || event.key === 'Enter') {
                  event.preventDefault()
                  onKindChange(option.kind)
                }
              }}
              data-kind={option.kind}
              className={`group relative flex cursor-pointer items-start gap-3 rounded-md border px-3.5 py-3 text-left transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 ${
                selected ? 'border-foreground/30 bg-accent' : 'border-border hover:bg-accent/50'
              }`}
            >
              <span
                className={`inline-flex size-8 shrink-0 items-center justify-center rounded-md border transition-colors ${
                  selected
                    ? 'border-foreground/20 bg-background/60 text-foreground'
                    : 'border-border/70 bg-background/30 text-muted-foreground group-hover:text-foreground'
                }`}
              >
                {option.icon}
              </span>
              <span className="min-w-0">
                <span className="block text-[13px] font-medium leading-tight">{option.title}</span>
                <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">
                  {option.caption}
                </span>
              </span>
            </button>
          )
        })}
      </div>
      {kind === 'recipe' && showRecipeOption && (
        <div className="space-y-2">
          <Label className="text-xs">
            {translate('auto.components.director.DirectorTypePicker.recipe_label', 'Recipe')}
          </Label>
          <Select value={selectedRecipeName ?? undefined} onValueChange={onRecipeChange}>
            <SelectTrigger size="sm" className="w-full text-xs">
              <SelectValue
                placeholder={translate(
                  'auto.components.director.DirectorTypePicker.recipe_placeholder',
                  'Select a recipe'
                )}
              />
            </SelectTrigger>
            <SelectContent>
              {recipes.map((recipe) => (
                <SelectItem key={recipe.name} value={recipe.name}>
                  <span className="flex flex-col">
                    <span className="text-[13px]">{recipe.name}</span>
                    <span className="text-[11px] leading-snug text-muted-foreground">
                      {recipe.description}
                    </span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  )
}
