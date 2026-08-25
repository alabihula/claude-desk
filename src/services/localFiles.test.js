import { describe, expect, it } from 'vitest'
import { extractLocalFileCandidates, extractProjectFileReferences, fileSelectionSnippet, fileSelectionsPrompt, formatFileSize, localProjectLink, projectFileOpenMode, selectionLineRange } from './localFiles'

describe('local file references', () => {
  it('extracts only explicit local download links', () => {
    const content = [
      '已生成：`/Users/xing.min/Documents/羽毛球/政策头条 截图识别.md`。',
      '[下载表格](./exports/report.xlsx)',
      '[Download archive](./exports/source.zip)',
      '[查看报告](./exports/report.pdf)',
      '项目根目录还有 `README.md`。',
      '文件路径：/Users/xing.min/Documents/羽毛球/output/result.pdf，点击查看。',
    ].join('\n')
    expect(extractLocalFileCandidates(content)).toEqual([
      './exports/report.xlsx',
      './exports/source.zip',
    ])
  })

  it('ignores read file references, remote links, and duplicate downloads', () => {
    const content = [
      '读过 `package.json` 和 `packages/web/cordis.patch.yml`。',
      '绝对路径 `/Users/x/project/src/App.vue` 也只是引用。',
      '[下载官网](https://example.com/report.pdf)',
      '[下载报告](./exports/report.pdf)',
      '[再次下载](./exports/report.pdf)',
    ].join('\n')
    expect(extractLocalFileCandidates(content)).toEqual(['./exports/report.pdf'])
  })

  it('recognizes safe project links without treating remote or page links as files', () => {
    const target = (href) => ({ closest: () => ({ getAttribute: () => href }) })
    expect(localProjectLink(target('./exports/page%20preview.html'))).toBe('./exports/page preview.html')
    expect(localProjectLink(target('https://example.com/report.pdf'))).toBeNull()
    expect(localProjectLink(target('#details'))).toBeNull()
  })

  it('routes mainstream images and HTML while revealing unsupported deliverables', () => {
    expect(projectFileOpenMode('SCREENSHOT.PNG')).toBe('image')
    expect(projectFileOpenMode('preview.html')).toBe('html')
    expect(projectFileOpenMode('src/App.vue')).toBe('text')
    expect(projectFileOpenMode('README')).toBe('text')
    expect(projectFileOpenMode('report.pdf')).toBe('reveal')
    expect(projectFileOpenMode('archive.zip')).toBe('reveal')
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
