import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }))
vi.mock('../services/desktop', () => ({
  desktop: {
    saveMessage: vi.fn(),
    linkAttachments: vi.fn(),
    sendClaude: vi.fn(),
    interruptClaude: vi.fn(),
    stopClaude: vi.fn(),
    removeProject: vi.fn(),
    touchProject: vi.fn(),
    listConversations: vi.fn(),
    gitStatus: vi.fn(),
    renameConversation: vi.fn(),
    readProjectFile: vi.fn(),
    openInEditor: vi.fn(),
  },
}))

import { desktop } from '../services/desktop'
import { useWorkspaceStore } from './workspace'

function runningRun(status = 'running', content = '') {
  return {
    runId: 'run-current',
    operation: 'chat',
    content,
    activities: [],
    status,
    error: '',
    finalized: false,
    sawPartialText: false,
    permissionDenied: false,
    context: { tokens: 0, window: 0, measured: false },
  }
}

function setupStore() {
  const store = useWorkspaceStore()
  store.projects = [{ id: 'project-1', path: '/tmp/project' }]
  store.conversations = [{ id: 'conversation-1', projectId: 'project-1', claudeSessionId: 'session-1', title: 'Conversation' }]
  store.activeProjectId = 'project-1'
  store.activeConversationId = 'conversation-1'
  store.messages['conversation-1'] = [{ id: 'old-user', role: 'user', content: 'start' }]
  return store
}

describe('workspace supplemental messages', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    let messageId = 0
    desktop.saveMessage.mockImplementation(async (conversationId, role, content) => ({ id: `message-${++messageId}`, conversationId, role, content }))
    desktop.sendClaude.mockResolvedValue('run-next')
    desktop.interruptClaude.mockResolvedValue()
    desktop.listConversations.mockResolvedValue([])
    desktop.gitStatus.mockResolvedValue([])
  })

  it('queues new input without persisting it while Claude is running', async () => {
    const store = setupStore()
    store.runs['conversation-1'] = runningRun()

    await store.sendMessage('补充：使用深色主题')

    expect(store.activeQueuedMessages).toHaveLength(1)
    expect(store.activeQueuedMessages[0]).toMatchObject({ content: '补充：使用深色主题', status: 'queued' })
    expect(desktop.saveMessage).not.toHaveBeenCalled()
    expect(desktop.sendClaude).not.toHaveBeenCalled()
  })

  it('prioritizes the selected supplement and interrupts the current run', async () => {
    const store = setupStore()
    store.runs['conversation-1'] = runningRun()
    await store.sendMessage('first')
    await store.sendMessage('second')
    const secondId = store.activeQueuedMessages[1].id

    await store.steerQueuedMessage('conversation-1', secondId)

    expect(store.activeQueuedMessages.map((item) => item.content)).toEqual(['second', 'first'])
    expect(store.activeQueuedMessages[0].status).toBe('steering')
    expect(store.activeRun.status).toBe('steering')
    expect(desktop.interruptClaude).toHaveBeenCalledWith('conversation-1')
  })

  it('persists the completed answer then automatically dispatches the next supplement', async () => {
    const store = setupStore()
    store.runs['conversation-1'] = runningRun('complete', '当前回答完成')
    await store.sendMessage('继续检查边界条件')

    await store.finishRun('conversation-1', true)

    expect(store.activeQueuedMessages).toEqual([])
    expect(store.activeMessages.at(-2)).toMatchObject({ role: 'assistant', content: '当前回答完成' })
    expect(store.activeMessages.at(-1)).toMatchObject({ role: 'user', content: '继续检查边界条件' })
    expect(store.activeRun.runId).toBe('run-next')
    expect(desktop.sendClaude).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'conversation-1',
      sessionId: 'session-1',
      resume: true,
      prompt: '继续检查边界条件',
    }))
  })

  it('keeps queued supplements paused after an explicit stop', async () => {
    const store = setupStore()
    store.runs['conversation-1'] = runningRun('stopped')
    await store.sendMessage('暂时不要自动发送')

    await store.finishRun('conversation-1', false)

    expect(store.activeRun).toBeNull()
    expect(store.activeQueuedMessages).toHaveLength(1)
    expect(desktop.sendClaude).not.toHaveBeenCalled()
  })

  it('marks a partial assistant response when immediate steering interrupts it', async () => {
    const store = setupStore()
    store.runs['conversation-1'] = runningRun('interrupted', '未完成的回答')

    await store.finishRun('conversation-1', false)

    expect(store.activeMessages.at(-1)).toMatchObject({
      role: 'assistant',
      content: '未完成的回答\n\n> 已根据补充内容中断，并继续处理新要求。',
    })
  })

  it('opens project files in a Claude Desk workspace tab', async () => {
    const store = setupStore()
    store.settings.editor = 'claude-desk'
    desktop.readProjectFile.mockResolvedValue({
      path: '/tmp/project/notes.md',
      name: 'notes.md',
      content: '# Notes',
      size: 7,
    })

    await store.openFile('/tmp/project/notes.md')

    expect(desktop.readProjectFile).toHaveBeenCalledWith('/tmp/project', '/tmp/project/notes.md')
    expect(store.workspaceView).toBe('file')
    expect(store.filePreview).toMatchObject({ name: 'notes.md', content: '# Notes', loading: false })
  })

  it('keeps external editor choices routed through the desktop service', async () => {
    const store = setupStore()
    store.settings.editor = 'vscode'

    await store.openFile('/tmp/project/src/main.js', 12)

    expect(desktop.openInEditor).toHaveBeenCalledWith('/tmp/project/src/main.js', 12, 'vscode')
    expect(desktop.readProjectFile).not.toHaveBeenCalled()
  })

  it('keeps the current project selected when another project is removed', async () => {
    const store = setupStore()
    const otherProject = { id: 'project-2', path: '/tmp/other' }
    store.projects.push(otherProject)

    await store.removeProject(otherProject)

    expect(desktop.removeProject).toHaveBeenCalledWith('project-2')
    expect(store.activeProjectId).toBe('project-1')
    expect(store.activeConversationId).toBe('conversation-1')
  })

  it('selects the next project after removing the current project', async () => {
    const store = setupStore()
    store.projects.push({ id: 'project-2', path: '/tmp/other' })

    await store.removeProject(store.projects[0])

    expect(store.activeProjectId).toBe('project-2')
    expect(store.activeConversationId).toBeNull()
    expect(desktop.touchProject).toHaveBeenCalledWith('project-2')
  })

  it('clears committed changes and closes a stale diff preview', async () => {
    const store = setupStore()
    store.changes['project-1'] = [{ path: 'src/old.js', status: 'modified' }]
    store.diffDrawer = { file: { path: 'src/old.js', status: 'modified' }, content: 'old diff' }
    desktop.gitStatus.mockResolvedValue([])

    await store.refreshChanges()

    expect(desktop.gitStatus).toHaveBeenCalledWith('/tmp/project')
    expect(store.activeChanges).toEqual([])
    expect(store.diffDrawer).toBeNull()
  })
})
