<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  Folder,
  FolderOpen,
  MessageSquarePlus,
  MoreHorizontal,
  Pencil,
  Plus,
  Settings,
  ShieldCheck,
  Terminal,
  Trash2,
} from 'lucide-vue-next'
import { confirm, open } from '@tauri-apps/plugin-dialog'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useWorkspaceStore } from '../../stores/workspace'
import { desktop } from '../../services/desktop'
import BrandMark from '../common/BrandMark.vue'

const store = useWorkspaceStore()
const menu = ref(null)
const renamingConversationId = ref(null)
const renameTitle = ref('')
const collapsedStyle = {
  width: '0px',
  flexBasis: '0px',
  opacity: '0',
  transform: 'translateX(-8px)',
  borderRightColor: 'transparent',
  pointerEvents: 'none',
}

function dragWindow(event) {
  if (event.target.closest('button, a, input, select, textarea')) return
  getCurrentWindow().startDragging().catch(() => {})
}

async function chooseProject() {
  const path = await open({ directory: true, multiple: false, title: 'Add a project to Claude Desk' })
  if (path) await store.addProject(path)
}

function toggleMenu(event, type, item) {
  if (menu.value?.type === type && menu.value?.item.id === item.id) {
    menu.value = null
    return
  }
  const rect = event.currentTarget.getBoundingClientRect()
  const height = type === 'project' ? 118 : 82
  menu.value = {
    type,
    item,
    left: Math.max(8, rect.right - 188),
    top: Math.min(window.innerHeight - height - 8, rect.bottom + 4),
  }
}

function closeMenu(event) {
  if (!(event?.target instanceof Element) || !event.target.closest('[data-sidebar-menu], .row-action')) menu.value = null
}

async function removeProject(project) {
  menu.value = null
  const approved = await confirm(
    `Remove “${project.name}” from Claude Desk?\n\nYour project files will stay on disk.`,
    { title: 'Remove Project', kind: 'warning', okLabel: 'Remove', cancelLabel: 'Cancel' },
  )
  if (approved) await store.removeProject(project)
}

async function deleteConversation(conversation) {
  menu.value = null
  const approved = await confirm(
    `Delete “${conversation.title}”?${store.runs[conversation.id] ? '\n\nClaude is currently working in this conversation and will be stopped.' : ''}`,
    { title: 'Delete Conversation', kind: 'warning', okLabel: 'Delete', cancelLabel: 'Cancel' },
  )
  if (approved) await store.deleteConversation(conversation)
}

function startRename(conversation) {
  menu.value = null
  renamingConversationId.value = conversation.id
  renameTitle.value = conversation.title
  nextTick(() => {
    const input = document.querySelector('.sidebar-rename-input')
    input?.focus()
    input?.select()
  })
}

async function commitRename() {
  const id = renamingConversationId.value
  if (!id) return
  const conversation = store.conversations.find((item) => item.id === id)
  const title = renameTitle.value.trim()
  renamingConversationId.value = null
  if (conversation && title && title !== conversation.title) await store.renameConversation(conversation, title)
}

function cancelRename() {
  renamingConversationId.value = null
}

async function runMenuAction(action) {
  const current = menu.value
  if (!current) return
  const { item } = current
  menu.value = null
  if (action === 'reveal') await desktop.revealPath(item.path)
  if (action === 'terminal') await desktop.openTerminal(item.path)
  if (action === 'remove') await removeProject(item)
  if (action === 'rename') startRename(item)
  if (action === 'delete') await deleteConversation(item)
}

onMounted(() => {
  document.addEventListener('pointerdown', closeMenu)
  window.addEventListener('resize', closeMenu)
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', closeMenu)
  window.removeEventListener('resize', closeMenu)
})
</script>

<template>
  <aside class="sidebar" :style="store.sidebarCollapsed ? collapsedStyle : null">
    <header class="brand" data-tauri-drag-region @mousedown.left="dragWindow">
      <div class="brand-title">
        <BrandMark :size="28" />
        <span>Claude Desk</span>
      </div>
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
          <button class="row-action" title="Project actions" @click.stop="toggleMenu($event, 'project', project)"><MoreHorizontal :size="15" /></button>
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
          <input
            v-if="renamingConversationId === conversation.id"
            v-model="renameTitle"
            class="sidebar-rename-input"
            aria-label="Conversation name"
            @click.stop
            @keydown.enter.stop.prevent="commitRename"
            @keydown.esc.stop.prevent="cancelRename"
            @blur="commitRename"
          />
          <span v-else>{{ conversation.title }}</span>
          <span v-if="store.runs[conversation.id]" class="run-dot"></span>
          <button class="row-action" title="Conversation actions" @click.stop="toggleMenu($event, 'conversation', conversation)"><MoreHorizontal :size="15" /></button>
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

    <Teleport to="body">
      <div
        v-if="menu"
        class="sidebar-context-menu"
        data-sidebar-menu
        role="menu"
        :style="{ left: `${menu.left}px`, top: `${menu.top}px` }"
        @click.stop
      >
        <template v-if="menu.type === 'project'">
          <button role="menuitem" @click="runMenuAction('reveal')"><FolderOpen :size="14" /> Reveal in Finder</button>
          <button role="menuitem" @click="runMenuAction('terminal')"><Terminal :size="14" /> Open in Terminal</button>
          <div class="menu-separator"></div>
          <button class="danger" role="menuitem" @click="runMenuAction('remove')"><Trash2 :size="14" /> Remove Project</button>
        </template>
        <template v-else>
          <button role="menuitem" @click="runMenuAction('rename')"><Pencil :size="14" /> Rename</button>
          <button class="danger" role="menuitem" @click="runMenuAction('delete')"><Trash2 :size="14" /> Delete Conversation</button>
        </template>
      </div>
    </Teleport>
  </aside>
</template>
