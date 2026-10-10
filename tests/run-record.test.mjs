// skills/_shared/scripts/run_record.py — the Run record's one writer (ADR 0032, p15-1).
//
// Every case runs the shipped file: the CLI through spawnSync/spawn, the importable API through a small
// `python3 -c` driver that loads it by path (the way p15-2's reconcile subcommands will). Hermetic: each case
// gets its own mkdtemp HOME, an env built from scratch (PATH plus what the case sets), and that HOME as cwd,
// so no default path, relative path or bytecode lands in the checkout or the real ~/.local/state.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SCRIPT = path.join(root, 'skills', '_shared', 'scripts', 'run_record.py')
const TS_RE = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/
const SETTINGS = { parallel_ceiling: 3, max_review_rounds: 4, max_iterations: 3, max_plan_rounds: 3, rung: 'opus-xhigh' }

// ---- helpers ------------------------------------------------------------------------------------------

// beforeRemove(home) runs first in the same after-hook, so a case that locks a directory can unlock it.
function tmpHome(t, beforeRemove = () => {}) {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'run-record-')))
  t.after(() => {
    beforeRemove(home)
    fs.rmSync(home, { recursive: true, force: true })
  })
  return home
}

const baseEnv = (home, env = {}) => ({ PATH: process.env.PATH, HOME: home, PYTHONDONTWRITEBYTECODE: '1', ...env })

// run_record.py <args>, with HOME (and cwd) at `home`; `env` adds to the scratch env, never to process.env.
function cli(home, args, { env = {}, input, py = 'python3' } = {}) {
  const r = spawnSync(py, ['-B', SCRIPT, ...args], { encoding: 'utf8', cwd: home, env: baseEnv(home, env), input })
  return { status: r.status, stdout: r.stdout, stderr: r.stderr }
}

// A python driver that loads the module by path as `m`, then runs `body`; it prints JSON on stdout.
const LOAD = [
  'import importlib.util, json, sys',
  'spec = importlib.util.spec_from_file_location("run_record", sys.argv[1])',
  'm = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)',
].join('\n')
function api(home, body, { env = {}, args = [] } = {}) {
  const r = spawnSync('python3', ['-B', '-c', `${LOAD}\n${body}`, SCRIPT, ...args], { encoding: 'utf8', cwd: home, env: baseEnv(home, env) })
  return { status: r.status, stdout: r.stdout, stderr: r.stderr }
}

const ev = (home) => path.join(home, 'ev')
const EV = (home, env = {}) => ({ THREAD_EVENTS_DIR: ev(home), ...env })
const lines = (file) => fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
const listing = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [])

function emitOk(home, args, opts = {}) {
  const r = cli(home, ['emit', ...args], opts)
  assert.equal(r.stderr, '', `stderr for ${JSON.stringify(args)}`)
  assert.equal(r.status, 0, `status for ${JSON.stringify(args)}`)
  assert.equal(r.stdout, '')
  return r
}

// ---- 1. directory resolution ------------------------------------------------------------------------------

test('dir: THREAD_EVENTS_DIR wins over XDG_STATE_HOME and HOME', (t) => {
  const home = tmpHome(t)
  const r = cli(home, ['dir'], { env: { THREAD_EVENTS_DIR: `${home}/over`, XDG_STATE_HOME: `${home}/xdg` } })
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.stdout, `${home}/over\n`)
})

test('dir: XDG_STATE_HOME with the override unset, then the HOME fallback', (t) => {
  const home = tmpHome(t)
  assert.equal(cli(home, ['dir'], { env: { XDG_STATE_HOME: `${home}/xdg` } }).stdout, `${home}/xdg/thread/events\n`)
  assert.equal(cli(home, ['dir']).stdout, `${home}/.local/state/thread/events\n`)
})

test('dir: an empty override counts as unset, and `~` expands to HOME', (t) => {
  const home = tmpHome(t)
  assert.equal(cli(home, ['dir'], { env: { THREAD_EVENTS_DIR: '', XDG_STATE_HOME: `${home}/xdg` } }).stdout, `${home}/xdg/thread/events\n`)
  assert.equal(cli(home, ['dir'], { env: { THREAD_EVENTS_DIR: '~/ev' } }).stdout, `${home}/ev\n`)
})

test('a relative XDG_STATE_HOME (or an empty one) is ignored, as the XDG spec says', (t) => {
  const home = tmpHome(t)
  for (const x of ['rel/state', '']) {
    assert.equal(cli(home, ['dir'], { env: { XDG_STATE_HOME: x } }).stdout, `${home}/.local/state/thread/events\n`, `XDG_STATE_HOME=${x}`)
  }
})

test('emit lands in the resolved directory: override, XDG, HOME', (t) => {
  const home = tmpHome(t)
  emitOk(home, ['--rollout', 'r', '--kind', 'resumed'], { env: { THREAD_EVENTS_DIR: `${home}/over`, XDG_STATE_HOME: `${home}/xdg` } })
  emitOk(home, ['--rollout', 'r', '--kind', 'resumed'], { env: { XDG_STATE_HOME: `${home}/xdg` } })
  emitOk(home, ['--rollout', 'r', '--kind', 'resumed'])
  for (const d of ['over', 'xdg/thread/events', '.local/state/thread/events']) {
    assert.equal(lines(path.join(home, d, 'r.jsonl')).length, 1, d)
  }
})

test('a relative THREAD_EVENTS_DIR is a warned write failure: exit 0, nothing written', (t) => {
  const home = tmpHome(t)
  const r = cli(home, ['emit', '--rollout', 'r', '--kind', 'resumed'], { env: { THREAD_EVENTS_DIR: 'rel/ev' } })
  assert.equal(r.status, 0)
  assert.match(r.stderr, /^run_record: warning: .*relative.*\n$/)
  assert.deepEqual(listing(home), [])
  const d = cli(home, ['dir'], { env: { THREAD_EVENTS_DIR: 'rel/ev' } })
  assert.equal(d.status, 1)
  assert.equal(d.stdout, '')
  assert.match(d.stderr, /^run_record: .*relative/)
})

