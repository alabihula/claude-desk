export const PLATFORM_PROFILES = {
  macos: {
    id: 'macos',
    contextMenuWidth: 188,
    primaryModifier: 'metaKey',
    primaryModifierLabel: '⌘',
    translations: {
      'common.showInFileManager': 'platform.macos.showInFileManager',
      'sidebar.reveal': 'platform.macos.showInFileManager',
      'sidebar.terminal': 'platform.macos.openTerminal',
      'home.localNote': 'platform.macos.localNote',
      'workspace.openTerminal': 'platform.macos.openTerminal',
      'workspace.notFoundBody': 'platform.macos.notFoundBody',
      'message.reveal': 'platform.macos.revealAttachment',
    },
  },
  windows: {
    id: 'windows',
    contextMenuWidth: 224,
    primaryModifier: 'ctrlKey',
    primaryModifierLabel: 'Ctrl+',
    translations: {
      'common.showInFileManager': 'platform.windows.showInFileManager',
      'sidebar.reveal': 'platform.windows.showInFileManager',
      'sidebar.terminal': 'platform.windows.openTerminal',
      'home.localNote': 'platform.windows.localNote',
      'workspace.openTerminal': 'platform.windows.openTerminal',
      'workspace.notFoundBody': 'platform.windows.notFoundBody',
      'message.reveal': 'platform.windows.revealAttachment',
    },
  },
  other: {
    id: 'other',
    contextMenuWidth: 208,
    primaryModifier: 'ctrlKey',
    primaryModifierLabel: 'Ctrl+',
    translations: {
      'common.showInFileManager': 'platform.other.showInFileManager',
      'sidebar.reveal': 'platform.other.showInFileManager',
      'sidebar.terminal': 'platform.other.openTerminal',
      'home.localNote': 'platform.other.localNote',
      'workspace.openTerminal': 'platform.other.openTerminal',
      'workspace.notFoundBody': 'platform.other.notFoundBody',
      'message.reveal': 'platform.other.revealAttachment',
    },
  },
}

export function detectPlatform(navigatorLike = globalThis.navigator) {
  const value = [
    navigatorLike?.userAgentData?.platform,
    navigatorLike?.platform,
    navigatorLike?.userAgent,
  ].filter(Boolean).join(' ')
  if (/windows|win32/i.test(value)) return 'windows'
  if (/macintosh|macintel|mac os/i.test(value)) return 'macos'
  return 'other'
}

export const currentPlatform = detectPlatform()

export function platformProfile(platform = currentPlatform) {
  return PLATFORM_PROFILES[platform] || PLATFORM_PROFILES.other
}

export function platformTranslation(key, platform = currentPlatform) {
  return platformProfile(platform).translations[key] || key
}

export function platformShortcut(key, platform = currentPlatform) {
  return `${platformProfile(platform).primaryModifierLabel}${key.toUpperCase()}`
}

export function isPrimaryShortcut(event, platform = currentPlatform) {
  const profile = platformProfile(platform)
  return Boolean(event?.[profile.primaryModifier])
}
