// The vault grammar is defined once (skills/_shared/vault-grammar.md): the phase/task filename pattern and
// the status sets. Its readers keep literal copies (reconcile-project.py's PHASE_N, LANDED and ACTIVE,
// reconcile-rollout.py's PHASED_STEM_RE, next-action.py's DEAD_STATUSES and OPEN_STATUSES) because none of
// them imports a doc; this test pins each copy to the doc, so neither side drifts silently. The two scripts'
// phase-number helpers (reconcile-project.py's phase_key/phase_sort, reconcile-rollout.py's
// _phase_key/_phase_sort) are run on the doc's own examples (`p03` is `p3`, `p3.5` and `p3.50` distinct, the
// numeric order). The prose readers (orient § 2, reshuffle R1, reconcile-project.py's docstring) cite the doc
// instead of restating it, and § Readers keeps the readers not yet adopted apart from the conforming ones.
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

// ---- the phase-number helpers, on the doc's own examples ---------------------------------------------

// The examples the doc's Comparing and ordering bullet states: {same: [a, b]} (`p03` is `p3`), {distinct:
// [a, b]} (`p3.5` and `p3.50` are distinct), {order: [...]} (the numeric order); each null when absent.
function examplesOf(text) {
  const names = collapse(section(text, /^## Phase and task filenames\b/) ?? '')
  const same = names.match(/`p([\d.]+)` is `p([\d.]+)`/)
  const distinct = names.match(/`p([\d.]+)` and `p([\d.]+)` are distinct/)
  const order = names.match(/sort numerically: `([^`]+)`/)
  return { same: same && [same[1], same[2]], distinct: distinct && [distinct[1], distinct[2]],
    order: order && order[1].split(/,\s*/) }
}

// Each script's key and sort helper, as {key: {n: key(n)}, order: the doc's order reversed, then sorted}.
const HELPERS = { 'reconcile-project': ['phase_key', 'phase_sort'], 'reconcile-rollout': ['_phase_key', '_phase_sort'] }
const PY_HELPERS = `
import importlib.util, json, sys
sys.dont_write_bytecode = True
def load(name, p):
    s = importlib.util.spec_from_file_location(name, p)
    m = importlib.util.module_from_spec(s)
    s.loader.exec_module(m)
    return m
helpers = json.loads(sys.argv[3])
mods = dict(zip(helpers, (load(n, p) for n, p in zip(("rp", "rr"), sys.argv[1:3]))))
ex = json.loads(sys.argv[4])
print(json.dumps({label: {"key": {n: getattr(m, helpers[label][0])(n) for n in ex["inputs"]},
                          "order": sorted(reversed(ex["order"]), key=getattr(m, helpers[label][1]))}
                  for label, m in mods.items()}))
`
function helperResults(ex) {
  const inputs = [...new Set([...(ex.same ?? []), ...(ex.distinct ?? [])])]
  const r = spawnSync('python3', ['-c', PY_HELPERS, ...['skills/_shared/scripts/reconcile-project.py',
    'skills/execute/scripts/reconcile-rollout.py'].map((p) => path.join(root, p)), JSON.stringify(HELPERS),
  JSON.stringify({ inputs, order: ex.order ?? [] })],
  { encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } })
  assert.equal(r.status, 0, r.stderr)
  return JSON.parse(r.stdout)
}

// The names of every helper that breaks a doc example; [] when all hold. `results` maps a label to
// {key, order}; a label outside HELPERS (a control) names its helpers `key` and `sort`.
function helperMismatches(ex, results) {
  const out = []
  for (const [label, { key, order }] of Object.entries(results)) {
    const [keyName, sortName] = HELPERS[label] ?? ['key', 'sort']
    const keyOk = ex.same && ex.distinct && key[ex.same[0]] === key[ex.same[1]] &&
      key[ex.distinct[0]] !== key[ex.distinct[1]]
    if (!keyOk) out.push(`${label} ${keyName}`)
    if (!ex.order || JSON.stringify(order) !== JSON.stringify(ex.order)) out.push(`${label} ${sortName}`)
  }
  return out
}

// A test-side helper pair run the way PY_HELPERS runs the scripts' (for the controls).
function control(ex, key, cmp) {
  return { key: Object.fromEntries([...ex.same, ...ex.distinct].map((n) => [n, key(n)])),
    order: [...ex.order].reverse().sort(cmp) }
}

// ---- § Readers: the conforming readers and the ones not yet adopted ------------------------------------

const NOT_YET = '**Not yet adopted**'
// {adopted, notYet}: § Readers collapsed, split at the Not yet adopted line (notYet null when it is absent).
function readersOf(text) {
  const s = collapse(section(text, /^## Readers\b/) ?? '')
  const at = s.indexOf(NOT_YET)
  return at < 0 ? { adopted: s, notYet: null } : { adopted: s.slice(0, at), notYet: s.slice(at) }
}
const CONFORMING = ['reconcile-project.py', 'reconcile-rollout.py', 'next-action.py', 'orient', 'R1',
  'tests/contracts/vault-grammar.test.mjs', 'reflect.py']
const NOT_ADOPTED = ['repo-track.sh', 'candidate statuses', 'SHORT_ID_RE']

// The names of the failed § Readers checks; [] when every conforming reader is listed as such and the three
// not yet adopted are named apart, never among the conforming ones.
function readerChecks(text) {
  const { adopted, notYet } = readersOf(text)
  const out = CONFORMING.filter((r) => !adopted.includes(r)).map((r) => `lists ${r}`)
  if (!notYet) return [...out, 'not yet adopted line']
  out.push(...NOT_ADOPTED.filter((r) => !notYet.includes(r)).map((r) => `not yet adopted names ${r}`))
  out.push(...NOT_ADOPTED.filter((r) => adopted.includes(r)).map((r) => `${r} listed as conforming`))
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

test('the doc states its comparing and ordering examples', () => {
  assert.deepEqual(examplesOf(doc), { same: ['03', '3'], distinct: ['3.5', '3.50'], order: ['1', '2', '3', '3.5', '5', '10'] })
})

test("both scripts' phase-number helpers hold the doc's examples: 03 is 3, 3.5 and 3.50 distinct, the order", () => {
  const ex = examplesOf(doc)
  const results = helperResults(ex)
  assert.deepEqual(Object.keys(results), Object.keys(HELPERS))
  assert.deepEqual(helperMismatches(ex, results), [])
})

test('orient § 2, reshuffle R1 and the reconcile-project docstring cite the doc and restate nothing', () => {
  assert.deepEqual(citations({ orientText: orient, reshuffleText: reshuffle, docstring: scripts().doc }), [])
})

test('§ Readers lists the conforming readers, and names the three not yet adopted apart from them', () => {
  assert.deepEqual(readerChecks(doc), [])
})

test('controls: a broken helper, or a doc example the scripts break, fails the helper check', () => {
  const ex = examplesOf(doc)
  // a lexical sort with no canonical form (the pre-grammar shape) breaks both examples
  assert.deepEqual(helperMismatches(ex, { lexical: control(ex, (n) => n) }), ['lexical key', 'lexical sort'])
  // a float key merges 3.5 with 3.50, the forms the grammar keeps distinct; its numeric sort still holds
  assert.deepEqual(helperMismatches(ex, { float: control(ex, (n) => String(Number(n)), (a, b) => Number(a) - Number(b)) }),
    ['float key'])
  const lexOrder = doc.replace(/(sort numerically: `)[^`]+`/, '$11, 10, 2, 3, 3.5, 5`')
  assert.notEqual(lexOrder, doc, 'control is vacuous: no order example')
  const lexEx = examplesOf(lexOrder)
  assert.deepEqual(helperMismatches(lexEx, helperResults(lexEx)), ['reconcile-project phase_sort', 'reconcile-rollout _phase_sort'])
  const unstated = doc.replace(/`p03` is `p3`/, '`p03` and `p3`')
  assert.notEqual(unstated, doc, 'control is vacuous: no `p03` is `p3` example')
  const noSame = examplesOf(unstated)
  assert.deepEqual(helperMismatches(noSame, helperResults(noSame)), ['reconcile-project phase_key', 'reconcile-rollout _phase_key'])
})

// A control's text: `text` with `from` replaced by `to`, asserting the replacement happened.
function mutate(text, from, to) {
  const out = text.replace(from, to)
  assert.notEqual(out, text, `control is vacuous: ${from} not found`)
  return out
}

test('controls: each § Readers check rejects its own known-bad shape', () => {
  const lines = doc.split('\n')
  const at = lines.findIndex((l) => l.startsWith(NOT_YET))
  assert.ok(at >= 0, 'control is vacuous: no Not yet adopted line')
  const cases = [
    ['not yet adopted line', lines.slice(0, at).join('\n')],
    ['lists next-action.py', mutate(doc, /^- `skills\/_shared\/scripts\/next-action\.py`.*\n/m, '')],
    ['not yet adopted names SHORT_ID_RE', mutate(doc, /(\*\*Not yet adopted\*\*[\s\S]*)`SHORT_ID_RE`/, '$1`ORDER_RE`')],
    ['repo-track.sh listed as conforming', mutate(doc, /^(- `skills\/_shared\/scripts\/next-action\.py`.*)$/m, '$1 Also `repo-track.sh`.')],
  ]
  for (const [want, text] of cases) assert.deepEqual(readerChecks(text), [want], `control ${want}`)
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
