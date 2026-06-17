import {
  isAgentForegroundWrapperProcess,
  isExpectedAgentProcess,
  recognizeAgentProcessFromCommandLine
} from '../../shared/agent-process-recognition'
import { isShellProcess } from '../../shared/shell-process-detection'
import {
  queryWindowsProcessDescendants,
  type WindowsProcessCandidate,
  type WindowsProcessRow
} from './windows-foreground-process-rows'

export type AgentForegroundResolutionOptions = {
  contextPaths?: readonly string[]
}

// Why: a bare shell foreground reaches this resolver on every visible-pane
// completion poll (~2s) via LocalPtyProvider and the SSH relay, neither of
// which throttles like the daemon's SHELL_FOREGROUND_REFRESH_RETRY_MS. Each
// miss spawns a full Win32_Process enumeration (powershell.exe Get-CimInstance,
// up to 3s). Serve shell results from a short per-pid cache so an idle shell
// does not churn the process table on every poll. Wrapper enrichment keeps its
// pre-existing per-call behavior — only the shell path is gated here.
const SHELL_FOREGROUND_RESULT_CACHE_TTL_MS = 5_000
const SHELL_FOREGROUND_RESULT_CACHE_MAX_ENTRIES = 256
type ShellForegroundResult = { result: string | null; resolvedAt: number }
const shellForegroundResultCache = new Map<number, ShellForegroundResult>()

/** Test-only: drop the per-pid shell foreground cache so cases that reuse a
 *  shell pid do not observe a previous case's cached result. */
export function __clearWindowsShellForegroundResultCache(): void {
  shellForegroundResultCache.clear()
}

export function shouldInspectWindowsAgentForeground(fallbackProcess: string): boolean {
  return isAgentForegroundWrapperProcess(fallbackProcess) || isShellProcess(fallbackProcess)
}

export async function resolveWindowsAgentForegroundProcess(
  shellPid: number,
  fallbackProcess: string,
  options: AgentForegroundResolutionOptions
): Promise<string | null> {
  if (isShellProcess(fallbackProcess)) {
    return resolveWindowsShellAgentForeground(shellPid, options.contextPaths)
  }
  const candidates = await queryWindowsProcessDescendants(shellPid)
  if (!candidates) {
    return null
  }
  const wrapperCandidates = candidates.filter((candidate) =>
    windowsCandidateMatchesFallbackWrapper(candidate, fallbackProcess)
  )
  if (wrapperCandidates.length !== 1) {
    return resolveWrapperForegroundProcessFromWindowsCandidates(
      wrapperCandidates,
      options.contextPaths
    )
  }
  const [candidate] = wrapperCandidates
  const recognized =
    recognizeAgentProcessFromCommandLine(candidate.command) ??
    recognizeAgentProcessFromCommandLine(candidate.name)
  if (recognized) {
    return recognized.processName
  }
  return null
}

async function resolveWindowsShellAgentForeground(
  shellPid: number,
  contextPaths: readonly string[] | undefined
): Promise<string | null> {
  const now = Date.now()
  const cached = shellForegroundResultCache.get(shellPid)
  if (cached && now - cached.resolvedAt < SHELL_FOREGROUND_RESULT_CACHE_TTL_MS) {
    return cached.result
  }
  const candidates = await queryWindowsProcessDescendants(shellPid)
  if (!candidates) {
    // Why: a probe failure is transient (enumeration disabled, timeout). Do not
    // cache it — fall through to the caller's fallback and retry next poll.
    return null
  }
  const result = resolveShellForegroundProcessFromWindowsCandidates(candidates, contextPaths)
  if (shellForegroundResultCache.size >= SHELL_FOREGROUND_RESULT_CACHE_MAX_ENTRIES) {
    shellForegroundResultCache.clear()
  }
  shellForegroundResultCache.set(shellPid, { result, resolvedAt: Date.now() })
  return result
}

function resolveShellForegroundProcessFromWindowsCandidates(
  candidates: readonly WindowsProcessCandidate[],
  contextPaths: readonly string[] | undefined
): string | null {
  const recognizedCandidates = createRecognizedWindowsProcessCandidates(candidates, contextPaths)
  const contextCandidates = recognizedCandidates.filter((candidate) => candidate.contextMatch)
  if (contextCandidates.length > 0) {
    return resolveRecognizedWindowsProcessCandidates(contextCandidates, candidates)
  }
  return resolveRecognizedWindowsProcessCandidates(recognizedCandidates, candidates)
}

function resolveWrapperForegroundProcessFromWindowsCandidates(
  candidates: readonly WindowsProcessCandidate[],
  contextPaths: readonly string[] | undefined
): string | null {
  const contextCandidates = createRecognizedWindowsProcessCandidates(
    candidates,
    contextPaths
  ).filter((candidate) => candidate.contextMatch)
  return contextCandidates.length > 0
    ? resolveRecognizedWindowsProcessCandidates(contextCandidates, candidates)
    : null
}

