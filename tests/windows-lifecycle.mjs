// Drives the installed production App through the native WebView2 WebDriver.
// No QA hooks or command mocks are compiled into the shipping binary.
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
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
const skillDirectory = join(project, '.agents', 'skills', 'lifecycle')
mkdirSync(skillDirectory, { recursive: true })
writeFileSync(join(skillDirectory, 'SKILL.md'), '---\nname: lifecycle\ndescription: Test fixture skill\n---\nUse only the test browser.\n')
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
const phase = (name) => writeFileSync(join(root, 'phase.txt'), `background: ${name}`)
const report = []
const pass = (message) => { report.push(message); console.log(`PASS ${message}`) }
async function send(prompt) {
  phase(`send ${prompt}`)
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
  const nativeCapabilities = { browserName: 'webview2', 'ms:edgeChromium': true, 'ms:edgeOptions': { binary: app } }
  // EdgeDriver adds enable-logging by default; WebView2 131 allocates a console
  // for it. Reproduce that driver-only boundary, then test without the injected
  // logging flag. No production process or window is hidden by this test.
  writeFileSync(join(root, 'phase.txt'), 'probe-driver-logging')
  const probe = await api('POST', '/session', { capabilities: { alwaysMatch: nativeCapabilities } })
  await pause(1500)
  await api('DELETE', `/session/${probe.sessionId}`)
  await pause(1500)
  phase('start App through WebDriver')
  const created = await api('POST', '/session', { capabilities: { alwaysMatch: {
    ...nativeCapabilities, 'ms:edgeOptions': { binary: app, excludeSwitches: ['enable-logging'] },
  } } })
  session = created.sessionId
  await api('POST', `/session/${session}/timeouts`, { script: 90000 })
  await until('return store && !store.loading', 'App initialization failed')
  await evaluate(`store.settings = { ...store.settings, command: args[0], args: ['--playwright'], env: {}, language: 'en' }; await store.refreshHealth(); store.claudeSettings = { model: 'fixture-default' }; window.testEvents = []; const original = store.handleClaudeEvent; store.handleClaudeEvent = event => { if (event.kind === 'started') window.testEvents.push(event); return original(event) };`, [wrapper])
  assert.equal(await evaluate('return store.health.available'), true)
  phase('second App launch')
  const duplicate = spawn(app, [], { windowsHide: true, stdio: 'ignore' })
  await Promise.race([new Promise(r => duplicate.once('exit', r)), pause(10000).then(() => { throw new Error('Duplicate App did not exit') })])
  pass('installed App initialization and second-launch single instance')
  phase('add and select projects')
  await evaluate('await store.addProject(args[0]); window.firstProject = store.activeProjectId; window.firstConversation = store.activeConversationId;', [project])
  await pause(9500) // More than three Git refresh intervals.
  await evaluate('await store.addProject(args[0]); await store.selectProject(window.firstProject, window.firstConversation)', [otherProject])
  pass('add/select/switch projects and multiple Git polling intervals')
  await evaluate('window.lifecycleSkill = (await window.__TAURI_INTERNALS__.invoke("list_claude_skills", { projectPath: args[0] })).find(skill => skill.name === "lifecycle"); if (!window.lifecycleSkill) throw new Error("Test skill not found"); await store.sendMessage("open", [], window.lifecycleSkill)', [project])
  await until('return !store.activeRun', 'skill browser turn did not finish')
  assert((await evaluate('return store.activeMessages.filter(m => m.role === "assistant").at(-1)?.content')).includes('same-live-page'))
  assert((await send('check')).includes('same-live-page'))
  let events = await evaluate('return window.testEvents')
  assert.equal(events[0].data.pid, events[1].data.pid)
  assert.equal(events[1].data.reusedSession, true)
  pass('external skill then ordinary turn preserve the same PID and real Playwright page')
  phase('manual compaction context meter')
  assert.equal(await evaluate('return store.activeContext.percentage'), 60)
  await evaluate('await store.compactConversation()')
  await until('return !store.activeRun', 'manual compaction did not finish')
  assert(await evaluate('return store.activeContext.usagePending && !store.activeContext.measured'))
  assert((await evaluate('return document.querySelector(".context-meter summary").textContent')).includes('Usage pending'))
  await evaluate('await store.newConversation(); await store.selectConversation(window.firstConversation)')
  assert(await evaluate('return store.activeContext.usagePending && !store.activeContext.measured'))
  assert((await send('check')).includes('same-live-page'))
  assert.equal(await evaluate('return store.activeContext.percentage'), 6)
  await evaluate('await store.compactConversation()')
  await until('return !store.activeRun', 'second compaction did not finish')
  assert(await evaluate('return store.activeContext.measured && !store.activeContext.usagePending && store.activeContext.percentage === 6'))
  assert((await evaluate('return document.querySelector(".context-meter summary").textContent')).includes('6%'))
  await evaluate('await store.compactConversation()')
  await until('return !store.activeRun', 'rejected compaction did not finish')
  assert.equal(await evaluate('return store.activeContext.percentage'), 6)
  pass('manual compaction: missing/post tokens, persisted pending state, next-reply refresh, repeated/rejected compact and unchanged Playwright browser')
  assert((await send('check')).includes('same-live-page'))
  assert.equal(await evaluate('return window.testEvents.at(-1).data.pid'), events[0].data.pid)
  await evaluate('store.contextStats[store.activeConversationId] = { ...store.contextStats[store.activeConversationId], tokens: 195000, measured: true }')
  assert((await send('check')).includes('same-live-page'))
  assert.equal(await evaluate('return window.testEvents.at(-1).data.pid'), events[0].data.pid)
  pass('configured default model: manual/automatic/rejected compaction retain original browser and PID')
  rmSync(skillDirectory, { recursive: true })
  await evaluate('await store.sendMessage("check", [], window.lifecycleSkill)')
  await until('return !store.activeRun', 'stale skill failure did not finish')
  assert((await send('check')).includes('same-live-page'))
  assert.equal(await evaluate('return window.testEvents.at(-1).data.pid'), events[0].data.pid)
  pass('missing selected skill rejects only the turn without killing the existing browser')
  await evaluate('await store.sendMessage("hang")')
  await until('return store.activeRun?.content.includes("Waiting")', 'hanging turn did not start')
  await evaluate('await store.stopClaude()')
  await until('return !store.activeRun', 'stop did not complete')
  assert((await send('check')).includes('same-live-page'))
  pass('send/stop/send-again retains browser state')
  await evaluate('await store.sendMessage("hang")')
  await until('return store.activeRun?.content.includes("Waiting")', 'steer setup did not start')
  await evaluate('await store.sendMessage("check"); await store.steerQueuedMessage(store.activeConversationId, store.activeQueuedMessages[0].id)')
  await until('return !store.activeRun && !store.activeQueuedMessages.length', 'steered turn did not finish')
  assert((await send('check')).includes('same-live-page'))
  assert.equal(await evaluate('return window.testEvents.at(-1).data.pid'), events[0].data.pid)
  pass('queued immediate adjustment retains browser and PID')
  await evaluate('await store.newConversation()')
  assert(!(await send('check')).includes('same-live-page'))
  await evaluate('await store.selectConversation(window.firstConversation)')
  assert((await send('check')).includes('same-live-page'))
  pass('conversation switching preserves isolated browsers')
  phase('open and reveal file')
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
  assert(await evaluate('return store.activeMessages.some(m => m.content === "claude-desk:mcp-session:configuration-changed")'))
  assert((await evaluate('return document.body.textContent')).includes('Claude and MCP need to reconnect'))
  pass('changed settings restart with a visible persisted explanation')
  const retained = await evaluate('return window.testEvents.at(-1).data.pid')
  for (let index = 0; index < 3; index++) {
    await evaluate('await store.newConversation()')
    await send('tabs')
  }
  await evaluate('await store.selectConversation(window.firstConversation)')
  await send('tabs')
  assert.notEqual(await evaluate('return window.testEvents.at(-1).data.pid'), retained)
  assert(await evaluate('return store.activeMessages.some(m => m.content === "claude-desk:mcp-session:idle-limit")'))
  pass('idle LRU releases old sessions with a persisted explanation')
  await send('exit-idle')
  await until('return store.activeMessages.some(m => m.content === "claude-desk:mcp-session:connection-ended")', 'unexpected idle exit did not show a notice')
  await send('tabs')
  pass('unexpected idle process exit is reported and the next message reconnects')
  const screenshot = await api('GET', `/session/${session}/screenshot`)
  writeFileSync(join(root, 'packaged-app.png'), Buffer.from(screenshot, 'base64'))
  writeFileSync(join(root, 'phase.txt'), 'allow-terminal')
  await evaluate('await window.__TAURI_INTERNALS__.invoke("open_terminal", { path: args[0] })', [project])
  await pause(1500)
  pass('explicit Open Terminal action invoked')
  // CloseMainWindow sends WM_CLOSE; unlike terminating the process it exercises
  // the production App exit callback without widening webview IPC permissions.
  const closed = spawnSync('powershell.exe', ['-NoProfile', '-Command', "Get-Process claude-desk | ForEach-Object { $_.CloseMainWindow() | Out-Null }"], { windowsHide: true })
  assert.equal(closed.status, 0)
  await pause(5500)
  const alive = spawnSync('powershell.exe', ['-NoProfile', '-Command', '[bool](Get-Process claude-desk -ErrorAction SilentlyContinue)'], { windowsHide: true, encoding: 'utf8' })
  assert.equal(alive.status, 0)
  assert.equal(alive.stdout.trim(), 'False', 'App must exit before WebDriver session disposal')
  pass('normal window close exits App before driver disposal')
} finally {
  writeFileSync(join(root, 'report.json'), JSON.stringify({ checks: report }, null, 2))
  if (session) await api('DELETE', `/session/${session}`).catch(() => {})
}
