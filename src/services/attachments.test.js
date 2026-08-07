import { describe, expect, it } from 'vitest'
import { attachmentPrompt, messageWithAttachmentNames } from './attachments'

const attachments = [{ name: 'screen.png', path: '/tmp/screen.png' }, { name: 'trace.log', path: '/tmp/trace.log' }]

describe('attachment formatting', () => {
  it('passes real local paths to Claude', () => {
    expect(attachmentPrompt('Inspect this', attachments)).toContain('/tmp/screen.png')
    expect(attachmentPrompt('Inspect this', attachments)).toContain('/tmp/trace.log')
  })

  it('keeps persisted chat content readable', () => {
    expect(messageWithAttachmentNames('Inspect this', attachments)).toBe('Inspect this\n\n📎 screen.png\n📎 trace.log')
  })

  it('does not add an attachment section for an empty list', () => {
    expect(attachmentPrompt('Hello', [])).toBe('Hello')
  })
})
