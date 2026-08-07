export const COMPOSITION_CONFIRM_GUARD_MS = 120

export function shouldSubmitComposer(event, state, now = performance.now()) {
  if (event.key !== 'Enter' || event.shiftKey) return false
  if (event.isComposing || event.keyCode === 229 || state.composing) return false
  return now - state.compositionEndedAt > COMPOSITION_CONFIRM_GUARD_MS
}
