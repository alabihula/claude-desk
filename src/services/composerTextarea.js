export function resizeComposerTextarea(element, { minHeight = 52, maxHeight = 180 } = {}) {
  if (!element) return 0
  element.style.height = '0px'
  const contentHeight = element.scrollHeight
  const height = Math.max(minHeight, Math.min(contentHeight, maxHeight))
  element.style.height = `${height}px`
  element.style.overflowY = contentHeight > maxHeight ? 'auto' : 'hidden'
  return height
}
