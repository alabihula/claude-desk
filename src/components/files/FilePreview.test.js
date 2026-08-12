// @vitest-environment happy-dom
import { createApp, h, nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../services/desktop', () => ({ desktop: { revealPath: vi.fn() } }))

import { useWorkspaceStore } from '../../stores/workspace'
import FilePreview from './FilePreview.vue'

let app

afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
})

describe('FilePreview selection context', () => {
  it('adds the selected line range as structured conversation context without changing the text draft', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useWorkspaceStore()
    store.activeConversationId = 'conversation-1'
    store.workspaceView = 'files'
    store.filePreview = {
      path: '/tmp/project/src/main.js',
      relativePath: 'src/main.js',
      name: 'main.js',
      content: 'first\nsecond\nthird',
      size: 18,
      loading: false,
      error: '',
    }
    const root = document.createElement('div')
    document.body.appendChild(root)
    app = createApp({ render: () => h(FilePreview) })
    app.use(pinia)
    app.mount(root)
    await nextTick()

    const textarea = root.querySelector('textarea')
    textarea.setSelectionRange(6, 18)
    textarea.dispatchEvent(new Event('select'))
    await nextTick()

    const add = root.querySelector('.file-selection-button')
    expect(add.disabled).toBe(false)
    expect(add.textContent).toContain('2-3')
    add.click()
    await nextTick()

    expect(store.workspaceView).toBe('conversation')
    expect(store.drafts['conversation-1']).toBeUndefined()
    expect(store.snippetDrafts['conversation-1']).toEqual([expect.objectContaining({
      path: 'src/main.js', startLine: 2, endLine: 3, content: 'second\nthird',
    })])
  })
})
