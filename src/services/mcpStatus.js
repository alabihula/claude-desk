// A health probe, an init snapshot and live discovery are different evidence.
export function mcpRows(configured, runtime) {
  const names = new Set([...configured.map((s) => s.name), ...(runtime?.servers || []).map((s) => s.name)])
  return [...names].map((name) => {
    const config = configured.find((s) => s.name === name)
    const current = runtime?.servers?.find((s) => s.name === name)
    let state = 'unconfirmed'
    if (runtime?.source === 'live' && current) {
      if (/fail|disconnect|error/.test(current.status)) state = 'failed'
      else if (/auth/.test(current.status)) state = 'authRequired'
      else if (current.status === 'disabled') state = 'disabled'
      else if (current.status === 'pending') state = 'loading'
      else if (current.status === 'connected' && current.toolCount > 0) state = 'ready'
      else if (current.status === 'connected' && current.toolCount === 0) state = 'empty'
    }
    const message = current?.message || config?.message || ''
    return { ...config, name, configured: Boolean(config), current, state, issue: mcpIssue(message, config?.detail), message: safeMcpDetail(message), detail: safeMcpDetail(config?.detail), checkStatus: config?.status || 'unknown' }
  })
}

export function mcpIssue(message = '', command = '') {
  if (/timed?\s*out|timeout|ETIMEDOUT/i.test(message)) return /\bnpx(?:\.cmd)?\b/i.test(command) ? 'npxTimeout' : 'timeout'
  if (/ENOENT|not found|not recognized|找不到/i.test(message)) return 'command'
  if (/401|403|auth|credential|login/i.test(message)) return 'auth'
  if (/ENOTFOUND|ECONNREFUSED|network|fetch|registry/i.test(message)) return 'network'
  return 'unknown'
}

export function safeMcpDetail(value = '') {
  return String(value || '')
    .replace(/(Bearer\s+)[^\s"']+/gi, '$1[redacted]')
    .replace(/((?:[\w-]*(?:token|secret|password|api[_-]?key)[\w-]*|authorization)["']?\s*[:=]\s*["']?)[^\s"',;]+/gi, '$1[redacted]')
    .replace(/(--(?:token|secret|password|api-key)\s+)[^\s]+/gi, '$1[redacted]')
    .replace(/https?:\/\/[^\s/@]+:[^\s/@]+@/gi, 'https://[redacted]@')
    .slice(0, 1200)
}