// ---- 2. UTC ------------------------------------------------------------------------------------------------

test('ts is UTC with a Z, millisecond precision, whatever the local zone', (t) => {
  const home = tmpHome(t)
  const before = Date.now()
  emitOk(home, ['--rollout', 'r', '--kind', 'resumed'], { env: EV(home, { TZ: 'Australia/Melbourne' }) })
  const [l] = lines(path.join(ev(home), 'r.jsonl'))
  assert.match(l.ts, TS_RE)
  assert.ok(Math.abs(Date.parse(l.ts) - before) < 5000, `${l.ts} is within 5 s of now`)
})

test('--ts with an offset converts to UTC; a Z stamp passes through; a naive stamp is refused', (t) => {
  const home = tmpHome(t)
  const f = path.join(ev(home), 'r.jsonl')
  emitOk(home, ['--rollout', 'r', '--kind', 'resumed', '--ts', '2026-10-04T09:23:00+11:00'], { env: EV(home) })
  emitOk(home, ['--rollout', 'r', '--kind', 'resumed', '--ts', '2026-10-04T09:23:00Z'], { env: EV(home) })
  assert.deepEqual(lines(f).map((l) => l.ts), ['2026-10-03T22:23:00.000Z', '2026-10-04T09:23:00.000Z'])
  const r = cli(home, ['emit', '--rollout', 'r', '--kind', 'resumed', '--ts', '2026-10-04T09:23:00'], { env: EV(home) })
  assert.equal(r.status, 2)
  assert.match(r.stderr, /^run_record: refused: .*\n$/)
  assert.equal(lines(f).length, 2)
})

// One accepted shape on every python: 3.9's fromisoformat refuses both of these, 3.11's takes them.
test('--ts takes a +HHMM offset (date %z) and a short fraction; a malformed stamp is refused', (t) => {
  const home = tmpHome(t)
  const f = path.join(ev(home), 'r.jsonl')
  emitOk(home, ['--rollout', 'r', '--kind', 'resumed', '--ts', '2026-10-04T09:23:00+1100'], { env: EV(home) })
  emitOk(home, ['--rollout', 'r', '--kind', 'resumed', '--ts', '2026-10-04T09:23:00.12Z'], { env: EV(home) })
  assert.deepEqual(lines(f).map((l) => l.ts), ['2026-10-03T22:23:00.000Z', '2026-10-04T09:23:00.120Z'])
  for (const bad of ['20261004T092300Z', '2026-10-04T25:00:00Z', 'yesterday']) {
    const r = cli(home, ['emit', '--rollout', 'r', '--kind', 'resumed', '--ts', bad], { env: EV(home) })
    assert.equal(r.status, 2, bad)
    assert.match(r.stderr, /^run_record: refused: .*\n$/, bad)
  }
  assert.equal(lines(f).length, 2)
})

test('a DST-straddling pair (16:16+10:00 to 09:23+11:00) is 16 h 07 min apart', (t) => {
  const home = tmpHome(t)
  emitOk(home, ['--rollout', 'r', '--kind', 'resumed', '--ts', '2026-10-03T16:16:00+10:00'], { env: EV(home) })
  emitOk(home, ['--rollout', 'r', '--kind', 'resumed', '--ts', '2026-10-04T09:23:00+11:00'], { env: EV(home) })
  const [a, b] = lines(path.join(ev(home), 'r.jsonl')).map((l) => Date.parse(l.ts))
  assert.equal(b - a, (16 * 60 + 7) * 60 * 1000)
})

// ---- 3. refusals ---------------------------------------------------------------------------------------------

const REFUSALS = [
  ['an unknown kind', ['--rollout', 'r', '--kind', 'bogus']],
  ['ceiling-changed (settings ride on slot-taken and idle-slots instead)', ['--rollout', 'r', '--kind', 'ceiling-changed', '--json', '{"parallel_ceiling":5}']],
  ['slot-taken without settings', ['--rollout', 'r', '--task', 't', '--kind', 'slot-taken']],
  ['slot-taken with a zero ceiling', ['--rollout', 'r', '--task', 't', '--kind', 'slot-taken', '--json', '{"settings":{"parallel_ceiling":0}}']],
  ['hold=foo', ['--rollout', 'r', '--kind', 'hold-started', '--json', '{"hold":"foo"}']],
  ['a task-scoped kind without --task', ['--rollout', 'r', '--kind', 'ready']],
  ['a non-object --json', ['--rollout', 'r', '--kind', 'resumed', '--json', '[1,2]']],
  ['an invalid --json', ['--rollout', 'r', '--kind', 'resumed', '--json', '{nope']],
  ['a common-key collision', ['--rollout', 'r', '--kind', 'resumed', '--json', '{"ts":"2026-10-04T00:00:00Z"}']],
  ['a NaN value', ['--rollout', 'r', '--kind', 'resumed', '--json', '{"x":NaN}']],
  ['call-journal without status', ['--rollout', 'r', '--kind', 'call-journal', '--json', '{"runId":"w1"}']],
  ['call-journal with startTime as a string (it is the journal\'s epoch-ms integer)', ['--rollout', 'r', '--kind', 'call-journal', '--json', '{"runId":"w1","status":"running","startTime":"2026-10-04T09:23:00+11:00"}']],
  ['a traversal rollout slug', ['--rollout', '../x', '--kind', 'resumed']],
  ['a rollout slug with a slash', ['--rollout', 'a/b', '--kind', 'resumed']],
  ['an empty rollout slug', ['--rollout', '', '--kind', 'resumed']],
  ['`reviews` as the rollout', ['--rollout', 'reviews', '--kind', 'resumed']],
  ['`tunings` as the rollout', ['--rollout', 'tunings', '--kind', 'resumed']],
  ['`tunings` as a carried from', ['--rollout', 'r', '--task', 't', '--kind', 'carried', '--json', '{"from":"[[Tunings]]"}']],
  ['a tuning with a task', ['--rollout', 'r', '--task', 't', '--kind', 'tuning', '--json', JSON.stringify({ id: 't1', repo: 'o/r', window: { since: '2026-10-04T00:00:00.000Z', until: '2026-10-04T10:00:00.000Z' }, scores: { throughput: 1, runningHours: 2, merges: 2, tokensPerMerge: null, setAsideRate: 0, conflictRate: 0, quotaStalls: 0 }, applied: [] })]],
  ['a traversal task slug', ['--rollout', 'r', '--task', '../x', '--kind', 'ready']],
  ['no rollout for a rollout kind', ['--kind', 'resumed']],
  ['a line over 16 KiB', ['--rollout', 'r', '--kind', 'quota-stall', '--json', JSON.stringify({ detail: 'x'.repeat(17000) })]],
  // auto-retry (p16-4): its stage is a block's, never a gate (a sign-off is no retry); stage and a budget >= 1 required.
  ['auto-retry at stage gate', ['--rollout', 'r', '--task', 't', '--kind', 'auto-retry', '--json', JSON.stringify({ stage: 'gate', setAsideAt: 'run', retryClass: 'agent', used: 1, budget: 2 })]],
  ['auto-retry without a stage', ['--rollout', 'r', '--task', 't', '--kind', 'auto-retry', '--json', JSON.stringify({ setAsideAt: 'run', retryClass: 'agent', used: 1, budget: 2 })]],
  ['auto-retry with budget 0 (auto_retries: 0 retries nothing)', ['--rollout', 'r', '--task', 't', '--kind', 'auto-retry', '--json', JSON.stringify({ stage: 'plan', setAsideAt: 'run', retryClass: 'agent', used: 1, budget: 0 })]],
  ['auto-retry set aside at a gate', ['--rollout', 'r', '--task', 't', '--kind', 'auto-retry', '--json', JSON.stringify({ stage: 'plan', setAsideAt: 'gate', retryClass: 'agent', used: 1, budget: 2 })]],
  ['auto-retry without a task', ['--rollout', 'r', '--kind', 'auto-retry', '--json', JSON.stringify({ stage: 'plan', setAsideAt: 'run', retryClass: 'agent', used: 1, budget: 2 })]],
]

