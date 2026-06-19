import { useId, useMemo, useState } from 'react'
import { ExternalLink, LoaderCircle, Lock } from 'lucide-react'
import { getActiveRuntimeTarget } from '@/runtime/runtime-rpc-client'
import { useAppStore } from '@/store'
import { useMountedRef } from '@/hooks/useMountedRef'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { translate } from '@/i18n/i18n'

const API_TOKEN_DOCS_URL = 'https://support.atlassian.com/bitbucket-cloud/docs/using-api-tokens/'

type AuthMode = 'basic' | 'token'

type BitbucketCredentialsDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialAuthMode?: AuthMode | null
  initialEmail?: string | null
  initialBaseUrl?: string | null
  onConnected?: () => void
}

export function BitbucketCredentialsDialog({
  open,
  onOpenChange,
  initialAuthMode,
  initialEmail,
  initialBaseUrl,
  onConnected
}: BitbucketCredentialsDialogProps): React.JSX.Element {
  const settings = useAppStore((s) => s.settings)
  const mountedRef = useMountedRef()
  const emailId = useId()
  const apiTokenId = useId()
  const accessTokenId = useId()
  const baseUrlId = useId()
  const errorId = useId()

  const [authMode, setAuthMode] = useState<AuthMode>(initialAuthMode ?? 'basic')
  const [email, setEmail] = useState(initialEmail ?? '')
  const [apiToken, setApiToken] = useState('')
  const [accessToken, setAccessToken] = useState('')
  const [baseUrl, setBaseUrl] = useState(initialBaseUrl ?? '')
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const runtimeTarget = useMemo(() => getActiveRuntimeTarget(settings), [settings])
  const isRemote = runtimeTarget.kind === 'environment'

  const canSubmit =
    !connecting &&
    !isRemote &&
    (authMode === 'token' ? accessToken.trim().length > 0 : email.trim() && apiToken.trim())

  const handleOpenChange = (next: boolean): void => {
    if (!connecting) {
      onOpenChange(next)
    }
  }

  const handleConnect = async (): Promise<void> => {
    if (!canSubmit) {
      return
    }
    setConnecting(true)
    setError(null)
    try {
      const result = await window.api.bitbucket.connect({
        authMode,
        accessToken: authMode === 'token' ? accessToken.trim() : null,
        email: authMode === 'basic' ? email.trim() : null,
        apiToken: authMode === 'basic' ? apiToken.trim() : null,
        baseUrl: baseUrl.trim() || null
      })
      if (!mountedRef.current) {
        return
      }
      if (result.ok) {
        setApiToken('')
        setAccessToken('')
        onOpenChange(false)
        onConnected?.()
        return
      }
      setError(result.error)
    } catch (caught) {
      if (mountedRef.current) {
        setError(caught instanceof Error ? caught.message : 'Connection failed')
      }
    } finally {
      if (mountedRef.current) {
        setConnecting(false)
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader className="gap-3">
          <DialogTitle className="leading-tight">
            {translate(
              'auto.components.settings.bitbucket.credentials.dialog.title',
              'Connect Bitbucket'
            )}
          </DialogTitle>
          <DialogDescription>
            {translate(
              'auto.components.settings.bitbucket.credentials.dialog.description',
              'Connect a Bitbucket Cloud account to view pull requests and build statuses. Credentials are verified before they are saved.'
            )}
          </DialogDescription>
        </DialogHeader>

        {isRemote ? (
          <p className="text-xs text-muted-foreground">
            {translate(
              'auto.components.settings.bitbucket.credentials.dialog.remote',
              'The active remote runtime manages Bitbucket credentials through its environment variables. Set ORCA_BITBUCKET_* on the remote instead.'
            )}
          </p>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant={authMode === 'basic' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setAuthMode('basic')}
              >
                {translate(
                  'auto.components.settings.bitbucket.credentials.dialog.mode.basic',
                  'Email + API token'
                )}
              </Button>
              <Button
                type="button"
                variant={authMode === 'token' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setAuthMode('token')}
              >
                {translate(
                  'auto.components.settings.bitbucket.credentials.dialog.mode.token',
                  'Access token'
                )}
              </Button>
            </div>

            {authMode === 'basic' ? (
              <>
                <div className="space-y-2">
                  <Label htmlFor={emailId} className="text-xs">
                    {translate(
                      'auto.components.settings.bitbucket.credentials.dialog.email',
                      'Atlassian account email'
                    )}
                  </Label>
                  <Input
                    id={emailId}
                    autoFocus
                    type="email"
                    placeholder={translate(
                      'auto.components.settings.bitbucket.credentials.dialog.emailPlaceholder',
                      'you@example.com'
                    )}
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    disabled={connecting}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor={apiTokenId} className="text-xs">
                    {translate(
                      'auto.components.settings.bitbucket.credentials.dialog.apiToken',
                      'API token'
                    )}
                  </Label>
                  <Input
                    id={apiTokenId}
                    type="password"
                    placeholder={translate(
                      'auto.components.settings.bitbucket.credentials.dialog.apiTokenPlaceholder',
                      'ATATT...'
                    )}
                    value={apiToken}
                    onChange={(event) => setApiToken(event.target.value)}
                    disabled={connecting}
                    aria-invalid={error !== null}
                    aria-describedby={error ? errorId : undefined}
                  />
                </div>
              </>
            ) : (
              <div className="space-y-2">
                <Label htmlFor={accessTokenId} className="text-xs">
                  {translate(
                    'auto.components.settings.bitbucket.credentials.dialog.accessToken',
                    'Access token'
                  )}
                </Label>
                <Input
                  id={accessTokenId}
                  autoFocus
                  type="password"
                  placeholder={translate(
                    'auto.components.settings.bitbucket.credentials.dialog.accessTokenPlaceholder',
                    'bb_...'
                  )}
                  value={accessToken}
                  onChange={(event) => setAccessToken(event.target.value)}
                  disabled={connecting}
                  aria-invalid={error !== null}
                  aria-describedby={error ? errorId : undefined}
                />
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor={baseUrlId} className="text-xs">
                {translate(
                  'auto.components.settings.bitbucket.credentials.dialog.baseUrl',
                  'API base URL (optional)'
                )}
              </Label>
              <Input
                id={baseUrlId}
                type="text"
                placeholder={translate(
                  'auto.components.settings.bitbucket.credentials.dialog.baseUrlPlaceholder',
                  'https://api.bitbucket.org/2.0'
                )}
                value={baseUrl}
                onChange={(event) => setBaseUrl(event.target.value)}
                disabled={connecting}
              />
            </div>

            {error ? (
              <p id={errorId} className="text-xs text-destructive">
                {error}
              </p>
            ) : null}

            <button
              type="button"
              className="inline-flex items-center gap-1 text-xs text-primary underline-offset-2 hover:underline"
              onClick={() => window.api.shell.openUrl(API_TOKEN_DOCS_URL)}
            >
              <ExternalLink className="size-3" />
              {translate(
                'auto.components.settings.bitbucket.credentials.dialog.docs',
                'How to create a Bitbucket API token'
              )}
            </button>

            <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground/70">
              <Lock className="size-3 shrink-0" />
              {translate(
                'auto.components.settings.bitbucket.credentials.dialog.storage',
                'Stored on this device using Electron encrypted storage when available. Environment variables, if set, take precedence.'
              )}
            </p>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={connecting}>
            {translate('auto.components.settings.bitbucket.credentials.dialog.cancel', 'Cancel')}
          </Button>
          <Button onClick={() => void handleConnect()} disabled={!canSubmit}>
            {connecting ? (
              <>
                <LoaderCircle className="size-4 animate-spin" />
                {translate(
                  'auto.components.settings.bitbucket.credentials.dialog.verifying',
                  'Verifying...'
                )}
              </>
            ) : (
              translate('auto.components.settings.bitbucket.credentials.dialog.connect', 'Connect')
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
