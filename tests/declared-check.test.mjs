// skills/_shared/scripts/declared-check.py — orient's declared check (ADR 0036 d6; CONTEXT.md **Declared check**).
// Each case runs the shipped script against a fixture vault and a fake HOME under one temp dir, passing --vault and
// HOME every time, so nothing reads or writes the real vault or repos.
//
// The fixture check (check.sh) appends `call <a1> <a2>…` to calls.log and its realpath'd cwd to `where`. Called with
// a trailing `--advance` it copies `upstream` to `record` and prints one line; otherwise it prints the `upstream`
// lines `record` lacks. A `mode` file makes it fail (`fail`) or refuse its `--advance` (`refuse`). Every call parses
// stdout as the script prints it: line 1 a JSON header, then the check's raw bytes.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { root } from './lib/contract-text.mjs'

const SCRIPT = path.join(root, 'skills', '_shared', 'scripts', 'declared-check.py')

// Scrub git's own repo-local names first, then pin the config, so a hook's GIT_DIR never reaches a fixture repo.
const drop = spawnSync('git', ['rev-parse', '--local-env-vars'], { encoding: 'utf8' }).stdout.split('\n').filter(Boolean)
const base = { ...process.env }
for (const name of drop) delete base[name]
base.GIT_CONFIG_GLOBAL = '/dev/null'
base.GIT_CONFIG_NOSYSTEM = '1'
// A `pip install --user` PyYAML resolves under HOME, which every call swaps: pin the real user base as run.sh does.
base.PYTHONUSERBASE ??= spawnSync('python3', ['-c', 'import site; print(site.getuserbase())'], { encoding: 'utf8' }).stdout.trim()

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'declared-check-'))
after(() => fs.rmSync(scratch, { recursive: true, force: true }))
const HOME = path.join(scratch, 'home')
const VAULT = path.join(scratch, 'vault')
const NO_EXPECT = '0'.repeat(64)

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex')
const repoDir = (name) => path.join(HOME, 'repos', name)
const readIn = (name, file) => {
  const p = path.join(repoDir(name), file)
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null
}

function git(args) {
  const r = spawnSync('git', ['-c', 'init.defaultBranch=main', ...args], { env: base, encoding: 'utf8' })
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`)
}

const CHECK_SH = `#!/bin/sh
{ printf 'call'; for a in "$@"; do printf ' <%s>' "$a"; done; printf '\\n'; } >> calls.log
pwd -P > where
last=
for a in "$@"; do last=$a; done
mode=$(cat mode 2>/dev/null)
if [ "$last" = --advance ]; then
  if [ "$mode" = refuse ]; then echo 'refused: upstream not read; the record is unchanged'; exit 1; fi
  cp upstream record; echo 'record moved'; exit 0
fi
if [ "$mode" = fail ]; then echo partial; echo 'upstream unreachable' >&2; exit 1; fi
grep -vxF -f record upstream
exit 0
`
const SLOW_SH = 'sleep 30 &\necho $! > pid\nwait\n'

// A git-inited repo under the fake HOME holding check.sh, an empty record and an upstream.
function repo(name, files = {}) {
  const dir = repoDir(name)
  fs.mkdirSync(dir, { recursive: true })
  git(['init', '-q', dir])
  for (const [f, t] of Object.entries({ 'check.sh': CHECK_SH, upstream: '', record: '', ...files })) {
    fs.writeFileSync(path.join(dir, f), t)
  }
  return dir
}

// A project note; `check` is written as a JSON (so YAML double-quoted) string, `raw` as a literal line.
function note(name, { check, raw, repos = [`~/repos/${name.toLowerCase()}`], tags = ['project'], folder = 'Demo' } = {}) {
  const lines = ['---', 'tags:', ...tags.map((t) => `  - ${t}`)]
  if (repos) lines.push('repos:', ...repos.map((r) => `  - ${r}`))
  if (raw !== undefined) lines.push(raw)
  else if (check !== undefined) lines.push(`orient_check: ${JSON.stringify(check)}`)
  lines.push('---', '', `# ${name}`, '')
  const rel = `Work/Projects/${folder}/${name}.md`
  fs.mkdirSync(path.dirname(path.join(VAULT, rel)), { recursive: true })
  fs.writeFileSync(path.join(VAULT, rel), lines.join('\n'))
  return rel
}

