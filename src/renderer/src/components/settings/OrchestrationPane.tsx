import { useState } from 'react'
import { ArrowRightLeft, GitBranch, ListChecks, Workflow } from 'lucide-react'
import type { CliInstallStatus } from '../../../../shared/cli-install-types'
import { ORCHESTRATION_SKILL_NAME } from '@/lib/agent-feature-install-commands'
import {
  AGENT_SKILL_CLI_PREREQUISITE_NOTICE,
  ensureOrcaCliAvailableForAgentSkillTerminal
} from '@/lib/agent-skill-cli-prerequisite'
import { ORCHESTRATION_SKILL_INSTALL_COMMAND } from '@/lib/orchestration-install-command'
import { ORCHESTRATION_USAGE_EXAMPLES } from '@/lib/orchestration-usage-examples'
import {
  GLOBAL_AGENT_SKILL_SOURCE_KINDS,
  useInstalledAgentSkill
} from '@/hooks/useInstalledAgentSkills'
import { SearchableSetting } from './SearchableSetting'
import { matchesSettingsSearch } from './settings-search'
import { useAppStore } from '../../store'
import { ORCHESTRATION_PANE_SEARCH_ENTRIES } from './orchestration-search'
import { AgentSkillSetupPanel } from './AgentSkillSetupPanel'
import { OrchestrationSkillAgentCoverage } from './OrchestrationSkillAgentCoverage'
import { OrchestrationExampleDialog } from './OrchestrationExamplesDialog'
import { OrchestrationSkillPromptDialog } from './OrchestrationSkillPromptDialog'

const EXAMPLE_ICONS = {
  handoff: ArrowRightLeft,
  'worktree-handoff': ArrowRightLeft,
  'child-sequence': ListChecks,
  'child-parallel': GitBranch,
  'child-worktrees': Workflow
} as const

const ORCHESTRATION_NO_SKILL_PREVIEW_KEY = 'orca-preview-orchestration-no-skill'
const ORCHESTRATION_CLI_READY_PREVIEW_KEY = 'orca-preview-orchestration-cli-ready'

function isDevPreviewFlagEnabled(key: string): boolean {
  if (!import.meta.env.DEV || typeof window === 'undefined') {
    return false
  }
  try {
    return window.localStorage.getItem(key) === '1'
  } catch {
    // Why: localStorage can be unavailable in constrained renderer contexts;
    // preview toggles should never break the real settings pane.
    return false
  }
}

function isOrchestrationNoSkillPreviewActive(): boolean {
  return isDevPreviewFlagEnabled(ORCHESTRATION_NO_SKILL_PREVIEW_KEY)
}

function isOrchestrationCliReadyPreviewActive(): boolean {
  return isDevPreviewFlagEnabled(ORCHESTRATION_CLI_READY_PREVIEW_KEY)
}

function orchestrationCliPreviewStatus(platform: NodeJS.Platform): CliInstallStatus {
  return {
    platform,
    commandName: platform === 'linux' ? 'orca-ide' : 'orca',
    commandPath: null,
    pathDirectory: platform === 'darwin' ? '/usr/local/bin' : null,
    pathConfigured: false,
    launcherPath: null,
    installMethod: null,
    supported: true,
    state: 'not_installed',
    currentTarget: null,
    unsupportedReason: null,
    detail:
      platform === 'darwin'
        ? 'Register `orca` in /usr/local/bin.'
        : platform === 'linux'
          ? 'Register `orca-ide` in ~/.local/bin.'
          : 'Register `orca` in your user PATH.'
  }
}

function orchestrationCliReadyPreviewStatus(platform: NodeJS.Platform): CliInstallStatus {
  const commandName = platform === 'linux' ? 'orca-ide' : 'orca'
  const commandPath =
    platform === 'darwin'
      ? '/usr/local/bin/orca'
      : platform === 'linux'
        ? '~/.local/bin/orca-ide'
        : 'C:\\Users\\you\\AppData\\Local\\Programs\\orca\\orca.exe'
  return {
    platform,
    commandName,
    commandPath,
    pathDirectory: commandPath.replace(/[\\/][^\\/]+$/, ''),
    pathConfigured: true,
    launcherPath: commandPath,
    installMethod: 'symlink',
    supported: true,
    state: 'installed',
    currentTarget: null,
    unsupportedReason: null,
    detail: null
  }
}

async function getOrchestrationCliPrerequisiteStatus(): Promise<CliInstallStatus> {
  if (typeof window === 'undefined') {
    throw new Error('CLI status is unavailable outside the desktop renderer.')
  }
  if (!import.meta.env.DEV) {
    return window.api.cli.getInstallStatus()
  }
  const platform = window.api.platform.get().platform
  if (isOrchestrationCliReadyPreviewActive()) {
    return orchestrationCliReadyPreviewStatus(platform)
  }
  if (isOrchestrationNoSkillPreviewActive()) {
    return orchestrationCliPreviewStatus(platform)
  }
  return window.api.cli.getInstallStatus()
}

