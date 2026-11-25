// Launches the PACKAGED macOS app (read-only scan against the real ~/.claude; packaged builds ignore SKILLDOCK_* overrides).
import { _electron as electron } from 'playwright-core'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const root = path.resolve(fileURLToPath(new URL('../..', import.meta.url)))
const exe = path.join(root, `release/mac-${process.arch === 'arm64' ? 'arm64/' : ''}SkillDock.app/Contents/MacOS/SkillDock`)
// Test seams must be inert in a packaged build: hostile overrides are set and must be ignored.
const decoy = '/tmp/skilldock-decoy-home-must-be-ignored'
const app = await electron.launch({ executablePath: exe, env: { ...process.env, SKILLDOCK_HOME: decoy, SKILLDOCK_DATA_DIR: decoy + '-data', SKILLDOCK_E2E: '1', SKILLDOCK_GH_API: 'http://127.0.0.1:1', SKILLDOCK_E2E_NATIVE_CONFIRM: 'accept', SKILLDOCK_GH_TOKEN: 'ghp_decoy' } }); const page = await (async () => { for (;;) { const w = app.windows().find((x) => x.url().includes('index.html')); if (w) return w; await app.waitForEvent('window') } })() /* the startup splash is also a window */
const errs = []; page.on('pageerror', (e) => errs.push(e.message))
await page.waitForSelector('.cards, [role=dialog]', { timeout: 30000 }) // first run shows onboarding; returning runs go straight to Overview
if (await page.getByRole('dialog').count()) { await page.waitForSelector('[role=dialog] td:has-text("Claude Code CLI")'); await page.click('text=Continue') }
const info = await page.evaluate(() => window.skilldock.invoke('app:info')); assert.notEqual(info.home, decoy, 'SKILLDOCK_HOME must be ignored when packaged'); assert.notEqual(info.dataDir, decoy + '-data'); assert.equal(info.e2e, false, 'SKILLDOCK_E2E must be ignored when packaged')
assert.equal((await page.evaluate(() => window.skilldock.invoke('projects:addPath', { path: '/tmp' }).then(() => 'ran', (e) => e.message))), 'Error invoking remote method \'projects:addPath\': Error: Not available', 'e2e-only channel must be disabled')
const packaged = await app.evaluate(({ app }) => app.isPackaged); assert.equal(packaged, true)
await page.waitForSelector('.cards'); const t = (await page.innerText('.cards')).replace(/\n/g, ' '); assert.match(t, /\d+ Skills/)
const sec = await page.evaluate(() => window.skilldock.invoke('settings:get')); assert.equal(sec.telemetry, 'never')
const clip = await page.evaluate(async () => { try { await navigator.clipboard.writeText('skilldock-clip-probe'); return 'ok' } catch (e) { return e.name } }); assert.equal(clip, 'ok', `clipboard write in the packaged app: ${clip}`) // DEF-01
const clipRead = await page.evaluate(async () => { try { await navigator.clipboard.readText(); return 'allowed' } catch (e) { return 'denied' } }); assert.equal(clipRead, 'denied', 'clipboard READ must stay denied')
const dev = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.isDevToolsOpened()); assert.equal(dev, false)
assert.deepEqual(errs, []) // no screenshot: it would show the real machine's data
console.log('PACKAGED OK:', t); await app.close()
