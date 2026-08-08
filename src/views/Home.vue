<script setup>
import { FolderPlus } from 'lucide-vue-next'
import { open } from '@tauri-apps/plugin-dialog'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useWorkspaceStore } from '../stores/workspace'
import BrandMark from '../components/common/BrandMark.vue'
import { useI18n } from '../services/i18n'
const store = useWorkspaceStore()
const { t } = useI18n()
async function add() { const path = await open({ directory: true, title: t('sidebar.addProject') }); if (path) await store.addProject(path) }
function dragWindow(event) { if (!event.target.closest('button')) getCurrentWindow().startDragging().catch(() => {}) }
</script>
<template><main class="home-empty" data-tauri-drag-region @mousedown.left="dragWindow"><BrandMark :size="58" /><h1>Claude Desk</h1><p>{{ t('home.subtitle') }}</p><button class="primary-button" @click="add"><FolderPlus :size="17" /> {{ t('home.addProject') }}</button><small>{{ t('home.localNote') }}</small></main></template>
