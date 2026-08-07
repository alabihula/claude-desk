<script setup>
defineProps({ size: { type: Number, default: 28 } })
</script>

<template>
  <svg class="brand-symbol" :width="size" :height="size" viewBox="0 0 64 64" aria-hidden="true">
    <defs>
      <linearGradient id="brand-warm" x1="8" y1="5" x2="56" y2="59" gradientUnits="userSpaceOnUse">
        <stop stop-color="#e88968" />
        <stop offset="1" stop-color="#c4533e" />
      </linearGradient>
    </defs>
    <rect width="64" height="64" rx="15" fill="url(#brand-warm)" />
    <path d="M10 17a8 8 0 0 1 8-8h28a8 8 0 0 1 8 8v25a8 8 0 0 1-8 8H30l-10 8v-8h-2a8 8 0 0 1-8-8V17z" fill="#fff7ea" />
    <path d="M32 17l2.2 9 7.3-5.7-4.8 7.9 9.3-.7-8.7 3.5 8.3 4.4-9.2-1.7 4 8.5-6.6-6.5-1.2 9.2-1.2-9.2-6.6 6.5 4-8.5-9.2 1.7 8.3-4.4-8.7-3.5 9.3.7-4.8-7.9 7.3 5.7z" fill="url(#brand-warm)" />
  </svg>
</template>
