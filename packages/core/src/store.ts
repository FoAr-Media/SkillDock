import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import path from 'node:path'

/** App-owned metadata (index/cache/journal). Claude's own files stay authoritative; never store secrets here. */
const MIGRATIONS = [
  `CREATE TABLE projects (path TEXT PRIMARY KEY, added_at TEXT NOT NULL);
   CREATE TABLE installations (id TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL, scope TEXT NOT NULL, project TEXT, target TEXT NOT NULL, source TEXT NOT NULL, version TEXT, tree_hash TEXT, installed_at TEXT NOT NULL, pinned INTEGER NOT NULL DEFAULT 0, org TEXT);
   CREATE TABLE audit_events (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, action TEXT NOT NULL, detail TEXT NOT NULL, ok INTEGER NOT NULL, backup_id TEXT);
   CREATE TABLE marketplace_sources (id TEXT PRIMARY KEY, kind TEXT NOT NULL, spec TEXT NOT NULL, official INTEGER NOT NULL DEFAULT 0, verified_at TEXT);
   CREATE TABLE marketplace_entries (id TEXT PRIMARY KEY, source_id TEXT NOT NULL, json TEXT NOT NULL, verified_at TEXT NOT NULL);
   CREATE TABLE organizations (id TEXT PRIMARY KEY, location TEXT NOT NULL, json TEXT NOT NULL, fetched_at TEXT NOT NULL);
   CREATE TABLE presets (id TEXT PRIMARY KEY, name TEXT NOT NULL, json TEXT NOT NULL);
   CREATE TABLE preferences (key TEXT PRIMARY KEY, value TEXT NOT NULL);
   CREATE TABLE update_checks (installation_id TEXT PRIMARY KEY, latest TEXT, checked_at TEXT NOT NULL);
   CREATE TABLE skill_tests (skill_id TEXT PRIMARY KEY, json TEXT NOT NULL);`,
  // v2: marketplace source verification state (commit-based cache reuse, status, errors, repo stats)
  `ALTER TABLE marketplace_sources ADD COLUMN commit_sha TEXT;
   ALTER TABLE marketplace_sources ADD COLUMN status TEXT NOT NULL DEFAULT 'never';
   ALTER TABLE marketplace_sources ADD COLUMN error TEXT;
   ALTER TABLE marketplace_sources ADD COLUMN stars INTEGER;
   ALTER TABLE marketplace_sources ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE marketplace_sources ADD COLUMN entry_count INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE marketplace_sources ADD COLUMN mode TEXT;
   ALTER TABLE marketplace_sources ADD COLUMN last_attempt TEXT;`
]

export class Store {
  db: DatabaseSync
  constructor(file: string) {
    if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true })
    this.db = new DatabaseSync(file)
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON')
    const v = (this.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
    for (let i = v; i < MIGRATIONS.length; i++) { this.db.exec(MIGRATIONS[i]!); this.db.exec(`PRAGMA user_version=${i + 1}`) }
  }
  all<T = any>(sql: string, ...p: any[]): T[] { return this.db.prepare(sql).all(...p) as T[] }
  get<T = any>(sql: string, ...p: any[]): T | undefined { return this.db.prepare(sql).get(...p) as T | undefined }
  run(sql: string, ...p: any[]) { return this.db.prepare(sql).run(...p) }

  audit(action: string, detail: string, ok = true, backupId?: string) {
    this.run('INSERT INTO audit_events(ts,action,detail,ok,backup_id) VALUES (?,?,?,?,?)', new Date().toISOString(), action, detail, ok ? 1 : 0, backupId ?? null)
  }
  pref(key: string): string | undefined { return this.get<{ value: string }>('SELECT value FROM preferences WHERE key=?', key)?.value }
  setPref(key: string, value: string) { this.run('INSERT INTO preferences(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', key, value) }
  projects(): string[] { return this.all<{ path: string }>('SELECT path FROM projects ORDER BY path').map((r) => r.path) }
}
