// Template contracts: a skill's `*-template.md` and the "Substitute:" list in the same directory's
// SKILL.md must agree exactly. Every `{{NAME}}` the template carries is documented as a substitution
// bullet (a line starting `` - `{{NAME}}` ``), and every documented bullet is used. Otherwise the model
// filling the template either leaves a raw `{{NAME}}` in a rollout note or hunts for a value nothing
// uses (E2E verb 4: the template said `{{THREAD_LINE}}`, the list said `{{THREAD_PATH}}`).
//
// Reads files only. Deterministic and free, like manifest.test.mjs.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')

// Recursive walk, repo-relative paths (no fs.globSync: not in every Node this repo runs on).
const walk = (d) => fs.readdirSync(path.join(root, d), { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`]))
  .sort()

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

test('every placeholder template agrees exactly with its SKILL.md substitution list', () => {
  assert.ok(substituted.length >= 1, 'no skills/**/*-template.md carries a {{NAME}} placeholder — the check is vacuous')
  for (const tpl of substituted) {
    const doc = skillDocFor(tpl)
    assert.ok(fs.existsSync(path.join(root, doc)), `${tpl}: no ${doc} to document its placeholders`)
    const { undocumented, unused } = diffSets(placeholders(read(tpl)), documented(read(doc)))
    assert.deepEqual({ undocumented, unused }, { undocumented: [], unused: [] },
      `${tpl} ↔ ${doc}: used-but-undocumented [${undocumented.join(', ')}]; documented-but-unused [${unused.join(', ')}]`)
  }
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
