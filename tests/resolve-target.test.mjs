// skills/_shared/scripts/resolve-target.py — orient's target resolver (ADR 0036 d1–d4; CONTEXT.md **Target**).
// Each case runs the shipped script against a fixture vault and a fake HOME under one temp dir, passing --vault,
// --launch-folders and HOME every time, so nothing reads or writes the real vault, workspaces or ~/Projects.
//
// The fixture vault copies real names, aliases, tags, `area:` shapes and `repos:` values from
// ~/repos/obsidian/Work/Projects. Departures are marked [stand-in] (no such note in the real vault) or [departs]
// (a real note with a changed field). Numbers that hold only because of a stand-in are marked "fixture only".
// The fake HOME copies the real layout: umbrella repos at ~/Projects, ~/repos/workspaces and ~/.agents, repos
// nested inside them, dated project dirs, a linked worktree outside HOME, and a second HOME with no git at all.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { root } from './lib/contract-text.mjs'

const SCRIPT = path.join(root, 'skills', '_shared', 'scripts', 'resolve-target.py')

// Scrub git's own repo-local names first, then pin the config, so a hook's GIT_DIR never reaches a fixture repo.
const drop = spawnSync('git', ['rev-parse', '--local-env-vars'], { encoding: 'utf8' }).stdout.split('\n').filter(Boolean)
const base = { ...process.env }
for (const name of drop) delete base[name]
base.GIT_CONFIG_GLOBAL = '/dev/null'
base.GIT_CONFIG_NOSYSTEM = '1'
// A `pip install --user` PyYAML resolves under HOME, which every call swaps: pin the real user base as run.sh does.
base.PYTHONUSERBASE ??= spawnSync('python3', ['-c', 'import site; print(site.getuserbase())'], { encoding: 'utf8' }).stdout.trim()

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'resolve-target-'))
const LOCKED = path.join(scratch, 'locked')
after(() => {
  if (fs.existsSync(LOCKED)) fs.chmodSync(LOCKED, 0o755)
  fs.rmSync(scratch, { recursive: true, force: true })
})

// HOME is passed as given (on macOS a /var path); the script realpaths it, so expectations use realpaths.
const HOME = path.join(scratch, 'home')
const HOME2 = path.join(scratch, 'home2')
const OUTSIDE = path.join(scratch, 'outside')
const h = (rel) => path.join(HOME, rel)

