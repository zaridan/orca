import { describe, expect, it } from 'vitest'
import { inspectSetupScriptImportCandidates } from './setup-script-imports'

function makeReader(files: Record<string, string>) {
  return async (relativePath: string): Promise<string | null> => files[relativePath] ?? null
}

describe('inspectSetupScriptImportCandidates', () => {
  it('imports setup and teardown commands from Superset config', async () => {
    const candidates = await inspectSetupScriptImportCandidates(
      makeReader({
        '.superset/config.json': JSON.stringify({
          setup: ['./.superset/setup.sh', 'bun install'],
          teardown: ['./.superset/teardown.sh'],
          run: ['bun dev']
        })
      })
    )

    expect(candidates).toEqual([
      {
        provider: 'superset',
        label: 'Superset',
        files: ['.superset/config.json'],
        setup: './.superset/setup.sh\nbun install',
        archive: './.superset/teardown.sh',
        unsupportedFields: ['run']
      }
    ])
  })

  it('applies Superset local before and after setup overlays', async () => {
    const candidates = await inspectSetupScriptImportCandidates(
      makeReader({
        '.superset/config.json': JSON.stringify({
          setup: ['bun install'],
          teardown: ['docker compose down'],
          cwd: 'packages/web'
        }),
        '.superset/config.local.json': JSON.stringify({
          setup: {
            before: ['corepack enable'],
            after: ['bun run db:migrate']
          },
          teardown: ['docker compose down --remove-orphans'],
          run: ['bun dev']
        })
      })
    )

    expect(candidates).toEqual([
      {
        provider: 'superset',
        label: 'Superset',
        files: ['.superset/config.json', '.superset/config.local.json'],
        setup: 'corepack enable\nbun install\nbun run db:migrate',
        archive: 'docker compose down --remove-orphans',
        unsupportedFields: ['cwd', 'config.local.run']
      }
    ])
  })

  it('reports unsupported Superset local script object fields', async () => {
    const candidates = await inspectSetupScriptImportCandidates(
      makeReader({
        '.superset/config.json': JSON.stringify({
          setup: ['bun install']
        }),
        '.superset/config.local.json': JSON.stringify({
          setup: {
            before: ['corepack enable'],
            after: ['bun run db:migrate'],
            cwd: 'packages/web'
          }
        })
      })
    )

    expect(candidates).toEqual([
      {
        provider: 'superset',
        label: 'Superset',
        files: ['.superset/config.json', '.superset/config.local.json'],
        setup: 'corepack enable\nbun install\nbun run db:migrate',
        archive: undefined,
        unsupportedFields: ['config.local.setup.cwd']
      }
    ])
  })

  it('imports setup commands from cmux project config', async () => {
    const candidates = await inspectSetupScriptImportCandidates(
      makeReader({
        '.cmux/cmux.json': JSON.stringify({
          commands: [
            {
              name: 'Run Unit Tests',
              keywords: ['test', 'unit'],
              command: './scripts/test-unit.sh'
            },
            {
              name: 'Setup',
              description: 'Initialize submodules and build dependencies',
              keywords: ['setup', 'init', 'install'],
              command: './scripts/setup.sh',
              confirm: true,
              cwd: 'packages/web'
            }
          ]
        })
      })
    )

    expect(candidates).toEqual([
      {
        provider: 'cmux',
        label: 'cmux',
        files: ['.cmux/cmux.json'],
        setup: './scripts/setup.sh',
        unsupportedFields: ['commands.1.confirm', 'commands.1.cwd']
      }
    ])
  })

  it('imports setup commands from root cmux config when project config is absent', async () => {
    const candidates = await inspectSetupScriptImportCandidates(
      makeReader({
        'cmux.json': JSON.stringify({
          commands: [
            {
              title: 'Workspace Setup',
              keywords: ['setup'],
              command: 'pnpm install'
            }
          ]
        })
      })
    )

    expect(candidates).toEqual([
      {
        provider: 'cmux',
        label: 'cmux',
        files: ['cmux.json'],
        setup: 'pnpm install',
        unsupportedFields: []
      }
    ])
  })

  it('suggests setup commands from package manager lockfiles', async () => {
    const candidates = await inspectSetupScriptImportCandidates(
      makeReader({
        'package.json': JSON.stringify({ scripts: { dev: 'vite' } }),
        'pnpm-lock.yaml': 'lockfileVersion: 9.0'
      })
    )

    expect(candidates).toEqual([
      {
        provider: 'package-manager',
        label: 'package manager',
        files: ['pnpm-lock.yaml'],
        setup: 'pnpm install',
        unsupportedFields: []
      }
    ])
  })

  it('uses packageManager when no lockfile is present', async () => {
    const candidates = await inspectSetupScriptImportCandidates(
      makeReader({
        'package.json': JSON.stringify({ packageManager: 'bun@1.2.0' })
      })
    )

    expect(candidates).toEqual([
      {
        provider: 'package-manager',
        label: 'package manager',
        files: ['package.json'],
        setup: 'bun install',
        unsupportedFields: []
      }
    ])
  })

  it('uses explicit packageManager over conflicting lockfiles', async () => {
    const candidates = await inspectSetupScriptImportCandidates(
      makeReader({
        'package.json': JSON.stringify({ packageManager: 'pnpm@9.15.0' }),
        'package-lock.json': '{}'
      })
    )

    expect(candidates).toEqual([
      {
        provider: 'package-manager',
        label: 'package manager',
        files: ['package.json'],
        setup: 'pnpm install',
        unsupportedFields: []
      }
    ])
  })

  it('does not suggest a package-manager setup without a valid package.json', async () => {
    const candidates = await inspectSetupScriptImportCandidates(
      makeReader({
        'package.json': '{',
        'pnpm-lock.yaml': 'lockfileVersion: 9.0'
      })
    )

    expect(candidates).toEqual([])
  })

  it('does not guess between multiple lockfiles without packageManager', async () => {
    const candidates = await inspectSetupScriptImportCandidates(
      makeReader({
        'package.json': JSON.stringify({ scripts: { dev: 'vite' } }),
        'pnpm-lock.yaml': 'lockfileVersion: 9.0',
        'package-lock.json': '{}'
      })
    )

    expect(candidates).toEqual([])
  })

  it('allows multiple lockfiles for the same package manager family', async () => {
    const candidates = await inspectSetupScriptImportCandidates(
      makeReader({
        'package.json': JSON.stringify({ scripts: { dev: 'vite' } }),
        'package-lock.json': '{}',
        'npm-shrinkwrap.json': '{}'
      })
    )

    expect(candidates).toEqual([
      {
        provider: 'package-manager',
        label: 'package manager',
        files: ['package-lock.json'],
        setup: 'npm install',
        unsupportedFields: []
      }
    ])
  })

  it('imports setup and archive commands from Conductor config', async () => {
    const candidates = await inspectSetupScriptImportCandidates(
      makeReader({
        'conductor.json': JSON.stringify({
          scripts: {
            setup: 'pnpm install',
            archive: 'pnpm clean',
            run: 'pnpm dev'
          },
          runScriptMode: 'manual'
        })
      })
    )

    expect(candidates).toEqual([
      {
        provider: 'conductor',
        label: 'Conductor',
        files: ['conductor.json'],
        setup: 'pnpm install',
        archive: 'pnpm clean',
        unsupportedFields: ['runScriptMode', 'scripts.run']
      }
    ])
  })

  it('imports setup and cleanup scripts from Codex environment config', async () => {
    const candidates = await inspectSetupScriptImportCandidates(
      makeReader({
        '.codex/environments/environment.toml': `
[setup]
script = """
npm ci
pnpm build
"""

[cleanup]
script = "pnpm clean"

[actions.test]
command = "pnpm test"
`
      })
    )

    expect(candidates).toEqual([
      {
        provider: 'codex',
        label: 'Codex environment',
        files: ['.codex/environments/environment.toml'],
        setup: 'npm ci\npnpm build',
        archive: 'pnpm clean',
        unsupportedFields: ['[actions.test]']
      }
    ])
  })

  it('ignores malformed or setup-less configs', async () => {
    const candidates = await inspectSetupScriptImportCandidates(
      makeReader({
        '.superset/config.json': '{',
        'conductor.json': JSON.stringify({ scripts: { run: 'pnpm dev' } }),
        '.codex/environments/environment.toml': '[cleanup]\nscript = "pnpm clean"',
        '.cmux/cmux.json': JSON.stringify({
          commands: [{ name: 'Build', keywords: ['build'], command: 'pnpm build' }]
        })
      })
    )

    expect(candidates).toEqual([])
  })
})
