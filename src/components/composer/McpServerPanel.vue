<script setup>
import { AlertTriangle, Plug, RefreshCw, Server, X } from 'lucide-vue-next'
import { useI18n } from '../../services/i18n'

defineProps({
  servers: { type: Array, default: () => [] },
  loading: { type: Boolean, default: false },
  error: { type: String, default: '' },
})
defineEmits(['close', 'refresh'])
const { t } = useI18n()
</script>

<template>
  <section class="mcp-server-panel" role="dialog" aria-modal="false" :aria-label="t('mcp.title')">
    <header>
      <span><Plug :size="16" /><strong>{{ t('mcp.title') }}</strong></span>
      <small>{{ t('mcp.subtitle') }}</small>
      <button :disabled="loading" :title="t('mcp.refresh')" @click="$emit('refresh')"><RefreshCw :size="14" :class="{ spinning: loading }" /></button>
      <button :title="t('common.close')" @click="$emit('close')"><X :size="15" /></button>
    </header>

    <div v-if="loading" class="mcp-panel-state">
      <RefreshCw :size="19" class="spinning" />
      <strong>{{ t('mcp.loading') }}</strong>
      <small>{{ t('mcp.loadingHelp') }}</small>
    </div>
    <div v-else-if="error" class="mcp-panel-state error">
      <AlertTriangle :size="20" />
      <strong>{{ t('mcp.loadFailed') }}</strong>
      <small>{{ error }}</small>
      <button @click="$emit('refresh')">{{ t('common.retry') }}</button>
    </div>
    <div v-else-if="!servers.length" class="mcp-panel-state">
      <Plug :size="21" />
      <strong>{{ t('mcp.empty') }}</strong>
      <small>{{ t('mcp.emptyHelp') }}</small>
    </div>
    <div v-else class="mcp-server-list" role="list">
      <article v-for="server in servers" :key="server.name" role="listitem">
        <Server :size="16" />
        <span>
          <strong>{{ server.name }}</strong>
          <small :title="server.message || server.detail">{{ server.detail || server.message || t('mcp.noDetails') }}</small>
        </span>
        <em :class="`status-${server.status}`">{{ t(`mcp.status.${server.status}`) }}</em>
      </article>
    </div>
  </section>
</template>
