// The Readiness grade's prose contract (p25-2; ADR 0041): skills/_shared/readiness-grade.md is the grading agents'
// brief and the ranking's prose, skills/_shared/scripts/estate-rank.py does the deterministic half, and CONTEXT.md
// words the terms. Eight rules pin them to each other:
//   c1  the doc's twelve `##` headings, in order (p25-3's SKILL.md and this test cite them).
//   c2  the grade names agree three ways: the doc's § The grade bullets, the script's GRADES and the bold names in
//       CONTEXT.md **Readiness grade**.
//   c3  § The ranking's `| Constant | Value |` table equals the script's constants, name for name and value for value
//       (p25-4's grade log and the weekly Reflection tune them in one place).
//   c4  § The Unpark offer names both SNOOZE_KEYS and SNOOZE_DAYS, and the writer's `snooze <project> --clear`
//       that the unpark and kill writes run first (a re-parked project must not come back snoozed), which the
//       script's own parser accepts; GATE_KINDS equals the keys of gated_inputs.py's sweep (one gate vocabulary).
//   c5  § The ranking states the six-step key in order, crowned meaning standing crowned "never the `crowned:` date",
//       and ADR 0041 § Build rulings names the order and the doc.
//   c6  § Shape cites execution-fit.md read with every decision answered; § The raise states both steps; § Each decision
//       requires 2 to 4 options with the recommendation one of them; § The grade cites grill-fit.md steps 2(a) and 2(b)
//       and orient § 2 Open forks rather than restating either; § What the agent reads cites CONTEXT.md
//       **Thread home** with all three homes (the repo, the ~/Projects folder, _shared/threads) and open's
//       § Repo-thread lookup, so a project with no code repo still has its thread read.
//   c7  CONTEXT.md has **Ranked slate**, and **Readiness grade** says low confidence raises the grade (no scan-only
//       first pass).
//   c8  § Dependencies names every `blockedBy` why the script can emit, its HOLD_WHYS.
// One pure function, check(files, consts), returns the failing rules; the script's constants come from a python child
// that loads estate-rank.py and gated_inputs.py by path (importing either runs no sibling and writes no bytecode).
// Each control mutates one place and must fail exactly its rule. Reads files only.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { collapse, readIf, root, section, slice } from '../lib/contract-text.mjs'

const DOC = 'skills/_shared/readiness-grade.md'
const SCRIPT = 'skills/_shared/scripts/estate-rank.py'
const GATED = 'skills/_shared/scripts/gated_inputs.py'
const CONTEXT = 'CONTEXT.md'
const ADR = 'docs/adr/0041-orient-all-runs-the-estate-pass.md'

const HEADINGS = ['Gradeable tasks', 'The grading agents', 'What the agent reads', 'The grade', 'Shape', 'Each decision',
  'The raise', 'Size, deadlines and review', 'Output', 'Dependencies', 'The ranking', 'The Unpark offer']
const CONSTANTS = ['GRADES', 'SHAPES', 'SIZE_MINUTES', 'DECISION_MINUTES', 'REVIEW_MINUTES', 'ATTENTION_FLOOR', 'OPTIONS_MIN',
  'OPTIONS_MAX', 'DUE_SOON_DAYS', 'SNOOZE_DAYS', 'SNOOZE_KEYS', 'GATE_KINDS', 'CONFIDENCE']
// The ranking key, in order: each numbered item's bold lead.
const KEY = [/^Parked homes last/, /^Due soon first/, /^Crowned homes first/, /^Leverage/, /^Home standing/, /^Home name, then slug/]

const PY = `
import importlib.util, json, sys
sys.dont_write_bytecode = True
def load(name, p):
    s = importlib.util.spec_from_file_location(name, p)
    m = importlib.util.module_from_spec(s)
    s.loader.exec_module(m)
    return m
er, gi = load("thread_estate_rank", sys.argv[1]), load("thread_gated_inputs", sys.argv[2])
out = {n: getattr(er, n) for n in json.loads(sys.argv[3])}
out["HOLD_WHYS"] = er.HOLD_WHYS
out["sweepKeys"] = list(gi.sweep(""))
try:
    out["clears"] = er.parse(["snooze", "p", "--clear"]).clear is True
except SystemExit:
    out["clears"] = False
print(json.dumps(out))
`
function constants() {
  const r = spawnSync('python3', ['-c', PY, path.join(root, SCRIPT), path.join(root, GATED), JSON.stringify(CONSTANTS)],
    { encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } })
  assert.equal(r.status, 0, r.stderr)
  return JSON.parse(r.stdout)
}

