// skills/reflect/scripts/ledger.py and reflect.py's Time-lost ledger (p29-11, ADR 0051), part 1 of 2: the hours each
// cause class cost, summed from the Run record across every rollout and ranked by cause (L1, G1, and HALT_WAITS
// against execute's SKILL § 7), and trended week on week, where a class that tops it two readings running opens a
// Watch counted in readings (L2-L4). A load-topped ledger holding a Parallel ceiling raise, the Monthly audit on the
// month's first reading, before its ledger, and its gaps in the decision task, never against `quiet`, are the -audit
// part's. Every rule lives in ledger.py's docstring (the model), reflect.py's and run_record.py's; this pins the
// behaviour. tests/lib/reflect-ledger-fixtures.mjs holds the fixtures both parts use, and says how each case stays
// hermetic.
// Reach (tests/fast-tier.map): each part names every script the unsplit file named, so each runs on the changes it
// did: contract-text.mjs land.sh ledger.py reflect-due.py reflect.py run_record.py score.py tune.py.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { section } from './lib/contract-text.mjs'
import { root, LEDGER, RUN_RECORD, setup, reflect, ok, refused, rlines, tl, emitAll, py, rolloutNote, done, ledgerCli,
  S, T, idle, H0, CLASSES, FIXTURE, LSINCE, LUNTIL, SERIAL_LEFT_OUT, fixture, span, stallDay,
  closeLine } from './lib/reflect-ledger-fixtures.mjs'

const EXECUTE_SKILL = path.join(root, 'skills', 'execute', 'SKILL.md')

// ---- L1: the ledger sums fixture records across rollouts by class and ranks them ------------------------------------

