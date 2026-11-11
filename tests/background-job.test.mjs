// skills/_shared/scripts/background_job.py — the plumbing the background jobs share (p39-6): the Primary refresh's state
// file and launchd job, its frozen (no longer called, ADR 0075 d2) notify, and the one TERM-grace-KILL stop of a child's
// process group.
//   BJ0 python 3.8 syntax   BJ1 importing it changes nothing   BJ2 state_path   BJ3 read_state   BJ4 the writes
//   BJ5 the plist and PATH   BJ6 notify and run_plain   BJ7 kill_group
//   BJ8 a missing or broken module is each by-path loader's own broken-install line, never a traceback (land-carrier.py's
//       marker, which loads none, still reads)
//   BJ9 the structural pin: the TERM+KILL stops left in the tree are kill_group and the ones its docstring names
//   BJ10 the frozen interface primary-refresh.py calls (its self-update contract): every `BJ.<name>(...)` call shape in
//        primary-refresh.py is in a literal list, every listed one still binds to the module's signature, the parameters
//        additive-only, and read_state's, notify's, Notified's and the run callback's shapes
//   BJ10b the list is additive only: a copy of primary-refresh.py that no longer makes a call still passes, its entry
//        still listed and binding; a new or reshaped call fails until it joins
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

test('BJ4. write_state and atomic_write: the bytes, the mode, and a failed write leaves no temp file in the directory', (t) => {
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
    // Each failing write below records the temp files mkstemp made, so the case shows which branch it reached.
    'made = []',
    'real_mkstemp = bj.tempfile.mkstemp',
    'def mkstemp(*a, **k):',
    '    r = real_mkstemp(*a, **k)',
    '    made.append(r[1])',
    '    return r',
    'bj.tempfile.mkstemp = mkstemp',
    'def failing(target):',
    '    del made[:]',
    '    try:',
    '        bj.atomic_write(target, "x")',
    '        raised = None',
    '    except OSError as e:',
    '        raised = type(e).__name__',
    '    return {"raised": raised, "made": [os.path.basename(m) for m in made], "left": [os.path.lexists(m) for m in made],',
    '            "list": sorted(os.listdir(d))}',
    // The rename fails once the temp file exists: the target is a non-empty directory, so os.replace raises.
    'os.mkdir(os.path.join(d, "busy.json"))',
    'open(os.path.join(d, "busy.json", "keep"), "w").write("k")',
    'out["rename"] = failing(os.path.join(d, "busy.json"))',
    'out["kept"] = sorted(os.listdir(os.path.join(d, "busy.json")))',
    // The parent's mkdir fails under a regular file, before mkstemp runs: nothing is made at all.
    'open(os.path.join(d, "f"), "w").write("a file")',
    'out["mkdir"] = failing(os.path.join(d, "f", "under.json"))',
    'bj.tempfile.mkstemp = real_mkstemp',
    'print(json.dumps(out))',
  ].join('\n')
  const got = json(py(s, code, [d]))
  assert.deepEqual(got.loads, { v: 1, stuck: { a: { since: '2026-11-06T10:00:00+11:00' }, b: { x: 1 } } })
  assert.equal(got.bytes, true)
  assert.equal(got.mode, '0o600')
  assert.deepEqual(got.list1, ['state.json'])
  assert.equal(got.mode2, '0o644')
  assert.deepEqual(got.list2, ['job.plist', 'state.json'])
  const r = got.rename
  assert.ok(r.raised, 'a rename over a non-empty directory raises OSError')
  assert.equal(r.made.length, 1, `the temp file was made before the failure: ${JSON.stringify(r)}`)
  assert.ok(r.made[0].startsWith('.busy.json-'), r.made[0])
  assert.deepEqual(r.left, [false], 'the temp file is removed on the failure')
  assert.deepEqual(r.list.filter((x) => x.startsWith('.busy.json-')), [], `no .busy.json-* temp file left: ${r.list}`)
  assert.deepEqual(r.list, ['busy.json', 'job.plist', 'state.json'])
  assert.deepEqual(got.kept, ['keep'], 'the target directory is left as it was')
  const m = got.mkdir
  assert.ok(m.raised, 'a write under a regular file raises OSError')
  assert.deepEqual(m.made, [], 'its mkdir fails before any temp file is made')
  assert.deepEqual(m.list, ['busy.json', 'f', 'job.plist', 'state.json'])
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
    for (const verb of [['run', '--now', '2026-11-06T10:00:00+11:00'], ['stuck']]) {
      r = runs('_shared/scripts/land-carrier.py', [...verb, '--state', path.join(s.dir, 'landings.json')])
      assert.equal(r.status, 1, `${how} land-carrier ${verb[0]}: ${r.stdout}${r.stderr}`)
      assert.ok(r.stderr.startsWith(`land-carrier: cannot load ${mod}: `), `${how} land-carrier ${verb[0]}: ${r.stderr}`)
      assert.equal(r.stdout, '')
      assert.ok(!r.stderr.includes('Traceback'), r.stderr)
    }
    assert.ok(!fs.existsSync(path.join(s.dir, 'landings.json')), `${how} land-carrier: no state written`)
    r = spawnSync(PY, ['-B', path.join(copy, 'skills', '_shared', 'scripts', 'land-carrier.py'), 'marker', '--login', 'me'],
      { cwd: s.cwd, env: s.env, encoding: 'utf8', input: '[]' })
    assert.equal(`${r.status}|${r.stdout}`, '0|none\n', `${how} land-carrier marker loads no background_job.py: ${r.stderr}`)
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
  for (const rel of ['skills/_shared/scripts/primary-refresh.py', 'skills/execute/scripts/lead-integrate.py',
    'skills/_shared/scripts/declared-check.py', 'skills/_shared/scripts/estate-scan.py', 'skills/reflect/scripts/close-score.py',
    'skills/_shared/scripts/land-carrier.py']) {
    assert.ok(fs.readFileSync(path.join(root, rel), 'utf8').includes('background_job.py'), `${rel} names background_job.py`)
  }
})

