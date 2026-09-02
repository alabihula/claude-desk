const DEFAULT_COMPACT_THRESHOLD = 95

function positiveNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : 0
}

function compactThreshold(value) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 && number <= 100
    ? number
    : DEFAULT_COMPACT_THRESHOLD
}

export function contextStatus(current = {}, env = {}) {
  const window = positiveNumber(current.window || env.CLAUDE_CODE_AUTO_COMPACT_WINDOW)
  const reportedTokens = positiveNumber(current.tokens)
  // Historical versions stored cumulative run usage as an estimated context
  // value. It must remain informational and never trigger a compaction.
  const cumulativeTokens = positiveNumber(current.cumulativeTokens || (current.estimated ? reportedTokens : 0))
  const measured = Boolean(
    (current.measured || current.source === 'claude-transcript')
      && !current.estimated
      && reportedTokens
      && (!window || reportedTokens <= window),
  )
  const threshold = compactThreshold(env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE)

  return {
    tokens: measured ? reportedTokens : 0,
    window,
    measured,
    estimated: false,
    cumulativeTokens,
    source: current.source || '',
    percentage: measured && window ? Math.round((reportedTokens / window) * 100) : 0,
    autoCompact: env.DISABLE_AUTO_COMPACT !== '1' && env.DISABLE_COMPACT !== '1',
    threshold,
    lastCompactedAt: current.lastCompactedAt || null,
  }
}

export function shouldAutoCompact(current = {}, env = {}) {
  const status = contextStatus(current, env)
  return status.autoCompact
    && status.measured
    && status.window > 0
    && (status.tokens / status.window) * 100 >= status.threshold
}
