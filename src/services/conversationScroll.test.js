import { describe, expect, it } from 'vitest'
import { createConversationScrollFollower, isNearConversationBottom } from './conversationScroll'

describe('isNearConversationBottom', () => {
  it('keeps following while the viewport is at the bottom', () => {
    expect(isNearConversationBottom({ scrollHeight: 1000, clientHeight: 400, scrollTop: 600 })).toBe(true)
  })

  it('allows a small distance from the bottom for trackpad movement', () => {
    expect(isNearConversationBottom({ scrollHeight: 1000, clientHeight: 400, scrollTop: 540 })).toBe(true)
  })

  it('stops following after the user scrolls into conversation history', () => {
    expect(isNearConversationBottom({ scrollHeight: 1000, clientHeight: 400, scrollTop: 300 })).toBe(false)
  })

  it('treats a non-scrollable conversation as being at the bottom', () => {
    expect(isNearConversationBottom({ scrollHeight: 300, clientHeight: 500, scrollTop: 0 })).toBe(true)
  })
})

describe('createConversationScrollFollower', () => {
  it('supports explicit pause and resume for navigation and new prompts', () => {
    const follower = createConversationScrollFollower()

    follower.pause()
    expect(follower.following).toBe(false)
    follower.resume()
    expect(follower.following).toBe(true)
  })
})
