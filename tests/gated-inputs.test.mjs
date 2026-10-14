// skills/_shared/scripts/gated_inputs.py — the gated-input sweep and the standing approval's exposure reading
// (ADR 0008, ADR 0034; p18-2). The module is the one home of both readings: schedule § 3.6 runs its `sweep` CLI over
// every candidate, and `reconcile-rollout.py approve-gates --standing` prices each pending gate with `exposure`.
//
// Pinned here:
// - p18-7's two real gates (chorus-rollout-2026-10-10), verbatim from the archived note's `## Approved gates`: the probe
//   reads 9 (its `Cap US$5 total` plus the `reaches US$4` stop line) and passes; the fast-mode gate asks;
// - every exposure rule, each failure with its `why`, and the accepted residuals (ADR 0034 § Consequences, *A
//   fail-closed reading*) so a later change cannot "fix" one silently;
// - the widening words (a cap that is not the ceiling asks, inside the clause and outside it), a count whose unit is not
//   the per-unit token's, and one multiplier list for both sites;
// - ask ahead: the count-phrased rewording prices, the uncounted one still asks, and schedule's own Planner example
//   prices to exactly 150 (the guidance is coupled to the parser);
// - the annotation round-trips through reconcile-rollout.py's GATE_ANNOT_RE and the engine's unapprovedGates, so an
//   approved gate always matches its declaration (no resume cache, no prompt changes);
// - the sweep: p18-7's verbatim capture flags spend (and so did the old list: the 2026-10-10 miss was by eye), the new
//   words flag where the old list is silent, and the currency amount marker never flags a shell variable while the old
//   literal `$` does.
//
// Hermetic: python3 -I -B (no bytecode next to the module), THREAD_EVENTS_DIR in temp (reconcile-rollout.py is only
// imported, never run). Reads files only.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { loadEngine } from './lib/engine.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MODULE = path.join(root, 'skills', '_shared', 'scripts', 'gated_inputs.py')
const RECONCILE = path.join(root, 'skills', 'execute', 'scripts', 'reconcile-rollout.py')
const FIXTURES = path.join(root, 'tests', 'fixtures', 'gated-inputs')
const EVENTS = fs.mkdtempSync(path.join(os.tmpdir(), 'gated-inputs-events-'))
process.on('exit', () => fs.rmSync(EVENTS, { recursive: true, force: true }))

// One python process per batch: [{op, ...}] -> [result]. Decimals come back as strings.
const DRIVER = `import importlib.util, json, sys
def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m); return m
gi = load("gi", sys.argv[1])
rr = None
out = []
for req in json.loads(sys.argv[3]):
    op = req["op"]
    if op == "exposure":
        r = gi.exposure(req["gate"]); out.append({"usd": None if r["usd"] is None else str(r["usd"]), "why": r["why"]})
    elif op == "covered":
        r = gi.covered(req["gate"], req["limit"]); out.append({"covered": r["covered"], "usd": None if r["usd"] is None else str(r["usd"]), "why": r["why"]})
    elif op == "annotation":
        out.append(gi.annotation(req["date"], req["usd"], req["limit"], req["source"]))
    elif op == "strip":
        rr = rr or load("rr", sys.argv[2]); out.append(rr._norm_gate(req["line"]) == rr._norm_gate(req["gate"]) and rr.GATE_ANNOT_RE.sub("", req["line"]) == req["gate"])
    elif op == "hits":
        out.append(gi.hits(req["text"], getattr(gi, req["list"])))
    elif op == "sweep":
        out.append(gi.sweep(gi.body_of(open(req["path"], encoding="utf-8").read())))
    elif op == "lists":
        out.append({k: list(getattr(gi, k)) for k in ("UNIT_NOUNS", "PERIOD_ADVERBS")})
print(json.dumps(out))
`
function py(reqs) {
  const r = spawnSync('python3', ['-I', '-B', '-c', DRIVER, MODULE, RECONCILE, JSON.stringify(reqs)], {
    encoding: 'utf8',
    env: { ...process.env, THREAD_EVENTS_DIR: EVENTS },
  })
  assert.equal(r.status, 0, r.stderr)
  return JSON.parse(r.stdout)
}
const exposure = (gate) => py([{ op: 'exposure', gate }])[0]
const covered = (gate, limit) => py([{ op: 'covered', gate, limit }])[0]
const num = (usd) => (usd === null ? null : Number(usd))

