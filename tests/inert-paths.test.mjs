// skills/_shared/scripts/inert-paths.py — a move in Inert paths re-runs nothing (ADR 0045, p29-3): the path test, the Inert
// proof (fail-closed), and schedule's propose, record and drop.
//
// Hermetic: each case gets a mkdtemp HOME (kept in its as-written /var/folders form, so the realpath comparison is
// exercised), a fixture repo at <HOME>/repos/fx with a linked worktree at <HOME>/wt/t (outside the repo, so a walk of
// <HOME>/wt pins the worktree-list places), THREAD_EVENTS_DIR under HOME, and an env built from scratch. Every proof
// runs the shipped CLI (or the module in process, for the path test and the budget), with -B so no bytecode lands.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync, execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SCRIPTS = path.join(root, 'skills', '_shared', 'scripts')
const SCRIPT = path.join(SCRIPTS, 'inert-paths.py')
const REAL_GIT = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim()
const ID = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' }

// ---- helpers ------------------------------------------------------------------------------------------------------

function tmpHome(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'inert-paths-'))
  t.after(() => fs.rmSync(home, { recursive: true, force: true }))
  return home
}

const baseEnv = (home, extra = {}) => ({
  PATH: process.env.PATH, HOME: home, TMPDIR: process.env.TMPDIR || os.tmpdir(), PYTHONDONTWRITEBYTECODE: '1',
  THREAD_EVENTS_DIR: path.join(home, 'events'), GIT_CONFIG_GLOBAL: path.join(home, '.gitconfig'), GIT_CONFIG_NOSYSTEM: '1',
  ...ID, ...extra,
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

// A fixture repo at <home>/repos/fx holding `files` (plus a THREAD.md and a handoff), one commit, a linked worktree at
// <home>/wt/t, and a GitHub origin URL (never fetched).
function fixture(t, files = {}, { home = tmpHome(t), worktree = true, origin = 'https://github.com/o/fx' } = {}) {
  const repo = path.join(home, 'repos', 'fx')
  fs.mkdirSync(repo, { recursive: true })
  git(home, repo, 'init', '-q')
  if (origin) git(home, repo, 'remote', 'add', 'origin', origin)
  write(repo, { 'THREAD.md': '# thread\n', 'docs/handoffs/old.md': 'a handoff\n', 'docs/reviews/r.md': 'a review\n', ...files })
  git(home, repo, 'add', '-A')
  git(home, repo, 'commit', '-q', '-m', 'base')
  if (worktree) git(home, repo, 'worktree', 'add', '-q', '-b', 'task', path.join(home, 'wt', 't'))
  return { home, repo }
}

// `timeout` (ms, default none) kills the spawn when it runs past it, so a proof that never returns fails its test
// (`signal` set) instead of hanging the suite.
function cli(home, args, { env = {}, cwd = home, timeout } = {}) {
  const r = spawnSync('python3', ['-B', SCRIPT, ...args], { encoding: 'utf8', cwd, env: baseEnv(home, env), ...(timeout ? { timeout } : {}) })
  return { status: r.status, signal: r.signal, stdout: r.stdout, stderr: r.stderr }
}

function prove(fx, globs, { verifier = 'true', bootstrap = '', tree = 'HEAD', env = {} } = {}) {
  const args = ['prove', '--repo', fx.repo, '--tree', tree, '--verifier', verifier, ...(bootstrap ? ['--bootstrap', bootstrap] : [])]
  for (const g of globs) args.push('--glob', g)
  const r = cli(fx.home, args, { env })
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.stderr, '')
  return JSON.parse(r.stdout).globs
}

function holds(res, glob, label = glob) {
  assert.equal(res[glob].held, true, `${label} holds; readers: ${JSON.stringify(res[glob].readers)}`)
}

function fails(res, glob, want, label = glob) {
  assert.equal(res[glob].held, false, `${label} fails`)
  const hit = res[glob].readers.find((r) => Object.entries(want).every(([k, v]) => r[k] === v))
  assert.ok(hit, `${label}: a reader with ${JSON.stringify(want)}; got ${JSON.stringify(res[glob].readers)}`)
  return hit
}

// The module in process: `body` runs with `m` loaded; it prints JSON.
function inProcess(home, body, { env = {}, args = [] } = {}) {
  const code = ['import importlib.util, json, sys', 'spec = importlib.util.spec_from_file_location("ip", sys.argv[1])',
    'm = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)', body].join('\n')
  const r = spawnSync('python3', ['-B', '-c', code, SCRIPT, ...args], { encoding: 'utf8', cwd: home, env: baseEnv(home, env) })
  assert.equal(r.status, 0, r.stderr)
  return JSON.parse(r.stdout)
}

const PY_HEAD = 'import os, glob, sys, tempfile, functools\nfrom pathlib import Path\nREPO_ROOT = Path(__file__).resolve().parents[1]\n'

// ---- the path test ------------------------------------------------------------------------------------------------

function pathTest(fx, base, head, globs) {
  return inProcess(fx.home, 'print(json.dumps(m.path_test(sys.argv[2], sys.argv[3], sys.argv[4], json.loads(sys.argv[5]))))',
    { args: [fx.repo, base, head, JSON.stringify(globs)] })
}

test('path test: a THREAD.md-only move is inert; a source file beside it is not; empty globs make nothing inert', (t) => {
  const fx = fixture(t, { 'src/a.py': 'x = 1\n' })
  const base = git(fx.home, fx.repo, 'rev-parse', 'HEAD')
  write(fx.repo, { 'THREAD.md': '# thread\nmore\n' })
  git(fx.home, fx.repo, 'commit', '-qam', 'thread')
  const one = git(fx.home, fx.repo, 'rev-parse', 'HEAD')
  let pt = pathTest(fx, base, one, ['THREAD.md', 'docs/handoffs/**'])
  assert.deepEqual([pt.changed, pt.inert, pt.nonInert, pt.matched, pt.globs], [['THREAD.md'], ['THREAD.md'], [], ['THREAD.md'], ['THREAD.md']])
  write(fx.repo, { 'src/a.py': 'x = 2\n' })
  git(fx.home, fx.repo, 'commit', '-qam', 'src')
  const two = git(fx.home, fx.repo, 'rev-parse', 'HEAD')
  pt = pathTest(fx, base, two, ['THREAD.md'])
  assert.deepEqual([pt.inert, pt.nonInert], [['THREAD.md'], ['src/a.py']])
  pt = pathTest(fx, base, one, [])
  assert.deepEqual([pt.inert, pt.nonInert, pt.globs], [[], ['THREAD.md'], []])
})

test('path test: a rename from a source path into docs/handoffs/ counts at the path it left (--no-renames)', (t) => {
  const fx = fixture(t, { 'src/a.py': 'x = 1\n' })
  const base = git(fx.home, fx.repo, 'rev-parse', 'HEAD')
  git(fx.home, fx.repo, 'mv', 'src/a.py', 'docs/handoffs/a.md')
  git(fx.home, fx.repo, 'commit', '-qm', 'mv')
  const pt = pathTest(fx, base, git(fx.home, fx.repo, 'rev-parse', 'HEAD'), ['docs/handoffs/**'])
  assert.deepEqual([pt.inert, pt.nonInert], [['docs/handoffs/a.md'], ['src/a.py']])
})

test('path test: a non-prose file, a symlink or a deletion under a glob', (t) => {
  const fx = fixture(t)
  const base = git(fx.home, fx.repo, 'rev-parse', 'HEAD')
  write(fx.repo, { 'docs/handoffs/x.py': 'x = 1\n' })
  fs.symlinkSync('old.md', path.join(fx.repo, 'docs', 'handoffs', 'l.md'))
  git(fx.home, fx.repo, 'rm', '-q', 'docs/reviews/r.md')
  git(fx.home, fx.repo, 'add', '-A')
  git(fx.home, fx.repo, 'commit', '-qm', 'mixed')
  const pt = pathTest(fx, base, git(fx.home, fx.repo, 'rev-parse', 'HEAD'), ['docs/handoffs/**', 'docs/reviews/**'])
  assert.deepEqual([pt.inert, pt.nonInert.sort()], [['docs/reviews/r.md'], ['docs/handoffs/l.md', 'docs/handoffs/x.py']])
})

test('path test: a .txt is never inert (pytest collects test*.txt with no flag; a .txt is often data)', (t) => {
  const fx = fixture(t)
  const base = git(fx.home, fx.repo, 'rev-parse', 'HEAD')
  write(fx.repo, { 'docs/handoffs/test_notes.txt': '>>> 1 + 1\n3\n', 'docs/handoffs/n.md': 'a note\n', 'notes.txt': 'x\n' })
  git(fx.home, fx.repo, 'add', '-A')
  git(fx.home, fx.repo, 'commit', '-qm', 'txt')
  const pt = pathTest(fx, base, git(fx.home, fx.repo, 'rev-parse', 'HEAD'), ['docs/handoffs/**', '*.txt'])
  assert.deepEqual([pt.inert, pt.nonInert.sort()], [['docs/handoffs/n.md'], ['docs/handoffs/test_notes.txt', 'notes.txt']])
})

test('glob_match agrees with git on the glob forms', (t) => {
  const got = inProcess(tmpHome(t), `print(json.dumps([m.glob_match(g, p) for g, p in json.loads(sys.argv[2])]))`, {
    args: [JSON.stringify([['THREAD.md', 'THREAD.md'], ['THREAD.md', 'a/THREAD.md'], ['docs/handoffs/**', 'docs/handoffs/a.md'],
      ['docs/handoffs/**', 'docs/handoffs/x/y.md'], ['docs/handoffs/**', 'docs/handoffsx/a.md'], ['docs/*.md', 'docs/a.md'],
      ['docs/*.md', 'docs/x/a.md'], ['**/THREAD.md', 'THREAD.md'], ['**/THREAD.md', 'a/b/THREAD.md'], ['docs/**/x.md', 'docs/x.md']])],
  })
  assert.deepEqual(got, [true, false, true, true, false, true, false, true, true, true])
})

// ---- the proof: scope, unprovable, budget, submodule, symlink, tool, link ------------------------------------------------

test('a glob with no literal segment is unprovable; a clean repo proves THREAD.md and the doc globs', (t) => {
  const fx = fixture(t, { 'src/a.py': 'print(1)\n' })
  const res = prove(fx, ['THREAD.md', 'docs/handoffs/**', 'docs/reviews/**', '**', '*.md'])
  holds(res, 'THREAD.md'); holds(res, 'docs/handoffs/**'); holds(res, 'docs/reviews/**')
  fails(res, '**', { kind: 'unprovable' }); fails(res, '*.md', { kind: 'unprovable' })
})

test('past PROOF_BUDGET_S every glob is unprovable: proof budget exceeded', (t) => {
  const fx = fixture(t, { 'src/a.py': 'print(1)\n' })
  const out = inProcess(fx.home, 'm.PROOF_BUDGET_S = 0\nprint(json.dumps(m.prove(sys.argv[2], "HEAD", ["THREAD.md"], [("verifier", "true")])))',
    { args: [fx.repo] })
  fails(out, 'THREAD.md', { kind: 'unprovable', text: 'proof budget exceeded' })
})

// p34-2: the deadline is checked inside a file's work too (per logical shell line, per shell item, per view), so one
// big file cannot outrun it. The body counts calls to one module function and moves the clock past the deadline at the
// 50th: the proof must stop at that call (50, or 51 when the flip lands just after a check). Only the module-local
// clock `m._now` is patched: Tree's ls-tree and cat-file and _worktrees run before it flips, on the real clock, and
// stdlib time.monotonic (which _git's communicate(timeout=…) and subprocess read) is never touched. The exact verdict
// and the status-0 assert keep a ProofError (a git TimeoutExpired, say) from passing for the budget.
const DEADLINE_BODY = (fn) => [
  'n = 0',
  `real = m.${fn}`,
  'def counted(*a, **k):',
  '    global n',
  '    n += 1',
  '    return real(*a, **k)',
  `m.${fn} = counted`,
  'm._now = lambda: 0.0 if n < 50 else 1e12',
  'out = m.prove(sys.argv[2], "HEAD", ["THREAD.md"], [("verifier", "true")])',
  'print(json.dumps({"out": out, "n": n}))',
].join('\n')

const MANY_SH = "#!/bin/sh\n" + "find tests -name '*.py'\n".repeat(300)
const MANY_PY = 'import subprocess\n' + 'subprocess.run(["find", "tests", "-name", "*.py"])\n'.repeat(300)
const DEADLINE_CASES = [
  ['per logical line in a shell file (shell_items)', { 'tests/many.sh': MANY_SH }, 'shell_items'],
  ['per view of a shell file (_shell_walks)', { 'tests/many.sh': MANY_SH }, '_shell_walks'],
  ["per shell item of a Python file's argv lists (_shell_walks)", { 'tests/many.py': MANY_PY }, '_shell_walks'],
]

for (const [name, files, fn] of DEADLINE_CASES) {
  test(`the deadline is checked inside a file: ${name}`, (t) => {
    const fx = fixture(t, files)
    const got = inProcess(fx.home, DEADLINE_BODY(fn), { args: [fx.repo] })
    assert.equal(got.out['THREAD.md'].readersTotal, 1, JSON.stringify(got.out))
    assert.deepEqual(got.out['THREAD.md'].readers, [{ glob: 'THREAD.md', path: '-', kind: 'unprovable', text: 'proof budget exceeded' }])
    assert.ok(got.n >= 50 && got.n <= 51, `the proof stopped at the 50th ${fn} call, not the ${got.n}th`)
  })
}

test('a gitlink fails every glob; a symlink into a glob is a reader', (t) => {
  const fx = fixture(t)
  const head = git(fx.home, fx.repo, 'rev-parse', 'HEAD')
  git(fx.home, fx.repo, 'update-index', '--add', '--cacheinfo', `160000,${head},vendor/sub`)
  git(fx.home, fx.repo, 'commit', '-qm', 'sub')
  let res = prove(fx, ['THREAD.md', 'docs/handoffs/**'])
  fails(res, 'THREAD.md', { kind: 'submodule', path: 'vendor/sub' }); fails(res, 'docs/handoffs/**', { kind: 'submodule' })
  const fy = fixture(t, {}, { home: tmpHome(t) })
  fs.symlinkSync('THREAD.md', path.join(fy.repo, 'thread-link'))
  fs.symlinkSync('../docs', path.join(fy.repo, 'src-docs'))
  git(fy.home, fy.repo, 'add', '-A'); git(fy.home, fy.repo, 'commit', '-qm', 'links')
  res = prove(fy, ['THREAD.md', 'docs/handoffs/**', 'docs/reviews/**'])
  fails(res, 'THREAD.md', { kind: 'symlink', path: 'thread-link' })
  fails(res, 'docs/handoffs/**', { kind: 'symlink', path: 'src-docs' })
})

test('the tool rule: a named markdown tool or a tool config fails every glob; a remark in prose words holds', (t) => {
  let fx = fixture(t, { 'package.json': '{"scripts":{"test":"node --test","lint":"prettier --check \'**/*.md\'"}}\n' })
  let res = prove(fx, ['THREAD.md', 'docs/handoffs/**'], { verifier: 'npm test' })
  fails(res, 'THREAD.md', { kind: 'tool', path: 'package.json' }); fails(res, 'docs/handoffs/**', { kind: 'tool' })
  fx = fixture(t, { '.markdownlint.json': '{}\n' }, { home: tmpHome(t) })
  fails(prove(fx, ['THREAD.md']), 'THREAD.md', { kind: 'tool', path: '.markdownlint.json' })
  fx = fixture(t, { '.pre-commit-config.yaml': 'repos:\n  - repo: https://example.invalid/x\n    hooks:\n      - id: mdformat\n' }, { home: tmpHome(t) })
  fails(prove(fx, ['THREAD.md']), 'THREAD.md', { kind: 'tool', path: '.pre-commit-config.yaml' })
  fx = fixture(t, { 'src/a.py': '# a remark about it\nprint(1)\n' }, { home: tmpHome(t) })
  holds(prove(fx, ['THREAD.md']), 'THREAD.md')
})

// Whole-tree runners that read prose (round 2): each held before it joined TOOLS / TOOL_CONFIG_RE.
const TOOL_FAILS = [
  ['pre-commit run --all-files with the whitespace hooks (its config)', {
    '.pre-commit-config.yaml': 'repos:\n  - repo: https://github.com/pre-commit/pre-commit-hooks\n    rev: v4.6.0\n    hooks:\n' +
      '      - id: trailing-whitespace\n      - id: end-of-file-fixer\n',
  }, 'pre-commit run --all-files', '.pre-commit-config.yaml'],
  ['pytest with addopts --doctest-glob=*.md', { 'pyproject.toml': '[tool.pytest.ini_options]\naddopts = "--doctest-glob=*.md"\n' }, 'python3 -m pytest', 'pyproject.toml'],
  ['pytest --markdown-docs', {}, 'python3 -m pytest --markdown-docs', '<verifier>'],
  ['mktestdocs in a test', { 'tests/test_docs.py': 'from mktestdocs import check_md_file\n' }, 'python3 -m pytest', 'tests/test_docs.py'],
  ['phmdoctest', {}, 'phmdoctest README.md --outfile t.py && python3 -m pytest t.py', '<verifier>'],
]

for (const [name, files, verifier, where] of TOOL_FAILS) {
  test(`tool rule: ${name}`, (t) => {
    const res = prove(fixture(t, files), ['THREAD.md', 'docs/handoffs/**'], { verifier })
    fails(res, 'THREAD.md', { kind: 'tool', path: where }); fails(res, 'docs/handoffs/**', { kind: 'tool', path: where })
  })
}

// p47-14 (xi): a nested package that declares a tool and runs it only inside itself counts only under itself; git's hook
// slot (a quoted segment after `hooks`) is no tool. A git-root wrapper named anywhere in the tree (here the verifier)
// can run the package's tool from the git root, so it leaves the package unscoped.
test('tool rule: a nested package\'s declarations count only under it, unless a git-root wrapper runs anywhere; a hook path is no tool', (t) => {
  const fx = fixture(t, {
    'ext/package.json': '{"devDependencies":{"prettier":"^3"},"scripts":{"lint":"ray lint","build":"ray build -e dist"}}\n',
    'ext/package-lock.json': '{"packages":{"node_modules/prettier":{"version":"3.0.0"}}}\n',
    'tests/test_h.py': 'hook = root / ".git" / "hooks" / "pre-commit"\nHOOK = ".git/hooks/pre-commit"\n',
  }, { worktree: false })
  let res = prove(fx, ['THREAD.md', 'docs/handoffs/**', 'ext/notes/**'])
  holds(res, 'THREAD.md'); holds(res, 'docs/handoffs/**')
  fails(res, 'ext/notes/**', { kind: 'tool', path: 'ext/package.json' })
  fails(res, 'ext/notes/**', { kind: 'tool', path: 'ext/package-lock.json' })
  res = prove(fx, ['THREAD.md'], { verifier: 'cd ext && npx pretty-quick --check' })
  fails(res, 'THREAD.md', { kind: 'tool', path: 'ext/package.json' })
  fails(res, 'THREAD.md', { kind: 'tool', path: 'ext/package-lock.json' })
})

test('tool rule controls stay readers: a tool outside the dependency keys, pre-commit, the root package, a lock with no package, a quoted segment not after hooks, a directory under hooks', (t) => {
  const fx = fixture(t, {
    'x/package.json': '{"scripts":{"fmt":"prettier --check ."}}\n',
    'y/package.json': '{"devDependencies":{"pre-commit":"1"}}\n',
    'z/package.json': '{"devDependencies":{"prettier":"^3"},"prettier":{}}\n',
    'package.json': '{"devDependencies":{"prettier":"^3"}}\n',
    'vendor/yarn.lock': 'prettier@^3:\n  version "3.0.0"\n',
    'tests/b.py': 'from pathlib import Path\nROOT = Path(__file__).parent\nBIN = ROOT / "node_modules" / ".bin" / "prettier"\n',
    'tests/c.sh': 'bash tools/hooks/prettier/run.sh\n',
  }, { worktree: false })
  const res = prove(fx, ['THREAD.md'])
  for (const p of ['x/package.json', 'y/package.json', 'z/package.json', 'package.json', 'vendor/yarn.lock', 'tests/b.py', 'tests/c.sh']) {
    fails(res, 'THREAD.md', { kind: 'tool', path: p }, p)
  }
})

test('tool rule: each climb marker keeps a nested package unscoped', (t) => {
  const pkg = (script) => JSON.stringify({ devDependencies: { prettier: '^3' }, scripts: { fmt: script } }) + '\n'
  const MARKERS = {
    'm-dotdot': 'ray lint ../..', 'm-abs': 'ray lint /srv/app', 'm-home': 'ray lint ~/proj', 'm-dollar': 'ray lint $ROOT',
    'm-tick': 'ray lint `pwd`', 'm-git': 'git ls-files | xargs ray lint', 'm-initcwd': 'cd %INIT_CWD% && ray lint',
    'm-prefix': 'ray lint --prefix=x', 'm-cwd': 'ray lint --cwd x', 'm-dir': 'ray lint --dir x', 'm-root': 'ray lint --root x',
    'm-C': 'ray lint -C x', 'm-w': 'ray lint -w x', 'm-workspace': 'ray lint --workspace x', 'm-workspaces': 'ray lint --workspaces',
    'm-ws': 'ray lint -ws', 'm-iwr': 'ray lint --include-workspace-root',
  }
  const files = { 'm-base/package.json': pkg('ray lint'), 'm-bad/package.json': '{"devDependencies":{"prettier":"^3"',
    'm-dotdot/package-lock.json': '{"packages":{"node_modules/prettier":{"version":"3.0.0"}}}\n' }
  for (const [d, s] of Object.entries(MARKERS)) files[`${d}/package.json`] = pkg(s)
  const res = prove(fixture(t, files, { worktree: false }), ['THREAD.md', 'm-base/notes/**'])
  // prove() sorts readers by (path, line, kind) and returns only the first READERS_OUT, so an absence check over
  // `readers` is sound only when the list is whole
  assert.equal(res['THREAD.md'].readers.length, res['THREAD.md'].readersTotal, 'every reader is listed')
  fails(res, 'm-base/notes/**', { kind: 'tool', path: 'm-base/package.json' })
  assert.ok(!res['THREAD.md'].readers.some((r) => r.path === 'm-base/package.json'), 'the scoped baseline is no THREAD.md reader')
  for (const p of [...Object.keys(MARKERS), 'm-bad'].map((d) => `${d}/package.json`).concat('m-dotdot/package-lock.json')) {
    fails(res, 'THREAD.md', { kind: 'tool', path: p }, p)
  }
})

// Condition (4) reads the whole tree, so each name is one row in process over _wrapper_named (the end-to-end row is the
// verifier above).
test('tool rule: _wrapper_named finds each listed git-root wrapper, bounded by characters outside [A-Za-z0-9]', (t) => {
  const ROWS = [['"fmt": "pretty-quick --staged"', true], ['npx lint-staged', true], ['nano-staged', true], ['precise-commits', true],
    ['"git-format-staged": "1"', true], ['husky install', true], ['lefthook run fmt', true], ['"simple-git-hooks": {}', true],
    ['"yorkie": "2"', true], ['huskyx lefthooks', false]]
  const got = inProcess(tmpHome(t), ['from types import SimpleNamespace as F',
    'print(json.dumps([m._wrapper_named([F(text=x)], float("inf")) for x in json.loads(sys.argv[2])]))'].join('\n'),
  { args: [JSON.stringify(ROWS.map((r) => r[0]))] })
  assert.deepEqual(ROWS.map((r, i) => [r[0], got[i]]), ROWS)
})

test('the link rule: a literal ]( in a non-prose file fails every glob', (t) => {
  const fx = fixture(t, { 'src/links.py': 'LINK = "[a](b)"\n' })
  const res = prove(fx, ['THREAD.md', 'docs/handoffs/**'])
  fails(res, 'THREAD.md', { kind: 'link', path: 'src/links.py', line: 1 }); fails(res, 'docs/handoffs/**', { kind: 'link' })
})

// ---- the name rule -------------------------------------------------------------------------------------------------

test('the name rule: split-segment joins, an UPPER_CASE constant and a comment hit; prose never counts', (t) => {
  let fx = fixture(t, { 'tests/t.py': `${PY_HEAD}def f(n):\n    return REPO_ROOT / 'docs' / 'handoffs' / n\n` })
  fails(prove(fx, ['docs/handoffs/**']), 'docs/handoffs/**', { kind: 'name', path: 'tests/t.py' })
  fx = fixture(t, { 'tests/t.test.mjs': "import path from 'node:path'\nexport const p = (f) => path.join('docs','handoffs',f)\n" }, { home: tmpHome(t) })
  fails(prove(fx, ['docs/handoffs/**']), 'docs/handoffs/**', { kind: 'name', path: 'tests/t.test.mjs' })
  fx = fixture(t, { 'src/c.py': 'HANDOFFS_DIR = 1\n' }, { home: tmpHome(t) })
  fails(prove(fx, ['docs/handoffs/**']), 'docs/handoffs/**', { kind: 'name', path: 'src/c.py' })
  fx = fixture(t, { 'src/c.py': 'x = 1  # see thread.md\n' }, { home: tmpHome(t) })
  fails(prove(fx, ['THREAD.md']), 'THREAD.md', { kind: 'name', path: 'src/c.py', line: 1 })
  fx = fixture(t, { 'docs/notes.md': 'THREAD.md and docs/handoffs are named here\n', 'src/c.py': 'THREADS = 1\n' }, { home: tmpHome(t) })
  const res = prove(fx, ['THREAD.md', 'docs/handoffs/**'])
  holds(res, 'THREAD.md'); holds(res, 'docs/handoffs/**')
})

test('the name rule reads a .txt blob (a fixture list of paths a test opens): .txt is never prose', (t) => {
  const fx = fixture(t, { 'tests/fixtures/paths.txt': 'THREAD.md\nREADME.md\n' })
  fails(prove(fx, ['THREAD.md']), 'THREAD.md', { kind: 'name', path: 'tests/fixtures/paths.txt', line: 1 })
})

test("the name rule reads the steps; a glob's own non-prose file is scanned, and under docs/ its walk counts once something reaches it", (t) => {
  let fx = fixture(t)
  fails(prove(fx, ['THREAD.md'], { verifier: 'cat THREAD.md' }), 'THREAD.md', { kind: 'name', path: '<verifier>' })
  fails(prove(fx, ['THREAD.md'], { bootstrap: 'wc -l THREAD.md' }), 'THREAD.md', { kind: 'name', path: '<bootstrap>' })
  fx = fixture(t, { 'docs/reviews/check.py': "from pathlib import Path\nfor p in Path(__file__).parent.glob('*.md'):\n    print(p)\n" }, { home: tmpHome(t), worktree: false })
  // reached: the verifier names check.py (R2) and its directory (R4a); the step's own `reviews` is a name reader too
  let res = prove(fx, ['docs/reviews/**', 'THREAD.md'], { verifier: 'python3 docs/reviews/check.py' })
  fails(res, 'docs/reviews/**', { kind: 'walk', path: 'docs/reviews/check.py', origin: 'repo' })
  holds(res, 'THREAD.md')
  // unreached (narrowing x): nothing names, lists or runs it, so its walk is no reader
  res = prove(fx, ['docs/reviews/**', 'THREAD.md'])
  holds(res, 'docs/reviews/**'); holds(res, 'THREAD.md')
})

// ---- walks that count (fail THREAD.md, kind walk) ------------------------------------------------------------------------

const WALK_FAILS = [
  ['glob.glob(**/*.md) in a test (cwd)', { 'tests/t.py': "import glob\nfiles = glob.glob('**/*.md', recursive=True)\n" }, 'cwd'],
  ['Path().rglob (cwd)', { 'tests/t.py': "from pathlib import Path\nfiles = list(Path().rglob('*.md'))\n" }, 'cwd'],
  ['os.listdir() (cwd)', { 'tests/t.py': 'import os\nnames = os.listdir()\n' }, 'cwd'],
  ['os.walk(os.curdir) (cwd)', { 'tests/t.py': 'import os\nfor d, _, fs in os.walk(os.curdir):\n    pass\n' }, 'cwd'],
  ['an mjs fs.globSync (cwd)', { 'tests/t.test.mjs': "import fs from 'node:fs'\nconst files = fs.globSync('**/*.md')\n" }, 'cwd'],
  ['a helper passed by reference (open)', { 'tests/t.py': `${PY_HEAD}def md_files(root):\n    return root.rglob('*.md')\nlist(map(md_files, [REPO_ROOT]))\n` }, 'open'],
  ['a caller passing sys.argv[1] (input)', { 'tests/t.py': `${PY_HEAD}def md_files(root):\n    return Path(root).rglob('*.md')\nmd_files(sys.argv[1])\n` }, 'input'],
  ['a parameter with no caller (open)', { 'tests/t.py': `${PY_HEAD}def md_files(root):\n    return Path(root).rglob('*.md')\n` }, 'open'],
  ['rglob(f"{slug}.md"): a prose extension with a variable stem (repo)', { 'tests/t.py': `${PY_HEAD}def f(slug):\n    return list(REPO_ROOT.rglob(f"{slug}.md"))\nf("x")\n` }, 'repo'],
  ['subprocess git ls-files *.md in a test file (cwd)', { 'tests/t.py': "import subprocess\nsubprocess.run(['git', 'ls-files', '*.md'])\n" }, 'cwd'],
  ['a shell test walking the tree (cwd)', { 'tests/run.sh': "#!/bin/sh\ncd \"$(dirname \"$0\")/..\"\nfind . -name '*.md' | wc -l\n" }, 'cwd'],
  ['a Makefile recipe with a ** glob', { Makefile: "check:\n\tnpx some-linter '**/*.md'\n" }, 'cwd'],
  // round 2: a copy or archive of the repo is a walk of its source (a later walk of the copy is under TMP)
  ['cp -R of the repo into a temp dir, then a find over the copy (cwd)', { 'tests/t.sh': 'T=$(mktemp -d); cp -R . "$T/r"; find "$T/r" -name \'*.md\'\n' }, 'cwd'],
  ['rsync -a of the repo (cwd)', { 'tests/t.sh': 'T=$(mktemp -d)\nrsync -a --exclude .git . "$T/r"\n' }, 'cwd'],
  ['ditto of the repo (cwd)', { 'tests/t.sh': 'T=$(mktemp -d)\nditto . "$T/r"\n' }, 'cwd'],
  ['tar czf of the repo, the old option style (cwd)', { 'tests/t.sh': 'T=$(mktemp -d)\ntar czf "$T/x.tgz" .\n' }, 'cwd'],
  ['zip -qr of the repo with an -x pattern list (cwd)', { 'tests/t.sh': 'T=$(mktemp -d)\nzip -qr "$T/x.zip" . -x "*.git*"\n' }, 'cwd'],
  ['git clone of the repo (cwd)', { 'tests/t.sh': 'T=$(mktemp -d)\ngit clone -q . "$T/r"\n' }, 'cwd'],
  ['git archive -o into a temp dir (cwd)', { 'tests/t.sh': 'T=$(mktemp -d)\ngit archive -o "$T/x.tar" HEAD\n' }, 'cwd'],
  ['git worktree add into a temp dir (cwd)', { 'tests/t.sh': 'T=$(mktemp -d)\ngit worktree add -q "$T/w"\n' }, 'cwd'],
  ['TarFile.add of the cwd, the archive in a temp dir (cwd)', { 'tests/b.py': "import os, tarfile, tempfile\ntarfile.open(os.path.join(tempfile.mkdtemp(), 'x.tar'), 'w').add('.')\n" }, 'cwd'],
  ['ZipFile.write of argv names in a with block (input)', { 'tests/b.py': "import os, sys, tempfile, zipfile\nwith zipfile.ZipFile(os.path.join(tempfile.mkdtemp(), 'x.zip'), 'w') as z:\n    for name in sys.argv[1:]:\n        z.write(name)\n" }, 'input'],
  ['shutil.make_archive with no root_dir (cwd)', { 'tests/b.py': "import os, shutil, tempfile\nshutil.make_archive(os.path.join(tempfile.mkdtemp(), 'x'), 'gztar')\n" }, 'cwd'],
  ['shutil.make_archive of the repo root (repo)', { 'tests/b.py': `${PY_HEAD}import shutil\nshutil.make_archive(os.path.join(tempfile.mkdtemp(), 'x'), 'zip', root_dir=REPO_ROOT)\n` }, 'repo'],
  ['filecmp.dircmp of the cwd (cwd)', { 'tests/b.py': "import filecmp, tempfile\nfilecmp.dircmp('.', tempfile.mkdtemp()).report_full_closure()\n" }, 'cwd'],
  ['a Swift FileManager.copyItem of the cwd (cwd)', { 'tests/T.swift': 'import Foundation\ntry FileManager.default.copyItem(atPath: ".", toPath: "/tmp/x")\n' }, 'cwd'],
  // round 2: a command substitution is read as words of its own, and a bare `*` argument is a listing
  ['a $(find …) command substitution (cwd)', { 'tests/t.sh': '#!/bin/sh\nfor f in $(find . -name "*.md"); do echo "$f"; done\n' }, 'cwd'],
  ['a backquoted git ls-files (cwd)', { 'tests/t.sh': '#!/bin/sh\nx=`git ls-files`\necho "$x"\n' }, 'cwd'],
  ["a Makefile's $(shell find …) (cwd)", { Makefile: 'FILES := $(shell find . -name "*.md")\nall:\n\techo $(FILES)\n' }, 'cwd'],
  ["a Makefile's $(wildcard *.md) (cwd)", { Makefile: 'FILES := $(wildcard *.md)\nall:\n\techo $(FILES)\n' }, 'cwd'],
  ['a bare *.md glob argument in a shell test (cwd)', { 'tests/t.sh': '#!/bin/sh\ngrep -l TODO *.md\n' }, 'cwd'],
  ['a bare glob in a Python shell string after cat (cwd)', { 'tests/a.py': "import subprocess\nsubprocess.run('cat *.md | wc -l', shell=True)\n" }, 'cwd'],
  ['a bare glob in a JS execSync string after wc (cwd)', { 'tests/t.test.mjs': "import { execSync } from 'node:child_process'\nexecSync('wc -l *.md')\n" }, 'cwd'],
  ['a bare glob after a heredoc ends (cwd)', { 'tests/t.sh': '#!/bin/sh\ncat <<-EOF\n\tx\n\tEOF\ncat *.md\n' }, 'cwd'],
  ['a bare glob after a stray << that no delimiter closes (cwd)', { 'tests/t.sh': '#!/bin/sh\necho $((x<<y))\ncat *.md\n' }, 'cwd'],
  // p47-14 (ix): only a docstring is prose; the same text in any other string expression is still read as shell
  ['the same text in a non-docstring string expression (cwd)', { 'tests/a.py': 'x = 1\n"""find . -name \'*.md\'"""\n' }, 'cwd'],
]

for (const [name, files, origin] of WALK_FAILS) {
  test(`walk counts: ${name}`, (t) => {
    const fx = fixture(t, files)
    fails(prove(fx, ['THREAD.md']), 'THREAD.md', { kind: 'walk', origin })
  })
}

test('walk counts: the helper shape across files (repo), the reader at the helper', (t) => {
  const fx = fixture(t, {
    'tests/lib.py': 'def md_files(root):\n    return root.rglob("*.md")\n',
    'tests/test_x.py': `${PY_HEAD}from lib import md_files\n\ndef test_a():\n    assert list(md_files(REPO_ROOT))\n`,
  })
  fails(prove(fx, ['THREAD.md']), 'THREAD.md', { kind: 'walk', origin: 'repo', path: 'tests/lib.py', line: 2 })
})

test('walk counts: a step that walks the tree (cwd); a non-prose step walk does not cover', (t) => {
  const fx = fixture(t)
  fails(prove(fx, ['THREAD.md'], { verifier: "find . -name '*.md' | xargs wc -l" }), 'THREAD.md', { kind: 'walk', origin: 'cwd', path: '<verifier>' })
  holds(prove(fx, ['THREAD.md'], { verifier: "find tests -name '*.py' -exec python3 {} \\;" }), 'THREAD.md')
  fails(prove(fx, ['THREAD.md'], { verifier: 'cat *.md | wc -l' }), 'THREAD.md', { kind: 'walk', origin: 'cwd', path: '<verifier>' })
})

// ---- walks that hold -----------------------------------------------------------------------------------------------------

// p47-14 (x): walk bodies for the out-of-reach rows; each covers THREAD.md. GO's exec string must be a backquoted raw
// string: a double-quoted one is no walk the resolver reads (the REACH guard below pins every body).
const WALK_PY = "import glob\nglob.glob('*.md')\n"
const WALK_SH = "find . -name '*.md'\n"
const WALK_JS = "require('fs').globSync('*.md')\n"
const SWIFT = 'import Foundation\nlet xs = try FileManager.default.contentsOfDirectory(atPath: ".")\n'
const GO = 'package gopkg\n\nimport "os/exec"\n\nfunc Run() {\n\texec.Command("sh", "-c", `find . -name \'*.md\'`).Run()\n}\n'
const WALKER = "import os\nos.walk('.')\n"

// Unreached candidates (x): [name, files, the candidates holding a walk]. No reacher token, word or listing names any
// candidate (the collision rule: a red row is fixed by renaming, never by narrowing a rule).
const UNREACHED_HOLDS = [
  ["a glob's own non-prose file under docs/ that nothing reaches", { 'docs/reviews/check.py': WALK_PY }, ['docs/reviews/check.py']],
  ['walks in spike/, docs/ and scripts/**/probe* that nothing reaches', {
    'spike/walker.py': WALKER,
    'docs/tools/count.sh': WALK_SH,
    'scripts/stage/probe-tree.py': "import glob\nglob.glob('**/*.md', recursive=True)\n",
    'scripts/probe-kit/list.sh': 'find .\n',
    'spike/pkg/__init__.py': WALK_PY,
    'spike/cli/__main__.py': WALK_PY,
    'docs/tool/index.mjs': WALK_JS,
    'spike/kit/kitwalk.swift': SWIFT,
    'spike/gopkg/gowalk.go': GO,
    'spike/svc/gen.sh': WALK_SH,
    'spike/svc/package.json': '{"private": true}\n',
    'spike/runners/go.js': WALK_JS,
    // reachers: a *.csv-filtered listing, and words that are no repo root (an `a / b` operand, `//`, '/')
    'tests/t.py': "import glob\nglob.glob('**/*.csv', recursive=True)\nlhs, rhs = 6, 3\nratio = lhs / rhs\n# //\nfsroot = '/'\n",
    'tests/u.js': "// a comment\nconst r = '//'\n",
  }, ['spike/walker.py', 'docs/tools/count.sh', 'scripts/stage/probe-tree.py', 'scripts/probe-kit/list.sh', 'spike/pkg/__init__.py',
    'spike/cli/__main__.py', 'docs/tool/index.mjs', 'spike/kit/kitwalk.swift', 'spike/gopkg/gowalk.go', 'spike/svc/gen.sh', 'spike/runners/go.js']],
]

const WALK_HOLDS = [
  ['the helper called only with tempfile.mkdtemp()', { 'tests/t.py': `${PY_HEAD}def md_files(root):\n    return Path(root).rglob('*.md')\nmd_files(tempfile.mkdtemp())\n` }],
  ['the helper called only inside with TemporaryDirectory() as d', { 'tests/t.py': `${PY_HEAD}def md_files(root):\n    return Path(root).rglob('*.md')\nwith tempfile.TemporaryDirectory() as d:\n    md_files(d)\n` }],
  ['os.listdir of an absolute literal elsewhere', { 'tests/t.py': "import os\nnames = os.listdir('/nonexistent/dir')\n" }],
  ['a *.py filter', { 'tests/t.py': `${PY_HEAD}files = list(REPO_ROOT.rglob('*.py'))\n` }],
  ['an anchored walk over a literal disjoint dir', { 'tests/t.py': `${PY_HEAD}for d, _, fs in os.walk(REPO_ROOT / "tests"):\n    pass\n` }],
  ['a comment-only line', { 'tests/t.py': `${PY_HEAD}# os.walk(REPO_ROOT)\nprint(1)\n` }],
  ['a comprehension filtering a listing to .tmp', { 'tests/t.py': `${PY_HEAD}tmps = [n for n in os.listdir(REPO_ROOT) if n.endswith(".tmp")]\n` }],
  ['ast.walk (a module function, no Path method)', { 'tests/t.py': 'import ast\nfor n in ast.walk(ast.parse("x = 1")):\n    pass\n' }],
  ['case patterns, a [[ ]] test, arithmetic and a glob under a temp dir are no listing of the repo', {
    'tests/t.sh': '#!/bin/bash\ncase "$1" in\n  *.md) echo md ;;\n  *) echo other ;;\nesac\nif [[ $1 == *.md ]]; then echo y; fi\necho $((2*3))\nT=$(mktemp -d)\nrm -rf "$T"/*\n',
  }],
  ['markdown emphasis in a docstring and a heredoc body are no globs', {
    'tests/a.py': 'def f():\n    """A *closed* Session for **Question:** and **bold**.\n    on closed NOW **or** closed beneath."""\n    return 1\n',
    'tests/t.sh': '#!/bin/sh\nT=$(mktemp -d)\ncat > "$T/n.md" <<EOF\nsome **bold** text and * bullets\n- item *x*\nEOF\necho done\n',
  }],
  ['copies and archives that stay in a temp dir: tar -C, tar -x, a zip or cp with no -r, git -C on a temp repo, make_archive of a temp dir, set.add', {
    'tests/t.sh': 'T=$(mktemp -d)\ntar -C "$T" -czf "$T/x.tgz" .\ntar -xf "$T/x.tgz" -C "$T"\nzip "$T/x.zip" a.py\ncp a.py "$T"\n' +
      'git -C "$T" archive -o "$T/x.tar" HEAD\ngit worktree list\n',
    'tests/b.py': "import os, shutil, tempfile\nd = tempfile.mkdtemp()\nshutil.make_archive(os.path.join(d, 'x'), 'tar', root_dir=d)\nseen = set()\nseen.add('x')\n",
  }],
  ['an event-scanner shape: production _discover(pages_dir) from main on expanduser(args.vault), and a test on a TemporaryDirectory', {
    'board.py': 'import argparse, os\n\ndef _discover(pages_dir):\n    return sorted(os.listdir(pages_dir))\n\n' +
      'def main():\n    ap = argparse.ArgumentParser()\n    ap.add_argument("--vault")\n    args = ap.parse_args()\n' +
      '    pages_dir = os.path.join(os.path.expanduser(args.vault), "Attachments", "Pages")\n    return _discover(pages_dir)\n',
    'tests/test_board.py': 'import tempfile\nfrom board import _discover\n\ndef test_it():\n    with tempfile.TemporaryDirectory() as d:\n        assert _discover(d) == []\n',
  }],
  // p47-14 (ix): a module, class, def and async def docstring is prose, never read as shell
  ['find in module, class, def and async def docstrings', {
    'tests/a.py': `"""find . -name '*.md'"""\nclass C:\n    """find . -name '*.md'"""\n\ndef f():\n    """find . -name '*.md'"""\n\nasync def g():\n    """find . -name '*.md'"""\n`,
  }, { worktree: false }],
  ...UNREACHED_HOLDS.map(([name, files]) => [name, files, { worktree: false }]),
]

for (const [name, files, opts] of WALK_HOLDS) {
  test(`walk holds: ${name}`, (t) => {
    holds(prove(fixture(t, files, opts), ['THREAD.md']), 'THREAD.md')
  })
}

// ---- out of reach (p47-14, narrowing x) -----------------------------------------------------------------------------------

test("out of reach: an unreached candidate's name and link hits still count", (t) => {
  const res = prove(fixture(t, { 'spike/n.py': "open('THREAD.md')\n", 'spike/l.py': 'L = "[a](b)"\n' }, { worktree: false }), ['THREAD.md'])
  fails(res, 'THREAD.md', { kind: 'name', path: 'spike/n.py' })
  fails(res, 'THREAD.md', { kind: 'link', path: 'spike/l.py' })
})

// [name, files, verifier, the candidates whose walk must stay a reader, symlinks {path: target | (fx) => target}]. Each row
// reaches its candidates by its named rule only, so each row fails when its rule is deleted. Two rows name two rules and
// fail only when both are deleted: "a relative symlink to the root" and "R5 and R6: a for loop over a glob".
const REACH = [
  ['R1: a test-shaped name, a .t file', { 'spike/test_walk.py': WALK_PY, 'spike/check.t': WALK_SH }, 'true', ['spike/test_walk.py', 'spike/check.t']],
  ['R2: a stem imported', { 'docs/probes/echo_frames.py': WALK_PY, 'tests/test_echo.py': 'from echo_frames import frames\n' }, 'true', ['docs/probes/echo_frames.py']],
  ['R2: a basename run', { 'scripts/probe-fork.py': WALK_PY, 'tests/test_fork.py': "import subprocess, sys\nsubprocess.run([sys.executable, 'scripts/probe-fork.py'])\n" }, 'true', ['scripts/probe-fork.py']],
  ['a fixpoint: a reached candidate reaches another', {
    'spike/second.py': WALK_PY, 'spike/first.py': 'import second\n', 'tests/test_chain.py': "import runpy\nrunpy.run_path('spike/first.py')\n",
  }, 'true', ['spike/second.py']],
  ['a step names it', { 'scripts/probe-z.sh': WALK_SH }, 'bash scripts/probe-z.sh', ['scripts/probe-z.sh']],
  ['a relative symlink to the root (the symlink rule and R4c)', { 'spike/walker.py': WALKER }, 'true', ['spike/walker.py'], { 'tests/root': '..' }],
  ['an absolute symlink to the repo: the resolved symlink rule alone', { 'spike/walker.py': WALKER }, 'true', ['spike/walker.py'], { 'tests/root': (fx) => fx.repo }],
  ['not in scope: src/spike and scripts/ without probe', { 'src/spike/w.py': WALK_PY, 'scripts/tools/w.sh': WALK_SH }, 'true', ['src/spike/w.py', 'scripts/tools/w.sh']],
  ['R4a: entry points by directory (import pkg, python -m spike.cli, require of a directory)', {
    'spike/pkg/__init__.py': WALK_PY, 'tests/test_p.py': 'import pkg\n',
    'spike/cli/__main__.py': WALK_PY, 'tests/run.sh': 'python3 -m spike.cli\n',
    'docs/tool/index.mjs': WALK_JS, 'tests/t.test.cjs': "require('../docs/tool')\n",
  }, 'true', ['spike/pkg/__init__.py', 'spike/cli/__main__.py', 'docs/tool/index.mjs']],
  ['R4a: a runner pointed at a directory', { 'spike/runners/go.js': WALK_JS }, 'mocha spike/runners', ['spike/runners/go.js']],
  ['R4b: a runner pointed at the top segment in a step', { 'spike/hello.js': WALK_JS }, 'mocha spike', ['spike/hello.js']],
  ['R4b: the top segment in code', {
    'docs/check.js': WALK_JS,
    'tests/t.py': "import subprocess\nfrom pathlib import Path\nREPO = Path(__file__).resolve().parent.parent\nsubprocess.run(['tap', REPO / 'docs'])\n",
  }, 'true', ['docs/check.js']],
  ['R4c: the repo root', { 'spike/rooted.js': WALK_JS }, 'mocha --recursive .', ['spike/rooted.js']],
  ['R3: a reached manifest reaches its directory', {
    'spike/svc/gen.sh': WALK_SH, 'spike/svc/package.json': '{"private": true}\n', 'tests/t.sh': 'jq .private package.json\n',
  }, 'true', ['spike/svc/gen.sh']],
  ['R3: a reached module reaches its ancestor __init__.py', { 'spike/a1/__init__.py': WALK_PY, 'spike/a1/b1/test_c.py': 'def test_x():\n    pass\n' }, 'true', ['spike/a1/__init__.py']],
  ['R4d: Swift siblings', { 'spike/kit/kitwalk.swift': SWIFT, 'spike/kit/KitTests.swift': 'import XCTest\nfinal class T: XCTestCase {}\n' }, 'true', ['spike/kit/kitwalk.swift']],
  ['R4d: Go ./...', { 'spike/gopkg/gowalk.go': GO }, 'go vet ./...', ['spike/gopkg/gowalk.go']],
  ['R5: a repo walk that runs what it lists', {
    'docs/runners/stepper.sh': WALK_SH,
    'tests/test_all.py': 'import os, subprocess\nfrom pathlib import Path\nROOT = Path(__file__).resolve().parents[1]\n' +
      "for d, _, names in os.walk(ROOT):\n    for n in names:\n        subprocess.run(['bash', os.path.join(d, n)])\n",
  }, 'true', ['docs/runners/stepper.sh']],
  ['R5 and R6: a for loop over a glob', { 'scripts/probe-y.sh': WALK_SH, 'tests/run_probes.sh': 'for p in scripts/probe-*.sh; do bash "$p"; done\n' }, 'true', ['scripts/probe-y.sh']],
  ['R6: glob text the walk rule does not read', { 'docs/run-a.sh': WALK_SH, 'package.json': '{"scripts": {"probes": "bash docs/run-*.sh"}}\n' }, 'true', ['docs/run-a.sh']],
  ['R6: a templated path whose variable segment reads as *', { 'spike/walker.sh': WALK_SH, 'tests/run.sh': 'bash "$ROOT/spike/$PROBE.sh"\n' }, 'true', ['spike/walker.sh']],
  ['R6: glob text that climbs', {
    'docs/run-b.sh': WALK_SH, 'tools/package.json': '{"scripts": {"probes": "bash ../docs/run-*.sh"}}\n',
    'spike/climb.sh': WALK_SH, 'tests/t.py': 'import os, subprocess\nHERE = os.path.dirname(__file__)\nsubprocess.run(f"run-all {HERE}/../spike/*.sh", shell=True)\n',
  }, 'true', ['docs/run-b.sh', 'spike/climb.sh']],
  // the off switch end to end; its other selectors are the in-process table below
  ["the off switch: an unreached candidate's own pytest config", { 'spike/walker.py': WALKER, 'spike/cfg/tox.ini': '[pytest]\npython_files = check_*.py\n' }, 'true', ['spike/walker.py']],
]

for (const [name, files, verifier, paths, links] of REACH) {
  test(`out of reach, reached: ${name}`, (t) => {
    const fx = fixture(t, files, { worktree: false })
    if (links) {
      for (const [p, target] of Object.entries(links)) {
        fs.mkdirSync(path.dirname(path.join(fx.repo, p)), { recursive: true })
        fs.symlinkSync(typeof target === 'function' ? target(fx) : target, path.join(fx.repo, p))
      }
      git(fx.home, fx.repo, 'add', '-A'); git(fx.home, fx.repo, 'commit', '-qm', 'links')
    }
    const res = prove(fx, ['THREAD.md'], { verifier })
    for (const p of paths) fails(res, 'THREAD.md', { kind: 'walk', path: p }, `${name}: ${p}`)
  })
}

// A REACH row that goes red has lost reach only if its walk form is read where nothing narrows it: one copy of every
// asserted or held candidate body under ctl/ (no candidate there), each a walk reader. A row whose walk form the resolver
// misses fails here by name instead.
test('REACH guard: every asserted walk form is read where nothing narrows it', (t) => {
  const copies = new Map()
  const rows = [...REACH.map(([name, files, , paths]) => [name, files, paths]), ...UNREACHED_HOLDS]
  for (const [name, files, paths] of rows) {
    for (const p of paths) {
      const key = `${path.basename(p)}\0${files[p]}`
      if (!copies.has(key)) copies.set(key, { at: `ctl/${copies.size}/${path.basename(p)}`, body: files[p], name })
    }
  }
  const res = prove(fixture(t, Object.fromEntries([...copies.values()].map((c) => [c.at, c.body])), { worktree: false }), ['THREAD.md'])
  assert.equal(res['THREAD.md'].readers.length, res['THREAD.md'].readersTotal, 'every reader is listed')
  for (const c of copies.values()) fails(res, 'THREAD.md', { kind: 'walk', path: c.at }, `${c.name}: ${c.at}`)
})

// The off switch's selectors, in process over _off_switch (one end-to-end row is the REACH row above): each runner
// collection selector fires it, and an include outside a runner config or a package.json files key does not.
test('the off switch: each collection selector fires it; a tsconfig include and a package.json files key do not', (t) => {
  const ROWS = [
    ['vitest.config.ts', "export default { test: { include: ['spike/**/*.ts'] } }\n", true],
    ['package.json', '{"jest": {"roots": ["<rootDir>/tests"]}}\n', true],
    ['.mocharc.yml', "spec: 'spike/**/*.cjs'\n", true],
    ['tests/run.sh', "python3 -m unittest discover -s tests -p 'check_*.py'\n", true],
    ['tests/run.sh', 'pytest --nbmake tests/notebooks\n', true],
    ['.mocharc.json', '{"extension": ["cjs"]}\n', true],
    ['tsconfig.json', '{"include": ["spike/**/*.ts"]}\n', false],
    ['package.json', '{"files": ["dist"]}\n', false],
  ]
  const got = inProcess(tmpHome(t), ['from types import SimpleNamespace as F',
    'print(json.dumps([m._off_switch(F(step=False, path=p, text=x)) for p, x in json.loads(sys.argv[2])]))'].join('\n'),
  { args: [JSON.stringify(ROWS.map(([p, x]) => [p, x]))] })
  assert.deepEqual(ROWS.map(([p, x], i) => [p, x, got[i]]), ROWS)
})

// ---- brace filters (p34-2): BRACE_CAP during expansion, and a truncated filter fails closed --------------------------------

const GROUPS70 = '{a,b}'.repeat(70)

test('_brace of a 70-group filter returns at once', (t) => {
  // The alarm ends a _brace that never returns (2^70 before the fix), so this test goes red instead of hanging.
  const got = inProcess(tmpHome(t), [
    'import signal, time', 'signal.alarm(10)', 't0 = time.monotonic()',
    'pats, truncated = m._brace(sys.argv[2])',
    'print(json.dumps({"n": len(pats), "truncated": truncated, "s": time.monotonic() - t0, "first": pats[0]}))',
  ].join('\n'), { args: [GROUPS70 + '*.md'] })
  assert.equal(got.n, 64)
  assert.equal(got.truncated, true)
  assert.equal(got.first, 'a'.repeat(70) + '*.md')
  assert.ok(got.s < 1, `_brace took ${got.s} s`)
})

test("_brace keeps the first 64 of the full expansion, in the recursive expander's order (bash's for flat groups), and says when it dropped any", (t) => {
  const many = (n) => '{' + Array.from({ length: n }, (_, i) => `y${i}`).join(',') + '}.md'
  const pats = ['x{a,b}{c,d}{e,f}', '{a,{b,c}}', '{a}', '{}', 'a{b,c', '{a,b}'.repeat(6), '{a,b}'.repeat(7), many(65), many(64)]
  // An uncapped copy of the recursive expander _brace replaced: the reference order. It is bash's for flat groups only:
  // nested '{a,{b,c}}' gives a, b, a, c (bash: a, b, c), and '{a}' and '{}' expand (bash keeps them literal).
  const got = inProcess(tmpHome(t), [
    'import re',
    'def ref(pat):',
    '    g = re.search(r"\\{([^{}]*)\\}", pat)',
    '    if not g:',
    '        return [pat]',
    '    out = []',
    '    for alt in g.group(1).split(","):',
    '        out.extend(ref(pat[:g.start()] + alt + pat[g.end():]))',
    '    return out',
    'res = []',
    'for p in json.loads(sys.argv[2]):',
    '    want = ref(p)',
    '    pats, truncated = m._brace(p)',
    '    res.append({"same": pats == want[:64], "truncated": truncated, "over": len(want) > 64, "n": len(pats), "pats": pats[:4]})',
    'print(json.dumps(res))',
  ].join('\n'), { args: [JSON.stringify(pats)] })
  got.forEach((r, i) => {
    assert.ok(r.same, `${pats[i]}: the first 64 of the full expansion`)
    assert.equal(r.truncated, r.over, `${pats[i]}: truncated only when something was dropped`)
  })
  assert.deepEqual(got.map((r) => r.n), [8, 4, 1, 1, 1, 64, 64, 64, 64])
  assert.deepEqual(got.map((r) => r.truncated), [false, false, false, false, false, false, true, true, false])
  assert.deepEqual(got[0].pats, ['xace', 'xacf', 'xade', 'xadf'])
  assert.deepEqual(got[1].pats, ['a', 'b', 'a', 'c'])
  assert.deepEqual([got[2].pats, got[3].pats, got[4].pats], [['a'], [''], ['a{b,c']])
})

test('_brace with stop_at_cut returns at the first cut with the same verdict, and _filter_ok uses it', (t) => {
  const pats = ['x{a,b}{c,d}{e,f}', '{a,{b,c}}', '{a}', 'a{b,c', '{a,b}'.repeat(6), '{a,b}'.repeat(7), '{a,b}'.repeat(4000) + '.md']
  const got = inProcess(tmpHome(t), [
    'res, br = [], m._BRACE_RE.search',
    'for p in json.loads(sys.argv[2]):',
    '    full, cut = m._brace(p), m._brace(p, stop_at_cut=True)',
    '    res.append({"truncated": [full[1], cut[1]], "same": full[0] == cut[0], "n": len(cut[0]),',
    '                "braces": [any(br(q) for q in full[0]), any(br(q) for q in cut[0])]})',
    'calls, orig = [], m._brace',
    'def spy(pat, stop_at_cut=False):',
    '    calls.append(stop_at_cut)',
    '    return orig(pat, stop_at_cut)',
    'm._brace = spy',
    'ok = m._filter_ok([("glob", "{a,b}" * 4000 + ".md")], "THREAD.md")',
    'print(json.dumps({"res": res, "ok": ok, "calls": calls}))',
  ].join('\n'), { args: [JSON.stringify(pats)] })
  got.res.forEach((r, i) => {
    assert.equal(r.truncated[1], r.truncated[0], `${pats[i].slice(0, 40)}: the same verdict`)
    if (!r.truncated[0]) assert.ok(r.same, `${pats[i]}: an untruncated result is the same either way`)
  })
  assert.deepEqual(got.res.map((r) => r.truncated[0]), [false, false, false, false, false, true, true])
  // The 4000-group filter: the full call expands every group, stop_at_cut leaves the rest unexpanded after the cut.
  assert.equal(got.res[6].n, 64)
  assert.deepEqual(got.res[6].braces, [false, true])
  // _filter_ok fails closed on the cut, through stop_at_cut.
  assert.deepEqual([got.ok, got.calls], [true, [true]])
})

test('a brace filter past the cap fails closed: its 65th alternative is a missed reader', (t) => {
  const alts = (n) => Array.from({ length: n }, (_, i) => `x${i}`).join(',')
  // (a) THREAD is alternative #65, one past the cap: before p34-2 the cut dropped it and THREAD.md held, a missed reader.
  let fx = fixture(t, { 'tests/t.sh': `#!/bin/sh\nfind . -name '{${alts(64)},THREAD}.md'\n` })
  fails(prove(fx, ['THREAD.md']), 'THREAD.md', { kind: 'walk', origin: 'cwd', path: 'tests/t.sh' }, '#65 past the cap')
  // (b) truncation alone makes the filter able to match: none of its 256 alternatives is THREAD.md.
  fx = fixture(t, { 'tests/t.sh': `#!/bin/sh\nfind . -name '${'{a,b}'.repeat(7)}{x,THREAD}.md'\n` }, { home: tmpHome(t) })
  fails(prove(fx, ['THREAD.md']), 'THREAD.md', { kind: 'walk', origin: 'cwd', path: 'tests/t.sh' }, 'truncated, no THREAD.md')
  // (c) control: THREAD is alternative #64, inside the cap, so it is matched (before p34-2 too).
  fx = fixture(t, { 'tests/t.sh': `#!/bin/sh\nfind . -name '{${alts(63)},THREAD}.md'\n` }, { home: tmpHome(t) })
  fails(prove(fx, ['THREAD.md']), 'THREAD.md', { kind: 'walk', origin: 'cwd', path: 'tests/t.sh' }, '#64 inside the cap')
  // (d) negative control for (b): exactly 64 alternatives, none THREAD.md, not truncated, so the filter cannot match and
  // THREAD.md holds. A brace filter is not a reader merely for having braces.
  fx = fixture(t, { 'tests/t.sh': `#!/bin/sh\nfind . -name '${'{a,b}'.repeat(6)}.md'\n` }, { home: tmpHome(t) })
  let res = prove(fx, ['THREAD.md'])
  holds(res, 'THREAD.md', '64 alternatives, none THREAD.md')
  assert.equal(res['THREAD.md'].readersTotal, 0)
  // (e) the same filter with one more group: 128 alternatives, truncated, none THREAD.md. The cap is the only difference
  // from (d), and it alone makes the walk a reader.
  fx = fixture(t, { 'tests/t.sh': `#!/bin/sh\nfind . -name '${'{a,b}'.repeat(7)}.md'\n` }, { home: tmpHome(t) })
  res = prove(fx, ['THREAD.md'])
  fails(res, 'THREAD.md', { kind: 'walk', origin: 'cwd', path: 'tests/t.sh' }, '128 alternatives, truncated, none THREAD.md')
  assert.equal(res['THREAD.md'].readersTotal, 1)
})

test('a 70-group brace filter in a repo file: prove returns and the walk is a reader', (t) => {
  const fx = fixture(t, { 'tests/t.sh': `#!/bin/sh\nfind . -name '${GROUPS70}*.md'\n` })
  // Before p34-2 this proof never returned: the 30 s kill turns that into a red test, not a hang.
  const r = cli(fx.home, ['prove', '--repo', fx.repo, '--tree', 'HEAD', '--verifier', 'true', '--glob', 'THREAD.md'], { timeout: 30000 })
  assert.equal(r.signal, null, 'the proof returned')
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.stderr, '')
  fails(JSON.parse(r.stdout).globs, 'THREAD.md', { kind: 'walk', origin: 'cwd', path: 'tests/t.sh' })
})

