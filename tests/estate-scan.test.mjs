// skills/_shared/scripts/estate-scan.py — the estate pass's deterministic first pass (CONTEXT.md **Estate scan**).
// Every case runs the shipped script against fixture vaults, fixture repos and a fake HOME under one temp dir S,
// passing --vault and --today on every run, so nothing reads or writes the real vault, ~/.claude or a real remote.
//
// The remotes: every fixture origin is `git@github.com:fixture/<x>.git`, served by a fake `ssh` first on PATH
// (S/bin/ssh). It logs its argv to S/ssh.log and runs `git upload-pack` on the bare S/remotes/fixture/<x>.git, so
// `git ls-remote --symref` works with no network; `fixture/hang.git` writes its pid to S/hang.pid and sleeps instead.
// The landing register is S/register.md (LANDING_REGISTER), listing fixture/b. The plugin marketplace registry
// (S/home/.claude/plugins/known_marketplaces.json) names repos F and G as directory sources, so F has no usable
// rollout clone and G has G-rollout.
//
// The main vault V1 runs once online and once offline (shared across the cases), plus a second online run for
// determinism, a GIT_SSH_COMMAND run, and a --deadline 0 run behind a `git` shim. V2 holds a chmod-000 note under
// Work/Tasks/Archive/ (the vault-level case; skipped under root). V3 declares one repo whose remote hangs.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { root } from './lib/contract-text.mjs'

const SCRIPT = path.join(root, 'skills', '_shared', 'scripts', 'estate-scan.py')
const TODAY = '2026-10-19'

// Scrub git's own repo-local names first, then pin the config, so a hook's GIT_DIR never reaches a fixture repo.
const drop = spawnSync('git', ['rev-parse', '--local-env-vars'], { encoding: 'utf8' }).stdout.split('\n').filter(Boolean)
const base = { ...process.env }
for (const name of drop) delete base[name]
base.GIT_CONFIG_GLOBAL = '/dev/null'
base.GIT_CONFIG_NOSYSTEM = '1'
// A `pip install --user` PyYAML resolves under HOME, which every run swaps: pin the real user base as run.sh does.
base.PYTHONUSERBASE ??= spawnSync('python3', ['-c', 'import site; print(site.getuserbase())'], { encoding: 'utf8' }).stdout.trim()

const S = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'estate-scan-')))
const HOME = path.join(S, 'home')
const R = (name) => path.join(HOME, 'repos', name)
const LOCKED = path.join(S, 'v2', 'Work', 'Tasks', 'Archive', 'locked.md')
const HANG_PID = path.join(S, 'hang.pid')
const SSH_LOG = path.join(S, 'ssh.log')

function alive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
after(() => {
  // The hang case's sleep, by the pid the fake ssh recorded, if the scan left it alive (it must not).
  if (fs.existsSync(HANG_PID)) {
    const pid = Number(fs.readFileSync(HANG_PID, 'utf8').trim())
    if (pid > 0 && alive(pid)) process.kill(pid, 'SIGKILL')
  }
  if (fs.existsSync(LOCKED)) fs.chmodSync(LOCKED, 0o644)
  fs.rmSync(S, { recursive: true, force: true })
})

const mkdir = (p) => fs.mkdirSync(p, { recursive: true })
const write = (p, text) => { mkdir(path.dirname(p)); fs.writeFileSync(p, text) }
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

function git(args, cwd) {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false',
    '-c', 'init.defaultBranch=main', ...args], { env: base, encoding: 'utf8', cwd })
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`)
  return r.stdout.trim()
}

// ---- The fake remote side ------------------------------------------------------------------------------------
mkdir(path.join(S, 'bin'))
write(path.join(S, 'bin', 'ssh'), `#!/bin/sh
# Fake ssh: log the argv, then serve git@github.com:<owner>/<name>.git from S/remotes (no network).
printf '%s\\n' "$*" >> '${SSH_LOG}'
for a in "$@"; do cmd=$a; done
repo=$(printf '%s' "$cmd" | sed -n "s/^git-upload-pack '\\(.*\\)'$/\\1/p")
case "$repo" in
  */hang.git) echo $$ > '${HANG_PID}'; exec sleep 30 ;;
esac
exec git upload-pack '${S}/remotes/'"\${repo#/}"
`)
fs.chmodSync(path.join(S, 'bin', 'ssh'), 0o755)
// A `git` shim for the --deadline 0 run: it records that it ran, then runs the real git.
const realGit = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8', env: base }).stdout.trim()
write(path.join(S, 'shim', 'git'), `#!/bin/sh\n: > '${path.join(S, 'git-called')}'\nexec '${realGit}' "$@"\n`)
fs.chmodSync(path.join(S, 'shim', 'git'), 0o755)

write(path.join(S, 'register.md'), '# Landing register\n\n- fixture/b — fixture listing\n')

