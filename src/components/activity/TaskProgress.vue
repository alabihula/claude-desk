<script setup>
import { computed } from 'vue'
import { Check, LoaderCircle } from 'lucide-vue-next'
import { useI18n } from '../../services/i18n'

const props = defineProps({ tasks: { type: Array, default: () => [] } })
const { t } = useI18n()
const completed = computed(() => props.tasks.filter((task) => task.status === 'completed').length)
const taskLabel = (task) => task.status === 'in_progress'
  ? task.activeForm || task.subject
  : task.subject || task.activeForm
</script>

<template>
  <section class="task-progress" :aria-label="t('tasks.title')">
    <header>
      <strong>{{ t('tasks.title') }}</strong>
      <span>{{ t('tasks.progress', { completed, total: tasks.length }) }}</span>
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
        <span class="task-checkbox" :aria-label="t(`tasks.${task.status}`)">
          <Check v-if="task.status === 'completed'" :size="13" />
          <LoaderCircle v-else-if="task.status === 'in_progress'" :size="12" />
        </span>
        <span>{{ taskLabel(task) }}</span>
      </div>
    </div>
  </section>
</template>
