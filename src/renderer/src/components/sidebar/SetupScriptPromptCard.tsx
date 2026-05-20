import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Download, LoaderCircle, Settings, X } from 'lucide-react'
import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import {
  checkRuntimeHooks,
  inspectRuntimeSetupScriptImports,
  type HookCheckResult
} from '@/runtime/runtime-hooks-client'
import { getDefaultRepoHookSettings } from '../../../../shared/constants'
import { normalizeHookCommandSourcePolicy } from '../../../../shared/hook-command-source-policy'
import { isGitRepoKind } from '../../../../shared/repo-kind'
import type { Repo, RepoHookSettings } from '../../../../shared/types'
import type { SetupScriptImportCandidate } from '../../../../shared/setup-script-imports'

type PromptState = {
  repoId: string
  hasEffectiveSetup: boolean
  hasSharedHooks: boolean
  candidate: SetupScriptImportCandidate | null
}

function hasEffectiveSetupCommand(repo: Repo, hooksResult: HookCheckResult): boolean {
  const localSetup = repo.hookSettings?.scripts?.setup?.trim()
  const sharedSetup = hooksResult.hooks?.scripts?.setup?.trim()
  const rawPolicy = repo.hookSettings?.commandSourcePolicy
  const sourcePolicy = normalizeHookCommandSourcePolicy(rawPolicy)

  if (sourcePolicy === 'local-only') {
    return Boolean(localSetup)
  }

  if (sourcePolicy === 'run-both') {
    return Boolean(sharedSetup || localSetup)
  }

  // Why: local setup commands saved before commandSourcePolicy existed still
  // run when there is no tracked hook file; the prompt should respect that.
  if (rawPolicy === undefined && !hooksResult.hasHooks) {
    return Boolean(localSetup)
  }

  return Boolean(sharedSetup)
}

function buildImportedHookSettings(
  repo: Repo,
  candidate: SetupScriptImportCandidate,
  hasSharedHooks: boolean
): RepoHookSettings {
  const defaults = getDefaultRepoHookSettings()
  const current = repo.hookSettings
  return {
    ...defaults,
    ...current,
    setupRunPolicy: current?.setupRunPolicy ?? defaults.setupRunPolicy,
    // Why: imported setup commands are stored as local settings. If a shared
    // hook file exists, run-both preserves its archive hook; otherwise local
    // settings need to be authoritative so the imported setup actually runs.
    commandSourcePolicy: hasSharedHooks ? 'run-both' : 'local-only',
    scripts: {
      ...defaults.scripts,
      ...current?.scripts,
      setup: candidate.setup,
      archive: candidate.archive ?? current?.scripts?.archive ?? defaults.scripts.archive
    }
  }
}