test('ledger.py parses as python 3.9', () => {
  const r = spawnSync('python3', ['-B', '-c', 'import ast, sys\nast.parse(open(sys.argv[1]).read(), sys.argv[1], feature_version=(3, 9))', LEDGER], { encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
})

test('L1: the ledger sums fixture records across rollouts by class and cause, ranks them by cause and names each class\'s contributors', (t) => {
  const h = setup(t)
  fixture(h)
  const b = ledgerCli(h, LSINCE, LUNTIL)
  const row = b.row
  assert.deepEqual(row.hours, { stalls: 30.25, 'quota-bound': 1, load: 2.25, 'lane-bound': 3.5, rework: 1.5, 'plan-rejected': 1 }, JSON.stringify(row.byCause))
  assert.deepEqual(row.byCause, {
    stalls: { 'cool-down': 0.25, 'dead-lead': 2, gate: 4, halt: 3, 'hand-back': 1, 'hold-git-env': 5, 'hold-merge': 1, 'hold-race': 1,
      'hold-trickle': 1, 'lead-absent': 1.5, 'mac-sleep': 1, question: 8, unexplained: 1, watchdog: 0.5 },
    'quota-bound': { 'cool-down': 0.5, 'usage-limit': 0.5 },
    load: { heat: 0.5, 'hold-heat': 1, 'slot-wait': 0.25, timeout: 0.5 },
    'lane-bound': { lane: 3.5 },
    rework: { integration: 1, race: 0.5 },
    'plan-rejected': { 'plan-rejected': 1 },
  })
  assert.deepEqual(row.other, { pause: 0.5, revise: 0.5 }, 'the soft pause and the revise are reported, never ranked')
  assert.equal(row.top, 'stalls')
  assert.deepEqual(b.ranking, ['stalls', 'lane-bound', 'load', 'rework', 'quota-bound', 'plan-rejected'], 'a tie below the top keeps the class order')
  assert.deepEqual(row.rollouts.stalls, [['l-waits', 12], ['l-remainder', 3.75], ['l-caps', 3], ['l-holds', 3], ['l-live', 3], ['l-stops', 3],
    ['l-ledger-only', 2], ['l-lane', 0.5]], 'ranked by hours, then slug, at most 8')
  assert.deepEqual(row.rollouts['lane-bound'], [['l-lane', 2], ['l-holds', 1.5]], 'the stop and the rework leave the lane; the pause does too')
  assert.deepEqual(row.rollouts['quota-bound'], [['l-remainder', 0.5], ['l-stops', 0.5]])
  assert.deepEqual(row.rollouts.load, [['l-caps', 2], ['l-lane', 0.25]])
  assert.deepEqual(row.events, { 'base-moved': 1, 'base-moved-inert': 1, 'quota-stall': 1, stopped: 10 })
  const flags = b.flags.join('\n')
  assert.match(flags, /\[\[l-remainder\]\]: the wait at 2026-10-06T01:00:00\.000Z: \[\[f1\]\] moved on with no recorded mover/)
  assert.match(flags, /\[\[l-waits\]\]: the halt at 2026-10-06T08:00:00\.000Z: a wait over set-asides of different reasonClasses \(gate, review-rounds\) is classed by the first moved \(\[\[e2\]\], gate\)/)
  assert.match(flags, /\[\[l-live\]\]: the wait at 2026-10-11T21:00:00\.000Z: still waiting: \[\[g1\]\]'s needs-human set-aside/)
  assert.match(flags, /\[\[l-waits\]\]: a halt at 2026-10-06T15:00:00\.000Z whose reason no HALT_WAITS prefix matches/)
  assert.ok(!b.flags.some((f) => /l-waits.*the halt at 2026-10-06T01:00/.test(f)), 'a question over one set-aside is no mixed wait')
  // the live serial chain is in none of the hours above, and flagged
  assert.ok(b.flags.includes(SERIAL_LEFT_OUT), flags)
  assert.ok(!CLASSES.some((c) => row.rollouts[c].some(([slug]) => slug === 'l-serial')) && !b.intervals.some((i) => i.rollout === 'l-serial'))
  // the leads the Monthly audit starts from
  assert.deepEqual(b.leads.filter((l) => l.kind !== 'pause').map((l) => [l.rollout, l.kind, l.hours]), [['l-remainder', 'lead-absent', 1.5], ['l-remainder', 'unexplained', 1]])
  // the record line it would write passes run_record
  py(h, RUN_RECORD, 'm.check(None, "time-lost", None, dict(a, reflection="r-x", id="tl-record-x")) or True', row)
})

// G1 (ADR 0064): an origin yield's gap is lane-bound/lane, never stalls. x runs a Slot 01:00-02:00, integrates from 02:00,
// yields the origin lane at 02:20 (lane-freed release=origin), takes it again at 02:50 and merges at 03:00. Control: the
// same lane hours as two tasks with no yield leave the gap outside the lane, as today.
function yieldRecord(gap) {
  const base = [[T('06', '01:00'), 'slot-taken', 'x', S('start')], [T('06', '01:00'), 'run-bound', 'x', { runId: 'w-x', journalDir: '/j', call: 'task' }],
    [T('06', '02:00'), 'slot-freed', 'x', { outcome: 'ready' }], [T('06', '02:00'), 'ready', 'x', { pr: 1 }]]
  if (gap === 'origin') {
    return [...base, [T('06', '02:00'), 'lane-taken', 'x', {}], [T('06', '02:20'), 'lane-freed', 'x', { release: 'origin', origin: 'o/r' }],
      [T('06', '02:50'), 'lane-taken', 'x', {}], [T('06', '03:00'), 'lane-freed', 'x', { release: 'merge', path: 'lead', triggers: [], conflict: false }],
      [T('06', '03:00'), 'merged', 'x', { pr: 1 }]]
  }
  return [...base, [T('06', '02:00'), 'lane-taken', 'x', {}], [T('06', '02:20'), 'lane-freed', 'x', { release: 'merge', path: 'lead', triggers: [], conflict: false }],
    [T('06', '02:20'), 'merged', 'x', { pr: 1 }], [T('06', '02:50'), 'lane-taken', 'y', {}],
    [T('06', '03:00'), 'lane-freed', 'y', { release: 'merge', path: 'lead', triggers: [], conflict: false }], [T('06', '03:00'), 'merged', 'y', { pr: 2 }]]
}

test('G1: an origin yield\'s gap is priced lane-bound/lane, so stalls/unexplained stays 0; with no yield the gap is no lane time', (t) => {
  const h = setup(t)
  emitAll(h, 'g-yield', yieldRecord('origin'))
  done(h, 'g-yield')
  const b = ledgerCli(h, LSINCE, LUNTIL)
  assert.equal(b.row.byCause['lane-bound']?.lane, 1, 'the holdings (30 min) and the yield\'s gap (30 min): one hour of lane')
  assert.equal(b.row.byCause.stalls?.unexplained ?? 0, 0, 'the gap never reads as stalls/unexplained')
  const c = setup(t)
  emitAll(c, 'g-plain', yieldRecord('plain'))
  done(c, 'g-plain')
  const bc = ledgerCli(c, LSINCE, LUNTIL)
  assert.equal(bc.row.byCause['lane-bound']?.lane, 0.5, 'control: two separate tasks hold the lane 30 minutes between them')
})

test('L1 controls: a sign-off pause re-moded hard moves its 2 h to other; a quota cool-down re-classed infra moves to stalls', (t) => {
  const h = setup(t)
  fixture(h, { 'l-caps': FIXTURE['l-caps'].map((e) => (e[1] === 'paused' ? [e[0], 'paused', null, { mode: 'hard' }] : e)) })
  const b = ledgerCli(h, LSINCE, LUNTIL)
  assert.deepEqual([b.row.hours.stalls, b.row.byCause.stalls.gate, b.row.other.pause], [28.25, 2, 2.5])
  const h2 = setup(t)
  fixture(h2, { 'l-remainder': FIXTURE['l-remainder'].map((e) => (e[2] === 'f5' && e[1] === 'set-aside' ? [e[0], e[1], e[2], { ...e[3], reasonClass: 'transient' }]
    : e[2] === 'f5' && e[1] === 'auto-retry' ? [e[0], e[1], e[2], { stage: 'implement', setAsideAt: 'run', retryClass: 'infra', used: 1, budget: 2 }] : e)) })
  const c = ledgerCli(h2, LSINCE, LUNTIL)
  assert.deepEqual([c.row.hours['quota-bound'], c.row.byCause['quota-bound'], c.row.byCause.stalls['cool-down'], c.row.hours.stalls],
    [0.5, { 'usage-limit': 0.5 }, 0.75, 30.75])
})

test('L1 (p54-14): the soft pause re-moded catch-up moves its 0.5 h to other.catch-up, every class unchanged; one before since adds nothing', (t) => {
  const h = setup(t)
  fixture(h, { 'l-holds': FIXTURE['l-holds'].map((e) => (e[1] === 'paused' ? [e[0], 'paused', null, { mode: 'catch-up' }] : e)) })
  const b = ledgerCli(h, LSINCE, LUNTIL)
  assert.deepEqual(b.row.other, { 'catch-up': 0.5, revise: 0.5 }, 'an Engine catch-up is the engine\'s own pause, never his')
  assert.deepEqual(b.row.rollouts['lane-bound'], [['l-lane', 2], ['l-holds', 1.5]], 'still subtracted from the lane, as his pause is')
  assert.deepEqual(b.row.hours, { stalls: 30.25, 'quota-bound': 1, load: 2.25, 'lane-bound': 3.5, rework: 1.5, 'plan-rejected': 1 })
  const h2 = setup(t)
  emitAll(h2, 'l-early', [[T('04', '00:00'), 'paused', null, { mode: 'catch-up' }], [T('04', '02:00'), 'resumed', null, {}]])
  done(h2, 'l-early')
  assert.equal(ledgerCli(h2, LSINCE, LUNTIL).row.other['catch-up'] ?? 0, 0, 'a catch-up pause before since adds nothing')
})

test('L1 (p55-5): the soft pause re-moded hand-over moves its 0.5 h to other.hand-over, every class unchanged; a hand-over-drain marker is other; one before since adds nothing', (t) => {
  const h = setup(t)
  fixture(h, {
    'l-holds': FIXTURE['l-holds'].map((e) => (e[1] === 'paused' ? [e[0], 'paused', null, { mode: 'hand-over' }] : e)),
    'l-caps': FIXTURE['l-caps'].map((e) => (e[1] === 'idle-slots' && e[3].reason === 'hold-trickle' ? [e[0], e[1], e[2], idle('hand-over-drain')] : e)),
  })
  const b = ledgerCli(h, LSINCE, LUNTIL)
  assert.deepEqual([b.row.other['hand-over'], b.row.other['hand-over-drain'], b.row.other.pause ?? 0], [0.5, 1, 0],
    'a Lead hand-over and its drain are the engine\'s own, never his pause and never a stall')
  assert.deepEqual(b.row.rollouts['lane-bound'], [['l-lane', 2], ['l-holds', 1.5]], 'still subtracted from the lane, as his pause is')
  assert.deepEqual(b.row.hours, { stalls: 29.25, 'quota-bound': 1, load: 2.25, 'lane-bound': 3.5, rework: 1.5, 'plan-rejected': 1 },
    'every class unchanged but the hour the drain marker took out of stalls')
  const h2 = setup(t)
  emitAll(h2, 'l-early', [[T('04', '00:00'), 'paused', null, { mode: 'hand-over' }], [T('04', '02:00'), 'resumed', null, {}]])
  done(h2, 'l-early')
  assert.equal(ledgerCli(h2, LSINCE, LUNTIL).row.other['hand-over'] ?? 0, 0, 'a hand-over pause before since adds nothing')
})

test('L1 controls (p36-7): the hold-heat stretch re-marked hold-quota (the quota hold) moves its 1 h from load to quota-bound', (t) => {
  const h = setup(t)
  fixture(h, { 'l-caps': FIXTURE['l-caps'].map((e) => (e[1] === 'idle-slots' && e[3].reason === 'hold-heat' ? [e[0], e[1], e[2], idle('hold-quota')] : e)) })
  const b = ledgerCli(h, LSINCE, LUNTIL)
  assert.equal(b.row.byCause['quota-bound']['hold-quota'], 1, 'the quota hold is quota-bound')
  assert.equal(b.row.byCause.load['hold-heat'] ?? 0, 0, 'and no longer load')
})

test('L1: a stop open across a window with no line in it is counted on a live rollout, to until; archived, it ends at its last line', (t) => {
  const h = setup(t)
  emitAll(h, 'l-open', [
    [T('04', '00:00'), 'slot-taken', 'h1', S('start')],
    [T('04', '01:00'), 'slot-freed', 'h1', { outcome: 'ready' }],
    [T('04', '02:00'), 'stopped', null, { cause: 'watchdog', inferred: false, calls: [] }],
  ])
  rolloutNote(h, 'l-open')
  const live = ledgerCli(h, LSINCE, LUNTIL)
  assert.deepEqual([live.row.hours.stalls, live.row.byCause.stalls, live.row.top], [168, { watchdog: 168 }, 'stalls'])
  assert.ok(live.flags.some((f) => /\[\[l-open\]\]: a watchdog stop at 2026-10-04T02:00:00\.000Z is still open at the record's end: it runs to until/.test(f)), live.flags.join('\n'))
  fs.rmSync(path.join(h.tasks, 'l-open.md'))
  done(h, 'l-open')
  const closed = ledgerCli(h, LSINCE, LUNTIL)
  assert.deepEqual([closed.row.hours, closed.row.top], [H0, null], 'archived: the stop ends at the last line, before the window')
})

// p46-2: fold-journals writes role-call lines after the fact, as it writes call-journal lines: never a record's tail.
test('L1: a role-call line is never the tail: an archived rollout\'s open stop still ends at its last real line', (t) => {
  const h = setup(t)
  const role = { runId: 'wf_h1', startTime: Date.parse(T('04', '00:00')), call: 'task', role: 'builder', model: 'opus', effort: 'high', dispatches: 1, outcome: 'review' }
  emitAll(h, 'l-role', [
    [T('04', '00:00'), 'slot-taken', 'h1', S('start')],
    [T('04', '01:00'), 'slot-freed', 'h1', { outcome: 'ready' }],
    [T('04', '02:00'), 'stopped', null, { cause: 'watchdog', inferred: false, calls: [] }],
    [T('06', '03:00'), 'role-call', 'h1', role],
  ])
  done(h, 'l-role')
  const closed = ledgerCli(h, LSINCE, LUNTIL)
  assert.deepEqual([closed.row.hours, closed.row.top], [H0, null], 'the stop ends at the stopped line, never at the fold')
})

for (const reasonClass of ['no-runner', 'unreported-context']) {
  test(`L1: a wait still open on a ${reasonClass} set-aside reads stalls/cool-down, never a hand-back`, (t) => {
    const h = setup(t)
    emitAll(h, 'l-github', [
      [T('11', '20:00'), 'slot-taken', 'n1', S('start')],
      [T('11', '21:00'), 'set-aside', 'n1', { stage: 'integrate', reasonClass, setAsideAt: 'integration' }],
      [T('11', '21:00'), 'slot-freed', 'n1', { outcome: 'set-aside' }],
      [T('11', '21:00'), 'idle-slots', null, idle('awaiting-hand-back')],
    ])
    rolloutNote(h, 'l-github')
    const b = ledgerCli(h, LSINCE, LUNTIL)
    assert.deepEqual(b.row.byCause.stalls, { 'cool-down': 3 }, b.flags.join('\n'))
  })
}

// p46-3 (ADR 0079 d7): an allowance block writes no quota-stall and retries as quota, so its wait is quota-bound whether it
// still waits (its reasonClass) or an auto-retry with retryClass quota moved it.
test('L1: an allowance set-aside\'s wait is quota-bound/cool-down, still waiting or moved by its quota auto-retry', (t) => {
  for (const [name, moved, want] of [['still waiting', [], 3], ['moved by its quota auto-retry', [
    [T('11', '22:30'), 'auto-retry', 'w1', { stage: 'implement', setAsideAt: 'run', retryClass: 'quota', used: 0, budget: 2, quotaRetries: 1 }],
    [T('11', '22:30'), 'slot-taken', 'w1', S('hand-back')],
  ], 1.5]]) {
    const h = setup(t)
    emitAll(h, 'l-allow', [
      [T('11', '20:00'), 'slot-taken', 'w1', S('start')],
      [T('11', '21:00'), 'set-aside', 'w1', { stage: 'implement', reasonClass: 'allowance', setAsideAt: 'run' }],
      [T('11', '21:00'), 'slot-freed', 'w1', { outcome: 'set-aside' }],
      [T('11', '21:00'), 'idle-slots', null, idle('awaiting-hand-back')],
      ...moved,
    ])
    rolloutNote(h, 'l-allow')
    const b = ledgerCli(h, LSINCE, LUNTIL)
    assert.deepEqual(b.row.byCause['quota-bound'], { 'cool-down': want }, `${name}: ${b.flags.join('\n')}`)
    const stalls = b.row.byCause.stalls || {}
    assert.ok(!('cool-down' in stalls) && !('hand-back' in stalls), `${name}: never stalls: ${JSON.stringify(b.row.byCause)}`)
  }
})

test('L1 controls: a live serial chain and a superseding rollout not yet run price 0 h, flagged; re-shaped parallel, the chain prices from its first engine line; the carried rollout from its first Slot', (t) => {
  const h = setup(t)
  emitAll(h, 'l-serial', FIXTURE['l-serial'])
  rolloutNote(h, 'l-serial', { shape: 'serial' })
  // a supersede's carry, written at schedule time: the new rollout's note open, its record a carried line alone
  emitAll(h, 'l-super', [[T('08', '00:00'), 'carried', 'u1', { from: 'l-old' }]])
  rolloutNote(h, 'l-super', { status: 'open' })
  const b = ledgerCli(h, LSINCE, LUNTIL)
  assert.deepEqual([b.row.hours, b.row.top, b.intervals], [H0, null, []], JSON.stringify(b.row.byCause))
  assert.ok(b.flags.includes(SERIAL_LEFT_OUT), b.flags.join('\n'))
  assert.ok(b.flags.includes('[[l-super]]: no engine line yet (acts or carried lines alone): nothing priced'), b.flags.join('\n'))
  // archived, the chain is still left out (a closed chain's record is no parallel rollout's either)
  fs.rmSync(path.join(h.tasks, 'l-serial.md'))
  rolloutNote(h, 'l-serial', { status: 'done', archived: true, shape: 'serial' })
  assert.deepEqual(ledgerCli(h, LSINCE, LUNTIL).row.hours, H0)
  // the controls: the same record under a parallel note is priced from its first engine line (the suite at 07 02:00, not
  // the gate-signed at 00:00) to until, nothing running: 118 h of stalls; the carried rollout, once it takes a Slot
  // (11 00:00 .. 01:00), from that Slot to until: 23 h, never from its carry on the 8th
  fs.rmSync(path.join(h.tasks, 'Archive', 'Rollouts', 'l-serial.md'))
  rolloutNote(h, 'l-serial')
  emitAll(h, 'l-super', [[T('11', '00:00'), 'slot-taken', 'u1', S('start')], [T('11', '01:00'), 'slot-freed', 'u1', { outcome: 'ready' }]])
  const c = ledgerCli(h, LSINCE, LUNTIL)
  assert.deepEqual(c.row.rollouts.stalls, [['l-serial', 118], ['l-super', 23]], JSON.stringify(c.row.byCause))
  assert.ok(c.flags.includes('[[l-serial]]: no slot-taken: its live span starts at its first engine line (a suite-started at 2026-10-07T02:00:00.000Z)'), c.flags.join('\n'))
})

test('HALT_WAITS: each prefix is a reason="<prefix> of execute\'s SKILL § 7; a renamed reason fails the pin', (t) => {
  const h = setup(t)
  const waits = py(h, LEDGER, '[p for p, _c in m.HALT_WAITS]')
  assert.deepEqual(waits, ['nothing can start:', 'RACE undecided:', 'UNVERIFIED undecided:', 'git-env trip:', 'git-env canary failed', 'awaiting sign-off:'])
  const s7 = section(fs.readFileSync(EXECUTE_SKILL, 'utf8'), /^### 7\. /)
  assert.ok(s7, 'execute § 7')
  const unpinned = (text) => waits.filter((w) => !text.includes(`reason="${w}`))
  assert.deepEqual(unpinned(s7), [])
  assert.deepEqual(unpinned(s7.replace('reason="nothing can start:', 'reason="nothing could start:')), ['nothing can start:'], 'the control')
})

// ---- the readings: real spans, then the writers -------------------------------------------------------------------------

// Reading k's window: a week of September 2026 (before the baseline's end, so no audit is due).
const WEEK = (k) => {
  const d = (n) => new Date(Date.UTC(2026, 8, n)).toISOString()
  return { since: d(1 + 7 * (k - 1)), until: d(8 + 7 * (k - 1)), day: d(3 + 7 * (k - 1)).slice(0, 10) }
}

// A whole reading on a stall-topped rollout of its own: span, ledger, decide ({} decisions), close. Returns the span.
function reading(h, k, { decide = true } = {}) {
  const w = WEEK(k)
  stallDay(h, `w${k}`, w.day)
  const sp = span(h, w.since, w.until)
  ok(h, ['ledger', '--span', sp.out])
  ok(h, ['attention', '--span', sp.out]) // p30-7: step 13b, before decide and close
  if (decide) {
    const dec = path.join(sp.dir, 'decisions.json')
    fs.writeFileSync(dec, '{}')
    sp.decide = ok(h, ['decide', '--span', sp.out, '--decisions', dec, '--tasks-dir', h.tasks, '--now', w.until]).stdout
  }
  sp.close = ok(h, ['close', '--span', sp.out]).stdout
  return sp
}

const STALLS_WID = (h) => py(h, LEDGER, 'm.watch_id("stalls")')

test('L2: the trend reads persisted rows, not re-summed records; an audit row sits in weeks with its recorded and missed, never as previous', (t) => {
  const h = setup(t)
  const RA = 'r-20260901T000000Z-00000a'
  const RB = 'r-20260905T000000Z-00000b'
  const RC = 'r-20260907T000000Z-00000c'
  const line = (rid, source, hours, extra) => [WEEK(1).until, 'time-lost', null, { id: `tl-${source}-${rid.slice(2)}`, source, reflection: rid,
    since: WEEK(1).since, until: WEEK(1).until, hours: { ...H0, ...hours }, ...extra }, null]
  // RA's row says 99 h of stalls; no record holds that week, so a re-sum would read 0
  emitAll(h, null, [line(RA, 'record', { stalls: 99 }, { top: 'stalls', month: '2026-09' }),
    line(RB, 'audit', { 'lane-bound': 40 }, { month: '2026-09', recorded: { ...H0, stalls: 5, 'lane-bound': 10 }, rank: ['lane-bound', 'stalls', 'quota-bound', 'load', 'rework', 'plan-rejected'],
      audit: { sources: [{ source: 'transcripts', read: true }], entries: [], gaps: [] } }),
    line(RC, 'record', { 'lane-bound': 3 }, { top: 'lane-bound', month: '2026-09' })])
  stallDay(h, 'w2', WEEK(2).day)
  const { s } = span(h, WEEK(2).since, WEEK(2).until)
  const L = s.ledger
  assert.deepEqual(L.weeks.map((w) => [w.source, w.reflection]), [['record', RA], ['audit', RB], ['record', RC], ['record', s.reflection]])
  assert.deepEqual([L.weeks[0].hours.stalls, L.weeks[0].top], [99, 'stalls'], 'the persisted row, not a re-sum')
  assert.deepEqual([L.weeks[1].hours['lane-bound'], L.weeks[1].recorded['lane-bound'], L.weeks[1].missed['lane-bound'], L.weeks[1].missed.stalls, L.weeks[1].missed.load],
    [40, 10, 0.8, 0, null], 'found / (found + recorded), per class')
  assert.deepEqual([L.previous.reflection, L.previous.source], [RC, 'record'], 'previous skips the audit row')
  assert.deepEqual([L.delta.stalls, L.delta['lane-bound']], [2, -3])
  assert.deepEqual([L.row.top, L.streak], ['stalls', 1], 'RC topped lane-bound: the streak starts again')
})

test('L3 and L4: the baseline seeds once; a class topping two readings running opens a Watch counted in readings, which recurs into a rule item, closes on a no and returns two readings later', (t) => {
  const h = setup(t)
  const r1 = reading(h, 1)
  assert.deepEqual([r1.s.ledger.baseline.id, r1.s.ledger.baseline.month, r1.s.ledger.baseline.since, r1.s.ledger.baseline.until],
    ['tl-baseline-2026-10', '2026-10', '2026-08-31T14:00:00.000Z', '2026-10-21T13:00:00.000Z'])
  assert.deepEqual([r1.s.ledger.baseline.ranges[0].low, r1.s.ledger.baseline.ranges[0].high, r1.s.ledger.baseline.top], [150, 185, 'stalls'])
  assert.deepEqual([r1.s.ledger.row.top, r1.s.ledger.watch.sighted], ['stalls', false])
  assert.equal(rlines(h).filter((l) => l.kind === 'watch').length, 0, 'reading 1: no Watch')
  const wid = STALLS_WID(h)
  // reading 2: the Watch opens, new, so not quiet, and no decision task alone
  const r2 = reading(h, 2)
  assert.equal(r2.s.ledger.watch.sighted, true)
  const w2 = rlines(h).filter((l) => l.kind === 'watch')
  assert.deepEqual(w2.map((l) => [l.id, l.ledgerClass, l.count, l.rollouts, l.reflection, l.shape]),
    [[wid, 'stalls', 1, ['w2'], r2.s.reflection, 'stalls tops the Time-lost ledger']])
  assert.equal(r2.decide, 'no rule proposal or held trade: no decision task\n')
  assert.deepEqual([closeLine(h, r2.s.reflection).counts.newWatches, closeLine(h, r2.s.reflection).quiet], [1, false])
  // reading 3: it recurs (two readings), and decide writes the rule item
  const r3 = reading(h, 3)
  assert.match(r3.decide, /^decision task thread-skill-decisions-2026-09-22 /)
  const task = path.join(h.tasks, 'thread-skill-decisions-2026-09-22.md')
  assert.match(fs.readFileSync(task, 'utf8'), new RegExp(`^- ${wid}: rule ADR 0051: a class that tops the Time-lost ledger two readings running; shape stalls tops the Time-lost ledger; rollouts \\[\\[w2\\]\\], \\[\\[w3\\]\\]`, 'm'))
  assert.equal(closeLine(h, r3.s.reflection).counts.rules, 1)
  // a plain raise of a one-reading Watch is refused in readings' words; Lachy's no closes the cycle
  ok(h, ['raised', '--watch', wid, '--reflection', r3.s.reflection, '--declined'])
  fs.writeFileSync(task, fs.readFileSync(task, 'utf8').replace('status: open', 'status: done'))
  // reading 4: a new cycle of one reading: not new, not offered
  const r4 = reading(h, 4)
  assert.equal(r4.decide, 'no rule proposal or held trade: no decision task\n')
  assert.deepEqual([closeLine(h, r4.s.reflection).counts.newWatches, closeLine(h, r4.s.reflection).counts.rules], [0, 0])
  const one = reflect(h, ['raised', '--watch', wid, '--reflection', r4.s.reflection])
  assert.equal(one.status, 2)
  assert.match(one.stderr, /^reflect: Watch \S+ is seen in one reading: a plain raise needs two/)
  // reading 5: two later readings show it again: a rule item again
  const r5 = reading(h, 5)
  assert.equal(closeLine(h, r5.s.reflection).counts.rules, 1)
  assert.ok(rlines(h).some((l) => l.kind === 'proposal' && l.altitude === 'rule' && l.id === wid && l.reflection === r5.s.reflection))
  assert.equal(tl(h, 'baseline').length, 1, 'the baseline line is written once')
  assert.deepEqual(tl(h, 'record').map((l) => l.streak), [1, 2, 3, 4, 5])
  // the model never writes the ledger's Watch
  refused(h, ['watch', '--span', r5.out, '--rollout', 'w5', '--rule', 'ADR 0051: a class that tops the Time-lost ledger two readings running',
    '--shape', 'stalls tops the Time-lost ledger', '--count', '1'], /is reflect\.py ledger's alone/)
})

test('L4: an audit row between two readings never moves the top or the Watch; the same hours as a record row do', (t) => {
  const audit = (rid) => [WEEK(2).since, 'time-lost', null, { id: `tl-audit-${rid.slice(2)}`, source: 'audit', reflection: rid, since: WEEK(1).until,
    until: WEEK(2).since, month: '2026-09', hours: { ...H0, 'lane-bound': 40 }, recorded: H0, rank: ['lane-bound', 'stalls', 'quota-bound', 'load', 'rework', 'plan-rejected'],
    audit: { sources: [{ source: 'transcripts', read: true }], entries: [], gaps: [] } }, null]
  const record = (rid) => [WEEK(2).since, 'time-lost', null, { id: `tl-record-${rid.slice(2)}`, source: 'record', reflection: rid, since: WEEK(1).until,
    until: WEEK(2).since, month: '2026-09', hours: { ...H0, 'lane-bound': 40 }, top: 'lane-bound' }, null]
  const RX = 'r-20260908T000000Z-0000ff'
  for (const [insert, opens] of [[audit, true], [record, false]]) {
    const h = setup(t)
    reading(h, 1, { decide: false })
    emitAll(h, null, [insert(RX)])
    const r2 = reading(h, 2, { decide: false })
    assert.equal(r2.s.ledger.row.top, 'stalls')
    assert.deepEqual([r2.s.ledger.watch.sighted, r2.s.ledger.streak], opens ? [true, 2] : [false, 1])
    assert.equal(rlines(h).filter((l) => l.kind === 'watch' && l.ledgerClass === 'stalls').length, opens ? 1 : 0, insert.name)
  }
})
