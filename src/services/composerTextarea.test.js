import { describe, expect, it } from 'vitest'
import { resizeComposerTextarea } from './composerTextarea'

function textarea(scrollHeight) {
  return { scrollHeight, style: {} }
}

describe('composer textarea sizing', () => {
  it('keeps the minimum height for short input', () => {
    const element = textarea(24)
    expect(resizeComposerTextarea(element)).toBe(52)
    expect(element.style).toMatchObject({ height: '52px', overflowY: 'hidden' })
  })

  it('grows with content and scrolls after the maximum height', () => {
    const growing = textarea(120)
    const overflowing = textarea(240)
    expect(resizeComposerTextarea(growing)).toBe(120)
    expect(growing.style.overflowY).toBe('hidden')
    expect(resizeComposerTextarea(overflowing)).toBe(180)
    expect(overflowing.style.overflowY).toBe('auto')
  })
})
