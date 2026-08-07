<script setup>
import { FolderPlus } from 'lucide-vue-next'
import { open } from '@tauri-apps/plugin-dialog'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useWorkspaceStore } from '../stores/workspace'
import BrandMark from '../components/common/BrandMark.vue'
const store = useWorkspaceStore()
async function add() { const path = await open({ directory: true, title: 'Add a project to Claude Desk' }); if (path) await store.addProject(path) }
function dragWindow(event) { if (!event.target.closest('button')) getCurrentWindow().startDragging().catch(() => {}) }
</script>
<template><main class="home-empty" data-tauri-drag-region @mousedown.left="dragWindow"><BrandMark :size="58" /><h1>Claude Desk</h1><p>Your Claude Code workspace.</p><button class="primary-button" @click="add"><FolderPlus :size="17" /> Add Project</button><small>Projects stay on your Mac. Removing one here never deletes its files.</small></main></template>
