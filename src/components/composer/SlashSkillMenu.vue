<script setup>
import { Command, CornerDownLeft, Plug } from 'lucide-vue-next'
import { useI18n } from '../../services/i18n'

defineProps({
  skills: { type: Array, default: () => [] },
  activeIndex: { type: Number, default: 0 },
})
defineEmits(['select'])
const { t } = useI18n()
</script>

<template>
  <div v-if="skills.length" class="slash-skill-menu" role="listbox" :aria-label="t('skills.title')">
    <button
      v-for="(skill, index) in skills"
      :key="skill.name"
      class="slash-skill-option"
      :class="{ active: index === activeIndex }"
      role="option"
      :aria-selected="index === activeIndex"
      @mousedown.prevent
      @click="$emit('select', skill)"
    >
      <Plug v-if="skill.name === 'mcp' && skill.scope === 'builtIn'" :size="15" />
      <Command v-else :size="15" />
      <span class="slash-skill-copy"><strong>/{{ skill.name }}</strong><small>{{ skill.description || t('skills.noDescription') }}</small></span>
      <em>{{ t(`skills.${skill.scope}`) }}</em>
      <CornerDownLeft v-if="index === activeIndex" :size="13" />
    </button>
  </div>
</template>
