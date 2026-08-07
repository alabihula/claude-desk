<script setup>
import { Folder, FolderOpen, MessageSquarePlus, MoreHorizontal, Plus, Settings, ShieldCheck } from 'lucide-vue-next'
import { open } from '@tauri-apps/plugin-dialog'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useWorkspaceStore } from '../../stores/workspace'
import { desktop } from '../../services/desktop'
import BrandMark from '../common/BrandMark.vue'

const store = useWorkspaceStore()

function dragWindow(event) {
  if (event.target.closest('button, a, input, select, textarea')) return
  getCurrentWindow().startDragging().catch(() => {})
}

async function chooseProject() {
  const path = await open({ directory: true, multiple: false, title: 'Add a project to Claude Desk' })
  if (path) await store.addProject(path)
}

async function projectMenu(project) {
  const action = window.prompt(`Project: ${project.name}\nType “reveal”, “terminal”, or “remove”.`)
  if (action === 'reveal') await desktop.revealPath(project.path)
  if (action === 'terminal') await desktop.openTerminal(project.path)
  if (action === 'remove' && window.confirm(`Remove ${project.name} from Claude Desk?\nYour project files will not be deleted.`)) await store.removeProject(project)
}

async function conversationMenu(conversation) {
  const action = window.prompt(`Conversation: ${conversation.title}\nType “rename” or “delete”.`)
  if (action === 'rename') {
    const title = window.prompt('Conversation name', conversation.title)
    if (title?.trim()) await store.renameConversation(conversation, title)
  }
  if (action === 'delete' && window.confirm(`Delete “${conversation.title}” from Claude Desk?`)) await store.deleteConversation(conversation)
}
</script>

<template>
  <aside class="sidebar">
    <header class="brand" data-tauri-drag-region @mousedown.left="dragWindow">
      <BrandMark :size="28" />
      <span>Claude Desk</span>
    </header>

    <div class="sidebar-scroll">
      <section class="sidebar-section">
        <div class="section-title">
          <span>Projects</span>
          <button class="icon-button small" title="Add project" @click="chooseProject"><Plus :size="15" /></button>
        </div>
        <div
          v-for="project in store.projects"
          :key="project.id"
          class="sidebar-item project-item"
          :class="{ active: store.activeProjectId === project.id }"
          :title="project.path"
          role="button"
          tabindex="0"
          @click="store.selectProject(project.id)"
          @keydown.enter="store.selectProject(project.id)"
        >
          <FolderOpen v-if="store.activeProjectId === project.id" :size="16" />
          <Folder v-else :size="16" />
          <span>{{ project.name }}</span>
          <button class="row-action" title="Project actions" @click.stop="projectMenu(project)"><MoreHorizontal :size="15" /></button>
        </div>
        <button class="sidebar-add" @click="chooseProject"><Plus :size="15" /> Add Project</button>
      </section>

      <section v-if="store.activeProject" class="sidebar-section conversations-section">
        <div class="section-title">
          <span>Conversations</span>
          <button class="icon-button small" title="New conversation" @click="store.newConversation"><MessageSquarePlus :size="15" /></button>
        </div>
        <div
          v-for="conversation in store.conversations"
          :key="conversation.id"
          class="sidebar-item conversation-item"
          :class="{ active: store.activeConversationId === conversation.id }"
          role="button"
          tabindex="0"
          @click="store.selectConversation(conversation.id)"
          @keydown.enter="store.selectConversation(conversation.id)"
        >
          <span>{{ conversation.title }}</span>
          <span v-if="store.runs[conversation.id]" class="run-dot"></span>
          <button class="row-action" title="Conversation actions" @click.stop="conversationMenu(conversation)"><MoreHorizontal :size="15" /></button>
        </div>
        <button class="sidebar-add" @click="store.newConversation"><Plus :size="15" /> New chat</button>
      </section>
    </div>

    <footer class="sidebar-footer">
      <button class="sidebar-item permission-entry" @click="store.permissionsOpen = true">
        <ShieldCheck :size="16" /><span>Permissions</span>
        <small>{{ store.settings.permissionMode === 'bypassPermissions' ? 'Full' : 'Project' }}</small>
      </button>
      <button class="sidebar-item" @click="store.settingsOpen = true"><Settings :size="16" /><span>Settings</span></button>
      <div v-if="store.health" class="health-line" :class="{ healthy: store.health.available }">
        <span></span>{{ store.health.available ? store.health.version : 'Claude not found' }}
      </div>
    </footer>
  </aside>
</template>
