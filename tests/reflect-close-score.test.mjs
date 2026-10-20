// skills/reflect/scripts/close-score.py — the script half of a Reflection, run at a rollout's close (p21-6, ADR 0037
// d4): fold, settings, origin slug, score and one record-only `tunings.jsonl` line through tune.py, stamped with the
// close that wrote it. One close line per rollout: a re-run answers `already recorded <id>` before any step runs; a
// rollout where nothing ran is `not recorded`; a failed or timed-out step, the overall deadline and an unusable note,
// Project root, events dir or tunings.jsonl are `not scored`, with nothing written. stdout is one line; a signal kills
// the live step's group and leaves stdout empty; the scratch dir never outlives a run.
// A serial note (p24-4) takes the serial path: serial-score.py, then tune.py, a close line stamped shape serial with
// repo null, and never fold-journals, rollout-settings.py, land.sh or score.py (each pinned with a control that shows
// the step would be seen).
//
// Hermetic: each case gets its own mkdtemp HOME (its own THREAD_EVENTS_DIR and TMPDIR under it), an env built from
// scratch (no inherited GIT_*, an empty global git config), a temp git repo with one commit whose origin is
// https://github.com/o/r.git (land.sh --origin-slug reads it locally, no network), and the rollout note at
// <HOME>/repos/obsidian/Work/Tasks/, so score.py's default task-notes dir is the fixture's. The Run record goes
// through run_record.py's own emit (a local copy of reflect-score.test.mjs's emitAll and life() shapes). No
// rollouts.toml unless a case writes one. Times sit two days before now, so the default --until (now) follows them.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, spawnSync, execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CLOSE = path.join(root, 'skills', 'reflect', 'scripts', 'close-score.py')
const TUNE = path.join(root, 'skills', 'reflect', 'scripts', 'tune.py')
const RUN_RECORD = path.join(root, 'skills', '_shared', 'scripts', 'run_record.py')
const REAL_GIT = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim()
const REAL_BASH = execFileSync('sh', ['-c', 'command -v bash'], { encoding: 'utf8' }).trim()
const SLUG = 'demo-rollout-2026-10-05'
const IS_ROOT = typeof process.getuid === 'function' && process.getuid() === 0

// ---- helpers ----------------------------------------------------------------------------------------------

const BASE = Math.floor((Date.now() - 2 * 86400000) / 60000) * 60000
const T = (min) => new Date(BASE + min * 60000).toISOString()
const S = { parallel_ceiling: 2, max_review_rounds: 4, max_iterations: 3, max_plan_rounds: 3 }

// One task's life: a Slot from..to (ready at its end), then a lane holding to laneEnd and its merge.
function life(task, from, to, laneEnd) {
  return [
    [T(from), 'slot-taken', task, { settings: S, start: 'start' }],
    [T(from), 'run-bound', task, { runId: `wf_${task}`, journalDir: '/nonexistent/workflows', call: 'task' }],
    [T(to), 'slot-freed', task, { outcome: 'ready' }],
    [T(to), 'ready', task, { pr: 7 }],
    [T(to), 'lane-taken', task, {}],
    [T(laneEnd), 'lane-freed', task, { release: 'merge', path: 'lead', triggers: [], conflict: false }],
    [T(laneEnd), 'merged', task, { pr: 7 }],
  ]
}
const RECORD = [...life('t1', 0, 60, 70), ...life('t2', 0, 80, 90)].sort((a, b) => Date.parse(a[0]) - Date.parse(b[0]))

const evDir = (home) => path.join(home, 'events')
const tmpDir = (home) => path.join(home, 'tmp')
const tuningsPath = (home) => path.join(evDir(home), 'tunings.jsonl')
const baseEnv = (home, extra = {}) => ({
  PATH: process.env.PATH, HOME: home, PYTHONDONTWRITEBYTECODE: '1', THREAD_EVENTS_DIR: evDir(home), TMPDIR: tmpDir(home),
  GIT_CONFIG_GLOBAL: path.join(home, 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1', ...extra,
})
const lines = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))

