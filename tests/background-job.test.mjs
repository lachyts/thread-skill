// skills/_shared/scripts/background_job.py — the plumbing the background jobs share (p39-6): the Primary refresh's and the
// Watchdog's state file, ntfy-push call and launchd job, and the one TERM-grace-KILL stop of a child's process group.
//   BJ0 python 3.8 syntax   BJ1 importing it changes nothing   BJ2 state_path   BJ3 read_state   BJ4 the writes
//   BJ5 the plist and PATH   BJ6 notify and run_plain   BJ7 kill_group
//   BJ8 a missing or broken module is each by-path loader's own broken-install line, never a traceback
//   BJ9 the structural pin: the TERM+KILL stops left in the tree are kill_group and the ones its docstring names
// Hermetic: each case runs `python3 -B` with PYTHONDONTWRITEBYTECODE=1, a mkdtemp HOME and a mkdtemp cwd; BJ8 runs a
// copy of skills/ in a mkdtemp dir. Nothing is written in the checkout.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync, execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BJ = path.join(root, 'skills', '_shared', 'scripts', 'background_job.py')
const PY = execFileSync('sh', ['-c', 'command -v python3'], { encoding: 'utf8' }).trim()
// A `pip install --user` PyYAML resolves under the real HOME (tests/run.sh pins PYTHONUSERBASE for that), and BJ8's
// loaders read next-action.py, which imports it.
const USERBASE = process.env.PYTHONUSERBASE ?? execFileSync(PY, ['-c', 'import site; print(site.getuserbase())'], { encoding: 'utf8' }).trim()

function scratch(t) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'background-job-')))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const s = { dir, home: path.join(dir, 'home'), cwd: path.join(dir, 'cwd') }
  for (const d of [s.home, s.cwd]) fs.mkdirSync(d, { recursive: true })
  s.env = { PATH: process.env.PATH, HOME: s.home, PYTHONDONTWRITEBYTECODE: '1', PYTHONUSERBASE: USERBASE }
  return s
}

// The module, loaded by path as its callers load it; `bj` in scope for the case's code.
const PRE = [
  'import importlib.util, json, os, sys',
  'sys.dont_write_bytecode = True',
  'spec = importlib.util.spec_from_file_location("thread_background_job", sys.argv[1])',
  'bj = importlib.util.module_from_spec(spec)',
  'spec.loader.exec_module(bj)',
].join('\n')

// py(s, code, args, env): run PRE + code with sys.argv[1] the module and sys.argv[2:] `args`.
function py(s, code, args = [], env = {}) {
  const r = spawnSync(PY, ['-B', '-c', `${PRE}\n${code}`, BJ, ...args], { cwd: s.cwd, env: { ...s.env, ...env }, encoding: 'utf8' })
  return { status: r.status, stdout: r.stdout, stderr: r.stderr }
}
const json = (r) => { assert.equal(r.status, 0, r.stderr); return JSON.parse(r.stdout) }

