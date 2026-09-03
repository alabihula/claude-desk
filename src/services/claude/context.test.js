import { describe, expect, it } from 'vitest'
import { contextForModel, contextStatus, inferredContextWindow, shouldAutoCompact } from './context'

describe('Claude context status', () => {
  it('triggers proactive compaction at the exact configured threshold', () => {
    const current = { tokens: 170000, window: 200000, source: 'claude-transcript' }
    const env = { CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: '85' }

    expect(contextStatus(current, env)).toMatchObject({ measured: true, percentage: 85, threshold: 85 })
    expect(shouldAutoCompact(current, env)).toBe(true)
  })

  it('does not use rounded display percentages to compact early', () => {
    const current = { tokens: 169000, window: 200000, source: 'claude-transcript' }
    const env = { CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: '85' }

    expect(contextStatus(current, env).percentage).toBe(85)
    expect(shouldAutoCompact(current, env)).toBe(false)
  })

  it('ignores cumulative or unmeasured token usage', () => {
    expect(shouldAutoCompact({ cumulativeTokens: 190000, window: 200000 }, {})).toBe(false)
    expect(shouldAutoCompact({ tokens: 190000, window: 200000, estimated: true }, {})).toBe(false)
  })

  it('honors both current and legacy Claude compaction disable flags', () => {
    const current = { tokens: 190000, window: 200000, source: 'claude-transcript' }

    expect(shouldAutoCompact(current, { DISABLE_AUTO_COMPACT: '1' })).toBe(false)
    expect(shouldAutoCompact(current, { DISABLE_COMPACT: '1' })).toBe(false)
  })

  it('recalculates against a cached target-model window', () => {
    const current = {
      tokens: 186000,
      window: 200000,
      model: 'model-a',
      modelWindows: { 'model-a': 200000, 'model-b': 1000000 },
      source: 'claude-transcript',
    }

    expect(contextStatus(current, {}, 'model-b')).toMatchObject({
      model: 'model-b', window: 1000000, percentage: 19, windowPending: false,
    })
    expect(shouldAutoCompact(current, {}, 'model-b')).toBe(false)
  })

  it('marks an unseen custom model window pending instead of reusing the previous model', () => {
    const current = {
      tokens: 186000, window: 200000, model: 'model-a', source: 'claude-transcript',
    }

    expect(contextForModel(current, 'custom-model-b')).toMatchObject({
      model: 'custom-model-b', window: 0, windowPending: true,
    })
    expect(shouldAutoCompact(current, {}, 'custom-model-b')).toBe(false)
  })

  it('recognizes the explicit extended-context model suffix immediately', () => {
    expect(inferredContextWindow('sonnet[1m]')).toBe(1000000)
    expect(contextStatus({
      tokens: 186000, window: 200000, model: 'sonnet', source: 'claude-transcript',
    }, {}, 'sonnet[1m]')).toMatchObject({ window: 1000000, percentage: 19, windowPending: false })
  })

  it('treats an explicit context-window setting as authoritative for a new model', () => {
    expect(contextStatus({
      tokens: 186000, window: 200000, model: 'model-a', source: 'claude-transcript',
    }, { CLAUDE_CODE_AUTO_COMPACT_WINDOW: '1000000' }, 'model-b')).toMatchObject({
      window: 1000000, percentage: 19, windowPending: false,
    })
  })
})
