export function normalizeConversationDensity(value) {
  return value === 'compact' ? 'compact' : 'comfortable'
}

export function applyDisplaySettings(settings = {}, root = document.documentElement) {
  root.dataset.theme = settings.theme || 'system'
  root.dataset.density = normalizeConversationDensity(settings.conversationDensity)
}
