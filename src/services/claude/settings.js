const CONNECTION_KEYS = [
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_MODEL',
  'DISABLE_AUTO_COMPACT',
  'CLAUDE_AUTOCOMPACT_PCT_OVERRIDE',
  'CLAUDE_CODE_AUTO_COMPACT_WINDOW',
]

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function modelFromArgs(args = []) {
  const index = args.findIndex((value) => value === '--model')
  return index >= 0 ? args[index + 1] || '' : ''
}

export function configuredModel(settings, legacy = {}) {
  const config = object(settings)
  const env = object(config.env)
  const legacyEnv = object(legacy.env)
  return config.model || env.ANTHROPIC_MODEL || legacyEnv.ANTHROPIC_MODEL || modelFromArgs(legacy.args) || ''
}

export function visualFromClaudeSettings(settings, legacy = {}) {
  const config = object(settings)
  const env = object(config.env)
  const legacyEnv = object(legacy.env)
  const baseUrl = env.ANTHROPIC_BASE_URL || legacyEnv.ANTHROPIC_BASE_URL || ''
  const customEndpoint = Boolean(baseUrl)
  return {
    baseUrl,
    token: (customEndpoint ? env.ANTHROPIC_AUTH_TOKEN : env.ANTHROPIC_API_KEY)
      || env.ANTHROPIC_AUTH_TOKEN
      || env.ANTHROPIC_API_KEY
      || legacyEnv.ANTHROPIC_AUTH_TOKEN
      || legacyEnv.ANTHROPIC_API_KEY
      || '',
    model: configuredModel(config, legacy),
    autoCompact: (env.DISABLE_AUTO_COMPACT || legacyEnv.DISABLE_AUTO_COMPACT) !== '1',
    compactThreshold: env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE || legacyEnv.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE || 'default',
    contextWindow: env.CLAUDE_CODE_AUTO_COMPACT_WINDOW || legacyEnv.CLAUDE_CODE_AUTO_COMPACT_WINDOW || '',
  }
}

export function applyVisualClaudeSettings(settings, visual) {
  const config = JSON.parse(JSON.stringify(object(settings)))
  const env = { ...object(config.env) }
  const baseUrl = visual.baseUrl.trim()
  const token = visual.token.trim()
  const model = visual.model.trim()

  if (baseUrl) env.ANTHROPIC_BASE_URL = baseUrl
  else delete env.ANTHROPIC_BASE_URL

  delete env.ANTHROPIC_AUTH_TOKEN
  delete env.ANTHROPIC_API_KEY
  if (token) env[baseUrl ? 'ANTHROPIC_AUTH_TOKEN' : 'ANTHROPIC_API_KEY'] = token

  if (baseUrl) {
    delete config.model
    if (model) env.ANTHROPIC_MODEL = model
    else delete env.ANTHROPIC_MODEL
  } else {
    delete env.ANTHROPIC_MODEL
    if (model) config.model = model
    else delete config.model
  }

  if (visual.autoCompact) delete env.DISABLE_AUTO_COMPACT
  else env.DISABLE_AUTO_COMPACT = '1'
  if (visual.compactThreshold && visual.compactThreshold !== 'default') env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE = String(visual.compactThreshold)
  else delete env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE
  if (String(visual.contextWindow || '').trim()) env.CLAUDE_CODE_AUTO_COMPACT_WINDOW = String(visual.contextWindow).trim()
  else delete env.CLAUDE_CODE_AUTO_COMPACT_WINDOW

  if (Object.keys(env).length) config.env = env
  else delete config.env
  return config
}

export function removeMigratedLegacySettings(settings) {
  const env = { ...object(settings.env) }
  for (const key of CONNECTION_KEYS) delete env[key]
  const args = []
  for (let index = 0; index < (settings.args || []).length; index += 1) {
    if (settings.args[index] === '--model') { index += 1; continue }
    args.push(settings.args[index])
  }
  return { ...settings, args, env }
}
