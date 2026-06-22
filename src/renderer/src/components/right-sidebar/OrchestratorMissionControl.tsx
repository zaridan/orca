import React, { useEffect, useMemo, useState } from 'react'
import { ExternalLink, GitMerge, Network } from 'lucide-react'
import { useAppStore } from '@/store'
import { cn } from '@/lib/utils'
import { AgentStateDot } from '@/components/AgentStateDot'
import { activateAndRevealWorktree } from '@/lib/worktree-activation'
import { deriveWorktreeAgentDotState } from '@/lib/worktree-agent-dot-state'
import { selectSpawnedWorktreeIds } from '@/lib/orchestrator-mission-control-data'
import { deriveWorkerPrBadge } from '@/lib/orchestrator-worker-pr-badge'
import {
  parseOrchestrateLogOutcomes,
  selectShippedWork,
  type ShippedWorkItem
} from '@/lib/orcastrate-log-shipped-work'
import { buildGithubPrSearchUrl } from '@/lib/github-pr-search-url'
import { matchesShippedBranch } from '@/lib/shipped-branch-pr-match'
import { getHostedReviewCacheKey } from '@/store/slices/hosted-review'
import { joinPath } from '@/lib/path'
import { translate } from '@/i18n/i18n'
import type { HostedReviewState } from '../../../../shared/hosted-review'
import type { GitHubWorkItem, Repo, Worktree } from '../../../../shared/types'

// Why: a director appends its outcomes to this log in its own worktree, so it
// survives the worker worktrees being removed — the only durable shipped history.
const ORCASTRATE_LOG_RELATIVE_PATH = '.orcastrate/log.jsonl'

// Why: PR state words are user-facing, so map them through the catalog rather
// than rendering the raw enum value.
function prStateLabel(state: HostedReviewState): string {
  switch (state) {
    case 'open':
      return translate('auto.components.right.sidebar.OrchestratorMissionControl.pr_open', 'open')
    case 'merged':
      return translate(
        'auto.components.right.sidebar.OrchestratorMissionControl.pr_merged',
        'merged'
      )
    case 'closed':
      return translate(
        'auto.components.right.sidebar.OrchestratorMissionControl.pr_closed',
        'closed'
      )
    case 'draft':
      return translate('auto.components.right.sidebar.OrchestratorMissionControl.pr_draft', 'draft')
  }
}

// Why: PR state reads as a colored pill in GitHub's convention (merged = purple,
// open = green, closed = red, draft = gray). Colors come from theme-scoped
// --pr-state-* tokens in main.css (the same VS-Code-parity exception the
// git-decoration palette makes) rather than raw hex in this renderer file.
const PR_STATE_PILL_CLASS: Record<HostedReviewState, string> = {
  merged: 'bg-[var(--pr-state-merged)] text-white',
  open: 'bg-[var(--pr-state-open)] text-white',
  closed: 'bg-[var(--pr-state-closed)] text-white',
  draft: 'bg-[var(--pr-state-draft)] text-white'
}

function PrStatePill({ state }: { state: HostedReviewState }): React.JSX.Element {
  return (
    <span
      className={cn(
        'shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium capitalize leading-none',
        PR_STATE_PILL_CLASS[state]
      )}
    >
      {prStateLabel(state)}
    </span>
  )
}