// ---- The repos -------------------------------------------------------------------------------------------------
// repo(name, files, {bare, origin}): main with one commit of `files`, pushed to the bare (by path), with
// refs/remotes/origin/main and the origin/HEAD symref set locally, and origin set to the GitHub-shaped URL.
function repo(name, files, { bare = `fixture/${name.toLowerCase()}.git`, origin } = {}) {
  const dir = R(name)
  mkdir(dir)
  git(['init', '-q', '-b', 'main', dir])
  for (const [f, text] of Object.entries(files)) write(path.join(dir, f), text)
  git(['-C', dir, 'add', '-A'])
  git(['-C', dir, 'commit', '-q', '-m', 'init'])
  const sha = git(['-C', dir, 'rev-parse', 'HEAD'])
  if (bare) {
    const b = path.join(S, 'remotes', bare)
    mkdir(b)
    git(['init', '-q', '--bare', '-b', 'main', b])
    git(['-C', dir, 'push', '-q', b, 'main:main'])
  }
  git(['-C', dir, 'remote', 'add', 'origin', origin ?? `git@github.com:${bare}`])
  git(['-C', dir, 'update-ref', 'refs/remotes/origin/main', sha])
  git(['-C', dir, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main'])
  return dir
}
function commit(dir, files, msg, extra = []) {
  for (const [f, text] of Object.entries(files)) write(path.join(dir, f), text)
  git(['-C', dir, 'add', '-A'])
  git(['-C', dir, 'commit', '-q', ...extra, '-m', msg])
}

// A: one local content commit ahead of origin, a Makefile `test:` target, a nested sub-directory.
repo('A', { Makefile: 'test:\n\techo ok\n', 'sub/x.txt': 'x\n' })
commit(R('A'), { 'a.txt': 'local only\n' }, 'feat: local only')
// B: in sync, no verifier, on the landing register, with core.sshCommand set (so the scan leaves ssh alone).
repo('B', { 'README.md': '# B\n' })
git(['-C', R('B'), 'config', 'core.sshCommand', 'ssh'])
// C: ahead only on THREAD.md, package.json scripts.test.
repo('C', { 'package.json': JSON.stringify({ name: 'c', scripts: { test: 'node -e 0' } }) + '\n' })
commit(R('C'), { 'THREAD.md': '# Thread\n' }, 'docs: thread')
// D: ahead by one empty commit (an ahead set touching no file blocks), pyproject [tool.poetry].
repo('D', { 'pyproject.toml': '[tool.poetry]\nname = "d"\n' })
commit(R('D'), {}, 'chore: empty', ['--allow-empty'])
// E: origin a local bare path (no GitHub origin), CLAUDE.md names its verifier.
repo('E', { 'CLAUDE.md': '# E\n\nVerifier: `make check`\n' }, { bare: 'local/e.git', origin: path.join(S, 'remotes', 'local', 'e.git') })
// F: a directory-source marketplace with no F-rollout clone.
repo('F', { Makefile: 'test:\n\ttrue\n' })
// G: a directory-source marketplace with a usable G-rollout clone, and the primary's main one content commit ahead.
repo('G', { Makefile: 'test:\n\ttrue\n' })
git(['clone', '-q', path.join(S, 'remotes', 'fixture', 'g.git'), R('G-rollout')])
git(['-C', R('G-rollout'), 'remote', 'set-url', 'origin', 'git@github.com:fixture/g.git'])
commit(R('G'), { 'g.txt': 'primary only\n' }, 'feat: primary only')
// H: the hanging remote, with a cached origin/HEAD.
repo('H', { Makefile: 'test:\n\ttrue\n' }, { bare: null, origin: 'git@github.com:fixture/hang.git' })
mkdir(R('plain'))  // a plain directory, no git

const marketplaces = { 'fx-f': { source: { source: 'directory', path: R('F') }, installLocation: R('F') },
  'fx-g': { source: { source: 'directory', path: R('G') }, installLocation: R('G') } }
write(path.join(HOME, '.claude', 'plugins', 'known_marketplaces.json'), JSON.stringify(marketplaces, null, 2) + '\n')

// ---- Vault V1 --------------------------------------------------------------------------------------------------
const V1 = path.join(S, 'v1')
const fm = (lines, body = '\n# Note\n') => `---\n${lines}\n---\n${body}`
const P = (rel, text) => write(path.join(V1, 'Work', 'Projects', rel), text)
const T = (rel, text) => write(path.join(V1, 'Work', 'Tasks', rel), text)
const project = (status, rest = '') => fm(`tags:\n  - project${status ? `\nstatus: ${status}` : ''}\ndone: false${rest}`)
const task = (status, projects, rest = '', body = '\n# Task\n') =>
  fm(`tags:\n  - task\nstatus: ${status}\nprojects:${projects.length ? projects.map((p) => `\n  - "[[${p}]]"`).join('') : ' []'}${rest}`, body)
const R1 = 'crowned-one-rollout-2026-10-19'
const R2 = 'queued-one-rollout-2026-10-18'

P('AI/AI.md', fm('tags:\n  - area'))
P('AI/Crowned One.md', project('crowned', '\ncrowned: 2026-10-06\nlane: Tools\narea:\n  - "[[AI]]"\naliases:\n  - c1\n' +
  'repos:\n  - ~/repos/A\n  - ~/repos/A/sub\nnext_task: "[[t-open-past]]"'))
P('AI/Active One.md', project('active', `\nrepos:\n  - ${R('D')}`))
P('AI/Queued One.md', project('queued', '\nrepos:\n  - ~/repos/B/'))
P('AI/Parked One.md', project('parked', `\nrepos:\n  - ~/repos/C\n  - ${R('C')}/`))
P('AI/Repo E.md', project('on-hold', '\nrepos:\n  - ~/repos/E'))
P('AI/Repo F.md', project('queued', '\nrepos: ~/repos/F'))  // a scalar, not a list
P('AI/Repo G.md', project('queued', '\nrepos:\n  - ~/repos/G'))
P('AI/Odd Repos.md', project('', '\nrepos:\n  - ~/repos/missing\n  - ~/repos/plain'))
P('AI/Twin.md', project('queued'))
P('Art/Twin.md', project('queued'))
P('AI/Done Flag.md', project('queued', '\nrepos:\n  - ~/repos/B').replace('done: false', 'done: true'))
P('AI/Done String.md', project('queued').replace('done: false', 'done: "true"'))
P('AI/Legacy Done.md', project('done'))
P('AI/Archived Tag.md', fm('tags:\n  - project\n  - archived\nstatus: queued'))
P('Archive/Old Project.md', project('queued'))
P('AI/Not Tagged.md', fm('tags:\n  - note'))
P('AI/Broken.md', '---\ntags: [project\n---\n')
write(path.join(V1, 'Work', 'Phases', 'crowned-one-p1-start.md'),
  fm('tags:\n  - phase\nphase: 1\nstatus: open\nprojects:\n  - "[[Crowned One]]"'))
write(path.join(V1, 'Work', 'Phases', 'crowned-one-p0-done.md'),
  fm('tags:\n  - phase\nphase: 0\nstatus: done\nprojects:\n  - "[[Crowned One]]"'))

T('t-open-past.md', task('open', ['Crowned One'], '\ndue: 2026-10-01\nphase: 1\npriority: high\nnext_action: "Ship the past task"',
  '\n# Past due task\n\nBody.\n'))
T('t-open-future.md', task('open', ['Crowned One'], '\ndue: 2026-11-01\nphase: 1'))
T('t-in-progress.md', task('in-progress', ['Active One']))
T('t-review.md', task('review', ['Queued One']))
T('t-parked.md', task('parked', ['Parked One']))
T('t-done.md', task('done', ['Crowned One']))
T('Archive/t-archived.md', task('open', ['Crowned One']))
T('t-archived-tag.md', task('open', ['Crowned One']).replace('  - task', '  - task\n  - archived'))
T('t-two-projects.md', task('open', ['Crowned One', 'Queued One'], '', '\nNo heading here.\n'))
T('t-live-and-dead.md', task('open', ['Crowned One', 'Done Flag']))
T('t-broken.md', '---\ntags: [task\n---\n')
const UNHOMED = {
  'u-missing': ['No Such Project', 'missing', 'no note'],
  'u-archived-dir': ['Old Project', 'project archived', 'archived'],
  'u-archived-tag': ['Archived Tag', 'project archived', 'archived'],
  'u-not-project': ['Not Tagged', 'not a project', 'not a project note (Work/Projects/AI/Not Tagged.md)'],
  'u-ambiguous': ['Twin', 'ambiguous', 'ambiguous (Work/Projects/AI/Twin.md, Work/Projects/Art/Twin.md)'],
  'u-area': ['AI', 'area note', 'area note (Work/Projects/AI/AI.md)'],
  'u-unreadable': ['Broken', 'project unreadable', 'frontmatter does not parse (Work/Projects/AI/Broken.md)'],
  'u-done-flag': ['Done Flag', 'project done', 'done (done: true)'],
  'u-done-legacy': ['Legacy Done', 'project done', 'done'],
}
for (const [slug, [link]] of Object.entries(UNHOMED)) T(`${slug}.md`, task('open', [link]))
T('u-no-projects.md', task('open', []))
// Rollout R1, linked to the crowned project, rooted at repo A: one gate-pending task, one open.
T(`${R1}.md`, fm(`tags:\n  - task\n  - rollout\nstatus: open\nprotocol_version: 5\nparallel_ceiling: 2\nprojects:\n  - "[[Crowned One]]"`,
  '\n## Notes\n\nProject root: `~/repos/A`\n\n## Queue\n\n- [[r1-gate]]\n- [[r1-open]]\n'))
T('r1-gate.md', task('gate-pending', ['Crowned One'], `\nrollout: "[[${R1}]]"`,
  '\n# Gate\n\n## Gated inputs (awaiting sign-off)\n\n- spend: a fixture spend — cap $1\n'))
T('r1-open.md', task('open', ['Crowned One'], `\nrollout: "[[${R1}]]"`))
// Rollout R2: frontmatter closing at the end of the file with no trailing newline (status refuses it).
T(`${R2}.md`, '---\ntags:\n  - task\n  - rollout\nstatus: open\nprojects:\n  - "[[Queued One]]"\n---')
T('Archive/Rollouts/old-rollout-2026-01-01.md', fm('tags:\n  - task\n  - rollout\nstatus: done\nprojects:\n  - "[[Crowned One]]"'))

// ---- Vault V2: an unreadable note under Work/Tasks/Archive/ ---------------------------------------------------
const V2 = path.join(S, 'v2')
write(path.join(V2, 'Work', 'Projects', 'V2 Project.md'), project('queued', '\nrepos:\n  - ~/repos/C'))
write(path.join(V2, 'Work', 'Tasks', 'v2-rollout.md'), fm('tags:\n  - task\n  - rollout\nstatus: open\nprojects:\n  - "[[V2 Project]]"',
  '\nProject root: `~/repos/C`\n'))
write(path.join(V2, 'Work', 'Tasks', 'v2-task.md'), task('open', ['V2 Project'], '\nrollout: "[[v2-rollout]]"'))
write(LOCKED, task('done', ['V2 Project']))
const ROOT_USER = process.getuid?.() === 0
if (!ROOT_USER) fs.chmodSync(LOCKED, 0o000)

// ---- Vault V3: one project whose repo's remote hangs ----------------------------------------------------------
const V3 = path.join(S, 'v3')
write(path.join(V3, 'Work', 'Projects', 'Hang Project.md'), project('queued', '\nrepos:\n  - ~/repos/H'))
mkdir(path.join(V3, 'Work', 'Tasks'))

// ---- Running the scan ------------------------------------------------------------------------------------------
const env = { ...base }
for (const name of ['GIT_SSH_COMMAND', 'GIT_SSH', 'CLAUDE_PLUGIN_ROOT', 'PYTHONDONTWRITEBYTECODE']) delete env[name]
Object.assign(env, {
  HOME,
  CLAUDE_CONFIG_DIR: path.join(HOME, '.claude'),
  LANDING_REGISTER: path.join(S, 'register.md'),
  THREAD_EVENTS_DIR: process.env.THREAD_TEST_EVENTS_DIR || path.join(S, 'events'),
  THREAD_VERIFY_SLOTS_DIR: path.join(S, 'verify-slots'),
  PATH: `${path.join(S, 'bin')}:${process.env.PATH}`,
})

// One run: {status, stdout, stderr, json, ms, ssh} — `ssh` is the fake's log lines from this run (then cleared).
function scan(vault, args = [], extra = {}) {
  fs.rmSync(SSH_LOG, { force: true })
  const t0 = Date.now()
  const r = spawnSync('python3', [SCRIPT, '--vault', vault, '--today', TODAY, ...args],
    { encoding: 'utf8', cwd: S, env: { ...env, ...extra }, timeout: 120000 })
  const ms = Date.now() - t0
  let json = null
  try { json = JSON.parse(r.stdout) } catch { /* left null: the case's own assertion names it */ }
  const ssh = fs.existsSync(SSH_LOG) ? fs.readFileSync(SSH_LOG, 'utf8').split('\n').filter(Boolean) : []
  fs.rmSync(SSH_LOG, { force: true })
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, json, ms, ssh }
}
const once = (fn) => { let v; return () => (v ??= fn()) }
const ok = (run) => { assert.equal(run.status, 0, run.stderr); assert.ok(run.json, `no JSON on stdout: ${run.stdout.slice(0, 300)}`); return run.json }
const online = once(() => scan(V1))
const offline = once(() => scan(V1, ['--offline']))

// The snapshot for case 9, taken before the first run: mtime and size of everything under HOME (the repos and
// their .git included) and the vault.
function snap(dir) {
  const out = {}
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      const st = fs.lstatSync(p)
      out[p] = `${e.isDirectory() ? 'd' : 'f'}:${st.mtimeMs}:${st.size}`
      if (e.isDirectory()) walk(p)
    }
  }
  walk(dir)
  return out
}
const BEFORE = [snap(HOME), snap(V1)]

