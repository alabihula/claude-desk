<script setup>
import { computed } from 'vue'
import { Check, LoaderCircle } from 'lucide-vue-next'
import { useI18n } from '../../services/i18n'

const props = defineProps({
  tasks: { type: Array, default: () => [] },
  runStatus: { type: String, default: 'running' },
})
const { t } = useI18n()
const completed = computed(() => props.tasks.filter((task) => task.status === 'completed').length)
// A cancelled/finished run must not leave an unfinished task visibly spinning.
const running = computed(() => ['starting', 'running', 'finishing'].includes(props.runStatus))
const taskLabel = (task) => task.status === 'in_progress' && running.value
  ? task.activeForm || task.subject
  : task.subject || task.activeForm
</script>

<template>
  <section class="task-progress" :class="{ 'task-progress-idle': !running }" :aria-label="t('tasks.title')">
    <header>
      <strong>{{ t('tasks.title') }}</strong>
      <span role="status" aria-live="polite" aria-atomic="true">{{ t('tasks.progress', { completed, total: tasks.length }) }}</span>
    </header>
    <div class="task-progress-list" role="list">
      <div
        v-for="task in tasks"
        :key="task.id"
        class="task-progress-item"
        :class="`task-${task.status}`"
        role="listitem"
        :title="task.description || taskLabel(task)"
      >
        <span class="task-checkbox" :aria-label="t(`tasks.${task.status === 'in_progress' && !running ? 'incomplete' : task.status}`)">
          <Check v-if="task.status === 'completed'" :size="13" />
          <LoaderCircle v-else-if="task.status === 'in_progress' && running" :size="12" />
        </span>
        <span>{{ taskLabel(task) }}</span>
      </div>
    </div>
  </section>
</template>
