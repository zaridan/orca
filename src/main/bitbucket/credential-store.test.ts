import { existsSync, mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import type * as Os from 'os'
import { join } from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

let tempHome = ''
const decryptStringMock = vi.fn((value: Buffer) => value.toString('utf-8'))

async function loadStore() {
  vi.resetModules()
  vi.doMock('electron', () => ({
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (value: string) => Buffer.from(value),
      decryptString: decryptStringMock
    }
  }))
  vi.doMock('os', async () => {
    const actual = await vi.importActual<typeof Os>('os')
    return { ...actual, homedir: () => tempHome }
  })
  return import('./credential-store')
}

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), 'orca-bitbucket-store-'))
  decryptStringMock.mockClear()
})

describe('Bitbucket credential store', () => {
  it('persists plaintext metadata and an encrypted secret, then reads them back', async () => {
    const store = await loadStore()
    store.saveBitbucketCredential({
      authMode: 'basic',
      email: 'ada@example.com',
      baseUrl: null,
      account: 'ada',
      accessToken: null,
      apiToken: 'secret-token'
    })

    expect(store.hasStoredBitbucketCredential()).toBe(true)
    expect(store.getStoredBitbucketMetadata()).toMatchObject({
      authMode: 'basic',
      email: 'ada@example.com',
      account: 'ada'
    })
    expect(store.loadStoredBitbucketSecret()).toEqual({
      accessToken: null,
      apiToken: 'secret-token'
    })
  })

  it('does not decrypt for metadata/status reads — only on a forced secret load', async () => {
    const store = await loadStore()
    store.saveBitbucketCredential({
      authMode: 'token',
      email: null,
      baseUrl: 'https://api.bitbucket.org/2.0',
      account: 'dev',
      accessToken: 'access-secret',
      apiToken: null
    })

    // Simulate a fresh session: caches cleared, files still on disk.
    store._resetBitbucketCredentialCache()

    // Reading metadata + presence must not touch the keychain.
    expect(store.getStoredBitbucketMetadata()?.account).toBe('dev')
    expect(store.hasStoredBitbucketCredential()).toBe(true)
    expect(decryptStringMock).not.toHaveBeenCalled()

    // Without force, the secret stays unread.
    expect(store.loadStoredBitbucketSecret()).toBeNull()
    expect(decryptStringMock).not.toHaveBeenCalled()

    // Forcing the load decrypts exactly once, then caches.
    expect(store.loadStoredBitbucketSecret({ force: true })).toEqual({
      accessToken: 'access-secret',
      apiToken: null
    })
    expect(decryptStringMock).toHaveBeenCalledTimes(1)
    expect(store.loadStoredBitbucketSecret()).not.toBeNull()
    expect(decryptStringMock).toHaveBeenCalledTimes(1)
  })

  it('clears both files and in-memory state on disconnect', async () => {
    const store = await loadStore()
    store.saveBitbucketCredential({
      authMode: 'basic',
      email: 'ada@example.com',
      baseUrl: null,
      account: 'ada',
      accessToken: null,
      apiToken: 'secret-token'
    })

    store.clearStoredBitbucketCredential()

    expect(store.hasStoredBitbucketCredential()).toBe(false)
    expect(store.getStoredBitbucketMetadata()).toBeNull()
    expect(existsSync(join(tempHome, '.orca', 'bitbucket-credential.enc'))).toBe(false)
    expect(existsSync(join(tempHome, '.orca', 'bitbucket-credential.json'))).toBe(false)
  })
})
