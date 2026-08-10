<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import {
  Folder,
  FolderOpen,
  List,
  ListTree,
  MessageSquare,
  MessageSquarePlus,
  MoreHorizontal,
  Plus,
  SquarePen,
} from 'lucide-vue-next'
import { useWorkspaceStore } from '../../stores/workspace'
import { useI18n } from '../../services/i18n'

const props = defineProps({
  renamingConversationId: { type: String, default: null },
  renameTitle: { type: String, default: '' },
})
const emit = defineEmits([
  'add-project',
  'project-menu',
  'conversation-menu',
  'update:rename-title',
  'commit-rename',
  'cancel-rename',
])

const store = useWorkspaceStore()
const { t, conversationTitle } = useI18n()
const treeMode = computed(() => store.settings.sidebarMode === 'tree')
const expandedProjects = ref(new Set())
const hoveredRow = ref(null)
const pendingDrag = ref(null)
const dragging = ref(null)
const dropTarget = ref(null)
let suppressClick = false

watch(
  () => store.projects.map((project) => project.id),
  (projectIds) => {
    const next = new Set([...expandedProjects.value].filter((id) => projectIds.includes(id)))
    for (const id of projectIds) next.add(id)
    expandedProjects.value = next
  },
  { immediate: true },
)

async function toggleMode() {
  try {
    await store.setSidebarMode(treeMode.value ? 'focused' : 'tree')
  } catch (error) {
    store.error = String(error)
  }
}

function toggleExpanded(projectId) {
  const next = new Set(expandedProjects.value)
  if (next.has(projectId)) next.delete(projectId)
  else next.add(projectId)
  expandedProjects.value = next
}

async function activateTreeProject(project) {
  if (store.activeProjectId === project.id) {
    toggleExpanded(project.id)
    return
  }
  expandedProjects.value = new Set(expandedProjects.value).add(project.id)
  await store.selectProject(project.id)
}

async function createConversation(projectId) {
  expandedProjects.value = new Set(expandedProjects.value).add(projectId)
  await store.newConversation(projectId)
}

function startPointerSort(event, type, item, projectId = null) {
  if (event.button !== 0 || event.target.closest('button, input')) return
  const rect = event.currentTarget.getBoundingClientRect()
  pendingDrag.value = {
    type,
    id: item.id,
    projectId,
    label: type === 'project' ? item.name : conversationTitle(item.title),
    startX: event.clientX,
    startY: event.clientY,
    offsetX: event.clientX - rect.left,
    offsetY: event.clientY - rect.top,
    width: rect.width,
    height: rect.height,
  }
  window.addEventListener('pointermove', movePointerSort)
  window.addEventListener('pointerup', finishPointerSort, { once: true })
  window.addEventListener('pointercancel', cancelPointerSort, { once: true })
}

function movePointerSort(event) {
  const pending = pendingDrag.value
  if (!pending) return
  if (!dragging.value && Math.hypot(event.clientX - pending.startX, event.clientY - pending.startY) < 5) return
  event.preventDefault()
  dragging.value = { ...pending, x: event.clientX, y: event.clientY }
  document.documentElement.classList.add('sidebar-sorting')

  const row = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-sort-type]')
  const projectId = row?.dataset.projectId || null
  if (!row || row.dataset.sortType !== pending.type || row.dataset.sortId === pending.id
    || (pending.type === 'conversation' && projectId !== pending.projectId)) {
    dropTarget.value = null
    return
  }
  const rect = row.getBoundingClientRect()
  const position = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
  dropTarget.value = { type: pending.type, id: row.dataset.sortId, projectId, position }
}

async function finishPointerSort() {
  const source = dragging.value
  const target = dropTarget.value
  cleanupPointerSort()
  if (!source) return
  suppressClick = true
  setTimeout(() => { suppressClick = false }, 0)
  if (!target) return
  try {
    if (source.type === 'project') await store.reorderProjects(source.id, target.id, target.position)
    else await store.reorderConversations(source.projectId, source.id, target.id, target.position)
  } catch (error) {
    store.error = String(error)
  }
}

function cancelPointerSort() {
  cleanupPointerSort()
}

