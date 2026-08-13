import { describe, expect, it } from 'vitest'
import { normalizeLanguage, translate, translateActivity } from './i18n'

describe('interface translations', () => {
  it('falls back to English and interpolates values', () => {
    expect(normalizeLanguage('unknown')).toBe('en')
    expect(translate('en', 'workspace.startBody', { project: 'demo' })).toBe('Ask Claude to work in demo.')
  })

  it('translates Chinese interface and activity labels without changing paths', () => {
    expect(translate('zh-CN', 'sidebar.projects')).toBe('项目')
    expect(translateActivity('zh-CN', 'Reading /tmp/report.md')).toBe('正在读取 /tmp/report.md')
  })

  it('uses native file manager, terminal, device, and shortcut labels', () => {
    expect(translate('zh-CN', 'sidebar.reveal', {}, 'macos')).toBe('在访达中显示')
    expect(translate('zh-CN', 'sidebar.reveal', {}, 'windows')).toBe('在文件资源管理器中显示')
    expect(translate('en', 'workspace.openTerminal', {}, 'windows')).toBe('Open in terminal')
    expect(translate('zh-CN', 'home.localNote', {}, 'windows')).toContain('这台电脑')
    expect(translate('zh-CN', 'workspace.notFoundBody', { command: 'claude' }, 'windows')).toContain('Windows 环境')
    expect(translate('en', 'workspace.filesShortcut', {}, 'macos')).toContain('⌘P')
    expect(translate('en', 'workspace.filesShortcut', {}, 'windows')).toContain('Ctrl+P')
  })
})
