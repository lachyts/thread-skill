// skills/reflect/scripts/ledger.py and reflect.py's Time-lost ledger (p29-11, ADR 0051), part 2 of 2 (p49-3): L1 in
// span (a live serial chain left out), a load-topped ledger holding a Parallel ceiling raise in span and in tune.py
// --auto (L5), the Monthly audit on the month's first reading, before its ledger (L6), its gaps in the decision
// task, never against `quiet` (L7), the order of ledger, decide and close (L8), and a take-out ending a wait (L9).
// tests/lib/reflect-ledger-fixtures.mjs holds the fixtures both parts use, and says how each case stays hermetic.
// Reach (tests/fast-tier.map): each part names every script the unsplit file named, so each runs on the changes it
// did: contract-text.mjs land.sh ledger.py reflect-due.py reflect.py run_record.py score.py tune.py.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { section } from './lib/contract-text.mjs'
import { LEDGER, TUNE, DUE, RUN_RECORD, setup, env, run, ok, refused, reflectionsFile, rlines, sha, tl, emitAll, py,
  rolloutNote, done, ledgerCli, T, SHA, suite, H0, CLASSES, FIXTURE, LSINCE, LUNTIL, SERIAL_LEFT_OUT, span, stallDay,
  closeLine } from './lib/reflect-ledger-fixtures.mjs'

test('L1 in span: a live serial chain read this week is left out of span\'s ledger too (Span.serial), flagged', (t) => {
  const h = setup(t)
  emitAll(h, 'l-serial', FIXTURE['l-serial'])
  rolloutNote(h, 'l-serial', { shape: 'serial' })
  const { s } = span(h, LSINCE, LUNTIL)
  assert.equal(s.rollouts.find((e) => e.rollout === 'l-serial')?.shape, 'serial', 'the reading reads the chain')
  assert.deepEqual([s.ledger.row.hours, s.ledger.row.top], [H0, null], JSON.stringify(s.ledger.row.byCause))
  assert.ok(s.ledger.flags.includes(SERIAL_LEFT_OUT), s.ledger.flags.join('\n'))
})

// ---- L5: a load-topped ledger holds a proposed Parallel ceiling raise -------------------------------------------------

function life(slug, from, to, lane, c) {
  return [[from, 'slot-taken', slug, { settings: { parallel_ceiling: c, max_review_rounds: 4, max_iterations: 3, max_plan_rounds: 3 }, start: 'start' }],
    [to, 'slot-freed', slug, { outcome: 'ready' }], [to, 'ready', slug, { pr: 7 }],
    [lane[0], 'lane-taken', slug, {}], [lane[1], 'lane-freed', slug, { release: 'merge', path: 'lead', triggers: [], conflict: false }],
    [lane[1], 'merged', slug, { pr: 7 }]]
}
// three tasks in their Slots from 00:00 at ceiling 3 (score.py proposes a ceiling raise); with `load`, one suite waited
// an hour for a verify slot, which puts machine load on top of the ledger
function slotBound(h, slug, load) {
  const V = (hm) => `2026-10-10T${hm}:00Z`
  const ev = []
  for (let i = 0; i < 3; i++) ev.push(...life(`a${i + 1}`, V('00:00'), V(`04:${i}0`), [V(`04:${i}0`), V(`04:${i}5`)], 3))
  if (load) {
    ev.push([V('02:00'), 'suite-started', 'a1', { ...suite(9, 'task', 'agent'), sha: SHA, dirty: false, waited: 3600 }],
      [V('02:30'), 'suite-ended', 'a1', { ...suite(9, 'task', 'agent'), outcome: 'green', seconds: 1800, rc: 0 }])
  }
  emitAll(h, slug, ev.sort((x, y) => Date.parse(x[0]) - Date.parse(y[0])))
  done(h, slug)
}
// a closed earlier Reflection whose knob line names one other rollout (the Agreement rule counts each)
function agreeing(h, rid, kid, rollout, ts) {
  const L = (o) => JSON.stringify({ v: 1, ts, host: 'h', rollout: null, task: null, ...o })
  fs.appendFileSync(reflectionsFile(h), `${L({ kind: 'proposal', id: kid, altitude: 'knob', reflection: rid, rollouts: [rollout], repo: 'o/r', key: 'parallel_ceiling',
    rule: 'slot-bound-raise', direction: 1, landed: false, held: 'agreement 1 of 3' })}\n${L({ kind: 'reflection', id: rid })}\n`)
}
function loadWeek(h, load) {
  fs.writeFileSync(path.join(h.home, 'rollouts.toml'), '[defaults]\nparallel_ceiling = 3\n')
  const kid = py(h, RUN_RECORD, 'm.knob_key("o/r", "parallel_ceiling", "slot-bound-raise", 1)')
  agreeing(h, 'r-20261001T000000Z-000001', kid, 'old-1', '2026-10-01T00:00:00.000Z')
  agreeing(h, 'r-20261002T000000Z-000002', kid, 'old-2', '2026-10-02T00:00:00.000Z')
  slotBound(h, 'week-a', load)
  return { kid, ...span(h, '2026-10-09T00:00+11:00', '2026-10-15T12:00+11:00') }
}
const autoTune = (h, sp) => run(h, TUNE, ['--scores', path.join(sp.dir, 'week-a.score.json'), '--auto', '--repo', h.repo, '--reflection', sp.s.reflection,
  '--config', path.join(h.home, 'rollouts.toml')])
