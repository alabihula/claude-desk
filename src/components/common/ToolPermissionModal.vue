<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Check, ChevronDown, Clock3, Globe2, Plug, Server, ShieldCheck, ShieldQuestion } from 'lucide-vue-next'
import {
  permissionDecisions,
  permissionInputPreview,
  permissionPersistenceChoices,
} from '../../services/claude/permissions'
import { useI18n } from '../../services/i18n'
import { useWorkspaceStore } from '../../stores/workspace'

const store = useWorkspaceStore()
const { t } = useI18n()
const request = computed(() => store.activePermissionRequest)
const conversation = computed(() => store.conversationById(request.value?.conversationId))
const inputPreview = computed(() => permissionInputPreview(request.value?.input))
const persistenceChoices = computed(() => permissionPersistenceChoices(request.value))
const alwaysMenu = ref(null)
const alwaysMenuOpen = ref(false)

function respond(decision) {
  alwaysMenuOpen.value = false
  if (request.value) store.respondPermission(request.value.requestId, decision)
}

function closeAlwaysMenu(event) {
  if (!alwaysMenu.value?.contains(event.target)) alwaysMenuOpen.value = false
}

watch(() => request.value?.requestId, () => { alwaysMenuOpen.value = false })
onMounted(() => window.addEventListener('pointerdown', closeAlwaysMenu))
onBeforeUnmount(() => window.removeEventListener('pointerdown', closeAlwaysMenu))
</script>

<template>
  <div v-if="request" class="modal-backdrop tool-permission-backdrop">
    <section class="settings-modal tool-permission-modal" role="dialog" aria-modal="true" aria-labelledby="tool-permission-title">
      <header>
        <span class="permission-request-icon"><Plug v-if="request.isMcp" :size="20" /><ShieldQuestion v-else :size="20" /></span>
        <div>
          <span class="eyebrow">{{ t('toolPermission.eyebrow') }}</span>
          <h2 id="tool-permission-title">{{ t(request.isMcp ? 'toolPermission.mcpTitle' : 'toolPermission.title') }}</h2>
        </div>
      </header>
      <div class="tool-permission-body">
        <p>{{ request.description || t('toolPermission.intro') }}</p>
        <dl>
          <template v-if="request.isMcp">
            <dt>{{ t('toolPermission.server') }}</dt><dd>{{ request.server }}</dd>
          </template>
          <dt>{{ t('toolPermission.tool') }}</dt><dd>{{ request.action }}</dd>
          <dt>{{ t('toolPermission.conversation') }}</dt><dd>{{ conversation?.title || request.conversationId }}</dd>
        </dl>
        <div class="permission-arguments">
          <strong>{{ t('toolPermission.arguments') }}</strong>
          <pre>{{ inputPreview }}</pre>
        </div>
      </div>
      <footer>
        <button class="secondary-button permission-deny" :disabled="request.responding" @click="respond(permissionDecisions.deny)">{{ t('toolPermission.deny') }}</button>
        <button class="primary-button permission-allow" :disabled="request.responding" @click="respond(permissionDecisions.allowOnce)">{{ t(request.responding ? 'toolPermission.responding' : 'toolPermission.allowOnce') }}</button>
        <div v-if="persistenceChoices.length" ref="alwaysMenu" class="permission-always-wrap">
          <button
            class="secondary-button permission-always-toggle"
            :disabled="request.responding"
            :aria-expanded="alwaysMenuOpen"
            aria-haspopup="menu"
            @click="alwaysMenuOpen = !alwaysMenuOpen"
          >
            {{ t('toolPermission.alwaysAllow') }} <ChevronDown :size="14" />
          </button>
          <div v-if="alwaysMenuOpen" class="permission-always-menu" role="menu">
            <button
              v-for="choice in persistenceChoices"
              :key="choice.decision"
              class="permission-scope-option"
              :class="{ risky: choice.risk }"
              :data-decision="choice.decision"
              role="menuitem"
              @click="respond(choice.decision)"
            >
              <ShieldCheck v-if="choice.decision === permissionDecisions.allowProjectTool" :size="17" />
              <Clock3 v-else-if="choice.decision === permissionDecisions.allowSessionTool" :size="17" />
              <Globe2 v-else-if="choice.decision === permissionDecisions.allowUserTool" :size="17" />
              <Server v-else :size="17" />
              <span>
                <strong>{{ t(choice.titleKey, { tool: request.action, server: request.server }) }}</strong>
                <small>{{ t(choice.descriptionKey, { tool: request.action, server: request.server }) }}</small>
              </span>
              <em v-if="choice.recommended"><Check :size="12" />{{ t('toolPermission.recommended') }}</em>
              <em v-else-if="choice.risk">{{ t('toolPermission.broaderAccess') }}</em>
            </button>
          </div>
        </div>
      </footer>
    </section>
  </div>
</template>
