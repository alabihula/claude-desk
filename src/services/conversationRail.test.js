import { describe, expect, it } from 'vitest'
import { activeTurnFromOffsets, conversationTurns } from './conversationRail'

describe('conversation rail', () => {
  it('creates one navigable marker per user turn', () => {
    const turns = conversationTurns([
      { id: 'system', role: 'system', content: 'Compacted' },
      { id: 'one', role: 'user', content: '帮我检查一下登录问题' },
      { id: 'answer', role: 'assistant', content: '我来看看。' },
      { id: 'two', role: 'user', content: '再补充一个边界条件' },
    ])
    expect(turns).toEqual([
      { id: 'one', index: 1, preview: '帮我检查一下登录问题' },
      { id: 'two', index: 2, preview: '再补充一个边界条件' },
    ])
  })

  it('selects the latest turn that has passed the reading position', () => {
    const turns = [{ id: 'one' }, { id: 'two' }, { id: 'three' }]
    expect(activeTurnFromOffsets(turns, [{ id: 'one', top: 20 }, { id: 'two', top: 150 }, { id: 'three', top: 340 }], 0)).toBe('one')
    expect(activeTurnFromOffsets(turns, [{ id: 'one', top: -220 }, { id: 'two', top: 30 }, { id: 'three', top: 300 }], 0)).toBe('two')
  })
})
