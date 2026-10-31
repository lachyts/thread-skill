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
//   literal `$` does;
// - the test-credential reading (ADR 0062): each step's why, in order (the class-independent steps first); p8-1's two
//   gates, p8-2's and p8-3's staging gate (verbatim) read their keys; the deny cases, the known false asks and the
//   accepted residuals (a second credential in prose, the GitHub PAT: the annotation names only the proved keys);
//   schedule's test-credential Planner examples read their keys (the guidance is coupled to the reader);
// - the env-file read: a FIFO, a device, a symlink to one and a directory never block or read (isfile patched too), the
//   1 MiB cap, the dotenv edges and the JWT edges, no value in any why; the bootstrap-refresh shapes; the credential
//   annotation round-trips through GATE_ANNOT_RE and the engine's unapprovedGates, the gate's own parentheses kept.
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
    elif op == "credential":
        out.append(gi.credential_reading(req["gate"], req.get("cls")))
    elif op == "covered_cred":
        out.append(gi.credential_covered(req["gate"], req["cls"], req["bootstrap"]))
    elif op == "proof":
        out.append(gi.env_proof(req["cls"], req["names"]))
    elif op == "patched_proof":
        real = gi.os.path.isfile
        gi.os.path.isfile = lambda p: True
        try:
            out.append(gi.env_proof(req["cls"], req["names"]))
        finally:
            gi.os.path.isfile = real
    elif op == "read_env":
        env, why = gi.read_env(req["path"]); out.append({"env": env, "why": why})
    elif op == "bootstrap":
        out.append(gi.bootstrap_refreshes(req["cmd"], req["file"]))
    elif op == "cred_annotation":
        try:
            out.append(gi.credential_annotation(req["date"], req["names"], req["file"], req["source"]))
        except ValueError as e:
            out.append({"error": str(e)})
print(json.dumps(out))
`
function py(reqs, env = {}) {
  const r = spawnSync('python3', ['-I', '-B', '-c', DRIVER, MODULE, RECONCILE, JSON.stringify(reqs)], {
    encoding: 'utf8',
    env: { ...process.env, THREAD_EVENTS_DIR: EVENTS, ...env },
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

// ---- ADR 0038: a Cap is a promise. The stdin form `exposure -` the plan judge runs, and the one-line gate ----------
// The pricer's rules do not change (ADR 0038 § Consequences, *No pricer change*): `exposure -` reads ONE gate on stdin
// and prints the same reading as one JSON line, {"usd": "<amount>" | null, "why": "<reason>"}. The plan judge runs it
// on each top-level spend gate the engine parsed (task.workflow.js gatePricingBlock), quoted `<<'EOF'` so `$` and
// backticks in a gate never expand.

// p19-10's original gate (thread-skill-rollout-2026-10-17), from its archived note's line 157: the `## Approved plan`
// quote of its `### Gated inputs`, `> - ` stripped. Its line 49 (`## Approved gates`) carries the same gate plus
// ` (approved 2026-10-18)`, which prices `unrecognised clause: …` instead, so the bare form is the one the judge sees.
const P19_10 = 'spend: `claude plugin eval` re-runs of close-deletes-consumed-keeps-legacy and close-pending-doc-owns-continuation, --runs 3 each, Opus model and judge, before and after the fix plus at most one more iteration (up to 6 invocations, each --max-cost-usd 4) — cap 20 USD'
// ADR 0038 decision 1's restatements: the Cap holds the whole spend, the split goes in sub-bullets.
const P19_10_ONE_LINE = 'spend: claude plugin eval re-runs of the two close cases — cap 24 USD'
const P19_5_ONE_LINE = 'spend: two make evals runs, pre-trim and post-trim — cap 50 USD total'

// `exposure -` with `input` on stdin; args and env overridable. Returns {status, out (parsed when one JSON line), stderr}.
function cli(input, args = ['exposure', '-'], env = {}) {
  const r = spawnSync('python3', ['-I', '-B', MODULE, ...args], { input, env: { ...process.env, ...env } })
  const stdout = r.stdout.toString('utf8')
  let out = null
  try { out = JSON.parse(stdout) } catch { out = null }
  return { status: r.status, stdout, out, stderr: r.stderr.toString('utf8') }
}

test('ADR 0038: `exposure -` prices the one-line gates and names p19-10\'s `each`', () => {
  assert.ok(!P19_10.includes('(approved'), 'the fixture is the bare gate from line 157, never the annotated line 49')
  for (const [gate, want] of [
    [P19_10_ONE_LINE, { usd: '24', why: '' }],
    ['spend: claude plugin eval re-runs of the two close cases — cap 20 USD', { usd: '20', why: '' }],
    [P19_5_ONE_LINE, { usd: '50', why: '' }],
    ['spend: two make evals runs (pre-trim and post-trim) — cap 50 USD total', { usd: '50', why: '' }],
    [P19_10, { usd: null, why: 'per/each outside the cap clause: each, each' }],
  ]) {
    const r = cli(gate + '\n')
    assert.equal(r.status, 0, r.stderr)
    assert.equal(r.stdout.split('\n').filter(Boolean).length, 1, 'one JSON line')
    assert.deepEqual(r.out, want, gate)
  }
})