function call(args, { env = {}, pyFlags = [], vault = VAULT } = {}) {
  return spawnSync('python3', [...pyFlags, SCRIPT, ...args, '--vault', vault],
    { encoding: 'buffer', cwd: scratch, env: { ...base, HOME, ...env } })
}

// A header outcome: exit 0, nothing on stderr, line 1 the JSON header, the rest exactly `bytes` long.
function parse(r) {
  assert.equal(r.status, 0, `exit ${r.status}: ${r.stderr}`)
  assert.equal(r.stderr.toString(), '')
  const i = r.stdout.indexOf(0x0a)
  assert.ok(i >= 0, `no header line: ${r.stdout}`)
  const head = JSON.parse(r.stdout.subarray(0, i).toString('utf8'))
  const body = r.stdout.subarray(i + 1)
  assert.equal(head.bytes, body.length, 'bytes is the body length')
  return { head, body, text: body.toString('utf8') }
}
const run = (rel, opts, extra = []) => parse(call(['run', rel, ...extra], opts))
const advance = (rel, expect, opts, extra = []) => parse(call(['advance', rel, '--expect', expect, ...extra], opts))

// A script refusal: the exit code, stdout empty, exactly one `declared-check: ` line on stderr.
function refusal(r, code, re) {
  assert.equal(r.status, code, `exit ${r.status}: ${r.stderr}`)
  assert.equal(r.stdout.length, 0)
  const err = r.stderr.toString()
  assert.match(err, /^declared-check: [^\n]*\n$/)
  assert.match(err, re)
}

// An orphaned sleep is reaped asynchronously after the group kill: poll, in 50 ms steps, for up to 5 s (a loaded
// machine reaps slowly).
async function gone(pid) {
  for (let i = 0; i < 100; i++) {
    try { process.kill(pid, 0) } catch (e) { if (e.code === 'ESRCH') return true; throw e }
    await new Promise((r) => setTimeout(r, 50))
  }
  return false
}

// ---- The fixtures ---------------------------------------------------------------------------------------------
const BIG = Array.from({ length: 1000 }, (_, i) => `entry ${String(i).padStart(4, '0')} ${'x'.repeat(28)}\n`).join('')

