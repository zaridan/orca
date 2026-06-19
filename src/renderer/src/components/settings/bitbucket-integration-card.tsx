import { useCallback, useEffect, useState } from 'react'
import { ExternalLink, GitPullRequestArrow, LoaderCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useMountedRef } from '@/hooks/useMountedRef'
import { IntegrationCardDetails, IntegrationCardShell } from './integration-card-shell'
import { usePreflightCardStatuses } from './source-control-preflight-card-status'
import { BitbucketCredentialsDialog } from './bitbucket-credentials-dialog'
import { translate } from '@/i18n/i18n'

const API_TOKEN_DOCS_URL = 'https://support.atlassian.com/bitbucket-cloud/docs/using-api-tokens/'

type BitbucketConnectionInfo = Awaited<ReturnType<typeof window.api.bitbucket.status>>

export function BitbucketIntegrationCard(): React.JSX.Element {
  const { statuses, unavailable, refresh } = usePreflightCardStatuses('bitbucket')
  const status = unavailable ? 'unavailable' : statuses.bitbucketStatus
  const connected = status === 'connected'
  const mountedRef = useMountedRef()
  const [connection, setConnection] = useState<BitbucketConnectionInfo | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)

  // Why: source (env var vs in-app store) reads only plaintext metadata, never
  // the encrypted secret — safe to call on every mount without a keychain prompt.
  const loadConnection = useCallback(async () => {
    try {
      const next = await window.api.bitbucket.status()
      if (mountedRef.current) {
        setConnection(next)
      }
    } catch {
      // Status is best-effort; the preflight card still renders without it.
    }
  }, [mountedRef])

  useEffect(() => {
    void loadConnection()
  }, [loadConnection])

  const envManaged = connection?.source === 'environment'
  const storedConnection = connection?.source === 'stored'

  const handleConnected = (): void => {
    void loadConnection()
    refresh()
  }

  const handleDisconnect = async (): Promise<void> => {
    setDisconnecting(true)
    try {
      await window.api.bitbucket.disconnect()
    } finally {
      if (mountedRef.current) {
        setDisconnecting(false)
      }
      void loadConnection()
      refresh()
    }
  }

  return (
    <IntegrationCardShell
      icon={<GitPullRequestArrow className="size-5" />}
      name="Bitbucket"
      description={
        connected
          ? statuses.bitbucketAccount
            ? translate(
                'auto.components.settings.token.source.control.integration.cards.ea204f5e03',
                '{{value0}} · Pull requests and build statuses',
                { value0: statuses.bitbucketAccount }
              )
            : translate(
                'auto.components.settings.token.source.control.integration.cards.0fa5629dad',
                'Pull requests and build statuses'
              )
          : translate(
              'auto.components.settings.bitbucket.integration.card.description',
              'Pull requests and build statuses for Bitbucket Cloud.'
            )
      }
      checking={status === 'checking'}
      statusTone={connected ? 'connected' : 'attention'}
      statusLabel={
        connected
          ? 'Connected'
          : status === 'unavailable'
            ? 'Unavailable'
            : status === 'not-configured'
              ? 'Not configured'
              : 'Auth failed'
      }
    >
      {status !== 'checking' ? (
        <IntegrationCardDetails>
          {status === 'unavailable' ? (
            <p className="text-xs text-muted-foreground">
              {translate(
                'auto.components.settings.token.source.control.integration.cards.24ac1c69dc',
                'Bitbucket status is not available in this runtime yet.'
              )}
            </p>
          ) : envManaged ? (
            <p className="text-xs text-muted-foreground">
              {translate(
                'auto.components.settings.bitbucket.integration.card.envManaged',
                'Configured via ORCA_BITBUCKET_* environment variables.'
              )}
            </p>
          ) : status === 'not-authenticated' ? (
            <p className="text-xs text-muted-foreground">
              {translate(
                'auto.components.settings.bitbucket.integration.card.authFailed',
                'Saved Bitbucket credentials could not authenticate. Reconnect with a valid token.'
              )}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              {translate(
                'auto.components.settings.bitbucket.integration.card.notConfigured',
                'Connect a Bitbucket Cloud account to view pull requests and build statuses.'
              )}
            </p>
          )}

          {!envManaged ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setDialogOpen(true)}>
                {storedConnection
                  ? translate(
                      'auto.components.settings.bitbucket.integration.card.edit',
                      'Edit credentials'
                    )
                  : translate(
                      'auto.components.settings.bitbucket.integration.card.connect',
                      'Connect'
                    )}
              </Button>
              {storedConnection ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void handleDisconnect()}
                  disabled={disconnecting}
                >
                  {disconnecting ? <LoaderCircle className="size-4 animate-spin" /> : null}
                  {translate(
                    'auto.components.settings.bitbucket.integration.card.disconnect',
                    'Disconnect'
                  )}
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => window.api.shell.openUrl(API_TOKEN_DOCS_URL)}
                >
                  <ExternalLink className="size-3.5 mr-1.5" />
                  {translate(
                    'auto.components.settings.token.source.control.integration.cards.1a9475dace',
                    'Learn more'
                  )}
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={refresh}>
                {translate(
                  'auto.components.settings.token.source.control.integration.cards.793a06e899',
                  'Re-check'
                )}
              </Button>
            </div>
          ) : (
            <Button variant="ghost" size="sm" onClick={refresh}>
              {translate(
                'auto.components.settings.token.source.control.integration.cards.793a06e899',
                'Re-check'
              )}
            </Button>
          )}
        </IntegrationCardDetails>
      ) : null}

      <BitbucketCredentialsDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        initialAuthMode={connection?.authMode}
        initialEmail={connection?.email}
        initialBaseUrl={connection?.baseUrl}
        onConnected={handleConnected}
      />
    </IntegrationCardShell>
  )
}
