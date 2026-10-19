// skills/reflect/scripts/serial-score.py — a serial rollout's chain of Legs scored for its close line (p24-4, ADR 0040):
// the window and running time from the Leg log (read through leg.py status, every stamp converted to UTC Z), merges,
// throughput, the Hands-off rate from the Run record's acts and halt clears, Quality from `fixes:` only (always
// partial), and the parallel-only keys null and flagged.
//
// Hermetic: each case gets its own mkdtemp HOME (its own THREAD_EVENTS_DIR under it), an env built from scratch with
// TZ=Australia/Melbourne (so a stamp written with +11:00 must still print as UTC Z), the serial note and its task notes
// at <HOME>/repos/obsidian/Work/Tasks/, and its Leg log written in leg.py's line forms (tests/leg.test.sh builds such
// logs through the verbs; here the stamps must be exact). Acts go through run_record.py's own emit.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SERIAL = path.join(root, 'skills', 'reflect', 'scripts', 'serial-score.py')
const RUN_RECORD = path.join(root, 'skills', '_shared', 'scripts', 'run_record.py')
const SLUG = 'demo-rollout-2026-10-20'
const UTC_Z_RE = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/
const FIX = 'demo-followup-fix-t3'

// ---- the fixture ------------------------------------------------------------------------------------------------

