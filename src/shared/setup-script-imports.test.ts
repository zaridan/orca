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
        '.codex/environments/environment.toml': '[cleanup]\nscript = "pnpm clean"'
      })
    )

    expect(candidates).toEqual([])
  })
})
