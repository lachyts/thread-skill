// skills/reflect/scripts/ledger.py and reflect.py's Time-lost ledger (p29-11, ADR 0051): the hours each cause class cost,
// summed from the Run record across every rollout, ranked by cause and trended week on week; a class that tops it two
// readings running opens a Watch counted in readings; a load-topped ledger holds a Parallel ceiling raise; the Monthly
// audit on the month's first reading, before its ledger; its gaps in the decision task, never against `quiet`. Every rule
// lives in ledger.py's docstring (the model), reflect.py's and run_record.py's; this pins the behaviour.
//
// Hermetic: each case gets its own mkdtemp HOME, THREAD_EVENTS_DIR and tasks dir (with Archive/2026/ and
// Archive/Rollouts/), TZ pinned to Melbourne, an env built from scratch that every spawn passes, and a temp git repo whose
// origin is https://github.com/o/r.git (land.sh reads it locally, no network). Record lines go through run_record.emit in
// one python process per fixture. L1 runs ledger.py's CLI (no score.py), the readings run the real span, and the writers'
// cases that need no score build span.json by hand in span's shape.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync, execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { section } from './lib/contract-text.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const LEDGER = path.join(root, 'skills', 'reflect', 'scripts', 'ledger.py')
const REFLECT = path.join(root, 'skills', 'reflect', 'scripts', 'reflect.py')
const TUNE = path.join(root, 'skills', 'reflect', 'scripts', 'tune.py')
const DUE = path.join(root, 'skills', 'reflect', 'scripts', 'reflect-due.py')
const RUN_RECORD = path.join(root, 'skills', '_shared', 'scripts', 'run_record.py')
const EXECUTE_SKILL = path.join(root, 'skills', 'execute', 'SKILL.md')
const REAL_GIT = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim()

// ---- helpers ----------------------------------------------------------------------------------------------

function setup(t) {
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

const env = (h, extra = {}) => ({ PATH: process.env.PATH, HOME: h.home, PYTHONDONTWRITEBYTECODE: '1', TZ: 'Australia/Melbourne',
  THREAD_EVENTS_DIR: h.ev, GIT_CONFIG_GLOBAL: path.join(h.home, 'gitconfig'), ...extra })
const git = (h, args) => execFileSync(REAL_GIT, ['-C', h.repo, ...args], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: h.home } }).trim()

function run(h, script, args) {
  const r = spawnSync('python3', ['-B', script, ...args], { encoding: 'utf8', cwd: h.home, env: env(h) })
  return { status: r.status, stdout: r.stdout, stderr: r.stderr }
}
const reflect = (h, args) => run(h, REFLECT, args)
function ok(h, args) {
  const r = reflect(h, args)
  assert.equal(r.status, 0, `${args[0]}: ${r.stderr}`)
  return r
}
function refused(h, args, re) {
  const before = sha(reflectionsFile(h))
  const r = reflect(h, args)
  assert.equal(r.status, 2, `${args[0]}: ${r.stderr}`)
  assert.match(r.stderr, re)
  assert.equal(sha(reflectionsFile(h)), before, `${args[0]}: nothing written`)
  return r
}

