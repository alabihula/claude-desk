// @vitest-environment happy-dom
import { createApp, h, nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useWorkspaceStore } from '../../stores/workspace'
import ClaudeQuestionModal from './ClaudeQuestionModal.vue'

let app
let root
let store

beforeEach(() => {
  const pinia = createPinia()
  setActivePinia(pinia)
  store = useWorkspaceStore()
  store.questionRequests = [{
    requestId: 'question-1', conversationId: 'conversation-1', runId: 'run-1', responding: false,
    questions: [{
      id: 'question-1:0', prompt: 'Which framework?', header: 'Framework', multiSelect: false,
      options: [{ label: 'Vue', description: 'Use Vue' }, { label: 'React', description: 'Use React' }],
    }],
  }]
  store.respondQuestion = vi.fn()
  root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp({ render: () => h(ClaudeQuestionModal) })
  app.use(pinia)
  app.mount(root)
})

afterEach(() => {
  app.unmount()
  document.body.innerHTML = ''
})

describe('ClaudeQuestionModal', () => {
  it('requires an answer and submits the selected option as structured answers', async () => {
    const submit = root.querySelector('.question-submit')
    expect(submit.disabled).toBe(true)

    root.querySelector('.claude-question-option input').click()
    await nextTick()
    expect(submit.disabled).toBe(false)
    submit.click()

    expect(store.respondQuestion).toHaveBeenCalledWith(
      'question-1', { 'Which framework?': 'Vue' },
    )
  })

  it('uses custom text instead of a selected option for a single-select question', async () => {
    root.querySelector('.claude-question-option input').click()
    const custom = root.querySelector('.claude-question-custom input')
    custom.value = 'Svelte'
    custom.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    root.querySelector('.question-submit').click()

    expect(store.respondQuestion).toHaveBeenCalledWith(
      'question-1', { 'Which framework?': 'Svelte' },
    )
  })

  it('combines multiple selected options for a multi-select question', async () => {
    store.questionRequests = [{
      ...store.questionRequests[0],
      requestId: 'question-2',
      questions: [{
        ...store.questionRequests[0].questions[0],
        id: 'question-2:0',
        prompt: 'Which features?',
        multiSelect: true,
      }],
    }]
    await nextTick()
    const options = root.querySelectorAll('.claude-question-option input')
    options[0].click()
    options[1].click()
    await nextTick()
    root.querySelector('.question-submit').click()

    expect(store.respondQuestion).toHaveBeenCalledWith(
      'question-2', { 'Which features?': 'Vue, React' },
    )
  })

  it('keeps the blocking dialog open on backdrop clicks and supports explicit skip', async () => {
    root.querySelector('.modal-backdrop').click()
    await nextTick()
    expect(store.activeQuestionRequest).not.toBeNull()

    root.querySelector('.question-cancel').click()
    expect(store.respondQuestion).toHaveBeenCalledWith('question-1', {}, true)
  })
})
