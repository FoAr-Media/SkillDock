// Regression tests for defects found by the dedicated QA pass (docs/DEFECT_REPORT.md).
import { chmod, mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vitest'
import { Store, claudePaths, safeJoin, updateJson, saveText, planSkillInstall, applySkillInstall, reconcileInstallations, checkUpdates, configHealth, cliError, CLI_MISSING, type InstallEnv } from '../src'
const posixTest = process.platform === 'win32' ? test.skip : test // relies on POSIX permission bits / symlinks

const tmp = () => mkdtemp(path.join(tmpdir(), 'skilldock-def-'))
async function env(): Promise<{ e: InstallEnv; root: string; src: string; home: string }> {
  const root = await tmp(), home = path.join(root, 'home'), src = path.join(root, 'src'); await mkdir(path.join(home, '.claude', 'skills'), { recursive: true }); await mkdir(src, { recursive: true }); await writeFile(path.join(src, 'SKILL.md'), '---\nname: s1\ndescription: d\n---\nbody')
  return { root, src, home, e: { ctx: { backupRoot: path.join(root, 'd', 'bk') }, store: new Store(':memory:'), paths: claudePaths(home), gh: { apiBase: '', rawBase: '' }, stagingRoot: path.join(root, 'd', 's'), plans: new Map() } }
}

test('DEF-04 backslash path segments are rejected (traversal on Windows, odd file names elsewhere)', () => {
  for (const bad of ['..\\..\\x', 'a\\b', 'skills\\t2\\..\\..\\win.txt']) expect(() => safeJoin('/a/b', bad)).toThrow(/unsafe/)
  expect(safeJoin('/a/b', 'ok/file.txt')).toBe('/a/b/ok/file.txt')
})
posixTest('DEF-06 a file the user made read-only is never replaced', async () => {
  const r = await tmp(), f = path.join(r, 's.json'), ctx = { backupRoot: path.join(r, 'bk') }; await writeFile(f, '{"a":1}'); await chmod(f, 0o444)
  await expect(updateJson(ctx, f, 'x', (d) => { d.b = 2 })).rejects.toThrow(/read-only/); await expect(saveText(ctx, f, '{"a":2}', 'x')).rejects.toThrow(/read-only/); expect(await readFile(f, 'utf8')).toBe('{"a":1}'); await chmod(f, 0o644)
})
test('DEF-02 approval is refused when the target appeared or changed after the plan was shown', async () => {
  const { e, src, home } = await env(); const target = path.join(home, '.claude', 'skills', 's1')
  const p1 = await planSkillInstall(e, { type: 'local', dir: src }, { scope: 'user' }); expect(p1.targetSnapshot).toBeNull()
  await mkdir(target); await writeFile(path.join(target, 'SKILL.md'), 'PRECIOUS')
  await expect(applySkillInstall(e, p1.id)).rejects.toThrow(/changed after this plan was reviewed/); expect(await readFile(path.join(target, 'SKILL.md'), 'utf8')).toBe('PRECIOUS')
  const p2 = await planSkillInstall(e, { type: 'local', dir: src }, { scope: 'user' }); expect(p2.conflict).toBe('exists-foreign'); await writeFile(path.join(target, 'SKILL.md'), 'EDITED AFTER PLAN')
  await expect(applySkillInstall(e, p2.id, { overwrite: true })).rejects.toThrow(/changed after this plan/); expect(await readFile(path.join(target, 'SKILL.md'), 'utf8')).toBe('EDITED AFTER PLAN')
  const p3 = await planSkillInstall(e, { type: 'local', dir: src }, { scope: 'user' }); await applySkillInstall(e, p3.id, { overwrite: true }); expect(await readFile(path.join(target, 'SKILL.md'), 'utf8')).toContain('body') // an unchanged target still installs
  expect(e.plans.size).toBe(0)
})
posixTest('DEF-09 staging is removed before a failed install returns', async () => {
  const { e, src, home } = await env(); const skills = path.join(home, '.claude', 'skills'); const p = await planSkillInstall(e, { type: 'local', dir: src }, { scope: 'user' }); await chmod(skills, 0o555)
  try { await expect(applySkillInstall(e, p.id)).rejects.toThrow() } finally { await chmod(skills, 0o755) }
  const left = await (await import('node:fs/promises')).readdir(e.stagingRoot).catch(() => []); expect(left).toEqual([])
})
test('DEF-03 records of skills that no longer exist are dropped and never reported as updates', async () => {
  const { e, src, home } = await env(); const p = await planSkillInstall(e, { type: 'local', dir: src }, { scope: 'user' }); await applySkillInstall(e, p.id)
  expect(e.store.all('SELECT * FROM installations')).toHaveLength(1); await rm(path.join(home, '.claude', 'skills', 's1'), { recursive: true })
  expect(await reconcileInstallations(e)).toBe(1); expect(e.store.all('SELECT * FROM installations')).toHaveLength(0); expect(await checkUpdates(e)).toEqual([])
})
test('DEF-05 unreadable config files are reported, healthy and absent ones are not', async () => {
  const r = await tmp(), home = path.join(r, 'home'), proj = path.join(r, 'p'); await mkdir(path.join(home, '.claude'), { recursive: true }); await mkdir(path.join(proj, '.claude'), { recursive: true })
  const paths = { ...claudePaths(home), managedDirs: [] as string[] }; await writeFile(paths.userJson, '{ broken'); await writeFile(paths.userSettings, '{}'); await writeFile(path.join(proj, '.mcp.json'), '[1]')
  const h = await configHealth(paths, [proj]); expect(h.map((x) => x.label).sort()).toEqual(['p/.mcp.json', '~/.claude.json']); expect(h.every((x) => x.error)).toBe(true)
})
test('DEF-07 a missing CLI gives an actionable message, other failures keep their text', () => {
  expect(cliError(Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' })).message).toBe(CLI_MISSING); expect(CLI_MISSING).toMatch(/https:\/\/code\.claude\.com/)
  expect(cliError(Object.assign(new Error('boom'), { stderr: 'real stderr text\n' })).message).toBe('real stderr text')
})

posixTest('DEF-10 backup/restore preserves file permissions (a rollback must not change a file\'s mode)', async () => {
  const { createBackup, restoreBackup } = await import('../src'); const { stat } = await import('node:fs/promises')
  const r = await tmp(), f = path.join(r, 'script.sh'), ctx = { backupRoot: path.join(r, 'bk') }; await writeFile(f, '#!/bin/sh\n'); await chmod(f, 0o755)
  const b = await createBackup(ctx, 't', [f]); await writeFile(f, 'changed'); await chmod(f, 0o600); await restoreBackup(ctx, b.id)
  expect((await stat(f)).mode & 0o777).toBe(0o755); expect(await readFile(f, 'utf8')).toBe('#!/bin/sh\n')
})

test('DEF-11 a failed download leaves no staging residue, even with parallel workers still in flight', async () => {
  const { createServer } = await import('node:http'); const { stageGithubDir } = await import('../src')
  const files: Record<string, string> = { 'skills/x/SKILL.md': '---\nname: x\n---\n' }; for (let i = 0; i < 40; i++) files[`skills/x/f${i}.txt`] = 'data'; files['skills/x/a/../../../evil.txt'] = 'pwned'
  const sha = 'a'.repeat(40), srv = createServer((req, res) => { const p = new URL(req.url!, 'http://x').pathname
    if (p === '/repos/o/r') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ default_branch: 'main', stargazers_count: 1 })) }
    if (p.includes('/commits/')) { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ sha })) }
    if (p.includes('/git/trees/')) { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ truncated: false, tree: Object.entries(files).map(([path, c]) => ({ path, type: 'blob', mode: '100644', sha: 's', size: c.length })) })) }
    setTimeout(() => { res.writeHead(200); res.end('data') }, 15) }) // slow raw responses keep workers in flight
  await new Promise<void>((r) => srv.listen(0, r)); const base = `http://127.0.0.1:${(srv.address() as any).port}`
  const root = await tmp(), dest = path.join(root, 'staging', 'p1')
  try { await expect(stageGithubDir({ apiBase: base, rawBase: base }, { owner: 'o', repo: 'r', path: 'skills/x' }, dest)).rejects.toThrow(/escapes root/) } finally { srv.close() }
  await new Promise((r) => setTimeout(r, 400)); expect(await (await import('node:fs/promises')).readdir(path.join(root, 'staging')).catch(() => [])).toEqual([])
})
