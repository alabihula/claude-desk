const TOOL_LABELS = {
  Read: 'Reading',
  Edit: 'Editing',
  Write: 'Writing',
  Bash: 'Running command',
  Grep: 'Searching',
  Glob: 'Finding files',
  WebFetch: 'Reading web page',
  WebSearch: 'Searching the web',
  Task: 'Delegating task',
}

function toolTarget(block) {
  const input = block.input || {}
  return input.file_path || input.path || input.pattern || input.command || input.query || ''
}

function toolActivity(block) {
  const prefix = TOOL_LABELS[block.name] || block.name || 'Using tool'
  const target = toolTarget(block)
  return {
    id: block.id || crypto.randomUUID(),
    tool: block.name || 'Tool',
    label: target ? `${prefix} ${target}` : prefix,
    status: 'running',
  }
}

function contextTokens(usage = {}) {
  return ['input_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens', 'output_tokens']
    .reduce((total, key) => total + Number(usage[key] || 0), 0)
}

function contextWindow(modelUsage = {}) {
  return Math.max(0, ...Object.values(modelUsage).map((usage) => Number(usage?.contextWindow || 0)))
}

function valueType(value) {
  if (value === undefined) return 'missing'
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

export function parseClaudeEvent(payload) {
  if (!payload || typeof payload !== 'object') return []
  const events = []

  if (payload.type === 'system' && payload.subtype === 'init') {
    events.push({ type: 'session', sessionId: payload.session_id })
  }

  if (payload.type === 'stream_event') {
    const event = payload.event || {}
    if (event.type === 'message_start') {
      events.push({ type: 'message-start', messageId: event.message?.id || '' })
    }
    if (event.type === 'content_block_start' && ['thinking', 'redacted_thinking'].includes(event.content_block?.type)) {
      events.push({ type: 'thinking-start', index: event.index, hidden: event.content_block.type === 'redacted_thinking' })
    }
    if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
      events.push({ type: 'text', text: event.delta.text || '' })
    }
    if (event.type === 'content_block_delta' && event.delta?.type === 'thinking_delta') {
      events.push({ type: 'thinking', index: event.index, text: event.delta.thinking || '' })
    }
    if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
      events.push({ type: 'activity', activity: toolActivity(event.content_block) })
    }
    if (event.type === 'content_block_stop') {
      events.push({ type: 'block-complete', index: event.index })
    }
  }

  if (payload.type === 'assistant') {
    const blocks = payload.message?.content || []
    const text = blocks.filter((block) => block.type === 'text').map((block) => block.text).join('')
    for (const [index, block] of blocks.entries()) {
      if (block.type === 'thinking') {
        events.push({ type: 'full-thinking', messageId: payload.message?.id || '', index, text: block.thinking || '', hidden: false })
      }
      if (block.type === 'redacted_thinking') {
        events.push({ type: 'full-thinking', messageId: payload.message?.id || '', index, text: '', hidden: true })
      }
      if (block.type === 'tool_use') events.push({ type: 'activity', activity: toolActivity(block) })
    }
    if (text) events.push({ type: 'full-text', text })
    const tokens = contextTokens(payload.message?.usage)
    if (tokens) events.push({ type: 'usage', tokens, estimated: false })
  }

  if (payload.type === 'user') {
    for (const block of payload.message?.content || []) {
      if (block.type === 'tool_result') {
        events.push({ type: 'activity-complete', id: block.tool_use_id, error: Boolean(block.is_error) })
      }
    }
  }

  if (payload.type === 'result') {
    // Result usage is the total for a whole Claude Code run. Compatible gateways
    // often aggregate several internal turns here, so it must never be presented
    // as the current model-context size.
    const cumulativeTokens = contextTokens(payload.usage)
    events.push({
      type: 'result',
      text: typeof payload.result === 'string' ? payload.result : '',
      valueType: valueType(payload.result),
      error: Boolean(payload.is_error),
      errorMessage: payload.error || payload.result || '',
      permissionDenials: Array.isArray(payload.permission_denials) ? payload.permission_denials : [],
      contextWindow: contextWindow(payload.modelUsage),
      cumulativeTokens,
    })
  }

  return events
}

export function mergeActivity(activities, incoming) {
  const existing = activities.find((item) => item.id === incoming.id)
  if (existing) {
    Object.assign(existing, incoming)
    return existing
  }
  activities.push(incoming)
  return incoming
}
