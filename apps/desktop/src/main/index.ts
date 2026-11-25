import { inheritShellPath } from './path'
import { app, BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron'
import path from 'node:path'
import { handlers } from './handlers'

const RENDERER_URL = process.env['ELECTRON_RENDERER_URL']
let win: BrowserWindow | null = null

// Reject IPC from anything other than our own window's top frame.
function trusted(e: IpcMainInvokeEvent): void {
  const url = e.senderFrame?.url ?? ''
  const ok = e.sender === win?.webContents && e.senderFrame === win.webContents.mainFrame && (RENDERER_URL ? url.startsWith(RENDERER_URL) : url.startsWith('file://'))
  if (!ok) throw new Error('untrusted IPC sender')
}

for (const [channel, { schema, fn }] of Object.entries(handlers)) {
  ipcMain.handle(channel, async (e, raw) => { trusted(e); return fn(schema.parse(raw)) })
}

/** Startup splash (B10): shown immediately, closed the moment the main window can paint. No timers, so it never delays startup. */
function showSplash(main: BrowserWindow): void {
  const splash = new BrowserWindow({ width: 704, height: 396, frame: false, resizable: false, movable: true, show: false, skipTaskbar: true, center: true, backgroundColor: '#0B0B14', title: 'SkillDock', webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, devTools: false } })
  splash.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  splash.once('ready-to-show', () => { if (!main.isVisible()) splash.show() })
  const close = () => { if (!splash.isDestroyed()) splash.close() }
  main.once('show', close)
  main.webContents.once('did-fail-load', close)
  void (RENDERER_URL ? splash.loadURL(new URL('splash.html', RENDERER_URL + '/').href) : splash.loadFile(path.join(__dirname, '../renderer/splash.html')))
}

/** Platform-aware title bar: macOS inset traffic lights; Windows hidden bar + native min/max/close overlay; Linux keeps the native frame. The renderer's top bar is the drag region. */
function titleBar(): Partial<Electron.BrowserWindowConstructorOptions> {
  if (process.platform === 'darwin') return { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 14 } }
  if (process.platform === 'win32') return { titleBarStyle: 'hidden', titleBarOverlay: { color: '#0B0B14', symbolColor: '#B4B4C8', height: 44 } }
  return {}
}

/** App icon (dark tile derived from the supplied icon art). Packaged builds embed it via electron-builder; this covers unpackaged runs (dock) and the Linux window icon. */
const iconPath = app.isPackaged ? path.join(process.resourcesPath, 'icon.png') : path.join(__dirname, '../../build/icon.png')

function createWindow(): void {
  if (process.platform === 'darwin' && !app.isPackaged) app.dock?.setIcon(iconPath)
  win = new BrowserWindow({
    show: false, icon: iconPath, width: 1360, height: 860, minWidth: 640, minHeight: 520, backgroundColor: '#101216', title: 'SkillDock', ...titleBar(),
    webPreferences: { preload: path.join(__dirname, '../preload/index.js'), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, devTools: !app.isPackaged }
  })
  win.once('ready-to-show', () => win?.show())
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (e, url) => { if (!(RENDERER_URL && url.startsWith(RENDERER_URL))) e.preventDefault() })
  // Deny every permission except writing to the clipboard (the Copy buttons need it); clipboard READ stays denied.
  win.webContents.session.setPermissionRequestHandler((_wc, p, cb) => cb(p === 'clipboard-sanitized-write'))
  win.webContents.session.setPermissionCheckHandler((_wc, p) => p === 'clipboard-sanitized-write')
  if (RENDERER_URL) win.webContents.session.webRequest.onHeadersReceived((d, cb) => cb({ responseHeaders: { ...d.responseHeaders, 'Content-Security-Policy': ["default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws://localhost:* http://localhost:*; img-src 'self' data:"] } })) // dev server only
  if (RENDERER_URL) void win.loadURL(RENDERER_URL)
  else void win.loadFile(path.join(__dirname, '../renderer/index.html'))
  if (!process.env.SKILLDOCK_E2E || app.isPackaged) showSplash(win) // e2e runs skip it: automation must see the app window as the first window
}

app.whenReady().then(async () => { if (!process.env.SKILLDOCK_E2E || app.isPackaged) await inheritShellPath(); createWindow() }) // e2e runs keep their controlled PATH
app.on('window-all-closed', () => app.quit())
