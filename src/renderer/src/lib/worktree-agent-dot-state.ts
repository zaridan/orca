import type { AgentDotState } from '@/components/AgentStateDot'
import type { AgentStatusEntry } from '../../../shared/agent-status-types'

// Why: a worktree's live agent state is the freshest agent-status entry among
// its tabs (paneKey is `${tabId}:${leafId}`). Shared so the Orcastrators sidebar
// and Mission Control render identical dots from one rule, not two copies.
export function deriveWorktreeAgentDotState(
  worktreeId: string,
  tabIds: readonly string[],
  agentStatusByPaneKey: Record<string, AgentStatusEntry>
): AgentDotState {
  let latest: AgentStatusEntry | null = null
  for (const [paneKey, entry] of Object.entries(agentStatusByPaneKey)) {
    // Why: a status may be attributed directly via worktreeId before its tabs
    // attach; matching tab prefix alone would drop it and show a stale idle dot.
    const matchesWorktree = entry.worktreeId === worktreeId
    const colon = paneKey.indexOf(':')
    const matchesTab = colon > 0 && tabIds.includes(paneKey.slice(0, colon))
    if (!matchesWorktree && !matchesTab) {
      continue
    }
    if (!latest || entry.stateStartedAt > latest.stateStartedAt) {
      latest = entry
    }
  }
  return latest?.state ?? 'idle'
}
