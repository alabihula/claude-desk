<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import MessageItem from './MessageItem.vue'
import ActivityList from '../activity/ActivityList.vue'
import ConversationRail from './ConversationRail.vue'
import { activeTurnFromOffsets, conversationTurns } from '../../services/conversationRail'
import { createConversationScrollFollower, isNearConversationBottom } from '../../services/conversationScroll'

const props = defineProps({
  conversationId: { type: String, default: '' },
  messages: { type: Array, default: () => [] },
  attachmentsByMessage: { type: Object, default: () => ({}) },
  run: { type: Object, default: null },
})
const scroller = ref(null)
const activeTurnId = ref(null)
const turnElements = new Map()
let scrollFrame = 0
const outputFollower = createConversationScrollFollower()
let pointerScrolling = false
let resumeBlocked = false
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
  const viewport = scroller.value
  if (pointerScrolling && !isNearConversationBottom(viewport)) outputFollower.pause()
  if (!resumeBlocked && isNearConversationBottom(viewport, 1)) outputFollower.resume()
  window.cancelAnimationFrame(scrollFrame)
  scrollFrame = window.requestAnimationFrame(updateActiveTurn)
}

function handleWheel(event) {
  // Wheel fires before scroll, so this cancels any queued stream-follow update
  // as soon as the user starts moving toward conversation history.
  if (event.deltaY < 0) {
    resumeBlocked = true
    outputFollower.pause()
  } else if (event.deltaY > 0) {
    resumeBlocked = false
  }
}

function handlePointerDown() {
  pointerScrolling = true
  resumeBlocked = false
}

function handlePointerEnd() {
  pointerScrolling = false
}

function queueScrollToBottom(force) {
  if (!force && !outputFollower.following) return

  nextTick(() => {
    const viewport = scroller.value
    if (!viewport || (!force && !outputFollower.following)) return
    viewport.scrollTo({ top: viewport.scrollHeight, behavior: 'auto' })
    updateActiveTurn()
  })
}

function followLatestOutput() {
  queueScrollToBottom(false)
}

function forceScrollToBottom() {
  queueScrollToBottom(true)
}

function jumpToTurn(id) {
  resumeBlocked = true
  outputFollower.pause()
  turnElements.get(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

watch(() => props.conversationId, () => {
  resumeBlocked = false
  outputFollower.resume()
  forceScrollToBottom()
})
watch(() => props.messages.length, (length, previousLength) => {
  const newestMessage = props.messages[length - 1]
  const submittedByUser = length > previousLength && newestMessage?.role === 'user'
  if (submittedByUser) {
    resumeBlocked = false
    outputFollower.resume()
  }
  if (submittedByUser) forceScrollToBottom()
  else followLatestOutput()
})
watch(() => [
  props.run?.content?.length,
  props.run?.timeline?.length,
  props.run?.timeline?.reduce((total, item) => total + (item.text?.length || 0), 0),
], followLatestOutput)
watch(turns, () => nextTick(updateActiveTurn), { flush: 'post' })
onMounted(() => {
  window.addEventListener('pointerup', handlePointerEnd)
  window.addEventListener('pointercancel', handlePointerEnd)
  forceScrollToBottom()
})
onBeforeUnmount(() => {
  window.cancelAnimationFrame(scrollFrame)
  window.removeEventListener('pointerup', handlePointerEnd)
  window.removeEventListener('pointercancel', handlePointerEnd)
})
</script>

<template>
  <div ref="scroller" class="message-scroller" @scroll.passive="handleScroll" @wheel.passive="handleWheel" @pointerdown.passive="handlePointerDown">
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
