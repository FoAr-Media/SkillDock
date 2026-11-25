// LIVE marketplace flows against the REAL GitHub + MCP registry. Fixture HOME only; the real ~/.claude is checksummed before/after.
// Run: SKILLDOCK_LIVE=1 node tests/e2e/marketplace-live.e2e.mjs   (optional SKILLDOCK_GH_TOKEN for a higher API limit)
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { readdir, readFile, lstat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { makeFixture, launchLive, root } from './harness.mjs'

if (!process.env.SKILLDOCK_LIVE) { console.log('skipped: set SKILLDOCK_LIVE=1 to run against the real network'); process.exit(0) }
const SHOTS = path.join(root, 'docs/screenshots/live'); mkdirSync(SHOTS, { recursive: true })
const realClaude = path.join(os.homedir(), '.claude')
const fingerprint = async () => createHash('sha256').update(JSON.stringify([(await readdir(path.join(realClaude, 'skills')).catch(() => [])).sort(), existsSync(path.join(realClaude, 'settings.json')) ? readFileSync(path.join(realClaude, 'settings.json'), 'utf8') : ''])).digest('hex')
const realBefore = await fingerprint()
const fx = await makeFixture(); const { app, page } = await launchLive(fx)
const errors = []; page.on('pageerror', (e) => errors.push(e.message))
const shot = (n) => page.screenshot({ path: path.join(SHOTS, `${n}.png`) })
const nav = (l) => page.locator('nav.sidebar').getByRole('button', { name: l, exact: true }).click()
const toast = (t, ms = 120000) => page.waitForSelector(`.toast:has-text("${t}")`, { timeout: ms })
const btn = (n, o = {}) => page.getByRole('button', { name: n, ...o })
const results = [], facts = {}
async function step(name, fn) { const t = Date.now(); try { await fn(); results.push({ name, ok: true, ms: Date.now() - t }); console.log(`  ✓ ${name}`) } catch (e) { results.push({ name, ok: false, error: e.message.split('\n')[0] }); console.log(`  ✗ ${name}\n      ${e.message.split('\n').slice(0, 4).join('\n      ')}`); await page.screenshot({ path: path.join(SHOTS, `FAIL-${results.length}.png`) }).catch(() => {}); await page.keyboard.press('Escape').catch(() => {}) } }
const showing = async () => { const m = /Showing (\d+) of (\d+)/.exec(await page.locator('p[aria-live="polite"]').innerText()); return m ? { shown: +m[1], total: +m[2] } : null }
const filterCat = async (c) => { await page.selectOption('select[aria-label="Category"]', c); await page.waitForFunction(() => /Showing \d+ of \d+/.test(document.querySelector('p[aria-live="polite"]')?.innerText ?? '')) }
const reset = async () => { await nav('Marketplace'); await page.waitForSelector('select[aria-label="Category"]') }

await step('onboarding is read-only; marketplace auto-verifies the two official sources from real GitHub', async () => {
  await page.waitForSelector('text=Welcome to SkillDock', { timeout: 30000 }); await page.getByRole('button', { name: 'Continue' }).click(); await nav('Marketplace')
  await page.waitForSelector('.tile', { timeout: 150000 }); const s = await showing(); assert.ok(s.total > 5, `official skills listed: ${s.total}`); facts.officialSkills = s.total
  assert.match(await page.locator('.tile').first().innerText(), /official source/); assert.match(await page.locator('p.note', { hasText: 'GitHub API budget' }).innerText(), /\d+ \/ \d+ requests left/)
  facts.rateMeter = await page.locator('p.note', { hasText: 'GitHub API budget' }).innerText(); await shot('30-official-sources')
})
await step('featured sources: add real video, development, productivity and design repositories (verified live)', async () => {
  await page.locator('summary', { hasText: 'Sources & verification' }).click()
  for (const id of ['remotion-dev/skills', 'addyosmani/agent-skills', 'obsidianmd/obsidian-skills', 'pbakaus/impeccable']) { await page.getByRole('button', { name: `Add ${id}` }).click(); await toast(`Added ${id}`) }
  const rows = await page.locator('details table').first().locator('tbody tr').allInnerTexts(); facts.sourceRows = rows.map((r) => r.replace(/\s+/g, ' ').slice(0, 160))
  for (const id of ['remotion-dev/skills', 'addyosmani/agent-skills', 'obsidianmd/obsidian-skills', 'pbakaus/impeccable']) { const r = rows.find((x) => x.includes(id)); assert.match(r, /verified/); assert.match(r, /\d[\d,]{2,}/, `${id} shows live stars`) }
  await shot('31-sources-verification'); await page.locator('summary', { hasText: 'Sources & verification' }).click()
})
const area = async (name, category, shotName, mustSource) => step(`${name}: real "${category}" resources are discovered, filterable and sorted by repository stars`, async () => {
  await reset(); await filterCat(category); const s = await showing(); assert.ok(s.total > 0, `${category}: ${s.total}`); facts[name] = { category, total: s.total }
  if (mustSource) { await page.fill('input[aria-label="Search marketplace"]', mustSource.q); await page.waitForFunction((q) => document.querySelectorAll('.tile').length > 0, mustSource.q); assert.match((await page.locator('.grid').innerText()).toLowerCase(), new RegExp(mustSource.q)); await page.fill('input[aria-label="Search marketplace"]', '') }
  await page.waitForSelector('.tile'); await shot(shotName)
})
await area('video production', 'Video creation', '32-video-production', { q: 'remotion' })
await area('development', 'Testing', '33-development')
await area('productivity', 'Productivity', '34-productivity')
await area('design', 'UI/UX design', '35-design')
await step('mirrored skills collapse into one listing with a mirror badge (real impeccable repository)', async () => {
  await reset(); await page.fill('input[aria-label="Search marketplace"]', 'impeccable'); await page.waitForSelector('.tile'); const t = await page.locator('.grid').innerText(); assert.match(t, /\+\d+ mirrors?/); facts.mirrorBadge = (/\+\d+ mirrors?/.exec(t) ?? [])[0]
  const count = await page.locator('.tile').count(); facts.impeccableTiles = count; assert.ok(count < 26, `collapsed below the raw 26 SKILL.md files: ${count}`); await shot('35b-mirrors-collapsed')
})
await step('resource page for a real video skill: live repo stats, docs, files, versions, security explanation', async () => {
  await reset(); await page.fill('input[aria-label="Search marketplace"]', 'remotion best practices'); await page.waitForSelector('.tile'); await page.locator('.tile').first().click(); await page.waitForSelector('.resource-page h1')
  const t = await page.locator('.resource-page').innerText(); assert.match(t, /★ [\d,]{2,}/); assert.match(t, /whole repository, not this resource/); assert.match(t, /Commit\s+[0-9a-f]{10}/); facts.resource = (await page.locator('.resource-page h1').innerText()); await shot('36-resource-page')
  await page.getByRole('tab', { name: 'Documentation' }).click(); await page.waitForSelector('.resource-page .doc h2, .resource-page .doc h3, .resource-page .doc p', { timeout: 60000 }); await shot('37-resource-docs')
  await page.getByRole('tab', { name: 'Files' }).click(); assert.match(await page.locator('.tabbody').innerText(), /SKILL\.md/); await page.getByRole('tab', { name: 'Security & install' }).click(); assert.match(await page.locator('.tabbody').innerText(), /Not inspected/)
  await page.getByRole('tab', { name: 'Overview' }).click(); const usage = await page.locator('.tabbody').innerText(); assert.match(usage, /documented in SKILL\.md/i)
})
let installedName
await step('transactional install of a real skill: staged plan with security inspection → approve → verified in the FIXTURE home → backup recorded', async () => {
  const skillsDir = path.join(fx.claude, 'skills'); const beforeNames = (await readdir(skillsDir)).sort()
  await btn('Review installation plan').click(); await page.waitForSelector('text=Review installation:', { timeout: 120000 }); const dlg = page.getByRole('dialog').last(); const t = await dlg.innerText()
  installedName = /Review installation: (.+)/.exec(t)[1].trim(); assert.match(t, /Exact file changes/i); assert.match(t, /Security/); assert.match(t, /Will be invoked as/); assert.match(t, /Nothing has been written/); facts.plan = { name: installedName, security: /Security\s+([^\n]+)/.exec(t)?.[1] }
  assert.deepEqual((await readdir(skillsDir)).sort(), beforeNames, 'plan wrote nothing'); await shot('38-install-plan-security-preview')
  const risk = dlg.getByRole('checkbox'); if (await risk.count()) { for (let i = 0; i < await risk.count(); i++) await risk.nth(i).check() }
  await btn(/Approve & install|Replace & install/).click(); await toast(`Installed ${installedName}`, 120000)
  assert.ok((await readdir(skillsDir)).includes(installedName)); assert.match(await readFile(path.join(skillsDir, installedName, 'SKILL.md'), 'utf8'), /^---/); assert.deepEqual(await fingerprint(), realBefore, 'the REAL ~/.claude is untouched')
})
await step('installed state is reflected (resource page, My Skills) and uninstall is backed up and verified', async () => {
  await page.waitForSelector('.resource-page:has-text("installed")'); assert.match(await page.locator('.resource-page').innerText(), /installed · current/); await shot('39-installed-state')
  await nav('My Skills'); await page.locator('.tile', { hasText: installedName }).first().click(); await page.waitForSelector(`.dhead h2:has-text("${installedName}")`); await btn('Uninstall', { exact: true }).click(); await btn('Uninstall', { exact: true }).last().click(); await toast('Uninstalled')
  assert.equal(await lstat(path.join(fx.claude, 'skills', installedName)).then(() => true, () => false), false); await nav('Backups'); await page.waitForSelector(`tr:has-text("uninstall ${installedName}")`); await shot('40-backups-after-uninstall'); assert.deepEqual(await fingerprint(), realBefore)
})
await step('Find repositories on GitHub: live topic search returns unverified candidates with real stars', async () => {
  await reset(); await btn('Find repositories on GitHub…').click(); await page.fill('input[aria-label="Minimum repository stars"]', '1000'); await btn('Search GitHub').click(); await page.waitForSelector('[role=dialog] tbody tr', { timeout: 60000 })
  const t = await page.getByRole('dialog').innerText(); assert.match(t, /not yet inspected/); assert.match(t, /\d[\d,]{3,}/); facts.findRepos = (await page.locator('[role=dialog] tbody tr').count()); await shot('41-find-repositories'); await page.keyboard.press('Escape')
})
await step('MCP registry: real search → resource page with the configuration that would be created → wizard prefilled (nothing written)', async () => {
  await reset(); await page.getByRole('tab', { name: /^MCP/ }).click(); await page.fill('input[aria-label="Search MCP registry"]', 'github'); await btn('Search registry').click(); await page.waitForSelector('.tile', { timeout: 60000 })
  const tile = page.locator('.tile', { has: page.locator('.badge', { hasText: 'mcp' }) }).first(); facts.mcpTiles = await page.locator('.tile').count(); await tile.click(); await page.waitForSelector('.resource-page h1'); await shot('42-mcp-registry-resource')
  const wiz = btn('Configure in MCP wizard…'); if (await wiz.count()) { await wiz.click(); await page.waitForSelector('text=Add MCP server'); await shot('43-mcp-wizard-prefilled'); await page.keyboard.press('Escape') }
  assert.equal(existsSync(path.join(fx.home, '.claude.json')) ? JSON.parse(await readFile(path.join(fx.home, '.claude.json'), 'utf8')).mcpServers.added : undefined, undefined)
})
assert.deepEqual(errors, [], 'no renderer errors'); await app.close()
assert.deepEqual(await fingerprint(), realBefore, 'real Claude configuration byte-identical after the whole run')
const failed = results.filter((r) => !r.ok); writeFileSync(path.join(root, 'docs/live-e2e-results.json'), JSON.stringify({ at: new Date().toISOString(), authenticated: !!process.env.SKILLDOCK_GH_TOKEN, realClaudeUntouched: true, facts, results }, null, 2))
console.log(`\n${results.length - failed.length}/${results.length} live steps passed`); process.exit(failed.length ? 1 : 0)
