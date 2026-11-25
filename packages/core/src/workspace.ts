import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { readJsonFile, updateJson } from './config'
import { managedSettingsFiles } from './managed'
import { exists } from './fsutil'
import type { ClaudePaths } from './paths'
import { parseSkillMd } from './skill-parse'
import { discoverSkills } from './skills'
import { BUILTIN_COMMANDS } from './names'
import type { Ctx } from './backup'

const run = promisify(execFile)

// ---------- config files ----------
export interface ConfigFile { id: string; label: string; scope: 'managed' | 'user' | 'project' | 'local'; path: string; kind: 'json' | 'md'; readOnly: boolean; exists: boolean; project?: string }
export async function configFiles(paths: ClaudePaths, projects: string[]): Promise<ConfigFile[]> {
  const list: Omit<ConfigFile, 'id' | 'exists'>[] = [
    ...paths.managedDirs.flatMap((d) => [{ label: 'Managed settings', scope: 'managed' as const, path: path.join(d, 'managed-settings.json'), kind: 'json' as const, readOnly: true }]),
    { label: 'User settings', scope: 'user', path: paths.userSettings, kind: 'json', readOnly: false },
    { label: 'User instructions (CLAUDE.md)', scope: 'user', path: path.join(paths.claudeDir, 'CLAUDE.md'), kind: 'md', readOnly: false },
    ...projects.flatMap((p) => [
      { label: 'Project settings', scope: 'project' as const, path: path.join(p, '.claude', 'settings.json'), kind: 'json' as const, readOnly: false, project: p },
      { label: 'Local settings', scope: 'local' as const, path: path.join(p, '.claude', 'settings.local.json'), kind: 'json' as const, readOnly: false, project: p },
      { label: 'Project MCP (.mcp.json)', scope: 'project' as const, path: path.join(p, '.mcp.json'), kind: 'json' as const, readOnly: false, project: p },
      { label: 'Project instructions (CLAUDE.md)', scope: 'project' as const, path: path.join(p, 'CLAUDE.md'), kind: 'md' as const, readOnly: false, project: p },
      { label: 'Local instructions (CLAUDE.local.md)', scope: 'local' as const, path: path.join(p, 'CLAUDE.local.md'), kind: 'md' as const, readOnly: false, project: p }
    ])
  ]
  const dropins = (await managedSettingsFiles(paths)).filter((f) => f.file.includes(`${path.sep}managed-settings.d${path.sep}`)).map((f) => ({ label: `Managed drop-in ${path.basename(f.file)}`, scope: 'managed' as const, path: f.file, kind: 'json' as const, readOnly: true }))
  return Promise.all([...list, ...dropins].map(async (f) => ({ ...f, id: f.path, exists: await exists(f.path) })))
}
/** Renderer passes a path as id; accept only if it is one of the files we enumerate (no arbitrary file access). */
export async function resolveConfigFile(paths: ClaudePaths, projects: string[], id: string): Promise<ConfigFile> {
  const f = (await configFiles(paths, projects)).find((x) => x.id === id)
  if (!f) throw new Error('Not a recognised Claude configuration file')
  return f
}

// ---------- inheritance ----------
export interface Layer { scope: ConfigFile['scope']; file: string; exists: boolean; error?: string; keys: string[] }
export interface KeyView { key: string; values: { scope: string; value: unknown }[]; winner?: string; conflict: boolean }
/** Documented precedence (highest first): managed > local > project > user. Scalars: highest wins. Objects/arrays are shown per scope; merge semantics are not asserted. */
export async function inheritance(paths: ClaudePaths, project?: string): Promise<{ layers: Layer[]; keys: KeyView[] }> {
  const files = [
    ...(await managedSettingsFiles(paths)).reverse().map((f) => ({ scope: 'managed' as const, file: f.file })),
    ...(project ? [{ scope: 'local' as const, file: path.join(project, '.claude', 'settings.local.json') }, { scope: 'project' as const, file: path.join(project, '.claude', 'settings.json') }] : []),
    { scope: 'user' as const, file: paths.userSettings }
  ]
  const layers: Layer[] = [], datas: { scope: string; data: Record<string, unknown> }[] = []
  for (const f of files) {
    const j = await readJsonFile(f.file)
    layers.push({ ...f, exists: j.exists, error: j.error, keys: Object.keys(j.data) })
    datas.push({ scope: f.scope, data: j.data })
  }
  const allKeys = [...new Set(datas.flatMap((d) => Object.keys(d.data)))].sort()
  const keys = allKeys.map((key): KeyView => {
    const values = datas.filter((d) => key in d.data).map((d) => ({ scope: d.scope, value: d.data[key] }))
    const scalar = values.every((v) => v.value === null || typeof v.value !== 'object')
    const distinct = new Set(values.map((v) => JSON.stringify(v.value)))
    return { key, values, winner: values[0]?.scope, conflict: scalar && distinct.size > 1 }
  })
  return { layers, keys }
}

