// skills/reflect/scripts/reflect-due.py — is the weekly Reflection due (p21-8, ADR 0037 d4 and d6)? Due once the
// cadence's days (7, or 14 on the relaxed cadence) have passed, in Melbourne dates, since the last `reflection`
// line's until; the cadence is run_record's cadence rule over the `reflection` lines' quiet flags (three quiet in a
// row: 14; any that is not quiet: back to 7). reflect.py's close writes the cadence it moved to on its own line.
//
// Hermetic: each case gets its own mkdtemp HOME and THREAD_EVENTS_DIR, TZ pinned to Melbourne, and an env built
// from scratch. The fixture record's lines go through run_record.emit, so they are lines run_record accepts.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DUE = path.join(root, 'skills', 'reflect', 'scripts', 'reflect-due.py')
const REFLECT = path.join(root, 'skills', 'reflect', 'scripts', 'reflect.py')
const RUN_RECORD = path.join(root, 'skills', '_shared', 'scripts', 'run_record.py')

function setup(t) {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'reflect-due-')))
  t.after(() => fs.rmSync(home, { recursive: true, force: true }))
  fs.mkdirSync(path.join(home, 'events'))
  return { home, ev: path.join(home, 'events') }
}
const env = (h) => ({ PATH: process.env.PATH, HOME: h.home, PYTHONDONTWRITEBYTECODE: '1', TZ: 'Australia/Melbourne', THREAD_EVENTS_DIR: h.ev })

function due(h, now, extra = []) {
  const r = spawnSync('python3', ['-B', DUE, ...(now ? ['--now', now] : []), ...extra], { encoding: 'utf8', cwd: h.home, env: env(h) })
  return { status: r.status, out: r.stdout ? JSON.parse(r.stdout) : null, stderr: r.stderr }
}

const COUNTS = { sightings: 0, newWatches: 0, rules: 0, bugs: 0, filed: 0, knobs: 0, landed: 0, reverted: 0, breaches: 0 }
const RID = (n) => `r-202609${String(n).padStart(2, '0')}T000000Z-00000${n % 10}`

// One `reflection` line per entry, through run_record.emit(strict=True): {n, until, quiet, cadence?}.
function reflections(h, rows) {
  const body = ['import importlib.util, json, sys', 'spec = importlib.util.spec_from_file_location("run_record", sys.argv[1])',
    'm = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)',
    'for f in json.load(sys.stdin):', '    assert m.emit(None, "reflection", None, f, ts=f["until"], strict=True), f'].join('\n')
  const lines = rows.map(({ n, since, until, quiet, cadence }) => ({ id: RID(n), since: since ?? '2026-08-01T00:00:00.000Z', until,
    rollouts: [], escapesOnly: [], counts: { ...COUNTS, ...(quiet ? {} : { bugs: 1 }) }, quiet, ...(cadence ? { cadence } : {}) }))
  const r = spawnSync('python3', ['-B', '-c', body, RUN_RECORD], { encoding: 'utf8', env: env(h), input: JSON.stringify(lines) })
  assert.equal(r.status, 0, r.stderr)
}

