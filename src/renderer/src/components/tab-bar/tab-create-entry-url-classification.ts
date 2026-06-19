import { translate } from '@/i18n/i18n'

const HOST_FILE_EXTENSIONS = new Set([
  'css',
  'html',
  'js',
  'jsx',
  'json',
  'md',
  'py',
  'toml',
  'ts',
  'tsx',
  'yaml',
  'yml'
])

const LOCAL_ADDRESS_PATTERN =
  /^(?:localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[[0-9a-f:]+\])(?::\d+)?(?:[/?#].*)?$/i

export type ExplicitUrlClassification =
  | { kind: 'blocked'; message: string }
  | { kind: 'explicit-url'; url: string }

export type HostUrlClassification = { kind: 'host-url'; url: string }

export function classifyExplicitUrl(query: string): ExplicitUrlClassification | null {
  if (LOCAL_ADDRESS_PATTERN.test(query)) {
    return null
  }
  let url: URL
  try {
    url = new URL(query)
  } catch {
    return null
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname) {
    return {
      kind: 'blocked',
      message: translate(
        'auto.components.tab.bar.tab.create.entry.classifier.90eb94dc48',
        'Enter an http:// or https:// URL.'
      )
    }
  }
  return { kind: 'explicit-url', url: url.href }
}

function classifyLocalDevUrl(query: string): HostUrlClassification | null {
  if (!LOCAL_ADDRESS_PATTERN.test(query)) {
    return null
  }
  try {
    const url = new URL(`http://${query}`)
    return url.hostname ? { kind: 'host-url', url: url.href } : null
  } catch {
    return null
  }
}

function classifyHostLikeUrl(query: string): HostUrlClassification | null {
  if (/[\\/]/.test(query) || /\s/.test(query)) {
    return null
  }
  const extension = query.split(':')[0]?.split('.').pop()?.toLowerCase() ?? ''
  if (HOST_FILE_EXTENSIONS.has(extension)) {
    return null
  }
  const hostPort = '(?::\\d{1,5})?'
  const localhost = new RegExp(`^localhost${hostPort}$`, 'i')
  const ipv4 = new RegExp(`^(?:\\d{1,3}\\.){3}\\d{1,3}${hostPort}$`)
  const domain = new RegExp(
    `^(?=.{1,253}${hostPort}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z]{2,}${hostPort}$`,
    'i'
  )
  if (!localhost.test(query) && !ipv4.test(query) && !domain.test(query)) {
    return null
  }
  try {
    const url = new URL(`https://${query}`)
    return url.hostname ? { kind: 'host-url', url: url.href } : null
  } catch {
    return null
  }
}

export function classifyHostUrl(query: string): HostUrlClassification | null {
  return classifyLocalDevUrl(query) ?? classifyHostLikeUrl(query)
}
