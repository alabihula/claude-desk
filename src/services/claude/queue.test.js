import { describe, expect, it } from 'vitest'
import { createQueuedMessage, prioritizeQueuedMessage, resetQueuedMessage, takeNextQueuedMessage } from './queue'

const conversation = { id: 'conversation-1', claudeSessionId: 'session-1' }
const project = { id: 'project-1', path: '/tmp/project' }

function queued(id, content = id) {
  return createQueuedMessage({ id, conversation, project, content, attachments: [], createdAt: 'now' })
}

describe('Claude supplemental message queue', () => {
  it('captures the conversation and project needed for background dispatch', () => {
    expect(queued('one', '  补充内容  ')).toMatchObject({
      id: 'one',
      conversationId: 'conversation-1',
      sessionId: 'session-1',
      projectId: 'project-1',
      projectPath: '/tmp/project',
      content: '补充内容',
      status: 'queued',
    })
  })

  it('moves the selected message to the front for immediate steering', () => {
    const result = prioritizeQueuedMessage([queued('one'), queued('two'), queued('three')], 'two')
    expect(result.map(({ id, status }) => ({ id, status }))).toEqual([
      { id: 'two', status: 'steering' },
      { id: 'one', status: 'queued' },
      { id: 'three', status: 'queued' },
    ])
  })

  it('does not mutate the queue for an unknown message', () => {
    const messages = [queued('one')]
    expect(prioritizeQueuedMessage(messages, 'missing')).toBe(messages)
  })

  it('can recover a steering message and dequeue in FIFO order', () => {
    const prioritized = prioritizeQueuedMessage([queued('one'), queued('two')], 'two')
    expect(resetQueuedMessage(prioritized, 'two')[0].status).toBe('queued')
    const [next, rest] = takeNextQueuedMessage(prioritized)
    expect(next.id).toBe('two')
    expect(rest.map((item) => item.id)).toEqual(['one'])
  })
})