const byName = (j, name) => j.projects.filter((p) => p.name === name)
const proj = (j, name) => { const p = byName(j, name); assert.equal(p.length, 1, `one project ${name}`); return p[0] }
const taskRow = (j, slug) => j.tasks.find((t) => t.slug === slug)
const repoAt = (j, dir) => { const r = j.repos.find((x) => x.path === dir); assert.ok(r, `a repo row for ${dir}`); return r }
const checks = (rows) => rows.map((x) => x.check)
const CHECKS = ['git', 'self-rollout', 'no-github-origin', 'landing-register', 'default-branch', 'unpushed-default',
  'unfinished-rollout', 'no-verifier']

// ---- 1. Projects ------------------------------------------------------------------------------------------------
test('1. projects: done, archived, area and untagged notes are absent; parked is marked; the order is by standing', () => {
  const j = ok(online())
  const names = j.projects.map((p) => p.name)
  for (const gone of ['Done Flag', 'Done String', 'Legacy Done', 'Archived Tag', 'Old Project', 'AI', 'Not Tagged', 'Broken']) {
    assert.ok(!names.includes(gone), `${gone} is not listed`)
  }
  assert.deepEqual(names, ['Crowned One', 'Active One', 'Queued One', 'Repo F', 'Repo G', 'Twin', 'Twin', 'Parked One',
    'Repo E', 'Odd Repos'])
  assert.deepEqual(j.projects.map((p) => p.standing), ['crowned', 'active', 'queued', 'queued', 'queued', 'queued', 'queued',
    'parked', 'other', 'none'])
  assert.deepEqual(byName(j, 'Twin').map((p) => p.note), ['Work/Projects/AI/Twin.md', 'Work/Projects/Art/Twin.md'])
  const parked = proj(j, 'Parked One')
  assert.equal(parked.parked, true)
  assert.equal(proj(j, 'Queued One').parked, false)
  assert.equal(proj(j, 'Repo E').status, 'on-hold')
  assert.equal(proj(j, 'Odd Repos').status, null)
  const c = proj(j, 'Crowned One')
  assert.equal(c.crowned, '2026-10-06')
  assert.equal(c.lane, 'Tools')
  assert.deepEqual(c.area, ['AI'])
  assert.deepEqual(c.aliases, ['c1'])
  assert.deepEqual(c.repos, ['~/repos/A', '~/repos/A/sub'])
  assert.deepEqual(proj(j, 'Repo F').repos, ['~/repos/F'], 'a scalar repos: is one declared repo')
  assert.deepEqual(c.nextTask, { result: 'live', task: 't-open-past', next_action: 'Ship the past task' })
  assert.deepEqual(proj(j, 'Queued One').nextTask, { result: 'blank', task: null, next_action: null })
  assert.deepEqual(c.phases, [{ slug: 'crowned-one-p1-start', note: 'Work/Phases/crowned-one-p1-start.md', status: 'open',
    phase: 1, openTasks: 2 }])
  assert.equal(j.counts.projects, 10)
  assert.equal(j.counts.parked, 1)
})

