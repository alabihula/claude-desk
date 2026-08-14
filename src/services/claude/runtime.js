const SERVICE_REQUESTS = [
  /(?:启动|重启|运行).{0,16}(?:前端|后端|服务|工程|项目|开发环境)/,
  /(?:前端|后端|服务|工程|项目).{0,16}(?:启动|重启|运行)/,
  /\b(?:pnpm|npm|yarn|bun)\s+(?:run\s+)?dev\b/i,
  /\bspring-boot:run\b/i,
  /\b(?:start|restart|run|serve)\b.{0,40}\b(?:server|frontend|backend|dev server|development server)\b/i,
]

const SERVICE_GUIDANCE = 'Claude Desk runtime requirement: If you actually start a local development service that must remain reachable after this reply, detach it from the Claude Code process using the native mechanism for the current operating system. On macOS use a user launchd job; on Windows use a detached PowerShell Start-Process invocation with explicit stdout/stderr log files. Preserve PATH or use absolute executable paths, record the label or PID, and verify the configured port or health endpoint after startup. Do not claim the service is started unless verification passes. Tell the user the exact command needed to stop it.'
const DOWNLOAD_GUIDANCE = 'Claude Desk download requirement: Only when the user explicitly requests a downloadable deliverable, include a Markdown link whose visible label contains "下载" or "Download" and whose destination is a project-relative file path, for example [下载报告](./exports/report.xlsx). Never create download links for source or configuration files that were merely read, referenced, or edited while doing the work.'

export function requestsPersistentService(prompt = '') {
  return SERVICE_REQUESTS.some((pattern) => pattern.test(prompt))
}

export function withRuntimeGuidance(prompt = '') {
  const guidance = [DOWNLOAD_GUIDANCE]
  if (requestsPersistentService(prompt)) guidance.push(SERVICE_GUIDANCE)
  return [prompt.trim(), ...guidance].filter(Boolean).join('\n\n')
}