const at = (hm) => `2026-10-20T${hm}+11:00`
// The main chain: three Legs of an hour each (10:00–11:00, 11:30–12:30, 13:00 to --until 14:00), seven done rows (a fix
// for t3 among them, which names t3 in fixes:), Leg 3 still open (Complete scores before its close).
const MAIN = [
  `- ${at('10:00')} Leg 1 began: leg-1 session s1 in cc-demo from /work`,
  `- ${at('10:05')} Leg 1 claimed [[t1]]`, `- ${at('10:20')} Leg 1 done [[t1]] (verify pass)`,
  `- ${at('10:21')} Leg 1 claimed [[t2]]`, `- ${at('10:40')} Leg 1 done [[t2]] (verify pass)`,
  `- ${at('10:41')} Leg 1 claimed [[t3]]`, `- ${at('11:00')} Leg 1 done [[t3]] (verify pass)`,
  `- ${at('11:00')} Leg 1 closed: handoff to Leg 2 in cc-demo from /work`, `- ${at('11:00')} Leg 1 hand-over: started task_a`,
  `- ${at('11:30')} Leg 2 began: leg-2 session s2 in cc-demo from /work`,
  `- ${at('11:31')} Leg 2 smoke: [[t3]] fail: a.txt is wrong`,
  `- ${at('11:35')} Leg 2 filed [[${FIX}]] (verifies [[t3]]; cause own)`,
  `- ${at('11:36')} Leg 2 claimed [[${FIX}]]`, `- ${at('11:45')} Leg 2 done [[${FIX}]] (verify pass)`,
  `- ${at('11:46')} Leg 2 claimed [[t4]]`, `- ${at('12:00')} Leg 2 done [[t4]] (verify pass)`,
  `- ${at('12:30')} Leg 2 closed: handoff to Leg 3 in cc-demo from /work`, `- ${at('12:30')} Leg 2 hand-over: started task_b`,
  `- ${at('13:00')} Leg 3 began: leg-3 session s3 in cc-demo from /work`,
  `- ${at('13:05')} Leg 3 claimed [[t5]]`, `- ${at('13:20')} Leg 3 done [[t5]] (verify pass)`,
  `- ${at('13:25')} Leg 3 claimed [[t6]]`, `- ${at('13:40')} Leg 3 done [[t6]] (verify pass)`,
]
const MAIN_ROWS = ['t1', 't2', 't3', FIX, 't4', 't5', 't6']
const UNTIL = at('14:00')
const tasksOf = (home) => path.join(home, 'repos', 'obsidian', 'Work', 'Tasks')
const evDir = (home) => path.join(home, 'events')
const baseEnv = (home) => ({ PATH: process.env.PATH, HOME: home, PYTHONDONTWRITEBYTECODE: '1', TZ: 'Australia/Melbourne',
  THREAD_EVENTS_DIR: evDir(home), GIT_CONFIG_GLOBAL: path.join(home, 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1' })

// A task note of the chain; `extra` frontmatter lines go before the closing fence.
function task(home, slug, status = 'done', extra = []) {
  fs.writeFileSync(path.join(tasksOf(home), `${slug}.md`), ['---', 'tags: [task]', `status: ${status}`, 'projects:', '  - "[[Demo]]"',
    `rollout: "[[${SLUG}]]"`, ...extra, '---', '', '## Notes', '', `Do ${slug}.`, ''].join('\n'))
}

// The serial note: its Queue (one row per slug, one launch) and, when `log` is non-empty, its Leg log.
function note(home, rows, log, { status = 'open' } = {}) {
  const queue = rows.map((s, i) => `| ${i + 1} | [[${s}\\|${s}]] | \`cc-demo\` from \`/work\` | \`ext:x\` |`)
  const body = ['---', 'tags:', '  - task', '  - rollout', `status: ${status}`, 'priority: high', 'projects:', '  - "[[Demo]]"',
    'captured: 2026-10-20', 'protocol_version: 5', 'shape: serial', 'surfaces:', '  - "ext:x"', '---', '', '## Notes', '',
    'Serial-rollout plan.', '', '## Queue', '', '| # | Task | Launch | Surfaces |', '|---|---|---|---|', ...queue, '',
    '## Post-rollout', '', 'Rollout-specific items go here:', '', ...(log.length ? ['## Leg log', '', ...log] : []), '']
  const p = path.join(tasksOf(home), `${SLUG}.md`)
  fs.writeFileSync(p, body.join('\n'))
  return p
}

// Every event through run_record.emit(strict=True) in one python process: [ts, kind, task, fields].
function emitAll(home, events) {
  const body = [
    'import importlib.util, json, sys',
    'spec = importlib.util.spec_from_file_location("run_record", sys.argv[1])',
    'm = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)',
    'for ts, kind, task, fields in json.load(sys.stdin):',
    `    assert m.emit("${SLUG}", kind, task, fields, ts=ts, strict=True), (kind, task, ts)`,
  ].join('\n')
  const r = spawnSync('python3', ['-B', '-c', body, RUN_RECORD], { encoding: 'utf8', cwd: home, env: baseEnv(home), input: JSON.stringify(events) })
  assert.equal(r.status, 0, r.stderr)
}

// A fixture: HOME, the task notes (MAIN_ROWS done, FIX naming t3 in fixes:), the note, and `events` in the record.
function fixture(t, { log = MAIN, rows = MAIN_ROWS, fixes = true, events = [[at('11:50'), 'answer-recorded', 't4', { answerKind: 'decision', form: 'hand-back' }]] } = {}) {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'reflect-serial-score-')))
  t.after(() => fs.rmSync(home, { recursive: true, force: true }))
  fs.mkdirSync(tasksOf(home), { recursive: true })
  fs.writeFileSync(path.join(home, 'gitconfig'), '')
  for (const s of rows) {
    task(home, s, 'done', s === FIX ? ['verifies: "[[t3]]"', ...(fixes ? ['fixes: "[[t3]]"'] : [])] : [])
  }
  const p = note(home, rows, log)
  if (events.length) emitAll(home, events)
  return { home, note: p }
}

function score(fx, args = []) {
  const r = spawnSync('python3', ['-B', SERIAL, '--rollout', fx.note, '--until', UNTIL, ...args], { encoding: 'utf8', cwd: fx.home, env: baseEnv(fx.home) })
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, doc: r.status === 0 && r.stdout ? JSON.parse(r.stdout) : null }
}

function ok(r) {
  assert.equal(r.status, 0, r.stderr)
  assert.doesNotMatch(r.stderr, /Traceback/)
  return r.doc
}

// ---- the main chain ----------------------------------------------------------------------------------------------

