// Deterministic Claude protocol fixture. With --playwright it uses a real stdio
// MCP server and Chromium; only the model's choice of tools is scripted.
import readline from 'node:readline'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtempSync, rmSync } from 'node:fs'
const send = (value) => process.stdout.write(`${JSON.stringify(value)}\n`)
if (process.argv.includes('--version')) { console.log('2.1.0 (Claude Code)'); process.exit(0) }
let outputDirectory
process.on('exit', () => { if (outputDirectory) rmSync(outputDirectory, { recursive: true, force: true }) })
let sequence = 0
let compactions = 0
let contextTokens = 120000
let mcp
let pending = new Map()
let rpcId = 0
async function rpc(method, params) {
  const id = ++rpcId
  const response = new Promise((resolve, reject) => pending.set(id, { resolve, reject }))
  mcp.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
  return response
}
async function connect() {
  const require = createRequire(import.meta.url)
  const root = dirname(require.resolve('@playwright/mcp/package.json'))
  outputDirectory = mkdtempSync(join(tmpdir(), 'claude-desk-mcp-test-'))
  mcp = spawn(process.execPath, [join(root, 'cli.js'), '--headless', '--isolated', '--browser', process.env.CLAUDE_DESK_TEST_BROWSER || 'chromium', '--output-dir', outputDirectory], {
    stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true,
  })
  readline.createInterface({ input: mcp.stdout }).on('line', (line) => {
    const value = JSON.parse(line)
    const request = pending.get(value.id)
    if (!request) return
    pending.delete(value.id)
    if (value.error) request.reject(new Error(JSON.stringify(value.error)))
    else request.resolve(value.result)
  })
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'claude-desk-lifecycle-test', version: '1' } })
  mcp.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`)
}
async function tool(name, args) {
  const value = await rpc('tools/call', { name, arguments: args })
  if (value.isError) throw new Error(JSON.stringify(value))
  return value.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n')
}
const finish = (result, error = false) => send({ modelUsage: { 'test-model': { contextWindow: 200000 } }, type: 'result', subtype: error ? 'error_during_execution' : 'success', result, is_error: error })
let hanging = false
const input = readline.createInterface({ input: process.stdin })
input.on('line', async (line) => {
  const value = JSON.parse(line)
  if (value.type === 'control_request') {
    const subtype = value.request.subtype
    send({ type: 'control_response', response: { subtype: 'success', request_id: value.request_id, response: {} } })
    if (subtype === 'initialize') send({ type: 'system', subtype: 'init', mcp_servers: [] })
    if (subtype === 'interrupt' && hanging && !process.argv.includes('--ignore-interrupt')) { hanging = false; finish('Interrupted') }
    return
  }
  if (value.type !== 'user') return
  const content = value.message.content
  const prompt = (content.startsWith('Use the reusable skill instructions')
    ? content.split('\n').find(line => line.startsWith('User request: '))?.slice(14) || ''
    : content.split('\n')[0]).trim()
  if (prompt.startsWith('/compact')) {
    if (++compactions === 3) {
      send({ type: 'system', subtype: 'status', compact_result: 'failed', compact_error: 'Not enough messages to compact.' })
      finish('Not enough messages to compact.')
      return
    }
    contextTokens = 12000
    send({ type: 'system', subtype: 'compact_boundary', uuid: `compact-${compactions}`, compact_metadata: { pre_tokens: 120000, ...(compactions === 2 ? { post_tokens: contextTokens } : {}) } })
    send({ type: 'system', subtype: 'status', compact_result: 'success' })
    finish('')
    return
  }
  if (prompt === 'crash') process.exit(7)
  if (prompt === 'exit-idle') { setTimeout(() => process.exit(7), 500); }
  if (prompt === 'hang') { hanging = true; send({ type: 'assistant', message: { content: [{ type: 'text', text: 'Waiting' }] } }); return }
  try {
    let result = `${++sequence}:${process.pid}:${prompt}`
    if (process.argv.includes('--playwright')) {
      if (!mcp) await connect()
      if (prompt === 'open') {
        await tool('browser_navigate', { url: 'about:blank' })
        result = await tool('browser_evaluate', { function: '() => { window.claudeDeskNonce = "same-live-page"; return window.claudeDeskNonce }' })
      } else if (prompt === 'check') result = await tool('browser_evaluate', { function: '() => window.claudeDeskNonce || "missing"' })
      else if (prompt === 'tabs') result = await tool('browser_tabs', { action: 'list' })
      else if (prompt === 'new-tab') result = await tool('browser_tabs', { action: 'new' })
      else if (prompt === 'close-browser') result = await tool('browser_close', {})
    }
    send({ type: 'assistant', message: { content: [{ type: 'text', text: result }], usage: { input_tokens: contextTokens } } })
    finish(result)
  } catch (error) { finish(String(error), true) }
})
input.on('close', () => {
  if (mcp) { mcp.stdin.end(); mcp.on('exit', () => process.exit(0)) }
  else process.exit(0)
})
