import { promises as fs } from 'node:fs'
import path from 'node:path'

export type Severity = 'info' | 'review' | 'high'
export interface Finding { severity: Severity; rule: string; file: string; line?: number; message: string }
export type SecurityStatus = 'not-inspected' | 'inspection-completed' | 'review-recommended' | 'high-risk' | 'blocked' | 'user-approved'

interface Rule { id: string; severity: Severity; re: RegExp; message: string }
// Advisory heuristics only. A clean result is NOT a safety guarantee.
const RULES: Rule[] = [
  { id: 'pipe-to-shell', severity: 'high', re: /(curl|wget)\b[^\n|]*\|\s*(sudo\s+)?(ba|z)?sh\b/, message: 'Downloads and pipes content into a shell' },
  { id: 'destructive', severity: 'high', re: /\brm\s+-[a-z]*r[a-z]*f?\s+(\/|~|\$HOME)|\bmkfs\b|\bdd\s+if=.*of=\/dev\//, message: 'Destructive filesystem command' },
  { id: 'sudo', severity: 'review', re: /\bsudo\b/, message: 'Uses sudo / elevated privileges' },
  { id: 'eval-exec', severity: 'review', re: /\beval\s*\(|\bexec\s*\(|child_process|subprocess\.|os\.system|\bshell=True/, message: 'Dynamic code or process execution' },
  { id: 'obfuscation', severity: 'high', re: /base64\s+(-d|--decode)|atob\(|fromCharCode\(.*\)\s*\)|[A-Za-z0-9+/]{400,}={0,2}/, message: 'Possible obfuscated payload' },
  { id: 'credentials', severity: 'review', re: /\.ssh\b|\.aws\b|\.npmrc|\.netrc|id_rsa|credentials\.json|keychain|API[_-]?KEY|SECRET|PASSWORD|\bTOKEN\b/i, message: 'References credentials or secret stores' },
  { id: 'env-access', severity: 'info', re: /process\.env|os\.environ|\bgetenv\(|\$\{?[A-Z][A-Z0-9_]{3,}\}?/, message: 'Reads environment variables' },
  { id: 'network', severity: 'review', re: /\bhttps?:\/\/(?!(localhost|127\.0\.0\.1))[^\s)'"`>]+|\bfetch\(|requests\.(get|post)|\bcurl\b|\bwget\b|\bnc\s+-/, message: 'Makes or references network requests' },
  { id: 'fs-write', severity: 'info', re: /writeFile|fs\.write|open\([^)]*['"]w|>\s*~\/|>>\s*~\//, message: 'Writes to the filesystem' },
  { id: 'config-tamper', severity: 'high', re: /\.claude\/settings|\.claude\.json|\.zshrc|\.bashrc|authorized_keys|crontab/, message: 'Touches Claude settings, shell profile or persistence locations' }
]
const SCRIPT_EXT = new Set(['.sh', '.bash', '.zsh', '.py', '.js', '.mjs', '.ts', '.rb', '.pl', '.ps1', '.bat', '.cmd'])
const BINARY_EXT = new Set(['.exe', '.dll', '.so', '.dylib', '.bin', '.jar', '.class', '.wasm', '.node', '.pkg', '.dmg', '.msi', '.app'])
const MAX_SCAN = 512 * 1024
const MAX_FILES = 2000

/** Apply the advisory rules to one text file's contents. */
export function scanText(file: string, text: string): Finding[] {
  const out: Finding[] = []
  text.split('\n').forEach((line, i) => { for (const r of RULES) if (r.re.test(line)) out.push({ severity: r.severity, rule: r.id, file, line: i + 1, message: r.message }) })
  return out
}

export async function scanDir(dir: string): Promise<{ findings: Finding[]; status: SecurityStatus; scripts: string[] }> {
  const findings: Finding[] = [], scripts: string[] = []
  let seen = 0
  const walk = async (d: string) => {
    for (const e of await fs.readdir(d, { withFileTypes: true })) {
      if (++seen > MAX_FILES) { if (seen === MAX_FILES + 1) findings.push({ severity: 'review', rule: 'too-many-files', file: '.', message: `More than ${MAX_FILES} files; scan truncated` }); return }
      const p = path.join(d, e.name), rel = path.relative(dir, p)
      if (e.isSymbolicLink()) { findings.push({ severity: 'high', rule: 'symlink', file: rel, message: 'Contains a symlink (never followed)' }); continue }
      if (e.isDirectory()) { await walk(p); continue }
      if (!e.isFile()) continue
      const ext = path.extname(e.name).toLowerCase(), st = await fs.stat(p)
      if (SCRIPT_EXT.has(ext)) scripts.push(rel)
      if (st.mode & 0o111) findings.push({ severity: 'review', rule: 'executable-bit', file: rel, message: 'File is marked executable' })
      const fh = await fs.open(p, 'r'); const buf = Buffer.alloc(Math.min(st.size, MAX_SCAN)); try { await fh.read(buf, 0, buf.length, 0) } finally { await fh.close() }
      if (BINARY_EXT.has(ext) || buf.includes(0)) {
        if (!/\.(png|jpe?g|gif|webp|ico|pdf|ttf|woff2?|otf|zip|mp[34]|wav)$/i.test(e.name)) findings.push({ severity: 'high', rule: 'binary', file: rel, message: 'Unexpected binary file' })
        continue
      }
      findings.push(...scanText(rel, buf.toString('utf8')))
    }
  }
  await walk(dir)
  // Findings in prose docs are less alarming than in scripts: keep but don't let docs alone mark high-risk on 'network'.
  const status: SecurityStatus = findings.some((f) => f.severity === 'high') ? 'high-risk' : findings.some((f) => f.severity === 'review') ? 'review-recommended' : 'inspection-completed'
  return { findings: findings.slice(0, 300), status, scripts }
}