// ---------- agents ----------
export interface Agent { id: string; name: string; description: string; scope: 'user' | 'project' | 'plugin'; project?: string; file: string; model?: string; tools?: string; hooks?: unknown; errors: string[] }
export async function listAgents(paths: ClaudePaths, projects: string[]): Promise<Agent[]> {
  const out: Agent[] = []
  const scan = async (dir: string, scope: Agent['scope'], project?: string) => {
    for (const e of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (!e.name.endsWith('.md')) continue
      const file = path.join(dir, e.name), fm = parseSkillMd(await fs.readFile(file, 'utf8').catch(() => ''))
      out.push({ id: file, name: String(fm.frontmatter.name ?? e.name.replace(/\.md$/, '')), description: String(fm.frontmatter.description ?? ''), scope, project, file, model: fm.frontmatter.model as string | undefined, hooks: fm.frontmatter.hooks, tools: Array.isArray(fm.frontmatter.tools) ? fm.frontmatter.tools.join(', ') : (fm.frontmatter.tools as string | undefined), errors: fm.errors })
    }
  }
  await scan(path.join(paths.claudeDir, 'agents'), 'user')
  for (const p of projects) await scan(path.join(p, '.claude', 'agents'), 'project', p)
  for (const pl of await listPlugins(paths)) if (pl.installPath) await scan(path.join(pl.installPath, 'agents'), 'plugin', pl.id)
  return out
}

// ---------- plugins ----------
export interface PluginInfo { id: string; name: string; marketplace: string; version?: string; scope?: string; installPath?: string; enabled: boolean; components: { skills: number; commands: number; agents: number; hooks: boolean; mcp: boolean } }
export async function listPlugins(paths: ClaudePaths): Promise<PluginInfo[]> {
  const idx = (await readJsonFile(paths.pluginsIndex)).data as { plugins?: Record<string, any[]> }
  const enabled = ((await readJsonFile(paths.userSettings)).data.enabledPlugins ?? {}) as Record<string, boolean>
  const count = async (d: string) => (await fs.readdir(d, { withFileTypes: true }).catch(() => [])).filter((e) => !e.name.startsWith('.')).length
  return Promise.all(Object.entries(idx.plugins ?? {}).map(async ([id, installs]) => {
    const i = installs[0] ?? {}, root: string | undefined = i.installPath
    const [name, marketplace = ''] = id.split('@')
    return { id, name: name!, marketplace, version: i.version, scope: i.scope, installPath: root, enabled: enabled[id] === true,
      components: { skills: root ? await count(path.join(root, 'skills')) : 0, commands: root ? await count(path.join(root, 'commands')) : 0, agents: root ? await count(path.join(root, 'agents')) : 0, hooks: root ? await exists(path.join(root, 'hooks')) || await exists(path.join(root, 'hooks.json')) : false, mcp: root ? await exists(path.join(root, '.mcp.json')) : false } }
  }))
}
export const CLI_MISSING = 'The Claude Code CLI (`claude`) was not found on PATH. Install it from https://code.claude.com/docs/ or add it to PATH, then try again.'
/** Turn a spawn failure into something a person can act on. */
export function cliError(e: unknown): Error { const x = e as NodeJS.ErrnoException & { stderr?: string }; return x?.code === 'ENOENT' ? new Error(CLI_MISSING) : new Error((x?.stderr || x?.message || String(e)).trim()) }
const PLUGIN_ID = /^[A-Za-z0-9][\w.-]*(@[A-Za-z0-9][\w.-]*)?$/ // must not start with '-' (option injection)
/** Plugin lifecycle goes through the official `claude plugin` CLI (documented mechanism), with HOME pointed at the managed home. */
export async function pluginCli(paths: ClaudePaths, action: 'install' | 'enable' | 'disable' | 'uninstall', id: string): Promise<string> {
  if (!PLUGIN_ID.test(id)) throw new Error('Invalid plugin id')
  try { const { stdout, stderr } = await run('claude', ['plugin', action, id], { timeout: 120_000, env: { ...process.env, HOME: paths.home } }); return (stdout + stderr).trim() } catch (e) { throw cliError(e) }
}
/** Skill enable/disable: Claude's `skillOverrides: {name: "off"}` in user settings (observed key; reversible; removing it re-enables). */
export async function setSkillEnabled(ctx: Ctx, paths: ClaudePaths, name: string, enabled: boolean) {
  return updateJson(ctx, paths.userSettings, `skill ${enabled ? 'enable' : 'disable'} ${name}`, (d) => {
    const o = (d.skillOverrides ??= {}); if (enabled) delete o[name]; else o[name] = 'off'
    if (!Object.keys(o).length) delete d.skillOverrides
  })
}
export async function skillOverrides(paths: ClaudePaths): Promise<Record<string, string>> {
  return ((await readJsonFile(paths.userSettings)).data.skillOverrides ?? {}) as Record<string, string>
}

