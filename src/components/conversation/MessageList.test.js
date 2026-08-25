// @vitest-environment happy-dom
import { createApp, h, nextTick, reactive } from 'vue'
import { createPinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ convertFileSrc: (path) => `asset:${path}` }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: vi.fn() }))
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn() }))
vi.mock('@tauri-apps/api/path', () => ({ downloadDir: vi.fn(), join: vi.fn() }))
vi.mock('../../services/desktop', () => ({ desktop: {
  resolveLocalFiles: vi.fn().mockResolvedValue([]),
  exportRunDiagnostic: vi.fn().mockResolvedValue(),
  openProjectHtml: vi.fn().mockResolvedValue(),
  revealProjectFile: vi.fn().mockResolvedValue(),
  readProjectFile: vi.fn().mockResolvedValue(),
  openInEditor: vi.fn().mockResolvedValue(),
} }))
import { desktop } from '../../services/desktop'
import { save } from '@tauri-apps/plugin-dialog'
import { useWorkspaceStore } from '../../stores/workspace'
import MessageList from './MessageList.vue'

let app

afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
  vi.clearAllMocks()
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

  it('shows the submitted time and copies a user message from its hover action', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const root = document.createElement('div')
    document.body.appendChild(root)
    app = createApp({
      render: () => h(MessageList, {
        conversationId: 'conversation-1',
        messages: [{
          id: 'user-1', role: 'user', content: '帮我检查 Windows 拖动问题',
          createdAt: new Date(2026, 7, 18, 15, 0).toISOString(),
        }],
        attachmentsByMessage: {},
      }),
    })
    app.use(createPinia())
    app.mount(root)
    await nextTick()

    const copy = root.querySelector('.message-copy-action')
    expect(root.querySelector('.message-time')?.textContent).toBe('15:00')
    expect(copy?.textContent).toBe('')
    expect(copy?.getAttribute('aria-label')).toBe('Copy message')
    copy.click()

    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith('帮我检查 Windows 拖动问题'))
    await vi.waitFor(() => expect(copy.getAttribute('aria-label')).toBe('Message copied'))
  })

  it('shows download cards only after an explicit request and an explicit download link', async () => {
    desktop.resolveLocalFiles.mockResolvedValue([{ name: 'report.xlsx', path: '/project/exports/report.xlsx', size: 2048 }])
    const root = document.createElement('div')
    document.body.appendChild(root)
    const pinia = createPinia()
    const store = useWorkspaceStore(pinia)
    store.projects = [{ id: 'project-1', path: '/project' }]
    store.activeProjectId = 'project-1'

    app = createApp({
      render: () => h(MessageList, {
        conversationId: 'conversation-1',
        messages: [
          { id: 'user-read', role: 'user', content: '帮我读一下工程' },
          { id: 'assistant-read', role: 'assistant', content: '读过 `package.json` 和 `cordis.patch.yml`。' },
          { id: 'user-export', role: 'user', content: '请导出一份 Excel 报告' },
          { id: 'assistant-export', role: 'assistant', content: '还参考了 `cordis.patch.yml`。\n\n[下载报告](./exports/report.xlsx)' },
        ],
        attachmentsByMessage: {},
      }),
    })
    app.use(pinia)
    app.mount(root)

    await vi.waitFor(() => expect(desktop.resolveLocalFiles).toHaveBeenCalledOnce())
    expect(desktop.resolveLocalFiles).toHaveBeenCalledWith('/project', ['./exports/report.xlsx'])
    expect(root.querySelectorAll('.download-file-card')).toHaveLength(1)
    expect(root.querySelector('.download-file-card')?.textContent).toContain('report.xlsx')
  })

  it('intercepts project links and routes images, HTML, and other files without navigating the app', async () => {
    const files = {
      './exports/panel.png': { name: 'panel.png', path: '/project/exports/panel.png', size: 100 },
      './exports/panel.html': { name: 'panel.html', path: '/project/exports/panel.html', size: 200 },
      './exports/report.pdf': { name: 'report.pdf', path: '/project/exports/report.pdf', size: 300 },
    }
    desktop.resolveLocalFiles.mockImplementation(async (_, candidates) => candidates.map((path) => files[path]).filter(Boolean))
    const root = document.createElement('div')
    document.body.appendChild(root)
    const pinia = createPinia()
    const store = useWorkspaceStore(pinia)
    store.projects = [{ id: 'project-1', path: '/project' }]
    store.activeProjectId = 'project-1'
    app = createApp({
      render: () => h(MessageList, {
        conversationId: 'conversation-1',
        messages: [{
          id: 'assistant-1', role: 'assistant',
          content: '[下载图片](./exports/panel.png)\n\n[下载页面](./exports/panel.html)\n\n[下载报告](./exports/report.pdf)',
        }],
        attachmentsByMessage: {},
      }),
    })
    app.use(pinia)
    app.mount(root)
    await nextTick()

    const links = root.querySelectorAll('.message-body a')
    const click = (link) => link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))

    expect(click(links[0])).toBe(false)
    await vi.waitFor(() => expect(store.previewAttachment).toMatchObject({ name: 'panel.png', kind: 'image' }))

    expect(click(links[1])).toBe(false)
    await vi.waitFor(() => expect(desktop.openProjectHtml).toHaveBeenCalledWith('/project', '/project/exports/panel.html'))

    expect(click(links[2])).toBe(false)
    await vi.waitFor(() => expect(desktop.revealProjectFile).toHaveBeenCalledWith('/project', '/project/exports/report.pdf'))
  })

  it('renders an empty-response diagnostic and exports the matching privacy-safe record', async () => {
    save.mockResolvedValue('/tmp/diagnostic.json')
    const root = document.createElement('div')
    document.body.appendChild(root)
    app = createApp({
      render: () => h(MessageList, {
        conversationId: 'conversation-1',
        messages: [{
          id: 'diagnostic-1', conversationId: 'conversation-1', role: 'system',
          content: 'claude-desk:diagnostic:empty-response:run-123',
        }],
        attachmentsByMessage: {},
      }),
    })
    app.use(createPinia())
    app.mount(root)
    await nextTick()

    expect(root.querySelector('.diagnostic-event')?.textContent).toContain('Claude returned no response text')
    root.querySelector('.diagnostic-event button').click()

    await vi.waitFor(() => expect(desktop.exportRunDiagnostic).toHaveBeenCalledWith(
      'conversation-1', 'run-123', '/tmp/diagnostic.json',
    ))
  })
})
