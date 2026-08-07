export function createQueuedMessage({ id, conversation, project, content, attachments = [], createdAt }) {
  return {
    id,
    conversationId: conversation.id,
    sessionId: conversation.claudeSessionId,
    projectId: project.id,
    projectPath: project.path,
    content: content.trim(),
    attachments: attachments.map((item) => ({ ...item })),
    status: 'queued',
    createdAt,
  }
}

export function prioritizeQueuedMessage(messages, id) {
  const selected = messages.find((item) => item.id === id)
  if (!selected) return messages
  return [
    { ...selected, status: 'steering' },
    ...messages.filter((item) => item.id !== id).map((item) => ({ ...item, status: 'queued' })),
  ]
}

export function resetQueuedMessage(messages, id) {
  return messages.map((item) => item.id === id ? { ...item, status: 'queued' } : item)
}

export function takeNextQueuedMessage(messages) {
  if (!messages.length) return [null, messages]
  return [messages[0], messages.slice(1)]
}
