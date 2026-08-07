const BINARY_EXTENSIONS = new Set([
  '7z', 'avi', 'dmg', 'doc', 'docx', 'gif', 'gz', 'ico', 'jpeg', 'jpg', 'mov', 'mp3',
  'mp4', 'pdf', 'png', 'ppt', 'pptx', 'psd', 'tar', 'webp', 'xls', 'xlsx', 'zip',
])

export function preferredChange(files = []) {
  return files.find((file) => !BINARY_EXTENSIONS.has(file.path.split('.').pop()?.toLowerCase())) || files[0] || null
}

export function changeStatusLabel(status = '') {
  const value = status.trim()
  if (value === '??') return 'New'
  if (value.includes('R')) return 'R'
  if (value.includes('D')) return 'D'
  if (value.includes('A')) return 'A'
  if (value.includes('M')) return 'M'
  return value || 'M'
}
