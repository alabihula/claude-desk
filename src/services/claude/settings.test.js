import { describe, expect, it } from 'vitest'
import { applyVisualClaudeSettings, removeMigratedLegacySettings, visualFromClaudeSettings } from './settings'

describe('Claude settings mapping', () => {
  it('maps a custom gateway without dropping unrelated settings', () => {
    const original = { theme: 'dark', env: { OTEL_LOGS_EXPORTER: 'none' }, permissions: { allow: ['Read'] } }
    const next = applyVisualClaudeSettings(original, {
      baseUrl: 'https://gateway.example.com', token: 'secret', model: 'kimi-latest',
      autoCompact: true, compactThreshold: '85', contextWindow: '128000',
    })
    expect(next).toMatchObject({
      theme: 'dark', permissions: { allow: ['Read'] },
      env: {
        OTEL_LOGS_EXPORTER: 'none', ANTHROPIC_BASE_URL: 'https://gateway.example.com',
        ANTHROPIC_AUTH_TOKEN: 'secret', ANTHROPIC_MODEL: 'kimi-latest',
        CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: '85', CLAUDE_CODE_AUTO_COMPACT_WINDOW: '128000',
      },
    })
    expect(next.model).toBeUndefined()
  })

  it('uses API key and top-level model for the official endpoint', () => {
    const next = applyVisualClaudeSettings({ env: { ANTHROPIC_AUTH_TOKEN: 'old', ANTHROPIC_MODEL: 'old' } }, {
      baseUrl: '', token: 'api-key', model: 'sonnet', autoCompact: false,
      compactThreshold: 'default', contextWindow: '',
    })
    expect(next).toEqual({ model: 'sonnet', env: { ANTHROPIC_API_KEY: 'api-key', DISABLE_AUTO_COMPACT: '1' } })
  })

  it('reads legacy values and removes only migrated legacy keys', () => {
    const legacy = { args: ['--verbose', '--model', 'sonnet'], env: { ANTHROPIC_BASE_URL: 'https://old', KEEP_ME: 'yes' } }
    expect(visualFromClaudeSettings({}, legacy)).toMatchObject({ baseUrl: 'https://old', model: 'sonnet' })
    expect(removeMigratedLegacySettings(legacy)).toEqual({ args: ['--verbose'], env: { KEEP_ME: 'yes' } })
  })
})
