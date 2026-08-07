<script setup>
import { ref, watch } from 'vue'
import { Check, ShieldCheck, ShieldAlert, X } from 'lucide-vue-next'
import { useWorkspaceStore } from '../../stores/workspace'

const store = useWorkspaceStore()
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
        <div><span class="eyebrow">Claude Desk</span><h2>Permissions</h2></div>
        <button class="icon-button" title="Close" @click="store.permissionsOpen = false"><X :size="18" /></button>
      </header>
      <div class="settings-body permission-body">
        <p class="permission-intro">Choose what Claude can access while working. This applies to future messages.</p>
        <button class="permission-option" :class="{ selected: selected === 'acceptEdits' }" @click="selected = 'acceptEdits'">
          <span class="permission-icon"><ShieldCheck :size="20" /></span>
          <span><strong>Project & attachments</strong><small>Recommended</small><em>Work in the current project and read files copied into Claude Desk. Other protected actions may still be denied.</em></span>
          <Check v-if="selected === 'acceptEdits'" :size="18" />
        </button>
        <button class="permission-option danger-option" :class="{ selected: selected === 'bypassPermissions' }" @click="selected = 'bypassPermissions'">
          <span class="permission-icon"><ShieldAlert :size="20" /></span>
          <span><strong>Full access</strong><small>No further prompts</small><em>Allow Claude to read and modify any file and run commands without confirmation. Use only with trusted projects.</em></span>
          <Check v-if="selected === 'bypassPermissions'" :size="18" />
        </button>
        <div v-if="selected === 'bypassPermissions'" class="permission-warning"><ShieldAlert :size="16" /> Full access uses Claude's native bypass-permissions mode.</div>
      </div>
      <footer>
        <button class="secondary-button" @click="store.permissionsOpen = false">Cancel</button>
        <button class="primary-button" @click="save">Save Permissions</button>
      </footer>
    </section>
  </div>
</template>
