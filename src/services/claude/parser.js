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

export function parseClaudeEvent(payload) {
  if (!payload || typeof payload !== 'object') return []
  const events = []

  if (payload.type === 'system' && payload.subtype === 'init') {
    events.push({ type: 'session', sessionId: payload.session_id })
  }

  if (payload.type === 'stream_event') {
    const event = payload.event || {}
    if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
      events.push({ type: 'text', text: event.delta.text || '' })
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
    if (text) events.push({ type: 'full-text', text })
    for (const block of blocks.filter((item) => item.type === 'tool_use')) {
      events.push({ type: 'activity', activity: toolActivity(block) })
    }
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
    // Some compatible gateways omit assistant-level usage. The result total is a
    // useful fallback, but can include multiple internal model turns.
    const tokens = contextTokens(payload.usage)
    events.push({
      type: 'result',
      text: typeof payload.result === 'string' ? payload.result : '',
      error: Boolean(payload.is_error),
      errorMessage: payload.error || payload.result || '',
      permissionDenials: Array.isArray(payload.permission_denials) ? payload.permission_denials : [],
      contextWindow: contextWindow(payload.modelUsage),
      tokens,
    })
  }

  return events
}

export function mergeActivity(activities, incoming) {
  const existing = activities.find((item) => item.id === incoming.id)
  if (existing) Object.assign(existing, incoming)
  else activities.push(incoming)
}
