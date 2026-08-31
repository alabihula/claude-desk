<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ArrowUp, File, Paperclip, Square, X } from 'lucide-vue-next'
import { open } from '@tauri-apps/plugin-dialog'
import { convertFileSrc } from '@tauri-apps/api/core'
import { attachmentTypeLabel, clipboardImageFromEvent, copyAttachmentPaths } from '../../services/attachments'
import { shouldSubmitComposer } from '../../services/composerKeyboard'
import { resizeComposerTextarea } from '../../services/composerTextarea'
import { matchingSkills, selectedSkillInput, slashSkillQuery } from '../../services/skills'
import { useCloseOnOutsidePointerDown } from '../../services/clickOutside'
import { desktop } from '../../services/desktop'
import { useWorkspaceStore } from '../../stores/workspace'
import { configuredModel } from '../../services/claude/settings'
import ComposerRuntimeControls from './ComposerRuntimeControls.vue'
import ContextMeter from './ContextMeter.vue'
import McpServerPanel from './McpServerPanel.vue'
import CodeSnippetCapsule from '../common/CodeSnippetCapsule.vue'
import QueuedMessages from './QueuedMessages.vue'
import SlashSkillMenu from './SlashSkillMenu.vue'
import { useI18n } from '../../services/i18n'

const store = useWorkspaceStore()
const { t } = useI18n()
const text = ref('')
const skillDrafts = ref({})
const input = ref(null)
const adding = ref(false)
const runtimeSaving = ref(false)
const composition = { composing: false, compositionEndedAt: -Infinity }
const activeConversationId = computed(() => store.activeConversationId)
const activeConversation = computed(() => store.activeConversation)
const defaultModel = computed(() => configuredModel(store.claudeSettings, store.settings))
const attachments = computed(() => store.attachmentDrafts[activeConversationId.value] || [])
const snippets = computed(() => store.snippetDrafts[activeConversationId.value] || [])
const skills = ref([])
const selectedSkill = computed({
  get: () => skillDrafts.value[activeConversationId.value] || null,
  set: (value) => {
    if (!activeConversationId.value) return
    if (value) skillDrafts.value[activeConversationId.value] = value
    else delete skillDrafts.value[activeConversationId.value]
  },
})
const skillIndex = ref(0)
const skillMenuDismissed = ref(false)
const mcpPanelRoot = ref(null)
const mcpPanelOpen = ref(false)
const mcpServers = ref([])
const mcpLoading = ref(false)
const mcpError = ref('')
let mcpRequestId = 0
const skillQuery = computed(() => slashSkillQuery(text.value))
const builtInCommands = computed(() => [{
  name: 'mcp',
  description: t('skills.mcpDescription'),
  scope: 'builtIn',
  invocation: 'native',
}])
const slashItems = computed(() => [
  ...builtInCommands.value,
  ...skills.value.filter((skill) => skill.name !== 'mcp'),
])
const visibleSkills = computed(() => matchingSkills(slashItems.value, skillQuery.value))
const skillMenuOpen = computed(() => !mcpPanelOpen.value && skillQuery.value !== null && !skillMenuDismissed.value && visibleSkills.value.length > 0)

async function addPaths(paths, conversationId = store.activeConversationId) {
  if (!conversationId || !paths?.length) return
  adding.value = true
  try {
    const result = await copyAttachmentPaths(paths, conversationId, desktop.copyAttachment)
    store.appendAttachmentDrafts(conversationId, result.attachments)
    if (result.errors.length) store.error = result.errors.map(({ path, error }) => `${path}: ${error}`).join('\n')
  } catch (error) { store.error = String(error) }
  finally { adding.value = false }
}

async function chooseFiles() {
  const paths = await open({ multiple: true, directory: false, title: t('composer.attachDialog') })
  if (paths) await addPaths(Array.isArray(paths) ? paths : [paths])
}

async function changeRuntime(patch) {
  const conversation = activeConversation.value
  if (!conversation || runtimeSaving.value) return
  runtimeSaving.value = true
  try {
    await store.updateConversationRuntime(conversation.id, {
      model: conversation.model || null,
      effort: conversation.effort || null,
      ...patch,
    })
  } catch (error) { store.error = String(error) }
  finally { runtimeSaving.value = false }
}

async function onPaste(event) {
  const hasImage = [...(event.clipboardData?.items || [])].some((item) => item.type.startsWith('image/'))
  const conversationId = store.activeConversationId
  if (!hasImage || !conversationId) return
  // Clipboard data is only synchronously cancelable; waiting for arrayBuffer would also paste the file name.
  event.preventDefault()
  const image = await clipboardImageFromEvent(event)
  if (!image) return
  try {
    const attachment = await desktop.saveClipboardImage(conversationId, image.bytes, image.extension)
    store.appendAttachmentDrafts(conversationId, [attachment])
  }
  catch (error) { store.error = String(error) }
}