// Every event through run_record.emit(strict=True) in one python process: [ts, kind, task, fields, rollout?].
function emitAll(home, events) {
  const body = [
    'import importlib.util, json, sys',
    'spec = importlib.util.spec_from_file_location("run_record", sys.argv[1])',
    'm = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)',
    'for ts, kind, task, fields, r in json.load(sys.stdin):',
    '    assert m.emit(r, kind, task, fields, ts=ts, strict=True), (kind, task, ts)',
  ].join('\n')
  const rows = events.map(([ts, kind, task = null, fields = {}, r = SLUG]) => [ts, kind, task, fields, r])
  const r = spawnSync('python3', ['-B', '-c', body, RUN_RECORD], { encoding: 'utf8', cwd: home, env: baseEnv(home), input: JSON.stringify(rows) })
  assert.equal(r.status, 0, r.stderr)
}

function git(home, args) {
  execFileSync(REAL_GIT, ['-c', 'user.name=close-score', '-c', 'user.email=close-score@example.invalid', ...args],
    { env: baseEnv(home), stdio: ['ignore', 'pipe', 'pipe'] })
}

function writeNote(home, repo, { projectRoot = true } = {}) {
  const tasks = path.join(home, 'repos', 'obsidian', 'Work', 'Tasks')
  fs.mkdirSync(tasks, { recursive: true })
  const note = path.join(tasks, `${SLUG}.md`)
  const body = ['---', 'tags: [rollout]', 'status: in_progress', 'protocol_version: 5', 'parallel_ceiling: 2', '---', '',
    '# demo rollout', '', ...(projectRoot ? [`Project root: \`${repo}\``, ''] : []), '## Queue', '', '1. [[t1]]', '2. [[t2]]', '']
  fs.writeFileSync(note, body.join('\n'))
  return note
}

// A fixture: HOME with tmp/ and an empty gitconfig, a repo with one commit (origin `origin`, or none), the note, and
// the two-task record (unless record is false).
function fixture(t, { origin = 'https://github.com/o/r.git', record = true, projectRoot = true } = {}) {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'reflect-close-score-')))
  const restore = []
  t.after(() => {
    for (const p of restore) { try { fs.chmodSync(p, 0o755) } catch { /* gone */ } }
    fs.rmSync(home, { recursive: true, force: true })
  })
  fs.mkdirSync(tmpDir(home))
  fs.writeFileSync(path.join(home, 'gitconfig'), '')
  const repo = path.join(home, 'repo')
  git(home, ['init', '-q', repo])
  fs.writeFileSync(path.join(repo, 'README.md'), 'demo\n')
  git(home, ['-C', repo, 'add', 'README.md'])
  git(home, ['-C', repo, 'commit', '-q', '-m', 'init'])
  if (origin) git(home, ['-C', repo, 'remote', 'add', 'origin', origin])
  const note = writeNote(home, repo, { projectRoot })
  if (record) emitAll(home, RECORD)
  return { home, repo, note, env: baseEnv(home), restore }
}

const ARGS = (fx, close = 'completion') => ['--rollout', fx.note, '--close', close]

function closeScore(fx, args = ARGS(fx), env = {}) {
  const start = Date.now()
  const r = spawnSync('python3', ['-B', CLOSE, ...args], { encoding: 'utf8', cwd: fx.home, env: { ...fx.env, ...env }, input: '', timeout: 120000 })
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, elapsed: Date.now() - start }
}

// At most one stdout line, and no scratch dir left behind.
function settled(fx, r) {
  assert.ok(r.stdout.split('\n').filter(Boolean).length <= 1, `one stdout line: ${JSON.stringify(r.stdout)}`)
  assert.deepEqual(fs.readdirSync(tmpDir(fx.home)).filter((n) => n.startsWith('thread-close-score-')), [], 'no scratch dir left')
  assert.doesNotMatch(r.stdout + r.stderr, /Traceback/)
}

function recorded(fx, r, close = 'completion') {
  settled(fx, r)
  assert.equal(r.status, 0, r.stderr)
  const m = r.stdout.match(new RegExp(`^close-score: ${SLUG}: recorded (t-\\S+) \\(${close}\\)\\n$`))
  assert.ok(m, r.stdout)
  return m[1]
}

function notScored(fx, r, re) {
  settled(fx, r)
  assert.equal(r.status, 1, `stdout: ${r.stdout} stderr: ${r.stderr}`)
  assert.match(r.stdout, new RegExp(`^close-score: ${SLUG}: not scored: `))
  if (re) assert.match(r.stdout, re)
  assert.ok(!fs.existsSync(tuningsPath(fx.home)), 'no tunings.jsonl')
}

