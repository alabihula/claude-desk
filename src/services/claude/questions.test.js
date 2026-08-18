import { describe, expect, it } from 'vitest'
import {
  buildQuestionAnswers,
  normalizeQuestionRequest,
  questionAnswerValue,
} from './questions'

const event = {
  requestId: 'question-1',
  toolName: 'AskUserQuestion',
  input: {
    questions: [{
      question: 'Which framework?',
      header: 'Framework',
      options: [
        { label: 'Vue', description: 'Use Vue' },
        { label: 'React', description: 'Use React' },
      ],
      multiSelect: false,
    }],
  },
}

describe('Claude structured questions', () => {
  it('normalizes supported single and multi-select questions', () => {
    expect(normalizeQuestionRequest(event, 'conversation-1', 'run-1')).toMatchObject({
      requestId: 'question-1',
      questions: [{ prompt: 'Which framework?', header: 'Framework', multiSelect: false }],
      responding: false,
    })
  })

  it('rejects malformed requests and unsupported option counts', () => {
    expect(normalizeQuestionRequest({}, 'conversation-1', 'run-1')).toBeNull()
    expect(normalizeQuestionRequest({
      ...event,
      input: { questions: [{ ...event.input.questions[0], options: [{ label: 'Only one' }] }] },
    }, 'conversation-1', 'run-1')).toBeNull()
  })

  it('builds the protocol answer map from selections and custom text', () => {
    const request = normalizeQuestionRequest(event, 'conversation-1', 'run-1')
    expect(questionAnswerValue(['Vue', 'Vue'], 'with TypeScript')).toBe('Vue, with TypeScript')
    expect(buildQuestionAnswers(request, {
      'question-1:0': { selected: ['Vue'], custom: 'with TypeScript' },
    })).toEqual({ 'Which framework?': 'Vue, with TypeScript' })
  })
})
