import { defineStore } from 'pinia'
import { listen } from '@tauri-apps/api/event'
import { desktop } from '../services/desktop'
import { attachmentPrompt } from '../services/attachments'
import { preferredChange } from '../services/changes'
import { mergeActivity, parseClaudeEvent } from '../services/claude/parser'
import { createQueuedMessage, prioritizeQueuedMessage, resetQueuedMessage, takeNextQueuedMessage } from '../services/claude/queue'
import { removeMigratedLegacySettings } from '../services/claude/settings'

const defaultSettings = {
  command: 'claude',
  args: [],
  env: {},
  permissionMode: 'acceptEdits',
  theme: 'system',
  editor: 'vscode',
}

let diffRequestId = 0
let filePreviewRequestId = 0
let changesRequestId = 0

function conciseTitle(content) {
  const title = content.replace(/\s+/g, ' ').trim()
  return title.length > 28 ? `${title.slice(0, 28)}…` : title || 'New Conversation'
}

function newRun(operation = 'chat', context = null) {
  return {
    runId: null,
    operation,
    content: '',
    activities: operation === 'compact' ? [{ id: 'compact', label: 'Compacting context', status: 'running' }] : [],
    status: 'starting',
    error: '',
    finalized: false,
    sawPartialText: false,
    permissionDenied: false,
    context: context ? { ...context } : { tokens: 0, window: 0, measured: false },
  }
}