function git(args) {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false',
    '-c', 'init.defaultBranch=main', ...args], { env: base, encoding: 'utf8' })
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`)
}
const mkdir = (p) => fs.mkdirSync(p, { recursive: true })
function repo(p, { commit = false } = {}) {
  mkdir(p)
  git(['init', '-q', p])
  if (commit) git(['-C', p, 'commit', '-q', '--allow-empty', '-m', 'init'])
}

// ---- The fake HOME ----------------------------------------------------------------------------------------
mkdir(OUTSIDE)
for (const r of ['thread-skill', 'cmux-fork-murmur', 'mcp/mac-data-mcp', 'foo']) repo(h(`repos/tools/${r}`))
mkdir(h('repos/tools/thread-skill/src/deep'))
mkdir(h('repos/tools/foo/tools'))  // a sub-directory named like the Tools area, inside repo foo
repo(h('repos/tools/thread-skill-rollout'), { commit: true })
mkdir(h('repos/tools/thread-skill-rollout/docs'))
fs.writeFileSync(h('repos/tools/thread-skill-rollout/docs/plan.md'), '# Plan\n')
git(['-C', h('repos/tools/thread-skill-rollout'), 'worktree', 'add', '-q', '-b', 'wt',
  h('repos/tools/thread-skill-rollout/.claude/worktrees/wt')])
repo(h('repos/tools/murmur'), { commit: true })
git(['-C', h('repos/tools/murmur'), 'worktree', 'add', '-q', '-b', 'wt', path.join(OUTSIDE, 'murmur-wt')])
mkdir(path.join(OUTSIDE, 'plain'))
// ~/repos/workspaces: one umbrella repo for every *-workspace.
repo(h('repos/workspaces'))
for (const ws of ['ops', 'animately', 'narcissus', 'td-experiments', '2d', '3d', 'xr']) mkdir(h(`repos/workspaces/${ws}-workspace/launchers/full`))
mkdir(h('repos/workspaces/ops-workspace/launchers/lean'))
mkdir(h('repos/workspaces/animately-workspace/launchers/seo'))
repo(h('repos/workspaces/animately-workspace/crawler'), { commit: true })
git(['-C', h('repos/workspaces/animately-workspace/crawler'), 'worktree', 'add', '-q', '-b', 'wt', path.join(OUTSIDE, 'crawler-wt')])
mkdir(h('repos/workspaces/_shared/scripts'))
// ~/Projects: one umbrella repo, dated project dirs, a nested repo, archive and resource folders.
repo(h('Projects'))
for (const d of ['2D/26-08-03_possum-paste-up/finals', '2D/26-09-24_macklemore-mate', '2D/_archive/26-08-01_x',
  '2D/26-06-15_class-war-australian-cards', 'Narcissus/_sources', 'Narcissus/26-10-02_light-probe',
  '3D/26-10-01_bracket', 'skate', 'TSMS', '_archive']) mkdir(h(`Projects/${d}`))
repo(h('Projects/Narcissus/narcissus-avp'))
mkdir(h('Projects/Narcissus/narcissus-avp/Sources/App'))
// ~/.agents: one umbrella repo of skills.
repo(h('.agents'))
for (const s of ['ab', 'method', 'unpack']) mkdir(h(`.agents/skills/${s}`))
mkdir(h('Desktop/sketch'))  // no git
mkdir(h('links'))
fs.symlinkSync(h('repos/tools/thread-skill'), h('links/ts'))
mkdir(h('.claude/plans'))
fs.writeFileSync(h('.claude/plans/plan.md'), '# Plan\n')
mkdir(path.join(HOME2, 'Projects/2D/26-09-24_macklemore-mate'))  // a second HOME with no git anywhere
mkdir(LOCKED)
fs.writeFileSync(path.join(scratch, 'a-file'), 'x\n')

// launch-folders.json: workspace roots cut at /launchers/; a null path is skipped.
const LF = path.join(scratch, 'launch-folders.json')
const profiles = Object.fromEntries(['ops', 'animately', 'narcissus', 'td-experiments', '2d', '3d', 'xr']
  .map((ws) => [`${ws}-workspace`, { full: h(`repos/workspaces/${ws}-workspace/launchers/full`) }]))
profiles['ops-workspace'].lean = h('repos/workspaces/ops-workspace/launchers/lean')
profiles['animately-workspace'].seo = h('repos/workspaces/animately-workspace/launchers/seo')
profiles['gone-workspace'] = { full: null }
fs.writeFileSync(LF, JSON.stringify({ schema_version: 1, by_alias: {}, by_workspace_profile: profiles }, null, 2))
const LF_BAD = path.join(scratch, 'launch-folders-bad.json')
fs.writeFileSync(LF_BAD, '{ not json')

// ---- The fixture vault ------------------------------------------------------------------------------------
const P = 'Work/Projects'
const fm = (lines, body = '\n# Note\n') => `---\n${lines}\n---\n${body}`
const proj = (area, rest = '') => fm(`tags:\n  - project\narea:\n  - ${area}\nstatus: queued\ndone: false${rest}`)
function fixture() {
  return {
    [`${P}/AI/AI.md`]: fm('tags:\n  - area'),
    // [departs] the five retired-name aliases are left out: queue-only.test.mjs (rule b2) keeps that name out of test files.
    [`${P}/AI/Thread Skill.md`]: fm('tags:\n  - project\narea:\n  - AI\nrepos:\n  - ~/repos/tools/thread-skill\nstatus: queued\ndone: false\n' +
      'aliases:\n  - thread-skill\n  - Thread plugin\n  - thread\n  - ts',
    '\n# Thread Skill\n\nKeep me.\n'),
    [`${P}/AI/Murmur.md`]: proj('AI', '\nrepos:\n  - ~/repos/tools/murmur\n  - ~/repos/tools/cmux-fork-murmur'),
    [`${P}/AI/Murmur's cmux fork.md`]: proj('AI'),  // [stand-in]
    [`${P}/AI/Agent Reader.md`]: proj('AI', '\nrepos:\n  - ~/repos/tools/agent-reader\naliases:\n  - Claude Reader'),
    [`${P}/AI/Agent Stable.md`]: proj('AI', '\nrepos:\n  - ~/repos/workspaces\naliases:\n  - AI Agents - Claude + Codex + Antigravity\n' +
      '  - Antigravity\n  - agy\n  - Gemini harness\n  - AI Agents - Claude + Codex\n  - AI Agents\n  - Codex\n  - cx aliases\n  - Claude + Codex\n  - Codex Side by Side'),
    [`${P}/AI/Bake-off Model Rails.md`]: proj('AI', '\nrepos:\n  - ~/repos/workspaces\n  - ~/.agents/skills/ab\naliases:\n  - bakeoff-model-rails\n  - model rails\n  - bake-off rails'),
    [`${P}/AI/Calendar Travel Agent.md`]: proj('AI', '\nrepos:'),
    [`${P}/AI/Mac Data MCP.md`]: proj('AI', '\nrepos:\n  - ~/repos/tools/mcp/mac-data-mcp/'),
    [`${P}/AI/Shared Skills.md`]: fm('tags: [project]\narea: [AI]\nstatus: queued\ndone: false\naliases: [Shared skills migration, Claude and Codex skills parity]'),
    [`${P}/AI/Unpack Skill.md`]: proj('AI', '\nrepos:\naliases:\n  - unpack\n  - unpack-skill\n  - Unpack\n  - unpack map'),
    [`${P}/AI/Method Skill.md`]: proj('AI', '\nrepos:\n  - ~/.agents/skills/method\naliases:\n  - method\n  - method-skill'),
    [`${P}/Archive/Research System.md`]: fm('tags:\n  - project\narea:\n  - AI\nrepos:\n  - ~/repos/workspaces\nstatus: done\ndone: true\naliases:\n  - research-landing\n  - Research landing'),
    [`${P}/Tools/Tools.md`]: fm('tags:\n  - area'),
    [`${P}/Tools/Maquette.md`]: fm('tags:\n  - project\naliases:\n  - maquette\narea: Tools\nstatus: active\ndone: false\nrepos:\n  - ~/repos/tools/maquette'),
    [`${P}/Tools/Morning and Weekly Commands.md`]: proj('Tools', '\nrepos:\n  - ~/repos/workspaces/ops-workspace'),
    [`${P}/Tools/Gadget Shelf.md`]: proj('Tools'),  // [stand-in] a live neighbour for the dead gadgets
    [`${P}/Tools/Finished Gadget.md`]: fm('tags:\n  - project\narea: Tools\nstatus: done'),  // [stand-in]
    [`${P}/Tools/Done Flag Gadget.md`]: fm('tags:\n  - project\narea: Tools\nstatus: queued\ndone: true'),  // [stand-in]
    [`${P}/Tools/Shelved Gadget.md`]: fm('tags:\n  - project\n  - archived\narea: Tools\nstatus: parked'),  // [stand-in]
    [`${P}/Tools/Broken Gadget.md`]: '---\ntags: [project\narea: Tools\n---\n',  // [stand-in] does not parse
    [`${P}/Tools/Stub Wikilink.md`]: fm('tags: [project]\narea: "[[Life|Personal]]"\nstatus: queued'),  // [stand-in]
    [`${P}/Tools/Stub Nested.md`]: fm('tags: [project]\narea: [[Life]]\nstatus: queued'),  // [stand-in]
    [`${P}/Tools/Stub Empty.md`]: fm('tags: [project]\narea: []\nstatus: queued'),  // [stand-in]
    [`${P}/Tools/Stub Blank First.md`]: fm('tags: [project]\narea: ["", Life]\nstatus: queued'),  // [stand-in]
    [`${P}/Art/Art.md`]: fm('tags:\n  - area'),
    [`${P}/Art/Narcissus/Narcissus.md`]: fm('tags:\n  - project\narea:\n  - Art\nstatus: active\ndone: false\ndrift: skip'),
    [`${P}/Art/Narcissus/AVP show.md`]: fm('tags:\n  - project\narea:\n  - Art\nstatus: active\ndone: false\nlaunch: cc-avp'),
    [`${P}/Art/Narcissus/Echo prototype.md`]: fm('tags:\n  - project\narea:\n  - Art\nstatus: active\ndone: false'),
    [`${P}/Art/Narcissus/Quote videos.md`]: fm('tags:\n  - project\narea:\n  - Art\nstatus: active\ndone: false'),
    [`${P}/Art/Narcissus/concept.md`]: fm('tags:\n  - reference'),
    [`${P}/Art/Narcissus/Real-space lighting match/Real-space lighting match.md`]: fm('tags:\n  - project\narea:\n  - Art\nstatus: active\ndone: false'),
    [`${P}/Art/Narcissus/Real-space lighting match/Experiments/Experiments.md`]: fm('tags:\n  - project\narea:\nstatus: active\ndone: false\ncaptured: 2026-08-06\ntemplate: "[[Project]]"\nrepos:'),
    [`${P}/Art/Ikeda-style immersive AV prototype/Ikeda-style immersive AV prototype.md`]: fm('tags:\n  - project\narea:\n  - Art\nstatus: active\ndone: false\nrepos:'),
    [`${P}/Art/Ikeda-style immersive AV prototype/Experiments/Experiments.md`]: fm('tags:\n  - project\narea:\nstatus: active\ndone: false\ncaptured: 2026-08-06\ntemplate: "[[Project]]"\nrepos:'),
    [`${P}/Art/Colocated XR/Colocated XR.md`]: fm('tags:\n  - project\narea:\n  - Art\nstatus: active\ndone: false\nrepos:\n  - ~/Projects/XR/colocation'),
    [`${P}/2D/2D.md`]: fm('tags:\n  - area'),
    [`${P}/2D/Possum Paste-Up.md`]: fm('tags:\n  - project\narea: 2D\nstatus: parked\ndone: false'),  // [departs] no repos:, so rung 4 meets it
    [`${P}/2D/Class War Australian Cards/Class War Australian Cards.md`]: fm(
      `tags:\n  - project\narea:\n  - 2D\nstatus: queued\ndone: false\nrepos:\n  - ${HOME}/Projects/2D/26-06-15_class-war-australian-cards`),
    [`${P}/2D/Gig Posters.md`]: fm('tags:\n  - project\narea:\n  - 2D\nstatus: queued\ndone: false\nrepos:\n  - ~/Projects/2D/26-07-01_gig-posters\nnext_task:',
      '\n# Gig Posters\n'),  // [stand-in] a second 2D project
    [`${P}/Dance (area)/Dance (area).md`]: fm('tags:\n  - area'),
    [`${P}/Dance (area)/Barefoot Second Skin.md`]: fm('tags:\n  - project\narea:\n  - Dance\n  - 3D print\nstatus: queued\ndone: false'),
    [`${P}/Dance (area)/BPM Class App.md`]: proj('Dance', '\nrepos:\n  - ~/Projects/Life/bpm-class-app'),
    [`${P}/Skate (area)/Skate (area).md`]: fm('tags:\n  - area'),
    [`${P}/3D print/3D print.md`]: fm('tags:\n  - area'),
    [`${P}/Animately/Animately.md`]: fm('tags:\n  - area'),
    [`${P}/Life (area)/Life (area).md`]: fm('tags:\n  - index\n  - area'),
    [`${P}/Life (area)/Grandma Shirley's Book/Grandma Shirley's Book.md`]: fm('tags:\n  - project\narea: Life\nstatus: queued\ndone: false\nrepos:\n  - ~/Projects/Life/grandma-shirleys-book'),
    ['Work/Tasks/brain dump 2026-10-01.md']: fm('tags:\n  - task\n  - brain-dump\nstatus: open'),  // [stand-in]
  }
}
function makeVault(edit = {}) {
  const dir = fs.mkdtempSync(path.join(scratch, 'vault-'))
  for (const [rel, text] of Object.entries({ ...fixture(), ...edit })) {
    mkdir(path.dirname(path.join(dir, rel)))
    fs.writeFileSync(path.join(dir, rel), text)
  }
  return dir
}
const VAULT = makeVault()
const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf8')
const snapshot = (dir) => Object.fromEntries(
  fs.readdirSync(dir, { recursive: true }).filter((f) => f.endsWith('.md')).sort().map((f) => [f, read(dir, f)]))

