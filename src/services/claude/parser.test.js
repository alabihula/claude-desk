import { describe, expect, it } from 'vitest'
import { mergeActivity, parseClaudeEvent } from './parser'

describe('parseClaudeEvent', () => {
  it('parses incremental assistant text without exposing raw JSON', () => {
    const events = parseClaudeEvent({
      type: 'stream_event',
      event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello' } },
    })
    expect(events).toEqual([{ type: 'text', text: 'Hello' }])
  })

  it('parses streamed and completed thinking summaries separately from final text', () => {
    expect(parseClaudeEvent({
      type: 'stream_event',
      event: { type: 'content_block_start', index: 0, content_block: { type: 'thinking' } },
    })).toEqual([{ type: 'thinking-start', index: 0, hidden: false }])
    expect(parseClaudeEvent({
      type: 'stream_event',
      event: { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Inspect the project.' } },
    })).toEqual([{ type: 'thinking', index: 0, text: 'Inspect the project.' }])

    const events = parseClaudeEvent({
      type: 'assistant',
      message: { id: 'message-1', content: [{ type: 'thinking', thinking: 'Inspect the project.' }, { type: 'text', text: 'Done.' }] },
    })
    expect(events).toContainEqual({ type: 'full-thinking', messageId: 'message-1', index: 0, text: 'Inspect the project.', hidden: false })
    expect(events).toContainEqual({ type: 'full-text', text: 'Done.' })
  })

  it('turns tool use and result events into readable activity state', () => {
    const start = parseClaudeEvent({
      type: 'stream_event',
      event: { type: 'content_block_start', content_block: { type: 'tool_use', id: 'tool-1', name: 'Read', input: { file_path: 'src/App.vue' } } },
    })
    expect(start[0].activity).toMatchObject({ id: 'tool-1', label: 'Reading src/App.vue', status: 'running' })

    const complete = parseClaudeEvent({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tool-1' }] } })
    expect(complete).toEqual([{ type: 'activity-complete', id: 'tool-1', error: false }])
  })

  it('routes Task tools to structured task events instead of raw activity rows', () => {
    const [create] = parseClaudeEvent({
      type: 'assistant', message: { content: [{
        type: 'tool_use', id: 'create-1', name: 'TaskCreate',
        input: { subject: 'Compile changes', description: 'Run the build', activeForm: 'Compiling changes' },
      }] },
    })
    expect(create).toMatchObject({
      type: 'task-create', toolUseId: 'create-1', task: { subject: 'Compile changes', status: 'pending' },
    })

    const [result] = parseClaudeEvent({
      type: 'user', message: { content: [{
        type: 'tool_result', tool_use_id: 'create-1', content: '{"task":{"id":"1"}}',
      }] },
    })
    expect(result).toEqual({
      type: 'activity-complete', id: 'create-1', error: false, result: '{"task":{"id":"1"}}',
    })
  })

  it('recognizes successful and failed terminal results', () => {
    expect(parseClaudeEvent({ type: 'result', result: 'Done', is_error: false })[0]).toMatchObject({ type: 'result', text: 'Done', valueType: 'string', error: false })
    expect(parseClaudeEvent({ type: 'result', result: 'Failed', is_error: true })[0]).toMatchObject({ type: 'result', error: true })
    expect(parseClaudeEvent({ type: 'result', result: null, is_error: false })[0]).toMatchObject({ text: '', valueType: 'null' })
  })

  it('reports explicit context compaction success and failure', () => {
    expect(parseClaudeEvent({
      type: 'system', subtype: 'status', status: null, compact_result: 'success',
    })).toEqual([{ type: 'compact-result', success: true, error: '' }])
    expect(parseClaudeEvent({
      type: 'system', subtype: 'status', status: null, compact_result: 'failed', compact_error: 'Not enough messages to compact.',
    })).toEqual([{ type: 'compact-result', success: false, error: 'Not enough messages to compact.' }])
  })

  it('reports the MCP servers and tools loaded by the same Claude run', () => {
    const events = parseClaudeEvent({
      type: 'system',
      subtype: 'init',
      session_id: 'session-1',
      tools: ['Read', 'mcp__figma-mcp-front__get_design', 'mcp__codegraph__search', 'mcp__codegraph__read'],
      mcp_servers: [
        { name: 'figma-mcp-front', status: 'connected' },
        { name: 'codegraph', status: 'connected' },
        { name: 'unavailable', status: 'failed' },
      ],
    })

    expect(events).toContainEqual({
      type: 'mcp-runtime',
      runtime: {
        toolCount: 3,
        servers: [
          { name: 'figma-mcp-front', status: 'connected', toolCount: 1 },
          { name: 'codegraph', status: 'connected', toolCount: 2 },
          { name: 'unavailable', status: 'failed', toolCount: 0 },
        ],
      },
    })
  })

  it('surfaces permission denials for an actionable UI', () => {
    const [result] = parseClaudeEvent({ type: 'result', result: 'Blocked', permission_denials: [{ tool_name: 'Read' }] })
    expect(result.permissionDenials).toEqual([{ tool_name: 'Read' }])
  })

  it('reports current context usage and the model context window', () => {
    const assistant = parseClaudeEvent({
      type: 'assistant',
      message: { content: [], usage: { input_tokens: 100, cache_read_input_tokens: 800, output_tokens: 50 } },
    })
    expect(assistant).toContainEqual({ type: 'usage', tokens: 950, estimated: false })
    const [result] = parseClaudeEvent({
      type: 'result',
      usage: { input_tokens: 120, cache_read_input_tokens: 830, output_tokens: 50 },
      modelUsage: { model: { contextWindow: 200000 } },
    })
    expect(result.contextWindow).toBe(200000)
    expect(result.cumulativeTokens).toBe(1000)
  })
})

describe('mergeActivity', () => {
  it('does not duplicate repeated tool events', () => {
    const activities = [{ id: 'tool-1', label: 'Reading file', status: 'running' }]
    mergeActivity(activities, { id: 'tool-1', status: 'success' })
    expect(activities).toEqual([{ id: 'tool-1', label: 'Reading file', status: 'success' }])
  })
})
