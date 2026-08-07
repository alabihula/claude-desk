<script setup>
import { Check, Circle, CircleStop, ShieldAlert, X } from 'lucide-vue-next'
import { useWorkspaceStore } from '../../stores/workspace'
defineProps({ run: { type: Object, required: true } })
const store = useWorkspaceStore()
</script>

<template>
  <section class="activity-block">
    <div class="working-line" :class="{ pulse: ['starting', 'running', 'stopping'].includes(run.status) }">
      <span class="sparkle">✦</span>
      <span v-if="run.operation === 'compact' && ['starting', 'running'].includes(run.status)">Compacting context…</span>
      <span v-else-if="run.status === 'starting'">Starting Claude…</span>
      <span v-else-if="run.status === 'stopping'">Stopping Claude…</span>
      <span v-else-if="run.status === 'error'">Claude stopped with an error</span>
      <span v-else-if="run.status === 'complete'">Done</span>
      <span v-else>Claude is working</span>
    </div>
    <div v-if="run.activities.length" class="activity-list">
      <div v-for="activity in run.activities" :key="activity.id" class="activity-row">
        <Check v-if="activity.status === 'success'" :size="14" class="success-icon" />
        <X v-else-if="activity.status === 'error'" :size="14" class="error-icon" />
        <CircleStop v-else-if="run.status === 'stopping'" :size="14" />
        <Circle v-else :size="11" class="running-icon" />
        <span>{{ activity.label }}</span>
      </div>
    </div>
    <p v-if="run.error" class="run-error">{{ run.error }}</p>
    <button v-if="run.permissionDenied" class="permission-callout" @click="store.permissionsOpen = true">
      <ShieldAlert :size="15" /><span>Claude needs more access</span><strong>Review Permissions</strong>
    </button>
  </section>
</template>