// ---- Running it ---------------------------------------------------------------------------------------------
function run(args, { cwd, home = HOME, vault = VAULT, lf = LF, pyFlags = [] } = {}) {
  const flags = ['--vault', vault, '--launch-folders', lf, ...(cwd === undefined ? [] : ['--cwd', cwd])]
  return spawnSync('python3', [...pyFlags, SCRIPT, ...args, ...flags], { encoding: 'utf8', cwd: scratch, env: { ...base, HOME: home } })
}
function ok(args, opts) {
  const r = run(args, opts)
  assert.equal(r.stderr, '', `stderr for ${args.join(' ')}`)
  assert.equal(r.status, 0, `status for ${args.join(' ')}`)
  return JSON.parse(r.stdout)
}
const at = (cwd, opts = {}) => ok([], { ...opts, cwd })
function refused(args, pattern, opts = {}) {
  const vault = opts.vault ?? VAULT
  const before = snapshot(vault)
  const r = run(args, opts)
  assert.equal(r.status, 2, `status for ${args.join(' ')}; stderr: ${r.stderr}`)
  assert.equal(r.stdout, '')
  assert.match(r.stderr, /^resolve-target: \S[^\n]*\n$/, 'exactly one resolve-target: line')
  if (pattern) assert.match(r.stderr, pattern)
  assert.deepEqual(snapshot(vault), before, 'a refusal writes nothing')
  return r.stderr
}
const names = (r) => r.candidates.map((c) => c.name)
const scores = (r) => r.candidates.map((c) => c.score)
const target = (kind, name, note, folder, area) => ({ kind, name, note, folder, area })
const TS = target('project', 'Thread Skill', `${P}/AI/Thread Skill.md`, 'AI', 'AI')
const KEYS = ['outcome', 'rung', 'target', 'candidates', 'dir_anchor', 'reason', 'learn_dir']
function resolved(r, t, rung) {
  assert.deepEqual(Object.keys(r).sort(), [...KEYS].sort())
  assert.equal(r.outcome, 'resolved', r.reason)
  assert.equal(r.rung, rung)
  assert.deepEqual(r.target, t)
  assert.equal(r.candidates[0].note, t.note, 'the pick comes first')
}
const EXP_IKEDA = `${P}/Art/Ikeda-style immersive AV prototype/Experiments/Experiments.md`
const EXP_RSLM = `${P}/Art/Narcissus/Real-space lighting match/Experiments/Experiments.md`

