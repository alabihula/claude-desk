<script setup>
import { reactive, ref, watch } from 'vue'
import { CheckCircle2, Code2, Eye, EyeOff, RefreshCw, SlidersHorizontal, X, XCircle } from 'lucide-vue-next'
import { useWorkspaceStore } from '../../stores/workspace'
import { applyVisualClaudeSettings, visualFromClaudeSettings } from '../../services/claude/settings'
import { useI18n } from '../../services/i18n'

const store = useWorkspaceStore()
const { t } = useI18n()
const mode = ref('visual')
const showToken = ref(false)
const jsonText = ref('{}\n')
const jsonError = ref('')
const formError = ref('')
const saving = ref(false)
const workingConfig = ref({})
const form = reactive({
  baseUrl: '', token: '', model: '', autoCompact: true, compactThreshold: 'default', contextWindow: '',
  theme: 'system', editor: 'vscode', language: 'en',
})

function reset() {
  mode.value = store.claudeSettingsError ? 'json' : 'visual'
  jsonText.value = store.claudeSettingsContent
  jsonError.value = store.claudeSettingsError
  formError.value = ''
  workingConfig.value = JSON.parse(JSON.stringify(store.claudeSettings || {}))
  Object.assign(form, visualFromClaudeSettings(workingConfig.value, store.settings), {
    theme: store.settings.theme,
    editor: store.settings.editor,
    language: store.settings.language,
  })
}

watch(() => store.settingsOpen, (open) => { if (open) reset() }, { immediate: true })

function parseJson() {
  try {
    const parsed = JSON.parse(jsonText.value)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(t('settings.jsonObject'))
    jsonError.value = ''
    return parsed
  } catch (error) {
    jsonError.value = String(error)
    return null
  }
}

function selectMode(nextMode) {
  if (nextMode === 'json' && mode.value === 'visual') {
    workingConfig.value = applyVisualClaudeSettings(workingConfig.value, form)
    jsonText.value = JSON.stringify(workingConfig.value, null, 2)
  }
  if (nextMode === 'visual' && mode.value === 'json') {
    const parsed = parseJson()
    if (!parsed) return
    workingConfig.value = parsed
    Object.assign(form, visualFromClaudeSettings(parsed, store.settings))
  }
  mode.value = nextMode
}

async function reload() {
  await store.reloadClaudeSettings()
  reset()
}

