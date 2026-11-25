import { createServer, type Server } from 'node:http'
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { Store, claudePaths, discoverRepo, queryEntries, searchRegistry, registryToEntry, inferCategories, loadCatalog, planOrgResource, applySkillInstall, listPresets, planPreset, savePreset, generateSkill, validateSkill, saveSkillFiles, evaluateCases, TEMPLATES, defaultGh, hashTree, type InstallEnv } from '../src'

const SHA = 'c'.repeat(40)
const files: Record<string, string> = {
  'skills/video/SKILL.md': '---\nname: video-maker\ndescription: Create video with ffmpeg and subtitles\n---\n', 'skills/video/run.sh': 'ffmpeg -i a b', 'skills/video/requirements.txt': 'x',
  'skills/docs/SKILL.md': '---\nname: docs-writer\ndescription: Write documentation and readme files\n---\n',
  '.claude-plugin/marketplace.json': JSON.stringify({ name: 'mk', plugins: [{ name: 'pl1', description: 'security scanning', source: './p' }] })
}
let server: Server, base = ''
beforeAll(async () => {
  server = createServer((req, res) => {
    const p = new URL(req.url!, 'http://x').pathname, json = (o: unknown, c = 200) => { res.writeHead(c, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)) }
    if (p === '/repos/o/r') return json({ stargazers_count: 42, default_branch: 'main', pushed_at: '2026-01-01', created_at: '2025-01-01', license: { spdx_id: 'MIT' }, html_url: 'h', topics: ['t'] })
    if (p.startsWith('/repos/o/r/commits/')) return json({ sha: SHA })
    if (p === `/repos/o/r/git/trees/${SHA}`) return json({ truncated: false, tree: Object.entries(files).map(([path, c]) => ({ path, type: 'blob', mode: '100644', sha: 's', size: c.length })) })
    const raw = /^\/raw\/o\/r\/\w+\/(.+)$/.exec(p); if (raw && files[decodeURIComponent(raw[1]!)] !== undefined) { res.writeHead(200); return res.end(files[decodeURIComponent(raw[1]!)]) }
    if (p === '/v0/servers') return json({ servers: [{ server: { name: 'io.x/web', description: 'browser automation', version: '1.0.0', remotes: [{ type: 'streamable-http', url: 'https://m.example/mcp' }] }, _meta: {} }, { server: { name: 'io.x/npm', description: 'db', version: '2.0.0', packages: [{ registryType: 'npm', identifier: 'pkg', version: '2.0.0', transport: { type: 'stdio' }, environmentVariables: [{ name: 'KEY' }] }] }, _meta: {} }] })
    if (p === '/catalog.json') return json({ organization: { id: 'acme', name: 'Acme' }, catalogVersion: '3', resources: [{ id: 'v', name: 'Video', repo: 'o/r', path: 'skills/docs', ref: SHA, checksum: 'sha256:' + '0'.repeat(64) }, { id: 'd', name: 'Docs', repo: 'o/r', path: 'skills/docs', ref: SHA }] })
    json({}, 404)
  })
  await new Promise<void>((r) => server.listen(0, r)); base = `http://127.0.0.1:${(server.address() as any).port}`
})
afterAll(() => { server.close() })

async function env(): Promise<InstallEnv> {
  const root = await mkdtemp(path.join(tmpdir(), 'skilldock-')), home = path.join(root, 'home'); await mkdir(path.join(home, '.claude'), { recursive: true })
  return { ctx: { backupRoot: path.join(root, 'data', 'backups') }, store: new Store(':memory:'), paths: claudePaths(home), gh: { apiBase: base, rawBase: `${base}/raw` }, stagingRoot: path.join(root, 'data', 'staging'), plans: new Map() }
}

test('discovers multiple skills + plugin manifest; repo stars stay repo-level; filters and sorting work', async () => {
  const e = await env(); const r = await discoverRepo({ gh: e.gh, store: e.store }, 'o', 'r')
  expect(r.entries.map((x) => x.id).sort()).toEqual(['plugin:o/r:pl1', 'skill:o/r:skills/docs', 'skill:o/r:skills/video'])
  const v = r.entries.find((x) => x.name === 'video-maker')!
  expect(v).toMatchObject({ complexity: 'complex', os: ['macos', 'linux'], repo: { stars: 42, license: 'MIT' } }); expect(v.categories).toContain('Video editing')
  expect(queryEntries(e.store, { q: 'readme' }).map((x) => x.name)).toEqual(['docs-writer'])
  expect(queryEntries(e.store, { type: 'plugin' })).toHaveLength(1); expect(queryEntries(e.store, { category: 'Documentation' })[0]!.name).toBe('docs-writer')
  expect(queryEntries(e.store, { installed: true }, new Set(['docs-writer'])).map((x) => x.name)).toEqual(['docs-writer'])
  expect(queryEntries(e.store, { os: 'windows' }).map((x) => x.name)).not.toContain('video-maker')
})

