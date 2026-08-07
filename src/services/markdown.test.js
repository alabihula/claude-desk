// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { codeCopyPayload, createMessageMarkdown, writeClipboardText } from './markdown'

describe('message markdown code blocks', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  it('adds an accessible copy control to fenced and indented code blocks', () => {
    const markdown = createMessageMarkdown()
    const fenced = markdown.render('```js\nconst answer = 42\n```')
    const indented = markdown.render('    plain text\n')

    expect(fenced).toContain('data-copy-code')
    expect(fenced).toContain('<span>JavaScript</span>')
    expect(indented).toContain('<span>Code</span>')
    expect(markdown.render('Use `inline` here')).not.toContain('data-copy-code')
  })

  it('extracts only the selected block text and copies it', async () => {
    document.body.innerHTML = createMessageMarkdown().render('```js\nconst safe = "<tag>"\n```')
    const payload = codeCopyPayload(document.querySelector('[data-copy-code]'))
    const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) }

    expect(payload.text).toBe('const safe = "<tag>"\n')
    await writeClipboardText(payload.text, clipboard)
    expect(clipboard.writeText).toHaveBeenCalledWith('const safe = "<tag>"\n')
  })
})
