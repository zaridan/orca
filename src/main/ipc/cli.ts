import { ipcMain } from 'electron'
import type { CliInstallStatus } from '../../shared/cli-install-types'
import { CliInstaller } from '../cli/cli-installer'

export function registerCliHandlers(): void {
  void new CliInstaller().reconcileAfterAppUpdate().then(
    (result) => {
      if (
        result === 'migrated_legacy_launcher' ||
        result === 'permission_denied' ||
        result === 'stale_preserved'
      ) {
        console.info(`[cli] startup reconciliation result: ${result}`)
      }
    },
    (error: unknown) => {
      // Why: CLI reconciliation is a best-effort app-update repair. Startup
      // must continue even when a PATH-visible launcher is not writable.
      console.warn('[cli] startup reconciliation failed:', error)
    }
  )

  ipcMain.handle('cli:getInstallStatus', async (): Promise<CliInstallStatus> => {
    return new CliInstaller().getStatus()
  })

  ipcMain.handle('cli:install', async (): Promise<CliInstallStatus> => {
    return new CliInstaller().install()
  })

  ipcMain.handle('cli:remove', async (): Promise<CliInstallStatus> => {
    return new CliInstaller().remove()
  })
}
