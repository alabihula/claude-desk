import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
const require = createRequire(import.meta.url)
const playwrightRequire = createRequire(require.resolve('@playwright/mcp/package.json'))
const cli = join(dirname(playwrightRequire.resolve('playwright/package.json')), 'cli.js')
const result = spawnSync(process.execPath, [cli, 'install', 'chromium'], { stdio: 'inherit', windowsHide: true })
process.exit(result.status ?? 1)
