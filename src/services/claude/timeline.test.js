import { describe, expect, it } from 'vitest'
import { applyRunTimelineEvent } from './timeline'

function run() {
  return { activities: [], timeline: [], streamBlocks: {}, streamMessageId: '', timelineSequence: 0 }
}

describe('run timeline', () => {
  it('interleaves thinking summaries and tool activity without duplicating completed blocks', () => {
    const current = run()
    applyRunTimelineEvent(current, { type: 'message-start', messageId: 'message-1' })
    applyRunTimelineEvent(current, { type: 'thinking-start', index: 0 })
    applyRunTimelineEvent(current, { type: 'thinking', index: 0, text: 'Inspect ' })
    applyRunTimelineEvent(current, { type: 'thinking', index: 0, text: 'the project.' })
    applyRunTimelineEvent(current, { type: 'block-complete', index: 0 })
    applyRunTimelineEvent(current, { type: 'activity', activity: { id: 'tool-1', label: 'Reading src/App.vue', status: 'running' } })
    applyRunTimelineEvent(current, { type: 'full-thinking', messageId: 'message-1', index: 0, text: 'Inspect the project.', hidden: false })
    applyRunTimelineEvent(current, { type: 'activity-complete', id: 'tool-1', error: false })

    expect(current.timeline.map((item) => item.type)).toEqual(['thinking', 'activity'])
    expect(current.timeline[0]).toMatchObject({ text: 'Inspect the project.', status: 'complete' })
    expect(current.timeline[1].activity.status).toBe('success')
  })

  it('keeps redacted thinking as a visible placeholder', () => {
    const current = run()
    applyRunTimelineEvent(current, { type: 'message-start', messageId: 'message-2' })
    applyRunTimelineEvent(current, { type: 'thinking-start', index: 0, hidden: true })
    applyRunTimelineEvent(current, { type: 'block-complete', index: 0 })

    expect(current.timeline[0]).toMatchObject({ type: 'thinking', text: '', hidden: true, status: 'complete' })
  })
})