export function OrchestrationPane(): React.JSX.Element {
  const searchQuery = useAppStore((s) => s.settingsSearchQuery)
  const showOrchestration = matchesSettingsSearch(searchQuery, ORCHESTRATION_PANE_SEARCH_ENTRIES)
  const [selectedExampleId, setSelectedExampleId] = useState<string | null>(null)
  const [skillPromptOpen, setSkillPromptOpen] = useState(false)

  const {
    installed: orchestrationSkillDetected,
    loading: orchestrationSkillLoading,
    error: orchestrationSkillError,
    skills: discoveredSkills,
    refresh: refreshOrchestrationSkill
  } = useInstalledAgentSkill(ORCHESTRATION_SKILL_NAME, {
    sourceKinds: GLOBAL_AGENT_SKILL_SOURCE_KINDS
  })
  const previewNoSkillInstalled = isOrchestrationNoSkillPreviewActive()
  const orchestrationSkillInstalled = previewNoSkillInstalled ? false : orchestrationSkillDetected
  const orchestrationSkillScanLoading = previewNoSkillInstalled ? false : orchestrationSkillLoading
  const orchestrationSkillScanError = previewNoSkillInstalled ? null : orchestrationSkillError
  const orchestrationDiscoveredSkills = previewNoSkillInstalled ? [] : discoveredSkills

  if (!showOrchestration) {
    return <div />
  }

  return (
    <SearchableSetting
      title="Agent Orchestration"
      description="Coordinate coding agents across handoffs, worktree handovers, and child-agent work."
      keywords={ORCHESTRATION_PANE_SEARCH_ENTRIES[0].keywords}
      className="space-y-5 py-2"
    >
      <AgentSkillSetupPanel
        title="Orchestration skill"
        description="Enables agents to hand off context and coordinate work through Orca."
        command={ORCHESTRATION_SKILL_INSTALL_COMMAND}
        terminalTitle="Orchestration setup"
        terminalAriaLabel="Orchestration skill install terminal"
        terminalWorktreeId="settings-orchestration-skill-terminal"
        installed={orchestrationSkillInstalled}
        loading={orchestrationSkillScanLoading}
        error={orchestrationSkillScanError}
        icon={<Workflow className="size-5" />}
        preInstallNotice={AGENT_SKILL_CLI_PREREQUISITE_NOTICE}
        getPrerequisiteStatus={getOrchestrationCliPrerequisiteStatus}
        onBeforeOpenTerminal={async () => {
          useAppStore.getState().recordFeatureInteraction('agent-orchestration-setup')
          await ensureOrcaCliAvailableForAgentSkillTerminal()
        }}
        actionHint={
          <p className="text-[12px] leading-snug text-muted-foreground">
            Prefer your own terminal?{' '}
            <button
              type="button"
              className="font-medium text-foreground underline-offset-2 hover:underline"
              onClick={() => setSkillPromptOpen(true)}
            >
              Copy install command
            </button>
          </p>
        }
        footer={
          <OrchestrationSkillAgentCoverage
            embedded
            skills={orchestrationDiscoveredSkills}
            loading={orchestrationSkillScanLoading}
          />
        }
        onRecheck={refreshOrchestrationSkill}
      />

      <OrchestrationSkillPromptDialog
        command={ORCHESTRATION_SKILL_INSTALL_COMMAND}
        open={skillPromptOpen}
        onOpenChange={setSkillPromptOpen}
      />

      <div className="space-y-4 border-t border-border/60 pt-6">
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-foreground">How to use it</h3>
          <p className="text-xs text-muted-foreground">
            Ask a coordinator agent to use orchestration for handoffs, worktree handovers, and
            sequential or parallel child agents.
          </p>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          {ORCHESTRATION_USAGE_EXAMPLES.map((example) => {
            const Icon = EXAMPLE_ICONS[example.id as keyof typeof EXAMPLE_ICONS] ?? Workflow
            return (
              <button
                key={example.id}
                type="button"
                className="rounded-md border border-border/60 bg-muted/20 px-4 py-3 text-left transition-colors hover:bg-muted/35 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                onClick={() => setSelectedExampleId(example.id)}
              >
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-background text-muted-foreground">
                    <Icon className="size-4" />
                  </div>
                  <div className="min-w-0 space-y-1">
                    <p className="text-sm font-medium text-foreground">{example.title}</p>
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      {example.summary}
                    </p>
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {ORCHESTRATION_USAGE_EXAMPLES.map((example) => {
        const Icon = EXAMPLE_ICONS[example.id as keyof typeof EXAMPLE_ICONS] ?? Workflow
        return (
          <OrchestrationExampleDialog
            key={`${example.id}-dialog`}
            example={example}
            icon={Icon}
            open={selectedExampleId === example.id}
            onOpenChange={(open) => setSelectedExampleId(open ? example.id : null)}
          />
        )
      })}
    </SearchableSetting>
  )
}