// ---- Names (rung 1) -------------------------------------------------------------------------------------------
test('names: an exact alias or name resolves, carrying folder and area; a dead note is never a match', () => {
  let r = ok(['ts'])
  resolved(r, TS, 'argument')
  assert.equal(r.dir_anchor, null)
  assert.equal(r.learn_dir, null)
  r = ok(['murmur'])
  resolved(r, target('project', 'Murmur', `${P}/AI/Murmur.md`, 'AI', 'AI'), 'argument')
  assert.deepEqual([names(r)[1], scores(r)[1]], ["Murmur's cmux fork", 0.667], 'fixture only: the fork runner-up')
  r = ok(['Skate'])
  resolved(r, target('area', 'Skate (area)', `${P}/Skate (area)/Skate (area).md`, 'Skate (area)', 'Skate'), 'argument')
  r = ok(['AI'])
  resolved(r, target('area', 'AI', `${P}/AI/AI.md`, 'AI', 'AI'), 'argument')
  assert.deepEqual([names(r)[1], scores(r)[1]], ['Agent Stable', 0.75])
  r = ok(['experiments'])
  assert.equal(r.outcome, 'candidates', 'an exact hit on two notes asks')
  assert.deepEqual(r.candidates.map((c) => c.note), [EXP_IKEDA, EXP_RSLM])
  for (const dead of ['Research System', 'Finished Gadget', 'Done Flag Gadget', 'Shelved Gadget', 'Broken Gadget']) {
    r = ok([dead])
    assert.equal(r.outcome, 'none', dead)
    assert.ok(!names(r).includes(dead), `${dead} is never a candidate`)
  }
  assert.deepEqual(names(ok(['Finished Gadget'])), ['Gadget Shelf'])
  assert.equal(ok(['concept']).outcome, 'none', 'a reference note is no project')
})

test('names: a fuzzy match resolves only with a clear winner; a close call asks with the top three', () => {
  let r = ok(['murmr'])
  resolved(r, target('project', 'Murmur', `${P}/AI/Murmur.md`, 'AI', 'AI'), 'argument')
  assert.deepEqual(scores(r), [0.909, 0.606], 'fixture only: the fork at 0.606')
  r = ok(['avp'])
  resolved(r, target('project', 'AVP show', `${P}/Art/Narcissus/AVP show.md`, 'Art', 'Art'), 'argument')
  assert.equal(scores(r)[0], 0.75)
  r = ok(['agent'])
  assert.equal(r.outcome, 'candidates')
  assert.deepEqual(names(r), ['Agent Reader', 'Agent Stable', 'Calendar Travel Agent'])
  assert.deepEqual(scores(r), [0.75, 0.75, 0.667])
  assert.ok(r.candidates.every((c) => c.area === 'AI' && c.folder === 'AI' && c.kind === 'project'))
  r = ok(['murmur', 'cmux'])  // two words are one name
  assert.equal(r.outcome, 'candidates', 'fixture only: the real vault resolves Murmur at 0.75')
  assert.deepEqual(names(r), ["Murmur's cmux fork", 'Murmur'])
  assert.deepEqual(scores(r), [0.833, 0.75])
  r = ok(['td experiments'])
  assert.equal(r.outcome, 'candidates')
  assert.deepEqual(r.candidates.map((c) => [c.note, c.score, c.area, c.folder]), [[EXP_IKEDA, 0.75, 'Art', 'Art'], [EXP_RSLM, 0.75, 'Art', 'Art']])
  r = ok(['class war'])
  resolved(r, target('project', 'Class War Australian Cards', `${P}/2D/Class War Australian Cards/Class War Australian Cards.md`, '2D', '2D'), 'argument')
  assert.deepEqual(scores(r), [0.75, 0.417])
  r = ok(['grandma'])
  resolved(r, target('project', "Grandma Shirley's Book", `${P}/Life (area)/Grandma Shirley's Book/Grandma Shirley's Book.md`, 'Life (area)', 'Life'), 'argument')
  assert.equal(scores(r)[0], 0.667)
  r = ok(['mumur'])
  assert.deepEqual([r.outcome, r.candidates], ['none', []], 'a typo with nothing near asks in plain text')
})

test('area shapes: block, flow, scalar, null, absent, list of two, wikilinks, empty and blank-first', () => {
  const areaOf = (name) => { const r = ok([name]); assert.equal(r.outcome, 'resolved', name); return [r.target.folder, r.target.area] }
  assert.deepEqual(areaOf('Thread Skill'), ['AI', 'AI'])  // block list
  assert.deepEqual(areaOf('Shared Skills'), ['AI', 'AI'])  // flow list
  assert.deepEqual(areaOf('Maquette'), ['Tools', 'Tools'])  // scalar
  assert.deepEqual(areaOf('Barefoot Second Skin'), ['Dance (area)', 'Dance'])  // the first of two
  assert.deepEqual(areaOf('Dance'), ['Dance (area)', 'Dance'])  // an area note: absent, the folder minus " (area)"
  assert.deepEqual(areaOf('Stub Wikilink'), ['Tools', 'Life'])  // "[[Life|Personal]]"
  assert.deepEqual(areaOf('Stub Nested'), ['Tools', 'Life'])  // unquoted [[Life]] parses as nested lists
  assert.deepEqual(areaOf('Stub Empty'), ['Tools', 'Tools'])  // [] falls back to the folder
  assert.deepEqual(areaOf('Stub Blank First'), ['Tools', 'Life'])
  const exp = ok(['td experiments']).candidates
  assert.deepEqual(exp.map((c) => c.area), ['Art', 'Art'])  // null area:
})

