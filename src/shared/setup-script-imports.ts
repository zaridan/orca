export type SetupScriptImportProvider = 'superset' | 'conductor' | 'codex'

export type SetupScriptImportCandidate = {
  provider: SetupScriptImportProvider
  label: string
  files: string[]
  setup: string
  archive?: string
  unsupportedFields?: string[]
}

export type SetupScriptImportFileRead = (relativePath: string) => Promise<string | null>

const SUPERSET_CONFIG_PATH = '.superset/config.json'
const CONDUCTOR_CONFIG_PATH = 'conductor.json'
const CODEX_ENVIRONMENT_PATH = '.codex/environments/environment.toml'

export async function inspectSetupScriptImportCandidates(
  readFile: SetupScriptImportFileRead
): Promise<SetupScriptImportCandidate[]> {
  const candidates = await Promise.all([
    inspectSupersetConfig(readFile),
    inspectConductorConfig(readFile),
    inspectCodexEnvironmentConfig(readFile)
  ])
  return candidates.filter(
    (candidate): candidate is SetupScriptImportCandidate => candidate != null
  )
}

async function inspectSupersetConfig(
  readFile: SetupScriptImportFileRead
): Promise<SetupScriptImportCandidate | null> {
  const config = parseJsonObject(await readFile(SUPERSET_CONFIG_PATH))
  if (!config) {
    return null
  }

  const setup = normalizeCommandValue(config.setup)
  if (!setup) {
    return null
  }

  const unsupportedFields = collectUnsupportedFields(config, ['run'])
  collectUnsupportedScriptObjectFields(config.setup, 'setup', unsupportedFields)
  collectUnsupportedScriptObjectFields(config.teardown, 'teardown', unsupportedFields)

  return {
    provider: 'superset',
    label: 'Superset',
    files: [SUPERSET_CONFIG_PATH],
    setup,
    archive: normalizeCommandValue(config.teardown) || undefined,
    unsupportedFields
  }
}

async function inspectConductorConfig(
  readFile: SetupScriptImportFileRead
): Promise<SetupScriptImportCandidate | null> {
  const config = parseJsonObject(await readFile(CONDUCTOR_CONFIG_PATH))
  const scripts = asRecord(config?.scripts)
  if (!config || !scripts) {
    return null
  }

  const setup = normalizeCommandValue(scripts.setup)
  if (!setup) {
    return null
  }

  const unsupportedFields = collectUnsupportedFields(config, [
    'enterpriseDataPrivacy',
    'runScriptMode'
  ])
  for (const field of ['run', 'teardown'] as const) {
    if (normalizeCommandValue(scripts[field])) {
      unsupportedFields.push(`scripts.${field}`)
    }
  }

  return {
    provider: 'conductor',
    label: 'Conductor',
    files: [CONDUCTOR_CONFIG_PATH],
    setup,
    archive: normalizeCommandValue(scripts.archive) || undefined,
    unsupportedFields
  }
}

async function inspectCodexEnvironmentConfig(
  readFile: SetupScriptImportFileRead
): Promise<SetupScriptImportCandidate | null> {
  const content = await readFile(CODEX_ENVIRONMENT_PATH)
  if (!content) {
    return null
  }

  const parsed = parseCodexEnvironmentToml(content)
  const setup = parsed.setupScript?.trim()
  if (!setup) {
    return null
  }

  return {
    provider: 'codex',
    label: 'Codex environment',
    files: [CODEX_ENVIRONMENT_PATH],
    setup,
    archive: parsed.cleanupScript?.trim() || undefined,
    unsupportedFields: parsed.unsupportedFields
  }
}

