<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { Files, MessageSquare, PanelLeftClose, PanelLeftOpen, Plus, Terminal, X } from 'lucide-vue-next'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useWorkspaceStore } from '../stores/workspace'
import { desktop } from '../services/desktop'
import ChatComposer from '../components/composer/ChatComposer.vue'
import MessageList from '../components/conversation/MessageList.vue'
import ChangesButton from '../components/diff/ChangesButton.vue'
import FileWorkspace from '../components/files/FileWorkspace.vue'
import { useI18n } from '../services/i18n'

const store = useWorkspaceStore()
const { t, conversationTitle } = useI18n()
const currentWindow = getCurrentWindow()
const fullscreen = ref(false)
let unlistenResize

function dragWindow(event) {
  if (event.target.closest('button, a, input, select, textarea')) return
  currentWindow.startDragging().catch(() => {})
}

async function syncWindowMode() {
  fullscreen.value = await currentWindow.isFullscreen().catch(() => false)
}

onMounted(async () => {
  await syncWindowMode()
  // macOS fullscreen removes the traffic lights, so the collapsed header can reclaim their space.
  unlistenResize = await currentWindow.onResized(syncWindowMode)
})
onBeforeUnmount(() => unlistenResize?.())
</script>

<template>
  <main class="workspace">
    <header v-if="store.activeProject" class="workspace-header" :class="{ 'sidebar-hidden': store.sidebarCollapsed, fullscreen }">
      <div class="workspace-leading">
        <button
          class="icon-button workspace-sidebar-toggle"
          :title="t(store.sidebarCollapsed ? 'workspace.showSidebar' : 'workspace.hideSidebar')"
          @click="store.sidebarCollapsed = !store.sidebarCollapsed"
        >
          <PanelLeftOpen v-if="store.sidebarCollapsed" :size="17" />
          <PanelLeftClose v-else :size="17" />
        </button>
        <div class="workspace-title" data-tauri-drag-region @mousedown.left="dragWindow">
          <span>{{ store.activeProject.name }}</span><i>/</i><strong>{{ store.activeConversation ? conversationTitle(store.activeConversation.title) : t('workspace.noConversation') }}</strong>
        </div>
      </div>
      <div class="header-actions">
        <button class="text-button" :class="{ active: store.workspaceView === 'files' }" :title="t('workspace.filesShortcut')" @click="store.workspaceView = 'files'"><Files :size="15" /> {{ t('workspace.files') }}</button>
        <ChangesButton />
        <button class="text-button" @click="store.newConversation"><Plus :size="15" /> {{ t('workspace.newChat') }}</button>
        <button class="icon-button" :title="t('workspace.openTerminal')" @click="desktop.openTerminal(store.activeProject.path)"><Terminal :size="17" /></button>
      </div>
    </header>

    <nav v-if="store.workspaceView === 'files' || store.filePreview" class="workspace-tabs">
      <button class="workspace-tab" :class="{ active: store.workspaceView === 'conversation' }" @click="store.workspaceView = 'conversation'"><MessageSquare :size="13" /> {{ t('workspace.conversation') }}</button>
      <div class="workspace-tab file-tab" :class="{ active: store.workspaceView === 'files' }">
        <button class="file-tab-main" :title="store.filePreview?.path" @click="store.workspaceView = 'files'"><Files :size="13" /><span>{{ store.filePreview?.name || t('workspace.files') }}</span></button>
        <button class="file-tab-close" :title="t('workspace.closeFile')" @click="store.closeFilePreview"><X :size="12" /></button>
      </div>
    </nav>

    <template v-if="store.activeProject && store.activeConversation">
      <FileWorkspace v-if="store.workspaceView === 'files'" />
      <template v-else>
        <MessageList :conversation-id="store.activeConversationId" :messages="store.activeMessages" :attachments-by-message="store.activeAttachments" :run="store.activeRun">
          <div v-if="!store.activeMessages.length && !store.activeRun" class="conversation-empty">
            <div class="empty-sparkle">✦</div><h2>{{ t('workspace.emptyTitle') }}</h2><p>{{ t('workspace.emptyBody', { project: store.activeProject.name }) }}</p>
          </div>
        </MessageList>
        <div v-if="store.health && !store.health.available" class="claude-missing">
          <div><strong>{{ t('workspace.notFound') }}</strong><span>{{ t('workspace.notFoundBody', { command: store.settings.command }) }}</span></div>
          <button @click="store.settingsOpen = true">{{ t('workspace.openSettings') }}</button>
        </div>
        <ChatComposer />
      </template>
    </template>

    <div v-else-if="store.activeProject" class="workspace-empty">
      <div class="empty-sparkle">✦</div><h1>{{ t('workspace.startTitle') }}</h1><p>{{ t('workspace.startBody', { project: store.activeProject.name }) }}</p><button class="primary-button" @click="store.newConversation"><Plus :size="16" /> {{ t('workspace.newConversation') }}</button>
    </div>
  </main>
</template>
