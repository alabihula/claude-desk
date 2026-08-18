import { describe, expect, it } from 'vitest'
import { diagnosticMessage, parseDiagnosticMessage } from './diagnostics'

describe('Claude diagnostics messages', () => {
  it('round-trips supported diagnostic markers', () => {
    const content = diagnosticMessage('empty-response', 'run-123')
    expect(parseDiagnosticMessage(content)).toEqual({ kind: 'empty-response', runId: 'run-123' })
  })

  it('rejects unknown kinds and unsafe run identifiers', () => {
    expect(diagnosticMessage('other', 'run-123')).toBe('')
    expect(diagnosticMessage('run-error', '../private')).toBe('')
    expect(parseDiagnosticMessage('claude-desk:diagnostic:run-error:../private')).toBeNull()
  })
})
