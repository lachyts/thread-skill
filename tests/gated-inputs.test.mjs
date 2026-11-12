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
// - p37-4 (ADR 0034's 2026-11-05 amendment, unpriceable never means asked): the verbatim gate that stopped
//   chorus-rollout-2026-11-02 reads null in full and US$1 in the standing reading, covered at 200, its CLI line exactly
//   {"usd": "1", "why": ""}; the reading is monotone (a US$ amount is never dropped); outside the clause per/each is a
//   rate only before a unit, and on the cap any per/each/every asks in both readings; 7(ix) holds every per-unit word;
//   the cap-only clause signs prose and still asks on a rate, multiplier, %, plus, widening word, currency or per-unit
//   noun; the accepted residuals; and the test-Login reading, each why (an `@` or a conjunction beside the Login
//   asks) and its residual (a second thing in plain prose);
// - p48-4 (ADR 0034's 2026-11-13 amendment, a spend plainly under the limit never asks): the ruling's wordings (a split,
//   plus, a range, a counted rate, a multiplier, another currency, a bound synonym) priced at their widest, each with
//   the cap-only reading's why as `widest`; the ceiling table; the CLI's widest line; WIDENING's `±` and uncapped
//   words asking in both earlier readings; each widest step's why; the Verify corpus (a regression pin); per-unit gates
//   left to the full reading; the residuals r1, r2 and r5 and the named over-asks; the PR review's four under-reads,
//   each gate not covered at 200 (a unit's counts summed, two multipliers on a rate asking; a multiplier range at its
//   top; a dollar marker after its number; an ISO 4217 code off the table asking, in rule 6 too); its second review's
//   (a repeated-marker range, a grouped N and an unspaced em dash read whole; W5e's backstop asking on a multiplier
//   read only in part, each why pinned; `thrice`, `quadruple` and `N-fold` in every reading; an unknown letters-`$`
//   marker asking in rule 6); and the plan judge's other-currency sentence coupled to the pricer;
// - the test-credential reading (ADR 0063): each step's why, in order (the class-independent steps first); p8-1's two
//   gates, p8-2's and p8-3's staging gate (verbatim) read their keys; the deny cases, the known false asks and the
//   accepted residuals (a second credential in prose, the GitHub PAT: the annotation names only the proved keys);
//   schedule's test-credential Planner examples read their keys (the guidance is coupled to the reader);
// - the env-file read: a FIFO, a device, a symlink to one and a directory never block or read (isfile patched too), the
//   1 MiB cap, the dotenv edges and the JWT edges, no value in any why; the bootstrap-refresh shapes; the credential
//   annotation round-trips through GATE_ANNOT_RE and the engine's unapprovedGates, the gate's own parentheses kept;
// - p39-3 (the sweep records a declared test Login): the Verify (tests/fixtures/gated-inputs/test-login.md, the archived
//   Steer note's credential gate, reads `{names: ["dummy"]}` with ["dummy"] and asks with []; with no logins, today's
//   shape); the line rule (only a `credential:` gate line naming a Login reads, its `(approved …)` suffix in any case,
//   the standing approval's own annotation, `>` markers and a CR stripped; prose, a numbered line and a Planner line get
//   no key); APPROVED_SUFFIX_RE against GATE_ANNOT_RE (pattern, flags and an uppercase strip); schedule § 7's test-Login
//   Planner line coupled to the reader; the CLI's lazy read of `[defaults] test_logins` (declared, none, a refused file
//   with its one stderr line and exit 1, laziness for a note with no Login gate or one stopped at steps 1-6, stderr in
//   note order) and its no-bytecode load (a copy of three scripts, with a control that drops the flag).
//
// Hermetic: python3 -I -B (no bytecode next to the module), THREAD_EVENTS_DIR in temp (reconcile-rollout.py is only
// imported, never run), and every sweep CLI spawn under a temp HOME. It writes only under mktemp dirs; test 7 of p39-3
// copies three scripts there and runs them without -B.
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
    elif op == "standing":
        r = gi.standing_exposure(req["gate"]); o = {"usd": None if r["usd"] is None else str(r["usd"]), "why": r["why"], "capOnly": r["capOnly"]}
        if r.get("widest"):
            o["widest"] = r["widest"]
        out.append(o)
    elif op == "widest":
        r = gi.widest_exposure(req["gate"]); out.append({"usd": None if r["usd"] is None else str(r["usd"]), "why": r["why"]})
    elif op == "ceiling":
        out.append({k: str(v) for k, v in gi.CEILING_USD.items()})
    elif op == "login":
        out.append(gi.login_reading(req["gate"], req.get("logins")))
    elif op == "has_login":
        out.append(gi.has_login_phrase(req["gate"]))
    elif op == "login_annotation":
        try:
            out.append(gi.login_annotation(req["date"], req["names"], req["source"]))
        except ValueError as e:
            out.append({"error": str(e)})
    elif op == "annotation":
        out.append(gi.annotation(req["date"], req["usd"], req["limit"], req["source"]))
    elif op == "strip":
        rr = rr or load("rr", sys.argv[2]); out.append(rr._norm_gate(req["line"]) == rr._norm_gate(req["gate"]) and rr.GATE_ANNOT_RE.sub("", req["line"]) == req["gate"])
    elif op == "hits":
        out.append(gi.hits(req["text"], getattr(gi, req["list"])))
    elif op == "sweep":
        out.append(gi.sweep(gi.body_of(open(req["path"], encoding="utf-8").read()), req.get("logins")))
    elif op == "sweep_text":
        out.append(gi.sweep(req["text"], req.get("logins")))
    elif op == "suffix_re":
        rr = rr or load("rr", sys.argv[2])
        out.append([[r.pattern, r.flags] for r in (gi.APPROVED_SUFFIX_RE, rr.GATE_ANNOT_RE)])
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
const standing = (gate) => py([{ op: 'standing', gate }])[0]
const num = (usd) => (usd === null ? null : Number(usd))

// p18-7's real gates, verbatim from Archive/chorus-p18-7-fast-while-held.md `## Approved gates`, ` (approved 2026-10-12)`
// stripped.
const PROBE = "spend: the fast-mode probe (`scripts/stage/probe-fast.py`). Phase A is free (`get_usage` only, every signed-in Claude Login). Phase B runs seven Turns on `claude-opus-5-5` on ONE Login that passes the cap (three standard, four fast), drawn from that Login's usage credits. Cap US$5 total, held by the client's `max_budget_usd=5` and the script stopping before any Turn once the cumulative `total_cost_usd` reaches US$4."
const FAST = "spend: the live feature, Claude fast mode on each run of questions on the Session he is on, drawn from that Login's usage credits (extra usage). Cap US$50 per Login (per account) per calendar month, enforced in code: fast is asked only while the Login's extra-usage monthly limit reads at or under `fast_credit_cap` (5000 minor units, USD or AUD only) with used credits under it, and unknown, stale, unlimited or over-cap credits keep it standard."
// The gate that stopped chorus-rollout-2026-11-02 (p37-4), verbatim from
// Archive/chorus-a-steer-that-leads-with-a-local-command-tag-reads-lost.md:54, ` (approved 2026-11-03)` stripped.
const STEER = "spend: live probe of a tag-led Steer into a running Turn (Haiku 4.5, CLI 2.1.314 and the day's pin, per the task note's 'Measure first') — cap 1 USD"
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
test('never covered: a widening word inside or outside the cap clause asks in full; inside the clause it is never read as the bare cap', () => {
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
    // p37-4: the standing reading prices a gate whose widening word sits outside the cap clause from its cap alone
    // (an accepted residual of the cap-only reading: the cap stays the implementer's ceiling); one inside the clause
    // still asks there too.
    const inside = why.startsWith('unrecognised clause: ')
    assert.equal(got[2 * i + 1].covered, !inside, `${gate}: ${inside ? 'never covered' : 'covered from its cap'} at 50`)
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

test('the sweep CLI prints one JSON line per note, body only, each hit with its word and an `at` holding it', (t) => {
  // p39-3: every spawn under a temp HOME, so the operator's own rollouts.toml never enters the reading
  const H = fs.mkdtempSync(path.join(os.tmpdir(), 'gated-inputs-home-'))
  t.after(() => fs.rmSync(H, { recursive: true, force: true }))
  const env = { ...process.env, HOME: H, THREAD_EVENTS_DIR: EVENTS }
  const r = spawnSync('python3', ['-I', '-B', MODULE, 'sweep', path.join(FIXTURES, 'chorus-p18-7.md'), path.join(FIXTURES, 'shell-vars.md')],
    { encoding: 'utf8', env })
  assert.equal(r.status, 0, r.stderr)
  const lines = r.stdout.trim().split('\n').map((l) => JSON.parse(l))
  assert.deepEqual(lines.map((l) => l.slug), ['chorus-p18-7', 'shell-vars'])
  for (const l of lines) assert.deepEqual(Object.keys(l), ['slug', 'spend', 'credential', 'irreversible'])
  for (const h of lines[0].spend) {
    assert.deepEqual(Object.keys(h), ['word', 'at'])
    assert.ok(h.at.toLowerCase().includes(h.word.toLowerCase()), `${h.word} in ${h.at}`)
    assert.ok(!h.at.includes('\n'), 'newlines are folded')
  }
  const bad = spawnSync('python3', ['-I', '-B', MODULE, 'sweep', path.join(FIXTURES, 'no-such-note.md')], { encoding: 'utf8', env })
  assert.equal(bad.status, 1)
  assert.match(bad.stderr, /^gated_inputs: .*no-such-note\.md: /)
  assert.equal(spawnSync('python3', ['-I', '-B', MODULE], { encoding: 'utf8', env }).status, 2)
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
    // p37-4: the CLI prints the standing reading, so p19-10's gate prints its cap-only amount (its cap plus its
    // `--max-cost-usd 4`) and the plan judge never bounces it on wording alone; exposure() still asks (below).
    [P19_10, { usd: '24', why: '' }],
  ]) {
    const r = cli(gate + '\n')
    assert.equal(r.status, 0, r.stderr)
    assert.equal(r.stdout.split('\n').filter(Boolean).length, 1, 'one JSON line')
    assert.deepEqual(r.out, want, gate)
  }
  const [full, stand] = py([{ op: 'exposure', gate: P19_10 }, { op: 'standing', gate: P19_10 }])
  assert.deepEqual(full, { usd: null, why: 'per/each outside the cap clause: each, each' }, 'the full reading still names its two each')
  assert.deepEqual(stand, { usd: '24', why: '', capOnly: 'per/each outside the cap clause: each, each' }, 'the standing reading carries it as capOnly')
})

