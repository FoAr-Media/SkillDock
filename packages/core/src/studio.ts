import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { stringify } from 'yaml'
import { runTransaction } from './backup'
import { safeJoin } from './fsutil'
import type { InstallEnv, Target } from './install'
import { skillsBase } from './install'
import { scanDir } from './security'
import { parseSkillMd } from './skill-parse'
import { discoverSkills } from './skills'

const run = promisify(execFile)
export type SkillFiles = Record<string, string>

export interface Template { id: string; label: string; description: string; instructions: string }
const T = (id: string, label: string, description: string, instructions: string): Template => ({ id, label, description, instructions })
export const TEMPLATES: Template[] = [
  T('frontend', 'Frontend development', 'Use when building or modifying UI components, layouts or styling in a web frontend.', '## Process\n1. Inspect the existing component library and styling conventions before writing code.\n2. Reuse existing components; add new ones only when needed.\n3. Handle loading, empty and error states.\n4. Check keyboard access and color contrast.\n\n## Output\nSmall, focused diffs that follow the project style.'),
  T('api', 'API development', 'Use when designing, implementing or documenting HTTP APIs.', '## Process\n1. Read existing routes, error format and auth middleware.\n2. Validate all input at the boundary.\n3. Return consistent error shapes and status codes.\n4. Add or update tests and API docs.\n\n## Output\nImplementation plus a short summary of changed endpoints.'),
  T('code-review', 'Code review', 'Use when asked to review a diff, pull request or file for bugs and risks.', '## Process\n1. Read the whole change before commenting.\n2. Prioritize correctness, security, then maintainability.\n3. Cite file and line for each finding.\n\n## Output\nA ranked list: severity, location, problem, suggested fix. Say explicitly if nothing was found.'),
  T('unit-testing', 'Unit testing', 'Use when writing or fixing unit tests.', '## Process\n1. Find the test runner and conventions already in use.\n2. Cover the happy path, edge cases and failure modes.\n3. Keep tests deterministic and independent.\n4. Run the suite and report real results.\n\n## Output\nNew or changed tests and the test run output.'),
  T('video-editing', 'Video editing', 'Use when trimming, concatenating, captioning or converting video files with ffmpeg.', '## Requirements\n- ffmpeg installed and on PATH.\n\n## Process\n1. Probe input with ffprobe before choosing options.\n2. Never overwrite the source; write to a new file.\n3. Show the exact ffmpeg command before running it.\n\n## Output\nPath of the produced file and the command used.'),
  T('content-creation', 'Content creation', 'Use when drafting articles, posts or marketing copy in a defined voice.', '## Process\n1. Confirm audience, goal and tone.\n2. Outline first, then draft.\n3. Avoid unverifiable claims; mark placeholders clearly.\n\n## Output\nDraft plus a short list of assumptions.'),
  T('document-generation', 'Document generation', 'Use when generating structured documents (reports, specs, READMEs) from source material.', '## Process\n1. Gather source material and confirm the template.\n2. Generate section by section; keep facts traceable to sources.\n3. Proofread headings, numbering and links.\n\n## Output\nThe finished document in the requested format.'),
  T('database', 'Database management', 'Use when designing schemas, writing queries or planning migrations.', '## Process\n1. Read the current schema and migration history.\n2. Prefer additive, reversible migrations.\n3. Explain query plans for anything non-trivial.\n4. Never run destructive statements against a database without explicit confirmation.\n\n## Output\nSQL or migration files plus a rollback plan.'),
  T('devops', 'DevOps automation', 'Use when creating or debugging CI/CD pipelines, deployment scripts or infrastructure config.', '## Process\n1. Read existing pipeline and deployment configuration.\n2. Make small, reviewable changes.\n3. Keep secrets out of files; reference them via the platform secret store.\n4. Dry-run where possible.\n\n## Output\nConfig changes and how to verify them.'),
  T('business', 'Custom business workflow', 'Use when following our team\'s internal process for a recurring business task.', '## Process\n1. Describe each step of the workflow in order.\n2. List required inputs and where to find them.\n3. List approval points that need a human.\n\n## Output\nThe completed artifact and a checklist of steps performed.')
]

