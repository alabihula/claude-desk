<script setup>
import { CornerDownRight, Paperclip, X } from 'lucide-vue-next'
import { useI18n } from '../../services/i18n'

const { t } = useI18n()

defineProps({
  messages: { type: Array, default: () => [] },
  running: Boolean,
})

defineEmits(['activate', 'remove'])
</script>

<template>
  <section v-if="messages.length" class="queued-messages" :aria-label="t('queue.label')">
    <header>
      <strong>{{ t('queue.label') }}</strong>
      <span>{{ t(messages.some((item) => item.status === 'steering') ? 'queue.steering' : running ? 'queue.afterReply' : 'queue.paused') }}</span>
    </header>
    <div class="queued-message-list">
      <article v-for="(message, index) in messages" :key="message.id" :class="{ steering: message.status === 'steering' }">
        <span class="queue-index">{{ index + 1 }}</span>
        <div class="queue-content">
          <p>{{ message.content || t('queue.seeAttachments') }}</p>
          <small v-if="message.attachments.length"><Paperclip :size="11" />{{ t('queue.attachments', { count: message.attachments.length }) }}</small>
        </div>
        <button
          class="queue-activate"
          :disabled="messages.some((item) => item.status === 'steering')"
          :title="t(running ? 'queue.interruptTitle' : 'queue.sendTitle')"
          @click="$emit('activate', message.id)"
        >
          <CornerDownRight :size="13" />
          {{ t(message.status === 'steering' ? 'queue.adjusting' : running ? 'queue.adjustNow' : 'queue.sendNow') }}
        </button>
        <button
          class="queue-remove"
          :disabled="message.status === 'steering'"
          :title="t('queue.remove')"
          @click="$emit('remove', message.id)"
        ><X :size="13" /></button>
      </article>
    </div>
  </section>
</template>
