export async function clipboardImageFromEvent(event) {
  for (const item of event.clipboardData?.items || []) {
    if (!item.type.startsWith('image/')) continue
    const file = item.getAsFile()
    if (!file) continue
    const bytes = [...new Uint8Array(await file.arrayBuffer())]
    const extension = item.type.split('/')[1] || 'png'
    return { bytes, extension }
  }
  return null
}

export async function copyAttachmentPaths(paths, conversationId, copyAttachment) {
  const uniquePaths = [...new Set((paths || []).filter((path) => typeof path === 'string' && path))]
  const attachments = []
  const errors = []
  for (const path of uniquePaths) {
    try { attachments.push(await copyAttachment(conversationId, path)) }
    catch (error) { errors.push({ path, error: String(error) }) }
  }
  return { attachments, errors }
}

export function attachmentTypeLabel(attachment) {
  const extension = attachment.name?.split('.').pop()
  if (extension && extension !== attachment.name) return extension.toUpperCase()
  return attachment.kind === 'image' ? 'IMAGE' : 'FILE'
}

export function attachmentPrompt(content, attachments) {
  if (!attachments.length) return content
  const paths = attachments.map((item) => `- ${item.path}`).join('\n')
  return `${content.trim()}\n\n附件（请直接读取这些本地文件）：\n${paths}`
}

export function messageWithAttachmentNames(content, attachments) {
  if (!attachments.length) return content.trim()
  const names = attachments.map((item) => `📎 ${item.name}`).join('\n')
  return `${content.trim()}\n\n${names}`
}
