import type { CheckStatus } from '../../shared/types'
import {
  deriveBitbucketBuildStatus,
  mapBitbucketPullRequest,
  type BitbucketPullRequestInfo,
  type RawBitbucketBuildStatus,
  type RawBitbucketPullRequest
} from './pull-request-mappers'
import { getBitbucketRepoRef, type BitbucketRepoRef } from './repository-ref'
import {
  getHostedReviewLocalGitOptions,
  type HostedReviewExecutionOptions
} from '../source-control/hosted-review-git-options'
import {
  authHeaders,
  envValue,
  getEnvAuthConfig,
  hasAuth,
  DEFAULT_API_BASE_URL,
  type BitbucketAuthConfig
} from './bitbucket-auth-config'
import {
  getStoredBitbucketMetadata,
  hasStoredBitbucketCredential,
  loadStoredBitbucketSecret
} from './credential-store'
import { accountNameFromUser, fetchBitbucketUser } from './user-request'

const REQUEST_TIMEOUT_MS = 5000
const ALL_PULL_REQUEST_STATES = ['OPEN', 'MERGED', 'DECLINED', 'SUPERSEDED'] as const

export type BitbucketAuthStatus = {
  configured: boolean
  authenticated: boolean
  account: string | null
}

type RequestOptions = {
  searchParams?: Record<string, string | readonly string[]>
  timeoutMs?: number
}

// Resolves the auth used for API requests. Env vars take precedence (honored for
// headless/SSH setups); the in-app encrypted credential fills in when env is
// absent. The stored secret is decrypted lazily and cached by credential-store.
function resolveRequestAuth(): BitbucketAuthConfig | null {
  const env = getEnvAuthConfig()
  if (hasAuth(env)) {
    return env
  }
  if (!hasStoredBitbucketCredential()) {
    return null
  }
  let secret
  try {
    secret = loadStoredBitbucketSecret({ force: true })
  } catch {
    // Decryption failed (e.g. keychain denied) — treat as unauthenticated.
    return null
  }
  if (!secret) {
    return null
  }
  const metadata = getStoredBitbucketMetadata()
  const config: BitbucketAuthConfig = {
    baseUrl: envValue('ORCA_BITBUCKET_API_BASE_URL') ?? metadata?.baseUrl ?? DEFAULT_API_BASE_URL,
    accessToken: secret.accessToken,
    email: metadata?.email ?? null,
    apiToken: secret.apiToken
  }
  return hasAuth(config) ? config : null
}

function isStringArray(value: string | readonly string[]): value is readonly string[] {
  return Array.isArray(value)
}

function apiUrl(
  baseUrl: string,
  path: string,
  searchParams?: RequestOptions['searchParams']
): string {
  const base = baseUrl.replace(/\/+$/, '')
  const url = new URL(`${base}${path}`)
  if (searchParams) {
    for (const [key, value] of Object.entries(searchParams)) {
      if (isStringArray(value)) {
        for (const item of value) {
          url.searchParams.append(key, item)
        }
      } else {
        url.searchParams.set(key, value)
      }
    }
  }
  return url.toString()
}

async function requestJson<T>(path: string, options: RequestOptions = {}): Promise<T | null> {
  const auth = resolveRequestAuth()
  if (!auth) {
    return null
  }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(apiUrl(auth.baseUrl, path, options.searchParams), {
      headers: {
        Accept: 'application/json',
        ...authHeaders(auth)
      },
      signal: controller.signal
    })
    if (!response.ok) {
      return null
    }
    return (await response.json()) as T
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}

function encodedRepoPath(repo: BitbucketRepoRef): string {
  return `${encodeURIComponent(repo.workspace)}/${encodeURIComponent(repo.repoSlug)}`
}

function escapeBitbucketQueryString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function allStateFilter(): string {
  return `(${ALL_PULL_REQUEST_STATES.map((state) => `state = "${state}"`).join(' OR ')})`
}