const LOAD_HELD = /^machine load tops the Time-lost ledger \(1 h of 1\.25 h\): a Parallel ceiling raise waits \(ADR 0051\)$/

test('L5: a load-topped ledger holds the Parallel ceiling raise in span and in tune.py --auto; with no ledger line tune.py fails closed', (t) => {
  const h = setup(t)
  const sp = loadWeek(h, true)
  assert.equal(sp.s.ledger.row.top, 'load')
  const held = sp.s.knobs.held.find((k) => k.id === sp.kid)
  assert.match(held.reason, LOAD_HELD)
  assert.deepEqual(sp.s.knobs.land, [])
  assert.deepEqual(sp.s.ledger.holds.map((x) => [x.id, x.rollout, x.key]), [[sp.kid, 'week-a', 'parallel_ceiling']])
  const none = autoTune(h, sp)
  assert.equal(none.status, 0, none.stderr)
  assert.equal(none.stdout, `held parallel_ceiling: no Time-lost ledger line for Reflection ${sp.s.reflection}: run reflect.py ledger first\n`)
  ok(h, ['ledger', '--span', sp.out])
  const r = autoTune(h, sp)
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout.trim(), new RegExp(`^held parallel_ceiling: ${LOAD_HELD.source.slice(1, -1)}$`))
  assert.ok(!fs.existsSync(path.join(h.ev, 'tunings.jsonl')), 'nothing landed')
  ok(h, ['knobs', '--span', sp.out])
  assert.match(rlines(h).find((l) => l.kind === 'proposal' && l.id === sp.kid && l.reflection === sp.s.reflection).held, LOAD_HELD)
})

test('L5 controls: the same week without the load lands the raise; an audit line finding load on top beside it lands it too', (t) => {
  const h = setup(t)
  const sp = loadWeek(h, false)
  assert.notEqual(sp.s.ledger.row.top, 'load')
  assert.deepEqual(sp.s.knobs.land.map((k) => [k.id, k.rollout]), [[sp.kid, 'week-a']])
  ok(h, ['ledger', '--span', sp.out])
  emitAll(h, null, [['2026-10-15T01:00:00Z', 'time-lost', null, { id: `tl-audit-${sp.s.reflection.slice(2)}`, source: 'audit', reflection: sp.s.reflection,
    since: '2026-10-01T00:00:00.000Z', until: sp.s.until, month: '2026-10', hours: { ...H0, load: 40 }, recorded: H0,
    rank: ['load', 'stalls', 'quota-bound', 'lane-bound', 'rework', 'plan-rejected'], audit: { sources: [{ source: 'suite-logs', read: true }], entries: [], gaps: [] } }, null]])
  const r = autoTune(h, sp)
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /^applied parallel_ceiling 3 → 4 for o\/r: /m)
})

// ---- L6: the Monthly audit ------------------------------------------------------------------------------------------------

const AUDIT_DOC = (entries, gaps = [{ what: 'a lead question writes no Run-record line', evidence: 'session s-1 transcript, 2026-10-25 01:10' }], month = '2026-11') => ({
  month, sources: [{ source: 'transcripts', read: true }, { source: 'suite-logs', read: true }, { source: 'pause-logs', read: true },
    { source: 'mac-history', read: false, why: 'pmset -g log keeps two days' }], entries, gaps })
