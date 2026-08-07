<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { convertFileSrc } from '@tauri-apps/api/core'
import { save } from '@tauri-apps/plugin-dialog'
import { Download, File, FileCode2, FileText, Minimize2, ZoomIn } from 'lucide-vue-next'
import { desktop } from '../../services/desktop'
import { extractLocalFileCandidates, formatFileSize } from '../../services/localFiles'
import { codeCopyPayload, createMessageMarkdown, writeClipboardText } from '../../services/markdown'
import { useWorkspaceStore } from '../../stores/workspace'

const props = defineProps({
  message: { type: Object, required: true },
  attachments: { type: Array, default: () => [] },
})
const store = useWorkspaceStore()
const markdown = createMessageMarkdown()
const copyTimers = new Map()
const downloadTimers = new Map()
const downloadableFiles = ref([])
const downloadStatus = ref({})
let fileRequestId = 0
const rendered = computed(() => {
  let content = props.message.content || ''
  for (const attachment of props.attachments) {
    const name = attachment.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    content = content.replace(new RegExp(`\\n?\\n?📎 ${name}(?:\\n|$)`), '\n')
  }
  return markdown.render(content.trim())
})
const fileRefs = computed(() => {
  const matches = [...(props.message.content || '').matchAll(/\b((?:src|app|packages|tests?|components|lib)\/[\w@./-]+\.[A-Za-z0-9]+)(?::(\d+))?/g)]
  return [...new Map(matches.map((match) => [`${match[1]}:${match[2] || ''}`, { path: match[1], line: match[2] ? Number(match[2]) : null }])).values()]
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

function openFile(file) {
  if (!store.activeProject) return
  desktop.openInEditor(`${store.activeProject.path}/${file.path}`, file.line, store.settings.editor)
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
    payload.button.textContent = 'Copied'
    payload.button.setAttribute('aria-label', 'Code copied')
    payload.button.classList.add('copied')
    const timer = window.setTimeout(() => {
      payload.button.textContent = 'Copy'
      payload.button.setAttribute('aria-label', 'Copy code')
      payload.button.classList.remove('copied')
      copyTimers.delete(payload.button)
    }, 1600)
    copyTimers.set(payload.button, timer)
  } catch (error) { store.error = String(error) }
}

async function downloadLocalFile(file) {
  if (!store.activeProject || downloadStatus.value[file.path] === 'saving') return
  const destination = await save({ title: `保存 ${file.name}`, defaultPath: file.name })
  if (!destination) return
  downloadStatus.value = { ...downloadStatus.value, [file.path]: 'saving' }
  try {
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

onBeforeUnmount(() => {
  for (const timer of copyTimers.values()) window.clearTimeout(timer)
  for (const timer of downloadTimers.values()) window.clearTimeout(timer)
})
</script>

<template>
  <article v-if="message.role === 'system'" class="context-event"><Minimize2 :size="14" /><span>{{ message.content }}</span></article>
  <article v-else class="message" :class="`message-${message.role}`">
    <div class="message-author">{{ message.role === 'user' ? 'You' : 'Claude' }}</div>
    <div class="message-body markdown-body" @click="copyCode" v-html="rendered"></div>
    <div v-if="attachments.length" class="message-attachments">
      <button
        v-for="attachment in attachments"
        :key="attachment.id"
        :class="attachment.kind === 'image' ? 'message-image' : 'message-file'"
        :title="attachment.kind === 'image' ? `Preview ${attachment.name}` : `Reveal ${attachment.name}`"
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
      <button
        v-for="file in downloadableFiles"
        :key="file.path"
        class="download-file-card"
        :title="file.path"
        :disabled="downloadStatus[file.path] === 'saving'"
        @click="downloadLocalFile(file)"
      >
        <span class="download-file-icon"><FileText :size="18" /></span>
        <span class="download-file-info"><strong>{{ file.name }}</strong><small>{{ formatFileSize(file.size) }}</small></span>
        <span class="download-file-action"><Download :size="14" />{{ downloadStatus[file.path] === 'saving' ? '保存中…' : downloadStatus[file.path] === 'saved' ? '已保存' : '下载' }}</span>
      </button>
    </div>
  </article>
</template>
