import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { desktop } from './desktop'

export function useMcpRuntime(store, open) {
  const busy = ref(false)
  const retrying = ref('')
  const error = ref('')
  const active = computed(() => Boolean(store.activeRun?.runId) && ['starting', 'running'].includes(store.activeRun.status))
  const runtime = computed(() => store.mcpRuntimeByConversation[store.activeConversationId] || null)
  let generation = 0
  let timer

  async function refresh(reconnect = null) {
    if (!active.value || busy.value) return
    const conversationId = store.activeConversationId
    const runId = store.activeRun.runId
    const ticket = generation
    busy.value = true
    retrying.value = reconnect || ''
    error.value = ''
    try {
      const status = await desktop.inspectRunMcp(conversationId, runId, reconnect)
      if (ticket !== generation || store.activeRun?.runId !== runId) return
      store.mcpRuntimeByConversation[conversationId] = { ...status, runId, checkedAt: Date.now() }
    } catch {
      if (ticket === generation) error.value = reconnect ? 'mcp.reconnectFailed' : 'mcp.liveFailed'
    } finally {
      if (ticket === generation) {
        busy.value = false
        retrying.value = ''
      }
    }
  }

  watch([open, active, () => store.activeConversationId, () => store.activeRun?.runId], () => {
    generation++
    clearInterval(timer)
    busy.value = false
    retrying.value = ''
    error.value = ''
    if (open.value && active.value) {
      refresh()
      // Poll only the existing process while the panel is visible, never spawn probes here.
      timer = setInterval(() => { if (!error.value) refresh() }, 3000)
    }
  }, { immediate: true })
  onBeforeUnmount(() => { generation++; clearInterval(timer) })
  return { active, runtime, busy, retrying, error, refresh }
}