// A by-hand Reflection's line (tune.py --record-only, no --close) from a hand-made score.json in score.py's shape.
function byHand(fx) {
  const p = path.join(fx.home, 'hand-score.json')
  const window = { since: T(0), until: T(120), activeStart: T(0), activeEnd: T(90), partial: false }
  const headline = { throughput: 1.333, runningHours: 1.5, merges: 2, tokensPerMerge: null, setAsideRate: 0, conflictRate: 0, quotaStalls: 0,
    handsOffRate: 1, quality: null, reviewChurn: null }
  fs.writeFileSync(p, JSON.stringify({ rollout: SLUG, repo: 'o/r', window, headline, binding: { constraint: 'none-clear', why: 'x' }, proposals: [], withheld: [], flags: [] }))
  const r = spawnSync('python3', ['-B', TUNE, '--scores', p, '--record-only'], { encoding: 'utf8', cwd: fx.home, env: { ...fx.env, THREAD_EVENTS_DIR: evDir(fx.home) } })
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /^recorded t-\S+ in /)
}

// A fake `git` first on PATH: the real git, except `remote get-url`, which records its pid and hangs.
function hangingGit(fx) {
  const bin = path.join(fx.home, 'fakebin')
  fs.mkdirSync(bin)
  const pidFile = path.join(fx.home, 'sleeper.pid')
  fs.writeFileSync(path.join(bin, 'git'), [
    '#!/bin/sh',
    `case " $* " in *" remote get-url "*) echo $$ > '${pidFile}'; exec sleep 30 ;; esac`,
    `exec '${REAL_GIT}' "$@"`, '',
  ].join('\n'), { mode: 0o755 })
  return { PATH: `${bin}:${process.env.PATH}`, pidFile }
}

const alive = (pid) => { try { process.kill(pid, 0); return true } catch { return false } }
async function gone(pid, ms = 3000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (!alive(pid)) return true
    await new Promise((res) => setTimeout(res, 50))
  }
  return !alive(pid)
}

// ---- the ceremony ---------------------------------------------------------------------------------------------

test('a completion records one close line with no prompt; a second run writes none', (t) => {
  const fx = fixture(t)
  const id = recorded(fx, closeScore(fx))
  const [l, ...rest] = lines(tuningsPath(fx.home))
  assert.equal(rest.length, 0, 'exactly one tunings.jsonl line')
  assert.equal(l.kind, 'tuning')
  assert.equal(l.id, id)
  assert.equal(l.close, 'completion')
  assert.equal(l.rollout, SLUG)
  assert.equal(l.repo, 'o/r')
  assert.deepEqual(l.applied, [])
  assert.equal(l.scores.merges, 2)
  // the task's Verify: a second ceremony run writes none
  const again = closeScore(fx)
  settled(fx, again)
  assert.equal(again.status, 0, again.stderr)
  assert.equal(again.stdout, `close-score: ${SLUG}: already recorded ${id} (completion)\n`)
  assert.equal(lines(tuningsPath(fx.home)).length, 1)
})

test('a re-run answers from tunings.jsonl before any step: a refused rollouts.toml and a gone Project root do not matter', (t) => {
  const fx = fixture(t)
  const id = recorded(fx, closeScore(fx))
  const toml = path.join(fx.home, '.config', 'thread', 'rollouts.toml')
  fs.mkdirSync(path.dirname(toml), { recursive: true })
  fs.writeFileSync(toml, '[defaults]\nparallel_ceiling = 0\n')
  fs.renameSync(fx.repo, `${fx.repo}-moved`)
  const r = closeScore(fx)
  settled(fx, r)
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.stdout, `close-score: ${SLUG}: already recorded ${id} (completion)\n`)
  assert.equal(r.stderr, '', 'no step ran (the fold would WARN on the missing journals)')
  assert.equal(lines(tuningsPath(fx.home)).length, 1)
})

test('a by-hand Reflection line (no close) neither blocks the close line nor is blocked by it', (t) => {
  const fx = fixture(t)
  byHand(fx)
  const id = recorded(fx, closeScore(fx))
  byHand(fx)
  const all = lines(tuningsPath(fx.home))
  assert.equal(all.length, 3, 'a by-hand line, the close line, a by-hand line')
  assert.deepEqual(all.map((l) => l.close ?? null), [null, 'completion', null])
  assert.equal(all[1].id, id)
  const again = closeScore(fx)
  assert.equal(again.stdout, `close-score: ${SLUG}: already recorded ${id} (completion)\n`)
  assert.equal(lines(tuningsPath(fx.home)).length, 3)
})

