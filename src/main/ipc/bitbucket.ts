import { ipcMain } from 'electron'
import {
  connectBitbucket,
  disconnectBitbucket,
  getBitbucketConnectionStatus,
  type BitbucketConnectInput,
  type BitbucketConnectResult,
  type BitbucketConnectionStatus
} from '../bitbucket/credential-connection'
import { _resetPreflightCache } from './preflight'

function normalizeConnectInput(value: unknown): BitbucketConnectInput | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const raw = value as Record<string, unknown>
  if (raw.authMode !== 'token' && raw.authMode !== 'basic') {
    return null
  }
  const optionalString = (input: unknown): string | null =>
    typeof input === 'string' ? input : null
  return {
    authMode: raw.authMode,
    accessToken: optionalString(raw.accessToken),
    email: optionalString(raw.email),
    apiToken: optionalString(raw.apiToken),
    baseUrl: optionalString(raw.baseUrl)
  }
}

export function registerBitbucketHandlers(): void {
  ipcMain.handle(
    'bitbucket:connect',
    async (_event, args: unknown): Promise<BitbucketConnectResult> => {
      const input = normalizeConnectInput(args)
      if (!input) {
        return { ok: false, error: 'Invalid Bitbucket credentials' }
      }
      const result = await connectBitbucket(input)
      if (result.ok) {
        // Why: preflight caches the source-control status for the session; reset
        // so the Integrations card reflects the new connection without a relaunch.
        _resetPreflightCache()
      }
      return result
    }
  )

  ipcMain.handle('bitbucket:disconnect', async (): Promise<void> => {
    disconnectBitbucket()
    _resetPreflightCache()
  })

  ipcMain.handle('bitbucket:status', async (): Promise<BitbucketConnectionStatus> => {
    return getBitbucketConnectionStatus()
  })
}