// ---- ancestors of the repo (round 3): every absolute value is compared with the places ----------------------------------

test('ancestors: HOME, ~/repos (direct and through a name), <HOME>/repos in both spellings, the temp dir and a climb above the root fail THREAD.md (path)', (t) => {
  const home = tmpHome(t)
  const real = fs.realpathSync(home)
  const cases = {
    'tests/a.py': 'import os\nfrom pathlib import Path\nfor x in os.walk(Path.home()):\n    pass\n',
    'tests/b.py': "import os\nfor x in os.walk(os.path.expanduser('~/repos')):\n    pass\n",
    'tests/c.py': "import os\nROOT = '~/repos'\nfor x in os.walk(os.path.expanduser(ROOT)):\n    pass\n",
    'tests/d.py': `import os\nfor x in os.walk(${JSON.stringify(path.join(home, 'repos'))}):\n    pass\n`,
    'tests/e.py': `import os\nfor x in os.walk(${JSON.stringify(path.join(real, 'repos'))}):\n    pass\n`,
    'tests/f.py': 'import os, tempfile\nfor x in os.walk(tempfile.gettempdir()):\n    pass\n',
    'tests/g.py': 'import os\nfrom pathlib import Path\nfor x in os.walk(Path(__file__).resolve().parents[2]):\n    pass\n',
    'tests/h.py': `import os\nfor x in os.walk(${JSON.stringify(path.join(home, 'wt'))}):\n    pass\n`,
  }
  for (const [file, body] of Object.entries(cases)) {
    const fx = fixture(t, { [file]: body }, { home: fs.mkdtempSync(path.join(home, 'h-')) })
    // each case its own HOME under the first, so <HOME>/repos and <HOME>/wt are this fixture's
    const fxHome = fx.home
    const fixed = body.replaceAll(path.join(home, 'repos'), path.join(fxHome, 'repos')).replaceAll(path.join(real, 'repos'), path.join(fs.realpathSync(fxHome), 'repos'))
      .replaceAll(path.join(home, 'wt'), path.join(fxHome, 'wt'))
    write(fx.repo, { [file]: fixed })
    git(fxHome, fx.repo, 'commit', '-q', '--allow-empty', '-am', 'fix paths')
    fails(prove(fx, ['THREAD.md']), 'THREAD.md', { kind: 'walk', origin: 'path', path: file }, file)
  }
})

