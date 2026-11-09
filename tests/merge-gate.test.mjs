// skills/_shared/scripts/merge-gate.py — the facts of a repo's merge gate for schedule step 2.5 (giflab ADR 0012 d4,
// ADR 0068): the required contexts of branch protection and rulesets, each context's closure of workflow jobs at
// origin/<default>, and the read gaps the script itself finds. Its header is the one copy of the rules pinned here.
//
// Hermetic: each case gets a mkdtemp HOME holding a fixture repo whose origin is https://github.com/o/n (never
// fetched: refs/remotes/origin/main is set with update-ref), an env built from scratch (no GIT_* but
// GIT_CONFIG_GLOBAL=/dev/null, PYTHONUSERBASE kept so a user-site PyYAML still imports under the temp HOME), and
// tests/fixtures/merge-gate/fake-gh.py as --gh-bin, which serves the two endpoints from MG_BRANCH and MG_RULES and logs
// every call to MG_LOG. python3 runs with -B so no bytecode lands. A hung fake records its pid; the cleanup kills that
// recorded pid only, and only while it is alive.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync, execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SCRIPT = path.join(root, 'skills', '_shared', 'scripts', 'merge-gate.py')
const FAKE_GH = path.join(root, 'tests', 'fixtures', 'merge-gate', 'fake-gh.py')
const REAL_GIT = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim()
const [PY, USERBASE] = execFileSync('python3', ['-c', 'import site, sys; print(sys.executable); print(site.getuserbase())'],
  { encoding: 'utf8' }).trim().split('\n')
const ID = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' }
const CTX = 'Checks Complete'
const ACTIONS = 15368

// ---- helpers ------------------------------------------------------------------------------------------------------

function tmpHome(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'merge-gate-'))
  t.after(() => fs.rmSync(home, { recursive: true, force: true }))
  return home
}

const baseEnv = (home, extra = {}) => ({
  PATH: process.env.PATH, HOME: home, TMPDIR: process.env.TMPDIR || os.tmpdir(), PYTHONDONTWRITEBYTECODE: '1',
  PYTHONUSERBASE: process.env.PYTHONUSERBASE || USERBASE, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
  MG_LOG: path.join(home, 'gh.log'), MG_PIDS: path.join(home, 'gh.pids'), ...ID, ...extra,
})

function git(home, cwd, ...args) {
  return execFileSync(REAL_GIT, ['-c', 'init.defaultBranch=main', '-C', cwd, ...args], { encoding: 'utf8', env: baseEnv(home) }).trim()
}

function write(dir, files) {
  for (const [p, body] of Object.entries(files)) {
    const f = path.join(dir, p)
    fs.mkdirSync(path.dirname(f), { recursive: true })
    fs.writeFileSync(f, body)
  }
}

// A fixture repo at <home>/repo holding `files`, one commit, origin's URL set and refs/remotes/origin/<branch> at it.
function fixture(t, files = {}, { home = tmpHome(t), origin = 'https://github.com/o/n', branch = 'main' } = {}) {
  const repo = path.join(home, 'repo')
  fs.mkdirSync(repo, { recursive: true })
  git(home, repo, 'init', '-q')
  if (origin) git(home, repo, 'remote', 'add', 'origin', origin)
  write(repo, { 'README.md': '# fixture\n', ...files })
  git(home, repo, 'add', '-A')
  git(home, repo, 'commit', '-q', '-m', 'base')
  git(home, repo, 'update-ref', `refs/remotes/origin/${branch}`, 'HEAD')
  return { home, repo }
}

// A JSON body file under home, for MG_BRANCH / MG_RULES.
function body(home, name, data) {
  const f = path.join(home, `${name}.json`)
  fs.writeFileSync(f, JSON.stringify(data))
  return f
}

// The branch endpoint's body: protected with these contexts and checks ([context, appId]), or unprotected.
const protectedBranch = (contexts = [], checks = contexts.map((c) => [c, ACTIONS])) => ({
  name: 'main', protected: true,
  protection: { enabled: true, required_status_checks: { enforcement_level: 'non_admins', contexts,
    checks: checks.map(([context, app_id]) => ({ context, app_id })) } },
})
const UNPROTECTED = { name: 'main', protected: false,
  protection: { enabled: false, required_status_checks: { enforcement_level: 'off', contexts: [], checks: [] } } }
const statusRule = (...checks) => ({ type: 'required_status_checks', ruleset_id: 1,
  parameters: { strict_required_status_checks_policy: true,
    required_status_checks: checks.map(([context, integration_id]) => ({ context, ...(integration_id ? { integration_id } : {}) })) } })

function cli(fx, args, { env = {}, argv, timeout = 30000 } = {}) {
  const r = spawnSync(PY, argv || ['-B', SCRIPT, ...args], { encoding: 'utf8', env: baseEnv(fx.home, env), timeout })
  return { status: r.status, signal: r.signal, stdout: r.stdout, stderr: r.stderr }
}

