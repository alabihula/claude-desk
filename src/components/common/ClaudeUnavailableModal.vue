<script setup>
import { nextTick, ref, watch } from 'vue'
import { AlertTriangle } from 'lucide-vue-next'
import { useWorkspaceStore } from '../../stores/workspace'
import { useI18n } from '../../services/i18n'

const store = useWorkspaceStore()
const { t } = useI18n()
const confirmButton = ref(null)
let previousFocus

watch(() => store.claudeUnavailableOpen, async (open) => {
  if (open) {
    previousFocus = document.activeElement
    await nextTick()
    if (store.claudeUnavailableOpen) confirmButton.value?.focus()
  } else if (previousFocus?.isConnected) {
    previousFocus.focus()
  }
}, { flush: 'post', immediate: true })

function close() {
  store.claudeUnavailableOpen = false
}
</script>

<template>
  <div v-if="store.claudeUnavailableOpen" class="modal-backdrop claude-unavailable-backdrop"
    @keydown.esc.prevent.stop="close" @keydown.tab.prevent="confirmButton?.focus()">
    <section class="settings-modal claude-unavailable-modal" role="alertdialog" aria-modal="true"
      aria-labelledby="claude-unavailable-title" aria-describedby="claude-unavailable-description">
      <header>
        <span class="permission-request-icon"><AlertTriangle :size="24" aria-hidden="true" /></span>
        <h2 id="claude-unavailable-title">{{ t('claudeUnavailable.title') }}</h2>
      </header>
      <div id="claude-unavailable-description" class="claude-unavailable-body">
        <p>{{ t('claudeUnavailable.description') }}</p>
        <p>{{ t('claudeUnavailable.nodeHint') }}</p>
        <div class="claude-unavailable-check">
          <span>{{ t('claudeUnavailable.verify') }}</span>
          <code>claude --version</code>
        </div>
        <p>{{ t('claudeUnavailable.afterCheck') }}</p>
      </div>
      <footer><button ref="confirmButton" class="primary-button" @click="close">{{ t('claudeUnavailable.confirm') }}</button></footer>
    </section>
  </div>
</template>

<style scoped>
.claude-unavailable-backdrop { z-index: 100; }
.claude-unavailable-modal { width: min(480px, calc(100% - 36px)); }
.claude-unavailable-modal > header { justify-content: flex-start; align-items: center; gap: 12px; }
.claude-unavailable-modal h2 { margin: 0; font-size: 19px; }
.claude-unavailable-body { padding: 6px 22px; overflow-y: auto; font-size: 13px; line-height: 1.75; }
.claude-unavailable-body p { margin: 14px 0; }
.claude-unavailable-check { display: grid; gap: 7px; padding: 12px 14px; border: 1px solid var(--border-soft); border-radius: 8px; background: var(--app-bg); }
.claude-unavailable-check span { color: var(--text-muted); font-size: 12px; }
.claude-unavailable-check code { font-size: 13px; user-select: text; }
</style>
