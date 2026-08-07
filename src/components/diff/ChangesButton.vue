<script setup>
import { FileDiff } from 'lucide-vue-next'
import { useWorkspaceStore } from '../../stores/workspace'

const store = useWorkspaceStore()

function openChanges() { store.openChanges() }
</script>

<template>
  <button
    v-if="store.activeChanges.length"
    class="changes-button"
    :title="`Review ${store.activeChanges.length} changed file${store.activeChanges.length === 1 ? '' : 's'}`"
    @click="openChanges"
  >
    <FileDiff :size="15" /><span>Changes</span><em>{{ store.activeChanges.length }}</em>
  </button>
</template>