test('ADR 0038: `exposure -` agrees with exposure() and holds under LC_ALL=C (the em dash still prices)', () => {
  const gates = [PROBE, FAST, FAST_COUNTED, 'spend: image API — cap US$40, plus US$30 for the fallback',
    'credential: the Replicate API key', 'spend: fast mode — cap US$12.50 per month', 'spend: x — cap 5 USD and cap 3 USD']
  const want = py(gates.map((gate) => ({ op: 'exposure', gate })))
  gates.forEach((gate, i) => {
    for (const env of [{}, { LC_ALL: 'C', LANG: 'C' }]) {
      const r = cli(gate, undefined, env)
      assert.equal(r.status, 0, r.stderr)
      assert.deepEqual([num(r.out.usd), r.out.why], [num(want[i].usd), want[i].why], `${gate} ${JSON.stringify(env)}`)
    }
  })
  const c = cli(P19_10_ONE_LINE + '\r\n', undefined, { LC_ALL: 'C', LANG: 'C' })
  assert.deepEqual(c.out, { usd: '24', why: '' }, 'a CRLF line under LC_ALL=C')
  assert.equal(cli('spend: x — cap 2 USD for the €-priced tier').stdout.includes('€'), true, 'the why is UTF-8, never ASCII-escaped')
})

test('ADR 0038: `exposure` misuse exits 2 naming the stdin form; two lines ask; bad UTF-8 exits 1', () => {
  for (const args of [['exposure'], ['exposure', P19_10_ONE_LINE], ['exposure', '-', 'extra']]) {
    const r = cli(P19_10_ONE_LINE, args)
    assert.equal(r.status, 2, JSON.stringify(args))
    assert.match(r.stderr, /exposure - <<'EOF'/, 'the usage line names the stdin form')
    assert.equal(r.stdout, '', 'nothing on stdout')
  }
  for (const empty of ['', '\n', '  \n\n']) {
    const r = cli(empty)
    assert.equal(r.status, 2, JSON.stringify(empty))
    assert.match(r.stderr, /no gate on stdin/)
  }
  const two = cli(`${P19_10_ONE_LINE}\n${P19_5_ONE_LINE}\n`)
  assert.equal(two.status, 0)
  assert.deepEqual(two.out, { usd: null, why: 'stdin holds 2 lines: pass one gate' })
  const bad = cli(Buffer.from([0x73, 0x70, 0xff, 0xfe, 0x0a]))
  assert.equal(bad.status, 1)
  assert.equal(bad.stdout, '')
})

test("ADR 0038: the judge's quoted heredoc keeps `$` literal; an unquoted one expands it away (control)", () => {
  const run = (open) => spawnSync('bash', ['-c', `python3 -I -B '${MODULE}' exposure - ${open}\nspend: probe — cap $5\nEOF\n`], { encoding: 'utf8' })
  const quoted = run("<<'EOF'")
  assert.equal(quoted.status, 0, quoted.stderr)
  assert.deepEqual(JSON.parse(quoted.stdout), { usd: '5', why: '' })
  const bare = run('<<EOF')
  assert.equal(bare.status, 0, bare.stderr)
  assert.deepEqual(JSON.parse(bare.stdout), { usd: null, why: 'no cap clause' }, 'unquoted, `$5` expands to nothing')
})