// p37-4: the CLI prints standing_exposure()'s {usd, why}, never capOnly.
test('ADR 0038: `exposure -` agrees with standing_exposure() and holds under LC_ALL=C (the em dash still prices)', () => {
  const gates = [PROBE, FAST, FAST_COUNTED, 'spend: image API — cap US$40, plus US$30 for the fallback',
    'credential: the Replicate API key', 'spend: fast mode — cap US$12.50 per month', 'spend: x — cap 5 USD and cap 3 USD',
    STEER, P19_10, 'spend: probe — cap 1 USD x 3']
  const want = py(gates.map((gate) => ({ op: 'standing', gate })))
  gates.forEach((gate, i) => {
    for (const env of [{}, { LC_ALL: 'C', LANG: 'C' }]) {
      const r = cli(gate, undefined, env)
      assert.equal(r.status, 0, r.stderr)
      assert.deepEqual([num(r.out.usd), r.out.why], [num(want[i].usd), want[i].why], `${gate} ${JSON.stringify(env)}`)
    }
  })
  assert.deepEqual(cli(STEER + '\n').out, { usd: '1', why: '' }, 'the verbatim Steer gate prints exactly its cap, no capOnly key')
  const c = cli(P19_10_ONE_LINE + '\r\n', undefined, { LC_ALL: 'C', LANG: 'C' })
  assert.deepEqual(c.out, { usd: '24', why: '' }, 'a CRLF line under LC_ALL=C')
  // p48-4: a `€` with no number beside it is no amount, so the widest reading prices the bare gate at 2; `, soft` keeps
  // it asking, its why the cap-only reading's
  assert.equal(cli('spend: x — cap 2 USD for the €-priced tier, soft').stdout.includes('€'), true, 'the why is UTF-8, never ASCII-escaped')
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

// ---- p37-4: unpriceable never means asked (ADR 0034's 2026-11-05 amendment) -------------------------------------------
// The standing reading prices a gate the full reading refuses from its one readable cap: rules 1-4 and 6 as ever, rule 5
// against the cap-only leftover list, outside the clause only plurals (7(ii)) and per-unit words (7(ix)), the value
// rule 9's sum. Each pin below names the reading it holds.

test('p37-4 the verbatim Steer gate: null in full on the bare 4, US$1 standing, covered at 200, the CLI exactly {usd: "1", why: ""}', () => {
  const [full, stand, cov] = py([{ op: 'exposure', gate: STEER }, { op: 'standing', gate: STEER }, { op: 'covered', gate: STEER, limit: 200 }])
  assert.deepEqual(full, { usd: null, why: 'a number outside the cap clause: 4' }, '"per the task note" is no rate; the bare 4 of "Haiku 4.5" is')
  assert.deepEqual(stand, { usd: '1', why: '', capOnly: 'a number outside the cap clause: 4' })
  assert.deepEqual([cov.covered, cov.usd], [true, '1'])
  const r = cli(STEER + '\n')
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(r.out, { usd: '1', why: '' }, 'no capOnly key: the plan judge reads {usd, why} only')
  assert.equal(r.stdout, '{"usd": "1", "why": ""}\n')
})

test('p37-4 monotone: a USD amount outside the clause is summed in both readings, and a malformed one asks in both', () => {
  const [a, b, c, d] = py([{ op: 'standing', gate: 'spend: probe, US$500 — cap 1 USD' },
    { op: 'standing', gate: 'spend: probe, US$500 per run — cap 1 USD' },
    { op: 'exposure', gate: 'spend: probe, US$5k per run — cap 1 USD' }, { op: 'standing', gate: 'spend: probe, US$5k per run — cap 1 USD' }])
  assert.deepEqual(a, { usd: '501', why: '', capOnly: '' }, 'priced in full')
  assert.deepEqual(b, { usd: '501', why: '', capOnly: 'per/each outside the cap clause: per' }, 'cap-only, never below the full sum')
  assert.deepEqual(c, { usd: null, why: 'malformed amount: US$5k' })
  assert.deepEqual(d, { usd: null, why: 'malformed amount: US$5k', capOnly: '' })
})

test('p37-4 Do 2: per/each is a rate only before a unit; prose per is none; 7(ix) holds the per-Login words', () => {
  const prose = ['spend: image batch per the brief — cap US$5', 'spend: x per the task note — cap US$5', 'spend: x per ADR 0038 — cap US$5']
  const proseGot = py(prose.map((gate) => ({ op: 'exposure', gate })))
  // `per ADR 0038` drops its per but keeps its bare number, which only the full reading asks
  assert.deepEqual(proseGot, [{ usd: '5', why: '' }, { usd: '5', why: '' }, { usd: null, why: 'a number outside the cap clause: 0038' }])
  const rates = [['per run', 'per'], ['per-run', 'per'], ['per-call', 'per'], ['per-image', 'per'], ['per 1,000 tokens', 'per'],
    ['Per day', 'Per'], ['each night', 'each'], ['each of the runs', 'each'], ['one call each', 'each'], ['each --max-cost-usd 4', 'each'],
    ['per/run', 'per'], ['per 1k', 'per'], ['3 each, then', 'each']]
  const rateGot = py(rates.map(([w]) => ({ op: 'exposure', gate: `spend: x ${w} — cap US$5` })))
  rates.forEach(([w, word], i) => assert.equal(rateGot[i].why.startsWith(`per/each outside the cap clause: ${word}`), true, `${w}: ${rateGot[i].why}`))
  const [five] = py([{ op: 'exposure', gate: 'spend: x — cap US$5, US$5 each for the runs' }])
  assert.deepEqual(five, { usd: null, why: 'per/each outside the cap clause: each' }, '`US$5 each`: straight after a digit')
  for (const w of ['per-Login', 'each Login']) {
    assert.deepEqual(exposure(`spend: x ${w} — cap US$5`), { usd: null, why: `per/each outside the cap clause: ${w.slice(0, 3) === 'per' ? 'per' : 'each'}` }, w)
  }
  // 7(ix): a per-unit word no earlier rule names, in both readings
  for (const w of ['per the dummy Login', 'each new Login']) {
    const g = `spend: x ${w} — cap 5 USD`
    const [f, st] = py([{ op: 'exposure', gate: g }, { op: 'standing', gate: g }])
    assert.deepEqual(f, { usd: null, why: 'per-Login cap with no Login count' }, `${w}: full`)
    assert.deepEqual(st, { usd: null, why: 'per-Login cap with no Login count', capOnly: '' }, `${w}: standing`)
  }
  assert.deepEqual([exposure(PROBE), exposure(FAST_COUNTED)], [{ usd: '9', why: '' }, { usd: '150', why: '' }], 'PROBE and FAST_COUNTED unchanged')
})

// Review round 1 (p37-4): RATE_RE is rule 7(i)'s alone. On the cap itself any per/each/every asks in both readings,
// whatever follows it, as before p37-4: a rate on the cap never prices as a bare total. `_clause()` reads a substring,
// so RATE_RE's `(?<=\d\s)each` could never see the cap's digit there.
test('p37-4 a per/each/every on the cap itself asks in both readings, whatever follows; prose per outside the clause still prices', () => {
  // [gate, its clause]: the review's shapes, each priced as its bare cap before this pin
  const gates = [['spend: egress — cap US$0.10 per GB', 'per GB'], ['spend: x — cap US$5 per developer', 'per developer'],
    ['spend: x — cap US$5 per org', 'per org'], ['spend: x — cap US$2 per sample', 'per sample'],
    ['spend: probes — cap US$5 each for the images', 'each for the images'],
    ['spend: probes — cap US$5 each across the models', 'each across the models'],
    // p48-4 moved `cap US$2 per developer for 3 developers` to its own block: the widest reading counts it, 6
    ['spend: x — cap US$5 per generated image', 'per generated image']]
  const got = py(gates.flatMap(([gate]) => [{ op: 'exposure', gate }, { op: 'standing', gate }]))
  gates.forEach(([gate, c], i) => {
    assert.deepEqual(got[2 * i], { usd: null, why: `unrecognised clause: ${c}` }, `${gate}: full`)
    assert.deepEqual(got[2 * i + 1], { usd: null, why: `unrecognised clause: ${c}`, capOnly: '' }, `${gate}: standing`)
  })
  assert.equal(covered('spend: egress — cap US$0.10 per GB', 200).covered, false, 'a per-GB cap is never covered as a 10-cent total')
  // controls: the prose `per` outside the clause prices in both readings, and so does a month on the cap
  const [prose, proseSt, month] = py([{ op: 'exposure', gate: 'spend: x per the task note — cap US$5' },
    { op: 'standing', gate: 'spend: x per the task note — cap US$5' }, { op: 'standing', gate: 'spend: x — cap US$5 per month' }])
  assert.deepEqual([prose, proseSt, month], [{ usd: '5', why: '' }, { usd: '5', why: '', capOnly: '' }, { usd: '5', why: '', capOnly: '' }])
})

// ADR 0034's 2026-11-05 amendment, residuals (iii) and (iv): outside the clause a per/each rate RATE_RE cannot see (its
// unit not straight after it, or off RATE_UNITS) reads x1 in the full reading, the value the cap-only reading gives
// anyway; the same words on the cap ask (the test above).
test('accepted residual (ADR 0034 amendment iii, iv): outside the clause `per generated image` and `each such call` read x1', () => {
  const gates = ['spend: image API per generated image — cap US$5', 'spend: image API, each such call — cap US$5']
  const got = py(gates.flatMap((gate) => [{ op: 'exposure', gate }, { op: 'standing', gate }]))
  gates.forEach((gate, i) => {
    assert.deepEqual(got[2 * i], { usd: '5', why: '' }, `${gate}: full`)
    assert.deepEqual(got[2 * i + 1], { usd: '5', why: '', capOnly: '' }, `${gate}: standing`)
  })
})

test('p37-4 the cap-only clause: prose beside the cap signs at it; a rate, multiplier, %, plus, widening word, currency or per-unit noun asks', () => {
  // signs at the cap, capOnly the full reading's why (the last three are accepted residuals: a count on the cap with no
  // rate word reads as the cap, the implementer's ceiling)
  const sign = ['(Haiku 4.5)', 'for the 3 probes', 'for 3 runs', 'for 10k tokens', 'for both probes']
  const signGot = py(sign.map((c) => ({ op: 'standing', gate: `spend: probe — cap 1 USD ${c}` })))
  sign.forEach((c, i) => assert.deepEqual(signGot[i], { usd: '1', why: '', capOnly: `unrecognised clause: ${c}` }, c))
  // still asks, with the full reading's why (p48-4 moved `x 3`, `3x`, `three times`, `for the dummy Login` and `(US$15
  // with retries)` to its own block: the widest reading prices them)
  const ask = ['plus 20%', 'plus 30 more', '+ 2', 'per big run', '/1k tokens', 'a day', 'for 3 Logins',
    'soft', 'before tax', 'each', 'per day', 'every run', 'daily', 'per new Login']
  const askGot = py(ask.flatMap((c) => [{ op: 'exposure', gate: `spend: probe — cap US$1 ${c}` }, { op: 'standing', gate: `spend: probe — cap US$1 ${c}` }]))
  ask.forEach((c, i) => {
    assert.deepEqual(askGot[2 * i], { usd: null, why: `unrecognised clause: ${c}` }, `${c}: full`)
    assert.deepEqual(askGot[2 * i + 1], { usd: null, why: `unrecognised clause: ${c}`, capOnly: '' }, `${c}: standing`)
  })
  const [perLogin, counted] = py([{ op: 'standing', gate: 'spend: x — cap US$1 per Login' }, { op: 'standing', gate: 'spend: x — cap US$1 per Login across 3 Logins' }])
  assert.deepEqual(perLogin, { usd: null, why: 'per-Login cap with no Login count', capOnly: '' })
  assert.deepEqual(counted, { usd: '3', why: '', capOnly: '' }, 'the per-unit count still multiplies')
})

test('p37-4 cap-only outside the clause: rules 1-4 and 6, plurals and per-unit words ask; other prose reads as the cap (accepted residuals)', () => {
  // p48-4 moved `cap 1 USD and cap 2 USD`, `cap 30 AUD`, `cap US$1k`, `cap US$40 to US$60`, `A$500 of credits` and
  // `probe in dollars` to its own block: the widest reading prices them
  const ask = [['credential: the dummy Login — cap 1 USD', 'not a spend gate'], ['spend: probe — no cap', 'no cap clause'],
    ['spend: fast mode on the Logins — cap 1 USD', 'plural unit outside the cap clause: Logins'],
    ['spend: fast mode — cap 50 USD, per Login per month', 'per-Login cap with no Login count'],
    ['spend: fast mode at US$2 per-Login — cap 5 USD', 'per-Login cap with no Login count'],
    ['spend: fast mode on every Login — cap 5 USD', 'per-Login cap with no Login count'],
    ['spend: fast mode on a Login — cap 5 USD', 'per-Login cap with no Login count'],
    ['spend: fast mode, US$2/Login — cap 5 USD', 'per-Login cap with no Login count'],
    [FAST, 'per-Login cap with no Login count']]
  const askGot = py(ask.map(([gate]) => ({ op: 'standing', gate })))
  ask.forEach(([gate, why], i) => assert.deepEqual(askGot[i], { usd: null, why, capOnly: '' }, gate))
  const waived = [['spend: soft probe — cap 1 USD', 'widening word outside the cap clause: soft'], ['spend: 3 runs — cap 1 USD', 'a number outside the cap clause: 3'],
    ['spend: probe, plus 20% — cap 1 USD', 'percentage outside the cap clause: %'], ['spend: probe ×3 — cap 1 USD', 'multiplier outside the cap clause: ×'],
    ['spend: CI each night — cap 1 USD', 'per/each outside the cap clause: each']]
  const waivedGot = py(waived.map(([gate]) => ({ op: 'standing', gate })))
  waived.forEach(([gate, why], i) => assert.deepEqual(waivedGot[i], { usd: '1', why: '', capOnly: why }, gate))
  assert.deepEqual(standing('spend: CI on every push — cap 1 USD'), { usd: '1', why: '', capOnly: '' }, 'every push: x1 in full already')
  assert.equal(num(standing(PROBE).usd), 9, "control: p18-7's `every signed-in Claude Login` still passes in full")
})

// ---- p48-4: a spend plainly under the limit never asks (ADR 0034's 2026-11-13 amendment) ------------------------------
// A gate neither earlier reading prices is read at its widest: every amount its line names (a range at its top, a rate
// times its stated most count, a split summed, another currency at its ceiling rate), so long as one amount comes
// straight after a cap word. `widest` carries the cap-only reading's why. The p37-4 pins above that still read null
// (per developer, each for the images, per day, every run, daily, a day, /1k tokens, plus 30 more, + 2, US$5k per run,
// …) now run through all three readings.

// [gate, usd at its widest, the cap-only reading's why]
const P48_RULING = [
  ['spend: x — cap 10 USD for the runs; cap 5 USD for the judge', '15', '2 cap clauses'],
  ['spend: x — cap US$10 plus US$5 for the judge', '15', 'unrecognised clause: plus US$5 for the judge'],
  ['spend: probe — cap US$1 (US$15 with retries)', '16', 'unrecognised clause: (US$15 with retries)'],
  ['spend: x — cap US$40 to US$60', '60', 'range: US$40 to US$60'],
  ['spend: x — cap 10-15 USD', '15', 'no cap clause'],
  ['spend: x — cap US$0.50 per call, at most 40 calls', '20', 'unrecognised clause: per call'],
  ['spend: x — cap 2 USD per run for 5 runs', '10', 'unrecognised clause: per run for 5 runs'],
  ['spend: x — cap 2 USD per run for five runs', '10', 'unrecognised clause: per run for five runs'],
  ['spend: x — cap US$1 each, at most 5 images', '5', 'unrecognised clause: each'],
  ['spend: x — cap US$1 per call, at most 10 calls; cap US$2 per run, at most 5 runs', '20', '2 cap clauses'],
  ['spend: x — cap US$0.50 per call, 40-50 calls', '25', 'unrecognised clause: per call'],
  ['spend: gpt-4.1 calls — cap 10 USD; cap US$0.01 per call, at most 500 calls', '15', '2 cap clauses'],
  ['spend: probe — cap 1 USD x 3', '3', 'unrecognised clause: x 3'],
  ['spend: probe — cap US$1 three times', '3', 'unrecognised clause: three times'],
  ['spend: x — cap 10 USD; cap 5 USD, run twice', '30', '2 cap clauses'],
  ['spend: x — cap US$2 per developer for 3 developers', '6', 'unrecognised clause: per developer for 3 developers'],
  ['spend: x — up to US$5', '5', 'no cap clause'],
  ['spend: x — max A$30', '35.10', 'no cap clause'],
  ['spend: x — budget of €20', '33.80', 'no cap clause'],
  ['spend: x — limit: US$10', '10', 'no cap clause'],
]

test('p48-4 the ruling\'s wordings price at their widest, `widest` naming the cap-only refusal, and are covered at 200', () => {
  const got = py(P48_RULING.flatMap(([gate]) => [{ op: 'standing', gate }, { op: 'covered', gate, limit: 200 }]))
  P48_RULING.forEach(([gate, usd, widest], i) => {
    assert.deepEqual(got[2 * i], { usd, why: '', capOnly: '', widest }, gate)
    assert.deepEqual([got[2 * i + 1].covered, got[2 * i + 1].usd], [true, usd], `${gate}: covered at 200`)
  })
})

test('p48-4 the ceiling table, and another currency read at its ceiling rate (a word at the widest currency it names)', () => {
  const cur = [['spend: x — cap 30 AUD', '35.10'], ['spend: x — cap A$30', '35.10'], ['spend: x — cap €20', '33.80'],
    ['spend: x — cap £10', '22.30'], ['spend: x — cap 50 dollars', '58.50'], ['spend: x — cap 1000 JPY', '14'],
    ['spend: x — cap 50 cents', '0.85']]
  const [table, ...got] = py([{ op: 'ceiling' }, ...cur.map(([gate]) => ({ op: 'standing', gate }))])
  assert.deepEqual(table, { USD: '1', AUD: '1.17', NZD: '0.93', CAD: '1.16', EUR: '1.69', GBP: '2.23', JPY: '0.0140' })
  cur.forEach(([gate, usd], i) => assert.deepEqual(got[i], { usd, why: '', capOnly: '', widest: 'no cap clause' }, gate))
})

test('p48-4 the CLI prints the widest amount with an empty why, never the widest key', () => {
  const r = cli('spend: x — cap 30 AUD\n')
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.stdout, '{"usd": "35.10", "why": ""}\n')
})

// Round 2: WIDENING gains `±` and the uncapped words, so inside the cap clause both earlier readings ask on them (each
// signed at 10 before p48-4). Control: the widening test's `cap US$50; soft, no hard cap` stays covered at 50, unedited
// (outside the clause the cap-only reading still waives them, p37-4's residual).
test('p48-4 WIDENING gains `±` and the uncapped words: on the cap they ask in both earlier readings', () => {
  const cases = [['spend: x — cap US$10 ± 2', 'unrecognised clause: ± 2'],
    ['spend: x — cap US$10 (no limit on retries)', 'unrecognised clause: (no limit on retries)'],
    ['spend: x — cap US$10 (unlimited retries)', 'unrecognised clause: (unlimited retries)']]
  const got = py(cases.flatMap(([gate]) => [{ op: 'exposure', gate }, { op: 'standing', gate }, { op: 'covered', gate, limit: 200 }]))
  cases.forEach(([gate, why], i) => {
    assert.deepEqual(got[3 * i], { usd: null, why }, `${gate}: full`)
    assert.deepEqual(got[3 * i + 1], { usd: null, why, capOnly: '' }, `${gate}: standing`)
    assert.equal(got[3 * i + 2].covered, false, `${gate}: never covered`)
  })
})

test('p48-4 still asks: each widest step names its why, and the standing reading keeps the cap-only why with no widest key', () => {
  const steps = [
    ['credential: x — cap 1 USD', 'not a spend gate'],
    ['spend: x — cap US$5 per Login across 3 Logins; cap US$1 for the judge', 'a per-unit word: per Login'],
    ['spend: x — cap US$5 plus 20%', 'a percentage: %'],
    ['spend: x — cap US$50 soft', 'a widening word: soft'],
    ['spend: x — US$10 so far, no cap', 'a widening word: no cap'],
    ['spend: x — cap TBD; last run cost US$10', 'a widening word: cap TBD'],
    ['spend: OpenAI usage — no limit set; last month US$12', 'a widening word: no limit'],
    ['spend: x — not capped; US$10 so far', 'a widening word: not capped'],
    ['spend: x — without a cap; US$10 so far', 'a widening word: without a cap'],
    ['spend: x — cap: none; US$10 so far', 'a widening word: cap: none'],
    ['spend: probe — no cap', 'a widening word: no cap'],
    ['spend: x — cap US$10 ± 2', 'a widening word: ±'],
    ['spend: x — cap 10 USD; cap 5 USD, typically', 'a widening word: typically'],
    ['spend: x — cap 30 AUD, unlimited retries', 'a widening word: unlimited'],
    ['spend: x — cap US$5; cap US$1 plus 30 more', 'a widening word: plus'],
    ['spend: x — cap fifty USD', 'an amount in words: fifty USD'],
    ['spend: x — cap 5000 minor units', 'minor units: 5000 minor units'],
    ['spend: x — cap ¥1000', 'an unknown or ambiguous currency: ¥'],
    ['spend: x — cap HK$5', 'an unknown or ambiguous currency: HK$'],
    ['spend: x — cap ~US$5', 'an approximate amount: ~'],
    ['spend: x — cap c. US$10', 'an approximate amount: c.'],
    ['spend: x — cap est. US$10', 'an approximate amount: est.'],
    ['spend: x — cap ≈US$10', 'an approximate amount: ≈'],
    ['spend: x — cap US$5x', 'malformed amount: US$5x'],
    ['spend: some API', 'it names no amount'],
    ['spend: x — US$10 for the runs', 'it states no cap'],
    ['spend: rate-limit probe — US$10', 'it states no cap'],
    ['spend: x — run `--max-cost-usd 4`; US$10 so far', 'it states no cap'],
    ['spend: x — the cap is US$10', 'it states no cap'], // a named over-ask: a word between the cap and its amount
    ['spend: x — cap US$1 before discounts', 'a widening word: before'],
    ['spend: x — cap US$5 per 1k tokens', 'a rate per a count: per 1'],
    ['spend: x — cap US$0.50 per call, at most 40 calls per day', 'a rate beyond the amounts: per day'],
    ['spend: x — cap US$1 per call, at most 5 calls, all models', 'a count in words: all'],
    ['spend: x — cap US$1 per run, up to 10 runs across 3 models', 'a count in another unit: 3 models'],
    ['spend: x — cap US$0.50 per call, at most 40 runs', 'a count in another unit: 40 runs'],
    ['spend: Haiku 4.5 — cap US$0.01 per call, at most 500 calls', 'a number the rate cannot place: 4.5'],
    ['spend: x — cap US$0.50 per call, at most 40', 'a number the rate cannot place: 40'],
    ['spend: x — cap US$0.10 per GB', 'a rate with no stated most: US$0.10 per GB'],
  ]
  const got = py(steps.flatMap(([gate]) => [{ op: 'widest', gate }, { op: 'standing', gate }]))
  steps.forEach(([gate, why], i) => {
    assert.deepEqual(got[2 * i], { usd: null, why }, `${gate}: widest`)
    const st = got[2 * i + 1]
    assert.deepEqual([st.usd, 'widest' in st, st.capOnly], [null, false, ''], `${gate}: standing null, no widest key`)
  })
  // the standing reading keeps the cap-only reading's why, as before p48-4
  assert.deepEqual(got[2 * 10 + 1], { usd: null, why: 'no cap clause', capOnly: '' }, 'spend: probe — no cap')
  assert.deepEqual(got[2 * 5 + 1], { usd: null, why: 'no cap clause', capOnly: '' }, 'cap TBD')
})

test('p48-4 over the line, now priced: A$500 of credits reads 586 and is not covered at 200', () => {
  const gate = 'spend: probe, A$500 of credits — cap 1 USD'
  const [st, cov] = py([{ op: 'standing', gate }, { op: 'covered', gate, limit: 200 }])
  assert.deepEqual(st, { usd: '586', why: '', capOnly: '', widest: 'non-USD or ambiguous currency: A$5' })
  assert.deepEqual([cov.covered, cov.usd], [false, '586'])
})

// The Verify: the spend gates under US$200 of thread-skill-rollout-2026-10-26 (p27-5's two, from its archived note's
// `## Approved gates`) and of the 2026-11-03 smart-slider rollout, verbatim with their ` (approved …)` suffixes
// stripped. They already sign before p48-4 (a regression pin); Cartesia's free-tier gate, the vault's own null, still
// asks.
const P27_5 = 'spend: scored `claude plugin eval` runs through `make evals` on Opus model and judge with transcripts kept, one invocation per case: `make evals EVAL_ARGS="--case <name> --runs 3 --concurrency 3 --max-cost-usd 5 --trust-plugin --keep-temp --output-dir <scratch>/invN --report <scratch>/invN/report.html --json <scratch>/invN/run.json"` for handoff-ends-with-next, handoff-router-dispatch-skips-next and handoff-manual-dry-run, the same with `--runs 1` for handoff-fork-now, then at most one reserve re-run of one case after a B1/B2 fix — cap 15 USD'
const P27_5_RESCORE = 'spend: one scored `make evals` invocation of handoff-router-dispatch-skips-next at --runs 3 (Opus model and judge, --trust-plugin --keep-temp, scratch output) on the branch head, to score its amended grader — cap 3 USD'
const SS_COST = 'spend: AWS Cost Explorer API requests — cap 5 USD'
const SS_SPEED = 'spend: AWS CloudWatch Logs Insights queries and S3 reads for the caught-upload corpus and end-to-end timings — cap 10 USD'
const CARTESIA = 'spend: Cartesia API usage (adapter live verification: one voices listing + one short timestamp-granularity synth call; then bake-off auditions) — cap: free tier only, $0 — no subscription or paid plan; if free-tier credits cannot cover the felt test, stop and report rather than upgrade.'

test('p48-4 the Verify: the 10-26 and 11-03 spend gates sign at 20, 3, 5 and 10 with no widest key; Cartesia still asks', () => {
  const gates = [[P27_5, '20'], [P27_5_RESCORE, '3'], [SS_COST, '5'], [SS_SPEED, '10']]
  const got = py([...gates.flatMap(([gate]) => [{ op: 'standing', gate }, { op: 'covered', gate, limit: 200 }]), { op: 'standing', gate: CARTESIA }])
  gates.forEach(([gate, usd], i) => {
    assert.deepEqual([got[2 * i].usd, 'widest' in got[2 * i]], [usd, false], gate)
    assert.equal(got[2 * i + 1].covered, true, `${gate}: covered at 200`)
  })
  assert.deepEqual(got[8], { usd: null, why: 'no cap clause', capOnly: '' }, 'Cartesia: `+` with no amount after it')
})

test('p48-4 a per-unit gate is the full reading\'s alone', () => {
  const [counted, split, aud] = py([{ op: 'standing', gate: 'spend: x — cap US$5 per Login across 3 Logins' },
    { op: 'standing', gate: 'spend: x — cap US$5 per Login across 3 Logins; cap US$1 for the judge' },
    { op: 'standing', gate: 'spend: x — cap 30 AUD per Login across 2 Logins' }])
  assert.deepEqual(counted, { usd: '15', why: '', capOnly: '' })
  assert.deepEqual(split, { usd: null, why: '2 cap clauses', capOnly: '' })
  assert.deepEqual(aud, { usd: null, why: 'no cap clause', capOnly: '' })
})

test('p48-4 the pins the ruling flips, and the edges: bound words, ranges, magnitudes, months and several rates', () => {
  // moved from the p37-4 tests above (the rest of their flips are rows of P48_RULING, the currency test and A$500's)
  const flips = [['spend: probe — cap US$1 3x', '3', 'unrecognised clause: 3x'],
    ['spend: probe — cap US$1 for the dummy Login', '1', 'unrecognised clause: for the dummy Login'],
    ['spend: x — cap 1 USD and cap 2 USD', '3', '2 cap clauses'],
    ['spend: x — cap US$1k', '1000', 'malformed amount: US$1k'],
    ['spend: probe in dollars — cap 1 USD', '1', 'non-USD or ambiguous currency: dollars']]
  const edges = [
    ['spend: x — cap US$5 up to US$10', '15'], // two governed amounts
    ['spend: x — budget: €20', '33.80'], ['spend: x — limited to US$10', '10'], ['spend: x — ceiling of US$5', '5'],
    ['spend: x — no more than US$5', '5'], // a bound word, never a negation
    ['spend: x — capped at most US$5', '5'], // overlapping bound words
    ['spend: x — max US$5 — 10 USD', '15'], // a spaced em dash is the clause separator: two amounts
    ['spend: x — max US$10–5', '10'], // a descending range reads its max
    ['spend: x — max €10 to US$15', '25.35'], // a currency on either end, the higher ceiling
    ['spend: x — max US$5 or US$10', '10'], ['spend: x — max 5k USD', '5000'],
    ['spend: x — max US$20/month for 3 months', '20'], // a month counts x1, as in the full reading
    ['spend: x — max US$1 per call, at most 5 calls; max US$2 per run, at most 3 runs', '11'], // several rates sum
    ['spend: x — cap US$10; no capacity issues', '10'], // `no capacity` is no negation
    ['spend: x — cap (US$10)', null], ['spend: x — hard-cap US$10', null], // over-asks: it states no cap
    ['spend: x — max US$1 per run, at most 3 runs, --runs 3', null], // a stray number on a rate line
    ['spend: x — max US$5-a-day', null], // a hyphenated rate is still a rate beyond the amounts
    ['spend: x — cap US$5 plus fees', null], ['spend: x — cap US$5 + one short', null],
  ]
  const got = py([...flips.map(([gate]) => ({ op: 'standing', gate })), ...edges.map(([gate]) => ({ op: 'widest', gate }))])
  flips.forEach(([gate, usd, widest], i) => assert.deepEqual(got[i], { usd, why: '', capOnly: '', widest }, gate))
  edges.forEach(([gate, usd], i) => assert.equal(got[flips.length + i].usd, usd, `${gate}: ${got[flips.length + i].why}`))
})

test('p48-4 accepted residuals r1, r2 and r5, and the named over-asks', () => {
  const cases = [
    ['spend: x — cap 30 AUD for 3 runs', '35.10'], // r1: a count beside a total, on a line with no rate, reads once
    ['spend: x — cap 10 USD; cap 5 USD; 1000 rupees for the API', '15'], // r2: an unknown currency word is not read…
    ['spend: x — cap US$1 per call, at most 5 calls; 1000 rupees', null], // …but on a rate line it is a count in another unit
    ['spend: x — cap $10; cap $5', '15'], // r5: a bare $ is USD
    ['spend: x — cap 10 USD; cap 5 USD for the judge, per the brief', null], // over-ask: prose per
    ['spend: soft launch probe — cap 10 USD; cap 5 USD', null], // over-ask: a widening word in the description
  ]
  const got = py(cases.map(([gate]) => ({ op: 'standing', gate })))
  cases.forEach(([gate, usd], i) => assert.equal(got[i].usd, usd, `${gate}: ${got[i].why}`))
})

// Round 2 of the PR's review: four under-reads, each gate's true widest reading over the line (or off the table), so
// each is pinned not covered at 200. `[gate, usd at its widest | null, why]`, read by the widest reading alone.
function widestAt200(cases) {
  const got = py(cases.flatMap(([gate]) => [{ op: 'widest', gate }, { op: 'covered', gate, limit: 200 }]))
  cases.forEach(([gate, usd, why], i) => {
    assert.deepEqual(got[2 * i], { usd, why: why || '' }, gate)
    assert.equal(got[2 * i + 1].covered, usd !== null && Number(usd) <= 200, `${gate}: covered at 200 iff its widest is`)
  })
}

test('p48-4 W5c(iv): a unit counted more than once sums its counts, each range at its top; two multipliers on a rate ask', () => {
  widestAt200([
    ['spend: API, cap US$1 per call, at most 150 calls; and 150 calls for the retry pass', '300'], // read 150 before
    ['spend: x — cap US$1 each, at most 5 images, 3-4 images for the retry', '9'],
    ['spend: x — cap US$0.50 per call, 40-50 calls', '25'], // control: one count, its range at its top
    ['spend: x — cap US$5 each, x3, x4', null, 'more than one multiplier on a rate: x3, x4'], // they may compound
    ['spend: x — cap US$5 each, x3', '15'], // control: one multiplier counts the each
  ])
  assert.deepEqual(standing('spend: API, cap US$1 per call, at most 150 calls; and 150 calls for the retry pass'),
    { usd: '300', why: '', capOnly: '', widest: 'unrecognised clause: per call' })
})

test('p48-4 W5/W6: a multiplier range reads at its top, after the amount or unattached', () => {
  widestAt200([
    ['spend: API, max US$60, run 3-4 times', '240'], // read 60 before: `_NUM_START` refused the 4 after `-`
    ['spend: API, max US$10, run 2-3x', '30'], // read 10
    ['spend: API, max US$10, x3-4', '40'], // read 30
    ['spend: API, max US$10, ×3–4', '40'],
    ['spend: API, max US$10, run two or three times', '30'],
    ['spend: API, max US$10, run 3 to 4 times', '40'], // control: read so before
    ['spend: API, max US$10 x 3 to 4', '40'], // straight after the amount (Q_MULT_RE), read 30 before
    ['spend: API, max US$10 2-3x', '30'],
    ['spend: x — cap US$5 each, run 3-4 times', '20'], // on a rate line, the each's count
  ])
})

test('p48-4 W3: a dollar marker after its number is an amount (r5: a bare `$` is USD), and rule 6 asks on it', () => {
  widestAt200([
    ['spend: API, max US$10 and 500$ for the retries', '510'], // read 10 before
    ['spend: API, max US$10 and 500 US$ for the retries', '510'],
    ['spend: API, max US$10 and 500 A$ for the retries', '595'],
    ['spend: API, max US$10 and 500€ for the retries', '855'], // control: a trailing € read so before
    ['spend: x — max US$10 for 3 $5 runs', '15'], // a `$` before a number is that number's prefix (r1 waives the 3)
    ['spend: x — max US$10 (`echo 5 $HOME`)', '10'], // a `$` before a letter is a shell variable, no amount
  ])
  // the cap-only reading read rule 2's tokens alone, so `cap US$10 and 500$` signed at 10: rule 6 now asks on it, and
  // the widest reading prices it
  const gate = 'spend: API, cap US$10 and 500$ for the retries'
  const [full, st, cov] = py([{ op: 'exposure', gate }, { op: 'standing', gate }, { op: 'covered', gate, limit: 200 }])
  assert.deepEqual(full, { usd: null, why: 'non-USD or ambiguous currency: 500$' })
  assert.deepEqual(st, { usd: '510', why: '', capOnly: '', widest: 'non-USD or ambiguous currency: 500$' })
  assert.equal(cov.covered, false)
  assert.equal(standing('spend: API, cap US$10 and 500 A$ for the retries').usd, '595')
})

test('p48-4 W2(f) and rule 6: a number beside an ISO 4217 code off the table asks in every reading; a word never', () => {
  widestAt200([
    ['spend: API, max US$10 and 50 KWD', null, 'an unknown or ambiguous currency: KWD'], // about US$163: read 10 before
    ['spend: API, max US$10 and CHF 500', null, 'an unknown or ambiguous currency: CHF'],
    ['spend: API, max US$10 and 50KWD', null, 'an unknown or ambiguous currency: KWD'],
    ['spend: x — max US$10 on a PHP 8 runtime', null, 'an unknown or ambiguous currency: PHP'], // a named over-ask
    ['spend: API, max US$10 (GPT 4)', '10'], // GPT is no ISO code
    ['spend: API, max US$10, try 3 times', '30'], // upper case only: `try` is a word, never TRY
    ['spend: API, max US$10 and 50 kwd', '10'], // r2: a code in lower case is a word, not read
  ])
  const cases = [['spend: API, cap US$10 and 50 KWD', 'non-USD or ambiguous currency: KWD'],
    ['spend: API, cap US$10 and CHF 500', 'non-USD or ambiguous currency: CHF']]
  const got = py(cases.flatMap(([gate]) => [{ op: 'exposure', gate }, { op: 'standing', gate }]))
  cases.forEach(([gate, why], i) => {
    assert.deepEqual(got[2 * i], { usd: null, why }, `${gate}: full`)
    assert.deepEqual(got[2 * i + 1], { usd: null, why, capOnly: '' }, `${gate}: the cap-only reading signed it at 10 before`)
  })
})

// Round 3, the PR's second review: one range joiner for amounts and counts (an unspaced em dash included), one N for a
// multiplier and a noun count (thousands grouped by commas), and a marked range whose far end repeats its marker. Each
// read below its widest before; `3x-4x` names US$240, over the line.
test('p48-4 round 3: a repeated-marker range, a grouped N and an unspaced em dash read whole, at the top', () => {
  widestAt200([
    ['spend: API, max US$60, 3x-4x', '240'], // read 180 before: covered at 200
    ['spend: API, max US$60, run 3x-4x', '240'],
    ['spend: API, max US$60 3x-4x', '240'], // straight after the amount
    ['spend: API, max US$10, 3x–4x', '40'], // read 120 before: two multipliers
    ['spend: API, max US$10, 3x—4x', '40'],
    ['spend: API, max US$10, x3-x4', '40'], // read 120 before
    ['spend: API, max US$10, ×3–×4', '40'],
    ['spend: API, max US$10, 3×–4×', '40'],
    ['spend: API, max US$0.25 x 1,000', '250'], // read 0.25 before: `x 1`, the WE passing on the comma
    ['spend: API, max US$0.25 × 1,000 renders', '250'],
    ['spend: API, max US$0.25, run 1,000 times', '250'],
    ['spend: API, max US$60, x3—4', '240'], // read 180 before: an unspaced em dash joins a count as it joins an amount
    ['spend: x — cap US$1 per call, at most 40—50 calls', '50'], // and a noun count's
    ['spend: API, max US$10, run thrice', '30'], // a multiplier word, read as `triple` is
  ])
})

// W5e, the multiplier backstop: a multiplier marker left once the phrases are read, or a number touching a read one,
// asks; it never reads the multiplier at its bottom.
test('p48-4 W5e: a multiplier the grammar reads only in part asks, its why naming it', () => {
  const why = (m) => `a multiplier the reading cannot place: ${m}`
  widestAt200([
    ['spend: API, max US$60, 3x-4', null, why('3x-4')], // read 180 before
    ['spend: API, max US$60, 3x or 4', null, why('3x or 4')], // read 180
    ['spend: API, max US$10 x 1.5', null, why('x 1.5')], // read 10: a decimal multiplier asks (a named over-ask)
    ['spend: API, max US$10, 1.5x', null, why('1.5x')],
    ['spend: API, max US$10, x 1,0000', null, why('x 1,0000')],
    ['spend: API, max US$10, 3 × 4 runs', null, why('3 × 4')], // read 30
    ['spend: API, max US$10, 4 x3', null, why('4 x3')],
    ['spend: API, max US$10, x three hundred', null, why('x three hundred')], // read 30
    ['spend: API, max US$10, 2kx', null, why('2kx')], // read 10
    ['spend: API, max US$10, x thirteen', null, why('x thirteen')], // read 10: N in words stops at twelve
    ['spend: API, max US$10, x(3-4)', null, why('x(3-4)')], // read 10
    ['spend: API, max US$0.25 * 1000 renders', null, why('* 1000')], // read 0.25
    ['spend: API, max US$10, run several times', null, why('times')], // read 10
    ['spend: API, max US$10, tenfold', null, why('tenfold')],
    ['spend: x — cap US$5 each, run 3x-4', null, why('3x-4')], // on a rate line too, before W5c
    ['spend: x — max US$10 for response times', null, why('times')], // a named over-ask: `times` in prose
    ['spend: x — max US$10/month (cron `0 5 * * *`)', null, why('5 *')], // a named over-ask: a cron line's `*`
    ['spend: x — max US$10 for 512x512 renders', '10'], // control: an `x` inside a token is no multiplier
    ['spend: x — max US$10, run quintuple', '10'], // r3: a multiplier word off the lists reads x1
  ])
})

test('p48-4 round 3: MULTIPLIER gains `thrice`, `quadruple` and `N-fold`, and the cap-only clause a `*`, each read x1 before', () => {
  const cases = [['spend: x — cap US$1 thrice', 'unrecognised clause: thrice', '3'],
    ['spend: x — cap US$1 * 3', 'unrecognised clause: * 3', null], // the cap-only reading signed it at 1
    ['spend: x — cap US$1 quadruple', 'unrecognised clause: quadruple', '4'],
    ['spend: x — cap US$1 tenfold', 'unrecognised clause: tenfold', null],
    // outside the clause the cap-only reading waives a multiplier, as it does `run twice` (p37-4's residual)
    ['spend: x — cap US$1, 3-fold', 'multiplier outside the cap clause: 3-fold', '1']]
  const got = py(cases.flatMap(([gate]) => [{ op: 'exposure', gate }, { op: 'standing', gate }]))
  cases.forEach(([gate, why, usd], i) => {
    assert.deepEqual(got[2 * i], { usd: null, why }, `${gate}: full`)
    assert.equal(got[2 * i + 1].usd, usd, `${gate}: standing`)
  })
})

test('p48-4 round 3: rule 6 asks on an unknown letters-`$` marker beside a number, so no reading signs at the cap', () => {
  const cases = [['spend: API, cap US$10 and S$500 for the retries', 'non-USD or ambiguous currency: S$5', 'S$'],
    ['spend: API, cap US$10 and HK$500 for the retries', 'non-USD or ambiguous currency: HK$5', 'HK$'],
    ['spend: API, cap US$10 and 500 HK$ for the retries', 'non-USD or ambiguous currency: 500 HK$', 'HK$']]
  // controls: a known dollar after its number still prices (round 2), and a shell variable is no marker
  const controls = [['spend: API, cap US$10 and 500 A$ for the retries', '595'], ['spend: API, cap US$10 (`echo $HOME`)', '10']]
  const got = py([...cases.flatMap(([gate]) => [{ op: 'exposure', gate }, { op: 'standing', gate },
    { op: 'widest', gate }, { op: 'covered', gate, limit: 200 }]), ...controls.map(([gate]) => ({ op: 'standing', gate }))])
  cases.forEach(([gate, why, mark], i) => {
    assert.deepEqual(got[4 * i], { usd: null, why }, `${gate}: full`)
    assert.deepEqual(got[4 * i + 1], { usd: null, why, capOnly: '' }, `${gate}: the cap-only reading signed it at 10 before`)
    assert.deepEqual(got[4 * i + 2], { usd: null, why: `an unknown or ambiguous currency: ${mark}` }, `${gate}: widest`)
    assert.equal(got[4 * i + 3].covered, false, `${gate}: never covered`)
  })
  controls.forEach(([gate, usd], i) => assert.equal(got[4 * cases.length + i].usd, usd, gate))
})

test("p48-4 the plan judge's other-currency sentence is coupled to the pricer: its priced example prints an amount, its other null", () => {
  const T = loadEngine(['gatePricingBlock'])
  const frag = T.gatePricingBlock({ gatePricer: '/x/gated_inputs.py' }, 'Planned on: abc\n### Gated inputs\n- spend: x — cap 1 USD\n### Risks / unknowns\n- none')
  const m = frag.replace(/\s+/g, ' ').match(/A cap in another currency counts as one cap amount, and the pricer prices it at its ceiling rate \(`([^`]+)` prints an amount\); one it still cannot read, such as `([^`]+)`, which it reports as "no cap clause", may be listed\./)
  assert.ok(m, frag)
  assert.deepEqual(cli(`spend: x — ${m[1]}\n`).out, { usd: '35.10', why: '' })
  assert.deepEqual(cli(`spend: x — ${m[2]}\n`).out, { usd: null, why: 'no cap clause' })
})

// ---- the test-Login reading (p37-4) ---------------------------------------------------------------------------------
const LOGINS = ['dummy']
const NO_LOGINS = 'no test Logins declared (set [defaults] test_logins in ~/.config/thread/rollouts.toml)'
const DUMMY = 'credential: the dummy Claude Login, to run that probe'   // verbatim from the archived Steer note's line 55

test('p37-4 the test-Login reading: each why in order; names matched ignoring case, a possessive, Claude optional, a live probe', () => {
  const ok = [[DUMMY, ['dummy']], ['credential: a live probe on the dummy Login', ['dummy']], ["credential: the Dummy Login's history", ['dummy']],
    ['credential: the dummy login, live-run', ['dummy']], ['- Credential: the dummy Claude Login', ['dummy']],
    ['credential: the dummy Login, then the dummy Claude Login again', ['dummy']]]
  assert.deepEqual(py(ok.map(([gate]) => ({ op: 'login', gate, logins: LOGINS }))), ok.map(([, names]) => ({ names, why: '' })))
  const cases = [
    ['spend: the dummy Login — cap 1 USD', 'not a credential gate'],
    ['credential: access to the dummy Claude Login', 'deny word: access'],   // a known false ask, pinned
    ["credential: the dummy Claude Login's session token", 'deny word: token'],   // a known false ask, pinned
    ["credential: the dummy Login's OAuth token", 'deny word: OAuth'],
    ['credential: the dummy Claude Login and the live Stripe account', 'deny word: live'],
    ['credential: livemode on the dummy Login', 'deny word: livemode'],
    ['credential: the production dummy Login', 'deny word: production'],
    ['credential: wipe the dummy Login', 'deny word: wipe'],
    ['credential: the dummy Login and STRIPE_SECRET', 'an env key beside a Login: STRIPE_SECRET'],
    ['credential: the dummy Claude Login and the Stripe test account', 'another credential beside the Login: account'],
    ['credential: the dummy Login and the GitHub PAT', 'another credential beside the Login: PAT'],
    ['credential: the dummy Login and its API', 'another credential beside the Login: API'],
    ['credential: the dummy Login from .env.local', 'another credential beside the Login: .env'],
    ['credential: the dummy Login and the deploy keys', 'another credential beside the Login: keys'],
    // step 5 (review round 1): nothing joined beside the Login; each of these signed as `test Login dummy` before it
    ["credential: the dummy Login and Lachy's Gmail", 'something joined to the Login: and'],
    ['credential: the dummy Login and the Supabase service role', 'something joined to the Login: and'],
    ['credential: the dummy Login and the GitHub admin rights on lachyts/thread-skill', 'something joined to the Login: and'],
    ['credential: the dummy Login, then sign in as lachy@animately.com', 'an address beside the Login: lachy@animately.com'],
    ['credential: the dummy Login (lachy+dummy@animately.com).', 'an address beside the Login: lachy+dummy@animately.com'],
    ['credential: the dummy Login plus the Stripe dashboard', 'something joined to the Login: plus'],
    ['credential: the dummy Login & the deploy box', 'something joined to the Login: &'],
    ['credential: the dummy Login + Gmail', 'something joined to the Login: +'],
    ["credential: the dummy Login as well as Lachy's Gmail", 'something joined to the Login: as well as'],
    ['credential: the dummy Login along  with Gmail', 'something joined to the Login: along with'],
    ['credential: the dummy Login; the main Login', 'something joined to the Login: ;'],
    ['credential: the dummy Login OR the main Login', 'something joined to the Login: OR'],
    // a known false ask, pinned: two declared Logins joined by `and` ask too (list them with a comma or `then`)
    ['credential: the dummy Login and the dummy Claude Login', 'something joined to the Login: and'],
    ['credential: the Logins', 'more than one Login: Logins'],
    ['credential: Login for the probe', 'a Login it cannot name'],
    ['credential: the dummy account', 'another credential beside the Login: account'],
    ['credential: the dummy probe', 'it names no Login'],
    ['credential: the animately Login', 'animately is not a declared test Login'],
    ['credential: the Claude Login', 'the is not a declared test Login'],   // the leftmost name wins
    ['credential: the dummy Login, then the animately Login', 'animately is not a declared test Login'],
    // the order: steps 2-4 name their own word before step 5's conjunction (`and STRIPE_SECRET`, `and the GitHub PAT`
    // above), and step 5 runs before the naming steps 6-8, so a second Login joined by `and` asks on its conjunction
    ['credential: the dummy Login and the animately Login', 'something joined to the Login: and'],
  ]
  const got = py(cases.map(([gate]) => ({ op: 'login', gate, logins: LOGINS })))
  cases.forEach(([gate, why], i) => assert.deepEqual(got[i], { names: null, why }, gate))
  // steps 1-6 need no Logins: a gate they pass says NO_LOGINS_WHY with none declared, [] or null
  const [none, empty, pre, joined] = py([{ op: 'login', gate: DUMMY, logins: null }, { op: 'login', gate: DUMMY, logins: [] },
    { op: 'login', gate: 'credential: access to the dummy Claude Login', logins: null },
    { op: 'login', gate: "credential: the dummy Login and Lachy's Gmail", logins: null }])
  assert.deepEqual([none, empty], [{ names: null, why: NO_LOGINS }, { names: null, why: NO_LOGINS }])
  assert.deepEqual(pre, { names: null, why: 'deny word: access' }, 'a deny word says so with no Logins')
  assert.deepEqual(joined, { names: null, why: 'something joined to the Login: and' }, 'a conjunction says so with no Logins')
  // the accepted residual (module docstring 5; ADR 0034 amendment vi): a second thing in plain prose with no deny word,
  // env key, credential noun, `@` or conjunction passes; the annotation names only the Login
  const residual = ['credential: the dummy Login to push to the npm registry', "credential: the dummy Login, then Lachy's Gmail"]
  assert.deepEqual(py(residual.map((gate) => ({ op: 'login', gate, logins: LOGINS }))), residual.map(() => ({ names: ['dummy'], why: '' })))
  assert.deepEqual(py([{ op: 'login', gate: 'credential: the Dummy Login', logins: ['DUMMY'] }])[0], { names: ['DUMMY'], why: '' }, 'the declared spelling')
})

test('p37-4 has_login_phrase: a Login word and no env token; the class path keeps an env-token gate', () => {
  const got = py([DUMMY, 'credential: the Logins', 'credential: test-mode STRIPE_SECRET (sk_test_) for the dummy Login',
    'credential: the dummy account', 'credential: Stripe test-mode keys STRIPE_SECRET (sk_test_)', 'Login: no colon text'].map((gate) => ({ op: 'has_login', gate })))
  assert.deepEqual(got, [true, true, false, false, false, false])
})

test('p37-4 login_annotation: its text, one `)` last, stripped by GATE_ANNOT_RE and unapprovedGates; a `)` in a part raises', () => {
  const T = loadEngine(['unapprovedGates'])
  const [ann, bad] = py([{ op: 'login_annotation', date: '2026-10-14', names: ['dummy'], source: 'file:defaults' },
    { op: 'login_annotation', date: '2026-10-14', names: ['a)'], source: 'file:defaults' }])
  assert.equal(ann, '(approved 2026-10-14 under the standing approval: test Login dummy, from file:defaults)')
  assert.match(bad.error, /an annotation part holds a '\)'/)
  assert.deepEqual(py([{ op: 'strip', gate: DUMMY, line: `${DUMMY} ${ann}` }]), [true])
  assert.deepEqual([...T.unapprovedGates([DUMMY], [`${DUMMY} ${ann}`])], [])
})

// ---- p39-3: the sweep records a declared test Login -----------------------------------------------------------------
// schedule § 3.6 and orient reshuffle R3 (c) record a credential hit whose `login.names` the sweep set, never asking it
// ahead; every other hit keeps today's rule. The CLI reads the declared test Logins itself, lazily (module docstring 1).
const TEST_LOGIN = path.join(FIXTURES, 'test-login.md')
const DUMMY_READ = { names: ['dummy'], why: '' }
// The credential hits schedule § 3.6 would still ask ahead: those whose `login.names` the sweep did not set.
const asked = (s) => s.credential.filter((h) => !h.login?.names)

test('p39-3 the sweep records a declared test Login: recorded with ["dummy"], asked with []', () => {
  const [rec, ask, today] = py([{ op: 'sweep', path: TEST_LOGIN, logins: ['dummy'] }, { op: 'sweep', path: TEST_LOGIN, logins: [] },
    { op: 'sweep', path: TEST_LOGIN }])
  for (const s of [rec, ask, today]) {
    assert.deepEqual([s.spend, s.irreversible], [[], []], 'the fixture holds no spend or irreversible hit')
    assert.ok(s.credential.length > 0, 'its gate is a credential hit')
  }
  for (const h of rec.credential) assert.deepEqual(h.login, DUMMY_READ, h.at)
  assert.deepEqual(asked(rec), [], 'with ["dummy"] nothing is asked ahead')
  for (const h of ask.credential) assert.deepEqual(h.login, { names: null, why: NO_LOGINS }, h.at)
  assert.ok(asked(ask).length > 0, 'with [] it asks ahead as today')
  for (const h of today.credential) assert.deepEqual(Object.keys(h), ['word', 'at'], "with no logins: today's shape")
})

test('p39-3 the line rule: only a `credential:` gate line naming a Login reads; its `(approved …)` suffix, `>` markers and CR stripped', () => {
  const GATE = `- ${DUMMY}`
  const TOKEN = { names: null, why: 'deny word: token' }
  const cases = [
    ['Mind the token count of the brief.', null],   // prose: no key
    ["- credential: the dummy Claude Login's session token", TOKEN],   // both hits, one line reading
    ['- credential: the animately Login', { names: null, why: 'animately is not a declared test Login' }],
    [`${GATE} (approved 2026-11-03)`, DUMMY_READ],   // the verbatim Steer line, its suffix kept
    [`${GATE} (Approved 2026-11-03)`, DUMMY_READ],
    [`${GATE} (approved 2026-11-06 under the standing approval: test Login dummy, from file:defaults)`, DUMMY_READ],
    [`> ${GATE}`, DUMMY_READ],
    [`> > ${GATE} (approved 2026-11-03)\r\nthe next line`, DUMMY_READ],
    [`  ${GATE}`, DUMMY_READ],   // an indented sub-bullet is a gate (gate_kind strips the marker)
    ['- Credential: the Dummy Login, to run the probe', DUMMY_READ],   // the declared spelling
    [`1. ${DUMMY}`, null],   // a numbered line is no gate: fail closed
    ['- Planner: word each test-Login gate as `credential: the <name> Claude Login, <use>`; keep `token` off that line', null],
    ['- credential: the dummy Login and the GitHub PAT', { names: null, why: 'another credential beside the Login: PAT' }],
  ]
  const got = py(cases.map(([text]) => ({ op: 'sweep_text', text, logins: LOGINS })))
  cases.forEach(([text, want], i) => {
    assert.ok(got[i].credential.length > 0, `${text}: a credential hit`)
    for (const h of got[i].credential) {
      if (want === null) assert.deepEqual(Object.keys(h), ['word', 'at'], `${text}: no login key`)
      else assert.deepEqual(h.login, want, `${text}: ${h.word}`)
    }
  })
  assert.equal(got[1].credential.length, 2, 'credential and token: both hits on the one line')
  // control: unstripped, the standing approval's own annotation names a second Login, `test`
  assert.deepEqual(py([{ op: 'login', gate: cases[5][0], logins: LOGINS }])[0], { names: null, why: 'test is not a declared test Login' })
})

test('p39-3 APPROVED_SUFFIX_RE is GATE_ANNOT_RE (pattern and flags), and both strip an uppercase `(Approved …)`', () => {
  const [[gi, rr]] = py([{ op: 'suffix_re' }])
  assert.deepEqual(gi, rr, 'the copy holds the same pattern and flags')
  // behavioural: the annotation reads `test is not a declared test Login` unless stripped, so a case-sensitive copy fails
  const line = `${DUMMY} (Approved 2026-11-06 under the standing approval: test Login dummy, from file:defaults)`
  const [stripped, s] = py([{ op: 'strip', gate: DUMMY, line }, { op: 'sweep_text', text: `- ${line}`, logins: LOGINS }])
  assert.equal(stripped, true, 'GATE_ANNOT_RE strips it')
  assert.deepEqual(s.credential.map((h) => h.login), [DUMMY_READ], 'APPROVED_SUFFIX_RE strips it')
})

test("p39-3 schedule's test-Login Planner line is coupled to the reader: its example reads dummy; each word it keeps off asks", () => {
  const schedule = fs.readFileSync(path.join(root, 'skills', 'schedule', 'SKILL.md'), 'utf8')
  const s7 = schedule.slice(schedule.indexOf('### 7. '), schedule.indexOf('### 7.5. '))
  const line = s7.split('\n').find((l) => l.startsWith('- Planner: word each test-Login gate'))
  assert.ok(line, 'schedule § 7 has the test-Login Planner line')
  const examples = [...line.matchAll(/`(credential: [^`]*<name>[^`]*)`/g)].map((m) => m[1])
  assert.deepEqual(examples, ['credential: the <name> Claude Login, <use>'], 'one backticked example')
  const fill = (use) => examples[0].replace('<name>', 'dummy').replace('<use>', use)
  assert.deepEqual(py([{ op: 'login', gate: fill('to run the probe'), logins: LOGINS }])[0], DUMMY_READ, 'the example, filled')
  const off = ['access', 'token', 'session token', 'OAuth', 'secret', 'live Stripe', 'prod', 'API', 'account', 'key', 'PAT', '.env',
    'and the main Login', 'as lachy@x.com', 'STRIPE_KEY']
  const got = py(off.map((w) => ({ op: 'login', gate: fill(`to run the probe with ${w}`), logins: LOGINS })))
  off.forEach((w, i) => {
    assert.equal(got[i].names, null, `${w} asks`)
    assert.ok(got[i].why && got[i].why !== NO_LOGINS, `${w}: ${got[i].why}`)
  })
  assert.deepEqual(py([{ op: 'login', gate: fill('for a live probe'), logins: LOGINS }])[0], DUMMY_READ, 'control: a live probe reads dummy')
})

// The CLI's lazy settings read: every spawn under a temp HOME, so the operator's own rollouts.toml never enters.
const DECLARED = 'schema = 5\n\n[defaults]\ntest_logins = ["dummy"]\n'
const REFUSED = 'schema = 4\n\n[defaults]\ntest_logins = ["dummy"]\n'   // test_logins is a schema-5 key
const REFUSED_LINE = /^gated_inputs: test_logins: .*rollouts\.toml:\d+: rollout\.test_logins is a schema-5 key but the file says schema = 4/
function tempHome(t, toml) {
  const H = fs.mkdtempSync(path.join(os.tmpdir(), 'gated-inputs-home-'))
  t.after(() => fs.rmSync(H, { recursive: true, force: true }))
  if (toml != null) {
    fs.mkdirSync(path.join(H, '.config', 'thread'), { recursive: true })
    fs.writeFileSync(path.join(H, '.config', 'thread', 'rollouts.toml'), toml)
  }
  return H
}
const sweepCli = (H, notes, { script = MODULE, flags = ['-I', '-B'] } = {}) => spawnSync('python3', [...flags, script, 'sweep', ...notes],
  { encoding: 'utf8', env: { ...process.env, HOME: H, THREAD_EVENTS_DIR: EVENTS } })
const jsonLines = (r) => r.stdout.split('\n').filter(Boolean).map((l) => JSON.parse(l))
const errLines = (r) => r.stderr.split('\n').filter(Boolean)
const logins = (r) => jsonLines(r).flatMap((l) => l.credential.map((h) => h.login))

test('p39-3 the CLI reads the declared test Logins: ["dummy"] records, no file reads NO_LOGINS_WHY, both exit 0 with no stderr', (t) => {
  const declared = sweepCli(tempHome(t, DECLARED), [TEST_LOGIN])
  assert.deepEqual([declared.status, declared.stderr], [0, ''])
  assert.ok(logins(declared).length > 0)
  for (const l of logins(declared)) assert.deepEqual(l, DUMMY_READ)
  const none = sweepCli(tempHome(t, null), [TEST_LOGIN])
  assert.deepEqual([none.status, none.stderr], [0, ''])
  for (const l of logins(none)) assert.deepEqual(l, { names: null, why: NO_LOGINS })
})

test('p39-3 a refused rollouts.toml: one test_logins stderr line, exit 1, and the note still printed with no login key', (t) => {
  const r = sweepCli(tempHome(t, REFUSED), [TEST_LOGIN])
  assert.equal(r.status, 1)
  assert.equal(errLines(r).length, 1, r.stderr)
  assert.match(errLines(r)[0], REFUSED_LINE)
  assert.equal(jsonLines(r).length, 1)
  for (const h of jsonLines(r)[0].credential) assert.deepEqual(Object.keys(h), ['word', 'at'], 'no login: every hit keeps the ask')
})

test('p39-3 the read is lazy: a refused file never errs a note with no Login gate, nor one whose reading stops at steps 1-6', (t) => {
  const H = tempHome(t, REFUSED)
  const plain = sweepCli(H, [path.join(FIXTURES, 'chorus-p18-7.md'), path.join(FIXTURES, 'shell-vars.md')])
  assert.deepEqual([plain.status, plain.stderr], [0, ''], 'no credential gate: the file is never read')
  const note = path.join(H, 'deny.md')
  fs.writeFileSync(note, "# A probe\n\n- credential: the dummy Claude Login's session token\n")
  const deny = sweepCli(H, [note])
  assert.deepEqual([deny.status, deny.stderr], [0, ''], 'steps 1-6 never read the settings')
  assert.deepEqual(logins(deny), [{ names: null, why: 'deny word: token' }, { names: null, why: 'deny word: token' }])
})

test('p39-3 stderr follows note order: an unreadable note first, then the one test_logins line, written once', (t) => {
  const r = sweepCli(tempHome(t, REFUSED), [path.join(FIXTURES, 'no-such-note.md'), TEST_LOGIN, TEST_LOGIN])
  assert.equal(r.status, 1)
  const err = errLines(r)
  assert.equal(err.length, 2, r.stderr)
  assert.match(err[0], /^gated_inputs: .*no-such-note\.md: /)
  assert.match(err[1], REFUSED_LINE)
  assert.equal(jsonLines(r).length, 2, 'both readable notes printed')
  for (const l of jsonLines(r)) for (const h of l.credential) assert.deepEqual(Object.keys(h), ['word', 'at'])
})

test('p39-3 the CLI writes no bytecode: a copy of the three scripts run with no -B leaves no __pycache__ (control: without the flag it does)', (t) => {
  const H = tempHome(t, DECLARED)
  const dirs = ['copy', 'ctl'].map((n) => fs.mkdtempSync(path.join(os.tmpdir(), `gated-inputs-${n}-`)))
  t.after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }) })
  const [C, D] = dirs
  const src = path.join(root, 'skills', '_shared', 'scripts')
  for (const d of dirs) for (const f of ['gated_inputs.py', 'rollout-settings.py', 'ladder.py']) fs.copyFileSync(path.join(src, f), path.join(d, f))
  const FLAG = 'sys.dont_write_bytecode = True'
  const text = fs.readFileSync(MODULE, 'utf8')
  assert.equal(text.split(FLAG).length, 2, 'the loader sets the flag on exactly one line')
  fs.writeFileSync(path.join(D, 'gated_inputs.py'), text.replace(FLAG, 'pass'))
  const caches = (dir) => fs.readdirSync(dir, { recursive: true }).filter((p) => p.split(path.sep).includes('__pycache__'))
  // plain `python3 -I` (no -B, no pycache prefix): -I ignores PYTHONDONTWRITEBYTECODE, so the harness cannot mask it
  const r = sweepCli(H, [TEST_LOGIN], { script: path.join(C, 'gated_inputs.py'), flags: ['-I'] })
  assert.deepEqual([r.status, r.stderr], [0, ''])
  assert.deepEqual(logins(r), [DUMMY_READ], 'the loader ran')
  assert.deepEqual(caches(C), [], 'no __pycache__ beside the copied scripts')
  const c = sweepCli(H, [TEST_LOGIN], { script: path.join(D, 'gated_inputs.py'), flags: ['-I'] })
  assert.deepEqual([c.status, c.stderr], [0, ''])
  const made = fs.existsSync(path.join(D, '__pycache__')) ? fs.readdirSync(path.join(D, '__pycache__')) : []
  assert.ok(made.some((f) => /^rollout-settings\.cpython-.*\.pyc$/.test(f)), `control: rollout-settings bytecode written: ${made}`)
  assert.ok(made.some((f) => /^ladder\.cpython-.*\.pyc$/.test(f)), `control: ladder bytecode written: ${made}`)
})

// ---- the test-credential reading (ADR 0063) -----------------------------------------------------------------------
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

test('known false asks (ADR 0063 residual ii): Stripe\'s own "API keys" and "secret key", STRIPE_PRODUCT_ID, "lives"', () => {
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

// ---- the env file and the value proof (ADR 0063) --------------------------------------------------------------------

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

// ---- the bootstrap refresh (ADR 0063 d4) ----------------------------------------------------------------------------

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
