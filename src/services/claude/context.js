const DEFAULT_COMPACT_THRESHOLD = 95
const EXTENDED_CONTEXT_SUFFIX = /\[1m\]$/i

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

export function contextModelKey(model) {
  return String(model || '').trim()
}

export function inferredContextWindow(model) {
  return EXTENDED_CONTEXT_SUFFIX.test(contextModelKey(model)) ? 1_000_000 : 0
}

export function contextForModel(current = {}, model = '') {
  const targetModel = contextModelKey(model)
  const currentModel = contextModelKey(current.model)
  const cachedWindow = positiveNumber(current.modelWindows?.[targetModel])
  const inferredWindow = inferredContextWindow(targetModel)
  const modelChanged = targetModel !== currentModel
  const window = modelChanged
    ? cachedWindow || inferredWindow
    : positiveNumber(current.window) || cachedWindow || inferredWindow

  return {
    ...current,
    model: targetModel,
    window,
    windowPending: Boolean(!window && (modelChanged || current.windowPending)),
  }
}

export function contextStatus(current = {}, env = {}, model = current.model) {
  const selected = contextForModel(current, model)
  const configuredWindow = positiveNumber(env.CLAUDE_CODE_AUTO_COMPACT_WINDOW)
  const window = positiveNumber(selected.window) || configuredWindow
  const reportedTokens = positiveNumber(selected.tokens)
  // Historical versions stored cumulative run usage as an estimated context
  // value. It must remain informational and never trigger a compaction.
  const cumulativeTokens = positiveNumber(selected.cumulativeTokens || (selected.estimated ? reportedTokens : 0))
  const measured = Boolean(
    (selected.measured || selected.source === 'claude-transcript')
      && !selected.estimated
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
    source: selected.source || '',
    model: selected.model,
    modelWindows: selected.modelWindows || {},
    // An explicit window override is authoritative for every model, so there
    // is nothing left to discover from the provider in that configuration.
    windowPending: Boolean(selected.windowPending && !configuredWindow),
    percentage: measured && window ? Math.round((reportedTokens / window) * 100) : 0,
    autoCompact: env.DISABLE_AUTO_COMPACT !== '1' && env.DISABLE_COMPACT !== '1',
    threshold,
    lastCompactedAt: selected.lastCompactedAt || null,
  }
}

export function shouldAutoCompact(current = {}, env = {}, model = current.model) {
  const status = contextStatus(current, env, model)
  return status.autoCompact
    && status.measured
    && status.window > 0
    && (status.tokens / status.window) * 100 >= status.threshold
}