test('ancestors with a directory glob: inside the repo, and a HOME prefix inside the repo with a TMP-only name', (t) => {
  let fx = fixture(t)
  write(fx.repo, { 'tests/a.py': `import os\nfor x in os.walk(${JSON.stringify(path.join(fx.repo, 'docs'))}):\n    pass\n` })
  git(fx.home, fx.repo, 'add', '-A'); git(fx.home, fx.repo, 'commit', '-qm', 'a')
  fails(prove(fx, ['docs/handoffs/**']), 'docs/handoffs/**', { kind: 'walk', origin: 'path' })
  fx = fixture(t, { 'tests/b.py': "import os, tempfile\nfrom pathlib import Path\ndef scan(name):\n    return os.listdir(Path.home() / 'repos' / 'fx' / name)\nscan(tempfile.mkdtemp())\n" }, { home: tmpHome(t) })
  fails(prove(fx, ['docs/handoffs/**']), 'docs/handoffs/**', { kind: 'walk', origin: 'path' })
})

test('ancestor controls hold: a disjoint HOME literal, HOME-open, a missing absolute dir, a fresh temp dir; a non-literal later part counts (input)', (t) => {
  const fx = fixture(t, {
    'tests/a.py': "import os\nfor x in os.walk(os.path.expanduser('~/elsewhere')):\n    pass\n",
    'tests/b.py': "import argparse, os\nargs = argparse.ArgumentParser().parse_args()\nfor x in os.walk(os.path.join(os.path.expanduser(args.vault), 'P')):\n    pass\n",
    'tests/c.py': "import os\nfor x in os.walk('/nonexistent/dir'):\n    pass\n",
    'tests/d.py': 'import os, tempfile\nfor x in os.walk(tempfile.mkdtemp()):\n    pass\n',
  })
  holds(prove(fx, ['THREAD.md']), 'THREAD.md')
  const fy = fixture(t, { 'tests/e.py': "import argparse, os\nargs = argparse.ArgumentParser().parse_args()\nfor x in os.walk(os.path.join(os.path.expanduser(args.vault), args.sub)):\n    pass\n" }, { home: tmpHome(t) })
  fails(prove(fy, ['THREAD.md']), 'THREAD.md', { kind: 'walk', origin: 'input', path: 'tests/e.py' })
})

