// LIVE (SKILLDOCK_LIVE=1): exercises the real `claude` CLI in a THROWAWAY home (plugin lifecycle, run-with-Claude) and private-repo auth against a header-enforcing server.
// Never touches the real ~/.claude: every Claude call runs with HOME pointed at a temp directory.
import { execFile } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtemp, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { expect, test } from 'vitest'
import { claudePaths, listPlugins, pluginCli, runWithClaude, stageGithubDir, fetchBlob } from '../src'
const run = promisify(execFile)
const live = !!process.env.SKILLDOCK_LIVE

test.skipIf(!live)('REAL claude CLI: marketplace add → plugin install → listed → disable → enable → uninstall, in a throwaway home', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'skilldock-realplugin-')); await mkdir(path.join(home, '.claude'), { recursive: true }); const paths = claudePaths(home)
  const env = { ...process.env, HOME: home }
  await run('claude', ['plugin', 'marketplace', 'add', 'anthropics/claude-plugins-official'], { env, timeout: 180_000 })
  await pluginCli(paths, 'install', 'frontend-design@claude-plugins-official')
  let pl = (await listPlugins(paths)).find((p) => p.id === 'frontend-design@claude-plugins-official'); expect(pl, 'plugin appears in installed_plugins.json').toBeTruthy(); expect(pl!.enabled).toBe(true); expect(pl!.components.skills).toBeGreaterThan(0)
  await pluginCli(paths, 'disable', 'frontend-design@claude-plugins-official'); expect((await listPlugins(paths)).find((p) => p.id.startsWith('frontend-design'))!.enabled).toBe(false)
  await pluginCli(paths, 'enable', 'frontend-design@claude-plugins-official'); expect((await listPlugins(paths)).find((p) => p.id.startsWith('frontend-design'))!.enabled).toBe(true)
  await pluginCli(paths, 'uninstall', 'frontend-design@claude-plugins-official'); expect((await listPlugins(paths)).some((p) => p.id.startsWith('frontend-design'))).toBe(false)
}, 400_000)

test.skipIf(!live)('REAL "run with Claude": one tiny prompt through the user\'s own login, isolated working directory and throwaway home', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'skilldock-realrun-'))
  const r = await runWithClaude(home, 'Reply with exactly the single word OK and nothing else.', { approved: true, timeoutMs: 120_000 }).then((x) => ({ ok: true as const, x }), (e) => ({ ok: false as const, e: (e as Error).message }))
  console.log('RUN-WITH-CLAUDE RESULT:', JSON.stringify(r).slice(0, 400))
  if (r.ok) expect(r.x.result.length).toBeGreaterThan(0)
  else { expect(r.e).toMatch(/Not logged in/i); expect(r.e).not.toMatch(/no stdin data/i) } // the real reason is shown, never the stdin warning
}, 180_000)

test('private repository access: no token → clear 404 message; token → Authorization header sent, contents API used, files staged; token never goes to the raw host', async () => {
  const seen: { path: string; auth?: string; accept?: string }[] = []; const SECRET = 'github_pat_SECRET_TOKEN_VALUE_123456'
  const sha = 'a'.repeat(40), srv = createServer((req, res) => {
    const u = new URL(req.url!, 'http://x'); seen.push({ path: u.pathname, auth: req.headers.authorization, accept: req.headers.accept as string })
    const authed = req.headers.authorization === `Bearer ${SECRET}`, json = (o: unknown, c = 200) => { res.writeHead(c, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)) }
    if (!authed) return json({ message: 'Not Found' }, 404) // exactly what GitHub returns for a private repo without access
    if (u.pathname === '/repos/o/priv') return json({ default_branch: 'main', stargazers_count: 1, private: true })
    if (u.pathname.includes('/commits/')) return json({ sha })
    if (u.pathname.includes('/git/trees/')) return json({ truncated: false, tree: [{ path: 'skills/s/SKILL.md', type: 'blob', mode: '100644', sha: 'x', size: 20 }] })
    if (u.pathname.startsWith('/repos/o/priv/contents/')) { res.writeHead(200); return res.end('---\nname: s\n---\nsecret skill') }
    json({}, 404) })
  await new Promise<void>((r) => srv.listen(0, r)); const base = `http://127.0.0.1:${(srv.address() as any).port}`; const dest = path.join(await mkdtemp(path.join(tmpdir(), 'skilldock-priv-')), 'st')
  try {
    await expect(stageGithubDir({ apiBase: base, rawBase: `${base}/raw` }, { owner: 'o', repo: 'priv', path: 'skills/s' }, dest)).rejects.toThrow(/Not found \(or private without a token\)/)
    const r = await stageGithubDir({ apiBase: base, rawBase: `${base}/raw`, token: SECRET }, { owner: 'o', repo: 'priv', path: 'skills/s' }, dest); expect(r.files.map((f) => f.path)).toEqual(['SKILL.md'])
    expect(seen.filter((s) => s.auth).every((s) => s.auth === `Bearer ${SECRET}`)).toBe(true); expect(seen.some((s) => s.path.startsWith('/repos/o/priv/contents/') && s.accept?.includes('raw'))).toBe(true) // authenticated raw contents API
    expect(seen.some((s) => s.path.startsWith('/raw/'))).toBe(false) // the unauthenticated raw host is not used when a token exists
    expect((await fetchBlob({ apiBase: base, rawBase: base, token: SECRET }, 'o', 'priv', sha, 'skills/s/SKILL.md')).toString()).toContain('secret skill')
  } finally { srv.close() }
})
