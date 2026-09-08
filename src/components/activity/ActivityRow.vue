<script setup>
import { Check, Circle, CircleStop, X } from 'lucide-vue-next'
import { translateActivity, useI18n } from '../../services/i18n'
defineProps({ activity: { type: Object, required: true }, stopping: Boolean })
const { language } = useI18n()
</script>

<template>
  <div class="activity-row" :class="{ 'activity-error': activity.status === 'error' }">
    <Check v-if="activity.status === 'success'" :size="14" class="success-icon" />
    <X v-else-if="activity.status === 'error'" :size="14" class="error-icon" />
    <CircleStop v-else-if="stopping" :size="14" />
    <Circle v-else :size="11" class="running-icon" />
    <span :title="translateActivity(language, activity.label)">{{ translateActivity(language, activity.label) }}</span>
  </div>
</template>
