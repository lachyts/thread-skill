// The shared fixtures of the Time-lost ledger's suite (skills/reflect/scripts/ledger.py and reflect.py, p29-11), one
// suite in two files since p49-3 so node's files at a time and the full suite's shards spread it:
// tests/reflect-ledger.test.mjs (the model over the fixture records, L1 and G1, HALT_WAITS, and the readings' trend
// and Watch, L2-L4) and tests/reflect-ledger-audit.test.mjs (L1 in span, the load hold on a Parallel ceiling raise,
// L5, the Monthly audit, L6, and the writers over a span written by hand, L7-L9). Each part imports from here what
// it uses of the fixtures, and every engine-script bind with the spawner that runs it and the env it passes, so
// tests/contracts/run-record-hermetic.test.mjs reads them together.
//
// Hermetic: each case gets its own mkdtemp HOME, THREAD_EVENTS_DIR and tasks dir (with Archive/2026/ and
// Archive/Rollouts/), TZ pinned to Melbourne, an env built from scratch that every spawn passes, and a temp git repo
// whose origin is https://github.com/o/r.git (land.sh reads it locally, no network). Record lines go through
// run_record.emit in one python process per fixture. L1 runs ledger.py's CLI (no score.py), the readings run the
// real span, and the writers' cases that need no score build span.json by hand in span's shape.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync, execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
export const LEDGER = path.join(root, 'skills', 'reflect', 'scripts', 'ledger.py')
const REFLECT = path.join(root, 'skills', 'reflect', 'scripts', 'reflect.py')
export const TUNE = path.join(root, 'skills', 'reflect', 'scripts', 'tune.py')
export const DUE = path.join(root, 'skills', 'reflect', 'scripts', 'reflect-due.py')
export const RUN_RECORD = path.join(root, 'skills', '_shared', 'scripts', 'run_record.py')
const REAL_GIT = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim()

// ---- helpers ----------------------------------------------------------------------------------------------

export function setup(t) {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'reflect-ledger-')))
  t.after(() => fs.rmSync(home, { recursive: true, force: true }))
  const tasks = path.join(home, 'Tasks')
  for (const d of ['Archive/2026', 'Archive/Rollouts']) fs.mkdirSync(path.join(tasks, d), { recursive: true })
  for (const d of ['events', 'out', 'repo']) fs.mkdirSync(path.join(home, d), { recursive: true })
  const h = { home, tasks, ev: path.join(home, 'events'), out: path.join(home, 'out'), repo: path.join(home, 'repo') }
  git(h, ['init', '-q', '-b', 'main'])
  git(h, ['remote', 'add', 'origin', 'https://github.com/o/r.git'])
  return h
}

export const env = (h, extra = {}) => ({ PATH: process.env.PATH, HOME: h.home, PYTHONDONTWRITEBYTECODE: '1', TZ: 'Australia/Melbourne',
  THREAD_EVENTS_DIR: h.ev, GIT_CONFIG_GLOBAL: path.join(h.home, 'gitconfig'), ...extra })
const git = (h, args) => execFileSync(REAL_GIT, ['-C', h.repo, ...args], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: h.home } }).trim()

export function run(h, script, args) {
  const r = spawnSync('python3', ['-B', script, ...args], { encoding: 'utf8', cwd: h.home, env: env(h) })
  return { status: r.status, stdout: r.stdout, stderr: r.stderr }
}
export const reflect = (h, args) => run(h, REFLECT, args)
export function ok(h, args) {
  const r = reflect(h, args)
  assert.equal(r.status, 0, `${args[0]}: ${r.stderr}`)
  return r
}
export function refused(h, args, re) {
  const before = sha(reflectionsFile(h))
  const r = reflect(h, args)
  assert.equal(r.status, 2, `${args[0]}: ${r.stderr}`)
  assert.match(r.stderr, re)
  assert.equal(sha(reflectionsFile(h)), before, `${args[0]}: nothing written`)
  return r
}

