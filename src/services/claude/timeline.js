import { mergeActivity } from './parser'

function ensureTimeline(run) {
  run.timeline ||= []
  run.streamBlocks ||= {}
  run.timelineSequence ||= 0
}

function nextMessageId(run) {
  run.timelineSequence += 1
  return `stream-${run.timelineSequence}`
}

function completeOpenBlocks(run) {
  for (const id of Object.values(run.streamBlocks)) {
    const entry = run.timeline.find((item) => item.id === id)
    if (entry) entry.status = 'complete'
  }
  run.streamBlocks = {}
}

function thinkingEntry(run, event) {
  ensureTimeline(run)
  const index = Number(event.index || 0)
  if (!event.messageId && !run.streamMessageId) run.streamMessageId = nextMessageId(run)
  const messageId = event.messageId || run.streamMessageId
  const id = `thinking:${messageId}:${index}`
  let entry = run.timeline.find((item) => item.id === id)
  if (!entry) {
    entry = { id, type: 'thinking', text: '', hidden: Boolean(event.hidden), status: 'running' }
    run.timeline.push(entry)
  }
  if (!event.messageId) run.streamBlocks[index] = id
  return entry
}

export function applyRunTimelineEvent(run, event) {
  ensureTimeline(run)

  if (event.type === 'message-start') {
    completeOpenBlocks(run)
    run.streamMessageId = event.messageId || nextMessageId(run)
    return true
  }
  if (event.type === 'thinking-start') {
    thinkingEntry(run, event)
    return true
  }
  if (event.type === 'thinking') {
    const entry = thinkingEntry(run, event)
    entry.text += event.text
    entry.hidden = false
    return true
  }
  if (event.type === 'full-thinking') {
    const entry = thinkingEntry(run, event)
    if (event.text) entry.text = event.text
    entry.hidden = Boolean(event.hidden && !entry.text)
    entry.status = 'complete'
    return true
  }
  if (event.type === 'block-complete') {
    const id = run.streamBlocks[Number(event.index || 0)]
    const entry = run.timeline.find((item) => item.id === id)
    if (entry) entry.status = 'complete'
    delete run.streamBlocks[Number(event.index || 0)]
    return Boolean(entry)
  }
  if (event.type === 'activity') {
    const activity = mergeActivity(run.activities, event.activity)
    if (!run.timeline.some((item) => item.id === `activity:${activity.id}`)) {
      run.timeline.push({ id: `activity:${activity.id}`, type: 'activity', activity })
    }
    return true
  }
  if (event.type === 'activity-complete') {
    const activity = run.activities.find((item) => item.id === event.id)
    if (activity) activity.status = event.error ? 'error' : 'success'
    return true
  }
  return false
}
