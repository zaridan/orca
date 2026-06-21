import type { GlobalSettings } from '../../../../shared/types'
import { Label } from '../ui/label'
import { SearchableSetting } from './SearchableSetting'
import { matchesSettingsSearch } from './settings-search'
import { getExperimentalSearchEntry } from './experimental-search'
import { translate } from '@/i18n/i18n'

type OrchestratorsExperimentalToggleProps = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
  searchQuery: string
}

// Why: extracted from ExperimentalPane to keep that file under the max-lines
// cap; this owns the single Orcastrators experimental toggle row.
export function OrchestratorsExperimentalToggle({
  settings,
  updateSettings,
  searchQuery
}: OrchestratorsExperimentalToggleProps): React.JSX.Element | null {
  const show = matchesSettingsSearch(searchQuery, [getExperimentalSearchEntry().orchestrators])
  if (!show) {
    return null
  }
  const enabled = settings.experimentalOrchestrators ?? false
  return (
    <SearchableSetting
      title={translate(
        'auto.components.settings.ExperimentalPane.orchestrators.title',
        'Orcastrators'
      )}
      description={translate(
        'auto.components.settings.ExperimentalPane.orchestrators.description',
        'A sidebar section for launching persistent coordinator chats that plan and run multi-worktree work.'
      )}
      keywords={getExperimentalSearchEntry().orchestrators.keywords}
      className="space-y-3 py-2"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 shrink space-y-0.5">
          <Label>
            {translate(
              'auto.components.settings.ExperimentalPane.orchestrators.title',
              'Orcastrators'
            )}
          </Label>
          <p className="text-xs text-muted-foreground">
            {translate(
              'auto.components.settings.ExperimentalPane.orchestrators.detail',
              'Adds an "Orcastrators" section above Projects. Launch a coordinator chat per repo — it plans the work, spins up worktrees and worker agents, and supervises them. Experimental while the create-flow and multi-coordinator isolation are settling.'
            )}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          onClick={() =>
            updateSettings({ experimentalOrchestrators: !settings.experimentalOrchestrators })
          }
          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-transparent transition-colors ${
            enabled ? 'bg-foreground' : 'bg-muted-foreground/30'
          }`}
        >
          <span
            className={`inline-block h-3.5 w-3.5 transform rounded-full bg-background shadow-sm transition-transform ${
              enabled ? 'translate-x-4' : 'translate-x-0.5'
            }`}
          />
        </button>
      </div>
    </SearchableSetting>
  )
}
