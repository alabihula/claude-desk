<script setup>
import { CornerDownRight, Paperclip, X } from 'lucide-vue-next'

defineProps({
  messages: { type: Array, default: () => [] },
  running: Boolean,
})

defineEmits(['activate', 'remove'])
</script>

<template>
  <section v-if="messages.length" class="queued-messages" aria-label="待处理补充">
    <header>
      <strong>待处理补充</strong>
      <span>{{ messages.some((item) => item.status === 'steering') ? '正在中断当前步骤…' : running ? '当前回复完成后按顺序发送' : '已暂停，选择一条继续' }}</span>
    </header>
    <div class="queued-message-list">
      <article v-for="(message, index) in messages" :key="message.id" :class="{ steering: message.status === 'steering' }">
        <span class="queue-index">{{ index + 1 }}</span>
        <div class="queue-content">
          <p>{{ message.content || '请查看附件。' }}</p>
          <small v-if="message.attachments.length"><Paperclip :size="11" />{{ message.attachments.length }} 个附件</small>
        </div>
        <button
          class="queue-activate"
          :disabled="messages.some((item) => item.status === 'steering')"
          :title="running ? '中断当前步骤并按这条补充继续' : '立即发送这条补充'"
          @click="$emit('activate', message.id)"
        >
          <CornerDownRight :size="13" />
          {{ message.status === 'steering' ? '正在调整…' : running ? '立即调整' : '现在发送' }}
        </button>
        <button
          class="queue-remove"
          :disabled="message.status === 'steering'"
          title="移除这条补充"
          @click="$emit('remove', message.id)"
        ><X :size="13" /></button>
      </article>
    </div>
  </section>
</template>
