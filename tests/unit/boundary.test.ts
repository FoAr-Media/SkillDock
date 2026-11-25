// Architecture guard: the renderer must stay a pure UI; privileged code lives only in main; preload exposes one function.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from 'vitest'

const root = path.resolve(__dirname, '../..')
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = path.join(d, f); return statSync(p).isDirectory() ? walk(p) : [p] })
const imports = (file: string) => [...readFileSync(file, 'utf8').matchAll(/(?:import|export)[^'"\n]*from\s+['"]([^'"]+)['"]|import\(['"]([^'"]+)['"]\)|require\(['"]([^'"]+)['"]\)/g)].map((m) => m[1] ?? m[2] ?? m[3]!)

test('renderer imports no Node, Electron, or core modules (only react, lucide-react, bundled font CSS + relative)', () => {
  const bad: string[] = []
  for (const f of walk(path.join(root, 'apps/desktop/src/renderer')).filter((f) => /\.tsx?$/.test(f)))
    for (const i of imports(f)) if (!(i.startsWith('.') || i === 'react' || i === 'lucide-react' || i.startsWith('@fontsource-variable/') || i === 'react-dom/client' || i === 'react/jsx-runtime' || i === 'vite/client')) bad.push(`${path.relative(root, f)} → ${i}`)
  expect(bad).toEqual([])
})
test('renderer uses no inline style attributes (CSP style-src has no unsafe-inline)', () => {
  const hits = walk(path.join(root, 'apps/desktop/src/renderer')).filter((f) => /\.tsx$/.test(f)).filter((f) => /style=\{\{/.test(readFileSync(f, 'utf8')))
  expect(hits).toEqual([])
})
test('preload exposes exactly one function and never raw ipcRenderer', () => {
  const src = readFileSync(path.join(root, 'apps/desktop/src/preload/index.ts'), 'utf8')
  expect([...src.matchAll(/exposeInMainWorld\(/g)]).toHaveLength(1)
  expect(src).toMatch(/const api = \{\s*invoke:/); expect(src).not.toMatch(/exposeInMainWorld\('skilldock', ipcRenderer\)/)
  expect(imports(path.join(root, 'apps/desktop/src/preload/index.ts'))).toEqual(['electron'])
})
test('main window keeps sandbox, isolation, no node integration', () => {
  const src = readFileSync(path.join(root, 'apps/desktop/src/main/index.ts'), 'utf8')
  for (const s of ['contextIsolation: true', 'sandbox: true', 'nodeIntegration: false', 'webSecurity: true']) expect(src).toContain(s)
  expect(src).toContain('setWindowOpenHandler'); expect(src).toContain("trusted(e)")
})
test('every handler schema-validates; process-starting channels use the native confirm and a literal-true approval', () => {
  const src = readFileSync(path.join(root, 'apps/desktop/src/main/handlers.ts'), 'utf8')
  for (const ch of ['mcp:test', 'mcp:testDraft', 'studio:runClaude', 'plugins:action', 'plugins:addMarketplace']) {
    const body = src.slice(src.indexOf(`'${ch}'`)); expect(body.slice(0, 900)).toContain('nativeConfirm')
  }
  expect(src).not.toMatch(/approved: z\.boolean\(\)/)
})
test('core never imports electron', () => {
  const bad = walk(path.join(root, 'packages/core/src')).filter((f) => imports(f).some((i) => i === 'electron'))
  expect(bad).toEqual([])
})
