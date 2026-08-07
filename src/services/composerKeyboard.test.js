import { describe, expect, it } from 'vitest'
import { COMPOSITION_CONFIRM_GUARD_MS, shouldSubmitComposer } from './composerKeyboard'

const state = (overrides = {}) => ({ composing: false, compositionEndedAt: -Infinity, ...overrides })
const enter = (overrides = {}) => ({ key: 'Enter', shiftKey: false, isComposing: false, keyCode: 13, ...overrides })

describe('composer keyboard submission', () => {
  it('submits plain Enter but preserves Shift+Enter', () => {
    expect(shouldSubmitComposer(enter(), state(), 1000)).toBe(true)
    expect(shouldSubmitComposer(enter({ shiftKey: true }), state(), 1000)).toBe(false)
  })

  it('never submits while an IME composition is active', () => {
    expect(shouldSubmitComposer(enter({ isComposing: true }), state(), 1000)).toBe(false)
    expect(shouldSubmitComposer(enter(), state({ composing: true }), 1000)).toBe(false)
    expect(shouldSubmitComposer(enter({ keyCode: 229 }), state(), 1000)).toBe(false)
  })

  it('ignores the Enter that immediately confirms a composition', () => {
    const endedAt = 1000
    expect(shouldSubmitComposer(enter(), state({ compositionEndedAt: endedAt }), endedAt + 1)).toBe(false)
    expect(shouldSubmitComposer(enter(), state({ compositionEndedAt: endedAt }), endedAt + COMPOSITION_CONFIRM_GUARD_MS + 1)).toBe(true)
  })
})
