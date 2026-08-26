export const MIN_IMAGE_SCALE = 0.25
export const MAX_IMAGE_SCALE = 5

export function clampImageScale(value) {
  return Math.min(MAX_IMAGE_SCALE, Math.max(MIN_IMAGE_SCALE, Number(value) || 1))
}

export function fitImageSize(image, viewport, padding = 48) {
  const width = Math.max(0, Number(image?.width) || 0)
  const height = Math.max(0, Number(image?.height) || 0)
  if (!width || !height) return { width: 0, height: 0 }
  const availableWidth = Math.max(0, (viewport?.width || 0) - padding)
  const availableHeight = Math.max(0, (viewport?.height || 0) - padding)
  const ratio = Math.min(1, availableWidth / width, availableHeight / height)
  return { width: width * ratio, height: height * ratio }
}

export function imagePanBounds(image, viewport, scale) {
  const safeScale = clampImageScale(scale)
  return {
    x: Math.max(0, ((image?.width || 0) * safeScale - (viewport?.width || 0)) / 2),
    y: Math.max(0, ((image?.height || 0) * safeScale - (viewport?.height || 0)) / 2),
  }
}

export function clampImageOffset(offset, image, viewport, scale) {
  const bounds = imagePanBounds(image, viewport, scale)
  return {
    x: Math.min(bounds.x, Math.max(-bounds.x, Number(offset?.x) || 0)),
    y: Math.min(bounds.y, Math.max(-bounds.y, Number(offset?.y) || 0)),
  }
}

export function zoomImageAt(view, nextScale, anchor, image, viewport) {
  const scale = clampImageScale(view?.scale)
  const targetScale = clampImageScale(nextScale)
  const ratio = targetScale / scale
  const offset = clampImageOffset({
    x: (anchor?.x || 0) - ((anchor?.x || 0) - (view?.x || 0)) * ratio,
    y: (anchor?.y || 0) - ((anchor?.y || 0) - (view?.y || 0)) * ratio,
  }, image, viewport, targetScale)
  return { scale: targetScale, ...offset }
}
