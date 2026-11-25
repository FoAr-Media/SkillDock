// Dependency license tooling. `node scripts/licenses.mjs check` fails on non-permissive/unknown licenses; `... notices` writes THIRD_PARTY_NOTICES.md.
// Scope = the production closure that ends up inside the app (everything is bundled at build time).
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const ROOTS = ['yaml', 'zod', 'diff', '@modelcontextprotocol/sdk', 'react', 'react-dom', 'lucide-react', '@fontsource-variable/inter', '@fontsource-variable/jetbrains-mono'] // keep in sync with packages/core + apps/desktop dependencies
const ALLOWED = new Set(['MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', '0BSD', 'BlueOak-1.0.0', 'Python-2.0', 'CC0-1.0', 'Unlicense', 'OFL-1.1']) // OFL-1.1 covers the bundled Inter and JetBrains Mono font files
const read = (n) => { const p = path.join('node_modules', n, 'package.json'); return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null }
const seen = new Map(), q = [...ROOTS]
while (q.length) { const n = q.pop(); if (seen.has(n)) continue; const d = read(n); seen.set(n, d); if (d) for (const k of Object.keys(d.dependencies ?? {})) q.push(k) }
const licenseOf = (d) => { const l = d.license ?? d.licenses; return Array.isArray(l) ? l.map((x) => x.type).join(' OR ') : typeof l === 'object' && l ? l.type : String(l ?? 'UNKNOWN') }
const pkgs = [...seen].filter(([, d]) => d).map(([n, d]) => ({ n, v: d.version, l: licenseOf(d) })).sort((a, b) => (a.n < b.n ? -1 : 1))

if (process.argv[2] === 'check') {
  const bad = pkgs.filter((p) => !p.l.split(/\s+(?:OR|AND)\s+|[()]/).map((s) => s.trim()).filter(Boolean).some((s) => ALLOWED.has(s)))
  console.log(`${pkgs.length} bundled packages checked`)
  if (bad.length) { console.error('Non-permissive or unknown licenses:\n' + bad.map((p) => `  ${p.n}@${p.v}: ${p.l}`).join('\n')); process.exit(1) }
  console.log('all licenses permissive')
} else if (process.argv[2] === 'notices') {
  const out = ['# Third-party notices', '', 'SkillDock bundles the packages below (production dependency closure). Each is distributed under the license shown; license texts follow.', '', 'Electron and Chromium components are covered by `LICENSE.electron.txt` and `LICENSES.chromium.html` inside the application bundle.', '', '| Package | Version | License |', '|---|---|---|', ...pkgs.map((p) => `| ${p.n} | ${p.v} | ${p.l} |`), '']
  for (const p of pkgs) {
    const dir = path.join('node_modules', p.n), f = existsSync(dir) ? readdirSync(dir).find((x) => /^(licen[sc]e|copying)(\.(md|txt))?$/i.test(x)) : undefined
    out.push(`## ${p.n}@${p.v} (${p.l})`, '', f ? '```\n' + readFileSync(path.join(dir, f), 'utf8').trim() + '\n```' : '_No license file shipped in the package; license identifier taken from package.json._', '')
  }
  writeFileSync('THIRD_PARTY_NOTICES.md', out.join('\n')); console.log(`wrote THIRD_PARTY_NOTICES.md (${pkgs.length} packages)`)
} else { console.log('usage: licenses.mjs check|notices'); process.exit(2) }