// ---------- commands ----------
export interface CommandInfo { name: string; description: string; kind: 'built-in' | 'skill' | 'custom' | 'plugin'; category: string; source: string; syntax: string }
export async function listCommands(paths: ClaudePaths, projects: string[]): Promise<CommandInfo[]> {
  const out: CommandInfo[] = BUILTIN_COMMANDS.map(([n, d, category]) => ({ name: `/${n}`, description: d, kind: 'built-in', category, source: 'Claude Code (curated)', syntax: `/${n}` }))
  for (const s of await discoverSkills({ claudeDir: paths.claudeDir, projects }))
    out.push({ name: `/${s.scope === 'plugin' && s.source ? `${s.source.split('@')[0]}:` : ''}${s.name}`, description: s.description, kind: s.scope === 'legacy-command' ? 'custom' : s.scope === 'plugin' ? 'plugin' : 'skill', category: s.scope === 'legacy-command' ? 'Custom' : s.scope === 'plugin' ? 'Plugins' : 'Skills', source: `${s.scope}${s.source ? ` · ${s.source}` : ''}`,
      syntax: `/${s.name}${s.frontmatter['argument-hint'] ? ' ' + String(s.frontmatter['argument-hint']) : ''}` })
  for (const pl of await listPlugins(paths)) if (pl.installPath)
    for (const e of await fs.readdir(path.join(pl.installPath, 'commands')).catch(() => [] as string[])) if (e.endsWith('.md')) {
      const fm = parseSkillMd(await fs.readFile(path.join(pl.installPath, 'commands', e), 'utf8').catch(() => '')).frontmatter, n = e.replace(/\.md$/, '')
      out.push({ name: `/${pl.name}:${n}`, description: String(fm.description ?? ''), kind: 'plugin', category: 'Plugins', source: pl.id, syntax: `/${pl.name}:${n}${fm['argument-hint'] ? ' ' + fm['argument-hint'] : ''}` })
    }
  return out
}

export async function validateProjectDir(dir: string): Promise<void> {
  const st = await fs.stat(dir).catch(() => null)
  if (!st?.isDirectory()) throw new Error('Not a directory')
  if (path.resolve(dir) === path.parse(dir).root) throw new Error('Refusing to register a filesystem root')
}

// ---------- config health ----------
export interface FileHealth { file: string; label: string; error: string }
/** Config files that exist but cannot be parsed. Claude Code reads these; when they are broken this app cannot list their contents and will not modify them. */
export async function configHealth(paths: ClaudePaths, projects: string[]): Promise<FileHealth[]> {
  const files: [string, string][] = [[paths.userJson, '~/.claude.json'], [paths.userSettings, '~/.claude/settings.json'], ...(await managedSettingsFiles(paths)).map((f): [string, string] => [f.file, `managed ${path.basename(f.file)}`]),
    ...projects.flatMap((p): [string, string][] => [[path.join(p, '.mcp.json'), `${path.basename(p)}/.mcp.json`], [path.join(p, '.claude', 'settings.json'), `${path.basename(p)}/.claude/settings.json`], [path.join(p, '.claude', 'settings.local.json'), `${path.basename(p)}/.claude/settings.local.json`]])]
  const out: FileHealth[] = []
  for (const [file, label] of files) { const j = await readJsonFile(file); if (j.exists && j.error) out.push({ file, label, error: j.error }) }
  return out
}