test('ADR 0038 pipeline: sub-bullets are commentary, the one gate prices 24 through `exposure -` and the standing approval signs it', () => {
  const T = loadEngine(['parseGatedInputs'])
  const plan = [
    'Planned on: abc', '### Files to modify', '- x', '### Gated inputs',
    `- ${P19_10_ONE_LINE}`,
    '  - up to 6 invocations at --max-cost-usd 4, --runs 3 each',
    ' - one more iteration at most, each --max-cost-usd 4',
    '\t- before and after the fix, Opus model and judge',
    '### Risks / unknowns', '- none',
  ].join('\n')
  const gates = Array.from(T.parseGatedInputs(plan))
  assert.deepEqual(gates, [P19_10_ONE_LINE], 'a 2-space, a one-space and a tab sub-bullet are all commentary')
  assert.deepEqual(cli(gates[0] + '\n').out, { usd: '24', why: '' })
  const D = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-promise-'))
  try {
    const home = path.join(D, 'home')
    fs.mkdirSync(path.join(home, '.config', 'thread'), { recursive: true })
    fs.writeFileSync(path.join(home, '.config', 'thread', 'rollouts.toml'), '[defaults]\nspend_approval_usd = 50\n')
    fs.mkdirSync(path.join(D, 'repo'))
    fs.writeFileSync(path.join(D, 'ro.md'), `---\ntags: [task, rollout]\nstatus: open\nprotocol_version: 5\nparallel_ceiling: 4\n---\n\n## Notes\n\nProject root: \`${path.join(D, 'repo')}\`\n\n## Queue\n\n- [[a]]\n`)
    fs.writeFileSync(path.join(D, 'a.md'), `---\ntags: [task]\nstatus: gate-pending\nrollout: "[[ro]]"\n---\n\n## Notes\n\nbody\n\n## Gated inputs (awaiting sign-off)\n\n${gates.map((g) => '- ' + g).join('\n')}\n`)
    const r = spawnSync('python3', ['-I', '-B', RECONCILE, 'approve-gates', '--standing', '--tasks', 'a', '--rollout', path.join(D, 'ro.md'),
      '--tasks-dir', D, '--date', '2026-10-18', '--now', '2026-10-18T09:00:00Z'],
    { encoding: 'utf8', env: { ...process.env, HOME: home, THREAD_EVENTS_DIR: EVENTS } })
    assert.equal(r.status, 0, r.stdout + r.stderr)
    assert.ok(r.stdout.includes(`a: gate approved under the standing approval: ${P19_10_ONE_LINE} (exposure US$24 of US$50, file:defaults)`), r.stdout)
  } finally {
    fs.rmSync(D, { recursive: true, force: true })
  }
})

// ---- the test-credential reading (ADR 0062) -----------------------------------------------------------------------
// p8-1's two gates, verbatim from Archive/smart-slider-p8-1-credit-packs-on-the-slider.md (the ` (approved …)` stripped);
// p8-2's and p8-3's staging gates, verbatim from smart-slider-rollout-2026-10-28's task notes.
const P8_1_G1 = "credential: Stripe test-mode keys STRIPE_SECRET (sk_test_) and STRIPE_PUBLISHABLE_KEY (pk_test_) in the task tree's .env.local"
const P8_1_G2 = "credential: staging Supabase SUPABASE_SERVICE_ROLE_KEY (project geyyptxqiovujgbiecsp) in the task tree's .env.local"
const P8_2_G = "credential: staging Supabase SUPABASE_SERVICE_ROLE_KEY (project geyyptxqiovujgbiecsp) in the task tree's .env.local, for the Verify run (a throwaway staging test user topped up with add_credits, then the 5-GIF batch spends its credits)"
const P8_3_G = "credential: the staging Supabase SUPABASE_SERVICE_ROLE_KEY (project geyyptxqiovujgbiecsp), already in this task tree's copied .env.local, used by Verify to create a throwaway test user, fetch its sign-in code, read its credit balance and delete it"
const REF = 'geyyptxqiovujgbiecsp'
const CLS = { file: '/x/.env.local', keys: [{ name: 'STRIPE_SECRET', prefix: 'sk_test_' }, { name: 'STRIPE_PUBLISHABLE_KEY', prefix: 'pk_test_' },
  { name: 'SUPABASE_SERVICE_ROLE_KEY', supabase_project: REF }] }
const OFF = 'no test-credential class for this repo (set test_credentials in its [repo."owner/name"] table in ~/.config/thread/rollouts.toml)'
const reading = (gate, cls = CLS) => py([{ op: 'credential', gate, cls }])[0]

test('the test-credential reading: each step names its why, the class-independent steps first', () => {
  const cases = [
    ['spend: x — cap US$5 total', CLS, 'not a credential gate'],
    ['credential: test-mode STRIPE_SECRET (sk_test_), then wipe the test customers', CLS, 'deny word: wipe'],
    ["credential: STRIPE_SECRET (sk_test_) in the task tree's .env.local", CLS, 'no test-mode, staging or sandbox word'],
    ['credential: the tests read STRIPE_SECRET (sk_test_)', CLS, 'no test-mode, staging or sandbox word'], // `tests` is no mode word
    [P8_1_G1, null, OFF],
    ['credential: test-mode STRIPE_WEBHOOK_SECRET (whsec_)', CLS, 'STRIPE_WEBHOOK_SECRET is not a declared test credential'],
    ["credential: Stripe test-mode keys in the task tree's .env.local", CLS, 'it names no declared test credential'],
    ['credential: test-mode STRIPE_SECRET (pk_test_)', CLS, 'pk_test_ is not the declared prefix of a key it names'],
    ['credential: staging SUPABASE_SERVICE_ROLE_KEY (project abcdefghijklmnopqrst)', CLS,
      'abcdefghijklmnopqrst is not the declared Supabase project of a key it names'],
    ['credential: staging STRIPE_SECRET (sk_test_) for project geyyptxqiovujgbiecsp', CLS,
      'geyyptxqiovujgbiecsp is not the declared Supabase project of a key it names'], // a ref of a key it does not name
  ]
  const got = py(cases.map(([gate, cls]) => ({ op: 'credential', gate, cls })))
  cases.forEach(([gate, , why], i) => assert.deepEqual(got[i], { names: null, why }, gate))
})

