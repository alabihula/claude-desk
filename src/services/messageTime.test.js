import { describe, expect, it } from 'vitest'
import { formatMessageTime } from './messageTime'

describe('formatMessageTime', () => {
  it('formats a local message time without seconds', () => {
    const value = new Date(2026, 7, 18, 15, 5).toISOString()
    expect(formatMessageTime(value, 'zh-CN')).toBe('15:05')
  })

  it('does not render missing or invalid timestamps', () => {
    expect(formatMessageTime('')).toBe('')
    expect(formatMessageTime('not-a-date')).toBe('')
  })
})
