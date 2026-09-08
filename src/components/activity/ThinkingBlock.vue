<script setup>
import { ChevronDown, Sparkles } from 'lucide-vue-next'
import { useI18n } from '../../services/i18n'

defineProps({ item: { type: Object, required: true } })
const { t } = useI18n()
</script>

<template>
  <details class="thinking-block">
    <summary>
      <Sparkles :size="13" />
      <span>{{ t(item.text ? 'activity.thinkingDetails' : 'activity.thinkingHidden') }}</span>
      <ChevronDown v-if="item.text" :size="13" />
    </summary>
    <p v-if="item.text">{{ item.text }}</p>
  </details>
</template>
