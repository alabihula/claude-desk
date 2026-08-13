import { describe, expect, it } from 'vitest'
import {
  detectPlatform,
  isPrimaryShortcut,
  platformShortcut,
  platformProfile,
  platformTranslation,
} from './platform'

describe('desktop platform profile', () => {
  it('detects macOS and Windows webviews without relying on one navigator field', () => {
    expect(detectPlatform({ platform: 'MacIntel' })).toBe('macos')
    expect(detectPlatform({ userAgentData: { platform: 'Windows' } })).toBe('windows')
    expect(detectPlatform({ userAgent: 'X11; Linux x86_64' })).toBe('other')
  })

  it('maps native file manager labels and shortcut modifiers', () => {
    expect(platformTranslation('sidebar.reveal', 'macos')).toBe('platform.macos.showInFileManager')
    expect(platformTranslation('sidebar.reveal', 'windows')).toBe('platform.windows.showInFileManager')
    expect(platformShortcut('p', 'macos')).toBe('⌘P')
    expect(platformShortcut('p', 'windows')).toBe('Ctrl+P')
    expect(platformProfile('windows').contextMenuWidth).toBeGreaterThan(platformProfile('macos').contextMenuWidth)
  })

  it('uses Command on macOS and Control on Windows', () => {
    expect(isPrimaryShortcut({ metaKey: true }, 'macos')).toBe(true)
    expect(isPrimaryShortcut({ ctrlKey: true }, 'macos')).toBe(false)
    expect(isPrimaryShortcut({ ctrlKey: true }, 'windows')).toBe(true)
    expect(isPrimaryShortcut({ metaKey: true }, 'windows')).toBe(false)
  })
})
