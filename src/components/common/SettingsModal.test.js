// @vitest-environment happy-dom
import { createApp, h, nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useWorkspaceStore } from '../../stores/workspace'
import SettingsModal from './SettingsModal.vue'

let app
let root
let store

beforeEach(() => {
  const pinia = createPinia()
  setActivePinia(pinia)
  store = useWorkspaceStore()
  store.settingsOpen = true
  root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp({ render: () => h(SettingsModal) })
  app.use(pinia)
  app.mount(root)
})

afterEach(() => {
  app.unmount()
  document.body.innerHTML = ''
})

describe('SettingsModal', () => {
  it('ignores backdrop clicks and closes only through an explicit control', async () => {
    root.querySelector('.modal-backdrop').click()
    await nextTick()
    expect(store.settingsOpen).toBe(true)

    root.querySelector('.settings-modal header .icon-button').click()
    await nextTick()
    expect(store.settingsOpen).toBe(false)
  })
})