// ---- Links and paths (rung 1) -----------------------------------------------------------------------------
test('links: a project, a plain note, an archived project, and a missing link that falls to the name matcher', () => {
  resolved(ok(['[[AVP show]]']), target('project', 'AVP show', `${P}/Art/Narcissus/AVP show.md`, 'Art', 'Art'), 'argument')
  resolved(ok(['[[AVP show|the show]]']), target('project', 'AVP show', `${P}/Art/Narcissus/AVP show.md`, 'Art', 'Art'), 'argument')
  resolved(ok(['[[brain dump 2026-10-01]]']), target('note', 'brain dump 2026-10-01', 'Work/Tasks/brain dump 2026-10-01.md', null, null), 'argument')
  let r = ok(['[[Research System]]'])
  assert.equal(r.outcome, 'none')
  assert.match(r.reason, /archived/)
  assert.deepEqual(r.candidates, [])
  resolved(ok(['[[Murmr]]']), target('project', 'Murmur', `${P}/AI/Murmur.md`, 'AI', 'AI'), 'argument')
  r = ok(['[[Experiments]]'])
  assert.equal(r.outcome, 'candidates')
  assert.deepEqual(r.candidates.map((c) => c.note), [EXP_IKEDA, EXP_RSLM])
})

test('in-vault paths: relative or absolute, a folder through its folder note, a missing note by name', () => {
  const cwd = path.join(OUTSIDE, 'plain')
  resolved(ok([`${P}/AI/Thread Skill.md`], { cwd }), TS, 'argument')
  resolved(ok([path.join(VAULT, P, 'AI/Thread Skill.md')], { cwd }), TS, 'argument')
  resolved(ok([`${P}/Art/Narcissus`], { cwd }), target('project', 'Narcissus', `${P}/Art/Narcissus/Narcissus.md`, 'Art', 'Art'), 'argument')
  let r = ok(['Work/Tasks'], { cwd })
  assert.equal(r.outcome, 'none')
  assert.match(r.reason, /a vault folder, not a note/)
  resolved(ok([`${P}/AI/Murmr.md`], { cwd }), target('project', 'Murmur', `${P}/AI/Murmur.md`, 'AI', 'AI'), 'argument')
  r = ok([`${P}/Archive/Research System.md`], { cwd })
  assert.deepEqual([r.outcome, r.target], ['none', null])
  assert.match(r.reason, /archived/)
  r = ok([`${P}/Tools/Finished Gadget.md`], { cwd })
  assert.equal(r.outcome, 'none')
  assert.match(r.reason, /done/)
})

test('outside paths: a file is a scoped target, a directory runs the directory rungs, a missing path is none', () => {
  const plan = target('file', '~/.claude/plans/plan.md', null, null, null)
  resolved(ok([h('.claude/plans/plan.md')]), plan, 'argument')
  resolved(ok(['~/.claude/plans/plan.md']), plan, 'argument')
  let r = ok(['~/nowhere/plan.md'])
  assert.deepEqual([r.outcome, r.rung, r.target], ['none', 'argument', null])
  assert.match(r.reason, /no such path/)
  resolved(ok(['~/repos/tools/thread-skill']), TS, 'directory')
  r = ok(['docs/plan.md'], { cwd: h('repos/tools/thread-skill-rollout') })
  resolved(r, target('file', '~/repos/tools/thread-skill-rollout/docs/plan.md', null, null, null), 'argument')
})

// ---- Rung 2: declared directories --------------------------------------------------------------------------
test('rung 2: a declared repo, its sub-directories, a symlink and a linked worktree resolve to the declarer', () => {
  for (const cwd of [h('repos/tools/thread-skill'), h('repos/tools/thread-skill/src/deep'), h('links/ts')]) {
    const r = at(cwd)
    resolved(r, TS, 'directory')
    assert.equal(r.learn_dir, null)
    assert.match(r.reason, /~\/repos\/tools\/thread-skill is declared by Thread Skill/)
  }
  resolved(at(path.join(OUTSIDE, 'murmur-wt')), target('project', 'Murmur', `${P}/AI/Murmur.md`, 'AI', 'AI'), 'directory')
  resolved(at(h('repos/tools/mcp/mac-data-mcp')), target('project', 'Mac Data MCP', `${P}/AI/Mac Data MCP.md`, 'AI', 'AI'), 'directory')
  resolved(at(h('Projects/2D/26-06-15_class-war-australian-cards')),
    target('project', 'Class War Australian Cards', `${P}/2D/Class War Australian Cards/Class War Australian Cards.md`, '2D', '2D'), 'directory')
  resolved(at(h('repos/workspaces/ops-workspace/launchers/lean')),
    target('project', 'Morning and Weekly Commands', `${P}/Tools/Morning and Weekly Commands.md`, 'Tools', 'Tools'), 'directory')
  resolved(at(h('.agents/skills/ab')), target('project', 'Bake-off Model Rails', `${P}/AI/Bake-off Model Rails.md`, 'AI', 'AI'), 'directory')
})

test('rung 2: a prefix matches whole path components only', () => {
  const r = at(h('repos/tools/thread-skill-rollout'))
  assert.deepEqual([r.outcome, r.rung, r.target], ['none', 'directory-name', null])
  assert.deepEqual([names(r)[0], scores(r)[0]], ['Thread Skill', 0.833])
  assert.equal(r.dir_anchor.name, 'Tools')
  assert.equal(r.learn_dir, '~/repos/tools/thread-skill-rollout')
  assert.deepEqual(at(h('repos/tools/thread-skill-rollout/.claude/worktrees/wt')), r, 'a linked worktree reads as its main checkout')
  assert.deepEqual(at(h('repos/tools/thread-skill-rollout/docs')), r)
})

test('rung 2: a directory several projects declare asks, and is never learned', () => {
  for (const cwd of [h('repos/workspaces'), h('repos/workspaces/_shared/scripts')]) {
    const r = at(cwd)
    assert.deepEqual([r.outcome, r.rung, r.target, r.learn_dir], ['candidates', 'directory', null, null])
    assert.deepEqual(names(r), ['Agent Stable', 'Bake-off Model Rails'], 'the archived Research System is no declarer')
    assert.match(r.reason, /declared by 2/)
  }
})

