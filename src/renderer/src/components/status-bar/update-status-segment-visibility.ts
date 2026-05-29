import type { UpdateStatus } from '../../../../shared/types'

export function shouldShowUpdateStatusSegment(
  status: UpdateStatus,
  downloadIntentVersion: string | null
): boolean {
  const isUserInitiated = 'userInitiated' in status && Boolean(status.userInitiated)
  const isNudgeDriven = 'activeNudgeId' in status && Boolean(status.activeNudgeId)
  const matchesExplicitDownload =
    'version' in status &&
    downloadIntentVersion !== null &&
    status.version === downloadIntentVersion

  if (status.state === 'downloading' || status.state === 'downloaded') {
    return isUserInitiated || isNudgeDriven || matchesExplicitDownload
  }
  if (status.state === 'error') {
    return isUserInitiated || isNudgeDriven || downloadIntentVersion !== null
  }
  return false
}
