// Separate assistant messages, not streaming chunks. Full frames reconcile the
// same message so partial + full output cannot duplicate progress or answers.
export function applyResponseTextEvent(run, event) {
  if (!['message-start', 'text', 'full-text'].includes(event.type)) return false
  run.responseMessages ||= []
  if (event.type === 'message-start') {
    run.responseMessageId = event.messageId || `response-${run.responseMessages.length}`
    return false // Thinking uses the same boundary as well.
  }
  if (!event.text) return true
  const id = event.messageId || run.responseMessageId || 'response-0'
  let message = run.responseMessages.find((item) => item.id === id)
  if (!message) {
    message = { id, text: '' }
    run.responseMessages.push(message)
  }
  if (event.type === 'text') {
    message.text += event.text
    run.sawPartialText = true
  } else {
    message.text = event.text
  }
  run.content = run.responseMessages.map((item) => item.text).filter(Boolean).join('\n\n')
  return true
}
