import { describe, expect, it } from 'vitest'
import { sideBySideDiff } from './diff'

describe('sideBySideDiff', () => {
  it('aligns removed and added lines from a unified hunk', () => {
    const rows = sideBySideDiff('diff --git a/a.js b/a.js\n--- a/a.js\n+++ b/a.js\n@@ -2,2 +2,3 @@\n keep\n-old\n+new\n+extra\n end')
    expect(rows).toEqual([
      { type: 'hunk', text: '@@ -2,2 +2,3 @@' },
      { type: 'context', old: { number: 2, text: 'keep', kind: 'context' }, next: { number: 2, text: 'keep', kind: 'context' } },
      { type: 'change', old: { number: 3, text: 'old', kind: 'deletion' }, next: { number: 3, text: 'new', kind: 'addition' } },
      { type: 'change', old: null, next: { number: 4, text: 'extra', kind: 'addition' } },
      { type: 'context', old: { number: 4, text: 'end', kind: 'context' }, next: { number: 5, text: 'end', kind: 'context' } },
    ])
  })

  it('renders an untracked text file as additions on the right side', () => {
    expect(sideBySideDiff('+first\n+second')).toEqual([
      { type: 'change', old: null, next: { number: 1, text: 'first', kind: 'addition' } },
      { type: 'change', old: null, next: { number: 2, text: 'second', kind: 'addition' } },
    ])
  })
})