function removeAttachment(attachmentId) {
  store.removeAttachmentDraft(activeConversationId.value, attachmentId)
}

async function send() {
  if (!text.value.trim() && !attachments.value.length && !snippets.value.length) return
  if (text.value.trim() === '/mcp') {
    openMcpPanel()
    return
  }
  const conversationId = store.activeConversationId
  const outgoing = [...attachments.value]
  const outgoingSnippets = snippets.value
  const content = text.value
  const skill = selectedSkill.value
  text.value = ''
  selectedSkill.value = null
  store.clearAttachmentDrafts(conversationId)
  store.clearSnippetDrafts(conversationId)
  store.setDraft(conversationId, '')
  await store.sendMessage(content, outgoing, skill, outgoingSnippets)
}

function keydown(event) {
  if (handleSkillKeydown(event)) return
  if (mcpPanelOpen.value && event.key === 'Escape') {
    event.preventDefault()
    closeMcpPanel()
    return
  }
  if (shouldSubmitComposer(event, composition)) { event.preventDefault(); send() }
}

function handleSkillKeydown(event) {
  if (!skillMenuOpen.value || event.isComposing || event.keyCode === 229) return false
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    skillIndex.value = (skillIndex.value + 1) % visibleSkills.value.length
    return true
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault()
    skillIndex.value = (skillIndex.value + visibleSkills.value.length - 1) % visibleSkills.value.length
    return true
  }
  if (event.key === 'Enter' || event.key === 'Tab') {
    event.preventDefault()
    chooseSkill(visibleSkills.value[skillIndex.value])
    return true
  }
  if (event.key === 'Escape') {
    event.preventDefault()
    skillMenuDismissed.value = true
    return true
  }
  return false
}

function chooseSkill(skill) {
  if (!skill) return
  if (skill.name === 'mcp' && skill.scope === 'builtIn') {
    openMcpPanel()
    return
  }
  const selected = selectedSkillInput(skill)
  text.value = selected.text
  selectedSkill.value = selected.skill
  skillIndex.value = 0
  nextTick(focus)
}

async function loadMcpServers() {
  const projectPath = store.activeProject?.path
  if (!projectPath || mcpLoading.value) return
  const requestId = ++mcpRequestId
  mcpLoading.value = true
  mcpError.value = ''
  try {
    const servers = await desktop.listMcpServers(projectPath, store.settings.command, store.settings.env)
    if (requestId === mcpRequestId && store.activeProject?.path === projectPath) mcpServers.value = servers
  } catch (error) {
    if (requestId === mcpRequestId) {
      mcpServers.value = []
      mcpError.value = String(error)
    }
  } finally {
    if (requestId === mcpRequestId) mcpLoading.value = false
  }
}

function openMcpPanel() {
  text.value = ''
  selectedSkill.value = null
  skillMenuDismissed.value = true
  mcpPanelOpen.value = true
  loadMcpServers()
}

function closeMcpPanel() {
  if (!mcpPanelOpen.value) return
  mcpPanelOpen.value = false
  nextTick(focus)
}

useCloseOnOutsidePointerDown(mcpPanelRoot, closeMcpPanel)

function compositionStart() { composition.composing = true }
function compositionEnd() {
  composition.composing = false
  composition.compositionEndedAt = performance.now()
}

