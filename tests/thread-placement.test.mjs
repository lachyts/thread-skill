// skills/_shared/scripts/thread-placement.py — the placement check (ADR 0039 d5; CONTEXT.md **Placement check**,
// **Thread home**). Each case runs the shipped script against a fixture vault and a fake HOME under one temp dir,
// passing --vault and HOME every time and no launch-folders file, so nothing reads or writes the real vault,
// workspaces, ~/repos or ~/Projects.
//
// The fixture vault copies real shapes from ~/repos/obsidian/Work/Projects: GifLab declaring only its repo, Murmur's
// two repos, a seat subfolder note, the workspaces root's declarers. Departures are marked [stand-in] (no such note
// in the real vault). The fake HOME copies the real layout: ~/Projects as one umbrella repo, repos one to three
// levels below ~/repos (one at depth 3 holding its THREAD.md at depth 4), linked worktrees kept outside .claude, a
// submodule, a --separate-git-dir checkout, a same-origin clone, bare origins with and without origin/HEAD, and
// workspace seat subfolders. A second HOME holds the Smart Slider shape (one repo's thread only in a linked
// worktree on a side branch), which the steps change in place; a third is empty.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { root } from './lib/contract-text.mjs'

const SCRIPT = path.join(root, 'skills', '_shared', 'scripts', 'thread-placement.py')
const OPEN = path.join(root, 'skills', 'open', 'SKILL.md')

// Scrub git's own repo-local names first, then pin the config, so a hook's GIT_DIR never reaches a fixture repo.
const drop = spawnSync('git', ['rev-parse', '--local-env-vars'], { encoding: 'utf8' }).stdout.split('\n').filter(Boolean)
const base = { ...process.env }
for (const name of drop) delete base[name]
base.GIT_CONFIG_GLOBAL = '/dev/null'
base.GIT_CONFIG_NOSYSTEM = '1'
// A `pip install --user` PyYAML resolves under HOME, which every call swaps: pin the real user base as run.sh does.
base.PYTHONUSERBASE ??= spawnSync('python3', ['-c', 'import site; print(site.getuserbase())'], { encoding: 'utf8' }).stdout.trim()

// Physical paths throughout: the script realpaths HOME, so expectations do too.
const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'thread-placement-')))
after(() => fs.rmSync(scratch, { recursive: true, force: true }))
// git never walks above the scratch dir, so a THREAD.md outside every fixture repo is outside git.
base.GIT_CEILING_DIRECTORIES = scratch

const HOME = path.join(scratch, 'home')
const HOME_T = path.join(scratch, 'home-twin')
const HOME_C = path.join(scratch, 'home-clean')
const ORIGINS = path.join(scratch, 'origins')
const h = (rel) => path.join(HOME, rel)
const mkdir = (p) => fs.mkdirSync(p, { recursive: true })
const write = (p, text) => { mkdir(path.dirname(p)); fs.writeFileSync(p, text) }
const thread = (slug) => `---\nslug: ${slug}\nstate: active\n---\n# ${slug}\n`

