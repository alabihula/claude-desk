// @vitest-environment happy-dom
import { createApp, h, nextTick, reactive } from 'vue'
import { createPinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'
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
})