for (const r of ['bare', 'blank', 'spaces', 'nil']) repo(r)
const UNDECLARED = [note('Bare'), note('Blank', { check: '' }), note('Spaces', { check: '   ' }), note('Nil', { raw: 'orient_check: null' })]
repo('ok', { upstream: BIG })
const OK = note('Ok', { check: 'sh check.sh' })
repo('adv', { upstream: 'a\nb\n', record: 'a\n' })
const ADV = note('Adv', { check: 'sh check.sh' })
repo('drift', { upstream: 'a\n' })
const DRIFT = note('Drift', { check: 'sh check.sh' })
repo('rerun', { upstream: 'a\n' })
const RERUN = note('Rerun', { check: 'sh check.sh' })
repo('refuse', { upstream: 'a\n' })
const REFUSE = note('Refuse', { check: 'sh check.sh' })
repo('slow', { 'slow.sh': SLOW_SH })
const SLOW = note('Slow', { check: 'sh slow.sh' })
repo('slowadv', { 'slow.sh': SLOW_SH })
const SLOWADV = note('Slowadv', { check: 'sh slow.sh' })
repo('sigslow', { 'slow.sh': SLOW_SH })
const SIGSLOW = note('Sigslow', { check: 'sh slow.sh' })
repo('sigstart', { 'slow.sh': SLOW_SH })
const SIGSTART = note('Sigstart', { check: 'sh slow.sh' })
// A check that traps SIGTERM: the group kill reaches it only when it runs with the caller's signal mask.
repo('trapped', { 'trap.sh': "trap 'echo term > got; exit 0' TERM\nsleep 30 &\necho $! > pid\nwait\n" })
const TRAPPED = note('Trapped', { check: 'sh trap.sh' })
repo('missing')
const MISSING = note('Missing', { check: 'definitely-not-a-command-xyz' })
repo('fails', {
  'f1.sh': 'echo partial\necho "boom: bad thing" >&2\nexit 1\n',
  'f4.sh': 'echo first\necho last\necho\nexit 4\n',
  'f3.sh': 'exit 3\n',
  'f5.sh': `printf '%0300d\\n' 0 >&2\nexit 5\n`,
})
const FAILS = Object.fromEntries([1, 4, 3, 5].map((n) => [n, note(`Fail${n}`, { check: `sh f${n}.sh`, repos: ['~/repos/fails'] })]))
repo('noisy', {
  'noisy.sh': 'last=\nfor a in "$@"; do last=$a; done\necho "pid $$" >&2\n' +
    'if [ "$last" = --advance ]; then echo moved; exit 0; fi\necho stable\n',
})
const NOISY = note('Noisy', { check: 'sh noisy.sh' })
repo('gitdir')
const GITDIR = note('Gitdir', { check: 'git rev-parse --show-toplevel' })

// The guard: every refused command, then the ones that pass. All share one repo holding check.sh.
repo('guard', { upstream: 'g\n' })
const REFUSED = [
  'sh c.sh; touch m', 'sh c.sh && touch m', 'sh c.sh | touch m', 'sh c.sh & touch m', '(touch m)',
  'sh c.sh # x', 'sh c.sh > m', 'sh c.sh 2>&1',
  'sh c.sh `touch m`', 'sh c.sh $(touch m)', 'sh c.sh "$(touch m)"', 'sh c.sh "x$(touch m)y"', 'sh c.sh "$((1+2))"',
  "sh c.sh '$(x)'",
  'sh c.sh "abc', 'sh c.sh\ntouch m', '! sh c.sh', 'sh c.sh \\', 'if true', 'sh c.sh\ttouch',
  // Each of these ran `touch m` under /bin/sh past a guard that read quotes unlike sh: a quote inside a word, a
  // `\"` that does not close, and quotes nested inside `${…}` (bash reads `'…'` there as one string).
  'sh c.sh a"b "x;touch m;y" c"', "sh c.sh a'b 'x;touch m;y' c'", 'sh c.sh "x\\" ";touch m;" y"',
  'sh c.sh "x\\" "|touch m|" y"', `sh c.sh "\${x-'" '}";touch m; #'`,
  // A `$` that does not start $NAME or ${NAME}, quoted or not.
  'sh c.sh ${x-y}', "sh c.sh $'a b'", 'sh c.sh "$1"',
].map((cmd, i) => ({ cmd, rel: note(`Guard${i}`, { check: cmd, repos: ['~/repos/guard'] }) }))
const PASSED = ['sh check.sh "a;b"', 'sh check.sh "a>b"', 'sh check.sh $HOME', 'sh check.sh ${HOME}', 'FOO=1 sh check.sh']
  .map((cmd, i) => ({ cmd, rel: note(`Pass${i}`, { check: cmd, repos: ['~/repos/guard'] }) }))
repo('quoted', { upstream: 'q\n' })
const QUOTED = note('Quoted', { check: "sh check.sh 'a b'" })

repo('list'); repo('number')
const INVALID = [{ rel: note('List', { raw: 'orient_check: [a, b]' }), type: 'list' },
  { rel: note('Number', { raw: 'orient_check: 3' }), type: 'int' }]