test("p8-1's two gates, p8-2's and p8-3's staging gates read their declared keys", () => {
  const got = py([P8_1_G1, P8_1_G2, P8_2_G, P8_3_G, `- Credential: ${P8_1_G2.slice('credential: '.length)}`].map((gate) => ({ op: 'credential', gate, cls: CLS })))
  assert.deepEqual(got, [
    { names: ['STRIPE_SECRET', 'STRIPE_PUBLISHABLE_KEY'], why: '' },
    { names: ['SUPABASE_SERVICE_ROLE_KEY'], why: '' },
    { names: ['SUPABASE_SERVICE_ROLE_KEY'], why: '' },
    { names: ['SUPABASE_SERVICE_ROLE_KEY'], why: '' },
    { names: ['SUPABASE_SERVICE_ROLE_KEY'], why: '' }, // a list marker and a capitalised kind are normalised first
  ])
})

test('the deny rules: live or prod at a word start or after _, the irreversible list and the deny nouns, the whole word quoted', () => {
  const cases = [
    ['credential: test-mode SUPABASE_PROD_KEY', 'PROD'],
    ['credential: test-mode STRIPE_LIVE_KEY', 'LIVE'],
    ['credential: test-mode STRIPE_SECRET (sk_prod_)', 'prod'],
    ['credential: Production Supabase SUPABASE_SERVICE_ROLE_KEY', 'Production'],
    ['credential: test-mode STRIPE_SECRET with livemode off', 'livemode'],
    ['credential: test-mode STRIPE_SECRET (sk_live_)', 'live'],
    ['credential: Stripe live keys STRIPE_SECRET (sk_live_)', 'live'],
    ['credential: staging SUPABASE_SERVICE_ROLE_KEY, then delete production rows', 'delete production'],
    ['credential: staging SUPABASE_SERVICE_ROLE_KEY, which cannot be undone', 'cannot be undone'],
    ['credential: the staging Postgres password', 'password'],
    ['credential: a test-mode GitHub token GH_TOKEN', 'token'],
    ['credential: staging OAuth client STAGING_CLIENT_ID', 'OAuth'],
    ['credential: the staging ssh key', 'ssh'],
    ['credential: the staging deploy private key', 'private key'],
    ['credential: the staging AWS access key AWS_KEY_ID', 'access key'],
    ['credential: staging read access to SUPABASE_SERVICE_ROLE_KEY', 'access'],
    ['credential: the staging session cookies', 'cookies'],
    ['credential: test-mode STRIPE_SECRET from the keychain', 'keychain'],
    ['credential: test-mode STRIPE_SECRET from 1Password', '1Password'],
    ['credential: the staging GPG passphrase', 'passphrase'],
  ]
  const got = py(cases.map(([gate]) => ({ op: 'credential', gate, cls: CLS })))
  cases.forEach(([gate, word], i) => assert.deepEqual(got[i], { names: null, why: `deny word: ${word}` }, gate))
})

test('the order: a gate no class could sign says its own why, with or without a class (S3\'s Replicate gate)', () => {
  const CRED = 'credential: the Replicate API key from 1Password'
  assert.deepEqual(reading(CRED, CLS), { names: null, why: 'deny word: API key' })
  assert.deepEqual(reading(CRED, null), { names: null, why: 'deny word: API key' })
  assert.deepEqual(reading("credential: Stripe live keys STRIPE_SECRET (sk_live_)", null), { names: null, why: 'deny word: live' })
})

test('known false asks (ADR 0062 residual ii): Stripe\'s own "API keys" and "secret key", STRIPE_PRODUCT_ID, "lives"', () => {
  const cases = [
    ['credential: test-mode STRIPE_PRODUCT_ID', 'deny word: PRODUCT'],
    ["credential: Stripe test-mode API keys STRIPE_SECRET (sk_test_) in the task tree's .env.local", 'deny word: API keys'],
    ['credential: Stripe test secret key STRIPE_SECRET (sk_test_)', 'deny word: secret'],
    ['credential: the test-mode STRIPE_SECRET (sk_test_) that lives in .env.local', 'deny word: lives'],
  ]
  const got = py(cases.map(([gate]) => ({ op: 'credential', gate, cls: CLS })))
  cases.forEach(([gate, why], i) => assert.deepEqual(got[i], { names: null, why }, gate))
})