function cleanupPointerSort() {
  window.removeEventListener('pointermove', movePointerSort)
  window.removeEventListener('pointerup', finishPointerSort)
  window.removeEventListener('pointercancel', cancelPointerSort)
  pendingDrag.value = null
  dragging.value = null
  dropTarget.value = null
  hoveredRow.value = null
  document.documentElement.classList.remove('sidebar-sorting')
}

function runRowClick(event, action) {
  if (suppressClick) {
    event.preventDefault()
    event.stopPropagation()
    return
  }
  action()
}

function rowClass(type, id) {
  return {
    'actions-visible': hoveredRow.value?.type === type && hoveredRow.value?.id === id,
    dragging: dragging.value?.type === type && dragging.value?.id === id,
    'drop-before': dropTarget.value?.type === type && dropTarget.value?.id === id && dropTarget.value.position === 'before',
    'drop-after': dropTarget.value?.type === type && dropTarget.value?.id === id && dropTarget.value.position === 'after',
  }
}

function showRowActions(type, id) {
  if (!dragging.value) hoveredRow.value = { type, id }
}

function hideRowActions(type, id) {
  if (hoveredRow.value?.type === type && hoveredRow.value?.id === id) hoveredRow.value = null
}

onBeforeUnmount(cleanupPointerSort)
</script>

