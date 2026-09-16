import { describe, expect, it } from 'vitest'
import { mcpRows, mcpIssue, safeMcpDetail } from './mcpStatus'

describe('MCP availability evidence', () => {
  const config = [{ name: 'test', status: 'connected', detail: 'npx test' }]
  const runtime = (status, toolCount, source = 'live') => ({ source, servers: [{ name: 'test', status, toolCount }] })
  it('does not promote successful probes or startup snapshots to ready', () => {
    expect(mcpRows(config, null)[0].state).toBe('unconfirmed')
    expect(mcpRows(config, runtime('connected', 3, 'snapshot'))[0].state).toBe('unconfirmed')
  })
  it('distinguishes slow startup, unknown counts, empty lists and ready discovery', () => {
    expect(mcpRows(config, runtime('pending', null))[0].state).toBe('loading')
    expect(mcpRows(config, runtime('connected', null))[0].state).toBe('connected')
    expect(mcpRows(config, runtime('connected', 0))[0].state).toBe('empty')
    expect(mcpRows(config, runtime('connected', 2))[0].state).toBe('ready')
    expect(mcpRows(config, runtime('failed', 2))[0].state).toBe('failed')
    expect(mcpRows(config, runtime('needs-auth', 0))[0].state).toBe('authRequired')
  })
  it('keeps runtime-only servers and does not invent absent ones', () => {
    expect(mcpRows([], runtime('connected', 2))[0].checkStatus).toBe('unknown')
    expect(mcpRows(config, { source: 'live', servers: [] })[0].state).toBe('unconfirmed')
  })
  it('suggests npx only for timeout evidence', () => {
    expect(mcpIssue('timed out', 'npx -y pkg')).toBe('npxTimeout')
    expect(mcpIssue('timed out', 'node server')).toBe('timeout')
    expect(mcpIssue('ENOENT', 'npx pkg')).toBe('command')
    expect(mcpIssue('401 Unauthorized')).toBe('auth')
    expect(mcpIssue('ECONNREFUSED')).toBe('network')
    expect(mcpIssue('', 'npx pkg')).toBe('unknown')
  })
  it('redacts credentials in commands, environment, headers and URLs', () => {
    const secret = 'do-not-display'
    for (const input of [`MCP_YAPI_TOKEN=${secret}`, `--token ${secret}`, `Authorization: Bearer ${secret}`, `https://user:${secret}@host`, `{"apiKey":"${secret}"}`]) {
      expect(safeMcpDetail(input)).not.toContain(secret)
    }
    expect(safeMcpDetail('x'.repeat(9000))).toHaveLength(1200)
  })
})
