import { describe, expect, it } from 'vitest'
import { diagnosticMessage, parseDiagnosticMessage, isUnsupportedMediaError } from './diagnostics'

describe('Claude diagnostics messages', () => {
  it('round-trips supported diagnostic markers', () => {
    const content = diagnosticMessage('empty-response', 'run-123')
    expect(parseDiagnosticMessage(content)).toEqual({ kind: 'empty-response', runId: 'run-123' })
  })

  it('recognizes provider media failures without treating unrelated errors as media rejection', () => {
    expect(isUnsupportedMediaError('API Error: 400 Model only support text input')).toBe(true)
    expect(isUnsupportedMediaError('This model does not support image input')).toBe(true)
    expect(isUnsupportedMediaError('API Error: 429 overloaded')).toBe(false)
    expect(parseDiagnosticMessage(diagnosticMessage('unsupported-media', 'run-1'))?.kind).toBe('unsupported-media')
  })

  it('rejects unknown kinds and unsafe run identifiers', () => {
    expect(diagnosticMessage('other', 'run-123')).toBe('')
    expect(diagnosticMessage('run-error', '../private')).toBe('')
    expect(parseDiagnosticMessage('claude-desk:diagnostic:run-error:../private')).toBeNull()
  })
})
