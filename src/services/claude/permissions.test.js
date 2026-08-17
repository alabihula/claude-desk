import { describe, expect, it } from 'vitest'
import {
  normalizePermissionRequest,
  permissionInputPreview,
  permissionPersistenceChoices,
  permissionToolDetails,
} from './permissions'

describe('Claude tool permissions', () => {
  it('separates an MCP tool into server and action labels', () => {
    expect(permissionToolDetails('mcp__github__create_issue')).toEqual({
      isMcp: true,
      server: 'github',
      action: 'create_issue',
    })
  })

  it('normalizes a request with the run identity needed for a safe response', () => {
    expect(normalizePermissionRequest({
      requestId: 'permission-1',
      toolName: 'Bash',
      input: { command: 'pnpm test' },
    }, 'conversation-1', 'run-1')).toMatchObject({
      requestId: 'permission-1',
      conversationId: 'conversation-1',
      runId: 'run-1',
      action: 'Bash',
      isMcp: false,
      responding: false,
    })
  })

  it('rejects incomplete events and bounds large argument previews', () => {
    expect(normalizePermissionRequest({}, 'conversation-1', 'run-1')).toBeNull()
    expect(permissionInputPreview({ content: 'x'.repeat(7000) })).toMatch(/…$/)
  })

  it('offers persistent scopes only for MCP tools and recommends the exact project tool', () => {
    const choices = permissionPersistenceChoices({ isMcp: true })
    expect(choices.map((choice) => choice.decision)).toEqual([
      'allowProjectTool',
      'allowSessionTool',
      'allowUserTool',
      'allowProjectServer',
    ])
    expect(choices[0].recommended).toBe(true)
    expect(permissionPersistenceChoices({ isMcp: false })).toEqual([])
  })
})
