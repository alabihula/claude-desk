// @vitest-environment happy-dom
import { createApp, h, nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { confirm } from '@tauri-apps/plugin-dialog'
import { desktop } from '../../services/desktop'

vi.mock('@tauri-apps/plugin-dialog', () => ({ confirm: vi.fn() }))
vi.mock('../../services/desktop', () => ({ desktop: { restartApp: vi.fn() } }))

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
  vi.clearAllMocks()
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

  it('explains when a native dialog language change needs a restart', async () => {
    store.languageRestartRequired = true
    await nextTick()

    expect(root.querySelector('.save-note')?.textContent).toContain('native system dialogs')
  })

  it('offers to restart after saving a native dialog language change', async () => {
    store.languageRestartRequired = true
    store.saveConfiguration = vi.fn(async () => { store.settingsOpen = false })
    confirm.mockResolvedValueOnce(true)

    root.querySelector('footer .primary-button').click()
    await vi.waitFor(() => expect(desktop.restartApp).toHaveBeenCalledOnce())

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('macOS system dialogs'), expect.objectContaining({
      okLabel: 'Restart Now',
    }))
  })

  it('saves the selected conversation density as an app preference', async () => {
    store.saveConfiguration = vi.fn(async () => {})
    const density = root.querySelector('[data-testid="conversation-density"]')
    density.value = 'compact'
    density.dispatchEvent(new Event('change'))

    root.querySelector('footer .primary-button').click()
    await vi.waitFor(() => expect(store.saveConfiguration).toHaveBeenCalled())

    expect(store.saveConfiguration).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      conversationDensity: 'compact',
    }))
  })

  it('blurs an input when clicking non-control content in the settings body', async () => {
    const baseUrl = root.querySelector('[placeholder="https://api.anthropic.com"]')
    baseUrl.focus()
    expect(document.activeElement).toBe(baseUrl)

    root.querySelector('.connection-base-url > span').click()
    await nextTick()

    expect(document.activeElement).not.toBe(baseUrl)
  })

  it('creates, renames, and activates an additional Claude connection profile', async () => {
    store.saveConfiguration = vi.fn(async () => {})
    root.querySelector('[title="Add connection profile"]').click()
    await nextTick()

    const name = root.querySelector('[data-testid="connection-profile-name"]')
    name.value = 'Backup token'
    name.dispatchEvent(new Event('input'))
    const token = root.querySelector('.connection-section .secret-input input')
    token.value = 'backup-secret'
    token.dispatchEvent(new Event('input'))
    root.querySelector('footer .primary-button').click()

    await vi.waitFor(() => expect(store.saveConfiguration).toHaveBeenCalled())
    const [, settings] = store.saveConfiguration.mock.calls[0]
    expect(settings.connectionProfiles).toHaveLength(2)
    expect(settings.connectionProfiles.find((profile) => profile.id === settings.activeConnectionProfileId)).toMatchObject({
      name: 'Backup token', token: 'backup-secret',
    })
  })
})
