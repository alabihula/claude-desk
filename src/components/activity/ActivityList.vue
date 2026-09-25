<script setup>
import { computed } from 'vue'
import { ChevronDown, ShieldAlert } from 'lucide-vue-next'
import { useWorkspaceStore } from '../../stores/workspace'
import { useI18n } from '../../services/i18n'
import { activityPresentation } from '../../services/claude/activityPresentation'
import { canRecoverMedia } from '../../services/claude/mediaFallback'
import ActivityRow from './ActivityRow.vue'
import ThinkingBlock from './ThinkingBlock.vue'
import TaskProgress from './TaskProgress.vue'
const props = defineProps({ run: { type: Object, required: true } })
const store = useWorkspaceStore()
const { t } = useI18n()
const presentation = computed(() => activityPresentation(props.run))
const recoveringMedia = computed(() => canRecoverMedia(props.run)
  || (props.run.request?.recoverMedia && ['starting', 'running', 'finishing'].includes(props.run.status)))
</script>

<template>
  <section class="activity-block">
    <div class="working-line" :class="{ pulse: ['starting', 'running', 'finishing', 'stopping'].includes(run.status) }">
      <span class="sparkle">✦</span>
      <span v-if="recoveringMedia">{{ t('activity.mediaFallback') }}</span>
      <span v-else-if="run.operation === 'compact' && ['starting', 'running'].includes(run.status)">{{ t('activity.compacting') }}</span>
      <span v-else-if="run.status === 'starting'">{{ t('activity.starting') }}</span>
      <span v-else-if="run.status === 'stopping'">{{ t('activity.stopping') }}</span>
      <span v-else-if="run.status === 'finishing'">{{ t('activity.finishing') }}</span>
      <span v-else-if="run.status === 'error'">{{ t('activity.error') }}</span>
      <span v-else-if="run.status === 'complete'">{{ t('activity.done') }}</span>
      <span v-else>{{ t('activity.working') }}</span>
    </div>
    <TaskProgress v-if="run.tasks?.length" :tasks="run.tasks" :run-status="run.status" />
    <div v-if="presentation.current.length" class="activity-current">
      <ActivityRow v-for="entry in presentation.current" :key="entry.id" :activity="entry.activity" :stopping="run.status === 'stopping'" />
    </div>
    <div v-if="presentation.errors.length" class="activity-errors" role="status">
      <ActivityRow v-for="entry in presentation.errors" :key="entry.id" :activity="entry.activity" />
    </div>
    <details v-if="presentation.entries.length" class="execution-details">
      <summary><ChevronDown :size="14" /><span>{{ t('activity.executionDetails') }}</span><small v-if="presentation.total">{{ t('activity.toolProgress', { completed: presentation.completed, total: presentation.total }) }}</small></summary>
      <div class="activity-list">
      <template v-for="entry in presentation.entries" :key="entry.id">
        <ThinkingBlock v-if="entry.type === 'thinking'" :item="entry" />
        <ActivityRow v-else :activity="entry.activity" :stopping="run.status === 'stopping'" />
      </template>
      </div>
    </details>
    <p v-if="run.error && !recoveringMedia" class="run-error">{{ run.error }}</p>
    <button v-if="run.permissionDenied" class="permission-callout" @click="store.permissionsOpen = true">
      <ShieldAlert :size="15" /><span>{{ t('activity.needsAccess') }}</span><strong>{{ t('activity.reviewPermissions') }}</strong>
    </button>
  </section>
</template>
