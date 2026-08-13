import { defineStore } from 'pinia'
import { listen } from '@tauri-apps/api/event'
import { desktop } from '../services/desktop'
import { attachmentPrompt } from '../services/attachments'
import { preferredChange } from '../services/changes'
import { parseClaudeEvent } from '../services/claude/parser'
import { createQueuedMessage, prioritizeQueuedMessage, resetQueuedMessage, takeNextQueuedMessage } from '../services/claude/queue'
import { withRuntimeGuidance } from '../services/claude/runtime'
import { externalSkillPrompt } from '../services/skills'
import { fileSelectionsPrompt } from '../services/localFiles'
import { removeMigratedLegacySettings } from '../services/claude/settings'
import { applyRunTimelineEvent } from '../services/claude/timeline'

const defaultSettings = {
  command: 'claude',
  args: [],
  env: {},
  permissionMode: 'acceptEdits',
  theme: 'system',
  editor: 'vscode',
  sidebarMode: 'focused',
  language: 'en',
}

let diffRequestId = 0
let filePreviewRequestId = 0
let changesRequestId = 0
const changesRefreshes = new Map()

function conciseTitle(content) {
  const title = content.replace(/\s+/g, ' ').trim()
  return title.length > 28 ? `${title.slice(0, 28)}…` : title || 'New Conversation'
}

function snippetOnlyMessage(language, count) {
  return language === 'zh-CN'
    ? `请查看以下 ${count} 个代码片段。`
    : `Please review the following ${count} code snippet${count === 1 ? '' : 's'}.`
}

function moveRelative(items, sourceId, targetId, position = 'before') {
  if (sourceId === targetId) return items
  const source = items.find((item) => item.id === sourceId)
  if (!source || !items.some((item) => item.id === targetId)) return items
  const remaining = items.filter((item) => item.id !== sourceId)
  const targetIndex = remaining.findIndex((item) => item.id === targetId)
  const insertIndex = targetIndex + (position === 'after' ? 1 : 0)
  const next = [...remaining.slice(0, insertIndex), source, ...remaining.slice(insertIndex)]
  return next.every((item, index) => item.id === items[index]?.id) ? items : next
}

function newRun(operation = 'chat', context = null) {
  const activities = operation === 'compact' ? [{ id: 'compact', label: 'Compacting context', status: 'running' }] : []
  return {
    runId: null,
    operation,
    content: '',
    activities,
    timeline: activities.map((activity) => ({ id: `activity:${activity.id}`, type: 'activity', activity })),
    streamBlocks: {},
    streamMessageId: '',
    timelineSequence: 0,
    status: 'starting',
    error: '',
    finalized: false,
    sawPartialText: false,
    permissionDenied: false,
    context: context ? { ...context } : { tokens: 0, window: 0, measured: false },
  }
}

function storedContext(stats) {
  if (!stats) return null
  return {
    tokens: Number(stats.tokens || 0),
    window: Number(stats.window || 0),
    cumulativeTokens: Number(stats.cumulativeTokens || 0),
    measured: stats.source === 'claude-transcript',
    source: stats.source || '',
    lastCompactedAt: stats.lastCompactedAt || null,
  }
}

