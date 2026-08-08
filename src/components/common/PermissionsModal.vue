<script setup>
import { ref, watch } from 'vue'
import { Check, ShieldCheck, ShieldAlert, X } from 'lucide-vue-next'
import { useWorkspaceStore } from '../../stores/workspace'
import { useI18n } from '../../services/i18n'

const store = useWorkspaceStore()
const { t } = useI18n()
const selected = ref('acceptEdits')

watch(() => store.permissionsOpen, (open) => {
  if (open) selected.value = store.settings.permissionMode === 'bypassPermissions' ? 'bypassPermissions' : 'acceptEdits'
}, { immediate: true })

function save() {
  store.savePermissionMode(selected.value)
}
</script>

<template>
  <div v-if="store.permissionsOpen" class="modal-backdrop" @click.self="store.permissionsOpen = false">
    <section class="settings-modal permissions-modal">
      <header>
        <div><span class="eyebrow">Claude Desk</span><h2>{{ t('permissions.title') }}</h2></div>
        <button class="icon-button" :title="t('common.close')" @click="store.permissionsOpen = false"><X :size="18" /></button>
      </header>
      <div class="settings-body permission-body">
        <p class="permission-intro">{{ t('permissions.intro') }}</p>
        <button class="permission-option" :class="{ selected: selected === 'acceptEdits' }" @click="selected = 'acceptEdits'">
          <span class="permission-icon"><ShieldCheck :size="20" /></span>
          <span><strong>{{ t('permissions.projectTitle') }}</strong><small>{{ t('permissions.recommended') }}</small><em>{{ t('permissions.projectDesc') }}</em></span>
          <Check v-if="selected === 'acceptEdits'" :size="18" />
        </button>
        <button class="permission-option danger-option" :class="{ selected: selected === 'bypassPermissions' }" @click="selected = 'bypassPermissions'">
          <span class="permission-icon"><ShieldAlert :size="20" /></span>
          <span><strong>{{ t('permissions.fullTitle') }}</strong><small>{{ t('permissions.noPrompts') }}</small><em>{{ t('permissions.fullDesc') }}</em></span>
          <Check v-if="selected === 'bypassPermissions'" :size="18" />
        </button>
        <div v-if="selected === 'bypassPermissions'" class="permission-warning"><ShieldAlert :size="16" /> {{ t('permissions.warning') }}</div>
      </div>
      <footer>
        <button class="secondary-button" @click="store.permissionsOpen = false">{{ t('common.cancel') }}</button>
        <button class="primary-button" @click="save">{{ t('permissions.save') }}</button>
      </footer>
    </section>
  </div>
</template>
