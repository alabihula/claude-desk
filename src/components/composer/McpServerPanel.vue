<script setup>
import { computed } from 'vue'
import { Plug, RefreshCw, Server, X } from 'lucide-vue-next'
import { useI18n } from '../../services/i18n'
import { mcpRows, mcpIssue, safeMcpDetail, mcpRuntimeLabel, mcpToolsLabel, canReconnectMcp } from '../../services/mcpStatus'

const props = defineProps({
  servers: { type: Array, default: () => [] },
  runtime: { type: Object, default: null },
  active: Boolean, liveBusy: Boolean, loading: Boolean,
  liveError: { type: String, default: '' },
  reconnecting: { type: String, default: '' },
  retryingName: { type: String, default: '' },
  error: { type: String, default: '' },
})
defineEmits(['close', 'refresh', 'retry', 'live-refresh', 'reconnect'])
const { t } = useI18n()
const rows = computed(() => mcpRows(props.servers, props.runtime, props.active))
const busy = computed(() => props.loading || Boolean(props.retryingName) || props.liveBusy)
function retryable(server) { return server.configured && ['failed', 'unknown'].includes(server.checkStatus) }
function runtimeLabel(server) { return mcpRuntimeLabel(server, props) }
function reconnectable(server) { return canReconnectMcp(server, props) }
function toolsLabel(server) { return mcpToolsLabel(server, props) }
</script>

<template>
  <section class="mcp-server-panel" role="dialog" aria-modal="false" :aria-label="t('mcp.title')">
    <header>
      <span><Plug :size="16" /><strong>{{ t('mcp.title') }}</strong></span>
      <small>{{ t(active ? 'mcp.liveTitle' : 'mcp.checkTitle') }}</small>
      <button class="icon-button" :disabled="busy" :title="t(active ? 'mcp.liveRefresh' : 'mcp.refresh')" :aria-label="t(active ? 'mcp.liveRefresh' : 'mcp.refresh')" @click="$emit(active ? 'live-refresh' : 'refresh')"><RefreshCw :size="14" :class="{ spinning: loading || (liveBusy && !reconnecting) }" /></button>
      <button class="icon-button" :title="t('common.close')" :aria-label="t('common.close')" @click="$emit('close')"><X :size="15" /></button>
    </header>
    <div class="mcp-panel-notice">
      <span>{{ t(active ? 'mcp.liveHelp' : 'mcp.idleHelp') }}</span>
      <span v-if="liveError" class="mcp-notice-error">{{ t(liveError) }}</span>
      <span v-if="error && rows.length" class="mcp-notice-error">{{ t('mcp.checkStale') }}</span>
    </div>
    <div v-if="loading && !rows.length" class="mcp-panel-state">
      <RefreshCw :size="19" class="spinning" /><strong>{{ t('mcp.loading') }}</strong><small>{{ t('mcp.loadingHelp') }}</small>
    </div>
    <div v-else-if="error && !rows.length" class="mcp-panel-state error">
      <strong>{{ t('mcp.loadFailed') }}</strong>
      <small>{{ t(`mcp.help.${mcpIssue(error)}`) }}</small>
      <details><summary>{{ t('mcp.details') }}</summary><small>{{ safeMcpDetail(error) }}</small></details>
      <button @click="$emit('refresh')">{{ t('mcp.recheck') }}</button>
    </div>
    <div v-else-if="!rows.length" class="mcp-panel-state">
      <Plug :size="21" /><strong>{{ t('mcp.empty') }}</strong><small>{{ t('mcp.emptyHelp') }}</small>
    </div>
    <div v-else class="mcp-server-list" role="list">
      <article v-for="server in rows" :key="server.name" role="listitem">
        <Server :size="16" />
        <span>
          <strong>{{ server.name }}</strong>
          <small v-if="server.configured">{{ t('mcp.checkLabel') }}{{ t(`mcp.status.${server.checkStatus}`) }}</small>
          <small v-else>{{ t(error ? 'mcp.loadFailed' : 'mcp.configNotListed') }}</small>
          <small v-if="active" class="mcp-runtime-state" :class="{ [`status-${server.state}`]: !liveError && runtime?.source === 'live' }">{{ t('mcp.currentLabel') }}{{ t(runtimeLabel(server)) }}</small>
          <small v-if="server.current">{{ t(toolsLabel(server), { count: server.current.toolCount }) }}</small>
          <details v-if="server.detail || server.message || server.checkStatus !== 'connected' || (active && server.state === 'empty')">
            <summary>{{ t('mcp.details') }}</summary>
            <p v-if="server.message || (active && ['failed', 'empty', 'authRequired'].includes(server.state)) || ['failed', 'unknown', 'authRequired'].includes(server.checkStatus)">{{ t(`mcp.help.${active && server.state === 'empty' ? 'empty' : server.issue}`) }}</p>
            <p v-if="server.detail">{{ server.detail }}</p>
            <p v-if="server.message">{{ server.message }}</p>
          </details>
        </span>
        <div class="mcp-server-status">
          <button v-if="reconnectable(server)" class="mcp-server-retry" :disabled="busy" @click="$emit('reconnect', server.name)">
            <RefreshCw :size="12" :class="{ spinning: reconnecting === server.name }" />{{ t(reconnecting === server.name ? 'mcp.reconnecting' : 'mcp.reconnect') }}
          </button>
          <button v-else-if="retryable(server)" class="mcp-server-retry" :disabled="busy" :title="t('mcp.retryHelp')" @click="$emit('retry', server.name)">
            <RefreshCw :size="12" :class="{ spinning: retryingName === server.name }" />{{ t(retryingName === server.name ? 'mcp.retrying' : 'mcp.recheck') }}
          </button>
        </div>
      </article>
    </div>
  </section>
</template>
