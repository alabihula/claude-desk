export function formatMessageTime(value, language = 'en') {
  const date = new Date(value)
  if (!value || Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat(language === 'zh-CN' ? 'zh-CN' : 'en', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}
