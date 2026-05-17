/* eslint-disable max-lines -- Why: this suite keeps cross-platform CLI install fixtures beside the status/reconciliation cases they exercise. */
import {
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  readlink,
  stat,
  symlink,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => tmpdir(),
    getAppPath: () => tmpdir()
  }
}))

import { CliInstaller } from './cli-installer'

async function makeFixture(): Promise<{
  root: string
  userDataPath: string
  appPath: string
}> {
  const root = await mkdtemp(join(tmpdir(), 'orca-cli-installer-'))
  const userDataPath = join(root, 'userData')
  const appPath = join(root, 'app')
  const cliEntryPath = join(appPath, 'out', 'cli', 'index.js')
  await mkdir(join(appPath, 'out', 'cli'), { recursive: true })
  await writeFile(cliEntryPath, 'console.log("orca")\n', 'utf8')
  return { root, userDataPath, appPath }
}

async function makePackagedFixture(
  platform: NodeJS.Platform,
  appDir = 'Orca.app'
): Promise<{
  root: string
  userDataPath: string
  resourcesPath: string
  bundledLauncherPath: string
}> {
  const root = await mkdtemp(join(tmpdir(), 'orca-cli-packaged-'))
  const userDataPath = join(root, 'userData')
  const resourcesPath =
    platform === 'darwin' ? join(root, appDir, 'Contents', 'Resources') : join(root, 'resources')
  const bundledLauncherPath = join(resourcesPath, 'bin', platform === 'win32' ? 'orca.cmd' : 'orca')
  await mkdir(join(resourcesPath, 'bin'), { recursive: true })
  await writeFile(bundledLauncherPath, bundledLauncherContent(platform), 'utf8')
  return { root, userDataPath, resourcesPath, bundledLauncherPath }
}

function bundledLauncherContent(platform: NodeJS.Platform): string {
  if (platform === 'win32') {
    return [
      '@echo off',
      'set ELECTRON_RUN_AS_NODE=1',
      'set "CLI=%RESOURCES_DIR%\\app.asar.unpacked\\out\\cli\\index.js"'
    ].join('\n')
  }
  return [
    '#!/usr/bin/env bash',
    'ELECTRON_RUN_AS_NODE=1 "$ELECTRON" "$CONTENTS/Resources/app.asar.unpacked/out/cli/index.js" "$@"'
  ].join('\n')
}