test('--close supersede stamps close: supersede', (t) => {
  const fx = fixture(t)
  recorded(fx, closeScore(fx, ARGS(fx, 'supersede')), 'supersede')
  const [l] = lines(tuningsPath(fx.home))
  assert.equal(l.close, 'supersede')
})

// ---- not recorded (exit 0, nothing written) -------------------------------------------------------------------

test('no GitHub origin: not recorded, exit 0, no tunings.jsonl', (t) => {
  const fx = fixture(t, { origin: null })
  const r = closeScore(fx)
  settled(fx, r)
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.stdout, `close-score: ${SLUG}: not recorded: the scores carry no repo (no GitHub origin), so no baseline is kept\n`)
  assert.ok(!fs.existsSync(tuningsPath(fx.home)))
})

test('nothing ran: no record, or a record of only a carried line, is not recorded (exit 0, no line)', (t) => {
  const none = fixture(t, { record: false })
  const r = closeScore(none, ARGS(none, 'supersede'))
  settled(none, r)
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.stdout, `close-score: ${SLUG}: not recorded: nothing ran (no record)\n`)
  assert.ok(!fs.existsSync(tuningsPath(none.home)))

  const carried = fixture(t, { record: false })
  emitAll(carried.home, [[T(0), 'carried', 't1', { from: SLUG }, 'other-rollout-2026-10-07']])
  assert.equal(lines(path.join(evDir(carried.home), `${SLUG}.jsonl`)).length, 1, 'the carried line lands in the prior\'s record')
  const c = closeScore(carried, ARGS(carried, 'supersede'))
  settled(carried, c)
  assert.equal(c.status, 0, c.stderr)
  assert.equal(c.stdout, `close-score: ${SLUG}: not recorded: nothing ran (no Slot, lane or merge in the record)\n`)
  assert.ok(!fs.existsSync(tuningsPath(carried.home)))
})

// ---- not scored (exit 1, nothing written) -----------------------------------------------------------------------

test('a refused rollouts.toml with no prior line: not scored, rollout-settings exit 2, no line', (t) => {
  const fx = fixture(t)
  const toml = path.join(fx.home, '.config', 'thread', 'rollouts.toml')
  fs.mkdirSync(path.dirname(toml), { recursive: true })
  fs.writeFileSync(toml, '[defaults]\nparallel_ceiling = 0\n')
  notScored(fx, closeScore(fx), /: not scored: rollout-settings\.py exited 2: \S/)
})

test('the note and its Project root: no Project root line, a root that is gone, a missing note', (t) => {
  const noLine = fixture(t, { projectRoot: false })
  notScored(noLine, closeScore(noLine), /: not scored: no Project root line in /)
  const goneRoot = fixture(t)
  fs.rmSync(goneRoot.repo, { recursive: true, force: true })
  notScored(goneRoot, closeScore(goneRoot), /: not scored: Project root \S+ is not a directory\n$/)
  const noNote = fixture(t)
  fs.rmSync(noNote.note)
  notScored(noNote, closeScore(noNote), /: not scored: no rollout note at /)
})

test('a read-only events dir: not scored through tune.py exit 1, no traceback', { skip: IS_ROOT && 'root ignores the mode' }, (t) => {
  const fx = fixture(t)
  fs.chmodSync(evDir(fx.home), 0o555)
  fx.restore.push(evDir(fx.home))
  const r = closeScore(fx)
  fs.chmodSync(evDir(fx.home), 0o755)
  notScored(fx, r, /: not scored: tune\.py exited 1: \S/)
})

