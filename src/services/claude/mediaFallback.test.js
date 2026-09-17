import { describe, expect, it } from 'vitest'
import { canRecoverMedia, mediaFallbackRequest } from './mediaFallback'

describe('media fallback', () => {
  const request = { sessionId: 'session', model: 'text-only', permissionMode: 'manual', prompt: 'original task', resume: false }
  const rejected = { operation: 'chat', status: 'error', diagnosticKind: 'unsupported-media', request }

  it('continues the same session once without replaying the attachment prompt', () => {
    const fallback = mediaFallbackRequest(request)
    expect(canRecoverMedia(rejected)).toBe(true)
    expect(fallback).toMatchObject({ sessionId: 'session', model: 'text-only', permissionMode: 'manual', resume: true, recoverMedia: true })
    expect(fallback.prompt).not.toContain('original task')
    expect(canRecoverMedia({ ...rejected, request: fallback })).toBe(false)
    expect(request.resume).toBe(false)
  })

  it('does not retry stop, steer, compaction or unrelated errors', () => {
    for (const changes of [{ status: 'stopping' }, { status: 'interrupted' }, { status: 'steering' }, { operation: 'compact' }, { diagnosticKind: 'run-error' }, { request: null }]) {
      expect(canRecoverMedia({ ...rejected, ...changes })).toBe(false)
    }
  })
})
