const SERVICE_REQUESTS = [
  /(?:启动|重启|运行).{0,16}(?:前端|后端|服务|工程|项目|开发环境)/,
  /(?:前端|后端|服务|工程|项目).{0,16}(?:启动|重启|运行)/,
  /\b(?:pnpm|npm|yarn|bun)\s+(?:run\s+)?dev\b/i,
  /\bspring-boot:run\b/i,
  /\b(?:start|restart|run|serve)\b.{0,40}\b(?:server|frontend|backend|dev server|development server)\b/i,
]

export function requestsPersistentService(prompt = '') {
  return SERVICE_REQUESTS.some((pattern) => pattern.test(prompt))
}

export function withRuntimeGuidance(prompt = '') {
  if (!requestsPersistentService(prompt)) return prompt
  return `${prompt.trim()}\n\nClaude Desk runtime requirement: If you actually start a local development service that must remain reachable after this reply, detach it from the Claude Code process using the native mechanism for the current operating system. On macOS use a user launchd job; on Windows use a detached PowerShell Start-Process invocation with explicit stdout/stderr log files. Preserve PATH or use absolute executable paths, record the label or PID, and verify the configured port or health endpoint after startup. Do not claim the service is started unless verification passes. Tell the user the exact command needed to stop it.`
}
