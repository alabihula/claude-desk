import { describe, expect, it } from 'vitest'
import { attachmentPrompt, attachmentTypeLabel, copyAttachmentPaths, messageWithAttachmentNames } from './attachments'

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

describe('attachment intake', () => {
  it('copies unique paths into the conversation in drop order', async () => {
    const copy = async (conversationId, path) => ({ id: path, conversationId, path })

    await expect(copyAttachmentPaths(['/tmp/a.md', '/tmp/a.md', '/tmp/b.png'], 'conversation-1', copy)).resolves.toEqual({
      attachments: [
        { id: '/tmp/a.md', conversationId: 'conversation-1', path: '/tmp/a.md' },
        { id: '/tmp/b.png', conversationId: 'conversation-1', path: '/tmp/b.png' },
      ],
      errors: [],
    })
  })

  it('keeps valid files when one dropped path cannot be copied', async () => {
    const copy = async (_, path) => {
      if (path.endsWith('folder')) throw new Error('Attachment is not a readable file')
      return { id: path, path }
    }

    const result = await copyAttachmentPaths(['/tmp/folder', '/tmp/notes.md'], 'conversation-1', copy)

    expect(result.attachments).toEqual([{ id: '/tmp/notes.md', path: '/tmp/notes.md' }])
    expect(result.errors).toEqual([{ path: '/tmp/folder', error: 'Error: Attachment is not a readable file' }])
  })

  it('provides a compact type label for attachment cards', () => {
    expect(attachmentTypeLabel({ name: 'Product-AI-use-case.md', kind: 'file' })).toBe('MD')
    expect(attachmentTypeLabel({ name: 'Makefile', kind: 'file' })).toBe('FILE')
  })
})
