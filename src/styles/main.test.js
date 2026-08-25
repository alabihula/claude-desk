import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const styles = readFileSync(new URL('./main.css', import.meta.url), 'utf8')

describe('queued message layout', () => {
  it('keeps the grid track and its flex row shrinkable for long commands', () => {
    expect(styles).toMatch(/\.queued-message-list\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/)
    expect(styles).toMatch(/\.queued-message-list article\s*\{[^}]*min-width:\s*0/)
  })
})

describe('conversation content containment', () => {
  it('keeps flex messages shrinkable and clips overflow at the conversation viewport', () => {
    expect(styles).toMatch(/\.message-scroller\s*\{[^}]*min-width:\s*0[^}]*overflow-x:\s*hidden/)
    expect(styles).toMatch(/\.message-column\s*\{[^}]*min-width:\s*0/)
    expect(styles).toMatch(/\.message\s*\{[^}]*min-width:\s*0[^}]*max-width:\s*100%/)
    expect(styles).toMatch(/\.message-surface\s*\{[^}]*min-width:\s*0[^}]*max-width:\s*100%/)
  })

  it('wraps long prose, inline code, and table cells while code blocks scroll locally', () => {
    expect(styles).toMatch(/\.message-body\s*\{[^}]*overflow-wrap:\s*anywhere[^}]*word-break:\s*break-word/)
    expect(styles).toMatch(/\.markdown-body code\s*\{[^}]*overflow-wrap:\s*anywhere[^}]*word-break:\s*break-word/)
    expect(styles).toMatch(/\.markdown-body pre\s*\{[^}]*max-width:\s*100%[^}]*overflow-x:\s*auto/)
    expect(styles).toMatch(/\.markdown-body pre code\s*\{[^}]*overflow-wrap:\s*normal[^}]*word-break:\s*normal/)
    expect(styles).toMatch(/\.markdown-body table\s*\{[^}]*max-width:\s*100%[^}]*table-layout:\s*fixed/)
    expect(styles).toMatch(/\.markdown-body th, \.markdown-body td\s*\{[^}]*overflow-wrap:\s*anywhere[^}]*word-break:\s*break-word/)
  })
})
