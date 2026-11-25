// Full Electron e2e. Destructive flows run ONLY against an isolated fixture HOME. Persona tags in step names.
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { readdir, readFile, writeFile, lstat, stat, realpath, rm } from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { startMock, makeFixture, launch, repoFiles, read, root } from './harness.mjs'

const require = createRequire(import.meta.url)
const SHOTS = path.join(root, 'docs/screenshots'); mkdirSync(SHOTS, { recursive: true })
const mock = await startMock(), fx = await makeFixture()
const { app, page } = await launch(fx, mock)
const errors = []; page.on('pageerror', (e) => errors.push(e.message))
const results = []
const shot = (n) => page.screenshot({ path: path.join(SHOTS, `${n}.png`) })
const nav = (l) => page.locator('nav.sidebar').getByRole('button', { name: l, exact: true }).click()
const toast = (t, ms = 20000) => page.waitForSelector(`.toast:has-text("${t}")`, { timeout: ms })
const btn = (n, o = {}) => page.getByRole('button', { name: n, ...o })
const dlg = () => page.getByRole('dialog')
const exists = (p) => lstat(p).then(() => true, () => false)
const settings = async () => JSON.parse(await read(path.join(fx.claude, 'settings.json')))
const claudeJson = async () => JSON.parse(await read(path.join(fx.home, '.claude.json')))
const invoke = (c, p) => page.evaluate(([c, p]) => window.skilldock.invoke(c, p).then((r) => ({ ok: true, r }), (e) => ({ ok: false, e: e.message })), [c, p])
async function step(name, fn) {
  const t = Date.now()
  try { await fn(); results.push({ name, ok: true, ms: Date.now() - t }); console.log(`  ✓ ${name}`) }
  catch (e) { results.push({ name, ok: false, error: e.message.split('\n')[0] }); console.log(`  ✗ ${name}\n      ${e.message.split('\n').slice(0, 4).join('\n      ')}`); await page.screenshot({ path: path.join(SHOTS, `FAIL-${results.length}.png`) }).catch(() => {}); await page.keyboard.press('Escape').catch(() => {}) }
}
const until = async (fn, ms = 10000) => { const t = Date.now(); for (;;) { try { if (await fn()) return } catch { /* retry */ } if (Date.now() - t > ms) throw new Error('until() timed out'); await new Promise((r) => setTimeout(r, 100)) } }
const backToResults = async () => { const b = page.getByRole('button', { name: '← Back to results' }); if (await b.count()) await b.click() }
const closeDialogs = async () => { for (let i = 0; i < 3; i++) if (await dlg().count()) await page.keyboard.press('Escape') }

