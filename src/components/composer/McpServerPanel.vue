<script setup>
import { computed } from 'vue'
import { AlertTriangle, Plug, RefreshCw, Server, X } from 'lucide-vue-next'
import { useI18n } from '../../services/i18n'

const props = defineProps({
  servers: { type: Array, default: () => [] },
  runtime: { type: Object, default: null },
  loading: { type: Boolean, default: false },
  retryingName: { type: String, default: '' },
  error: { type: String, default: '' },
})
defineEmits(['close', 'refresh', 'retry'])
const { t } = useI18n()

const runtimeByName = computed(() => new Map((props.runtime?.servers || []).map((server) => [server.name, server])))
const configuredNames = computed(() => new Set(props.servers.map((server) => server.name)))
const rows = computed(() => {
  return [
    ...props.servers,
    ...(props.runtime?.servers || [])
      .filter((server) => !configuredNames.value.has(server.name))
      .map((server) => ({ ...server, detail: '', status: 'unknown', message: '' })),
  ]
})
const runtimeIssues = computed(() => props.runtime
  ? props.servers.filter((server) => {
    const current = runtimeByName.value.get(server.name)
    return !current || current.toolCount === 0 || /fail|disconnect|error/i.test(current.status)
  }).length
  : 0)

function runtimeLabel(name) {
  if (!props.runtime) return ''
  const current = runtimeByName.value.get(name)
  if (!current) return t('mcp.runtimeMissing')
  if (/fail|disconnect|error/i.test(current.status)) return t('mcp.runtimeFailed', { status: current.status })
  if (!current.toolCount) return t('mcp.runtimeNoTools', { status: current.status })
  return t('mcp.runtimeTools', { count: current.toolCount })
}

function retryable(server) {
  return configuredNames.value.has(server.name) && ['failed', 'unknown'].includes(server.status)
}

function serverDescription(server) {
  if (retryable(server) && server.message) return server.message
  return server.detail || server.message || t('mcp.noDetails')
}
</script>

<template>
  <section class="mcp-server-panel" role="dialog" aria-modal="false" :aria-label="t('mcp.title')">
    <header>
      <span><Plug :size="16" /><strong>{{ t('mcp.title') }}</strong></span>
      <small>{{ runtime ? t('mcp.runtimeSummary', { count: runtime.toolCount }) : t('mcp.subtitle') }}</small>
      <button :disabled="loading || retryingName" :title="t('mcp.refresh')" @click="$emit('refresh')"><RefreshCw :size="14" :class="{ spinning: loading }" /></button>
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
    <div v-else-if="!rows.length" class="mcp-panel-state">
      <Plug :size="21" />
      <strong>{{ t('mcp.empty') }}</strong>
      <small>{{ t('mcp.emptyHelp') }}</small>
    </div>
    <div v-else class="mcp-server-list" role="list">
      <div v-if="runtimeIssues" class="mcp-runtime-warning"><AlertTriangle :size="15" /><span>{{ t('mcp.runtimeWarning', { count: runtimeIssues }) }}</span></div>
      <article v-for="server in rows" :key="server.name" role="listitem">
        <Server :size="16" />
        <span>
          <strong>{{ server.name }}</strong>
          <small :title="server.message || server.detail">{{ serverDescription(server) }}</small>
          <small v-if="runtime" class="mcp-runtime-detail" :class="{ missing: !runtimeByName.get(server.name)?.toolCount }">{{ runtimeLabel(server.name) }}</small>
        </span>
        <div class="mcp-server-status">
          <em :class="`status-${server.status}`">{{ t(`mcp.status.${server.status}`) }}</em>
          <button
            v-if="retryable(server)"
            class="mcp-server-retry"
            type="button"
            :disabled="Boolean(retryingName)"
            :title="t('mcp.retryHelp')"
            @click="$emit('retry', server.name)"
          >
            <RefreshCw :size="12" :class="{ spinning: retryingName === server.name }" />
            {{ t(retryingName === server.name ? 'mcp.retrying' : 'common.retry') }}
          </button>
        </div>
      </article>
    </div>
  </section>
</template>