// ---- Rung 3: workspaces ---------------------------------------------------------------------------------------
test('rung 3: a workspace below a shared declaration gives its area or folder project', () => {
  let r = at(h('repos/workspaces/animately-workspace/launchers/seo'))
  resolved(r, target('area', 'Animately', `${P}/Animately/Animately.md`, 'Animately', 'Animately'), 'workspace')
  assert.equal(r.learn_dir, null, 'a matched workspace root is never learned')
  r = at(h('repos/workspaces/narcissus-workspace'))
  resolved(r, target('project', 'Narcissus', `${P}/Art/Narcissus/Narcissus.md`, 'Art', 'Art'), 'workspace')
  assert.equal(r.learn_dir, null)
  r = at(h('repos/workspaces/animately-workspace/crawler'))
  resolved(r, target('area', 'Animately', `${P}/Animately/Animately.md`, 'Animately', 'Animately'), 'workspace')
  assert.equal(r.learn_dir, '~/repos/workspaces/animately-workspace/crawler', 'a repo nested in a workspace is its own directory')
  assert.deepEqual(at(path.join(OUTSIDE, 'crawler-wt')), r, 'a linked worktree outside HOME reads as its main checkout')
  r = at(h('repos/workspaces/td-experiments-workspace/launchers/full'))
  assert.deepEqual([r.outcome, r.rung, r.learn_dir], ['none', 'workspace', '~/repos/workspaces/td-experiments-workspace'])
  const table = { '2d': ['2D', 1], '3d': ['3D print', 0.75], xr: ['Colocated XR', 0.75] }
  for (const [ws, [name, score]] of Object.entries(table)) {
    r = at(h(`repos/workspaces/${ws}-workspace/launchers/full`))
    assert.deepEqual([r.outcome, r.rung, r.target?.name, scores(r)[0]], ['resolved', 'workspace', name, score], ws)
  }
})

test('rung 3: missing or unparseable launch folders skip it with a reason', () => {
  for (const lf of [path.join(scratch, 'no-such.json'), LF_BAD]) {
    const r = at(h('repos/workspaces/animately-workspace/launchers/seo'), { lf })
    assert.deepEqual([r.outcome, r.rung], ['candidates', 'directory'])
    assert.deepEqual(names(r), ['Agent Stable', 'Bake-off Model Rails'])
    assert.match(r.reason, /rung 3 skipped/)
  }
})

// ---- Rung 4: the directory's own name ------------------------------------------------------------------------
test('rung 4: a dated dir in an umbrella repo is named by its own directory, within its area', () => {
  let r = at(h('Projects/2D/26-08-03_possum-paste-up/finals'))
  resolved(r, target('project', 'Possum Paste-Up', `${P}/2D/Possum Paste-Up.md`, '2D', '2D'), 'directory-name')
  assert.equal(r.learn_dir, '~/Projects/2D/26-08-03_possum-paste-up', 'never ~/Projects')
  r = at(h('Projects/2D/26-09-24_macklemore-mate'))
  assert.deepEqual([r.outcome, r.rung, r.target], ['none', 'directory-name', null])
  assert.deepEqual(r.dir_anchor, target('area', '2D', `${P}/2D/2D.md`, '2D', '2D'))
  assert.match(r.reason, /in 2D/)
  assert.equal(r.learn_dir, '~/Projects/2D/26-09-24_macklemore-mate')
  const r2 = at(path.join(HOME2, 'Projects/2D/26-09-24_macklemore-mate'), { home: HOME2 })
  assert.deepEqual(r2, r, 'the same answer with no git anywhere')
  for (const cwd of [h('Projects/Narcissus/narcissus-avp'), h('Projects/Narcissus/narcissus-avp/Sources/App')]) {
    r = at(cwd)
    resolved(r, target('project', 'AVP show', `${P}/Art/Narcissus/AVP show.md`, 'Art', 'Art'), 'directory-name')
    assert.equal(scores(r)[0], 0.75)
    assert.equal(r.learn_dir, '~/Projects/Narcissus/narcissus-avp')
  }
  r = at(h('Projects/3D/26-10-01_bracket'))
  assert.deepEqual([r.outcome, r.dir_anchor?.name, r.learn_dir], ['none', '3D print', '~/Projects/3D/26-10-01_bracket'])
  r = at(h('Projects/Narcissus/26-10-02_light-probe'))
  assert.deepEqual([r.outcome, r.dir_anchor?.name, r.learn_dir], ['none', 'Narcissus', '~/Projects/Narcissus/26-10-02_light-probe'])
  assert.deepEqual([names(r), scores(r)], [['Real-space lighting match'], [0.375]])
})

test('rung 4: area directories resolve to their anchor and are never learned', () => {
  const cases = [
    ['Projects/Narcissus', target('project', 'Narcissus', `${P}/Art/Narcissus/Narcissus.md`, 'Art', 'Art')],
    ['Projects/skate', target('area', 'Skate (area)', `${P}/Skate (area)/Skate (area).md`, 'Skate (area)', 'Skate')],
    ['Projects/3D', target('area', '3D print', `${P}/3D print/3D print.md`, '3D print', '3D print')],
  ]
  for (const [rel, t] of cases) {
    const r = at(h(rel))
    resolved(r, t, 'directory-name')
    assert.equal(r.learn_dir, null, rel)
  }
})

test('rung 4: umbrellas, archive and resource folders, and dirs outside any area', () => {
  let r = at(h('Projects/TSMS'))
  assert.deepEqual([r.outcome, r.learn_dir], ['none', '~/Projects/TSMS'])
  r = at(h('Projects'))
  assert.deepEqual([r.outcome, r.learn_dir], ['none', null])
  r = at(h('Projects/_archive'))
  assert.deepEqual([r.outcome, r.learn_dir], ['none', null])
  r = at(h('Projects/2D/_archive/26-08-01_x'))
  assert.deepEqual([r.outcome, r.dir_anchor?.name, r.learn_dir], ['none', '2D', '~/Projects/2D/_archive/26-08-01_x'])
  r = at(h('Projects/Narcissus/_sources'))
  assert.deepEqual([r.outcome, r.learn_dir], ['none', null])
  r = at(h('.agents/skills/unpack'))
  assert.deepEqual([r.outcome, r.dir_anchor, names(r)[0], r.learn_dir], ['none', null, 'Unpack Skill', '~/.agents/skills/unpack'],
    'no anchor: suggestions only, never a confident vault-wide guess')
  r = at(h('repos/tools/foo/tools'))
  assert.deepEqual([r.outcome, r.dir_anchor?.name, r.learn_dir], ['none', 'Tools', '~/repos/tools/foo'])
  assert.match(r.reason, /foo/, 'the repo names itself, never its sub-directory')
})

