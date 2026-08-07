<script setup>
import { FileText, FolderOpen } from 'lucide-vue-next'
import { useWorkspaceStore } from '../../stores/workspace'
import { desktop } from '../../services/desktop'
import { formatFileSize } from '../../services/localFiles'

const store = useWorkspaceStore()
</script>

<template>
  <section v-if="store.filePreview" class="file-preview">
    <header>
      <span class="file-preview-icon"><FileText :size="18" /></span>
      <div><strong>{{ store.filePreview.name }}</strong><small :title="store.filePreview.path">{{ store.filePreview.path }} · {{ formatFileSize(store.filePreview.size) }}</small></div>
      <button class="icon-button" title="Show in Finder" @click="desktop.revealPath(store.filePreview.path)"><FolderOpen :size="17" /></button>
    </header>
    <div v-if="store.filePreview.loading" class="file-preview-empty">Loading file…</div>
    <div v-else-if="store.filePreview.error" class="file-preview-empty error"><strong>Preview unavailable</strong><span>{{ store.filePreview.error }}</span></div>
    <pre v-else class="file-preview-content"><code>{{ store.filePreview.content }}</code></pre>
  </section>
</template>
