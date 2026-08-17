const MAX_INPUT_PREVIEW = 6000

export const permissionDecisions = Object.freeze({
  deny: 'deny',
  allowOnce: 'allowOnce',
  allowSessionTool: 'allowSessionTool',
  allowProjectTool: 'allowProjectTool',
  allowProjectServer: 'allowProjectServer',
  allowUserTool: 'allowUserTool',
})

export function permissionPersistenceChoices(request) {
  if (!request?.isMcp) return []
  return [
    {
      decision: permissionDecisions.allowProjectTool,
      titleKey: 'toolPermission.projectTool',
      descriptionKey: 'toolPermission.projectToolDescription',
      recommended: true,
    },
    {
      decision: permissionDecisions.allowSessionTool,
      titleKey: 'toolPermission.sessionTool',
      descriptionKey: 'toolPermission.sessionToolDescription',
    },
    {
      decision: permissionDecisions.allowUserTool,
      titleKey: 'toolPermission.userTool',
      descriptionKey: 'toolPermission.userToolDescription',
      risk: true,
    },
    {
      decision: permissionDecisions.allowProjectServer,
      titleKey: 'toolPermission.projectServer',
      descriptionKey: 'toolPermission.projectServerDescription',
      risk: true,
    },
  ]
}

export function permissionToolDetails(toolName, displayName = '') {
  const name = String(toolName || 'Tool')
  if (!name.startsWith('mcp__')) {
    return { isMcp: false, server: '', action: displayName || name }
  }
  const [, server = '', ...actionParts] = name.split('__')
  return {
    isMcp: true,
    server,
    action: displayName || actionParts.join('__') || name,
  }
}

export function normalizePermissionRequest(data, conversationId, runId) {
  const requestId = String(data?.requestId || '')
  if (!requestId || !conversationId || !runId) return null
  const toolName = String(data?.toolName || 'Tool')
  const input = data?.input && typeof data.input === 'object' ? data.input : {}
  return {
    requestId,
    conversationId,
    runId,
    toolName,
    displayName: String(data?.displayName || ''),
    description: String(data?.description || ''),
    toolUseId: String(data?.toolUseId || ''),
    input,
    ...permissionToolDetails(toolName, data?.displayName),
    responding: false,
  }
}

export function permissionInputPreview(input) {
  let value
  try { value = JSON.stringify(input || {}, null, 2) }
  catch { value = String(input || '') }
  return value.length > MAX_INPUT_PREVIEW ? `${value.slice(0, MAX_INPUT_PREVIEW)}\n…` : value
}