repo('second')
const NOREPO = note('Norepo', { check: 'sh check.sh', repos: null })
const FIRSTGONE = note('Firstgone', { check: 'sh check.sh', repos: ['~/repos/not-a-dir', '~/repos/second'] })

const AREA = note('Demo', { check: 'sh check.sh', tags: ['area'], repos: null })
note('Twin', { check: 'sh check.sh' })
note('Twin', { check: 'sh check.sh', folder: 'Other' })

// Every vault note, byte for byte, before any case runs: the script never writes the vault.
const vaultFiles = () => {
  const out = {}
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else out[path.relative(VAULT, p)] = fs.readFileSync(p).toString('base64')
    }
  }
  walk(VAULT)
  return out
}
const SNAPSHOT = vaultFiles()

// ---- The cases ------------------------------------------------------------------------------------------------

test('(a) no orient_check:, a blank one or a null one is undeclared and runs nothing', () => {
  for (const rel of UNDECLARED) {
    const { head, body } = run(rel)
    assert.equal(head.status, 'undeclared', rel)
    assert.equal(head.audit, null)
    assert.equal(head.exit, null)
    assert.equal(head.digest, null)
    assert.equal(body.length, 0)
    assert.equal(head.note, rel)
  }
  for (const r of ['bare', 'blank', 'spaces', 'nil']) assert.equal(readIn(r, 'calls.log'), null, r)
})

test('(b, l) ok: the whole output untruncated, its digest, run from the first repos: entry with ~ against HOME', () => {
  const { head, body } = run(OK)
  assert.equal(head.verb, 'run')
  assert.equal(head.note, OK)
  assert.equal(head.command, 'sh check.sh')
  assert.equal(head.status, 'ok')
  assert.equal(head.exit, 0)
  assert.equal(head.audit, null)
  assert.ok(BIG.length >= 40000)
  assert.ok(body.equals(Buffer.from(BIG)), 'the body is the check stdout byte for byte')
  assert.equal(head.bytes, BIG.length)
  assert.equal(head.digest, sha(body))
  const real = fs.realpathSync(repoDir('ok'))
  assert.equal(head.cwd, real)
  assert.equal(readIn('ok', 'where'), `${real}\n`)
  assert.equal(readIn('ok', 'calls.log'), 'call\n')
  assert.equal(readIn('ok', 'record'), '', 'a plain run changes nothing')
})

test('(c) advance on a matching digest runs <command> --advance after the re-run', () => {
  const first = run(ADV)
  assert.equal(first.text, 'b\n')
  const { head, text } = advance(ADV, first.head.digest)
  assert.equal(head.verb, 'advance')
  assert.equal(head.status, 'advanced')
  assert.equal(head.expected, first.head.digest)
  assert.equal(head.digest, first.head.digest)
  assert.equal(head.exit, 0)
  assert.equal(head.audit, 'declared check: advanced; record moved')
  assert.equal(text, 'record moved\n')
  assert.equal(readIn('adv', 'calls.log'), 'call\ncall\ncall <--advance>\n')
  assert.equal(readIn('adv', 'record'), 'a\nb\n')
})

test('(d) advance holds when the output changed since the audit', () => {
  const first = run(DRIFT)
  fs.appendFileSync(path.join(repoDir('drift'), 'upstream'), 'b\n')
  const before = fs.readFileSync(path.join(repoDir('drift'), 'record'))
  const { head, body } = advance(DRIFT, first.head.digest)
  assert.equal(head.status, 'held')
  assert.equal(head.audit, 'declared check: changed since the audit; record held, the next orient lists it')
  assert.notEqual(head.digest, first.head.digest)
  assert.equal(body.length, 0)
  assert.ok(fs.readFileSync(path.join(repoDir('drift'), 'record')).equals(before), 'record byte-unchanged')
  assert.ok(!readIn('drift', 'calls.log').includes('<--advance>'))
})