// ───────────── Persona A: beginner ─────────────
await step('A: first-run onboarding is read-only and shows detected components', async () => {
  await page.waitForSelector('text=Welcome to SkillDock', { timeout: 20000 })
  await page.waitForSelector('[role=dialog] td:has-text("Claude Code CLI")', { timeout: 20000 }); assert.match(await dlg().innerText(), /read-only/i)
  await shot('01-onboarding'); await page.getByRole('button', { name: 'Continue' }).click()
  assert.equal(await exists(path.join(fx.claude, 'skills', 'video-maker')), false)
})
await step('overview: real counts from fixture + screenshot', async () => {
  await page.waitForSelector('h1:has-text("Overview")'); const t = await page.innerText('.cards')
  assert.match(t.replace(/\n/g, ' '), /7 Skills/); assert.match(t.replace(/\n/g, ' '), /2 MCP servers/); assert.match(t.replace(/\n/g, ' '), /1 Agents/)
  await shot('02-dashboard')
})
await step('A: marketplace discovers skills from (mock) public sources; category filter + search work', async () => {
  await nav('Marketplace'); await page.waitForSelector('.tile:has-text("video-maker")', { timeout: 30000 })
  assert.equal(await page.locator('.tile').count(), 3)
  await page.selectOption('select[aria-label="Category"]', 'Video editing'); await page.waitForFunction(() => document.querySelectorAll('.tile').length === 1)
  assert.match(await page.innerText('.tile'), /video-maker/)
  await page.selectOption('select[aria-label="Category"]', ''); await page.fill('input[aria-label="Search marketplace"]', 'readme'); await page.waitForFunction(() => document.querySelectorAll('.tile').length === 1 && document.querySelector('.tile').innerText.includes('docs-writer'))
  assert.match(await page.innerText('.tile'), /docs-writer/); await page.fill('input[aria-label="Search marketplace"]', ''); await page.waitForFunction(() => document.querySelectorAll('.tile').length === 3)
  await shot('03-marketplace')
  await page.locator('summary', { hasText: 'Sources & verification' }).click(); const srcT = (await page.locator('details table').first().innerText()).replace(/\s+/g, ' ')
  assert.match(srcT, /anthropics\/skills[\s\S]*verified/); assert.match(srcT, /official/); assert.match(await page.locator('.chips').innerText(), /Video editing/); await shot('03b-sources-verification')
  const raws = () => mock.hits.urls.filter((u) => u.startsWith('/raw/')).length; let before = raws()
  await page.locator('details tr', { hasText: 'anthropics/skills' }).getByRole('button', { name: 'Re-verify' }).click(); await toast('Verified 1 source(s)'); assert.ok(raws() > before, 'Re-verify forces a refetch')
  await page.locator('.toast').waitFor({ state: 'detached', timeout: 8000 }).catch(() => {}); before = raws()
  await page.getByRole('button', { name: 'Refresh sources' }).click(); await toast('unchanged, served from cache'); assert.equal(raws(), before, 'unchanged commits cost no SKILL.md downloads')
  await page.locator('summary', { hasText: 'Sources & verification' }).click()
})
await step('A: resource page shows repo-level stars (not a skill rating), inferred categories with evidence, honest security status, safe docs', async () => {
  await page.locator('.tile', { hasText: 'video-maker' }).click(); await page.waitForSelector('.resource-page h1:has-text("video-maker")')
  const t = await page.locator('.resource-page').innerText(); assert.match(t, /150,000/); assert.match(t, /whole repository, not this resource/); assert.match(t, /inferred/); assert.doesNotMatch(t, /\d+ (reviews?|downloads)|star rating|verified badge/i)
  assert.match(await page.locator('.resource-page dd', { hasText: 'Video editing' }).first().innerText(), /Video editing/); assert.ok((await page.locator('.resource-page span[title^="evidence:"]').first().getAttribute('title')).length > 10, 'category evidence is exposed')
  await page.getByRole('tab', { name: 'Documentation' }).click(); await page.waitForSelector('.resource-page .doc'); await page.getByRole('button', { name: 'Raw' }).click(); await page.waitForSelector('.resource-page pre.doc'); await shot('04-skill-details')
  await page.getByRole('tab', { name: 'Files' }).click(); assert.match(await page.locator('.tabbody').innerText(), /SKILL\.md[\s\S]*references\/guide\.md/)
  await page.getByRole('tab', { name: 'Security & install' }).click(); assert.match(await page.locator('.tabbody').innerText(), /Not inspected/); assert.match(await page.locator('.tabbody').innerText(), /Nothing from the resource is executed/)
  await page.getByRole('tab', { name: 'Versions' }).click(); assert.match(await page.locator('.tabbody').innerText(), /not installed from this entry/); await page.getByRole('tab', { name: 'Related' }).click(); assert.match(await page.locator('.tabbody').innerText(), /docs-writer|pdf/)
  await page.getByRole('tab', { name: 'Overview' }).click()
})
await step('A/G: install plan previews exact changes; nothing written until approval; then installs + verified', async () => {
  await btn('Review installation plan').click(); await page.waitForSelector('text=Review installation: video-maker')
  const t = await dlg().last().innerText(); assert.match(t, /SKILL\.md/); assert.match(t, /references\/guide\.md/); assert.match(t, /Nothing has been written/)
  assert.equal(await exists(path.join(fx.claude, 'skills', 'video-maker')), false); await shot('05-install-preview')
  const before = { local: await read(path.join(fx.claude, 'skills/my-local/SKILL.md')), settings: await read(path.join(fx.claude, 'settings.json')), cj: await read(path.join(fx.home, '.claude.json')) }
  await btn('Approve & install').click(); await toast('Installed video-maker')
  assert.match(await read(path.join(fx.claude, 'skills/video-maker/SKILL.md')), /video-maker/); assert.equal(await read(path.join(fx.claude, 'skills/video-maker/references/guide.md')), 'ffmpeg guide')
  assert.equal(await read(path.join(fx.claude, 'skills/my-local/SKILL.md')), before.local, 'unrelated skill untouched'); assert.equal(await read(path.join(fx.claude, 'settings.json')), before.settings); assert.equal(await read(path.join(fx.home, '.claude.json')), before.cj)
  assert.equal(await exists(path.join(fx.claude, 'skills/docs-writer')), false, 'only the chosen skill, not the whole repo')
})
await step('G: reinstall of an existing skill requires explicit overwrite', async () => {
  await page.waitForSelector('.resource-page'); assert.match(await page.locator('.resource-page').innerText(), /installed · current/); await backToResults(); await page.locator('.tile', { hasText: 'video-maker' }).click(); await btn('Review installation plan').click(); await page.waitForSelector('text=Review installation: video-maker')
  assert.equal(await btn('Replace & install').isDisabled(), true); await dlg().last().getByRole('checkbox').check(); assert.equal(await btn('Replace & install').isDisabled(), false)
  await btn('Cancel').last().click(); await closeDialogs()
})
// ───────────── Persona F: security-conscious ─────────────
await step('F: suspicious repo → high-risk plan, approval required, cancel leaves disk untouched', async () => {
  await nav('Marketplace'); await btn('Import GitHub repository / skill URL').click()
  await page.fill('input[placeholder="anthropics/skills"]', 'o/evil'); await page.fill('input[placeholder="skills/frontend-design"]', 'skills/shady'); await btn('Review plan').click()
  await page.waitForSelector('text=Review installation: shady'); const t = await dlg().last().innerText()
  assert.match(t, /High-risk behavior detected/); assert.match(t, /Downloads and pipes content into a shell|Destructive filesystem command/)
  assert.equal(await btn('Approve & install').isDisabled(), true); await shot('06-security-findings-plan')
  await btn('Cancel').last().click(); assert.equal(await exists(path.join(fx.claude, 'skills/shady')), false)
  assert.equal(await exists(path.join(fx.data, 'staging', 'x')), false)
})
await step('F: path-traversal archive is rejected and nothing escapes staging', async () => {
  await btn('Import GitHub repository / skill URL').click(); await page.fill('input[placeholder="anthropics/skills"]', 'o/trav'); await page.fill('input[placeholder="skills/frontend-design"]', 'skills/bad'); await btn('Review plan').click()
  await toast('escapes'); assert.equal(await exists(path.join(fx.data, 'escape.txt')), false); assert.equal(await exists(path.join(fx.data, 'staging', 'escape.txt')), false); assert.equal(await exists(path.join(fx.claude, 'escape.txt')), false)
  await closeDialogs()
})
await step('marketplace: plugin entries + MCP registry search → wizard prefilled', async () => {
  await nav('Marketplace'); await page.getByRole('tab', { name: 'Plugins' }).click(); await page.waitForSelector('.tile:has-text("demo-plugin")')
  await page.getByRole('tab', { name: /^MCP/ }).click(); await page.fill('input[aria-label="Search MCP registry"]', 'browser'); await btn('Search registry').click(); await page.waitForSelector('.tile:has-text("browser-tools")')
  await page.locator('.tile', { hasText: 'browser-tools' }).click(); await btn('Configure in MCP wizard…').click(); await page.waitForSelector('text=Add MCP server')
  assert.equal(await page.inputValue('input[aria-label="URL"]'), 'https://mcp.example.com/mcp'); await closeDialogs()
})
// ───────────── My skills (B, G) ─────────────
await step('G: My Skills lists symlinked + local + installed; all 11 detail tabs render', async () => {
  await nav('My Skills'); await page.waitForSelector('.tile:has-text("linked-skill")'); assert.ok((await page.locator('.tile').count()) >= 3)
  await page.locator('.tile', { hasText: 'video-maker' }).click(); await page.waitForSelector('.dhead h2:has-text("video-maker")')
  for (const t of ['Overview', 'How to use', 'Commands', 'Files', 'Dependencies', 'Configuration', 'Permissions', 'Security', 'Version history', 'Changelog', 'Compatibility']) {
    await page.getByRole('tab', { name: t }).click(); await page.waitForTimeout(80); assert.ok((await page.locator('.tabbody').innerText()).length > 5, `tab ${t} empty`)
    if (t === 'How to use') assert.match(await page.locator('.tabbody').innerText(), /Documented[\s\S]*Invocation/i)
    if (t === 'Version history') assert.match(await page.locator('.tabbody').innerText(), /install video-maker/)
  }
  await page.getByRole('tab', { name: 'Files' }).click(); await page.locator('.tabbody').getByRole('button', { name: 'SKILL.md' }).click(); await page.waitForSelector('.tabbody pre')
  await page.getByRole('tab', { name: 'Overview' }).click(); await shot('07-my-skills')
  await page.getByRole('button', { name: 'Table' }).click(); await page.waitForSelector('table.table'); await page.getByRole('button', { name: 'Grid' }).click()
})
await step('G: disable/enable via skillOverrides preserves unknown settings keys (reversible)', async () => {
  await page.locator('.tile', { hasText: 'my-local' }).click(); await page.waitForSelector('.dhead h2:has-text("my-local")'); await btn('Disable', { exact: true }).click(); await toast('Disabled')
  let s = await settings(); assert.deepEqual(s.skillOverrides, { 'my-local': 'off' }); assert.deepEqual(s.someUnknownFutureKey, { keep: ['me'] }); assert.equal(s.model, 'opus')
  await btn('Enable', { exact: true }).click(); await toast('Enabled'); s = await settings(); assert.equal(s.skillOverrides, undefined); assert.deepEqual(s.someUnknownFutureKey, { keep: ['me'] })
})
await step('B/G: update detection, diff, no silent overwrite of local edits', async () => {
  const skillMd = path.join(fx.claude, 'skills/video-maker/SKILL.md')
  repoFiles['anthropics/skills']['skills/video-maker/SKILL.md'] = '---\nname: video-maker\ndescription: Create video v2. Use when editing video.\n---\n# v2\n'; mock.state.head = 'f'.repeat(40)
  await nav('Overview'); await btn('Check updates').click(); await toast('1 update(s) available')
  await nav('My Skills'); await page.locator('.tile', { hasText: 'video-maker' }).click(); await btn('Update / check diff').click(); await page.waitForSelector('text=Review installation: video-maker')
  const t = await dlg().last().innerText(); assert.match(t, /~ SKILL\.md/); assert.match(t, /replaces the installed version/i)
  await writeFile(skillMd, 'LOCAL EDIT'); await btn('Cancel').last().click()
  await btn('Update / check diff').click(); await page.waitForSelector('text=modified locally'); assert.equal(await btn('Replace & install').isDisabled(), true)
  await btn('Cancel').last().click(); assert.equal(await read(skillMd), 'LOCAL EDIT', 'never silently overwritten')
  await btn('Update / check diff').click(); await page.waitForSelector('text=modified locally'); await dlg().last().getByRole('checkbox').check(); await btn('Replace & install').click(); await toast('Installed video-maker')
  assert.match(await read(skillMd), /# v2/)
})
await step('F: uninstall is confirmed, backed up, recoverable (backup restore)', async () => {
  await nav('My Skills'); await page.locator('.tile', { hasText: 'video-maker' }).click(); await btn('Uninstall', { exact: true }).click(); await page.waitForSelector('text=Uninstall video-maker?'); await btn('Uninstall', { exact: true }).last().click(); await toast('Uninstalled')
  assert.equal(await exists(path.join(fx.claude, 'skills/video-maker')), false); assert.equal(await exists(path.join(fx.claude, 'skills/my-local')), true)
  await nav('Backups'); await page.waitForSelector('tr:has-text("uninstall video-maker")'); await shot('08-backups')
  await page.locator('tr:has-text("uninstall video-maker")').getByRole('button', { name: 'Restore' }).click(); await btn('Restore', { exact: true }).last().click(); await toast('Restored')
  assert.match(await read(path.join(fx.claude, 'skills/video-maker/SKILL.md')), /# v2/)
})
await step('G: uninstalling a symlinked skill removes only the link', async () => {
  await nav('My Skills'); await page.locator('.tile', { hasText: 'linked-skill' }).click(); await btn('Uninstall', { exact: true }).click(); await btn('Uninstall', { exact: true }).last().click(); await toast('Uninstalled')
  assert.equal(await exists(path.join(fx.claude, 'skills/linked-skill')), false); assert.equal(await exists(path.join(fx.dir, 'shared/linked-skill/SKILL.md')), true, 'link target preserved')
})
// ───────────── MCP (B, F, G) ─────────────
await step('F: MCP list masks secrets everywhere in the renderer', async () => {
  await nav('MCP Servers'); await page.waitForSelector('tr:has-text("echo")'); await page.locator('tr', { hasText: 'echo' }).first().click(); await page.waitForSelector('text=SECRET_TOKEN')
  const html = await page.content(); assert.doesNotMatch(html, /super-secret-value-123|top-secret-bearer/)
  const raw = await invoke('mcp:list'); assert.doesNotMatch(JSON.stringify(raw), /super-secret-value-123|top-secret-bearer/)
})
await step('B/F: test connection requires approval, performs real handshake, lists tools, never calls them', async () => {
  await btn('Test connection…').click(); await page.waitForSelector('text=Start and test'); await shot('09-mcp-approval'); assert.match(await dlg().innerText(), /No tool will be called/)
  await btn('Start & test').click(); await page.waitForSelector('.diag:has-text("echo-fixture")', { timeout: 30000 })
  const t = await page.locator('.diag').innerText(); assert.match(t, /Tools discovered \(2\)/); assert.match(t, /Claude runtime status: unknown/); assert.doesNotMatch(t, /DANGEROUS CALLED|super-secret-value-123/)
  await shot('10-mcp-manager')
})
await step('F: unreachable remote server is diagnosed, not reported as success', async () => {
  await page.locator('tr', { hasText: 'remote' }).first().click(); await btn('Test connection…').click(); await btn('Start & test').click(); await page.waitForSelector('.diag', { timeout: 30000 })
  assert.match(await page.locator('.diag').innerText(), /✗\s*Protocol handshake/); assert.match(await page.locator('.diag').innerText(), /Error:/)
})
await step('B: add server via wizard (review step), preserves unrelated keys; edit keeps masked secret; delete with backup', async () => {
  await btn('Add server').click(); await page.fill('input[aria-label="Server name"]', 'added-one'); await page.fill('input[aria-label="Command"]', 'node'); await page.fill('textarea[aria-label="Arguments"]', 'x.js'); await page.fill('textarea[aria-label="Environment variables"]', 'API_KEY=abc123')
  await btn('Review').click(); assert.match(await dlg().innerText(), /\.claude\.json/); assert.doesNotMatch(await dlg().innerText(), /abc123/); await btn('Save (with backup)').click(); await toast('Saved added-one')
  let j = await claudeJson(); assert.equal(j.mcpServers['added-one'].env.API_KEY, 'abc123'); assert.equal(j.numStartups, 42); assert.deepEqual(j.projects[fx.proj].allowedTools, ['keep']); assert.ok(j.mcpServers.echo)
  await page.locator('tr', { hasText: 'added-one' }).click(); await btn('Edit', { exact: true }).click(); assert.match(await page.inputValue('textarea[aria-label="Environment variables"]'), /API_KEY=••••/)
  await page.fill('textarea[aria-label="Arguments"]', 'y.js'); await btn('Review').click(); await btn('Save (with backup)').click(); await toast('Saved added-one')
  j = await claudeJson(); assert.deepEqual(j.mcpServers['added-one'].args, ['y.js']); assert.equal(j.mcpServers['added-one'].env.API_KEY, 'abc123', 'masked placeholder keeps stored secret')
  await page.locator('tr', { hasText: 'added-one' }).click(); await btn('Delete', { exact: true }).click(); await btn('Delete', { exact: true }).last().click(); await toast('Deleted'); assert.equal((await claudeJson()).mcpServers['added-one'], undefined)
})
await step('G: external modification between open and save is detected, nothing overwritten', async () => {
  await page.locator('tr', { hasText: 'echo' }).first().click(); await btn('Edit', { exact: true }).click(); await page.fill('textarea[aria-label="Arguments"]', 'changed.js')
  const j = await claudeJson(); j.externalWrite = true; await writeFile(path.join(fx.home, '.claude.json'), JSON.stringify(j, null, 2))
  await btn('Review').click(); await btn('Save (with backup)').click(); await toast('changed on disk'); const after = await claudeJson(); assert.equal(after.externalWrite, true); assert.notDeepEqual(after.mcpServers.echo.args, ['changed.js']); await closeDialogs()
})
// ───────────── Projects (B) ─────────────
await step('B: register project (explicit), project dashboard + inheritance conflict', async () => {
  assert.equal((await invoke('projects:addPath', { path: fx.proj })).ok, true); await nav('Projects'); await page.locator('.plist button', { hasText: 'myproj' }).click(); await page.waitForSelector('.dhead h2:has-text("myproj")')
  assert.match(await page.locator('.tabbody').innerText(), /proj-skill/); await page.getByRole('tab', { name: 'Inheritance' }).click(); await page.waitForSelector('code:text-is("model")')
  const row = page.locator('tr', { has: page.locator('code:text-is("model")') }); assert.match(await row.innerText(), /conflict/); assert.match(await row.innerText(), /project/); await shot('11-project-dashboard')
})
await step('B: install into a specific project scope', async () => {
  await nav('Marketplace'); await btn('Import GitHub repository / skill URL').click(); await page.fill('input[placeholder="anthropics/skills"]', 'anthropics/skills'); await page.fill('input[placeholder="skills/frontend-design"]', 'skills/docs-writer')
  await page.selectOption('select[aria-label="Install scope"]', await realpath(fx.proj)); await btn('Review plan').click(); await page.waitForSelector('text=Review installation: docs-writer'); assert.match(await dlg().last().innerText(), /myproj\/\.claude\/skills\/docs-writer/)
  await btn('Approve & install').click(); await toast('Installed docs-writer'); assert.equal(await exists(path.join(fx.proj, '.claude/skills/docs-writer/SKILL.md')), true); assert.equal(await exists(path.join(fx.claude, 'skills/docs-writer')), false)
})
await step('F15: .mcp.json approval and scope-override states follow the documented rules (project keyed by a non-real path)', async () => {
  await nav('MCP Servers'); await page.waitForSelector('tr:has(b:text-is("pend"))'); const row = (n, scope) => page.locator('tr', { has: page.locator(`b:text-is("${n}")`) }).filter({ has: page.locator(`td:nth-child(2) .badge:text-is("${scope}")`) }).first()
  const txt = async (n, scope) => (await row(n, scope).innerText()).replace(/\s+/g, ' ')
  assert.match(await txt('pend', 'project'), /pending approval/); assert.match(await txt('appr', 'project'), /approved/); assert.match(await txt('rej', 'project'), /rejected/, 'rejection beats approval, even from the local file')
  assert.match(await txt('committed', 'project'), /pending approval/); assert.match(await row('committed', 'project').locator('span[title]').first().getAttribute('title'), /trust/i)
  assert.match(await txt('dis', 'project'), /disabled here/); assert.match(await txt('echo', 'project'), /pending approval/); assert.match(await txt('echo', 'user'), /overridden in 1/)
  await row('pend', 'project').click(); await page.waitForSelector('text=Configuration state'); const d = await page.locator('.detailpane').innerText(); assert.match(d, /run `claude`/); assert.match(d, /never by this app/)
  assert.equal(await page.getByRole('button', { name: /approve/i }).count(), 0, 'the app never approves servers on the user\'s behalf')
  await shot('21-mcp-approval-states')
})
await step('F16: same-name skills follow documented precedence; plugin skills are namespaced; plan warns before installing a clash', async () => {
  await nav('My Skills'); await page.selectOption('select[aria-label="Filter by scope"]', 'conflicts'); await page.waitForFunction(() => document.querySelectorAll('.tile').length === 2)
  const t = (await page.locator('.grid').innerText()).replace(/\s+/g, ' '); assert.match(t, /deploy/); assert.match(t, /shadowed/); assert.match(t, /ship/); assert.match(t, /not loaded/)
  await page.locator('.tile', { hasText: 'shadowed' }).click(); await page.waitForSelector('text=Name resolution'); const d = await page.locator('.detailpane').innerText(); assert.match(d, /shadowed by/i); assert.match(d, /personal skill/); await shot('22-skill-name-conflicts')
  await page.selectOption('select[aria-label="Filter by scope"]', 'all'); await page.locator('.tile', { hasText: 'Personal compact skill' }).click(); await page.waitForSelector('text=Name resolution'); assert.match(await page.locator('.detailpane').innerText(), /replaces builtin/i)
  await page.locator('.tile', { hasText: 'Plugin deploy skill' }).click(); await page.waitForSelector('text=Name resolution'); assert.match(await page.locator('.detailpane').innerText(), /No conflicts/); assert.match(await page.locator('.detailpane').innerText(), /\/fixture:deploy/)
  await nav('Marketplace'); await btn('Import GitHub repository / skill URL').click(); await page.fill('input[placeholder="anthropics/skills"]', 'o/other'); await page.fill('input[placeholder="skills/frontend-design"]', 'skills/deploy')
  await page.selectOption('select[aria-label="Install scope"]', await realpath(fx.proj)); await btn('Review plan').click(); await page.waitForSelector('text=Review installation: deploy')
  const p = await dlg().last().innerText(); assert.match(p, /runs the personal skill/); assert.match(p, /Will be invoked as/); await btn('Cancel').last().click(); assert.equal(await exists(path.join(fx.proj, '.claude/skills/deploy/SKILL.md')), true, 'existing project deploy untouched (plan wrote nothing new)')
  await nav('Overview'); const n = async (l) => +(await page.locator('.card', { hasText: l }).locator('b').innerText()); assert.ok((await n('Name conflicts')) >= 3); assert.equal(await n('MCP pending approval'), 3)
})
await step('F18: hooks from every documented source, with policy/trust state; a managed lock is reflected live', async () => {
  await nav('Hooks'); await page.waitForSelector('table.table tbody tr'); const text = async () => (await page.locator('table.table').innerText()).replace(/\s+/g, ' ')
  let t = await text()
  for (const label of ['User settings', 'Project settings', 'Managed 10-hook.json', 'Plugin fixture@market', 'Skill “compact”', 'Agent “reviewer”']) assert.ok(t.includes(label), `source listed: ${label}`)
  assert.match(t, /sends event data to collect\.example/); assert.match(t, /passes env vars into headers: API_TOKEN/); assert.match(t, /script scripts\/fmt\.sh/); assert.match(t, /script scripts\/check\.sh/)
  const proj = page.locator('tr', { hasText: 'Project settings' }).first(); assert.match(await proj.innerText(), /trust-gated/); assert.match(await proj.innerText(), /claude -p/); assert.match(await proj.innerText(), /committed to a repository you have not trusted/)
  assert.match(await page.locator('tr', { hasText: 'Skill “compact”' }).innerText(), /on demand/); assert.match(await page.locator('tr', { hasText: 'Managed 10-hook.json' }).innerText(), /configured/)
  await page.selectOption('select[aria-label="Hook source"]', 'plugin'); await page.waitForFunction(() => [...document.querySelectorAll('table.table tbody tr')].every((r) => r.innerText.includes('Plugin '))); await shot('23-hooks-sources'); await page.selectOption('select[aria-label="Hook source"]', 'all')
  assert.equal((await invoke('hooks:list')).r.hooks.every((h) => typeof h.status === 'string' && h.statusReason), true)
  const lock = path.join(fx.managed, 'managed-settings.d', '20-lock.json'); await writeFile(lock, JSON.stringify({ allowManagedHooksOnly: true }))
  try { await nav('Overview'); await nav('Hooks'); await page.waitForSelector('text=allowManagedHooksOnly'); t = await text(); assert.match(await page.locator('tr', { hasText: 'User settings' }).first().innerText(), /blocked by policy/); assert.match(await page.locator('tr', { hasText: 'Managed 10-hook.json' }).innerText(), /configured/); await shot('24-hooks-managed-lock') }
  finally { await rm(lock, { force: true }) }
  await nav('Overview'); await nav('Hooks'); await page.waitForSelector('table.table tbody tr'); assert.equal(await page.locator('text=allowManagedHooksOnly').count(), 0, 'lock lifted when the managed file is removed')
})
await step('B: custom agent create + edit with backup; hooks flagged', async () => {
  await nav('Agents'); await page.waitForSelector('tr:has-text("reviewer")'); await btn('New agent').click(); await page.fill('input[aria-label="Agent name"]', 'tester'); await page.fill('input[aria-label="Agent description"]', 'Writes tests'); await page.fill('textarea[aria-label="Agent prompt"]', 'You write tests.'); await btn('Create').click(); await toast('Agent created')
  assert.equal(await exists(path.join(fx.claude, 'agents/tester.md')), true); await page.waitForSelector('textarea[aria-label="Agent file"]'); await page.fill('textarea[aria-label="Agent file"]', '---\nname: tester\ndescription: Writes tests\n---\nEdited.\n'); await btn('Save', { exact: true }).click(); await toast('Saved'); assert.match(await read(path.join(fx.claude, 'agents/tester.md')), /Edited/)
  await nav('Hooks'); await page.waitForSelector('text=Hooks run programs'); const t = await page.locator('table').innerText(); assert.match(t, /network access/); assert.match(t, /dynamic execution/)
})
await step('commands + plugins pages', async () => {
  await nav('Commands'); await page.fill('input[aria-label="Search commands"]', 'go'); await page.waitForSelector('code:text-is("/fixture:go")'); await nav('Plugins'); await page.waitForSelector('tr:has-text("fixture")'); assert.match(await page.locator('tr:has-text("fixture")').innerText(), /enabled/)
})
// ───────────── Persona D: skill developer ─────────────
await step('D: Skill Studio create (template) → validate → save → discoverable; invalid blocks save; diff; tests', async () => {
  await nav('Skill Studio'); await page.selectOption('select[aria-label="Template"]', 'code-review'); await page.fill('input[aria-label="Skill name"]', 'review-helper'); await btn('Generate skill files').click(); await page.waitForSelector('textarea[aria-label="Editing SKILL.md"]')
  await shot('12-skill-studio'); await page.getByRole('tab', { name: 'Validation' }).click(); await page.waitForSelector('text=Static validation only')
  const md = await page.inputValue('textarea[aria-label="Editing SKILL.md"]'); await page.fill('textarea[aria-label="Editing SKILL.md"]', md.replace('name: review-helper', 'name: Bad Name')); await page.waitForSelector('text=lowercase letters'); assert.equal(await btn('Save to Claude').isDisabled(), true)
  await page.fill('textarea[aria-label="Editing SKILL.md"]', md); await page.waitForFunction(() => !document.body.innerText.includes('lowercase letters, digits and hyphens'))
  await btn('+ Add file').click(); await page.fill('input[aria-label="New file path"]', 'references/notes.md'); await btn('Add', { exact: true }).click(); await page.fill('textarea[aria-label="Editing references/notes.md"]', 'extra notes')
  await btn('Save to Claude').click(); await toast('Saved review-helper'); assert.equal(await read(path.join(fx.claude, 'skills/review-helper/references/notes.md')), 'extra notes')
  await page.getByRole('tab', { name: 'Tests' }).click(); await btn('+ Add test case').click(); await page.fill('input[aria-label="Test prompt"]', 'please review my pull request diff'); await page.locator('.case').getByLabel('Expected behavior').fill('lists findings'); await btn('Evaluate (static + simulated)').click(); await page.waitForSelector('text=shares terms with the description')
  await btn('Run with Claude…').click(); await page.waitForSelector('text=actual Claude execution'); await btn('Cancel').click()
})
await step('D: edit existing skill in Studio shows diff; export path validated; import/export roundtrip of local skill', async () => {
  await nav('My Skills'); await page.locator('.tile', { hasText: 'review-helper' }).click(); await btn('Edit in Studio').click(); await page.waitForSelector('textarea[aria-label="Editing SKILL.md"]')
  const md = await page.inputValue('textarea[aria-label="Editing SKILL.md"]'); await page.fill('textarea[aria-label="Editing SKILL.md"]', md + '\nExtra line\n'); await page.getByRole('tab', { name: 'Diff' }).click(); await page.waitForSelector('.diff .add:has-text("Extra line")')
  await btn('Save to Claude').click(); await btn('Save', { exact: true }).last().click(); await until(async () => /Extra line/.test(await read(path.join(fx.claude, 'skills/review-helper/SKILL.md'))))
  const exp = await invoke('studio:export', { name: '../x', files: {} }); assert.equal(exp.ok, false)
})
// ───────────── Persona E: org admin ─────────────
await step('E: connect catalog (HTTPS/localhost only), pinned resources, checksum enforced, install, presets', async () => {
  await nav('Organizations'); await page.fill('input[aria-label="Catalog location"]', `${mock.base}/catalog.json`); await btn('Connect').click(); await page.waitForSelector('h2:has-text("Acme Corp")')
  assert.match(await page.locator('.card-block').innerText(), /signature present \(not verified\)/)
  await page.locator('tr', { hasText: 'Docs' }).getByRole('button', { name: 'Install' }).click(); await toast('Checksum mismatch')
  await page.locator('tr', { hasText: 'PDF' }).getByRole('button', { name: 'Install' }).click(); await page.waitForSelector('text=Review installation: pdf'); assert.match(await dlg().last().innerText(), /Organization/); await btn('Approve & install').click(); await toast('Installed pdf')
  await page.waitForSelector('tr:has-text("PDF"):has-text("current")'); await shot('13-organization-catalog')
  const bad = await invoke('orgs:connect', { kind: 'url', value: 'http://evil.example/c.json' }); assert.equal(bad.ok, false); assert.match(bad.e, /https/)
})
await step('C/E: presets reviewed plan reports missing items honestly; custom preset saved', async () => {
  await nav('Presets'); await page.waitForSelector('text=Office documents'); await page.locator('.tile', { hasText: 'Office documents' }).getByRole('button', { name: 'Review plan' }).click(); await page.waitForSelector('text=Review installation plans')
  const t = await dlg().innerText(); assert.match(t, /docx|xlsx|pptx/); assert.match(t, /Not found|No files found/); await closeDialogs()
  await btn('New preset').click(); await page.fill('input[aria-label="Preset name"]', 'Content pack'); await page.fill('textarea[aria-label="Preset items"]', 'o/other/skills/mine\nanthropics/skills/skills/docs-writer'); await btn('Save', { exact: true }).click(); await toast('Preset saved'); await page.waitForSelector('.tile:has-text("Content pack")')
  await page.locator('.tile', { hasText: 'Content pack' }).getByRole('button', { name: 'Review plan' }).click(); await page.waitForSelector('text=mine'); await shot('14-presets'); await closeDialogs()
})
await step('C: individual skill from multi-skill community source (add source) installs alone', async () => {
  await nav('Marketplace'); await page.fill('input[aria-label="Add source repository"]', 'o/other'); await btn('Add', { exact: true }).click(); await toast('Added o/other'); await page.fill('input[aria-label="Search marketplace"]', 'spreadsheets'); await page.waitForSelector('.tile:has-text("mine")')
  await page.fill('input[aria-label="Search marketplace"]', ''); await page.selectOption('select[aria-label="Source type"]', 'community'); await page.waitForFunction(() => [...document.querySelectorAll('.tile')].every((t) => !t.innerText.includes('official source')))
})
// ───────────── Admin pages ─────────────
await step('F: security scan flags risky content advisory-only; hooks warnings', async () => {
  await nav('Security'); await btn('Scan installed skills & hooks').click(); await page.waitForSelector('table.table'); const t = await page.locator('body').innerText()
  assert.match(t, /Review recommended/); assert.match(t, /advisory/i); assert.match(t, /hooks with warnings/); assert.doesNotMatch(t, /\b(completely|100%|guaranteed|verified) safe\b|\bis safe\b/i); await shot('15-security')
})
await step('G: config editor — diff review, atomic save with backup, unknown keys kept, conflict + managed read-only + inheritance', async () => {
  await nav('Configuration'); await page.locator('.plist button', { hasText: 'User settings' }).click(); await page.waitForSelector('textarea[aria-label="File contents"]')
  const txt = await page.inputValue('textarea[aria-label="File contents"]'); await page.fill('textarea[aria-label="File contents"]', txt.replace('"model": "opus"', '"model": "sonnet"')); await btn('Review changes').click(); await page.waitForSelector('.diff .add'); await shot('16-config-editor')
  await btn('Save with backup').click(); await toast('Saved'); let s = await settings(); assert.equal(s.model, 'sonnet'); assert.deepEqual(s.someUnknownFutureKey, { keep: ['me'] })
  const txt2 = await page.inputValue('textarea[aria-label="File contents"]'); await writeFile(path.join(fx.claude, 'settings.json'), JSON.stringify({ ...s, externallyChanged: 1 }, null, 2))
  await page.fill('textarea[aria-label="File contents"]', txt2.replace('"sonnet"', '"haiku"')); await btn('Review changes').click(); await btn('Save with backup').click(); await toast('changed on disk'); assert.equal((await settings()).model, 'sonnet'); await closeDialogs()
  await page.fill('textarea[aria-label="File contents"]', '{ broken'); await btn('Review changes').click(); await page.waitForSelector('text=Invalid JSON'); assert.equal(await btn('Save with backup').isDisabled(), true); await closeDialogs()
  await page.locator('.plist button', { hasText: 'Managed settings' }).click(); await page.waitForSelector('text=read-only (managed)'); assert.equal(await page.locator('textarea[aria-label="File contents"]').getAttribute('readonly') !== null, true)
  assert.equal((await invoke('config:save', { id: path.join(fx.managed, 'managed-settings.json'), text: '{}', hash: 'x' })).ok, false)
  await page.getByRole('tab', { name: 'Inheritance' }).click(); await page.waitForSelector('code:text-is("theme")'); assert.match(await page.locator('tr', { has: page.locator('code:text-is("theme")') }).innerText(), /managed/)
})
await step('F/G: crash recovery UI rolls back an incomplete transaction', async () => {
  const bks = (await invoke('backups:list')).r; const target = bks.filter((b) => b.label.startsWith('config settings.json')).at(-1); assert.ok(target) // oldest = state before the first edit
  await mkdirP(path.join(fx.data, 'journal')); await writeFile(path.join(fx.data, 'journal', 'crashed.json'), JSON.stringify({ id: 'crashed', label: 'simulated crash', backupId: target.id, startedAt: new Date().toISOString(), status: 'pending' }))
  await nav('Overview'); await page.waitForSelector('text=did not finish last time'); await nav('Backups'); await page.waitForSelector('text=Incomplete operations detected'); await btn('Roll back').click(); await toast('Rolled back')
  assert.equal((await settings()).model, 'opus', 'restored to the pre-edit backup'); await page.waitForFunction(() => !document.body.innerText.includes('Incomplete operations detected'))
})
await step('activity log records operations; settings theme + welcome', async () => {
  await nav('Activity'); await page.waitForSelector('table.table'); assert.ok((await page.locator('tbody tr').count()) > 8); assert.match(await page.locator('table').innerText(), /skill\.install/); await shot('17-activity')
  await nav('Settings'); await page.selectOption('select[aria-label="Theme"]', 'light'); await page.waitForFunction(() => document.documentElement.dataset.theme === 'light'); await shot('18-settings'); await page.selectOption('select[aria-label="Theme"]', 'dark')
  assert.match(await page.locator('body').innerText(), /Telemetry: never/)
})
// ───────────── cross-cutting ─────────────
await step('REVIEW P0: editing a skill that has binary/large/odd files never corrupts or deletes them; explicit delete only removes that file', async () => {
  const dir = path.join(fx.claude, 'skills/with-bin'), png = await readFile(path.join(dir, 'assets/logo.png')), big = await readFile(path.join(dir, 'assets/big.bin'))
  await nav('My Skills'); await page.locator('.tile', { hasText: 'with-bin' }).click(); await btn('Edit in Studio').click(); await page.waitForSelector('textarea[aria-label="Editing SKILL.md"]')
  assert.equal(await page.locator('.studio aside .files li', { hasText: 'logo.png' }).count(), 0, 'binary not loaded into the text editor')
  const md = await page.inputValue('textarea[aria-label="Editing SKILL.md"]'); await page.fill('textarea[aria-label="Editing SKILL.md"]', md + '\nedited\n'); await btn('Save to Claude').click(); await btn('Save', { exact: true }).last().click()
  await until(async () => /edited/.test(await read(path.join(dir, 'SKILL.md'))))
  assert.deepEqual(await readFile(path.join(dir, 'assets/logo.png')), png); assert.equal((await readFile(path.join(dir, 'assets/big.bin'))).length, big.length); assert.equal(await read(path.join(dir, 'notes.md')), 'keep or delete me')
  await page.locator('.studio aside .files li', { hasText: 'notes.md' }).getByRole('button', { name: /Delete/ }).click(); await btn('Save to Claude').click(); await btn('Save', { exact: true }).last().click()
  await until(async () => !(await exists(path.join(dir, 'notes.md')))); assert.deepEqual(await readFile(path.join(dir, 'assets/logo.png')), png)
})
await step('REVIEW P0: dotfile-managed (symlinked) settings.json stays a symlink through every write', async () => {
  const link = path.join(fx.claude, 'settings.json'); assert.equal((await lstat(link)).isSymbolicLink(), true)
  assert.ok(JSON.parse(await read(path.join(fx.dir, 'dotfiles/settings.json'))).someUnknownFutureKey, 'edits landed in the real file')
})
await step('REVIEW P0: process-starting actions need the system dialog; renderer-supplied approval is not enough', async () => {
  await app.evaluate(() => { process.env.SKILLDOCK_E2E_NATIVE_CONFIRM = 'deny' })
  const d1 = await invoke('mcp:testDraft', { config: { command: process.execPath, args: ['-e', 'require("fs").writeFileSync(process.env.HOME+"/pwned","x")'] }, approved: true }); assert.equal(d1.ok, false); assert.match(d1.e, /Cancelled/); assert.equal(await exists(path.join(fx.home, 'pwned')), false)
  assert.equal((await invoke('studio:runClaude', { prompt: 'hi', approved: true })).ok, false); assert.equal((await invoke('plugins:action', { action: 'enable', id: 'x@y' })).ok, false)
  assert.equal((await invoke('mcp:testDraft', { config: { command: 'x' }, approved: false })).ok, false, 'approved must be literal true')
  await app.evaluate(() => { process.env.SKILLDOCK_E2E_NATIVE_CONFIRM = 'accept' })
  assert.equal((await invoke('plugins:action', { action: 'enable', id: '--help' })).ok, false); assert.equal((await invoke('studio:runClaude', { prompt: '--dangerously-skip-permissions', approved: true })).ok, false)
  assert.equal((await invoke('plugins:addMarketplace', { source: '--x/y' })).ok, false)
})
await step('REVIEW P0: previews cannot read through symlinks; agents reject frontmatter injection; strict CSP', async () => {
  const sk = (await invoke('skills:list')).r.find((s) => s.name === 'with-bin'); const r = await invoke('skills:file', { id: sk.id, rel: 'leak.md' }); assert.equal(r.ok, false); assert.doesNotMatch(JSON.stringify(r), /TOP SECRET/)
  assert.equal((await invoke('agents:create', { scope: 'user', name: 'inj', description: 'd', prompt: 'p', tools: 'Read\nhooks: evil' })).ok, false)
  const csp = await page.evaluate(() => document.querySelector('meta[http-equiv="Content-Security-Policy"]').content); assert.doesNotMatch(csp, /unsafe-/); assert.match(csp, /object-src 'none'/)
  assert.equal(await page.evaluate(() => { const d = document.createElement('div'); d.setAttribute('style', 'color: rgb(1, 2, 3)'); document.body.appendChild(d); return getComputedStyle(d).color !== 'rgb(1, 2, 3)' }), true, 'inline style attributes are blocked by CSP')
})
await step('keyboard: ⌘K palette navigates; tab order reaches controls', async () => {
  await page.keyboard.press('Meta+k'); await page.waitForSelector('[aria-label="Command palette search"]'); await page.keyboard.type('secur'); await page.keyboard.press('Enter'); await page.waitForSelector('h1:has-text("Security")')
  await page.keyboard.press('Tab'); assert.ok(await page.evaluate(() => document.activeElement && document.activeElement !== document.body))
})
await step('security: renderer isolated; IPC rejects unknown channels, arbitrary paths, traversal, non-https links', async () => {
  assert.equal(await page.evaluate(() => typeof require + typeof process + typeof Buffer), 'undefinedundefinedundefined'); assert.deepEqual(await page.evaluate(() => Object.keys(window.skilldock)), ['invoke'])
  assert.equal((await invoke('fs:read', { path: '/etc/passwd' })).ok, false); assert.equal((await invoke('config:read', { id: '/etc/passwd' })).ok, false)
  const sk = (await invoke('skills:list')).r.find((s) => s.name === 'my-local'); assert.equal((await invoke('skills:file', { id: sk.id, rel: '../../../../etc/passwd' })).ok, false)
  assert.equal((await invoke('app:openExternal', { url: 'http://example.com' })).ok, false); assert.equal((await invoke('skills:uninstall', { id: 'nope' })).ok, false)
  assert.equal((await invoke('projects:remove', { path: 5 })).ok, false)
  const prefs = await app.evaluate(({ BrowserWindow }) => { const p = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences(); return [p.sandbox, p.contextIsolation, p.nodeIntegration] }); assert.deepEqual(prefs, [true, true, false])
  const csp = await page.evaluate(() => document.querySelector('meta[http-equiv="Content-Security-Policy"]').content); assert.match(csp, /default-src 'self'/)
})
await step('layouts at multiple desktop sizes have no horizontal overflow', async () => {
  for (const [w, h] of [[1100, 700], [1280, 800], [1920, 1080]]) { await page.setViewportSize({ width: w, height: h }); await nav('Overview'); await page.waitForSelector('.cards'); await page.waitForTimeout(150)
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `overflow at ${w}`); await shot(`overview-${w}x${h}`) }
  await page.setViewportSize({ width: 1440, height: 900 })
})
await step('accessibility (axe): no critical violations on primary pages', async () => {
  const axe = await readFile(require.resolve('axe-core/axe.min.js'), 'utf8'); const report = {}
  for (const p of ['Overview', 'Marketplace', 'My Skills', 'MCP Servers', 'Configuration', 'Settings']) {
    await nav(p); await page.waitForTimeout(400); await page.evaluate(axe)
    const v = await page.evaluate(async () => (await axe.run(document, { resultTypes: ['violations'] })).violations.map((x) => ({ id: x.id, impact: x.impact, n: x.nodes.length })))
    report[p] = v; assert.deepEqual(v.filter((x) => x.impact === 'critical'), [], `${p}: ${JSON.stringify(v.filter((x) => x.impact === 'critical'))}`)
  }
})
await step('offline: cached marketplace still browsable and local management works; refresh fails gracefully', async () => {
  mock.close(); await nav('Marketplace'); await page.waitForSelector('.tile'); assert.ok((await page.locator('.tile').count()) >= 1)
  await btn('Refresh sources').click(); await toast('Refresh issues', 40000); await nav('My Skills'); await page.waitForSelector('.tile'); await nav('Configuration'); await page.waitForSelector('.plist')
})
assert.deepEqual(errors, [], 'no uncaught renderer errors: ' + errors.join('|'))
await app.close()

// ───────────── real ~/.claude, read-only ─────────────
await step('real system: detection + listing of the actual ~/.claude is read-only', async () => {
  const os = await import('node:os'); const realClaude = path.join(os.homedir(), '.claude'); const before = existsSync(path.join(realClaude, 'settings.json')) ? await read(path.join(realClaude, 'settings.json')) : ''
  const names = await readdir(path.join(realClaude, 'skills')).catch(() => [])
  const { mkdtemp } = await import('node:fs/promises'); const data = await mkdtemp(path.join(os.tmpdir(), 'skilldock-real-'))
  const { _electron } = await import('playwright-core'); const a = await _electron.launch({ args: [path.join(root, 'apps/desktop')], env: { ...process.env, SKILLDOCK_DATA_DIR: data } }); const w = await a.firstWindow()
  await w.waitForSelector('text=Welcome to SkillDock', { timeout: 20000 }); await w.click('text=Continue'); await w.waitForSelector('.cards'); const t = (await w.innerText('.cards')).replace(/\n/g, ' ')
  const n = +/(\d+) Skills/.exec(t)[1]; assert.ok(n >= names.length - 5 && n > 0, `real skills counted: ${t}`)
  await a.close() // (deliberately no screenshot: it would show the real machine's paths)
  assert.equal(existsSync(path.join(realClaude, 'settings.json')) ? await read(path.join(realClaude, 'settings.json')) : '', before, 'real settings.json untouched')
  assert.deepEqual((await readdir(path.join(realClaude, 'skills')).catch(() => [])).sort(), names.sort(), 'real skills dir untouched')
})
async function mkdirP(p) { const { mkdir } = await import('node:fs/promises'); await mkdir(p, { recursive: true }) }
const failed = results.filter((r) => !r.ok); writeFileSync(path.join(root, 'docs/e2e-results.json'), JSON.stringify({ at: new Date().toISOString(), passed: results.length - failed.length, failed: failed.length, results }, null, 2))
console.log(`\n${results.length - failed.length}/${results.length} e2e steps passed`); process.exit(failed.length ? 1 : 0)
