import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const styles = readFileSync(new URL('./main.css', import.meta.url), 'utf8')

describe('queued message layout', () => {
  it('keeps the grid track and its flex row shrinkable for long commands', () => {
    expect(styles).toMatch(/\.queued-message-list\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/)
    expect(styles).toMatch(/\.queued-message-list article\s*\{[^}]*min-width:\s*0/)
  })
})
