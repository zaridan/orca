import React from 'react'
import { RefreshCw, Ellipsis, Link, Unlink, GitMerge } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { getTerminalUrlSystemBrowserHint } from '../terminal-pane/terminal-link-open-hints'
import { PullRequestIcon, prStateColor } from './checks-panel-content'
import { type ChecksPanelReview } from './checks-panel-review'
import type { HostedReviewProvider } from '../../../../shared/hosted-review'
import { translate } from '@/i18n/i18n'

type ReviewProviderPresentation = {
  hostLabel: string
  icon: typeof PullRequestIcon
  numberPrefix: string
}

// Why: handle every HostedReviewProvider explicitly so non-GitHub hosts
// (Bitbucket/Azure DevOps/Gitea) show their own name instead of defaulting to
// "GitHub". Only GitLab uses the merge-request icon + `!` notation; the other
// providers are all pull-request style. No default case: the switch is
// exhaustive, so adding a provider becomes a compile error here.
function reviewProviderPresentation(provider: HostedReviewProvider): ReviewProviderPresentation {
  switch (provider) {
    case 'github':
      return { hostLabel: 'GitHub', icon: PullRequestIcon, numberPrefix: '#' }
    case 'gitlab':
      return { hostLabel: 'GitLab', icon: GitMerge, numberPrefix: '!' }
    case 'bitbucket':
      return { hostLabel: 'Bitbucket', icon: PullRequestIcon, numberPrefix: '#' }
    case 'azure-devops':
      return { hostLabel: 'Azure DevOps', icon: PullRequestIcon, numberPrefix: '#' }
    case 'gitea':
      return { hostLabel: 'Gitea', icon: PullRequestIcon, numberPrefix: '#' }
    case 'unsupported':
      return { hostLabel: 'Review', icon: PullRequestIcon, numberPrefix: '#' }
  }
}

type ChecksPanelReviewHeaderProps = {
  review: ChecksPanelReview
  isRefreshing: boolean
  canUnlinkPullRequest: boolean
  // Link/unlink edit worktree meta; hide the menu when there's no live worktree
  // (a shipped/worktree-less card) so the actions aren't shown enabled-but-no-op.
  canManagePullRequestLink: boolean
  showSystemBrowserHint: boolean
  onRefresh: () => void
  onOpenReview: (event: React.MouseEvent<HTMLButtonElement>) => void
  onUnlinkPullRequest: () => void
  onLinkAnotherPullRequest: () => void
}

export function ChecksPanelReviewHeader({
  review,
  isRefreshing,
  canUnlinkPullRequest,
  canManagePullRequestLink,
  showSystemBrowserHint,
  onRefresh,
  onOpenReview,
  onUnlinkPullRequest,
  onLinkAnotherPullRequest
}: ChecksPanelReviewHeaderProps): React.JSX.Element {
  const {
    hostLabel: reviewHostLabel,
    icon: ReviewIcon,
    numberPrefix
  } = reviewProviderPresentation(review.provider)
  const reviewNumberLabel = `${numberPrefix}${review.number}`
  // Hide link/unlink edits on shipped/worktree-less cards so they aren't shown enabled-but-no-op.
  const showPullRequestMenu = review.provider === 'github' && canManagePullRequestLink
  const openTitle = translate(
    'auto.components.right.sidebar.ChecksPanel.5c88c6db07',
    'Open on {{value0}}',
    { value0: reviewHostLabel }
  )
  const title = showSystemBrowserHint
    ? `${openTitle}. ${getTerminalUrlSystemBrowserHint()}`
    : openTitle

  return (
    <div className="flex items-center gap-2">
      <ReviewIcon className="size-4 text-muted-foreground shrink-0" />
      <button
        type="button"
        className="rounded px-0.5 text-[12px] font-semibold text-foreground underline decoration-border underline-offset-2 hover:text-foreground hover:decoration-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        title={title}
        onClick={onOpenReview}
      >
        {reviewNumberLabel}
      </button>
      <span
        className={cn(
          'text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border',
          prStateColor(review.state)
        )}
      >
        {review.state}
      </span>
      <div className="flex-1" />
      <button
        type="button"
        className="cursor-pointer rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-default disabled:opacity-50"
        aria-label={translate('auto.components.right.sidebar.ChecksPanel.7f4489f370', 'Refresh')}
        title={translate('auto.components.right.sidebar.ChecksPanel.7f4489f370', 'Refresh')}
        onClick={onRefresh}
        disabled={isRefreshing}
      >
        <RefreshCw className={cn('size-3.5', isRefreshing && 'animate-spin')} />
      </button>
      {showPullRequestMenu && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={translate(
                'auto.components.right.sidebar.ChecksPanel.653c105ecc',
                'More PR actions'
              )}
              title={translate(
                'auto.components.right.sidebar.ChecksPanel.653c105ecc',
                'More PR actions'
              )}
              className="text-muted-foreground hover:text-foreground"
            >
              <Ellipsis className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem disabled={!canUnlinkPullRequest} onSelect={onUnlinkPullRequest}>
              <Unlink className="size-3.5" />
              {translate('auto.components.right.sidebar.ChecksPanel.7202f4a40a', 'unlink PR')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onLinkAnotherPullRequest}>
              <Link className="size-3.5" />
              {translate('auto.components.right.sidebar.ChecksPanel.07871c0589', 'Link another PR')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}
