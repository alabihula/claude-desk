const TASK_TOOL_NAMES = new Set(['TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet', 'TodoWrite'])

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function taskId(input = {}) {
  const value = input.taskId ?? input.id ?? input.task_id
  return value === undefined || value === null ? '' : String(value)
}

function activeForm(input = {}) {
  return cleanText(input.activeForm || input.active_form)
}

function taskSubject(input = {}) {
  return cleanText(input.subject || input.content || activeForm(input) || input.description)
}

function normalizedTask(input = {}, fallbackId = '') {
  const id = taskId(input) || fallbackId
  const subject = taskSubject(input)
  return {
    id,
    subject: subject || (id ? `Task #${id}` : 'Task'),
    description: cleanText(input.description),
    activeForm: activeForm(input),
    status: ['pending', 'in_progress', 'completed'].includes(input.status) ? input.status : 'pending',
  }
}

export function taskEventFromToolUse(block = {}) {
  if (!TASK_TOOL_NAMES.has(block.name)) return null
  const input = block.input && typeof block.input === 'object' ? block.input : {}
  const toolUseId = cleanText(block.id)

  if (block.name === 'TaskCreate') {
    const hasDetails = Boolean(taskSubject(input) || cleanText(input.description))
    return {
      type: 'task-create',
      toolUseId,
      task: hasDetails ? normalizedTask(input, `pending:${toolUseId}`) : null,
    }
  }
  if (block.name === 'TaskUpdate') {
    return {
      type: 'task-update',
      toolUseId,
      taskId: taskId(input),
      changes: {
        subject: cleanText(input.subject || input.content),
        description: cleanText(input.description),
        activeForm: activeForm(input),
        status: cleanText(input.status),
      },
    }
  }
  if (block.name === 'TodoWrite') {
    return {
      type: 'tasks-replace',
      toolUseId,
      tasks: Array.isArray(input.todos)
        ? input.todos.map((task, index) => normalizedTask(task, `todo:${index + 1}`))
        : null,
    }
  }
  return { type: 'task-query', toolUseId, query: block.name === 'TaskList' ? 'list' : 'get' }
}

function ensureTaskState(run) {
  run.tasks ||= []
  run.taskToolUses ||= {}
}

function cloneTasks(tasks) {
  return tasks.map((task) => ({ ...task }))
}

function parsedContent(content) {
  if (Array.isArray(content)) {
    const text = content.map((item) => cleanText(item?.text || item?.content)).filter(Boolean).join('\n')
    return text ? parsedContent(text) : content
  }
  if (content && typeof content === 'object') return content
  const text = cleanText(content)
  if (!text || !['{', '['].includes(text[0])) return text
  try { return JSON.parse(text) } catch { return text }
}

