<script setup>
import { MoreHorizontal, Plus, Terminal } from 'lucide-vue-next'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useWorkspaceStore } from '../stores/workspace'
import { desktop } from '../services/desktop'
import ChatComposer from '../components/composer/ChatComposer.vue'
import MessageList from '../components/conversation/MessageList.vue'
import ChangesButton from '../components/diff/ChangesButton.vue'

const store = useWorkspaceStore()

function dragWindow(event) {
  if (event.target.closest('button, a, input, select, textarea')) return
  getCurrentWindow().startDragging().catch(() => {})
}
</script>

<template>
  <main class="workspace">
    <header v-if="store.activeProject" class="workspace-header">
      <div class="workspace-title" data-tauri-drag-region @mousedown.left="dragWindow">
        <span>{{ store.activeProject.name }}</span><i>/</i><strong>{{ store.activeConversation?.title || 'No conversation' }}</strong>
      </div>
      <div class="header-actions">
        <ChangesButton />
        <button class="text-button" @click="store.newConversation"><Plus :size="15" /> New chat</button>
        <button class="icon-button" title="Open Terminal" @click="desktop.openTerminal(store.activeProject.path)"><Terminal :size="17" /></button>
        <button class="icon-button" title="Reveal project" @click="desktop.revealPath(store.activeProject.path)"><MoreHorizontal :size="18" /></button>
      </div>
    </header>

    <template v-if="store.activeProject && store.activeConversation">
      <MessageList :messages="store.activeMessages" :attachments-by-message="store.activeAttachments" :run="store.activeRun">
        <div v-if="!store.activeMessages.length && !store.activeRun" class="conversation-empty">
          <div class="empty-sparkle">✦</div><h2>What are we building?</h2><p>Claude can read, edit, and run code in <strong>{{ store.activeProject.name }}</strong>.</p>
        </div>
      </MessageList>
      <div v-if="store.health && !store.health.available" class="claude-missing">
        <div><strong>Claude Code not found</strong><span>Claude Desk couldn't find <code>{{ store.settings.command }}</code> in your login shell.</span></div>
        <button @click="store.settingsOpen = true">Open Settings</button>
      </div>
      <ChatComposer />
    </template>

    <div v-else-if="store.activeProject" class="workspace-empty">
      <div class="empty-sparkle">✦</div><h1>Start a conversation</h1><p>Ask Claude to work in {{ store.activeProject.name }}.</p><button class="primary-button" @click="store.newConversation"><Plus :size="16" /> New conversation</button>
    </div>
  </main>
</template>
