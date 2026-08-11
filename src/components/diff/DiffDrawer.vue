<script setup>
import { computed } from 'vue'
import { ExternalLink, X } from 'lucide-vue-next'
import { useWorkspaceStore } from '../../stores/workspace'
import { changeStatusLabel } from '../../services/changes'
import { sideBySideDiff } from '../../services/diff'
import { useI18n } from '../../services/i18n'

const store = useWorkspaceStore()
const { t } = useI18n()
const rows = computed(() => sideBySideDiff(store.diffDrawer?.content))
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
        <div v-else-if="store.diffDrawer.content" class="diff-content diff-split">
          <div v-for="(row, index) in rows" :key="index" class="diff-split-row" :class="row.type">
            <code v-if="row.type === 'hunk'" class="diff-hunk">{{ row.text }}</code>
            <template v-else>
              <div class="diff-cell old" :class="[row.old?.kind, { empty: !row.old }]">
                <span class="line-number">{{ row.old?.number || '' }}</span><code>{{ row.old?.text || ' ' }}</code>
              </div>
              <div class="diff-cell next" :class="[row.next?.kind, { empty: !row.next }]">
                <span class="line-number">{{ row.next?.number || '' }}</span><code>{{ row.next?.text || ' ' }}</code>
              </div>
            </template>
          </div>
        </div>
        <div v-else class="diff-empty">{{ t('changes.binary') }}</div>
      </aside>
    </div>
  </Transition>
</template>