<template>
  <section class="sidebar-section navigation-section">
    <div class="section-title navigation-title">
      <span>{{ t('sidebar.projects') }}</span>
      <div class="section-actions">
        <button class="icon-button small" :title="t(treeMode ? 'sidebar.currentView' : 'sidebar.treeView')" @click="toggleMode">
          <List v-if="treeMode" :size="14" />
          <ListTree v-else :size="14" />
        </button>
        <button class="icon-button small" :title="t('sidebar.addProject')" @click="emit('add-project')"><Plus :size="15" /></button>
      </div>
    </div>

    <template v-if="!treeMode">
      <div
        v-for="project in store.projects"
        :key="project.id"
        class="sidebar-item project-item draggable-row"
        :class="[{ active: store.activeProjectId === project.id }, rowClass('project', project.id)]"
        :title="project.path"
        data-sort-type="project"
        :data-sort-id="project.id"
        role="button"
        tabindex="0"
        @click="runRowClick($event, () => store.selectProject(project.id))"
        @keydown.enter="store.selectProject(project.id)"
        @pointerenter="showRowActions('project', project.id)"
        @pointerleave="hideRowActions('project', project.id)"
        @pointerdown="startPointerSort($event, 'project', project)"
      >
        <FolderOpen v-if="store.activeProjectId === project.id" :size="16" />
        <Folder v-else :size="16" />
        <span>{{ project.name }}</span>
        <button class="row-action" :title="t('sidebar.projectActions')" @click.stop="emit('project-menu', { event: $event, item: project })"><MoreHorizontal :size="15" /></button>
      </div>

      <template v-if="store.activeProject">
        <div class="section-title conversations-title">
          <span>{{ t('sidebar.conversations') }}</span>
          <div class="section-actions">
            <button class="icon-button small" :title="t('sidebar.newConversation')" @click="store.newConversation()"><MessageSquarePlus :size="15" /></button>
          </div>
        </div>
        <div
          v-for="conversation in store.conversations"
          :key="conversation.id"
          class="sidebar-item conversation-item draggable-row"
          :class="[{ active: store.activeConversationId === conversation.id }, rowClass('conversation', conversation.id)]"
          data-sort-type="conversation"
          :data-sort-id="conversation.id"
          :data-project-id="store.activeProjectId"
          role="button"
          tabindex="0"
          @click="runRowClick($event, () => store.selectConversation(conversation.id))"
          @keydown.enter="store.selectConversation(conversation.id)"
          @pointerenter="showRowActions('conversation', conversation.id)"
          @pointerleave="hideRowActions('conversation', conversation.id)"
          @pointerdown="startPointerSort($event, 'conversation', conversation, store.activeProjectId)"
        >
          <input
            v-if="props.renamingConversationId === conversation.id"
            :value="props.renameTitle"
            class="sidebar-rename-input"
            :aria-label="t('sidebar.conversationName')"
            @input="emit('update:rename-title', $event.target.value)"
            @click.stop
            @keydown.enter.stop.prevent="emit('commit-rename')"
            @keydown.esc.stop.prevent="emit('cancel-rename')"
            @blur="emit('commit-rename')"
          />
          <span v-else class="sidebar-item-label" :title="conversation.title">{{ conversationTitle(conversation.title) }}</span>
          <span v-if="store.runs[conversation.id]" class="run-dot"></span>
          <button class="row-action" :title="t('sidebar.conversationActions')" @click.stop="emit('conversation-menu', { event: $event, item: conversation })"><MoreHorizontal :size="15" /></button>
        </div>
      </template>
    </template>

    <div v-else class="project-tree">
      <div v-for="project in store.projects" :key="project.id" class="tree-project">
        <div
          class="sidebar-item tree-project-row draggable-row"
          :class="[{ current: store.activeProjectId === project.id }, rowClass('project', project.id)]"
          :title="project.path"
          data-sort-type="project"
          :data-sort-id="project.id"
          role="button"
          tabindex="0"
          @click="runRowClick($event, () => activateTreeProject(project))"
          @keydown.enter="activateTreeProject(project)"
          @pointerenter="showRowActions('project', project.id)"
          @pointerleave="hideRowActions('project', project.id)"
          @pointerdown="startPointerSort($event, 'project', project)"
        >
          <FolderOpen v-if="expandedProjects.has(project.id)" :size="16" />
          <Folder v-else :size="16" />
          <span>{{ project.name }}</span>
          <div class="tree-row-actions">
            <button :title="t('sidebar.newConversation')" @click.stop="createConversation(project.id)"><SquarePen :size="14" /></button>
            <button :title="t('sidebar.projectActions')" @click.stop="emit('project-menu', { event: $event, item: project })"><MoreHorizontal :size="15" /></button>
          </div>
        </div>

        <div v-show="expandedProjects.has(project.id)" class="tree-conversations">
          <div
            v-for="conversation in store.projectConversations(project.id)"
            :key="conversation.id"
            class="sidebar-item conversation-item tree-conversation-row draggable-row"
            :class="[{ active: store.activeConversationId === conversation.id }, rowClass('conversation', conversation.id)]"
            data-sort-type="conversation"
            :data-sort-id="conversation.id"
            :data-project-id="project.id"
            role="button"
            tabindex="0"
            @click="runRowClick($event, () => store.selectProject(project.id, conversation.id))"
            @keydown.enter="store.selectProject(project.id, conversation.id)"
            @pointerenter="showRowActions('conversation', conversation.id)"
            @pointerleave="hideRowActions('conversation', conversation.id)"
            @pointerdown="startPointerSort($event, 'conversation', conversation, project.id)"
          >
            <input
              v-if="props.renamingConversationId === conversation.id"
              :value="props.renameTitle"
              class="sidebar-rename-input"
              :aria-label="t('sidebar.conversationName')"
              @input="emit('update:rename-title', $event.target.value)"
              @click.stop
              @keydown.enter.stop.prevent="emit('commit-rename')"
              @keydown.esc.stop.prevent="emit('cancel-rename')"
              @blur="emit('commit-rename')"
            />
            <span v-else class="sidebar-item-label" :title="conversation.title">{{ conversationTitle(conversation.title) }}</span>
            <span v-if="store.runs[conversation.id]" class="run-dot"></span>
            <button class="row-action" :title="t('sidebar.conversationActions')" @click.stop="emit('conversation-menu', { event: $event, item: conversation })"><MoreHorizontal :size="15" /></button>
          </div>
        </div>
      </div>
    </div>

    <Teleport to="body">
      <div
        v-if="dragging"
        class="sidebar-drag-preview"
        :style="{
          width: `${dragging.width}px`,
          height: `${dragging.height}px`,
          transform: `translate3d(${dragging.x - dragging.offsetX}px, ${dragging.y - dragging.offsetY}px, 0)`,
        }"
      >
        <Folder v-if="dragging.type === 'project'" :size="16" />
        <MessageSquare v-else :size="15" />
        <span>{{ dragging.label }}</span>
      </div>
    </Teleport>
  </section>
</template>
