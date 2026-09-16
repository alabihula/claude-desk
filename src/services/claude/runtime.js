const SERVICE_REQUESTS = [
  /(?:启动|重启|运行).{0,16}(?:前端|后端|服务|工程|项目|开发环境)/,
  /(?:前端|后端|服务|工程|项目).{0,16}(?:启动|重启|运行)/,
  /\b(?:pnpm|npm|yarn|bun)\s+(?:run\s+)?dev\b/i,
  /\bspring-boot:run\b/i,
  /\b(?:start|restart|run|serve)\b.{0,40}\b(?:server|frontend|backend|dev server|development server)\b/i,
]

const SERVICE_GUIDANCE = 'Claude Desk runtime requirement: If you actually start a local development service that must remain reachable after this reply, detach it from the Claude Code process using the native mechanism for the current operating system. On macOS use a user launchd job; on Windows use a detached PowerShell Start-Process invocation with explicit stdout/stderr log files. Preserve PATH or use absolute executable paths, record the label or PID, and verify the configured port or health endpoint after startup. Do not claim the service is started unless verification passes. Tell the user the exact command needed to stop it.'
const DOWNLOAD_GUIDANCE = 'Claude Desk download requirement: Only when the user explicitly requests a downloadable deliverable, include a Markdown link whose visible label contains "下载" or "Download" and whose destination is the exact file path relative to the initial project working directory, for example [下载报告](./exports/report.xlsx). Verify that exact linked path exists before replying; do not make it relative to a nested working directory or tool workspace. Never create download links for source or configuration files that were merely read, referenced, or edited while doing the work.'

export function requestsPersistentService(prompt = '') {
  return SERVICE_REQUESTS.some((pattern) => pattern.test(prompt))
}

export function withRuntimeGuidance(prompt = '') {
  const guidance = [DOWNLOAD_GUIDANCE, 'Claude Desk communication guidance: Use the user\'s language. Keep progress updates brief and only send them when there is a meaningful finding, change of approach, or a question for the user. The app already displays tool activity, so do not narrate every read, search or command. Keep raw payloads such as Base64 out of user-facing prose unless explicitly requested. Make the final answer self-contained with the result, verification and unresolved issues; avoid repeating the execution log. This guidance does not limit necessary tools, verification, warnings or user-requested detail.']
  guidance.push('Claude Desk attachment guidance: Words such as “如图” or “as shown” are not evidence of a new attachment. Only use image paths explicitly attached to this message or explicitly requested by the user; never search for or reopen old screenshots to guess what they meant. If no image was attached, ask for clarification. Tool access to image files does not imply that the configured model supports vision.')
  if (/\bmcp\b/i.test(prompt)) guidance.push('Claude Desk MCP configuration: This app uses Claude Code configuration. For a user-wide server use claude mcp add or add-json with --scope user; the standard location is ~/.claude.json, not ~/.claude/mcp.json and not Claude Desktop or Codex configuration. For shared project scope use the project-root .mcp.json. Respect CLAUDE_CONFIG_DIR if configured. Verify with claude mcp get and claude mcp list from the active project before claiming configuration succeeded. Distinguish registration, connectivity and tools actually available to the current run.')
  if (requestsPersistentService(prompt)) guidance.push(SERVICE_GUIDANCE)
  return [prompt.trim(), ...guidance].filter(Boolean).join('\n\n')
}
