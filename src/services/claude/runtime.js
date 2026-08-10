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
  return `${prompt.trim()}\n\nClaude Desk runtime requirement: If you actually start a local development service that must remain reachable after this reply, do not use Claude Code's ordinary background task. On macOS, create a user launchd job with \`launchctl submit\` under a unique \`com.claude-desk.<project>.<service>\` label. Give it explicit stdout/stderr log paths, preserve the current PATH (or use absolute executable paths), record the label and PID, and verify the configured port or health endpoint after startup. Do not claim the service is started unless that verification passes. Tell the user the exact \`launchctl remove <label>\` command to stop it.`
}
