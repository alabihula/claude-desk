<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { convertFileSrc } from '@tauri-apps/api/core'
import { downloadDir, join } from '@tauri-apps/api/path'
import { save } from '@tauri-apps/plugin-dialog'
import { openUrl } from '@tauri-apps/plugin-opener'
import { AlertTriangle, Check, Copy, Download, File, FileCode2, FileText, Minimize2, ZoomIn } from 'lucide-vue-next'
import { desktop } from '../../services/desktop'
import { extractLocalFileCandidates, extractProjectFileReferences, formatFileSize, localProjectLink } from '../../services/localFiles'
import { codeCopyPayload, createMessageMarkdown, externalHttpUrl, writeClipboardText } from '../../services/markdown'
import { useWorkspaceStore } from '../../stores/workspace'
import { useI18n } from '../../services/i18n'
import CodeSnippetCapsule from '../common/CodeSnippetCapsule.vue'
import { parseDiagnosticMessage } from '../../services/claude/diagnostics'
import { formatMessageTime } from '../../services/messageTime'

const props = defineProps({
  message: { type: Object, required: true },
  attachments: { type: Array, default: () => [] },
})
const store = useWorkspaceStore()
const { language, t } = useI18n()
const copyTimers = new Map()
const downloadTimers = new Map()
const downloadableFiles = ref([])
const downloadStatus = ref({})
const messageCopied = ref(false)
const diagnosticStatus = ref('idle')
let fileRequestId = 0
let messageCopyTimer
const rendered = computed(() => {
  let content = props.message.content || ''
  for (const attachment of props.attachments) {
    const name = attachment.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    content = content.replace(new RegExp(`\\n?\\n?📎 ${name}(?:\\n|$)`), '\n')
  }
  return createMessageMarkdown({ code: t('message.code'), copy: t('message.copy'), copyAria: t('message.copyCode') }).render(content.trim())
})
const diagnostic = computed(() => props.message.role === 'system' ? parseDiagnosticMessage(props.message.content) : null)
const messageTime = computed(() => formatMessageTime(props.message.createdAt || props.message.created_at, language.value))
const fileRefs = computed(() => {
  return extractProjectFileReferences(props.message.content)
})

watch(
  [() => props.message.content, () => store.activeProject?.path],
  async ([content, projectPath]) => {
    const requestId = ++fileRequestId
    const candidates = props.message.role === 'assistant' ? extractLocalFileCandidates(content) : []
    if (!projectPath || !candidates.length) { downloadableFiles.value = []; return }
    try {
      const files = await desktop.resolveLocalFiles(projectPath, candidates)
      if (requestId === fileRequestId) downloadableFiles.value = files
    } catch {
      if (requestId === fileRequestId) downloadableFiles.value = []
    }
  },
  { immediate: true },
)

async function openFile(file) {
  if (!store.activeProject) return
  await store.openFile(`${store.activeProject.path}/${file.path}`, file.line)
}

async function openDownloadableFile(file) {
  await store.openResolvedLocalFile(file)
}

function openAttachment(attachment) {
  if (attachment.kind === 'image') store.previewAttachment = attachment
  else desktop.revealPath(attachment.path)
}

async function copyCode(event) {
  const payload = codeCopyPayload(event.target)
  if (!payload) return
  try {
    await writeClipboardText(payload.text)
    window.clearTimeout(copyTimers.get(payload.button))
    payload.button.textContent = t('message.copied')
    payload.button.setAttribute('aria-label', t('message.codeCopied'))
    payload.button.classList.add('copied')
    const timer = window.setTimeout(() => {
      payload.button.textContent = t('message.copy')
      payload.button.setAttribute('aria-label', t('message.copyCode'))
      payload.button.classList.remove('copied')
      copyTimers.delete(payload.button)
    }, 1600)
    copyTimers.set(payload.button, timer)
  } catch (error) { store.error = String(error) }
}

async function handleMessageClick(event) {
  const localPath = localProjectLink(event.target)
  if (localPath) {
    event.preventDefault()
    try {
      if (!store.activeProject) return
      const [file] = await desktop.resolveLocalFiles(store.activeProject.path, [localPath])
      if (!file) throw new Error(t('message.localFileUnavailable'))
      await store.openResolvedLocalFile(file)
    } catch (error) { store.error = String(error) }
    return
  }
  const url = externalHttpUrl(event.target)
  if (!url) return copyCode(event)
  event.preventDefault()
  try { await openUrl(url) } catch (error) { store.error = String(error) }
}

async function copyMessage() {
  try {
    await writeClipboardText(props.message.content || '')
    messageCopied.value = true
    window.clearTimeout(messageCopyTimer)
    messageCopyTimer = window.setTimeout(() => { messageCopied.value = false }, 1600)
  } catch (error) { store.error = String(error) }
}

