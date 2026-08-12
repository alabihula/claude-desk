<script setup>
import { FolderOpen } from 'lucide-vue-next'
import { useWorkspaceStore } from '../../stores/workspace'
import { useI18n } from '../../services/i18n'
import FilePreview from './FilePreview.vue'
import ProjectFileTree from './ProjectFileTree.vue'

const store = useWorkspaceStore()
const { t } = useI18n()
</script>

<template>
  <section class="file-workspace">
    <FilePreview v-if="store.filePreview" />
    <div v-else class="file-workspace-empty"><FolderOpen :size="40" /><strong>{{ t('files.openTitle') }}</strong><span>{{ t('files.openBody') }}</span></div>
    <ProjectFileTree />
  </section>
</template>