async function getBuildStatus(
  repo: BitbucketRepoRef,
  headSha: string | undefined
): Promise<CheckStatus> {
  if (!headSha) {
    return 'neutral'
  }
  const data = await requestJson<{ values?: RawBitbucketBuildStatus[] }>(
    `/repositories/${encodedRepoPath(repo)}/commit/${encodeURIComponent(headSha)}/statuses/build`,
    { searchParams: { pagelen: '100' } }
  )
  return deriveBitbucketBuildStatus(data?.values ?? [])
}

async function normalizePullRequest(
  repo: BitbucketRepoRef,
  raw: RawBitbucketPullRequest
): Promise<BitbucketPullRequestInfo | null> {
  const headSha = raw.source?.commit?.hash?.trim()
  const status = await getBuildStatus(repo, headSha)
  return mapBitbucketPullRequest(raw, status)
}

export async function getBitbucketAuthStatus(): Promise<BitbucketAuthStatus> {
  const env = getEnvAuthConfig()
  if (hasAuth(env)) {
    const user = await fetchBitbucketUser(env)
    return { configured: true, authenticated: user !== null, account: accountNameFromUser(user) }
  }
  if (hasStoredBitbucketCredential()) {
    // Why: trust the validation performed when the user connected; reading the
    // secret here would decrypt (risking a keychain prompt) on every preflight.
    return {
      configured: true,
      authenticated: true,
      account: getStoredBitbucketMetadata()?.account ?? null
    }
  }
  return { configured: false, authenticated: false, account: null }
}

export async function getBitbucketPullRequest(
  repoPath: string,
  prNumber: number,
  connectionId?: string | null,
  options: HostedReviewExecutionOptions = {}
): Promise<BitbucketPullRequestInfo | null> {
  const repo = await getBitbucketRepoRef(
    repoPath,
    connectionId,
    getHostedReviewLocalGitOptions(options)
  )
  if (!repo) {
    return null
  }
  const raw = await requestJson<RawBitbucketPullRequest>(
    `/repositories/${encodedRepoPath(repo)}/pullrequests/${encodeURIComponent(String(prNumber))}`
  )
  return raw ? normalizePullRequest(repo, raw) : null
}

export async function getBitbucketPullRequestForBranch(
  repoPath: string,
  branch: string,
  linkedPRNumber?: number | null,
  connectionId?: string | null,
  options: HostedReviewExecutionOptions = {}
): Promise<BitbucketPullRequestInfo | null> {
  const branchName = branch.replace(/^refs\/heads\//, '')
  if (!branchName && linkedPRNumber == null) {
    return null
  }

  const repo = await getBitbucketRepoRef(
    repoPath,
    connectionId,
    getHostedReviewLocalGitOptions(options)
  )
  if (!repo) {
    return null
  }

  if (branchName) {
    const query = [
      `source.branch.name = "${escapeBitbucketQueryString(branchName)}"`,
      allStateFilter()
    ].join(' AND ')
    const list = await requestJson<{ values?: RawBitbucketPullRequest[] }>(
      `/repositories/${encodedRepoPath(repo)}/pullrequests`,
      {
        searchParams: {
          pagelen: '1',
          sort: '-updated_on',
          q: query,
          state: ALL_PULL_REQUEST_STATES
        }
      }
    )
    const raw = list?.values?.[0]
    if (raw) {
      return normalizePullRequest(repo, raw)
    }
  }

  if (typeof linkedPRNumber !== 'number') {
    return null
  }
  const raw = await requestJson<RawBitbucketPullRequest>(
    `/repositories/${encodedRepoPath(repo)}/pullrequests/${encodeURIComponent(String(linkedPRNumber))}`
  )
  return raw ? normalizePullRequest(repo, raw) : null
}

export async function getBitbucketRepoSlug(
  repoPath: string,
  connectionId?: string | null,
  options: HostedReviewExecutionOptions = {}
): Promise<BitbucketRepoRef | null> {
  return getBitbucketRepoRef(repoPath, connectionId, getHostedReviewLocalGitOptions(options))
}