function focus() { input.value?.focus() }
function resizeInput() { resizeComposerTextarea(input.value) }
function dropped(event) { addPaths(event.detail?.paths, event.detail?.conversationId) }
function activateQueued(messageId) {
  if (store.activeConversationId) store.sendQueuedMessageNow(store.activeConversationId, messageId)
}
function removeQueued(messageId) {
  if (store.activeConversationId) store.removeQueuedMessage(store.activeConversationId, messageId)
}
async function loadSkills() {
  const projectPath = store.activeProject?.path
  if (!projectPath) {
    skills.value = []
    return
  }
  try {
    const result = await desktop.listClaudeSkills(projectPath)
    if (store.activeProject?.path === projectPath) skills.value = result
  }
  catch { skills.value = [] }
}
watch(text, (value) => {
  const prefix = selectedSkill.value ? `/${selectedSkill.value.name}` : ''
  if (prefix && value !== prefix && !value.startsWith(`${prefix} `)) selectedSkill.value = null
  store.setDraft(activeConversationId.value, value)
  skillIndex.value = 0
  skillMenuDismissed.value = false
  nextTick(resizeInput)
})
watch(skillQuery, (next, previous) => {
  if (next !== null && previous === null) loadSkills()
})
watch(activeConversationId, (next, previous) => {
  if (previous && previous !== next) store.setDraft(previous, text.value)
  text.value = next ? store.drafts[next] || '' : ''
  nextTick(resizeInput)
}, { immediate: true })
watch(() => store.activeProject?.path, () => {
  mcpRequestId += 1
  mcpLoading.value = false
  mcpServers.value = []
  mcpError.value = ''
  closeMcpPanel()
  loadSkills()
}, { immediate: true })
onMounted(() => {
  window.addEventListener('claude-desk-drop', dropped)
  window.addEventListener('claude-desk-focus', focus)
  window.addEventListener('resize', resizeInput)
  resizeInput()
})
onBeforeUnmount(() => {
  store.setDraft(activeConversationId.value, text.value)
  window.removeEventListener('claude-desk-drop', dropped)
  window.removeEventListener('claude-desk-focus', focus)
  window.removeEventListener('resize', resizeInput)
})
</script>

<template>
  <div class="composer-wrap">
    <div class="composer" :class="{ busy: store.activeRun }">
      <QueuedMessages
        :messages="store.activeQueuedMessages"
        :running="Boolean(store.activeRun)"
        @activate="activateQueued"
        @remove="removeQueued"
      />
      <div v-if="attachments.length || snippets.length" class="composer-draft-items">
        <div
          v-for="attachment in attachments"
          :key="attachment.id"
          class="attachment-card"
          :title="attachment.sourcePath || attachment.path || attachment.name"
        >
          <button
            v-if="attachment.kind === 'image'"
            class="attachment-thumb attachment-preview"
            :aria-label="t('message.preview', { name: attachment.name })"
            @click="store.previewAttachment = attachment"
          >
            <img :src="convertFileSrc(attachment.path)" :alt="attachment.name" />
          </button>
          <div v-else class="attachment-thumb"><File :size="23" /></div>
          <span><strong>{{ attachment.name }}</strong><small>{{ attachmentTypeLabel(attachment) }}</small></span>
          <button class="attachment-remove" :title="t('composer.removeAttachment')" @click="removeAttachment(attachment.id)"><X :size="13" /></button>
        </div>
        <CodeSnippetCapsule :snippets="snippets" removable @clear="store.clearSnippetDrafts(activeConversationId)" />
      </div>
      <SlashSkillMenu :skills="skillMenuOpen ? visibleSkills : []" :active-index="skillIndex" @select="chooseSkill" />
      <div v-if="mcpPanelOpen" ref="mcpPanelRoot" class="mcp-panel-anchor">
        <McpServerPanel
          :servers="mcpServers"
          :runtime="store.mcpRuntimeByConversation[store.activeConversationId] || null"
          :loading="mcpLoading"
          :error="mcpError"
          @refresh="loadMcpServers"
          @close="closeMcpPanel"
        />
      </div>
      <textarea
        ref="input"
        v-model="text"
        rows="1"
        :placeholder="t(store.activeRun ? 'composer.queuedPlaceholder' : 'composer.placeholder')"
        @keydown="keydown"
        @compositionstart="compositionStart"
        @compositionend="compositionEnd"
        @paste="onPaste"
      ></textarea>
      <div class="composer-actions">
        <button class="attach-button" :disabled="adding" :title="t('composer.attachFiles')" @click="chooseFiles">
          <Paperclip :size="17" /> <span>{{ t(adding ? 'composer.adding' : 'composer.attach') }}</span>
        </button>
        <ContextMeter />
        <ComposerRuntimeControls
          v-if="activeConversation"
          :model="activeConversation.model || ''"
          :effort="activeConversation.effort || ''"
          :default-model="defaultModel"
          :saving="runtimeSaving"
          @change="changeRuntime"
        />
        <span class="composer-hint">{{ t(store.activeRun ? 'composer.queueHint' : 'composer.sendHint') }} · {{ t('composer.newlineHint') }}</span>
        <button v-if="store.activeRun" class="send-button stop-button" :title="t('composer.stop')" @click="store.stopClaude()"><Square :size="13" fill="currentColor" /></button>
        <button class="send-button" :disabled="!text.trim() && !attachments.length && !snippets.length" :title="t(store.activeRun ? 'composer.queue' : 'composer.send')" @click="send"><ArrowUp :size="18" /></button>
      </div>
    </div>
  </div>
</template>
