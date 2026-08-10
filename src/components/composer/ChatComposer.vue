<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ArrowUp, File, Paperclip, Square, X } from 'lucide-vue-next'
import { open } from '@tauri-apps/plugin-dialog'
import { convertFileSrc } from '@tauri-apps/api/core'
import { clipboardImageFromEvent } from '../../services/attachments'
import { shouldSubmitComposer } from '../../services/composerKeyboard'
import { resizeComposerTextarea } from '../../services/composerTextarea'
import { matchingSkills, slashSkillQuery } from '../../services/skills'
import { desktop } from '../../services/desktop'
import { useWorkspaceStore } from '../../stores/workspace'
import ContextMeter from './ContextMeter.vue'
import QueuedMessages from './QueuedMessages.vue'
import SlashSkillMenu from './SlashSkillMenu.vue'
import { useI18n } from '../../services/i18n'

const store = useWorkspaceStore()
const { t } = useI18n()
const text = ref('')
const attachments = ref([])
const input = ref(null)
const adding = ref(false)
const composition = { composing: false, compositionEndedAt: -Infinity }
const activeConversationId = computed(() => store.activeConversationId)
const skills = ref([])
const skillIndex = ref(0)
const skillMenuDismissed = ref(false)
const skillQuery = computed(() => slashSkillQuery(text.value))
const visibleSkills = computed(() => matchingSkills(skills.value, skillQuery.value))
const skillMenuOpen = computed(() => skillQuery.value !== null && !skillMenuDismissed.value && visibleSkills.value.length > 0)

async function addPaths(paths) {
  if (!store.activeConversationId || !paths?.length) return
  adding.value = true
  try {
    for (const path of paths) attachments.value.push(await desktop.copyAttachment(store.activeConversationId, path))
  } catch (error) { store.error = String(error) }
  finally { adding.value = false }
}

async function chooseFiles() {
  const paths = await open({ multiple: true, directory: false, title: t('composer.attachDialog') })
  if (paths) await addPaths(Array.isArray(paths) ? paths : [paths])
}

async function onPaste(event) {
  const image = await clipboardImageFromEvent(event)
  if (!image || !store.activeConversationId) return
  event.preventDefault()
  try { attachments.value.push(await desktop.saveClipboardImage(store.activeConversationId, image.bytes, image.extension)) }
  catch (error) { store.error = String(error) }
}

async function send() {
  if (!text.value.trim() && !attachments.value.length) return
  const conversationId = store.activeConversationId
  const outgoing = attachments.value
  const content = text.value
  text.value = ''
  attachments.value = []
  store.setDraft(conversationId, '')
  await store.sendMessage(content, outgoing)
}

function keydown(event) {
  if (handleSkillKeydown(event)) return
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
  text.value = `/${skill.name} `
  skillIndex.value = 0
  nextTick(focus)
}

function compositionStart() { composition.composing = true }
function compositionEnd() {
  composition.composing = false
  composition.compositionEndedAt = performance.now()
}

function focus() { input.value?.focus() }
function resizeInput() { resizeComposerTextarea(input.value) }
function dropped(event) { addPaths(event.detail) }
function activateQueued(messageId) {
  if (store.activeConversationId) store.sendQueuedMessageNow(store.activeConversationId, messageId)
}
function removeQueued(messageId) {
  if (store.activeConversationId) store.removeQueuedMessage(store.activeConversationId, messageId)
}
async function loadSkills() {
  if (!store.activeProject?.path) {
    skills.value = []
    return
  }
  try { skills.value = await desktop.listClaudeSkills(store.activeProject.path) }
  catch { skills.value = [] }
}
watch(text, (value) => {
  store.setDraft(activeConversationId.value, value)
  skillIndex.value = 0
  skillMenuDismissed.value = false
  nextTick(resizeInput)
})
watch(activeConversationId, (next, previous) => {
  if (previous && previous !== next) store.setDraft(previous, text.value)
  text.value = next ? store.drafts[next] || '' : ''
  nextTick(resizeInput)
}, { immediate: true })
watch(() => store.activeProject?.path, loadSkills, { immediate: true })
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
      <div v-if="attachments.length" class="attachment-strip">
        <div v-for="(attachment, index) in attachments" :key="attachment.id" class="attachment-card">
          <img v-if="attachment.kind === 'image'" :src="convertFileSrc(attachment.path)" :alt="attachment.name" />
          <div v-else class="file-thumb"><File :size="21" /></div>
          <span>{{ attachment.name }}</span>
          <button :title="t('composer.removeAttachment')" @click="attachments.splice(index, 1)"><X :size="13" /></button>
        </div>
      </div>
      <SlashSkillMenu :skills="skillMenuOpen ? visibleSkills : []" :active-index="skillIndex" @select="chooseSkill" />
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
        <span class="composer-hint">{{ t(store.activeRun ? 'composer.queueHint' : 'composer.sendHint') }} · {{ t('composer.newlineHint') }}</span>
        <button v-if="store.activeRun" class="send-button stop-button" :title="t('composer.stop')" @click="store.stopClaude()"><Square :size="13" fill="currentColor" /></button>
        <button class="send-button" :disabled="!text.trim() && !attachments.length" :title="t(store.activeRun ? 'composer.queue' : 'composer.send')" @click="send"><ArrowUp :size="18" /></button>
      </div>
    </div>
  </div>
</template>
