import { describe, expect, it } from 'vitest'
import { requestsPersistentService, withRuntimeGuidance } from './runtime'

describe('persistent service runtime guidance', () => {
  it('leaves ordinary requests unchanged', () => {
    expect(withRuntimeGuidance('解释这段组件代码')).toBe('解释这段组件代码')
    expect(requestsPersistentService('新建一个 class-css 分支')).toBe(false)
  })

  it('adds a macOS persistence contract to service-start requests', () => {
    const prompt = withRuntimeGuidance('帮我启动这个工程的前端和后端服务')
    expect(prompt).toContain('launchctl submit')
    expect(prompt).toContain('configured port or health endpoint')
    expect(requestsPersistentService('cd frontend && pnpm dev')).toBe(true)
  })
})