test('an unreadable tunings.jsonl: not scored before any step runs', { skip: IS_ROOT && 'root ignores the mode' }, (t) => {
  const fx = fixture(t)
  fs.writeFileSync(tuningsPath(fx.home), '')
  fs.chmodSync(tuningsPath(fx.home), 0o000)
  fx.restore.push(tuningsPath(fx.home))
  const r = closeScore(fx)
  fs.chmodSync(tuningsPath(fx.home), 0o644)
  settled(fx, r)
  assert.equal(r.status, 1, r.stderr)
  assert.match(r.stdout, new RegExp(`^close-score: ${SLUG}: not scored: tunings\\.jsonl cannot be read: .*\\n$`))
  assert.equal(r.stderr, '', 'no step ran (the fold would WARN on the missing journals)')
  assert.equal(fs.readFileSync(tuningsPath(fx.home), 'utf8'), '', 'nothing written')
})

// ---- time limits and signals --------------------------------------------------------------------------------------

test('a hung step is cut at its cap: its whole group is killed, not scored, no line', async (t) => {
  const fx = fixture(t)
  const fake = hangingGit(fx)
  const r = closeScore(fx, [...ARGS(fx), '--timeout', '3'], { PATH: fake.PATH })
  notScored(fx, r)
  assert.equal(r.stdout, `close-score: ${SLUG}: not scored: land.sh --origin-slug timed out after 3s\n`)
  assert.ok(r.elapsed < 15000, `elapsed ${r.elapsed} ms`)
  const pid = Number(fs.readFileSync(fake.pidFile, 'utf8'))
  assert.ok(pid > 0)
  assert.ok(await gone(pid), `the sleeper ${pid} is gone`)
})

test('the overall deadline clips a step cap: a 30 s land cap under --deadline 5 ends in seconds', async (t) => {
  const fx = fixture(t)
  const fake = hangingGit(fx)
  const r = closeScore(fx, [...ARGS(fx), '--deadline', '5'], { PATH: fake.PATH })
  notScored(fx, r, new RegExp(`^close-score: ${SLUG}: not scored: ((fold-journals|rollout-settings\\.py|land\\.sh --origin-slug) timed out after [1-5]s \\(overall deadline 5s\\)|overall deadline 5s reached before (fold-journals|rollout-settings\\.py|land\\.sh --origin-slug))\\n$`))
  assert.ok(r.elapsed < 15000, `elapsed ${r.elapsed} ms: the 30 s land cap was clipped`)
  if (fs.existsSync(fake.pidFile)) {
    const pid = Number(fs.readFileSync(fake.pidFile, 'utf8'))
    assert.ok(await gone(pid), `the sleeper ${pid} is gone`)
  }
})

test('an inherited GIT_DIR never reaches a step: land.sh\'s bash sees it unset, and the line is for the Project root', (t) => {
  const fx = fixture(t)
  const other = path.join(fx.home, 'other.git')
  git(fx.home, ['init', '-q', '--bare', other])
  git(fx.home, ['--git-dir', other, 'remote', 'add', 'origin', 'https://github.com/x/y.git'])
  const shim = path.join(fx.home, 'shim')
  fs.mkdirSync(shim)
  const saw = path.join(fx.home, 'bash-saw')
  fs.writeFileSync(path.join(shim, 'bash'), ['#!/bin/sh', `printf '%s\\n' "\${GIT_DIR-unset}" >> '${saw}'`, `exec '${REAL_BASH}' "$@"`, ''].join('\n'), { mode: 0o755 })
  // the shim's own control: run directly under GIT_DIR, it records that path (so an unscrubbed child would show)
  const c = spawnSync(path.join(shim, 'bash'), ['-c', 'true'], { env: { ...fx.env, GIT_DIR: other } })
  assert.equal(c.status, 0)
  assert.equal(fs.readFileSync(saw, 'utf8'), `${other}\n`)
  fs.writeFileSync(saw, '')
  const r = closeScore(fx, ARGS(fx), { PATH: `${shim}:${process.env.PATH}`, GIT_DIR: other })
  recorded(fx, r)
  const seen = fs.readFileSync(saw, 'utf8').split('\n').filter(Boolean)
  assert.ok(seen.length > 0, 'land.sh ran through the shim')
  assert.deepEqual([...new Set(seen)], ['unset'], 'no step saw GIT_DIR')
  // an end-to-end regression guard only: land.sh, rollout-settings and escapes scrub as well
  assert.equal(lines(tuningsPath(fx.home))[0].repo, 'o/r')
})