test('accepted residual (i): a second credential in prose, and the GitHub PAT, pass the reading; the annotation names only the proved key', () => {
  const PROSE = 'credential: test-mode STRIPE_SECRET (sk_test_) and the Replicate key from the vault'
  const PAT = "credential: test-mode STRIPE_SECRET (sk_test_) and the GitHub PAT in the task tree's .env.local"
  assert.deepEqual(reading(PROSE), { names: ['STRIPE_SECRET'], why: '' })
  assert.deepEqual(reading(PAT), { names: ['STRIPE_SECRET'], why: '' }, '`PAT` has no _, so it is no env token, and no deny noun')
  const [ann] = py([{ op: 'cred_annotation', date: '2026-11-01', names: reading(PAT).names, file: CLS.file, source: 'file:repo' }])
  assert.equal(ann, '(approved 2026-11-01 under the standing approval: test credential STRIPE_SECRET present in /x/.env.local, class from file:repo)',
    'the boundary: the annotation names STRIPE_SECRET alone and the file')
})

test("schedule's test-credential Planner examples read their keys (the guidance is coupled to the reader); API keys inserted asks", () => {
  const schedule = fs.readFileSync(path.join(root, 'skills', 'schedule', 'SKILL.md'), 'utf8')
  const s7 = schedule.slice(schedule.indexOf('### 7. '), schedule.indexOf('### 7.5. '))
  const line = s7.split('\n').find((l) => l.startsWith('- Planner: word each test-credential gate'))
  assert.ok(line, 'schedule § 7 has the test-credential Planner line')
  const examples = [...line.matchAll(/`(credential: [^`]*<NAME>[^`]*)`/g)].map((m) => m[1])
  assert.equal(examples.length, 2, 'two backticked examples, a prefix key and a project key')
  const fill = (ex, k) => ex.replace('<NAME>', k.name).replace('<prefix>', k.prefix ?? '').replace('<ref>', k.supabase_project ?? '')
  const filled = [fill(examples[0], CLS.keys[0]), fill(examples[1], CLS.keys[2])]
  assert.deepEqual(py(filled.map((gate) => ({ op: 'credential', gate, cls: CLS }))),
    [{ names: ['STRIPE_SECRET'], why: '' }, { names: ['SUPABASE_SERVICE_ROLE_KEY'], why: '' }], filled.join(' | '))
  assert.deepEqual(reading(filled[0].replace('test-mode', 'test-mode API keys')), { names: null, why: 'deny word: API keys' }, 'control')
})

// ---- the env file and the value proof (ADR 0062) --------------------------------------------------------------------

// One driver run under a 10 s deadline: a read that blocked (a FIFO opened without O_NONBLOCK) fails the test, never the suite.
function pyT(reqs) {
  const r = spawnSync('python3', ['-I', '-B', '-c', DRIVER, MODULE, RECONCILE, JSON.stringify(reqs)], {
    encoding: 'utf8', timeout: 10000, env: { ...process.env, THREAD_EVENTS_DIR: EVENTS },
  })
  assert.equal(r.signal, null, 'the read returned (no block)')
  assert.equal(r.status, 0, r.stderr)
  return JSON.parse(r.stdout)
}
function scratch(t) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'gated-env-'))
  t.after(() => fs.rmSync(d, { recursive: true, force: true }))
  return d
}
const clsAt = (file) => ({ ...CLS, file })
const b64 = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url')
const JWT = (payload) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}.c2ln`

test('a FIFO, a device, a symlink to one and a directory are never read, nor block, even with isfile patched to True', (t) => {
  const d = scratch(t)
  const fifo = path.join(d, 'fifo.env')
  assert.equal(spawnSync('mkfifo', [fifo]).status, 0, 'mkfifo')
  const link = path.join(d, 'zero.env')
  fs.symlinkSync('/dev/zero', link)
  const dir = path.join(d, 'dir.env')
  fs.mkdirSync(dir)
  for (const f of [fifo, '/dev/zero', link, dir]) {
    const [plain, patched] = pyT([{ op: 'proof', cls: clsAt(f), names: ['STRIPE_SECRET'] }, { op: 'patched_proof', cls: clsAt(f), names: ['STRIPE_SECRET'] }])
    assert.deepEqual(plain, { ok: false, why: `${f} is not a regular file` }, `${f}: never opened`)
    assert.deepEqual(patched, { ok: false, why: `${f} is not a regular file` }, `${f}: swapped after the check, fstat refuses it`)
  }
  const missing = path.join(d, 'none.env')
  assert.deepEqual(pyT([{ op: 'proof', cls: clsAt(missing), names: ['STRIPE_SECRET'] }])[0], { ok: false, why: `${missing} is not a regular file` })
})

test('the 1 MiB cap: one byte over asks; exactly 1 MiB holding the key reads', (t) => {
  const d = scratch(t)
  const head = 'STRIPE_SECRET=sk_test_FAKE51capvalue\n'
  const exact = path.join(d, 'exact.env')
  fs.writeFileSync(exact, head + '#'.repeat((1 << 20) - head.length - 1) + '\n')
  assert.equal(fs.statSync(exact).size, 1 << 20)
  const over = path.join(d, 'over.env')
  fs.writeFileSync(over, head + '#'.repeat((1 << 20) - head.length) + '\n')
  const [a, b] = pyT([{ op: 'proof', cls: clsAt(exact), names: ['STRIPE_SECRET'] }, { op: 'proof', cls: clsAt(over), names: ['STRIPE_SECRET'] }])
  assert.deepEqual(a, { ok: true, why: '' })
  assert.deepEqual(b, { ok: false, why: `${over} is over 1 MiB` })
})

test('the dotenv parse: export, both quotes, an unclosed quote, ` #`, CRLF, the last assignment, an empty value; non-UTF-8 asks', (t) => {
  const d = scratch(t)
  const f = path.join(d, 'a.env')
  fs.writeFileSync(f, ['# a comment', '', 'export A_KEY=one', 'B_KEY="two words" # trailing', "C_KEY='three'", 'D_KEY="unclosed',
    'E_KEY=five # a comment', 'F_KEY=six#kept', 'G_KEY=first', 'G_KEY=second', 'H_KEY=', 'I_KEY=   ', 'J_KEY = spaced', 'not a line', 'K_KEY=crlf\r', ''].join('\n'))
  const bad = path.join(d, 'bad.env')
  fs.writeFileSync(bad, Buffer.from([0x41, 0x5f, 0x4b, 0x3d, 0xff, 0xfe, 0x0a]))
  const [r, nb] = pyT([{ op: 'read_env', path: f }, { op: 'read_env', path: bad }])
  assert.deepEqual(r, { env: { A_KEY: 'one', B_KEY: 'two words', C_KEY: 'three', E_KEY: 'five', F_KEY: 'six#kept', G_KEY: 'second', J_KEY: 'spaced', K_KEY: 'crlf' }, why: null })
  assert.deepEqual(nb, { env: null, why: `${bad} is not UTF-8` })
})

