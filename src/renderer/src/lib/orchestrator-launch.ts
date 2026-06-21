import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { buildAgentStartupPlan } from '@/lib/tui-agent-startup'
import {
  resolveTuiAgentLaunchArgs,
  resolveTuiAgentLaunchEnv
} from '../../../shared/tui-agent-launch-defaults'
import { activateAndRevealWorktree } from '@/lib/worktree-activation'
import { CLIENT_PLATFORM } from '@/lib/new-workspace'
import { pasteDraftWhenAgentReady } from '@/lib/agent-paste-draft'
import { getProjectDefaultCheckout } from '@/components/sidebar/project-added-default-checkout'
import { translate } from '@/i18n/i18n'
import type { Project, TuiAgent, Worktree } from '../../../shared/types'

// Why: the coordinator session is a normal Claude Code agent that starts by
// invoking the orchestrate skill, exactly as a user would type it by hand.
const ORCASTRATE_PROMPT = '/orcastrate'

// Why: an Orcastrator is the coordinator, not a worker — default it to Claude
// Code unless the user has chosen a different default agent (a `'blank'`
// default means "plain shell", which can't coordinate, so fall back to claude).
function resolveCoordinatorAgent(defaultTuiAgent: TuiAgent | 'blank' | null | undefined): TuiAgent {
  return defaultTuiAgent && defaultTuiAgent !== 'blank' ? defaultTuiAgent : 'claude'
}

// Why: a coordinator runs in the repo's existing primary checkout (it creates
// worktrees for workers — it does not get one itself). Resolve the project's
// primary worktree across its source repos.
function findPrimaryWorktree(project: Project): Worktree | null {
  const byRepo = useAppStore.getState().worktreesByRepo
  for (const repoId of project.sourceRepoIds) {
    const primary = getProjectDefaultCheckout(byRepo[repoId] ?? [])
    if (primary) {
      return primary
    }
  }
  return null
}

/**
 * Launch an Orcastrator (coordinator agent) in a project's primary worktree and
 * seed it with `/orcastrate`. Mirrors the verified "Use" launch path: build the
 * agent startup plan, activate the worktree with that startup command, then
 * paste-and-submit the prompt once the agent's TUI is ready. Best-effort: the
 * prompt paste runs in the background so the click doesn't block on agent boot.
 */
export async function launchOrchestratorForProject(project: Project): Promise<boolean> {
  const primary = findPrimaryWorktree(project)
  if (!primary) {
    toast.error(
      translate(
        'auto.lib.orchestrator.launch.no_checkout',
        'No checkout found for this project yet — open it once, then launch an Orcastrator.'
      )
    )
    return false
  }

  const settings = useAppStore.getState().settings
  const agent = resolveCoordinatorAgent(settings?.defaultTuiAgent)
  const startupPlan = buildAgentStartupPlan({
    agent,
    prompt: '',
    cmdOverrides: settings?.agentCmdOverrides ?? {},
    platform: CLIENT_PLATFORM,
    agentArgs: resolveTuiAgentLaunchArgs(agent, settings?.agentDefaultArgs),
    agentEnv: resolveTuiAgentLaunchEnv(agent, settings?.agentDefaultEnv),
    allowEmptyPromptLaunch: true
  })
  if (!startupPlan) {
    toast.error(
      translate(
        'auto.lib.orchestrator.launch.no_command',
        'Could not build the Orcastrator launch command for this agent.'
      )
    )
    return false
  }

  // Why: always spawn a *fresh* tab and queue the agent command directly onto
  // it, rather than relying on the activation startup payload. Activation only
  // seeds a worktree's *initial* terminal, so relaunching into an already-open
  // worktree would otherwise no-op (no new director). createTab +
  // queueTabStartupCommand works whether or not the worktree is already active.
  const store = useAppStore.getState()
  const tab = store.createTab(primary.id, undefined, undefined, {
    activate: true,
    launchAgent: agent
  })
  store.queueTabStartupCommand(tab.id, {
    command: startupPlan.launchCommand,
    ...(startupPlan.env ? { env: startupPlan.env } : {}),
    ...(startupPlan.startupCommandDelivery
      ? { startupCommandDelivery: startupPlan.startupCommandDelivery }
      : {}),
    initialAgentStatus: { agent, prompt: ORCASTRATE_PROMPT }
  })
  activateAndRevealWorktree(primary.id, { sidebarRevealBehavior: 'auto' })

  // Why: the command runs when the PTY mounts; deliver /orcastrate once the
  // agent's TUI is accepting input (bracketed paste + submit). Background so
  // the click doesn't block on agent boot. Generous timeout: a cold agent boot
  // (model load + first-run banners, slower still in dev) can exceed the
  // default window, which previously dropped the prompt with a "took too long"
  // toast.
  void pasteDraftWhenAgentReady({
    tabId: tab.id,
    content: ORCASTRATE_PROMPT,
    agent,
    submit: true,
    forcePaste: true,
    timeoutMs: 90_000
  })
  return true
}