export interface WizardInput {
  name: string; description: string; purpose?: string; triggers?: string; instructions: string; workflows?: string[]; dependencies?: string[]
  references?: { name: string; content: string }[]; scripts?: { name: string; content: string }[]; exampleInputs?: string[]; expectedOutputs?: string[]
}
/** Structure follows the documented layout: <skill>/SKILL.md (name + description frontmatter), optional references/ and scripts/. */
export function generateSkill(i: WizardInput): SkillFiles {
  const description = [i.description.trim(), i.triggers?.trim() && `Use when ${i.triggers.trim().replace(/^use when\s+/i, '')}`].filter(Boolean).join(' ')
  const body = [`# ${i.name}`, i.purpose?.trim() && `\n## Purpose\n${i.purpose.trim()}`, i.dependencies?.length && `\n## Requirements\n${i.dependencies.map((d) => `- ${d}`).join('\n')}`, `\n${i.instructions.trim()}`,
    i.workflows?.length && `\n## Workflows\n${i.workflows.map((w) => `- ${w}`).join('\n')}`, i.exampleInputs?.length && `\n## Example inputs\n${i.exampleInputs.map((x) => `- ${x}`).join('\n')}`,
    i.expectedOutputs?.length && `\n## Expected outputs\n${i.expectedOutputs.map((x) => `- ${x}`).join('\n')}`,
    i.references?.length && `\n## References\n${i.references.map((r) => `- [${r.name}](references/${r.name})`).join('\n')}`, i.scripts?.length && `\n## Scripts\n${i.scripts.map((s) => `- \`scripts/${s.name}\``).join('\n')}`].filter(Boolean).join('\n')
  const files: SkillFiles = { 'SKILL.md': `---\n${stringify({ name: i.name, description }, { lineWidth: 0 })}---\n\n${body}\n` }
  for (const r of i.references ?? []) files[`references/${r.name}`] = r.content
  for (const s of i.scripts ?? []) files[`scripts/${s.name}`] = s.content
  return files
}

export interface Issue { level: 'error' | 'warning' | 'info'; message: string; file?: string }
/** STATIC validation only (no Claude, no network). */
export async function validateSkill(files: SkillFiles): Promise<Issue[]> {
  const issues: Issue[] = [], md = files['SKILL.md']
  if (md === undefined) return [{ level: 'error', message: 'SKILL.md is missing', file: 'SKILL.md' }]
  const p = parseSkillMd(md)
  for (const e of p.errors) issues.push({ level: 'error', message: e, file: 'SKILL.md' })
  const { name, description } = p.frontmatter as Record<string, unknown>
  if (typeof name !== 'string' || !name) issues.push({ level: 'error', message: 'frontmatter `name` is required', file: 'SKILL.md' })
  else {
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) issues.push({ level: 'error', message: '`name` should be lowercase letters, digits and hyphens', file: 'SKILL.md' })
    if (name.length > 64) issues.push({ level: 'error', message: '`name` exceeds 64 characters', file: 'SKILL.md' })
  }
  if (typeof description !== 'string' || !description.trim()) issues.push({ level: 'error', message: 'frontmatter `description` is required (Claude uses it to decide when to load the skill)', file: 'SKILL.md' })
  else {
    if (description.length > 1024) issues.push({ level: 'error', message: '`description` exceeds 1024 characters', file: 'SKILL.md' })
    if (!/\buse (this )?(skill )?when\b|\bwhen\b/i.test(description)) issues.push({ level: 'warning', message: 'description does not say when to use the skill; add trigger conditions', file: 'SKILL.md' })
  }
  if (!p.body.trim()) issues.push({ level: 'warning', message: 'SKILL.md body is empty', file: 'SKILL.md' })
  if (md.split('\n').length > 500) issues.push({ level: 'warning', message: 'SKILL.md is over 500 lines; move detail into references/', file: 'SKILL.md' })
  for (const m of p.body.matchAll(/\]\(((?:references|scripts|assets)\/[^)\s#]+)\)/g)) if (!(m[1]! in files)) issues.push({ level: 'error', message: `linked file not found: ${m[1]}`, file: 'SKILL.md' })
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'skilldock-val-'))
  try {
    for (const [f, c] of Object.entries(files)) { const o = safeJoin(dir, f); await fs.mkdir(path.dirname(o), { recursive: true }); await fs.writeFile(o, c) }
    for (const f of (await scanDir(dir)).findings.filter((x) => x.severity !== 'info')) issues.push({ level: f.severity === 'high' ? 'warning' : 'info', message: `${f.message}${f.line ? ` (line ${f.line})` : ''}`, file: f.file })
  } finally { await fs.rm(dir, { recursive: true, force: true }) }
  return issues
}

export async function loadSkillFiles(env: InstallEnv, dir: string): Promise<SkillFiles> {
  const s = (await discoverSkills({ claudeDir: env.paths.claudeDir, projects: env.store.projects() })).find((x) => x.dir === dir && x.scope !== 'legacy-command')
  if (!s || s.scope === 'plugin') throw new Error('Only user and project skills can be edited')
  const root = s.realPath ?? s.dir, out: SkillFiles = {}
  for (const f of s.files) { // text only: binary or large files are not loaded into the editor and are preserved untouched on save
    const p = safeJoin(root, f), st = await fs.lstat(p); if (!st.isFile() || st.size >= 512 * 1024) continue
    const b = await fs.readFile(p); if (!b.includes(0)) out[f] = b.toString('utf8')
  }
  return out
}
export async function saveSkillFiles(env: InstallEnv, target: Target, dirName: string, files: SkillFiles, opts: { overwrite?: boolean; deleted?: string[] } = {}): Promise<{ dir: string; backupId: string }> {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(dirName)) throw new Error('Skill folder name must be lowercase letters, digits and hyphens')
  const dir = safeJoin(skillsBase(env, target), dirName)
  const errs = (await validateSkill(files)).filter((i) => i.level === 'error'); if (errs.length) throw new Error(`Validation failed: ${errs.map((e) => e.message).join('; ')}`)
  const existing = await fs.lstat(dir).then(() => true, () => false)
  if (existing && !opts.overwrite) throw new Error('A skill with this name already exists; confirm overwrite')
  const lst = existing ? await fs.lstat(dir) : null
  const writeDir = lst?.isSymbolicLink() ? await fs.realpath(dir) : dir // edit through links in place; Never replace a link by copy
  const backupId = await runTransaction(env.ctx, `studio save ${dirName}`, [writeDir], async (b) => {
    // Never wipe the directory: binary/large files the editor cannot represent must survive. Write only changed files; delete only what the user explicitly removed.
    await fs.mkdir(writeDir, { recursive: true })
    for (const f of opts.deleted ?? []) { if (f !== 'SKILL.md' && !(f in files)) await fs.rm(safeJoin(writeDir, f), { force: true }) }
    for (const [f, c] of Object.entries(files)) {
      const o = safeJoin(writeDir, f)
      if ((await fs.lstat(o).then((s) => s.isSymbolicLink(), () => false))) continue // never write through a symlink inside a skill
      if ((await fs.readFile(o, 'utf8').catch(() => null)) === c) continue // unchanged: leave bytes alone (lossless for odd encodings)
      await fs.mkdir(path.dirname(o), { recursive: true }); await fs.writeFile(o, c)
    }
    const found = (await discoverSkills({ claudeDir: env.paths.claudeDir, projects: target.project ? [target.project] : [] })).find((s) => s.dir === dir)
    if (!found || found.errors.length) throw new Error('Verification failed: skill is not discoverable after save')
    return b.id
  })
  env.store.audit('studio.save', dir, true, backupId)
  return { dir, backupId }
}
/** Lossless export of an installed skill (byte-for-byte, symlinks skipped). */
export async function exportSkillDir(srcDir: string, destParent: string, name: string): Promise<string> {
  const dest = safeJoin(destParent, name); if (await fs.lstat(dest).then(() => true, () => false)) throw new Error('Destination already exists')
  const { copyTree } = await import('./fsutil'); await copyTree(srcDir, dest, { followRootLink: true }); return dest
}
export async function exportSkill(files: SkillFiles, destParent: string, name: string): Promise<string> {
  const dest = safeJoin(destParent, name); if (await fs.lstat(dest).then(() => true, () => false)) throw new Error('Destination already exists')
  for (const [f, c] of Object.entries(files)) { const o = safeJoin(dest, f); await fs.mkdir(path.dirname(o), { recursive: true }); await fs.writeFile(o, c) }
  return dest
}

// ---------- test cases ----------
export interface TestCase { id: string; prompt: string; expectedBehavior: string; expectedFormat?: string; requiredTools?: string[]; criteria?: string[] }
export interface CaseResult { id: string; level: 'static' | 'simulated'; ok: boolean; notes: string[] }
const words = (s: string) => new Set(s.toLowerCase().match(/[a-z0-9]{4,}/g) ?? [])
/** STATIC checks + a SIMULATED trigger heuristic (word overlap). Neither is Claude's behavior. */
export function evaluateCases(files: SkillFiles, cases: TestCase[]): CaseResult[] {
  const fm = parseSkillMd(files['SKILL.md'] ?? '').frontmatter, desc = words(`${fm.name ?? ''} ${fm.description ?? ''}`)
  const allowed = String(fm['allowed-tools'] ?? '').split(/[,\s]+/).filter(Boolean)
  return cases.flatMap((c): CaseResult[] => {
    const st: string[] = []
    if (!c.prompt.trim()) st.push('prompt is empty'); if (!c.expectedBehavior.trim()) st.push('expected behavior is empty')
    if (allowed.length) for (const t of c.requiredTools ?? []) if (!allowed.some((a) => a.split('(')[0] === t.split('(')[0])) st.push(`required tool "${t}" is not in the skill's allowed-tools`)
    const overlap = [...words(c.prompt)].filter((w) => desc.has(w))
    return [{ id: c.id, level: 'static', ok: !st.length, notes: st.length ? st : ['case is well-formed'] },
      { id: c.id, level: 'simulated', ok: overlap.length > 0, notes: [overlap.length ? `prompt shares terms with the description: ${overlap.slice(0, 6).join(', ')}` : 'prompt shares no terms with the description; Claude may not select this skill. (Heuristic only.)'] }]
  })
}
export const getCases = (env: InstallEnv, skillId: string): TestCase[] => JSON.parse(env.store.get<{ json: string }>('SELECT json FROM skill_tests WHERE skill_id=?', skillId)?.json ?? '[]')
export const setCases = (env: InstallEnv, skillId: string, cases: TestCase[]) => env.store.run('INSERT INTO skill_tests(skill_id,json) VALUES (?,?) ON CONFLICT(skill_id) DO UPDATE SET json=excluded.json', skillId, JSON.stringify(cases))

