<script setup>
import { MessageSquareText, X } from 'lucide-vue-next'
import { useI18n } from '../../services/i18n'

const props = defineProps({ snippets: { type: Array, default: () => [] } })
defineEmits(['clear'])

const { t } = useI18n()

function countLabel() {
  return t(props.snippets.length === 1 ? 'composer.selectedSnippet' : 'composer.selectedSnippets', { count: props.snippets.length })
}

function lineLabel(snippet) {
  return snippet.startLine === snippet.endLine
    ? t('files.line', { line: snippet.startLine })
    : t('files.lines', { start: snippet.startLine, end: snippet.endLine })
}
</script>

<template>
  <div v-if="snippets.length" class="snippet-drafts">
    <div class="snippet-drafts-chip" tabindex="0">
      <MessageSquareText :size="15" />
      <span>{{ countLabel() }}</span>
      <button :title="t('composer.removeSnippets')" @click.stop="$emit('clear')"><X :size="13" /></button>
      <div class="snippet-drafts-tooltip" role="tooltip">
        <strong>{{ t('composer.snippetSources') }}</strong>
        <div v-for="snippet in snippets" :key="snippet.id" class="snippet-source">
          <span :title="snippet.path">{{ snippet.path }}</span>
          <small>{{ lineLabel(snippet) }}</small>
        </div>
      </div>
    </div>
  </div>
</template>