// ---- 2. Tasks and homing ----------------------------------------------------------------------------------------
test('2. tasks: status classes, homing under every live project, dead links, unhomed reasons, skipped notes, deadlines', () => {
  const j = ok(online())
  assert.deepEqual(j.tasks.map((t) => t.slug), [...j.tasks.map((t) => t.slug)].sort(), 'tasks sorted by slug')
  for (const gone of ['t-done', 't-archived', 't-archived-tag', 't-broken', R1, R2]) assert.equal(taskRow(j, gone), undefined, `${gone} absent`)
  assert.equal(j.tasks.length, 19)
  assert.equal(taskRow(j, 't-in-progress').statusClass, 'active', 'in-progress reads as in_progress (OPEN_STATUSES)')
  assert.equal(taskRow(j, 't-review').statusClass, 'review')
  assert.equal(taskRow(j, 't-parked').statusClass, 'hold')
  assert.equal(taskRow(j, 'r1-gate').statusClass, 'hold')
  assert.equal(taskRow(j, 't-open-past').statusClass, 'active')
  assert.equal(taskRow(j, 't-open-past').title, 'Past due task')
  assert.equal(taskRow(j, 't-open-future').title, 'Task')
  assert.equal(taskRow(j, 't-two-projects').title, 't-two-projects', 'no H1: the slug')
  assert.equal(taskRow(j, 't-open-past').due, '2026-10-01')
  assert.equal(taskRow(j, 't-open-past').priority, 'high')
  // in flight: a live rollout link, or in_progress / review
  assert.equal(taskRow(j, 'r1-gate').rollout, R1)
  assert.equal(taskRow(j, 'r1-gate').rolloutLive, true)
  assert.equal(taskRow(j, 'r1-gate').inFlight, true)
  assert.equal(taskRow(j, 't-in-progress').inFlight, true)
  assert.equal(taskRow(j, 't-review').inFlight, true)
  assert.equal(taskRow(j, 't-open-past').inFlight, false)

  const two = taskRow(j, 't-two-projects')
  assert.deepEqual(two.projects, ['Crowned One', 'Queued One'])
  assert.ok(proj(j, 'Crowned One').tasks.includes('t-two-projects'))
  assert.ok(proj(j, 'Queued One').tasks.includes('t-two-projects'))
  assert.equal(j.tasks.filter((t) => t.slug === 't-two-projects').length, 1)
  const mixed = taskRow(j, 't-live-and-dead')
  assert.deepEqual(mixed.projects, ['Crowned One'])
  assert.deepEqual(mixed.deadLinks, [{ link: 'Done Flag', why: 'project done', raw: 'done (done: true)' }])
  assert.ok(!j.unhomed.some((u) => u.slug === 't-live-and-dead'), 'a task with one live project is homed')
  assert.deepEqual(proj(j, 'Crowned One').tasks, ['r1-gate', 'r1-open', 't-live-and-dead', 't-open-future', 't-open-past', 't-two-projects'])
  assert.equal(proj(j, 'Crowned One').openTasks, 6)
  assert.deepEqual(proj(j, 'Parked One').tasks, ['t-parked'])

  const want = Object.entries(UNHOMED).map(([slug, [link, why, raw]]) => ({ slug, why, links: [{ link, why, raw }] }))
  want.push({ slug: 'u-no-projects', why: 'no projects', links: [] })
  want.sort((a, b) => (a.slug < b.slug ? -1 : 1))
  // next-action lists an ambiguous link's notes in the vault walk's order, which the filesystem decides.
  const amb = j.unhomed.find((u) => u.slug === 'u-ambiguous')
  assert.match(amb?.links[0].raw ?? '', /^ambiguous \(Work\/Projects\/(AI|Art)\/Twin\.md, Work\/Projects\/(AI|Art)\/Twin\.md\)$/)
  want.find((u) => u.slug === 'u-ambiguous').links[0].raw = amb.links[0].raw
  assert.deepEqual(j.unhomed, want)
  assert.equal(j.counts.unhomed, 10)

  assert.deepEqual(j.skipped, [{ note: 'Work/Projects/AI/Broken.md', why: 'frontmatter does not parse' },
    { note: 'Work/Tasks/t-broken.md', why: 'frontmatter does not parse' }])
  assert.deepEqual(j.deadlines, [
    { date: '2026-10-01', kind: 'due', task: 't-open-past', projects: ['Crowned One'] },
    { date: '2026-11-01', kind: 'due', task: 't-open-future', projects: ['Crowned One'] }])
  assert.equal(proj(j, 'Crowned One').overdue, 1, 'overdue against --today')
  assert.equal(proj(j, 'Crowned One').nextDue, '2026-11-01')
  assert.equal(proj(j, 'Queued One').overdue, 0)
  assert.equal(proj(j, 'Queued One').nextDue, null)
})

