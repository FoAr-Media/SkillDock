import path from 'node:path'
import type { Skill } from './types'

// Curated list of long-standing built-in commands (NOT exhaustive: `/help` is authoritative for your version).
export const BUILTIN_COMMANDS: [string, string, string][] = [['help', 'Show help and available commands', 'Session'], ['clear', 'Clear conversation history', 'Session'], ['compact', 'Compact the conversation, optionally with focus instructions', 'Session'], ['config', 'Open settings', 'Configuration'], ['mcp', 'Manage MCP server connections', 'Extensions'], ['agents', 'Manage subagents', 'Extensions'], ['init', 'Initialize a CLAUDE.md for the project', 'Project'], ['memory', 'Edit memory / CLAUDE.md files', 'Project'], ['model', 'Select the model', 'Session'], ['permissions', 'View or update tool permissions', 'Configuration'], ['resume', 'Resume a previous conversation', 'Session'], ['hooks', 'Manage hooks', 'Extensions'], ['doctor', 'Check installation health', 'Diagnostics']]
export const BUILTIN_COMMAND_NAMES: ReadonlySet<string> = new Set(BUILTIN_COMMANDS.map(([n]) => n))
/** Docs: where /ship is available, a custom skill or command named ship, ship-local or steward is not loaded. */
export const RESERVED_NAMES: ReadonlySet<string> = new Set(['ship', 'ship-local', 'steward'])

export type NameConflictKind = 'shadowed-by' | 'shadows' | 'command-overridden' | 'duplicate' | 'replaces-builtin' | 'reserved'
export interface NameConflict { kind: NameConflictKind; name: string; detail: string; other?: { id: string; label: string; scope: string } }
export interface NameInfo {
  /** Commands that invoke this skill (frontmatter name AND directory name; plugin skills are namespaced). */
  names: string[]
  /** active: wins every name · partial: loses some · shadowed: loses all · reserved: not loaded by Claude Code */
  status: 'active' | 'partial' | 'shadowed' | 'reserved'
  conflicts: NameConflict[]
}

const base = (s: Skill) => (s.scope === 'legacy-command' ? s.name : path.basename(s.dir))
const fmName = (s: Skill) => (typeof s.frontmatter.name === 'string' && s.frontmatter.name.trim() ? s.frontmatter.name.trim() : undefined)
/** Documented: in a personal/project skill directory, `name` sets the command and the directory name also invokes it. */
export function commandNames(s: Skill): string[] {
  if (s.scope === 'legacy-command') return [s.name]
  const own = [...new Set([fmName(s), base(s)].filter((x): x is string => !!x))]
  return s.scope === 'plugin' ? own.slice(0, 1) : own
}
const label = (s: Skill) => `${s.scope === 'user' ? 'personal' : s.scope} skill “${base(s)}”${s.source && s.scope === 'project' ? ` (${path.basename(s.source)})` : ''}`
const other = (s: Skill) => ({ id: s.id, label: label(s), scope: s.scope })
const rank = (s: Skill) => (s.scope === 'user' ? 1 : s.scope === 'project' ? 2 : 9)

/**
 * Documented resolution (code.claude.com/docs/en/skills "Resolve skills that share a name"):
 * enterprise > personal > project; a skill beats a .claude/commands file; a skill replaces a built-in command (not its aliases);
 * plugin skills are namespaced (/plugin:name) and never conflict; skills of different projects never interact.
 * Not modelled: enterprise (managed) skills, nested/added-directory skills, claude.ai synced skills.
 */
export function analyzeSkillNames(skills: Skill[], builtin: ReadonlySet<string> = BUILTIN_COMMAND_NAMES): Map<string, NameInfo> {
  const out = new Map<string, NameInfo>()
  const lost = new Map<string, Set<string>>(), won = new Map<string, Set<string>>()
  for (const s of skills) {
    out.set(s.id, { names: s.scope === 'plugin' ? commandNames(s).map((n) => `/${(s.source ?? '').split('@')[0]}:${n}`) : commandNames(s).map((n) => `/${n}`), status: 'active', conflicts: [] })
    lost.set(s.id, new Set()); won.set(s.id, new Set())
  }
  const add = (s: Skill, c: NameConflict) => { const l = out.get(s.id)!.conflicts; if (!l.some((x) => x.kind === c.kind && x.name === c.name && x.other?.id === c.other?.id)) l.push(c) }
  const local = skills.filter((s) => s.scope !== 'plugin')
  const contexts = [...new Set(local.filter((s) => s.scope === 'project').map((s) => s.source ?? ''))]
  for (const ctx of contexts.length ? contexts : ['']) {
    const inCtx = local.filter((s) => s.scope === 'user' || (s.scope === 'project' && (s.source ?? '') === ctx) || (s.scope === 'legacy-command' && (!s.source || s.source === ctx)))
    const byName = new Map<string, Skill[]>()
    for (const s of inCtx) for (const n of commandNames(s)) byName.set(n, [...(byName.get(n) ?? []), s])
    for (const [n, entries] of byName) {
      const real = entries.filter((e) => e.scope !== 'legacy-command'), cmds = entries.filter((e) => e.scope === 'legacy-command')
      if (RESERVED_NAMES.has(n)) for (const e of entries) add(e, { kind: 'reserved', name: `/${n}`, detail: `Where the bundled /${n} is available, Claude Code does not load a custom /${n}.` })
      if (builtin.has(n) && real.length) add(real[0]!, { kind: 'replaces-builtin', name: `/${n}`, detail: `Replaces the built-in /${n} command in a local terminal session (its aliases still run the built-in). Built-in list is curated, not exhaustive.` })
      if (real.length) {
        const top = Math.min(...real.map(rank)), winners = real.filter((e) => rank(e) === top)
        if (winners.length > 1) for (const w of winners) for (const o of winners) if (o !== w) add(w, { kind: 'duplicate', name: `/${n}`, other: other(o), detail: `Two skills of the same level answer to /${n}; the documentation does not say which one runs.` })
        for (const e of real) if (rank(e) > top) {
          const w = winners[0]!; lost.get(e.id)!.add(n)
          add(e, { kind: 'shadowed-by', name: `/${n}`, other: other(w), detail: `/${n} runs the ${label(w)} instead (enterprise > personal > project).` })
          for (const x of winners) { won.get(x.id)!.add(n); add(x, { kind: 'shadows', name: `/${n}`, other: other(e), detail: `Takes /${n} over the ${label(e)}.` }) }
        }
        for (const c of cmds) { lost.get(c.id)!.add(n); add(c, { kind: 'command-overridden', name: `/${n}`, other: other(winners[0]!), detail: `A skill named ${n} wins over a .claude/commands file of the same name.` }); add(winners[0]!, { kind: 'shadows', name: `/${n}`, other: other(c), detail: `Takes /${n} over the custom command file.` }) }
      }
    }
  }
  for (const s of skills) {
    const info = out.get(s.id)!, names = commandNames(s), l = lost.get(s.id)!
    const reserved = names.length > 0 && names.every((n) => RESERVED_NAMES.has(n))
    info.status = reserved ? 'reserved' : s.scope === 'plugin' ? 'active' : l.size === 0 ? 'active' : l.size >= names.length ? 'shadowed' : 'partial'
  }
  return out
}
