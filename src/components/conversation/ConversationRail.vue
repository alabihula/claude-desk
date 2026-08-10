<script setup>
import { useI18n } from '../../services/i18n'

defineProps({
  turns: { type: Array, default: () => [] },
  activeTurnId: { type: String, default: null },
})
const emit = defineEmits(['select'])
const { t } = useI18n()

function label(turn) {
  return t('conversation.jumpToTurn', { index: turn.index, preview: turn.preview })
}
</script>

<template>
  <aside v-if="turns.length > 1" class="conversation-rail" :aria-label="t('conversation.navigation')">
    <button
      v-for="turn in turns"
      :key="turn.id"
      class="conversation-rail-marker"
      :class="{ active: turn.id === activeTurnId }"
      :aria-label="label(turn)"
      :aria-current="turn.id === activeTurnId ? 'step' : undefined"
      @click="emit('select', turn.id)"
    >
      <i></i>
      <span class="conversation-rail-tooltip"><small>{{ t('conversation.turn', { index: turn.index }) }}</small>{{ turn.preview }}</span>
    </button>
  </aside>
</template>