function parseJsonObject(content: string | null): Record<string, unknown> | null {
  if (!content) {
    return null
  }
  try {
    return asRecord(JSON.parse(content))
  } catch {
    return null
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function normalizeCommandValue(value: unknown): string {
  if (typeof value === 'string') {
    return value.trim()
  }
  if (!Array.isArray(value)) {
    return ''
  }
  const commands = value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
  return commands.join('\n')
}

function collectUnsupportedFields(
  source: Record<string, unknown>,
  fieldNames: readonly string[]
): string[] {
  return fieldNames.filter((field) => source[field] !== undefined)
}

function collectUnsupportedScriptObjectFields(
  value: unknown,
  prefix: string,
  unsupportedFields: string[]
): void {
  const record = asRecord(value)
  if (!record) {
    return
  }
  for (const field of ['before', 'after'] as const) {
    if (record[field] !== undefined) {
      unsupportedFields.push(`${prefix}.${field}`)
    }
  }
}

type CodexEnvironmentToml = {
  setupScript?: string
  cleanupScript?: string
  unsupportedFields: string[]
}

function parseCodexEnvironmentToml(content: string): CodexEnvironmentToml {
  const lines = content.split(/\r?\n/)
  const unsupportedFields: string[] = []
  let section = ''
  let setupScript: string | undefined
  let cleanupScript: string | undefined

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]
    const trimmed = line.trim()
    if (/^actions\s*=/.test(trimmed)) {
      unsupportedFields.push('actions')
    }
    const sectionMatch = trimmed.match(/^\[([A-Za-z0-9_.-]+)\]\s*(?:#.*)?$/)
    if (sectionMatch) {
      section = sectionMatch[1]
      if (section === 'actions' || section.startsWith('actions.')) {
        unsupportedFields.push(`[${section}]`)
      }
      continue
    }

    if (section !== 'setup' && section !== 'cleanup') {
      continue
    }

    const assignment = line.match(/^\s*script\s*=\s*(.*)$/)
    if (!assignment) {
      continue
    }

    const parsed = parseTomlStringValue(lines, index, assignment[1])
    index = parsed.endLineIndex
    if (section === 'setup') {
      setupScript = parsed.value
    } else {
      cleanupScript = parsed.value
    }
  }

  return { setupScript, cleanupScript, unsupportedFields }
}

function parseTomlStringValue(
  lines: string[],
  startLineIndex: number,
  rawValue: string
): { value: string; endLineIndex: number } {
  const value = rawValue.trimStart()
  if (value.startsWith('"""') || value.startsWith("'''")) {
    const delimiter = value.startsWith('"""') ? '"""' : "'''"
    return parseTomlMultilineString(lines, startLineIndex, value.slice(3), delimiter)
  }
  if (value.startsWith('"')) {
    return { value: parseTomlBasicString(value), endLineIndex: startLineIndex }
  }
  if (value.startsWith("'")) {
    return { value: parseTomlLiteralString(value), endLineIndex: startLineIndex }
  }
  return { value: value.replace(/\s+#.*$/, '').trim(), endLineIndex: startLineIndex }
}

function parseTomlMultilineString(
  lines: string[],
  startLineIndex: number,
  firstLineRemainder: string,
  delimiter: '"""' | "'''"
): { value: string; endLineIndex: number } {
  let content = ''
  let remainder = firstLineRemainder
  for (let index = startLineIndex; index < lines.length; index++) {
    if (index > startLineIndex) {
      remainder = lines[index]
    }
    const closeIndex = remainder.indexOf(delimiter)
    if (closeIndex >= 0) {
      return {
        value: content + remainder.slice(0, closeIndex),
        endLineIndex: index
      }
    }
    content += `${remainder}\n`
  }
  return { value: content.trimEnd(), endLineIndex: lines.length - 1 }
}

function parseTomlBasicString(value: string): string {
  const raw = value.slice(0, findTomlStringEnd(value, '"') + 1)
  try {
    return JSON.parse(raw) as string
  } catch {
    return raw.slice(1, -1)
  }
}

function parseTomlLiteralString(value: string): string {
  const end = findTomlStringEnd(value, "'")
  return value.slice(1, end)
}

function findTomlStringEnd(value: string, quote: '"' | "'"): number {
  for (let index = 1; index < value.length; index++) {
    if (value[index] !== quote) {
      continue
    }
    if (quote === "'" || !isEscaped(value, index)) {
      return index
    }
  }
  return value.length - 1
}

function isEscaped(value: string, index: number): boolean {
  let slashCount = 0
  for (let cursor = index - 1; cursor >= 0 && value[cursor] === '\\'; cursor--) {
    slashCount++
  }
  return slashCount % 2 === 1
}
