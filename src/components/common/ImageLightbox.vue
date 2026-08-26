<script setup>
import { convertFileSrc } from '@tauri-apps/api/core'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { FolderOpen, Minus, Plus, X } from 'lucide-vue-next'
import { useWorkspaceStore } from '../../stores/workspace'
import { desktop } from '../../services/desktop'
import { useI18n } from '../../services/i18n'
import { clampImageOffset, fitImageSize, imagePanBounds, MAX_IMAGE_SCALE, MIN_IMAGE_SCALE, zoomImageAt } from '../../services/imageViewport'

const store = useWorkspaceStore()
const { t } = useI18n()
const stage = ref(null)
const image = ref(null)
const imageSize = ref({ width: 0, height: 0 })
const view = ref({ scale: 1, x: 0, y: 0 })
const dragging = ref(false)
let pointerStart = null
let suppressBackdropClose = false

const imageStyle = computed(() => ({
  width: `${imageSize.value.width * view.value.scale}px`,
  height: `${imageSize.value.height * view.value.scale}px`,
  marginLeft: `${-imageSize.value.width * view.value.scale / 2}px`,
  marginTop: `${-imageSize.value.height * view.value.scale / 2}px`,
  transform: `translate3d(${view.value.x}px, ${view.value.y}px, 0)`,
}))
const zoomPercent = computed(() => `${Math.round(view.value.scale * 100)}%`)
const canPan = computed(() => {
  const bounds = imagePanBounds(imageSize.value, viewportSize(), view.value.scale)
  return bounds.x > 0 || bounds.y > 0
})

function viewportSize() {
  return { width: stage.value?.clientWidth || 0, height: stage.value?.clientHeight || 0 }
}

function resetView() {
  view.value = { scale: 1, x: 0, y: 0 }
}

function updateImageSize() {
  // Image load can fire before CSS max-height settles. Derive the final fitted size from the
  // intrinsic dimensions so drag bounds always match the pixels the user actually sees.
  imageSize.value = fitImageSize({
    width: image.value?.naturalWidth || 0,
    height: image.value?.naturalHeight || 0,
  }, viewportSize())
  const offset = clampImageOffset(view.value, imageSize.value, viewportSize(), view.value.scale)
  view.value = { ...view.value, ...offset }
}

function setScale(scale, anchor = { x: 0, y: 0 }) {
  view.value = zoomImageAt(view.value, scale, anchor, imageSize.value, viewportSize())
}

function handleWheel(event) {
  const bounds = stage.value?.getBoundingClientRect()
  if (!bounds) return
  const anchor = {
    x: event.clientX - bounds.left - bounds.width / 2,
    y: event.clientY - bounds.top - bounds.height / 2,
  }
  setScale(view.value.scale * (event.deltaY < 0 ? 1.15 : 1 / 1.15), anchor)
}

function beginPan(event) {
  if (event.button !== 0 || !canPan.value) return
  dragging.value = true
  suppressBackdropClose = false
  pointerStart = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, offset: { x: view.value.x, y: view.value.y } }
  event.currentTarget.setPointerCapture?.(event.pointerId)
}

function movePan(event) {
  if (!dragging.value || event.pointerId !== pointerStart?.pointerId) return
  const next = {
    x: pointerStart.offset.x + event.clientX - pointerStart.x,
    y: pointerStart.offset.y + event.clientY - pointerStart.y,
  }
  if (Math.abs(event.clientX - pointerStart.x) > 2 || Math.abs(event.clientY - pointerStart.y) > 2) suppressBackdropClose = true
  const offset = clampImageOffset(next, imageSize.value, viewportSize(), view.value.scale)
  view.value = { ...view.value, ...offset }
}

function endPan(event) {
  if (event.pointerId !== pointerStart?.pointerId) return
  event.currentTarget.releasePointerCapture?.(event.pointerId)
  dragging.value = false
  pointerStart = null
}

function closeFromBackdrop(event) {
  if (event.target !== event.currentTarget) return
  if (suppressBackdropClose) { suppressBackdropClose = false; return }
  store.previewAttachment = null
}

function handleResize() {
  updateImageSize()
}

watch(() => store.previewAttachment?.path, async () => {
  resetView()
  await nextTick()
  updateImageSize()
})
onMounted(() => window.addEventListener('resize', handleResize))
onBeforeUnmount(() => window.removeEventListener('resize', handleResize))
</script>

<template>
  <div v-if="store.previewAttachment" class="image-lightbox" role="dialog" aria-modal="true" :aria-label="store.previewAttachment.name">
    <header>
      <span>{{ store.previewAttachment.name }}</span>
      <div>
        <button :title="t('common.zoomOut')" :disabled="view.scale <= MIN_IMAGE_SCALE" @click="setScale(view.scale - 0.25)"><Minus :size="18" /></button>
        <button class="image-zoom-level" :title="t('common.resetZoom')" @click="resetView">{{ zoomPercent }}</button>
        <button :title="t('common.zoomIn')" :disabled="view.scale >= MAX_IMAGE_SCALE" @click="setScale(view.scale + 0.25)"><Plus :size="18" /></button>
        <button :title="t('common.showInFileManager')" @click="desktop.revealPath(store.previewAttachment.path)"><FolderOpen :size="18" /></button>
        <button :title="t('common.close')" @click="store.previewAttachment = null"><X :size="20" /></button>
      </div>
    </header>
    <div
      ref="stage"
      class="image-lightbox-stage"
      :class="{ 'can-pan': canPan, dragging }"
      @click="closeFromBackdrop"
      @dblclick="resetView"
      @wheel.prevent="handleWheel"
      @pointerdown="beginPan"
      @pointermove="movePan"
      @pointerup="endPan"
      @pointercancel="endPan"
    >
      <img ref="image" draggable="false" :src="convertFileSrc(store.previewAttachment.path)" :alt="store.previewAttachment.name" :style="imageStyle" @load="updateImageSize" @dragstart.prevent />
      <small>{{ t('common.imagePreviewHelp') }}</small>
    </div>
  </div>
</template>
