export const DEFAULT_BOTTOM_THRESHOLD = 72

export function isNearConversationBottom(viewport, threshold = DEFAULT_BOTTOM_THRESHOLD) {
  if (!viewport) return true

  const distance = viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop
  return distance <= Math.max(0, threshold)
}

export function createConversationScrollFollower() {
  let following = true

  return {
    get following() { return following },
    pause() { following = false },
    resume() { following = true },
  }
}