for (const [name, args] of REFUSALS) {
  test(`refused with exit 2, one line, nothing written: ${name}`, (t) => {
    const home = tmpHome(t)
    const r = cli(home, ['emit', ...args], { env: EV(home) })
    assert.equal(r.status, 2, `stderr: ${r.stderr}`)
    assert.equal(r.stdout, '')
    assert.match(r.stderr, /^run_record: refused: \S.*\n$/, 'one prefixed line on stderr')
    assert.deepEqual(listing(ev(home)), [], 'no file created')
  })
}

test('auto-retry (p16-4): a valid emit, and a quota retry with used 0 and its quotaRetries', (t) => {
  const home = tmpHome(t)
  emitOk(home, ['--rollout', 'r', '--task', 't', '--kind', 'auto-retry', '--json',
    JSON.stringify({ stage: 'review', setAsideAt: 'run', retryClass: 'agent', used: 1, budget: 2, fingerprint: 'abcdef012345', reviewRounds: 4 })], { env: EV(home) })
  emitOk(home, ['--rollout', 'r', '--task', 't', '--kind', 'auto-retry', '--json',
    JSON.stringify({ stage: 'integrate', setAsideAt: 'integration', retryClass: 'quota', used: 0, budget: 2, quotaRetries: 1 })], { env: EV(home) })
  const [a, b] = lines(path.join(ev(home), 'r.jsonl'))
  assert.deepEqual([a.kind, a.task, a.stage, a.used, a.budget, a.reviewRounds, a.fingerprint], ['auto-retry', 't', 'review', 1, 2, 4, 'abcdef012345'])
  assert.deepEqual([b.retryClass, b.used, b.quotaRetries, b.setAsideAt], ['quota', 0, 1, 'integration'])
})

test('unknown extra keys are allowed beside the kind fields', (t) => {
  const home = tmpHome(t)
  emitOk(home, ['--rollout', 'r', '--task', 't', '--kind', 'ready', '--json', '{"pr":"https://github.com/o/r/pull/7","harness":"codex","extra":1}'], { env: EV(home) })
  const [l] = lines(path.join(ev(home), 'r.jsonl'))
  assert.equal(l.harness, 'codex')
  assert.equal(l.extra, 1)
})

// ---- 4. best-effort writes -----------------------------------------------------------------------------------

function warnsNothingWritten(home, env, what) {
  const r = cli(home, ['emit', '--rollout', 'r', '--kind', 'resumed'], { env })
  assert.equal(r.status, 0, `${what}: ${r.stderr}`)
  assert.equal(r.stdout, '')
  assert.match(r.stderr, /^run_record: warning: cannot write .*\n$/, what)
}

test('the events dir under a regular file (ENOTDIR) warns and exits 0', (t) => {
  const home = tmpHome(t)
  fs.writeFileSync(path.join(home, 'file'), '')
  warnsNothingWritten(home, { THREAD_EVENTS_DIR: `${home}/file/events` }, 'ENOTDIR')
  assert.equal(fs.readFileSync(path.join(home, 'file'), 'utf8'), '')
})

test('an unwritable parent (chmod 0500) warns and exits 0', { skip: process.getuid?.() === 0 && 'root ignores modes' }, (t) => {
  const home = tmpHome(t, (h) => fs.chmodSync(path.join(h, 'locked'), 0o700))
  fs.mkdirSync(path.join(home, 'locked'), { mode: 0o500 })
  fs.chmodSync(path.join(home, 'locked'), 0o500)
  warnsNothingWritten(home, { THREAD_EVENTS_DIR: `${home}/locked/events` }, 'EACCES')
  assert.deepEqual(listing(path.join(home, 'locked')), [])
})

test('a dangling-symlink events dir warns and never falls back elsewhere', (t) => {
  const home = tmpHome(t)
  fs.symlinkSync(path.join(home, 'gone'), path.join(home, 'link'))
  warnsNothingWritten(home, { THREAD_EVENTS_DIR: `${home}/link`, XDG_STATE_HOME: `${home}/xdg` }, 'dangling')
  assert.deepEqual(listing(home), ['link'], 'no target created, no XDG or HOME fallback')
})

