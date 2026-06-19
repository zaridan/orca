import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import {
  CredentialDecryptionError,
  credentialFileHasContent,
  readStoredCredentialToken,
  writeEncryptedCredential
} from '../integration-credential-file'

// Why: the API token / access token stays encrypted via safeStorage, while
// non-secret metadata (auth mode, email, base URL, resolved account) stays
// plaintext so status checks render the connected account without decrypting
// and triggering an OS keychain prompt every time Settings opens.
export type BitbucketAuthMode = 'token' | 'basic'

export type BitbucketStoredMetadata = {
  version: 1
  authMode: BitbucketAuthMode
  email: string | null
  baseUrl: string | null
  account: string | null
  updatedAt: string
}

export type BitbucketStoredSecret = {
  accessToken: string | null
  apiToken: string | null
}

export type BitbucketCredentialSaveInput = {
  authMode: BitbucketAuthMode
  email: string | null
  baseUrl: string | null
  account: string | null
  accessToken: string | null
  apiToken: string | null
}

let cachedMetadata: BitbucketStoredMetadata | null = null
let metadataLoadedFromDisk = false
let cachedSecret: BitbucketStoredSecret | null = null
let credentialError: string | null = null

function getOrcaDir(): string {
  return join(homedir(), '.orca')
}

function getMetadataPath(): string {
  return join(getOrcaDir(), 'bitbucket-credential.json')
}

function getSecretPath(): string {
  return join(getOrcaDir(), 'bitbucket-credential.enc')
}

function ensureOrcaDir(): void {
  const dir = getOrcaDir()
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

function readMetadataFromDisk(): BitbucketStoredMetadata | null {
  const path = getMetadataPath()
  if (!existsSync(path)) {
    return null
  }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as Partial<BitbucketStoredMetadata>
    if (parsed.authMode !== 'token' && parsed.authMode !== 'basic') {
      return null
    }
    return {
      version: 1,
      authMode: parsed.authMode,
      email: parsed.email ?? null,
      baseUrl: parsed.baseUrl ?? null,
      account: parsed.account ?? null,
      updatedAt: parsed.updatedAt ?? ''
    }
  } catch {
    return null
  }
}

export function getStoredBitbucketMetadata(): BitbucketStoredMetadata | null {
  if (!metadataLoadedFromDisk) {
    cachedMetadata = readMetadataFromDisk()
    metadataLoadedFromDisk = true
  }
  return cachedMetadata
}

// Cheap "is a credential saved?" check: metadata present and the secret file is
// non-empty. Never decrypts, so it is safe on every status poll.
export function hasStoredBitbucketCredential(): boolean {
  return getStoredBitbucketMetadata() !== null && credentialFileHasContent(getSecretPath())
}

export function getStoredBitbucketCredentialError(): string | null {
  return credentialError
}

// Returns the decrypted secret. Cache-first; only touches the keychain when the
// secret is not already in memory (mirrors Linear's `loadToken({ force })`).
// Throws CredentialDecryptionError when ciphertext cannot be decrypted.
export function loadStoredBitbucketSecret(
  options: { force?: boolean } = {}
): BitbucketStoredSecret | null {
  if (cachedSecret !== null) {
    return cachedSecret
  }
  if (!options.force) {
    return null
  }
  const path = getSecretPath()
  if (!existsSync(path)) {
    return null
  }
  try {
    const token = readStoredCredentialToken('Bitbucket', readFileSync(path))
    if (!token) {
      return null
    }
    const parsed = JSON.parse(token) as Partial<BitbucketStoredSecret>
    cachedSecret = {
      accessToken: parsed.accessToken ?? null,
      apiToken: parsed.apiToken ?? null
    }
    credentialError = null
    return cachedSecret
  } catch (error) {
    if (error instanceof CredentialDecryptionError) {
      credentialError = error.message
      throw error
    }
    return null
  }
}

export function saveBitbucketCredential(input: BitbucketCredentialSaveInput): void {
  ensureOrcaDir()
  const secret: BitbucketStoredSecret = {
    accessToken: input.accessToken,
    apiToken: input.apiToken
  }
  writeEncryptedCredential('Bitbucket', getSecretPath(), JSON.stringify(secret))
  const metadata: BitbucketStoredMetadata = {
    version: 1,
    authMode: input.authMode,
    email: input.email,
    baseUrl: input.baseUrl,
    account: input.account,
    updatedAt: new Date().toISOString()
  }
  writeFileSync(getMetadataPath(), JSON.stringify(metadata, null, 2), {
    encoding: 'utf-8',
    mode: 0o600
  })
  cachedMetadata = metadata
  metadataLoadedFromDisk = true
  cachedSecret = secret
  credentialError = null
}

export function clearStoredBitbucketCredential(): void {
  for (const path of [getSecretPath(), getMetadataPath()]) {
    try {
      unlinkSync(path)
    } catch {
      // File may not exist — safe to ignore.
    }
  }
  cachedMetadata = null
  metadataLoadedFromDisk = true
  cachedSecret = null
  credentialError = null
}

/** @internal - tests need a clean in-memory cache between cases. */
export function _resetBitbucketCredentialCache(): void {
  cachedMetadata = null
  metadataLoadedFromDisk = false
  cachedSecret = null
  credentialError = null
}
