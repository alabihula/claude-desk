import { describe, expect, it } from 'vitest'
import { extractLocalFileCandidates, formatFileSize } from './localFiles'

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
})
