<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { FileText, MessageSquarePlus, FolderOpen } from 'lucide-vue-next'
import { useWorkspaceStore } from '../../stores/workspace'
import { desktop } from '../../services/desktop'
import { fileSelectionPrompt, formatFileSize, selectionLineRange } from '../../services/localFiles'
import { useI18n } from '../../services/i18n'

const store = useWorkspaceStore()
const { t } = useI18n()
const content = ref(null)
const selection = ref(null)
const selectionLabel = computed(() => {
  if (!selection.value) return ''
  return selection.value.startLine === selection.value.endLine
    ? t('files.line', { line: selection.value.startLine })
    : t('files.lines', { start: selection.value.startLine, end: selection.value.endLine })
})

function updateSelection() {
  selection.value = content.value
    ? selectionLineRange(store.filePreview.content, content.value.selectionStart, content.value.selectionEnd)
    : null
}

function addSelection() {
  if (!selection.value || !content.value) return
  const prompt = fileSelectionPrompt(
    store.filePreview.relativePath,
    store.filePreview.content,
    content.value.selectionStart,
    content.value.selectionEnd,
    t('files.selectionContext', { path: store.filePreview.relativePath, lines: selectionLabel.value }),
  )
  store.appendDraft(store.activeConversationId, prompt)
  store.workspaceView = 'conversation'
  nextTick(() => window.dispatchEvent(new Event('claude-desk-focus')))
}

watch(() => store.filePreview?.path, () => { selection.value = null })
</script>

<template>
  <section v-if="store.filePreview" class="file-preview">
    <header>
      <span class="file-preview-icon"><FileText :size="18" /></span>
      <div><strong>{{ store.filePreview.name }}</strong><small :title="store.filePreview.path">{{ store.filePreview.path }} · {{ formatFileSize(store.filePreview.size) }}</small></div>
      <button class="file-selection-button" :disabled="!selection" @click="addSelection"><MessageSquarePlus :size="15" />{{ selection ? t('files.addSelectionWithLines', { lines: selectionLabel }) : t('files.selectText') }}</button>
      <button class="icon-button" :title="t('common.showInFinder')" @click="desktop.revealPath(store.filePreview.path)"><FolderOpen :size="17" /></button>
    </header>
    <div v-if="store.filePreview.loading" class="file-preview-empty">{{ t('file.loading') }}</div>
    <div v-else-if="store.filePreview.error" class="file-preview-empty error"><strong>{{ t('common.previewUnavailable') }}</strong><span>{{ store.filePreview.error }}</span></div>
    <textarea
      v-else
      ref="content"
      class="file-preview-content"
      :value="store.filePreview.content"
      readonly
      spellcheck="false"
      @select="updateSelection"
      @mouseup="updateSelection"
      @keyup="updateSelection"
    ></textarea>
  </section>
</template>