test('the window is UTC Z from Leg 1\'s began; three hours, seven merges, throughput 2.333', (t) => {
  const d = ok(score(fixture(t)))
  assert.equal(d.window.since, '2026-10-19T23:00:00.000Z', 'Leg 1 began at 10:00+11:00')
  assert.equal(d.window.activeStart, '2026-10-19T23:00:00.000Z')
  assert.equal(d.window.until, '2026-10-20T03:00:00.000Z')
  assert.equal(d.window.activeEnd, '2026-10-20T03:00:00.000Z', 'Leg 3, still open, runs to --until')
  assert.equal(d.window.partial, false, 'every row is done: the tail has landed')
  for (const k of ['since', 'until', 'activeStart', 'activeEnd']) assert.match(d.window[k], UTC_Z_RE, k)
  for (const s of d.runningTime.spans) { assert.match(s.start, UTC_Z_RE); assert.match(s.end, UTC_Z_RE) }
  assert.equal(d.runningTime.hours, 3)
  assert.deepEqual(d.runningTime.spans.map((s) => s.hours), [1, 1, 1])
  assert.equal(d.merges.count, 7)
  assert.equal(d.throughput, 2.333)
  assert.deepEqual([d.headline.merges, d.headline.runningHours, d.headline.throughput], [7, 3, 2.333])
  assert.equal(d.chain, 'live')
})

test('hands-off 6 of 7: t4\'s answer before its done counts; quality 0.8571 from the fix naming t3, partial', (t) => {
  const d = ok(score(fixture(t)))
  assert.deepEqual([d.handsOff.landed, d.handsOff.handsOff, d.handsOff.rate], [7, 6, 0.8571])
  assert.deepEqual(d.handsOff.tasks.map((x) => [x.task, x.acts.map((a) => a.kind)]), [['t4', ['answer']]])
  assert.equal(d.handsOff.tasks[0].acts[0].at, '2026-10-20T00:50:00.000Z')
  assert.equal(d.handsOff.byKind.answer, 1)
  assert.equal(d.headline.handsOffRate, 0.8571)
  assert.deepEqual([d.escapes.count, d.escapes.landed, d.escapes.quality, d.escapes.partial], [1, 7, 0.8571, true])
  assert.equal(d.escapes.tasks[0].task, 't3')
  assert.equal(d.escapes.sources.fixes, 'read')
  assert.match(d.escapes.sources.reverts, /^unread: no --repo/)
  assert.equal(d.headline.quality, 0.8571)
  assert.ok(d.flags.some((f) => f.startsWith('quality reads fixes: only')), d.flags.join('\n'))
})

test('the parallel-only keys and reviewChurn are null and flagged; repo null, shape serial, no proposals', (t) => {
  const d = ok(score(fixture(t)))
  for (const k of ['tokensPerMerge', 'setAsideRate', 'conflictRate', 'quotaStalls', 'reviewChurn']) assert.equal(d.headline[k], null, k)
  assert.deepEqual(Object.keys(d.headline), ['throughput', 'runningHours', 'merges', 'tokensPerMerge', 'setAsideRate', 'conflictRate',
    'quotaStalls', 'handsOffRate', 'quality', 'reviewChurn'])
  assert.ok(d.flags.some((f) => f.includes('quotaStalls are a parallel rollout\'s')), d.flags.join('\n'))
  assert.ok(d.flags.some((f) => f.startsWith('reviewChurn is not read')), d.flags.join('\n'))
  assert.deepEqual([d.repo, d.shape, d.binding, d.proposals, d.withheld], [null, 'serial', null, [], []])
  assert.deepEqual(d.handsOff.notCounted, { takeOvers: 0, manualHandOvers: 0, restarts: 0, stops: 0, standingApproval: 0 })
})

test('Archive parity: the archived note scores the same', (t) => {
  const fx = fixture(t)
  const live = ok(score(fx))
  const arch = path.join(tasksOf(fx.home), 'Archive', 'Rollouts')
  fs.mkdirSync(arch, { recursive: true })
  const moved = path.join(arch, `${SLUG}.md`)
  fs.renameSync(fx.note, moved)
  const a = ok(score({ ...fx, note: moved }))
  for (const k of ['window', 'runningTime', 'merges', 'throughput', 'handsOff', 'headline']) assert.deepEqual(a[k], live[k], k)
  assert.equal(a.escapes.quality, live.escapes.quality)
})