// p18-7's real gates, verbatim from Archive/chorus-p18-7-fast-while-held.md `## Approved gates`, ` (approved 2026-10-12)`
// stripped.
const PROBE = "spend: the fast-mode probe (`scripts/stage/probe-fast.py`). Phase A is free (`get_usage` only, every signed-in Claude Login). Phase B runs seven Turns on `claude-opus-5-5` on ONE Login that passes the cap (three standard, four fast), drawn from that Login's usage credits. Cap US$5 total, held by the client's `max_budget_usd=5` and the script stopping before any Turn once the cumulative `total_cost_usd` reaches US$4."
const FAST = "spend: the live feature, Claude fast mode on each run of questions on the Session he is on, drawn from that Login's usage credits (extra usage). Cap US$50 per Login (per account) per calendar month, enforced in code: fast is asked only while the Login's extra-usage monthly limit reads at or under `fast_credit_cap` (5000 minor units, USD or AUD only) with used credits under it, and unknown, stale, unlimited or over-cap credits keep it standard."
// The count-phrased rewording the ask-ahead Planner line asks for.
const FAST_COUNTED = "spend: Claude fast mode on the Session he is on, drawn from that Login's usage credits (extra usage) — cap US$50 per Login per month across 3 Logins"

// ---- p18-7's real gates ----------------------------------------------------------------------------------

test("p18-7's probe reads 9 (its cap plus its US$4 stop line) and is covered at 50 and at 9, not at 8", () => {
  assert.deepEqual(exposure(PROBE), { usd: '9', why: '' })
  const [a, b, c] = py([{ op: 'covered', gate: PROBE, limit: 50 }, { op: 'covered', gate: PROBE, limit: 9 },
    { op: 'covered', gate: PROBE, limit: 8 }])
  assert.equal(a.covered, true, 'at 50')
  assert.equal(b.covered, true, 'at 9: the limit is inclusive')
  assert.equal(c.covered, false, 'at 8')
})

test("p18-7's fast-mode gate asks: a per-Login cap with no Login count", () => {
  assert.deepEqual(exposure(FAST), { usd: null, why: 'per-Login cap with no Login count' })
})

// ---- gates that price ------------------------------------------------------------------------------------

test('gates that price: totals, monthly caps, per-unit counts, decimals and every USD amount summed', () => {
  const cases = [
    ['spend: fast mode — cap US$50 per Login per month across three Logins', 150],
    ['spend: x — cap US$15 per Login per month across 3 Logins', 45],
    ['spend: x — cap US$50 total', 50],
    ['spend: a paid API — cap USD 5', 5], // a bare cap is a total (the engine's own shape)
    ['spend: x — cap USD 5 — for the probe', 5], // a clause that ends at an em-dash is a total
    ['spend: x — cap US$ 4.50, then stop', 4.5], // the `.` terminator never splits a decimal
    ['spend: x — cap US$50.01', 50.01],
    ['spend: x — cap US$1,000 total', 1000],
    ['spend: x — cap $20', 20],
    ['spend: x — cap 20 USD per month', 20],
    ['spend: x — capped at US$5', 5],
    ['spend: CI every month — cap US$15', 15], // rule 7(iii)'s control: `every month` outside the clause is x1
    ['spend: OpenAI GPT-4o API — cap US$10', 10], // an identifier's digit is no bare number
    ['spend: image API — cap US$40, plus US$30 for the fallback', 70],
    ['spend: image API — cap US$40 and US$30 for the retry model', 70],
    ['spend: x — cap US$20 per account per month across 2 Logins', 40], // Login and account are one unit
    ['spend: x — cap US$20 per Login across 2 accounts', 40],
    ['spend: x — cap US$20 per seat across two seats', 40],
  ]
  const got = py(cases.map(([gate]) => ({ op: 'exposure', gate })))
  cases.forEach(([gate, usd], i) => assert.deepEqual([num(got[i].usd), got[i].why], [usd, ''], gate))
  const [a, b, c] = py([{ op: 'covered', gate: cases[0][0], limit: 50 }, { op: 'covered', gate: cases[2][0], limit: 50 },
    { op: 'covered', gate: cases[6][0], limit: 50 }])
  assert.equal(a.covered, false, '150 is over 50')
  assert.equal(b.covered, true, 'exactly 50 is covered (inclusive)')
  assert.equal(c.covered, false, '50.01 is over 50')
  const [d, e] = py([{ op: 'covered', gate: cases[1][0], limit: 50 }, { op: 'covered', gate: cases[13][0], limit: 50 }])
  assert.equal(d.covered, true, '15 x 3 = 45 is covered')
  assert.equal(e.covered, false, 'US$40 plus US$30 is 70, over 50')
})

