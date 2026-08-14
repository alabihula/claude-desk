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
    reorderProjects: vi.fn(),
    reorderConversations: vi.fn(),
    saveSettings: vi.fn(),
    touchProject: vi.fn(),
    touchConversation: vi.fn(),
    createConversation: vi.fn(),
    refreshContextStats: vi.fn(),
    listMessages: vi.fn(),
    listAttachments: vi.fn(),
    listConversations: vi.fn(),
    gitStatus: vi.fn(),
    gitEnvironment: vi.fn(),
    gitCommit: vi.fn(),
    renameConversation: vi.fn(),
    updateConversationRuntime: vi.fn(),
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
  store.conversationsByProject['project-1'] = store.conversations
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
    desktop.saveMessage.mockImplementation(async (conversationId, role, content, snippets = []) => ({ id: `message-${++messageId}`, conversationId, role, content, snippets }))
    desktop.sendClaude.mockResolvedValue('run-next')
    desktop.interruptClaude.mockResolvedValue()
    desktop.createConversation.mockResolvedValue({ id: 'conversation-new', projectId: 'project-1', title: 'New conversation' })
    desktop.listConversations.mockResolvedValue([])
    desktop.listMessages.mockResolvedValue([])
    desktop.listAttachments.mockResolvedValue([])
    desktop.gitStatus.mockResolvedValue([])
    desktop.gitEnvironment.mockResolvedValue({
      isRepository: true, branch: 'main', upstream: 'origin/main', ahead: 0, behind: 0, additions: 0, deletions: 0,
    })
    desktop.refreshContextStats.mockResolvedValue(null)
  })

  it('keeps the selected project when a new-conversation click passes an event argument', async () => {
    const store = setupStore()
    store.conversations = []
    store.conversationsByProject['project-1'] = []
    store.activeConversationId = null

    await store.newConversation({ type: 'click' })

    expect(store.activeProjectId).toBe('project-1')
    expect(store.activeConversationId).toBe('conversation-new')
    expect(desktop.createConversation).toHaveBeenCalledWith('project-1')
    expect(desktop.touchProject).not.toHaveBeenCalled()
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

  it('persists conversation runtime choices and sends a queued message with its snapshot', async () => {
    const store = setupStore()
    store.runs['conversation-1'] = runningRun()
    await store.updateConversationRuntime('conversation-1', { model: 'sonnet[1m]', effort: 'high' })
    await store.sendMessage('使用扩展上下文')
    await store.updateConversationRuntime('conversation-1', { model: 'opus', effort: 'max' })

    expect(desktop.updateConversationRuntime).toHaveBeenNthCalledWith(1, 'conversation-1', 'sonnet[1m]', 'high')
    expect(store.activeQueuedMessages[0]).toMatchObject({ model: 'sonnet[1m]', effort: 'high' })

    delete store.runs['conversation-1']
    await store.dispatchNextQueued('conversation-1')
    expect(desktop.sendClaude).toHaveBeenCalledWith(expect.objectContaining({ model: 'sonnet[1m]', effort: 'high' }))
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
    const request = desktop.sendClaude.mock.calls.at(-1)[0]
    expect(request).toEqual(expect.objectContaining({
      conversationId: 'conversation-1',
      sessionId: 'session-1',
      resume: true,
    }))
    expect(request.prompt).toMatch(/^继续检查边界条件\n\nClaude Desk download requirement:/)
  })

  it('dispatches an external skill as a readable instruction file instead of a fake slash command', async () => {
    const store = setupStore()

    await store.sendMessage('/superpowers:brainstorming 设计登录方案', [], {
      name: 'superpowers:brainstorming',
      path: '/tmp/superpowers/skills/brainstorming/SKILL.md',
    })

    expect(desktop.saveMessage).toHaveBeenCalledWith(
      'conversation-1',
      'user',
      '/superpowers:brainstorming 设计登录方案',
      [],
    )
    expect(desktop.sendClaude).toHaveBeenCalledWith(expect.objectContaining({
      skillPath: '/tmp/superpowers/skills/brainstorming/SKILL.md',
      prompt: expect.stringContaining('User request: 设计登录方案'),
    }))
  })

  it('waits for the process exit before declaring a successful result complete', async () => {
    const store = setupStore()
    store.runs['conversation-1'] = runningRun()

    store.handleClaudeEvent({
      conversationId: 'conversation-1', runId: 'run-current', kind: 'stream',
      data: { type: 'result', result: '已完成', is_error: false, usage: { input_tokens: 634000 }, modelUsage: { model: { contextWindow: 200000 } } },
    })

    expect(store.activeRun.status).toBe('finishing')
    expect(store.activeContext.measured).toBe(false)
    expect(store.activeContext.cumulativeTokens).toBe(634000)

    store.handleClaudeEvent({ conversationId: 'conversation-1', runId: 'run-current', kind: 'exit', data: { success: true } })
    await vi.waitFor(() => expect(store.activeRun).toBeNull())
    expect(store.activeMessages.at(-1)).toMatchObject({ role: 'assistant', content: '已完成' })
  })

  it('uses transcript-backed context usage when the provider stream reports zero usage', () => {
    const store = setupStore()
    store.runs['conversation-1'] = runningRun()

    store.handleClaudeEvent({
      conversationId: 'conversation-1', runId: 'run-current', kind: 'context',
      data: {
        tokens: 76304,
        window: 200000,
        cumulativeTokens: 76032,
        source: 'claude-transcript',
      },
    })

    expect(store.activeContext).toMatchObject({
      tokens: 76304,
      window: 200000,
      measured: true,
      percentage: 38,
      cumulativeTokens: 76032,
    })
  })

  it('keeps a draft scoped to its conversation until it is submitted or cleared', () => {
    const store = setupStore()

    store.setDraft('conversation-1', '先别丢这段内容')
    store.setDraft('conversation-2', '另一段草稿')
    store.setDraft('conversation-1', '')

    expect(store.drafts).toEqual({ 'conversation-2': '另一段草稿' })
  })

  it('keeps attachment drafts scoped to their conversation until removed or cleared', () => {
    const store = setupStore()
    const first = { id: 'attachment-1', name: 'first.png' }
    const second = { id: 'attachment-2', name: 'second.md' }

    store.appendAttachmentDrafts('conversation-1', [first, second])
    store.appendAttachmentDrafts('conversation-2', [second])
    store.removeAttachmentDraft('conversation-1', first.id)

    expect(store.attachmentDrafts['conversation-1']).toEqual([second])
    expect(store.attachmentDrafts['conversation-2']).toEqual([second])

    store.clearAttachmentDrafts('conversation-1')
    expect(store.attachmentDrafts['conversation-1']).toBeUndefined()
  })

  it('deduplicates selected file fragments within each conversation draft', () => {
    const store = setupStore()
    const snippet = { path: 'src/main.js', startLine: 2, endLine: 3, content: 'one\ntwo' }

    store.addSnippetDraft('conversation-1', snippet)
    store.addSnippetDraft('conversation-1', snippet)
    store.addSnippetDraft('conversation-2', snippet)

    expect(store.snippetDrafts['conversation-1']).toHaveLength(1)
    expect(store.snippetDrafts['conversation-2']).toHaveLength(1)
  })

  it('keeps saved user text compact while sending full selected file context to Claude', async () => {
    const store = setupStore()
    const snippets = [{ path: 'src/main.js', startLine: 2, endLine: 3, content: 'one\ntwo' }]

    await store.sendMessage('检查这里', [], null, snippets)

    expect(desktop.saveMessage).toHaveBeenCalledWith('conversation-1', 'user', '检查这里', snippets)
    expect(store.activeMessages.at(-1).snippets).toEqual(snippets)
    expect(desktop.sendClaude).toHaveBeenCalledWith(expect.objectContaining({
      prompt: expect.stringContaining('File: src/main.js (lines 2-3)\n```\none\ntwo\n```'),
    }))
  })

  it('can send selected file context without requiring editable message text', async () => {
    const store = setupStore()
    store.settings.language = 'zh-CN'
    const snippets = [{ path: 'src/main.js', startLine: 2, endLine: 2, content: 'const value = 1' }]

    await store.sendMessage('', [], null, snippets)

    expect(desktop.saveMessage).toHaveBeenCalledWith('conversation-1', 'user', '请查看以下 1 个代码片段。', snippets)
    expect(desktop.sendClaude).toHaveBeenCalledWith(expect.objectContaining({
      prompt: expect.stringContaining('File: src/main.js (line 2)'),
    }))
  })

  it('reloads persisted snippets and linked dropped files with their user message', async () => {
    const store = setupStore()
    const snippets = [{ path: 'src/main.js', startLine: 2, endLine: 3, content: 'one\ntwo' }]
    const message = { id: 'saved-user', conversationId: 'conversation-1', role: 'user', content: '检查输入', snippets }
    const attachment = {
      id: 'attachment-1', conversationId: 'conversation-1', messageId: 'saved-user',
      kind: 'file', name: 'requirements.md', path: '/app-data/requirements.md', size: 32,
    }
    delete store.messages['conversation-1']
    desktop.listMessages.mockResolvedValue([message])
    desktop.listAttachments.mockResolvedValue([attachment])

    await store.selectConversation('conversation-1')

    expect(store.activeMessages).toEqual([message])
    expect(store.activeAttachments['saved-user']).toEqual([attachment])
  })

  it('links a dropped file to the saved user message so it remains visible after sending', async () => {
    const store = setupStore()
    const attachment = {
      id: 'attachment-1', conversationId: 'conversation-1', kind: 'file',
      name: 'requirements.md', path: '/app-data/requirements.md', size: 32,
    }

    await store.sendMessage('检查附件', [attachment])

    expect(desktop.linkAttachments).toHaveBeenCalledWith('message-1', ['attachment-1'])
    expect(store.activeAttachments['message-1']).toEqual([{ ...attachment, messageId: 'message-1' }])
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
    expect(store.workspaceView).toBe('files')
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

  it('coalesces overlapping Git refreshes for the active project', async () => {
    const store = setupStore()
    let resolveStatus
    desktop.gitStatus.mockImplementation(() => new Promise((resolve) => { resolveStatus = resolve }))

    const first = store.refreshChanges()
    const second = store.refreshChanges()
    resolveStatus([])
    await Promise.all([first, second])

    expect(desktop.gitStatus).toHaveBeenCalledTimes(1)
    expect(desktop.gitEnvironment).toHaveBeenCalledTimes(1)
  })

  it('commits and refreshes a stable project working tree', async () => {
    const store = setupStore()
    store.changes['project-1'] = [{ path: 'src/main.js', status: 'M' }]
    desktop.gitCommit.mockResolvedValue({ commit: 'abc123 feat: update', pushed: true })

    const result = await store.commitProjectChanges('feat: update', true)

    expect(desktop.gitCommit).toHaveBeenCalledWith('/tmp/project', 'feat: update', true)
    expect(result).toEqual({ commit: 'abc123 feat: update', pushed: true })
    expect(store.gitOperationBusy).toBe(false)
  })

  it('does not commit while Claude is still changing the active project', async () => {
    const store = setupStore()
    store.changes['project-1'] = [{ path: 'src/main.js', status: 'M' }]
    store.runs['conversation-1'] = runningRun()

    expect(await store.commitProjectChanges('feat: update', true)).toBeNull()
    expect(desktop.gitCommit).not.toHaveBeenCalled()
  })

  it('persists project and conversation drag ordering', async () => {
    const store = setupStore()
    store.projects = [
      { id: 'project-1', path: '/tmp/project' },
      { id: 'project-2', path: '/tmp/project-2' },
      { id: 'project-3', path: '/tmp/project-3' },
    ]
    store.conversations.push({ id: 'conversation-2', projectId: 'project-1', title: 'Second' })

    await store.reorderProjects('project-3', 'project-1')
    await store.reorderConversations('project-1', 'conversation-1', 'conversation-2', 'after')

    expect(store.projects.map((item) => item.id)).toEqual(['project-3', 'project-1', 'project-2'])
    expect(store.conversations.map((item) => item.id)).toEqual(['conversation-2', 'conversation-1'])
    expect(desktop.reorderProjects).toHaveBeenCalledWith(['project-3', 'project-1', 'project-2'])
    expect(desktop.reorderConversations).toHaveBeenCalledWith('project-1', ['conversation-2', 'conversation-1'])
  })

  it('loads every project conversation list when switching to tree mode', async () => {
    const store = setupStore()
    store.projects.push({ id: 'project-2', path: '/tmp/project-2' })
    desktop.listConversations.mockResolvedValueOnce([{ id: 'conversation-2', projectId: 'project-2', title: 'Other' }])

    await store.setSidebarMode('tree')

    expect(store.settings.sidebarMode).toBe('tree')
    expect(desktop.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ sidebarMode: 'tree' }))
    expect(desktop.listConversations).toHaveBeenCalledWith('project-2')
    expect(store.projectConversations('project-2')).toHaveLength(1)
  })

  it('persists interface language changes immediately', async () => {
    const store = setupStore()

    await store.setLanguage('zh-CN')

    expect(store.settings.language).toBe('zh-CN')
    expect(desktop.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ language: 'zh-CN' }))
  })
})
