// @vitest-environment happy-dom
import { createApp, h, nextTick, reactive } from 'vue'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import McpServerPanel from './McpServerPanel.vue'
let app
beforeEach(() => { setActivePinia(createPinia()) })
afterEach(() => { app?.unmount(); document.body.innerHTML = '' })
it('never shows a successful independent probe as tool readiness, even after recheck', () => {
  const root = document.createElement('div')
  app = createApp({ render: () => h(McpServerPanel, { servers: [{ name: 'test', status: 'connected' }] }) })
  app.mount(root)
  expect(root.textContent).toContain('Connection check: Passed')
  expect(root.textContent).toContain('Unconfirmed')
  expect(root.querySelector('.status-ready')).toBeNull()
})
it('tracks loading/empty/ready/ended and reconnects only a live server', async () => {
  const root = document.createElement('div')
  const reconnects = []
  const props = reactive({ active: true, runtime: { source: 'live', servers: [{ name: 'test', status: 'pending', toolCount: null }] } })
  app = createApp({ render: () => h(McpServerPanel, { ...props, onReconnect: (name) => reconnects.push(name) }) })
  app.mount(root)
  expect(root.textContent).toContain('Loading tools')
  props.runtime.servers[0] = { name: 'test', status: 'connected', toolCount: 0 }
  await nextTick()
  expect(root.textContent).toContain('No tools returned')
  root.querySelector('.mcp-server-retry').click()
  expect(reconnects).toEqual(['test'])
  props.runtime.servers[0].toolCount = 3
  await nextTick()
  expect(root.querySelector('.status-ready')).not.toBeNull()
  props.liveError = 'mcp.liveFailed'
  await nextTick()
  expect(root.querySelector('.status-ready')).toBeNull()
  props.liveError = ''
  props.active = false
  await nextTick()
  expect(root.querySelector('.status-ready')).toBeNull()
  expect(root.querySelector('.mcp-server-retry')).toBeNull()
})
it('renders diagnostic text rather than HTML and redacts tokens', () => {
  const root = document.createElement('div')
  app = createApp({ render: () => h(McpServerPanel, { servers: [{ name: '<img src=x>', status: 'failed', detail: 'npx server --token PRIVATE', message: 'timed out' }] }) })
  app.mount(root)
  expect(root.querySelector('img')).toBeNull()
  expect(root.textContent).not.toContain('PRIVATE')
  expect(root.textContent).toContain('npx may be downloading')
})
