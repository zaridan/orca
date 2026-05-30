import type { SetupScriptImportCandidate, SetupScriptImportFileRead } from './setup-script-imports'

const PACKAGE_JSON_PATH = 'package.json'
type PackageManagerName = 'pnpm' | 'bun' | 'yarn' | 'npm'

const PACKAGE_MANAGER_LOCKFILES = [
  { path: 'pnpm-lock.yaml', manager: 'pnpm', setup: 'pnpm install' },
  { path: 'bun.lock', manager: 'bun', setup: 'bun install' },
  { path: 'bun.lockb', manager: 'bun', setup: 'bun install' },
  { path: 'yarn.lock', manager: 'yarn', setup: 'yarn install' },
  { path: 'package-lock.json', manager: 'npm', setup: 'npm install' },
  { path: 'npm-shrinkwrap.json', manager: 'npm', setup: 'npm install' }
] as const

export async function inspectPackageManagerSetupCandidate(
  readFile: SetupScriptImportFileRead
): Promise<SetupScriptImportCandidate | null> {
  const [packageJsonContent, lockfileReads] = await Promise.all([
    readFile(PACKAGE_JSON_PATH),
    Promise.all(
      PACKAGE_MANAGER_LOCKFILES.map(async (entry) => ({
        ...entry,
        exists: (await readFile(entry.path)) !== null
      }))
    )
  ])
  const packageJson = parsePackageJson(packageJsonContent)
  if (!packageJson) {
    return null
  }

  const lockfiles = lockfileReads.filter((entry) => entry.exists)
  const packageManager = getPackageManagerName(packageJson.packageManager)
  const packageManagerSetup = packageManager ? getPackageManagerSetup(packageManager) : null
  const lockfileManagers = new Set(lockfiles.map((entry) => entry.manager))
  const selectedLockfile = lockfileManagers.size === 1 ? lockfiles[0] : null
  if (!packageManagerSetup && lockfileManagers.size > 1) {
    return null
  }
  const setup = packageManagerSetup ?? selectedLockfile?.setup ?? 'npm install'

  return {
    provider: 'package-manager',
    label: 'package manager',
    files: packageManagerSetup
      ? [PACKAGE_JSON_PATH]
      : selectedLockfile
        ? [selectedLockfile.path]
        : [PACKAGE_JSON_PATH],
    setup,
    unsupportedFields: []
  }
}

function parsePackageJson(content: string | null): Record<string, unknown> | null {
  if (!content) {
    return null
  }
  try {
    const parsed = JSON.parse(content)
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

function getPackageManagerName(value: unknown): PackageManagerName | null {
  if (typeof value !== 'string') {
    return null
  }
  const packageManager = value.trim().toLowerCase()
  if (packageManager.startsWith('pnpm@')) {
    return 'pnpm'
  }
  if (packageManager.startsWith('bun@')) {
    return 'bun'
  }
  if (packageManager.startsWith('yarn@')) {
    return 'yarn'
  }
  if (packageManager.startsWith('npm@')) {
    return 'npm'
  }
  return null
}

function getPackageManagerSetup(packageManager: PackageManagerName): string {
  switch (packageManager) {
    case 'pnpm':
      return 'pnpm install'
    case 'bun':
      return 'bun install'
    case 'yarn':
      return 'yarn install'
    case 'npm':
      return 'npm install'
  }
}
