// The vault grammar is defined once (skills/_shared/vault-grammar.md): the phase/task filename pattern and
// the status sets. Its readers keep literal copies (reconcile-project.py's PHASE_N, LANDED and ACTIVE,
// reconcile-rollout.py's PHASED_STEM_RE, next-action.py's DEAD_STATUSES and OPEN_STATUSES) because none of
// them imports a doc; this test pins each copy to the doc, so neither side drifts silently. The prose readers
// (orient § 2, reshuffle R1, reconcile-project.py's docstring) cite the doc instead of restating it.
// Controls prove the checks are not vacuous. Reads files and imports the scripts (no __pycache__ written).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { collapse, read, root, section } from '../lib/contract-text.mjs'

const DOC = 'skills/_shared/vault-grammar.md'
const CITE = '_shared/vault-grammar.md'
const doc = read(DOC)
const orient = read('skills/orient/SKILL.md')
const reshuffle = read('skills/orient/reshuffle.md')

// ---- the doc's grammar --------------------------------------------------------------------------------

// The backticked tokens of the `- **<label>**` bullet under § Statuses, sorted; null when absent.
function statusSet(text, label) {
  const s = section(text, /^## Statuses\b/)
  const line = s?.split('\n').find((l) => l.startsWith(`- **${label}**`))
  return line ? [...line.matchAll(/`([^`]+)`/g)].map((m) => m[1]).sort() : null
}

// What the doc states: {landed, active, phaseN}, each null when the doc does not state it.
function grammarOf(text) {
  const names = section(text, /^## Phase and task filenames\b/)
  const m = names?.match(/`PHASE_N` = `([^`]+)`/)
  return { landed: statusSet(text, 'Landed'), active: statusSet(text, 'Active'), phaseN: m ? m[1] : null }
}

// The scripts' copies, loaded by import (each script is `__main__`-guarded).
const PY = `
import importlib.util, json, sys
sys.dont_write_bytecode = True
def load(name, p):
    s = importlib.util.spec_from_file_location(name, p)
    m = importlib.util.module_from_spec(s)
    s.loader.exec_module(m)
    return m
rp, rr, na = (load(n, p) for n, p in zip(("rp", "rr", "na"), sys.argv[1:4]))
print(json.dumps({"LANDED": sorted(rp.LANDED), "ACTIVE": sorted(rp.ACTIVE), "PHASE_N": rp.PHASE_N,
                  "PHASED_STEM_RE": rr.PHASED_STEM_RE.pattern, "DEAD_STATUSES": sorted(na.DEAD_STATUSES),
                  "OPEN_STATUSES": sorted(na.OPEN_STATUSES), "doc": rp.__doc__}))
`
function scripts() {
  const r = spawnSync('python3', ['-c', PY, ...['skills/_shared/scripts/reconcile-project.py',
    'skills/execute/scripts/reconcile-rollout.py', 'skills/_shared/scripts/next-action.py'].map((p) => path.join(root, p))],
  { encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } })
  assert.equal(r.status, 0, r.stderr)
  return JSON.parse(r.stdout)
}

// The names of every script copy that disagrees with the doc's grammar `g`; [] when all agree.
function mismatches(g, s) {
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)
  const out = []
  if (!g.landed || !eq(s.LANDED, g.landed)) out.push('reconcile-project LANDED')
  if (!g.active || !eq(s.ACTIVE, g.active)) out.push('reconcile-project ACTIVE')
  if (!g.phaseN || s.PHASE_N !== g.phaseN) out.push('reconcile-project PHASE_N')
  if (!g.phaseN || !s.PHASED_STEM_RE.includes(`-p(?P<n>${g.phaseN})-`)) out.push('reconcile-rollout PHASED_STEM_RE')
  if (!g.landed || !eq(s.DEAD_STATUSES, g.landed)) out.push('next-action DEAD_STATUSES')
  if (!g.active || !eq(s.OPEN_STATUSES, g.active)) out.push('next-action OPEN_STATUSES')
  return out
}

// ---- the prose readers --------------------------------------------------------------------------------

