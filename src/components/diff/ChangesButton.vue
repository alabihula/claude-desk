<script setup>
import { onBeforeUnmount, onMounted } from 'vue'
import { FileDiff } from 'lucide-vue-next'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useWorkspaceStore } from '../../stores/workspace'

const store = useWorkspaceStore()
let refreshTimer
let unlistenFocus

function openChanges() { store.openChanges() }
function refreshChanges() {
  store.refreshChanges().catch(() => {})
}
function handleVisibilityChange() {
  if (document.visibilityState === 'visible') store.refreshChanges().catch(() => {})
}

onMounted(async () => {
  window.addEventListener('focus', refreshChanges)
  document.addEventListener('visibilitychange', handleVisibilityChange)
  refreshTimer = window.setInterval(refreshChanges, 3000)
  unlistenFocus = await getCurrentWindow().onFocusChanged(({ payload: focused }) => {
    if (focused) refreshChanges()
  })
})
onBeforeUnmount(() => {
  window.removeEventListener('focus', refreshChanges)
  document.removeEventListener('visibilitychange', handleVisibilityChange)
  window.clearInterval(refreshTimer)
  unlistenFocus?.()
})
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
