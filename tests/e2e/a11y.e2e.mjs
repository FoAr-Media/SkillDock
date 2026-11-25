// Accessibility sweep (axe-core): every route x dark/light theme + the install-plan dialog. Fails on critical or serious violations.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { startMock, makeFixture, launch, root } from './harness.mjs'
const require = createRequire(import.meta.url), axe = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8')
const mock = await startMock(), fx = await makeFixture(); const { app, page } = await launch(fx, mock)
await page.waitForSelector('text=Welcome to SkillDock'); const scan = async (label) => { await page.evaluate(axe); const v = await page.evaluate(async () => (await axe.run(document, { resultTypes: ['violations'] })).violations.map((x) => ({ id: x.id, impact: x.impact, n: x.nodes.length, sample: x.nodes[0]?.target?.join(' ').slice(0, 90) }))); return { label, v } }
const report = []; report.push(await scan('onboarding dialog')); await page.getByRole('button', { name: 'Continue' }).click()
const routes = ['Overview', 'Marketplace', 'My Skills', 'MCP Servers', 'Plugins', 'Commands', 'Agents', 'Hooks', 'Projects', 'Skill Studio', 'Presets', 'Organizations', 'Security', 'Configuration', 'Backups', 'Activity', 'Settings']
for (const theme of ['dark', 'light']) {
  await page.locator('nav.sidebar').getByRole('button', { name: 'Settings', exact: true }).click(); await page.selectOption('select[aria-label="Theme"]', theme); await page.waitForTimeout(150)
  for (const r of routes) { await page.locator('nav.sidebar').getByRole('button', { name: r, exact: true }).click(); await page.waitForTimeout(350); report.push(await scan(`${r} [${theme}]`)) }
  if (theme === 'dark') { await page.locator('nav.sidebar').getByRole('button', { name: 'Marketplace', exact: true }).click(); await page.waitForSelector('.tile'); await page.locator('.tile').first().click(); await page.waitForSelector('.resource-page h1'); report.push(await scan('Resource page [dark]'))
    await page.getByRole('button', { name: 'Review installation plan' }).click(); await page.waitForSelector('text=Review installation:'); report.push(await scan('Install plan dialog [dark]')); await page.keyboard.press('Escape') }
}
await app.close(); mock.close()
const bad = report.flatMap((r) => r.v.filter((x) => ['critical', 'serious'].includes(x.impact)).map((x) => ({ page: r.label, ...x })))
const minor = report.flatMap((r) => r.v.filter((x) => !['critical', 'serious'].includes(x.impact)).map((x) => ({ page: r.label, ...x })))
writeFileSync(path.join(root, 'docs/a11y-report.json'), JSON.stringify({ at: new Date().toISOString(), scanned: report.length, seriousOrCritical: bad, minorOrModerate: minor }, null, 2))
console.log(`scanned ${report.length} views; serious/critical: ${bad.length}; moderate/minor: ${minor.length}`); for (const b of bad.slice(0, 20)) console.log(`  ${b.impact} ${b.id} x${b.n} on ${b.page} e.g. ${b.sample}`)
process.exit(bad.length ? 1 : 0)