// ---- 3. Rollouts ------------------------------------------------------------------------------------------------
test("3. rollouts: R1 carries status's summary with its pending sign-off; R2's failing status is reported, not fatal", () => {
  const j = ok(online())
  assert.deepEqual(j.rollouts.map((r) => r.slug), [R1, R2], 'the archived rollout is absent')
  const r1 = j.rollouts[0]
  assert.equal(r1.note, `Work/Tasks/${R1}.md`)
  assert.equal(r1.shape, 'parallel')
  assert.equal(r1.protocolVersion, 5)
  assert.deepEqual(r1.projects, ['Crowned One'])
  assert.equal(r1.projectRoot, '~/repos/A')
  assert.equal(r1.error, null)
  assert.ok(r1.summary, 'R1 has a summary')
  assert.deepEqual(r1.summary.pendingSignOffs, ['r1-gate'])
  assert.deepEqual(r1.summary.setAside, [{ slug: 'r1-gate', status: 'gate-pending', setAsideAt: 'gate' }])
  assert.equal(r1.summary.awaitingSignOff, false)
  assert.equal(r1.summary.counts.total, 2)
  assert.equal(r1.summary.counts.setAside, 1)
  assert.equal(r1.summary.counts.queued, 1)
  assert.match(r1.summary.progress, /^progress: 0\/2 merged/)
  assert.equal(r1.summary.ceiling, 2)
  assert.equal(r1.summary.gitEnvHold, 0)
  assert.deepEqual(proj(j, 'Crowned One').rollouts, [R1])
  assert.deepEqual(proj(j, 'Queued One').rollouts, [R2])
  const r2 = j.rollouts[1]
  assert.equal(r2.summary, null)
  assert.match(r2.error, /no YAML frontmatter block found/)
})

