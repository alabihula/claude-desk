<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { Search } from 'lucide-vue-next'
import { desktop } from '../../services/desktop'
import { useWorkspaceStore } from '../../stores/workspace'
import { useI18n } from '../../services/i18n'
import FileTreeNode from './FileTreeNode.vue'

const store = useWorkspaceStore()
const { t } = useI18n()
const query = ref('')
const expanded = ref(new Set())
const children = ref({})
const loading = ref(new Set())
const errors = ref({})

const rootEntries = computed(() => children.value[''] || [])

function visible(entries) {
  const term = query.value.trim().toLowerCase()
  return term ? entries.filter((entry) => entry.name.toLowerCase().includes(term)) : entries
}

async function loadDirectory(path = '') {
  if (!store.activeProject || loading.value.has(path) || children.value[path]) return
  loading.value = new Set([...loading.value, path])
  try {
    children.value = { ...children.value, [path]: await desktop.listProjectDirectory(store.activeProject.path, path) }
    const nextErrors = { ...errors.value }
    delete nextErrors[path]
    errors.value = nextErrors
  } catch (error) {
    errors.value = { ...errors.value, [path]: String(error) }
  } finally {
    const next = new Set(loading.value)
    next.delete(path)
    loading.value = next
  }
}

async function toggle(entry) {
  if (entry.kind === 'file') {
    await store.openFile(entry.path, null, true)
    return
  }
  const next = new Set(expanded.value)
  if (next.has(entry.path)) next.delete(entry.path)
  else {
    next.add(entry.path)
    await loadDirectory(entry.path)
  }
  expanded.value = next
}

function reset() {
  query.value = ''
  expanded.value = new Set()
  children.value = {}
  errors.value = {}
  loadDirectory()
}

watch(() => store.activeProject?.id, reset)
onMounted(loadDirectory)
</script>

<template>
  <aside class="project-file-tree" :aria-label="t('files.title')">
    <label class="file-tree-search"><Search :size="15" /><input v-model="query" :placeholder="t('files.filter')" /></label>
    <div class="file-tree-scroll">
      <p v-if="loading.has('')" class="file-tree-status">{{ t('common.loading') }}</p>
      <p v-else-if="errors['']" class="file-tree-status error">{{ errors[''] }}</p>
      <template v-else>
        <FileTreeNode
          v-for="entry in visible(rootEntries)"
          :key="entry.path"
          :entry="entry"
          :active-path="store.filePreview?.relativePath || ''"
          :expanded="expanded"
          :children="children"
          :loading="loading"
          :errors="errors"
          :filter="visible"
          @toggle="toggle"
        />
      </template>
    </div>
  </aside>
</template>
