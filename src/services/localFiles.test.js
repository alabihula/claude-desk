import { describe, expect, it } from 'vitest'
import { extractLocalFileCandidates, extractProjectFileReferences, fileSelectionSnippet, fileSelectionsPrompt, formatFileSize, selectionLineRange } from './localFiles'

describe('local file references', () => {
  it('extracts generated files from inline code, links, and bare absolute paths', () => {
    const content = [
      '已生成：`/Users/xing.min/Documents/羽毛球/政策头条 截图识别.md`。',
      '[下载表格](./exports/report.xlsx)',
      '项目根目录还有 `README.md`。',
      '文件路径：/Users/xing.min/Documents/羽毛球/output/result.pdf，点击查看。',
    ].join('\n')
    expect(extractLocalFileCandidates(content)).toEqual([
      '/Users/xing.min/Documents/羽毛球/政策头条 截图识别.md',
      './exports/report.xlsx',
      'README.md',
      '/Users/xing.min/Documents/羽毛球/output/result.pdf',
    ])
  })

  it('ignores source references, shell snippets, remote URLs, and duplicates', () => {
    const content = '`src/main.js` `npm run build` https://example.com/report.pdf `/tmp/report.md` `/tmp/report.md`'
    expect(extractLocalFileCandidates(content)).toEqual(['/tmp/report.md'])
  })

  it('formats compact file sizes', () => {
    expect(formatFileSize(42)).toBe('42 B')
    expect(formatFileSize(1536)).toBe('1.5 KB')
    expect(formatFileSize(2 * 1024 ** 2)).toBe('2.0 MB')
  })

  it('extracts project file references without matching inside absolute paths', () => {
    const content = '`src/main.js:12` and components/Button.vue, not `/Users/x/claude-app/report.md`'
    expect(extractProjectFileReferences(content)).toEqual([
      { path: 'src/main.js', line: 12 },
      { path: 'components/Button.vue', line: null },
    ])
  })

  it('maps a text selection to its inclusive source line range', () => {
    const content = 'first\nsecond\nthird\n'
    expect(selectionLineRange(content, 6, 18)).toEqual({ startLine: 2, endLine: 3 })
    expect(selectionLineRange(content, 6, 13)).toEqual({ startLine: 2, endLine: 2 })
    expect(selectionLineRange(content, 4, 4)).toBeNull()
  })

  it('keeps selected file context structured until message dispatch', () => {
    const snippet = fileSelectionSnippet('src/main.js', 'first\nsecond\nthird', 6, 12)
    expect(snippet).toEqual({ path: 'src/main.js', startLine: 2, endLine: 2, content: 'second' })
    expect(fileSelectionsPrompt('Please review this.', [snippet])).toBe(
      'Please review this.\n\nSelected project file context:\n\nFile: src/main.js (line 2)\n```\nsecond\n```',
    )
    expect(fileSelectionsPrompt('', [{ ...snippet, path: 'README.md', content: '````' }])).toContain('`````\n````\n`````')
    expect(fileSelectionsPrompt('', [snippet])).toMatch(/^Selected project file context:/)
  })
})