function resultTask(content) {
  const value = parsedContent(content)
  const candidate = value?.task && typeof value.task === 'object' ? value.task : value
  if (candidate && !Array.isArray(candidate) && typeof candidate === 'object' && taskId(candidate)) {
    return normalizedTask(candidate)
  }
  if (typeof value === 'string') {
    const match = value.match(/Task\s+#?([^\s:]+)\s+created\b/i)
    if (match) return normalizedTask({ id: match[1] })
  }
  return null
}

function resultTasks(content) {
  const value = parsedContent(content)
  const tasks = Array.isArray(value) ? value : value?.tasks
  return Array.isArray(tasks) ? tasks.map((task, index) => normalizedTask(task, `task:${index + 1}`)) : null
}

function mergeCreatedTask(run, pendingId, result) {
  const pendingIndex = run.tasks.findIndex((task) => task.id === pendingId)
  const existingIndex = run.tasks.findIndex((task) => task.id === result.id)
  const pending = pendingIndex >= 0 ? run.tasks[pendingIndex] : null
  const existing = existingIndex >= 0 ? run.tasks[existingIndex] : null
  const placeholder = `Task #${result.id}`
  const subject = existing?.subject && existing.subject !== placeholder
    ? existing.subject
    : result.subject !== placeholder ? result.subject : pending?.subject || result.subject
  const merged = {
    ...pending,
    ...result,
    ...existing,
    id: result.id,
    subject,
    description: existing?.description || pending?.description || result.description,
    activeForm: existing?.activeForm || pending?.activeForm || result.activeForm,
    status: existing?.status || pending?.status || result.status,
  }

  if (pendingIndex >= 0) run.tasks.splice(pendingIndex, 1)
  const nextExistingIndex = run.tasks.findIndex((task) => task.id === result.id)
  if (nextExistingIndex >= 0) run.tasks.splice(nextExistingIndex, 1, merged)
  else run.tasks.push(merged)
}

function restoreTasks(run, binding) {
  if (binding.before) run.tasks.splice(0, run.tasks.length, ...cloneTasks(binding.before))
}

export function applyRunTaskEvent(run, event) {
  ensureTaskState(run)

  if (event.type === 'task-create') {
    const existing = run.taskToolUses[event.toolUseId]
    if (existing?.resolved) return true
    const binding = existing || { kind: 'create', taskId: event.task?.id || '' }
    run.taskToolUses[event.toolUseId] = binding
    if (!event.task) return true
    if (!binding.taskId) binding.taskId = event.task.id
    const task = run.tasks.find((item) => item.id === binding.taskId)
    if (task) Object.assign(task, event.task, { id: binding.taskId })
    else run.tasks.push({ ...event.task, id: binding.taskId })
    return true
  }

  if (event.type === 'task-update') {
    const existing = run.taskToolUses[event.toolUseId]
    if (existing?.applied || existing?.resolved || !event.taskId) return true
    const binding = { kind: 'update', taskId: event.taskId, before: cloneTasks(run.tasks), applied: true }
    run.taskToolUses[event.toolUseId] = binding
    if (event.changes.status === 'deleted') {
      const index = run.tasks.findIndex((task) => task.id === event.taskId)
      if (index >= 0) run.tasks.splice(index, 1)
      return true
    }
    let task = run.tasks.find((item) => item.id === event.taskId)
    if (!task) {
      task = normalizedTask({ id: event.taskId })
      run.tasks.push(task)
    }
    for (const key of ['subject', 'description', 'activeForm']) {
      if (event.changes[key]) task[key] = event.changes[key]
    }
    if (['pending', 'in_progress', 'completed'].includes(event.changes.status)) task.status = event.changes.status
    return true
  }

  if (event.type === 'tasks-replace') {
    const existing = run.taskToolUses[event.toolUseId]
    if (existing?.applied || existing?.resolved || !event.tasks) return true
    run.taskToolUses[event.toolUseId] = {
      kind: 'replace', before: cloneTasks(run.tasks), applied: true,
    }
    run.tasks.splice(0, run.tasks.length, ...cloneTasks(event.tasks))
    return true
  }

  if (event.type === 'task-query') {
    run.taskToolUses[event.toolUseId] ||= { kind: event.query }
    return true
  }

  if (event.type !== 'activity-complete') return false
  const binding = run.taskToolUses[event.id]
  if (!binding) return false
  if (binding.resolved) return true
  binding.resolved = true

  if (event.error) {
    if (binding.kind === 'create' && binding.taskId) {
      const index = run.tasks.findIndex((task) => task.id === binding.taskId)
      if (index >= 0) run.tasks.splice(index, 1)
    } else restoreTasks(run, binding)
    return true
  }

  if (binding.kind === 'create') {
    const result = resultTask(event.result)
    if (result?.id) {
      mergeCreatedTask(run, binding.taskId, result)
      binding.taskId = result.id
    }
  } else if (binding.kind === 'list') {
    const tasks = resultTasks(event.result)
    if (tasks) run.tasks.splice(0, run.tasks.length, ...tasks)
  } else if (binding.kind === 'get') {
    const task = resultTask(event.result)
    const existing = task && run.tasks.find((item) => item.id === task.id)
    if (existing) Object.assign(existing, task)
    else if (task) run.tasks.push(task)
  }
  return true
}
