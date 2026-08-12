<script setup>
import { ChevronDown, ChevronRight, File, Folder, FolderOpen } from 'lucide-vue-next'

defineOptions({ name: 'FileTreeNode' })
const props = defineProps({
  entry: { type: Object, required: true },
  depth: { type: Number, default: 0 },
  activePath: { type: String, default: '' },
  expanded: { type: Object, required: true },
  children: { type: Object, required: true },
  loading: { type: Object, required: true },
  errors: { type: Object, required: true },
  filter: { type: Function, required: true },
})
const emit = defineEmits(['toggle'])
</script>

<template>
  <div class="file-tree-node">
    <button
      :class="{ active: activePath === entry.path }"
      :style="{ paddingLeft: `${8 + depth * 16}px` }"
      @click="emit('toggle', entry)"
    >
      <ChevronDown v-if="entry.kind === 'directory' && expanded.has(entry.path)" :size="14" />
      <ChevronRight v-else-if="entry.kind === 'directory'" :size="14" />
      <span v-else></span>
      <FolderOpen v-if="entry.kind === 'directory' && expanded.has(entry.path)" :size="15" />
      <Folder v-else-if="entry.kind === 'directory'" :size="15" />
      <File v-else :size="15" />
      <em>{{ entry.name }}</em>
    </button>
    <template v-if="entry.kind === 'directory' && expanded.has(entry.path)">
      <p v-if="loading.has(entry.path)" class="file-tree-status" :style="{ paddingLeft: `${32 + depth * 16}px` }">…</p>
      <p v-else-if="errors[entry.path]" class="file-tree-status error">{{ errors[entry.path] }}</p>
      <FileTreeNode
        v-for="child in filter(children[entry.path] || [])"
        v-else
        :key="child.path"
        :entry="child"
        :depth="depth + 1"
        :active-path="activePath"
        :expanded="expanded"
        :children="children"
        :loading="loading"
        :errors="errors"
        :filter="filter"
        @toggle="emit('toggle', $event)"
      />
    </template>
  </div>
</template>
