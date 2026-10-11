// Drives the installed production App through the native WebView2 WebDriver.
// No QA hooks or command mocks are compiled into the shipping binary.
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
const app = process.env.CLAUDE_DESK_TEST_APP
assert(app, 'Installed App path is required')
const root = resolve('release/windows-lifecycle')
mkdirSync(root, { recursive: true })
const project = join(root, 'project with spaces')
const otherProject = join(root, 'other project')
for (const directory of [project, otherProject]) {
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, 'example.txt'), 'lifecycle test file\n')
  assert.equal(spawnSync('git', ['init', directory], { windowsHide: true }).status, 0)
}
const wrapper = join(root, 'fixture.cmd')
writeFileSync(wrapper, `@echo off\r\n"${process.execPath}" "${resolve('tests/fixtures/claude-session.mjs')}" %*\r\n`)
let session
const pause = (ms) => new Promise((r) => setTimeout(r, ms))
async function api(method, path, body) {
  const response = await fetch(`http://127.0.0.1:4444${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(90000) })
  const result = await response.json()
  if (!response.ok || result.value?.error) throw new Error(JSON.stringify(result))
  return result.value
}
async function evaluate(script, args = []) {
  const value = await api('POST', `/session/${session}/execute/async`, { script: `const done = arguments[arguments.length - 1]; const args = arguments[0]; const store = document.getElementById('app')?.__vue_app__?.config.globalProperties.$pinia?._s.get('workspace'); (async () => { ${script} })().then(value => done({ value }), error => done({ error: String(error) }));`, args: [args] })
  if (value.error) throw new Error(value.error)
  return value.value
}
async function until(script, message, limit = 60000) {
  const end = Date.now() + limit
  do { if (await evaluate(script)) return; await pause(100) } while (Date.now() < end)
  throw new Error(message)
}
const report = []
const pass = (message) => { report.push(message); console.log(`PASS ${message}`) }
async function send(prompt) {
  await evaluate('await store.sendMessage(args[0]);', [prompt])
  await until('return !store.activeRun', `turn did not finish: ${prompt}`)
  const text = await evaluate('return store.activeMessages.filter(m => m.role === "assistant").at(-1)?.content')
  assert(text, `No assistant response: ${prompt}`)
  return text
}
try {
  for (let n = 0; n < 100; n++) {
    try { await api('GET', '/status'); break } catch { await pause(200) }
  }
  const created = await api('POST', '/session', { capabilities: { alwaysMatch: { 'tauri:options': { application: app } } } })
  session = created.sessionId
  await api('POST', `/session/${session}/timeouts`, { script: 90000 })
  await until('return store && !store.loading', 'App initialization failed')
  await evaluate(`store.settings = { ...store.settings, command: args[0], args: ['--playwright'], env: {}, language: 'en' }; await store.refreshHealth(); window.testEvents = []; const original = store.handleClaudeEvent; store.handleClaudeEvent = event => { if (event.kind === 'started') window.testEvents.push(event); return original(event) };`, [wrapper])
  assert.equal(await evaluate('return store.health.available'), true)
  const duplicate = spawn(app, [], { windowsHide: true, stdio: 'ignore' })
  await Promise.race([new Promise(r => duplicate.once('exit', r)), pause(10000).then(() => { throw new Error('Duplicate App did not exit') })])
  pass('installed App initialization and second-launch single instance')
  await evaluate('await store.addProject(args[0]); window.firstProject = store.activeProjectId; window.firstConversation = store.activeConversationId;', [project])
  await pause(9500) // More than three Git refresh intervals.
  await evaluate('await store.addProject(args[0]); await store.selectProject(window.firstProject, window.firstConversation)', [otherProject])
  pass('add/select/switch projects and multiple Git polling intervals')
  assert((await send('open')).includes('same-live-page'))
  assert((await send('check')).includes('same-live-page'))
  let events = await evaluate('return window.testEvents')
  assert.equal(events[0].data.pid, events[1].data.pid)
  assert.equal(events[1].data.reusedSession, true)
  pass('two real Playwright turns preserve the same PID and in-page state')
  await evaluate('await store.sendMessage("hang")')
  await until('return store.activeRun?.content.includes("Waiting")', 'hanging turn did not start')
  await evaluate('await store.stopClaude()')
  await until('return !store.activeRun', 'stop did not complete')
  assert((await send('check')).includes('same-live-page'))
  pass('send/stop/send-again retains browser state')
  await evaluate('await store.newConversation()')
  assert(!(await send('check')).includes('same-live-page'))
  await evaluate('await store.selectConversation(window.firstConversation)')
  assert((await send('check')).includes('same-live-page'))
  pass('conversation switching preserves isolated browsers')
  await evaluate('await store.openFile(args[0], null, true)', [join(project, 'example.txt')])
  await evaluate('await window.__TAURI_INTERNALS__.invoke("reveal_project_file", { projectPath: args[0], sourcePath: "example.txt" })', [project])
  pass('open and reveal project file')
  // Scope validation remains in Rust, including during a persistent session.
  assert(await evaluate('try { await window.__TAURI_INTERNALS__.invoke("read_project_file", { projectPath: args[0], sourcePath: "../outside.txt" }); return false } catch { return true }', [project]))
  pass('out-of-project file boundary rejected')
  const beforeChange = await evaluate('return window.testEvents.at(-1).data.pid')
  await evaluate('store.settings.permissionMode = "plan"')
  assert(!(await send('check')).includes('same-live-page'))
  assert.notEqual(await evaluate('return window.testEvents.at(-1).data.pid'), beforeChange)
  pass('changed settings restart the idle session for the next turn')
  const retained = await evaluate('return window.testEvents.at(-1).data.pid')
  for (let index = 0; index < 3; index++) {
    await evaluate('await store.newConversation()')
    await send('tabs')
  }
  await evaluate('await store.selectConversation(window.firstConversation)')
  await send('tabs')
  assert.notEqual(await evaluate('return window.testEvents.at(-1).data.pid'), retained)
  pass('idle LRU evicts old sessions after three retained conversations')
  const screenshot = await api('GET', `/session/${session}/screenshot`)
  writeFileSync(join(root, 'packaged-app.png'), Buffer.from(screenshot, 'base64'))
  writeFileSync(join(root, 'phase.txt'), 'allow-terminal')
  await evaluate('await window.__TAURI_INTERNALS__.invoke("open_terminal", { path: args[0] })', [project])
  await pause(1500)
  pass('explicit Open Terminal action invoked')
  // Close via native window IPC so App lifecycle cleanup runs (not a forced kill).
  await evaluate('setTimeout(() => window.__TAURI_INTERNALS__.invoke("plugin:window|close", { label: "main" }), 50);')
  await pause(5500)
  pass('normal window close and session cleanup requested')
} finally {
  writeFileSync(join(root, 'report.json'), JSON.stringify({ checks: report }, null, 2))
  if (session) await api('DELETE', `/session/${session}`).catch(() => {})
}
