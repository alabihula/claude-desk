<script setup>
import { computed, ref } from 'vue'
import { Gauge, Minimize2 } from 'lucide-vue-next'
import { useWorkspaceStore } from '../../stores/workspace'

const store = useWorkspaceStore()
const details = ref(null)
const context = computed(() => store.activeContext)
const canCompact = computed(() => !store.activeRun && store.activeMessages.some((message) => message.role === 'user'))

const label = computed(() => {
  if (store.activeRun?.operation === 'compact') return 'Compacting…'
  if (context.value.measured && context.value.window) return `${context.value.estimated ? '~' : ''}${context.value.percentage}% context`
  if (context.value.measured) return `${context.value.estimated ? '~' : ''}${tokens(context.value.tokens)} context`
  if (context.value.lastCompactedAt) return 'Context compacted'
  return context.value.autoCompact ? 'Auto compact' : 'Compact off'
})

function tokens(value) {
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k`
  return String(value)
}

async function compact() {
  details.value?.removeAttribute('open')
  await store.compactConversation()
}
</script>

<template>
  <details ref="details" class="context-meter">
    <summary :class="{ warning: context.measured && context.window && context.percentage >= context.threshold, disabled: !context.autoCompact }">
      <Gauge :size="14" /><span>{{ label }}</span>
    </summary>
    <div class="context-popover">
      <header><strong>Context</strong><small>{{ context.autoCompact ? `Auto-compact at ${context.threshold}%` : 'Auto-compact is off' }}</small></header>
      <template v-if="context.measured && context.window">
        <div class="context-progress"><i :style="{ width: `${context.percentage}%` }"></i></div>
        <p>{{ context.estimated ? 'Approximately ' : '' }}{{ tokens(context.tokens) }} of {{ tokens(context.window) }} tokens currently in use.</p>
      </template>
      <p v-else-if="context.measured">{{ context.estimated ? 'Approximately ' : '' }}{{ tokens(context.tokens) }} tokens in use. Set the provider context window in Settings to show a percentage.</p>
      <p v-else>Usage will appear after Claude's next response.</p>
      <button :disabled="!canCompact" @click="compact"><Minimize2 :size="14" /> Compact now</button>
    </div>
  </details>
</template>
