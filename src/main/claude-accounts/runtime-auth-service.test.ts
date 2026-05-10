import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getDefaultSettings } from '../../shared/constants'
import type { ClaudeManagedAccount, GlobalSettings } from '../../shared/types'

const testState = {
  userDataDir: '',
  fakeHomeDir: '',
  activeKeychainCredentials: null as string | null,
  managedKeychainCredentials: new Map<string, string>()
}

vi.mock('electron', () => ({
  app: {
    getPath: () => testState.userDataDir
  }
}))

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os') // eslint-disable-line @typescript-eslint/consistent-type-imports -- vi.importActual requires inline import()
  return {
    ...actual,
    homedir: () => testState.fakeHomeDir
  }
})

vi.mock('./keychain', () => ({
  readActiveClaudeKeychainCredentials: vi.fn(async () => testState.activeKeychainCredentials),
  writeActiveClaudeKeychainCredentials: vi.fn(async (contents: string) => {
    testState.activeKeychainCredentials = contents
  }),
  deleteActiveClaudeKeychainCredentials: vi.fn(async () => {
    testState.activeKeychainCredentials = null
  }),
  readManagedClaudeKeychainCredentials: vi.fn(
    async (accountId: string) => testState.managedKeychainCredentials.get(accountId) ?? null
  ),
  writeManagedClaudeKeychainCredentials: vi.fn(async (accountId: string, contents: string) => {
    testState.managedKeychainCredentials.set(accountId, contents)
  })
}))

function createSettings(overrides: Partial<GlobalSettings> = {}): GlobalSettings {
  return {
    ...getDefaultSettings(testState.fakeHomeDir),
    ...overrides
  }
}

function createStore(settings: GlobalSettings) {
  return {
    getSettings: vi.fn(() => settings),
    updateSettings: vi.fn((updates: Partial<GlobalSettings>) => {
      settings = {
        ...settings,
        ...updates,
        notifications: {
          ...settings.notifications,
          ...updates.notifications
        }
      }
      return settings
    })
  }
}

function createManagedClaudeAuth(
  rootDir: string,
  accountId: string,
  credentialsJson: string
): string {
  const managedAuthPath = join(rootDir, 'claude-accounts', accountId, 'auth')
  mkdirSync(managedAuthPath, { recursive: true })
  writeFileSync(join(managedAuthPath, '.credentials.json'), credentialsJson, 'utf-8')
  writeFileSync(join(managedAuthPath, 'oauth-account.json'), `{"accountUuid":"${accountId}"}\n`)
  testState.managedKeychainCredentials.set(accountId, credentialsJson)
  return managedAuthPath
}

function createClaudeAccount(id: string, managedAuthPath: string): ClaudeManagedAccount {
  return {
    id,
    email: 'user@example.com',
    managedAuthPath,
    authMethod: 'subscription-oauth',
    organizationUuid: null,
    organizationName: null,
    createdAt: 1,
    updatedAt: 1,
    lastAuthenticatedAt: 1
  }
}

function createClaudeCredentialsJson(email: string, accessToken: string): string {
  return `${JSON.stringify({
    claudeAiOauth: {
      email,
      accessToken,
      refreshToken: `${accessToken}-refresh`,
      expiresAt: Date.now() + 60_000
    }
  })}\n`
}

function readManagedCredentialsForTest(accountId: string, managedAuthPath: string): string | null {
  if (process.platform === 'darwin') {
    return testState.managedKeychainCredentials.get(accountId) ?? null
  }
  return readFileSync(join(managedAuthPath, '.credentials.json'), 'utf-8')
}

