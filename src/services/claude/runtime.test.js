import { describe, expect, it } from 'vitest'
import { requestsPersistentService, withRuntimeGuidance } from './runtime'

describe('persistent service runtime guidance', () => {
  it('keeps ordinary requests free of service-start guidance', () => {
    const prompt = withRuntimeGuidance('解释这段组件代码')
    expect(prompt).toContain('解释这段组件代码')
    expect(prompt).toContain('Never create download links')
    expect(prompt).not.toContain('launchd')
    expect(requestsPersistentService('新建一个 class-css 分支')).toBe(false)
  })

  it('adds a cross-platform persistence contract to service-start requests', () => {
    const prompt = withRuntimeGuidance('帮我启动这个工程的前端和后端服务')
    expect(prompt).toContain('launchd')
    expect(prompt).toContain('PowerShell Start-Process')
    expect(prompt).toContain('configured port or health endpoint')
    expect(requestsPersistentService('cd frontend && pnpm dev')).toBe(true)
  })

  it('defines an explicit Markdown contract for downloadable deliverables', () => {
    const prompt = withRuntimeGuidance('帮我生成一份 Excel 报告')
    expect(prompt).toContain('[下载报告](./exports/report.xlsx)')
    expect(prompt).toContain('initial project working directory')
    expect(prompt).toContain('Verify that exact linked path exists')
    expect(prompt).toContain('merely read, referenced, or edited')
  })
})
