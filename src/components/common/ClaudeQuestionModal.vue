<script setup>
import { computed, ref, watch } from 'vue'
import { Check, MessagesSquare } from 'lucide-vue-next'
import { buildQuestionAnswers, questionAnswerValue } from '../../services/claude/questions'
import { useI18n } from '../../services/i18n'
import { useWorkspaceStore } from '../../stores/workspace'

const store = useWorkspaceStore()
const { t } = useI18n()
const request = computed(() => store.activeQuestionRequest)
const responses = ref({})

watch(() => request.value?.requestId, () => {
  responses.value = Object.fromEntries((request.value?.questions || []).map((question) => [
    question.id,
    { selected: [], custom: '' },
  ]))
}, { immediate: true })

const canSubmit = computed(() => request.value?.questions.every((question) => {
  const response = responses.value[question.id]
  return Boolean(questionAnswerValue(response?.selected, response?.custom))
}))

function toggleOption(question, label) {
  const response = responses.value[question.id]
  if (!response) return
  if (question.multiSelect) {
    response.selected = response.selected.includes(label)
      ? response.selected.filter((value) => value !== label)
      : [...response.selected, label]
  } else {
    response.selected = [label]
    response.custom = ''
  }
}

function updateCustom(question, value) {
  const response = responses.value[question.id]
  if (!response) return
  response.custom = value
  if (!question.multiSelect && value.trim()) response.selected = []
}

function cancel() {
  if (request.value) store.respondQuestion(request.value.requestId, {}, true)
}

function submit() {
  if (!request.value || !canSubmit.value) return
  store.respondQuestion(
    request.value.requestId,
    buildQuestionAnswers(request.value, responses.value),
  )
}
</script>

<template>
  <div v-if="request" class="modal-backdrop claude-question-backdrop">
    <section class="settings-modal claude-question-modal" role="dialog" aria-modal="true" aria-labelledby="claude-question-title">
      <header>
        <span class="permission-request-icon"><MessagesSquare :size="20" /></span>
        <div>
          <span class="eyebrow">{{ t('question.eyebrow') }}</span>
          <h2 id="claude-question-title">{{ t('question.title') }}</h2>
        </div>
      </header>
      <div class="claude-question-body">
        <p>{{ t('question.intro') }}</p>
        <fieldset v-for="(question, index) in request.questions" :key="question.id" class="claude-question-group">
          <legend>
            <small>{{ question.header || t('question.fallbackHeader', { index: index + 1 }) }}</small>
            <strong>{{ question.prompt }}</strong>
            <span>{{ t(question.multiSelect ? 'question.multiSelect' : 'question.singleSelect') }}</span>
          </legend>
          <label
            v-for="option in question.options"
            :key="option.label"
            class="claude-question-option"
            :class="{ selected: responses[question.id]?.selected.includes(option.label) }"
          >
            <input
              :type="question.multiSelect ? 'checkbox' : 'radio'"
              :name="question.id"
              :checked="responses[question.id]?.selected.includes(option.label)"
              @change="toggleOption(question, option.label)"
            >
            <span>
              <strong>{{ option.label }}</strong>
              <small v-if="option.description">{{ option.description }}</small>
            </span>
            <Check :size="16" />
          </label>
          <label class="claude-question-custom">
            <span>{{ t('question.other') }}</span>
            <input
              :value="responses[question.id]?.custom"
              :placeholder="t('question.otherPlaceholder')"
              @input="updateCustom(question, $event.target.value)"
            >
          </label>
        </fieldset>
      </div>
      <footer>
        <button class="secondary-button question-cancel" :disabled="request.responding" @click="cancel">
          {{ t('question.skip') }}
        </button>
        <button class="primary-button question-submit" :disabled="request.responding || !canSubmit" @click="submit">
          {{ t(request.responding ? 'question.responding' : 'question.submit') }}
        </button>
      </footer>
    </section>
  </div>
</template>
