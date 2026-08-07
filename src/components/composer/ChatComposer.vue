<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ArrowUp, File, Paperclip, Square, X } from 'lucide-vue-next'
import { open } from '@tauri-apps/plugin-dialog'
import { convertFileSrc } from '@tauri-apps/api/core'
import { clipboardImageFromEvent } from '../../services/attachments'
import { shouldSubmitComposer } from '../../services/composerKeyboard'
import { resizeComposerTextarea } from '../../services/composerTextarea'
import { desktop } from '../../services/desktop'
import { useWorkspaceStore } from '../../stores/workspace'
import ContextMeter from './ContextMeter.vue'
import QueuedMessages from './QueuedMessages.vue'

const store = useWorkspaceStore()
const text = ref('')
const attachments = ref([])
const input = ref(null)
const adding = ref(false)
const composition = { composing: false, compositionEndedAt: -Infinity }

async function addPaths(paths) {
  if (!store.activeConversationId || !paths?.length) return
  adding.value = true
  try {
    for (const path of paths) attachments.value.push(await desktop.copyAttachment(store.activeConversationId, path))
  } catch (error) { store.error = String(error) }
  finally { adding.value = false }
}

async function chooseFiles() {
  const paths = await open({ multiple: true, directory: false, title: 'Attach files for Claude' })
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
  const outgoing = attachments.value
  const content = text.value
  text.value = ''
  attachments.value = []
  await store.sendMessage(content, outgoing)
}

function keydown(event) {
  if (shouldSubmitComposer(event, composition)) { event.preventDefault(); send() }
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
watch(text, () => nextTick(resizeInput))
onMounted(() => {
  window.addEventListener('claude-desk-drop', dropped)
  window.addEventListener('claude-desk-focus', focus)
  window.addEventListener('resize', resizeInput)
  resizeInput()
})
onBeforeUnmount(() => {
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
          <button title="Remove attachment" @click="attachments.splice(index, 1)"><X :size="13" /></button>
        </div>
      </div>
      <textarea
        ref="input"
        v-model="text"
        rows="1"
        :placeholder="store.activeRun ? '补充内容会先加入待处理队列…' : 'Ask Claude…'"
        @keydown="keydown"
        @compositionstart="compositionStart"
        @compositionend="compositionEnd"
        @paste="onPaste"
      ></textarea>
      <div class="composer-actions">
        <button class="attach-button" :disabled="adding" title="Attach files" @click="chooseFiles">
          <Paperclip :size="17" /> <span>{{ adding ? 'Adding…' : 'Attach' }}</span>
        </button>
        <ContextMeter />
        <span class="composer-hint">{{ store.activeRun ? 'Enter 加入队列' : 'Enter 发送' }} · Shift Enter 换行</span>
        <button v-if="store.activeRun" class="send-button stop-button" title="Stop Claude" @click="store.stopClaude()"><Square :size="13" fill="currentColor" /></button>
        <button class="send-button" :disabled="!text.trim() && !attachments.length" :title="store.activeRun ? '加入待处理队列' : '发送'" @click="send"><ArrowUp :size="18" /></button>
      </div>
    </div>
  </div>
</template>
