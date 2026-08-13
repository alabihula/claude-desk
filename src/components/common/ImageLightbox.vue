<script setup>
import { convertFileSrc } from '@tauri-apps/api/core'
import { FolderOpen, X } from 'lucide-vue-next'
import { useWorkspaceStore } from '../../stores/workspace'
import { desktop } from '../../services/desktop'
import { useI18n } from '../../services/i18n'

const store = useWorkspaceStore()
const { t } = useI18n()
</script>

<template>
  <div v-if="store.previewAttachment" class="image-lightbox" @click.self="store.previewAttachment = null">
    <header>
      <span>{{ store.previewAttachment.name }}</span>
      <div>
        <button :title="t('common.showInFileManager')" @click="desktop.revealPath(store.previewAttachment.path)"><FolderOpen :size="18" /></button>
        <button :title="t('common.close')" @click="store.previewAttachment = null"><X :size="20" /></button>
      </div>
    </header>
    <img :src="convertFileSrc(store.previewAttachment.path)" :alt="store.previewAttachment.name" />
  </div>
</template>