// ---- argument binding (round 3) -------------------------------------------------------------------------------------------

const BINDING_FAILS = [
  ['an omitted argument adds its default (repo)', { 'tests/t.py': `${PY_HEAD}def md_files(root=REPO_ROOT):\n    return root.rglob('*.md')\nmd_files()\nmd_files(tempfile.mkdtemp())\n` }, 'repo'],
  ['a JS default for an omitted argument (repo)', {
    'tests/t.test.mjs': "import fs from 'node:fs'\nimport path from 'node:path'\nimport os from 'node:os'\nconst ROOT = path.resolve(import.meta.dirname, '..')\n" +
      'function mdFiles(root = ROOT) { return fs.readdirSync(root) }\nmdFiles()\nmdFiles(fs.mkdtempSync(path.join(os.tmpdir(), "x-")))\n',
  }, 'repo'],
  ['an omitted argument with no default (open)', { 'tests/t.py': `${PY_HEAD}def scan(scratch, root):\n    return os.listdir(root)\nscan(tempfile.mkdtemp())\n` }, 'open'],
  ['a None-only default: an empty set reads open', { 'tests/t.py': `${PY_HEAD}def f(root=None):\n    return os.walk(root)\nf()\n` }, 'open'],
  ['os.listdir(None) from a None default lists the cwd (cwd)', { 'tests/a.py': `${PY_HEAD}def scan(root=None):\n    return os.listdir(root)\nscan(tempfile.mkdtemp())\nscan()\n` }, 'cwd'],
  ['os.scandir(None) from a None default lists the cwd (cwd)', { 'tests/a.py': `${PY_HEAD}def scan(root=None):\n    return list(os.scandir(root))\nscan(tempfile.mkdtemp())\nscan()\n` }, 'cwd'],
  ["glob's root_dir=None is the cwd (cwd)", { 'tests/a.py': `${PY_HEAD}def md(root=None):\n    return glob.glob('*.md', root_dir=root)\nmd(tempfile.mkdtemp())\nmd()\n` }, 'cwd'],
  ['a JS glob with cwd: undefined is the cwd (cwd)', {
    'tests/t.test.mjs': "import fs from 'node:fs'\nfunction md(dir = undefined) { return fs.globSync('*.md', { cwd: dir }) }\nmd(fs.mkdtempSync('/tmp/x-'))\nmd()\n",
  }, 'cwd'],
  ['a method call skips self (repo; an unshifted alignment would read open)', { 'tests/t.py': `${PY_HEAD}class Scan:\n    def md(self, scratch, root):\n        return root.rglob('*.md')\nScan().md(tempfile.mkdtemp(), REPO_ROOT)\n` }, 'repo'],
  ['a constructor call binds __init__ and self.root reads it (repo)', { 'tests/t.py': `${PY_HEAD}class Docs:\n    def __init__(self, root):\n        self.root = root\n    def files(self):\n        return self.root.rglob('*.md')\nDocs(REPO_ROOT).files()\n` }, 'repo'],
  ['an unbound @staticmethod call (repo)', { 'tests/t.py': `${PY_HEAD}class Scan:\n    @staticmethod\n    def md(root):\n        return root.rglob('*.md')\nScan.md(REPO_ROOT)\n` }, 'repo'],
  ['a *args spread beside a TMP call (open)', { 'tests/t.py': `${PY_HEAD}def md_files(root):\n    return Path(root).rglob('*.md')\nroots = [tempfile.mkdtemp()]\nmd_files(*roots)\nmd_files(tempfile.mkdtemp())\n` }, 'open'],
  ['a **kwargs spread beside a TMP call (open)', { 'tests/t.py': `${PY_HEAD}def md_files(root):\n    return Path(root).rglob('*.md')\nkw = {}\nmd_files(**kw)\nmd_files(tempfile.mkdtemp())\n` }, 'open'],
  ['a JS ...spread beside a TMP call (open)', {
    'tests/t.test.mjs': "import fs from 'node:fs'\nfunction mdFiles(root) { return fs.readdirSync(root) }\nconst roots = []\nmdFiles(...roots)\nmdFiles(fs.mkdtempSync('/tmp/x-'))\n",
  }, 'open'],
  ['functools.partial (open)', { 'tests/t.py': `${PY_HEAD}def md_files(root):\n    return Path(root).rglob('*.md')\ng = functools.partial(md_files, REPO_ROOT)\n` }, 'open'],
  ['a fixture name with a call site is chased (repo)', { 'tests/t.py': `${PY_HEAD}def scan(tmpdir):\n    return os.walk(tmpdir)\nscan(REPO_ROOT)\n` }, 'repo'],
  ['a subclass binding self.root read by a base-class walk (repo)', { 'tests/t.py': `${PY_HEAD}class Base:\n    def files(self):\n        return list(self.root.rglob('*.md'))\nclass Docs(Base):\n    def __init__(self):\n        self.root = REPO_ROOT\nDocs().files()\n` }, 'repo'],
  ['a tmp_path fixture override reads open', {
    'tests/conftest.py': `${PY_HEAD}def tmp_path():\n    return REPO_ROOT\n`,
    'tests/test_t.py': "def test_x(tmp_path):\n    assert not list(tmp_path.rglob('*.md'))\n",
  }, 'open'],
]

