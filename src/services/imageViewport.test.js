import { describe, expect, it } from 'vitest'
import { clampImageOffset, clampImageScale, fitImageSize, imagePanBounds, zoomImageAt } from './imageViewport'

describe('image viewport', () => {
  it('keeps zoom inside the supported range', () => {
    expect(clampImageScale(0.01)).toBe(0.25)
    expect(clampImageScale(2)).toBe(2)
    expect(clampImageScale(20)).toBe(5)
  })

  it('centers fitted images and bounds panning after zoom', () => {
    const image = { width: 400, height: 300 }
    const viewport = { width: 600, height: 400 }
    expect(imagePanBounds(image, viewport, 1)).toEqual({ x: 0, y: 0 })
    expect(imagePanBounds(image, viewport, 2)).toEqual({ x: 100, y: 100 })
    expect(clampImageOffset({ x: 400, y: -250 }, image, viewport, 2)).toEqual({ x: 100, y: -100 })
  })

  it('uses the final fitted size so a tall image cannot be dragged into blank space', () => {
    const viewport = { width: 2500, height: 1620 }
    const image = fitImageSize({ width: 1440, height: 1846 }, viewport)
    const scale = 1.52
    const bounds = imagePanBounds(image, viewport, scale)
    const clamped = clampImageOffset({ x: 0, y: 9999 }, image, viewport, scale)

    expect(image.height).toBe(1572)
    expect(bounds.y).toBeCloseTo(384.72)
    expect(viewport.height / 2 + clamped.y - image.height * scale / 2).toBeCloseTo(0)
  })

  it('keeps the pointer anchor stable while zooming and never pans out of bounds', () => {
    expect(zoomImageAt(
      { scale: 1, x: 0, y: 0 },
      2,
      { x: 100, y: 50 },
      { width: 400, height: 300 },
      { width: 600, height: 400 },
    )).toEqual({ scale: 2, x: -100, y: -50 })
  })
})
