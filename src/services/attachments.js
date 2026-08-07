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