// ---- 5. concurrency ------------------------------------------------------------------------------------------

function run(cmd, args, env, cwd) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { env, cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    let err = ''
    p.stderr.on('data', (d) => { err += d })
    p.on('close', (code) => resolve({ code, err }))
  })
}

test('concurrent emitters (4 importers x 300, 2 CLI loops) leave every line whole', async (t) => {
  const home = tmpHome(t)
  const env = baseEnv(home, EV(home))
  const worker = `${LOAD}
pad = "x" * 3000
for i in range(300):
    assert m.emit("conc", "quota-stall", fields={"detail": pad, "w": sys.argv[2], "i": i}, strict=True)`
  const loop = `for i in $(seq 1 25); do python3 -B "$1" emit --rollout conc --kind quota-stall --json "{\\"detail\\":\\"$(printf 'y%.0s' $(seq 1 3000))\\",\\"w\\":\\"$2\\",\\"i\\":$i}" || exit 1; done`
  const procs = [
    ...[0, 1, 2, 3].map((w) => run('python3', ['-B', '-c', worker, SCRIPT, `p${w}`], env, home)),
    ...[0, 1].map((w) => run('bash', ['-c', loop, 'loop', SCRIPT, `c${w}`], env, home)),
  ]
  for (const r of await Promise.all(procs)) assert.equal(r.code, 0, r.err)
  const raw = fs.readFileSync(path.join(ev(home), 'conc.jsonl'), 'utf8')
  assert.ok(raw.endsWith('\n'))
  const all = raw.split('\n').filter(Boolean).map((l) => JSON.parse(l))
  assert.equal(all.length, 4 * 300 + 2 * 25)
  for (const w of ['p0', 'p1', 'p2', 'p3']) assert.equal(all.filter((l) => l.w === w).length, 300, w)
  for (const w of ['c0', 'c1']) assert.equal(all.filter((l) => l.w === w).length, 25, w)
})

test('8 concurrent call-journal folders over overlapping runIds leave one line per runId', async (t) => {
  const home = tmpHome(t)
  const env = baseEnv(home, EV(home))
  // A stress check: every worker spins to a shared start instant, then folds the same runIds in the same
  // order, so the scans race head to head. It catches an unlocked fold only some of the time; the next test
  // is the deterministic check that the fold waits for the lock.
  const worker = `${LOAD}
import time
start = float(sys.argv[2])
while time.time() < start:
    pass
for i in range(40):
    for _ in range(2):
        assert m.emit("fold", "call-journal", fields={"runId": "w%02d" % i, "status": "completed", "tokens": 9}, strict=True)`
  const start = String(Date.now() / 1000 + 1.5)
  const res = await Promise.all([0, 1, 2, 3, 4, 5, 6, 7].map(() => run('python3', ['-B', '-c', worker, SCRIPT, start], env, home)))
  for (const r of res) assert.equal(r.code, 0, r.err)
  const all = lines(path.join(ev(home), 'fold.jsonl'))
  assert.equal(all.length, 40)
  assert.equal(new Set(all.map((l) => l.runId)).size, 40)
})

// A holder takes the flock; a fold of runId X starts and reaches the lock (its retry sleep is the signal; an
// unlocked fold never sleeps, so it finishes first and writes its line); the holder then appends a terminal X
// line and releases. A fold that waited for the lock re-scans, finds the terminal line and skips: 1 line.
test('a call-journal fold waits for the flock, then scans: a terminal line written meanwhile wins', async (t) => {
  const home = tmpHome(t)
  const f = path.join(ev(home), 'r.jsonl')
  fs.mkdirSync(ev(home))
  fs.writeFileSync(f, '')
  const terminal = JSON.stringify({ v: 1, ts: '2026-10-04T00:00:00.000Z', host: 'h', rollout: 'r', task: null, kind: 'call-journal', runId: 'X', status: 'completed' })
  const holder = spawn('python3', ['-B', '-c', [
    'import fcntl, sys',
    'fd = open(sys.argv[1], "a")',
    'fcntl.flock(fd, fcntl.LOCK_EX)',
    'print("held", flush=True)',
    'sys.stdin.readline()',
    'fd.write(sys.argv[2] + "\\n"); fd.flush()',
    'fcntl.flock(fd, fcntl.LOCK_UN)',
  ].join('\n'), f, terminal], { env: baseEnv(home), stdio: ['pipe', 'pipe', 'inherit'] })
  t.after(() => holder.kill())
  const holderDone = new Promise((resolve) => holder.on('close', resolve))
  await new Promise((resolve) => holder.stdout.once('data', resolve))
  const folder = spawn('python3', ['-B', '-c', `${LOAD}
real = m.time.sleep
said = []
def sleep(s):
    if not said:
        said.append(1)
        print("waiting", flush=True)
    real(s)
m.time.sleep = sleep
print(json.dumps(m.emit("r", "call-journal", fields={"runId": "X", "status": "running", "tokens": 1}, strict=True)))`, SCRIPT],
  { env: baseEnv(home, EV(home)), cwd: home, stdio: ['ignore', 'pipe', 'pipe'] })
  t.after(() => folder.kill())
  let out = ''
  let err = ''
  folder.stderr.on('data', (d) => { err += d })
  const folderDone = new Promise((resolve) => folder.on('close', resolve))
  // Release the holder once the fold is waiting on the lock, or once it has finished without waiting.
  await Promise.race([new Promise((resolve) => folder.stdout.on('data', (d) => { out += d; if (out.includes('waiting')) resolve() })), folderDone])
  holder.stdin.end('go\n')
  await holderDone
  const code = await folderDone
  assert.equal(code, 0, err)
  assert.equal(err, '')
  assert.match(out, /^waiting\ntrue\n$/, 'the fold waited on the lock, then returned True (skipped)')
  const all = lines(f)
  assert.equal(all.length, 1, 'only the holder\'s terminal line: the fold saw it after taking the lock')
  assert.equal(all[0].status, 'completed')
})

// ---- 6. shape ------------------------------------------------------------------------------------------------

