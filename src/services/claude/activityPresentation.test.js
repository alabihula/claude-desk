import { describe, expect, it } from 'vitest'
import { activityPresentation } from './activityPresentation'

describe('bounded activity presentation', () => {
  it('retains all history but surfaces only two active operations and every error', () => {
    const activities = Array.from({ length: 50 }, (_, i) => ({ id: String(i), status: i < 45 ? 'success' : i < 49 ? 'running' : 'error' }))
    const view = activityPresentation({ activities, status: 'running' })
    expect(view.entries).toHaveLength(50)
    expect(view.current.map((entry) => entry.activity.id)).toEqual(['47', '48'])
    expect(view.errors).toHaveLength(1)
    expect(view.completed).toBe(45)
  })
  it('does not imply stopped operations are still running and tolerates missing data', () => {
    expect(activityPresentation({}).entries).toEqual([])
    expect(activityPresentation({ activities: [{ id: 'a', status: 'running' }], status: 'stopped' }).current).toEqual([])
  })
})
