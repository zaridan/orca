import React from 'react'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import type { HostedReviewState } from '../../../../shared/hosted-review'

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
// open = green, closed = red, draft = gray). The user asked for GitHub styling, so
// these mirror GitHub's solid state-badge colors rather than Orca's neutral tokens
// (the same exception the git-decoration palette makes for VS Code parity).
const PR_STATE_PILL_CLASS: Record<HostedReviewState, string> = {
  merged: 'bg-[#8250df] text-white',
  open: 'bg-[#1a7f37] text-white',
  closed: 'bg-[#cf222e] text-white',
  draft: 'bg-[#6e7781] text-white'
}

export function PrStatePill({ state }: { state: HostedReviewState }): React.JSX.Element {
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
