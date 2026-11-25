import { parse } from 'yaml'

export interface ParsedSkillMd { frontmatter: Record<string, unknown>; body: string; errors: string[] }

/** Tolerant SKILL.md parser: never throws; malformed YAML is reported, not fatal. */
export function parseSkillMd(text: string): ParsedSkillMd {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text.replace(/^﻿/, ''))
  if (!m) return { frontmatter: {}, body: text, errors: ['missing YAML frontmatter'] }
  try {
    const fm = parse(m[1]!)
    if (fm && typeof fm === 'object' && !Array.isArray(fm)) return { frontmatter: fm as Record<string, unknown>, body: m[2]!, errors: [] }
    return { frontmatter: {}, body: m[2]!, errors: ['frontmatter is not a mapping'] }
  } catch (e) {
    return { frontmatter: {}, body: m[2]!, errors: [`invalid YAML frontmatter: ${(e as Error).message.split('\n')[0]}`] }
  }
}
