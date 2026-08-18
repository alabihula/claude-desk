const MIN_OPTIONS = 2
const MAX_OPTIONS = 4
const MAX_QUESTIONS = 4

function normalizeOptions(options) {
  if (!Array.isArray(options) || options.length < MIN_OPTIONS || options.length > MAX_OPTIONS) return null
  const normalized = options.map((option) => ({
    label: String(option?.label || '').trim(),
    description: String(option?.description || '').trim(),
  }))
  if (normalized.some((option) => !option.label)) return null
  if (new Set(normalized.map((option) => option.label)).size !== normalized.length) return null
  return normalized
}

export function normalizeQuestionRequest(data, conversationId, runId) {
  const requestId = String(data?.requestId || '')
  const rawQuestions = data?.input?.questions
  if (data?.toolName !== 'AskUserQuestion' || !requestId || !conversationId || !runId) return null
  if (!Array.isArray(rawQuestions) || !rawQuestions.length || rawQuestions.length > MAX_QUESTIONS) return null
  const questions = rawQuestions.map((question, index) => ({
    id: `${requestId}:${index}`,
    prompt: String(question?.question || '').trim(),
    header: String(question?.header || '').trim(),
    multiSelect: question?.multiSelect === true,
    options: normalizeOptions(question?.options),
  }))
  if (questions.some((question) => !question.prompt || !question.options)) return null
  return {
    requestId,
    conversationId,
    runId,
    questions,
    responding: false,
  }
}

export function questionAnswerValue(selected = [], custom = '') {
  const values = [...new Set(selected.map((value) => String(value).trim()).filter(Boolean))]
  const customValue = String(custom).trim()
  if (customValue) values.push(customValue)
  return values.join(', ')
}

export function buildQuestionAnswers(request, responses = {}) {
  return Object.fromEntries(request.questions.map((question) => {
    const response = responses[question.id] || {}
    return [question.prompt, questionAnswerValue(response.selected, response.custom)]
  }))
}
