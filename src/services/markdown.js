import MarkdownIt from 'markdown-it'

const LANGUAGE_LABELS = {
  bash: 'Bash', css: 'CSS', html: 'HTML', js: 'JavaScript', javascript: 'JavaScript',
  json: 'JSON', markdown: 'Markdown', md: 'Markdown', sh: 'Shell', sql: 'SQL',
  ts: 'TypeScript', typescript: 'TypeScript', vue: 'Vue', xml: 'XML', yaml: 'YAML', yml: 'YAML',
}

function codeBlockLabel(info = '', fallback = 'Code') {
  const language = info.trim().split(/\s+/)[0].toLowerCase()
  return LANGUAGE_LABELS[language] || language || fallback
}

function wrapCodeBlock(rendered, token, markdown, labels) {
  const label = markdown.utils.escapeHtml(codeBlockLabel(token.info, labels.code))
  return `<div class="code-block"><div class="code-block-toolbar"><span>${label}</span><button type="button" class="code-copy-button" data-copy-code aria-label="${markdown.utils.escapeHtml(labels.copyAria)}">${markdown.utils.escapeHtml(labels.copy)}</button></div>${rendered}</div>`
}

export function createMessageMarkdown(labels = {}) {
  const resolvedLabels = { code: 'Code', copy: 'Copy', copyAria: 'Copy code', ...labels }
  const markdown = new MarkdownIt({ html: false, linkify: true, breaks: true })
  const renderFence = markdown.renderer.rules.fence
  const renderCodeBlock = markdown.renderer.rules.code_block

  markdown.renderer.rules.fence = (tokens, index, options, env, self) => (
    wrapCodeBlock(renderFence(tokens, index, options, env, self), tokens[index], markdown, resolvedLabels)
  )
  markdown.renderer.rules.code_block = (tokens, index, options, env, self) => (
    wrapCodeBlock(renderCodeBlock(tokens, index, options, env, self), tokens[index], markdown, resolvedLabels)
  )
  return markdown
}

export function codeCopyPayload(target) {
  const button = target?.closest?.('[data-copy-code]')
  const code = button?.closest('.code-block')?.querySelector('pre code')
  return button && code ? { button, text: code.textContent || '' } : null
}

export function externalHttpUrl(target) {
  const href = target?.closest?.('a[href]')?.getAttribute('href')
  if (!href) return null
  try {
    const url = new URL(href)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
}

export async function writeClipboardText(text, clipboard = globalThis.navigator?.clipboard) {
  if (clipboard?.writeText) return clipboard.writeText(text)

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.style.cssText = 'position:fixed;left:-9999px;opacity:0'
  document.body.appendChild(textarea)
  textarea.select()
  const copied = document.execCommand?.('copy')
  textarea.remove()
  if (!copied) throw new Error('Clipboard access is unavailable.')
}
