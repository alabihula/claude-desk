// @vitest-environment happy-dom
import { createApp, h, nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useWorkspaceStore } from '../../stores/workspace'
import ToolPermissionModal from './ToolPermissionModal.vue'

let app
let root
let store

beforeEach(() => {
  const pinia = createPinia()
  setActivePinia(pinia)
  store = useWorkspaceStore()
  store.conversations = [{ id: 'conversation-1', title: 'MCP setup' }]
  store.permissionRequests = [{
    requestId: 'permission-1', conversationId: 'conversation-1', runId: 'run-1',
    toolName: 'mcp__github__create_issue', server: 'github', action: 'create_issue', isMcp: true,
    description: 'Create an issue', input: { title: 'Bug' }, responding: false,
  }]
  store.respondPermission = vi.fn()
  root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp({ render: () => h(ToolPermissionModal) })
  app.use(pinia)
  app.mount(root)
})

afterEach(() => {
  app.unmount()
  document.body.innerHTML = ''
})

describe('ToolPermissionModal', () => {
  it('shows MCP server, tool arguments, and the originating conversation', () => {
    expect(root.querySelector('.tool-permission-modal')?.textContent).toContain('MCP tool')
    expect(root.querySelector('.tool-permission-modal')?.textContent).toContain('github')
    expect(root.querySelector('.tool-permission-modal')?.textContent).toContain('create_issue')
    expect(root.querySelector('.tool-permission-modal')?.textContent).toContain('MCP setup')
    expect(root.querySelector('.permission-arguments pre')?.textContent).toContain('"title": "Bug"')
  })

  it('requires an explicit allow or deny decision', async () => {
    root.querySelector('.modal-backdrop').click()
    await nextTick()
    expect(store.activePermissionRequest).not.toBeNull()

    root.querySelector('.permission-allow').click()
    expect(store.respondPermission).toHaveBeenCalledWith('permission-1', 'allowOnce')
    root.querySelector('.permission-deny').click()
    expect(store.respondPermission).toHaveBeenCalledWith('permission-1', 'deny')
  })

  it('offers scoped persistent MCP choices and defaults to the exact project tool', async () => {
    root.querySelector('.permission-always-toggle').click()
    await nextTick()

    const menu = root.querySelector('.permission-always-menu')
    expect(menu?.textContent).toContain('Always allow this tool in this project')
    expect(menu?.textContent).toContain('Recommended')
    expect(menu?.textContent).toContain('all projects')
    expect(menu?.textContent).toContain('every tool from github')

    menu.querySelector('[data-decision="allowProjectTool"]').click()
    expect(store.respondPermission).toHaveBeenCalledWith('permission-1', 'allowProjectTool')
    await nextTick()
    expect(root.querySelector('.permission-always-menu')).toBeNull()
  })

  it('does not offer broad persistent approval for non-MCP tools', async () => {
    store.permissionRequests[0].isMcp = false
    store.permissionRequests[0].toolName = 'Bash'
    await nextTick()
    expect(root.querySelector('.permission-always-toggle')).toBeNull()
  })
})
