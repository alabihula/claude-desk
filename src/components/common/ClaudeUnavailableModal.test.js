// @vitest-environment happy-dom
import { createApp, h, nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { useWorkspaceStore } from '../../stores/workspace'
import ClaudeUnavailableModal from './ClaudeUnavailableModal.vue'

let app, root, store, opener
beforeEach(() => {
  const pinia = createPinia()
  setActivePinia(pinia)
  store = useWorkspaceStore()
  store.settings.language = 'zh-CN'
  opener = document.createElement('button')
  root = document.createElement('div')
  document.body.append(opener, root)
  app = createApp({ render: () => h(ClaudeUnavailableModal) }).use(pinia)
  app.mount(root)
})
afterEach(() => { app.unmount(); document.body.innerHTML = '' })

it('shows actionable guidance without rendering internal errors, and restores focus on dismissal', async () => {
  opener.focus()
  store.health = { available: false, error: '<img src=x onerror=alert(1)> Detected PATH: private-fixture' }
  store.claudeUnavailableOpen = true
  await nextTick()
  await nextTick()
  const dialog = root.querySelector('[role="alertdialog"]')
  const button = dialog.querySelector('button')
  expect(dialog.textContent).toContain('当前 Node.js 环境已安装 Claude Code')
  expect(dialog.textContent).toContain('claude --version')
  expect(dialog.textContent).not.toContain('private-fixture')
  expect(dialog.querySelector('img')).toBeNull()
  expect(document.activeElement).toBe(button)
  root.querySelector('.modal-backdrop').click()
  expect(store.claudeUnavailableOpen).toBe(true)
  button.click()
  await nextTick()
  expect(root.querySelector('[role="alertdialog"]')).toBeNull()
  expect(document.activeElement).toBe(opener)
})

it('keeps Tab focus inside the dialog and allows Escape after repeated openings', async () => {
  for (let i = 0; i < 2; i++) {
    store.claudeUnavailableOpen = true
    await nextTick()
    await nextTick()
    const button = root.querySelector('button')
    for (const shiftKey of [false, true]) {
      const tab = new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true })
      button.dispatchEvent(tab)
      expect(tab.defaultPrevented).toBe(true)
      expect(document.activeElement).toBe(button)
    }
    button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await nextTick()
    expect(store.claudeUnavailableOpen).toBe(false)
  }
})
