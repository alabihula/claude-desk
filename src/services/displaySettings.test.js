import { describe, expect, it } from 'vitest'
import { applyDisplaySettings, normalizeConversationDensity } from './displaySettings'

describe('display settings', () => {
  it('normalizes unknown density values to the comfortable default', () => {
    expect(normalizeConversationDensity('compact')).toBe('compact')
    expect(normalizeConversationDensity('comfortable')).toBe('comfortable')
    expect(normalizeConversationDensity('dense')).toBe('comfortable')
  })

  it('applies theme and density to the supplied root element', () => {
    const root = { dataset: {} }
    applyDisplaySettings({ theme: 'dark', conversationDensity: 'compact' }, root)
    expect(root.dataset).toEqual({ theme: 'dark', density: 'compact' })
  })
})
