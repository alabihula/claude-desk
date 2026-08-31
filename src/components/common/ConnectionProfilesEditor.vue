<script setup>
import { computed, ref } from 'vue'
import { Copy, Eye, EyeOff, Plus, Trash2 } from 'lucide-vue-next'
import { activeConnectionProfile, createConnectionProfile } from '../../services/claude/connectionProfiles'
import { useI18n } from '../../services/i18n'

const props = defineProps({
  profiles: { type: Array, required: true },
  activeId: { type: String, required: true },
})
const emit = defineEmits(['update:profiles', 'update:activeId', 'change-profile'])
const { t } = useI18n()
const showToken = ref(false)
const active = computed(() => activeConnectionProfile(props.profiles, props.activeId))

function select(event) {
  showToken.value = false
  emit('update:activeId', event.target.value)
}

function update(field, value) {
  if (!active.value) return
  emit('change-profile', { profileId: active.value.id, changes: { [field]: value } })
}

function add() {
  const profile = createConnectionProfile(t('settings.newConnection'))
  emit('update:profiles', [...props.profiles, profile])
  emit('update:activeId', profile.id)
  showToken.value = false
}

function duplicate() {
  if (!active.value) return
  const profile = createConnectionProfile(t('settings.connectionCopy', { name: active.value.name }), active.value)
  emit('update:profiles', [...props.profiles, profile])
  emit('update:activeId', profile.id)
}

function remove() {
  if (!active.value || props.profiles.length <= 1) return
  const remaining = props.profiles.filter((profile) => profile.id !== active.value.id)
  emit('update:profiles', remaining)
  emit('update:activeId', remaining[0].id)
  showToken.value = false
}
</script>

<template>
  <div class="connection-profile-toolbar">
    <label>
      {{ t('settings.activeConnection') }}
      <span>{{ t('settings.activeConnectionHelp') }}</span>
      <select :value="activeId" data-testid="connection-profile-select" @change="select">
        <option v-for="profile in profiles" :key="profile.id" :value="profile.id">{{ profile.name }}</option>
      </select>
    </label>
    <div class="connection-profile-actions">
      <button type="button" :title="t('settings.addConnection')" @click="add"><Plus :size="15" /></button>
      <button type="button" :title="t('settings.duplicateConnection')" @click="duplicate"><Copy :size="14" /></button>
      <button type="button" :disabled="profiles.length <= 1" :title="t('settings.deleteConnection')" @click="remove"><Trash2 :size="14" /></button>
    </div>
  </div>

  <template v-if="active">
    <label class="connection-profile-name">
      {{ t('settings.connectionName') }}
      <span>{{ t('settings.connectionNameHelp') }}</span>
      <input :value="active.name" data-testid="connection-profile-name" @input="update('name', $event.target.value)" />
    </label>
    <label class="connection-base-url">
      {{ t('settings.baseUrl') }}
      <span>{{ t('settings.baseUrlHelp') }}</span>
      <input :value="active.baseUrl" spellcheck="false" placeholder="https://api.anthropic.com" @input="update('baseUrl', $event.target.value)" />
    </label>
    <label>
      {{ t('settings.token') }}
      <span>{{ t('settings.tokenHelp') }}</span>
      <div class="secret-input">
        <input :value="active.token" :type="showToken ? 'text' : 'password'" spellcheck="false" placeholder="Token" @input="update('token', $event.target.value)" />
        <button type="button" :title="t(showToken ? 'settings.hideToken' : 'settings.showToken')" @click="showToken = !showToken"><EyeOff v-if="showToken" :size="16" /><Eye v-else :size="16" /></button>
      </div>
    </label>
    <label>
      {{ t('settings.model') }}
      <span>{{ t('settings.modelHelp') }}</span>
      <input :value="active.model" spellcheck="false" placeholder="sonnet or kimi-latest" @input="update('model', $event.target.value)" />
    </label>
  </template>
</template>
