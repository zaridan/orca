import { useCallback, useEffect, useMemo } from 'react'
import { Network, Plus, X } from 'lucide-react'
import { useAppStore } from '@/store'
import { cn } from '@/lib/utils'
import { AgentStateDot } from '@/components/AgentStateDot'
import { activateAndRevealWorktree } from '@/lib/worktree-activation'
import { deriveWorktreeAgentDotState } from '@/lib/worktree-agent-dot-state'
import { translate } from '@/i18n/i18n'
import { ORCASTRATOR_DISPLAY_PREFIX } from '@/store/slices/orchestrators'
import { WorktreeTitleInlineRename } from './WorktreeTitleInlineRename'

// Why: experimental "Orcastrators" sidebar section. The `+` opens a project
// picker; selecting one launches a director session for that project (see
// orchestrator-launch.ts). Launched directors are listed here as persistent
// nav entries — no worktree/branch shown — and the list acts as the navigator.
// Reuses the app's nav-item styling (rounded accent highlight) and AgentStateDot.
export function OrchestratorsSidebarSection(): React.JSX.Element | null {
  const enabled = useAppStore((s) => s.settings?.experimentalOrchestrators ?? false)
  const openModal = useAppStore((s) => s.openModal)
  const orchestrators = useAppStore((s) => s.orchestrators)
  const worktreesByRepo = useAppStore((s) => s.worktreesByRepo)
  const tabsByWorktree = useAppStore((s) => s.tabsByWorktree)
  const agentStatusByPaneKey = useAppStore((s) => s.agentStatusByPaneKey)
  const activeWorktreeId = useAppStore((s) => s.activeWorktreeId)
  const activeTabIdByWorktree = useAppStore((s) => s.activeTabIdByWorktree)
  const setActiveTab = useAppStore((s) => s.setActiveTab)
  const closeOrchestrator = useAppStore((s) => s.closeOrchestrator)
  const updateOrchestrator = useAppStore((s) => s.updateOrchestrator)
  const updateWorktreeMeta = useAppStore((s) => s.updateWorktreeMeta)
  const reattachOrchestrators = useAppStore((s) => s.reattachOrchestrators)

  // Why: rename mirrors the worktree-title rename — update the in-memory entry
  // for instant UI, then persist the prefixed displayName on the underlying
  // worktree so reattachOrchestrators reconstructs the name after a reload.
  const renameOrchestrator = useCallback(
    async (id: string, worktreeId: string, projectName: string): Promise<void> => {
      // Why: persist the durable worktree displayName first, then update the
      // in-memory entry. If the persist throws, the rename never lands in the UI
      // either, so the sidebar can't diverge from what reattach would reconstruct.
      await updateWorktreeMeta(worktreeId, {
        displayName: `${ORCASTRATOR_DISPLAY_PREFIX}${projectName}`
      })
      updateOrchestrator(id, { projectName })
    },
    [updateOrchestrator, updateWorktreeMeta]
  )

  const activate = useCallback(
    (worktreeId: string, focusTabId: string | undefined): void => {
      activateAndRevealWorktree(worktreeId, { sidebarRevealBehavior: 'auto' })
      if (focusTabId) {
        setActiveTab(focusTabId)
      }
    },
    [setActiveTab]
  )

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
        Object.values(worktreesByRepo ?? {})
          .flat()
          .map((w) => w.id)
      ),
    [worktreesByRepo]
  )
  if (!enabled) {
    return null
  }
  const live = (orchestrators ?? []).filter((entry) => liveWorktreeIds.has(entry.worktreeId))
  return (
    <div className="flex flex-col gap-0.5 px-2 pb-1">
      <div className="flex items-center justify-between px-2 pt-2 pb-0.5">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-worktree-sidebar-foreground/40">
          {translate('auto.components.sidebar.OrchestratorsSidebarSection.title', 'Orcastrators')}
        </span>
        <button
          type="button"
          onClick={() => openModal('orchestrator-launch')}
          aria-label={translate(
            'auto.components.sidebar.OrchestratorsSidebarSection.new',
            'New Orcastrator'
          )}
          className="rounded p-0.5 text-worktree-sidebar-foreground/40 transition-colors hover:bg-worktree-sidebar-foreground/8 hover:text-worktree-sidebar-foreground/70"
        >
          <Plus className="size-3.5" strokeWidth={2} />
        </button>
      </div>
      {live.map((entry) => {
        const worktreeTabIds = (tabsByWorktree[entry.worktreeId] ?? []).map((tab) => tab.id)
        const dotState = deriveWorktreeAgentDotState(worktreeTabIds, agentStatusByPaneKey)
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
            {/* Why: a div (not a button) hosts the inline-rename Input — an
                Input nested in a <button> is invalid HTML. role/tabIndex/key
                handling keep activation keyboard-accessible. */}
            <div
              role="button"
              tabIndex={0}
              aria-current={isActive ? 'page' : undefined}
              onClick={() => activate(entry.worktreeId, focusTabId)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  activate(entry.worktreeId, focusTabId)
                }
              }}
              className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 px-2 py-1.5 text-left text-[13px] tracking-tight text-worktree-sidebar-foreground/80 outline-none focus-visible:ring-2 focus-visible:ring-worktree-sidebar-ring"
            >
              <AgentStateDot state={dotState} size="sm" />
              <Network
                className="size-3.5 shrink-0 text-worktree-sidebar-foreground/40"
                strokeWidth={1.75}
              />
              <WorktreeTitleInlineRename
                displayName={entry.projectName}
                className="flex-1 text-[13px]"
                editingClassName="flex-1"
                onRename={(projectName) =>
                  renameOrchestrator(entry.id, entry.worktreeId, projectName)
                }
              />
            </div>
            <button
              type="button"
              aria-label={translate(
                'auto.components.sidebar.OrchestratorsSidebarSection.close',
                'Close Orcastrator'
              )}
              onClick={() => {
                void closeOrchestrator(entry.id)
              }}
              // Why: hover-reveal hides this on hover-capable devices, but stays
              // visible on touch (no hover) and on keyboard focus, with a focus
              // ring — so the control is discoverable without a pointer.
              className="shrink-0 rounded p-0.5 text-worktree-sidebar-foreground/40 opacity-100 transition-opacity hover:text-destructive can-hover:opacity-0 can-hover:group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-worktree-sidebar-ring"
            >
              <X className="size-3.5" />
            </button>
          </div>
        )
      })}
    </div>
  )
}
