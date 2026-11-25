// Opt-in (SKILLDOCK_LIVE=1): hits the real GitHub API + MCP registry. Installs only into a temp HOME.
import { mkdtemp, mkdir, readdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vitest'
import { Store, claudePaths, defaultGh, discoverRepo, planSkillInstall, applySkillInstall, uninstallSkill, searchRegistry, discoverSkills, queryEntries, type InstallEnv } from '../src'

test.skipIf(!process.env.SKILLDOCK_LIVE)('real anthropics/skills: discover, install ONE skill, verify, uninstall; real MCP registry search', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'skilldock-live-')), home = path.join(root, 'home'); await mkdir(path.join(home, '.claude'), { recursive: true })
  const env: InstallEnv = { ctx: { backupRoot: path.join(root, 'data', 'backups') }, store: new Store(':memory:'), paths: claudePaths(home), gh: defaultGh(process.env.GITHUB_TOKEN), stagingRoot: path.join(root, 'data', 'staging'), plans: new Map() }
  const r = await discoverRepo({ gh: env.gh, store: env.store }, 'anthropics', 'skills')
  const skills = r.entries.filter((e) => e.type === 'skill')
  expect(skills.length).toBeGreaterThan(10); expect(r.info.stars).toBeGreaterThan(1000)
  const fd = skills.find((s) => s.path === 'skills/frontend-design')!; expect(fd).toBeTruthy()
  const plan = await planSkillInstall(env, { type: 'github', owner: 'anthropics', repo: 'skills', path: fd.path!, ref: fd.commit }, { scope: 'user' })
  expect(plan.files.some((f) => f.path === 'SKILL.md')).toBe(true)
  await applySkillInstall(env, plan.id, { approveHighRisk: true })
  expect(await readdir(path.join(home, '.claude', 'skills'))).toEqual([plan.name]) // exactly one skill, not the whole repo
  expect((await readFile(path.join(home, '.claude', 'skills', plan.name, 'SKILL.md'), 'utf8')).startsWith('---')).toBe(true)
  expect((await discoverSkills({ claudeDir: env.paths.claudeDir })).map((s) => s.name)).toContain('frontend-design')
  await uninstallSkill(env, path.join(home, '.claude', 'skills', plan.name))
  expect(await readdir(path.join(home, '.claude', 'skills'))).toEqual([])
  const mcp = await searchRegistry({ gh: env.gh, store: env.store }, 'github', 10); expect(mcp.length).toBeGreaterThan(0)
  expect(queryEntries(env.store, { type: 'mcp' }).length).toBeGreaterThan(0)
}, 90_000)