async function downloadLocalFile(file) {
  if (!store.activeProject || downloadStatus.value[file.path] === 'saving') return
  try {
    let defaultPath = file.name
    try { defaultPath = await join(await downloadDir(), file.name) } catch { /* Fall back to the dialog's last directory. */ }
    const destination = await save({ title: t('message.saveFile', { name: file.name }), defaultPath })
    if (!destination) return
    downloadStatus.value = { ...downloadStatus.value, [file.path]: 'saving' }
    await desktop.downloadFile(store.activeProject.path, file.path, destination)
    downloadStatus.value = { ...downloadStatus.value, [file.path]: 'saved' }
    window.clearTimeout(downloadTimers.get(file.path))
    downloadTimers.set(file.path, window.setTimeout(() => {
      const next = { ...downloadStatus.value }
      delete next[file.path]
      downloadStatus.value = next
      downloadTimers.delete(file.path)
    }, 1800))
  } catch (error) {
    downloadStatus.value = { ...downloadStatus.value, [file.path]: 'error' }
    store.error = String(error)
  }
}

async function exportDiagnostic() {
  if (!diagnostic.value || diagnosticStatus.value === 'saving') return
  try {
    const destination = await save({
      title: t('diagnostic.exportTitle'),
      defaultPath: `claude-desk-diagnostic-${diagnostic.value.runId}.json`,
    })
    if (!destination) return
    diagnosticStatus.value = 'saving'
    await desktop.exportRunDiagnostic(props.message.conversationId, diagnostic.value.runId, destination)
    diagnosticStatus.value = 'saved'
  } catch (error) {
    diagnosticStatus.value = 'idle'
    store.error = String(error)
  }
}

onBeforeUnmount(() => {
  for (const timer of copyTimers.values()) window.clearTimeout(timer)
  for (const timer of downloadTimers.values()) window.clearTimeout(timer)
  window.clearTimeout(messageCopyTimer)
})
</script>

<template>
  <article v-if="diagnostic" class="diagnostic-event" role="status">
    <AlertTriangle :size="17" />
    <div><strong>{{ t(diagnostic.kind === 'empty-response' ? 'diagnostic.emptyTitle' : 'diagnostic.errorTitle') }}</strong><span>{{ t(diagnostic.kind === 'empty-response' ? 'diagnostic.emptyBody' : 'diagnostic.errorBody') }}</span></div>
    <button :disabled="diagnosticStatus === 'saving'" @click="exportDiagnostic"><Download :size="14" />{{ t(diagnosticStatus === 'saving' ? 'diagnostic.exporting' : diagnosticStatus === 'saved' ? 'diagnostic.exported' : 'diagnostic.export') }}</button>
  </article>
  <article v-else-if="message.role === 'system'" class="context-event"><Minimize2 :size="14" /><span>{{ message.content === 'Context compacted manually · Full transcript remains available' ? t('message.compactedManually') : message.content }}</span></article>
  <article v-else class="message" :class="`message-${message.role}`">
    <div class="message-surface">
      <div class="message-author">{{ message.role === 'user' ? t('message.you') : 'Claude' }}</div>
      <CodeSnippetCapsule v-if="message.role === 'user'" :snippets="message.snippets || []" />
      <div class="message-body markdown-body" @click="handleMessageClick" v-html="rendered"></div>
      <div v-if="attachments.length" class="message-attachments">
        <button
          v-for="attachment in attachments"
          :key="attachment.id"
          :class="attachment.kind === 'image' ? 'message-image' : 'message-file'"
          :title="t(attachment.kind === 'image' ? 'message.preview' : 'message.reveal', { name: attachment.name })"
          @click="openAttachment(attachment)"
        >
          <template v-if="attachment.kind === 'image'">
            <img :src="convertFileSrc(attachment.path)" :alt="attachment.name" />
            <span><ZoomIn :size="15" /></span>
          </template>
          <template v-else><File :size="15" /><em>{{ attachment.name }}</em></template>
        </button>
      </div>
      <div v-if="fileRefs.length" class="file-references">
        <button v-for="file in fileRefs" :key="`${file.path}:${file.line}`" class="file-chip" @click="openFile(file)">
          <FileCode2 :size="14" />{{ file.path }}<span v-if="file.line">:{{ file.line }}</span>
        </button>
      </div>
      <div v-if="downloadableFiles.length" class="downloadable-files">
        <div
          v-for="file in downloadableFiles"
          :key="file.path"
          class="download-file-card"
        >
          <button class="download-file-open" :title="file.path" @click="openDownloadableFile(file)">
            <span class="download-file-icon"><FileText :size="18" /></span>
            <span class="download-file-info"><strong>{{ file.name }}</strong><small>{{ formatFileSize(file.size) }}</small></span>
          </button>
          <button class="download-file-action" :title="t('message.downloadTitle', { path: file.path })" :disabled="downloadStatus[file.path] === 'saving'" @click="downloadLocalFile(file)">
            <Download :size="14" />{{ t(downloadStatus[file.path] === 'saving' ? 'message.saving' : downloadStatus[file.path] === 'saved' ? 'message.saved' : 'message.download') }}
          </button>
        </div>
      </div>
    </div>
    <div v-if="message.role === 'user'" class="message-meta">
      <time v-if="messageTime" class="message-time" :datetime="message.createdAt || message.created_at">{{ messageTime }}</time>
      <button
        class="message-copy-action"
        :class="{ copied: messageCopied }"
        :title="t(messageCopied ? 'message.messageCopied' : 'message.copyMessage')"
        :aria-label="t(messageCopied ? 'message.messageCopied' : 'message.copyMessage')"
        @click="copyMessage"
      >
        <Check v-if="messageCopied" :size="14" />
        <Copy v-else :size="14" />
      </button>
    </div>
  </article>
</template>