const C = (s) => (s == null ? '' : collapse(s))
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// A CONTEXT.md entry: its `- **<name>**` line up to the next top-level entry or heading.
const entry = (text, name) => slice(text, new RegExp(`^- \\*\\*${esc(name)}\\*\\*`), /^(- \*\*|#)/)
const sec = (text, name) => section(text, new RegExp(`^## ${esc(name)}$`))

// { fails: sorted rule names, details }; fails [] means every rule holds.
function check(files, consts) {
  const fails = new Set()
  const details = []
  const flag = (rule, why) => { fails.add(rule); details.push(`${rule}: ${why}`) }
  const need = (rule, name, text, patterns) => {
    if (!text) return flag(rule, `${name} is missing`)
    for (const p of patterns) {
      const hit = typeof p === 'string' ? text.includes(p) : p.test(text)
      if (!hit) flag(rule, `${name} does not contain ${p}`)
    }
  }
  const doc = files[DOC] ?? ''
  const context = files[CONTEXT] ?? ''
  const adr = files[ADR] ?? ''

  // c1: the twelve headings, in order.
  const heads = doc.split('\n').filter((l) => /^## /.test(l)).map((l) => l.slice(3).trim())
  if (JSON.stringify(heads) !== JSON.stringify(HEADINGS)) flag('c1', `${DOC} headings are ${JSON.stringify(heads)}`)

  // c2: the grade names, three ways.
  const docGrades = (sec(doc, 'The grade') ?? '').split('\n').map((l) => l.match(/^- \*\*(.+?)\*\*/)?.[1]).filter(Boolean)
  const ctxEntry = entry(context, 'Readiness grade') ?? ''
  const ctxGrades = [...C(ctxEntry).matchAll(/\*\*(.+?)\*\*/g)].map((m) => m[1]).filter((n) => n !== 'Readiness grade')
  for (const [name, list] of [['the doc', docGrades], ['CONTEXT.md', ctxGrades]]) {
    if (JSON.stringify(list) !== JSON.stringify(consts.GRADES)) flag('c2', `${name} grades ${JSON.stringify(list)} ≠ GRADES ${JSON.stringify(consts.GRADES)}`)
  }

  // c3: the constants table.
  const ranking = sec(doc, 'The ranking') ?? ''
  const table = {}
  for (const l of ranking.split('\n')) {
    const m = l.match(/^\|\s*`([A-Z_]+)`\s*\|\s*`([^`]+)`\s*\|/)
    if (!m) continue
    try { table[m[1]] = JSON.parse(m[2]) } catch { table[m[1]] = `unparsed ${m[2]}` }
  }
  if (!/^\| Constant \| Value \|/m.test(ranking)) flag('c3', '§ The ranking has no | Constant | Value | table')
  if (JSON.stringify(Object.keys(table).sort()) !== JSON.stringify([...CONSTANTS].sort())) {
    flag('c3', `the table names ${JSON.stringify(Object.keys(table))}`)
  }
  for (const n of CONSTANTS) {
    if (n in table && JSON.stringify(table[n]) !== JSON.stringify(consts[n])) flag('c3', `${n}: doc ${JSON.stringify(table[n])} ≠ script ${JSON.stringify(consts[n])}`)
  }

  // c4: the snooze record and the gate vocabulary.
  const unpark = sec(doc, 'The Unpark offer')
  need('c4', '§ The Unpark offer', unpark, [...(consts.SNOOZE_KEYS ?? []).map((k) => `\`${k}\``), '`SNOOZE_DAYS`'])
  need('c4', '§ The Unpark offer', C(unpark), ['estate-rank.py snooze <project> --clear', 'The unpark and kill writes run it first'])
  if (consts.clears !== true) flag('c4', 'estate-rank.py snooze does not accept --clear')
  if (JSON.stringify(consts.GATE_KINDS) !== JSON.stringify(consts.sweepKeys)) {
    flag('c4', `GATE_KINDS ${JSON.stringify(consts.GATE_KINDS)} ≠ gated_inputs sweep keys ${JSON.stringify(consts.sweepKeys)}`)
  }

  // c5: the key, in order, and the ADR's ruling.
  const items = ranking.split('\n').map((l) => l.match(/^\d+\. \*\*(.+?)\*\*/)?.[1]).filter(Boolean)
  if (items.length !== KEY.length || !KEY.every((re, i) => re.test(items[i]))) flag('c5', `§ The ranking's key is ${JSON.stringify(items)}`)
  need('c5', '§ The ranking', C(ranking), ['never the `crowned:` date'])
  const rulings = C(section(adr, /^## Build rulings$/))
  need('c5', `${ADR} § Build rulings`, rulings, ['How the slate ranks', '`skills/_shared/readiness-grade.md` is canonical',
    /parked last[^.]*due within a fortnight[^.]*crowned[^.]*leverage/, '`status: crowned`'])

  // c6: the cited rules, never restated.
  need('c6', '§ Shape', C(sec(doc, 'Shape')), ['execution-fit.md', 'already answered', 'ruling (c)'])
  need('c6', '§ The raise', C(sec(doc, 'The raise')), ['0 is Ready, 1 is One call, 2 or more is Grill', /`low`[^.]*rises one step/,
    'Orient stays Orient'])
  need('c6', '§ Each decision', C(sec(doc, 'Each decision')), [/`options`[^.]*required[^.]*2 to 4/, /recommendation[^.]*one of the options/])
  const grade = C(sec(doc, 'The grade'))
  need('c6', '§ The grade', grade, ['grill-fit.md', 'step 2(a)', 'step 2(b)', 'orient § 2 Open forks'])
  for (const own of ['**Resolvable**', 'bake a gate line', 'List the forks']) {
    if (grade.includes(own)) flag('c6', `§ The grade restates grill-fit.md ("${own}")`)
  }
  need('c6', '§ What the agent reads', C(sec(doc, 'What the agent reads')), ['**Thread home**', 'thread-placement.py home',
    '`~/Projects/<Area>/<Project>/THREAD.md`', '`_shared/threads/<slug>.md`', '§ Repo-thread lookup'])

  // c7: CONTEXT.md's terms.
  need('c7', 'CONTEXT.md **Ranked slate**', C(entry(context, 'Ranked slate')), ['Review load', 'Unpark offer', 'leverage'])
  need('c7', 'CONTEXT.md **Readiness grade**', C(ctxEntry), ['raises the grade one step'])
  if (/scan-only/.test(C(ctxEntry))) flag('c7', '**Readiness grade** still says scan-only')

  // c8: every hold why.
  const deps = sec(doc, 'Dependencies') ?? ''
  if (!(consts.HOLD_WHYS ?? []).length) flag('c8', 'HOLD_WHYS is empty')
  for (const why of consts.HOLD_WHYS ?? []) if (!deps.includes(`\`${why}\``)) flag('c8', `§ Dependencies does not name \`${why}\``)

  return { fails: [...fails].sort(), details }
}

const FILES = { [DOC]: readIf(DOC), [CONTEXT]: readIf(CONTEXT), [ADR]: readIf(ADR) }
const CONSTS = constants()

// Mutate one place: `from` must be present, so a control never passes vacuously.
function swap(files, rel, from, to) {
  assert.ok(files[rel]?.includes(from), `${rel} no longer holds ${JSON.stringify(from)}: update this control`)
  return { ...files, [rel]: files[rel].replace(from, to) }
}
// Every mention, where the doc names a thing more than once.
function swapAll(files, rel, from, to) {
  assert.ok(files[rel]?.includes(from), `${rel} no longer holds ${JSON.stringify(from)}: update this control`)
  return { ...files, [rel]: files[rel].replaceAll(from, to) }
}
const only = (files, consts, rules, what) => {
  const r = check(files, consts)
  assert.deepEqual(r.fails, rules, `${what}: ${r.details.join('\n')}`)
}

test('the doc, the script, CONTEXT.md and ADR 0041 agree (c1-c8)', () => {
  const r = check(FILES, CONSTS)
  assert.deepEqual(r.fails, [], r.details.join('\n'))
})

test('control c1: a renamed heading fails c1 alone', () => {
  only(swap(FILES, DOC, '## Gradeable tasks', '## Gradable tasks'), CONSTS, ['c1'], 'c1')
})

test('control c2: a grade CONTEXT.md names differently fails c2 alone', () => {
  only(swap(FILES, CONTEXT, '**Grill** (', '**Grills** ('), CONSTS, ['c2'], 'c2')
})

test('control c3: a table value that drifts from the script fails c3 alone', () => {
  only(swap(FILES, DOC, '`{"S": 30, "M": 120, "L": 480}`', '`{"S": 60, "M": 120, "L": 480}`'), CONSTS, ['c3'], 'c3')
})

test('control c4: a snooze key the doc no longer names, the clear step gone, or a gate kind the sweep lacks, fails c4 alone', () => {
  only(swapAll(FILES, DOC, '`snoozed_ready`', '`snoozed_count`'), CONSTS, ['c4'], 'c4 doc')
  only(swap(FILES, DOC, 'The unpark and kill writes run it first', 'The unpark and kill writes may run it'), CONSTS, ['c4'], 'c4 clear doc')
  only(FILES, { ...CONSTS, clears: false }, ['c4'], 'c4 clear script')
  only(FILES, { ...CONSTS, sweepKeys: ['spend', 'credential'] }, ['c4'], 'c4 sweep')
})

test('control c5: the crowned: date reading, or the ADR ruling gone, fails c5 alone', () => {
  only(swap(FILES, DOC, 'never the `crowned:` date', 'or the `crowned:` date'), CONSTS, ['c5'], 'c5 doc')
  only(swap(FILES, ADR, 'How the slate ranks', 'How it ranks'), CONSTS, ['c5'], 'c5 adr')
})

test('control c6: a dropped grill-fit citation, or a thread home the reading list drops, fails c6 alone', () => {
  only(swap(FILES, DOC, 'step 2(b)', 'its second half'), CONSTS, ['c6'], 'c6')
  only(swap(FILES, DOC, '`~/Projects/<Area>/<Project>/THREAD.md`', 'its folder thread'), CONSTS, ['c6'], 'c6 thread home')
})

test('control c7: CONTEXT.md without **Ranked slate** fails c7 alone', () => {
  only(swap(FILES, CONTEXT, '- **Ranked slate**', '- **Slate**'), CONSTS, ['c7'], 'c7')
})

test('control c8: a hold why the doc no longer names fails c8 alone', () => {
  only(swap(FILES, DOC, '`cycle`', '`loop`'), CONSTS, ['c8'], 'c8')
})