export const reflectionsFile = (h) => path.join(h.ev, 'reflections.jsonl')
const parse = (l) => { try { return JSON.parse(l) } catch { return null } }
export const rlines = (h) => (fs.existsSync(reflectionsFile(h)) ? fs.readFileSync(reflectionsFile(h), 'utf8').split('\n').map(parse).filter(Boolean) : [])
export const sha = (f) => (fs.existsSync(f) ? crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex') : 'absent')
export const tl = (h, source) => rlines(h).filter((l) => l.kind === 'time-lost' && (!source || l.source === source))

// Every event through run_record.emit(strict=True): [ts, kind, task, fields, rollout?].
export function emitAll(h, rollout, events) {
  const body = ['import importlib.util, json, sys', 'spec = importlib.util.spec_from_file_location("run_record", sys.argv[1])',
    'm = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)',
    'for ts, kind, task, fields, r in json.load(sys.stdin):', '    assert m.emit(r, kind, task, fields, ts=ts, strict=True), (kind, task, ts)'].join('\n')
  const rows = events.map(([ts, kind, task = null, fields = {}, r = rollout]) => [ts, kind, task, fields, r])
  const r = spawnSync('python3', ['-B', '-c', body, RUN_RECORD], { encoding: 'utf8', cwd: h.home, env: env(h), input: JSON.stringify(rows) })
  assert.equal(r.status, 0, r.stderr)
}

// A python expression over a module loaded by path as `m` (its stdin JSON as `a`), printed as JSON.
export function py(h, script, expr, input = null) {
  const body = ['import importlib.util, json, sys', 'spec = importlib.util.spec_from_file_location("m", sys.argv[1])',
    'm = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)', 'a = json.load(sys.stdin)', `print(json.dumps(${expr}))`].join('\n')
  const r = spawnSync('python3', ['-B', '-c', body, script], { encoding: 'utf8', cwd: h.home, env: env(h), input: JSON.stringify(input) })
  assert.equal(r.status, 0, r.stderr)
  return JSON.parse(r.stdout)
}

export function rolloutNote(h, slug, { status = 'in_progress', archived = false, shape = null } = {}) {
  const dir = archived ? path.join(h.tasks, 'Archive', 'Rollouts') : h.tasks
  fs.writeFileSync(path.join(dir, `${slug}.md`), ['---', 'tags: [rollout]', `status: ${status}`, 'protocol_version: 5', ...(shape ? [`shape: ${shape}`] : []),
    '---', '', `# ${slug}`, '', `Project root: \`${h.repo}\``, '', '## Notes', ''].join('\n'))
}
export const done = (h, slug) => rolloutNote(h, slug, { status: 'done', archived: true })

// ledger.py's CLI over [since, until]: the block, every interval included.
export function ledgerCli(h, since, until) {
  const out = path.join(h.out, `ledger-${crypto.randomBytes(3).toString('hex')}.json`)
  const r = run(h, LEDGER, ['--since', since, '--until', until, '--tasks-dir', h.tasks, '--out', out])
  assert.equal(r.status, 0, r.stderr)
  return JSON.parse(fs.readFileSync(out, 'utf8'))
}

const SET = { parallel_ceiling: 2 }
export const S = (start) => ({ settings: SET, start })
export const T = (day, hm) => `2026-10-${day}T${hm}:00Z`
const SU = (n) => `s-${String(n).padStart(16, '0')}`
export const SHA = 'a'.repeat(40)
export const suite = (n, by, runner = 'lead') => ({ suite: SU(n), by, runner })
export const idle = (reason) => ({ reason, free: 2, settings: SET })
export const H0 = { stalls: 0, 'quota-bound': 0, load: 0, 'lane-bound': 0, rework: 0, 'plan-rejected': 0 }
export const CLASSES = Object.keys(H0)

// ---- L1: the ledger sums fixture records across rollouts by class and ranks them ------------------------------------

// Eight records over one week, each built to price one part of the model by hand (the stamps say the hours).
export const FIXTURE = {
  // a live usage-limit stop and its lead-entry resume (0.5 h); an inferred dead-lead stop (2:00..5:00) and a mac-sleep
  // overlapping it (3:00..4:00): the sleep owns its overlap, so dead-lead 2 h and mac-sleep 1 h, priced over running time
  'l-stops': [
    [T('06', '00:00'), 'slot-taken', 't1', S('start')],
    [T('06', '01:00'), 'stopped', null, { cause: 'usage-limit', inferred: false, calls: [{ task: 't1' }] }],
    [T('06', '01:30'), 'lead-entry', null, { by: 'lachy', stop: 'usage-limit' }],
    [T('06', '05:00'), 'stopped', null, { cause: 'dead-lead', inferred: true, calls: [{ task: 't1' }], at: T('06', '02:00') }],
    [T('06', '05:00'), 'stopped', null, { cause: 'mac-sleep', inferred: true, calls: [], at: T('06', '03:00'), wake: T('06', '04:00') }],
    [T('06', '05:00'), 'lead-entry', null, { by: 'lachy', stop: 'dead-lead' }],
    [T('06', '06:00'), 'slot-freed', 't1', { outcome: 'ready' }],
  ],
  // a lane holding (1:00..5:00) with a watchdog stop inside it (0.5 h), two Integration suites for one task (the second,
  // 2:00..3:00, rework) and a RACE suite (4:00..4:30, rework): the lane is 4 - 0.5 - 1 - 0.5 = 2 h; the first suite
  // waited 15 min for a verify slot (load); a base-moved refusal touching only Inert paths is an event; a completion
  // suite is priced nowhere
  'l-lane': [
    [T('06', '00:00'), 'slot-taken', 'b1', S('start')],
    [T('06', '01:00'), 'slot-freed', 'b1', { outcome: 'ready' }],
    [T('06', '01:00'), 'lane-taken', 'b1', {}],
    [T('06', '01:00'), 'suite-started', 'b1', { ...suite(1, 'integration'), sha: SHA, dirty: false, waited: 900 }],
    [T('06', '01:30'), 'base-moved', 'b1', { repo: 'o/r', pr: 7, base: SHA, main: 'b'.repeat(40), inertOnly: true, moversTotal: 0, movers: [] }],
    [T('06', '02:00'), 'suite-ended', 'b1', { ...suite(1, 'integration'), outcome: 'red', seconds: 3600, rc: 1 }],
    [T('06', '02:00'), 'suite-started', 'b1', { ...suite(2, 'integration'), sha: SHA, dirty: false }],
    [T('06', '03:00'), 'suite-ended', 'b1', { ...suite(2, 'integration'), outcome: 'green', seconds: 3600, rc: 0 }],
    [T('06', '03:00'), 'stopped', null, { cause: 'watchdog', inferred: false, calls: [] }],
    [T('06', '03:30'), 'lead-entry', null, { by: 'watchdog', stop: 'watchdog' }],
    [T('06', '04:00'), 'suite-started', 'b1', { ...suite(3, 'race'), sha: SHA, dirty: false }],
    [T('06', '04:30'), 'suite-ended', 'b1', { ...suite(3, 'race'), outcome: 'green', seconds: 1800, rc: 0 }],
    // a completion suite belongs to no class: its hour's wait and its heat stop are priced nowhere
    [T('06', '04:40'), 'suite-started', null, { ...suite(6, 'completion'), sha: SHA, dirty: false, waited: 3600 }],
    [T('06', '04:50'), 'suite-ended', null, { ...suite(6, 'completion'), outcome: 'heat', seconds: 600, step: 'verifier' }],
    [T('06', '05:00'), 'lane-freed', 'b1', { release: 'merge', path: 'lead', triggers: [], conflict: false }],
    [T('06', '05:00'), 'merged', 'b1', { pr: 7 }],
  ],
  // a git-env hold (task null, 2 h) with nothing running; a merge hold (1 h) inside a lane holding (3:00..6:00) that a
  // soft pause (4:30..5:00) also overlaps: the lane is 3 - 1 - 0.5 = 1.5 h and the pause is `other`
  'l-holds': [
    [T('06', '00:00'), 'slot-taken', 'c1', S('start')],
    [T('06', '01:00'), 'slot-freed', 'c1', { outcome: 'ready' }],
    [T('06', '01:00'), 'hold-started', null, { hold: 'git-env' }],
    [T('06', '03:00'), 'hold-ended', null, { hold: 'git-env' }],
    [T('06', '03:00'), 'lane-taken', 'c1', {}],
    [T('06', '03:00'), 'hold-started', 'c1', { hold: 'merge' }],
    [T('06', '04:00'), 'hold-ended', 'c1', { hold: 'merge' }],
    [T('06', '04:30'), 'paused', null, { mode: 'soft' }],
    [T('06', '05:00'), 'resumed', null, {}],
    [T('06', '06:00'), 'lane-freed', 'c1', { release: 'merge', path: 'lead', triggers: [], conflict: false }],
    [T('06', '06:00'), 'merged', 'c1', { pr: 8 }],
  ],
  // a plan-rejected set-aside (its Slot's 1 h); a hold-trickle stretch then a hold-heat one with nothing running (1 h
  // each); a suite stopped by the heat and one that timed out (0.5 h each, load); a 2 h sign-off pause (stalls/gate)
  'l-caps': [
    [T('06', '00:00'), 'slot-taken', 'd1', S('start')],
    [T('06', '01:00'), 'set-aside', 'd1', { stage: 'plan', reasonClass: 'plan-rejected', setAsideAt: 'run' }],
    [T('06', '01:00'), 'slot-freed', 'd1', { outcome: 'set-aside' }],
    [T('06', '01:00'), 'idle-slots', null, idle('hold-trickle')],
    [T('06', '02:00'), 'idle-slots', null, idle('hold-heat')],
    [T('06', '03:00'), 'slot-taken', 'd2', S('start')],
    [T('06', '03:00'), 'suite-started', 'd2', { ...suite(4, 'task', 'agent'), sha: SHA, dirty: false }],
    [T('06', '03:30'), 'suite-ended', 'd2', { ...suite(4, 'task', 'agent'), outcome: 'heat', seconds: 1800, step: 'verifier' }],
    [T('06', '03:30'), 'suite-started', 'd2', { ...suite(5, 'task', 'agent'), sha: SHA, dirty: false }],
    [T('06', '04:00'), 'suite-ended', 'd2', { ...suite(5, 'task', 'agent'), outcome: 'timeout', seconds: 1800, timeout: 1800, rc: 124 }],
    [T('06', '04:00'), 'slot-freed', 'd2', { outcome: 'ready' }],
    [T('06', '04:00'), 'paused', null, { mode: 'sign-off' }],
    [T('06', '06:00'), 'resumed', null, {}],
    [T('06', '06:00'), 'slot-taken', 'd3', S('start')],
    [T('06', '06:30'), 'slot-freed', 'd3', { outcome: 'ready' }],
  ],
  // the § 7 halts: a question (5 h, its needs-human set-aside answered); a gate (2 h) over a gate and a review-rounds
  // set-aside, classed by the first moved and flagged; a git-env trip (3 h); a settings halt (1 h, plain halt); a RACE (1 h)
  'l-waits': [
    [T('06', '00:00'), 'slot-taken', 'e1', S('start')],
    [T('06', '01:00'), 'set-aside', 'e1', { stage: 'implement', reasonClass: 'needs-human', setAsideAt: 'run' }],
    [T('06', '01:00'), 'slot-freed', 'e1', { outcome: 'set-aside' }],
    [T('06', '01:00'), 'stopped', null, { cause: 'halt', inferred: false, calls: [], reason: 'nothing can start: 1 set aside' }],
    [T('06', '06:00'), 'lead-entry', null, { by: 'lachy', stop: 'halt' }],
    [T('06', '06:00'), 'answer-recorded', 'e1', { answerKind: 'needs-you', form: 'hand-back' }],
    [T('06', '06:00'), 'handed-back', 'e1', { via: 'answer', arm: 'run' }],
    [T('06', '06:00'), 'slot-taken', 'e1', S('hand-back')],
    [T('06', '07:00'), 'slot-freed', 'e1', { outcome: 'ready' }],
    [T('06', '07:00'), 'slot-taken', 'e2', S('start')],
    [T('06', '07:00'), 'slot-taken', 'e3', S('start')],
    [T('06', '08:00'), 'set-aside', 'e2', { stage: 'gate', reasonClass: 'gate', setAsideAt: 'gate' }],
    [T('06', '08:00'), 'slot-freed', 'e2', { outcome: 'set-aside' }],
    [T('06', '08:00'), 'set-aside', 'e3', { stage: 'review', reasonClass: 'review-rounds', setAsideAt: 'run' }],
    [T('06', '08:00'), 'slot-freed', 'e3', { outcome: 'set-aside' }],
    [T('06', '08:00'), 'stopped', null, { cause: 'halt', inferred: false, calls: [], reason: 'nothing can start: 2 set aside' }],
    [T('06', '10:00'), 'lead-entry', null, { by: 'lachy', stop: 'halt' }],
    [T('06', '10:00'), 'gate-signed', 'e2', { standing: false, gates: 1 }],
    [T('06', '10:00'), 'slot-taken', 'e2', S('resume')],
    [T('06', '11:00'), 'slot-freed', 'e2', { outcome: 'ready' }],
    [T('06', '11:00'), 'handed-back', 'e3', { via: 'retry', arm: 'run' }],
    [T('06', '11:00'), 'slot-taken', 'e3', S('hand-back')],
    [T('06', '12:00'), 'slot-freed', 'e3', { outcome: 'ready' }],
    [T('06', '12:00'), 'stopped', null, { cause: 'halt', inferred: false, calls: [], reason: 'git-env trip: the shared checkout changed' }],
    [T('06', '15:00'), 'lead-entry', null, { by: 'repair', stop: 'halt' }],
    [T('06', '15:00'), 'stopped', null, { cause: 'halt', inferred: false, calls: [], reason: 'invalid round budget: max_iterations on [[e4]]' }],
    [T('06', '16:00'), 'lead-entry', null, { by: 'lachy', stop: 'halt' }],
    [T('06', '16:00'), 'stopped', null, { cause: 'halt', inferred: false, calls: [], reason: 'RACE undecided: [[e1]]' }],
    [T('06', '17:00'), 'lead-entry', null, { by: 'repair', stop: 'halt' }],
    [T('06', '17:00'), 'slot-taken', 'e4', S('start')],
    [T('06', '18:00'), 'slot-freed', 'e4', { outcome: 'ready' }],
  ],
  // the not-running remainder: a hand-back with no mover (1 h, flagged unrecorded); a seeded revise ending an
  // awaiting-hand-back stretch (0.5 h, other); a lead-absent gap (6:30..8:00); a stretch with no marker (1 h,
  // unexplained); a quota cool-down (0.5 h, quota-bound) and an infra one (0.25 h, stalls)
  'l-remainder': [
    [T('06', '00:00'), 'slot-taken', 'f1', S('start')],
    [T('06', '01:00'), 'set-aside', 'f1', { stage: 'review', reasonClass: 'review-rounds', setAsideAt: 'run' }],
    [T('06', '01:00'), 'slot-freed', 'f1', { outcome: 'set-aside' }],
    [T('06', '01:00'), 'idle-slots', null, idle('awaiting-hand-back')],
    [T('06', '02:00'), 'slot-taken', 'f1', S('hand-back')],
    [T('06', '03:00'), 'slot-freed', 'f1', { outcome: 'ready' }],
    [T('06', '03:00'), 'slot-taken', 'f2', S('start')],
    [T('06', '04:00'), 'set-aside', 'f2', { stage: 'review', reasonClass: 'blocked', setAsideAt: 'run' }],
    [T('06', '04:00'), 'slot-freed', 'f2', { outcome: 'set-aside' }],
    [T('06', '04:00'), 'idle-slots', null, idle('awaiting-hand-back')],
    [T('06', '04:30'), 'slot-taken', 'f2', S('revise')],
    [T('06', '05:00'), 'slot-freed', 'f2', { outcome: 'ready' }],
    [T('06', '05:00'), 'slot-taken', 'f3', S('start')],
    [T('06', '05:00'), 'run-bound', 'f3', { runId: 'w-f3', journalDir: '/j', call: 'task' }],
    [T('06', '08:00'), 'slot-freed', 'f3', { outcome: 'ready' }],
    [T('06', '08:00'), 'call-journal', null, { runId: 'w-f3', status: 'completed', startTime: Date.parse(T('06', '05:00')), durationMs: 3600000 }],
    [T('06', '09:00'), 'slot-taken', 'f4', S('start')],
    [T('06', '10:00'), 'slot-freed', 'f4', { outcome: 'ready' }],
    [T('06', '10:00'), 'slot-taken', 'f5', S('start')],
    [T('06', '11:00'), 'quota-stall', null, { stage: 'implement' }],
    [T('06', '11:00'), 'set-aside', 'f5', { stage: 'implement', reasonClass: 'quota', setAsideAt: 'run' }],
    [T('06', '11:00'), 'slot-freed', 'f5', { outcome: 'set-aside' }],
    [T('06', '11:00'), 'idle-slots', null, idle('awaiting-hand-back')],
    [T('06', '11:30'), 'auto-retry', 'f5', { stage: 'implement', setAsideAt: 'run', retryClass: 'quota', used: 0, budget: 2, quotaRetries: 1 }],
    [T('06', '11:30'), 'slot-taken', 'f5', S('hand-back')],
    [T('06', '12:00'), 'slot-freed', 'f5', { outcome: 'ready' }],
    [T('06', '12:00'), 'slot-taken', 'f6', S('start')],
    [T('06', '13:00'), 'set-aside', 'f6', { stage: 'implement', reasonClass: 'transient', setAsideAt: 'run' }],
    [T('06', '13:00'), 'slot-freed', 'f6', { outcome: 'set-aside' }],
    [T('06', '13:00'), 'idle-slots', null, idle('awaiting-hand-back')],
    [T('06', '13:15'), 'auto-retry', 'f6', { stage: 'implement', setAsideAt: 'run', retryClass: 'infra', used: 1, budget: 2 }],
    [T('06', '13:15'), 'slot-taken', 'f6', S('hand-back')],
    [T('06', '14:00'), 'slot-freed', 'f6', { outcome: 'ready' }],
  ],
  // a live rollout's awaiting-hand-back stretch still open at until over a needs-human set-aside: 3 h of question,
  // flagged still waiting
  'l-live': [
    [T('11', '20:00'), 'slot-taken', 'g1', S('start')],
    [T('11', '21:00'), 'set-aside', 'g1', { stage: 'implement', reasonClass: 'needs-human', setAsideAt: 'run' }],
    [T('11', '21:00'), 'slot-freed', 'g1', { outcome: 'set-aside' }],
    [T('11', '21:00'), 'idle-slots', null, idle('awaiting-hand-back')],
  ],
  // a record of ledger lines alone, with no note: a 2 h halt is counted
  'l-ledger-only': [
    [T('08', '00:00'), 'stopped', null, { cause: 'halt', inferred: false, calls: [], reason: 'invalid round budget: max_plan_rounds on [[x]]' }],
    [T('08', '02:00'), 'lead-entry', null, { by: 'lachy', stop: 'halt' }],
  ],
  // a live serial chain (its note `shape: serial`, in progress): Lachy's acts and a Leg's suite, no Slot or stop. Left out:
  // 0 h, never 4+ days of stalls/unexplained from its first line to until
  'l-serial': [
    [T('07', '00:00'), 'gate-signed', 's1', { standing: false, gates: 1 }],
    [T('07', '02:00'), 'suite-started', 's1', { ...suite(7, 'task', 'agent'), sha: SHA, dirty: false }],
    [T('07', '02:30'), 'suite-ended', 's1', { ...suite(7, 'task', 'agent'), outcome: 'green', seconds: 1800, rc: 0 }],
    [T('09', '00:00'), 'answer-recorded', 's1', { answerKind: 'needs-you', form: 'hand-back' }],
  ],
}
export const LSINCE = '2026-10-05T00:00:00.000Z'
export const LUNTIL = '2026-10-12T00:00:00.000Z'
export const SERIAL_LEFT_OUT = '[[l-serial]]: a serial chain (shape: serial): its Legs record no Slots or stops, so the ledger leaves it out'

export function fixture(h, over = {}) {
  for (const [slug, events] of Object.entries({ ...FIXTURE, ...over })) emitAll(h, slug, events)
  for (const slug of ['l-stops', 'l-lane', 'l-holds', 'l-caps', 'l-waits', 'l-remainder']) done(h, slug)
  rolloutNote(h, 'l-live') // in progress: live, its open stretch runs to until
  rolloutNote(h, 'l-serial', { shape: 'serial' })
}

// ---- the readings: real spans, then the writers -------------------------------------------------------------------------

let N = 0
// A span over [since, until], in its own out directory (so each due reading keeps its own intervals file).
export function span(h, since, until) {
  const dir = path.join(h.out, `r${++N}`)
  const out = path.join(dir, 'span.json')
  // --now (tests only) is until itself: a reading of November runs on any day, never clamped to the clock
  ok(h, ['span', '--since', since, '--until', until, '--now', until, '--tasks-dir', h.tasks, '--config', path.join(h.home, 'rollouts.toml'), '--out', out])
  const s = JSON.parse(fs.readFileSync(out, 'utf8'))
  // the window check (reflect.py's header): a `window: ` flag is a reader that read past its window, in any reading
  assert.ok(!s.flags.some((f) => f.startsWith('window: ')), JSON.stringify(s.flags))
  return { out, s, dir }
}

// An archived rollout on `day` with 2 h of nothing running and no marker between two Slots: stalls/unexplained tops it.
export function stallDay(h, slug, day) {
  const V = (hm) => `${day}T${hm}:00Z`
  emitAll(h, slug, [[V('00:00'), 'slot-taken', 'x1', S('start')], [V('01:00'), 'slot-freed', 'x1', { outcome: 'ready' }],
    [V('03:00'), 'slot-taken', 'x2', S('start')], [V('04:00'), 'slot-freed', 'x2', { outcome: 'ready' }]])
  done(h, slug)
}
export const closeLine = (h, rid) => rlines(h).find((l) => l.kind === 'reflection' && l.id === rid)