for (const [name, files, origin] of BINDING_FAILS) {
  test(`binding fails: ${name}`, (t) => {
    fails(prove(fixture(t, files), ['THREAD.md']), 'THREAD.md', { kind: 'walk', origin })
  })
}

const BINDING_HOLDS = [
  ['a constructor called only with a temp dir', { 'tests/t.py': `${PY_HEAD}class Docs:\n    def __init__(self, root):\n        self.root = root\n    def files(self):\n        return Path(self.root).rglob('*.md')\nDocs(tempfile.mkdtemp()).files()\n` }],
  ['a keyword argument only with a temp dir (the default unused)', { 'tests/t.py': `${PY_HEAD}def md_files(root=REPO_ROOT):\n    return Path(root).rglob('*.md')\nmd_files(root=tempfile.mkdtemp())\n` }],
  ['a pytest tmp_path with no call site', { 'tests/test_t.py': "def test_x(tmp_path):\n    assert not list(tmp_path.rglob('*.md'))\n" }],
  ['a base class setUp binding self.tmp to a temp dir, read in a subclass', { 'tests/test_t.py': `${PY_HEAD}import unittest\nclass Base(unittest.TestCase):\n    def setUp(self):\n        self.tmp = tempfile.mkdtemp()\nclass T(Base):\n    def test_x(self):\n        self.assertEqual(os.listdir(self.tmp), [])\n` }],
]