// The interface an installed Primary refresh copy calls in process. A self-update that fails partway leaves the OLD copy
// running against the NEW background_job.py (primary-refresh.py's step 5), and an old copy that raises at its first
// BJ call (BJ.state_path, at the top of cmd_run) never reaches the fetch or the self-update that would heal it: only a
// hand install gets it out. So this is frozen, additive only:
// never rename, remove or reorder a function, a parameter or a Notified field; a new parameter goes last with a
// default; read_state stays a 2-tuple. A new BJ call shape in primary-refresh.py joins CALLS (and a new name joins
// FROZEN). An entry never leaves CALLS or FROZEN, even after primary-refresh.py stops making that call, because an
// installed older copy still makes it: retiring one is a contract change that needs a hand re-install, the same rule
// as tests/primary-refresh.test.sh I6's tokens (ADR 0066 decision 7). So BJ10 holds primary-refresh.py's calls to a
// subset of CALLS, never to CALLS exactly, and BJ10b proves a retired call's entry still passes and binds.
const CALLS = [
  ['atomic_write', 2, []],
  ['atomic_write', 2, ['mode']],
  ['job_path', 2, []],
  ['job_python', 0, []],
  ['kill_group', 2, ['reap']],
  ['launchd_plist', 5, []],
  ['notify', 3, ['run', 'timeout']],
  ['read_state', 4, []],
  ['state_path', 2, []],
  ['write_state', 4, []],
]
const FROZEN = {
  atomic_write: ['path', 'data', 'mode'],
  job_path: ['first'],
  job_python: [],
  kill_group: ['p', 'grace', 'reap'],
  launchd_plist: ['label', 'argv', 'path', 'interval', 'log'],
  notify: ['script', 'message', 'server', 'run', 'timeout'],
  read_state: ['path', 'prog', 'key', 'version'],
  state_path: ['arg', 'name'],
  write_state: ['path', 'key', 'entries', 'version'],
}
const NOTIFIED = ['rc', 'why', 'out', 'err', 'ran']
const PR = path.join(root, 'skills', '_shared', 'scripts', 'primary-refresh.py')
const key = (c) => JSON.stringify(c)

// shapes(s, src): what the primary-refresh.py at `src` reads of the module, by its AST: each `BJ.<name>(...)` call's
// shape [name, positional count, sorted keyword names], the calls that pass *args or **kwargs, any other BJ.<name>
// read (BJ.Notified, a function passed along uncalled), and its BJ_REL.
const SHAPES = [
  'import ast, re',
  'src = open(sys.argv[2], encoding="utf-8").read()',
  'tree = ast.parse(src, sys.argv[2])',
  'calls, funcs, unsplat = set(), set(), []',
  'for n in ast.walk(tree):',
  '    f = getattr(n, "func", None)',
  '    if isinstance(n, ast.Call) and isinstance(f, ast.Attribute) and isinstance(f.value, ast.Name) and f.value.id == "BJ":',
  '        funcs.add(id(f))',
  '        if any(isinstance(a, ast.Starred) for a in n.args) or any(k.arg is None for k in n.keywords):',
  '            unsplat.append(f.attr)',
  '        calls.add((f.attr, len(n.args), tuple(sorted(k.arg for k in n.keywords if k.arg))))',
  'other = sorted({n.attr for n in ast.walk(tree) if isinstance(n, ast.Attribute) and isinstance(n.value, ast.Name)',
  '                and n.value.id == "BJ" and id(n) not in funcs})',
  'print(json.dumps({"calls": sorted([a, n, list(k)] for a, n, k in calls), "unsplat": unsplat, "other": other,',
  '                  "bjRel": re.findall(r"^BJ_REL = \\"([^\\"]+)\\"$", src, re.M)}))',
].join('\n')
const shapes = (s, src) => json(py(s, SHAPES, [src]))