test('the value proof: missing keys all named, a wrong prefix, and every JWT edge; no value in any why', (t) => {
  const d = scratch(t)
  const write = (name, lines) => { const f = path.join(d, name); fs.writeFileSync(f, lines.join('\n') + '\n'); return f }
  const none = write('none.env', ['ENVIRONMENT=staging', 'SUPABASE_ANON_KEY=anon-FAKE', 'STRIPE_PUBLISHABLE_KEY='])
  const live = write('live.env', ['STRIPE_SECRET=sk_live_FAKE51value', 'STRIPE_PUBLISHABLE_KEY=pk_test_FAKE51value'])
  const [missing, wrong] = pyT([{ op: 'proof', cls: clsAt(none), names: ['STRIPE_SECRET', 'STRIPE_PUBLISHABLE_KEY', 'SUPABASE_SERVICE_ROLE_KEY'] },
    { op: 'proof', cls: clsAt(live), names: ['STRIPE_SECRET', 'STRIPE_PUBLISHABLE_KEY'] }])
  assert.deepEqual(missing, { ok: false, why: `STRIPE_SECRET is not set in ${none}; STRIPE_PUBLISHABLE_KEY is not set in ${none}; SUPABASE_SERVICE_ROLE_KEY is not set in ${none}` })
  assert.deepEqual(wrong, { ok: false, why: `STRIPE_SECRET in ${live} does not start with sk_test_` })
  const LEGACY = (f) => `SUPABASE_SERVICE_ROLE_KEY in ${f} is not a legacy JWT service key, so its project cannot be proved`
  const cases = [
    ['nodots-FAKE', 'legacy'],
    [`${b64({ alg: 'HS256' })}.${b64({ ref: REF })}`, 'legacy'], // two parts
    [`${b64({ alg: 'HS256' })}.!!FAKE!!.c2ln`, 'legacy'], // bad base64url
    [`${b64({ alg: 'HS256' })}.${b64('[1,2]')}.c2ln`, 'legacy'], // a payload that is no JSON object
    [`${b64({ alg: 'HS256' })}.${b64('not json')}.c2ln`, 'legacy'],
    ['sb_secret_FAKE51newformat', 'legacy'],
    [JWT({ ref: 'abcdefghijklmnopqrst', role: 'service_role' }), 'other'],
    [JWT({ role: 'service_role' }), 'other'], // no ref
    [JWT({ ref: REF, role: 'service_role' }), 'ok'],
  ]
  const files = cases.map(([value], i) => write(`jwt${i}.env`, [`SUPABASE_SERVICE_ROLE_KEY=${value}`]))
  const got = pyT(files.map((f) => ({ op: 'proof', cls: clsAt(f), names: ['SUPABASE_SERVICE_ROLE_KEY'] })))
  cases.forEach(([value, want], i) => {
    const expect = want === 'ok' ? { ok: true, why: '' } : want === 'legacy' ? { ok: false, why: LEGACY(files[i]) }
      : { ok: false, why: `SUPABASE_SERVICE_ROLE_KEY in ${files[i]} is not a key for Supabase project ${REF}` }
    assert.deepEqual(got[i], expect, value)
    assert.ok(!JSON.stringify(got[i]).includes(value), `no value in the why: ${value}`)
  })
  assert.ok(!JSON.stringify([missing, wrong]).includes('FAKE'), 'no value in the missing or prefix whys')
})

