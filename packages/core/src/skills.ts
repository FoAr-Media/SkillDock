import { promises as fs } from 'node:fs'
import path from 'node:path'
import { parseSkillMd } from './skill-parse'
import type { Skill, SkillScope } from './types'

const MAX_FILES = 500
const MAX_SKILL_MD = 1024 * 1024

async function listFiles(root: string): Promise<string[]> {
  const out: string[] = []
  const walk = async (dir: string, depth: number) => {
    if (depth > 6 || out.length >= MAX_FILES) return
    for (const e of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (e.name === '.git' || e.name === 'node_modules') continue
      const p = path.join(dir, e.name)
      if (e.isDirectory()) await walk(p, depth + 1)
      else if (e.isFile()) out.push(path.relative(root, p))
    }
  }
  await walk(root, 0)
  return out.sort()
}

async function readSkillDir(dir: string, scope: SkillScope, source?: string): Promise<Skill | null> {
  const skillFile = path.join(dir, 'SKILL.md')
  const st = await fs.stat(skillFile).catch(() => null) // stat follows symlinks
  if (!st?.isFile()) return null
  const errors: string[] = []
  let text = ''
  if (st.size > MAX_SKILL_MD) errors.push('SKILL.md exceeds 1 MiB; not parsed')
  else text = await fs.readFile(skillFile, 'utf8')
  const parsed = parseSkillMd(text)
  errors.push(...parsed.errors)
  const fm = parsed.frontmatter
  // A skill is a symlink only if ITS directory is one; an aliased ancestor (macOS /var, dotfile-managed ~/.claude) is not.
  const isLink = await fs.lstat(dir).then((l) => l.isSymbolicLink(), () => false)
  const real = isLink ? await fs.realpath(dir).catch(() => dir) : dir
  const name = typeof fm.name === 'string' && fm.name ? fm.name : path.basename(dir)
  return {
    id: `${scope}:${source ?? ''}:${path.basename(dir)}`,
    name,
    description: typeof fm.description === 'string' ? fm.description : '',
    scope, source, dir, skillFile,
    realPath: isLink && real !== dir ? real : undefined,
    frontmatter: fm,
    files: await listFiles(real),
    lastModified: st.mtime.toISOString(),
    errors
  }
}

async function scanRoot(root: string, scope: SkillScope, source?: string): Promise<Skill[]> {
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => [])
  const skills = await Promise.all(entries.filter((e) => !e.name.startsWith('.')).map((e) => readSkillDir(path.join(root, e.name), scope, source)))
  return skills.filter((s): s is Skill => s !== null)
}

async function scanLegacyCommands(root: string, scope: SkillScope, source?: string): Promise<Skill[]> {
  const out: Skill[] = []
  for (const e of await fs.readdir(root, { withFileTypes: true }).catch(() => [])) {
    if (!e.name.endsWith('.md')) continue
    const file = path.join(root, e.name)
    const st = await fs.stat(file).catch(() => null)
    if (!st?.isFile() || st.size > MAX_SKILL_MD) continue
    const parsed = parseSkillMd(await fs.readFile(file, 'utf8'))
    const base = e.name.replace(/\.md$/, '')
    out.push({
      id: `legacy-command:${source ?? ''}:${base}`, name: base,
      description: typeof parsed.frontmatter.description === 'string' ? parsed.frontmatter.description : '',
      scope: 'legacy-command', source, dir: root, skillFile: file, frontmatter: parsed.frontmatter,
      files: [e.name], lastModified: st.mtime.toISOString(), errors: parsed.errors.filter((x) => !x.startsWith('missing YAML'))
    })
  }
  return out
}

export interface DiscoverOptions { claudeDir: string; projects?: string[] }

/** Read-only discovery of user, project, plugin skills and legacy commands. */
export async function discoverSkills({ claudeDir, projects = [] }: DiscoverOptions): Promise<Skill[]> {
  const all: Skill[] = [
    ...(await scanRoot(path.join(claudeDir, 'skills'), 'user')),
    ...(await scanLegacyCommands(path.join(claudeDir, 'commands'), 'user'))
  ]
  for (const p of projects) {
    all.push(...(await scanRoot(path.join(p, '.claude', 'skills'), 'project', p)))
    all.push(...(await scanLegacyCommands(path.join(p, '.claude', 'commands'), 'project', p)))
  }
  // Plugin skills: installed_plugins.json is the documented-by-observation index; best effort.
  try {
    const idx = JSON.parse(await fs.readFile(path.join(claudeDir, 'plugins', 'installed_plugins.json'), 'utf8')) as { plugins?: Record<string, { installPath?: string }[]> }
    for (const [pluginId, installs] of Object.entries(idx.plugins ?? {})) {
      const installPath = installs[0]?.installPath
      if (installPath) all.push(...(await scanRoot(path.join(installPath, 'skills'), 'plugin', pluginId)))
    }
  } catch { /* no plugins index: nothing to add */ }
  return all.sort((a, b) => a.name.localeCompare(b.name))
}

/** Read one file inside a skill for preview. Rejects symlinks and anything resolving outside the skill root. */
export async function readSkillFile(root: string, rel: string, maxBytes = 300_000): Promise<string> {
  const { safeJoin } = await import('./fsutil'); const p = safeJoin(root, rel)
  const st = await fs.lstat(p); if (st.isSymbolicLink() || !st.isFile()) throw new Error('Not a regular file')
  const realRoot = await fs.realpath(root), real = await fs.realpath(p)
  if (real !== realRoot && !real.startsWith(realRoot + path.sep)) throw new Error('Path escapes the skill directory')
  if (st.size > maxBytes) throw new Error('File too large to preview')
  const b = await fs.readFile(p); if (b.includes(0)) throw new Error('Binary file'); return b.toString('utf8')
}