describe('CliInstaller', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  // Why: this test creates Unix symlinks and shell scripts that only apply on macOS.
  it.skipIf(process.platform === 'win32')(
    'creates a dev launcher and installs a macOS symlink in the requested path',
    async () => {
      const fixture = await makeFixture()
      const installPath = join(fixture.root, 'bin', 'orca')
      const installer = new CliInstaller({
        platform: 'darwin',
        isPackaged: false,
        userDataPath: fixture.userDataPath,
        execPath: '/Applications/Orca.app/Contents/MacOS/Orca',
        appPath: fixture.appPath,
        commandPathOverride: installPath,
        processPathEnv: join(fixture.root, 'bin')
      })

      const initial = await installer.getStatus()
      expect(initial.state).toBe('not_installed')
      expect(initial.launcherPath).toContain(join('userData', 'cli', 'bin', 'orca'))

      const installed = await installer.install()
      expect(installed.state).toBe('installed')
      expect(installed.pathConfigured).toBe(true)

      const launcherContent = await readFile(installed.launcherPath as string, 'utf8')
      expect(launcherContent).toContain('ELECTRON_RUN_AS_NODE=1')
      expect(launcherContent).toContain(join(fixture.appPath, 'out', 'cli', 'index.js'))

      const removed = await installer.remove()
      expect(removed.state).toBe('not_installed')
    }
  )

  // Why: this test creates Unix symlinks and shell scripts that only apply on Linux.
  it.skipIf(process.platform === 'win32')(
    'creates a linux symlink under the requested path and warns when PATH is missing',
    async () => {
      const fixture = await makeFixture()
      const installPath = join(fixture.root, '.local', 'bin', 'orca')
      const installer = new CliInstaller({
        platform: 'linux',
        isPackaged: false,
        userDataPath: fixture.userDataPath,
        execPath: '/opt/Orca/orca',
        appPath: fixture.appPath,
        commandPathOverride: installPath,
        processPathEnv: '/usr/bin'
      })

      const installed = await installer.install()
      expect(installed.state).toBe('installed')
      expect(installed.pathConfigured).toBe(false)
      expect(installed.detail).toContain('.local')

      const launcherContent = await readFile(installed.launcherPath as string, 'utf8')
      expect(launcherContent).toContain('ELECTRON_RUN_AS_NODE=1')

      const removed = await installer.remove()
      expect(removed.state).toBe('not_installed')
    }
  )

  it('creates a windows wrapper and updates the user PATH', async () => {
    const fixture = await makeFixture()
    const installPath = join(fixture.root, 'Programs', 'Orca', 'bin', 'orca.cmd')
    let userPath = 'C:\\Windows\\System32'
    const installer = new CliInstaller({
      platform: 'win32',
      isPackaged: false,
      userDataPath: fixture.userDataPath,
      execPath: 'C:\\Users\\me\\AppData\\Local\\Orca\\Orca.exe',
      appPath: fixture.appPath,
      commandPathOverride: installPath,
      userPathReader: async () => userPath,
      userPathWriter: async (value) => {
        userPath = value
      }
    })

    const installed = await installer.install()
    expect(installed.state).toBe('installed')
    expect(installed.pathConfigured).toBe(true)
    expect(userPath).toContain(join(fixture.root, 'Programs', 'Orca', 'bin'))

    const wrapperContent = await readFile(installPath, 'utf8')
    expect(wrapperContent).toContain('ORCA_LAUNCHER=')
    expect(wrapperContent).toContain('orca.cmd')

    const removed = await installer.remove()
    expect(removed.state).toBe('not_installed')
    expect(userPath).not.toContain(join(fixture.root, 'Programs', 'Orca', 'bin'))
  })

  // Why: this test creates a Unix symlink to /tmp/not-orca, which only applies on macOS/Linux.
  it.skipIf(process.platform === 'win32')(
    'reports stale when a different symlink already exists',
    async () => {
      const fixture = await makeFixture()
      const installPath = join(fixture.root, 'bin', 'orca')
      await mkdir(join(fixture.root, 'bin'), { recursive: true })
      await symlink('/tmp/not-orca', installPath)

      const installer = new CliInstaller({
        platform: 'darwin',
        isPackaged: false,
        userDataPath: fixture.userDataPath,
        execPath: '/Applications/Orca.app/Contents/MacOS/Orca',
        appPath: fixture.appPath,
        commandPathOverride: installPath
      })

      await expect(installer.getStatus()).resolves.toMatchObject({
        state: 'stale',
        supported: true
      })
    }
  )

  it.skipIf(process.platform === 'win32')(
    'keeps packaged macOS installs pointed at the app-bundle launcher',
    async () => {
      const fixture = await makePackagedFixture('darwin')
      const installPath = join(fixture.root, 'bin', 'orca')
      const installer = new CliInstaller({
        platform: 'darwin',
        isPackaged: true,
        userDataPath: fixture.userDataPath,
        resourcesPath: fixture.resourcesPath,
        commandPathOverride: installPath,
        processPathEnv: join(fixture.root, 'bin')
      })

      const installed = await installer.install()
      expect(installed.state).toBe('installed')
      expect(installed.launcherPath).toBe(fixture.bundledLauncherPath)
      expect(await readlink(installPath)).toBe(fixture.bundledLauncherPath)
    }
  )

  it.skipIf(process.platform === 'win32')(
    'refreshes the Linux stable launcher without changing the public symlink',
    async () => {
      const first = await makePackagedFixture('linux')
      const installPath = join(first.root, 'bin', 'orca')
      const firstInstaller = new CliInstaller({
        platform: 'linux',
        isPackaged: true,
        userDataPath: first.userDataPath,
        resourcesPath: first.resourcesPath,
        commandPathOverride: installPath,
        processPathEnv: join(first.root, 'bin')
      })

      const installed = await firstInstaller.install()
      const stableLauncherPath = installed.launcherPath as string
      expect(await readlink(installPath)).toBe(stableLauncherPath)
      expect((await stat(stableLauncherPath)).mode & 0o111).not.toBe(0)

      const nextResourcesPath = join(first.root, 'next', 'resources')
      const nextBundledLauncherPath = join(nextResourcesPath, 'bin', 'orca')
      await mkdir(join(nextResourcesPath, 'bin'), { recursive: true })
      await writeFile(nextBundledLauncherPath, bundledLauncherContent('linux'), 'utf8')

      const nextInstaller = new CliInstaller({
        platform: 'linux',
        isPackaged: true,
        userDataPath: first.userDataPath,
        resourcesPath: nextResourcesPath,
        commandPathOverride: installPath,
        processPathEnv: join(first.root, 'bin')
      })

      await expect(nextInstaller.getStatus()).resolves.toMatchObject({ state: 'installed' })
      expect(await readlink(installPath)).toBe(stableLauncherPath)
      expect(await readFile(stableLauncherPath, 'utf8')).toContain(nextBundledLauncherPath)
    }
  )

  it.skipIf(process.platform === 'win32')(
    'migrates a legacy macOS direct bundled symlink after an app move',
    async () => {
      const oldFixture = await makePackagedFixture('darwin', 'Old.app')
      const newResourcesPath = join(oldFixture.root, 'New.app', 'Contents', 'Resources')
      const newBundledLauncherPath = join(newResourcesPath, 'bin', 'orca')
      await mkdir(join(newResourcesPath, 'bin'), { recursive: true })
      await writeFile(newBundledLauncherPath, bundledLauncherContent('darwin'), 'utf8')
      const installPath = join(oldFixture.root, 'bin', 'orca')
      await mkdir(join(oldFixture.root, 'bin'), { recursive: true })
      await symlink(oldFixture.bundledLauncherPath, installPath)

      const installer = new CliInstaller({
        platform: 'darwin',
        isPackaged: true,
        userDataPath: oldFixture.userDataPath,
        resourcesPath: newResourcesPath,
        commandPathOverride: installPath,
        processPathEnv: join(oldFixture.root, 'bin')
      })

      await expect(installer.getStatus()).resolves.toMatchObject({
        state: 'stale',
        currentTarget: oldFixture.bundledLauncherPath
      })
      await expect(installer.reconcileAfterAppUpdate()).resolves.toBe('migrated_legacy_launcher')
      const repaired = await installer.getStatus()
      expect(repaired.state).toBe('installed')
      expect(await readlink(installPath)).toBe(newBundledLauncherPath)
    }
  )

  it.skipIf(process.platform === 'win32')(
    'does not elevate when startup reconciliation cannot rewrite a macOS symlink',
    async () => {
      const oldFixture = await makePackagedFixture('darwin', 'Old.app')
      const newResourcesPath = join(oldFixture.root, 'New.app', 'Contents', 'Resources')
      const newBundledLauncherPath = join(newResourcesPath, 'bin', 'orca')
      const commandDir = join(oldFixture.root, 'bin')
      const installPath = join(commandDir, 'orca')
      const privilegedRunner = vi.fn()
      await mkdir(join(newResourcesPath, 'bin'), { recursive: true })
      await writeFile(newBundledLauncherPath, bundledLauncherContent('darwin'), 'utf8')
      await mkdir(commandDir, { recursive: true })
      await symlink(oldFixture.bundledLauncherPath, installPath)
      await chmod(commandDir, 0o555)
      try {
        const installer = new CliInstaller({
          platform: 'darwin',
          isPackaged: true,
          userDataPath: oldFixture.userDataPath,
          resourcesPath: newResourcesPath,
          commandPathOverride: installPath,
          privilegedRunner,
          processPathEnv: commandDir
        })

        await expect(installer.reconcileAfterAppUpdate()).resolves.toBe('permission_denied')
        expect(privilegedRunner).not.toHaveBeenCalled()
        expect(await readlink(installPath)).toBe(oldFixture.bundledLauncherPath)
      } finally {
        await chmod(commandDir, 0o755)
      }
    }
  )

  it.skipIf(process.platform === 'win32')(
    'migrates a legacy Linux direct bundled symlink to the stable launcher',
    async () => {
      const oldFixture = await makePackagedFixture('linux')
      const newResourcesPath = join(oldFixture.root, 'next', 'resources')
      const newBundledLauncherPath = join(newResourcesPath, 'bin', 'orca')
      const installPath = join(oldFixture.root, 'bin', 'orca')
      await mkdir(join(newResourcesPath, 'bin'), { recursive: true })
      await writeFile(newBundledLauncherPath, bundledLauncherContent('linux'), 'utf8')
      await mkdir(join(oldFixture.root, 'bin'), { recursive: true })
      await symlink(oldFixture.bundledLauncherPath, installPath)

      const installer = new CliInstaller({
        platform: 'linux',
        isPackaged: true,
        userDataPath: oldFixture.userDataPath,
        resourcesPath: newResourcesPath,
        commandPathOverride: installPath,
        processPathEnv: join(oldFixture.root, 'bin')
      })

      await expect(installer.reconcileAfterAppUpdate()).resolves.toBe('migrated_legacy_launcher')
      const repaired = await installer.getStatus()
      expect(repaired.state).toBe('installed')
      expect(await readlink(installPath)).toBe(repaired.launcherPath)
      expect(await readFile(repaired.launcherPath as string, 'utf8')).toContain(
        newBundledLauncherPath
      )
    }
  )

  it.skipIf(process.platform === 'win32')(
    'preserves stale symlinks that are not Orca launchers',
    async () => {
      const fixture = await makePackagedFixture('darwin')
      const installPath = join(fixture.root, 'bin', 'orca')
      await mkdir(join(fixture.root, 'bin'), { recursive: true })
      await symlink('/tmp/not-orca', installPath)

      const installer = new CliInstaller({
        platform: 'darwin',
        isPackaged: true,
        userDataPath: fixture.userDataPath,
        resourcesPath: fixture.resourcesPath,
        commandPathOverride: installPath
      })

      await expect(installer.reconcileAfterAppUpdate()).resolves.toBe('stale_preserved')
      expect(await readlink(installPath)).toBe('/tmp/not-orca')
    }
  )

  it.skipIf(process.platform === 'win32')(
    'preserves missing legacy-shaped symlinks because ownership cannot be verified',
    async () => {
      const fixture = await makePackagedFixture('darwin')
      const installPath = join(fixture.root, 'bin', 'orca')
      const missingLegacyTarget = join(
        fixture.root,
        'Missing.app',
        'Contents',
        'Resources',
        'bin',
        'orca'
      )
      await mkdir(join(fixture.root, 'bin'), { recursive: true })
      await symlink(missingLegacyTarget, installPath)

      const installer = new CliInstaller({
        platform: 'darwin',
        isPackaged: true,
        userDataPath: fixture.userDataPath,
        resourcesPath: fixture.resourcesPath,
        commandPathOverride: installPath
      })

      await expect(installer.reconcileAfterAppUpdate()).resolves.toBe('stale_preserved')
      expect(await readlink(installPath)).toBe(missingLegacyTarget)
    }
  )

  it('points packaged Windows installs at a stable user-data launcher', async () => {
    const fixture = await makePackagedFixture('win32')
    const installPath = join(fixture.root, 'Programs', 'Orca', 'bin', 'orca.cmd')
    let userPath = ''
    const installer = new CliInstaller({
      platform: 'win32',
      isPackaged: true,
      userDataPath: fixture.userDataPath,
      resourcesPath: fixture.resourcesPath,
      commandPathOverride: installPath,
      userPathReader: async () => userPath,
      userPathWriter: async (value) => {
        userPath = value
      }
    })

    const installed = await installer.install()
    expect(installed.state).toBe('installed')
    expect(installed.launcherPath).toBe(join(fixture.userDataPath, 'cli', 'bin', 'orca.cmd'))

    const publicWrapper = await readFile(installPath, 'utf8')
    expect(publicWrapper).toContain(`ORCA_LAUNCHER=${installed.launcherPath}`)

    const stableLauncher = await readFile(installed.launcherPath as string, 'utf8')
    expect(stableLauncher).toContain(`ORCA_BUNDLED_LAUNCHER=${fixture.bundledLauncherPath}`)
    expect(stableLauncher).toContain('exit /b %ERRORLEVEL%')
  })

  it('refreshes the Windows stable launcher without changing the public wrapper', async () => {
    const first = await makePackagedFixture('win32')
    const installPath = join(first.root, 'Programs', 'Orca', 'bin', 'orca.cmd')
    let userPath = join(first.root, 'Programs', 'Orca', 'bin')
    const firstInstaller = new CliInstaller({
      platform: 'win32',
      isPackaged: true,
      userDataPath: first.userDataPath,
      resourcesPath: first.resourcesPath,
      commandPathOverride: installPath,
      userPathReader: async () => userPath,
      userPathWriter: async (value) => {
        userPath = value
      }
    })

    const installed = await firstInstaller.install()
    const stableLauncherPath = installed.launcherPath as string
    expect(await readFile(installPath, 'utf8')).toContain(`ORCA_LAUNCHER=${stableLauncherPath}`)

    const nextResourcesPath = join(first.root, 'next', 'resources')
    const nextBundledLauncherPath = join(nextResourcesPath, 'bin', 'orca.cmd')
    await mkdir(join(nextResourcesPath, 'bin'), { recursive: true })
    await writeFile(nextBundledLauncherPath, bundledLauncherContent('win32'), 'utf8')
    const nextInstaller = new CliInstaller({
      platform: 'win32',
      isPackaged: true,
      userDataPath: first.userDataPath,
      resourcesPath: nextResourcesPath,
      commandPathOverride: installPath,
      userPathReader: async () => userPath,
      userPathWriter: async (value) => {
        userPath = value
      }
    })

    await expect(nextInstaller.getStatus()).resolves.toMatchObject({ state: 'installed' })
    expect(await readFile(installPath, 'utf8')).toContain(`ORCA_LAUNCHER=${stableLauncherPath}`)
    expect(await readFile(stableLauncherPath, 'utf8')).toContain(nextBundledLauncherPath)
  })

  it('migrates a legacy Windows wrapper during startup reconciliation', async () => {
    const fixture = await makePackagedFixture('win32')
    const installPath = join(fixture.root, 'Programs', 'Orca', 'bin', 'orca.cmd')
    await mkdir(join(fixture.root, 'Programs', 'Orca', 'bin'), { recursive: true })
    await writeFile(
      installPath,
      [
        '@echo off',
        'setlocal',
        `set "ORCA_LAUNCHER=${fixture.bundledLauncherPath}"`,
        '"%ORCA_LAUNCHER%" %*',
        ''
      ].join('\n'),
      'utf8'
    )
    const installer = new CliInstaller({
      platform: 'win32',
      isPackaged: true,
      userDataPath: fixture.userDataPath,
      resourcesPath: fixture.resourcesPath,
      commandPathOverride: installPath,
      userPathReader: async () => join(fixture.root, 'Programs', 'Orca', 'bin'),
      userPathWriter: async () => undefined
    })

    await expect(installer.getStatus()).resolves.toMatchObject({
      state: 'stale',
      currentTarget: fixture.bundledLauncherPath
    })
    await expect(installer.reconcileAfterAppUpdate()).resolves.toBe('migrated_legacy_launcher')
    await expect(installer.getStatus()).resolves.toMatchObject({ state: 'installed' })
    expect(await readFile(installPath, 'utf8')).toContain(
      `ORCA_LAUNCHER=${join(fixture.userDataPath, 'cli', 'bin', 'orca.cmd')}`
    )
  })

  it('preserves custom Windows wrappers even when they reference an Orca launcher', async () => {
    const fixture = await makePackagedFixture('win32')
    const installPath = join(fixture.root, 'Programs', 'Orca', 'bin', 'orca.cmd')
    const customWrapper = [
      '@echo off',
      'echo custom preflight',
      `set "ORCA_LAUNCHER=${fixture.bundledLauncherPath}"`,
      '"%ORCA_LAUNCHER%" %*'
    ].join('\n')
    await mkdir(join(fixture.root, 'Programs', 'Orca', 'bin'), { recursive: true })
    await writeFile(installPath, customWrapper, 'utf8')
    const installer = new CliInstaller({
      platform: 'win32',
      isPackaged: true,
      userDataPath: fixture.userDataPath,
      resourcesPath: fixture.resourcesPath,
      commandPathOverride: installPath,
      userPathReader: async () => join(fixture.root, 'Programs', 'Orca', 'bin'),
      userPathWriter: async () => undefined
    })

    await expect(installer.reconcileAfterAppUpdate()).resolves.toBe('stale_preserved')
    expect(await readFile(installPath, 'utf8')).toBe(customWrapper)
  })
})