for (const [name, files] of BINDING_HOLDS) {
  test(`binding holds: ${name}`, (t) => {
    holds(prove(fixture(t, files), ['THREAD.md']), 'THREAD.md')
  })
}

// ---- object literals (p47-5: an interpolated template before a `:` crashed propose on the optimizer) -------------------

test('object literals: an instanceof ternary with a template branch holds; no key an out-of-step read meets drops a value; a computed lit key keeps its name', (t) => {
  holds(prove(fixture(t, {
    'tests/run.test.ts': 'const report = { error: err instanceof Error ? `${err.name}: ${err.message}` : String(err) }\n',
  }), ['THREAD.md']), 'THREAD.md')
  // `in` and `x!` stop the value's parse, so the object reads on token by token: a template key, a [ROOT] array read as a
  // computed key, a stray `x` key met twice (by a `:` and by a shorthand) and every spread keep their values.
  const ts = (call) => ({ 'tests/t.test.ts': "import fs from 'node:fs'\nimport path from 'node:path'\n" +
    `const ROOT = path.resolve(import.meta.dirname, '..')\nconst x = fs.mkdtempSync('/tmp/x-')\n${call}\n` })
  for (const call of ['fs.readdirSync({ a: k in o ? `${k}` : ROOT })', "fs.readdirSync({ ...ROOT, ...fs.mkdtempSync('/tmp/x-') })",
    'fs.readdirSync({ a: x! ? [ROOT] : x })', 'fs.readdirSync({ a: x! ? x : ROOT, b: x! ? x : x })', 'fs.readdirSync({ a: x! ? x : ROOT, x })']) {
    fails(prove(fixture(t, ts(call), { home: tmpHome(t) }), ['THREAD.md']), 'THREAD.md', { kind: 'walk', origin: 'repo' }, call)
  }
  // The glob reads a tmp cwd only when the computed ['cwd'] key is named "cwd".
  holds(prove(fixture(t, { 'tests/t.test.ts': "import fs from 'node:fs'\nfs.globSync('*.md', { ['cwd']: fs.mkdtempSync('/tmp/x-') })\n" }),
    ['THREAD.md']), 'THREAD.md')
})