// ---- the accepted residuals (ADR 0034 § Consequences, *A fail-closed reading*) ---------------------------------

// Rule 7(iii) is a list, never a blanket `every`: p18-7's probe reads "every signed-in Claude Login" and must pass
// (ADR 0034 decision 1). So `every`, `a` or `an` before a noun NOT on UNIT_NOUNS reads x1. That is safe: the engine's
// GATED_INPUTS_CHECK (task.workflow.js) makes an approved cap "a CEILING to respect, never a target (blowing it is a
// verifier/review failure, not a re-ask)", and the annotation records the approval as "total exposure", so spending the
// cap per push or per image is a review failure, never an approved spend.
test('accepted residual (ADR 0034 § Consequences): every/a/an before a noun outside UNIT_NOUNS reads ×1; the cap is the task\'s total ceiling', () => {
  const [push, image, day, probe, ann] = py([
    { op: 'exposure', gate: 'spend: CI on every push — cap US$5' },
    { op: 'exposure', gate: 'spend: image API, one call every image — cap US$5' },
    { op: 'exposure', gate: 'spend: a run every day — cap US$5' },
    { op: 'exposure', gate: PROBE },
    { op: 'annotation', date: '2026-10-14', usd: 5, limit: 50, source: 'file:defaults' },
  ])
  assert.equal(num(push.usd), 5, 'every push reads x1')
  assert.equal(num(image.usd), 5, 'every image reads x1')
  assert.equal(day.usd, null, 'control: every day (a listed noun) asks')
  assert.match(day.why, /^recurring unit outside the cap clause/)
  assert.equal(num(probe.usd), 9, "control: the probe's `every signed-in Claude Login` passes")
  assert.ok(ann.includes('total exposure US$5'), ann)
  const lists = py([{ op: 'lists' }])[0]
  assert.ok(!lists.UNIT_NOUNS.map((n) => n.toLowerCase()).includes('month'), 'month is the counting period, never a unit')
})

test('accepted residual (ADR 0034 § Consequences): a number word outside the clause with no Login/account/seat/user noun is not counted', () => {
  assert.equal(num(exposure('spend: x — cap US$5 total, seven Turns').usd), 5)
})

// ---- ask ahead ------------------------------------------------------------------------------------------------------

test('ask ahead: the count-phrased fast-mode gate prices to 150; the verbatim uncounted one still asks', () => {
  const [a, b, c] = py([{ op: 'covered', gate: FAST_COUNTED, limit: 150 }, { op: 'covered', gate: FAST_COUNTED, limit: 149 },
    { op: 'covered', gate: FAST, limit: 150 }])
  assert.deepEqual([num(a.usd), a.covered], [150, true], 'covered at 150 (inclusive)')
  assert.equal(b.covered, false, 'not covered at 149')
  assert.deepEqual([c.covered, c.why], [false, 'per-Login cap with no Login count'], 'an ask-ahead stamp of 150 never covers the uncounted gate')
})