test('(d2) advance holds when the re-run fails', () => {
  const first = run(RERUN)
  fs.writeFileSync(path.join(repoDir('rerun'), 'mode'), 'fail\n')
  const { head } = advance(RERUN, first.head.digest)
  assert.equal(head.status, 'held')
  assert.equal(head.exit, 1)
  assert.equal(head.audit, 'declared check: the re-run before --advance exit 1: upstream unreachable; record held, the next orient lists it')
  assert.equal(readIn('rerun', 'record'), '')
  assert.ok(!readIn('rerun', 'calls.log').includes('<--advance>'))
})

test('(d3) a refused --advance is one line naming its exit and the record is unchanged', () => {
  const first = run(REFUSE)
  fs.writeFileSync(path.join(repoDir('refuse'), 'mode'), 'refuse\n')
  const { head, body } = advance(REFUSE, first.head.digest)
  assert.equal(head.status, 'failed')
  assert.equal(head.exit, 1)
  assert.equal(head.audit, 'declared check: --advance exit 1: refused: upstream not read; the record is unchanged')
  assert.equal(body.length, 0)
  assert.equal(readIn('refuse', 'record'), '')
  assert.match(readIn('refuse', 'calls.log'), /call <--advance>\n$/)
})

test('(e) a timeout kills the whole process group', async () => {
  const t0 = Date.now()
  const { head } = run(SLOW, {}, ['--timeout', '1'])
  assert.ok(Date.now() - t0 < 10000, `took ${Date.now() - t0} ms`)
  assert.equal(head.status, 'timeout')
  assert.equal(head.exit, null)
  assert.equal(head.audit, 'declared check: timed out after 1s; its process group was killed')
  const pid = Number(readIn('slow', 'pid'))
  assert.ok(pid > 0)
  assert.ok(await gone(pid), `the backgrounded sleep ${pid} outlived the timeout`)
})

test('(e2) advance holds when the re-run times out, and never runs --advance', async () => {
  const { head } = advance(SLOWADV, NO_EXPECT, {}, ['--timeout', '1'])
  assert.equal(head.status, 'held')
  assert.equal(head.audit, 'declared check: the re-run before --advance timed out after 1s; record held, the next orient lists it')
  assert.ok(await gone(Number(readIn('slowadv', 'pid'))))
})

test('(f) a command that is not found fails with 127 and the shell\'s words', () => {
  const { head, body } = run(MISSING)
  assert.equal(head.status, 'failed')
  assert.equal(head.exit, 127)
  assert.match(head.audit, /^declared check: exit 127: .*not found/)
  assert.equal(body.length, 0)
})

test('(g) a failing check is one audit line: the stderr tail, else stdout, else no output', () => {
  let { head, body } = run(FAILS[1])
  assert.equal(head.status, 'failed')
  assert.equal(head.exit, 1)
  assert.equal(head.audit, 'declared check: exit 1: boom: bad thing')
  assert.equal(head.digest, null)
  assert.equal(body.length, 0, 'a failing check\'s output is not read as entries')
  ;({ head } = run(FAILS[4]))
  assert.equal(head.audit, 'declared check: exit 4: last')
  ;({ head } = run(FAILS[3]))
  assert.equal(head.audit, 'declared check: exit 3: no output')
  ;({ head } = run(FAILS[5]))
  assert.equal(head.audit, `declared check: exit 5: ${'0'.repeat(240)}`, 'the tail is capped at 240 characters')
})

test('(h) stderr stays out of the output and the digest', () => {
  const a = run(NOISY)
  const b = run(NOISY)
  assert.equal(a.text, 'stable\n')
  assert.equal(a.head.digest, b.head.digest)
  const { head, text } = advance(NOISY, a.head.digest)
  assert.equal(head.status, 'advanced')
  assert.equal(text, 'moved\n')
  assert.equal(head.audit, 'declared check: advanced; moved')
  assert.ok(!a.text.includes('pid') && !text.includes('pid'))
})

