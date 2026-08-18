import { describe, expect, it } from 'vitest'
import { applyRunTaskEvent, taskEventFromToolUse } from './tasks'

function run() {
  return { tasks: [], taskToolUses: {} }
}

describe('Claude task tracking', () => {
  it('normalizes Task tools and the raw key variants repaired by Claude Code', () => {
    expect(taskEventFromToolUse({
      id: 'create-1', name: 'TaskCreate',
      input: { subject: 'Compile changes', description: 'Run the build', activeForm: 'Compiling changes' },
    })).toMatchObject({
      type: 'task-create', toolUseId: 'create-1',
      task: { subject: 'Compile changes', activeForm: 'Compiling changes', status: 'pending' },
    })
    expect(taskEventFromToolUse({
      id: 'update-1', name: 'TaskUpdate', input: { task_id: 7, active_form: 'Running tests', status: 'in_progress' },
    })).toMatchObject({
      type: 'task-update', taskId: '7', changes: { activeForm: 'Running tests', status: 'in_progress' },
    })
  })

  it('creates one live task, captures its returned id, and applies status updates', () => {
    const current = run()
    const create = taskEventFromToolUse({
      id: 'create-1', name: 'TaskCreate',
      input: { subject: 'Compile changes', description: 'Run the build', activeForm: 'Compiling changes' },
    })
    applyRunTaskEvent(current, create)
    applyRunTaskEvent(current, create)
    expect(current.tasks).toHaveLength(1)

    applyRunTaskEvent(current, {
      type: 'activity-complete', id: 'create-1', error: false,
      result: { task: { id: '1', subject: 'Compile changes' } },
    })
    applyRunTaskEvent(current, taskEventFromToolUse({
      id: 'update-1', name: 'TaskUpdate', input: { taskId: '1', status: 'in_progress' },
    }))
    applyRunTaskEvent(current, taskEventFromToolUse({
      id: 'update-2', name: 'TaskUpdate', input: { taskId: '1', status: 'completed' },
    }))

    expect(current.tasks).toEqual([expect.objectContaining({
      id: '1', subject: 'Compile changes', activeForm: 'Compiling changes', status: 'completed',
    })])
  })

  it('supports compatible gateways that return a plain-text id and omit subject', () => {
    const current = run()
    applyRunTaskEvent(current, taskEventFromToolUse({
      id: 'create-1', name: 'TaskCreate',
      input: { activeForm: 'Testing the app', description: 'Run the dev server and verify the result' },
    }))
    applyRunTaskEvent(current, {
      type: 'activity-complete', id: 'create-1', error: false,
      result: 'Task #4 created successfully: Run the dev server and verify the result',
    })

    expect(current.tasks).toEqual([expect.objectContaining({
      id: '4', subject: 'Testing the app', activeForm: 'Testing the app', status: 'pending',
    })])
  })

  it('merges an update that arrives before the matching create result', () => {
    const current = run()
    applyRunTaskEvent(current, taskEventFromToolUse({
      id: 'create-1', name: 'TaskCreate', input: { subject: 'Run tests', description: 'Verify changes' },
    }))
    applyRunTaskEvent(current, taskEventFromToolUse({
      id: 'update-1', name: 'TaskUpdate', input: { taskId: '1', status: 'in_progress' },
    }))
    applyRunTaskEvent(current, {
      type: 'activity-complete', id: 'create-1', error: false,
      result: '{"task":{"id":"1","subject":"Run tests"}}',
    })

    expect(current.tasks).toEqual([expect.objectContaining({ id: '1', subject: 'Run tests', status: 'in_progress' })])
  })

  it('rolls back failed creates and updates without leaving stale progress', () => {
    const current = run()
    applyRunTaskEvent(current, taskEventFromToolUse({
      id: 'create-1', name: 'TaskCreate', input: { subject: 'Run tests', description: 'Verify changes' },
    }))
    applyRunTaskEvent(current, { type: 'activity-complete', id: 'create-1', error: true })
    expect(current.tasks).toEqual([])

    current.tasks.push({ id: '1', subject: 'Build', description: '', activeForm: '', status: 'pending' })
    applyRunTaskEvent(current, taskEventFromToolUse({
      id: 'update-1', name: 'TaskUpdate', input: { taskId: '1', status: 'completed' },
    }))
    applyRunTaskEvent(current, { type: 'activity-complete', id: 'update-1', error: true })
    expect(current.tasks[0].status).toBe('pending')
  })

  it('supports TodoWrite snapshots, task deletion, and structured TaskList results', () => {
    const current = run()
    applyRunTaskEvent(current, taskEventFromToolUse({
      id: 'todo-1', name: 'TodoWrite', input: { todos: [
        { content: 'Inspect code', activeForm: 'Inspecting code', status: 'completed' },
        { content: 'Build app', activeForm: 'Building app', status: 'in_progress' },
      ] },
    }))
    expect(current.tasks.map((task) => task.status)).toEqual(['completed', 'in_progress'])

    applyRunTaskEvent(current, taskEventFromToolUse({
      id: 'delete-1', name: 'TaskUpdate', input: { taskId: 'todo:1', status: 'deleted' },
    }))
    expect(current.tasks.map((task) => task.id)).toEqual(['todo:2'])

    applyRunTaskEvent(current, taskEventFromToolUse({ id: 'list-1', name: 'TaskList', input: {} }))
    applyRunTaskEvent(current, {
      type: 'activity-complete', id: 'list-1', error: false,
      result: { tasks: [{ id: '8', subject: 'Package app', status: 'pending' }] },
    })
    expect(current.tasks).toEqual([expect.objectContaining({ id: '8', subject: 'Package app', status: 'pending' })])
  })
})
