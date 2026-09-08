import { describe, expect, it } from 'vitest'
import { applyResponseTextEvent as apply } from './responseText'

describe('response message boundaries', () => {
  it('joins deltas verbatim but separates assistant messages and deduplicates full frames', () => {
    const run = { content: '' }
    apply(run, { type: 'message-start', messageId: 'a' })
    apply(run, { type: 'text', text: 'Checking ' })
    apply(run, { type: 'text', text: 'files.' })
    apply(run, { type: 'full-text', messageId: 'a', text: 'Checking files.' })
    apply(run, { type: 'message-start', messageId: 'b' })
    apply(run, { type: 'text', text: 'Done.' })
    apply(run, { type: 'full-text', messageId: 'b', text: 'Done.' })
    expect(run.content).toBe('Checking files.\n\nDone.')
  })
  it('preserves multiple non-streamed messages and handles late full frames by identity', () => {
    const run = { content: '' }
    apply(run, { type: 'full-text', messageId: 'a', text: 'First' })
    apply(run, { type: 'full-text', messageId: 'b', text: 'Second' })
    apply(run, { type: 'full-text', messageId: 'a', text: 'First complete' })
    expect(run.content).toBe('First complete\n\nSecond')
  })
  it('keeps fallback frames deduplicated and ignores unrelated or empty events', () => {
    const run = { content: '' }
    expect(apply(run, { type: 'result' })).toBe(false)
    apply(run, { type: 'text', text: 'hello' })
    apply(run, { type: 'full-text', text: 'hello' })
    apply(run, { type: 'text', text: '' })
    expect(run.content).toBe('hello')
  })
})