// ---- the bootstrap refresh (ADR 0062 d4) ----------------------------------------------------------------------------

// HOME is pinned to /Users/lachlants, so F and T name one file on every runner: a word counts as what the shell passes, so
// `~/`, `$HOME/` and `${HOME}/` serve a class declaring F and the reverse, while a quoted `~` or a single-quoted `$HOME`
// (which the shell never expands: under p8-1's `|| true` the copy fails silently and the stale copy stays) asks.
test('bootstrap_refreshes: a plain cp of the file passes (p8-1\'s verbatim line, ~/, $HOME, ${HOME}, cp -v); every other shape asks', () => {
  const HOME = { HOME: '/Users/lachlants' }
  const F = '/Users/lachlants/repos/animately/optimizer/.env.local'
  const T = '~/repos/animately/optimizer/.env.local'
  const P8_1 = `yarn install --immutable && git submodule update --init library && (cp ${F} .env.local 2>/dev/null || true)`
  const okCases = [[P8_1, F], [`cp ${T} .env.local`, T], ['cp $HOME/repos/animately/optimizer/.env.local .env.local', T],
    ['cp "${HOME}/repos/animately/optimizer/.env.local" .env.local', T], [`cp -v ${F} .env.local`, F], [`yarn install; cp -- ${F} ./.env.local`, F],
    [`cp ${T} .env.local`, F], [`cp ${F} .env.local`, T], ['cp "$HOME"/repos/animately/optimizer/.env.local .env.local', F],
    [`test -f .env.example\ncp ${F} .env.local`, F], [`cp ${F} \\\n  .env.local`, F]]
  assert.deepEqual(py(okCases.map(([cmd, file]) => ({ op: 'bootstrap', cmd, file })), HOME), okCases.map(() => ({ ok: true, why: '' })), 'accepted')
  const PRE = `the rollout's env_bootstrap may not refresh ${F} into the task tree: `
  const NONE = `the rollout's env_bootstrap does not provide ${F}`
  const QUOTED = (file) => `the rollout's env_bootstrap may not refresh ${file} into the task tree: it names the file with a quoted ~ or a single-quoted $HOME, which the shell never expands`
  const refusedT = [
    [`cp "${T}" .env.local`, QUOTED(T)],
    ["cp '$HOME/repos/animately/optimizer/.env.local' .env.local", QUOTED(T)],
    ["cp '${HOME}/repos/animately/optimizer/.env.local' .env.local", QUOTED(T)],
    [`cp \\${T} .env.local`, QUOTED(T)],
    ['cp $HOMEDIR/repos/animately/optimizer/.env.local .env.local', `the rollout's env_bootstrap does not provide ${T}`],
  ]
  const gotT = py(refusedT.map(([cmd]) => ({ op: 'bootstrap', cmd, file: T })), HOME)
  refusedT.forEach(([cmd, why], i) => assert.deepEqual(gotT[i], { ok: false, why }, cmd))
  const refused = [
    [`cp "${T}" .env.local`, QUOTED(F)],
    [`(test -f .env.example)&&cp ${F} .env.local`, PRE + 'its copy runs only after a test'],
    [`test -f .env.example &&\ncp ${F} .env.local`, PRE + 'its copy runs only after a test'],
    ['', NONE],
    [`cp ${F}.bak .env.local`, NONE],
    [`yarn install # cp ${F} .env.local`, NONE],
    [`[ -f .env.local ] || cp ${F} .env.local`, PRE + 'its copy runs only after a test'],
    [`test -f .env.example && cp ${F} .env.local`, PRE + 'its copy runs only after a test'],
    [`test -f ${F} && cp ${F} .env.local`, PRE + 'it names the file outside a plain cp'], // the test names it too
    [`[ -f x ] && echo copying && cp ${F} .env.local`, PRE + 'its copy runs only after a test'],
    [`cp -n ${F} .env.local`, PRE + 'its cp skips an existing copy (-n, -u or -i)'],
    [`cp -u ${F} .env.local`, PRE + 'its cp skips an existing copy (-n, -u or -i)'],
    [`cp -vi ${F} .env.local`, PRE + 'its cp skips an existing copy (-n, -u or -i)'],
    [`cp --no-clobber ${F} .env.local`, PRE + 'its cp skips an existing copy (-n, -u or -i)'],
    [`cp --update=older ${F} .env.local`, PRE + 'its cp skips an existing copy (-n, -u or -i)'],
    [`cp .env.local ${F}`, PRE + 'its cp writes the file instead of reading it'],
    [`ln -s ${F} .env.local`, PRE + 'it names the file outside a plain cp'],
    [`rsync ${F} .env.local`, PRE + 'it names the file outside a plain cp'],
    [`if true; then cp ${F} .env.local; fi`, PRE + 'it names the file outside a plain cp'],
    [`cp '${F} .env.local`, "the rollout's env_bootstrap is not one shell command"],
  ]
  const got = py(refused.map(([cmd]) => ({ op: 'bootstrap', cmd, file: F })), HOME)
  refused.forEach(([cmd, why], i) => assert.deepEqual(got[i], { ok: false, why }, cmd))
})