/** ACTUAL Claude execution through the user's own `claude` CLI/login. Spends their usage; requires `approved`. Runs in an empty temp dir. */
export async function runWithClaude(homeDir: string, prompt: string, opts: { approved: boolean; timeoutMs?: number }): Promise<{ result: string; costUsd?: number; raw: unknown }> {
  if (!opts.approved) throw new Error('Approval required: this runs Claude and uses your plan/API usage')
  if (/^\s*-/.test(prompt)) throw new Error('Prompt must not start with "-" (it would be parsed as a CLI option)')
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'skilldock-run-'))
  try {
    const p = run('claude', ['-p', prompt, '--output-format', 'json', '--max-turns', '3'], { cwd, timeout: opts.timeoutMs ?? 120_000, env: { ...process.env, HOME: homeDir }, maxBuffer: 5_000_000 })
    p.child.stdin?.end() // `claude -p` waits for piped stdin otherwise (3 s delay + a misleading warning)
    let stdout: string
    try { ({ stdout } = await p) } catch (e) {
      // The CLI reports failures (e.g. "Not logged in") as JSON on stdout with a non-zero exit code; stderr only carries noise.
      const out = (e as { stdout?: string }).stdout ?? ''
      try { const j = JSON.parse(out); if (j?.result) throw new Error(String(j.result)) } catch (inner) { if (inner instanceof Error && !(inner instanceof SyntaxError)) throw inner }
      const { cliError } = await import('./workspace'); const err = cliError(e); err.message = err.message.replace(/^Warning: no stdin data received[^\n]*\n?/, '').trim() || 'claude exited with an error'; throw err
    }
    const j = JSON.parse(stdout); if (j.is_error) throw new Error(String(j.result ?? 'claude reported an error'))
    return { result: String(j.result ?? ''), costUsd: j.total_cost_usd, raw: j }
  } finally { await fs.rm(cwd, { recursive: true, force: true }) }
}