test('BJ0. python 3.8 syntax', () => {
  const r = spawnSync(PY, ['-B', '-c', 'import ast, sys\nast.parse(open(sys.argv[1]).read(), sys.argv[1], feature_version=(3, 8))', BJ],
    { encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
})

test('BJ1. importing it installs no handler, blocks no signal, writes nothing and starts no thread', (t) => {
  const s = scratch(t)
  const code = [
    'import importlib.util, json, os, signal, sys, threading',
    'sys.dont_write_bytecode = True',
    'SIGS = (signal.SIGTERM, signal.SIGINT, signal.SIGHUP, signal.SIGCHLD, signal.SIGPIPE)',
    'def seen():',
    '    return {"handlers": [str(signal.getsignal(x)) for x in SIGS],',
    '            "mask": sorted(int(x) for x in signal.pthread_sigmask(signal.SIG_BLOCK, [])),',
    '            "cwd": sorted(os.listdir(".")), "threads": threading.active_count()}',
    'before = seen()',
    'spec = importlib.util.spec_from_file_location("thread_background_job", sys.argv[1])',
    'bj = importlib.util.module_from_spec(spec)',
    'spec.loader.exec_module(bj)',
    'print(json.dumps({"before": before, "after": seen()}))',
  ].join('\n')
  const r = spawnSync(PY, ['-B', '-c', code, BJ], { cwd: s.cwd, env: s.env, encoding: 'utf8' })
  const got = json(r)
  assert.deepEqual(got.after, got.before)
  assert.deepEqual(got.after.cwd, [])
  assert.equal(r.stderr, '')
})

test('BJ2. state_path: --state with ~ expanded, else XDG_STATE_HOME, else ~/.local/state, under thread/', (t) => {
  const s = scratch(t)
  const code = 'print(json.dumps([str(bj.state_path("~/x/s.json", "n.json")), str(bj.state_path(None, "n.json")), str(bj.state_path("", "n.json"))]))'
  assert.deepEqual(json(py(s, code)), [path.join(s.home, 'x', 's.json'), path.join(s.home, '.local', 'state', 'thread', 'n.json'),
    path.join(s.home, '.local', 'state', 'thread', 'n.json')])
  const xdg = path.join(s.dir, 'xdg')
  assert.deepEqual(json(py(s, code, [], { XDG_STATE_HOME: xdg })).slice(1), [path.join(xdg, 'thread', 'n.json'), path.join(xdg, 'thread', 'n.json')])
})

test('BJ3. read_state: missing, unreadable, corrupt, the wrong shape and valid, each WARN whole', (t) => {
  const s = scratch(t)
  const code = 'print(json.dumps(bj.read_state(sys.argv[2], sys.argv[3], sys.argv[4])))'
  for (const [prog, key] of [['primary-refresh', 'stuck'], ['watchdog', 'notified']]) {
    const p = path.join(s.dir, `${prog}.json`)
    fs.rmSync(p, { recursive: true, force: true })
    let r = py(s, code, [p, prog, key])
    assert.deepEqual(json(r), [{}, false], `${prog} missing`)
    assert.equal(r.stderr, '')
    fs.mkdirSync(p)
    r = py(s, code, [p, prog, key])
    assert.deepEqual(json(r), [{}, false], `${prog} a directory`)
    assert.equal(r.stderr, `WARN: ${prog}: state ${p} unreadable ([Errno 21] Is a directory: '${p}'): read as empty\n`)
    fs.rmdirSync(p)
    fs.writeFileSync(p, Buffer.from([0o377, 0o376, 0x7b]))
    r = py(s, code, [p, prog, key])
    assert.deepEqual(json(r), [{}, true], `${prog} not UTF-8`)
    assert.equal(r.stderr, `WARN: ${prog}: state ${p} is corrupt ('utf-8' codec can't decode byte 0xff in position 0: invalid start byte): read as empty\n`)
    for (const bad of ['[]', JSON.stringify({ v: 2, [key]: {} }), JSON.stringify({ v: 1, [key]: [] })]) {
      fs.writeFileSync(p, bad)
      r = py(s, code, [p, prog, key])
      assert.deepEqual(json(r), [{}, true], `${prog} ${bad}`)
      assert.equal(r.stderr, `WARN: ${prog}: state ${p} is corrupt (not a v1 ${prog} state): read as empty\n`)
    }
    fs.writeFileSync(p, JSON.stringify({ v: 1, [key]: { a: { since: 'x' } } }))
    r = py(s, code, [p, prog, key])
    assert.deepEqual(json(r), [{ a: { since: 'x' } }, false], `${prog} valid`)
    assert.equal(r.stderr, '')
  }
})

test('BJ4. write_state and atomic_write: the bytes, the mode, and nothing else left in the directory', (t) => {
  const s = scratch(t)
  const d = path.join(s.dir, 'w')
  const code = [
    'import stat',
    'd = sys.argv[2]',
    'entries = {"b": {"x": 1}, "a": {"since": "2026-11-06T10:00:00+11:00"}}',
    'bj.write_state(os.path.join(d, "state.json"), "stuck", entries)',
    'got = open(os.path.join(d, "state.json"), "rb").read()',
    'out = {"loads": json.loads(got), "bytes": got == (json.dumps({"v": 1, "stuck": entries}, indent=2, sort_keys=True) + "\\n").encode(),',
    '       "mode": oct(stat.S_IMODE(os.stat(os.path.join(d, "state.json")).st_mode)), "list1": sorted(os.listdir(d))}',
    'bj.atomic_write(os.path.join(d, "job.plist"), b"x", mode=0o644)',
    'out["mode2"] = oct(stat.S_IMODE(os.stat(os.path.join(d, "job.plist")).st_mode))',
    'out["list2"] = sorted(os.listdir(d))',
    'open(os.path.join(d, "f"), "w").write("a file")',
    'try:',
    '    bj.atomic_write(os.path.join(d, "f", "under.json"), "x")',
    '    out["raised"] = None',
    'except OSError as e:',
    '    out["raised"] = type(e).__name__',
    'out["list3"] = sorted(os.listdir(d))',
    'print(json.dumps(out))',
  ].join('\n')
  const got = json(py(s, code, [d]))
  assert.deepEqual(got.loads, { v: 1, stuck: { a: { since: '2026-11-06T10:00:00+11:00' }, b: { x: 1 } } })
  assert.equal(got.bytes, true)
  assert.equal(got.mode, '0o600')
  assert.deepEqual(got.list1, ['state.json'])
  assert.equal(got.mode2, '0o644')
  assert.deepEqual(got.list2, ['job.plist', 'state.json'])
  assert.ok(got.raised, 'a write under a regular file raises OSError')
  assert.deepEqual(got.list3, ['f', 'job.plist', 'state.json'])
})

test('BJ5. the launchd plist, job_path and job_python', (t) => {
  const s = scratch(t)
  const code = [
    'import plistlib',
    'j = plistlib.loads(bj.launchd_plist("com.x", ["/p", "a b"], "/a:/usr/bin", 600, "~/Library/Logs/x.log"))',
    'print(json.dumps({"job": j, "path": bj.job_path("/a", "", "/usr/bin", "/a"), "exe": sys.executable}))',
  ].join('\n')
  const got = json(py(s, code))
  const log = path.join(s.home, 'Library', 'Logs', 'x.log')
  assert.deepEqual(got.job, { Label: 'com.x', ProgramArguments: ['/p', 'a b'], EnvironmentVariables: { PATH: '/a:/usr/bin' },
    StartInterval: 600, RunAtLoad: true, ProcessType: 'Background', StandardOutPath: log, StandardErrorPath: log })
  assert.equal(got.path, '/a:/usr/bin:/bin:/usr/sbin:/sbin')
  const own = path.join(s.dir, 'own'); const foreign = path.join(s.dir, 'foreign'); const empty = path.join(s.dir, 'empty')
  for (const d of [own, foreign, empty]) fs.mkdirSync(d)
  fs.symlinkSync(got.exe, path.join(own, 'python3'))
  fs.writeFileSync(path.join(foreign, 'python3'), '#!/bin/sh\nexit 0\n', { mode: 0o755 })
  const which = 'out = []\nfor d in sys.argv[2:]:\n    os.environ["PATH"] = d\n    out.append(bj.job_python())\nprint(json.dumps(out))'
  assert.deepEqual(json(py(s, which, [own, foreign, empty])), [path.join(own, 'python3'), got.exe, got.exe])
})

test('BJ6. notify and run_plain: the reason, the argv and stdin, a timeout as text, a start failure', (t) => {
  const s = scratch(t)
  const w = (name, lines) => { const f = path.join(s.dir, name); fs.writeFileSync(f, lines.join('\n') + '\n'); return f }
  const three = w('three.py', ['import sys', 'print("o")', 'sys.stderr.write("e1\\ne2\\n")', 'sys.exit(3)'])
  const outOnly = w('out.py', ['print("a")', 'print("b")'])
  const echo = w('echo.py', ['import json, sys', 'print(json.dumps({"argv": sys.argv[1:], "stdin": sys.stdin.read()}))'])
  const sleeper = w('sleeper.py', ['import time', 'print("hi", flush=True)', 'time.sleep(30)'])
  let got = json(py(s, 'print(json.dumps([list(bj.notify(sys.argv[2], "m", None)), list(bj.notify(sys.argv[3], "m", None))]))', [three, outOnly]))
  assert.deepEqual(got[0], [3, 'e2', 'o\n', 'e1\ne2\n', true])
  assert.deepEqual(got[1], [0, 'b', 'a\nb\n', '', true])
  got = json(py(s, 'n = bj.notify(sys.argv[2], "the message", "S")\nprint(json.dumps([n.rc, json.loads(n.out)]))', [echo]))
  assert.deepEqual(got, [0, { argv: ['--server', 'S'], stdin: 'the message\n' }])
  const timed = [
    'import time',
    't0 = time.monotonic()',
    'r = bj.run_plain([sys.executable, "-B", sys.argv[2]], 2, "")',
    't1 = time.monotonic()',
    'n = bj.notify(sys.argv[2], "m", None, timeout=2)',
    't2 = time.monotonic()',
    'print(json.dumps({"run": list(r), "types": [type(r[1]).__name__, type(r[2]).__name__], "notify": list(n),',
    '                  "isNotified": type(n) is bj.Notified, "secs": [t1 - t0, t2 - t1]}))',
  ].join('\n')
  got = json(py(s, timed, [sleeper]))
  assert.deepEqual(got.run, [null, 'hi\n', '', true])
  assert.deepEqual(got.types, ['str', 'str'])
  assert.deepEqual(got.notify, [124, 'ntfy-push ran past 2 s and was stopped', 'hi\n', '', false])
  assert.equal(got.isNotified, true)
  assert.ok(got.secs.every((x) => x < 8), `each back within 8 s: ${got.secs}`)
  const failing = [
    'def runner(argv, timeout, input):',
    '    raise OSError("cannot start\\n  it")',
    'n = bj.notify("x.py", "m", None, run=runner)',
    'try:',
    '    bj.run_plain([os.path.join(sys.argv[2], "no-such-binary")], 2, "")',
    '    raised = None',
    'except OSError as e:',
    '    raised = type(e).__name__',
    'print(json.dumps([list(n), raised]))',
  ].join('\n')
  got = json(py(s, failing, [s.dir]))
  assert.deepEqual(got[0], [127, 'cannot start it', '', '', false])
  assert.equal(got[1], 'FileNotFoundError')
})

test('BJ7. kill_group: a group that dies on TERM, one that ignores it, and a child already waited', (t) => {
  const s = scratch(t)
  const pidfile = path.join(s.dir, 'sleeper.pid')
  const code = [
    'import subprocess, time',
    'out = {}',
    'p = subprocess.Popen(["sleep", "30"], start_new_session=True)',
    't0 = time.monotonic(); bj.kill_group(p, 5); out["a"] = time.monotonic() - t0',
    'p.wait()',
    'p = subprocess.Popen(["sh", "-c", "trap \'\' TERM; sleep 30 & echo $! > \\"$0\\"; wait", sys.argv[2]], start_new_session=True)',
    'end = time.monotonic() + 10',
    'while time.monotonic() < end and not (os.path.exists(sys.argv[2]) and open(sys.argv[2]).read().strip()):',
    '    time.sleep(0.05)',
    'sleeper = int(open(sys.argv[2]).read())',
    't0 = time.monotonic(); bj.kill_group(p, 0.5, reap=2); out["b"] = time.monotonic() - t0',
    'out["rc"] = p.returncode',
    'end = time.monotonic() + 2',
    'alive = True',
    'while alive and time.monotonic() < end:',
    '    try:',
    '        os.kill(sleeper, 0)',
    '        time.sleep(0.05)',
    '    except ProcessLookupError:',
    '        alive = False',
    'out["sleeperAlive"] = alive',
    'p = subprocess.Popen(["true"], start_new_session=True); p.wait()',
    't0 = time.monotonic(); bj.kill_group(p, 5); out["c"] = time.monotonic() - t0',
    'print(json.dumps(out))',
  ].join('\n')
  const got = json(py(s, code, [pidfile]))
  assert.ok(got.a < 2, `(a) a group that dies on TERM is back well inside the grace: ${got.a}`)
  assert.ok(got.b >= 0.5, `(b) a group that ignores TERM gets the whole grace: ${got.b}`)
  assert.equal(got.rc, -9, '(b) … then KILL, and the reap reads it')
  assert.equal(got.sleeperAlive, false, '(b) … its grandchild is gone too')
  assert.ok(got.c < 0.5, `(c) a child already waited is back at once: ${got.c}`)
})

test('BJ8. a missing or broken background_job.py is each by-path loader\'s own broken-install line, never a traceback', (t) => {
  const s = scratch(t)
  const copy = path.join(s.dir, 'copy')
  fs.cpSync(path.join(root, 'skills'), path.join(copy, 'skills'), { recursive: true, filter: (src) => path.basename(src) !== '__pycache__' })
  const mod = path.join(copy, 'skills', '_shared', 'scripts', 'background_job.py')
  const vault = path.join(s.dir, 'vault')
  fs.mkdirSync(path.join(vault, 'Work', 'Tasks'), { recursive: true })
  const runs = (script, args) => spawnSync(PY, ['-B', path.join(copy, 'skills', script), ...args], { cwd: s.cwd, env: s.env, encoding: 'utf8' })
  for (const how of ['deleted', 'broken']) {
    if (how === 'deleted') fs.rmSync(mod)
    else fs.writeFileSync(mod, 'raise RuntimeError("bj8 broken")\n')
    let r = runs('_shared/scripts/declared-check.py', ['run', 'x', '--vault', vault])
    assert.equal(r.status, 3, `${how} declared-check: ${r.stderr}`)
    assert.ok(r.stderr.startsWith(`declared-check: cannot load ${mod}: `), `${how} declared-check: ${r.stderr}`)
    assert.ok(!(r.stdout + r.stderr).includes('Traceback'), r.stderr)
    r = runs('reflect/scripts/close-score.py', ['--rollout', path.join(vault, 'x-rollout-2026-11-06.md'), '--close', 'completion'])
    assert.equal(r.status, 1, `${how} close-score: ${r.stdout}${r.stderr}`)
    const lines = r.stdout.split('\n').filter(Boolean)
    assert.equal(lines.length, 1, r.stdout)
    assert.ok(lines[0].startsWith('close-score: not scored: cannot load its helpers: '), lines[0])
    assert.ok(lines[0].includes(how === 'deleted' ? 'background_job.py' : 'bj8 broken'), lines[0])
    assert.equal(r.stderr, '')
    r = runs('_shared/scripts/estate-scan.py', ['--vault', vault, '--today', '2026-11-06'])
    assert.equal(r.status, 3, `${how} estate-scan: ${r.stderr}`)
    assert.ok(r.stderr.startsWith(`estate-scan: cannot load ${mod}: `), `${how} estate-scan: ${r.stderr}`)
    assert.equal(r.stdout, '')
    assert.ok(!r.stderr.includes('Traceback'), r.stderr)
  }
})

test('BJ9. the TERM+KILL group stops left in the tree are kill_group and the ones its docstring names; each loader names it', () => {
  const code = [
    'import ast, os, subprocess, sys',
    'files = subprocess.run(["git", "-C", sys.argv[1], "ls-files", "*.py"], capture_output=True, text=True, check=True).stdout.split("\\n")',
    'def kills(c, name):',
    '    f = c.func',
    '    return (isinstance(f, ast.Attribute) and f.attr == "killpg" and isinstance(f.value, ast.Name) and f.value.id == "os"',
    '            and len(c.args) == 2 and isinstance(c.args[1], ast.Attribute) and c.args[1].attr == name',
    '            and isinstance(c.args[1].value, ast.Name) and c.args[1].value.id == "signal")',
    'found = []',
    'for rel in filter(None, files):',
    '    tree = ast.parse(open(os.path.join(sys.argv[1], rel), "rb").read(), rel)',
    '    units = []',
    '    for node in tree.body:',
    '        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):',
    '            units.append(node)',
    '        elif isinstance(node, ast.ClassDef):',
    '            units += [n for n in node.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))]',
    '    for fn in units:',
    '        calls = [n for n in ast.walk(fn) if isinstance(n, ast.Call)]',
    '        if any(kills(c, "SIGTERM") for c in calls) and any(kills(c, "SIGKILL") for c in calls):',
    '            found.append(os.path.basename(rel) + ":" + fn.name)',
    'print("\\n".join(sorted(found)))',
  ].join('\n')
  const r = spawnSync(PY, ['-B', '-c', code, root], { encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } })
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(r.stdout.trim().split('\n'), ['background_job.py:kill_group', 'estate-scan.py:interrupt', 'verify-slot.py:_end',
    'verify-slot.py:kill_group'])
  for (const rel of ['skills/_shared/scripts/primary-refresh.py', 'skills/execute/scripts/watchdog.py', 'skills/execute/scripts/lead-integrate.py',
    'skills/_shared/scripts/declared-check.py', 'skills/_shared/scripts/estate-scan.py', 'skills/reflect/scripts/close-score.py']) {
    assert.ok(fs.readFileSync(path.join(root, rel), 'utf8').includes('background_job.py'), `${rel} names background_job.py`)
  }
})
