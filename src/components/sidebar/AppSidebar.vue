<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  FolderOpen,
  Pencil,
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
import SidebarNavigation from './SidebarNavigation.vue'
import { useI18n } from '../../services/i18n'

const store = useWorkspaceStore()
const { t } = useI18n()
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
  const path = await open({ directory: true, multiple: false, title: t('sidebar.addProject') })
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
    t('sidebar.removeConfirm', { name: project.name }),
    { title: t('sidebar.removeTitle'), kind: 'warning', okLabel: t('sidebar.remove'), cancelLabel: t('common.cancel') },
  )
  if (approved) await store.removeProject(project)
}

async function deleteConversation(conversation) {
  menu.value = null
  const approved = await confirm(
    t('sidebar.deleteConfirm', { name: conversation.title, running: store.runs[conversation.id] ? t('sidebar.deleteRunning') : '' }),
    { title: t('sidebar.deleteTitle'), kind: 'warning', okLabel: t('sidebar.delete'), cancelLabel: t('common.cancel') },
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
  const conversation = store.conversationById(id)
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
      <SidebarNavigation
        :renaming-conversation-id="renamingConversationId"
        :rename-title="renameTitle"
        @add-project="chooseProject"
        @project-menu="toggleMenu($event.event, 'project', $event.item)"
        @conversation-menu="toggleMenu($event.event, 'conversation', $event.item)"
        @update:rename-title="renameTitle = $event"
        @commit-rename="commitRename"
        @cancel-rename="cancelRename"
      />
    </div>

    <footer class="sidebar-footer">
      <button class="sidebar-item permission-entry" @click="store.permissionsOpen = true">
        <ShieldCheck :size="16" /><span>{{ t('sidebar.permissions') }}</span>
        <small>{{ t(store.settings.permissionMode === 'bypassPermissions' ? 'sidebar.full' : 'sidebar.project') }}</small>
      </button>
      <button class="sidebar-item" @click="store.settingsOpen = true"><Settings :size="16" /><span>{{ t('sidebar.settings') }}</span></button>
      <div v-if="store.health" class="health-line" :class="{ healthy: store.health.available }">
        <span></span>{{ store.health.available ? store.health.version : t('sidebar.claudeNotFound') }}
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
          <button role="menuitem" @click="runMenuAction('reveal')"><FolderOpen :size="14" /> {{ t('sidebar.reveal') }}</button>
          <button role="menuitem" @click="runMenuAction('terminal')"><Terminal :size="14" /> {{ t('sidebar.terminal') }}</button>
          <div class="menu-separator"></div>
          <button class="danger" role="menuitem" @click="runMenuAction('remove')"><Trash2 :size="14" /> {{ t('sidebar.removeProject') }}</button>
        </template>
        <template v-else>
          <button role="menuitem" @click="runMenuAction('rename')"><Pencil :size="14" /> {{ t('sidebar.rename') }}</button>
          <button class="danger" role="menuitem" @click="runMenuAction('delete')"><Trash2 :size="14" /> {{ t('sidebar.deleteConversation') }}</button>
        </template>
      </div>
    </Teleport>
  </aside>
</template>
