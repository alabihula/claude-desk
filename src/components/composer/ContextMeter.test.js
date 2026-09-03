// @vitest-environment happy-dom
import { createApp, h, nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useWorkspaceStore } from '../../stores/workspace'
import ContextMeter from './ContextMeter.vue'

let app
let root

beforeEach(() => {
  const pinia = createPinia()
  setActivePinia(pinia)
  root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp({ render: () => h(ContextMeter) })
  app.use(pinia)
  app.mount(root)
})

afterEach(() => {
  app.unmount()
  document.body.innerHTML = ''
})

describe('ContextMeter', () => {
  it('closes the context popover on an outside pointer action', async () => {
    const details = root.querySelector('details')
    details.open = true
    await nextTick()

    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))

    expect(details.open).toBe(false)
  })

  it('shows a pending state instead of the previous model percentage', async () => {
    const store = useWorkspaceStore()
    store.activeConversationId = 'conversation-1'
    store.conversations = [{
      id: 'conversation-1', projectId: 'project-1', model: 'model-b',
    }]
    store.contextStats['conversation-1'] = {
      tokens: 186000,
      window: 200000,
      model: 'model-a',
      modelWindows: { 'model-a': 200000 },
      measured: true,
      source: 'claude-transcript',
    }
    await nextTick()

    expect(root.textContent).toContain('Context window pending')
    expect(root.textContent).not.toContain('93% context')
  })
})
