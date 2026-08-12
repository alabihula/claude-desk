// @vitest-environment happy-dom
import { createApp, h, nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ convertFileSrc: (path) => `asset:${path}` }))
vi.mock('../../services/desktop', () => ({
  desktop: {
    copyAttachment: vi.fn(),
    listClaudeSkills: vi.fn(),
    saveClipboardImage: vi.fn(),
  },
}))

import { desktop } from '../../services/desktop'
import { useWorkspaceStore } from '../../stores/workspace'
import ChatComposer from './ChatComposer.vue'

let app
let root

async function flushPromises() {
  await Promise.resolve()
  await Promise.resolve()
  await nextTick()
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  desktop.listClaudeSkills.mockResolvedValue([])
  desktop.copyAttachment.mockImplementation(async (conversationId, path) => ({
    id: `${conversationId}:${path}`,
    conversationId,
    kind: 'file',
    name: path.split('/').pop(),
    path,
  }))
  root = document.createElement('div')
  document.body.appendChild(root)
})

afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
})

describe('ChatComposer attachments', () => {
  it('adds dropped files to the target conversation and keeps drafts isolated', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useWorkspaceStore()
    store.projects = [{ id: 'project-1', path: '/tmp/project' }]
    store.conversations = [
      { id: 'conversation-1', projectId: 'project-1' },
      { id: 'conversation-2', projectId: 'project-1' },
    ]
    store.activeProjectId = 'project-1'
    store.activeConversationId = 'conversation-1'
    store.sendMessage = vi.fn()

    app = createApp({ render: () => h(ChatComposer) })
    app.use(pinia)
    app.mount(root)

    window.dispatchEvent(new CustomEvent('claude-desk-drop', {
      detail: { conversationId: 'conversation-1', paths: ['/tmp/Product-AI-use-case.md'] },
    }))
    await flushPromises()

    expect(desktop.copyAttachment).toHaveBeenCalledWith('conversation-1', '/tmp/Product-AI-use-case.md')
    expect(root.querySelector('.attachment-card')?.textContent).toContain('Product-AI-use-case.md')
    expect(root.querySelector('.attachment-card')?.textContent).toContain('MD')

    store.activeConversationId = 'conversation-2'
    await nextTick()
    expect(root.querySelector('.attachment-card')).toBeNull()

    store.activeConversationId = 'conversation-1'
    await nextTick()
    expect(root.querySelector('.attachment-card')?.textContent).toContain('Product-AI-use-case.md')

    root.querySelector('.attachment-card button').click()
    await nextTick()
    expect(root.querySelector('.attachment-card')).toBeNull()
  })

  it('submits a selected Codex skill with its verified file binding', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useWorkspaceStore()
    store.projects = [{ id: 'project-1', path: '/tmp/project' }]
    store.conversations = [{ id: 'conversation-1', projectId: 'project-1' }]
    store.activeProjectId = 'project-1'
    store.activeConversationId = 'conversation-1'
    store.sendMessage = vi.fn()
    desktop.listClaudeSkills.mockResolvedValue([{
      name: 'superpowers:brainstorming',
      description: 'Brainstorm first',
      scope: 'codexPlugin',
      invocation: 'external',
      path: '/tmp/superpowers/skills/brainstorming/SKILL.md',
    }])

    app = createApp({ render: () => h(ChatComposer) })
    app.use(pinia)
    app.mount(root)
    await flushPromises()

    const textarea = root.querySelector('textarea')
    textarea.value = '/'
    textarea.dispatchEvent(new Event('input'))
    await nextTick()
    root.querySelector('.slash-skill-option').click()
    await nextTick()
    textarea.value = '/superpowers:brainstorming 设计登录方案'
    textarea.dispatchEvent(new Event('input'))
    await nextTick()
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    await flushPromises()

    expect(store.sendMessage).toHaveBeenCalledWith(
      '/superpowers:brainstorming 设计登录方案',
      [],
      { name: 'superpowers:brainstorming', path: '/tmp/superpowers/skills/brainstorming/SKILL.md' },
    )
  })
})
