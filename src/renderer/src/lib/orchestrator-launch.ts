import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { buildAgentStartupPlan } from '@/lib/tui-agent-startup'
import {
  resolveTuiAgentLaunchArgs,
  resolveTuiAgentLaunchEnv
} from '../../../shared/tui-agent-launch-defaults'
import { activateAndRevealWorktree } from '@/lib/worktree-activation'
import { CLIENT_PLATFORM } from '@/lib/new-workspace'
import { buildDirectWorkItemStartupOpts } from '@/lib/launch-work-item-direct-agent'
import { pasteDraftWhenAgentReady } from '@/lib/agent-paste-draft'
import { ORCASTRATOR_DISPLAY_PREFIX } from '@/store/slices/orchestrators'
import { translate } from '@/i18n/i18n'
import type { Project, TuiAgent } from '../../../shared/types'

// Why: the coordinator session is a normal Claude Code agent that starts by
// invoking the orchestrate skill, exactly as a user would type it by hand.
const ORCASTRATE_PROMPT = '/orcastrate'

// Why: a cold agent boot (model load + first-run banners, slower still in dev)
// can exceed the default paste window; give it room so the prompt lands.
const ORCASTRATE_PASTE_TIMEOUT_MS = 90_000

// Why: an Orcastrator is the coordinator, not a worker — default it to Claude
// Code unless the user has chosen a different default agent (a `'blank'`
// default means "plain shell", which can't coordinate, so fall back to claude).
function resolveCoordinatorAgent(defaultTuiAgent: TuiAgent | 'blank' | null | undefined): TuiAgent {
  return defaultTuiAgent && defaultTuiAgent !== 'blank' ? defaultTuiAgent : 'claude'
}

export type LaunchOrchestratorOptions = {
  /** Optional human name for the director (shown in the ORCASTRATORS list). */
  name?: string
  /** Coordinator agent override; defaults to the user's default agent. */
  agent?: TuiAgent
  /** Initial task the director should plan — seeded after `/orcastrate` so it
   *  starts planning instead of asking "what's the task?". */
  prompt?: string
}

/**
 * Launch an Orcastrator (director) for a project. The director is a first-class
 * entity, not a worktree agent: it runs in its *own* dedicated worktree (hidden
 * from Projects, shown only in the ORCASTRATORS section) so it never couples to
 * the project's primary checkout. Creates the worktree, launches the coordinator
 * agent in it, seeds `/orcastrate` (+ the task), and registers it.
 */
export async function launchOrchestratorForProject(
  project: Project,
  options?: LaunchOrchestratorOptions
): Promise<boolean> {
  const repoId = project.sourceRepoIds[0]
  if (!repoId) {
    toast.error(
      translate(
        'auto.lib.orchestrator.launch.no_repo',
        'This project has no repo to launch an Orcastrator in.'
      )
    )
    return false
  }

  const store = useAppStore.getState()
  const repo = store.repos.find((entry) => entry.id === repoId)
  const settings = store.settings
  const agent = options?.agent ?? resolveCoordinatorAgent(settings?.defaultTuiAgent)
  const label = options?.name?.trim() || project.displayName
  const task = options?.prompt?.trim()
  const promptContent = task ? `${ORCASTRATE_PROMPT} ${task}` : ORCASTRATE_PROMPT

  let worktreeId: string
  let setup: Awaited<ReturnType<typeof store.createWorktree>>['setup']
  try {
    // Why: 'skip' setup — a director coordinates, it doesn't build, so it does
    // not need the repo's setup scripts run in its checkout.
    const result = await store.createWorktree(
      repoId,
      `orcastrator-${label}`,
      repo?.worktreeBaseRef,
      'skip',
      undefined,
      undefined,
      `${ORCASTRATOR_DISPLAY_PREFIX}${label}`
    )
    worktreeId = result.worktree.id
    setup = result.setup
  } catch (error) {
    toast.error(
      error instanceof Error
        ? error.message
        : translate(
            'auto.lib.orchestrator.launch.create_failed',
            'Failed to create the Orcastrator.'
          )
    )
    return false
  }

  const startupPlan = buildAgentStartupPlan({
    agent,
    prompt: '',
    cmdOverrides: settings?.agentCmdOverrides ?? {},
    platform: CLIENT_PLATFORM,
    agentArgs: resolveTuiAgentLaunchArgs(agent, settings?.agentDefaultArgs),
    agentEnv: resolveTuiAgentLaunchEnv(agent, settings?.agentDefaultEnv),
    allowEmptyPromptLaunch: true
  })

  // Why: tear down the freshly created worktree on any launch failure so an
  // orphaned hidden director workspace isn't left behind. Shared by both the
  // falsy-return and thrown-activation paths below.
  const teardownAfterFailedLaunch = async (): Promise<void> => {
    try {
      await store.removeWorktree(worktreeId, true)
    } catch (error) {
      console.error(
        `Failed to clean up Orcastrator worktree ${worktreeId} after activation failed:`,
        error
      )
    }
    toast.error(
      translate('auto.lib.orchestrator.launch.no_workspace', 'Could not open the Orcastrator.')
    )
  }

  let activation: ReturnType<typeof activateAndRevealWorktree>
  try {
    activation = activateAndRevealWorktree(worktreeId, {
      sidebarRevealBehavior: 'auto',
      setup,
      ...buildDirectWorkItemStartupOpts(agent, startupPlan, 'sidebar')
    })
  } catch (error) {
    // Why: activation can throw, not just return falsy — without this the worktree
    // created above would leak when reveal/startup fails mid-flight.
    console.error(`Orcastrator activation threw for worktree ${worktreeId}:`, error)
    await teardownAfterFailedLaunch()
    return false
  }
  if (!activation) {
    await teardownAfterFailedLaunch()
    return false
  }

  store.registerOrchestrator({
    id: worktreeId,
    projectId: project.id,
    projectName: label,
    worktreeId,
    tabId: activation.primaryTabId ?? '',
    launchedAt: Date.now()
  })

  // Why: the agent command runs when the PTY mounts; deliver /orcastrate once
  // the TUI is accepting input. Background so the click doesn't block on boot,
  // with a generous timeout since cold boots are slow.
  if (activation.primaryTabId) {
    // Why: seeding is backgrounded so the launch doesn't block on TUI boot, but a
    // timed-out paste means the coordinator never receives /orcastrate — surface
    // that so the session doesn't sit silently idle.
    const notifySeedFailed = (): void => {
      toast.error(
        translate(
          'auto.lib.orchestrator.launch.seed_failed',
          'Orcastrator opened, but initial command seeding timed out.'
        )
      )
    }
    void pasteDraftWhenAgentReady({
      tabId: activation.primaryTabId,
      content: promptContent,
      agent,
      submit: true,
      forcePaste: true,
      timeoutMs: ORCASTRATE_PASTE_TIMEOUT_MS
    })
      .then((ok) => {
        if (!ok) {
          notifySeedFailed()
        }
      })
      .catch(notifySeedFailed)
  }
  return true
}
