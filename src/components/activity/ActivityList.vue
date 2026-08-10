<script setup>
import { computed } from 'vue'
import { Check, Circle, CircleStop, ShieldAlert, X } from 'lucide-vue-next'
import { useWorkspaceStore } from '../../stores/workspace'
import { translateActivity, useI18n } from '../../services/i18n'
import ThinkingBlock from './ThinkingBlock.vue'
const props = defineProps({ run: { type: Object, required: true } })
const store = useWorkspaceStore()
const { language, t } = useI18n()
const activityLabel = (label) => translateActivity(language.value, label)
const entries = computed(() => props.run.timeline?.length
  ? props.run.timeline
  : props.run.activities.map((activity) => ({ id: `activity:${activity.id}`, type: 'activity', activity })))
</script>

<template>
  <section class="activity-block">
    <div class="working-line" :class="{ pulse: ['starting', 'running', 'finishing', 'stopping'].includes(run.status) }">
      <span class="sparkle">✦</span>
      <span v-if="run.operation === 'compact' && ['starting', 'running'].includes(run.status)">{{ t('activity.compacting') }}</span>
      <span v-else-if="run.status === 'starting'">{{ t('activity.starting') }}</span>
      <span v-else-if="run.status === 'stopping'">{{ t('activity.stopping') }}</span>
      <span v-else-if="run.status === 'finishing'">{{ t('activity.finishing') }}</span>
      <span v-else-if="run.status === 'error'">{{ t('activity.error') }}</span>
      <span v-else-if="run.status === 'complete'">{{ t('activity.done') }}</span>
      <span v-else>{{ t('activity.working') }}</span>
    </div>
    <div v-if="entries.length" class="activity-list">
      <template v-for="entry in entries" :key="entry.id">
        <ThinkingBlock v-if="entry.type === 'thinking'" :item="entry" />
        <div v-else class="activity-row">
          <Check v-if="entry.activity.status === 'success'" :size="14" class="success-icon" />
          <X v-else-if="entry.activity.status === 'error'" :size="14" class="error-icon" />
          <CircleStop v-else-if="run.status === 'stopping'" :size="14" />
          <Circle v-else :size="11" class="running-icon" />
          <span>{{ activityLabel(entry.activity.label) }}</span>
        </div>
      </template>
    </div>
    <p v-if="run.error" class="run-error">{{ run.error }}</p>
    <button v-if="run.permissionDenied" class="permission-callout" @click="store.permissionsOpen = true">
      <ShieldAlert :size="15" /><span>{{ t('activity.needsAccess') }}</span><strong>{{ t('activity.reviewPermissions') }}</strong>
    </button>
  </section>
</template>