// ---- 4. Repo blockers -------------------------------------------------------------------------------------------
test('4. repos: each dispatch blocker, the verifier, the nested path, the separate clone, missing and plain dirs', () => {
  const j = ok(online())
  assert.deepEqual(j.repos.map((r) => r.path), [...j.repos.map((r) => r.path)].sort(), 'repos sorted by path')

  const a = repoAt(j, R('A'))
  assert.equal(a.exists, true)
  assert.equal(a.git, true)
  assert.equal(a.nested, false)
  assert.equal(a.rolloutRoot, R('A'))
  assert.equal(a.github, 'fixture/a')
  assert.equal(a.origin, 'git@github.com:fixture/a.git')
  assert.deepEqual(a.declaredBy, ['Crowned One'])
  assert.deepEqual(checks(a.blockers), ['unpushed-default', 'unfinished-rollout'])
  assert.deepEqual(a.unchecked, [])
  assert.equal(a.defaultBranch, 'main')
  assert.equal(a.defaultBranchSource, 'remote')
  assert.equal(a.unpushed.length, 1)
  assert.equal(a.unpushed[0].clone, R('A'))
  assert.equal(a.unpushed[0].ahead, 1)
  assert.equal(a.unpushed[0].basis, 'remote')
  assert.deepEqual(a.unpushed[0].touched, ['a.txt'])
  assert.equal(a.unpushed[0].blocks, true)
  assert.match(a.unpushed[0].commits[0], /feat: local only/)
  assert.deepEqual(a.verifier, { command: 'make test', source: 'Makefile' })
  assert.equal(a.unfinishedRollout.length, 1)
  assert.equal(a.unfinishedRollout[0].project, 'Crowned One')
  assert.equal(a.unfinishedRollout[0].verdict, 'refuse')
  assert.equal(a.unfinishedRollout[0].line, `refuse ${R1}`)
  assert.equal(a.unfinishedRollout[0].exit, 3)

  const sub = repoAt(j, R('A/sub'))
  assert.equal(sub.nested, true)
  assert.equal(sub.toplevel, R('A'))
  assert.equal(sub.rolloutRoot, R('A/sub'), 'the self-rollout check runs on the declared path itself')
  for (const k of ['origin', 'github', 'landingRegister', 'defaultBranch', 'unpushed', 'verifier', 'unfinishedRollout', 'blockers']) {
    assert.deepEqual(sub[k], a[k], `A/sub shares A's ${k}`)
  }

  const b = repoAt(j, R('B'))
  assert.deepEqual(b.declared, ['~/repos/B/'])
  assert.deepEqual(checks(b.blockers), ['landing-register', 'no-verifier'])
  assert.deepEqual(b.landingRegister, { exit: 3, line: 'listed fixture/b: fixture listing' })
  assert.equal(b.blockers[0].why, 'listed fixture/b: fixture listing')
  assert.equal(b.verifier, null)
  assert.ok(b.unpushed.every((u) => u.ahead === 0 && !u.blocks), 'B is in sync')

  const c = repoAt(j, R('C'))
  assert.deepEqual(c.declared, [`${R('C')}/`, '~/repos/C'], 'two spellings of one repo, deduped, both kept')
  assert.deepEqual(c.blockers, [])
  assert.equal(c.unpushed[0].ahead, 1)
  assert.equal(c.unpushed[0].threadOnly, true)
  assert.equal(c.unpushed[0].blocks, false)
  assert.deepEqual(c.verifier, { command: 'npm test', source: 'package.json' })

  const d = repoAt(j, R('D'))
  assert.deepEqual(checks(d.blockers), ['unpushed-default'])
  assert.equal(d.unpushed[0].ahead, 1)
  assert.deepEqual(d.unpushed[0].touched, [])
  assert.equal(d.unpushed[0].blocks, true, 'an ahead set touching no file blocks')
  assert.deepEqual(d.verifier, { command: 'poetry run pytest', source: 'pyproject.toml' })

  const e = repoAt(j, R('E'))
  assert.deepEqual(checks(e.blockers), ['no-github-origin'])
  assert.equal(e.github, null)
  assert.equal(e.landingRegister.exit, 4)
  assert.deepEqual(e.verifier, { command: 'make check', source: 'CLAUDE.md' })

  const f = repoAt(j, R('F'))
  assert.deepEqual(checks(f.blockers), ['self-rollout'])
  assert.equal(f.selfRollout.exit, 3)
  assert.match(f.selfRollout.stderr, /F-rollout is not a usable rollout clone/)
  assert.equal(f.rolloutRoot, R('F'), 'the later checks still run on the toplevel')
  assert.deepEqual(f.verifier, { command: 'make test', source: 'Makefile' })

  const g = repoAt(j, R('G'))
  assert.equal(g.selfRollout.exit, 0)
  assert.equal(g.rolloutRoot, R('G-rollout'))
  assert.deepEqual(checks(g.blockers), ['unpushed-default'])
  assert.deepEqual(g.unpushed.map((u) => [u.clone, u.ahead, u.blocks]), [[R('G-rollout'), 0, false], [R('G'), 1, true]])

  const missing = repoAt(j, R('missing'))
  assert.equal(missing.exists, false)
  assert.equal(missing.git, null)
  assert.deepEqual(missing.blockers, [])
  assert.deepEqual(missing.unchecked, CHECKS.map((check) => ({ check, why: 'missing' })))
  const plain = repoAt(j, R('plain'))
  assert.equal(plain.exists, true)
  assert.equal(plain.git, false)
  assert.deepEqual(plain.blockers, [])
  assert.deepEqual(plain.unchecked, CHECKS.map((check) => ({ check, why: 'not a git repo' })))
  assert.equal(j.counts.repos, 10)
})