const reflectionsFile = (h) => path.join(h.ev, 'reflections.jsonl')
const parse = (l) => { try { return JSON.parse(l) } catch { return null } }
const rlines = (h) => (fs.existsSync(reflectionsFile(h)) ? fs.readFileSync(reflectionsFile(h), 'utf8').split('\n').map(parse).filter(Boolean) : [])
const sha = (f) => (fs.existsSync(f) ? crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex') : 'absent')
const tl = (h, source) => rlines(h).filter((l) => l.kind === 'time-lost' && (!source || l.source === source))

// Every event through run_record.emit(strict=True): [ts, kind, task, fields, rollout?].
function emitAll(h, rollout, events) {
  const body = ['import importlib.util, json, sys', 'spec = importlib.util.spec_from_file_location("run_record", sys.argv[1])',
    'm = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)',
    'for ts, kind, task, fields, r in json.load(sys.stdin):', '    assert m.emit(r, kind, task, fields, ts=ts, strict=True), (kind, task, ts)'].join('\n')
  const rows = events.map(([ts, kind, task = null, fields = {}, r = rollout]) => [ts, kind, task, fields, r])
  const r = spawnSync('python3', ['-B', '-c', body, RUN_RECORD], { encoding: 'utf8', cwd: h.home, env: env(h), input: JSON.stringify(rows) })
  assert.equal(r.status, 0, r.stderr)
}

// A python expression over a module loaded by path as `m` (its stdin JSON as `a`), printed as JSON.
function py(h, script, expr, input = null) {
  const body = ['import importlib.util, json, sys', 'spec = importlib.util.spec_from_file_location("m", sys.argv[1])',
    'm = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)', 'a = json.load(sys.stdin)', `print(json.dumps(${expr}))`].join('\n')
  const r = spawnSync('python3', ['-B', '-c', body, script], { encoding: 'utf8', cwd: h.home, env: env(h), input: JSON.stringify(input) })
  assert.equal(r.status, 0, r.stderr)
  return JSON.parse(r.stdout)
}

function rolloutNote(h, slug, { status = 'in_progress', archived = false, shape = null } = {}) {
  const dir = archived ? path.join(h.tasks, 'Archive', 'Rollouts') : h.tasks
  fs.writeFileSync(path.join(dir, `${slug}.md`), ['---', 'tags: [rollout]', `status: ${status}`, 'protocol_version: 5', ...(shape ? [`shape: ${shape}`] : []),
    '---', '', `# ${slug}`, '', `Project root: \`${h.repo}\``, '', '## Notes', ''].join('\n'))
}
const done = (h, slug) => rolloutNote(h, slug, { status: 'done', archived: true })

// ledger.py's CLI over [since, until]: the block, every interval included.
function ledgerCli(h, since, until) {
  const out = path.join(h.out, `ledger-${crypto.randomBytes(3).toString('hex')}.json`)
  const r = run(h, LEDGER, ['--since', since, '--until', until, '--tasks-dir', h.tasks, '--out', out])
  assert.equal(r.status, 0, r.stderr)
  return JSON.parse(fs.readFileSync(out, 'utf8'))
}

const SET = { parallel_ceiling: 2 }
const S = (start) => ({ settings: SET, start })
const T = (day, hm) => `2026-10-${day}T${hm}:00Z`
const SU = (n) => `s-${String(n).padStart(16, '0')}`
const SHA = 'a'.repeat(40)
const suite = (n, by, runner = 'lead') => ({ suite: SU(n), by, runner })
const idle = (reason) => ({ reason, free: 2, settings: SET })
const H0 = { stalls: 0, 'quota-bound': 0, load: 0, 'lane-bound': 0, rework: 0, 'plan-rejected': 0 }
const CLASSES = Object.keys(H0)

// ---- L1: the ledger sums fixture records across rollouts by class and ranks them ------------------------------------

// Eight records over one week, each built to price one part of the model by hand (the stamps say the hours).
const FIXTURE = {
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
const LSINCE = '2026-10-05T00:00:00.000Z'
const LUNTIL = '2026-10-12T00:00:00.000Z'
const SERIAL_LEFT_OUT = '[[l-serial]]: a serial chain (shape: serial): its Legs record no Slots or stops, so the ledger leaves it out'

function fixture(h, over = {}) {
  for (const [slug, events] of Object.entries({ ...FIXTURE, ...over })) emitAll(h, slug, events)
  for (const slug of ['l-stops', 'l-lane', 'l-holds', 'l-caps', 'l-waits', 'l-remainder']) done(h, slug)
  rolloutNote(h, 'l-live') // in progress: live, its open stretch runs to until
  rolloutNote(h, 'l-serial', { shape: 'serial' })
}

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

let N = 0
// A span over [since, until], in its own out directory (so each due reading keeps its own intervals file).
function span(h, since, until) {
  const dir = path.join(h.out, `r${++N}`)
  const out = path.join(dir, 'span.json')
  // --now (tests only) is until itself: a reading of November runs on any day, never clamped to the clock
  ok(h, ['span', '--since', since, '--until', until, '--now', until, '--tasks-dir', h.tasks, '--config', path.join(h.home, 'rollouts.toml'), '--out', out])
  return { out, s: JSON.parse(fs.readFileSync(out, 'utf8')), dir }
}

// An archived rollout on `day` with 2 h of nothing running and no marker between two Slots: stalls/unexplained tops it.
function stallDay(h, slug, day) {
  const V = (hm) => `${day}T${hm}:00Z`
  emitAll(h, slug, [[V('00:00'), 'slot-taken', 'x1', S('start')], [V('01:00'), 'slot-freed', 'x1', { outcome: 'ready' }],
    [V('03:00'), 'slot-taken', 'x2', S('start')], [V('04:00'), 'slot-freed', 'x2', { outcome: 'ready' }]])
  done(h, slug)
}

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
const closeLine = (h, rid) => rlines(h).find((l) => l.kind === 'reflection' && l.id === rid)
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
  assert.match(r3.decide, /^decision task thread-skill-decisions-2026-09-22: /)
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
  const r = ok(h, ['ledger', '--span', nov.out, '--audit', writeJson(nov.dir, 'audit.json', AUDIT_DOC([entry({})]))])
  // the week itself (29 October to 5 November) lost nothing; the audit window's 2 h are October's
  assert.match(r.stdout, /^ledger r-\S+: no time lost of 0 h; baseline 2026-10, audit 2026-11 \(1 entry, 1 gap\), record written\n$/)
  assert.deepEqual(tl(h).map((l) => l.source), ['baseline', 'audit', 'record'], 'the audit lands before its ledger')
  const [au] = tl(h, 'audit')
  assert.deepEqual([au.month, au.since, au.until, au.hours.load, au.recorded, au.rank.slice(0, 2)], ['2026-11', A.since, A.until, 1.5, A.recorded, ['stalls', 'load']])
  assert.deepEqual(au.audit.entries.map((e) => [e.from, e.to, e.hours]), [['2026-10-25T01:00:00.000Z', '2026-10-25T02:30:00.000Z', 1.5]], 'hours from from .. to')
  assert.deepEqual(au.audit.sources.find((s) => !s.read), { source: 'mac-history', read: false, why: 'pmset -g log keeps two days' })
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
  assert.match(d.stdout, /^decision task thread-skill-decisions-2026-11-05: scheduled \S+ \(new\)\n$/)
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
