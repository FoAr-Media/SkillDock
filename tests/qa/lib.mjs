// QA harness: real Electron app, isolated fixtures, mock network with failure modes. Every case records evidence (expected vs actual + screenshot).
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { lstat, readFile, writeFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { startMock, makeFixture, launch, repoFiles, read, root } from '../e2e/harness.mjs'
export { assert, repoFiles, read, root, startMock, makeFixture, writeFile, readFile, readdir, lstat, path }

export const OUT = path.join(root, 'docs/qa'), SHOTS = path.join(OUT, 'screenshots'); mkdirSync(SHOTS, { recursive: true })
export const evidence = []
const sk = (n, d) => `---\nname: ${n}\ndescription: ${d}\n---\n# ${n}\n`
const many = {}; for (let i = 0; i < 310; i++) many[`skills/many/f${i}.txt`] = 'x'
const rootMany = {}; for (let i = 0; i < 310; i++) rootMany[`assets/f${i}.txt`] = 'x'
const huge = {}; for (let i = 0; i < 450; i++) huge[`plugins/p${i % 9}/skills/hs${i}/SKILL.md`] = sk(`hs${i}`, `ffmpeg video subtitles skill ${i}`)
const same = sk('impeccable', 'Design vocabulary for frontend interfaces')
Object.assign(repoFiles, {
  'qa/mal': { 'skills/t1/SKILL.md': sk('t1', 'dotdot traversal'), 'skills/t1/sub/../../../esc1.txt': 'pwned', 'skills/t2/SKILL.md': sk('t2', 'backslash traversal'), 'skills/t2/..\\..\\win-esc.txt': 'pwned',
    'skills/t3/SKILL.md': sk('t3', 'NUL byte'), 'skills/t3/a\u0000b.txt': 'x', 'skills/t4/SKILL.md': sk('t4', 'symlink + submodule entries'), 'skills/t4/link': { c: '../../../../etc/passwd', mode: '120000' }, 'skills/t4/sub': { type: 'commit', mode: '160000', c: '' }, 'skills/t4/ok.md': 'fine' },
  'qa/big': { 'skills/bigfile/SKILL.md': sk('bigfile', 'has a 2.2 MB file'), 'skills/bigfile/data.bin': 'a'.repeat(Math.round(2.2 * 1024 * 1024)) },
  'qa/many': { 'skills/many/SKILL.md': sk('many', 'has 310 files'), ...many },
  'qa/mirror': { 'skills/impeccable/SKILL.md': same, '.claude/skills/impeccable/SKILL.md': same, '.agents/skills/impeccable/SKILL.md': same, '.codex/skills/impeccable/SKILL.md': sk('impeccable', 'Codex flavoured variant') },
  'qa/deps': { 'skills/pyskill/SKILL.md': sk('pyskill', 'needs python deps'), 'skills/pyskill/requirements.txt': 'requests', 'skills/pyskill/run.py': 'print(1)' },
  'qa/root': { 'SKILL.md': sk('rootskill', 'the whole repo is the skill'), ...rootMany },
  'qa/huge': huge,
  'qa/dup': { 'skills/a/SKILL.md': sk('dupname', 'first'), 'skills/b/SKILL.md': sk('dupname', 'second') },
  'qa/badyaml': { 'skills/broken/SKILL.md': '---\nname: [unclosed\n description: : :\n---\nbody' },
  'qa/other': { 'skills/deploy/SKILL.md': sk('deploy', 'community deploy') }
})
const pristine = structuredClone(repoFiles)
export function resetMock(mock) { mock.state.mode.apiDown = false; mock.state.mode.rawReset = false; mock.state.routes = {}; mock.state.head = mock.SHA; mock.state.pdfSha = null; for (const k of Object.keys(repoFiles)) delete repoFiles[k]; Object.assign(repoFiles, structuredClone(pristine)) }

/** One app instance + fixture per journey. `tc` records a case with expected/actual evidence and a screenshot. */
export async function session(persona, mock, fn, { env = {}, onboarding = true } = {}) {
  resetMock(mock); const fx = await makeFixture(); const { app, page } = await launch(fx, mock, env)
  const errors = []; page.on('pageerror', (e) => errors.push(e.message))
  const nav = (l) => page.locator('nav.sidebar').getByRole('button', { name: l, exact: true }).click()
  const toast = (t, ms = 20000) => page.waitForSelector(`.toast:has-text("${t}")`, { timeout: ms })
  const btn = (n, o = {}) => page.getByRole('button', { name: n, ...o })
  const invoke = (c, p) => page.evaluate(([c, p]) => window.skilldock.invoke(c, p).then((r) => ({ ok: true, r }), (e) => ({ ok: false, e: e.message })), [c, p])
  const exists = (p) => lstat(p).then(() => true, () => false)
  const until = async (f, ms = 10000) => { const t = Date.now(); for (;;) { try { if (await f()) return } catch { /* retry */ } if (Date.now() - t > ms) throw new Error('until() timed out'); await new Promise((r) => setTimeout(r, 100)) } }
  const settings = async () => JSON.parse(await read(path.join(fx.claude, 'settings.json'))), claudeJson = async () => JSON.parse(await read(path.join(fx.home, '.claude.json')))
  const stagingEmpty = async () => (await readdir(path.join(fx.data, 'staging')).catch(() => [])).length === 0
  const c = { page, app, fx, mock, nav, toast, btn, invoke, exists, until, settings, claudeJson, stagingEmpty, errors, persona }
  c.tc = async (id, title, expected, body, { channel = 'ui' } = {}) => {
    const rec = { id, persona, title, expected, channel, notes: [] }, t = Date.now(), cx = { ...c, note: (s) => rec.notes.push(String(s)), ipc: () => { rec.channel = 'ui+ipc' } }
    try { await body(cx); rec.status = 'pass' } catch (e) { rec.status = 'fail'; rec.error = e.message.split('\n').slice(0, 3).join(' | ') }
    rec.ms = Date.now() - t; rec.actual = rec.status === 'pass' ? (rec.notes.join(' · ') || 'matched expectation') : `FAILED: ${rec.error}`
    rec.screenshot = `screenshots/${id}.png`; await page.screenshot({ path: path.join(OUT, rec.screenshot) }).catch(() => { rec.screenshot = null })
    evidence.push(rec); console.log(`  ${rec.status === 'pass' ? '✓' : '✗'} ${id} ${title}${rec.status === 'fail' ? `\n      ${rec.error}` : ''}`)
    for (let i = 0; i < 3; i++) if (await page.getByRole('dialog').count()) await page.keyboard.press('Escape')
    await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {})
  }
  c.skip = (id, title, reason) => { evidence.push({ id, persona, title, status: 'not-executed', actual: `NOT EXECUTED: ${reason}`, expected: '—', notes: [], channel: '-' }); console.log(`  - ${id} ${title} (not executed: ${reason})`) }
  if (onboarding) await page.waitForSelector('text=Welcome to SkillDock', { timeout: 20000 })
  try { await fn(c) } finally { evidence.push({ id: `${persona}-runtime`, persona, title: 'no uncaught renderer errors during the journey', expected: 'none', status: errors.length ? 'fail' : 'pass', actual: errors.length ? errors.join(' | ') : 'none', notes: [], channel: 'ui', ms: 0 }); await app.close().catch(() => {}) }
}
export function writeEvidence() {
  writeFileSync(path.join(OUT, 'execution-evidence.json'), JSON.stringify({ at: new Date().toISOString(), evidence }, null, 2))
  const rows = evidence.map((e) => `| ${e.id} | ${e.persona} | ${e.title} | ${e.channel} | **${e.status}** | ${String(e.actual).replace(/\|/g, '\\|').slice(0, 240)} | ${e.screenshot ? `[shot](${e.screenshot})` : ''} |`)
  writeFileSync(path.join(OUT, 'EXECUTION_EVIDENCE.md'), `# QA execution evidence\nGenerated ${new Date().toISOString()} by tests/qa/run.mjs. Every row below was executed against the real app; "not-executed" rows were not run and say why.\n\n| ID | Persona | Case | Channel | Result | Actual | Evidence |\n|---|---|---|---|---|---|---|\n${rows.join('\n')}\n`)
}
