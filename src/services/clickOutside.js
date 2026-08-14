import { onBeforeUnmount, onMounted } from 'vue'

export function useCloseOnOutsidePointerDown(root, close) {
  function onPointerDown(event) {
    if (root.value && !root.value.contains(event.target)) close()
  }

  onMounted(() => document.addEventListener('pointerdown', onPointerDown))
  onBeforeUnmount(() => document.removeEventListener('pointerdown', onPointerDown))
}
