import { describe, expect, it } from 'vitest'
import { contextStatus, shouldAutoCompact } from './context'

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
})
