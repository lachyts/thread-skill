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

function cli(home, args, { env = {}, cwd = home } = {}) {
  const r = spawnSync('python3', ['-B', SCRIPT, ...args], { encoding: 'utf8', cwd, env: baseEnv(home, env) })
  return { status: r.status, stdout: r.stdout, stderr: r.stderr }
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
})

test('record: a P29+ Primary, a live note stamped at a usable P29+ snapshot, and a file already at schema 2 all write with no WARN', (t) => {
  // the Primary moved to commit 2
  let fx = fixture(t)
  let pf = pluginFixture(t, fx)
  write(path.dirname(settingsPath(fx.home)), { 'rollouts.toml': '[defaults]\nparallel_ceiling = 3\n' })
  git(fx.home, pf.P, 'checkout', '-q', pf.c2)
  let r = recordFrom(fx, pf)
  assert.equal(r.status, 0, r.stderr)
  assert.doesNotMatch(r.stderr, /WARN/)
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