test("schedule's own Planner example prices to exactly 150 (the guidance is coupled to the parser)", () => {
  const schedule = fs.readFileSync(path.join(root, 'skills', 'schedule', 'SKILL.md'), 'utf8')
  const s7 = schedule.slice(schedule.indexOf('### 7. '), schedule.indexOf('### 7.5. '))
  const line = s7.split('\n').find((l) => l.startsWith('- Planner:'))
  assert.ok(line, 'schedule § 7 has a `- Planner:` line')
  const example = (line.match(/`(spend:[^`]*)`/) ?? [])[1]
  assert.ok(example, 'the Planner line holds a backticked `spend:` example')
  assert.deepEqual(exposure(example), { usd: '150', why: '' }, example)
})

// ---- never covered ----------------------------------------------------------------------------------------------

test('never covered: each failure names its rule', () => {
  const cases = [
    // 1. kind
    ['credential: the Stripe key for the probe — cap US$5', 'not a spend gate'],
    ['irreversible: publish the release, cap US$5', 'not a spend gate'],
    ['the probe — cap US$5', 'not a spend gate'],
    // 3. the cap clause
    ['spend: x — limit US$5', 'no cap clause'],
    ['spend: x — cap US$5 and cap US$6', '2 cap clauses'],
    ['spend: x — cap A$50', 'no cap clause'],
    ['spend: x — cap 50 AUD', 'no cap clause'],
    // 4. every token's tail
    ['spend: x — cap US$1k total', 'malformed amount: US$1k'],
    ['spend: x — cap US$2m', 'malformed amount: US$2m'],
    ['spend: x — cap US$1.5K', 'malformed amount: US$1.5K'],
    ['spend: x — cap US$5 thousand', 'magnitude word: US$5 thousand'],
    ['spend: x — cap US$40–60', 'range: US$40–60'],
    ['spend: x — cap US$40 to US$60', 'range: US$40 to US$60'],
    ['spend: x — cap US$5, plus US$1k later', 'malformed amount: US$1k'], // the tail rule covers every token
    // 5. the clause whitelist
    ['spend: x — cap US$20/Login/month', 'unrecognised clause: /Login'],
    ['spend: x — cap US$20 × 3 Logins', 'unrecognised clause: × 3 Logins'],
    ['spend: x — cap US$20 for 3 accounts', 'unrecognised clause: for 3 accounts'],
    ['spend: x — cap US$5 / Login', 'unrecognised clause: / Login'],
    ['spend: x — cap US$5 total for two Logins', 'unrecognised clause: for two Logins'],
    ['spend: x — cap US$5 each', 'unrecognised clause: each'],
    ['spend: x — cap US$5 per day', 'unrecognised clause: per day'],
    ['spend: x — cap US$5 nightly', 'unrecognised clause: nightly'],
    ['spend: x — cap US$5 (US$15 with retries)', 'unrecognised clause: (US$15 with retries)'], // a second amount inside
    ['spend: x — cap US$50 per Login per account across 3 Logins', 'more than one per-unit token'],
    ['spend: x — cap US$5 double', 'unrecognised clause: double'],
    // 7. rule 7, round 3's reviewer shapes
    ['spend: nightly eval — cap US$20', 'period outside the cap clause: nightly'],
    ['spend: CI each night — cap US$10', 'per/each outside the cap clause: each'],
    ['spend: fast mode on the Logins — cap US$15 per month', 'plural unit outside the cap clause: Logins'],
    ['spend: fast mode across Logins — cap US$15/month', 'plural unit outside the cap clause: Logins'],
    // 7. the rest
    ['spend: image batch per the brief — cap US$5', 'per/each outside the cap clause: per'],
    ['spend: one call each — cap US$5 total', 'per/each outside the cap clause: each'],
    ['spend: x — cap US$5. Per day after that', 'per/each outside the cap clause: Per'],
    ['spend: fast mode on each Login — cap US$15 per month', 'per/each outside the cap clause: each'],
    ['spend: x — cap US$5 total, 3 Logins', 'plural unit outside the cap clause: Logins'],
    ['spend: x — cap US$5 total, three Logins', 'plural unit outside the cap clause: Logins'],
    ['spend: CI every night — cap US$5', 'recurring unit outside the cap clause: every night'],
    ['spend: a run every day — cap US$5', 'recurring unit outside the cap clause: a run, every day'],
    ['spend: x — cap US$5 total, /user', 'per-unit slash outside the cap clause: /user'],
    ['spend: x — cap US$5, US$5 each for the runs', 'per/each outside the cap clause: each'],
    ['spend: x — cap US$5 total, run twice', 'multiplier outside the cap clause: twice'],
    ['spend: probe, run double — cap US$45', 'multiplier outside the cap clause: double'], // one list with rule 5's
    ['spend: x — cap US$5 total, then triple it', 'multiplier outside the cap clause: triple'],
    ['spend: x — cap US$5 total, plus 20%', 'percentage outside the cap clause: %'],
    // 6. currency
    ['spend: x — cap US$5 total, plus fifty dollars for retries', 'non-USD or ambiguous currency: dollars'],
    ['spend: x — cap US$5, plus 2k USD', 'non-USD or ambiguous currency: 2k USD'],
    ['spend: x — cap US$5, plus 5000 minor units', 'non-USD or ambiguous currency: 5000 minor units'],
    ['spend: x — cap US$5, plus A$20', 'non-USD or ambiguous currency: A$2'],
    ['spend: x — cap US$5, plus fifty USD', 'non-USD or ambiguous currency: fifty USD'],
    // 8. bare numbers
    ['spend: x — cap US$5 total, plus 30 more for retries', 'a number outside the cap clause: 30'],
    ['spend: x — cap US$5 total, then 2 more Turns', 'a number outside the cap clause: 2'],
  ]
  const got = py(cases.map(([gate]) => ({ op: 'exposure', gate })))
  cases.forEach(([gate, why], i) => assert.deepEqual(got[i], { usd: null, why }, gate))
})

// A cap whose own wording says it is not the ceiling never reads as the bare cap (ADR 0034: anything it cannot price
// asks). WIDENING is one list for rule 5 (inside the clause) and rule 7 (outside it).
test('never covered: a widening word inside or outside the cap clause asks, and is never read as the bare cap', () => {
  const cases = [
    // the review's shapes, each read as the bare cap and approved at 50 before WIDENING
    ['spend: x — cap US$50 (no hard limit: overage possible)', 'unrecognised clause: (no hard limit'],
    ['spend: x — cap US$50 plus overage', 'unrecognised clause: plus overage'],
    ['spend: x — cap US$50, overage billed at cost', 'widening word outside the cap clause: overage'],
    ['spend: x — cap US$45 + tax', 'unrecognised clause: + tax'],
    ['spend: x — cap US$50 plus VAT', 'unrecognised clause: plus VAT'],
    ['spend: x — cap US$50 before tax', 'unrecognised clause: before tax'],
    ['spend: x — cap US$50 before discounts', 'unrecognised clause: before discounts'], // `before` alone, clause-only
    ['spend: x — cap US$50 excluding overage charges', 'unrecognised clause: excluding overage charges'],
    ['spend: x — cap US$50 soft', 'unrecognised clause: soft'],
    ['spend: x — cap US$50 to start', 'unrecognised clause: to start'],
    ['spend: x — cap US$50 initially', 'unrecognised clause: initially'],
    ['spend: x — cap US$50 for now', 'unrecognised clause: for now'],
    ['spend: x, plus overage at the provider rate — cap US$45', 'widening word outside the cap clause: plus, overage'],
    // the rest of the list, inside and outside
    ['spend: x — cap US$50 ex GST', 'unrecognised clause: ex GST'],
    ['spend: x — cap US$50 exclusive of fees', 'unrecognised clause: exclusive of fees'],
    ['spend: x — cap US$50 excl. taxes', 'unrecognised clause: excl'], // the `.` ends the clause; `excl` stays in it
    ['spend: x — cap US$50 uncapped', 'unrecognised clause: uncapped'],
    ['spend: x — cap US$50 or more', 'unrecognised clause: or more'],
    ['spend: x — cap US$50 at least', 'unrecognised clause: at least'],
    ['spend: x — cap US$50 minimum', 'unrecognised clause: minimum'],
    ['spend: x — cap US$50 approx', 'unrecognised clause: approx'],
    ['spend: x — cap US$50, plus fees', 'widening word outside the cap clause: plus, fees'],
    ['spend: x — cap US$50, may exceed', 'widening word outside the cap clause: exceed'],
    ['spend: x — cap US$50; soft, no hard cap', 'widening word outside the cap clause: soft, no hard cap'],
    ['spend: x + VAT — cap US$50', 'widening word outside the cap clause: +, VAT'],
    ['spend: x — cap US$50, roughly, for now', 'widening word outside the cap clause: roughly, for now'],
    ['spend: x — cap US$50, initially', 'widening word outside the cap clause: initially'],
  ]
  const got = py(cases.flatMap(([gate]) => [{ op: 'exposure', gate }, { op: 'covered', gate, limit: 50 }]))
  cases.forEach(([gate, why], i) => {
    assert.deepEqual(got[2 * i], { usd: null, why }, gate)
    assert.equal(got[2 * i + 1].covered, false, `${gate}: never covered at 50`)
  })
  // controls: `plus` with an amount after it is an amount (summed), and `before` outside the clause is the probe's own
  // "stopping before any Turn", so p18-7's probe still reads 9 and the count-phrased fast-mode gate still reads 150
  const [plus, probe, fast] = py([{ op: 'exposure', gate: 'spend: image API — cap US$40, plus US$30 for the fallback' },
    { op: 'exposure', gate: PROBE }, { op: 'exposure', gate: FAST_COUNTED }])
  assert.deepEqual(plus, { usd: '70', why: '' }, '`plus US$30` is an amount')
  assert.deepEqual(probe, { usd: '9', why: '' }, 'PROBE still reads 9')
  assert.deepEqual(fast, { usd: '150', why: '' }, 'FAST_COUNTED still reads 150')
})

test('never covered: a count whose noun is not the per-unit token\'s unit asks (a Login can hold several users)', () => {
  const [user, seat] = py([{ op: 'exposure', gate: 'spend: x — cap US$20 per user per month across 2 Logins' },
    { op: 'exposure', gate: 'spend: x — cap US$20 per seat across 3 accounts' }])
  assert.deepEqual(user, { usd: null, why: 'count unit does not match the per-unit token' }, 'per user across Logins')
  assert.deepEqual(seat, { usd: null, why: 'count unit does not match the per-unit token' }, 'per seat across accounts')
  assert.equal(covered('spend: x — cap US$20 per user per month across 2 Logins', 50).covered, false, 'never covered at 50')
})

test('identifiers are never the cap word, an amount, a per or a budget hit', () => {
  const gate = 'spend: the probe (`fast_credit_cap`, `max_budget_usd=5`, `total_cost_usd`, `per_call_cap`) — cap US$5 total'
  assert.deepEqual(exposure(gate), { usd: '5', why: '' })
  assert.deepEqual(py([{ op: 'hits', text: 'held by max_budget_usd', list: 'OLD_SPEND' }])[0], [])
})

test('a limit of 0 covers nothing, the probe included', () => {
  assert.equal(covered(PROBE, 0).covered, false)
  assert.equal(covered('spend: x — cap US$1 total', 0).covered, false)
})

// ---- the annotation round trip ---------------------------------------------------------------------------------

test("the annotation is stripped by GATE_ANNOT_RE and the engine's unapprovedGates, p18-7's own gates included", () => {
  const T = loadEngine(['unapprovedGates'])
  const gates = [PROBE, FAST, 'spend: a paid API — cap USD 5']
  const anns = py([
    { op: 'annotation', date: '2026-10-14', usd: 9, limit: 50, source: 'file:defaults' },
    { op: 'annotation', date: '2026-10-14', usd: '150', limit: 150, source: 'task' },
    { op: 'annotation', date: '2026-10-14', usd: '4.5', limit: 50, source: 'rollout' },
  ])
  assert.equal(anns[0], '(approved 2026-10-14 under the standing approval: total exposure US$9, limit US$50 from file:defaults)')
  assert.equal(anns[2], '(approved 2026-10-14 under the standing approval: total exposure US$4.50, limit US$50 from rollout)')
  for (const ann of anns) {
    assert.ok(ann.startsWith('(approved ') && ann.indexOf(')') === ann.length - 1, `one ')' and it is last: ${ann}`)
  }
  const stripped = py(gates.map((gate, i) => ({ op: 'strip', gate, line: `${gate} ${anns[i]}` })))
  assert.deepEqual(stripped, [true, true, true], 'GATE_ANNOT_RE strips each, `(per account)` and the backticked path included')
  gates.forEach((gate, i) => assert.deepEqual([...T.unapprovedGates([gate], [`${gate} ${anns[i]}`])], [], gate))
})

// ---- the sweep ---------------------------------------------------------------------------------------------------

const words = (list) => [...new Set(list.map((h) => h.word))].sort()

test("the p18-7 sweep: its verbatim capture flags spend, and the old list as a script flags it too (the miss was by eye)", () => {
  const p = path.join(FIXTURES, 'chorus-p18-7.md')
  const [s] = py([{ op: 'sweep', path: p }])
  for (const w of ['credit', 'credits', 'fast mode']) assert.ok(words(s.spend).includes(w), `spend flags ${w}: ${words(s.spend)}`)
  const text = fs.readFileSync(p, 'utf8')
  const [old] = py([{ op: 'hits', text, list: 'OLD_SPEND' }])
  assert.ok(words(old).includes('credits'), 'honest control: the old list flags `credits` ("show the the api credits")')
})

test('the new words flag where the old list is silent; "audit" and "audio" never flag AUD', () => {
  const text = fs.readFileSync(path.join(FIXTURES, 'new-words.md'), 'utf8')
  const [neu, old, audit] = py([{ op: 'hits', text, list: 'SPEND' }, { op: 'hits', text, list: 'OLD_SPEND' },
    { op: 'hits', text: 'an audit of the audio', list: 'SPEND' }])
  for (const w of ['fast mode', 'extra usage', 'credit', 'AUD', 'per month', 'max_budget']) {
    assert.ok(words(neu).includes(w), `the sweep flags ${w}: ${words(neu)}`)
  }
  assert.deepEqual(old, [], 'the old list flags nothing')
  assert.deepEqual(audit, [])
})

test('the currency amount marker: shell variables never flag, the old literal $ does', () => {
  const text = fs.readFileSync(path.join(FIXTURES, 'shell-vars.md'), 'utf8')
  const [neu, old] = py([{ op: 'hits', text, list: 'SPEND' }, { op: 'hits', text, list: 'OLD_SPEND' }])
  assert.deepEqual(neu, [], 'no spend on a note of shell variables')
  assert.ok(words(old).includes('$'), 'honest control: the old literal $ flags it (the regression a mechanical old list brings)')
})

test('the currency amount marker: amounts flag as `$ amount`, code-only bare amounts and shell text do not', () => {
  const flag = ['about $5 of calls', 'about $ 5', 'US$5', '~A$690', 'AU$ 8.50/mo', 'NZ$5', 'C$5', 'a sub-$5 dust', '`US$5`']
  const quiet = ['`$5`', 'PATH=$PATH:bin', '$HOME/x']
  const got = py([...flag, ...quiet].map((text) => ({ op: 'hits', text, list: 'SPEND' })))
  flag.forEach((text, i) => {
    assert.deepEqual(words(got[i]), ['$ amount'], text)
    for (const h of got[i]) assert.equal(h.at, text, `${text}: its at holds the whole match`)
  })
  quiet.forEach((text, i) => assert.deepEqual(got[flag.length + i], [], text))
})

test('the sweep CLI prints one JSON line per note, body only, each hit with its word and an `at` holding it', () => {
  const r = spawnSync('python3', ['-I', '-B', MODULE, 'sweep', path.join(FIXTURES, 'chorus-p18-7.md'), path.join(FIXTURES, 'shell-vars.md')],
    { encoding: 'utf8', env: { ...process.env, THREAD_EVENTS_DIR: EVENTS } })
  assert.equal(r.status, 0, r.stderr)
  const lines = r.stdout.trim().split('\n').map((l) => JSON.parse(l))
  assert.deepEqual(lines.map((l) => l.slug), ['chorus-p18-7', 'shell-vars'])
  for (const l of lines) assert.deepEqual(Object.keys(l), ['slug', 'spend', 'credential', 'irreversible'])
  for (const h of lines[0].spend) {
    assert.deepEqual(Object.keys(h), ['word', 'at'])
    assert.ok(h.at.toLowerCase().includes(h.word.toLowerCase()), `${h.word} in ${h.at}`)
    assert.ok(!h.at.includes('\n'), 'newlines are folded')
  }
  const bad = spawnSync('python3', ['-I', '-B', MODULE, 'sweep', path.join(FIXTURES, 'no-such-note.md')], { encoding: 'utf8' })
  assert.equal(bad.status, 1)
  assert.match(bad.stderr, /^gated_inputs: .*no-such-note\.md: /)
  assert.equal(spawnSync('python3', ['-I', '-B', MODULE], { encoding: 'utf8' }).status, 2)
})