type RecognizedWindowsProcessCandidate = WindowsProcessRow & {
  contextMatch: boolean
  depth: number
  processName: string
}

function createRecognizedWindowsProcessCandidates(
  candidates: readonly WindowsProcessCandidate[],
  contextPaths: readonly string[] | undefined
): RecognizedWindowsProcessCandidate[] {
  const normalizedContextPaths = normalizeContextPaths(contextPaths)
  return candidates.flatMap((candidate) => {
    const recognized = recognizeWindowsProcessCandidate(candidate)
    if (!recognized) {
      return []
    }
    return [
      {
        ...candidate,
        contextMatch: candidateMatchesContextPath(candidate, normalizedContextPaths),
        processName: recognized
      }
    ]
  })
}

function resolveRecognizedWindowsProcessCandidates(
  recognizedCandidates: readonly RecognizedWindowsProcessCandidate[],
  allCandidates: readonly WindowsProcessCandidate[]
): string | null {
  if (recognizedCandidates.length === 0) {
    return null
  }
  const recognizedProcessNames = new Set(
    recognizedCandidates.map((candidate) => candidate.processName)
  )
  if (recognizedProcessNames.size === 1) {
    return [...recognizedProcessNames][0]
  }

  const candidatesByPid = new Map(allCandidates.map((candidate) => [candidate.pid, candidate]))
  const leafCandidates = recognizedCandidates.filter(
    (candidate) =>
      !recognizedCandidates.some(
        (other) =>
          other.pid !== candidate.pid &&
          windowsCandidateIsAncestor(candidate, other, candidatesByPid)
      )
  )
  const leafProcessNames = new Set(leafCandidates.map((candidate) => candidate.processName))
  // Why: Windows lacks a cheap PTY foreground marker like POSIX '+'. A single
  // recognized lineage leaf is strong enough; sibling agent leaves are not.
  return leafProcessNames.size === 1 ? [...leafProcessNames][0] : null
}

function windowsCandidateIsAncestor(
  candidate: WindowsProcessRow,
  other: WindowsProcessRow,
  candidatesByPid: ReadonlyMap<number, WindowsProcessRow>
): boolean {
  let current = candidatesByPid.get(other.ppid)
  while (current) {
    if (current.pid === candidate.pid) {
      return true
    }
    current = candidatesByPid.get(current.ppid)
  }
  return false
}

function normalizeContextPaths(contextPaths: readonly string[] | undefined): string[] {
  const normalized = new Set<string>()
  for (const contextPath of contextPaths ?? []) {
    const candidate = normalizePathForCommandMatch(contextPath)
    if (isSafeContextPath(candidate)) {
      normalized.add(candidate)
    }
  }
  return [...normalized].sort((a, b) => b.length - a.length)
}

function isSafeContextPath(contextPath: string): boolean {
  return contextPath.length >= 4 && (/^[a-z]:\//.test(contextPath) || contextPath.startsWith('//'))
}

function candidateMatchesContextPath(
  candidate: WindowsProcessRow,
  normalizedContextPaths: readonly string[]
): boolean {
  if (normalizedContextPaths.length === 0) {
    return false
  }
  const haystack = normalizePathForCommandMatch(
    [candidate.command, candidate.executablePath].filter(Boolean).join('\n')
  )
  return normalizedContextPaths.some((contextPath) =>
    commandLineContainsPath(haystack, contextPath)
  )
}

function normalizePathForCommandMatch(value: string): string {
  return value
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/\\/g, '/')
    .replace(/\/+$/g, '')
    .toLowerCase()
}

function commandLineContainsPath(haystack: string, contextPath: string): boolean {
  let index = haystack.indexOf(contextPath)
  while (index !== -1) {
    const before = index > 0 ? haystack[index - 1] : ''
    const after = haystack[index + contextPath.length] ?? ''
    const beforeOk = !before || /[\s"'(=]/.test(before)
    const afterOk = !after || after === '/' || /[\s"'),;]/.test(after)
    if (beforeOk && afterOk) {
      return true
    }
    index = haystack.indexOf(contextPath, index + 1)
  }
  return false
}

function recognizeWindowsProcessCandidate(candidate: WindowsProcessRow): string | null {
  const recognized =
    recognizeAgentProcessFromCommandLine(candidate.command) ??
    recognizeAgentProcessFromCommandLine(candidate.name)
  return recognized?.processName ?? null
}

function windowsCandidateMatchesFallbackWrapper(
  candidate: WindowsProcessRow,
  fallbackProcess: string
): boolean {
  const commandToken = candidate.command.trim().split(/\s+/, 1)[0] ?? ''
  return (
    isExpectedAgentProcess(candidate.name, fallbackProcess) ||
    isExpectedAgentProcess(commandToken, fallbackProcess)
  )
}