test('reflect-due.py parses as python 3.9', () => {
  const r = spawnSync('python3', ['-B', '-c', 'import ast, sys\nast.parse(open(sys.argv[1]).read(), sys.argv[1], feature_version=(3, 9))', DUE], { encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
})

// 2026-09-10 08:00 Melbourne (AEST, +10:00)
const UNTIL = '2026-09-09T22:00:00.000Z'

test('no Reflection yet: due at once, cadence 7', (t) => {
  const h = setup(t)
  const r = due(h, '2026-09-10T06:00+10:00')
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(r.out, { due: true, cadence: 7, quietStreak: 0, last: null, lastUntil: null, today: '2026-09-10', dueOn: null, days: null })
})

test('weekly: due at day 7, not at day 6, by Melbourne dates whatever the hour', (t) => {
  const h = setup(t)
  reflections(h, [{ n: 1, until: UNTIL, quiet: false }])
  const six = due(h, '2026-09-16T23:59+10:00')
  assert.equal(six.status, 4, six.stderr)
  assert.deepEqual(six.out, { due: false, cadence: 7, quietStreak: 0, last: RID(1), lastUntil: UNTIL, today: '2026-09-16', dueOn: '2026-09-17', days: 6 })
  // an earlier hour than the last until's, on day 7: still due (the daily sweep runs at one hour a day)
  const seven = due(h, '2026-09-17T06:00+10:00')
  assert.equal(seven.status, 0, seven.stderr)
  assert.deepEqual([seven.out.due, seven.out.days, seven.out.dueOn], [true, 7, '2026-09-17'])
  assert.equal(due(h, '2026-09-30T06:00+10:00').status, 0, 'overdue is due')
})

test('the quiet streak: three quiet Reflections in a row move the cadence to 14; any non-quiet one back to 7', (t) => {
  const h = setup(t)
  const at = (d) => `2026-09-${String(d).padStart(2, '0')}T22:00:00.000Z`
  reflections(h, [{ n: 1, until: at(1), quiet: false }, { n: 2, until: at(2), quiet: true }, { n: 3, until: at(3), quiet: true }])
  // two quiet in a row: still weekly (until 2026-09-04 Melbourne -> due 2026-09-11)
  let r = due(h, '2026-09-11T06:00+10:00')
  assert.deepEqual([r.status, r.out.cadence, r.out.quietStreak, r.out.dueOn], [0, 7, 2, '2026-09-11'])
  reflections(h, [{ n: 4, until: UNTIL, quiet: true }])
  r = due(h, '2026-09-17T06:00+10:00')
  assert.deepEqual([r.status, r.out.cadence, r.out.quietStreak, r.out.days, r.out.dueOn], [4, 14, 3, 7, '2026-09-24'])
  r = due(h, '2026-09-23T23:00+10:00')
  assert.deepEqual([r.status, r.out.days], [4, 13], 'not at day 13')
  r = due(h, '2026-09-24T06:00+10:00')
  assert.deepEqual([r.status, r.out.days], [0, 14], 'due at day 14')
  // a fourth quiet one stays fortnightly
  reflections(h, [{ n: 5, until: '2026-09-23T22:00:00.000Z', quiet: true }])
  r = due(h, '2026-10-01T06:00+10:00')
  assert.deepEqual([r.status, r.out.cadence, r.out.quietStreak, r.out.dueOn], [4, 14, 4, '2026-10-08'])
  // one that is not quiet: back to weekly at once
  reflections(h, [{ n: 6, until: '2026-10-07T22:00:00.000Z', quiet: false }])
  r = due(h, '2026-10-15T06:00+10:00')
  assert.deepEqual([r.status, r.out.cadence, r.out.quietStreak, r.out.dueOn], [0, 7, 0, '2026-10-15'])
})

test('the rule, not a written cadence, decides: a line written with cadence 14 after one quiet Reflection reads 7', (t) => {
  const h = setup(t)
  reflections(h, [{ n: 1, until: UNTIL, quiet: true, cadence: 14 }])
  const r = due(h, '2026-09-17T06:00+10:00')
  assert.deepEqual([r.status, r.out.cadence, r.out.quietStreak], [0, 7, 1])
})

test('a torn last line is skipped; a malformed --now is exit 2 with nothing on stdout', (t) => {
  const h = setup(t)
  reflections(h, [{ n: 1, until: UNTIL, quiet: false }])
  fs.appendFileSync(path.join(h.ev, 'reflections.jsonl'), '{"kind": "reflection", "id": "r-torn"')
  const r = due(h, '2026-09-16T06:00+10:00')
  assert.deepEqual([r.status, r.out.last], [4, RID(1)])
  const bad = spawnSync('python3', ['-B', DUE, '--now', 'tuesday'], { encoding: 'utf8', env: env(h) })
  assert.equal(bad.status, 2)
  assert.equal(bad.stdout, '')
  assert.match(bad.stderr, /^reflect-due: --now/)
})

test('an unreadable reflections.jsonl is exit 1', (t) => {
  const h = setup(t)
  fs.mkdirSync(path.join(h.ev, 'reflections.jsonl'))
  const r = spawnSync('python3', ['-B', DUE, '--now', '2026-09-16T06:00+10:00'], { encoding: 'utf8', env: env(h) })
  assert.equal(r.status, 1)
  assert.match(r.stderr, /^reflect-due: reflections\.jsonl cannot be read/)
})

// close writes the cadence the rule gives once its own line is counted, so each change is on a record line.
test('close records the cadence: 7, 7, then 14 on the third quiet close, then 7 on a non-quiet one; reflect-due agrees', (t) => {
  const h = setup(t)
  const span = (n, until, entries = {}) => {
    const p = path.join(h.home, `span-${n}.json`)
    fs.writeFileSync(p, JSON.stringify({ reflection: RID(n), since: '2026-08-01T00:00:00.000Z', until, previous: null,
      rollouts: Object.entries(entries).map(([rollout, e]) => ({ rollout, mode: 'read', breached: [], breachCounts: false, proposals: [], ...e })),
      freshReview: [], watches: [], knobs: { revert: [], land: [], held: [] }, bugsOpen: [], decisionTask: null, cannotShow: [], flags: [] }))
    return p
  }
  const close = (p) => {
    const r = spawnSync('python3', ['-B', REFLECT, 'close', '--span', p], { encoding: 'utf8', cwd: h.home, env: env(h) })
    assert.equal(r.status, 0, r.stderr)
    return r.stdout
  }
  const lines = () => fs.readFileSync(path.join(h.ev, 'reflections.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  close(span(1, '2026-09-01T22:00:00.000Z'))
  close(span(2, '2026-09-08T22:00:00.000Z'))
  const third = close(span(3, '2026-09-15T22:00:00.000Z'))
  assert.match(third, /cadence 7 -> 14/)
  assert.deepEqual(lines().map((l) => [l.quiet, l.cadence]), [[true, 7], [true, 7], [true, 14]])
  assert.deepEqual([due(h, '2026-09-23T06:00+10:00').status, due(h, '2026-09-30T06:00+10:00').status], [4, 0])
  const back = close(span(4, '2026-09-29T22:00:00.000Z', { a: { breached: ['setAsideRate'], breachCounts: true } }))
  assert.match(back, /not quiet/)
  assert.match(back, /cadence 14 -> 7/)
  assert.deepEqual(lines().at(-1).cadence, 7)
  assert.equal(due(h, '2026-10-07T06:00+10:00').status, 0)
})