test('a standing approval is no act: 7 of 7, counted under notCounted', (t) => {
  const d = ok(score(fixture(t, { events: [[at('13:10'), 'gate-signed', 't5', { standing: true, gates: 1 }]] })))
  assert.deepEqual([d.handsOff.handsOff, d.handsOff.landed, d.handsOff.rate], [7, 7, 1])
  assert.equal(d.handsOff.notCounted.standingApproval, 1)
})

test('a drift fix (verifies: only, no fixes:) is no Escape: quality 1', (t) => {
  const d = ok(score(fixture(t, { fixes: false })))
  assert.deepEqual([d.escapes.count, d.escapes.quality], [0, 1])
})

test('the done minute counts whole: an act at done + 30 s counts, one at done + 60 s does not', (t) => {
  const in30 = ok(score(fixture(t, { events: [['2026-10-20T01:00:30.000Z', 'answer-recorded', 't4', { answerKind: 'needs-you' }]] })))
  assert.deepEqual([in30.handsOff.handsOff, in30.handsOff.tasks.map((x) => x.task)], [6, ['t4']])
  const at60 = ok(score(fixture(t, { events: [['2026-10-20T01:01:00.000Z', 'answer-recorded', 't4', { answerKind: 'needs-you' }]] })))
  assert.deepEqual([at60.handsOff.handsOff, at60.handsOff.tasks], [7, []])
  const before = ok(score(fixture(t, { events: [['2026-10-19T22:59:00.000Z', 'answer-recorded', 't1', { answerKind: 'decision' }]] })))
  assert.equal(before.handsOff.handsOff, 7, 'an act before the chain began is a question before the run')
})

test('a missing record reads no acts, flagged', (t) => {
  const d = ok(score(fixture(t, { events: [] })))
  assert.equal(d.handsOff.rate, 1)
  assert.ok(d.flags.some((f) => f.startsWith('no record:')), d.flags.join('\n'))
})

// ---- the other shapes of a chain ---------------------------------------------------------------------------------

test('a lost Leg\'s span ends at its own last line, never the taker\'s close line; the take-over is not counted', (t) => {
  const log = [
    `- ${at('10:00')} Leg 1 began: leg-1 session s1 in cc-demo from /work`,
    `- ${at('10:05')} Leg 1 claimed [[t1]]`, `- ${at('10:30')} Leg 1 done [[t1]] (verify pass)`,
    `- ${at('10:31')} Leg 1 claimed [[t2]]`,
    `- ${at('13:00')} Leg 1 closed: lost (taken over by Leg 2)`,
    `- ${at('13:00')} Leg 2 began: leg-2 session s2 in cc-demo from /work; took over from Leg 1`,
    `- ${at('13:01')} Leg 2 took [[t2]] (inherited from Leg 1)`, `- ${at('13:30')} Leg 2 done [[t2]] (verify pass)`,
  ]
  const d = ok(score(fixture(t, { log, rows: ['t1', 't2'], events: [] })))
  assert.deepEqual(d.runningTime.spans.map((s) => [s.leg, s.end, s.lost]),
    [[1, '2026-10-19T23:31:00.000Z', true], [2, '2026-10-20T03:00:00.000Z', false]])
  assert.equal(d.runningTime.hours, 1.517, '31 min of Leg 1, then Leg 2 from 13:00 to 14:00')
  assert.ok(d.flags.some((f) => f.startsWith('Leg 1 was lost')), d.flags.join('\n'))
  assert.deepEqual([d.handsOff.rate, d.handsOff.notCounted.takeOvers], [1, 1])
})

