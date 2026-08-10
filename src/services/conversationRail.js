function preview(content = '') {
  const normalized = content.replace(/\s+/g, ' ').trim()
  return normalized.length > 72 ? `${normalized.slice(0, 72)}…` : normalized
}

export function conversationTurns(messages = [], attachmentsByMessage = {}) {
  return messages
    .filter((message) => message.role === 'user')
    .map((message, index) => ({
      id: message.id,
      index: index + 1,
      preview: preview(message.content) || attachmentsByMessage[message.id]?.[0]?.name || 'Attachment',
    }))
}

export function activeTurnFromOffsets(turns = [], offsets = [], viewportTop = 0, padding = 92) {
  let active = turns[0]?.id || null
  for (const offset of offsets) {
    if (offset.top > viewportTop + padding) break
    active = offset.id
  }
  return active
}