test('rung 4: non-git directories answer with exit 0', () => {
  let r = at(HOME)
  assert.deepEqual([r.outcome, r.candidates, r.learn_dir], ['none', [], null])
  r = at(h('Desktop/sketch'))
  assert.deepEqual([r.outcome, r.learn_dir], ['none', '~/Desktop/sketch'])
  r = at(path.join(OUTSIDE, 'plain'))
  assert.deepEqual([r.outcome, r.learn_dir], ['none', null])
})

// ---- Refusals -------------------------------------------------------------------------------------------------
test('a bad --cwd is refused only when a directory rung reads it', () => {
  refused([], /does not exist/, { cwd: path.join(scratch, 'nope') })
  refused([], /not a directory/, { cwd: path.join(scratch, 'a-file') })
  resolved(ok(['ts'], { cwd: path.join(scratch, 'nope') }), TS, 'argument')
  if (process.getuid?.() === 0) return  // root reads anything
  fs.chmodSync(LOCKED, 0o000)
  try {
    refused([], /not readable/, { cwd: LOCKED })
    resolved(ok(['ts'], { cwd: LOCKED }), TS, 'argument')
  } finally {
    fs.chmodSync(LOCKED, 0o755)
  }
})

test('usage errors, a missing vault and missing PyYAML each print one line', () => {
  refused(['--learn', '~/Desktop/sketch'], null)
  refused(['--learn', '~/Desktop/sketch', `${P}/2D/Gig Posters.md`, 'extra'], null)
  refused(['--bogus'], null)
  for (const args of [['ts'], ['--learn', '~/Desktop/sketch', `${P}/2D/Gig Posters.md`]]) {
    let r = run(args, { vault: path.join(scratch, 'no-vault') })
    assert.deepEqual([r.status, r.stdout], [3, ''])
    assert.match(r.stderr, /^resolve-target: no vault at [^\n]*\n$/)
    r = run(args, { pyFlags: ['-S'] })  // -S drops site-packages, so PyYAML is gone
    assert.deepEqual([r.status, r.stdout], [3, ''])
    assert.match(r.stderr, /^resolve-target: PyYAML is required[^\n]*\n$/)
  }
})

// ---- --learn -------------------------------------------------------------------------------------------------
function learn(dir, note, vault, opts = {}) {
  const r = run(['--learn', dir, note], { ...opts, vault })
  assert.equal(r.stderr, '', `stderr for --learn ${dir} ${note}`)
  assert.equal(r.status, 0)
  return JSON.parse(r.stdout)
}
// The one line `after` adds to `before`; every other byte equal.
function addedLine(before, after) {
  const b = before.split('\n')
  const a = after.split('\n')
  assert.equal(a.length, b.length + 1, 'exactly one new line')
  const i = a.findIndex((l, k) => l !== b[k])
  assert.deepEqual([...a.slice(0, i), ...a.slice(i + 1)], b, 'every other byte equal')
  return a[i]
}

test('learn: an undeclared repo joins the note\'s block list, then resolves at rung 2; a repeat is refused', () => {
  const vault = makeVault()
  const rel = `${P}/AI/Thread Skill.md`
  const before = read(vault, rel)
  const ino = fs.statSync(path.join(vault, rel)).ino
  assert.equal(at(h('repos/tools/thread-skill-rollout'), { vault }).learn_dir, '~/repos/tools/thread-skill-rollout')
  assert.deepEqual(learn('~/repos/tools/thread-skill-rollout', rel, vault), { learned: '~/repos/tools/thread-skill-rollout', note: rel })
  assert.equal(addedLine(before, read(vault, rel)), '  - ~/repos/tools/thread-skill-rollout')
  assert.equal(fs.statSync(path.join(vault, rel)).ino, ino, 'written in place')
  for (const cwd of [h('repos/tools/thread-skill-rollout'), h('repos/tools/thread-skill-rollout/.claude/worktrees/wt')]) {
    resolved(at(cwd, { vault }), TS, 'directory')
  }
  refused(['--learn', h('repos/tools/thread-skill-rollout'), rel], /already declared by Work\/Projects\/AI\/Thread Skill\.md/, { vault })
})

test('learn: dated dirs, a workspace root and a stopped rung-4 pick', () => {
  const vault = makeVault()
  const gig = `${P}/2D/Gig Posters.md`
  const GIG = target('project', 'Gig Posters', gig, '2D', '2D')
  learn('~/Projects/2D/26-09-24_macklemore-mate', gig, vault)
  resolved(at(h('Projects/2D/26-09-24_macklemore-mate'), { vault }), GIG, 'directory')
  // The stop correction: a rung-4 `resolved` pick still carries its learn_dir, and a learn into another project lands.
  const possum = at(h('Projects/2D/26-08-03_possum-paste-up/finals'), { vault })
  assert.deepEqual([possum.outcome, possum.target.name, possum.learn_dir], ['resolved', 'Possum Paste-Up', '~/Projects/2D/26-08-03_possum-paste-up'])
  learn(possum.learn_dir, gig, vault)
  resolved(at(h('Projects/2D/26-08-03_possum-paste-up/finals'), { vault }), GIG, 'directory')
  const echo = `${P}/Art/Narcissus/Echo prototype.md`
  learn(h('repos/workspaces/td-experiments-workspace'), echo, vault)
  resolved(at(h('repos/workspaces/td-experiments-workspace/launchers/full'), { vault }),
    target('project', 'Echo prototype', echo, 'Art', 'Art'), 'directory')
  assert.deepEqual(read(vault, gig).split('\n').filter((l) => l.startsWith('  - ~/')),
    ['  - ~/Projects/2D/26-07-01_gig-posters', '  - ~/Projects/2D/26-09-24_macklemore-mate', '  - ~/Projects/2D/26-08-03_possum-paste-up'])
})

test('learn: two notes share a basename — the path lands in exactly one, the bare name is refused', () => {
  const vault = makeVault()
  const dir = '~/Projects/Narcissus/26-10-02_light-probe'
  refused(['--learn', dir, 'Experiments'], /ambiguous/, { vault })
  const ikeda = read(vault, EXP_IKEDA)
  const before = read(vault, EXP_RSLM)
  learn(dir, EXP_RSLM, vault)
  assert.equal(read(vault, EXP_IKEDA), ikeda, 'the other Experiments note is untouched')
  assert.equal(read(vault, EXP_RSLM), before.replace('\nrepos:\n', `\nrepos:\n  - ${dir}\n`), 'a null repos: becomes a one-item list')
  resolved(at(h('Projects/Narcissus/26-10-02_light-probe'), { vault }), target('project', 'Experiments', EXP_RSLM, 'Art', 'Art'), 'directory')
})

