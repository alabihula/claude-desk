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
  expect(root.textContent).not.toContain('Unconfirmed')
  expect(root.querySelector('.mcp-server-status em')).toBeNull()
  expect(root.querySelector('.mcp-server-retry')).toBeNull()
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
  expect(root.textContent).toContain('Connected · Tool list is empty')
  expect(root.querySelector('.mcp-server-retry')).toBeNull()
  props.runtime.servers[0].status = 'failed'
  await nextTick()
  root.querySelector('.mcp-server-retry').click()
  expect(reconnects).toEqual(['test'])
  props.runtime.servers[0] = { name: 'test', status: 'connected', toolCount: 3 }
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

it('separates status refresh from reconnect and keeps Close available while busy', async () => {
  const root = document.createElement('div')
  const calls = []
  const props = reactive({ active: true, liveBusy: false, runtime: { source: 'live', servers: [{ name: 'test', status: 'failed', toolCount: null }] } })
  app = createApp({ render: () => h(McpServerPanel, { ...props, onLiveRefresh: () => calls.push('read'), onReconnect: () => calls.push('reconnect'), onClose: () => calls.push('close') }) })
  app.mount(root)
  root.querySelector('header button').click()
  expect(calls).toEqual(['read'])
  root.querySelector('.mcp-server-retry').click()
  expect(calls).toEqual(['read', 'reconnect'])
  props.liveBusy = true
  await nextTick()
  expect(root.querySelector('header button').disabled).toBe(true)
  expect(root.querySelector('.mcp-server-retry').disabled).toBe(true)
  root.querySelector('header button:last-child').click()
  expect(calls.at(-1)).toBe('close')
})
it('states missing tool counts precisely and does not offer reconnect for unknown status', async () => {
  const root = document.createElement('div')
  const props = reactive({ active: true, runtime: { source: 'live', servers: [{ name: 'test', status: 'connected', toolCount: null }] } })
  app = createApp({ render: () => h(McpServerPanel, props) })
  app.mount(root)
  expect(root.textContent).toContain('Connected')
  expect(root.textContent).toContain('did not report tool counts')
  expect(root.querySelector('.mcp-server-retry')).toBeNull()
  props.liveError = 'mcp.liveFailed'
  await nextTick()
  expect(root.textContent).toContain('Could not read current connection status')
  expect(root.querySelector('.mcp-server-retry')).toBeNull()
})
