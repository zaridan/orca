import { Network, Plus } from 'lucide-react'
import { useAppStore } from '@/store'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { activateAndRevealWorktree } from '@/lib/worktree-activation'
import { launchOrchestratorForProject } from '@/lib/orchestrator-launch'
import { translate } from '@/i18n/i18n'

// Why: experimental "Orcastrators" sidebar section. The `+` opens a project
// picker; selecting one launches a director session in that project's primary
// worktree (see orchestrator-launch.ts). Launched directors are listed here as
// persistent entries — no worktree/branch shown, since that's irrelevant to a
// director. Gated on experimentalOrchestrators.
export function OrchestratorsSidebarSection(): React.JSX.Element | null {
  const enabled = useAppStore((s) => s.settings?.experimentalOrchestrators ?? false)
  const projects = useAppStore((s) => s.projects)
  const orchestrators = useAppStore((s) => s.orchestrators)
  const tabsByWorktree = useAppStore((s) => s.tabsByWorktree)
  const setActiveTab = useAppStore((s) => s.setActiveTab)
  if (!enabled) {
    return null
  }
  // Why: drop entries whose agent tab has been closed so the list never shows
  // a dead director.
  const live = orchestrators.filter((entry) =>
    tabsByWorktree[entry.worktreeId]?.some((tab) => tab.id === entry.tabId)
  )
  return (
    <div className="pb-1">
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
      {live.map((entry) => (
        <button
          key={entry.id}
          type="button"
          onClick={() => {
            activateAndRevealWorktree(entry.worktreeId, { sidebarRevealBehavior: 'auto' })
            setActiveTab(entry.tabId)
          }}
          className="flex w-full items-center gap-2 px-4 py-1 text-left text-[13px] tracking-tight text-worktree-sidebar-foreground/70 transition-colors hover:bg-worktree-sidebar-foreground/8"
        >
          <Network
            className="size-3.5 shrink-0 text-worktree-sidebar-foreground/40"
            strokeWidth={1.75}
          />
          <span className="flex-1 truncate">{entry.projectName}</span>
        </button>
      ))}
    </div>
  )
}
