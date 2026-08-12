import { describe, expect, it } from 'vitest'
import { extractLocalFileCandidates, extractProjectFileReferences, fileSelectionPrompt, formatFileSize, selectionLineRange } from './localFiles'

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

  it('formats selected file context for the composer', () => {
    const content = 'first\nsecond\nthird'
    expect(fileSelectionPrompt('src/main.js', content, 6, 12, 'Review src/main.js line 2:')).toBe(
      'Review src/main.js line 2:\n\n```\nsecond\n```',
    )
    expect(fileSelectionPrompt('README.md', '````', 0, 4)).toContain('`````\n````\n`````')
  })
})
