// @vitest-environment happy-dom
import { createApp, h, nextTick, reactive } from 'vue'
import { createPinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ convertFileSrc: (path) => `asset:${path}` }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: vi.fn() }))
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn() }))
vi.mock('@tauri-apps/api/path', () => ({ downloadDir: vi.fn(), join: vi.fn() }))
vi.mock('../../services/desktop', () => ({ desktop: { resolveLocalFiles: vi.fn().mockResolvedValue([]) } }))
import MessageList from './MessageList.vue'

let app

afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
})

describe('MessageList stream following', () => {
  it('does not force the viewport down after the user scrolls upward', async () => {
    const state = reactive({
      run: { operation: 'chat', content: '', timeline: [], activities: [], status: 'running', error: '' },
    })
    const root = document.createElement('div')
    document.body.appendChild(root)
    app = createApp({
      render: () => h(MessageList, {
        conversationId: 'conversation-1',
        messages: [],
        attachmentsByMessage: {},
        run: state.run,
      }),
    })
    app.use(createPinia())
    app.mount(root)
    await nextTick()

    const viewport = root.querySelector('.message-scroller')
    let scrollTop = 600
    Object.defineProperties(viewport, {
      scrollHeight: { configurable: true, get: () => 1000 },
      clientHeight: { configurable: true, get: () => 400 },
      scrollTop: {
        configurable: true,
        get: () => scrollTop,
        set: (value) => { scrollTop = value },
      },
    })
    const scrollTo = vi.fn(({ top }) => { scrollTop = Math.min(top, 600) })
    viewport.scrollTo = scrollTo

    viewport.dispatchEvent(new WheelEvent('wheel', { deltaY: -40 }))
    scrollTop = 450
    viewport.dispatchEvent(new Event('scroll'))
    state.run.content = 'first streaming chunk'
    await nextTick()
    await nextTick()
    expect(scrollTo).not.toHaveBeenCalled()

    // Layout-driven scroll events must not be mistaken for another user action.
    scrollTop = 520
    viewport.dispatchEvent(new Event('scroll'))
    state.run.content = 'layout grew again'
    await nextTick()
    await nextTick()
    expect(scrollTo).not.toHaveBeenCalled()

    viewport.dispatchEvent(new WheelEvent('wheel', { deltaY: 40 }))
    scrollTop = 600
    viewport.dispatchEvent(new Event('scroll'))
    state.run.content = 'second streaming chunk'
    await nextTick()
    await nextTick()
    expect(scrollTo).toHaveBeenCalledOnce()

    scrollTop = 450
    viewport.dispatchEvent(new Event('scroll'))
    state.run.content = 'third streaming chunk'
    await nextTick()
    await nextTick()
    expect(scrollTo).toHaveBeenCalledTimes(2)
  })

  it('renders persisted snippets and linked dropped files on the submitted user message', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const snippet = { path: 'src/main.js', startLine: 4, endLine: 7, content: 'const answer = 42' }
    const attachment = {
      id: 'attachment-1', conversationId: 'conversation-1', messageId: 'user-1',
      kind: 'file', name: 'requirements.md', path: '/app-data/requirements.md', size: 32,
    }
    app = createApp({
      render: () => h(MessageList, {
        conversationId: 'conversation-1',
        messages: [{ id: 'user-1', role: 'user', content: '帮我看看', snippets: [snippet] }],
        attachmentsByMessage: { 'user-1': [attachment] },
      }),
    })
    app.use(createPinia())
    app.mount(root)
    await nextTick()

    expect(root.querySelector('.snippet-capsule')?.textContent).toContain('1 selected text fragment')
    expect(root.querySelector('.snippet-capsule-tooltip')?.textContent).toContain('src/main.js')
    expect(root.querySelector('.message-file')?.textContent).toContain('requirements.md')
  })
})
