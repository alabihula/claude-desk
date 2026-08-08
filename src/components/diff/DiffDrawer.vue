<script setup>
import { computed } from 'vue'
import { ExternalLink, X } from 'lucide-vue-next'
import { useWorkspaceStore } from '../../stores/workspace'
import { changeStatusLabel } from '../../services/changes'
import { useI18n } from '../../services/i18n'

const store = useWorkspaceStore()
const { t } = useI18n()
const lines = computed(() => (store.diffDrawer?.content || '').split('\n'))
function lineKind(line) {
  if (line.startsWith('+') && !line.startsWith('+++')) return 'addition'
  if (line.startsWith('-') && !line.startsWith('---')) return 'deletion'
  if (line.startsWith('@@')) return 'hunk'
  return ''
}
async function openFile() {
  const file = store.diffDrawer?.file
  if (!file) return
  await store.openFile(`${store.activeProject.path}/${file.path}`)
  if (store.settings.editor === 'claude-desk') store.diffDrawer = null
}
</script>

<template>
  <Transition name="drawer">
    <div v-if="store.diffDrawer" class="drawer-backdrop" @click.self="store.diffDrawer = null">
      <aside class="diff-drawer">
        <header>
          <div><span class="eyebrow">{{ t('changes.label') }}</span><strong>{{ store.diffDrawer.file.path }}</strong></div>
          <div class="drawer-actions">
            <button class="icon-button" :title="t('changes.openEditor')" @click="openFile"><ExternalLink :size="17" /></button>
            <button class="icon-button" :title="t('common.close')" @click="store.diffDrawer = null"><X :size="18" /></button>
          </div>
        </header>
        <nav class="diff-file-list">
          <button v-for="file in store.activeChanges" :key="file.path" :class="{ active: file.path === store.diffDrawer.file.path }" @click="store.openDiff(file)">
            <span>{{ file.status.trim() === '??' ? t('changes.new') : changeStatusLabel(file.status) }}</span>{{ file.path }}
          </button>
        </nav>
        <div v-if="store.diffDrawer.loading" class="diff-empty">{{ t('changes.loading') }}</div>
        <div v-else-if="store.diffDrawer.error" class="diff-empty diff-error">
          <strong>{{ t('common.previewUnavailable') }}</strong><span>{{ store.diffDrawer.error }}</span>
        </div>
        <div v-else-if="store.diffDrawer.content" class="diff-content">
          <div v-for="(line, index) in lines" :key="index" class="diff-line" :class="lineKind(line)">
            <span class="line-number">{{ index + 1 }}</span><code>{{ line || ' ' }}</code>
          </div>
        </div>
        <div v-else class="diff-empty">{{ t('changes.binary') }}</div>
      </aside>
    </div>
  </Transition>
</template>