// Why: shown in the Source Control panel when a director's worktree is active,
// in place of the publish/PR view a director has no use for. It is the director's
// console: who it is, why there's no branch here, and the worker worktrees it
// spawned (linked via lineage parent) with each worker's live agent state. v1 is
// derived entirely from already-synced store state — no orchestration RPC yet, so
// it shows agent run-state per worker, not (yet) per-worker dispatch state.
export default function OrchestratorMissionControl({
  worktreeId
}: {
  worktreeId: string
}): React.JSX.Element {
  const orchestrators = useAppStore((s) => s.orchestrators)
  const worktreeLineageById = useAppStore((s) => s.worktreeLineageById)
  const worktreesByRepo = useAppStore((s) => s.worktreesByRepo)
  const tabsByWorktree = useAppStore((s) => s.tabsByWorktree)
  const agentStatusByPaneKey = useAppStore((s) => s.agentStatusByPaneKey)
  const repos = useAppStore((s) => s.repos)
  const settings = useAppStore((s) => s.settings)
  const hostedReviewCache = useAppStore((s) => s.hostedReviewCache)

  const entry = (orchestrators ?? []).find((candidate) => candidate.worktreeId === worktreeId)

  const worktreesById = useMemo(() => {
    const map = new Map<string, Worktree>()
    for (const list of Object.values(worktreesByRepo ?? {})) {
      for (const worktree of list) {
        map.set(worktree.id, worktree)
      }
    }
    return map
  }, [worktreesByRepo])

  const reposById = useMemo(() => {
    const map = new Map<string, Repo>()
    for (const repo of repos ?? []) {
      map.set(repo.id, repo)
    }
    return map
  }, [repos])

  // Why: a worker's PR reads identically to the worktree card — compute the cache
  // key the same way and reuse the card's display derivation, so a live worker
  // shows `PR #N · open/merged` while its worktree exists.
  const prBadgeForWorker = (
    worker: Worktree | undefined
  ): ReturnType<typeof deriveWorkerPrBadge> => {
    if (!worker) {
      return null
    }
    const repo = reposById.get(worker.repoId)
    const branch = worker.branch
    const key =
      repo && branch
        ? getHostedReviewCacheKey(
            repo.path,
            branch,
            settings,
            repo.id,
            repo.connectionId,
            repo.executionHostId
          )
        : ''
    const reviewEntry = key ? hostedReviewCache[key] : undefined
    return deriveWorkerPrBadge(
      worker,
      reviewEntry !== undefined ? reviewEntry.data : undefined,
      reviewEntry?.linkedReviewHintKey
    )
  }

  const workerIds = useMemo(
    () =>
      selectSpawnedWorktreeIds(worktreeId, worktreeLineageById ?? {}, (id) =>
        worktreesById.has(id)
      ),
    [worktreeId, worktreeLineageById, worktreesById]
  )

  // Why: read the director's outcome log so its shipped work shows even after the
  // worker worktrees are torn down. Keyed off the director worktree (path +
  // connection) and re-read when the worktree set changes (a teardown is when a
  // new shipped entry is most likely to have landed).
  const directorWorktree = worktreesById.get(worktreeId)
  const directorRepo = directorWorktree ? reposById.get(directorWorktree.repoId) : undefined
  const directorPath = directorWorktree?.path ?? null
  const directorConnectionId = directorRepo?.connectionId ?? undefined
  const [shippedItems, setShippedItems] = useState<ShippedWorkItem[]>([])
  useEffect(() => {
    if (!directorPath) {
      setShippedItems([])
      return
    }
    let cancelled = false
    const filePath = joinPath(directorPath, ORCASTRATE_LOG_RELATIVE_PATH)
    void window.api.fs
      .readFile({ filePath, connectionId: directorConnectionId })
      .then((result) => {
        if (!cancelled) {
          setShippedItems(parseOrchestrateLogOutcomes(result.content))
        }
      })
      .catch(() => {
        // Why: no log yet (a brand-new director) is the normal case, not an error.
        if (!cancelled) {
          setShippedItems([])
        }
      })
    return () => {
      cancelled = true
    }
  }, [directorPath, directorConnectionId, worktreesByRepo])

  // Why: resolve the director repo's `owner/repo` so a shipped branch can link to
  // its merged PR via GitHub head-ref search — reliable even after the branch is
  // deleted and the review cache is cold. Null for non-GitHub repos (no link).
  const [repoSlug, setRepoSlug] = useState<string | null>(null)
  useEffect(() => {
    const repoPath = directorRepo?.path
    const repoId = directorRepo?.id
    if (!repoPath || !repoId) {
      setRepoSlug(null)
      return
    }
    let cancelled = false
    void window.api.gh
      .repoSlug({ repoPath, repoId })
      .then((result) => {
        if (!cancelled) {
          setRepoSlug(result ? `${result.owner}/${result.repo}` : null)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRepoSlug(null)
        }
      })
    return () => {
      cancelled = true
    }
  }, [directorRepo?.path, directorRepo?.id])

  // Why: don't double-list a branch that is still a live worker above; the shipped
  // section is for work whose worktree is gone.
  const liveWorkerBranches = useMemo(
    () => new Set(workerIds.map((id) => worktreesById.get(id)?.branch).filter(Boolean)),
    [workerIds, worktreesById]
  )
  const shippedWork = useMemo(
    () => selectShippedWork(shippedItems).filter((item) => !liveWorkerBranches.has(item.name)),
    [shippedItems, liveWorkerBranches]
  )

  // Why: fetch the repo's PRs once and match each shipped branch to its PR by head
  // ref — prefix-agnostic, so a branch renamed on push (`chore/x` → `prefix/chore-x`)
  // still resolves. Avoids reconstructing the push prefix (which depends on
  // git-username resolution we can't see reliably from the renderer). The
  // component is keyed by the director worktree (see SourceControl), so switching
  // directors remounts it and this state resets without an effect.
  const [prItems, setPrItems] = useState<Omit<GitHubWorkItem, 'repoId'>[]>([])
  useEffect(() => {
    const repoPath = directorRepo?.path
    const repoId = directorRepo?.id
    if (!repoPath || !repoId || shippedWork.length === 0) {
      // Drop any previously-fetched items so a repo/shipped-work change that fails
      // preconditions can't leave stale PRs to match against.
      setPrItems([])
      return
    }
    let cancelled = false
    void window.api.gh
      // Why: `state:all` so merged PRs come back — the default is open-only, which
      // is exactly the wrong set for shipped (merged) work.
      .listWorkItems({ repoPath, repoId, query: 'is:pr state:all', limit: 100 })
      .then((result) => {
        if (!cancelled) {
          setPrItems((result.items ?? []).filter((item) => item.type === 'pr'))
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPrItems([])
        }
      })
    return () => {
      cancelled = true
    }
  }, [directorRepo?.path, directorRepo?.id, shippedWork.length])

  // Direct PR link when a matching PR is found; otherwise a GitHub head-ref search
  // as a fallback (e.g. gh not authed). Null when there's nothing to link to.
  const shippedPrLink = (branch: string): { url: string; number?: number } | null => {
    const pr = prItems.find((item) => matchesShippedBranch(item.branchName ?? '', branch))
    if (pr) {
      return { url: pr.url, number: pr.number }
    }
    return repoSlug ? { url: buildGithubPrSearchUrl(repoSlug, branch) } : null
  }

  const directorTabIds = (tabsByWorktree[worktreeId] ?? []).map((tab) => tab.id)
  const directorDot = deriveWorktreeAgentDotState(directorTabIds, agentStatusByPaneKey)
  const directorName =
    entry?.projectName ??
    translate('auto.components.right.sidebar.OrchestratorMissionControl.fallback', 'Orcastrator')

  return (
    <div className="flex h-full flex-col overflow-y-auto scrollbar-sleek">
      <div className="border-b border-border px-3 py-3">
        <div className="flex items-center gap-2">
          <AgentStateDot state={directorDot} size="sm" />
          <Network className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
            {directorName}
          </span>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          {translate(
            'auto.components.right.sidebar.OrchestratorMissionControl.summary',
            'Directs worker agents in their own worktrees — it has no branch to publish. Each worker opens its own pull request.'
          )}
        </p>
      </div>

      <div className="px-2 py-2">
        <div className="flex items-center justify-between px-1 pb-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {translate(
              'auto.components.right.sidebar.OrchestratorMissionControl.spawned',
              'Spawned work'
            )}
          </span>
          {workerIds.length > 0 ? (
            <span className="text-[11px] tabular-nums text-muted-foreground">
              {workerIds.length}
            </span>
          ) : null}
        </div>

        {workerIds.length === 0 ? (
          <p className="px-1 py-2 text-xs leading-relaxed text-muted-foreground">
            {translate(
              'auto.components.right.sidebar.OrchestratorMissionControl.empty',
              'No worktrees yet — the director creates them as it plans the work.'
            )}
          </p>
        ) : (
          <div className="flex flex-col gap-0.5">
            {workerIds.map((id) => {
              const worker = worktreesById.get(id)
              const tabIds = (tabsByWorktree[id] ?? []).map((tab) => tab.id)
              const dot = deriveWorktreeAgentDotState(tabIds, agentStatusByPaneKey)
              const prBadge = prBadgeForWorker(worker)
              const prUrl = prBadge?.url
              // Why: row + PR link are siblings (not nested buttons) so the link
              // opens the PR while the row body reveals the worktree.
              return (
                <div
                  key={id}
                  className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-[13px] text-foreground transition-colors hover:bg-accent"
                >
                  <button
                    type="button"
                    onClick={() => activateAndRevealWorktree(id, { sidebarRevealBehavior: 'auto' })}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    <AgentStateDot state={dot} size="sm" />
                    <span className="min-w-0 flex-1 truncate">{worker?.displayName ?? id}</span>
                  </button>
                  {prBadge ? (
                    <div className="flex shrink-0 items-center gap-1.5">
                      {prBadge.state ? <PrStatePill state={prBadge.state} /> : null}
                      {prUrl ? (
                        <button
                          type="button"
                          onClick={() => void window.api.shell.openUrl(prUrl)}
                          className="flex items-center gap-1 text-[11px] tabular-nums text-muted-foreground transition-colors hover:text-foreground hover:underline"
                        >
                          {prBadge.label} #{prBadge.number}
                          <ExternalLink className="size-3" aria-hidden />
                        </button>
                      ) : (
                        <span className="flex items-center gap-1 text-[11px] tabular-nums text-muted-foreground">
                          {prBadge.label} #{prBadge.number}
                        </span>
                      )}
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {shippedWork.length > 0 ? (
        <div className="border-t border-border px-2 py-2">
          <div className="flex items-center justify-between px-1 pb-1">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {translate(
                'auto.components.right.sidebar.OrchestratorMissionControl.shipped',
                'Shipped'
              )}
            </span>
            <span className="text-[11px] tabular-nums text-muted-foreground">
              {shippedWork.length}
            </span>
          </div>
          <div className="flex flex-col gap-1.5">
            {shippedWork.map((item) => {
              const prLink = shippedPrLink(item.name)
              return (
                <div key={item.name} className="flex min-w-0 items-start gap-2 px-1 py-0.5">
                  <GitMerge
                    className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="min-w-0 flex-1 truncate text-[13px] text-foreground">
                        {item.name}
                      </p>
                      <PrStatePill state="merged" />
                      {prLink ? (
                        <button
                          type="button"
                          onClick={() => void window.api.shell.openUrl(prLink.url)}
                          className="flex shrink-0 items-center gap-1 text-[11px] tabular-nums text-muted-foreground transition-colors hover:text-foreground hover:underline"
                        >
                          {prLink.number != null
                            ? translate(
                                'auto.components.right.sidebar.OrchestratorMissionControl.pr_number',
                                'PR #{{number}}',
                                { number: prLink.number }
                              )
                            : translate(
                                'auto.components.right.sidebar.OrchestratorMissionControl.view_pr',
                                'View PR'
                              )}
                          <ExternalLink className="size-3" aria-hidden />
                        </button>
                      ) : null}
                    </div>
                    {item.description ? (
                      <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                        {item.description}
                      </p>
                    ) : null}
                  </div>
                </div>
              )
            })}
          </div>
          <p className="px-1 pt-1.5 text-[11px] leading-snug text-muted-foreground/80">
            {translate(
              'auto.components.right.sidebar.OrchestratorMissionControl.shipped_note',
              'From the director’s log — the worktrees are torn down after merge; each branch is matched to its merged pull request.'
            )}
          </p>
        </div>
      ) : null}
    </div>
  )
}