test('credential_covered: the reading, then the bootstrap, then the proof', (t) => {
  const d = scratch(t)
  const f = path.join(d, 'src.env')
  fs.writeFileSync(f, `STRIPE_SECRET=sk_test_FAKE51a\nSTRIPE_PUBLISHABLE_KEY=pk_test_FAKE51b\nSUPABASE_SERVICE_ROLE_KEY=${JWT({ ref: REF, role: 'service_role' })}\n`)
  const boot = `yarn install && (cp ${f} .env.local 2>/dev/null || true)`
  const got = py([
    { op: 'covered_cred', gate: P8_1_G1, cls: clsAt(f), bootstrap: boot },
    { op: 'covered_cred', gate: P8_1_G2, cls: clsAt(f), bootstrap: boot },
    { op: 'covered_cred', gate: 'credential: the Replicate API key', cls: clsAt(f), bootstrap: '' },
    { op: 'covered_cred', gate: P8_1_G1, cls: clsAt(f), bootstrap: '' },
    { op: 'covered_cred', gate: P8_1_G1, cls: clsAt(path.join(d, 'none.env')), bootstrap: `cp ${path.join(d, 'none.env')} .env.local` },
  ])
  assert.deepEqual(got[0], { covered: true, names: ['STRIPE_SECRET', 'STRIPE_PUBLISHABLE_KEY'], why: '' })
  assert.deepEqual(got[1], { covered: true, names: ['SUPABASE_SERVICE_ROLE_KEY'], why: '' })
  assert.deepEqual(got[2], { covered: false, names: null, why: 'deny word: API key' }, 'the reading first: no bootstrap is read')
  assert.deepEqual(got[3], { covered: false, names: ['STRIPE_SECRET', 'STRIPE_PUBLISHABLE_KEY'], why: `the rollout's env_bootstrap does not provide ${f}` })
  assert.deepEqual(got[4], { covered: false, names: ['STRIPE_SECRET', 'STRIPE_PUBLISHABLE_KEY'], why: `${path.join(d, 'none.env')} is not a regular file` })
})

test("the credential annotation strips through GATE_ANNOT_RE and the engine's unapprovedGates, the gate's own parentheses kept", () => {
  const T = loadEngine(['unapprovedGates'])
  const gates = [P8_1_G1, P8_1_G2]
  const anns = py([
    { op: 'cred_annotation', date: '2026-11-01', names: ['STRIPE_SECRET', 'STRIPE_PUBLISHABLE_KEY'], file: '~/repos/animately/optimizer/.env.local', source: 'file:repo' },
    { op: 'cred_annotation', date: '2026-11-01', names: ['SUPABASE_SERVICE_ROLE_KEY'], file: '/x/.env.local', source: 'file:repo' },
    { op: 'cred_annotation', date: '2026-11-01', names: ['STRIPE_SECRET'], file: '/x/(old).env', source: 'file:repo' },
  ])
  assert.equal(anns[0], '(approved 2026-11-01 under the standing approval: test credential STRIPE_SECRET, STRIPE_PUBLISHABLE_KEY present in ~/repos/animately/optimizer/.env.local, class from file:repo)')
  assert.match(anns[2].error, /an annotation part holds a '\)'/, 'a ) in a part raises')
  for (const ann of anns.slice(0, 2)) assert.ok(ann.startsWith('(approved ') && ann.indexOf(')') === ann.length - 1, `one ')' and it is last: ${ann}`)
  const stripped = py(gates.map((gate, i) => ({ op: 'strip', gate, line: `${gate} ${anns[i]}` })))
  assert.deepEqual(stripped, [true, true], 'GATE_ANNOT_RE strips each; `(sk_test_)` and `(project …)` stay')
  gates.forEach((gate, i) => assert.deepEqual([...T.unapprovedGates([gate], [`${gate} ${anns[i]}`])], [], gate))
})
