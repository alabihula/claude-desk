// @vitest-environment happy-dom
import { createApp, h, nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ convertFileSrc: (path) => `asset:${path}` }))
vi.mock('../../services/attachments', async (importOriginal) => ({
  ...await importOriginal(),
  clipboardImageFromEvent: vi.fn(),
}))
vi.mock('../../services/desktop', () => ({
  desktop: {
    copyAttachment: vi.fn(),
    listClaudeSkills: vi.fn(),
    listMcpServers: vi.fn(),
    saveClipboardImage: vi.fn(),
  },
}))

import { desktop } from '../../services/desktop'
import { clipboardImageFromEvent } from '../../services/attachments'
import { useWorkspaceStore } from '../../stores/workspace'
import ChatComposer from './ChatComposer.vue'

let app
let root

async function flushPromises() {
  await Promise.resolve()
  await Promise.resolve()
  await nextTick()
}

function imagePasteEvent() {
  const event = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', { value: { items: [{ type: 'image/png' }] } })
  return event
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  desktop.listClaudeSkills.mockResolvedValue([])
  desktop.listMcpServers.mockResolvedValue([])
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
  it('shows a pasted image immediately and removes it from an empty draft', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useWorkspaceStore()
    store.projects = [{ id: 'project-1', path: '/tmp/project' }]
    store.conversations = [{ id: 'conversation-1', projectId: 'project-1' }]
    store.activeProjectId = 'project-1'
    store.activeConversationId = 'conversation-1'
    clipboardImageFromEvent.mockResolvedValue({ bytes: [1, 2, 3], extension: 'png' })
    desktop.saveClipboardImage.mockResolvedValue({
      id: 'image-1',
      conversationId: 'conversation-1',
      kind: 'image',
      name: 'screenshot.png',
      path: '/tmp/screenshot.png',
    })

    app = createApp({ render: () => h(ChatComposer) })
    app.use(pinia)
    app.mount(root)

    const paste = imagePasteEvent()
    root.querySelector('textarea').dispatchEvent(paste)
    expect(paste.defaultPrevented).toBe(true)
    await flushPromises()

    expect(desktop.saveClipboardImage).toHaveBeenCalledWith('conversation-1', [1, 2, 3], 'png')
    expect(root.querySelector('.attachment-card')?.textContent).toContain('screenshot.png')

    root.querySelector('.attachment-preview').click()
    expect(store.previewAttachment).toEqual(expect.objectContaining({ id: 'image-1', path: '/tmp/screenshot.png' }))

    root.querySelector('.attachment-remove').click()
    await nextTick()
    expect(root.querySelector('.attachment-card')).toBeNull()
  })

  it('clears a pasted image immediately after sending while the request is still running', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useWorkspaceStore()
    store.projects = [{ id: 'project-1', path: '/tmp/project' }]
    store.conversations = [{ id: 'conversation-1', projectId: 'project-1' }]
    store.activeProjectId = 'project-1'
    store.activeConversationId = 'conversation-1'
    let finishSend
    store.sendMessage = vi.fn(() => new Promise((resolve) => { finishSend = resolve }))
    const attachment = {
      id: 'image-1',
      conversationId: 'conversation-1',
      kind: 'image',
      name: 'screenshot.png',
      path: '/tmp/screenshot.png',
    }
    clipboardImageFromEvent.mockResolvedValue({ bytes: [1, 2, 3], extension: 'png' })
    desktop.saveClipboardImage.mockResolvedValue(attachment)

    app = createApp({ render: () => h(ChatComposer) })
    app.use(pinia)
    app.mount(root)

    const textarea = root.querySelector('textarea')
    textarea.dispatchEvent(imagePasteEvent())
    await flushPromises()
    textarea.value = '这个图片是什么内容？'
    textarea.dispatchEvent(new Event('input'))
    await nextTick()
    root.querySelector('.send-button:last-child').click()
    await nextTick()

    expect(store.sendMessage).toHaveBeenCalledWith('这个图片是什么内容？', [attachment], null, [])
    expect(root.querySelector('.attachment-card')).toBeNull()
    finishSend()
    await flushPromises()
  })

  it('keeps an asynchronously saved clipboard image with the conversation where paste started', async () => {
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
    clipboardImageFromEvent.mockResolvedValue({ bytes: [1, 2, 3], extension: 'png' })
    let finishSave
    desktop.saveClipboardImage.mockImplementation(() => new Promise((resolve) => { finishSave = resolve }))

    app = createApp({ render: () => h(ChatComposer) })
    app.use(pinia)
    app.mount(root)

    root.querySelector('textarea').dispatchEvent(imagePasteEvent())
    await Promise.resolve()
    store.activeConversationId = 'conversation-2'
    await nextTick()
    finishSave({
      id: 'image-1',
      conversationId: 'conversation-1',
      kind: 'image',
      name: 'screenshot.png',
      path: '/tmp/screenshot.png',
    })
    await flushPromises()

    expect(root.querySelector('.attachment-card')).toBeNull()
    store.activeConversationId = 'conversation-1'
    await nextTick()
    expect(root.querySelector('.attachment-card')?.textContent).toContain('screenshot.png')
  })

  it('keeps an attachment when the composer remounts after adding a file snippet', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useWorkspaceStore()
    store.projects = [{ id: 'project-1', path: '/tmp/project' }]
    store.conversations = [{ id: 'conversation-1', projectId: 'project-1' }]
    store.activeProjectId = 'project-1'
    store.activeConversationId = 'conversation-1'
    clipboardImageFromEvent.mockResolvedValue({ bytes: [1, 2, 3], extension: 'png' })
    desktop.saveClipboardImage.mockResolvedValue({
      id: 'image-1',
      conversationId: 'conversation-1',
      kind: 'image',
      name: 'screenshot.png',
      path: '/tmp/screenshot.png',
    })

    app = createApp({ render: () => h(ChatComposer) })
    app.use(pinia)
    app.mount(root)
    root.querySelector('textarea').dispatchEvent(imagePasteEvent())
    await flushPromises()
    expect(root.querySelector('.attachment-card')?.textContent).toContain('screenshot.png')

    app.unmount()
    app = null
    root.innerHTML = ''
    store.addSnippetDraft('conversation-1', {
      path: 'src/main.js', startLine: 3, endLine: 4, content: 'const answer = 42',
    })
    app = createApp({ render: () => h(ChatComposer) })
    app.use(pinia)
    app.mount(root)
    await flushPromises()

    expect(root.querySelector('.attachment-card')?.textContent).toContain('screenshot.png')
    expect(root.querySelector('.snippet-capsule')?.textContent).toContain('1 selected text fragment')
    expect(root.querySelector('.composer-draft-items')?.children).toHaveLength(2)
  })

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
    expect(root.querySelector('.attachment-card')?.title).toBe('/tmp/Product-AI-use-case.md')

    store.activeConversationId = 'conversation-2'
    await nextTick()
    expect(root.querySelector('.attachment-card')).toBeNull()

    store.activeConversationId = 'conversation-1'
    await nextTick()
    expect(root.querySelector('.attachment-card')?.textContent).toContain('Product-AI-use-case.md')

    root.querySelector('.attachment-remove').click()
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
    ;[...root.querySelectorAll('.slash-skill-option')]
      .find((option) => option.textContent.includes('/superpowers:brainstorming'))
      .click()
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
      [],
    )
  })

  it('opens the local MCP server panel from the slash menu without sending a message', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useWorkspaceStore()
    store.projects = [{ id: 'project-1', path: '/tmp/project' }]
    store.conversations = [{ id: 'conversation-1', projectId: 'project-1' }]
    store.activeProjectId = 'project-1'
    store.activeConversationId = 'conversation-1'
    store.sendMessage = vi.fn()
    desktop.listMcpServers.mockResolvedValue([
      { name: 'filesystem', detail: 'node server.js /tmp', status: 'connected', message: '' },
      { name: 'figma-mcp-front', detail: 'figma-mcp-front -mode mcp', status: 'connected', message: '' },
    ])
    store.mcpRuntimeByConversation['conversation-1'] = {
      runId: 'run-1',
      toolCount: 2,
      servers: [
        { name: 'filesystem', status: 'connected', toolCount: 2 },
        { name: 'removed-server', status: 'failed', toolCount: 0 },
      ],
    }
    desktop.listClaudeSkills.mockResolvedValue([{
      name: 'aliyun-observability',
      description: 'Configure an MCP endpoint',
      scope: 'codex',
      invocation: 'external',
      path: '/tmp/aliyun/SKILL.md',
    }])

    app = createApp({ render: () => h(ChatComposer) })
    app.use(pinia)
    app.mount(root)
    await flushPromises()

    const textarea = root.querySelector('textarea')
    textarea.value = '/m'
    textarea.dispatchEvent(new Event('input'))
    await nextTick()
    const option = root.querySelector('.slash-skill-option')
    expect(option?.textContent).toContain('/mcp')
    expect(option?.textContent).toContain('configured MCP servers')
    option.click()
    await flushPromises()

    expect(textarea.value).toBe('')
    expect(desktop.listMcpServers).toHaveBeenCalledWith('/tmp/project', 'claude', {})
    expect(root.querySelector('.mcp-server-panel')?.textContent).toContain('filesystem')
    expect(root.querySelector('.mcp-server-panel')?.textContent).toContain('Connected')
    expect(root.querySelector('.mcp-server-panel')?.textContent).toContain('Latest run: 2 tools available')
    expect(root.querySelector('.mcp-server-panel')?.textContent).toContain('figma-mcp-front')
    expect(root.querySelector('.mcp-server-panel')?.textContent).toContain('Latest run: server was not loaded')
    expect(root.querySelector('.mcp-server-panel')?.textContent).toContain('removed-server')
    expect(root.querySelector('.mcp-server-retry')).toBeNull()
    expect(store.sendMessage).not.toHaveBeenCalled()

    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    await nextTick()
    expect(root.querySelector('.mcp-server-panel')).toBeNull()
  })

  it('opens the MCP panel for a manually entered exact command and renders the empty state', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useWorkspaceStore()
    store.projects = [{ id: 'project-1', path: '/tmp/project' }]
    store.conversations = [{ id: 'conversation-1', projectId: 'project-1' }]
    store.activeProjectId = 'project-1'
    store.activeConversationId = 'conversation-1'
    store.sendMessage = vi.fn()

    app = createApp({ render: () => h(ChatComposer) })
    app.use(pinia)
    app.mount(root)
    await flushPromises()

    const textarea = root.querySelector('textarea')
    textarea.value = '/mcp'
    textarea.dispatchEvent(new Event('input'))
    await nextTick()
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    await flushPromises()

    expect(root.querySelector('.mcp-panel-state')?.textContent).toContain('No MCP servers configured')
    expect(store.sendMessage).not.toHaveBeenCalled()
  })

  it('shows an MCP load error and retries', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useWorkspaceStore()
    store.projects = [{ id: 'project-1', path: '/tmp/project' }]
    store.conversations = [{ id: 'conversation-1', projectId: 'project-1' }]
    store.activeProjectId = 'project-1'
    store.activeConversationId = 'conversation-1'
    store.sendMessage = vi.fn()
    desktop.listMcpServers.mockRejectedValueOnce(new Error('status unavailable')).mockResolvedValueOnce([])

    app = createApp({ render: () => h(ChatComposer) })
    app.use(pinia)
    app.mount(root)
    await flushPromises()

    const textarea = root.querySelector('textarea')
    textarea.value = '/mcp'
    textarea.dispatchEvent(new Event('input'))
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    await flushPromises()
    expect(root.querySelector('.mcp-panel-state.error')?.textContent).toContain('status unavailable')

    root.querySelector('.mcp-panel-state.error button').click()
    await flushPromises()
    expect(desktop.listMcpServers).toHaveBeenCalledTimes(2)
    expect(root.querySelector('.mcp-panel-state')?.textContent).toContain('No MCP servers configured')
  })

  it('retries a failed MCP row once and replaces it with the recovered status', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useWorkspaceStore()
    store.projects = [{ id: 'project-1', path: '/tmp/project' }]
    store.conversations = [{ id: 'conversation-1', projectId: 'project-1' }]
    store.activeProjectId = 'project-1'
    store.activeConversationId = 'conversation-1'
    let finishRetry
    desktop.listMcpServers
      .mockResolvedValueOnce([
        { name: 'filesystem', detail: 'node server.js', status: 'connected', message: '' },
        { name: 'sentry', detail: 'https://mcp.test', status: 'failed', message: 'Connection refused' },
        { name: 'private', detail: 'https://private.test', status: 'authRequired', message: 'Login required' },
      ])
      .mockReturnValueOnce(new Promise((resolve) => { finishRetry = resolve }))

    app = createApp({ render: () => h(ChatComposer) })
    app.use(pinia)
    app.mount(root)
    await flushPromises()

    const textarea = root.querySelector('textarea')
    textarea.value = '/mcp'
    textarea.dispatchEvent(new Event('input'))
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    await flushPromises()

    const retry = root.querySelector('.mcp-server-retry')
    expect(root.querySelectorAll('.mcp-server-retry')).toHaveLength(1)
    retry.click()
    retry.click()
    await nextTick()
    expect(desktop.listMcpServers).toHaveBeenCalledTimes(2)
    expect(retry.disabled).toBe(true)
    expect(retry.textContent).toContain('Retrying')

    finishRetry([
      { name: 'filesystem', detail: 'node server.js', status: 'connected', message: '' },
      { name: 'sentry', detail: 'https://mcp.test', status: 'connected', message: '' },
      { name: 'private', detail: 'https://private.test', status: 'authRequired', message: 'Login required' },
    ])
    await flushPromises()

    expect(root.querySelectorAll('.mcp-server-retry')).toHaveLength(0)
    expect(root.querySelector('.mcp-server-list')?.textContent).toContain('sentry')
    expect(root.querySelector('.mcp-server-list')?.textContent).toContain('Connected')
  })

  it('keeps a failed MCP row retryable when the health command fails', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useWorkspaceStore()
    store.projects = [{ id: 'project-1', path: '/tmp/project' }]
    store.conversations = [{ id: 'conversation-1', projectId: 'project-1' }]
    store.activeProjectId = 'project-1'
    store.activeConversationId = 'conversation-1'
    desktop.listMcpServers
      .mockResolvedValueOnce([{ name: 'sentry', detail: 'https://mcp.test', status: 'failed', message: 'Connection refused' }])
      .mockRejectedValueOnce(new Error('status unavailable'))

    app = createApp({ render: () => h(ChatComposer) })
    app.use(pinia)
    app.mount(root)
    await flushPromises()

    const textarea = root.querySelector('textarea')
    textarea.value = '/mcp'
    textarea.dispatchEvent(new Event('input'))
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    await flushPromises()
    root.querySelector('.mcp-server-retry').click()
    await flushPromises()

    expect(root.querySelector('.mcp-server-list')?.textContent).toContain('Retry failed: Error: status unavailable')
    expect(root.querySelector('.mcp-server-retry')?.disabled).toBe(false)
  })

  it('marks a missing MCP server as unknown after retry', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useWorkspaceStore()
    store.projects = [{ id: 'project-1', path: '/tmp/project' }]
    store.conversations = [{ id: 'conversation-1', projectId: 'project-1' }]
    store.activeProjectId = 'project-1'
    store.activeConversationId = 'conversation-1'
    desktop.listMcpServers
      .mockResolvedValueOnce([{ name: 'sentry', detail: 'https://mcp.test', status: 'failed', message: 'Connection refused' }])
      .mockResolvedValueOnce([])

    app = createApp({ render: () => h(ChatComposer) })
    app.use(pinia)
    app.mount(root)
    await flushPromises()

    const textarea = root.querySelector('textarea')
    textarea.value = '/mcp'
    textarea.dispatchEvent(new Event('input'))
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    await flushPromises()
    root.querySelector('.mcp-server-retry').click()
    await flushPromises()

    expect(root.querySelector('.mcp-server-list')?.textContent).toContain('Unknown')
    expect(root.querySelector('.mcp-server-list')?.textContent).toContain('did not return this server')
    expect(root.querySelector('.mcp-server-retry')).not.toBeNull()
  })

  it('does not duplicate an in-flight MCP check when the panel is closed and reopened', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useWorkspaceStore()
    store.projects = [{ id: 'project-1', path: '/tmp/project' }]
    store.conversations = [{ id: 'conversation-1', projectId: 'project-1' }]
    store.activeProjectId = 'project-1'
    store.activeConversationId = 'conversation-1'
    let finishList
    desktop.listMcpServers.mockReturnValue(new Promise((resolve) => { finishList = resolve }))

    app = createApp({ render: () => h(ChatComposer) })
    app.use(pinia)
    app.mount(root)
    await flushPromises()

    const textarea = root.querySelector('textarea')
    textarea.value = '/mcp'
    textarea.dispatchEvent(new Event('input'))
    await nextTick()
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    await nextTick()
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    await nextTick()

    textarea.value = '/mcp'
    textarea.dispatchEvent(new Event('input'))
    await nextTick()
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    await nextTick()
    expect(desktop.listMcpServers).toHaveBeenCalledTimes(1)

    finishList([])
    await flushPromises()
    expect(root.querySelector('.mcp-panel-state')?.textContent).toContain('No MCP servers configured')
  })

  it('shows selected code as a compact capsule and sends the structured fragments', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useWorkspaceStore()
    store.settings.language = 'zh-CN'
    store.projects = [{ id: 'project-1', path: '/tmp/project' }]
    store.conversations = [
      { id: 'conversation-1', projectId: 'project-1' },
      { id: 'conversation-2', projectId: 'project-1' },
    ]
    store.activeProjectId = 'project-1'
    store.activeConversationId = 'conversation-1'
    store.sendMessage = vi.fn()
    store.addSnippetDraft('conversation-1', {
      path: 'src/main.js', startLine: 4, endLine: 7, content: 'const answer = 42',
    })

    app = createApp({ render: () => h(ChatComposer) })
    app.use(pinia)
    app.mount(root)
    await flushPromises()

    expect(root.querySelector('.snippet-capsule')?.textContent).toContain('1 个已选文本片段')
    expect(root.querySelector('.snippet-capsule-tooltip')?.textContent).toContain('src/main.js')
    expect(root.querySelector('.snippet-capsule-tooltip')?.textContent).toContain('第 4-7 行')

    store.activeConversationId = 'conversation-2'
    await nextTick()
    expect(root.querySelector('.snippet-capsule')).toBeNull()
    store.activeConversationId = 'conversation-1'
    await nextTick()

    root.querySelector('.send-button:last-child').click()
    await flushPromises()
    expect(store.sendMessage).toHaveBeenCalledWith('', [], null, [expect.objectContaining({
      path: 'src/main.js', startLine: 4, endLine: 7, content: 'const answer = 42',
    })])
    expect(store.snippetDrafts['conversation-1']).toBeUndefined()
    expect(root.querySelector('.snippet-capsule')).toBeNull()
  })

  it('removes all selected text fragments from the capsule action', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useWorkspaceStore()
    store.projects = [{ id: 'project-1', path: '/tmp/project' }]
    store.conversations = [{ id: 'conversation-1', projectId: 'project-1' }]
    store.activeProjectId = 'project-1'
    store.activeConversationId = 'conversation-1'
    store.addSnippetDraft('conversation-1', { path: 'a.js', startLine: 1, endLine: 1, content: 'a' })
    store.addSnippetDraft('conversation-1', { path: 'b.js', startLine: 2, endLine: 2, content: 'b' })

    app = createApp({ render: () => h(ChatComposer) })
    app.use(pinia)
    app.mount(root)
    await flushPromises()

    expect(root.querySelector('.snippet-capsule')?.textContent).toContain('2 selected text fragments')
    root.querySelector('.snippet-capsule > button').click()
    await nextTick()
    expect(store.snippetDrafts['conversation-1']).toBeUndefined()
  })
})