test('common keys come first and in order, then the kind fields', (t) => {
  const home = tmpHome(t)
  emitOk(home, ['--rollout', 'r', '--task', 't', '--kind', 'slot-taken', '--json', JSON.stringify({ settings: SETTINGS, start: 'start' })], { env: EV(home) })
  emitOk(home, ['--rollout', 'r', '--kind', 'idle-slots', '--json', JSON.stringify({ reason: 'queue-tail', free: 2, settings: SETTINGS })], { env: EV(home) })
  const raw = fs.readFileSync(path.join(ev(home), 'r.jsonl'), 'utf8').split('\n').filter(Boolean)
  const [a, b] = raw.map((l) => JSON.parse(l))
  assert.deepEqual(Object.keys(a), ['v', 'ts', 'host', 'rollout', 'task', 'kind', 'settings', 'start'])
  assert.deepEqual(Object.keys(b), ['v', 'ts', 'host', 'rollout', 'task', 'kind', 'reason', 'free', 'settings'])
  assert.equal(a.v, 1)
  assert.equal(a.task, 't')
  assert.equal(b.task, null)
  assert.match(a.host, /^[^.]+$/, 'the host is the first label only')
  assert.deepEqual(a.settings, SETTINGS)
  assert.ok(!raw[0].includes(': ') && !raw[0].includes(', '), 'compact separators')
})

test('review-round lands in reviews.jsonl with rollout and task null', (t) => {
  const home = tmpHome(t)
  emitOk(home, ['--kind', 'review-round', '--json', '{"repo":"thread-skill","head":"abc1234","digest":"d1","findings":3,"verdict":"changes"}'], { env: EV(home) })
  assert.deepEqual(listing(ev(home)), ['reviews.jsonl'])
  const [l] = lines(path.join(ev(home), 'reviews.jsonl'))
  assert.equal(l.rollout, null)
  assert.equal(l.task, null)
  assert.equal(l.kind, 'review-round')
})

// ---- the tuning kind (skills/retro/scripts/tune.py's one line per Retro) ---------------------------------------

const WINDOW = { since: '2026-10-04T00:00:00.000Z', until: '2026-10-04T10:00:00.000Z', activeStart: '2026-10-04T00:00:00.000Z', activeEnd: '2026-10-04T09:00:00.000Z', partial: false }
const SCORES = { throughput: 0.667, runningHours: 9, merges: 6, tokensPerMerge: 125000, setAsideRate: 0.1, conflictRate: null, quotaStalls: 0 }
const APPLIED = { key: 'parallel_ceiling', from: 3, to: 4, ranAt: 3, rule: 'slot-bound-raise', evidence: 'Slot-bound: Slots full 62% of 9 running h, lane 25% busy', agreeing: 0 }
const tuning = (over = {}) => ({ id: 't-1', repo: 'o/r', window: WINDOW, scores: SCORES, applied: [APPLIED], binding: 'slot-bound', ...over })

test('tuning lands in tunings.jsonl, its rollout kept as a stamp and its task null', (t) => {
  const home = tmpHome(t)
  emitOk(home, ['--rollout', '[[Demo-Rollout]]', '--kind', 'tuning', '--json', JSON.stringify(tuning())], { env: EV(home) })
  emitOk(home, ['--rollout', 'demo-rollout', '--kind', 'tuning', '--json', JSON.stringify(tuning({ id: 't-2', applied: [], voids: 't-1' }))], { env: EV(home) })
  assert.deepEqual(listing(ev(home)), ['tunings.jsonl'], 'never the rollout\'s own record')
  const [a, b] = lines(path.join(ev(home), 'tunings.jsonl'))
  assert.equal(a.rollout, 'demo-rollout')
  assert.equal(a.task, null)
  assert.equal(a.kind, 'tuning')
  assert.deepEqual(a.window, WINDOW)
  assert.deepEqual(a.scores, SCORES)
  assert.deepEqual(a.applied, [APPLIED])
  assert.equal(b.voids, 't-1')
  assert.deepEqual(b.applied, [])
})

test('a tuning with a null activeStart and activeEnd (no running time) is recorded', (t) => {
  const home = tmpHome(t)
  emitOk(home, ['--rollout', 'r', '--kind', 'tuning', '--json', JSON.stringify(tuning({ window: { since: WINDOW.since, until: WINDOW.until, activeStart: null, activeEnd: null } }))], { env: EV(home) })
  assert.equal(lines(path.join(ev(home), 'tunings.jsonl')).length, 1)
})

const { merges: _m, ...SCORES_LESS } = SCORES
const TUNING_REFUSALS = [
  ['no rollout', null, tuning()],
  ['scores missing a key', 'r', tuning({ scores: SCORES_LESS })],
  ['scores with an extra key', 'r', tuning({ scores: { ...SCORES, speed: 1 } })],
  ['scores with a string', 'r', tuning({ scores: { ...SCORES, throughput: 'fast' } })],
  ['merges null', 'r', tuning({ scores: { ...SCORES, merges: null } })],
  ['quotaStalls negative', 'r', tuning({ scores: { ...SCORES, quotaStalls: -1 } })],
  ['window with an extra key', 'r', tuning({ window: { ...WINDOW, tz: 'Australia/Melbourne' } })],
  ['window with no until', 'r', tuning({ window: { since: WINDOW.since } })],
  ['a naive activeEnd', 'r', tuning({ window: { ...WINDOW, activeEnd: '2026-10-04T09:00:00' } })],
  ['an offset since (UTC Z only)', 'r', tuning({ window: { ...WINDOW, since: '2026-10-04T11:00:00+11:00' } })],
  ['partial not a boolean', 'r', tuning({ window: { ...WINDOW, partial: 'no' } })],
  ['applied from == to', 'r', tuning({ applied: [{ ...APPLIED, to: 3 }] })],
  ['applied with an unknown key name', 'r', tuning({ applied: [{ ...APPLIED, key: 'verify_timeout' }] })],
  ['applied with an extra field', 'r', tuning({ applied: [{ ...APPLIED, note: 'x' }] })],
  ['applied with a zero ranAt', 'r', tuning({ applied: [{ ...APPLIED, ranAt: 0 }] })],
  ['applied evidence over 300 characters', 'r', tuning({ applied: [{ ...APPLIED, evidence: 'e'.repeat(301) }] })],
  ['applied rule over 64 characters', 'r', tuning({ applied: [{ ...APPLIED, rule: 'r'.repeat(65) }] })],
  ['applied with 9 entries', 'r', tuning({ applied: Array(9).fill(APPLIED) })],
  ['an unknown binding', 'r', tuning({ binding: 'cpu-bound' })],
  ['no id', 'r', (({ id, ...rest }) => rest)(tuning())],
]

