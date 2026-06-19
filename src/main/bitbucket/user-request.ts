import { authHeaders, type BitbucketAuthConfig } from './bitbucket-auth-config'

const USER_REQUEST_TIMEOUT_MS = 4000

type RawBitbucketUser = {
  username?: string | null
  display_name?: string | null
  account_id?: string | null
}

export function accountNameFromUser(user: RawBitbucketUser | null): string | null {
  return user?.username ?? user?.display_name ?? user?.account_id ?? null
}

// Validates a credential set against the Bitbucket `/user` endpoint. Returns the
// raw user on success, null on any failure (bad creds, network, timeout). Used
// both for live env-var status and for verifying candidate creds before saving.
export async function fetchBitbucketUser(
  config: BitbucketAuthConfig,
  timeoutMs: number = USER_REQUEST_TIMEOUT_MS
): Promise<RawBitbucketUser | null> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const base = config.baseUrl.replace(/\/+$/, '')
    const response = await fetch(`${base}/user`, {
      headers: {
        Accept: 'application/json',
        ...authHeaders(config)
      },
      signal: controller.signal
    })
    if (!response.ok) {
      return null
    }
    return (await response.json()) as RawBitbucketUser
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}