test('(i) the guard refuses anything but one simple command, through run and advance alike', () => {
  for (const { cmd, rel } of REFUSED) {
    for (const r of [run(rel), advance(rel, NO_EXPECT)]) {
      assert.equal(r.head.status, 'refused', JSON.stringify(cmd))
      assert.match(r.head.audit, /^declared check: orient_check: is not one simple command \([^)]+\); not run$/, JSON.stringify(cmd))
      assert.equal(r.head.command, cmd)
      assert.equal(r.body.length, 0)
    }
  }
  assert.ok(!fs.existsSync(path.join(repoDir('guard'), 'm')), 'a refused command ran')
  assert.ok(!fs.existsSync(path.join(scratch, 'm')), 'a refused command ran')
  assert.equal(readIn('guard', 'calls.log'), null, 'a refused command ran')
  for (const { cmd, rel } of PASSED) assert.equal(run(rel).head.status, 'ok', JSON.stringify(cmd))
  // Quoted operators are plain words; $HOME and ${HOME} expand in the check's shell; an assignment prefix passes.
  assert.equal(readIn('guard', 'calls.log'), `call <a;b>\ncall <a>b>\ncall <${HOME}>\ncall <${HOME}>\ncall\n`)
})

test('(i) a quoted argument stays one word, and --advance arrives as its own', () => {
  const first = run(QUOTED)
  assert.equal(first.head.status, 'ok')
  assert.equal(advance(QUOTED, first.head.digest).head.status, 'advanced')
  assert.equal(readIn('quoted', 'calls.log'), 'call <a b>\ncall <a b>\ncall <a b> <--advance>\n')
})

test('(j) a non-string orient_check: is invalid, unrun', () => {
  for (const { rel, type } of INVALID) {
    for (const r of [run(rel), advance(rel, NO_EXPECT)]) {
      assert.equal(r.head.status, 'invalid')
      assert.equal(r.head.audit, `declared check: orient_check: is not a command string (${type}); not run`)
    }
  }
  assert.equal(readIn('list', 'calls.log'), null)
  assert.equal(readIn('number', 'calls.log'), null)
})

test('(k) no usable first repos: entry is no-repo, and a later entry is never tried', () => {
  let { head } = run(NOREPO)
  assert.equal(head.status, 'no-repo')
  assert.equal(head.cwd, null)
  assert.equal(head.audit, `declared check: ${NOREPO} has no repos: directory to run orient_check: from (none); not run`)
  ;({ head } = run(FIRSTGONE))
  assert.equal(head.status, 'no-repo')
  assert.equal(head.audit, `declared check: ${FIRSTGONE} has no repos: directory to run orient_check: from (~/repos/not-a-dir); not run`)
  assert.equal(readIn('second', 'calls.log'), null)
})

test('(m) a GIT_DIR in the caller\'s environment never reaches the check', () => {
  const { head, text } = run(GITDIR, { env: { GIT_DIR: '/nonexistent', GIT_WORK_TREE: '/nonexistent' } })
  assert.equal(head.status, 'ok', head.audit)
  assert.equal(text, `${fs.realpathSync(repoDir('gitdir'))}\n`)
})