for (const [name, rollout, fields] of TUNING_REFUSALS) {
  test(`tuning refused with exit 2, nothing written: ${name}`, (t) => {
    const home = tmpHome(t)
    const r = cli(home, ['emit', ...(rollout ? ['--rollout', rollout] : []), '--kind', 'tuning', '--json', JSON.stringify(fields)], { env: EV(home) })
    assert.equal(r.status, 2, `stderr: ${r.stderr}`)
    assert.match(r.stderr, /^run_record: refused: \S.*\n$/)
    assert.deepEqual(listing(ev(home)), [])
  })
}

test('a NaN score is refused through the API (the CLI\'s JSON never carries one)', (t) => {
  const home = tmpHome(t)
  const r = api(home, `
f = json.loads(sys.argv[2]); f["scores"]["throughput"] = float("nan")
try:
    m.emit("r", "tuning", fields=f, strict=True); print("written")
except m.Refused as e:
    print("Refused")`, { env: EV(home), args: [JSON.stringify(tuning())] })
  assert.equal(r.stdout, 'Refused\n', r.stderr)
  assert.deepEqual(listing(ev(home)), [])
})

test('the tuning keys are rollout-settings.py\'s KEYS, and RESERVED holds both record files', (t) => {
  const home = tmpHome(t)
  const rs = path.join(root, 'skills', '_shared', 'scripts', 'rollout-settings.py')
  const r = api(home, `
spec2 = importlib.util.spec_from_file_location("rs", sys.argv[2]); rs = importlib.util.module_from_spec(spec2); spec2.loader.exec_module(rs)
print(json.dumps([list(m.TUNING_KEYS), list(rs.KEYS), list(m.RESERVED)]))`, { args: [rs] })
  assert.equal(r.status, 0, r.stderr)
  const [mine, theirs, reserved] = JSON.parse(r.stdout)
  assert.deepEqual(mine, theirs)
  assert.deepEqual(reserved, ['reviews', 'tunings'])
})

test('rollout and task slugs normalise from wikilinks, note paths and any case', (t) => {
  const home = tmpHome(t)
  for (const r of ['[[Foo]]', '/p/Foo.md', 'FOO']) emitOk(home, ['--rollout', r, '--kind', 'resumed'], { env: EV(home) })
  for (const tk of ['[[Bar-Baz]]', '/Users/x/Work/Tasks/Bar-Baz.md', 'BAR-BAZ', '[[bar-baz|alias]]']) {
    emitOk(home, ['--rollout', 'foo', '--task', tk, '--kind', 'lane-taken'], { env: EV(home) })
  }
  assert.deepEqual(listing(ev(home)), ['foo.jsonl'])
  const all = lines(path.join(ev(home), 'foo.jsonl'))
  assert.equal(all.length, 7)
  assert.ok(all.every((l) => l.rollout === 'foo'))
  assert.deepEqual(all.slice(3).map((l) => l.task), ['bar-baz', 'bar-baz', 'bar-baz', 'bar-baz'])
})

test('--json - reads the fields from stdin; non-ASCII is escaped', (t) => {
  const home = tmpHome(t)
  emitOk(home, ['--rollout', 'r', '--kind', 'quota-stall', '--json', '-'], { env: EV(home), input: '{"detail":"café — ok"}' })
  const raw = fs.readFileSync(path.join(ev(home), 'r.jsonl'), 'utf8')
  assert.ok(/^[\x00-\x7f]*$/.test(raw), 'ASCII only on disk')
  assert.equal(JSON.parse(raw).detail, 'café — ok')
})

// ---- 7. journal folds ----------------------------------------------------------------------------------------

test('call-journal folds: progress appends, a repeat or a post-terminal fold adds nothing', (t) => {
  const home = tmpHome(t)
  const f = path.join(ev(home), 'r.jsonl')
  const fold = (o) => emitOk(home, ['--rollout', 'r', '--kind', 'call-journal', '--json', JSON.stringify(o)], { env: EV(home) })
  const count = () => lines(f).length
  fold({ runId: 'w1', status: 'running', tokens: 100, durationMs: 5000 })
  fold({ runId: 'w1', status: 'running', tokens: 100, durationMs: 5000 })
  assert.equal(count(), 1, '(i) an identical mid-run fold is absorbed')
  fold({ runId: 'w1', status: 'running', tokens: 300, durationMs: 9000 })
  assert.equal(count(), 2, '(ii) a mid-run fold with progress appends')
  fold({ runId: 'w1', status: 'completed', tokens: 900, durationMs: 20000 })
  assert.equal(count(), 3, '(iii) the terminal fold lands')
  fold({ runId: 'w1', status: 'completed', tokens: 900, durationMs: 20000 })
  fold({ runId: 'w1', status: 'completed', tokens: 1200, durationMs: 30000 })
  fold({ runId: 'w1', status: 'running', tokens: 5, durationMs: 1 })
  assert.equal(count(), 3, '(iv) nothing lands after a terminal line')
  fold({ runId: 'w2', status: 'killed', tokens: 7 })
  assert.equal(count(), 4, '(v) another runId appends')
  fold({ runId: 'w3', status: 'weird', tokens: 1 })
  fold({ runId: 'w3', status: 'completed', tokens: 2 })
  assert.equal(count(), 6, '(vii) an unknown status is non-terminal: kept, and the completed fold still lands')

  // (vi) The header's reader rule: per runId, the latest terminal line, else the latest line (in flight).
  const r = api(home, `
latest = {}
for raw in open(sys.argv[2]):
    try:
        d = json.loads(raw)
    except ValueError:
        continue
    if d.get("kind") != "call-journal":
        continue
    cur = latest.get(d["runId"])
    if cur is None or d["status"] in m.TERMINAL_STATUSES or cur["status"] not in m.TERMINAL_STATUSES:
        latest[d["runId"]] = d
print(json.dumps({k: [v["status"], v["tokens"]] for k, v in latest.items()}))`, { args: [f] })
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(JSON.parse(r.stdout), { w1: ['completed', 900], w2: ['killed', 7], w3: ['completed', 2] })
})

