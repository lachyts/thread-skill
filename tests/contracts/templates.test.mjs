// Template contracts: a skill's `*-template.md` files and the substitution bullets in the same directory's
// SKILL.md must agree exactly. Every `{{NAME}}` a template carries is documented as a substitution bullet (a
// line starting `` - `{{NAME}}` ``), and every documented bullet is used by at least one of the directory's
// templates: a directory with two templates (schedule's parallel and serial rollout notes) shares the bullets
// they have in common, so the rule is checked on the union of their placeholders. Otherwise the model filling
// a template either leaves a raw `{{NAME}}` in a rollout note or hunts for a value nothing uses (E2E verb 4:
// the template said `{{THREAD_LINE}}`, the list said `{{THREAD_PATH}}`).
//
// Reads files only. Deterministic and free, like manifest.test.mjs.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { root, walk, read } from '../lib/contract-text.mjs'

const PLACEHOLDER = /\{\{([A-Z][A-Z0-9_]*)\}\}/g
const DOCUMENTED = /^- `\{\{([A-Z][A-Z0-9_]*)\}\}`/

const placeholders = (text) => new Set([...text.matchAll(PLACEHOLDER)].map((m) => m[1]))
const documented = (text) => new Set(text.split('\n').map((l) => l.match(DOCUMENTED)?.[1]).filter(Boolean))

// The set comparison, shared by the real check and its control case.
function diffSets(used, docs) {
  return {
    undocumented: [...used].filter((n) => !docs.has(n)).sort(),
    unused: [...docs].filter((n) => !used.has(n)).sort(),
  }
}

const mdFiles = walk('skills').filter((f) => f.endsWith('.md'))
const templates = mdFiles.filter((f) => f.endsWith('-template.md'))
const substituted = templates.filter((f) => placeholders(read(f)).size > 0)
const skillDocFor = (tpl) => `${path.posix.dirname(tpl)}/SKILL.md`

// Per SKILL.md: { undocumented: per template, unused: against the union of the directory's templates }.
function checkDir(templateTexts, docText) {
  const docs = documented(docText)
  const union = new Set(templateTexts.flatMap((x) => [...placeholders(x)]))
  return {
    undocumented: [...new Set(templateTexts.flatMap((x) => diffSets(placeholders(x), docs).undocumented))].sort(),
    unused: diffSets(union, docs).unused,
  }
}

test('every placeholder template agrees exactly with its SKILL.md substitution list', () => {
  assert.ok(substituted.length >= 1, 'no skills/**/*-template.md carries a {{NAME}} placeholder — the check is vacuous')
  const byDoc = new Map()
  for (const tpl of substituted) byDoc.set(skillDocFor(tpl), [...(byDoc.get(skillDocFor(tpl)) ?? []), tpl])
  for (const [doc, tpls] of byDoc) {
    assert.ok(fs.existsSync(path.join(root, doc)), `${tpls.join(', ')}: no ${doc} to document their placeholders`)
    const { undocumented, unused } = checkDir(tpls.map(read), read(doc))
    assert.deepEqual({ undocumented, unused }, { undocumented: [], unused: [] },
      `${tpls.join(' + ')} ↔ ${doc}: used-but-undocumented [${undocumented.join(', ')}]; documented-but-unused [${unused.join(', ')}]`)
  }
})

test('schedule ships two placeholder templates, so the union rule is exercised', () => {
  const sched = substituted.filter((f) => f.startsWith('skills/schedule/'))
  assert.deepEqual(sched, ['skills/schedule/rollout-template.md', 'skills/schedule/serial-rollout-template.md'])
})

test('execute/subagent-prompt-template.md carries no {{ placeholders (skipped by construction)', () => {
  const f = 'skills/execute/subagent-prompt-template.md'
  assert.ok(templates.includes(f), `${f} is gone — update this test`)
  assert.ok(!read(f).includes('{{'), `${f} now carries {{…}}; document them in skills/execute/SKILL.md`)
})

test('every {{NAME}} mentioned anywhere in skills/**/*.md is a documented placeholder', () => {
  const docs = new Set(substituted.flatMap((tpl) => [...documented(read(skillDocFor(tpl)))]))
  const stray = []
  for (const f of mdFiles) {
    for (const n of placeholders(read(f))) if (!docs.has(n)) stray.push(`${f}: {{${n}}}`)
  }
  assert.deepEqual(stray, [])
})

test('every {{ inside a template opens a well-formed {{NAME}} (no typo slips past the set check)', () => {
  const bad = []
  for (const tpl of templates) {
    const text = read(tpl)
    for (const m of text.matchAll(/\{\{/g)) {
      if (!/^\{\{[A-Z][A-Z0-9_]*\}\}/.test(text.slice(m.index))) {
        const line = text.slice(0, m.index).split('\n').length
        bad.push(`${tpl}:${line} ${text.slice(m.index, m.index + 24).split('\n')[0]}`)
      }
    }
  }
  assert.deepEqual(bad, [])
})

test('control: the set check reports a synthetic undocumented and a synthetic unused name', () => {
  const tpl = 'a {{KEPT}} b {{NEW_ONE}}\n'
  const doc = '- `{{KEPT}}` — kept\n- `{{OLD_ONE}}` — no longer used\nprose mentioning `{{KEPT}}` is not a bullet\n'
  assert.deepEqual(diffSets(placeholders(tpl), documented(doc)), { undocumented: ['NEW_ONE'], unused: ['OLD_ONE'] })
})

test('control: in a two-template directory, a bullet neither template uses is reported, one only the other uses is not', () => {
  const doc = '- `{{SHARED}}` — both\n- `{{ONLY_A}}` — the first\n- `{{ONLY_B}}` — the second\n- `{{NEITHER}}` — stale\n'
  assert.deepEqual(checkDir(['{{SHARED}} {{ONLY_A}}', '{{SHARED}} {{ONLY_B}}'], doc), { undocumented: [], unused: ['NEITHER'] })
  assert.deepEqual(checkDir(['{{SHARED}} {{ONLY_A}}', '{{SHARED}} {{ONLY_B}} {{NEW}}'], doc), { undocumented: ['NEW'], unused: ['NEITHER'] })
})