describe('ClaudeRuntimeAuthService', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    testState.activeKeychainCredentials = null
    testState.managedKeychainCredentials.clear()
    testState.userDataDir = mkdtempSync(join(tmpdir(), 'orca-claude-runtime-'))
    testState.fakeHomeDir = mkdtempSync(join(tmpdir(), 'orca-claude-home-'))
    mkdirSync(join(testState.fakeHomeDir, '.claude'), { recursive: true })
  })

  afterEach(() => {
    rmSync(testState.userDataDir, { recursive: true, force: true })
    rmSync(testState.fakeHomeDir, { recursive: true, force: true })
  })

  it('rematerializes unchanged managed credentials when the runtime file is missing', async () => {
    const runtimeCredentialsPath = join(testState.fakeHomeDir, '.claude', '.credentials.json')
    const managedAuthPath = createManagedClaudeAuth(
      testState.userDataDir,
      'account-1',
      '{"token":"managed"}\n'
    )
    const settings = createSettings({
      claudeManagedAccounts: [createClaudeAccount('account-1', managedAuthPath)],
      activeClaudeManagedAccountId: 'account-1'
    })
    const store = createStore(settings)

    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const service = new ClaudeRuntimeAuthService(store as never)
    await service.syncForCurrentSelection()

    expect(readFileSync(runtimeCredentialsPath, 'utf-8')).toBe('{"token":"managed"}\n')

    rmSync(runtimeCredentialsPath, { force: true })
    await service.prepareForClaudeLaunch()

    expect(readFileSync(runtimeCredentialsPath, 'utf-8')).toBe('{"token":"managed"}\n')
  })

  it('falls back to atomic write when the unchanged check cannot read the target', async () => {
    if (process.platform === 'win32') {
      return
    }

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const runtimeCredentialsPath = join(testState.fakeHomeDir, '.claude', '.credentials.json')
    const managedAuthPath = createManagedClaudeAuth(
      testState.userDataDir,
      'account-1',
      '{"token":"managed"}\n'
    )
    const settings = createSettings({
      claudeManagedAccounts: [createClaudeAccount('account-1', managedAuthPath)],
      activeClaudeManagedAccountId: 'account-1'
    })
    const store = createStore(settings)

    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const service = new ClaudeRuntimeAuthService(store as never)
    await service.syncForCurrentSelection()

    testState.managedKeychainCredentials.set('account-1', '{"token":"rotated"}\n')
    writeFileSync(join(managedAuthPath, '.credentials.json'), '{"token":"rotated"}\n', 'utf-8')
    chmodSync(runtimeCredentialsPath, 0o000)
    try {
      await service.syncForCurrentSelection()
    } finally {
      if (existsSync(runtimeCredentialsPath)) {
        chmodSync(runtimeCredentialsPath, 0o600)
      }
      warn.mockRestore()
    }

    expect(readFileSync(runtimeCredentialsPath, 'utf-8')).toBe('{"token":"rotated"}\n')
  })

  it('reads back refreshed credentials when the Claude identity still matches', async () => {
    const runtimeCredentialsPath = join(testState.fakeHomeDir, '.claude', '.credentials.json')
    const originalCredentials = createClaudeCredentialsJson('user@example.com', 'original')
    const refreshedCredentials = createClaudeCredentialsJson('user@example.com', 'refreshed')
    const managedAuthPath = createManagedClaudeAuth(
      testState.userDataDir,
      'account-1',
      originalCredentials
    )
    const settings = createSettings({
      claudeManagedAccounts: [createClaudeAccount('account-1', managedAuthPath)],
      activeClaudeManagedAccountId: 'account-1'
    })
    const store = createStore(settings)

    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const service = new ClaudeRuntimeAuthService(store as never)
    await service.syncForCurrentSelection()

    writeFileSync(runtimeCredentialsPath, refreshedCredentials, 'utf-8')
    await service.syncForCurrentSelection()

    expect(readManagedCredentialsForTest('account-1', managedAuthPath)).toBe(refreshedCredentials)
    expect(readFileSync(runtimeCredentialsPath, 'utf-8')).toBe(refreshedCredentials)
  })

  it('rejects runtime read-back from a different Claude identity', async () => {
    const runtimeCredentialsPath = join(testState.fakeHomeDir, '.claude', '.credentials.json')
    const selectedCredentials = createClaudeCredentialsJson('user@example.com', 'selected')
    const staleCredentials = createClaudeCredentialsJson('other@example.com', 'stale')
    const managedAuthPath = createManagedClaudeAuth(
      testState.userDataDir,
      'account-1',
      selectedCredentials
    )
    const settings = createSettings({
      claudeManagedAccounts: [createClaudeAccount('account-1', managedAuthPath)],
      activeClaudeManagedAccountId: 'account-1'
    })
    const store = createStore(settings)

    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const service = new ClaudeRuntimeAuthService(store as never)
    await service.syncForCurrentSelection()

    writeFileSync(runtimeCredentialsPath, staleCredentials, 'utf-8')
    await service.syncForCurrentSelection()

    expect(readManagedCredentialsForTest('account-1', managedAuthPath)).toBe(selectedCredentials)
    expect(readFileSync(runtimeCredentialsPath, 'utf-8')).toBe(selectedCredentials)
  })
})
