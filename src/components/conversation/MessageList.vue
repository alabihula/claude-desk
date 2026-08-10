<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import MessageItem from './MessageItem.vue'
import ActivityList from '../activity/ActivityList.vue'
import ConversationRail from './ConversationRail.vue'
import { activeTurnFromOffsets, conversationTurns } from '../../services/conversationRail'

const props = defineProps({
  messages: { type: Array, default: () => [] },
  attachmentsByMessage: { type: Object, default: () => ({}) },
  run: { type: Object, default: null },
})
const scroller = ref(null)
const activeTurnId = ref(null)
const turnElements = new Map()
let scrollFrame = 0
const turns = computed(() => conversationTurns(props.messages, props.attachmentsByMessage))

function setTurnElement(id, element) {
  if (element) turnElements.set(id, element)
  else turnElements.delete(id)
}

function updateActiveTurn() {
  const viewport = scroller.value
  if (!viewport) return
  const top = viewport.getBoundingClientRect().top
  const offsets = turns.value
    .map((turn) => ({ id: turn.id, top: turnElements.get(turn.id)?.getBoundingClientRect().top }))
    .filter((item) => Number.isFinite(item.top))
  activeTurnId.value = activeTurnFromOffsets(turns.value, offsets, top)
}

function handleScroll() {
  window.cancelAnimationFrame(scrollFrame)
  scrollFrame = window.requestAnimationFrame(updateActiveTurn)
}

function scrollToBottom() {
  nextTick(() => {
    scroller.value?.scrollTo({ top: scroller.value.scrollHeight, behavior: 'smooth' })
    updateActiveTurn()
  })
}

function jumpToTurn(id) {
  turnElements.get(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

watch(() => [
  props.messages.length,
  props.run?.content?.length,
  props.run?.timeline?.length,
  props.run?.timeline?.reduce((total, item) => total + (item.text?.length || 0), 0),
], scrollToBottom)
watch(turns, () => nextTick(updateActiveTurn), { flush: 'post' })
onMounted(scrollToBottom)
onBeforeUnmount(() => window.cancelAnimationFrame(scrollFrame))
</script>

<template>
  <div ref="scroller" class="message-scroller" @scroll.passive="handleScroll">
    <div class="message-layout">
      <ConversationRail :turns="turns" :active-turn-id="activeTurnId" @select="jumpToTurn" />
      <div class="message-column">
        <div
          v-for="message in messages"
          :key="message.id"
          class="conversation-message"
          :ref="message.role === 'user' ? (element) => setTurnElement(message.id, element) : undefined"
        >
          <MessageItem :message="message" :attachments="attachmentsByMessage[message.id] || []" />
        </div>
      <ActivityList v-if="run" :run="run" />
      <article v-if="run?.content" class="message message-assistant streaming-message">
        <div class="message-author">Claude</div>
        <div class="message-body markdown-body live-text">{{ run.content }}</div>
      </article>
      <slot></slot>
      </div>
    </div>
  </div>
</template>
