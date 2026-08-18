// @vitest-environment happy-dom
import { createApp, h } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useWorkspaceStore } from '../../stores/workspace'
import TaskProgress from './TaskProgress.vue'

let app
let root

beforeEach(() => {
  const pinia = createPinia()
  setActivePinia(pinia)
  useWorkspaceStore().settings.language = 'zh-CN'
  root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp({
    render: () => h(TaskProgress, { tasks: [
      { id: '1', subject: '读取代码', activeForm: '正在读取代码', status: 'completed' },
      { id: '2', subject: '补充单测', activeForm: '正在补充单测', status: 'in_progress' },
      { id: '3', subject: '编译验证', activeForm: '正在编译验证', status: 'pending' },
    ] }),
  })
  app.use(pinia)
  app.mount(root)
})

afterEach(() => {
  app.unmount()
  document.body.innerHTML = ''
})

describe('TaskProgress', () => {
  it('renders a localized progress title and checkbox state for every task', () => {
    expect(root.querySelector('header').textContent).toContain('任务进度')
    expect(root.querySelector('header').textContent).toContain('已完成 1/3')
    expect(root.querySelectorAll('.task-progress-item')).toHaveLength(3)
    expect(root.querySelector('.task-completed').textContent).toContain('读取代码')
    expect(root.querySelector('.task-in_progress').textContent).toContain('正在补充单测')
    expect(root.querySelector('.task-pending').textContent).toContain('编译验证')
    expect(root.querySelector('.task-completed .task-checkbox svg')).not.toBeNull()
    expect(root.querySelector('.task-pending .task-checkbox svg')).toBeNull()
  })
})