test('learn: a non-git dir, by absolute or ~/ form', () => {
  const a = makeVault()
  const b = makeVault()
  const gig = `${P}/2D/Gig Posters.md`
  learn(h('Desktop/sketch'), gig, a)
  learn('~/Desktop/sketch', gig, b)
  assert.equal(read(a, gig), read(b, gig))
  assert.match(read(a, gig), /^ {2}- ~\/Desktop\/sketch$/m)
})

test('learn: ~/.agents is an umbrella and each skill names itself, with no repos: entry under ~/.agents', () => {
  // The live vault's ~/.agents/skills/ab and ~/.agents/skills/method declarations are gone here, so nothing a note
  // declares frames ~/.agents/skills: the umbrella and the frame must hold on their own.
  const vault = makeVault({
    [`${P}/AI/Bake-off Model Rails.md`]: proj('AI', '\nrepos:\n  - ~/repos/workspaces\naliases:\n  - bakeoff-model-rails'),
    [`${P}/AI/Method Skill.md`]: proj('AI', '\nrepos:\naliases:\n  - method\n  - method-skill'),
  })
  const unpack = `${P}/AI/Unpack Skill.md`
  let r = at(h('.agents/skills/unpack'), { vault })
  assert.deepEqual([r.outcome, r.rung, r.dir_anchor, names(r)[0], r.learn_dir],
    ['none', 'directory-name', null, 'Unpack Skill', '~/.agents/skills/unpack'])
  assert.match(r.reason, /holds unpack/, 'the skill names itself, never .agents')
  for (const cwd of [h('.agents'), h('.agents/skills')]) assert.equal(at(cwd, { vault }).learn_dir, null, cwd)
  for (const dir of [h('.agents'), '~/.agents', h('.agents/skills')]) refused(['--learn', dir, unpack], /umbrella/, { vault })
  learn('~/.agents/skills/unpack', unpack, vault)
  resolved(at(h('.agents/skills/unpack'), { vault }), target('project', 'Unpack Skill', unpack, 'AI', 'AI'), 'directory')
  r = at(h('.agents/skills/method'), { vault })
  assert.deepEqual([r.outcome, r.rung, names(r)[0], r.learn_dir], ['none', 'directory-name', 'Method Skill', '~/.agents/skills/method'],
    'one learned skill never claims its siblings')
})

test('learn: every directory the resolver would not name is refused, and the vault is untouched', () => {
  const vault = makeVault()
  const gig = `${P}/2D/Gig Posters.md`
  const cases = [
    [h('repos/tools/murmur'), /already declared by Work\/Projects\/AI\/Murmur\.md/],
    [h('repos/workspaces'), /already declared/],
    [h('repos/workspaces/_shared'), /_-prefixed/],
    [h('Projects'), /umbrella/],
    [h('Projects/2D'), /area directory/],
    [h('Projects/_archive'), /_-prefixed/],
    [h('Projects/Narcissus/_sources'), /_-prefixed/],
    [h('repos/tools'), /area directory/],
    [h('.agents'), /umbrella/],
    [h('.agents/skills'), /umbrella/],
    [HOME, /umbrella/],
    [h('repos/workspaces/animately-workspace'), /no learnable directory here/],
    [h('repos/tools/thread-skill-rollout/docs'), /the resolver names ~\/repos\/tools\/thread-skill-rollout for this directory/],
    [path.join(OUTSIDE, 'plain'), /outside HOME/],
    [h('nowhere'), /no such directory/],
  ]
  for (const [dir, why] of cases) refused(['--learn', dir, gig], why, { vault })
})

test('learn: every repos: shape becomes a valid list of the old entries plus the new one', () => {
  const dir = '~/Projects/2D/26-09-24_macklemore-mate'
  const head = 'tags:\n  - project\narea:\n  - 2D\nstatus: queued'
  const shapes = {
    null: [`${head}\nrepos:\ndone: false`, []],
    empty: [`${head}\nrepos: []\ndone: false`, []],
    absent: [`${head}\ndone: false`, []],
    flow: [`${head}\nrepos: [~/elsewhere/a, "~/elsewhere/b"]\ndone: false`, ['~/elsewhere/a', '~/elsewhere/b']],
    scalar: [`${head}\nrepos: ~/elsewhere/a\ndone: false`, ['~/elsewhere/a']],
  }
  for (const [shape, [lines, old]] of Object.entries(shapes)) {
    const gig = `${P}/2D/Gig Posters.md`
    const vault = makeVault({ [gig]: fm(lines, '\n# Gig Posters\n') })
    learn(dir, gig, vault)
    const text = read(vault, gig)
    const parsed = spawnSync('python3', ['-c', 'import json,sys,yaml; t=open(sys.argv[1]).read(); print(json.dumps(yaml.safe_load(t.split("---")[1])))',
      path.join(vault, gig)], { encoding: 'utf8' })
    assert.equal(parsed.status, 0, parsed.stderr)
    const data = JSON.parse(parsed.stdout)
    assert.deepEqual(data.repos, [...old, dir], shape)
    assert.equal(data.done, false, `${shape}: every other key unchanged`)
    assert.match(text, /\n# Gig Posters\n$/, `${shape}: the body is untouched`)
  }
})

test('learn: only a live project note takes a directory', () => {
  const vault = makeVault()
  const dir = '~/Projects/2D/26-09-24_macklemore-mate'
  for (const [note, why] of [
    [`${P}/2D/2D.md`, /area note/],
    [`${P}/Archive/Research System.md`, /archived/],
    [`${P}/Tools/Shelved Gadget.md`, /archived/],
    [`${P}/Tools/Finished Gadget.md`, /done/],
    [`${P}/Tools/Done Flag Gadget.md`, /done/],
    ['Nope', /no note/],
    ['Experiments', /ambiguous/],
    ['Work/Tasks/brain dump 2026-10-01.md', /not a project note/],
  ]) refused(['--learn', dir, note], why, { vault })
})
