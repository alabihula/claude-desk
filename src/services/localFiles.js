const EXPORT_EXTENSIONS = 'md|markdown|txt|pdf|doc|docx|xls|xlsx|csv|tsv|ppt|pptx|json|ya?ml|xml|html?|zip|tar|gz|tgz|7z|png|jpe?g|webp|gif|svg|mp3|wav|mp4|mov|sql|log'
const ANY_FILE_EXTENSIONS = `${EXPORT_EXTENSIONS}|js|jsx|ts|tsx|vue|css|scss|less|py|rs|java|go|sh|bash`

function decodePath(value) {
  try { return decodeURIComponent(value) } catch { return value }
}

function cleanPath(value) {
  const decoded = decodePath(value.trim().replace(/^file:\/\//, ''))
  return decoded.replace(/^[<"']+|[>"'，。；;,)）\]}]+$/g, '').trim()
}

function isDownloadCandidate(value) {
  if (!value || /[\r\n]/.test(value)) return false
  if (value.startsWith('/')) return new RegExp(`\.(${ANY_FILE_EXTENSIONS})$`, 'i').test(value)
  return !/^(?:https?:)?\/\//i.test(value)
    && !/[<>:"|?*]/.test(value)
    && new RegExp(`\.(${EXPORT_EXTENSIONS})$`, 'i').test(value)
}

export function extractLocalFileCandidates(content = '') {
  const matches = []
  const add = (raw, index) => {
    const path = cleanPath(raw)
    if (isDownloadCandidate(path)) matches.push({ path, index })
  }

  for (const match of content.matchAll(/`([^`\n]+)`/g)) add(match[1], match.index)
  for (const match of content.matchAll(/\[[^\]]*\]\((file:\/\/[^)\n]+|\/[^)\n]+|\.\.?\/[^)\n]+)\)/g)) add(match[1], match.index)

  const absoluteFile = new RegExp(`((?:/Users|/Volumes|/private|/tmp)/[^\n\u0060]+?\.(${ANY_FILE_EXTENSIONS}))(?=$|[\\s，。；;,)）\\]】])`, 'gim')
  for (const match of content.matchAll(absoluteFile)) add(match[1], match.index)

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

export function fileSelectionPrompt(path, content, start, end, reference = '') {
  const range = selectionLineRange(content, start, end)
  if (!range) return ''
  const selected = content.slice(start, end)
  const longestFence = Math.max(0, ...[...selected.matchAll(/`+/g)].map((match) => match[0].length))
  const fence = '`'.repeat(Math.max(3, longestFence + 1))
  const fallback = `${path}:${range.startLine}${range.startLine === range.endLine ? '' : `-${range.endLine}`}`
  return `${reference || fallback}\n\n${fence}\n${selected}\n${fence}`
}
