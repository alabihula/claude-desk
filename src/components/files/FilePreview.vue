<script setup>
import { FileText, FolderOpen } from 'lucide-vue-next'
import { useWorkspaceStore } from '../../stores/workspace'
import { desktop } from '../../services/desktop'
import { formatFileSize } from '../../services/localFiles'
import { useI18n } from '../../services/i18n'

const store = useWorkspaceStore()
const { t } = useI18n()
</script>

<template>
  <section v-if="store.filePreview" class="file-preview">
    <header>
      <span class="file-preview-icon"><FileText :size="18" /></span>
      <div><strong>{{ store.filePreview.name }}</strong><small :title="store.filePreview.path">{{ store.filePreview.path }} · {{ formatFileSize(store.filePreview.size) }}</small></div>
      <button class="icon-button" :title="t('common.showInFinder')" @click="desktop.revealPath(store.filePreview.path)"><FolderOpen :size="17" /></button>
    </header>
    <div v-if="store.filePreview.loading" class="file-preview-empty">{{ t('file.loading') }}</div>
    <div v-else-if="store.filePreview.error" class="file-preview-empty error"><strong>{{ t('common.previewUnavailable') }}</strong><span>{{ store.filePreview.error }}</span></div>
    <pre v-else class="file-preview-content"><code>{{ store.filePreview.content }}</code></pre>
  </section>
</template>
