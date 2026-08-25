function decodePath(value) {
  try { return decodeURIComponent(value) } catch { return value }
}

function cleanPath(value) {
  const decoded = decodePath(value.trim().replace(/^file:\/\//, ''))
  return decoded.replace(/^[<"']+|[>"'，。；;,)）\]}]+$/g, '').trim()
}

function isDownloadCandidate(value) {
  if (!value || /[\r\n]/.test(value)) return false
  return !/^(?:(?:https?|mailto|javascript|data):|\/\/)/i.test(value)
    && !value.startsWith('#')
}

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif'])
const HTML_EXTENSIONS = new Set(['html', 'htm'])
const TEXT_EXTENSIONS = new Set([
  'bash', 'c', 'cc', 'conf', 'config', 'cpp', 'cs', 'css', 'csv', 'env', 'fish', 'go',
  'gql', 'graphql', 'h', 'hpp', 'ini', 'java', 'js', 'json', 'jsonc', 'jsx', 'kt', 'kts',
  'less', 'log', 'lua', 'md', 'markdown', 'php', 'properties', 'py', 'rb', 'rs', 'sass',
  'scss', 'sh', 'sql', 'svelte', 'swift', 'toml', 'ts', 'tsx', 'txt', 'vue', 'xml', 'yaml',
  'yml', 'zsh',
])
const TEXT_FILENAMES = new Set(['dockerfile', 'license', 'makefile', 'readme'])

export function localProjectLink(target) {
  const href = target?.closest?.('a[href]')?.getAttribute('href')
  if (!href) return null
  const path = cleanPath(href)
  return isDownloadCandidate(path) ? path : null
}

export function projectFileOpenMode(name = '') {
  const filename = String(name).toLowerCase()
  const extension = filename.includes('.') ? filename.split('.').pop() : ''
  if (IMAGE_EXTENSIONS.has(extension)) return 'image'
  if (HTML_EXTENSIONS.has(extension)) return 'html'
  if (TEXT_EXTENSIONS.has(extension) || TEXT_FILENAMES.has(filename)) return 'text'
  return 'reveal'
}

export function extractLocalFileCandidates(content = '') {
  const matches = []
  const add = (raw, index) => {
    const path = cleanPath(raw)
    if (isDownloadCandidate(path)) matches.push({ path, index })
  }

  // A download card is an explicit product affordance, not a guess based on a
  // path mentioned while Claude reads or edits the project.
  for (const match of content.matchAll(/\[([^\]\n]+)\]\(([^)\n]+)\)/g)) {
    if (/(?:下载|\bdownload\b)/i.test(match[1])) add(match[2], match.index)
  }

  const candidates = []
  for (const match of matches.sort((left, right) => left.index - right.index)) {
    if (!candidates.includes(match.path)) candidates.push(match.path)
  }
  return candidates.slice(0, 20)
}

export function extractProjectFileReferences(content = '') {
  const matches = content.matchAll(/(?:^|[^\w@./-])((?:src|app|packages|tests?|components|lib)\/[\w@./-]+\.[A-Za-z0-9]+)(?::(\d+))?/g)
  return [...new Map([...matches].map((match) => [
    `${match[1]}:${match[2] || ''}`,
    { path: match[1], line: match[2] ? Number(match[2]) : null },
  ])).values()]
}

export function formatFileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`
  return `${(bytes / 1024 ** 2).toFixed(bytes < 10 * 1024 ** 2 ? 1 : 0)} MB`
}

export function selectionLineRange(content, start, end) {
  const safeStart = Math.max(0, Math.min(Number(start) || 0, content.length))
  const safeEnd = Math.max(safeStart, Math.min(Number(end) || 0, content.length))
  if (safeStart === safeEnd) return null
  const startLine = content.slice(0, safeStart).split('\n').length
  const endLine = content.slice(0, Math.max(safeStart, safeEnd - 1)).split('\n').length
  return { startLine, endLine }
}

export function fileSelectionSnippet(path, content, start, end) {
  const range = selectionLineRange(content, start, end)
  if (!range) return null
  return {
    path,
    startLine: range.startLine,
    endLine: range.endLine,
    content: content.slice(start, end),
  }
}

export function fileSelectionsPrompt(content, snippets = []) {
  if (!snippets.length) return content
  const blocks = snippets.map((snippet) => {
    const selected = String(snippet.content || '')
    const longestFence = Math.max(0, ...[...selected.matchAll(/`+/g)].map((match) => match[0].length))
    const fence = '`'.repeat(Math.max(3, longestFence + 1))
    const path = String(snippet.path || '').replace(/[\r\n]+/g, ' ')
    const lines = snippet.startLine === snippet.endLine
      ? `line ${snippet.startLine}`
      : `lines ${snippet.startLine}-${snippet.endLine}`
    return `File: ${path} (${lines})\n${fence}\n${selected}\n${fence}`
  })
  return [content.trim(), `Selected project file context:\n\n${blocks.join('\n\n')}`].filter(Boolean).join('\n\n')
}
