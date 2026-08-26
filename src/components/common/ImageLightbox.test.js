// @vitest-environment happy-dom
import { createApp, h, nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ convertFileSrc: (path) => `asset:${path}` }))
vi.mock('../../services/desktop', () => ({ desktop: { revealPath: vi.fn() } }))

import { useWorkspaceStore } from '../../stores/workspace'
import ImageLightbox from './ImageLightbox.vue'

let app
let root
let store

beforeEach(() => {
  const pinia = createPinia()
  setActivePinia(pinia)
  store = useWorkspaceStore()
  store.previewAttachment = { name: 'panel.png', path: '/project/exports/panel.png' }
  root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp({ render: () => h(ImageLightbox) })
  app.use(pinia)
  app.mount(root)
})

afterEach(() => {
  app.unmount()
  document.body.innerHTML = ''
})

describe('ImageLightbox', () => {
  it('centers the preview in a fixed stage and exposes zoom controls', async () => {
    const stage = root.querySelector('.image-lightbox-stage')
    const image = root.querySelector('img')
    Object.defineProperty(stage, 'clientWidth', { value: 800 })
    Object.defineProperty(stage, 'clientHeight', { value: 600 })
    Object.defineProperty(image, 'naturalWidth', { value: 400 })
    Object.defineProperty(image, 'naturalHeight', { value: 800 })
    image.dispatchEvent(new Event('load'))
    await nextTick()

    expect(stage).not.toBeNull()
    expect(image.getAttribute('src')).toBe('asset:/project/exports/panel.png')
    expect(image.style.height).toBe('552px')

    const zoomIn = root.querySelector('button[title="Zoom in"]')
    zoomIn.click()
    await nextTick()
    expect(root.querySelector('.image-zoom-level')?.textContent).toBe('125%')
    expect(image.style.height).toBe('690px')
    expect(image.style.marginTop).toBe('-345px')

    root.querySelector('.image-zoom-level').click()
    await nextTick()
    expect(root.querySelector('.image-zoom-level')?.textContent).toBe('100%')
  })

  it('closes from the backdrop but not when the image is clicked', async () => {
    root.querySelector('img').click()
    await nextTick()
    expect(store.previewAttachment).not.toBeNull()

    root.querySelector('.image-lightbox-stage').click()
    await nextTick()
    expect(store.previewAttachment).toBeNull()
  })
})
