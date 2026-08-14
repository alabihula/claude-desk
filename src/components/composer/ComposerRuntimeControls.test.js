// @vitest-environment happy-dom
import { createApp, h, nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ComposerRuntimeControls from './ComposerRuntimeControls.vue'

let app
let root

beforeEach(() => {
  setActivePinia(createPinia())
  root = document.createElement('div')
  document.body.appendChild(root)
})

afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
})

describe('ComposerRuntimeControls', () => {
  it('offers extended-context aliases and emits per-conversation runtime changes', async () => {
    const change = vi.fn()
    app = createApp({
      render: () => h(ComposerRuntimeControls, {
        model: '', effort: '', defaultModel: 'kimi-latest', onChange: change,
      }),
    })
    app.use(createPinia())
    app.mount(root)

    const menus = root.querySelectorAll('details')
    menus[0].open = true
    await nextTick()
    const oneMillion = [...menus[0].querySelectorAll('button')].find((button) => button.textContent.includes('sonnet[1m]'))
    oneMillion.click()
    expect(change).toHaveBeenCalledWith({ model: 'sonnet[1m]' })

    menus[1].open = true
    await nextTick()
    const high = [...menus[1].querySelectorAll('button')].find((button) => button.textContent.startsWith('High'))
    high.click()
    expect(change).toHaveBeenCalledWith({ effort: 'high' })
  })

  it('accepts a custom provider model id', async () => {
    const change = vi.fn()
    app = createApp({ render: () => h(ComposerRuntimeControls, { defaultModel: 'sonnet', onChange: change }) })
    app.use(createPinia())
    app.mount(root)

    const input = root.querySelector('.runtime-custom-model input')
    input.value = 'kimi-latest'
    input.dispatchEvent(new Event('input'))
    await nextTick()
    root.querySelector('.runtime-custom-model').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))

    expect(change).toHaveBeenCalledWith({ model: 'kimi-latest' })
  })

  it('closes either runtime menu when the user points outside the capsule group', async () => {
    app = createApp({ render: () => h(ComposerRuntimeControls, { defaultModel: 'sonnet' }) })
    app.use(createPinia())
    app.mount(root)

    const menus = root.querySelectorAll('details')
    menus[0].open = true
    await nextTick()
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    expect(menus[0].open).toBe(false)

    menus[1].open = true
    await nextTick()
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    expect(menus[1].open).toBe(false)
  })
})
