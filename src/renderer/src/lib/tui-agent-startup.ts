import { TUI_AGENT_CONFIG } from '../../../shared/tui-agent-config'
import { resolveCustomAgentBaseCommand } from '../../../shared/custom-agent-profile'
import type { CustomAgentProfile, TuiAgent } from '../../../shared/types'

export type AgentStartupPlan = {
  /** Why: surfaces the agent id so downstream paste-draft logic can resolve
   * the per-agent draft injection strategy without re-deriving from the
   * launch command string. */
  agent: TuiAgent
  launchCommand: string
  expectedProcess: string
  followupPrompt: string | null
  /** Why: text to type into the live agent input WITHOUT submitting it (no
   * trailing \r). Used by the quick-create flow to pre-fill a linked work
   * item URL so the user can edit/add to it before sending. Independent from
   * `followupPrompt` so the call site can choose: type-and-submit (followup)
   * or type-and-leave-pending (draft). */
  draftPrompt?: string | null
}

function quoteStartupArg(value: string, platform: NodeJS.Platform): string {
  if (platform === 'win32') {
    return `"${value.replace(/"/g, '""')}"`
  }

  return `'${value.replace(/'/g, `'\\''`)}'`
}

export function buildAgentStartupPlan(args: {
  agent: TuiAgent
  prompt: string
  cmdOverrides: Partial<Record<TuiAgent, string>>
  platform: NodeJS.Platform
  allowEmptyPromptLaunch?: boolean
  /** Why: when set, the launch command comes from the profile (with its env
   *  vars rendered as a shell prefix) instead of the catalog default + the
   *  generic per-agent override. The base agent (passed via `agent`) still
   *  drives prompt-injection mode, telemetry kind, and paste-draft logic, so
   *  custom profiles ride the existing flow without a new code path. */
  customProfile?: CustomAgentProfile | null
}): AgentStartupPlan | null {
  const {
    agent,
    prompt,
    cmdOverrides,
    platform,
    allowEmptyPromptLaunch = false,
    customProfile = null
  } = args
  const trimmedPrompt = prompt.trim()
  const config = TUI_AGENT_CONFIG[agent]
  const baseCommand = customProfile
    ? resolveCustomAgentBaseCommand(customProfile, platform)
    : (cmdOverrides[agent] ?? config.launchCmd)

  if (!trimmedPrompt) {
    if (!allowEmptyPromptLaunch) {
      return null
    }
    return {
      agent,
      launchCommand: baseCommand,
      expectedProcess: config.expectedProcess,
      followupPrompt: null
    }
  }

  const quotedPrompt = quoteStartupArg(trimmedPrompt, platform)

  if (config.promptInjectionMode === 'argv') {
    return {
      agent,
      launchCommand: `${baseCommand} ${quotedPrompt}`,
      expectedProcess: config.expectedProcess,
      followupPrompt: null
    }
  }

  if (config.promptInjectionMode === 'flag-prompt') {
    return {
      agent,
      launchCommand: `${baseCommand} --prompt ${quotedPrompt}`,
      expectedProcess: config.expectedProcess,
      followupPrompt: null
    }
  }

  if (config.promptInjectionMode === 'flag-prompt-interactive') {
    return {
      agent,
      launchCommand: `${baseCommand} --prompt-interactive ${quotedPrompt}`,
      expectedProcess: config.expectedProcess,
      followupPrompt: null
    }
  }

  if (config.promptInjectionMode === 'flag-interactive') {
    return {
      agent,
      launchCommand: `${baseCommand} -i ${quotedPrompt}`,
      expectedProcess: config.expectedProcess,
      followupPrompt: null
    }
  }

  return {
    agent,
    launchCommand: baseCommand,
    expectedProcess: config.expectedProcess,
    // Why: several agent TUIs either lack a documented "start interactive
    // session with this prompt" flag or vary too much across versions. For
    // those agents Orca launches the TUI first, then types the composed prompt
    // into the live session once the agent owns the terminal.
    followupPrompt: trimmedPrompt
  }
}

export type AgentDraftLaunchPlan = {
  agent: TuiAgent
  launchCommand: string
  expectedProcess: string
}

/**
 * Why: when the agent's CLI exposes a documented "prefill but don't submit"
 * flag (currently only `claude --prefill <text>`), launch with that flag so
 * the TUI mounts with the draft already in its input box. This is strictly
 * better than the post-launch bracketed-paste fallback in agent-paste-draft.ts
 * because it eliminates the empirical readiness wait entirely — the agent
 * controls when its input is rendered.
 *
 * Returns `null` when the agent has no native prefill flag; callers fall
 * back to the paste-after-ready path.
 */
export function buildAgentDraftLaunchPlan(args: {
  agent: TuiAgent
  draft: string
  cmdOverrides: Partial<Record<TuiAgent, string>>
  platform: NodeJS.Platform
  /** Same role as in `buildAgentStartupPlan`: when set, the launch command
   *  comes from the profile + env shell prefix. */
  customProfile?: CustomAgentProfile | null
}): AgentDraftLaunchPlan | null {
  const { agent, draft, cmdOverrides, platform, customProfile = null } = args
  const config = TUI_AGENT_CONFIG[agent]
  if (!config.draftPromptFlag) {
    return null
  }
  const trimmed = draft.trim()
  if (!trimmed) {
    return null
  }
  const baseCommand = customProfile
    ? resolveCustomAgentBaseCommand(customProfile, platform)
    : (cmdOverrides[agent] ?? config.launchCmd)
  const quoted = quoteStartupArg(trimmed, platform)
  return {
    agent,
    launchCommand: `${baseCommand} ${config.draftPromptFlag} ${quoted}`,
    expectedProcess: config.expectedProcess
  }
}

export { isShellProcess } from '../../../shared/agent-detection'