function git(args) {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false',
    '-c', 'init.defaultBranch=main', '-c', 'protocol.file.allow=always', ...args], { env: base, encoding: 'utf8' })
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`)
  return r.stdout
}
function repo(p, { commit = false } = {}) {
  mkdir(p)
  git(['init', '-q', p])
  if (commit) git(['-C', p, 'commit', '-q', '--allow-empty', '-m', 'init'])
}
function commitFile(r, rel, text, msg = `add ${rel}`) {
  write(path.join(r, rel), text)
  git(['-C', r, 'add', '--', rel])
  git(['-C', r, 'commit', '-q', '-m', msg])
}
// A bare origin for repo r, pushed and (unless noHead) with origin/HEAD set.
function origin(r, name, { noHead = false } = {}) {
  const o = path.join(ORIGINS, `${name}.git`)
  git(['init', '-q', '--bare', o])
  git(['-C', r, 'remote', 'add', 'origin', o])
  git(['-C', r, 'push', '-q', '-u', 'origin', 'main'])
  if (!noHead) git(['-C', r, 'remote', 'set-head', 'origin', '--auto'])
  return o
}

// ---- The fake HOME ----------------------------------------------------------------------------------------------
mkdir(ORIGINS)
repo(h('Projects'), { commit: true })
// GifLab: the note declares only the repo; the folder beside it holds the thread and a named sibling.
repo(h('repos/animately/giflab'), { commit: true })
write(h('Projects/Animately/giflab/THREAD.md'), thread('giflab'))
write(h('Projects/Animately/giflab/THREAD-leaderboard.md'), thread('leaderboard'))
mkdir(h('Projects/Animately/giflab/sub'))
write(h('Projects/Animately/User Research/THREAD.md'), thread('user-research'))
// Widget declares its folder and its repo; Big declares an ancestor folder and its repo.
repo(h('repos/tools/widget'), { commit: true })
write(h('repos/tools/widget/THREAD-old.md'), thread('widget-old'))
write(h('Projects/Art/widget-folder/THREAD.md'), thread('widget'))
repo(h('repos/tools/big'))
write(h('Projects/Big/THREAD.md'), thread('big'))
write(h('Projects/Big/sub/THREAD.md'), '# Big sub-folder, no front matter\n')
// Folio declares its folder and no repo; Folio Engine declares a same-named repo.
repo(h('repos/tools/folio'))
write(h('Projects/Art/folio/THREAD.md'), thread('folio'))
// A repo-name attribution, an undeclared same-named repo, and two negatives.
repo(h('repos/tools/raycast-google-contacts'))
write(h('Projects/Life/raycast-google-contacts/THREAD.md'), thread('raycast-google-contacts'))
repo(h('repos/tools/orphan-tool'))
write(h('Projects/Life/orphan-tool/THREAD.md'), thread('orphan-tool'))
repo(h('repos/concepts/stephanie'))
write(h('Projects/Stephanie/26-06-06_x/THREAD.md'), thread('stephanie-x'))
// Never a thread home: a linked worktree, a submodule and a --separate-git-dir checkout, each named like a folder.
repo(h('repos/tools/main-tool'), { commit: true })
git(['-C', h('repos/tools/main-tool'), 'worktree', 'add', '-q', '-b', 'wt', h('repos/tools/wt-tool')])
const SUB_SRC = path.join(scratch, 'sub-src')
repo(SUB_SRC, { commit: true })
git(['-C', h('repos/tools/main-tool'), 'submodule', 'add', '-q', SUB_SRC, 'sub-mod'])
git(['-C', h('repos/tools/main-tool'), 'commit', '-q', '-m', 'add sub-mod'])
git(['init', '-q', '--separate-git-dir', path.join(scratch, 'sepdir.git'), h('repos/tools/sepdir-tool')])
for (const n of ['wt-tool', 'sub-mod', 'sepdir-tool']) write(h(`Projects/Life/${n}/THREAD.md`), thread(n))
mkdir(h('Projects/Tools/wt-only'))
// A fuzzy name never attributes; two notes declaring same-named repos make a folder ambiguous.
repo(h('repos/tools/gizmo'))
write(h('Projects/Tools/gismo/THREAD.md'), thread('gismo'))
repo(h('repos/tools/dupe'))
repo(h('repos/concepts/dupe'))
mkdir(h('Projects/Life/dupe'))
write(h('Projects/Life/no-front/THREAD.md'), '# no front matter\n')
// Murmur: two repos, each with a thread; the second repo's is a repo-form split-home.
repo(h('repos/tools/murmur'))
write(h('repos/tools/murmur/THREAD.md'), thread('murmur'))
repo(h('repos/tools/cmux-fork-murmur'))
write(h('repos/tools/cmux-fork-murmur/THREAD.md'), thread('cmux-fork-murmur'))
// Clean repo threads: one at depth 4, and maquette's (no front matter) in its main checkout and a linked worktree.
repo(h('repos/tools/mcp/mac-data-mcp'))
write(h('repos/tools/mcp/mac-data-mcp/THREAD.md'), thread('mac-data-mcp'))
repo(h('repos/tools/maquette'), { commit: true })
commitFile(h('repos/tools/maquette'), 'THREAD.md', '# Maquette\n')
git(['-C', h('repos/tools/maquette'), 'worktree', 'add', '-q', '-b', 'wt', h('repos/tools/maquette-wt')])
// thread-skill: a worktree left on an older THREAD.md, then a newer one pushed, and a same-origin clone.
const TS = h('repos/tools/thread-skill')
repo(TS, { commit: true })
commitFile(TS, 'THREAD.md', thread('thread-skill'))
git(['-C', TS, 'worktree', 'add', '-q', '-b', 'wt', h('repos/tools/thread-skill-wt')])
commitFile(TS, 'THREAD.md', thread('thread-skill') + '\nv2\n', 'v2')
const TS_ORIGIN = origin(TS, 'thread-skill')
git(['clone', '-q', TS_ORIGIN, h('repos/tools/thread-skill-rollout')])
// An undeclared repo and its linked worktree, a THREAD.md outside git, and one in a depth-4 node_modules.
repo(h('repos/tools/stray'), { commit: true })
commitFile(h('repos/tools/stray'), 'THREAD.md', thread('stray'))
git(['-C', h('repos/tools/stray'), 'worktree', 'add', '-q', '-b', 'wt', h('repos/tools/stray-wt')])
write(h('repos/loose/THREAD.md'), thread('loose'))
write(h('repos/tools/node_modules/x/THREAD.md'), thread('nm'))
// Git state: a side branch, an unpushed default (the local-llm shape), a branch behind, no origin/HEAD.
const SIDER = h('repos/tools/sider')
repo(SIDER, { commit: true })
origin(SIDER, 'sider')
git(['-C', SIDER, 'checkout', '-q', '-b', 'feat/side'])
commitFile(SIDER, 'THREAD.md', thread('sider'))
git(['-C', SIDER, 'checkout', '-q', 'main'])
const LOCALISH = h('repos/tools/localish')
repo(LOCALISH, { commit: true })
origin(LOCALISH, 'localish')
commitFile(LOCALISH, 'THREAD.md', thread('localish'))
const BEHINDY = h('repos/tools/behindy')
repo(BEHINDY, { commit: true })
commitFile(BEHINDY, 'THREAD.md', thread('behindy'))
git(['-C', BEHINDY, 'branch', 'feat/x'])
commitFile(BEHINDY, 'THREAD.md', thread('behindy') + '\nv2\n', 'v2')
origin(BEHINDY, 'behindy')
git(['-C', BEHINDY, 'checkout', '-q', 'feat/x'])
const NOHEAD = h('repos/tools/nohead')
repo(NOHEAD, { commit: true })
commitFile(NOHEAD, 'THREAD.md', thread('nohead'))
origin(NOHEAD, 'nohead', { noHead: true })
const NOHEAD_B = h('repos/tools/nohead-branch')
repo(NOHEAD_B, { commit: true })
git(['-C', NOHEAD_B, 'checkout', '-q', '-b', 'feat/t'])
commitFile(NOHEAD_B, 'THREAD.md', thread('nohead-branch'))
git(['-C', NOHEAD_B, 'checkout', '-q', 'main'])
// _archive in both trees, and a .claude worktree copy: never scanned.
write(h('repos/tools/_archive/old/THREAD.md'), thread('old'))
write(h('Projects/_archive/Old/THREAD.md'), thread('old'))
write(h('Projects/Life/_archive/x/THREAD-old.md'), thread('old'))
write(h('repos/tools/murmur/.claude/worktrees/w/THREAD.md'), thread('murmur'))
// Workspaces: seat subfolders (one a "Moved to" stub, one a declared note's, one misnamed) and a _shared thread.
const WS = h('repos/workspaces')
write(path.join(WS, 'animately-workspace/design/THREAD.md'), thread('animately-design'))
write(path.join(WS, 'animately-workspace/product-design/THREAD.md'), 'Moved to ~/repos/animately/optimizer/THREAD.md on 2026-10-18.\n')
write(path.join(WS, 'animately-workspace/crawler/THREAD.md'), thread('crawler'))
write(path.join(WS, 'ops-workspace/notes/THREAD-x.md'), thread('ops-x'))
write(path.join(WS, '_shared/threads/x.md'), thread('x'))
mkdir(path.join(scratch, 'plain'))
mkdir(HOME_C)

// ---- The fixture vault ------------------------------------------------------------------------------------------
const P = 'Work/Projects'
const fm = (lines, body = '\n# Note\n') => `---\n${lines}\n---\n${body}`
const proj = (area, repos = []) => fm(`tags:\n  - project\narea:\n  - ${area}\nstatus: active\ndone: false` +
  (repos.length ? `\nrepos:\n${repos.map((r) => `  - ${r}`).join('\n')}` : ''))
const VAULT = path.join(scratch, 'vault')
const notes = {
  [`${P}/AI/AI.md`]: fm('tags:\n  - area'),
  [`${P}/AI/Agent Stable.md`]: proj('AI', ['~/repos/workspaces']),
  [`${P}/AI/Murmur.md`]: proj('AI', ['~/repos/tools/murmur', '~/repos/tools/cmux-fork-murmur']),
  [`${P}/Animately/Animately.md`]: fm('tags:\n  - area'),
  [`${P}/Animately/GifLab.md`]: proj('Animately', ['~/repos/animately/giflab']),
  [`${P}/Animately/User Research.md`]: proj('Animately'),
  [`${P}/Animately/Crawler.md`]: proj('Animately', ['~/repos/workspaces/animately-workspace/crawler']),  // [stand-in]
  [`${P}/Art/Art.md`]: fm('tags:\n  - area'),
  [`${P}/Art/Widget.md`]: proj('Art', ['~/Projects/Art/widget-folder', '~/repos/tools/widget']),  // [stand-in]
  [`${P}/Art/Folio.md`]: proj('Art', ['~/Projects/Art/folio']),  // [stand-in]
  [`${P}/Art/Same.md`]: proj('Art'),  // [stand-in]
  [`${P}/Life (area)/Life (area).md`]: fm('tags:\n  - area'),
  [`${P}/Life (area)/Contacts Bridge.md`]: proj('Life', ['~/repos/tools/raycast-google-contacts']),  // [stand-in]
  [`${P}/Tools/Tools.md`]: fm('tags:\n  - area'),
  [`${P}/Tools/Big.md`]: proj('Tools', ['~/Projects/Big', '~/repos/tools/big']),  // [stand-in]
  [`${P}/Tools/Folio Engine.md`]: proj('Tools', ['~/repos/tools/folio']),  // [stand-in]
  [`${P}/Tools/Twin.md`]: proj('Tools', ['~/repos/tools/twin-ui', '~/repos/tools/twin-core']),  // [stand-in] Smart Slider's shape
  [`${P}/Tools/Mac Data MCP.md`]: proj('Tools', ['~/repos/tools/mcp/mac-data-mcp/']),
  [`${P}/Tools/Maquette.md`]: proj('Tools', ['~/repos/tools/maquette']),
  [`${P}/Tools/Thread Skill.md`]: proj('Tools', ['~/repos/tools/thread-skill']),
  [`${P}/Tools/WT Only.md`]: proj('Tools', ['~/repos/tools/wt-tool']),  // [stand-in]
  [`${P}/Tools/WT First.md`]: proj('Tools', ['~/repos/tools/wt-tool', '~/repos/tools/main-tool']),  // [stand-in]
  [`${P}/Tools/Gizmo.md`]: proj('Tools', ['~/repos/tools/gizmo']),  // [stand-in]
  [`${P}/Tools/Dupe One.md`]: proj('Tools', ['~/repos/tools/dupe']),  // [stand-in]
  [`${P}/Tools/Dupe Two.md`]: proj('Tools', ['~/repos/concepts/dupe']),  // [stand-in]
  [`${P}/Tools/Sider.md`]: proj('Tools', ['~/repos/tools/sider']),  // [stand-in]
  [`${P}/Tools/Localish.md`]: proj('Tools', ['~/repos/tools/localish']),  // [stand-in]
  [`${P}/Tools/Behindy.md`]: proj('Tools', ['~/repos/tools/behindy']),  // [stand-in]
  [`${P}/Tools/Nohead.md`]: proj('Tools', ['~/repos/tools/nohead']),  // [stand-in]
  [`${P}/Tools/Nohead Branch.md`]: proj('Tools', ['~/repos/tools/nohead-branch']),  // [stand-in]
  [`${P}/Tools/Same.md`]: proj('Tools'),  // [stand-in]
  [`${P}/Tools/Morning and Weekly Commands.md`]: proj('Tools', ['~/repos/workspaces/ops-workspace']),
  [`${P}/Tools/Finished Gadget.md`]: fm('tags:\n  - project\narea: Tools\nstatus: done'),  // [stand-in]
}
for (const [rel, text] of Object.entries(notes)) write(path.join(VAULT, rel), text)
const N = (name) => {
  const rel = Object.keys(notes).find((k) => path.basename(k, '.md') === name)
  assert.ok(rel, `no fixture note ${name}`)
  return rel
}

// ---- Running it -------------------------------------------------------------------------------------------------
function run(args, { home = HOME, vault = VAULT, env = {} } = {}) {
  return spawnSync('python3', [SCRIPT, ...args, '--vault', vault], { encoding: 'utf8', cwd: scratch, env: { ...base, HOME: home, ...env } })
}
function audit(args = [], opts) {
  const r = run(['audit', ...args, '--json'], opts)
  assert.equal(r.stderr, '', `stderr for audit ${args.join(' ')}`)
  assert.equal(r.status, 0, `status for audit ${args.join(' ')}`)
  return JSON.parse(r.stdout)
}
function text(args = [], opts) {
  const r = run(['audit', ...args], opts)
  assert.equal(r.stderr, '', `stderr for audit ${args.join(' ')}`)
  assert.equal(r.status, 0, `status for audit ${args.join(' ')}`)
  return r.stdout
}
function home(args, opts) {
  const r = run(['home', ...args], opts)
  assert.equal(r.stderr, '', `stderr for home ${args.join(' ')}`)
  assert.equal(r.status, 0, `status for home ${args.join(' ')}`)
  return r.stdout.trim()
}
const of = (j, kind) => j.findings.filter((f) => f.kind === kind)
const at = (j, p) => j.findings.filter((f) => f.path === p)
const kinds = (fs_) => fs_.map((f) => f.kind)
const ESTATE = audit()

// ---- 1-4: ~/Projects folders and the note they belong to ---------------------------------------------------------
test('1. the live GifLab shape: a folder thread whose note declares only the repo is a split-home by exact name', () => {
  const folder = h('Projects/Animately/giflab')
  const sh = at(ESTATE, `${folder}/THREAD.md`)
  assert.deepEqual(sh.map((f) => [f.kind, f.basis]), [['split-home', 'declared']])
  assert.match(sh[0].detail, /GifLab/)
  assert.match(sh[0].detail, /~\/repos\/animately\/giflab/)
  assert.match(sh[0].detail, /exact name/)
  assert.deepEqual(sh[0].owners, [N('GifLab')])
  assert.deepEqual(sh[0].copies, [`${folder}/THREAD.md`])
  assert.deepEqual(kinds(at(ESTATE, `${folder}/THREAD-leaderboard.md`)), ['misnamed'])
  const p = audit(['--project', 'GifLab'])
  assert.deepEqual(p.findings.map((f) => [f.kind, f.path]), [['split-home', `${folder}/THREAD.md`], ['misnamed', `${folder}/THREAD-leaderboard.md`]])
  assert.deepEqual(p.unchecked, [])
  assert.equal(home(['--dir', folder]), h('repos/animately/giflab'))
})

test('2. a declared ~/Projects entry attributes its folder; an ancestor entry only owns findings', () => {
  const wf = h('Projects/Art/widget-folder/THREAD.md')
  const sh = at(ESTATE, wf)
  assert.deepEqual(sh.map((f) => [f.kind, f.basis]), [['split-home', 'declared']])
  assert.match(sh[0].detail, /declared entry/)
  assert.deepEqual(sh[0].owners, [N('Widget')])
  assert.equal(home(['--dir', h('Projects/Art/widget-folder')]), h('repos/tools/widget'))
  // Big declares ~/Projects/Big: its own folder attributes, the sub-folder below it does not.
  const big = at(ESTATE, h('Projects/Big/THREAD.md'))
  assert.deepEqual(big.map((f) => [f.kind, f.basis]), [['split-home', 'declared']])
  assert.match(big[0].detail, /declared entry/)
  assert.deepEqual(kinds(at(ESTATE, h('Projects/Big/sub/THREAD.md'))), ['no-slug'])
  assert.equal(home(['--dir', h('Projects/Big/sub')]), '')
  const p = audit(['--project', 'Big'])
  assert.deepEqual(p.findings.map((f) => [f.kind, f.path]),
    [['split-home', h('Projects/Big/THREAD.md')], ['no-slug', h('Projects/Big/sub/THREAD.md')]])
})

test('3. a folder named like a note\'s declared repo attributes by repo name', () => {
  const sh = at(ESTATE, h('Projects/Life/raycast-google-contacts/THREAD.md'))
  assert.deepEqual(sh.map((f) => [f.kind, f.basis]), [['split-home', 'declared']])
  assert.match(sh[0].detail, /repo name/)
  assert.deepEqual(sh[0].owners, [N('Contacts Bridge')])
  assert.equal(home(['--dir', h('Projects/Life/raycast-google-contacts')]), h('repos/tools/raycast-google-contacts'))
})

test('4. a same-named repo is audit-only: reported, never a home', () => {
  const orphan = at(ESTATE, h('Projects/Life/orphan-tool/THREAD.md'))
  assert.deepEqual(orphan.map((f) => [f.kind, f.basis]), [['split-home', 'same-named']])
  assert.match(orphan[0].detail, /~\/repos\/tools\/orphan-tool/)
  assert.match(orphan[0].detail, /declared by no note/)
  assert.deepEqual(orphan[0].owners, [])
  assert.equal(home(['--dir', h('Projects/Life/orphan-tool')]), '')
  // A note declaring the folder but no repo, beside a repo another note declares: same-named, owned by both.
  const folio = at(ESTATE, h('Projects/Art/folio/THREAD.md'))
  assert.deepEqual(folio.map((f) => [f.kind, f.basis]), [['split-home', 'same-named']])
  assert.match(folio[0].detail, /Folio Engine/)
  assert.deepEqual(folio[0].owners, [N('Folio'), N('Folio Engine')])
  assert.equal(home(['--dir', h('Projects/Art/folio')]), '')
  // Negatives: a dated folder under an area-level folder named like a repo; a note declaring no repo.
  assert.deepEqual(at(ESTATE, h('Projects/Stephanie/26-06-06_x/THREAD.md')), [])
  assert.deepEqual(at(ESTATE, h('Projects/Animately/User Research/THREAD.md')), [])
  assert.equal(home(['--dir', h('Projects/Animately/User Research')]), '')
})

test('5. a linked worktree, a submodule and a --separate-git-dir checkout never qualify', () => {
  for (const n of ['wt-tool', 'sub-mod', 'sepdir-tool']) {
    const git_ = n === 'sub-mod' ? h('repos/tools/main-tool/sub-mod/.git') : h(`repos/tools/${n}/.git`)
    assert.ok(fs.statSync(git_).isFile(), `the fixture ${n} has a .git file`)
    assert.deepEqual(at(ESTATE, h(`Projects/Life/${n}/THREAD.md`)), [], `no finding beside ${n}`)
  }
  assert.equal(home(['--project', 'WT Only']), '')
  assert.equal(home(['--dir', h('Projects/Tools/wt-only')]), '')
  assert.equal(home(['--project', 'WT First']), h('repos/tools/main-tool'))
})

// ---- 5b: the thread identity (R4-3) -------------------------------------------------------------------------------
test('5b. one finding per thread identity: the Smart Slider shape, then the same thread in the main checkout and a clone', () => {
  const t = (rel) => path.join(HOME_T, rel)
  const UI = t('repos/tools/twin-ui')
  const CORE = t('repos/tools/twin-core')
  const WT = t('repos/tools/twin-core-wt')
  const CLONE = t('repos/tools/twin-core-clone')
  repo(UI, { commit: true })
  repo(CORE, { commit: true })
  const o = origin(CORE, 'twin-core')
  git(['-C', CORE, 'worktree', 'add', '-q', '-b', 'feat/thread', WT])
  commitFile(WT, 'THREAD.md', thread('twin'))
  const opts = { home: HOME_T }

  // Step 1: the thread exists only in the worktree, on a side branch.
  for (const args of [[], ['--project', 'Twin']]) {
    const j = audit(args, opts)
    const sh = of(j, 'split-home')
    assert.equal(sh.length, 1, `one split-home (${args})`)
    assert.deepEqual({ basis: sh[0].basis, path: sh[0].path, copies: sh[0].copies, owners: sh[0].owners },
      { basis: 'repo', path: `${CORE}/THREAD.md`, copies: [`${WT}/THREAD.md`], owners: [N('Twin')] })
    assert.match(sh[0].detail, /twin-ui/)
    assert.match(sh[0].detail, /on disk only in/)
    assert.match(sh[0].detail, /linked worktree on feat\/thread/)
    const sb = of(j, 'side-branch')
    assert.equal(sb.length, 1)
    assert.equal(sb[0].path, `${CORE}/THREAD.md`)
    assert.match(sb[0].detail, /feat\/thread/)
    assert.deepEqual(sb[0].copies, [])
    assert.deepEqual(of(j, 'undeclared'), [])
    assert.deepEqual(j.findings.filter((f) => f.path.startsWith(`${WT}/`)), [], 'no finding at a worktree path')
    assert.ok(j.scanned.repo_threads.includes(`${WT}/THREAD.md`), 'the worktree copy is scanned')
  }
  const lines = text(['--project', 'Twin'], opts).split('\n').filter((l) => l.startsWith('split-home: '))
  assert.equal(lines.length, 1)
  assert.ok(lines[0].startsWith(`split-home: ${CORE}/THREAD.md — `))
  // --thread on the worktree copy maps to its identity, plus its main checkout's git checks.
  const viaWt = audit(['--thread', `${WT}/THREAD.md`], opts)
  assert.deepEqual(viaWt.findings.map((f) => [f.kind, f.path]), [['split-home', `${CORE}/THREAD.md`], ['side-branch', `${CORE}/THREAD.md`]])

  // Step 2: the main checkout gains THREAD.md too (uncommitted), and both gain a named sibling.
  write(`${CORE}/THREAD.md`, thread('twin'))
  write(`${CORE}/THREAD-old.md`, thread('twin-old'))
  write(`${WT}/THREAD-old.md`, thread('twin-old'))
  let j = audit([], opts)
  assert.equal(of(j, 'split-home').length, 1)
  assert.deepEqual(of(j, 'split-home')[0].copies, [`${CORE}/THREAD.md`, `${WT}/THREAD.md`].sort())
  assert.doesNotMatch(of(j, 'split-home')[0].detail, /on disk only in/)
  const mis = of(j, 'misnamed')
  assert.equal(mis.length, 1)
  assert.equal(mis[0].path, `${CORE}/THREAD-old.md`)
  assert.equal(mis[0].copies.length, 2)
  assert.deepEqual(mis[0].owners, [N('Twin')])
  assert.equal(of(j, 'side-branch').length, 1, 'local main and origin/main still lack it')

  // Step 3: committed on main and pushed: the side branch clears, nothing is behind.
  git(['-C', CORE, 'add', '--', 'THREAD.md'])
  git(['-C', CORE, 'commit', '-q', '-m', 'thread'])
  git(['-C', CORE, 'push', '-q', 'origin', 'main'])
  git(['-C', CORE, 'fetch', '-q', 'origin'])
  j = audit([], opts)
  assert.equal(of(j, 'split-home').length, 1)
  assert.deepEqual(of(j, 'side-branch'), [])
  assert.deepEqual(of(j, 'behind'), [])

  // Step 4: an undeclared same-origin clone folds into the identity and is git-checked on its own refs.
  git(['clone', '-q', o, CLONE])
  j = audit([], opts)
  const sh = of(j, 'split-home')
  assert.equal(sh.length, 1)
  assert.ok(sh[0].copies.includes(`${CLONE}/THREAD.md`), 'the clone is a copy')
  assert.deepEqual(of(j, 'undeclared'), [])
  assert.deepEqual(of(j, 'behind'), [])
  assert.deepEqual(of(j, 'side-branch'), [])
  assert.deepEqual(j.unchecked, [])
  assert.equal(home(['--project', 'Twin'], opts), UI)
})

// ---- 6-10 --------------------------------------------------------------------------------------------------------
test('6. a fuzzy name never attributes', () => {
  assert.deepEqual(at(ESTATE, h('Projects/Tools/gismo/THREAD.md')), [])
  assert.equal(home(['--dir', h('Projects/Tools/gismo')]), '')
})

test('7. a thread in a repo its note lists second is a repo-form split-home', () => {
  const p = h('repos/tools/cmux-fork-murmur/THREAD.md')
  const sh = at(ESTATE, p)
  assert.deepEqual(sh.map((f) => [f.kind, f.basis]), [['split-home', 'repo']])
  assert.deepEqual(sh[0].copies, [p])
  assert.deepEqual(sh[0].owners, [N('Murmur')])
  assert.match(sh[0].detail, /~\/repos\/tools\/murmur/)
  assert.match(sh[0].fix, /reorder/)
  assert.doesNotMatch(sh[0].detail, /on disk/, 'no on-disk clause when the copy is the identity')
  assert.deepEqual(at(ESTATE, h('repos/tools/murmur/THREAD.md')), [])
  assert.deepEqual(audit(['--project', 'Murmur']).findings.map((f) => [f.kind, f.path]), [['split-home', p]])
})

test('8. clean repo threads give no finding, and a clean HOME prints placement: none', () => {
  for (const p of ['repos/tools/mcp/mac-data-mcp/THREAD.md', 'repos/tools/maquette/THREAD.md', 'repos/tools/murmur/THREAD.md',
    'repos/tools/thread-skill/THREAD.md']) assert.deepEqual(at(ESTATE, h(p)), [], p)
  assert.ok(ESTATE.scanned.repo_threads.includes(h('repos/tools/mcp/mac-data-mcp/THREAD.md')), 'depth 4 is scanned')
  assert.equal(text([], { home: HOME_C }), 'placement: none\n')
})

test('9. undeclared: once per identity; a declared repo\'s worktree and same-origin clone are not flagged', () => {
  const ts = h('repos/tools/thread-skill')
  for (const f of ESTATE.findings) {
    assert.ok(!f.path.startsWith(`${ts}-`) && !f.path.startsWith(`${ts}/`), `no finding for thread-skill or its copies: ${f.kind} ${f.path}`)
  }
  const und = of(ESTATE, 'undeclared')
  assert.deepEqual(und.map((f) => f.path).sort(), [h('repos/loose/THREAD.md'), h('repos/tools/node_modules/x/THREAD.md'),
    h('repos/tools/stray/THREAD.md')].sort())
  const stray = at(ESTATE, h('repos/tools/stray/THREAD.md'))[0]
  assert.deepEqual(stray.copies, [h('repos/tools/stray-wt/THREAD.md'), h('repos/tools/stray/THREAD.md')].sort())
  assert.deepEqual(stray.owners, [])
  assert.deepEqual(at(ESTATE, h('repos/loose/THREAD.md'))[0].copies, [h('repos/loose/THREAD.md')])
  assert.deepEqual(of(audit(['--project', 'Thread Skill']), 'undeclared'), [], 'no undeclared under --project')
})

test('10. no-slug is a ~/Projects kind: a repo thread without front matter is legitimate', () => {
  const nf = at(ESTATE, h('Projects/Life/no-front/THREAD.md'))
  assert.deepEqual(kinds(nf), ['no-slug'])
  assert.deepEqual(nf[0].owners, [])
  assert.deepEqual(of(ESTATE, 'no-slug').filter((f) => f.path.startsWith(h('repos') + '/')), [])
})

// ---- 11-15 -------------------------------------------------------------------------------------------------------
test('11. a seat subfolder thread is workspace only, owned by the seat or its declared subfolder note', () => {
  const ws = (rel) => path.join(WS, rel)
  const design = at(ESTATE, ws('animately-workspace/design/THREAD.md'))
  assert.deepEqual(kinds(design), ['workspace'])
  assert.deepEqual(design[0].owners, [N('Animately')])
  assert.match(design[0].fix, /_shared\/threads\/animately-design\.md/)
  assert.deepEqual(at(ESTATE, ws('animately-workspace/crawler/THREAD.md'))[0].owners, [N('Crawler')])
  const stub = at(ESTATE, ws('animately-workspace/product-design/THREAD.md'))
  assert.deepEqual(kinds(stub), ['workspace'])
  assert.match(stub[0].fix, /delete/)
  const x = at(ESTATE, ws('ops-workspace/notes/THREAD-x.md'))
  assert.deepEqual(kinds(x), ['workspace'], 'a seat THREAD-x.md is workspace only, never misnamed too')
  assert.deepEqual(x[0].owners, [N('Morning and Weekly Commands')])
  assert.deepEqual(audit(['--project', 'Agent Stable']).findings, [], "the workspaces root's declarers own no seat finding")
})

test('12. side-branch: the default branch lacks THREAD.md, locally and on origin, while another branch has it', () => {
  const sb = at(ESTATE, `${SIDER}/THREAD.md`)
  assert.deepEqual(kinds(sb), ['side-branch'])
  assert.match(sb[0].detail, /feat\/side/)
  assert.deepEqual(sb[0].owners, [N('Sider')])
  // The local-llm shape: committed on the local default, not yet pushed, is no side branch.
  assert.deepEqual(at(ESTATE, `${LOCALISH}/THREAD.md`), [])
})

test('13. behind: HEAD lacks a THREAD.md commit on origin\'s default', () => {
  const b = at(ESTATE, `${BEHINDY}/THREAD.md`)
  assert.deepEqual(kinds(b), ['behind'])
  assert.match(b[0].detail, /\b1 THREAD\.md commit/)
  assert.match(b[0].detail, /feat\/x/)
  assert.deepEqual(b[0].owners, [N('Behindy')])
})

test('14. unchecked: no origin/HEAD where a thread exists, on disk or only on a branch', () => {
  const u = Object.fromEntries(ESTATE.unchecked.map((e) => [e.path, e]))
  assert.deepEqual(u[NOHEAD].owners, [N('Nohead')])
  assert.equal(u[NOHEAD].fix, `git -C ${NOHEAD} remote set-head origin --auto`)
  assert.deepEqual(u[NOHEAD_B].owners, [N('Nohead Branch')])
  assert.ok(!(SIDER in u) && !(h('repos/animately/giflab') in u), 'a resolved origin/HEAD, or no thread, is never unchecked')
  assert.deepEqual(ESTATE.findings.filter((f) => f.path.startsWith(`${NOHEAD}/`) || f.path.startsWith(`${NOHEAD_B}/`)), [])
  const out = text(['--project', 'Nohead'])
  assert.equal(out, `unchecked: ${NOHEAD} — no origin/HEAD · fix: git -C ${NOHEAD} remote set-head origin --auto\nplacement: none · unchecked 1\n`)
})

test('15. _archive is ignored in both trees, and a .claude copy is never scanned', () => {
  const all = Object.values(ESTATE.scanned).flat()
  assert.deepEqual(all.filter((p) => p.includes('/_archive/') || p.includes('/.claude/')), [])
  assert.deepEqual(ESTATE.findings.filter((f) => f.path.includes('/_archive/')), [])
})

// ---- 16-21 -------------------------------------------------------------------------------------------------------
test('16. --thread reports that file\'s own entries', () => {
  const folder = h('Projects/Animately/giflab')
  const j = audit(['--thread', `${folder}/THREAD.md`])
  assert.deepEqual(j.findings.map((f) => [f.kind, f.path]), [['split-home', `${folder}/THREAD.md`], ['misnamed', `${folder}/THREAD-leaderboard.md`]])
  const wt = audit(['--thread', h('repos/tools/stray-wt/THREAD.md')])
  assert.deepEqual(wt.findings.map((f) => [f.kind, f.path]), [['undeclared', h('repos/tools/stray/THREAD.md')]])
  assert.deepEqual(audit(['--thread', `${BEHINDY}/THREAD.md`]).findings.map((f) => f.kind), ['behind'])
  assert.equal(text(['--thread', path.join(WS, '_shared/threads/x.md')]), 'placement: none\n')
  assert.deepEqual(audit(['--thread', path.join(WS, 'animately-workspace/design/THREAD.md')]).findings.map((f) => f.kind), ['workspace'])
})

test('17. home prints only a declared, qualifying repo of the folder\'s note', () => {
  assert.equal(home(['--dir', h('Projects/Animately/giflab/sub')]), h('repos/animately/giflab'))
  assert.equal(home(['--dir', h('repos/animately/giflab')]), '', 'a repo is no ~/Projects folder')
  assert.equal(home(['--dir', h('Projects')]), '', '~/Projects itself is no folder')
  assert.equal(home(['--dir', h('Projects/Life/dupe')]), '', 'two notes declaring same-named repos: ambiguous')
  assert.equal(home(['--project', 'GifLab']), h('repos/animately/giflab'))
  assert.equal(home(['--project', 'Murmur']), h('repos/tools/murmur'), 'a two-repo note prints its first')
  assert.equal(home(['--project', 'User Research']), '')
  assert.equal(home(['--project', `${P}/Tools/Same.md`]), '')
})

test('18. --project shows each kind under its owner and never under an unrelated note', () => {
  const cases = [
    ['split-home', h('Projects/Animately/giflab/THREAD.md'), 'GifLab'],
    ['split-home', h('Projects/Art/folio/THREAD.md'), 'Folio Engine'],
    ['split-home', h('repos/tools/cmux-fork-murmur/THREAD.md'), 'Murmur'],
    ['misnamed', h('repos/tools/widget/THREAD-old.md'), 'Widget'],
    ['misnamed', h('Projects/Animately/giflab/THREAD-leaderboard.md'), 'GifLab'],
    ['no-slug', h('Projects/Big/sub/THREAD.md'), 'Big'],
    ['behind', `${BEHINDY}/THREAD.md`, 'Behindy'],
    ['side-branch', `${SIDER}/THREAD.md`, 'Sider'],
    ['workspace', path.join(WS, 'animately-workspace/design/THREAD.md'), 'Animately'],
  ]
  for (const [kind, p, owner] of cases) {
    const f = at(ESTATE, p).filter((x) => x.kind === kind)
    assert.equal(f.length, 1, `one ${kind} at ${p}`)
    assert.ok(f[0].owners.includes(N(owner)), `${kind} at ${p} is owned by ${owner}`)
    assert.ok(!f[0].owners.includes(N('User Research')), `${kind} at ${p} is not owned by User Research`)
  }
  // The scope keeps exactly the entries a named note owns, and a note owning nothing sees nothing.
  const unrelated = audit(['--project', 'User Research'])
  assert.deepEqual([unrelated.findings, unrelated.unchecked], [[], []])
  for (const owner of ['Animately', 'Folio Engine']) {
    assert.deepEqual(audit(['--project', owner]).findings, ESTATE.findings.filter((f) => f.owners.includes(N(owner))), owner)
  }
  // Several --project notes: the union.
  const both = audit(['--project', 'Sider', '--project', `${P}/Tools/Behindy.md`])
  assert.deepEqual(both.findings.map((f) => [f.kind, f.path]), [['behind', `${BEHINDY}/THREAD.md`], ['side-branch', `${SIDER}/THREAD.md`]])
})

test('19. exit codes: 2 for a bad argument, 3 for a missing vault, and home --dir outside ~/Projects needs neither', () => {
  const refused = (args, code, pattern, opts) => {
    const r = run(args, opts)
    assert.equal(r.status, code, `status for ${args.join(' ')}: ${r.stderr}`)
    assert.equal(r.stdout, '')
    assert.match(r.stderr, /^thread-placement: \S[^\n]*\n$/, 'exactly one thread-placement: line')
    if (pattern) assert.match(r.stderr, pattern)
  }
  refused(['audit', '--project', 'Nope'], 2, /Nope/)
  refused(['audit', '--project', 'Same'], 2, /ambiguous/)
  refused(['audit', '--project', 'Finished Gadget'], 2)
  refused(['home', '--project', 'Nope'], 2)
  refused(['audit', '--thread', h('Projects')], 2)
  refused(['audit', '--thread', h('Projects/none/THREAD.md')], 2)
  refused(['home', '--dir', h('Projects/Big/THREAD.md')], 2)
  refused(['home', '--dir', h('Projects/missing')], 2)
  refused(['home'], 2)
  refused(['bogus'], 2)
  refused(['audit'], 3, /vault/, { vault: path.join(scratch, 'no-vault') })
  assert.equal(run(['audit', '--project', `${P}/Tools/Same.md`, '--json']).status, 0, 'a vault path settles a shared name')

  // home --dir outside ~/Projects (a repo, ~/Projects itself, outside HOME) has no folder note to read, so it prints
  // nothing and exits 0 before it needs the vault or PyYAML: handoff runs it from every launch directory. A
  // ~/Projects folder still needs both. The shadow yaml.py makes next-action's `import yaml` fail.
  const noYaml = path.join(scratch, 'no-yaml')
  write(path.join(noYaml, 'yaml.py'), 'raise ImportError("no PyYAML in this test")\n')
  const without = { 'no vault': { vault: path.join(scratch, 'no-vault') }, 'no PyYAML': { env: { PYTHONPATH: noYaml } } }
  for (const [what, opts] of Object.entries(without)) {
    for (const d of [h('repos/animately/giflab'), h('Projects'), scratch]) {
      const r = run(['home', '--dir', d], opts)
      assert.deepEqual([r.status, r.stdout, r.stderr], [0, '', ''], `home --dir ${d} with ${what}`)
    }
    refused(['home', '--dir', h('Projects/Animately/giflab')], 3, what === 'no vault' ? /vault/ : /PyYAML/, opts)
    refused(['home', '--dir', h('repos/animately/giflab/THREAD.md')], 2, null, opts)
  }
})

test('20. parity: scanned.repo_threads is exactly open\'s lookup with slug= empty', () => {
  const snippet = fs.readFileSync(OPEN, 'utf8').split('\n')
  const a = snippet.findIndex((l) => l.startsWith('# thread:repo-thread-lookup'))
  const b = snippet.findIndex((l) => l.startsWith('# end thread:repo-thread-lookup'))
  assert.ok(a >= 0 && b > a, 'the lookup snippet is in open')
  const r = spawnSync('bash', ['-c', snippet.slice(a + 1, b).join('\n')], { cwd: path.join(scratch, 'plain'), encoding: 'utf8',
    env: { ...base, HOME, slug: '' } })
  assert.equal(r.status, 0)
  const lookup = r.stdout.split('\n').filter(Boolean)
  assert.deepEqual(ESTATE.scanned.repo_threads, lookup)
  assert.ok(lookup.includes(h('repos/tools/thread-skill-wt/THREAD.md')), 'worktree copies kept outside .claude are listed by both')
  assert.ok(lookup.includes(h('repos/tools/node_modules/x/THREAD.md')), 'a depth-4 node_modules copy is listed by both')
  assert.deepEqual(ESTATE.scanned.repo_misnamed, [h('repos/tools/widget/THREAD-old.md')])
  assert.ok(!lookup.includes(h('repos/tools/widget/THREAD-old.md')))
  assert.deepEqual(ESTATE.scanned.workspace_threads, [...ESTATE.scanned.workspace_threads].sort())
  assert.deepEqual(ESTATE.scanned.project_misnamed, [h('Projects/Animately/giflab/THREAD-leaderboard.md')])
})

test('20b. rollout clones (ADR 0042): their copies are no thread, parity holds, and a nested clone gives no duplicate finding', () => {
  const HR = path.join(scratch, 'home-rollout')
  const hr = (rel) => path.join(HR, rel)
  const pair = (twin, a, b) => {
    for (const [d, u] of [[twin, a], [`${twin}-rollout`, b]]) { repo(d); git(['-C', d, 'remote', 'add', 'origin', u]) }
  }
  repo(hr('Projects'), { commit: true })
  pair(hr('repos/tools/pairy'), 'git@github.com:Own/Pairy.git', 'https://github.com/own/pairy.git')
  write(hr('repos/tools/pairy/THREAD.md'), thread('pairy'))
  write(hr('repos/tools/pairy-rollout/THREAD.md'), thread('pairy'))
  pair(hr('repos/workspaces'), 'https://github.com/o/ws.git', 'https://github.com/o/ws.git')
  write(hr('repos/workspaces-rollout/seat/THREAD.md'), thread('seat'))
  pair(hr('Projects/N/nest'), 'git@github.com:o/nest.git', 'git@github.com:o/nest.git')
  write(hr('Projects/N/nest/THREAD.md'), '# nest, no front matter\n')
  write(hr('Projects/N/nest-rollout/THREAD.md'), '# nest, no front matter\n')
  // a *-rollout with no GitHub origin is no rollout clone: listed, as in the lookup (repo-threads.test.sh's foo-rollout)
  repo(hr('repos/tools/plain-rollout')); write(hr('repos/tools/plain-rollout/THREAD.md'), thread('plain'))
  const j = audit([], { home: HR })
  const snippet = fs.readFileSync(OPEN, 'utf8').split('\n')
  const a = snippet.findIndex((l) => l.startsWith('# thread:repo-thread-lookup'))
  const b = snippet.findIndex((l) => l.startsWith('# end thread:repo-thread-lookup'))
  const r = spawnSync('bash', ['-c', snippet.slice(a + 1, b).join('\n')], { cwd: path.join(scratch, 'plain'), encoding: 'utf8',
    env: { ...base, HOME: HR, slug: '' } })
  assert.equal(r.status, 0)
  const lookup = r.stdout.split('\n').filter(Boolean)
  assert.deepEqual(j.scanned.repo_threads, lookup, 'parity with the lookup, rollout clones and all')
  assert.deepEqual(lookup, [hr('repos/tools/pairy/THREAD.md'), hr('repos/tools/plain-rollout/THREAD.md')])
  assert.deepEqual(j.scanned.project_threads, [hr('Projects/N/nest/THREAD.md')], 'the nested clone copy is never scanned')
  const noSlug = of(j, 'no-slug').map((f) => f.path)
  assert.deepEqual(noSlug, [hr('Projects/N/nest/THREAD.md')], 'one no-slug finding, at the twin: never a duplicate at the clone')
  for (const f of j.findings) assert.ok(!f.path.includes('-rollout/THREAD.md') || f.path.includes('plain-rollout'), `no finding at a clone copy: ${f.kind} ${f.path}`)
})

test('21. read-only: nothing under HOME or the vault changes, and no bytecode is written', () => {
  const snap = (dir) => {
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
  const before = [snap(HOME), snap(VAULT)]
  const env = { ...base }
  delete env.PYTHONDONTWRITEBYTECODE
  for (const args of [['audit'], ['audit', '--project', 'GifLab', '--json'], ['audit', '--thread', h('Projects/Big/THREAD.md')],
    ['home', '--dir', h('Projects/Animately/giflab')], ['home', '--project', 'Murmur']]) {
    const r = spawnSync('python3', [SCRIPT, ...args, '--vault', VAULT], { encoding: 'utf8', cwd: scratch, env: { ...env, HOME } })
    assert.equal(r.status, 0, `${args.join(' ')}: ${r.stderr}`)
  }
  assert.deepEqual([snap(HOME), snap(VAULT)], before)
  assert.ok(!fs.existsSync(path.join(root, 'skills', '_shared', 'scripts', '__pycache__')), 'no __pycache__ beside the script')
})