test('call-journal takes startTime as the journal\'s epoch-ms integer, verbatim', (t) => {
  const home = tmpHome(t)
  emitOk(home, ['--rollout', 'r', '--kind', 'call-journal', '--json', '{"runId":"w1","status":"running","startTime":1788422612019}'], { env: EV(home) })
  const [l] = lines(path.join(ev(home), 'r.jsonl'))
  assert.equal(l.startTime, 1788422612019)
})

test('a call-journal fold whose lock stays busy past 5 s warns, exits 0 and writes nothing', (t) => {
  const home = tmpHome(t)
  const f = path.join(ev(home), 'r.jsonl')
  fs.mkdirSync(ev(home))
  fs.writeFileSync(f, '')
  const holder = spawn('python3', ['-B', '-c', 'import fcntl, sys, time\nfd = open(sys.argv[1], "a")\nfcntl.flock(fd, fcntl.LOCK_EX)\nprint("held", flush=True)\ntime.sleep(30)', f], { env: baseEnv(home), stdio: ['ignore', 'pipe', 'inherit'] })
  t.after(() => holder.kill())
  return new Promise((resolve, reject) => {
    holder.stdout.once('data', () => {
      try {
        const t0 = Date.now()
        const r = cli(home, ['emit', '--rollout', 'r', '--kind', 'call-journal', '--json', '{"runId":"w1","status":"completed"}'], { env: EV(home) })
        assert.ok(Date.now() - t0 >= 4500, 'it waited for the lock')
        assert.equal(r.status, 0)
        assert.match(r.stderr, /^run_record: warning: cannot write .*lock.*\n$/)
        assert.equal(fs.readFileSync(f, 'utf8'), '')
        resolve()
      } catch (e) { reject(e) }
    })
  })
})

// ---- 8. review-round is not deduped ---------------------------------------------------------------------------

test('review-round is never deduped by the writer: idempotency is the emitter\'s job', (t) => {
  const home = tmpHome(t)
  const args = ['--kind', 'review-round', '--json', '{"repo":"r","head":"abc","digest":"d"}']
  emitOk(home, args, { env: EV(home) })
  emitOk(home, args, { env: EV(home) })
  assert.equal(lines(path.join(ev(home), 'reviews.jsonl')).length, 2)
})

// ---- 9. carry ------------------------------------------------------------------------------------------------

test('carried appends to the old and the new rollout files, each line naming its own file', (t) => {
  const home = tmpHome(t)
  emitOk(home, ['--rollout', 'new-r', '--task', 'T1', '--kind', 'carried', '--json', '{"from":"[[Old-R]]"}'], { env: EV(home) })
  assert.deepEqual(listing(ev(home)), ['new-r.jsonl', 'old-r.jsonl'])
  for (const slug of ['old-r', 'new-r']) {
    const [l] = lines(path.join(ev(home), `${slug}.jsonl`))
    assert.equal(l.rollout, slug)
    assert.equal(l.task, 't1')
    assert.equal(l.from, 'old-r')
    assert.equal(l.to, 'new-r')
  }
})

test('carried with the old file unwritable still writes the new one, with a warning', (t) => {
  const home = tmpHome(t)
  fs.mkdirSync(path.join(ev(home), 'old-r.jsonl'), { recursive: true }) // a directory where the file goes
  const r = cli(home, ['emit', '--rollout', 'new-r', '--task', 't1', '--kind', 'carried', '--json', '{"from":"old-r"}'], { env: EV(home) })
  assert.equal(r.status, 0)
  assert.match(r.stderr, /^run_record: warning: cannot write .*old-r\.jsonl.*\n$/)
  assert.equal(lines(path.join(ev(home), 'new-r.jsonl')).length, 1)
})

// ---- 10. the importable API ------------------------------------------------------------------------------------

test('emit() never raises by default: a refusal prints one line and returns False', (t) => {
  const home = tmpHome(t)
  const r = api(home, `
out = []
out.append(m.emit("x", "bogus"))
out.append(m.emit("x", "slot-taken", task="t"))
out.append(m.emit("x", "hold-started", fields={"hold": "foo"}))
print(json.dumps(out))`, { env: EV(home) })
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(JSON.parse(r.stdout), [false, false, false])
  const err = r.stderr.split('\n').filter(Boolean)
  assert.equal(err.length, 3)
  for (const l of err) assert.match(l, /^run_record: refused: /)
  assert.deepEqual(listing(ev(home)), [])
})

test('emit(strict=True) raises Refused for a refusal only', (t) => {
  const home = tmpHome(t)
  const r = api(home, `
try:
    m.emit("x", "bogus", strict=True)
    print("no raise")
except m.Refused:
    print("Refused")`, { env: EV(home) })
  assert.equal(r.stdout, 'Refused\n', r.stderr)
  assert.deepEqual(listing(ev(home)), [])
})

test('an unexpected exception while writing is a warning and False, strict or not', (t) => {
  const home = tmpHome(t)
  const r = api(home, `
def boom(*a):
    raise RuntimeError("boom")
m.os.write = boom
print(json.dumps([m.emit("x", "resumed"), m.emit("x", "resumed", strict=True)]))`, { env: EV(home) })
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(JSON.parse(r.stdout), [false, false])
  const err = r.stderr.split('\n').filter(Boolean)
  assert.equal(err.length, 2)
  for (const l of err) assert.match(l, /^run_record: warning: cannot write .*boom/)
})

