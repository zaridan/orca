import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  handleMock,
  reconcileAfterAppUpdateMock,
  getStatusMock,
  installMock,
  removeMock,
  CliInstallerMock
} = vi.hoisted(() => {
  const reconcileAfterAppUpdateMock = vi.fn()
  const getStatusMock = vi.fn()
  const installMock = vi.fn()
  const removeMock = vi.fn()
  const CliInstallerMock = vi.fn(function CliInstaller() {
    return {
      reconcileAfterAppUpdate: reconcileAfterAppUpdateMock,
      getStatus: getStatusMock,
      install: installMock,
      remove: removeMock
    }
  })
  return {
    handleMock: vi.fn(),
    reconcileAfterAppUpdateMock,
    getStatusMock,
    installMock,
    removeMock,
    CliInstallerMock
  }
})

vi.mock('electron', () => ({
  ipcMain: {
    handle: handleMock
  }
}))

vi.mock('../cli/cli-installer', () => ({
  CliInstaller: CliInstallerMock
}))

import { CliInstaller } from '../cli/cli-installer'
import { registerCliHandlers } from './cli'

describe('registerCliHandlers', () => {
  beforeEach(() => {
    handleMock.mockReset()
    reconcileAfterAppUpdateMock.mockReset()
    reconcileAfterAppUpdateMock.mockResolvedValue('already_installed')
    getStatusMock.mockReset()
    installMock.mockReset()
    removeMock.mockReset()
    vi.mocked(CliInstaller).mockClear()
  })

  it('starts app-update reconciliation and registers CLI IPC handlers', () => {
    registerCliHandlers()

    expect(reconcileAfterAppUpdateMock).toHaveBeenCalledTimes(1)
    expect(handleMock).toHaveBeenCalledWith('cli:getInstallStatus', expect.any(Function))
    expect(handleMock).toHaveBeenCalledWith('cli:install', expect.any(Function))
    expect(handleMock).toHaveBeenCalledWith('cli:remove', expect.any(Function))
  })

  it('does not throw when startup reconciliation fails', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    reconcileAfterAppUpdateMock.mockRejectedValueOnce(new Error('permission denied'))

    expect(() => registerCliHandlers()).not.toThrow()
    await Promise.resolve()

    expect(warnSpy).toHaveBeenCalledWith('[cli] startup reconciliation failed:', expect.any(Error))
    warnSpy.mockRestore()
  })
})