test('SIGTERM mid-run kills the live step\'s group, removes the scratch dir and exits 143 with stdout empty', async (t) => {
  const fx = fixture(t)
  const fake = hangingGit(fx)
  const child = spawn('python3', ['-B', CLOSE, ...ARGS(fx), '--timeout', '60'], { cwd: fx.home, env: { ...fx.env, PATH: fake.PATH }, stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (d) => { stdout += d })
  child.stderr.on('data', (d) => { stderr += d })
  const exited = new Promise((res) => child.on('close', (code, signal) => res({ code, signal })))
  const end = Date.now() + 10000
  while (!fs.existsSync(fake.pidFile) || !fs.readFileSync(fake.pidFile, 'utf8').trim()) {
    assert.ok(Date.now() < end, `the step never hung: ${stderr}`)
    await new Promise((res) => setTimeout(res, 50))
  }
  const pid = Number(fs.readFileSync(fake.pidFile, 'utf8'))
  child.kill('SIGTERM')
  const { code, signal } = await exited
  assert.equal(code, 143, `signal ${signal}, stderr ${stderr}`)
  assert.equal(stdout, '')
  assert.ok(await gone(pid), `the sleeper ${pid} is gone`)
  assert.deepEqual(fs.readdirSync(tmpDir(fx.home)).filter((n) => n.startsWith('thread-close-score-')), [], 'no scratch dir left')
  assert.ok(!fs.existsSync(tuningsPath(fx.home)))
})

// ---- a serial rollout (p24-4): serial-score.py, then tune.py; no fold, settings, land.sh or score.py -------------------

const SCORE = path.join(root, 'skills', 'reflect', 'scripts', 'score.py')
const SERIAL = path.join(root, 'skills', 'reflect', 'scripts', 'serial-score.py')
const tasksOf = (home) => path.join(home, 'repos', 'obsidian', 'Work', 'Tasks')
const recordOf = (home) => path.join(evDir(home), `${SLUG}.jsonl`)

// The serial note (no Project root: a chain has none) with a Leg log, or none (log false), and its two done tasks:
// Leg 1 began at T(0), finished t1 and t2, and closed at T(60) (so its hour is fixed whatever now is).
function writeSerial(fx, { log = true } = {}) {
  for (const s of ['t1', 't2']) {
    fs.writeFileSync(path.join(tasksOf(fx.home), `${s}.md`), ['---', 'tags: [task]', 'status: done', `rollout: "[[${SLUG}]]"`, '---', '',
      `Do ${s}.`, ''].join('\n'))
  }
  const legLog = ['## Leg log', '', `- ${T(0)} Leg 1 began: leg-1 session s1 in cc-demo from /work`,
    `- ${T(1)} Leg 1 claimed [[t1]]`, `- ${T(30)} Leg 1 done [[t1]] (verify pass)`,
    `- ${T(31)} Leg 1 claimed [[t2]]`, `- ${T(60)} Leg 1 done [[t2]] (verify pass)`, `- ${T(60)} Leg 1 closed: stopped: out of context`, '']
  fs.writeFileSync(fx.note, ['---', 'tags: [task, rollout]', 'status: open', 'protocol_version: 5', 'shape: serial', '---', '',
    '## Queue', '', '| # | Task | Launch | Surfaces |', '|---|---|---|---|', '| 1 | [[t1\\|t1]] | `cc-demo` from `/work` | `ext:x` |',
    '| 2 | [[t2\\|t2]] | `cc-demo` from `/work` | `ext:x` |', '', ...(log ? legLog : [])].join('\n'))
}

// A run-bound line whose journal exists: fold-journals, if it ran, would fold it into a `call-journal` line.
function foldable(fx) {
  const jdir = path.join(fx.home, 'journals')
  fs.mkdirSync(jdir)
  fs.writeFileSync(path.join(jdir, 'wf_fold.json'), JSON.stringify({ runId: 'wf_fold', status: 'completed', args: { mode: 'task' } }))
  emitAll(fx.home, [[T(2), 'run-bound', 't1', { runId: 'wf_fold', journalDir: jdir, call: 'task' }]])
}
const folded = (fx) => lines(recordOf(fx.home)).filter((l) => l.kind === 'call-journal').length

function serialFixture(t, opts) {
  const fx = fixture(t, { record: false })
  writeSerial(fx, opts)
  foldable(fx)
  return fx
}

test('serial: one close line, shape serial and repo null, from serial-score.py; a second run writes none', (t) => {
  const fx = serialFixture(t)
  const id = recorded(fx, closeScore(fx))
  const [l, ...rest] = lines(tuningsPath(fx.home))
  assert.equal(rest.length, 0)
  assert.deepEqual([l.id, l.shape, l.repo, l.close, l.applied, l.rollout], [id, 'serial', null, 'completion', [], SLUG])
  assert.deepEqual([l.scores.merges, l.scores.runningHours, l.scores.quotaStalls, l.scores.handsOffRate], [2, 1, null, 1])
  assert.equal(l.window.activeStart, T(0))
  const again = closeScore(fx)
  settled(fx, again)
  assert.equal(again.stdout, `close-score: ${SLUG}: already recorded ${id} (completion)\n`)
  assert.equal(lines(tuningsPath(fx.home)).length, 1)
})

test('serial: the window must be UTC Z: a raw offset stamp (the unconverted Leg log) is refused by the record (control)', (t) => {
  const fx = serialFixture(t)
  const out = path.join(fx.home, 'serial.json')
  const r = spawnSync('python3', ['-B', SERIAL, '--rollout', fx.note, '--out', out], { encoding: 'utf8', cwd: fx.home, env: fx.env })
  assert.equal(r.status, 0, r.stderr)
  const doc = JSON.parse(fs.readFileSync(out, 'utf8'))
  doc.window.since = doc.window.activeStart = '2026-10-20T10:15+11:00'
  fs.writeFileSync(out, JSON.stringify(doc))
  const tn = spawnSync('python3', ['-B', TUNE, '--scores', out, '--record-only', '--close', 'completion'], { encoding: 'utf8', cwd: fx.home, env: fx.env })
  assert.equal(tn.status, 2, tn.stderr)
  assert.match(tn.stderr, /window must be an object with since a UTC Z stamp/)
  assert.ok(!fs.existsSync(tuningsPath(fx.home)))
})

test('serial: --close supersede and --repo are not scored; no Leg is not recorded (nothing ran)', (t) => {
  const fx = serialFixture(t)
  notScored(fx, closeScore(fx, ARGS(fx, 'supersede')), /: not scored: a serial rollout is never superseded/)
  notScored(fx, closeScore(fx, [...ARGS(fx), '--repo', fx.repo]), /: not scored: a serial rollout has no Project root/)
  const none = serialFixture(t, { log: false })
  const r = closeScore(none)
  settled(none, r)
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.stdout, `close-score: ${SLUG}: not recorded: nothing ran (no Leg)\n`)
  assert.ok(!fs.existsSync(tuningsPath(none.home)))
})

