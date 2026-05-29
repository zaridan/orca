import { parseGitHubIssueOrPRLink } from './github-links'
import { parseGitLabIssueOrMRLink } from './gitlab-links'

export function isSmartWorkspaceLinearSourceIntent(input: string): boolean {
  return /^[A-Z][A-Z0-9_]*-\d+$/.test(input.trim())
}

export function isSmartWorkspaceSourceIntent(
  input: string,
  options?: { linearEnabled?: boolean }
): boolean {
  const trimmed = input.trim()
  if (!trimmed) {
    return false
  }
  if (parseGitHubIssueOrPRLink(trimmed) || /^#\d+$/.test(trimmed)) {
    return true
  }
  if (parseGitLabIssueOrMRLink(trimmed)) {
    return true
  }
  if (options?.linearEnabled === false) {
    return false
  }
  return isSmartWorkspaceLinearSourceIntent(trimmed)
}

export function getManualWorkspaceNameFromSmartInput(args: {
  name: string
  smartSourceQuery: string
  linearEnabled?: boolean
}): string {
  const query = args.smartSourceQuery.trim()
  if (query && !isSmartWorkspaceSourceIntent(query, args)) {
    return query
  }
  return args.name.trim()
}
