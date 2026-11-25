import { execFile } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * Apps launched from Finder/the Dock inherit a minimal PATH (/usr/bin:/bin:…), so tools installed under Homebrew, nvm or ~/.local/bin
 * (claude, node, npm, uv) look "not installed". Merge the user's login-shell PATH plus well-known install dirs into process.env.PATH once at startup.
 */
export async function inheritShellPath(): Promise<void> {
  if (process.platform === 'win32') return
  const home = os.homedir(), dirs: string[] = []
  const shell = process.env.SHELL && path.isAbsolute(process.env.SHELL) ? process.env.SHELL : '/bin/zsh'
  await new Promise<void>((resolve) => {
    execFile(shell, ['-ilc', 'printf "__SDPATH__%s__SDPATH__" "$PATH"'], { timeout: 2500, env: { ...process.env, TERM: 'dumb' } }, (_e, out) => {
      const m = /__SDPATH__(.*)__SDPATH__/s.exec(String(out)); if (m?.[1]) dirs.push(...m[1].split(':')); resolve()
    })
  })
  // Fallbacks when the shell could not be queried (slow rc files, unusual shells).
  dirs.push(path.join(home, '.local/bin'), path.join(home, '.cargo/bin'), '/opt/homebrew/bin', '/usr/local/bin')
  const nvm = path.join(home, '.nvm/versions/node')
  if (existsSync(nvm)) for (const v of readdirSync(nvm).sort().reverse()) dirs.push(path.join(nvm, v, 'bin'))
  process.env.PATH = [...new Set([...dirs, ...(process.env.PATH ?? '').split(':')].filter((d) => d && existsSync(d)))].join(':')
}
