import { Ban, CheckCircle2, Copy } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import type { GitHubIssueCloseReason } from '../../../../shared/types'

export type CloseIssueReasonOption = {
  reason: GitHubIssueCloseReason
  label: string
  description: string
  icon: React.JSX.Element
}

export const CLOSE_ISSUE_REASONS: CloseIssueReasonOption[] = [
  {
    reason: 'completed',
    label: translate(
      'auto.components.github.githubIssueCloseReasons.completed.label',
      'Close as completed'
    ),
    description: translate(
      'auto.components.github.githubIssueCloseReasons.completed.description',
      'Done, closed, fixed, resolved'
    ),
    icon: <CheckCircle2 className="size-4 text-violet-500" />
  },
  {
    reason: 'not_planned',
    label: translate(
      'auto.components.github.githubIssueCloseReasons.notPlanned.label',
      'Close as not planned'
    ),
    description: translate(
      'auto.components.github.githubIssueCloseReasons.notPlanned.description',
      "Won't fix, can't repro, stale"
    ),
    icon: <Ban className="size-4 text-muted-foreground" />
  },
  {
    reason: 'duplicate',
    label: translate(
      'auto.components.github.githubIssueCloseReasons.duplicate.label',
      'Close as duplicate'
    ),
    description: translate(
      'auto.components.github.githubIssueCloseReasons.duplicate.description',
      'Duplicate of another issue'
    ),
    icon: <Copy className="size-4 text-muted-foreground" />
  }
]
