<script setup>
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { FileUp } from 'lucide-vue-next'
import AppSidebar from './components/sidebar/AppSidebar.vue'
import DiffDrawer from './components/diff/DiffDrawer.vue'
import EnvironmentPanel from './components/diff/EnvironmentPanel.vue'
import SettingsModal from './components/common/SettingsModal.vue'
import PermissionsModal from './components/common/PermissionsModal.vue'
import ToolPermissionModal from './components/common/ToolPermissionModal.vue'
import ClaudeQuestionModal from './components/common/ClaudeQuestionModal.vue'
import ImageLightbox from './components/common/ImageLightbox.vue'
import Home from './views/Home.vue'
import Workspace from './views/Workspace.vue'
import { useWorkspaceStore } from './stores/workspace'
import { useI18n } from './services/i18n'
import { currentPlatform, isPrimaryShortcut } from './services/platform'

const store = useWorkspaceStore()
const { t } = useI18n()
const dragging = ref(false)
let unlistenDrag

function shortcuts(event) {
  const primary = isPrimaryShortcut(event)
  if (primary && event.key.toLowerCase() === 'n') { event.preventDefault(); store.newConversation() }
  if (primary && event.key.toLowerCase() === 'k') { event.preventDefault(); window.dispatchEvent(new Event('claude-desk-focus')) }
  if (primary && event.key.toLowerCase() === 'b') { event.preventDefault(); store.sidebarCollapsed = !store.sidebarCollapsed }
  if (primary && event.key.toLowerCase() === 'p') { event.preventDefault(); store.workspaceView = 'files' }
  if (primary && event.key === ',') { event.preventDefault(); store.settingsOpen = true }
  if (event.key === 'Escape') {
    if (store.activePermissionRequest || store.activeQuestionRequest) return
    if (store.previewAttachment) store.previewAttachment = null
    else if (store.permissionsOpen) store.permissionsOpen = false
    else if (store.environmentPanel) store.environmentPanel = false
    else if (store.diffDrawer) store.diffDrawer = null
    else if (store.settingsOpen) store.settingsOpen = false
    else if (store.workspaceView === 'files') store.closeFilePreview()
    else if (store.activeRun) store.stopClaude()
  }
}

onMounted(async () => {
  document.documentElement.dataset.platform = currentPlatform
  window.addEventListener('keydown', shortcuts)
  await store.init()
  document.documentElement.dataset.theme = store.settings.theme
  document.documentElement.lang = store.settings.language
  unlistenDrag = await getCurrentWebviewWindow().onDragDropEvent((event) => {
    if (event.payload.type === 'enter' || event.payload.type === 'over') dragging.value = true
    if (event.payload.type === 'leave') dragging.value = false
    if (event.payload.type === 'drop') {
      dragging.value = false
      window.dispatchEvent(new CustomEvent('claude-desk-drop', {
        detail: { conversationId: store.activeConversationId, paths: event.payload.paths },
      }))
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
    <div v-if="dragging && store.activeConversation" class="drop-overlay"><div><span><FileUp :size="26" /></span><strong>{{ t('app.dropTitle') }}</strong><small>{{ t('app.dropSubtitle') }}</small></div></div>
    <div v-if="store.error" class="toast" @click="store.error = ''">{{ store.error }}</div>
    <DiffDrawer />
    <EnvironmentPanel />
    <SettingsModal />
    <PermissionsModal />
    <ToolPermissionModal />
    <ClaudeQuestionModal />
    <ImageLightbox />
  </div>
</template>
