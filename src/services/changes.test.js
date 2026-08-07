import { describe, expect, it } from 'vitest'
import { changeStatusLabel, preferredChange } from './changes'

describe('preferredChange', () => {
  it('opens a reviewable text change before binary assets', () => {
    const files = [{ path: 'preview.png' }, { path: 'src/App.vue' }]
    expect(preferredChange(files)).toEqual(files[1])
  })

  it('falls back to the first change and handles an empty list', () => {
    const files = [{ path: 'preview.png' }, { path: 'movie.mp4' }]
    expect(preferredChange(files)).toEqual(files[0])
    expect(preferredChange([])).toBeNull()
  })

  it('turns raw porcelain status into a clear user-facing label', () => {
    expect(changeStatusLabel('??')).toBe('New')
    expect(changeStatusLabel(' M')).toBe('M')
    expect(changeStatusLabel('R ')).toBe('R')
  })
})
