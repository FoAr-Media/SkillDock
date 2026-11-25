// Design-system behaviour: notification popover auto-close, theme switching/persistence, responsive tiers, keyboard, fonts.
import assert from 'node:assert/strict'
import { startMock, makeFixture, launch } from './harness.mjs'
const mock = await startMock(), fx = await makeFixture(); const { app, page } = await launch(fx, mock)
const results = []; const step = async (n, f) => { try { await f(); results.push([1, n]); console.log('  ✓', n) } catch (e) { results.push([0, n]); console.log('  ✗', n, '\n   ', e.message) } }
await page.getByRole('button', { name: 'Continue' }).click(); await page.waitForSelector('.cards')
const bell = () => page.locator('button[aria-expanded]').filter({ has: page.locator('.sr', { hasText: 'Notifications' }) })
const open = async () => { await bell().click(); await page.waitForSelector('.notes') }
const gone = async (ms = 1500) => { await page.waitForSelector('.notes', { state: 'detached', timeout: ms }) }

await step('notifications close on outside click', async () => { await open(); await page.mouse.click(600, 400); await gone() })
await step('notifications close on Escape', async () => { await open(); await page.keyboard.press('Escape'); await gone() })
await step('notifications close on navigation', async () => { await open(); await page.locator('nav.sidebar').getByRole('button', { name: 'Marketplace' }).click(); await gone() })
await step('notifications close by themselves after the idle timeout', async () => { await open(); await page.mouse.move(600, 500); await page.waitForSelector('.notes', { state: 'detached', timeout: 12000 }) })
await step('notifications stay open while the pointer is inside', async () => { await open(); await page.locator('.notes').hover(); await page.waitForTimeout(10500); assert.ok(await page.locator('.notes').count() === 1); await page.keyboard.press('Escape'); await gone() })
await step('theme menu: light/dark apply, persist across reload with no flash', async () => {
  await page.getByRole('button', { name: 'Theme' }).click(); await page.getByRole('menuitemradio', { name: 'Light' }).click()
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light')
  await page.reload(); assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'light') // set by theme-init.js before React
  await page.getByRole('button', { name: 'Theme' }).click(); await page.getByRole('menuitemradio', { name: 'Dark' }).click()
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark')
})
await step('tokens: brand colour and fonts are applied', async () => {
  const r = await page.evaluate(() => ({ brand: getComputedStyle(document.documentElement).getPropertyValue('--brand').trim().toLowerCase(), bg: getComputedStyle(document.body).backgroundColor, ui: getComputedStyle(document.body).fontFamily }))
  assert.ok(r.brand); assert.equal(r.bg, 'rgb(11, 11, 20)'); assert.match(r.ui, /Inter Variable/)
  assert.ok(await page.evaluate(() => document.fonts.check('14px "Inter Variable"')))
})
for (const [w, h, mode] of [[1440, 900, 'full'], [1000, 700, 'rail'], [700, 760, 'drawer'], [640, 520, 'drawer']]) await step(`responsive ${w}×${h}: ${mode} layout, no horizontal overflow on 6 pages`, async () => {
  await page.setViewportSize({ width: w, height: h }); await page.waitForTimeout(250)
  const cls = await page.locator('.app').getAttribute('class'); assert.equal(mode === 'full' ? !/rail|drawer/.test(cls) : cls.includes(mode), true, cls)
  for (const p of ['Overview', 'Marketplace', 'My Skills', 'MCP Servers', 'Security', 'Settings']) {
    if (mode === 'drawer') await page.getByRole('button', { name: 'Open navigation' }).click()
    await page.locator('nav.sidebar').getByRole('button', { name: p }).click(); await page.waitForTimeout(250)
    const o = await page.evaluate(() => { const c = document.querySelector('.content'); return [document.documentElement.scrollWidth - innerWidth, c.scrollWidth - c.clientWidth] })
    assert.ok(o[0] <= 0 && o[1] <= 1, `${p} overflows at ${w}: ${o}`)
  }
})
await step('drawer navigation: opens, Escape/scrim closes, hidden from tab order when closed', async () => {
  await page.setViewportSize({ width: 700, height: 760 }); await page.waitForTimeout(250)
  assert.equal(await page.locator('nav.sidebar').getAttribute('inert') !== null, true)
  await page.getByRole('button', { name: 'Open navigation' }).click(); assert.equal(await page.locator('nav.sidebar').getAttribute('inert'), null)
  await page.keyboard.press('Escape'); await page.waitForTimeout(300); assert.equal(await page.locator('nav.sidebar').getAttribute('inert') !== null, true)
})
await step('keyboard: ⌘K palette opens and Escape closes; focus ring visible on Tab', async () => {
  await page.setViewportSize({ width: 1300, height: 800 }); await page.waitForTimeout(250)
  await page.keyboard.press('Meta+k'); await page.waitForSelector('.modal'); await page.keyboard.press('Escape'); await page.waitForSelector('.modal', { state: 'detached' })
  await page.keyboard.press('Tab'); const ol = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle); assert.notEqual(ol, 'none')
})
await step('shell: nav groups, sidebar width 232–248px, status indicators, theme-matched logo', async () => {
  await page.setViewportSize({ width: 1440, height: 900 }); await page.waitForTimeout(250)
  assert.deepEqual(await page.locator('nav.sidebar h2').allInnerTexts(), ['Workspace', 'Collections', 'System'])
  const w = (await page.locator('nav.sidebar').boundingBox()).width; assert.ok(w >= 232 && w <= 248, `sidebar ${w}`)
  assert.ok(await page.locator('.statusbar .dot').count() >= 2)
  const vis = async (cls) => page.locator(`.brand img.${cls}`).evaluate((e) => getComputedStyle(e).display !== 'none')
  await page.getByRole('button', { name: 'Theme' }).click(); await page.getByRole('menuitemradio', { name: 'Dark' }).click(); await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark')
  assert.equal(await vis('logo-on-dark'), true); assert.equal(await vis('logo-on-light'), false)
  await page.getByRole('button', { name: 'Theme' }).click(); await page.getByRole('menuitemradio', { name: 'Light' }).click(); await page.waitForFunction(() => document.documentElement.dataset.theme === 'light')
  assert.equal(await vis('logo-on-light'), true); assert.equal(await vis('logo-on-dark'), false)
  const nat = await page.locator('.brand img.logo-on-light').evaluate((e) => [e.naturalWidth / e.naturalHeight, e.width / e.height]); assert.ok(Math.abs(nat[0] - nat[1]) < 0.05, 'logo aspect ratio preserved')
  await page.getByRole('button', { name: 'Theme' }).click(); await page.getByRole('menuitemradio', { name: 'Dark' }).click(); await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark')
})
await step('shell: ⌘B collapses to a 60–64px rail with tooltips; the choice persists across reload', async () => {
  await page.keyboard.press('Meta+b'); await page.waitForSelector('.app.rail')
  const w = (await page.locator('nav.sidebar').boundingBox()).width; assert.ok(w >= 60 && w <= 64, `rail ${w}`)
  await page.locator('nav.sidebar').getByRole('button', { name: 'Marketplace' }).hover()
  assert.equal(await page.locator('nav.sidebar button[data-label="Marketplace"]').evaluate((e) => getComputedStyle(e, '::after').content), '"Marketplace"')
  await page.waitForTimeout(300); await page.reload(); await page.waitForSelector('.app.rail')
  await page.keyboard.press('Meta+b'); await page.waitForFunction(() => !document.querySelector('.app.rail')); await page.reload(); await page.waitForSelector('.app'); assert.equal(await page.locator('.app.rail').count(), 0)
})
await step('shell: ⌘, opens Settings', async () => { await page.keyboard.press('Meta+,'); await page.getByRole('heading', { name: /settings/i }).first().waitFor() })
await step('panels: sidebar and list/detail dividers resize by drag and keyboard, persist, and reset on double-click', async () => {
  await page.setViewportSize({ width: 1440, height: 900 }); await page.waitForTimeout(250)
  const sb = async () => (await page.locator('nav.sidebar').boundingBox()).width
  const h = page.getByRole('separator', { name: 'Resize sidebar' }); const b = await h.boundingBox(); const w0 = await sb()
  await page.mouse.move(b.x + 4, b.y + 300); await page.mouse.down(); await page.mouse.move(b.x + 84, b.y + 300, { steps: 5 }); await page.mouse.up()
  assert.ok(Math.abs((await sb()) - (w0 + 80)) < 6, `dragged ${w0} -> ${await sb()}`)
  await h.focus(); await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft'); assert.ok(Math.abs((await sb()) - (w0 + 48)) < 6)
  await page.reload(); await page.waitForSelector('.app'); assert.ok(Math.abs((await sb()) - (w0 + 48)) < 6, 'sidebar width persisted')
  await page.getByRole('separator', { name: 'Resize sidebar' }).dblclick(); await page.waitForTimeout(100); assert.ok(Math.abs((await sb()) - w0) < 4, 'reset')
  await page.locator('nav.sidebar').getByRole('button', { name: 'My Skills' }).click(); await page.waitForSelector('.listpane')
  const lw = async () => (await page.locator('.listpane').boundingBox()).width; const l0 = await lw()
  const lh = page.getByRole('separator', { name: 'Resize list and detail panels' }); const lb = await lh.boundingBox()
  await page.mouse.move(lb.x + 4, lb.y + 200); await page.mouse.down(); await page.mouse.move(lb.x - 116, lb.y + 200, { steps: 5 }); await page.mouse.up()
  assert.ok(Math.abs((await lw()) - (l0 - 120)) < 8, `list ${l0} -> ${await lw()}`)
  await lh.dblclick()
})
await step('My Skills: category chips and filter work like the marketplace', async () => {
  await page.locator('nav.sidebar').getByRole('button', { name: 'My Skills' }).click(); await page.waitForSelector('.listpane .tile')
  const total = await page.locator('.listpane .tile').count(); const chips = page.locator('.chips[aria-label="Category shortcuts"] .chip'); assert.ok(await chips.count() > 0, 'category chips present')
  await chips.first().click(); const n = await page.locator('.listpane .tile').count(); assert.ok(n > 0 && n <= total); assert.equal(await chips.first().getAttribute('aria-pressed'), 'true')
  await chips.first().click(); assert.equal(await page.locator('.listpane .tile').count(), total)
})
await app.close(); mock.close()
const bad = results.filter((r) => !r[0]).length; console.log(`\n${results.length - bad}/${results.length} design steps passed`); process.exit(bad ? 1 : 0)
