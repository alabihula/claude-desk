const DIAGNOSTIC_PREFIX = 'claude-desk:diagnostic:'
const DIAGNOSTIC_PATTERN = /^claude-desk:diagnostic:(empty-response|run-error|unsupported-media):([a-zA-Z0-9-]+)$/

export function isUnsupportedMediaError(message = '') {
  return /only supports? text input|does(?: not|n't) support images?|image input is not supported|does not support multimodal/i.test(String(message))
}

export function diagnosticMessage(kind, runId) {
  if (!['empty-response', 'run-error', 'unsupported-media'].includes(kind) || !/^[a-zA-Z0-9-]+$/.test(runId || '')) return ''
  return `${DIAGNOSTIC_PREFIX}${kind}:${runId}`
}

export function parseDiagnosticMessage(content = '') {
  const match = String(content).match(DIAGNOSTIC_PATTERN)
  return match ? { kind: match[1], runId: match[2] } : null
}
