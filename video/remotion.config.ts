import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { Config } from '@remotion/cli/config'

Config.setVideoImageFormat('jpeg')
Config.setJpegQuality(95)
Config.setOverwriteOutput(true)
Config.setConcurrency(4)

// On this machine Remotion's downloaded chrome-headless-shell exits on launch, so prefer
// an explicit browser: $REMOTION_BROWSER, else Playwright's headless shell if installed.
function findBrowser(): string | null {
  if (process.env.REMOTION_BROWSER) return process.env.REMOTION_BROWSER
  const root = join(homedir(), 'Library', 'Caches', 'ms-playwright')
  if (!existsSync(root)) return null
  for (const dir of readdirSync(root).filter((d) => d.startsWith('chromium_headless_shell-')).sort().reverse()) {
    for (const sub of readdirSync(join(root, dir))) {
      const exe = join(root, dir, sub, 'chrome-headless-shell')
      if (existsSync(exe)) return exe
    }
  }
  return null
}
const browser = findBrowser()
if (browser) Config.setBrowserExecutable(browser)