export const useWorkspaceStore = defineStore('workspace', {
  state: () => ({
    projects: [],
    conversations: [],
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
    changes: {},
    loading: true,
    error: '',
    settingsOpen: false,
    permissionsOpen: false,
    sidebarCollapsed: false,
    previewAttachment: null,
    filePreview: null,
    workspaceView: 'conversation',
    diffDrawer: null,
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
      const tokens = Number(current.tokens || 0)
      return {
        tokens,
        window,
        measured: Boolean(current.measured && tokens),
        estimated: Boolean(current.estimated),
        percentage: window ? Math.min(100, Math.round((tokens / window) * 100)) : 0,
        autoCompact: env.DISABLE_AUTO_COMPACT !== '1',
        threshold: Number(env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE || 95),
        lastCompactedAt: current.lastCompactedAt || null,
      }
    },
    activeChanges(state) { return state.changes[state.activeProjectId] || [] },
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

    async selectProject(id) {
      if (this.activeProjectId === id && this.conversations.length) return
      this.activeProjectId = id
      this.filePreview = null
      this.workspaceView = 'conversation'
      await desktop.touchProject(id)
      this.conversations = await desktop.listConversations(id)
      const first = this.conversations[0]
      this.activeConversationId = null
      if (first) await this.selectConversation(first.id)
      await this.refreshChanges()
    },

    async removeProject(project) {
      await desktop.removeProject(project.id)
      this.projects = this.projects.filter((item) => item.id !== project.id)
      if (this.activeProjectId !== project.id) return
      this.activeProjectId = null
      this.activeConversationId = null
      this.conversations = []
      if (this.projects[0]) await this.selectProject(this.projects[0].id)
    },

    async newConversation() {
      if (!this.activeProjectId) return
      const conversation = await desktop.createConversation(this.activeProjectId)
      this.conversations.unshift(conversation)
      this.messages[conversation.id] = []
      this.activeConversationId = conversation.id
    },

    async selectConversation(id) {
      this.activeConversationId = id
      this.workspaceView = 'conversation'
      await desktop.touchConversation(id)
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
      conversation.title = title.trim()
    },

    async deleteConversation(conversation) {
      if (this.runs[conversation.id]) await this.stopClaude(conversation.id)
      await desktop.deleteConversation(conversation.id)
      this.conversations = this.conversations.filter((item) => item.id !== conversation.id)
      for (const message of this.messages[conversation.id] || []) delete this.attachmentsByMessage[message.id]
      delete this.messages[conversation.id]
      delete this.queuedMessages[conversation.id]
      if (this.activeConversationId === conversation.id) {
        this.activeConversationId = null
        if (this.conversations[0]) await this.selectConversation(this.conversations[0].id)
      }
    },

    async sendMessage(content, attachments = []) {
      const conversation = this.activeConversation
      const project = this.activeProject
      const cleanContent = content.trim()
      if (!conversation || !project || (!cleanContent && !attachments.length)) return
      const queued = createQueuedMessage({
        id: crypto.randomUUID(),
        conversation,
        project,
        content: cleanContent,
        attachments,
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
      const content = queued.content || '请查看附件。'
      const userMessage = await desktop.saveMessage(queued.conversationId, 'user', content)
      if (queued.attachments.length) {
        await desktop.linkAttachments(userMessage.id, queued.attachments.map((item) => item.id))
        this.attachmentsByMessage[userMessage.id] = queued.attachments.map((item) => ({ ...item, messageId: userMessage.id }))
      }
      previousMessages.push(userMessage)
      this.messages[queued.conversationId] = previousMessages
      const conversation = this.conversations.find((item) => item.id === queued.conversationId)
      if (conversation?.title === 'New Conversation') {
        await this.renameConversation(conversation, conciseTitle(queued.content || queued.attachments[0]?.name || 'New Conversation'))
      }

      this.runs[queued.conversationId] = newRun('chat', this.contextStats[queued.conversationId])
      try {
        const runId = await desktop.sendClaude({
          conversationId: queued.conversationId,
          sessionId: queued.sessionId,
          projectPath: queued.projectPath,
          prompt: attachmentPrompt(content, queued.attachments),
          resume: hasPreviousUserMessage,
          command: this.settings.command,
          args: this.settings.args,
          env: this.settings.env,
          permissionMode: this.settings.permissionMode,
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
      if (payload.kind === 'error') {
        if (run.status !== 'steering' && run.status !== 'stopping') {
          run.status = 'error'
          run.error = payload.data?.message || 'Claude stopped unexpectedly.'
        }
      }
      if (payload.kind === 'stream') {
        for (const event of parseClaudeEvent(payload.data)) {
          if (event.type === 'text') { run.content += event.text; run.sawPartialText = true }
          if (event.type === 'full-text' && !run.sawPartialText && !run.content) run.content = event.text
          if (event.type === 'activity') mergeActivity(run.activities, event.activity)
          if (event.type === 'usage') Object.assign(run.context, { tokens: event.tokens, measured: true, estimated: event.estimated })
          if (event.type === 'activity-complete') {
            const activity = run.activities.find((item) => item.id === event.id)
            if (activity) activity.status = event.error ? 'error' : 'success'
          }
          if (event.type === 'result') {
            if (!run.content && event.text) run.content = event.text
            if (!run.context.measured && event.tokens) Object.assign(run.context, { tokens: event.tokens, measured: true, estimated: true })
            if (event.contextWindow) run.context.window = event.contextWindow
            if (event.permissionDenials.length) run.permissionDenied = true
            if (event.error) {
              if (run.status !== 'stopping' && run.status !== 'steering') { run.status = 'error'; run.error = event.errorMessage }
            } else run.status = 'complete'
          }
        }
      }
      if (payload.kind === 'exit') {
        const shouldContinue = run.status === 'complete' || run.status === 'steering'
        if (run.status === 'steering') run.status = 'interrupted'
        else if (!payload.data?.success && run.status !== 'stopping' && run.status !== 'error') {
          run.status = 'error'
          run.error ||= 'Claude exited before completing the response.'
        } else if (run.status !== 'error') run.status = run.status === 'stopping' ? 'stopped' : 'complete'
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
        this.contextStats[conversationId] = { tokens: 0, window: run.context.window, measured: false, lastCompactedAt: compactedAt }
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
      const requestId = ++changesRequestId
      const changes = await desktop.gitStatus(project.path)
      if (requestId !== changesRequestId || this.activeProjectId !== project.id) return
      this.changes[project.id] = changes
      if (this.diffDrawer && !changes.some((file) => file.path === this.diffDrawer.file.path)) this.diffDrawer = null
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
      if (file) await this.openDiff(file)
    },

    async openFile(path, line = null) {
      if (!this.activeProject) return
      if (this.settings.editor !== 'claude-desk') {
        try { await desktop.openInEditor(path, line, this.settings.editor) } catch (error) { this.error = String(error) }
        return
      }
      const requestId = ++filePreviewRequestId
      this.filePreview = {
        path,
        name: path.split('/').pop() || 'file',
        content: '',
        size: 0,
        loading: true,
        error: '',
        requestId,
      }
      this.workspaceView = 'file'
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
