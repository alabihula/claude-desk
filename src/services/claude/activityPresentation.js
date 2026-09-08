// Keep the working surface bounded without losing diagnostics or tool history.
export function activityPresentation(run) {
  const entries = run.timeline?.length ? run.timeline
    : (run.activities || []).map((activity) => ({ id: `activity:${activity.id}`, type: 'activity', activity }))
  const tools = entries.filter((entry) => entry.type === 'activity')
  const active = ['starting', 'running', 'finishing', 'stopping'].includes(run.status)
  return {
    entries,
    current: active ? tools.filter((entry) => entry.activity.status === 'running').slice(-2) : [],
    errors: tools.filter((entry) => entry.activity.status === 'error'),
    completed: tools.filter((entry) => entry.activity.status === 'success').length,
    total: tools.length,
  }
}