// ---- git env, errors ------------------------------------------------------------------------------------------------------

test('every git call scrubs the repo-local env: a decoy GIT_DIR is never read', (t) => {
  const fx = fixture(t)
  const decoy = fs.mkdtempSync(path.join(fx.home, 'decoy-'))
  git(fx.home, decoy, 'init', '-q')
  write(decoy, { 'tests/t.sh': 'cat THREAD.md\n' })
  git(fx.home, decoy, 'add', '-A'); git(fx.home, decoy, 'commit', '-qm', 'decoy')
  const res = prove(fx, ['THREAD.md'], { env: { GIT_DIR: path.join(decoy, '.git'), GIT_WORK_TREE: decoy, GIT_INDEX_FILE: path.join(decoy, '.git', 'index') } })
  holds(res, 'THREAD.md', 'the fixture was read, not the decoy')
})

test('prove --tree no-such-rev exits 2 with one ProofError line; a usage error exits 2', (t) => {
  const fx = fixture(t)
  let r = cli(fx.home, ['prove', '--repo', fx.repo, '--tree', 'no-such-rev', '--glob', 'THREAD.md'])
  assert.equal(r.status, 2)
  assert.equal(r.stdout, '')
  assert.match(r.stderr, /^inert-paths: ProofError: git rev-parse --verify exited \d+[^\n]*\n$/)
  r = cli(fx.home, ['prove', '--repo', fx.repo])
  assert.equal(r.status, 2)
  assert.match(r.stderr, /^inert-paths: [^\n]+\n$/)
})

// ---- propose and the drop rule ------------------------------------------------------------------------------------------

test('propose: only the clean candidates are proposed; a test naming reviews refuses docs/reviews/**', (t) => {
  const fx = fixture(t, { 'tests/t.py': "def test_r():\n    assert open('docs/reviews/r.md').read()\n" })
  const r = cli(fx.home, ['propose', '--repo', fx.repo, '--verifier', 'python3 -m pytest'])
  assert.equal(r.status, 0, r.stderr)
  const out = JSON.parse(r.stdout)
  assert.deepEqual([out.repo, out.proposed, out.refused.map((x) => x.glob), out.recorded, out.drop],
    ['o/fx', ['THREAD.md', 'docs/handoffs/**'], ['docs/reviews/**'], [], []])
})

test('propose: a verifier that walks the tree (run.sh: find . -name *.md) proposes nothing', (t) => {
  const fx = fixture(t, { 'tests/run.sh': "#!/usr/bin/env bash\ncd \"$(dirname \"$0\")/..\"\nfind . -name '*.md' -print\n" })
  const r = cli(fx.home, ['propose', '--repo', fx.repo, '--verifier', 'bash tests/run.sh'])
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(JSON.parse(r.stdout).proposed, [])
})

test('on this repo, nothing proposed matches SKILL.md or skills/**, and skills globs fail with a named reader', (t) => {
  const home = tmpHome(t)
  const r = cli(home, ['propose', '--repo', root, '--tree', 'HEAD', '--verifier', 'make test'])
  assert.equal(r.status, 0, r.stderr)
  const out = JSON.parse(r.stdout)
  for (const g of out.proposed) assert.ok(!g.startsWith('skills/') && !g.endsWith('SKILL.md'), g)
  const p = cli(home, ['prove', '--repo', root, '--tree', 'HEAD', '--verifier', 'make test', '--glob', 'skills/**', '--glob', 'skills/*/SKILL.md'])
  assert.equal(p.status, 0, p.stderr)
  const res = JSON.parse(p.stdout).globs
  for (const g of ['skills/**', 'skills/*/SKILL.md']) {
    assert.equal(res[g].held, false, g)
    assert.ok(res[g].readers.some((x) => x.kind === 'name' || x.kind === 'walk'), `${g}: a named reader`)
  }
})

test('the drop rule: three trailing failures drop a recorded glob; a pass among them, or error lines, do not', (t) => {
  const fx = fixture(t)
  const settings = path.join(fx.home, '.config', 'thread', 'rollouts.toml')
  write(path.dirname(settings), { 'rollouts.toml': 'schema = 2\n\n[repo."o/fx"]\ninert_paths = ["THREAD.md", "docs/handoffs/**"]\n' })
  const ev = path.join(fx.home, 'events')
  const line = (ts, kind, extra) => JSON.stringify({ v: 1, ts, host: 'h', rollout: 'ro', task: 't', kind, repo: 'O/FX', paths: ['THREAD.md'], pathsTotal: 1, ...extra })
  const fail = (ts, g) => line(ts, 'inert-proof-failed', { readers: [{ glob: g, path: 'x', kind: 'name' }], globs: [g], failed: [g] })
  const pass = (ts, g) => line(ts, 'verify-skipped', { globs: [g] })
  write(ev, {
    'ro.jsonl': [fail('2026-10-01T00:00:00.000Z', 'THREAD.md'), fail('2026-10-02T00:00:00.000Z', 'THREAD.md'),
      fail('2026-10-01T00:00:00.000Z', 'docs/handoffs/**'), pass('2026-10-02T00:00:00.000Z', 'docs/handoffs/**')].join('\n') + '\n',
    'ro2.jsonl': [fail('2026-10-03T00:00:00.000Z', 'THREAD.md'), line('2026-10-04T00:00:00.000Z', 'inert-proof-failed', { readers: [], error: 'inert check error: X' }),
      fail('2026-10-03T00:00:00.000Z', 'docs/handoffs/**'), fail('2026-10-03T01:00:00.000Z', 'docs/handoffs/**')].join('\n') + '\n',
    'tunings.jsonl': fail('2026-10-05T00:00:00.000Z', 'docs/handoffs/**') + '\n',
  })
  const r = cli(fx.home, ['propose', '--repo', fx.repo, '--verifier', 'true'])
  assert.equal(r.status, 0, r.stderr)
  const out = JSON.parse(r.stdout)
  assert.deepEqual(out.recorded.map((x) => [x.glob, x.streak]), [['THREAD.md', 3], ['docs/handoffs/**', 2]])
  assert.deepEqual(out.drop, ['THREAD.md'])
})

// ---- record and drop ---------------------------------------------------------------------------------------------------

const settingsPath = (home) => path.join(home, '.config', 'thread', 'rollouts.toml')
const tasksDir = (home) => path.join(home, 'tasks')

test('record writes schema = 2 and the array, re-proves first, and refuses a failing glob with nothing written; drop removes', (t) => {
  const fx = fixture(t, { 'src/c.py': 'REVIEWS = 1\n' })
  fs.mkdirSync(tasksDir(fx.home))
  write(path.dirname(settingsPath(fx.home)), { 'rollouts.toml': '# operator settings\n[defaults]\nparallel_ceiling = 3\n' })
  let r = cli(fx.home, ['record', '--repo', fx.repo, '--glob', 'docs/reviews/**', '--verifier', 'true', '--tasks-dir', tasksDir(fx.home)])
  assert.equal(r.status, 1, r.stderr)
  assert.match(r.stderr, /docs\/reviews\/\*\* fails its proof: src\/c\.py:1 name/)
  assert.equal(fs.readFileSync(settingsPath(fx.home), 'utf8'), '# operator settings\n[defaults]\nparallel_ceiling = 3\n', 'byte-identical')
  r = cli(fx.home, ['record', '--repo', fx.repo, '--glob', 'THREAD.md', '--glob', 'docs/handoffs/**', '--verifier', 'true', '--tasks-dir', tasksDir(fx.home)])
  assert.equal(r.status, 0, r.stderr)
  assert.equal(fs.readFileSync(settingsPath(fx.home), 'utf8'),
    'schema = 2\n\n# operator settings\n[defaults]\nparallel_ceiling = 3\n\n[repo."o/fx"]\ninert_paths = ["THREAD.md", "docs/handoffs/**"]\n')
  r = cli(fx.home, ['drop', '--repo', fx.repo, '--glob', 'THREAD.md'])
  assert.equal(r.status, 0, r.stderr)
  assert.match(fs.readFileSync(settingsPath(fx.home), 'utf8'), /\[repo\."o\/fx"\]\ninert_paths = \["docs\/handoffs\/\*\*"\]\n$/)
  r = cli(fx.home, ['drop', '--repo', fx.repo, '--glob', 'docs/handoffs/**'])
  assert.equal(r.status, 0, r.stderr)
  assert.doesNotMatch(fs.readFileSync(settingsPath(fx.home), 'utf8'), /inert_paths/)
})

