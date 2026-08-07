<script setup>
import { convertFileSrc } from '@tauri-apps/api/core'
import { FolderOpen, X } from 'lucide-vue-next'
import { useWorkspaceStore } from '../../stores/workspace'
import { desktop } from '../../services/desktop'

const store = useWorkspaceStore()
</script>

<template>
  <div v-if="store.previewAttachment" class="image-lightbox" @click.self="store.previewAttachment = null">
    <header>
      <span>{{ store.previewAttachment.name }}</span>
      <div>
        <button title="Show in Finder" @click="desktop.revealPath(store.previewAttachment.path)"><FolderOpen :size="18" /></button>
        <button title="Close preview" @click="store.previewAttachment = null"><X :size="20" /></button>
      </div>
    </header>
    <img :src="convertFileSrc(store.previewAttachment.path)" :alt="store.previewAttachment.name" />
  </div>
</template>