function SetupScriptPromptCard(): React.JSX.Element | null {
  const sidebarOpen = useAppStore((s) => s.sidebarOpen)
  const repos = useAppStore((s) => s.repos)
  const activeRepoId = useAppStore((s) => s.activeRepoId)
  const settings = useAppStore((s) => s.settings)
  const updateRepo = useAppStore((s) => s.updateRepo)
  const openSettingsPage = useAppStore((s) => s.openSettingsPage)
  const openSettingsTarget = useAppStore((s) => s.openSettingsTarget)
  const dismissedRepoIds = useAppStore((s) => s.setupScriptPromptDismissedRepoIds)
  const dismissSetupScriptPrompt = useAppStore((s) => s.dismissSetupScriptPrompt)
  const [promptState, setPromptState] = useState<PromptState | null>(null)
  const [isImporting, setIsImporting] = useState(false)

  const activeRepo = useMemo(
    () => repos.find((repo) => repo.id === activeRepoId) ?? null,
    [activeRepoId, repos]
  )
  const isDismissed = activeRepo ? dismissedRepoIds.includes(activeRepo.id) : false

  useEffect(() => {
    if (!sidebarOpen || !activeRepo || !isGitRepoKind(activeRepo) || isDismissed) {
      setPromptState(null)
      return
    }

    const repo = activeRepo
    let cancelled = false
    setPromptState(null)

    async function inspectRepoSetup(): Promise<void> {
      try {
        const hooksResult = await checkRuntimeHooks(settings, repo.id)
        if (cancelled) {
          return
        }

        const hasEffectiveSetup = hasEffectiveSetupCommand(repo, hooksResult)
        if (hasEffectiveSetup) {
          setPromptState({
            repoId: repo.id,
            hasEffectiveSetup: true,
            hasSharedHooks: hooksResult.hasHooks,
            candidate: null
          })
          return
        }

        const candidates = await inspectRuntimeSetupScriptImports(settings, repo.id).catch(() => [])
        if (cancelled) {
          return
        }

        setPromptState({
          repoId: repo.id,
          hasEffectiveSetup: false,
          hasSharedHooks: hooksResult.hasHooks,
          candidate: candidates[0] ?? null
        })
      } catch (error) {
        if (!cancelled) {
          console.warn('[setup-script-prompt] Failed to inspect setup scripts:', error)
          setPromptState(null)
        }
      }
    }

    void inspectRepoSetup()

    return () => {
      cancelled = true
    }
  }, [activeRepo, isDismissed, settings, sidebarOpen])

  const handleConfigure = useCallback(() => {
    if (!activeRepo) {
      return
    }
    openSettingsTarget({ pane: 'repo', repoId: activeRepo.id })
    openSettingsPage()
  }, [activeRepo, openSettingsPage, openSettingsTarget])

  const handleDismiss = useCallback(() => {
    if (activeRepo) {
      dismissSetupScriptPrompt(activeRepo.id)
    }
  }, [activeRepo, dismissSetupScriptPrompt])

  const handleImport = useCallback(async () => {
    if (!activeRepo || !promptState?.candidate) {
      return
    }
    setIsImporting(true)
    try {
      const nextSettings = buildImportedHookSettings(
        activeRepo,
        promptState.candidate,
        promptState.hasSharedHooks
      )
      await updateRepo(activeRepo.id, { hookSettings: nextSettings })
      setPromptState((current) =>
        current?.repoId === activeRepo.id ? { ...current, hasEffectiveSetup: true } : current
      )
      const skippedCount = promptState.candidate.unsupportedFields?.length ?? 0
      toast.success('Setup script imported', {
        description:
          skippedCount > 0
            ? `${skippedCount} unsupported field${skippedCount === 1 ? '' : 's'} skipped.`
            : undefined
      })
    } finally {
      setIsImporting(false)
    }
  }, [activeRepo, promptState, updateRepo])

  if (
    !sidebarOpen ||
    !activeRepo ||
    !isGitRepoKind(activeRepo) ||
    isDismissed ||
    promptState?.repoId !== activeRepo.id ||
    promptState.hasEffectiveSetup
  ) {
    return null
  }

  const candidate = promptState.candidate
  const title = 'Setup scripts'
  const description = candidate
    ? `Detected setup config for ${activeRepo.displayName}.`
    : `Automate workspace setup for ${activeRepo.displayName}.`
  const actionLabel = candidate ? 'Import setup' : 'Configure'
  const ActionIcon = candidate ? Download : Settings

  return (
    <div className="px-3 pb-2">
      <div className="relative rounded-lg border border-sidebar-border bg-card p-3 text-card-foreground shadow-xs">
        <Badge variant="outline" className="h-5 px-1.5 text-[11px]">
          Setup
        </Badge>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="Dismiss setup scripts"
              className="absolute right-2 top-2 text-muted-foreground"
              onClick={handleDismiss}
            >
              <X className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={4}>
            Dismiss
          </TooltipContent>
        </Tooltip>

        <p className="mt-2 pr-6 text-sm font-semibold leading-snug">{title}</p>
        <p className="mt-1 text-xs leading-snug text-muted-foreground">{description}</p>

        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-3 h-7 w-full text-xs"
          onClick={candidate ? () => void handleImport() : handleConfigure}
          disabled={isImporting}
        >
          {isImporting ? (
            <LoaderCircle className="size-3.5 animate-spin" />
          ) : (
            <ActionIcon className="size-3.5" />
          )}
          <span className={cn('truncate', isImporting && 'text-muted-foreground')}>
            {actionLabel}
          </span>
        </Button>
      </div>
    </div>
  )
}

export default React.memo(SetupScriptPromptCard)