async function save() {
  if (mode.value === 'visual' && form.contextWindow && !/^\d+$/.test(form.contextWindow.trim())) {
    formError.value = t('settings.contextInteger')
    return
  }
  saving.value = true
  try {
    const parsed = mode.value === 'json' ? parseJson() : workingConfig.value
    if (!parsed) return
    const content = mode.value === 'json'
      ? JSON.stringify(parsed, null, 2)
      : JSON.stringify(applyVisualClaudeSettings(parsed, form), null, 2)
    await store.saveConfiguration(content, { theme: form.theme, editor: form.editor, language: form.language })
  } catch (error) {
    store.error = String(error)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div v-if="store.settingsOpen" class="modal-backdrop">
    <section class="settings-modal settings-modal-wide">
      <header><div><span class="eyebrow">Claude Desk</span><h2>{{ t('settings.title') }}</h2></div><button class="icon-button" :title="t('common.close')" @click="store.settingsOpen = false"><X :size="18" /></button></header>
      <div class="settings-tabs">
        <button :class="{ active: mode === 'visual' }" @click="selectMode('visual')"><SlidersHorizontal :size="15" /> {{ t('settings.visual') }}</button>
        <button :class="{ active: mode === 'json' }" @click="selectMode('json')"><Code2 :size="15" /> JSON</button>
      </div>
      <div class="settings-body">
        <template v-if="mode === 'visual'">
          <section class="settings-section connection-section">
            <div class="settings-heading"><h3>{{ t('settings.connection') }}</h3><p>{{ t('settings.connectionHelp') }}</p></div>
            <label>{{ t('settings.baseUrl') }} <span>{{ t('settings.baseUrlHelp') }}</span><input v-model="form.baseUrl" spellcheck="false" placeholder="https://api.anthropic.com" /></label>
            <label>{{ t('settings.token') }} <span>{{ t('settings.tokenHelp') }}</span><div class="secret-input"><input v-model="form.token" :type="showToken ? 'text' : 'password'" spellcheck="false" placeholder="Token" /><button type="button" :title="t(showToken ? 'settings.hideToken' : 'settings.showToken')" @click="showToken = !showToken"><EyeOff v-if="showToken" :size="16" /><Eye v-else :size="16" /></button></div></label>
            <label>{{ t('settings.model') }} <span>{{ t('settings.modelHelp') }}</span><input v-model="form.model" spellcheck="false" placeholder="sonnet or kimi-latest" /></label>
          </section>

          <section class="settings-section context-settings">
            <div class="settings-heading"><h3>{{ t('settings.context') }}</h3><p>{{ t('settings.contextHelp') }}</p></div>
            <label class="toggle-row"><span><strong>{{ t('settings.autoCompact') }}</strong><em>{{ t('settings.autoCompactHelp') }}</em></span><input v-model="form.autoCompact" type="checkbox" /></label>
            <div class="two-column">
              <label>{{ t('settings.compactAt') }}<select v-model="form.compactThreshold" :disabled="!form.autoCompact"><option value="default">{{ t('settings.default95') }}</option><option value="90">90%</option><option value="85">{{ t('settings.safer') }}</option><option value="70">{{ t('settings.early') }}</option></select></label>
              <label>{{ t('settings.contextWindow') }} <span>{{ t('settings.contextWindowHelp') }}</span><input v-model="form.contextWindow" inputmode="numeric" spellcheck="false" :placeholder="t('settings.auto')" /></label>
            </div>
            <p v-if="formError" class="field-error">{{ formError }}</p>
          </section>
        </template>

        <section v-else class="settings-section json-settings">
          <div class="settings-heading settings-heading-row"><div><h3>{{ t('settings.userSettings') }}</h3><p>{{ store.claudeSettingsPath }}</p></div><button class="text-button" @click="reload"><RefreshCw :size="14" /> {{ t('settings.reload') }}</button></div>
          <div class="json-warning">{{ t('settings.jsonWarning') }}</div>
          <textarea v-model="jsonText" class="json-editor" rows="18" spellcheck="false" @input="jsonError = ''"></textarea>
          <p v-if="jsonError" class="field-error">{{ jsonError }}</p>
        </section>

        <section class="settings-section general-settings">
          <div class="settings-heading"><h3>{{ t('settings.app') }}</h3><p>{{ t('settings.appHelp') }}</p></div>
          <div class="three-column">
            <label>{{ t('settings.appearance') }}<select v-model="form.theme"><option value="system">{{ t('settings.system') }}</option><option value="light">{{ t('settings.light') }}</option><option value="dark">{{ t('settings.dark') }}</option></select></label>
            <label>{{ t('settings.language') }}<select v-model="form.language" @change="store.setLanguage(form.language)"><option value="en">{{ t('settings.english') }}</option><option value="zh-CN">{{ t('settings.chinese') }}</option></select></label>
            <label>{{ t('settings.openLinks') }} <span>{{ t('settings.openLinksHelp') }}</span><select v-model="form.editor"><option value="claude-desk">Claude Desk</option><option value="vscode">VS Code</option><option value="cursor">Cursor</option><option value="system">{{ t('settings.systemDefault') }}</option></select></label>
          </div>
          <button class="settings-link" @click="store.settingsOpen = false; store.permissionsOpen = true">{{ t('settings.accessManaged') }}</button>
          <div v-if="store.health" class="health-card" :class="{ error: !store.health.available }">
            <CheckCircle2 v-if="store.health.available" :size="17" /><XCircle v-else :size="17" />
            <div><strong>{{ store.health.available ? `Claude Code ${store.health.version}` : t('settings.notFound') }}</strong><small>{{ store.health.resolvedPath || store.health.error }}</small></div>
          </div>
        </section>
      </div>
      <footer><span class="save-note">{{ t('settings.noRestart') }}</span><button class="secondary-button" @click="store.settingsOpen = false">{{ t('common.cancel') }}</button><button class="primary-button" :disabled="saving" @click="save">{{ t(saving ? 'settings.saving' : 'settings.save') }}</button></footer>
    </section>
  </div>
</template>
