import { describe, expect, it } from 'vitest'
import { diagnosticMessage, parseDiagnosticMessage, isClaudeStartupError, isUnsupportedMediaError } from './diagnostics'

describe('Claude diagnostics messages', () => {
  it('recognizes only backend startup errors, not provider errors or quoted text', () => {
    expect(isClaudeStartupError('Claude Code not found: `claude`. Detected PATH: private')).toBe(true)
    expect(isClaudeStartupError(new Error("Claude couldn't start: No such file or directory"))).toBe(true)
    expect(isClaudeStartupError('Claude Code command resolves to Claude Desk itself.')).toBe(true)
    expect(isClaudeStartupError('API Error: 400 Model do not support image input')).toBe(false)
    expect(isClaudeStartupError('API Error: 401 Unauthorized')).toBe(false)
    expect(isClaudeStartupError('Explanation: Claude Code not found: example')).toBe(false)
  })

  it('round-trips supported diagnostic markers', () => {
    const content = diagnosticMessage('empty-response', 'run-123')
    expect(parseDiagnosticMessage(content)).toEqual({ kind: 'empty-response', runId: 'run-123' })
  })

  it('recognizes provider media failures without treating unrelated errors as media rejection', () => {
    expect(isUnsupportedMediaError('API Error: 400 Model only support text input')).toBe(true)
    expect(isUnsupportedMediaError('This model does not support image input')).toBe(true)
    expect(isUnsupportedMediaError('API Error: 400 Model do not support image input. Request id: test')).toBe(true)
    expect(isUnsupportedMediaError("Model doesn't support images")).toBe(true)
    expect(isUnsupportedMediaError("Models don't support multimodal input")).toBe(true)
    expect(isUnsupportedMediaError('API Error: 429 overloaded')).toBe(false)
    expect(parseDiagnosticMessage(diagnosticMessage('unsupported-media', 'run-1'))?.kind).toBe('unsupported-media')
  })

  it('rejects unknown kinds and unsafe run identifiers', () => {
    expect(diagnosticMessage('other', 'run-123')).toBe('')
    expect(diagnosticMessage('run-error', '../private')).toBe('')
    expect(parseDiagnosticMessage('claude-desk:diagnostic:run-error:../private')).toBeNull()
  })
})
