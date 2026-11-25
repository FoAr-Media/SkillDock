import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { promisify } from 'node:util'
import type { ToolStatus } from './types'

const run = promisify(execFile)

async function probe(id: string, label: string, cmd: string, args: string[] = ['--version']): Promise<ToolStatus> {
  try {
    const { stdout } = await run(cmd, args, { timeout: 5000 })
    return { id, label, status: 'connected', version: stdout.trim().split('\n')[0] }
  } catch {
    return { id, label, status: 'not-installed' }
  }
}

const exists = (p: string) => fs.stat(p).then(() => true, () => false)

export interface DetectOptions { claudeDir: string; desktopAppPaths?: string[] }

/** Read-only scan: runs only `<tool> --version` on a fixed allowlist. */
export async function detectEnvironment({ claudeDir, desktopAppPaths = [] }: DetectOptions): Promise<ToolStatus[]> {
  const desktop = (await Promise.all(desktopAppPaths.map(async (p) => ((await exists(p)) ? p : null)))).find(Boolean)
  const cfg = await exists(claudeDir)
  const tools = await Promise.all([
    probe('claude-code', 'Claude Code CLI', 'claude'),
    probe('git', 'Git', 'git'), probe('node', 'Node.js', 'node'), probe('npm', 'npm', 'npm'),
    probe('python', 'Python', 'python3'), probe('uv', 'uv', 'uv')
  ])
  return [
    ...tools,
    { id: 'claude-desktop', label: 'Claude Desktop', status: desktop ? 'connected' : 'not-installed', path: desktop ?? undefined },
    { id: 'claude-config', label: 'Claude user config', status: cfg ? 'connected' : 'config-missing', path: claudeDir }
  ]
}