// ---- 5. ssh BatchMode -------------------------------------------------------------------------------------------
test("5. ssh: BatchMode unless the caller or the repo names its own ssh command; a hook's GIT_DIR is scrubbed", () => {
  const run = online()
  ok(run)
  const lines = run.ssh
  assert.ok(lines.length >= 5, `the fake ssh served the online run: ${lines.join(' | ')}`)
  const forB = lines.filter((l) => l.includes("'fixture/b.git'"))
  assert.equal(forB.length, 1, 'one ls-remote for B')
  assert.ok(!forB[0].includes('-o BatchMode=yes'), "B's core.sshCommand is left alone")
  for (const l of lines.filter((x) => !forB.includes(x))) assert.ok(l.includes('-o BatchMode=yes'), `BatchMode: ${l}`)
  // The same run with a hook-exported GIT_DIR (repo B's, a throwaway fixture repo): every probe still reads its own repo.
  const own = scan(V1, [], { GIT_SSH_COMMAND: path.join(S, 'bin', 'ssh'), GIT_DIR: path.join(R('B'), '.git') })
  ok(own)
  assert.ok(own.ssh.length >= 5)
  for (const l of own.ssh) assert.ok(!l.includes('BatchMode'), `the caller's GIT_SSH_COMMAND is left alone: ${l}`)
  assert.deepEqual(own.json.repos, run.json.repos, 'GIT_DIR never reaches a probe')
})

// ---- 6. --offline -----------------------------------------------------------------------------------------------
test('6. --offline: no remote is asked; the cached origin/HEAD and the last fetch stand in', () => {
  const run = offline()
  const j = ok(run)
  assert.deepEqual(run.ssh, [])
  assert.equal(j.offline, true)
  const a = repoAt(j, R('A'))
  assert.equal(a.defaultBranch, 'main')
  assert.equal(a.defaultBranchSource, 'cached')
  assert.equal(a.unpushed[0].basis, 'last-fetch')
  assert.deepEqual(checks(a.blockers), ['unpushed-default', 'unfinished-rollout'])
})

// ---- 7. Timeout and deadline ------------------------------------------------------------------------------------
function gone(pid) {
  for (let i = 0; i < 40 && alive(pid); i++) sleep(50)
  return !alive(pid)
}
const hangPid = () => Number(fs.readFileSync(HANG_PID, 'utf8').trim())

test('7a. --timeout: a hung remote is killed with its whole group and the cached default branch stands in', () => {
  fs.rmSync(HANG_PID, { force: true })
  const run = scan(V3, ['--timeout', '1'])
  const j = ok(run)
  assert.ok(run.ms < 6000, `elapsed ${run.ms} ms`)
  const h = repoAt(j, R('H'))
  assert.ok(h.errors.some((e) => e.check === 'default-branch' && /timeout/.test(e.error)), JSON.stringify(h.errors))
  assert.equal(h.defaultBranch, 'main')
  assert.equal(h.defaultBranchSource, 'cached')
  assert.equal(j.deadlineHit, false)
  assert.ok(fs.existsSync(HANG_PID), 'the fake ssh ran')
  assert.ok(gone(hangPid()), 'the ssh grandchild is gone')
})

test('7b. --deadline: probes in flight at the deadline are killed and the run still reports', () => {
  fs.rmSync(HANG_PID, { force: true })
  const run = scan(V3, ['--timeout', '30', '--deadline', '2'])
  const j = ok(run)
  assert.ok(run.ms < 6000, `elapsed ${run.ms} ms`)
  assert.equal(j.deadlineHit, true)
  const h = repoAt(j, R('H'))
  assert.ok(h.errors.some((e) => e.check === 'default-branch' && /deadline/.test(e.error)), JSON.stringify(h.errors))
  assert.ok(h.unchecked.some((u) => u.why === 'deadline'), JSON.stringify(h.unchecked))
  assert.ok(gone(hangPid()), 'the ssh grandchild is gone')
})

