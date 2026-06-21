import { Plus } from 'lucide-react'
import { useAppStore } from '@/store'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { launchOrchestratorForProject } from '@/lib/orchestrator-launch'
import { translate } from '@/i18n/i18n'

// Why: experimental "Orcastrators" sidebar section. The `+` opens a project
// picker; selecting one launches a coordinator chat in that project's primary
// worktree (see orchestrator-launch.ts). Gated on experimentalOrchestrators.
export function OrchestratorsSidebarSection(): React.JSX.Element | null {
  const enabled = useAppStore((s) => s.settings?.experimentalOrchestrators ?? false)
  const projects = useAppStore((s) => s.projects)
  if (!enabled) {
    return null
  }
  return (
    <div className="flex items-center justify-between px-4 pt-3 pb-1">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-worktree-sidebar-foreground/40">
        {translate('auto.components.sidebar.OrchestratorsSidebarSection.title', 'Orcastrators')}
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={translate(
              'auto.components.sidebar.OrchestratorsSidebarSection.new',
              'New Orcastrator'
            )}
            className="rounded p-0.5 text-worktree-sidebar-foreground/40 transition-colors hover:bg-worktree-sidebar-foreground/8 hover:text-worktree-sidebar-foreground/70"
          >
            <Plus className="size-3.5" strokeWidth={2} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-52">
          <DropdownMenuLabel>
            {translate(
              'auto.components.sidebar.OrchestratorsSidebarSection.pick',
              'Launch an Orcastrator in…'
            )}
          </DropdownMenuLabel>
          {projects.length === 0 ? (
            <DropdownMenuItem disabled>
              {translate(
                'auto.components.sidebar.OrchestratorsSidebarSection.empty',
                'No projects yet'
              )}
            </DropdownMenuItem>
          ) : (
            projects.map((project) => (
              <DropdownMenuItem
                key={project.id}
                onSelect={() => {
                  void launchOrchestratorForProject(project)
                }}
              >
                {project.displayName}
              </DropdownMenuItem>
            ))
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
