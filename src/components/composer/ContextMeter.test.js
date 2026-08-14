// @vitest-environment happy-dom
import { createApp, h, nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
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
})