test('a valid emit returns True; events_dir and record_path are pure', (t) => {
  const home = tmpHome(t)
  const r = api(home, `
ok = m.emit("x", "ready", task="t", fields={"pr": 7})
d = m.events_dir(env={"THREAD_EVENTS_DIR": "/a/b", "HOME": "/h"})
h = m.events_dir(env={"HOME": "/h"})
p = m.record_path("[[X]]", env={"XDG_STATE_HOME": "/s", "HOME": "/h"})
print(json.dumps([ok, d, h, p, m.normalise_slug("[[Foo|bar]]")]))`, { env: EV(home, { XDG_STATE_HOME: `${home}/xdg` }) })
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(JSON.parse(r.stdout), [true, '/a/b', '/h/.local/state/thread/events', '/s/thread/events/x.jsonl', 'foo'])
  assert.equal(lines(path.join(ev(home), 'x.jsonl')).length, 1)
})

// ---- 11. the header and KINDS agree ----------------------------------------------------------------------------

// Each catalogue entry is `kind [T] fields`, continued on deeper-indented lines. Its field list is what is left
// once the (parenthesised) notes and {nested} settings keys are stripped, up to the first full stop (prose
// follows it), split on , and ; with a trailing ? marking an optional field.
function catalogue(doc) {
  const docLines = doc.split('\n')
  const start = docLines.findIndex((l) => l.startsWith('Kinds'))
  assert.ok(start >= 0, 'a Kinds section')
  const end = docLines.findIndex((l, i) => i > start && /^\S/.test(l))
  const entries = []
  for (const l of docLines.slice(start + 1, end < 0 ? undefined : end)) {
    const m = /^ {2}([a-z][a-z-]*) +(?:(T) +)?(.*)$/.exec(l)
    if (m) entries.push({ kind: m[1], task: m[2] === 'T', text: m[3] })
    else if (l.trim() && entries.length) entries.at(-1).text += ` ${l.trim()}`
  }
  return entries.map(({ kind, task, text }) => {
    let s = text
    while (/\([^()]*\)/.test(s)) s = s.replace(/\([^()]*\)/g, '')
    s = s.replace(/\{[^{}]*\}/g, '').split('.')[0]
    const names = s.split(/[,;]/).map((x) => x.trim()).filter(Boolean)
    for (const n of names) assert.match(n, /^[A-Za-z]+\??$/, `${kind}: catalogue field ${JSON.stringify(n)} parses as a name`)
    const req = names.filter((n) => !n.endsWith('?')).sort()
    const opt = names.filter((n) => n.endsWith('?')).map((n) => n.slice(0, -1)).sort()
    return [kind, [task, req, opt]]
  })
}

test('the docstring catalogue matches KINDS: kinds, the task flag, required and optional fields', (t) => {
  const home = tmpHome(t)
  const r = api(home, `print(json.dumps({"doc": m.__doc__, "terminal": sorted(m.TERMINAL_STATUSES),
    "kinds": {k: [t, sorted(req), sorted(opt)] for k, (t, req, opt) in m.KINDS.items()}}))`)
  assert.equal(r.status, 0, r.stderr)
  const { doc, kinds: spec, terminal } = JSON.parse(r.stdout)
  const kinds = Object.keys(spec).sort()
  const entries = catalogue(doc)
  assert.deepEqual(entries.map(([k]) => k).sort(), kinds, 'the catalogue lists every kind once, and no other')
  for (const [kind, fields] of entries) assert.deepEqual(fields, spec[kind], `${kind}: [task required, required, optional]`)
  assert.ok(!kinds.includes('ceiling-changed'))
  for (const s of terminal) assert.ok(doc.includes(s), `terminal status ${s} in the docstring`)
  assert.match(doc, /Mirror contract \(p15-7\)/)
})

// ---- 12. the python 3.8 floor ----------------------------------------------------------------------------------

// Syntax only: ast.parse(feature_version=(3, 8)) catches match statements and 3.9+ grammar, not stdlib APIs added
// after 3.8 or a runtime `list[str]` subscript outside an annotation. The optional real run below covers those
// wherever an older system python exists.
test('the script parses as python 3.8 and defers annotations', () => {
  const r = spawnSync('python3', ['-B', '-c', 'import ast, sys\nast.parse(open(sys.argv[1]).read(), sys.argv[1], feature_version=(3, 8))', SCRIPT], { encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  assert.match(fs.readFileSync(SCRIPT, 'utf8'), /^from __future__ import annotations$/m)
})

const SYS_PY = '/usr/bin/python3'
function sysPySkip() {
  if (!fs.existsSync(SYS_PY)) return `no ${SYS_PY}`
  // On macOS /usr/bin/python3 is a shim that pops a GUI install prompt when the command line tools are missing.
  if (process.platform === 'darwin' && spawnSync('xcode-select', ['-p']).status !== 0) return 'no command line tools'
  return false
}

test('one real emit under the system python', { skip: sysPySkip() }, (t) => {
  const home = tmpHome(t)
  const r = cli(home, ['emit', '--rollout', 'r', '--task', 't', '--kind', 'slot-taken', '--json', JSON.stringify({ settings: SETTINGS }), '--ts', '2026-10-04T09:23:00Z'], { env: EV(home), py: SYS_PY })
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.stderr, '')
  const fold = { runId: 'w1', status: 'completed' }
  assert.equal(cli(home, ['emit', '--rollout', 'r', '--kind', 'call-journal', '--json', JSON.stringify(fold)], { env: EV(home), py: SYS_PY }).status, 0)
  for (const ts of ['2026-10-04T09:23:00+1100', '2026-10-04T09:23:00.12Z']) {
    const s = cli(home, ['emit', '--rollout', 'r', '--kind', 'resumed', '--ts', ts], { env: EV(home), py: SYS_PY })
    assert.equal(s.status, 0, `${ts}: ${s.stderr}`)
  }
  const all = lines(path.join(ev(home), 'r.jsonl'))
  assert.equal(all.length, 4)
  assert.deepEqual(all.map((l) => l.ts).filter((x, i) => i !== 1), ['2026-10-04T09:23:00.000Z', '2026-10-03T22:23:00.000Z', '2026-10-04T09:23:00.120Z'])
})
