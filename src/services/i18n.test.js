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
})
