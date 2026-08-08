<script setup>
import { computed } from 'vue'
import { ChevronDown, Sparkles } from 'lucide-vue-next'
import { useI18n } from '../../services/i18n'

const props = defineProps({ item: { type: Object, required: true } })
const { t } = useI18n()
const preview = computed(() => {
  if (props.item.status === 'running') return t('activity.thinking')
  const text = props.item.text.trim().replace(/\s+/g, ' ')
  if (!text) return t('activity.thinkingHidden')
  return text.length > 88 ? `${text.slice(0, 88)}…` : text
})
</script>

<template>
  <details class="thinking-block" :open="item.status === 'running'">
    <summary>
      <Sparkles :size="13" />
      <span>{{ preview }}</span>
      <ChevronDown v-if="item.text" :size="13" />
    </summary>
    <p v-if="item.text">{{ item.text }}</p>
  </details>
</template>
