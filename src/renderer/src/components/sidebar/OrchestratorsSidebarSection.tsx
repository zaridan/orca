import { useEffect, useMemo } from 'react'
import { Network, Plus, X } from 'lucide-react'
import { useAppStore } from '@/store'
import { cn } from '@/lib/utils'
import { AgentStateDot, type AgentDotState } from '@/components/AgentStateDot'
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
import type { AgentStatusEntry } from '../../../../shared/agent-status-types'

// Why: the director's live activity belongs on its Orcastrator entry, not on
// the worktree it runs in. Derive its state from the freshest agent-status
// entry for its tab (paneKey is `${tabId}:${leafId}`) and render it with the
// app's shared AgentStateDot so it matches every other agent indicator.
function deriveDirectorDotState(
  tabIds: readonly string[],
  agentStatusByPaneKey: Record<string, AgentStatusEntry>
): AgentDotState {
  let latest: AgentStatusEntry | null = null
  for (const [paneKey, entry] of Object.entries(agentStatusByPaneKey)) {
    const colon = paneKey.indexOf(':')
    if (colon <= 0 || !tabIds.includes(paneKey.slice(0, colon))) {
      continue
    }
    if (!latest || entry.stateStartedAt > latest.stateStartedAt) {
      latest = entry
    }
  }
  return latest?.state ?? 'idle'
}

// Why: experimental "Orcastrators" sidebar section. The `+` opens a project
// picker; selecting one launches a director session for that project (see
// orchestrator-launch.ts). Launched directors are listed here as persistent
// nav entries — no worktree/branch shown — and the list acts as the navigator.
// Reuses the app's nav-item styling (rounded accent highlight) and AgentStateDot.
export function OrchestratorsSidebarSection(): React.JSX.Element | null {
  const enabled = useAppStore((s) => s.settings?.experimentalOrchestrators ?? false)
  const projects = useAppStore((s) => s.projects)
  const orchestrators = useAppStore((s) => s.orchestrators)
  const worktreesByRepo = useAppStore((s) => s.worktreesByRepo)
  const tabsByWorktree = useAppStore((s) => s.tabsByWorktree)
  const agentStatusByPaneKey = useAppStore((s) => s.agentStatusByPaneKey)
  const activeWorktreeId = useAppStore((s) => s.activeWorktreeId)
  const activeTabIdByWorktree = useAppStore((s) => s.activeTabIdByWorktree)
  const setActiveTab = useAppStore((s) => s.setActiveTab)
  const closeOrchestrator = useAppStore((s) => s.closeOrchestrator)
  const reattachOrchestrators = useAppStore((s) => s.reattachOrchestrators)

  // Why: the in-memory registry doesn't survive a reload, but director worktrees
  // do — rebuild it from them on load (and whenever worktrees change) so a
  // director re-hides from Projects and re-shows here. Idempotent.
  useEffect(() => {
    if (enabled) {
      reattachOrchestrators()
    }
  }, [enabled, worktreesByRepo, reattachOrchestrators])

  // Why: a director exists as long as its worktree does; key off worktree
  // existence (not a possibly-stale tab id, which changes on reattach).
  const liveWorktreeIds = useMemo(
    () =>
      new Set(
        Object.values(worktreesByRepo)
          .flat()
          .map((w) => w.id)
      ),
    [worktreesByRepo]
  )
  if (!enabled) {
    return null
  }
  const live = orchestrators.filter((entry) => liveWorktreeIds.has(entry.worktreeId))
  return (
    <div className="flex flex-col gap-0.5 px-2 pb-1">
      <div className="flex items-center justify-between px-2 pt-2 pb-0.5">
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
      {live.map((entry) => {
        const worktreeTabIds = (tabsByWorktree[entry.worktreeId] ?? []).map((tab) => tab.id)
        const dotState = deriveDirectorDotState(worktreeTabIds, agentStatusByPaneKey)
        // Why: the ORCASTRATORS list is the navigator — highlight the entry
        // whose worktree is active, using the same rounded accent highlight as
        // the sidebar nav items.
        const isActive = activeWorktreeId === entry.worktreeId
        const focusTabId = activeTabIdByWorktree[entry.worktreeId] ?? worktreeTabIds[0]
        return (
          // Why: `orcastrator-active-surface` shares the worktree card's active
          // styling via one CSS rule (see main.css) — single source of truth.
          <div
            key={entry.id}
            className={cn(
              'group flex items-center rounded-lg border border-transparent pr-1 transition-[background-color,border-color,box-shadow] duration-200',
              isActive ? 'orcastrator-active-surface' : 'worktree-sidebar-card-hover'
            )}
          >
            <button
              type="button"
              aria-current={isActive ? 'page' : undefined}
              onClick={() => {
                activateAndRevealWorktree(entry.worktreeId, { sidebarRevealBehavior: 'auto' })
                if (focusTabId) {
                  setActiveTab(focusTabId)
                }
              }}
              className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left text-[13px] tracking-tight text-worktree-sidebar-foreground/80"
            >
              <AgentStateDot state={dotState} size="sm" />
              <Network
                className="size-3.5 shrink-0 text-worktree-sidebar-foreground/40"
                strokeWidth={1.75}
              />
              <span className="flex-1 truncate">{entry.projectName}</span>
            </button>
            <button
              type="button"
              aria-label={translate(
                'auto.components.sidebar.OrchestratorsSidebarSection.close',
                'Close Orcastrator'
              )}
              onClick={() => {
                void closeOrchestrator(entry.id)
              }}
              className="shrink-0 rounded p-0.5 text-worktree-sidebar-foreground/40 opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
            >
              <X className="size-3.5" />
            </button>
          </div>
        )
      })}
    </div>
  )
}