// The shape check, the rule BJ10 holds primary-refresh.py to: every call shape it makes is in CALLS, none passes *args
// or **kwargs (so each shape is the whole call), it reads nothing else of the module, and BJ_REL is unchanged. The
// answer is its breaches, [] when it holds. It never asks the reverse: a CALLS entry primary-refresh.py no longer makes
// is no breach, since an installed older copy still makes it.
function breaches(got) {
  const listed = new Set(CALLS.map(key))
  return [
    ...got.calls.filter((c) => !listed.has(key(c))).map((c) => `BJ.${c[0]} called as ${key(c)}, not in CALLS`),
    ...got.unsplat.map((n) => `BJ.${n} called with *args or **kwargs`),
    ...got.other.map((n) => `BJ.${n} read uncalled`),
    ...(key(got.bjRel) === key(['skills/_shared/scripts/background_job.py']) ? [] : [`BJ_REL is ${key(got.bjRel)}`]),
  ]
}

// mod(s): the module's side, from the tree's background_job.py: whether each CALLS entry binds (index for index, "ok"
// or the error), each FROZEN function's leading parameters and any later one with no default, read_state's three
// answers, Notified's fields, notify's reading of its `run` callback, and the return types.
const MODULE = [
  'import inspect',
  'binds = []',
  'for name, npos, kws in json.loads(sys.argv[2]):',
  '    try:',
  '        inspect.signature(getattr(bj, name)).bind(*range(npos), **{k: None for k in kws})',
  '        binds.append("ok")',
  '    except (AttributeError, TypeError) as e:',
  '        binds.append(f"{type(e).__name__}: {e}")',
  'params = {}',
  'for name, frozen in json.loads(sys.argv[3]).items():',
  '    ps = list(inspect.signature(getattr(bj, name)).parameters.values())',
  '    extra = [p.name for p in ps[len(frozen):] if p.default is inspect.Parameter.empty',
  '             and p.kind not in (p.VAR_POSITIONAL, p.VAR_KEYWORD)]',
  '    params[name] = {"head": [p.name for p in ps[:len(frozen)]], "extraWithoutDefault": extra}',
  // read_state's three answers, each (entries, corrupt): a missing file, a valid one and a corrupt one.
  'here = os.getcwd()',
  'open(os.path.join(here, "valid.json"), "w").write(json.dumps({"v": 1, "stuck": {"a": {}}}))',
  'open(os.path.join(here, "corrupt.json"), "w").write("[]")',
  'rs = [bj.read_state(os.path.join(here, f), "primary-refresh", "stuck", 1) for f in ("missing.json", "valid.json", "corrupt.json")]',
  'ran = bj.notify("x.py", "m", None, run=lambda a, t, i: (3, "o1\\no2\\n", "", False), timeout=5)',
  'cut = bj.notify("x.py", "m", None, run=lambda a, t, i: (None, "", "", True), timeout=5)',
  'print(json.dumps({',
  '    "binds": binds, "params": params,',
  '    "readState": [[type(r).__name__, len(r), type(r[0]).__name__, r[1]] for r in rs],',
  '    "fields": list(bj.Notified._fields), "isNotified": [type(ran) is bj.Notified, type(cut) is bj.Notified],',
  '    "ran": [ran.rc, ran.why], "cut": [cut.rc, cut.why],',
  '    "types": [isinstance(bj.state_path(None, "x.json"), os.PathLike), type(bj.job_python()).__name__,',
  '              type(bj.job_path("/a")).__name__, type(bj.launchd_plist("l", ["/p"], "/a", 1, "/l.log")).__name__],',
  '}))',
].join('\n')
const mod = (s) => json(py(s, MODULE, [JSON.stringify(CALLS), JSON.stringify(FROZEN)]))