test('MCP registry parsing builds installable configs for remote and npm packages', async () => {
  const e = await env(); const l = await searchRegistry({ gh: e.gh, store: e.store, registryBase: base }, 'x')
  expect(l[0]!.mcp!.install).toEqual({ type: 'http', url: 'https://m.example/mcp' })
  expect(l[1]!.mcp!.install).toEqual({ command: 'npx', args: ['-y', 'pkg@2.0.0'], env: { KEY: '' } })
  expect(registryToEntry({ name: 'z', packages: [{ registryType: 'oci', identifier: 'i' }] }, {}).mcp!.installNote).toMatch(/No automatically/)
  expect(inferCategories('Use playwright for browser automation tests')).toEqual(expect.arrayContaining(['Browser automation', 'Testing']))
})

test('org catalog: validates, pins, enforces checksum, records org', async () => {
  const e = await env(); const m = await loadCatalog(e, { kind: 'url', url: `${base}/catalog.json` })
  expect(m.organization.id).toBe('acme')
  await expect(planOrgResource(e, 'acme', 'v', { scope: 'user' })).rejects.toThrow(/Checksum mismatch/)
  const plan = await planOrgResource(e, 'acme', 'd', { scope: 'user' }); expect(plan.version).toBe(SHA)
  await applySkillInstall(e, plan.id); expect(e.store.all('SELECT org FROM installations')).toEqual([{ org: 'acme' }])
  await expect(loadCatalog(e, { kind: 'url', url: 'http://evil.example/c.json' })).rejects.toThrow(/https/)
  const bad = path.join(await mkdtemp(path.join(tmpdir(), 'skilldock-')), 'c.json'); await writeFile(bad, JSON.stringify({ catalogVersion: '1' }))
  await expect(loadCatalog(e, { kind: 'file', path: bad })).rejects.toThrow()
})

test('presets: built-ins listed, custom saved, plan reports failures honestly', async () => {
  const e = await env(); expect(listPresets(e).map((p) => p.id)).toContain('office-documents')
  savePreset(e, { id: 'mine', name: 'Mine', description: '', items: [{ label: 'docs', source: { owner: 'o', repo: 'r', path: 'skills/docs' } }, { label: 'nope', source: { owner: 'o', repo: 'r', path: 'skills/none' } }] })
  const r = await planPreset(e, 'mine', { scope: 'user' }); expect(r.plans).toHaveLength(1); expect(r.errors[0]!.item).toBe('nope')
})

test('studio: generate, validate, save with backup, templates, test cases', async () => {
  const e = await env(); const files = generateSkill({ name: 'my-skill', description: 'Does things.', triggers: 'the user asks for things', instructions: '## Steps\n1. Do it', references: [{ name: 'a.md', content: 'ref' }], scripts: [{ name: 'x.sh', content: 'echo hi' }] })
  expect(await validateSkill(files)).toEqual(expect.not.arrayContaining([expect.objectContaining({ level: 'error' })]))
  expect((await validateSkill({ 'SKILL.md': '---\nname: Bad Name\n---\n[x](references/missing.md)' })).filter((i) => i.level === 'error').length).toBeGreaterThanOrEqual(3)
  const { dir } = await saveSkillFiles(e, { scope: 'user' }, 'my-skill', files)
  expect(await readFile(path.join(dir, 'references/a.md'), 'utf8')).toBe('ref')
  await expect(saveSkillFiles(e, { scope: 'user' }, 'my-skill', files)).rejects.toThrow(/already exists/)
  await saveSkillFiles(e, { scope: 'user' }, 'my-skill', { ...files, 'SKILL.md': files['SKILL.md']!.replace('Do it', 'Do it v2') }, { overwrite: true })
  await expect(saveSkillFiles(e, { scope: 'user' }, '../evil', files)).rejects.toThrow()
  expect(TEMPLATES).toHaveLength(10)
  for (const t of TEMPLATES) expect((await validateSkill(generateSkill({ name: 'tpl', description: t.description, instructions: t.instructions }))).filter((i) => i.level === 'error')).toEqual([])
  const r = evaluateCases(files, [{ id: '1', prompt: 'please do things for me', expectedBehavior: 'x', requiredTools: ['Bash'] }])
  expect(r.map((x) => `${x.level}:${x.ok}`)).toEqual(['static:true', 'simulated:true'])
  expect(await hashTree(dir)).toBeTruthy(); expect(defaultGh().apiBase).toContain('github')
})
