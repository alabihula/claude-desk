<script setup>
import { onBeforeUnmount, onMounted } from 'vue'
import { FileDiff } from 'lucide-vue-next'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useWorkspaceStore } from '../../stores/workspace'
import { useI18n } from '../../services/i18n'

const store = useWorkspaceStore()
const { t } = useI18n()
let refreshTimer
let unlistenFocus

function openEnvironment() { store.openEnvironment() }
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
    v-if="store.activeProject"
    class="changes-button"
    :title="t('environment.title')"
    @click="openEnvironment"
  >
    <FileDiff :size="15" /><span>{{ t('changes.label') }}</span><em v-if="store.activeChanges.length">{{ store.activeChanges.length }}</em>
  </button>
</template>