// RETIRE: write a copy of the primary-refresh.py at argv[2] to argv[3] with every `BJ.<argv[4]>(...)` call cut out of
// the source text (replaced by None, by the AST's byte offsets, so the rest of the file is byte for byte the same), and
// print how many it cut.
const RETIRE = [
  'import ast',
  'src = open(sys.argv[2], "rb").read()',
  'starts = [0]',
  'for line in src.splitlines(keepends=True):',
  '    starts.append(starts[-1] + len(line))',
  'cuts = sorted(((starts[n.lineno - 1] + n.col_offset, starts[n.end_lineno - 1] + n.end_col_offset)',
  '               for n in ast.walk(ast.parse(src, sys.argv[2])) if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)',
  '               and isinstance(n.func.value, ast.Name) and n.func.value.id == "BJ" and n.func.attr == sys.argv[4]), reverse=True)',
  'for a, b in cuts:',
  '    src = src[:a] + b"None" + src[b:]',
  'open(sys.argv[3], "wb").write(src)',
  'print(len(cuts))',
].join('\n')

test('BJ10. the frozen interface primary-refresh.py calls: every BJ call shape it makes is listed, every listed one still binds', (t) => {
  const s = scratch(t)
  assert.deepEqual(breaches(shapes(s, PR)), [],
    'every BJ.<name>(...) call shape in primary-refresh.py is in CALLS, none splats, nothing else of the module is read, BJ_REL is the path an installed copy loads')
  assert.deepEqual([...new Set(CALLS.map(([n]) => n))].sort(), Object.keys(FROZEN).sort(), 'CALLS and FROZEN name the same functions')
  const got = mod(s)
  CALLS.forEach((c, i) => assert.equal(got.binds[i], 'ok', `BJ.${c[0]} called as ${key(c)} still binds to background_job.py's signature`))
  for (const [name, frozen] of Object.entries(FROZEN)) {
    assert.deepEqual(got.params[name].head, frozen, `${name}'s parameters keep their names and order`)
    assert.deepEqual(got.params[name].extraWithoutDefault, [], `${name}'s new parameters come last, each with a default`)
  }
  assert.deepEqual(got.readState, [['tuple', 2, 'dict', false], ['tuple', 2, 'dict', false], ['tuple', 2, 'dict', true]],
    'read_state returns (entries, corrupt) for a missing, a valid and a corrupt file')
  assert.deepEqual(got.fields.slice(0, NOTIFIED.length), NOTIFIED, 'Notified keeps its fields, in order; a new one goes last')
  assert.deepEqual(got.isNotified, [true, true])
  assert.deepEqual(got.ran, [3, 'o2'], 'notify calls run(argv, timeout, input) positionally and reads (rc, out, err, timed_out)')
  assert.equal(got.cut[0], 124, '… timed_out is the stop at its bound')
  assert.deepEqual(got.types, [true, 'str', 'str', 'bytes'])
})

test('BJ10b. additive only: a call primary-refresh.py stops making stays listed and binding; a new or reshaped call must join', (t) => {
  const s = scratch(t)
  // Retire BJ.state_path, the call an installed older copy makes at the top of cmd_run, from a copy of primary-refresh.py.
  const retired = path.join(s.dir, 'retired-primary-refresh.py')
  const r = py(s, RETIRE, [PR, retired, 'state_path'])
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.stdout.trim(), '1', "the copy cuts primary-refresh.py's one BJ.state_path call")
  const before = shapes(s, PR), after = shapes(s, retired)
  assert.ok(before.calls.some(([n]) => n === 'state_path'), 'primary-refresh.py calls BJ.state_path (the precondition)')
  assert.deepEqual(after.calls, before.calls.filter(([n]) => n !== 'state_path'), 'the copy makes every other call as before, and no BJ.state_path')
  assert.deepEqual(breaches(after), [], 'the shape check still passes on the copy that no longer makes the call')
  const i = CALLS.findIndex((c) => key(c) === key(['state_path', 2, []]))
  assert.ok(i >= 0, 'CALLS still lists BJ.state_path(arg, name)')
  assert.deepEqual(FROZEN.state_path, ['arg', 'name'], '… FROZEN still freezes its parameters')
  const got = mod(s)
  assert.equal(got.binds[i], 'ok', '… and it still binds to background_job.py')
  assert.deepEqual(got.params.state_path.head, ['arg', 'name'])
  // A call the list does not hold, by a new name or a known name with one more positional, fails until it joins CALLS.
  const joined = path.join(s.dir, 'joined-primary-refresh.py')
  fs.writeFileSync(joined, `${fs.readFileSync(PR, 'utf8')}\n\ndef _bj10b():\n    BJ.brand_new(1)\n    BJ.state_path(None, "x.json", 3)\n`)
  assert.deepEqual(breaches(shapes(s, joined)), [
    'BJ.brand_new called as ["brand_new",1,[]], not in CALLS',
    'BJ.state_path called as ["state_path",3,[]], not in CALLS',
  ], 'a new call shape is a breach until it joins CALLS')
})