test('7c. --deadline 0: no subprocess at all, and the vault sections stay complete', () => {
  fs.rmSync(path.join(S, 'git-called'), { force: true })
  const run = scan(V1, ['--deadline', '0'], { PATH: `${path.join(S, 'shim')}:${env.PATH}` })
  const j = ok(run)
  assert.ok(!fs.existsSync(path.join(S, 'git-called')), 'git never ran')
  assert.deepEqual(run.ssh, [])
  assert.equal(j.deadlineHit, true)
  for (const r of j.repos) {
    const why = r.exists ? 'deadline' : 'missing'
    assert.deepEqual(r.unchecked, CHECKS.map((check) => ({ check, why })), r.path)
    assert.deepEqual(r.blockers, [], r.path)
    for (const k of ['git', 'toplevel', 'rolloutRoot', 'github', 'defaultBranch', 'verifier']) assert.equal(r[k], null, `${r.path} ${k}`)
  }
  for (const r of j.rollouts) {
    assert.equal(r.summary, null)
    assert.equal(r.error, 'deadline')
  }
  const full = ok(online())
  for (const k of ['projects', 'tasks', 'unhomed', 'deadlines', 'skipped']) assert.deepEqual(j[k], full[k], k)
  assert.deepEqual(j.rollouts.map(({ summary, error, ...rest }) => rest), full.rollouts.map(({ summary, error, ...rest }) => rest))
})

test('7d. SIGTERM: every live probe group is killed, then the scan exits 130', async () => {
  fs.rmSync(HANG_PID, { force: true })
  const child = spawn('python3', [SCRIPT, '--vault', V3, '--today', TODAY, '--timeout', '30', '--deadline', '30'],
    { cwd: S, env, stdio: 'ignore' })
  const exited = new Promise((resolve) => child.on('exit', (code, signal) => resolve({ code, signal })))
  const pidNow = () => (fs.existsSync(HANG_PID) ? Number(fs.readFileSync(HANG_PID, 'utf8').trim()) : 0)
  for (let i = 0; i < 300 && !pidNow(); i++) await new Promise((r) => setTimeout(r, 50))
  const pid = pidNow()
  assert.ok(pid > 0, 'the fake ssh started')
  child.kill('SIGTERM')
  assert.deepEqual(await exited, { code: 130, signal: null })
  assert.ok(gone(pid), 'the ssh grandchild is gone')
})

// ---- 8. Vault-level unreadable ------------------------------------------------------------------------------------
test('8. an unreadable note under Work/Tasks is reported once, and status and unfinished-rollout are not run', { skip: ROOT_USER && 'root reads a chmod-000 file' }, () => {
  const run = scan(V2)
  const j = ok(run)
  assert.deepEqual(j.vaultErrors, [{ kind: 'unreadable-tasks-notes', notes: ['Work/Tasks/Archive/locked.md'],
    skips: ['rollout status', 'unfinished-rollout'] }])
  assert.deepEqual(j.rollouts.map((r) => [r.slug, r.summary, r.error]), [['v2-rollout', null, 'vault']])
  const c = repoAt(j, R('C'))
  assert.ok(c.unchecked.some((u) => u.check === 'unfinished-rollout' && u.why === 'vault'), JSON.stringify(c.unchecked))
  assert.deepEqual(c.unfinishedRollout, [])
  assert.deepEqual(j.skipped, [{ note: 'Work/Tasks/Archive/locked.md', why: 'unreadable' }])
  assert.ok(!run.stdout.includes('Traceback'))
  assert.equal(j.tasks.length, 1)
})

// ---- 9. Read-only -------------------------------------------------------------------------------------------------
test('9. read-only: nothing under HOME (the repos and their refs included) or the vault changes; no bytecode', () => {
  ok(online())
  ok(offline())
  assert.ok(!('PYTHONDONTWRITEBYTECODE' in env), 'the runs leave bytecode to the script')
  const after = [snap(HOME), snap(V1)]
  assert.deepEqual(after, BEFORE)
  for (const d of [path.join(root, 'skills', '_shared', 'scripts'), path.join(root, 'skills', 'execute', 'scripts')]) {
    assert.ok(!fs.existsSync(path.join(d, '__pycache__')), `no __pycache__ in ${d}`)
  }
})

// ---- 10. Determinism ----------------------------------------------------------------------------------------------
test('10. determinism: two online runs are byte-equal once elapsedMs is dropped', () => {
  const strip = (run) => { const j = ok(run); delete j.elapsedMs; return JSON.stringify(j) }
  assert.equal(strip(scan(V1)), strip(online()))
})

// ---- 11. Usage and defaults ---------------------------------------------------------------------------------------
test('11. usage: an unknown flag is exit 2 with one line, a missing vault exit 3; the defaults bound the minute', () => {
  const bad = scan(V1, ['--bogus'])
  assert.equal(bad.status, 2)
  assert.equal(bad.stdout, '')
  const lines = bad.stderr.split('\n').filter(Boolean)
  assert.equal(lines.length, 1, bad.stderr)
  assert.match(lines[0], /^estate-scan: /)
  const none = scan(path.join(S, 'no-vault'))
  assert.equal(none.status, 3)
  assert.match(none.stderr, /^estate-scan: /)
  const j = ok(online())
  assert.deepEqual(j.limits, { deadline: 40, timeout: 10, jobs: 8 })
  assert.equal(j.schema, 1)
  assert.equal(j.today, TODAY)
  assert.equal(j.vault, V1)
  assert.equal(j.deadlineHit, false)
  assert.deepEqual(j.vaultErrors, [])
})