export const useWorkspaceStore = defineStore('workspace', {
  state: () => ({
    projects: [],
    conversations: [],
    conversationsByProject: {},
    messages: {},
    attachmentsByMessage: {},
    activeProjectId: null,
    activeConversationId: null,
    settings: { ...defaultSettings },
    claudeSettings: {},
    claudeSettingsContent: '{}\n',
    claudeSettingsPath: '',
    claudeSettingsError: '',
    contextStats: {},
    health: null,
    runs: {},
    queuedMessages: {},
    drafts: {},
    snippetDrafts: {},
    changes: {},
    gitEnvironments: {},
    loading: true,
    error: '',
    settingsOpen: false,
    permissionsOpen: false,
    sidebarCollapsed: false,
    previewAttachment: null,
    filePreview: null,
    workspaceView: 'conversation',
    diffDrawer: null,
    environmentPanel: false,
    gitOperationBusy: false,
    eventUnlisten: null,
  }),

  getters: {
    activeProject: (state) => state.projects.find((item) => item.id === state.activeProjectId) || null,
    activeConversation: (state) => state.conversations.find((item) => item.id === state.activeConversationId) || null,
    activeMessages(state) { return state.messages[state.activeConversationId] || [] },
    activeAttachments(state) {
      return Object.fromEntries(this.activeMessages.map((message) => [message.id, state.attachmentsByMessage[message.id] || []]))
    },
    activeRun(state) { return state.runs[state.activeConversationId] || null },
    activeQueuedMessages(state) { return state.queuedMessages[state.activeConversationId] || [] },
    activeContext(state) {
      const env = this.claudeSettings?.env || {}
      const current = state.runs[state.activeConversationId]?.context || state.contextStats[state.activeConversationId] || {}
      const window = Number(current.window || env.CLAUDE_CODE_AUTO_COMPACT_WINDOW || 0)
      const reportedTokens = Number(current.tokens || 0)
      // Older Claude Desk versions stored result-level cumulative usage as an
      // estimated context value. Keep it visible as cumulative data, never as a
      // percentage of a single model window.
      const cumulativeTokens = Number(current.cumulativeTokens || (current.estimated ? reportedTokens : 0))
      const measured = Boolean((current.measured || current.source === 'claude-transcript') && !current.estimated && reportedTokens && (!window || reportedTokens <= window))
      return {
        tokens: measured ? reportedTokens : 0,
        window,
        measured,
        estimated: false,
        cumulativeTokens,
        source: current.source || '',
        percentage: measured && window ? Math.round((reportedTokens / window) * 100) : 0,
        autoCompact: env.DISABLE_AUTO_COMPACT !== '1',
        threshold: Number(env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE || 95),
        lastCompactedAt: current.lastCompactedAt || null,
      }
    },
    activeChanges(state) { return state.changes[state.activeProjectId] || [] },
    activeGitEnvironment(state) {
      return state.gitEnvironments[state.activeProjectId] || {
        isRepository: false, branch: '', upstream: '', ahead: 0, behind: 0, additions: 0, deletions: 0,
      }
    },
    activeProjectHasRun(state) {
      const conversationIds = new Set((state.conversationsByProject[state.activeProjectId] || []).map((item) => item.id))
      return Object.keys(state.runs).some((conversationId) => conversationIds.has(conversationId))
    },
    projectConversations: (state) => (projectId) => state.conversationsByProject[projectId] || [],
    conversationById: (state) => (id) => state.conversations.find((item) => item.id === id)
      || Object.values(state.conversationsByProject).flat().find((item) => item.id === id)
      || null,
  },

  actions: {
    async init() {
      this.loading = true
      try {
        this.settings = { ...defaultSettings, ...(await desktop.loadSettings()) }
        await this.reloadClaudeSettings()
        this.projects = await desktop.listProjects()
        this.eventUnlisten = await listen('claude-event', ({ payload }) => this.handleClaudeEvent(payload))
        await this.refreshHealth()
        if (this.projects[0]) await this.selectProject(this.projects[0].id)
        if (this.settings.sidebarMode === 'tree') await this.loadSidebarConversations()
      } catch (error) {
        this.error = String(error)
      } finally {
        this.loading = false
      }
    },

    async refreshHealth() {
      this.health = await desktop.checkClaude(this.settings.command, this.settings.env)
    },

    async reloadClaudeSettings() {
      const file = await desktop.loadClaudeSettings()
      this.claudeSettingsContent = file.content
      this.claudeSettingsPath = file.path
      try {
        const parsed = JSON.parse(file.content)
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Settings must be a JSON object')
        this.claudeSettings = parsed
        this.claudeSettingsError = ''
      } catch (error) {
        this.claudeSettings = null
        this.claudeSettingsError = String(error)
      }
    },

    async addProject(path) {
      const project = await desktop.addProject(path)
      this.projects = [project, ...this.projects.filter((item) => item.id !== project.id)]
      await this.selectProject(project.id)
      if (!this.conversations.length) await this.newConversation()
    },

    async selectProject(id, conversationId = null) {
      if (this.activeProjectId === id && this.conversations.length) {
        if (conversationId && conversationId !== this.activeConversationId) await this.selectConversation(conversationId)
        return
      }
      this.activeProjectId = id
      this.filePreview = null
      this.workspaceView = 'conversation'
      this.environmentPanel = false
      await desktop.touchProject(id)
      this.conversations = await this.loadProjectConversations(id, true)
      const first = this.conversations.find((item) => item.id === conversationId) || this.conversations[0]
      this.activeConversationId = null
      if (first) await this.selectConversation(first.id)
      await this.refreshChanges()
    },

    async loadProjectConversations(projectId, force = false) {
      if (!force && this.conversationsByProject[projectId]) return this.conversationsByProject[projectId]
      const conversations = await desktop.listConversations(projectId)
      this.conversationsByProject[projectId] = conversations
      if (this.activeProjectId === projectId) this.conversations = conversations
      return conversations
    },

    async loadSidebarConversations() {
      await Promise.all(this.projects.map((project) => this.loadProjectConversations(project.id)))
    },

    async setSidebarMode(mode) {
      if (!['focused', 'tree'].includes(mode) || this.settings.sidebarMode === mode) return
      this.settings = { ...this.settings, sidebarMode: mode }
      await desktop.saveSettings(this.settings)
      if (mode === 'tree') await this.loadSidebarConversations()
    },

    async setLanguage(language) {
      if (!['en', 'zh-CN'].includes(language) || this.settings.language === language) return
      this.settings = { ...this.settings, language }
      if (typeof document !== 'undefined') document.documentElement.lang = language
      await desktop.saveSettings(this.settings)
    },

    async removeProject(project) {
      await desktop.removeProject(project.id)
      this.projects = this.projects.filter((item) => item.id !== project.id)
      delete this.conversationsByProject[project.id]
      if (this.activeProjectId !== project.id) return
      this.activeProjectId = null
      this.activeConversationId = null
      this.conversations = []
      if (this.projects[0]) await this.selectProject(this.projects[0].id)
    },

    async newConversation(projectId = this.activeProjectId) {
      // Direct Vue event bindings may pass a MouseEvent; never let it replace the selected project id.
      const targetProjectId = typeof projectId === 'string' ? projectId : this.activeProjectId
      if (!targetProjectId) return
      if (this.activeProjectId !== targetProjectId) await this.selectProject(targetProjectId)
      const conversation = await desktop.createConversation(targetProjectId)
      this.conversations.unshift(conversation)
      this.conversationsByProject[targetProjectId] = this.conversations
      this.messages[conversation.id] = []
      this.activeConversationId = conversation.id
    },

    setDraft(conversationId, content) {
      if (!conversationId) return
      const draft = String(content || '')
      if (draft) this.drafts[conversationId] = draft
      else delete this.drafts[conversationId]
    },

    addSnippetDraft(conversationId, snippet) {
      if (!conversationId || !snippet?.content || !snippet.path) return
      const current = this.snippetDrafts[conversationId] || []
      const duplicate = current.some((item) => item.path === snippet.path
        && item.startLine === snippet.startLine
        && item.endLine === snippet.endLine
        && item.content === snippet.content)
      if (duplicate) return
      this.snippetDrafts[conversationId] = [...current, { ...snippet, id: crypto.randomUUID() }]
    },

    clearSnippetDrafts(conversationId) {
      if (conversationId) delete this.snippetDrafts[conversationId]
    },

    async selectConversation(id) {
      this.activeConversationId = id
      this.workspaceView = 'conversation'
      await desktop.touchConversation(id)
      try {
        const context = await desktop.refreshContextStats(id)
        if (context) this.contextStats[id] = storedContext(context)
      } catch {
        // Context telemetry is optional and must not block opening a conversation.
      }
      if (!this.messages[id]) {
        const [messages, attachments] = await Promise.all([desktop.listMessages(id), desktop.listAttachments(id)])
        this.messages[id] = messages
        for (const attachment of attachments) {
          if (!attachment.messageId) continue
          ;(this.attachmentsByMessage[attachment.messageId] ||= []).push(attachment)
        }
      }
    },

    async renameConversation(conversation, title) {
      await desktop.renameConversation(conversation.id, title)
      const nextTitle = title.trim()
      conversation.title = nextTitle
      for (const conversations of Object.values(this.conversationsByProject)) {
        const match = conversations.find((item) => item.id === conversation.id)
        if (match) match.title = nextTitle
      }
    },

    async deleteConversation(conversation) {
      if (this.runs[conversation.id]) await this.stopClaude(conversation.id)
      await desktop.deleteConversation(conversation.id)
      const projectId = conversation.projectId
      const remaining = (this.conversationsByProject[projectId] || []).filter((item) => item.id !== conversation.id)
      this.conversationsByProject[projectId] = remaining
      if (this.activeProjectId === projectId) this.conversations = remaining
      for (const message of this.messages[conversation.id] || []) delete this.attachmentsByMessage[message.id]
      delete this.messages[conversation.id]
      delete this.queuedMessages[conversation.id]
      delete this.drafts[conversation.id]
      delete this.snippetDrafts[conversation.id]
      if (this.activeConversationId === conversation.id) {
        this.activeConversationId = null
        if (this.conversations[0]) await this.selectConversation(this.conversations[0].id)
      }
    },

    async reorderProjects(sourceId, targetId, position = 'before') {
      const previous = this.projects
      const next = moveRelative(previous, sourceId, targetId, position)
      if (next === previous) return
      this.projects = next
      try {
        await desktop.reorderProjects(next.map((item) => item.id))
      } catch (error) {
        this.projects = previous
        throw error
      }
    },

    async reorderConversations(projectId, sourceId, targetId, position = 'before') {
      const previous = this.conversationsByProject[projectId] || []
      const next = moveRelative(previous, sourceId, targetId, position)
      if (next === previous) return
      this.conversationsByProject[projectId] = next
      if (this.activeProjectId === projectId) this.conversations = next
      try {
        await desktop.reorderConversations(projectId, next.map((item) => item.id))
      } catch (error) {
        this.conversationsByProject[projectId] = previous
        if (this.activeProjectId === projectId) this.conversations = previous
        throw error
      }
    },

    async sendMessage(content, attachments = [], skill = null, snippets = []) {
      const conversation = this.activeConversation
      const project = this.activeProject
      const cleanContent = content.trim()
      if (!conversation || !project || (!cleanContent && !attachments.length && !snippets.length)) return
      const queued = createQueuedMessage({
        id: crypto.randomUUID(),
        conversation,
        project,
        content: cleanContent,
        attachments,
        snippets,
        skill,
        createdAt: new Date().toISOString(),
      })
      if (this.runs[conversation.id] || this.queuedMessages[conversation.id]?.length) {
        ;(this.queuedMessages[conversation.id] ||= []).push(queued)
        if (!this.runs[conversation.id]) await this.dispatchNextQueued(conversation.id)
        return
      }
      await this.dispatchMessage(queued)
    },

    async dispatchMessage(queued) {
      if (!queued || this.runs[queued.conversationId]) return
      const previousMessages = this.messages[queued.conversationId] || []
      const hasPreviousUserMessage = previousMessages.some((message) => message.role === 'user')
      const content = queued.content || (queued.snippets.length
        ? snippetOnlyMessage(this.settings.language, queued.snippets.length)
        : '请查看附件。')
      const userMessage = await desktop.saveMessage(queued.conversationId, 'user', content, queued.snippets)
      if (queued.attachments.length) {
        await desktop.linkAttachments(userMessage.id, queued.attachments.map((item) => item.id))
        this.attachmentsByMessage[userMessage.id] = queued.attachments.map((item) => ({ ...item, messageId: userMessage.id }))
      }
      previousMessages.push(userMessage)
      this.messages[queued.conversationId] = previousMessages
      const conversation = this.conversations.find((item) => item.id === queued.conversationId)
      if (conversation?.title === 'New Conversation') {
        await this.renameConversation(conversation, conciseTitle(queued.content || queued.snippets[0]?.path || queued.attachments[0]?.name || 'New Conversation'))
      }

      this.runs[queued.conversationId] = newRun('chat', this.contextStats[queued.conversationId])
      try {
        const runId = await desktop.sendClaude({
          conversationId: queued.conversationId,
          sessionId: queued.sessionId,
          projectPath: queued.projectPath,
          prompt: withRuntimeGuidance(fileSelectionsPrompt(attachmentPrompt(externalSkillPrompt(content, queued.skill), queued.attachments), queued.snippets)),
          resume: hasPreviousUserMessage,
          command: this.settings.command,
          args: this.settings.args,
          env: this.settings.env,
          permissionMode: this.settings.permissionMode,
          skillPath: queued.skill?.path || null,
        })
        if (this.runs[queued.conversationId]) this.runs[queued.conversationId].runId = runId
      } catch (error) {
        this.runs[queued.conversationId].status = 'error'
        this.runs[queued.conversationId].error = String(error)
        this.error = String(error)
        await this.finalizeRun(queued.conversationId)
        delete this.runs[queued.conversationId]
      }
    },

    removeQueuedMessage(conversationId, messageId) {
      const messages = this.queuedMessages[conversationId] || []
      this.queuedMessages[conversationId] = messages.filter((item) => item.id !== messageId || item.status === 'steering')
    },

    async sendQueuedMessageNow(conversationId, messageId) {
      if (this.runs[conversationId]) return this.steerQueuedMessage(conversationId, messageId)
      this.queuedMessages[conversationId] = prioritizeQueuedMessage(this.queuedMessages[conversationId] || [], messageId)
      await this.dispatchNextQueued(conversationId)
    },

    async steerQueuedMessage(conversationId, messageId) {
      const run = this.runs[conversationId]
      if (!run || run.status === 'steering' || run.status === 'stopping') return
      const messages = this.queuedMessages[conversationId] || []
      if (!messages.some((item) => item.id === messageId)) return
      const previousStatus = run.status
      this.queuedMessages[conversationId] = prioritizeQueuedMessage(messages, messageId)
      run.status = 'steering'
      try {
        await desktop.interruptClaude(conversationId)
      } catch (error) {
        this.queuedMessages[conversationId] = resetQueuedMessage(this.queuedMessages[conversationId], messageId)
        run.status = previousStatus
        // If the result won the race, normal queue dispatch will take over on exit.
        if (previousStatus !== 'complete') {
          run.error = String(error)
          this.error = String(error)
        }
      }
    },

    async dispatchNextQueued(conversationId) {
      if (this.runs[conversationId]) return
      const [next, rest] = takeNextQueuedMessage(this.queuedMessages[conversationId] || [])
      if (!next) return
      this.queuedMessages[conversationId] = rest
      await this.dispatchMessage(next)
    },

    async stopClaude(conversationId = this.activeConversationId) {
      if (!conversationId || !this.runs[conversationId]) return
      this.runs[conversationId].status = 'stopping'
      try { await desktop.stopClaude(conversationId) } catch (error) { this.runs[conversationId].error = String(error) }
    },

    handleClaudeEvent(payload) {
      const run = this.runs[payload.conversationId]
      if (!run || (run.runId && run.runId !== payload.runId)) return
      if (payload.kind === 'started' && run.status === 'starting') run.status = 'running'
      if (payload.kind === 'stderr') run.error = payload.data?.message || ''
      if (payload.kind === 'context') {
        const context = storedContext(payload.data)
        if (context) Object.assign(run.context, context)
      }
      if (payload.kind === 'error') {
        if (run.status !== 'steering' && run.status !== 'stopping') {
          run.status = 'error'
          run.error = payload.data?.message || 'Claude stopped unexpectedly.'
        }
      }
      if (payload.kind === 'stream') {
        for (const event of parseClaudeEvent(payload.data)) {
          if (applyRunTimelineEvent(run, event)) continue
          if (event.type === 'text') { run.content += event.text; run.sawPartialText = true }
          if (event.type === 'full-text' && !run.sawPartialText && !run.content) run.content = event.text
          if (event.type === 'usage') Object.assign(run.context, { tokens: event.tokens, measured: true, estimated: false })
          if (event.type === 'result') {
            if (!run.content && event.text) run.content = event.text
            if (event.cumulativeTokens) run.context.cumulativeTokens = event.cumulativeTokens
            if (event.contextWindow) run.context.window = event.contextWindow
            if (event.permissionDenials.length) run.permissionDenied = true
            if (event.error) {
              if (run.status !== 'stopping' && run.status !== 'steering') { run.status = 'error'; run.error = event.errorMessage }
            } else if (run.status !== 'stopping' && run.status !== 'steering') run.status = 'finishing'
          }
        }
      }
      if (payload.kind === 'exit') {
        let shouldContinue = false
        if (run.status === 'steering') run.status = 'interrupted'
        else if (!payload.data?.success && run.status !== 'stopping' && run.status !== 'error') {
          run.status = 'error'
          run.error ||= 'Claude exited before completing the response.'
        } else if (run.status !== 'error') {
          run.status = run.status === 'stopping' ? 'stopped' : 'complete'
          shouldContinue = run.status === 'complete'
        }
        if (run.status === 'interrupted') shouldContinue = true
        this.finishRun(payload.conversationId, shouldContinue)
      }
    },

    async finishRun(conversationId, shouldContinue) {
      await this.finalizeRun(conversationId)
      delete this.runs[conversationId]
      if (shouldContinue) await this.dispatchNextQueued(conversationId)
    },

    async finalizeRun(conversationId) {
      const run = this.runs[conversationId]
      if (!run || run.finalized) return
      run.finalized = true
      for (const activity of run.activities) if (activity.status === 'running') activity.status = run.status === 'complete' ? 'success' : 'error'
      if (run.context.measured || run.context.window) this.contextStats[conversationId] = { ...run.context }
      if (run.operation === 'compact' && run.status === 'complete') {
        const compactedAt = new Date().toISOString()
        this.contextStats[conversationId] = { ...run.context, lastCompactedAt: compactedAt }
        try {
          const message = await desktop.saveMessage(conversationId, 'system', 'Context compacted manually · Full transcript remains available')
          ;(this.messages[conversationId] ||= []).push(message)
        } catch (error) { run.error = String(error) }
      } else {
        const partial = run.content.trim()
        const content = run.status === 'interrupted' && partial
          ? `${partial}\n\n> 已根据补充内容中断，并继续处理新要求。`
          : partial || (run.status === 'stopped' ? '已停止。' : '')
        if (content) {
          try {
            const message = await desktop.saveMessage(conversationId, 'assistant', content)
            ;(this.messages[conversationId] ||= []).push(message)
            run.content = ''
          } catch (error) { run.error = String(error) }
        }
      }
      await this.refreshChanges()
    },

    async refreshChanges() {
      const project = this.activeProject
      if (!project) return
      if (changesRefreshes.has(project.id)) return changesRefreshes.get(project.id)
      const requestId = ++changesRequestId
      const refresh = Promise.all([
        desktop.gitStatus(project.path),
        desktop.gitEnvironment(project.path),
      ]).then(([changes, environment]) => {
        if (requestId !== changesRequestId || this.activeProjectId !== project.id) return
        this.changes[project.id] = changes
        this.gitEnvironments[project.id] = environment
        if (this.diffDrawer && !changes.some((file) => file.path === this.diffDrawer.file.path)) this.diffDrawer = null
      }).finally(() => {
        if (changesRefreshes.get(project.id) === refresh) changesRefreshes.delete(project.id)
      })
      changesRefreshes.set(project.id, refresh)
      return refresh
    },

    async openEnvironment() {
      if (!this.activeProject) return
      this.environmentPanel = true
      try { await this.refreshChanges() } catch (error) { this.error = String(error) }
    },

    async openDiff(file) {
      if (!file || !this.activeProject) return
      const requestId = ++diffRequestId
      this.diffDrawer = { file, content: '', loading: true, error: '', requestId }
      try {
        const content = await desktop.gitDiff(this.activeProject.path, file.path)
        if (this.diffDrawer?.requestId === requestId) Object.assign(this.diffDrawer, { content, loading: false })
      } catch (error) {
        if (this.diffDrawer?.requestId === requestId) Object.assign(this.diffDrawer, { error: String(error), loading: false })
      }
    },

    async openChanges() {
      const file = preferredChange(this.activeChanges)
      this.environmentPanel = false
      if (file) await this.openDiff(file)
    },

    async commitProjectChanges(message, push) {
      if (!this.activeProject || !this.activeChanges.length || this.activeProjectHasRun || this.gitOperationBusy) return null
      this.gitOperationBusy = true
      try {
        const result = await desktop.gitCommit(this.activeProject.path, message, Boolean(push))
        await this.refreshChanges()
        return result
      } finally {
        this.gitOperationBusy = false
      }
    },

    async openFile(path, line = null, forceInternal = false) {
      if (!this.activeProject) return
      if (!forceInternal && this.settings.editor !== 'claude-desk') {
        try { await desktop.openInEditor(path, line, this.settings.editor) } catch (error) { this.error = String(error) }
        return
      }
      const requestId = ++filePreviewRequestId
      this.filePreview = {
        path,
        relativePath: path,
        name: path.split('/').pop() || 'file',
        content: '',
        size: 0,
        loading: true,
        error: '',
        requestId,
      }
      this.workspaceView = 'files'
      try {
        const file = await desktop.readProjectFile(this.activeProject.path, path)
        if (this.filePreview?.requestId === requestId) Object.assign(this.filePreview, file, { loading: false })
      } catch (error) {
        if (this.filePreview?.requestId === requestId) Object.assign(this.filePreview, { error: String(error), loading: false })
      }
    },

    closeFilePreview() {
      this.filePreview = null
      this.workspaceView = 'conversation'
    },

    async saveAppSettings(settings) {
      this.settings = { ...defaultSettings, ...settings }
      await desktop.saveSettings(this.settings)
      await this.refreshHealth()
      this.settingsOpen = false
      document.documentElement.dataset.theme = this.settings.theme
    },

    async saveConfiguration(content, generalSettings) {
      const file = await desktop.saveClaudeSettings(content)
      this.claudeSettingsContent = file.content
      this.claudeSettingsPath = file.path
      this.claudeSettings = JSON.parse(file.content)
      this.claudeSettingsError = ''
      this.settings = {
        ...defaultSettings,
        ...removeMigratedLegacySettings(this.settings),
        ...generalSettings,
      }
      await desktop.saveSettings(this.settings)
      await this.refreshHealth()
      document.documentElement.dataset.theme = this.settings.theme
      this.settingsOpen = false
    },

    async compactConversation() {
      const conversation = this.activeConversation
      const project = this.activeProject
      const hasHistory = this.activeMessages.some((message) => message.role === 'user')
      if (!conversation || !project || !hasHistory || this.runs[conversation.id]) return
      this.runs[conversation.id] = newRun('compact', this.contextStats[conversation.id])
      try {
        const runId = await desktop.sendClaude({
          conversationId: conversation.id,
          sessionId: conversation.claudeSessionId,
          projectPath: project.path,
          prompt: '/compact Preserve the current plan, changed files, unresolved decisions, and latest test results.',
          resume: true,
          command: this.settings.command,
          args: this.settings.args,
          env: this.settings.env,
          permissionMode: this.settings.permissionMode,
        })
        if (this.runs[conversation.id]) this.runs[conversation.id].runId = runId
      } catch (error) {
        this.runs[conversation.id].status = 'error'
        this.runs[conversation.id].error = String(error)
        this.error = String(error)
        await this.finalizeRun(conversation.id)
        delete this.runs[conversation.id]
      }
    },

    async savePermissionMode(permissionMode) {
      this.settings = { ...this.settings, permissionMode }
      await desktop.saveSettings(this.settings)
      this.permissionsOpen = false
    },
  },
})