test('record refuses a dotted or multi-line inert_paths form: edit it by hand', (t) => {
  const fx = fixture(t)
  fs.mkdirSync(tasksDir(fx.home))
  for (const body of ['schema = 2\nrepo."o/fx".inert_paths = ["THREAD.md"]\n', 'schema = 2\n[repo."o/fx"]\ninert_paths = [\n  "THREAD.md",\n]\n']) {
    write(path.dirname(settingsPath(fx.home)), { 'rollouts.toml': body })
    const r = cli(fx.home, ['record', '--repo', fx.repo, '--glob', 'docs/handoffs/**', '--verifier', 'true', '--tasks-dir', tasksDir(fx.home)])
    assert.equal(r.status, 2, r.stderr)
    assert.match(r.stderr, /edit it by hand/)
    assert.equal(fs.readFileSync(settingsPath(fx.home), 'utf8'), body)
  }
})

// ADR 0063: a repo's test-credential class is ONE line in its repo table, which the line-by-line edit keeps byte-identical
// and inserts after; an edit whose result changes it is refused by the `mine` check; any other form refuses the file.
const IP_CLASS = 'test_credentials = { file = "/x/.env.local", keys = [{ name = "STRIPE_SECRET", prefix = "sk_test_" }] }  # test mode only'

test('record beside the one-line test_credentials class keeps it byte-identical and inserts after it', (t) => {
  const fx = fixture(t)
  fs.mkdirSync(tasksDir(fx.home))
  const before = `schema = 3\n\n[repo."o/fx"]\nparallel_ceiling = 3\n${IP_CLASS}\n`
  write(path.dirname(settingsPath(fx.home)), { 'rollouts.toml': before })
  const r = cli(fx.home, ['record', '--repo', fx.repo, '--glob', 'THREAD.md', '--verifier', 'true', '--tasks-dir', tasksDir(fx.home)])
  assert.equal(r.status, 0, r.stderr)
  assert.equal(fs.readFileSync(settingsPath(fx.home), 'utf8'), `${before}inert_paths = ["THREAD.md"]\n`)
})

test('record control: an edit that alters the class is refused by the mine check, nothing written', (t) => {
  const fx = fixture(t)
  fs.mkdirSync(tasksDir(fx.home))
  const before = `schema = 3\n\n[repo."o/fx"]\n${IP_CLASS}\n`
  write(path.dirname(settingsPath(fx.home)), { 'rollouts.toml': before })
  const code = ['import importlib.util, sys', 'spec = importlib.util.spec_from_file_location("ip", sys.argv[1])',
    'm = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)', 'edit = m.edit_inert',
    'm.edit_inert = lambda *a: edit(*a).replace(\'file = "/x/.env.local"\', \'file = "/y/.env.local"\')',
    'sys.exit(m.main(sys.argv[2:]))'].join('\n')
  const r = spawnSync('python3', ['-B', '-c', code, SCRIPT, 'record', '--repo', fx.repo, '--glob', 'THREAD.md', '--verifier', 'true',
    '--tasks-dir', tasksDir(fx.home)], { encoding: 'utf8', cwd: fx.home, env: baseEnv(fx.home) })
  assert.equal(r.status, 2, r.stderr)
  assert.equal(r.stderr, 'inert-paths: the edit resolves another result than intended: nothing written\n')
  assert.equal(fs.readFileSync(settingsPath(fx.home), 'utf8'), before, 'byte-identical')
})

test('record refuses a file holding the class as a sub-table or over several lines: exit 2, byte-identical', (t) => {
  const fx = fixture(t)
  fs.mkdirSync(tasksDir(fx.home))
  for (const body of [
    'schema = 3\n\n[repo."o/fx"]\nparallel_ceiling = 3\n\n[repo."o/fx".test_credentials]\nfile = "/x/.env.local"\nkeys = [{ name = "STRIPE_SECRET", prefix = "sk_test_" }]\n',
    'schema = 3\n\n[repo."o/fx"]\ntest_credentials = { file = "/x/.env.local", keys = [\n  { name = "STRIPE_SECRET", prefix = "sk_test_" }] }\n',
  ]) {
    write(path.dirname(settingsPath(fx.home)), { 'rollouts.toml': body })
    const r = cli(fx.home, ['record', '--repo', fx.repo, '--glob', 'THREAD.md', '--verifier', 'true', '--tasks-dir', tasksDir(fx.home)])
    assert.equal(r.status, 2, r.stderr)
    assert.match(r.stderr, /test_credentials must be one line in that table/)
    assert.equal(fs.readFileSync(settingsPath(fx.home), 'utf8'), body, 'byte-identical')
  }
})

// The reader check (round 2): a fixture plugin repo P with commit 1 (a pre-P29 rollout-settings.py stub that refuses a
// top-level schema line) and commit 2 (a copy of the real scripts). The Primary P sits at commit 1; record runs from a
// linked worktree W at commit 2, with a live rollout note in --tasks-dir.
function pluginFixture(t, fx) {
  const P = path.join(fx.home, 'plugin')
  fs.mkdirSync(path.join(P, 'skills', '_shared', 'scripts'), { recursive: true })
  git(fx.home, P, 'init', '-q')
  write(P, {
    'skills/_shared/scripts/rollout-settings.py': 'class SettingsError(Exception):\n    pass\n\n' +
      'def resolve(repo=None, path=None):\n    for line in open(path):\n        if line.startswith("schema"):\n' +
      '            raise SettingsError(\'unknown top-level key "schema"\')\n    return {}\n',
  })
  for (const f of ['engine-snapshot.py']) fs.copyFileSync(path.join(SCRIPTS, f), path.join(P, 'skills', '_shared', 'scripts', f))
  git(fx.home, P, 'add', '-A'); git(fx.home, P, 'commit', '-qm', 'pre-P29')
  const c1 = git(fx.home, P, 'rev-parse', 'HEAD')
  for (const f of fs.readdirSync(SCRIPTS)) {
    if (f.endsWith('.py') || f.endsWith('.sh')) fs.copyFileSync(path.join(SCRIPTS, f), path.join(P, 'skills', '_shared', 'scripts', f))
  }
  git(fx.home, P, 'add', '-A'); git(fx.home, P, 'commit', '-qm', 'P29')
  const c2 = git(fx.home, P, 'rev-parse', 'HEAD')
  git(fx.home, P, 'checkout', '-q', c1)
  const W = path.join(fx.home, 'plugin-w')
  git(fx.home, P, 'worktree', 'add', '-q', '--detach', W, c2)
  const td = tasksDir(fx.home)
  write(td, { 'ro.md': '---\ntags: [task, rollout]\nstatus: open\nprotocol_version: 5\n---\n\n## Queue\n' })
  return { P, W, c1, c2, td }
}

// The reader check loads another root's rollout-settings.py (and the ladder.py it loads) under -I, which ignores
// PYTHONDONTWRITEBYTECODE: it must still write no __pycache__ there (a stray one trips estate D14/15/9).
function noBytecode(...dirs) {
  for (const d of dirs) {
    const hits = fs.readdirSync(d, { recursive: true }).map(String).filter((p) => p.split(path.sep).includes('__pycache__'))
    assert.deepEqual(hits, [], `no __pycache__ under ${d}`)
  }
}

function recordFrom(fx, pf, extra = []) {
  const r = spawnSync('python3', ['-B', path.join(pf.W, 'skills', '_shared', 'scripts', 'inert-paths.py'), 'record', '--repo', fx.repo,
    '--glob', 'THREAD.md', '--verifier', 'true', '--tasks-dir', pf.td, ...extra], { encoding: 'utf8', cwd: fx.home, env: baseEnv(fx.home) })
  return { status: r.status, stdout: r.stdout, stderr: r.stderr }
}

test('record: the reader check refuses under a pre-P29 Primary (exit 1, file byte-identical); --force writes with a WARN', (t) => {
  const fx = fixture(t)
  const pf = pluginFixture(t, fx)
  const before = '[defaults]\nparallel_ceiling = 3\n'
  write(path.dirname(settingsPath(fx.home)), { 'rollouts.toml': before })
  let r = recordFrom(fx, pf)
  assert.equal(r.status, 1, r.stderr)
  assert.equal(fs.readFileSync(settingsPath(fx.home), 'utf8'), before, 'byte-identical')
  assert.match(r.stderr, new RegExp(`^inert-paths: \\[\\[ro\\]\\] runs on ${fs.realpathSync(pf.P).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}, whose rollout-settings\\.py refuses the new file \\(unknown top-level key "schema"\\): update that checkout to a P29\\+ release, or wait for the rollout to finish, or re-run with --force$`, 'm'))
  r = recordFrom(fx, pf, ['--force'])
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stderr, /^WARN: inert-paths: \[\[ro\]\] runs on /m)
  assert.match(fs.readFileSync(settingsPath(fx.home), 'utf8'), /^schema = 2\n[\s\S]*inert_paths = \["THREAD\.md"\]\n$/)
  noBytecode(pf.P, pf.W)
})

test('record: the reader check passes a P29+ Primary, a live note stamped at a usable P29+ snapshot, and a file already at schema 2: all write with no WARN', (t) => {
  // the Primary moved to commit 2
  let fx = fixture(t)
  let pf = pluginFixture(t, fx)
  write(path.dirname(settingsPath(fx.home)), { 'rollouts.toml': '[defaults]\nparallel_ceiling = 3\n' })
  git(fx.home, pf.P, 'checkout', '-q', pf.c2)
  let r = recordFrom(fx, pf)
  assert.equal(r.status, 0, r.stderr)
  assert.doesNotMatch(r.stderr, /WARN/)
  noBytecode(pf.P, pf.W)
  // a stamped note at a usable snapshot (the Primary still pre-P29): the snapshot reads the file, no wait
  fx = fixture(t, {}, { home: tmpHome(t) })
  pf = pluginFixture(t, fx)
  write(path.dirname(settingsPath(fx.home)), { 'rollouts.toml': '[defaults]\nparallel_ceiling = 3\n' })
  const S = path.join(fx.home, 'snap')
  git(fx.home, pf.P, 'worktree', 'add', '-q', '--detach', S, pf.c2)
  write(pf.td, { 'ro.md': `---\ntags: [task, rollout]\nstatus: open\nprotocol_version: 5\nengine_snapshot: "${S}"\nengine_sha: ${pf.c2}\n---\n` })
  const started = Date.now()
  r = recordFrom(fx, pf)
  assert.equal(r.status, 0, r.stderr)
  assert.doesNotMatch(r.stderr, /WARN/)
  assert.ok(Date.now() - started < 30000, 'no wait')
  noBytecode(pf.P, pf.W, S)
  // a file already at schema 2: no check runs, so the pre-P29 Primary is never asked
  fx = fixture(t, {}, { home: tmpHome(t) })
  pf = pluginFixture(t, fx)
  write(path.dirname(settingsPath(fx.home)), { 'rollouts.toml': 'schema = 2\n\n[defaults]\nparallel_ceiling = 3\n' })
  r = recordFrom(fx, pf)
  assert.equal(r.status, 0, r.stderr)
  assert.match(fs.readFileSync(settingsPath(fx.home), 'utf8'), /inert_paths = \["THREAD\.md"\]/)
})

test('record: a missing tasks dir is a WARN and the write goes on', (t) => {
  const fx = fixture(t)
  write(path.dirname(settingsPath(fx.home)), { 'rollouts.toml': '[defaults]\nparallel_ceiling = 3\n' })
  const r = cli(fx.home, ['record', '--repo', fx.repo, '--glob', 'THREAD.md', '--verifier', 'true', '--tasks-dir', path.join(fx.home, 'no-tasks')])
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stderr, /^WARN: inert-paths: no tasks dir at /m)
  assert.match(fs.readFileSync(settingsPath(fx.home), 'utf8'), /inert_paths = \["THREAD\.md"\]/)
})
