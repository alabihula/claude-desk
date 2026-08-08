<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Gauge, Minimize2 } from 'lucide-vue-next'
import { useWorkspaceStore } from '../../stores/workspace'
import { useI18n } from '../../services/i18n'

const store = useWorkspaceStore()
const { t } = useI18n()
const details = ref(null)
const context = computed(() => store.activeContext)
const canCompact = computed(() => !store.activeRun && store.activeMessages.some((message) => message.role === 'user'))

const label = computed(() => {
  if (store.activeRun?.operation === 'compact') return t('context.compacting')
  if (context.value.measured && context.value.window) return t('context.percent', { value: `${context.value.estimated ? '~' : ''}${context.value.percentage}` })
  if (context.value.measured) return t('context.tokens', { value: `${context.value.estimated ? '~' : ''}${tokens(context.value.tokens)}` })
  if (context.value.lastCompactedAt) return t('context.compacted')
  return t(context.value.autoCompact ? 'context.auto' : 'context.off')
})

function tokens(value) {
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k`
  return String(value)
}

function closeOnOutsidePointerDown(event) {
  if (details.value?.hasAttribute('open') && !details.value.contains(event.target)) {
    details.value.removeAttribute('open')
  }
}

onMounted(() => document.addEventListener('pointerdown', closeOnOutsidePointerDown))
onBeforeUnmount(() => document.removeEventListener('pointerdown', closeOnOutsidePointerDown))

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
      <header><strong>{{ t('context.title') }}</strong><small>{{ t(context.autoCompact ? 'context.autoAt' : 'context.autoOff', { value: context.threshold }) }}</small></header>
      <template v-if="context.measured && context.window">
        <div class="context-progress"><i :style="{ width: `${context.percentage}%` }"></i></div>
        <p>{{ t('context.usageWindow', { approx: context.estimated ? t('context.approximately') : '', used: tokens(context.tokens), total: tokens(context.window) }) }}</p>
      </template>
      <p v-else-if="context.measured">{{ t('context.usage', { approx: context.estimated ? t('context.approximately') : '', used: tokens(context.tokens) }) }}</p>
      <p v-else>{{ t('context.afterResponse') }}</p>
      <button :disabled="!canCompact" @click="compact"><Minimize2 :size="14" /> {{ t('context.compactNow') }}</button>
    </div>
  </details>
</template>