test('serial: no fold (no call-journal line), with its parallel control and a mutant run_serial that folds', (t) => {
  const fx = serialFixture(t)
  recorded(fx, closeScore(fx))
  assert.equal(folded(fx), 0, 'the serial path never runs fold-journals')
  // control: the same record under the parallel path folds its journal
  const par = fixture(t)
  foldable(par)
  recorded(par, closeScore(par))
  assert.equal(folded(par), 1, 'the parallel path folds it: so a fold would show')
  // mutant: run_serial that folds first writes the line, so the zero above is no vacuous pass
  const mut = serialFixture(t)
  const body = ['import importlib.util, sys',
    'spec = importlib.util.spec_from_file_location("close_score", sys.argv[1]); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)',
    'orig = m.Close.run_serial',
    'def mutant(self, note):',
    '    self.env = m.git_env(30); self.make_scratch(); self.fold(note)',
    '    return orig(self, note)',
    'm.Close.run_serial = mutant',
    'sys.exit(m.main(sys.argv[2:]))'].join('\n')
  const r = spawnSync('python3', ['-B', '-c', body, CLOSE, ...ARGS(mut)], { encoding: 'utf8', cwd: mut.home, env: mut.env })
  assert.equal(r.status, 0, r.stderr)
  assert.equal(folded(mut), 1, 'the mutant folds')
})

test('serial: no rollout-settings.py (a refused rollouts.toml still records), with its parallel control', (t) => {
  const write = (home) => {
    const toml = path.join(home, '.config', 'thread', 'rollouts.toml')
    fs.mkdirSync(path.dirname(toml), { recursive: true })
    fs.writeFileSync(toml, '[defaults]\nparallel_ceiling = 0\n')
  }
  const fx = serialFixture(t)
  write(fx.home)
  recorded(fx, closeScore(fx))
  const par = fixture(t)
  write(par.home)
  notScored(par, closeScore(par), /: not scored: rollout-settings\.py exited 2: /)
})