test('(n) the script\'s own refusals: one declared-check: line, nothing on stdout', () => {
  refusal(call(['run', OK], { vault: path.join(scratch, 'no-vault') }), 3, /^declared-check: no vault at /)
  refusal(call(['run', OK], { pyFlags: ['-S'] }), 3, /^declared-check: PyYAML is required/)
  refusal(call(['run', 'Nope']), 2, /no note/)
  refusal(call(['run', AREA]), 2, /area note/)
  refusal(call(['run', 'Twin']), 2, /ambiguous/)
  refusal(call(['run', '../outside.md']), 2, /outside the vault/)
  refusal(call(['advance', UNDECLARED[0], '--expect', NO_EXPECT]), 2, /no orient_check:/)
  refusal(call(['advance', OK]), 2, /--expect/)
  refusal(call(['advance', OK, '--expect', 'ABC']), 2, /--expect/)
  refusal(call(['advance', OK, '--expect', 'A'.repeat(64)]), 2, /--expect/)
  refusal(call(['run', OK, '--expect', NO_EXPECT]), 2, /--expect/)
  refusal(call(['run', OK, '--timeout', '0']), 2, /--timeout/)
  refusal(call(['check', OK]), 2, /invalid choice/)
  assert.equal(readIn('ok', 'calls.log'), 'call\n', 'a refusal ran the check')
})

test('(o) a signalled script kills the live check group', async () => {
  const child = spawn('python3', [SCRIPT, 'run', SIGSLOW, '--vault', VAULT, '--timeout', '60'],
    { cwd: scratch, env: { ...base, HOME }, stdio: ['ignore', 'pipe', 'pipe'] })
  const exited = new Promise((resolve) => child.on('exit', (code, signal) => resolve({ code, signal })))
  let pid = 0
  for (let i = 0; i < 400 && !(pid > 0); i++) {
    await new Promise((r) => setTimeout(r, 25))
    pid = Number((readIn('sigslow', 'pid') ?? '').trim())
  }
  assert.ok(pid > 0, 'the check never started')
  child.kill('SIGTERM')
  const { code } = await exited
  assert.equal(code, 143)
  assert.ok(await gone(pid), `the backgrounded sleep ${pid} outlived the signalled script`)
})

// The script imported (never written to the checkout: -B) with Popen wrapped so a SIGTERM lands after the check has
// started but before run_check records its group: the window between Popen returning and `_live` holding it.
const LATE = `import importlib.util, os, signal, subprocess, sys, time
spec = importlib.util.spec_from_file_location("declared_check", sys.argv[1])
dc = importlib.util.module_from_spec(spec)
spec.loader.exec_module(dc)
class Late(subprocess.Popen):
    def __init__(self, args, **kw):
        super().__init__(args, **kw)
        if list(args[:2]) == ["/bin/sh", "-c"]:
            pid = os.path.join(kw["cwd"], "pid")
            for _ in range(400):
                if os.path.exists(pid) and open(pid).read().strip():
                    break
                time.sleep(0.025)
            os.kill(os.getpid(), signal.SIGTERM)
            time.sleep(0.5)
subprocess.Popen = Late
sys.exit(dc.main(sys.argv[2:]))
`

test('(o2) a signal while the check is starting is held until its group can be killed', async () => {
  const r = spawnSync('python3', ['-B', '-c', LATE, SCRIPT, 'run', SIGSTART, '--vault', VAULT, '--timeout', '60'],
    { cwd: scratch, env: { ...base, HOME }, encoding: 'utf8', timeout: 30000 })
  assert.equal(r.status, 143, `exit ${r.status}: ${r.stderr}`)
  const pid = Number((readIn('sigstart', 'pid') ?? '').trim())
  assert.ok(pid > 0, 'the check never started')
  assert.ok(await gone(pid), `the backgrounded sleep ${pid} outlived a signal sent while the check started`)
})

test('(o3) the check runs with the caller\'s signal mask, so the group kill\'s SIGTERM reaches its trap', async () => {
  const { head } = run(TRAPPED, {}, ['--timeout', '1'])
  assert.equal(head.status, 'timeout')
  assert.equal(readIn('trapped', 'got'), 'term\n', 'SIGTERM never reached the check')
  assert.ok(await gone(Number(readIn('trapped', 'pid'))))
})

test('(p) the vault is byte-unchanged after every case', () => {
  assert.deepEqual(vaultFiles(), SNAPSHOT)
})
