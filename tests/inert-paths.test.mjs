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

test("the name rule reads the steps, and a glob's own non-prose files are scanned (no own-files exclusion)", (t) => {
  let fx = fixture(t)
  fails(prove(fx, ['THREAD.md'], { verifier: 'cat THREAD.md' }), 'THREAD.md', { kind: 'name', path: '<verifier>' })
  fails(prove(fx, ['THREAD.md'], { bootstrap: 'wc -l THREAD.md' }), 'THREAD.md', { kind: 'name', path: '<bootstrap>' })
  fx = fixture(t, { 'docs/reviews/check.py': "from pathlib import Path\nfor p in Path(__file__).parent.glob('*.md'):\n    print(p)\n" }, { home: tmpHome(t) })
  const res = prove(fx, ['docs/reviews/**', 'THREAD.md'])
  fails(res, 'docs/reviews/**', { kind: 'walk', path: 'docs/reviews/check.py', origin: 'repo' })
  holds(res, 'THREAD.md')
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
]

for (const [name, files] of WALK_HOLDS) {
  test(`walk holds: ${name}`, (t) => {
    holds(prove(fixture(t, files), ['THREAD.md']), 'THREAD.md')
  })
}

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

test('_brace keeps the first 64 of the full expansion, in bash order, and says when it dropped any', (t) => {
  const many = (n) => '{' + Array.from({ length: n }, (_, i) => `y${i}`).join(',') + '}.md'
  const pats = ['x{a,b}{c,d}{e,f}', '{a,{b,c}}', '{a}', '{}', 'a{b,c', '{a,b}'.repeat(6), '{a,b}'.repeat(7), many(65), many(64)]
  // An uncapped copy of the recursive expander _brace replaced: the reference order.
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