const writeJson = (dir, name, doc) => { const p = path.join(dir, name); fs.writeFileSync(p, JSON.stringify(doc)); return p }

test('L6: October stands on the baseline; November\'s first reading audits from 21 October, across the month, before its ledger; refusals; a second November reading is not due; the month is Melbourne\'s', (t) => {
  const h = setup(t)
  stallDay(h, 'oct-a', '2026-10-25') // 2 h of stalls/unexplained, 01:00..03:00 UTC, inside the audit window only
  const oct = span(h, '2026-10-22T13:00:00Z', '2026-10-29T02:00:00Z') // until: Melbourne 29 October
  assert.deepEqual([oct.s.ledger.audit.due, oct.s.ledger.audit.month], [false, '2026-10'], 'the baseline stands as October\'s')
  const nov = span(h, '2026-10-29T02:00:00Z', '2026-11-05T02:00:00Z') // Melbourne 5 November, 13:00
  const A = nov.s.ledger.audit
  assert.deepEqual([A.due, A.month, A.since, A.until], [true, '2026-11', '2026-10-21T13:00:00.000Z', '2026-11-05T02:00:00.000Z'])
  assert.deepEqual(A.recorded, ledgerCli(h, A.since, A.until).row.hours, 'recorded is rows() over the audit window')
  assert.equal(A.recorded.stalls, 2)
  const known = JSON.parse(fs.readFileSync(A.intervalsFile, 'utf8'))
  assert.deepEqual(known.intervals.map((k) => [k.rollout, k.class, k.cause, k.from, k.to]), [['oct-a', 'stalls', 'unexplained', '2026-10-25T01:00:00.000Z', '2026-10-25T03:00:00.000Z']])
  assert.deepEqual(known.leads.map((k) => [k.rollout, k.kind]), [['oct-a', 'unexplained']])
  // the audit runs before its ledger
  refused(h, ['ledger', '--span', nov.out], /the Monthly audit is due \(2026-11, 2026-10-21T13:00:00\.000Z \.\. 2026-11-05T02:00:00\.000Z\): run it/)
  const entry = (over) => ({ class: 'load', cause: 'hold-heat', rollout: 'oct-a', from: '2026-10-25T01:00:00Z', to: '2026-10-25T02:30:00Z',
    what: 'the Mac too hot to start a suite', evidence: 'pmset thermal log 2026-10-25', ...over })
  refused(h, ['ledger', '--span', nov.out, '--audit', writeJson(nov.dir, 'over.json', AUDIT_DOC([entry({ class: 'stalls', cause: 'question' })]))],
    /entry 1 overlaps the record's own stalls\/unexplained interval of \[\[oct-a\]\]/)
  refused(h, ['ledger', '--span', nov.out, '--audit', writeJson(nov.dir, 'out.json', AUDIT_DOC([entry({ from: '2026-10-20T01:00:00Z', to: '2026-10-20T02:00:00Z' })]))],
    /entry 1 \(2026-10-20T01:00:00\.000Z \.\. 2026-10-20T02:00:00\.000Z\) falls outside the audit window/)
  refused(h, ['ledger', '--span', nov.out, '--audit', writeJson(nov.dir, 'month.json', AUDIT_DOC([], undefined, '2026-10'))], /month '2026-10' is not this reading's 2026-11/)
  refused(h, ['ledger', '--span', nov.out, '--audit', writeJson(nov.dir, 'cause.json', AUDIT_DOC([entry({ cause: 'lunch' })]))], /entry 1: 'load' \/ 'lunch' is no class and cause/)
  refused(h, ['ledger', '--span', nov.out, '--audit', writeJson(nov.dir, 'many.json', AUDIT_DOC(Array.from({ length: 17 }, () => entry({}))))], /at most 16 entries/)
  refused(h, ['ledger', '--span', nov.out, '--audit', writeJson(nov.dir, 'gaps.json', AUDIT_DOC([], Array.from({ length: 9 }, () => ({ what: 'w', evidence: 'e' }))))], /at most 8 gaps/)
  refused(h, ['ledger', '--span', oct.out, '--audit', writeJson(nov.dir, 'oct.json', AUDIT_DOC([], undefined, '2026-10'))], /no Monthly audit is due this reading/)
  const r = ok(h, ['ledger', '--span', nov.out, '--audit', writeJson(nov.dir, 'audit.json', AUDIT_DOC([entry({})])), '--model', 'claude-opus-5-5', '--effort', 'xhigh'])
  // the week itself (29 October to 5 November) lost nothing; the audit window's 2 h are October's
  assert.match(r.stdout, /^ledger r-\S+: no time lost of 0 h; baseline 2026-10, audit 2026-11 \(1 entry, 1 gap\), record written\n$/)
  assert.deepEqual(tl(h).map((l) => l.source), ['baseline', 'audit', 'record'], 'the audit lands before its ledger')
  const [au] = tl(h, 'audit')
  assert.deepEqual([au.month, au.since, au.until, au.hours.load, au.recorded, au.rank.slice(0, 2)], ['2026-11', A.since, A.until, 1.5, A.recorded, ['stalls', 'load']])
  assert.deepEqual(au.audit.entries.map((e) => [e.from, e.to, e.hours]), [['2026-10-25T01:00:00.000Z', '2026-10-25T02:30:00.000Z', 1.5]], 'hours from from .. to')
  assert.deepEqual(au.audit.sources.find((s) => !s.read), { source: 'mac-history', read: false, why: 'pmset -g log keeps two days' })
  // p46-6 (ADR 0079 decision 5): the audit line carries the model and effort its reader ran on; the record line, summed
  // by script, carries none
  assert.deepEqual([au.model, au.effort, 'model' in tl(h, 'record')[0]], ['claude-opus-5-5', 'xhigh', false])
  // a second reading in November is not due; a reading ending 30 November 14:00 UTC is Melbourne's 1 December: due
  assert.equal(span(h, '2026-11-05T02:00:00Z', '2026-11-12T02:00:00Z').s.ledger.audit.due, false)
  const dec = span(h, '2026-11-23T14:00:00Z', '2026-11-30T14:00:00Z').s.ledger.audit
  assert.deepEqual([dec.due, dec.month, dec.since], [true, '2026-12', '2026-11-05T02:00:00.000Z'])
})

test('L6: the fortnightly cadence still audits the month\'s first reading (day 12); a month with no reading leaves the next to read from the last audit', (t) => {
  const h = setup(t)
  const au = (month, since, until) => [until, 'time-lost', null, { id: `tl-audit-${month}`, source: 'audit', reflection: `r-${month}`, since, until, month,
    hours: H0, recorded: H0, rank: CLASSES, audit: { sources: [{ source: 'transcripts', read: true }], entries: [], gaps: [] } }, null]
  const quiet = (n, until) => [until, 'reflection', null, { id: `r-2026111${n}T000000Z-00000${n}`, since: '2026-11-01T00:00:00.000Z', until, rollouts: [], escapesOnly: [],
    counts: { sightings: 0, newWatches: 0, rules: 0, bugs: 0, filed: 0, knobs: 0, landed: 0, reverted: 0, breaches: 0 }, quiet: true }, null]
  emitAll(h, null, [au('2026-11', '2026-10-21T13:00:00.000Z', '2026-11-05T02:00:00.000Z'), quiet(1, '2026-11-12T02:00:00.000Z'),
    quiet(2, '2026-11-19T02:00:00.000Z'), quiet(3, '2026-11-26T02:00:00.000Z')])
  const due = spawnSync('python3', ['-B', DUE, '--now', '2026-12-12T06:00+11:00'], { encoding: 'utf8', env: env(h) })
  assert.deepEqual([JSON.parse(due.stdout).cadence, JSON.parse(due.stdout).quietStreak], [14, 3])
  const day12 = span(h, '2026-11-26T02:00:00Z', '2026-12-12T02:00:00Z').s.ledger.audit
  assert.deepEqual([day12.due, day12.month, day12.since], [true, '2026-12', '2026-11-05T02:00:00.000Z'])
  emitAll(h, null, [au('2026-12', '2026-11-05T02:00:00.000Z', '2026-12-03T13:00:00.000Z')])
  const feb = span(h, '2027-01-28T02:00:00Z', '2027-02-04T02:00:00Z').s.ledger.audit
  assert.deepEqual([feb.due, feb.month, feb.since], [true, '2027-02', '2026-12-03T13:00:00.000Z'], 'January had no reading: February reads from December\'s audit')
})

// ---- L7 and L8: the writers over a span written by hand in span's shape ---------------------------------------------------

// A span.json in span's shape with a ledger block: a zero row (no top, so no Watch) and the audit part, due or not.
function handSpan(h, rid, { since, until, month, due = false, auditSince = since, rollouts = ['a'] }) {
  const dir = path.join(h.out, rid)
  fs.mkdirSync(dir, { recursive: true })
  const intervals = writeJson(dir, 'ledger-intervals.json', { intervals: [], leads: [] })
  const row = { id: `tl-record-${rid.slice(2)}`, source: 'record', reflection: rid, since, until, month, hours: H0, top: null, byCause: {},
    rollouts: Object.fromEntries(CLASSES.map((c) => [c, []])), other: {}, events: {}, streak: 0 }
  const ledger = { row, previous: null, delta: null, weeks: [], streak: 0, watch: { class: null, id: null, rollouts: [], sighted: false }, baseline: {}, holds: [],
    audit: { due, month, since: auditSince, until, recorded: due ? H0 : null, sessions: due ? [] : null, intervalsFile: due ? intervals : null }, flags: [] }
  return { dir, out: writeJson(dir, 'span.json', { reflection: rid, since, until, previous: null, knobs: { revert: [], land: [], held: [] }, ledger,
    rollouts: rollouts.map((r) => ({ rollout: r, mode: 'read', repo: 'o/r', breached: [], breachCounts: false, proposals: [], friction: [] })) }) }
}
const MONTHS = [['r-20261105T000000Z-000011', '2026-10-21T13:00:00.000Z', '2026-11-05T02:00:00.000Z', '2026-11'],
  ['r-20261203T000000Z-000012', '2026-11-05T02:00:00.000Z', '2026-12-03T02:00:00.000Z', '2026-12'],
  ['r-20270107T000000Z-000013', '2026-12-03T02:00:00.000Z', '2027-01-07T02:00:00.000Z', '2027-01']]

// An audit.json at every cap: 16 entries and 8 gaps, every what, evidence and why at full length in `ch`, 64-character
// rollout slugs, the longest class and cause, all four sources unread.
const MAX_AUDIT = (ch) => ({ month: '2026-11',
  sources: ['transcripts', 'suite-logs', 'pause-logs', 'mac-history'].map((source) => ({ source, read: false, why: ch.repeat(160) })),
  entries: Array.from({ length: 16 }, (_, i) => ({ class: 'plan-rejected', cause: 'plan-rejected', rollout: 'r'.repeat(64),
    from: `2026-10-22T${String(i).padStart(2, '0')}:00:00Z`, to: `2026-10-22T${String(i).padStart(2, '0')}:30:00Z`, what: ch.repeat(160), evidence: ch.repeat(200) })),
  gaps: Array.from({ length: 8 }, () => ({ what: ch.repeat(160), evidence: ch.repeat(200) })) })

test('L6: a maximal audit line passes run_record.check; one that JSON escapes push past 16 KiB is refused by ledger (trim entries or their text), nothing written', (t) => {
  const h = setup(t)
  assert.deepEqual(py(h, RUN_RECORD, '[m.MAX_AUDIT_ENTRIES, m.MAX_AUDIT_GAPS, m.TL_WHAT, m.TL_EVIDENCE, m.MAX_LINE]'), [16, 8, 160, 200, 16384])
  const [rid, since, until, month] = MONTHS[0]
  const audit = { due: true, month, since, until, recorded: { ...H0, stalls: 1234.567, 'lane-bound': 98.765 } }
  const [size, checked] = py(h, LEDGER, `(lambda f: [m.RR.line_bytes("time-lost", f), m.RR.check(None, "time-lost", None, f)])(m.audit_line(a["doc"], a["audit"], "${rid}", []))`,
    { doc: MAX_AUDIT('x'), audit })
  assert.ok(size > 13000 && size <= 16384, `the maximal plain line is ${size} bytes`)
  assert.equal(checked, null, 'run_record.check passes it')
  // end to end: the same caps in non-ASCII text are refused before anything is written; the plain one is written whole
  const sp = handSpan(h, rid, { since, until, month, due: true })
  refused(h, ['ledger', '--span', sp.out, '--audit', writeJson(sp.dir, 'wide.json', MAX_AUDIT('é'))],
    /^reflect: the audit is refused: the audit line would be \d+ bytes, over the Run record's 16384-byte line limit \(16 entries, 8 gaps; a non-ASCII character takes 6 bytes or more\): trim entries or their text: nothing written\n$/)
  ok(h, ['ledger', '--span', sp.out, '--audit', writeJson(sp.dir, 'audit.json', MAX_AUDIT('x'))])
  const raw = fs.readFileSync(reflectionsFile(h), 'utf8').split('\n').find((l) => l.includes('"source":"audit"'))
  const au = JSON.parse(raw)
  assert.deepEqual([au.audit.entries.length, au.audit.gaps.length, Buffer.byteLength(raw) + 1 <= 16384], [16, 8, true])
})

test('L7: an audit with gaps and no rule item writes the decision task with its gap lines; close waits for decide; a re-run is byte-identical', (t) => {
  const h = setup(t)
  const [rid, since, until, month] = MONTHS[0]
  const sp = handSpan(h, rid, { since, until, month, due: true })
  ok(h, ['ledger', '--span', sp.out, '--audit', writeJson(sp.dir, 'audit.json', AUDIT_DOC([], [{ what: 'a lead question writes no line', evidence: 'session s-1 01:10' },
    { what: 'a stale paused: stamp reads as Lachy\'s pause', evidence: '## Pause log, 2026-10-30' }]))])
  refused(h, ['close', '--span', sp.out, '--tasks-dir', h.tasks], /audit gap 1, 2 of 2026-11 have no decision task line from this Reflection: run decide\n$/)
  const d = ok(h, ['decide', '--span', sp.out, '--decisions', writeJson(sp.dir, 'd.json', {}), '--tasks-dir', h.tasks, '--now', '2026-11-05T13:00+11:00'])
  assert.match(d.stdout, /^decision task thread-skill-decisions-2026-11-05 \(new\)\n$/)
  const task = path.join(h.tasks, 'thread-skill-decisions-2026-11-05.md')
  const text = fs.readFileSync(task, 'utf8')
  const sec = section(text, new RegExp(`^## Reflection ${rid}$`))
  assert.match(sec, /^Monthly audit 2026-11 \(ADR 0051 d4\): what the Run record should have carried, read past it from 2026-10-21T13:00:00\.000Z to 2026-11-05T02:00:00\.000Z;/m)
  assert.match(sec, /^Found \(recorded\): stalls 0 h \(0 h\), quota-bound 0 h \(0 h\)/m)
  assert.match(sec, /^Sources: read transcripts, suite-logs, pause-logs; unread mac-history \(pmset -g log keeps two days\)$/m)
  assert.match(sec, /^- gap 1 2026-11: a lead question writes no line; evidence session s-1 01:10$/m)
  assert.match(sec, /^- gap 2 2026-11: a stale paused: stamp reads as Lachy's pause; evidence ## Pause log, 2026-10-30$/m)
  const before = sha(task)
  ok(h, ['decide', '--span', sp.out, '--decisions', writeJson(sp.dir, 'd.json', {}), '--tasks-dir', h.tasks, '--now', '2026-11-06T09:00+11:00'])
  assert.equal(sha(task), before, 'a re-run is byte-identical')
  ok(h, ['close', '--span', sp.out, '--tasks-dir', h.tasks])
  const c = closeLine(h, rid)
  assert.deepEqual([c.quiet, c.counts.rules], [true, 0], 'a gap-only reading closes quiet')
})

test('L7: with a rule item as well, the rule part and the audit part share one section, in that order', (t) => {
  const h = setup(t)
  const [rid, since, until, month] = MONTHS[0]
  const sp = handSpan(h, rid, { since, until, month, due: true, rollouts: ['a', 'b'] })
  ok(h, ['watch', '--span', sp.out, '--rollout', 'a', '--rollout', 'b', '--rule', 'orient § 5 grill', '--shape', 'a design fork asked mid-run', '--count', '2'])
  ok(h, ['ledger', '--span', sp.out, '--audit', writeJson(sp.dir, 'audit.json', AUDIT_DOC([]))])
  ok(h, ['decide', '--span', sp.out, '--decisions', writeJson(sp.dir, 'd.json', {}), '--tasks-dir', h.tasks, '--now', '2026-11-05T13:00+11:00'])
  const sec = section(fs.readFileSync(path.join(h.tasks, 'thread-skill-decisions-2026-11-05.md'), 'utf8'), new RegExp(`^## Reflection ${rid}$`))
  const lines = sec.split('\n')
  const rule = lines.findIndex((l) => /^- [0-9a-f]{8}: rule orient § 5 grill;/.test(l))
  const lead = lines.findIndex((l) => l.startsWith('Monthly audit 2026-11'))
  const gap = lines.findIndex((l) => l.startsWith('- gap 1 2026-11: '))
  assert.ok(rule > 0 && lead > rule && gap > lead, sec)
  assert.equal(lines[lead - 1], '', 'a blank line between the parts')
  ok(h, ['close', '--span', sp.out, '--tasks-dir', h.tasks])
  assert.equal(closeLine(h, rid).quiet, false)
})

test('L7: gaps never count against quiet: three gap-only readings move the cadence to 14; a new Watch is the control', (t) => {
  const h = setup(t)
  for (const [rid, since, until, month] of MONTHS) {
    const sp = handSpan(h, rid, { since, until, month, due: true })
    ok(h, ['ledger', '--span', sp.out, '--audit', writeJson(sp.dir, 'audit.json', AUDIT_DOC([], undefined, month))])
    ok(h, ['decide', '--span', sp.out, '--decisions', writeJson(sp.dir, 'd.json', {}), '--tasks-dir', h.tasks, '--now', until])
    ok(h, ['close', '--span', sp.out, '--tasks-dir', h.tasks])
    assert.equal(closeLine(h, rid).quiet, true, month)
  }
  const due = spawnSync('python3', ['-B', DUE, '--now', '2027-01-08T06:00+11:00'], { encoding: 'utf8', env: env(h) })
  assert.deepEqual([JSON.parse(due.stdout).cadence, JSON.parse(due.stdout).quietStreak], [14, 3])
  const rid = 'r-20270114T000000Z-000014'
  const sp = handSpan(h, rid, { since: '2027-01-07T02:00:00.000Z', until: '2027-01-14T02:00:00.000Z', month: '2027-01' })
  ok(h, ['ledger', '--span', sp.out])
  ok(h, ['watch', '--span', sp.out, '--rollout', 'a', '--rule', 'execute § 4.5', '--shape', 'a hand-back loses its answer', '--count', '1'])
  ok(h, ['close', '--span', sp.out, '--tasks-dir', h.tasks])
  assert.deepEqual([closeLine(h, rid).quiet, closeLine(h, rid).counts.newWatches], [false, 1])
})

test('L8: close, knobs and decide refuse with run ledger; a re-run of ledger prints exists; --dry-run writes nothing', (t) => {
  const h = setup(t)
  const rid = 'r-20260915T000000Z-000021'
  const sp = handSpan(h, rid, { since: '2026-09-08T00:00:00.000Z', until: '2026-09-15T00:00:00.000Z', month: '2026-09' })
  refused(h, ['close', '--span', sp.out], new RegExp(`^reflect: Reflection ${rid} is not closed: no Time-lost ledger line from this Reflection: run ledger\\n$`))
  refused(h, ['knobs', '--span', sp.out], new RegExp(`^reflect: Reflection ${rid} has no Time-lost ledger line: run ledger`))
  refused(h, ['decide', '--span', sp.out, '--tasks-dir', h.tasks], new RegExp(`^reflect: Reflection ${rid} has no Time-lost ledger line: run ledger .*: nothing written\\n$`))
  const dry = ok(h, ['ledger', '--span', sp.out, '--dry-run'])
  assert.match(dry.stdout, /^would write time-lost: .*"source": "baseline"/m)
  assert.match(dry.stdout, /^dry run, nothing written: ledger r-20260915T000000Z-000021: no time lost of 0 h; baseline 2026-10, record written$/m)
  assert.equal(sha(reflectionsFile(h)), 'absent')
  ok(h, ['ledger', '--span', sp.out])
  assert.equal(ok(h, ['ledger', '--span', sp.out]).stdout, `exists ledger ${rid}\n`)
  ok(h, ['knobs', '--span', sp.out])
  ok(h, ['close', '--span', sp.out])
  refused(h, ['ledger', '--span', sp.out], /is closed: nothing written/)
  // a span from before p29-11 (no ledger block) is refused by ledger, and closes as before
  const old = writeJson(h.out, 'old.json', { reflection: 'r-20260922T000000Z-000022', since: '2026-09-15T00:00:00.000Z', until: '2026-09-22T00:00:00.000Z', rollouts: [] })
  refused(h, ['ledger', '--span', old], /has no ledger block \(a span from before p29-11\)/)
  ok(h, ['close', '--span', old])
})

// The order a decide before ledger broke: watch, decide (its section appended once, with the rule item), then ledger with
// a gap, and close refused for good, since a re-run of decide finds the heading and appends nothing.
test('L8: decide before ledger is refused with the vault untouched; in order, the rule item and the gap share the section and close passes', (t) => {
  const h = setup(t)
  const [rid, since, until, month] = MONTHS[0]
  const sp = handSpan(h, rid, { since, until, month, due: true, rollouts: ['a', 'b'] })
  ok(h, ['watch', '--span', sp.out, '--rollout', 'a', '--rollout', 'b', '--rule', 'orient § 5 grill', '--shape', 'a design fork asked mid-run', '--count', '2'])
  const decide = ['decide', '--span', sp.out, '--decisions', writeJson(sp.dir, 'd.json', {}), '--tasks-dir', h.tasks, '--now', '2026-11-05T13:00+11:00']
  const vault = () => fs.readdirSync(h.tasks).filter((f) => f.endsWith('.md'))
  refused(h, decide, new RegExp(`^reflect: Reflection ${rid} has no Time-lost ledger line: run ledger \\(its Watch and the Monthly audit's gaps reach the decision task through it\\): nothing written\\n$`))
  assert.deepEqual(vault(), [], 'no decision task written')
  ok(h, ['ledger', '--span', sp.out, '--audit', writeJson(sp.dir, 'audit.json', AUDIT_DOC([]))])
  ok(h, ['knobs', '--span', sp.out])
  ok(h, decide)
  const sec = section(fs.readFileSync(path.join(h.tasks, 'thread-skill-decisions-2026-11-05.md'), 'utf8'), new RegExp(`^## Reflection ${rid}$`))
  assert.match(sec, /^- [0-9a-f]{8}: rule orient § 5 grill;/m)
  assert.match(sec, /^- gap 1 2026-11: a lead question writes no Run-record line; evidence /m)
  ok(h, ['close', '--span', sp.out, '--tasks-dir', h.tasks])
})

// p39-14 (ADR 0070 d5): a take-out moves its task's set-aside (a dependant's included), and a wait it ends is priced
// stalls/take-out, unflagged: the engine took the task out, nobody was asked. A dependant's line never ends the wait by
// itself, but its set-aside has its mover, so it never reads `still waiting`.
test('L9: a take-out ends a wait as stalls/take-out, unflagged; a taken-out dependant is moved, never still waiting', (t) => {
  const h = setup(t)
  const ms = (hm) => Date.parse(T('06', hm))
  const base = [
    [ms('01:00'), 1, { kind: 'set-aside', task: 'x', reasonClass: 'review-rounds' }],
    [ms('01:00'), 2, { kind: 'set-aside', task: 'y', reasonClass: 'needs-human' }],
    [ms('02:00'), 3, { kind: 'take-out', task: 'y', cause: 'dependant', with: 'x', fingerprint: 'abcdef012345' }],
    [ms('02:30'), 4, { kind: 'take-out', task: 'x', cause: 'spent', fingerprint: 'abcdef012345', stage: 'review', overtimeUsed: 3, overtimeBudget: 3 }],
  ]
  const read = (expr, rows) => py(h, LEDGER, expr, { base: rows, a: ms('01:00'), b: ms('03:00'), hi: ms('05:00') })
  const B = '[tuple(r) for r in a["base"]]'
  assert.deepEqual(read(`m.classify_wait(${B}, a["a"], a["b"], a["hi"])`, base), ['stalls', 'take-out', null], 'the task\'s take-out ends the wait')
  assert.deepEqual(read(`[m.first_mover(${B}, 1, "y", a["hi"])[0], list(m.mover_cause("take-out", None, None))]`, base),
    ['take-out', ['stalls', 'take-out']], 'the dependant\'s set-aside is moved by its own take-out line')
  const depOnly = base.slice(0, 3)
  const [, , flag] = read(`m.classify_wait(${B}, a["a"], a["b"], a["hi"])`, depOnly)
  assert.ok(!/still waiting: \[\[y\]\]/.test(flag ?? ''), `a taken-out dependant never reads still waiting: ${flag}`)
})