const S2 = (t) => collapse(section(t, /^### 2\./) ?? '')
const R1 = (t) => collapse(section(t, /^## R1\./) ?? '')

// The names of the failed citation checks; [] when every reader cites the doc and none restates it.
function citations({ orientText, reshuffleText, docstring }) {
  const out = []
  if (!S2(orientText).includes(CITE)) out.push('orient § 2 cites')
  if (!R1(reshuffleText).includes(CITE)) out.push('R1 cites')
  if (!collapse(docstring ?? '').includes(CITE)) out.push('docstring cites')
  if (/whole-number/.test(R1(reshuffleText))) out.push('R1 whole-number caveat')
  if (S2(orientText).includes('`status: in-progress`')) out.push('orient § 2 restates in flight')
  if (R1(reshuffleText).includes('`status: in-progress`')) out.push('R1 restates in flight')
  return out
}

// ---- tests --------------------------------------------------------------------------------------------

test('the doc has the four sections the readers cite', () => {
  for (const h of ['Phase and task filenames', 'Statuses', 'In flight', 'Readers']) {
    assert.ok(section(doc, new RegExp(`^## ${h}$`)), `${DOC} has no ## ${h}`)
  }
})

test('the doc states the phase number, the landed and the active sets', () => {
  const g = grammarOf(doc)
  assert.deepEqual(g.landed, ['done', 'dropped', 'merged'])
  assert.deepEqual(g.active, ['in_progress', 'open'])
  const re = new RegExp(`^(?:${g.phaseN})$`)
  for (const n of ['3', '03', '19', '3.5', '3.50']) assert.match(n, re, `${n} is a phase number`)
  for (const n of ['3.', '.5', '3.5.1', '-1', 'x', '']) assert.doesNotMatch(n, re, `${n} is not a phase number`)
  const st = collapse(section(doc, /^## Statuses\b/))
  assert.match(st, /`-` read as `_`/, '§ Statuses drops the dash normalisation')
  assert.match(st, /\*\*Hold\*\*/, '§ Statuses drops the hold set')
})

test('every script copy of the grammar equals the doc', () => {
  assert.deepEqual(mismatches(grammarOf(doc), scripts()), [])
})

test('orient § 2, reshuffle R1 and the reconcile-project docstring cite the doc and restate nothing', () => {
  assert.deepEqual(citations({ orientText: orient, reshuffleText: reshuffle, docstring: scripts().doc }), [])
  const readers = collapse(section(doc, /^## Readers\b/))
  for (const r of ['reconcile-project.py', 'reconcile-rollout.py', 'next-action.py', 'orient', 'R1',
    'tests/contracts/vault-grammar.test.mjs']) assert.ok(readers.includes(r), `§ Readers does not name ${r}`)
})

test('controls: a drifted set or a restored caveat fails its check', () => {
  const s = scripts()
  const drifted = doc.replace(/^(- \*\*Landed\*\*.*)`dropped`/m, '$1`abandoned`')
  assert.notEqual(drifted, doc, 'control is vacuous: no Landed bullet with `dropped`')
  assert.deepEqual(mismatches(grammarOf(drifted), s), ['reconcile-project LANDED', 'next-action DEAD_STATUSES'])
  const active = doc.replace(/^(- \*\*Active\*\*.*)`in_progress`/m, '$1`in-progress`')
  assert.notEqual(active, doc, 'control is vacuous: no Active bullet with `in_progress`')
  assert.deepEqual(mismatches(grammarOf(active), s), ['reconcile-project ACTIVE', 'next-action OPEN_STATUSES'])
  const whole = doc.replace(/`PHASE_N` = `[^`]+`/, '`PHASE_N` = `\\d+`')
  assert.notEqual(whole, doc, 'control is vacuous: no PHASE_N')
  assert.deepEqual(mismatches(grammarOf(whole), s), ['reconcile-project PHASE_N', 'reconcile-rollout PHASED_STEM_RE'])

  const caveat = reshuffle.replace(/^(## R1\..*\n(?:.*\n)*?.*`-p<N>-`)/m, '$1, though that script only reads whole-number phases')
  assert.notEqual(caveat, reshuffle, 'control is vacuous: no `-p<N>-` in R1')
  assert.deepEqual(citations({ orientText: orient, reshuffleText: caveat, docstring: s.doc }), ['R1 whole-number caveat'])
  const restated = orient.replace(/^(### 2\..*)$/m, '$1\n\nIn flight: `status: in-progress`.')
  assert.deepEqual(citations({ orientText: restated, reshuffleText: reshuffle, docstring: s.doc }),
    ['orient § 2 restates in flight'])
  assert.deepEqual(citations({ orientText: orient, reshuffleText: reshuffle, docstring: 'no citation' }), ['docstring cites'])
})
