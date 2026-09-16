// @vitest-environment happy-dom
import { createApp, h, reactive, ref, nextTick } from 'vue'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useMcpRuntime } from './useMcpRuntime'
import { desktop } from './desktop'
vi.mock('./desktop', () => ({ desktop: { inspectRunMcp: vi.fn() } }))
let app, store, open, state, checking
const flush = async () => { await Promise.resolve(); await nextTick(); await Promise.resolve() }
beforeEach(() => {
  vi.useFakeTimers()
  desktop.inspectRunMcp.mockReset().mockResolvedValue({ source: 'live', servers: [{ name: 'test', status: 'pending', toolCount: null }] })
  store = reactive({ activeConversationId: 'a', activeRun: { runId: 'one', status: 'running' }, mcpRuntimeByConversation: {} })
  open = ref(true)
  checking = ref(false)
  app = createApp({ setup() { state = useMcpRuntime(store, open, checking); return () => h('div') } })
  app.mount(document.createElement('div'))
})
afterEach(() => { app.unmount(); vi.useRealTimers() })
it('updates slow discovery without spawning a health probe', async () => {
  await flush()
  expect(store.mcpRuntimeByConversation.a.servers[0].status).toBe('pending')
  desktop.inspectRunMcp.mockResolvedValue({ source: 'live', servers: [{ name: 'test', status: 'connected', toolCount: 2 }] })
  await vi.advanceTimersByTimeAsync(3000)
  expect(store.mcpRuntimeByConversation.a.servers[0].toolCount).toBe(2)
  open.value = false
  await flush()
  await vi.advanceTimersByTimeAsync(9000)
  expect(desktop.inspectRunMcp).toHaveBeenCalledTimes(2)
})
it('coalesces clicks and ignores replies after switching conversations', async () => {
  await flush()
  let finish
  desktop.inspectRunMcp.mockReturnValue(new Promise((resolve) => { finish = resolve }))
  state.refresh('test'); state.refresh('test')
  expect(desktop.inspectRunMcp).toHaveBeenCalledTimes(2)
  store.activeConversationId = 'b'
  store.activeRun = null
  await flush()
  finish({ source: 'live', servers: [{ name: 'stale', toolCount: 9 }] })
  await flush()
  expect(store.mcpRuntimeByConversation.b).toBeUndefined()
  expect(store.mcpRuntimeByConversation.a.servers[0].name).toBe('test')
})
it('surfaces unsupported reconnect and stops automatic retry loops', async () => {
  await flush()
  desktop.inspectRunMcp.mockRejectedValue(new Error('unsupported'))
  await state.refresh('test')
  expect(state.error.value).toBe('mcp.reconnectFailed')
  expect(state.busy.value).toBe(false)
  await vi.advanceTimersByTimeAsync(9000)
  expect(desktop.inspectRunMcp).toHaveBeenCalledTimes(2)
})
it('discards results after stop even before the watcher runs', async () => {
  await flush()
  let finish
  desktop.inspectRunMcp.mockReturnValue(new Promise((resolve) => { finish = resolve }))
  state.refresh()
  store.activeRun = null
  finish({ source: 'live', servers: [{ name: 'stale' }] })
  await flush()
  expect(store.mcpRuntimeByConversation.a.servers[0].name).toBe('test')
})

it('serializes configuration checks with automatic polling and live reconnects', async () => {
  await flush()
  checking.value = true
  await state.refresh('test')
  await vi.advanceTimersByTimeAsync(6000)
  expect(desktop.inspectRunMcp).toHaveBeenCalledTimes(1)
  checking.value = false
  await flush()
  expect(desktop.inspectRunMcp).toHaveBeenCalledTimes(2)
})
it('does not repeat an in-flight reconnect when the panel is closed and reopened', async () => {
  await flush()
  let finish
  desktop.inspectRunMcp.mockReturnValue(new Promise((resolve) => { finish = resolve }))
  state.refresh('test')
  open.value = false
  await flush()
  open.value = true
  await flush()
  await state.refresh('test')
  await vi.advanceTimersByTimeAsync(3000)
  expect(desktop.inspectRunMcp).toHaveBeenCalledTimes(2)
  expect(state.busy.value).toBe(true)
  finish({ source: 'live', servers: [] })
  await flush()
  expect(state.busy.value).toBe(false)
})
