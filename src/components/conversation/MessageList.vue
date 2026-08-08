<script setup>
import { nextTick, onMounted, ref, watch } from 'vue'
import MessageItem from './MessageItem.vue'
import ActivityList from '../activity/ActivityList.vue'

const props = defineProps({
  messages: { type: Array, default: () => [] },
  attachmentsByMessage: { type: Object, default: () => ({}) },
  run: { type: Object, default: null },
})
const scroller = ref(null)

function scrollToBottom() { nextTick(() => scroller.value?.scrollTo({ top: scroller.value.scrollHeight, behavior: 'smooth' })) }
watch(() => [
  props.messages.length,
  props.run?.content?.length,
  props.run?.timeline?.length,
  props.run?.timeline?.reduce((total, item) => total + (item.text?.length || 0), 0),
], scrollToBottom)
onMounted(scrollToBottom)
</script>

<template>
  <div ref="scroller" class="message-scroller">
    <div class="message-column">
      <MessageItem v-for="message in messages" :key="message.id" :message="message" :attachments="attachmentsByMessage[message.id] || []" />
      <ActivityList v-if="run" :run="run" />
      <article v-if="run?.content" class="message message-assistant streaming-message">
        <div class="message-author">Claude</div>
        <div class="message-body markdown-body live-text">{{ run.content }}</div>
      </article>
      <slot></slot>
    </div>
  </div>
</template>
