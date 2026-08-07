<script setup>
import { reactive, ref, watch } from 'vue'
import { CheckCircle2, Code2, Eye, EyeOff, RefreshCw, SlidersHorizontal, X, XCircle } from 'lucide-vue-next'
import { useWorkspaceStore } from '../../stores/workspace'
import { applyVisualClaudeSettings, visualFromClaudeSettings } from '../../services/claude/settings'

const store = useWorkspaceStore()
const mode = ref('visual')
const showToken = ref(false)
const jsonText = ref('{}\n')
const jsonError = ref('')
const formError = ref('')
const saving = ref(false)
const workingConfig = ref({})
const form = reactive({
  baseUrl: '', token: '', model: '', autoCompact: true, compactThreshold: 'default', contextWindow: '',
  theme: 'system', editor: 'vscode',
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
  })
}

watch(() => store.settingsOpen, (open) => { if (open) reset() }, { immediate: true })

function parseJson() {
  try {
    const parsed = JSON.parse(jsonText.value)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Settings must be a JSON object')
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
    formError.value = 'Context window must be a positive whole number of tokens.'
    return
  }
  saving.value = true
  try {
    const parsed = mode.value === 'json' ? parseJson() : workingConfig.value
    if (!parsed) return
    const content = mode.value === 'json'
      ? JSON.stringify(parsed, null, 2)
      : JSON.stringify(applyVisualClaudeSettings(parsed, form), null, 2)
    await store.saveConfiguration(content, { theme: form.theme, editor: form.editor })
  } catch (error) {
    store.error = String(error)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div v-if="store.settingsOpen" class="modal-backdrop" @click.self="store.settingsOpen = false">
    <section class="settings-modal settings-modal-wide">
      <header><div><span class="eyebrow">Claude Desk</span><h2>Settings</h2></div><button class="icon-button" @click="store.settingsOpen = false"><X :size="18" /></button></header>
      <div class="settings-tabs">
        <button :class="{ active: mode === 'visual' }" @click="selectMode('visual')"><SlidersHorizontal :size="15" /> Visual</button>
        <button :class="{ active: mode === 'json' }" @click="selectMode('json')"><Code2 :size="15" /> JSON</button>
      </div>
      <div class="settings-body">
        <template v-if="mode === 'visual'">
          <section class="settings-section connection-section">
            <div class="settings-heading"><h3>Claude connection</h3><p>Three essentials for the endpoint Claude Code uses.</p></div>
            <label>Base URL <span>Leave empty for the official Anthropic endpoint.</span><input v-model="form.baseUrl" spellcheck="false" placeholder="https://api.anthropic.com" /></label>
            <label>Token <span>Custom endpoints use a Bearer token; the official endpoint uses an API key.</span><div class="secret-input"><input v-model="form.token" :type="showToken ? 'text' : 'password'" spellcheck="false" placeholder="Token" /><button type="button" :title="showToken ? 'Hide token' : 'Show token'" @click="showToken = !showToken"><EyeOff v-if="showToken" :size="16" /><Eye v-else :size="16" /></button></div></label>
            <label>Model <span>Alias or provider model ID.</span><input v-model="form.model" spellcheck="false" placeholder="sonnet or kimi-latest" /></label>
          </section>

          <section class="settings-section context-settings">
            <div class="settings-heading"><h3>Context management</h3><p>Claude Code compacts long sessions automatically. Changes apply to the next message.</p></div>
            <label class="toggle-row"><span><strong>Auto compact</strong><em>Summarize older context before the window fills.</em></span><input v-model="form.autoCompact" type="checkbox" /></label>
            <div class="two-column">
              <label>Compact at<select v-model="form.compactThreshold" :disabled="!form.autoCompact"><option value="default">Default (~95%)</option><option value="90">90%</option><option value="85">85% — Safer</option><option value="70">70% — Early</option></select></label>
              <label>Context window <span>Optional provider override, tokens.</span><input v-model="form.contextWindow" inputmode="numeric" spellcheck="false" placeholder="Auto" /></label>
            </div>
            <p v-if="formError" class="field-error">{{ formError }}</p>
          </section>
        </template>

        <section v-else class="settings-section json-settings">
          <div class="settings-heading settings-heading-row"><div><h3>Claude user settings</h3><p>{{ store.claudeSettingsPath }}</p></div><button class="text-button" @click="reload"><RefreshCw :size="14" /> Reload</button></div>
          <div class="json-warning">This file may contain credentials. Do not paste or share it publicly.</div>
          <textarea v-model="jsonText" class="json-editor" rows="18" spellcheck="false" @input="jsonError = ''"></textarea>
          <p v-if="jsonError" class="field-error">{{ jsonError }}</p>
        </section>

        <section class="settings-section general-settings">
          <div class="settings-heading"><h3>Claude Desk</h3><p>Local application preferences.</p></div>
          <div class="two-column">
            <label>Appearance<select v-model="form.theme"><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></label>
            <label>Open code links in <span>Used when you click a file path in Claude's response.</span><select v-model="form.editor"><option value="claude-desk">Claude Desk</option><option value="vscode">VS Code</option><option value="cursor">Cursor</option><option value="system">System Default</option></select></label>
          </div>
          <button class="settings-link" @click="store.settingsOpen = false; store.permissionsOpen = true">File and command access is managed in <strong>Permissions</strong>.</button>
          <div v-if="store.health" class="health-card" :class="{ error: !store.health.available }">
            <CheckCircle2 v-if="store.health.available" :size="17" /><XCircle v-else :size="17" />
            <div><strong>{{ store.health.available ? `Claude Code ${store.health.version}` : 'Claude Code not found' }}</strong><small>{{ store.health.resolvedPath || store.health.error }}</small></div>
          </div>
        </section>
      </div>
      <footer><span class="save-note">No restart required · applies to the next message</span><button class="secondary-button" @click="store.settingsOpen = false">Cancel</button><button class="primary-button" :disabled="saving" @click="save">{{ saving ? 'Saving…' : 'Save Settings' }}</button></footer>
    </section>
  </div>
</template>
