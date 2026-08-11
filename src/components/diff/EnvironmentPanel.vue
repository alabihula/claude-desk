<script setup>
import { computed, ref, watch } from 'vue'
import { ChevronRight, FileDiff, FolderOpen, GitBranch, Upload, X } from 'lucide-vue-next'
import { useWorkspaceStore } from '../../stores/workspace'
import { desktop } from '../../services/desktop'
import { useI18n } from '../../services/i18n'

const store = useWorkspaceStore()
const { t } = useI18n()
const commitFormOpen = ref(false)
const message = ref('')
const push = ref(true)
const error = ref('')
const result = ref('')
const environment = computed(() => store.activeGitEnvironment)
const canCommit = computed(() => environment.value.isRepository && store.activeChanges.length && !store.activeProjectHasRun && !store.gitOperationBusy)

watch(() => store.environmentPanel, (open) => {
  if (!open) {
    commitFormOpen.value = false
    error.value = ''
    result.value = ''
  }
})

function close() { store.environmentPanel = false }
function showCommitForm() {
  result.value = ''
  error.value = ''
  push.value = Boolean(environment.value.upstream)
  commitFormOpen.value = true
}
async function revealProject() {
  if (store.activeProject) await desktop.revealPath(store.activeProject.path)
}
async function submitCommit() {
  error.value = ''
  result.value = ''
  try {
    const commit = await store.commitProjectChanges(message.value, push.value)
    if (!commit) return
    result.value = commit.pushed ? t('environment.pushedResult', { commit: commit.commit }) : t('environment.committedResult', { commit: commit.commit })
    message.value = ''
    commitFormOpen.value = false
  } catch (commitError) {
    error.value = String(commitError)
  }
}
</script>

<template>
  <Transition name="environment-panel">
    <div v-if="store.environmentPanel" class="environment-backdrop" @click.self="close">
      <aside class="environment-panel" :aria-label="t('environment.title')">
        <header>
          <strong>{{ t('environment.title') }}</strong>
          <button class="icon-button" :title="t('common.close')" @click="close"><X :size="17" /></button>
        </header>

        <button class="environment-row" :disabled="!store.activeChanges.length" @click="store.openChanges()">
          <FileDiff :size="18" />
          <span>{{ t('changes.label') }}</span>
          <b v-if="environment.additions || environment.deletions"><i>+{{ environment.additions }}</i><em>-{{ environment.deletions }}</em></b>
          <small v-else>{{ t('environment.clean') }}</small>
          <ChevronRight v-if="store.activeChanges.length" :size="16" />
        </button>
        <button class="environment-row" @click="revealProject">
          <FolderOpen :size="18" /><span>{{ t('environment.local') }}</span><small class="environment-path" :title="store.activeProject?.path">{{ store.activeProject?.path }}</small><ChevronRight :size="16" />
        </button>
        <div v-if="environment.isRepository" class="environment-row environment-branch">
          <GitBranch :size="18" /><span>{{ environment.branch }}</span>
          <small v-if="environment.upstream">{{ environment.upstream }}<template v-if="environment.ahead || environment.behind"> · ↑{{ environment.ahead }} ↓{{ environment.behind }}</template></small>
          <small v-else>{{ t('environment.noUpstream') }}</small>
        </div>
        <div v-else class="environment-unavailable">{{ t('environment.notRepository') }}</div>

        <div class="environment-divider"></div>
        <button class="environment-row environment-commit" :disabled="!canCommit" @click="showCommitForm">
          <Upload :size="18" /><span>{{ t('environment.commitPush') }}</span><ChevronRight :size="16" />
        </button>
        <p v-if="store.activeProjectHasRun" class="environment-note">{{ t('environment.waitForClaude') }}</p>
        <p v-else-if="environment.isRepository && !store.activeChanges.length" class="environment-note">{{ t('environment.noChanges') }}</p>

        <form v-if="commitFormOpen" class="commit-form" @submit.prevent="submitCommit">
          <strong>{{ t('environment.commitTitle') }}</strong>
          <p>{{ t('environment.commitSummary', { count: store.activeChanges.length, branch: environment.branch }) }}</p>
          <textarea v-model="message" :placeholder="t('environment.commitPlaceholder')" rows="3" autofocus></textarea>
          <label v-if="environment.upstream"><input v-model="push" type="checkbox" /> {{ t('environment.pushTo', { upstream: environment.upstream }) }}</label>
          <div class="commit-form-actions">
            <button type="button" class="secondary-button" @click="commitFormOpen = false">{{ t('common.cancel') }}</button>
            <button type="submit" class="primary-button" :disabled="!message.trim() || store.gitOperationBusy">
              {{ t(push ? 'environment.confirmCommitPush' : 'environment.confirmCommit') }}
            </button>
          </div>
          <small>{{ t('environment.commitWarning') }}</small>
        </form>
        <p v-if="result" class="environment-result">{{ result }}</p>
        <p v-if="error" class="environment-error">{{ error }}</p>
      </aside>
    </div>
  </Transition>
</template>