// The gate over `fx`: branch / rules are a body (an object or array, written to a file) or a fake-gh keyword.
function gate(fx, { branch = protectedBranch([CTX]), rules = [], env = {}, args = [], argv } = {}) {
  const spec = (name, v) => (typeof v === 'string' ? v : body(fx.home, name, v))
  const r = cli(fx, ['--repo', fx.repo, '--branch', 'main', '--gh-bin', FAKE_GH, ...args],
    { env: { MG_BRANCH: spec('branch', branch), MG_RULES: spec('rules', rules), ...env }, argv })
  assert.equal(r.status, 0, `exit 0; stderr: ${r.stderr}`)
  assert.equal(r.stderr, '', 'nothing on stderr')
  assert.match(r.stdout, /^\{.*\}\n$/, 'one JSON line')
  return JSON.parse(r.stdout)
}

const ghCalls = (fx) => (fs.existsSync(path.join(fx.home, 'gh.log'))
  ? fs.readFileSync(path.join(fx.home, 'gh.log'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [])
const job = (out, id, workflow) => out.jobs.find((j) => j.id === id && (!workflow || j.workflow === workflow))
const ids = (out) => out.jobs.map((j) => `${path.basename(j.workflow)}:${j.id}${j.calledBy ? `<${j.calledBy.job}` : ''}`)
const hasWhy = (out, re) => assert.ok(out.why.some((w) => re.test(w)), `a why matching ${re}; got ${JSON.stringify(out.why)}`)

const yml = (lines) => lines.join('\n') + '\n'
const ROLLUP = yml([
  'name: CI', 'on:', '  pull_request:', '  push:', '    branches: [main]', 'jobs:',
  '  lint:', '    runs-on: ubuntu-latest', '    steps:', '      - uses: actions/checkout@v4', '      - run: make lint',
  '  test:', '    runs-on: ubuntu-latest', '    steps:', '      - uses: actions/checkout@v4', '      - run: pytest',
  '  checks:', `    name: ${CTX}`, '    if: always()', '    needs: [lint, test]', '    runs-on: ubuntu-latest',
  '    steps:', '      - run: echo all green',
])
const LINT_CALLEE = yml([
  'name: lint', 'on:', '  workflow_call:', 'jobs:',
  '  setup:', '    runs-on: ubuntu-latest', '    steps:', '      - run: make deps',
  '  check:', '    needs: setup', '    runs-on: ubuntu-latest', '    steps:', '      - uses: actions/checkout@v4', '      - run: make lint',
  '  docs:', '    runs-on: ubuntu-latest', '    steps:', '      - run: make docs',
])
const lintCaller = (on) => yml(['name: ci', ...on, 'jobs:', '  lint:', '    name: Lint', "    if: github.actor != 'bot'",
  '    uses: ./.github/workflows/lint.yml'])

// ---- M1: the Verify line's shape ----------------------------------------------------------------------------------

test('M1 a Checks Complete roll-up: its closure is the roll-up and its needs, with run text, if and triggers', (t) => {
  const fx = fixture(t, { '.github/workflows/ci.yml': ROLLUP })
  const out = gate(fx)
  assert.equal(out.status, 'read')
  assert.equal(out.repo, 'o/n')
  assert.equal(out.tree, 'origin/main')
  assert.deepEqual(out.required, [{ context: CTX, sources: ['protection'], appId: ACTIONS }])
  assert.deepEqual(ids(out), ['ci.yml:checks', 'ci.yml:lint', 'ci.yml:test'], 'the roll-up, then its needs in walk order')
  const checks = job(out, 'checks')
  assert.equal(checks.name, CTX)
  assert.equal(checks.if, 'always()')
  assert.deepEqual(checks.needs, ['lint', 'test'])
  assert.deepEqual(checks.matched, [CTX])
  for (const j of out.jobs) {
    assert.deepEqual(j.contexts, [CTX], `${j.id} carries the context`)
    assert.deepEqual(j.readGaps, [], `${j.id} has no read gap`)
    assert.equal(j.prTrigger, true)
    assert.equal(j.pushTrigger, true)
  }
  assert.deepEqual(job(out, 'lint').matched, [])
  assert.deepEqual(job(out, 'test').matched, [])
  assert.deepEqual(job(out, 'lint').steps, [{ uses: 'actions/checkout@v4' }, { run: 'make lint' }])
  assert.deepEqual(job(out, 'test').steps[1], { run: 'pytest' })
  assert.equal(out.workflows.length, 1)
  assert.equal(out.workflows[0].path, '.github/workflows/ci.yml')
  assert.equal(out.workflows[0].name, 'CI')
  assert.ok('pull_request' in out.workflows[0].on, 'workflows[0].on.pull_request is present')
  assert.deepEqual(out.workflows[0].on.push, { branches: ['main'] })
  assert.deepEqual(out.unmatched, [])
  assert.equal(out.truncated, false)
  const calls = ghCalls(fx)
  assert.deepEqual(calls.map((a) => a.at(-1)), ['repos/o/n/branches/main', 'repos/o/n/rules/branches/main'])
  for (const a of calls) assert.deepEqual(a.slice(0, 4), ['api', '-i', '-H', 'Accept: application/vnd.github+json'])
})

// ---- M2: protection and rulesets ---------------------------------------------------------------------------------

test('M2 protection and ruleset contexts are unioned: a shared one carries both sources, and appId is kept', (t) => {
  const fx = fixture(t, { '.github/workflows/ci.yml': ROLLUP })
  const out = gate(fx, { branch: protectedBranch(['A', 'B'], [['A', ACTIONS], ['B', null]]),
    rules: [statusRule(['B', ACTIONS], ['C', null]), { type: 'deletion' }] })
  assert.deepEqual(out.required, [
    { context: 'A', sources: ['protection'], appId: ACTIONS },
    { context: 'B', sources: ['protection', 'ruleset'], appId: ACTIONS },
    { context: 'C', sources: ['ruleset'] },
  ])
})

// ---- M3: matching ------------------------------------------------------------------------------------------------

test('M3 a ${{ }} name is a wildcard, a matrix suffix is stripped, and an `a / b` context reaches the callee', (t) => {
  const fx = fixture(t, {
    '.github/workflows/test.yml': yml(['name: test', 'on:', '  pull_request:', 'jobs:', '  test:',
      '    name: make test (${{ matrix.os }})', '    strategy:', '      matrix:', '        os: [ubuntu-latest, macos-latest]',
      '    runs-on: ${{ matrix.os }}', '    steps:', '      - run: make test']),
    '.github/workflows/py.yml': yml(['on: pull_request', 'jobs:', '  test:', '    strategy:', '      matrix:',
      "        python: ['3.11']", '    runs-on: ubuntu-latest', '    steps:', '      - run: pytest']),
    '.github/workflows/ci.yml': lintCaller(['on:', '  pull_request:']),
    '.github/workflows/lint.yml': LINT_CALLEE,
  })
  const out = gate(fx, { branch: protectedBranch(['make test (ubuntu-latest)', 'make test (macos-latest)', 'test (3.11)', 'Lint / check']) })
  assert.equal(out.status, 'read')
  assert.deepEqual(out.unmatched, [])
  const mt = job(out, 'test', '.github/workflows/test.yml')
  assert.deepEqual(mt.matched, ['make test (ubuntu-latest)', 'make test (macos-latest)'], 'one job for both matrix contexts')
  assert.deepEqual(mt.contexts, ['make test (ubuntu-latest)', 'make test (macos-latest)'])
  assert.equal(mt.matrix, '{"os":["ubuntu-latest","macos-latest"]}')
  assert.deepEqual(job(out, 'test', '.github/workflows/py.yml').matched, ['test (3.11)'], 'a no-name matrix job by its id')
  assert.deepEqual(ids(out), ['test.yml:test', 'py.yml:test', 'ci.yml:lint', 'lint.yml:check<lint', 'lint.yml:setup<lint'], 'docs is absent')
  const caller = job(out, 'lint', '.github/workflows/ci.yml')
  assert.equal(caller.uses, './.github/workflows/lint.yml')
  assert.deepEqual(caller.matched, ['Lint / check'])
  assert.deepEqual(caller.readGaps, [])
  for (const id of ['check', 'setup']) {
    const c = job(out, id, '.github/workflows/lint.yml')
    assert.deepEqual(c.calledBy, { workflow: '.github/workflows/ci.yml', job: 'lint', if: "github.actor != 'bot'" })
    assert.equal(c.onFrom, '.github/workflows/ci.yml')
    assert.equal(c.prTrigger, true, `${id}: counted by its caller's pull_request`)
    assert.equal(c.pushTrigger, false)
    assert.deepEqual(c.contexts, ['Lint / check'])
  }
  assert.deepEqual(job(out, 'check', '.github/workflows/lint.yml').matched, ['Lint / check'])
  assert.deepEqual(job(out, 'setup', '.github/workflows/lint.yml').matched, [])
  assert.deepEqual(out.workflows.map((w) => w.path), ['.github/workflows/test.yml', '.github/workflows/py.yml',
    '.github/workflows/ci.yml', '.github/workflows/lint.yml'])
  assert.ok('workflow_call' in out.workflows[3].on)

  const nope = gate(fx, { branch: protectedBranch(['Lint / nope']) })
  assert.deepEqual(ids(nope), ['ci.yml:lint', 'lint.yml:setup<lint', 'lint.yml:check<lint', 'lint.yml:docs<lint'], 'every callee job')
  hasWhy(nope, /^Lint \/ nope: no job of \.github\/workflows\/lint\.yml matches `nope`; every job of it is listed$/)
})

test('M3 a name two workflows share lists both candidates', (t) => {
  const job1 = (n) => yml(['on: [pull_request]', 'jobs:', `  ${n}:`, '    name: Dup', '    runs-on: x', '    steps:', `      - run: echo ${n}`])
  const fx = fixture(t, { '.github/workflows/a.yml': job1('one'), '.github/workflows/b.yml': job1('two') })
  const out = gate(fx, { branch: protectedBranch(['Dup']) })
  assert.deepEqual(ids(out), ['a.yml:one', 'b.yml:two'])
  for (const j of out.jobs) assert.deepEqual(j.matched, ['Dup'])
})

// ---- M4: unmatched -----------------------------------------------------------------------------------------------

test('M4 another app, an unmatched context, a required workflow and code scanning go to unmatched', (t) => {
  const fx = fixture(t, { '.github/workflows/ci.yml': yml(['on: pull_request', 'jobs:', '  build:', '    runs-on: x',
    '    steps:', '      - run: make build']) })
  const out = gate(fx, {
    branch: protectedBranch(['codecov/patch', 'build'], [['codecov/patch', null], ['build', 999]]),
    rules: [{ type: 'workflows', parameters: { workflows: [{ path: '.github/workflows/sec.yml', repository_id: 42, ref: 'main' }] } },
      { type: 'code_scanning', parameters: { code_scanning_tools: [{ tool: 'CodeQL', alerts_threshold: 'errors' }] } }],
  })
  assert.equal(out.status, 'read')
  assert.deepEqual(out.jobs, [], 'no job: build is another app\'s, although a job build exists')
  assert.deepEqual(out.unmatched, [
    { sources: ['ruleset'], kind: 'required-workflow', path: '.github/workflows/sec.yml', repositoryId: 42, ref: 'main' },
    { sources: ['ruleset'], kind: 'code-scanning', tools: ['CodeQL'] },
    { context: 'codecov/patch', sources: ['protection'], kind: 'context' },
    { context: 'build', sources: ['protection'], kind: 'app', appId: 999 },
  ])
})

// ---- M5-M7: status -----------------------------------------------------------------------------------------------

test('M5 none only on two clean reads with nothing required', (t) => {
  const fx = fixture(t, { '.github/workflows/ci.yml': ROLLUP })
  for (const branch of [UNPROTECTED, protectedBranch([])]) {
    const out = gate(fx, { branch, rules: [] })
    assert.equal(out.status, 'none', JSON.stringify(branch))
    assert.deepEqual([out.required, out.unmatched, out.jobs, out.why], [[], [], [], []])
  }
})

test('M6 a branch read that is not 200 is unreadable, never none', (t) => {
  const fx = fixture(t, { '.github/workflows/ci.yml': ROLLUP })
  const both = gate(fx, { branch: '404', rules: '404' })
  assert.equal(both.status, 'unreadable')
  assert.equal(both.jobs, null)
  hasWhy(both, /^branches\/main: HTTP 404/)
  hasWhy(both, /^rules\/branches\/main: HTTP 404/)
  assert.equal(gate(fx, { branch: '403' }).status, 'unreadable')
  const rulesOnly = gate(fx, { branch: '404', rules: [statusRule([CTX, ACTIONS])] })
  assert.equal(rulesOnly.status, 'unreadable')
  assert.deepEqual(rulesOnly.required, [{ context: CTX, sources: ['ruleset'], appId: ACTIONS }])
})

test('M7 a rules read that fails alone (an unprotected branch too), or a protection not visible, is partial', (t) => {
  const fx = fixture(t, { '.github/workflows/ci.yml': ROLLUP })
  const noRules = gate(fx, { rules: '404' })
  assert.equal(noRules.status, 'partial')
  assert.deepEqual(noRules.required.map((r) => r.context), [CTX])
  assert.deepEqual(ids(noRules), ['ci.yml:checks', 'ci.yml:lint', 'ci.yml:test'], 'the jobs are still read')
  hasWhy(noRules, /^rules\/branches\/main: HTTP 404/)
  // An unprotected branch whose rules read fails: nothing to read, but never `none` (only two clean reads are).
  for (const kw of ['404', '500', 'nologin']) {
    const bare = gate(fx, { branch: UNPROTECTED, rules: kw })
    assert.equal(bare.status, 'partial', `unprotected, rules ${kw}`)
    assert.deepEqual(bare.jobs, [], `unprotected, rules ${kw}: no jobs to read`)
    hasWhy(bare, /^rules\/branches\/main:/)
  }
  const hidden = gate(fx, { branch: { name: 'main', protected: true } })
  assert.equal(hidden.status, 'partial')
  hasWhy(hidden, /^branches\/main: protection not visible to this gh account$/)
  const next = gate(fx, { rules: [statusRule(['Extra', null])], env: { MG_RULES_NEXT: '1' } })
  assert.equal(next.truncated, true, 'a rules read with a next page is truncated')
  hasWhy(next, /^rules\/branches\/main: more than one page; only the first read$/)
})

test('M7b the plan\'s no-rulesets 403 is a clean empty rules read: none on an unprotected branch, read on a protected one', (t) => {
  const fx = fixture(t, { '.github/workflows/ci.yml': ROLLUP })
  // A private repo on GitHub Free: no ruleset can exist, and an unprotected branch requires nothing (lachyts/chorus).
  const free = gate(fx, { branch: UNPROTECTED, rules: '403plan' })
  assert.equal(free.status, 'none')
  assert.deepEqual([free.required, free.unmatched, free.jobs], [[], [], []])
  hasWhy(free, /^rules\/branches\/main: HTTP 403, rulesets are not on this repo's GitHub plan, so none can apply$/)
  // A protected branch on the same plan: the protection's contexts are read in full.
  const prot = gate(fx, { rules: '403plan' })
  assert.equal(prot.status, 'read')
  assert.deepEqual(prot.required.map((r) => r.context), [CTX])
  // Any other 403 on the rules read stays a failure.
  const other = gate(fx, { branch: UNPROTECTED, rules: '403' })
  assert.equal(other.status, 'partial')
  hasWhy(other, /^rules\/branches\/main: HTTP 403$/)
  // The branch read's 403 is never read as the plan's, whatever its body.
  assert.equal(gate(fx, { branch: '403', rules: '403plan' }).status, 'unreadable')
})

// ---- M8: gh failures ---------------------------------------------------------------------------------------------

test('M8 gh missing, logged out, a 5xx and a body that is not JSON are each unreadable, exit 0', (t) => {
  const fx = fixture(t, { '.github/workflows/ci.yml': ROLLUP })
  const missing = gate(fx, { args: ['--gh-bin', path.join(fx.home, 'nonexistent')] })
  assert.equal(missing.status, 'unreadable')
  hasWhy(missing, /^branches\/main: gh will not start: /)
  for (const kw of ['nologin', '500', 'badjson']) {
    const out = gate(fx, { branch: kw, rules: kw })
    assert.equal(out.status, 'unreadable', kw)
  }
  hasWhy(gate(fx, { branch: 'nologin' }), /^branches\/main: To get started with GitHub CLI/)
  hasWhy(gate(fx, { branch: 'badjson' }), /^branches\/main: HTTP 200 but the body is not JSON$/)
})

test('M8 a hung gh is killed with its group at GH_TIMEOUT, and the read is unreadable', (t) => {
  const fx = fixture(t, { '.github/workflows/ci.yml': ROLLUP })
  const pids = path.join(fx.home, 'gh.pids')
  t.after(() => {
    if (!fs.existsSync(pids)) return
    for (const p of fs.readFileSync(pids, 'utf8').split('\n').filter(Boolean).map(Number)) {
      try { process.kill(p, 0); process.kill(p, 'SIGKILL') } catch { /* gone */ }
    }
  })
  const started = Date.now()
  const out = gate(fx, { branch: 'hang', rules: 'hang', argv: ['-B', '-c', `import importlib.util, sys
spec = importlib.util.spec_from_file_location('mg', sys.argv[1]); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
m.GH_TIMEOUT = 1
sys.exit(m.main(sys.argv[2:]))`, SCRIPT, '--repo', fx.repo, '--branch', 'main', '--gh-bin', FAKE_GH] })
  const elapsed = Date.now() - started
  assert.ok(elapsed < 5000, `bounded: took ${elapsed}ms`)
  assert.equal(out.status, 'unreadable')
  hasWhy(out, /^branches\/main: gh api timed out after 1s$/)
  const recorded = fs.readFileSync(pids, 'utf8').split('\n').filter(Boolean).map(Number)
  assert.equal(recorded.length, 2, 'both reads hung')
  for (const p of recorded) assert.throws(() => process.kill(p, 0), /ESRCH/, `pid ${p} is gone`)
})

// ---- M9: the origin ----------------------------------------------------------------------------------------------

test('M9 no GitHub origin, a land.sh that fails and one that will not start are unreadable, and gh is never called', (t) => {
  const bare = fixture(t, {}, { origin: null })
  const b = tmpHome(t)
  git(b, b, 'init', '-q', '--bare', path.join(b, 'o.git'))
  git(bare.home, bare.repo, 'remote', 'add', 'origin', path.join(b, 'o.git'))
  const local = gate(bare)
  assert.equal(local.status, 'unreadable')
  assert.deepEqual(local.why, ['no GitHub origin'])

  const fx = fixture(t, { '.github/workflows/ci.yml': ROLLUP })
  const fake = path.join(fx.home, 'fakebin')
  fs.mkdirSync(fake)
  fs.writeFileSync(path.join(fake, 'bash'), '#!/bin/sh\nexit 3\n', { mode: 0o755 })
  const failing = gate(fx, { env: { PATH: `${fake}:${process.env.PATH}` } })
  assert.equal(failing.status, 'unreadable')
  hasWhy(failing, /^origin: .*land\.sh exit 3/)

  const only = path.join(fx.home, 'onlybin')
  fs.mkdirSync(only)
  fs.symlinkSync(PY, path.join(only, 'python3'))
  fs.symlinkSync(REAL_GIT, path.join(only, 'git'))
  const nostart = gate(fx, { env: { PATH: only } })
  assert.equal(nostart.status, 'unreadable')
  hasWhy(nostart, /^origin: .*will not start/)
  for (const f of [bare, fx]) assert.deepEqual(ghCalls(f), [], 'gh never called')
})

// ---- M10, M11: the tree and PyYAML -------------------------------------------------------------------------------

test('M10 the gate reads origin/<default>: an uncommitted job and a local-only commit are ignored; a missing tree is partial', (t) => {
  const fx = fixture(t, { '.github/workflows/ci.yml': ROLLUP })
  write(fx.repo, { '.github/workflows/local.yml': yml(['on: pull_request', 'jobs:', '  extra:', `    name: ${CTX}`,
    '    runs-on: x', '    steps:', '      - run: make extra']) })
  git(fx.home, fx.repo, 'add', '-A')
  git(fx.home, fx.repo, 'commit', '-q', '-m', 'local only')
  write(fx.repo, { '.github/workflows/dirty.yml': yml(['on: pull_request', 'jobs:', '  dirty:', `    name: ${CTX}`,
    '    runs-on: x', '    steps:', '      - run: make dirty']) })
  const out = gate(fx)
  assert.deepEqual(ids(out), ['ci.yml:checks', 'ci.yml:lint', 'ci.yml:test'])
  const missing = gate(fx, { args: ['--tree', 'origin/nope'] })
  assert.equal(missing.status, 'partial')
  assert.equal(missing.jobs, null)
  hasWhy(missing, /^tree origin\/nope: not found/)
})

test('M11 PyYAML not importable: jobs null, the workflows listed by path, and a why naming PyYAML', (t) => {
  const fx = fixture(t, { '.github/workflows/ci.yml': ROLLUP, '.github/workflows/b.yaml': 'on: push\n' })
  const out = gate(fx, { argv: ['-B', '-c', `import runpy, sys
sys.modules['yaml'] = None
sys.argv = sys.argv[1:]
runpy.run_path(sys.argv[0], run_name='__main__')`, SCRIPT, '--repo', fx.repo, '--branch', 'main', '--gh-bin', FAKE_GH] })
  assert.equal(out.status, 'partial')
  assert.equal(out.jobs, null)
  assert.deepEqual(out.workflows, [{ path: '.github/workflows/b.yaml' }, { path: '.github/workflows/ci.yml' }])
  hasWhy(out, /PyYAML/)
})

// ---- M12: caps ---------------------------------------------------------------------------------------------------

test('M12 MAX_JOBS cuts a closure that does not fit, callee jobs counting; a long run or with is cut and is a read gap', (t) => {
  const chain = ['  chain:', '    name: Chain', '    needs: c1', '    runs-on: x', '    steps:', '      - run: echo 0']
  for (let i = 1; i < 70; i++) chain.push(`  c${i}:`, ...(i < 69 ? [`    needs: c${i + 1}`] : []), '    runs-on: x', '    steps:', `      - run: echo ${i}`)
  const many = ['on: workflow_call', 'jobs:']
  for (let i = 1; i <= 70; i++) many.push(`  m${i}:`, '    runs-on: x', '    steps:', `      - run: echo ${i}`)
  const long = 'x'.repeat(2500)
  const fx = fixture(t, {
    '.github/workflows/a.yml': yml(['on: pull_request', 'jobs:', '  solo:', '    name: Solo', '    runs-on: x', '    steps:', '      - run: echo solo', ...chain]),
    '.github/workflows/b.yml': yml(['on: pull_request', 'jobs:', '  many:', '    name: Many', '    uses: ./.github/workflows/many.yml']),
    '.github/workflows/many.yml': yml(many),
    '.github/workflows/c.yml': yml(['on: pull_request', 'jobs:', '  long:', '    name: Long', '    runs-on: x', '    steps:',
      '      - uses: actions/checkout@v4', `      - run: echo ${long}`, '      - uses: org/x@v1', '        with:', `          args: ${long}`]),
  })
  const out = gate(fx, { branch: protectedBranch(['Solo', 'Chain']) })
  assert.equal(out.jobs.length, 64)
  assert.equal(out.truncated, true)
  assert.deepEqual(out.required.map((r) => [r.context, r.cut ?? false]), [['Solo', false], ['Chain', true]])
  hasWhy(out, /^Chain: its closure did not fit MAX_JOBS \(64 jobs\)$/)

  const callee = gate(fx, { branch: protectedBranch(['Many']) })
  assert.equal(callee.jobs.length, 64, 'the caller and 63 callee jobs')
  assert.equal(callee.required[0].cut, true)

  const cut = gate(fx, { branch: protectedBranch(['Long']) })
  const j = job(cut, 'long')
  assert.equal(j.steps[1].run.length, 2001)
  assert.ok(j.steps[1].run.endsWith('…'))
  assert.equal(j.steps[1].runTruncated, true)
  assert.equal(j.steps[2].runTruncated, true, 'an over-long with is cut too')
  assert.equal(j.steps[2].with.length, 2001)
  assert.equal(j.steps[0].runTruncated, undefined)
  assert.deepEqual(j.readGaps, ['step 2 cut at 2000 characters', 'step 3 cut at 2000 characters'])
  assert.equal(cut.truncated, true)
})

// ---- M13: on: and triggers ---------------------------------------------------------------------------------------

test('M13 on: in its string, list and map forms; filters kept; push-only callers set pushTrigger only', (t) => {
  const one = (name, on) => yml([...on, 'jobs:', '  j:', `    name: ${name}`, '    runs-on: x', '    steps:', '      - run: make it'])
  const fx = fixture(t, {
    '.github/workflows/s.yml': one('S', ['on: push']),
    '.github/workflows/l.yml': one('L', ['on: [push, pull_request]']),
    '.github/workflows/m.yml': one('M', ['"on":', '  pull_request:', "    paths: ['src/**']", '    types: [opened, synchronize]',
      '    other: dropped', '  workflow_dispatch:', '    inputs:', '      x: {}', '  schedule:', "    - cron: '0 5 * * 1'"]),
    '.github/workflows/ci.yml': lintCaller(['on:', '  push:']),
    '.github/workflows/lint.yml': LINT_CALLEE,
  })
  const out = gate(fx, { branch: protectedBranch(['S', 'L', 'M', 'Lint / check']) })
  const on = Object.fromEntries(out.workflows.map((w) => [path.basename(w.path), w.on]))
  assert.deepEqual(on['s.yml'], { push: null })
  assert.deepEqual(on['l.yml'], { push: null, pull_request: null })
  assert.deepEqual(on['m.yml'], { pull_request: { paths: ['src/**'], types: ['opened', 'synchronize'] }, workflow_dispatch: null, schedule: null })
  assert.deepEqual(on['ci.yml'], { push: null }, 'the YAML 1.1 True key reads as on')
  const trig = (file) => { const j = out.jobs.find((x) => x.workflow.endsWith(file)); return [j.prTrigger, j.pushTrigger] }
  assert.deepEqual(trig('/s.yml'), [false, true], 'a push-only workflow')
  assert.deepEqual(trig('/l.yml'), [true, true])
  assert.deepEqual(trig('/m.yml'), [true, false])
  const check = job(out, 'check', '.github/workflows/lint.yml')
  assert.deepEqual([check.prTrigger, check.pushTrigger, check.onFrom], [false, true, '.github/workflows/ci.yml'],
    'a callee is counted by its push-only caller')
})

// ---- M14-M16: usage, the git env, the branch's encoding ----------------------------------------------------------

test('M14 a --repo outside a git work tree, or no --branch, exits 2', (t) => {
  const home = tmpHome(t)
  const fx = { home, repo: home }
  const r = cli(fx, ['--repo', home, '--branch', 'main', '--gh-bin', FAKE_GH])
  assert.equal(r.status, 2)
  assert.equal(r.stdout, '')
  assert.match(r.stderr, /^merge-gate: --repo .*: not a git work tree\n$/)
  assert.equal(cli(fx, ['--repo', home]).status, 2)
})

test('M15 a GIT_DIR exported at a decoy repo still reads the fixture', (t) => {
  const fx = fixture(t, { '.github/workflows/ci.yml': ROLLUP })
  const decoy = tmpHome(t)
  git(decoy, decoy, 'init', '-q')
  const out = gate(fx, { env: { GIT_DIR: path.join(decoy, '.git'), GIT_WORK_TREE: decoy } })
  assert.equal(out.status, 'read')
  assert.equal(out.repo, 'o/n')
  assert.deepEqual(ids(out), ['ci.yml:checks', 'ci.yml:lint', 'ci.yml:test'])
})

test('M16 a branch holding a / is percent-encoded in both endpoints', (t) => {
  const fx = fixture(t, { '.github/workflows/ci.yml': ROLLUP }, { branch: 'release/1.x' })
  const r = cli(fx, ['--repo', fx.repo, '--branch', 'release/1.x', '--gh-bin', FAKE_GH],
    { env: { MG_BRANCH: body(fx.home, 'b', protectedBranch([CTX])), MG_RULES: body(fx.home, 'r', []) } })
  assert.equal(r.status, 0, r.stderr)
  assert.equal(JSON.parse(r.stdout).tree, 'origin/release/1.x')
  assert.deepEqual(ghCalls(fx).map((a) => a.at(-1)), ['repos/o/n/branches/release%2F1.x', 'repos/o/n/rules/branches/release%2F1.x'])
  assert.deepEqual(ids(JSON.parse(r.stdout)), ['ci.yml:checks', 'ci.yml:lint', 'ci.yml:test'])
})

// ---- M17: read gaps ----------------------------------------------------------------------------------------------

test('M17 the script names its read gaps: a remote or nested reusable workflow, and a local action it did not expand', (t) => {
  const fx = fixture(t, {
    '.github/workflows/ci.yml': yml(['on: pull_request', 'jobs:',
      '  lint:', '    uses: org/shared/.github/workflows/lint.yml@v1',
      '  test:', '    runs-on: x', '    steps:', '      - run: pytest',
      '  checks:', `    name: ${CTX}`, '    needs: [test, lint]', '    runs-on: x', '    steps:', '      - run: echo ok',
      '  outer:', '    name: Outer', '    uses: ./.github/workflows/outer.yml',
      '  acts:', '    name: Acts', '    runs-on: x', '    steps:', '      - uses: ./.github/actions/lint',
      '      - uses: ./.github/actions/node', '      - uses: ./.github/actions/gone', '      - uses: org/x@v1', '        with:', '          args: lint']),
    '.github/workflows/outer.yml': yml(['on: workflow_call', 'jobs:', '  inner:', '    uses: ./.github/workflows/inner.yml']),
    '.github/actions/lint/action.yml': yml(['name: lint', 'runs:', '  using: composite', '  steps:', '    - run: make lint', '      shell: bash']),
    '.github/actions/node/action.yaml': yml(['name: node', 'runs:', '  using: node20', '  main: index.js']),
  })
  const out = gate(fx, { branch: protectedBranch([CTX, 'Outer', 'Acts']) })
  assert.equal(out.status, 'read')
  assert.equal(out.required[0].cut, undefined)
  const lint = job(out, 'lint')
  assert.equal(lint.uses, 'org/shared/.github/workflows/lint.yml@v1')
  assert.deepEqual(lint.contexts, [CTX])
  assert.deepEqual(lint.steps, [])
  assert.deepEqual(lint.readGaps, ['remote reusable workflow org/shared/.github/workflows/lint.yml@v1: not read'])
  assert.deepEqual(job(out, 'test').readGaps, [])
  assert.deepEqual(job(out, 'inner').readGaps, ['nested reusable workflow ./.github/workflows/inner.yml: not expanded'])
  assert.deepEqual(job(out, 'inner').calledBy, { workflow: '.github/workflows/ci.yml', job: 'outer' })
  const acts = job(out, 'acts')
  assert.deepEqual(acts.steps[0], { uses: './.github/actions/lint',
    action: { path: '.github/actions/lint', using: 'composite', steps: [{ run: 'make lint' }] } })
  assert.deepEqual(acts.steps[1].action, { path: '.github/actions/node', using: 'node20' })
  assert.deepEqual(acts.steps[3], { uses: 'org/x@v1', with: '{"args":"lint"}' }, 'a remote step action keeps its uses and with')
  assert.deepEqual(acts.readGaps, ['local action .github/actions/node: node20 not read', 'local action .github/actions/gone: missing'])
})

// ---- M18: a shared need ------------------------------------------------------------------------------------------

test('M18 a job two contexts need carries both in contexts, and neither in matched', (t) => {
  const fx = fixture(t, { '.github/workflows/ci.yml': yml(['on: pull_request', 'jobs:',
    '  shared:', '    runs-on: x', '    steps:', '      - run: make lint',
    '  a:', '    name: A', '    needs: shared', '    runs-on: x', '    steps:', '      - run: echo a',
    '  b:', '    name: B', '    needs: [shared]', '    runs-on: x', '    steps:', '      - run: echo b']) })
  const out = gate(fx, { branch: protectedBranch(['A', 'B']) })
  assert.deepEqual(ids(out), ['ci.yml:a', 'ci.yml:shared', 'ci.yml:b'])
  assert.deepEqual(job(out, 'shared').contexts, ['A', 'B'])
  assert.deepEqual(job(out, 'shared').matched, [])
  assert.deepEqual(job(out, 'a').contexts, ['A'])
})