test('a halt cleared is an act on the task the halted Leg held', (t) => {
  const log = [
    `- ${at('10:00')} Leg 1 began: leg-1 session s1 in cc-demo from /work`,
    `- ${at('10:05')} Leg 1 claimed [[t1]]`,
    `- ${at('10:30')} Leg 1 closed: halted: a revert conflict`,
    `- ${at('10:45')} halt cleared: resolved by hand`,
    `- ${at('11:00')} Leg 2 began: leg-2 session s2 in cc-demo from /work`,
    `- ${at('11:01')} Leg 2 took [[t1]] (inherited from Leg 1)`, `- ${at('11:20')} Leg 2 done [[t1]] (verify pass)`,
    `- ${at('11:21')} Leg 2 claimed [[t2]]`, `- ${at('11:40')} Leg 2 done [[t2]] (verify pass)`,
  ]
  const d = ok(score(fixture(t, { log, rows: ['t1', 't2'], events: [] })))
  assert.deepEqual([d.handsOff.handsOff, d.handsOff.landed], [1, 2])
  assert.deepEqual(d.handsOff.tasks.map((x) => [x.task, x.acts.map((a) => [a.kind, a.at])]),
    [['t1', [['haltCleared', '2026-10-19T23:45:00.000Z']]]])
  assert.equal(d.handsOff.byKind.haltCleared, 1)
})

test('no Leg: since = until, activeStart and activeEnd null, nothing ran, exit 0', (t) => {
  const d = ok(score(fixture(t, { log: [], events: [] })))
  assert.deepEqual(d.window, { since: '2026-10-20T03:00:00.000Z', until: '2026-10-20T03:00:00.000Z', activeStart: null, activeEnd: null, partial: false })
  assert.deepEqual([d.merges.count, d.runningTime.hours, d.throughput, d.handsOff], [0, 0, null, null])
  assert.ok(d.flags.includes('no Leg began: nothing ran'), d.flags.join('\n'))
})

test('an open Leg with rows left makes the window partial', (t) => {
  const fx = fixture(t, { log: MAIN.slice(0, 7), rows: ['t1', 't2', 't3', 't4'], events: [] })
  task(fx.home, 't4', 'open')
  const d = ok(score(fx))
  assert.equal(d.window.partial, true)
  assert.ok(d.flags.some((f) => f.startsWith('partial: Leg 1 is open')), d.flags.join('\n'))
  assert.equal(d.runningTime.hours, 4, 'Leg 1, open, runs from 10:00 to --until 14:00')
})

// ---- refusals and the script ----------------------------------------------------------------------------------------

test('--until before Leg 1 began, a naive --until and a non-.md --rollout are usage errors (exit 2, stdout empty)', (t) => {
  const fx = fixture(t, { events: [] })
  for (const args of [['--rollout', fx.note, '--until', '2026-10-20T09:00+11:00'], ['--rollout', fx.note, '--until', '2026-10-20T14:00'],
    ['--rollout', path.join(fx.home, 'x.txt')]]) {
    const r = spawnSync('python3', ['-B', SERIAL, ...args], { encoding: 'utf8', cwd: fx.home, env: baseEnv(fx.home) })
    assert.equal(r.status, 2, `${args.join(' ')}: ${r.stderr}`)
    assert.equal(r.stdout, '')
    assert.match(r.stderr, /^serial-score: /)
  }
})

test('a note leg.py status refuses (a parallel note) is exit 1 with its line', (t) => {
  const fx = fixture(t, { events: [] })
  fs.writeFileSync(fx.note, fs.readFileSync(fx.note, 'utf8').replace('shape: serial', 'shape: parallel'))
  const r = score(fx)
  assert.equal(r.status, 1)
  assert.equal(r.stdout, '')
  assert.match(r.stderr, /^serial-score: leg\.py status exited 1: .*not a serial rollout/)
})

test('--out writes the score there and nothing to stdout', (t) => {
  const fx = fixture(t)
  const out = path.join(fx.home, 'score.json')
  const r = score(fx, ['--out', out])
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.stdout, '')
  assert.equal(JSON.parse(fs.readFileSync(out, 'utf8')).merges.count, 7)
  assert.match(r.stderr, /^serial-score: demo-rollout-2026-10-20: hands-off 0\.8571 \(6 of 7\), 7 merges in 3(\.0)? running h/)
})

test('serial-score.py parses as python 3.8', () => {
  const r = spawnSync('python3', ['-B', '-c', 'import ast, sys\nast.parse(open(sys.argv[1]).read(), sys.argv[1], feature_version=(3, 8))', SERIAL], { encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
})
