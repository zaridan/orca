import {
  DEFAULT_API_BASE_URL,
  envValue,
  getEnvAuthConfig,
  hasAuth,
  type BitbucketAuthConfig
} from './bitbucket-auth-config'
import { accountNameFromUser, fetchBitbucketUser } from './user-request'
import {
  clearStoredBitbucketCredential,
  getStoredBitbucketMetadata,
  hasStoredBitbucketCredential,
  saveBitbucketCredential,
  type BitbucketAuthMode
} from './credential-store'

const VERIFY_TIMEOUT_MS = 6000

export type BitbucketConnectInput = {
  authMode: BitbucketAuthMode
  accessToken?: string | null
  email?: string | null
  apiToken?: string | null
  baseUrl?: string | null
}

export type BitbucketConnectResult =
  | { ok: true; account: string | null }
  | { ok: false; error: string }

// Where the active credentials come from: an env var override, the in-app
// encrypted store, or nothing configured. Drives whether the UI offers
// Disconnect (only meaningful for in-app `stored` credentials).
export type BitbucketCredentialSource = 'environment' | 'stored' | 'none'

export type BitbucketConnectionStatus = {
  configured: boolean
  source: BitbucketCredentialSource
  account: string | null
  authMode: BitbucketAuthMode | null
  email: string | null
  baseUrl: string | null
}

function normalize(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? ''
  return trimmed.length > 0 ? trimmed : null
}

function buildCandidateConfig(input: BitbucketConnectInput): BitbucketAuthConfig {
  return {
    baseUrl: normalize(input.baseUrl) ?? DEFAULT_API_BASE_URL,
    accessToken: input.authMode === 'token' ? normalize(input.accessToken) : null,
    email: input.authMode === 'basic' ? normalize(input.email) : null,
    apiToken: input.authMode === 'basic' ? normalize(input.apiToken) : null
  }
}

// Verifies candidate credentials against `/user`, then persists them. Validating
// before saving keeps the stored "connected account" honest and lets the UI
// report failures inline instead of silently storing a dead token.
export async function connectBitbucket(
  input: BitbucketConnectInput
): Promise<BitbucketConnectResult> {
  const config = buildCandidateConfig(input)
  if (!hasAuth(config)) {
    return {
      ok: false,
      error:
        input.authMode === 'token'
          ? 'Enter an access token.'
          : 'Enter both an email and an API token.'
    }
  }
  const user = await fetchBitbucketUser(config, VERIFY_TIMEOUT_MS)
  if (!user) {
    return {
      ok: false,
      error: 'Could not authenticate with Bitbucket. Check the credentials and try again.'
    }
  }
  const account = accountNameFromUser(user)
  saveBitbucketCredential({
    authMode: input.authMode,
    email: config.email,
    baseUrl: normalize(input.baseUrl),
    account,
    accessToken: config.accessToken,
    apiToken: config.apiToken
  })
  return { ok: true, account }
}

export function disconnectBitbucket(): void {
  clearStoredBitbucketCredential()
}

// Lightweight status for the Settings card/dialog. Reads env vars and plaintext
// metadata only — never decrypts — so it is safe to call on every Settings open.
export function getBitbucketConnectionStatus(): BitbucketConnectionStatus {
  const env = getEnvAuthConfig()
  if (hasAuth(env)) {
    return {
      configured: true,
      source: 'environment',
      account: null,
      authMode: env.accessToken ? 'token' : 'basic',
      email: env.email,
      baseUrl: envValue('ORCA_BITBUCKET_API_BASE_URL')
    }
  }
  if (hasStoredBitbucketCredential()) {
    const metadata = getStoredBitbucketMetadata()
    return {
      configured: true,
      source: 'stored',
      account: metadata?.account ?? null,
      authMode: metadata?.authMode ?? null,
      email: metadata?.email ?? null,
      baseUrl: metadata?.baseUrl ?? null
    }
  }
  return {
    configured: false,
    source: 'none',
    account: null,
    authMode: null,
    email: null,
    baseUrl: null
  }
}