test('serial: no land.sh (a bash shim on PATH is never run), with its parallel control', (t) => {
  const shimmed = (fx) => {
    const shim = path.join(fx.home, 'shim')
    fs.mkdirSync(shim)
    const saw = path.join(fx.home, 'bash-ran')
    fs.writeFileSync(path.join(shim, 'bash'), ['#!/bin/sh', `echo "$*" >> '${saw}'`, `exec '${REAL_BASH}' "$@"`, ''].join('\n'), { mode: 0o755 })
    return { PATH: `${shim}:${process.env.PATH}`, saw }
  }
  const fx = serialFixture(t)
  const s = shimmed(fx)
  recorded(fx, closeScore(fx, ARGS(fx), { PATH: s.PATH }))
  assert.ok(!fs.existsSync(s.saw), 'no bash step ran')
  const par = fixture(t)
  const p = shimmed(par)
  recorded(par, closeScore(par, ARGS(par), { PATH: p.PATH }))
  assert.match(fs.readFileSync(p.saw, 'utf8'), /land\.sh --origin-slug/, 'the parallel path runs land.sh through it')
})

test('serial: the close line is never a baseline (score.py\'s load_tunings reads only a string repo)', (t) => {
  const fx = serialFixture(t)
  recorded(fx, closeScore(fx))
  const body = ['import importlib.util, json, sys',
    'spec = importlib.util.spec_from_file_location("score", sys.argv[1]); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)',
    'print(json.dumps(len(m.load_tunings(sys.argv[2]))))'].join('\n')
  const r = spawnSync('python3', ['-B', '-c', body, SCORE, evDir(fx.home)], { encoding: 'utf8', cwd: fx.home, env: fx.env })
  assert.equal(r.status, 0, r.stderr)
  assert.equal(JSON.parse(r.stdout), 0)
  assert.equal(lines(tuningsPath(fx.home)).length, 1, 'the line is there, and load_tunings skips it')
})

// ---- usage and the script itself ------------------------------------------------------------------------------------

test('usage: a bad --close, no --rollout, a non-.md --rollout, a reserved slug, --timeout 0, --deadline -1 exit 2 with stdout empty', (t) => {
  const fx = fixture(t, { record: false })
  for (const args of [
    ['--rollout', fx.note, '--close', 'weekly'],
    ['--close', 'completion'],
    ['--rollout', SLUG, '--close', 'completion'],
    ['--rollout', path.join(fx.home, 'tunings.md'), '--close', 'completion'],
    [...ARGS(fx), '--timeout', '0'],
    [...ARGS(fx), '--deadline', '-1'],
  ]) {
    const r = closeScore(fx, args)
    assert.equal(r.status, 2, `${args.join(' ')}: ${r.stdout} ${r.stderr}`)
    assert.equal(r.stdout, '', args.join(' '))
    assert.match(r.stderr, /^close-score: /, args.join(' '))
  }
  assert.ok(!fs.existsSync(tuningsPath(fx.home)))
})

test('close-score.py parses as python 3.8', () => {
  const r = spawnSync('python3', ['-B', '-c', 'import ast, sys\nast.parse(open(sys.argv[1]).read(), sys.argv[1], feature_version=(3, 8))', CLOSE], { encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
})

test('the header constants keep the worst case under the Bash tool\'s 600 s ceiling', () => {
  const text = fs.readFileSync(CLOSE, 'utf8')
  const num = (name) => {
    const m = text.match(new RegExp(`^${name} = (\\d+(?:\\.\\d+)?)`, 'm'))
    assert.ok(m, `${name} is a header constant`)
    return Number(m[1])
  }
  const deadline = num('DEADLINE')
  assert.ok(deadline + num('KILL_GRACE') + num('REAP_WAIT') <= 570, 'DEADLINE + KILL_GRACE + REAP_WAIT leaves a margin under 600 s')
  const score = text.match(/^CAPS = \{[\s\S]*?"score\.py": (\d+)/m)
  assert.ok(score, 'CAPS names score.py')
  assert.ok(Number(score[1]) < deadline, 'score.py\'s cap sits inside the deadline')
})
