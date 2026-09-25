// @vitest-environment happy-dom
import { createApp, h, nextTick, reactive } from 'vue'
import { createPinia } from 'pinia'
import { afterEach, describe, expect, it } from 'vitest'
import { useWorkspaceStore } from '../../stores/workspace'
import ActivityList from './ActivityList.vue'

let app
afterEach(() => { app?.unmount(); document.body.innerHTML = '' })

describe('execution details disclosure', () => {
  it('keeps live tasks outside collapsed details, including task-only runs and empty updates', async () => {
    const run = reactive({ status: 'running', tasks: [
      { id: '1', subject: '<img src=x onerror=alert(1)>', status: 'in_progress' },
      { id: '2', subject: '验证结果', status: 'pending' },
    ], timeline: [] })
    const root = document.createElement('div')
    document.body.appendChild(root)
    const pinia = createPinia()
    app = createApp({ render: () => h(ActivityList, { run }) }).use(pinia)
    useWorkspaceStore(pinia).settings.language = 'zh-CN'
    app.mount(root)
    expect(root.querySelector('.task-progress').closest('details')).toBeNull()
    expect(root.querySelector('.execution-details')).toBeNull()
    expect(root.querySelector('.task-progress img')).toBeNull()
    expect(root.querySelector('.task-progress').textContent).toContain('<img src=x onerror=alert(1)>')

    run.timeline.push({ id: 'thinking:a', type: 'thinking', text: '分析中', status: 'running' })
    run.tasks[0].status = 'completed'
    await nextTick()
    const details = root.querySelector('.execution-details')
    expect(details.open).toBe(false)
    expect(root.querySelector('.task-progress header').textContent).toContain('已完成 1/2')
    details.open = true
    run.tasks[1].status = 'completed'
    await nextTick()
    expect(details.open).toBe(true)
    expect(root.querySelectorAll('.task-progress')).toHaveLength(1)
    expect(root.querySelector('.task-progress header').textContent).toContain('已完成 2/2')
    run.tasks = []
    await nextTick()
    expect(root.querySelector('.task-progress')).toBeNull()
    expect(details.open).toBe(true)
  })

  it('stays collapsed by default, preserves user toggles during streaming, and keeps errors visible', async () => {
    const run = reactive({ status: 'running', activities: [], timeline: [
      { id: 'thinking:a', type: 'thinking', status: 'running', text: 'x'.repeat(4096) },
      { id: 'activity:a', type: 'activity', activity: { id: 'a', status: 'success', label: 'Reading file' } },
      { id: 'activity:b', type: 'activity', activity: { id: 'b', status: 'error', label: 'Reading missing file' } },
    ], error: 'Action failed', permissionDenied: true })
    const root = document.createElement('div')
    document.body.appendChild(root)
    const pinia = createPinia()
    app = createApp({ render: () => h(ActivityList, { run }) }).use(pinia)
    useWorkspaceStore(pinia).settings.language = 'zh-CN'
    app.mount(root)
    const outer = root.querySelector('.execution-details')
    const thinking = root.querySelector('.thinking-block')
    expect(outer.open).toBe(false)
    expect(thinking.open).toBe(false)
    expect(thinking.querySelector('summary').textContent).toBe('思考详情')
    expect(root.querySelector('.activity-errors').closest('details')).toBeNull()
    expect(root.querySelector('.run-error').textContent).toBe('Action failed')
    expect(root.querySelector('.permission-callout').closest('details')).toBeNull()
    outer.open = true
    thinking.open = true
    run.timeline[0].text += 'still streaming'
    run.timeline[0].status = 'complete'
    await nextTick()
    expect(outer.open).toBe(true)
    expect(thinking.open).toBe(true)
    outer.open = false
    run.timeline.push({ id: 'thinking:b', type: 'thinking', status: 'running', text: 'More' })
    await nextTick()
    expect(outer.open).toBe(false)
    expect(root.querySelectorAll('.thinking-block')[1].open).toBe(false)
  })
})
