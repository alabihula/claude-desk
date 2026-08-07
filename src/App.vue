<script setup>
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { Image } from 'lucide-vue-next'
import AppSidebar from './components/sidebar/AppSidebar.vue'
import DiffDrawer from './components/diff/DiffDrawer.vue'
import SettingsModal from './components/common/SettingsModal.vue'
import PermissionsModal from './components/common/PermissionsModal.vue'
import ImageLightbox from './components/common/ImageLightbox.vue'
import Home from './views/Home.vue'
import Workspace from './views/Workspace.vue'
import { useWorkspaceStore } from './stores/workspace'

const store = useWorkspaceStore()
const dragging = ref(false)
let unlistenDrag

function shortcuts(event) {
  if (event.metaKey && event.key.toLowerCase() === 'n') { event.preventDefault(); store.newConversation() }
  if (event.metaKey && event.key.toLowerCase() === 'k') { event.preventDefault(); window.dispatchEvent(new Event('claude-desk-focus')) }
  if (event.metaKey && event.key === ',') { event.preventDefault(); store.settingsOpen = true }
  if (event.key === 'Escape') {
    if (store.previewAttachment) store.previewAttachment = null
    else if (store.permissionsOpen) store.permissionsOpen = false
    else if (store.diffDrawer) store.diffDrawer = null
    else if (store.settingsOpen) store.settingsOpen = false
    else if (store.activeRun) store.stopClaude()
  }
}

onMounted(async () => {
  window.addEventListener('keydown', shortcuts)
  await store.init()
  document.documentElement.dataset.theme = store.settings.theme
  unlistenDrag = await getCurrentWebviewWindow().onDragDropEvent((event) => {
    if (event.payload.type === 'enter' || event.payload.type === 'over') dragging.value = true
    if (event.payload.type === 'leave') dragging.value = false
    if (event.payload.type === 'drop') {
      dragging.value = false
      window.dispatchEvent(new CustomEvent('claude-desk-drop', { detail: event.payload.paths }))
    }
  })
})
onBeforeUnmount(() => { window.removeEventListener('keydown', shortcuts); unlistenDrag?.(); store.eventUnlisten?.() })
</script>

<template>
  <div class="app-shell">
    <AppSidebar v-if="store.projects.length" />
    <Workspace v-if="store.activeProject" />
    <Home v-else />
    <div v-if="dragging && store.activeConversation" class="drop-overlay"><div><span><Image :size="26" /></span><strong>Drop files here</strong><small>Claude will receive a local copy</small></div></div>
    <div v-if="store.error" class="toast" @click="store.error = ''">{{ store.error }}</div>
    <DiffDrawer />
    <SettingsModal />
    <PermissionsModal />
    <ImageLightbox />
  </div>
</template>
