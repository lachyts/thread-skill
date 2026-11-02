// skills/_shared/scripts/estate-dispatch.py — the estate pass's deterministic half after the ranker (ADR 0041;
// CONTEXT.md **Decision round**, **Dispatch plan**; skills/orient-all/SKILL.md is its one caller). Every case runs the
// shipped script under one temp dir S: the fixture vault V, a fake HOME, and the grades files the grading agents
// would return, written by hand. The scan is the real one (`estate-scan.py --vault V --today 2026-10-20 --deadline 0`,
// which starts no subprocess, so every rollout summary is null and every repo check unchecked); the rollout summaries,
// one blocker and two clones' rolloutRoot are injected into a copy of its JSON, as the status probes and repo checks
// would have found them. The rank is the real `estate-rank.py rank` over that copy. Both run once and are shared.
// The notes three schedule forks would have written are added to V after the scan, as they land after it in a real
// pass. record writes only copies of V, and log (D16) only its own events dirs under S. D17-D21 are schedule's
// Pre-flight (schedule § 1.5, ADR 0047), over a vault of their own, VF; D22 is the question gate's (ADR 0054) over VF
// with a second grades file: his decisions asked in the Framing, the rest written as Decided for you.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { root } from './lib/contract-text.mjs'

const DISPATCH = path.join(root, 'skills', '_shared', 'scripts', 'estate-dispatch.py')
const RANK = path.join(root, 'skills', '_shared', 'scripts', 'estate-rank.py')
const SCAN = path.join(root, 'skills', '_shared', 'scripts', 'estate-scan.py')
const RR = path.join(root, 'skills', 'execute', 'scripts', 'reconcile-rollout.py')
const TODAY = '2026-10-20'

// The estate-rank suite's base env: git's repo-local names scrubbed, the real user base pinned (a `pip install --user`
// PyYAML resolves under HOME, which every run swaps), HOME, the events dir and the Leg lock dir inside S.
const drop = spawnSync('git', ['rev-parse', '--local-env-vars'], { encoding: 'utf8' }).stdout.split('\n').filter(Boolean)
const base = { ...process.env }
for (const name of drop) delete base[name]
base.PYTHONUSERBASE ??= spawnSync('python3', ['-c', 'import site; print(site.getuserbase())'], { encoding: 'utf8' }).stdout.trim()

const S = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'estate-dispatch-')))
after(() => fs.rmSync(S, { recursive: true, force: true }))
const HOME = path.join(S, 'home')
fs.mkdirSync(HOME, { recursive: true })
const env = { ...base }
for (const name of ['CLAUDE_PLUGIN_ROOT', 'PYTHONDONTWRITEBYTECODE']) delete env[name]
Object.assign(env, { HOME, THREAD_EVENTS_DIR: process.env.THREAD_TEST_EVENTS_DIR || path.join(S, 'events'),
  THREAD_LEG_LOCK_DIR: path.join(S, 'leg-locks') })

const mkdir = (p) => fs.mkdirSync(p, { recursive: true })
const write = (p, text) => { mkdir(path.dirname(p)); fs.writeFileSync(p, text) }
const once = (fn) => { let v; return () => (v ??= fn()) }
const ROOT = (name) => path.join(HOME, 'repos', name)

// ---- Vault V -------------------------------------------------------------------------------------------------
const V = path.join(S, 'v')
const TASKS = path.join(V, 'Work', 'Tasks')
const fm = (lines, body = '\n# Note\n') => `---\n${lines}\n---\n${body}`
const P = (name, status, rest = '') =>
  write(path.join(V, 'Work', 'Projects', `${name}.md`), fm(`tags:\n  - project${status ? `\nstatus: ${status}` : ''}${rest}`))
const repos = (...names) => `\nrepos:${names.map((n) => `\n  - ~/repos/${n}`).join('')}`
const links = (key, list) => (list.length ? `\n${key}:${list.map((l) => `\n  - "[[${l}]]"`).join('')}` : '')
const T = (slug, status, projects, rest = '', body = '') => write(path.join(TASKS, `${slug}.md`),
  fm(`tags:\n  - task\nstatus: ${status}${links('projects', projects)}${rest}`, `\n# Task ${slug}\n${body}`))

P('Crown', 'crowned', `\ncrowned: 2026-10-01${repos('crown')}`)
P('Act', 'active', `\narea: "[[Tools]]"${repos('shared')}`)
P('Shared', 'active', repos('shared'))
P('Mira', 'active', repos('mira'))
P('Mirb', 'active', repos('mirb'))
P('Two', 'active', repos('two-a', 'two-b'))
P('Dup One', 'active', repos('dup1'))
P('dup-one', 'active', repos('dup2'))
P("Lachy's Tools", 'active', repos('lt1'))
P('Lachys Tools', 'active', repos('lt2'))
P('Café', 'active', repos('cafe1'))
P('Cafe', 'active', repos('cafe2'))
P('Ser', 'active')
P('Ser2', 'active')
P('Blk', 'active', repos('blk'))
P('NoRepo', 'active')
P('ParkA', 'parked', repos('parka'))
P('Holds', 'active')
P('Lab', 'active')
P('Grl', 'active')
P('Sess', 'active')
P('Bo', 'queued')
P('Rec', 'active')
P('Deps', 'active', repos('deps'))
P('Chain', 'active', repos('chain'))

for (const s of ['crown-a', 'crown-b']) T(s, 'open', ['Crown'])
T('act-a', 'open', ['Act'])
T('act-call', 'open', ['Act'])
T('act-dep', 'open', ['Act'], links('depends-on', ['act-call']))
T('act-orient', 'open', ['Act'])
T('act-held', 'open', ['Act'], links('depends-on', ['act-orient']))
T('act-on-park', 'open', ['Act'], links('depends-on', ['pa-ready']))
T('act-cyc-a', 'open', ['Act'], links('depends-on', ['act-cyc-b']))
T('act-cyc-b', 'open', ['Act'], links('depends-on', ['act-cyc-a']))
T('shared-a', 'open', ['Shared'])
T('mira-a', 'open', ['Mira'])
T('mirb-a', 'open', ['Mirb'])
for (const s of ['two-a1', 'two-b1', 'two-none']) T(s, 'open', ['Two'])
T('dup1-a', 'open', ['Dup One'])
T('dup2-a', 'open', ['dup-one'])
T('lt1-a', 'open', ["Lachy's Tools"])
T('lt2-a', 'open', ['Lachys Tools'])
T('cafe1-a', 'open', ['Café'])
T('cafe2-a', 'open', ['Cafe'])
for (const s of ['ser-a', 'ser-b']) T(s, 'open', ['Ser'])
T('ser2-a', 'open', ['Ser2'])
T('blk-a', 'open', ['Blk'])
T('nr-a', 'open', ['NoRepo'])
T('pa-ready', 'open', ['ParkA'])
T('pa-call', 'open', ['ParkA'])
T('pa-held', 'open', ['ParkA'], links('depends-on', ['act-orient']))
T('oc-orient', 'open', ['Holds'], links('depends-on', ['act-orient']))
T('rdy-mid', 'open', ['Holds'], links('depends-on', ['act-orient']))
T('oc-chain', 'open', ['Holds'], links('depends-on', ['rdy-mid']))
T('oc-on-call', 'open', ['Holds'], links('depends-on', ['act-call']))
const LAB = Array.from({ length: 30 }, (_, i) => `lab-${String(i + 1).padStart(2, '0')}`)
for (const s of LAB) T(s, 'open', ['Lab'])
for (const s of ['grl-a', 'grl-b']) T(s, 'open', ['Grl'])
T('sess-a', 'open', ['Sess'])
T('bo-orient', 'open', ['Bo'])
// Ready work on a dependency the ranker lets pass (Ready, unheld) but no scheduled run will hold: the same-root waiter's
// task (a deadlock, as Act takes the root), a blocked run's, session-lane work; and, held in turn, work on one of them.
T('act-on-shared', 'open', ['Act'], links('depends-on', ['shared-a']))
T('deps-blk', 'open', ['Deps'], links('depends-on', ['blk-a']))
T('deps-sess', 'open', ['Deps'], links('depends-on', ['sess-a']))
T('chain-a', 'open', ['Chain'], links('depends-on', ['deps-blk']))
// Dependencies outside the scan, for rank copies to name: reconcile-rollout's _dep_status holds a row until its
// dependency lands, so a dropped note, an archived open one (by tag or by folder) or a link to no note never frees it; a
// done note and a tombstone folded into a done unit hold nothing; a tombstone folded into an open unit holds as that unit.
T('gone-dropped', 'dropped', ['Rec'])
write(path.join(TASKS, 'gone-archived.md'), fm('tags:\n  - task\n  - archived\nstatus: open\nprojects:\n  - "[[Rec]]"'))
write(path.join(TASKS, 'Archive', 'gone-shelved.md'), fm('tags:\n  - task\nstatus: open\nprojects:\n  - "[[Rec]]"'))
T('tomb-open', 'merged', ['Rec'], '\nmerged_into: "[[shared-a]]"')
T('tomb-done', 'merged', ['Rec'], '\nmerged_into: "[[rec-done]]"')

// The record cases' tasks (ungraded: an ungraded task holds nothing it does not block).
const END = '- 2026-10-19T10:00:00Z orient end: run 1, job 2, partial: fork for Lachy: Keep v3 or v4; evidence: x.py:3; ' +
  'fork for Lachy: Cache size; evidence: y.py:9'
T('rec-new', 'open', ['Rec'])
T('rec-ext', 'open', ['Rec'], '', `\n## Decisions (asked ahead ${TODAY})\n\n- Older? → yes (asked at /thread:schedule; recommended: yes)\n\n## Integration log\n\n- a line\n`)
T('rec-fork', 'open', ['Rec'], '', `\n## Notes\n\n${END}\n\n## Plan\n\nSteps.\n`)
T('rec-done', 'done', ['Rec'])
T('rec-inprog', 'in_progress', ['Rec'])
T('rec-inprog2', 'in-progress', ['Rec'])
T('rec-review', 'review', ['Rec'])
T('rec-live', 'open', ['Rec'], '\nrollout: "[[clean-rollout-2026-10-19]]"')
T('rec-arch', 'open', ['Rec'], '\nrollout: "[[arch-rollout-2026-10-01]]"')
write(path.join(TASKS, 'rec-nonl.md'), fm('tags:\n  - task\nstatus: open\nprojects:\n  - "[[Rec]]"', '\n# Task rec-nonl'))
write(path.join(TASKS, 'Archive', 'Rollouts', 'arch-rollout-2026-10-01.md'),
  fm('tags:\n  - rollout\nstatus: done\nprotocol_version: 5'))

// The gate-pending tasks, each in its rollout. gate-two's section holds two gates and a sub-bullet under the first.
const GATE_TWO = '- spend: a paid image API — cap 50 USD\n  - 10 runs at 5 USD each\n- credential: the deploy token'
const BOUNCE = 'bounced by the plan judge (ADR 0038): the cap is not one priceable total.\n\n- spend: images — every push'
const gate = (slug, rollout, body) => T(slug, 'gate-pending', ['Crown'], `\nrollout: "[[${rollout}]]"`,
  `\n## Gated inputs (awaiting sign-off)\n\n${body}\n`)
gate('gate-two', 'live-rollout-2026-10-19', GATE_TWO)
T('gate-bounced', 'gate-pending', ['Crown'], '\nrollout: "[[live-rollout-2026-10-19]]"',
  `\n## Gated inputs (awaiting sign-off)\n\n- spend: images — cap 20 USD\n\n## Gate bounce (awaiting sign-off)\n\n${BOUNCE}\n`)
T('gate-needs', 'gate-pending', ['Crown'], '\nrollout: "[[live-rollout-2026-10-19]]"',
  '\n## Gated inputs (awaiting sign-off)\n\n- spend: x — cap 5 USD\n\n## Needs you\n\nWhich card?\n')
gate('gate-so', 'signoff-rollout-2026-10-19', '- irreversible: publish the post')
gate('gate-paused', 'paused-rollout-2026-10-19', '- spend: y — cap 5 USD')
gate('gate-drain', 'drain-rollout-2026-10-19', '- spend: z — cap 5 USD')
gate('gate-unread', 'unread-rollout-2026-10-19', '- spend: w — cap 5 USD')

// The live rollouts, one per hold, and a clean one.
function RO(slug, rest = '', body = `\nProject root: \`${path.join(S, `root-${slug.split('-')[0]}`)}\`\n`) {
  const version = rest.includes('protocol_version:') ? '' : '\nprotocol_version: 5'
  write(path.join(TASKS, `${slug}.md`),
    fm(`tags:\n  - rollout\nstatus: open${version}${rest}\nprojects:\n  - "[[Crown]]"`, `\n# Rollout ${slug}\n${body}`))
}
RO('clean-rollout-2026-10-19')
RO('paused-rollout-2026-10-19', '\npaused: 2026-10-19T10:00+11:00')
RO('signoff-rollout-2026-10-19', '\npaused: 2026-10-19T10:00+11:00\npaused_for: sign-off')
RO('drain-rollout-2026-10-19', '\npause_requested: true')
RO('live-rollout-2026-10-19')
RO('stamped-rollout-2026-10-19', '\nstart: unattended')
RO('sup-rollout-2026-10-18', '\nsuperseded_by: "[[gone-rollout-2026-10-19]]"')
RO('lin-rollout-2026-10-17')
RO('v4-rollout-2026-10-19', '\nprotocol_version: 4\nsupersedes: "[[lin-rollout-2026-10-17]]"')
RO('inc-rollout-2026-10-19')
RO('ser-rollout-2026-10-19', '\nshape: serial', '\n## Queue\n\n| # | Task | Launch | Surfaces |\n|---|---|---|---|\n')
RO('unread-rollout-2026-10-19')
// An owner tag on the live rollout's running task.
T('live-running', 'in_progress', ['Crown'], '\nrollout: "[[live-rollout-2026-10-19]]"\nowner: lead-abc12345')

// ---- The scan, once, and its injected copy ---------------------------------------------------------------------
const scanRun = spawnSync('python3', [SCAN, '--vault', V, '--today', TODAY, '--deadline', '0'],
  { encoding: 'utf8', cwd: S, env, timeout: 60000 })
let RAW = null
try { RAW = JSON.parse(scanRun.stdout) } catch { /* the first case names it */ }
const COUNTS = (o = {}) => ({ merged: 0, running: 0, integrating: 0, awaitingIntegration: 0, queued: 1, setAside: 0,
  setAsideAtIntegration: 0, folded: 0, other: 0, total: 1, ...o })
const SUM = (o = {}) => ({ rolloutStatus: 'open', paused: null, pause_requested: false, pausedFor: null, incomplete: null,
  ceiling: 4, ceilingError: null, counts: COUNTS(), progress: '0/1 merged', gitEnvHold: 0, setAside: [], running: [],
  awaitingIntegration: [], pendingSignOffs: [], awaitingSignOff: false, ...o })
const aside = (slug, extra = {}) => ({ slug, status: 'gate-pending', setAsideAt: 'gate', ...extra })
const PAUSE = '2026-10-19T10:00+11:00'
const SUMMARIES = {
  'clean-rollout-2026-10-19': SUM(),
  'paused-rollout-2026-10-19': SUM({ paused: PAUSE, setAside: [aside('gate-paused')], pendingSignOffs: ['gate-paused'] }),
  'signoff-rollout-2026-10-19': SUM({ paused: PAUSE, pausedFor: 'sign-off', awaitingSignOff: true,
    setAside: [aside('gate-so')], pendingSignOffs: ['gate-so'] }),
  'drain-rollout-2026-10-19': SUM({ pause_requested: true, setAside: [aside('gate-drain')], pendingSignOffs: ['gate-drain'] }),
  'live-rollout-2026-10-19': SUM({ counts: COUNTS({ running: 1, total: 4 }), running: ['live-running'],
    setAside: [aside('gate-two'), aside('gate-bounced'), aside('gate-needs', { needsHuman: 'Which card?' })],
    pendingSignOffs: ['gate-two', 'gate-bounced', 'gate-needs'] }),
  'stamped-rollout-2026-10-19': SUM(),
  'sup-rollout-2026-10-18': SUM(),
  'lin-rollout-2026-10-17': SUM(),
  'v4-rollout-2026-10-19': SUM(),
  'inc-rollout-2026-10-19': SUM({ incomplete: 'a queued task names no rollout' }),
  'ser-rollout-2026-10-19': SUM(),
}
const BLOCKER = [{ check: 'landing-register', why: 'listed fixture/blk: a fixture listing' }]
const CLONE = path.join(S, 'clone')
function injected(raw) {
  const s = structuredClone(raw)
  for (const r of s.rollouts) if (r.slug in SUMMARIES) { r.summary = SUMMARIES[r.slug]; r.error = null }
  for (const r of s.repos) {
    if (r.path === ROOT('blk')) r.blockers = BLOCKER
    if (r.path === ROOT('mira') || r.path === ROOT('mirb')) r.rolloutRoot = CLONE
  }
  return s
}
const SCAN_FILE = path.join(S, 'scan.json')
if (RAW) write(SCAN_FILE, JSON.stringify(injected(RAW)))
const scanned = () => { assert.equal(scanRun.status, 0, scanRun.stderr); assert.ok(RAW, 'the scan printed JSON'); return injected(RAW) }

// ---- The grades, and the rank, once ----------------------------------------------------------------------------
const LONG60 = 'Keep the flat-file store and migrate it in a second pass now'
const REC40 = 'Ship the lab rig on the old firmware now'
// The Framing's Note (asking.md § 3), the last words of every question rounds and preflight build (ADR 0054 d8).
const INVITE = 'What would make this wrong for you?'
// The orient prompt's last line for a project ticked on the pick list (ADR 0061): a big project's (PICK_LINE, its
// counts), and a small project's (PICK_LINE_SMALL), ticked for its Orient tasks alone.
const PICKED = (counts) => `Ticked on orient-all's pick list on ${TODAY} (${counts}): this project keeps its own session, so its ` +
  'One calls and Grills are asked here and its rollout is scheduled here.'
const PICKED_SMALL = (orient) => `Ticked on orient-all's pick list on ${TODAY} for its ${orient}.`
// An opened big project's orient prompt line for the repair that asks a live rollout's pending sign-offs
// (SIGN_OFF_LINE).
const ASKS = (rollout, gates) => `orient-all is starting /thread:repair [[${rollout}]] beside this session, which asks its pending ` +
  `sign-offs (${gates.map((g) => `[[${g}]]`).join(', ')}); leave those to it.`
assert.equal(LONG60.length, 60)
assert.equal(REC40.length, 40)
const D = (question, recommendation, options, extra = {}) =>
  ({ question, recommendation, options, confidence: 'high', why: 'fixture: src/x.py:12', ...extra })
const one = (q = 'Which way?') => [D(q, 'left', ['left', 'right'])]
const G = (slug, grade, shape, extra = {}) => ({ slug, grade, shape, size: 'S', why: `fixture grade for ${slug}`, ...extra })
const R = (slug, shape = 'parallel', extra = {}) => G(slug, 'Ready', shape, extra)
const GRADES = {
  Crown: [R('crown-a'), R('crown-b')],
  Act: [R('act-a', 'parallel', { size: 'M' }),
    G('act-call', 'One call', 'parallel', { decisions: [D('Which store?', 'sqlite', ['sqlite', LONG60], { fork: 'Store choice' })] }),
    R('act-dep'), G('act-orient', 'Orient', 'serial'), R('act-held'), R('act-on-park'), R('act-cyc-a'), R('act-cyc-b'),
    R('act-on-shared')],
  Shared: [R('shared-a')],
  Mira: [R('mira-a')],
  Mirb: [R('mirb-a')],
  Two: [R('two-a1', 'parallel', { repo: '~/repos/two-a' }), R('two-b1', 'parallel', { repo: '~/repos/two-b' }), R('two-none')],
  'Dup One': [R('dup1-a')],
  'dup-one': [R('dup2-a')],
  "Lachy's Tools": [R('lt1-a')],
  'Lachys Tools': [R('lt2-a')],
  'Café': [R('cafe1-a')],
  Cafe: [R('cafe2-a')],
  Ser: [R('ser-a', 'serial'), R('ser-b', 'serial')],
  Ser2: [R('ser2-a', 'serial')],
  Blk: [R('blk-a')],
  NoRepo: [R('nr-a')],
  ParkA: [R('pa-ready'), G('pa-call', 'One call', 'parallel', { decisions: one() }), R('pa-held')],
  Holds: [G('oc-orient', 'One call', 'serial', { decisions: one() }), R('rdy-mid', 'serial'),
    G('oc-chain', 'One call', 'serial', { decisions: one() }), G('oc-on-call', 'One call', 'serial', { decisions: one() })],
  Lab: LAB.map((s) => G(s, 'One call', 'serial', { decisions: s === 'lab-01' ? [D('Firmware?', REC40, [REC40, 'Wait'])] : one(`${s}?`) })),
  Grl: [G('grl-a', 'Grill', 'serial', { decisions: [D('Schema?', 'flat', ['flat', 'nested']), D('Cache?', 'none', ['none', 'lru'])] }),
    G('grl-b', 'Grill', 'serial', { decisions: [D('Keep v3 or v4?', 'v4', ['v4', 'v3'], { fork: 'Keep v3 or v4' }), D('Size?', 'small', ['small', 'large'])] })],
  Sess: [R('sess-a', 'session')],
  Bo: [G('bo-orient', 'Orient', 'serial')],
  Deps: [R('deps-blk'), R('deps-sess')],
  Chain: [R('chain-a')],
}
const GRADE_FILES = Object.entries(GRADES).map(([project, tasks], i) => {
  const p = path.join(S, 'grades', `grades-${String(i).padStart(2, '0')}.json`)
  write(p, JSON.stringify({ project, tasks }, null, 2) + '\n')
  return p
})
const RANK_FILE = path.join(S, 'rank.json')
const rankRun = RAW ? spawnSync('python3', [RANK, 'rank', '--scan', SCAN_FILE, '--today', TODAY,
  ...GRADE_FILES.flatMap((f) => ['--grades', f])], { encoding: 'utf8', cwd: S, env, timeout: 60000 }) : null
if (rankRun?.status === 0) write(RANK_FILE, rankRun.stdout)
let RANKED = null
try { RANKED = JSON.parse(rankRun?.stdout) } catch { /* the first case names it */ }
const ranked = () => { scanned(); assert.equal(rankRun.status, 0, rankRun.stderr); assert.ok(RANKED, 'the rank printed JSON'); return RANKED }

// ---- The notes three schedule forks wrote, after the scan ---------------------------------------------------
const W1 = path.join(S, 'w1')
const W2 = path.join(S, 'w2')
const WROTE_PAR = path.join(TASKS, 'wrote-par-rollout-2026-10-20.md')
const WROTE_SER = path.join(TASKS, 'wrote-ser-rollout-2026-10-20.md')
const WROTE_CX = path.join(TASKS, 'wrote-cx-rollout-2026-10-20.md')
const QUEUE = (alias, folder) => `\n## Queue\n\n| # | Task | Launch | Surfaces |\n|---|---|---|---|\n` +
  `| 1 | [[ser-a\\|a]] | \`${alias}\` from \`${folder}\` | \`repo:x\` |\n| 2 | [[ser-b\\|b]] | \`${alias}\` from \`${folder}\` | |\n`
write(WROTE_PAR, fm('tags:\n  - rollout\nstatus: open\nprotocol_version: 5\nprojects:\n  - "[[Act]]"',
  `\n# Rollout\n\nProject root: \`${path.join(S, 'root-act')}\`\n`))
write(WROTE_SER, fm('tags:\n  - rollout\nstatus: open\nshape: serial\nprotocol_version: 5\nprojects:\n  - "[[Ser]]"', QUEUE('cc-thread', W1)))
write(WROTE_CX, fm('tags:\n  - rollout\nstatus: open\nshape: serial\nprotocol_version: 5\nprojects:\n  - "[[Ser2]]"', QUEUE('cx-ops', W2)))

// ---- Running it ------------------------------------------------------------------------------------------------
function py(args, extra = {}) {
  const r = spawnSync('python3', [DISPATCH, ...args], { encoding: 'utf8', cwd: S, env: { ...env, ...extra }, timeout: 60000,
    stdio: ['ignore', 'pipe', 'pipe'] })
  let json = null
  try { json = JSON.parse(r.stdout) } catch { /* left null: the case's own assertion names it */ }
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, json }
}
const ok = (run) => { assert.equal(run.status, 0, run.stderr); assert.ok(run.json, `no JSON on stdout: ${run.stdout.slice(0, 300)}`); return run.json }
const refusal = (run, re, code = 2) => {
  assert.equal(run.status, code, `${run.stderr}${run.stdout}`)
  assert.equal(run.stdout, '')
  const lines = run.stderr.split('\n').filter(Boolean)
  assert.equal(lines.length, 1, run.stderr)
  assert.match(lines[0], /^estate-dispatch: /)
  if (re) assert.match(lines[0], re)
}
const keep = (name, text) => { const p = path.join(S, 'out', name); write(p, text); return p }
const rounds = (budget, more = []) => { ranked(); return py(['rounds', '--rank', RANK_FILE, '--scan', SCAN_FILE, '--budget', String(budget), ...more]) }
const R30 = once(() => rounds(30))
const R60 = once(() => rounds(60))
const plan = (more = []) => { ranked(); return py(['plan', '--rank', RANK_FILE, '--scan', SCAN_FILE, ...more]) }
const PLAN = once(() => plan())
const planFile = (name, run) => keep(`${name}.json`, ok(run) && run.stdout)
const PLAN_FILE = once(() => planFile('plan', PLAN()))
const SIGNED_FILE = once(() => planFile('plan-signed', plan(['--signed', 'gate-so'])))
const sessions = (planPath, more = []) => py(['sessions', '--plan', planPath, ...more])
const entryOf = (j, run) => { const e = j.schedule.find((x) => x.run === run); assert.ok(e, `a schedule entry ${run}: ${j.schedule.map((x) => x.run).join(', ')}`); return e }
const waitOf = (j, run) => { const e = j.waiting.find((x) => x.run === run); assert.ok(e, `a waiting run ${run}: ${j.waiting.map((x) => x.run).join(', ')}`); return e }
const rolloutOf = (j, slug) => { const r = j.rollouts.find((x) => x.slug === slug); assert.ok(r, slug); return r }
const runId = (project, shape, rootName) => `${project}/${shape}/${rootName ? ROOT(rootName) : '-'}`
// Every plan the suite reads, with the rank it was planned from, for D8b's invariants.
const allPlans = []
const tracked = (run, rk = null) => { const j = ok(run); allPlans.push({ j, rk }); return j }
// A rank copy with some tasks' dependsOn[] replaced, planned (the ranker's own holds are left as they were).
function planWith(name, deps, more = []) {
  const rk = structuredClone(ranked())
  for (const [slug, list] of Object.entries(deps)) rk.tasks.find((t) => t.slug === slug).dependsOn = list.map((d) => `[[${d}]]`)
  return { rk, j: tracked(py(['plan', '--rank', keep(`rank-${name}.json`, JSON.stringify(rk)), '--scan', SCAN_FILE, ...more]), rk) }
}

// mtime and size of every file under a dir, and its bytes, for the read-only and refusal cases.
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
const BEFORE = snap(V)
const copyVault = (name) => {
  const d = path.join(S, 'copies', name)
  fs.rmSync(d, { recursive: true, force: true })
  mkdir(path.dirname(d))
  fs.cpSync(V, d, { recursive: true })
  return d
}

// ---- D1. slices --------------------------------------------------------------------------------------------------
test('D1. slices: one file per home with its rows and repos; skipped tasks absent; an existing file is exit 2', () => {
  scanned()
  const dir = path.join(S, 'slices')
  const j = ok(py(['slices', '--scan', SCAN_FILE, '--dir', dir]))
  const files = fs.readdirSync(dir).sort()
  assert.equal(files.length, j.homes.length)
  assert.deepEqual(j.homes.map((h) => path.basename(h.file)), files)
  for (const [i, f] of files.entries()) assert.match(f, new RegExp(`^${String(i + 1).padStart(2, '0')}-[a-z0-9-]+\\.json$`))
  const crown = JSON.parse(fs.readFileSync(j.homes.find((h) => h.project === 'Crown').file, 'utf8'))
  assert.equal(crown.project.name, 'Crown')
  assert.equal(crown.today, TODAY)
  assert.deepEqual(crown.tasks.map((t) => t.slug), ['crown-a', 'crown-b'])
  assert.deepEqual(crown.repos.map((r) => r.path), [ROOT('crown')])
  const all = j.homes.flatMap((h) => h.tasks)
  for (const s of ['gate-two', 'rec-inprog', 'rec-review', 'rec-live', 'live-running']) assert.ok(!all.includes(s), `${s} is not gradeable`)
  assert.ok(all.includes('rec-arch'), 'a task whose rollout is archived is gradeable')
  assert.equal(j.gradeable, all.length)
  assert.ok(j.skipped >= 5)
  assert.ok(j.homes.some((h) => h.project === 'Dup One') && j.homes.some((h) => h.project === 'dup-one'))
  assert.equal(new Set(files).size, files.length, 'same-slug names get distinct files')
  const held = Object.fromEntries(files.map((f) => [f, fs.readFileSync(path.join(dir, f), 'utf8')]))
  refusal(py(['slices', '--scan', SCAN_FILE, '--dir', dir]), /already holds/)
  assert.deepEqual(Object.fromEntries(fs.readdirSync(dir).sort().map((f) => [f, fs.readFileSync(path.join(dir, f), 'utf8')])), held)
})

// ---- D2. rounds: sign-offs -----------------------------------------------------------------------------------------
test('D2. rounds: sign-offs asked under no pause and the sign-off pause only; gates raw and as approve-gates signs them', () => {
  const j = ok(R30())
  const so = Object.fromEntries(j.signOffs.map((x) => [x.slug, x]))
  assert.deepEqual(j.signOffs.filter((x) => x.ask).map((x) => x.slug).sort(), ['gate-bounced', 'gate-so', 'gate-two'])
  assert.deepEqual([so['gate-paused'].why, so['gate-drain'].why, so['gate-needs'].why, so['gate-unread'].why],
    ['paused', 'draining', 'needs you', 'status unread'])
  for (const s of ['gate-paused', 'gate-drain', 'gate-needs', 'gate-unread']) assert.equal(so[s].ask, false, s)
  assert.equal(so['gate-unread'].rollout, 'unread-rollout-2026-10-19', 'a null summary still finds its gate-pending tasks')
  assert.equal(so['gate-two'].gateText, GATE_TWO, 'the section raw, the nested sub-bullet kept')
  assert.deepEqual(so['gate-two'].gates, ['spend: a paid image API — cap 50 USD', '10 runs at 5 USD each', 'credential: the deploy token'])
  assert.deepEqual([so['gate-bounced'].bounced, so['gate-bounced'].bounce], [true, BOUNCE])
  assert.deepEqual([so['gate-two'].bounced, so['gate-two'].bounce], [false, ''])
  // Charged first, and asked at a zero budget.
  const zero = ok(rounds(0))
  assert.equal(zero.minutes.signOffs, 3)
  assert.equal(zero.index.filter((x) => x.kind === 'sign-off').length, 3)
  assert.deepEqual([zero.oneCalls, zero.grill, zero.unpark], [[], [], []])
  // The count approve-gates signs, on a copy.
  const VC = copyVault('approve')
  const ag = spawnSync('python3', [RR, 'approve-gates', '--dry-run', '--tasks', 'gate-two', '--tasks-dir', path.join(VC, 'Work', 'Tasks')],
    { encoding: 'utf8', env, timeout: 60000 })
  assert.equal(ag.status, 0, ag.stderr)
  assert.match(ag.stdout, new RegExp(`^gate-two: ${so['gate-two'].gates.length} gate\\(s\\) approved`))
  // A near-miss heading empties both: the heading is reconcile-rollout's constant, not a copy.
  const VN = copyVault('near-miss')
  const note = path.join(VN, 'Work', 'Tasks', 'gate-two.md')
  fs.writeFileSync(note, fs.readFileSync(note, 'utf8').replace('## Gated inputs (awaiting sign-off)', '## Gated inputs (awaiting signoff)'))
  const near = ok(rounds(30, ['--vault', VN])).signOffs.find((x) => x.slug === 'gate-two')
  assert.deepEqual([near.gateText, near.gates, near.ask], ['', [], false])
})

// ---- D3. rounds: the cut -------------------------------------------------------------------------------------------
test('D3. rounds: sign-offs first, then One calls, Unpark offers and Grills, stopping at the first that does not fit', () => {
  const j = ok(rounds(10))
  assert.equal(j.minutes.signOffs, 3)
  assert.deepEqual(j.oneCalls.map((x) => x.slug), ['oc-on-call', 'lab-01', 'lab-02', 'lab-03', 'lab-04', 'lab-05', 'lab-06'])
  assert.deepEqual([j.unpark, j.grill], [[], []])
  assert.equal(j.later[0].slug, 'lab-07', 'the first overflow stops the cut')
  assert.deepEqual(j.later.map((x) => x.kind), [...Array(25).fill('one-call'), 'unpark', 'grill', 'grill'])
  assert.deepEqual([j.later.at(-3).project, j.later.at(-1).slug], ['ParkA', 'grl-b'])
  assert.equal(j.minutes.used, 10)
  assert.ok(j.minutes.used - j.minutes.signOffs <= 10 - j.minutes.signOffs)
  const big = ok(R60())
  assert.deepEqual(big.unpark.map((u) => u.project), ['ParkA'])
  assert.deepEqual(big.grill.map((g) => g.slug), ['grl-a', 'grl-b'])
  assert.deepEqual(big.later, [])
  assert.equal(big.minutes.used, 3 + 32 + 1 + 8)
  assert.ok(big.minutes.used <= 60)
  for (const b of [0, 1, 4, 10, 30, 60]) {
    const r = ok(rounds(b))
    assert.ok(r.minutes.used - r.minutes.signOffs <= Math.max(0, b - r.minutes.signOffs), `budget ${b}: ${JSON.stringify(r.minutes)}`)
  }
})

// ---- D4. rounds: holds -------------------------------------------------------------------------------------------
test('D4. rounds: a One call held by Orient, directly or through a held Ready chain, is skipped; one held by a One call stays', () => {
  const j = ok(R60())
  assert.deepEqual(j.skipped.map((x) => [x.kind, x.slug]), [['one-call', 'oc-chain'], ['one-call', 'oc-orient']])
  assert.deepEqual(j.skipped[0].blockedBy, [{ slug: 'rdy-mid', why: 'held' }])
  const kept = j.oneCalls.find((x) => x.slug === 'oc-on-call')
  assert.deepEqual(kept.blockedBy, [{ slug: 'act-call', why: 'One call' }])
  assert.ok(!j.later.some((x) => ['oc-chain', 'oc-orient'].includes(x.slug)), 'a skipped task is charged nothing')
})

// ---- D5. payloads ------------------------------------------------------------------------------------------------
// A sign-off question shows its gates: every gate line inside its `Sign off` description, and the count in its text.
function signOffShowsGates(question, gates) {
  const desc = question.options.find((o) => o.label === 'Sign off')?.description ?? ''
  return gates.every((g) => desc.includes(g)) && question.question.includes(`${gates.length} gated input`)
}
test('D5. payloads: at most 4 questions a call, short headers and labels, the recommendation marked, every text unique', () => {
  const j = ok(R60())
  const qs = j.asks.flat()
  assert.ok(j.asks.every((a) => a.length >= 1 && a.length <= 4))
  assert.equal(qs.length, j.index.length)
  assert.deepEqual(qs.map((q) => q.question), j.index.map((x) => x.question))
  assert.equal(new Set(qs.map((q) => q.question)).size, qs.length, 'every text unique')
  assert.deepEqual([...new Set(j.index.map((x) => x.kind))], ['sign-off', 'one-call', 'unpark'], 'sign-offs, One calls, Unpark')
  for (const q of qs) {
    assert.ok(q.question.startsWith('[['), q.question)
    assert.ok(q.question.endsWith(` ${INVITE}`), `every question ends with the Note, sign-offs and Unpark offers included: ${q.question}`)
    assert.ok(q.header.length <= 12, q.header)
    assert.equal(q.multiSelect, false)
    assert.ok(q.options.length >= 2 && q.options.length <= 4)
    assert.equal(new Set(q.options.map((o) => o.label)).size, q.options.length)
    for (const o of q.options) {
      assert.ok(o.label.length <= 40, `label over 40: ${o.label}`)
      assert.ok(o.description.length > 0)
    }
  }
  for (const [i, x] of j.index.entries()) {
    const q = qs[i]
    assert.deepEqual(q.options.map((o) => o.label), x.labels)
    assert.equal(x.texts.length, x.labels.length)
    const recommended = q.options.filter((o) => o.label.endsWith(' (Recommended)'))
    if (x.kind === 'one-call') {
      assert.equal(recommended.length, 1)
      assert.equal(q.options[0], recommended[0])
      assert.equal(x.recommended, x.texts[0])
    } else {
      assert.deepEqual([recommended.length, x.recommended], [0, null], `${x.kind} carries no recommendation`)
    }
  }
  const call = j.index.findIndex((x) => x.slug === 'act-call')
  assert.equal(j.index[call].fork, 'Store choice')
  const opts = qs[call].options
  assert.deepEqual(opts[0], { label: 'sqlite (Recommended)', description: 'fixture: src/x.py:12' })
  assert.equal(opts[1].label, '2. Keep the flat-file store and migrate…')
  assert.ok(opts[1].description.startsWith(LONG60))
  assert.deepEqual(j.index[call].texts, ['sqlite', LONG60])
  const lab = j.index.findIndex((x) => x.slug === 'lab-01')
  assert.ok(qs[lab].options[0].label.startsWith('1. ') && qs[lab].options[0].label.endsWith('… (Recommended)'),
    `a 40-character recommendation is shortened: ${qs[lab].options[0].label}`)
  assert.ok(qs[lab].options[0].description.startsWith(REC40))
  assert.equal(j.index[lab].texts[0], REC40)
  // Sign-offs: the gates shown, the bounce named.
  for (const so of j.signOffs.filter((x) => x.ask)) {
    const i = j.index.findIndex((x) => x.kind === 'sign-off' && x.slug === so.slug)
    assert.ok(signOffShowsGates(qs[i], so.gates), so.slug)
    assert.deepEqual(qs[i].options.map((o) => o.label), ['Sign off', 'Not now'])
    assert.equal(j.index[i].bounced, so.bounced)
    if (so.bounced) assert.ok(qs[i].question.includes('ADR 0038') && qs[i].question.includes('## Gate bounce (awaiting sign-off)'))
  }
  const two = j.index.findIndex((x) => x.slug === 'gate-two')
  const dropped = structuredClone(qs[two])
  dropped.options[0].description = dropped.options[0].description.replace(' · credential: the deploy token', '')
  assert.equal(signOffShowsGates(dropped, j.signOffs.find((x) => x.slug === 'gate-two').gates), false, 'control: a gate dropped')
  const un = qs[j.index.findIndex((x) => x.kind === 'unpark')]
  assert.deepEqual(un.options.map((o) => o.label), ['unpark', 'snooze', 'kill'])
  assert.ok(un.options[2].description.includes('pa-ready') && un.options[2].description.includes('3 open tasks'), un.options[2].description)
})

// ---- D6. top and live ----------------------------------------------------------------------------------------------
test('D6. rounds: top holds --top rows in rank order, live carries each rollout state', () => {
  const j = ok(rounds(30, ['--top', '5']))
  const rk = ranked()
  assert.deepEqual(j.top.map((t) => t.slug), rk.tasks.filter((t) => t.rank !== null).slice(0, 5).map((t) => t.slug))
  assert.deepEqual(j.top.map((t) => t.rank), [1, 2, 3, 4, 5])
  const live = Object.fromEntries(j.live.map((x) => [x.slug, x]))
  assert.equal(live['paused-rollout-2026-10-19'].paused, PAUSE)
  assert.equal(live['signoff-rollout-2026-10-19'].awaitingSignOff, true)
  assert.equal(live['drain-rollout-2026-10-19'].pauseRequested, true)
  assert.equal(live['live-rollout-2026-10-19'].live, 1)
  assert.equal(live['unread-rollout-2026-10-19'].error, 'deadline')
  assert.equal(j.live.length, scanned().rollouts.length)
})

// ---- D7. Acceptance: decisions gate dispatch ---------------------------------------------------------------------------
test('D7. acceptance: plan schedules decided members whose holds clear, and nothing else', () => {
  const act = runId('Act', 'parallel', 'shared')
  const j = tracked(PLAN())
  assert.deepEqual(entryOf(j, runId('Crown', 'parallel', 'crown')).members, ['crown-a', 'crown-b'], 'Ready is scheduled')
  assert.deepEqual(entryOf(j, act).members, ['act-a'])
  assert.ok(j.undecided.some((x) => x.slug === 'act-call' && x.grade === 'One call'), 'an undecided One call waits')
  assert.deepEqual(j.held.find((x) => x.slug === 'act-dep').blockedBy, [{ slug: 'act-call', why: 'One call' }])
  const d = tracked(plan(['--decided', 'act-call']))
  assert.deepEqual(entryOf(d, act).members, ['act-a', 'act-dep', 'act-call'], 'decided, and its dependant clears')
  assert.ok(!d.undecided.some((x) => x.slug === 'act-call') && !d.held.some((x) => x.slug === 'act-dep'))
  for (const p of [j, d]) {
    assert.deepEqual(p.held.find((x) => x.slug === 'act-held').blockedBy, [{ slug: 'act-orient', why: 'Orient' }], 'Orient-held stays')
    assert.ok(p.held.some((x) => x.slug === 'act-on-park'), 'a parked dependency holds without --unparked')
    for (const c of ['act-cyc-a', 'act-cyc-b']) assert.ok(p.held.some((x) => x.slug === c), `${c}: a cycle never clears`)
  }
  const u = tracked(plan(['--unparked', 'ParkA', '--decided', 'act-cyc-a', '--decided', 'act-cyc-b']))
  assert.ok(entryOf(u, act).members.includes('act-on-park'), 'the parked hold clears once its home is unparked')
  for (const c of ['act-cyc-a', 'act-cyc-b']) assert.ok(u.held.some((x) => x.slug === c), `${c} stays held, decided or not`)
  assert.deepEqual(entryOf(tracked(plan(['--unparked', 'Work/Projects/ParkA.md'])), act).members, ['act-a', 'act-on-park'],
    '--unparked takes the note too')
  // A dependency the ranker lets pass but no scheduled entry holds: the member is held, whatever is decided.
  const rk = ranked()
  const NOT = (slug) => [{ slug, why: 'dependency not scheduled' }]
  const WANT = { 'act-on-shared': 'shared-a', 'deps-blk': 'blk-a', 'deps-sess': 'sess-a', 'chain-a': 'deps-blk' }
  for (const p of [j, d, u]) {
    for (const [slug, dep] of Object.entries(WANT)) {
      assert.deepEqual(rk.tasks.find((t) => t.slug === slug).blockedBy, [], `${slug}: the ranker holds nothing`)
      assert.deepEqual(p.held.find((x) => x.slug === slug)?.blockedBy, NOT(dep), `${slug} waits on ${dep}`)
      assert.ok(!p.schedule.some((e) => e.members.includes(slug)), `${slug} is not scheduled`)
    }
  }
  assert.ok(entryOf(j, act).members.includes('act-a'), 'the run keeps its other members')
})

// ---- D8. plan: runs ---------------------------------------------------------------------------------------------------
test('D8. plan: a blocker, an unknown or undeclared repo, a shared root and a parked run wait; the rest are scheduled', () => {
  const j = tracked(PLAN())
  const rk = ranked()
  assert.deepEqual(waitOf(j, runId('Blk', 'parallel', 'blk')).why,
    { kind: 'blocker', detail: 'landing-register: listed fixture/blk: a fixture listing' })
  const crownRun = rk.runs.find((r) => r.id === runId('Crown', 'parallel', 'crown'))
  assert.ok(crownRun.unchecked.length > 0 && crownRun.blockers.length === 0)
  entryOf(j, crownRun.id)
  assert.equal(waitOf(j, runId('Two', 'parallel')).why.kind, 'repo unknown')
  assert.equal(waitOf(j, runId('NoRepo', 'parallel')).why.kind, 'no repo declared')
  const shared = waitOf(j, runId('Shared', 'parallel', 'shared'))
  assert.equal(shared.why.kind, 'same root')
  assert.ok(shared.why.detail.includes(runId('Act', 'parallel', 'shared')), shared.why.detail)
  const mirb = waitOf(j, runId('Mirb', 'parallel', 'mirb'))
  assert.equal(mirb.why.kind, 'same root', 'matching rolloutRoots with different roots are one root')
  assert.ok(mirb.why.detail.includes(runId('Mira', 'parallel', 'mira')) && mirb.why.detail.includes(CLONE), mirb.why.detail)
  for (const e of j.schedule) {
    assert.ok(!e.args.includes('--regenerate'), e.run)
    assert.equal(e.args, `--tasks ${e.members.join(',')}`)
    const rows = e.members.map((s) => rk.tasks.find((t) => t.slug === s))
    for (const k of ['pr', 'signOff', 'eyeCheck', 'minutes']) assert.equal(e.review[k], rows.reduce((n, t) => n + t.review[k], 0), `${e.run} ${k}`)
  }
  assert.deepEqual(j.schedule.filter((e) => e.shape === 'serial').map((e) => e.run), ['Ser/serial/-', 'Ser2/serial/-'])
  for (const e of j.schedule.filter((x) => x.shape === 'serial')) assert.equal(e.root, null)
  const park = waitOf(j, runId('ParkA', 'parallel', 'parka'))
  assert.equal(park.why.kind, 'parked')
  const u = tracked(plan(['--unparked', 'ParkA', '--decided', 'pa-call']))
  assert.deepEqual(entryOf(u, park.run).members, ['pa-ready'], 'only its Ready, unheld members go')
  for (const w of ['Holds/serial/-', 'Lab/serial/-', 'Grl/serial/-']) assert.equal(waitOf(j, w).why.kind, 'nothing decided', w)
  assert.ok(!j.waiting.some((w) => w.run === runId('Act', 'parallel', 'shared')))
  // A run whose every member depends on a task no scheduled entry holds (a blocked run's, session-lane work) waits, and
  // so, at the fixpoint, does a run whose member depends on one of its members.
  const deps = waitOf(j, runId('Deps', 'parallel', 'deps'))
  assert.deepEqual([deps.members, deps.why], [[], { kind: 'dependency not scheduled',
    detail: 'every member left depends on a task no scheduled run holds: blk-a, sess-a' }])
  assert.deepEqual(waitOf(j, runId('Chain', 'parallel', 'chain')).why,
    { kind: 'dependency not scheduled', detail: 'every member left depends on a task no scheduled run holds: deps-blk' })
  // The pre-hold: a member whose dependency cannot go whatever the root contest decides (here a blocked run's task) is
  // held before any root is contested, so its run never takes the root, and the next run on it goes.
  const act = runId('Act', 'parallel', 'shared')
  const mira = runId('Mira', 'parallel', 'mira')
  const { j: m } = planWith('mira-on-blk', { 'mira-a': ['blk-a'] })
  assert.deepEqual(waitOf(m, mira).why,
    { kind: 'dependency not scheduled', detail: 'every member left depends on a task no scheduled run holds: blk-a' })
  assert.deepEqual(entryOf(m, mirb.run).members, ['mirb-a'], 'the same-root waiter goes once the root is free')
  // The review's probe: Act's act-a depends on Mirb's task. Mira never takes the clone root, so Mirb goes, act-a goes
  // with it, and Act keeps its root: the lower-ranked Shared still waits on it.
  const { j: ma } = planWith('mira-act', { 'mira-a': ['blk-a'], 'act-a': ['mirb-a'] })
  assert.deepEqual(entryOf(ma, act).members, ['act-a'], 'act-a is scheduled, its dependency with it')
  assert.deepEqual(entryOf(ma, mirb.run).members, ['mirb-a'])
  assert.equal(waitOf(ma, shared.run).why.kind, 'same root')
  assert.ok(waitOf(ma, shared.run).why.detail.includes(act), waitOf(ma, shared.run).why.detail)
  assert.ok(!ma.held.some((x) => x.slug === 'act-a'))
  assert.deepEqual(ma.held.find((x) => x.slug === 'act-on-shared').blockedBy, [{ slug: 'shared-a', why: 'dependency not scheduled' }])
  // A genuine late hold, a same-root cascade the pre-hold cannot foresee: crown-a and crown-b depend on shared-a, whose
  // run loses the shared root to Act, and act-a depends on crown-a. The first choice holds both Crown members; the
  // second holds act-a, so Act empties and frees the root, and Shared goes. crown-a and crown-b stay held, so the plan
  // never flips back, and say why: their dependency was scheduled only after they were held, and they go next pass.
  const crown = runId('Crown', 'parallel', 'crown')
  const { j: late } = planWith('late', { 'crown-a': ['shared-a'], 'crown-b': ['shared-a'], 'act-a': ['crown-a'] })
  assert.deepEqual(entryOf(late, shared.run).members, ['shared-a'])
  const LATE = [{ slug: 'shared-a', why: 'dependency scheduled late' }]
  for (const s of ['crown-a', 'crown-b', 'act-on-shared']) assert.deepEqual(late.held.find((x) => x.slug === s)?.blockedBy, LATE, s)
  assert.deepEqual(late.held.find((x) => x.slug === 'act-a').blockedBy, [{ slug: 'crown-a', why: 'dependency not scheduled' }])
  assert.deepEqual(waitOf(late, crown).why, { kind: 'dependency scheduled late',
    detail: 'every member left was held before its dependency was scheduled, and goes next pass: shared-a' })
  assert.deepEqual(waitOf(late, act).why,
    { kind: 'dependency not scheduled', detail: 'every member left depends on a task no scheduled run holds: crown-a' })
  // Dependencies outside the scan. reconcile-rollout holds a row until its dependency lands, and a dropped note, an
  // archived open one (by tag or in the Archive folder) or a link to no note never does, so the member is held; a landed
  // dependency, or a tombstone folded into a landed unit, holds nothing; a tombstone folded into an open unit holds as it.
  const { j: g } = planWith('gone', { 'crown-a': ['gone-dropped', 'rec-done'], 'crown-b': ['tomb-done', 'rec-done'],
    'lt1-a': ['gone-archived'], 'lt2-a': ['gone-shelved'], 'cafe1-a': ['no-such-task'], 'cafe2-a': ['tomb-open'] })
  assert.deepEqual(entryOf(g, crown).members, ['crown-b'], 'a landed dependency, direct or folded, holds nothing')
  const gone = (slug) => g.held.find((x) => x.slug === slug)?.blockedBy
  assert.deepEqual(gone('crown-a'), [{ slug: 'gone-dropped', why: 'dependency dropped' }])
  assert.deepEqual(gone('lt1-a'), [{ slug: 'gone-archived', why: 'dependency dropped' }])
  assert.deepEqual(gone('lt2-a'), [{ slug: 'gone-shelved', why: 'dependency dropped' }])
  assert.deepEqual(gone('cafe1-a'), [{ slug: 'no-such-task', why: 'dependency not found' }])
  assert.deepEqual(gone('cafe2-a'), [{ slug: 'shared-a', why: 'dependency not scheduled' }], 'a tombstone holds as its unit')
  assert.deepEqual(waitOf(g, runId("Lachy's Tools", 'parallel', 'lt1')).why,
    { kind: 'dependency not scheduled', detail: 'every member left depends on a task no scheduled run holds: gone-archived' })
})

// ---- D8b. plan: batches ----------------------------------------------------------------------------------------------
// Every dependency why is read against the final schedule: no held member or waiting run names, as not scheduled, a task
// some entry holds as a member, nor, as scheduled late, one no entry holds.
function whysHonest(j) {
  const members = new Set(j.schedule.flatMap((e) => e.members))
  const check = (who, slug, why) => {
    if (why === 'dependency not scheduled') assert.ok(!members.has(slug), `${who} names ${slug} not scheduled, but it is`)
    if (why === 'dependency scheduled late') assert.ok(members.has(slug), `${who} names ${slug} scheduled late, but it is not`)
  }
  for (const h of j.held) for (const b of h.blockedBy) check(h.slug, b.slug, b.why)
  for (const w of j.waiting) for (const s of w.why.detail.split(': ').pop().split(', ')) check(w.run, s, w.why.kind)
}
function batchesHold(j) {
  const by = {}
  for (const e of j.schedule) (by[e.batch] ??= []).push(e)
  const nums = Object.keys(by).map(Number).sort((a, b) => a - b)
  assert.deepEqual(nums, nums.map((_, i) => i + 1), 'batches number from 1 with no gaps')
  for (const [b, es] of Object.entries(by)) {
    for (const x of es) for (const y of es) {
      if (x !== y) assert.ok(!x.batchKeys.some((k) => y.batchKeys.includes(k)), `batch ${b}: ${x.run} and ${y.run} share a key`)
    }
  }
}
// Every scheduled member's open, not-in-flight dependencies are scheduled members too (reconcile-rollout holds the row
// until each lands).
function depsScheduled(j, rk = ranked()) {
  const key = (link) => String(link).replace(/^\[\[|\]\]$/g, '').split('|')[0].split('#')[0].split('/').pop().replace(/\.md$/i, '').trim().toLowerCase()
  const open = new Map()
  for (const t of scanned().tasks) if (!open.has(t.slug.toLowerCase())) open.set(t.slug.toLowerCase(), t)
  const members = new Set(j.schedule.flatMap((e) => e.members))
  for (const s of members) {
    for (const link of rk.tasks.find((t) => t.slug === s).dependsOn) {
      const t = open.get(key(link))
      if (t && !t.inFlight) assert.ok(members.has(t.slug), `${s} depends on ${t.slug}, which no scheduled entry holds`)
    }
  }
}
// D8c (ADR 0064): Act and Shared both declare ~/repos/shared. With each in its own clone (the scan's projects[] entries,
// injected as estate-scan finds them), both are scheduled, on one origin in different batches; with both on D they
// still contest the root.
function sharedPlan(name, shared) {
  const s = structuredClone(scanned())
  const row = s.repos.find((r) => r.path === ROOT('shared'))
  row.github = 'O/Shared'
  const own = (project, at) => ({ project, clone: null, rolloutRoot: at, selfRollout: null, root: at, blockers: [], unchecked: [] })
  row.projects = [own('Act', `${ROOT('shared')}-rollout`), own('Shared', shared)]
  const scanPath = keep(`scan-${name}.json`, JSON.stringify(s))
  const r = spawnSync('python3', [RANK, 'rank', '--scan', scanPath, '--today', TODAY, ...GRADE_FILES.flatMap((f) => ['--grades', f])],
    { encoding: 'utf8', cwd: S, env, timeout: 60000 })
  assert.equal(r.status, 0, r.stderr)
  return tracked(py(['plan', '--rank', keep(`rank-${name}.json`, r.stdout), '--scan', scanPath]))
}
test('D8c. plan: two projects in their own clones of one repo are both scheduled, in different batches; on one clone they contest', () => {
  const j = sharedPlan('own-clones', `${ROOT('shared')}-shared-rollout`)
  const act = entryOf(j, runId('Act', 'parallel', 'shared'))
  const sh = entryOf(j, runId('Shared', 'parallel', 'shared'))
  assert.deepEqual([act.origin, sh.origin], ['o/shared', 'o/shared'], 'the scan row\'s github, lower-cased')
  assert.deepEqual([act.rolloutRoot, sh.rolloutRoot], [`${ROOT('shared')}-rollout`, `${ROOT('shared')}-shared-rollout`])
  assert.notEqual(act.batch, sh.batch, 'one origin: never one batch')
  batchesHold(j)
  const c = sharedPlan('one-clone', `${ROOT('shared')}-rollout`)
  const wait = waitOf(c, runId('Shared', 'parallel', 'shared'))
  assert.equal(wait.why.kind, 'same root')
  assert.ok(wait.why.detail.includes(`${ROOT('shared')}-rollout`), wait.why.detail)
})

test('D8b. plan: entries whose names may meet on one note slug never share a batch; serial entries follow, one each', () => {
  const j = tracked(PLAN())
  const e = (project, shape = 'parallel', rootName) => j.schedule.find((x) => x.project === project && x.shape === shape &&
    (rootName === undefined || x.root === ROOT(rootName)))
  assert.deepEqual([e('Two', 'parallel', 'two-a').batch, e('Two', 'parallel', 'two-b').batch], [1, 2])
  assert.deepEqual(e('Two', 'parallel', 'two-a').batchKeys, ['two'])
  for (const [a, b] of [['Dup One', 'dup-one'], ["Lachy's Tools", 'Lachys Tools'], ['Café', 'Cafe']]) {
    assert.notEqual(e(a).batch, e(b).batch, `${a} and ${b} are batched apart`)
  }
  assert.deepEqual([e("Lachy's Tools").batchKeys, e('Lachys Tools').batchKeys], [['lachystools'], ['lachystools']])
  assert.deepEqual([e('Café').batchKeys, e('Cafe').batchKeys], [['caf', 'cafe'], ['cafe']])
  assert.deepEqual([e("Lachy's Tools").projectSlug, e('Café').projectSlug, e('Dup One').projectSlug], ['lachys-tools', 'cafe', 'dup-one'])
  assert.equal(e('Crown').batch, 1)
  assert.equal(e('Mira').batch, 1, 'a non-conflicting entry joins the lowest free batch')
  const top = Math.max(...j.schedule.filter((x) => x.shape === 'parallel').map((x) => x.batch))
  const serial = j.schedule.filter((x) => x.shape === 'serial').map((x) => x.batch)
  assert.deepEqual(serial, [top + 1, top + 2])
  assert.deepEqual(j.schedule.map((x) => x.batch), [...j.schedule.map((x) => x.batch)].sort((a, b) => a - b), 'listed by batch')
  for (const { j: p, rk } of allPlans) {
    batchesHold(p)
    depsScheduled(p, rk ?? ranked())
    whysHonest(p)
  }
  assert.ok(allPlans.some(({ j: p }) => p.held.some((h) => h.blockedBy.some((b) => b.why === 'dependency scheduled late'))),
    'some plan holds a member late')
  // The control: the round-2 plan, which named a scheduled task as not scheduled, fails the invariant.
  const bad = structuredClone(allPlans.find(({ j: p }) => p.schedule.some((x) => x.members.includes('mirb-a'))).j)
  bad.held.push({ slug: 'act-a', run: 'Act/parallel/x', grade: 'Ready', blockedBy: [{ slug: 'mirb-a', why: 'dependency not scheduled' }] })
  assert.throws(() => whysHonest(bad), /mirb-a not scheduled, but it is/)
})

// ---- D9. plan: orient whatever the budget -------------------------------------------------------------------------------
test('D9. plan: orient[] is the rank orient list whatever the budget, parked projects left out', () => {
  const rk = ranked()
  const want = rk.orient.map((o) => o.project)
  assert.deepEqual(want, ['Act', 'Bo'])
  const base = tracked(PLAN())
  assert.deepEqual(base.orient, [{ name: 'Act', note: 'Work/Projects/Act.md', area: ['Tools'] }, { name: 'Bo', note: 'Work/Projects/Bo.md', area: [] }])
  for (const b of [0, 60]) {
    const f = keep(`rounds-${b}.json`, ok(rounds(b)) && rounds(b).stdout)
    assert.deepEqual(tracked(plan(['--rounds', f, '--assume-answered'])).orient, base.orient, `budget ${b}`)
  }
})

// ---- D10. plan: rollouts and reinstate ------------------------------------------------------------------------------------
test('D10. plan: each live rollout carries its holds; execute, repair and reinstate follow from them', () => {
  const j = tracked(PLAN())
  const HOLD = {
    'clean-rollout-2026-10-19': [], 'paused-rollout-2026-10-19': ['paused'], 'signoff-rollout-2026-10-19': ['paused'],
    'drain-rollout-2026-10-19': ['draining'], 'live-rollout-2026-10-19': ['live queue'],
    'stamped-rollout-2026-10-19': ['start stamp'], 'sup-rollout-2026-10-18': ['superseded'],
    'lin-rollout-2026-10-17': ['lineage'], 'v4-rollout-2026-10-19': ['version'], 'inc-rollout-2026-10-19': ['incomplete'],
    'ser-rollout-2026-10-19': ['serial'], 'unread-rollout-2026-10-19': ['status unread'],
  }
  assert.deepEqual(j.rollouts.map((r) => r.slug).sort(), Object.keys(HOLD).sort())
  for (const [slug, holds] of Object.entries(HOLD)) assert.deepEqual(rolloutOf(j, slug).holds, holds, slug)
  assert.deepEqual(j.rollouts.filter((r) => r.canExecute).map((r) => r.slug), ['clean-rollout-2026-10-19'])
  assert.deepEqual(j.rollouts.filter((r) => !r.canRepair).map((r) => r.slug).sort(),
    ['lin-rollout-2026-10-17', 'ser-rollout-2026-10-19', 'sup-rollout-2026-10-18', 'unread-rollout-2026-10-19', 'v4-rollout-2026-10-19'])
  assert.deepEqual(j.reinstate, [])
  assert.deepEqual(rolloutOf(j, 'live-rollout-2026-10-19').owners, ['lead-abc12345'])
  const s = tracked(plan(['--signed', 'gate-so']))
  const so = rolloutOf(s, 'signoff-rollout-2026-10-19')
  assert.deepEqual([so.reinstate, so.canExecute], [true, true])
  assert.deepEqual(s.reinstate, ['signoff-rollout-2026-10-19'])
  assert.equal(rolloutOf(s, 'paused-rollout-2026-10-19').canExecute, false, 'a plain pause never reinstates')
  const partial = tracked(plan(['--signed', 'gate-two']))
  assert.deepEqual([rolloutOf(partial, 'signoff-rollout-2026-10-19').reinstate, rolloutOf(partial, 'signoff-rollout-2026-10-19').holds],
    [false, ['paused']])
  assert.equal(rolloutOf(tracked(plan(['--signed', 'gate-two', '--signed', 'gate-bounced', '--signed', 'gate-needs'])),
    'live-rollout-2026-10-19').reinstate, false, 'a live, unpaused rollout never reinstates')
})

// ---- D11. --assume-answered ----------------------------------------------------------------------------------------------
test('D11. plan: --assume-answered --rounds F equals passing F\'s slugs as --decided, byte for byte', () => {
  const r = ok(R30())
  const f = keep('rounds-30.json', R30().stdout)
  const slugs = [...r.oneCalls, ...r.grill].map((x) => x.slug)
  assert.ok(slugs.length > 10)
  const a = plan(['--rounds', f, '--assume-answered'])
  const b = plan(slugs.flatMap((s) => ['--decided', s]))
  assert.equal(a.status, 0, a.stderr)
  assert.equal(a.stdout, b.stdout)
  tracked(a)
  assert.ok(entryOf(a.json, 'Lab/serial/-').members.length > 0, 'an answered One call is scheduled')
  refusal(plan(['--assume-answered']), /--rounds/)
  refusal(plan(['--rounds', f]), /--assume-answered/)
})

// ---- D12. Acceptance: decisions written into task notes ---------------------------------------------------------------
test('D12. acceptance: record writes each answer into its task note, folded to one line, and refuses what it must', () => {
  const VR = copyVault('record')
  const rec = (task, q, a, r, more = []) => py(['record', '--task', task, '--question', q, '--answer', a, '--recommended', r,
    '--today', TODAY, '--vault', VR, ...more])
  const file = (slug) => path.join(VR, 'Work', 'Tasks', `${slug}.md`)
  const read = (slug) => fs.readFileSync(file(slug), 'utf8')
  const B = (q, a, r) => `- ${q} → ${a} (asked at /thread:orient-all; recommended: ${r})`
  // A new section, by byte diff.
  const before = read('rec-new')
  const ino = fs.statSync(file('rec-new')).ino
  let w = rec('rec-new', 'Which way?', 'left', 'left')
  assert.deepEqual([w.status, w.stdout, w.stderr], [0, 'recorded Work/Tasks/rec-new.md: Which way? → left\n', ''])
  assert.equal(read('rec-new'), `${before}\n## Decisions (asked ahead ${TODAY})\n\n${B('Which way?', 'left', 'left')}\n`)
  assert.equal(fs.statSync(file('rec-new')).ino, ino, 'written in place')
  // The same answer again: no change.
  const mt = fs.statSync(file('rec-new')).mtimeMs
  w = rec('rec-new', 'Which way?', 'left', 'left')
  assert.equal(w.status, 0, w.stderr)
  assert.match(w.stdout, /\[no-change\]/)
  assert.equal(fs.statSync(file('rec-new')).mtimeMs, mt)
  // The question as the rounds index words it, `[[<slug>]] ` first (an alias and any case too): the self-link is cut,
  // so it is the same answer, no change, and the note never links to itself.
  for (const q of ['[[rec-new]] Which way?', '[[Rec-New|that task]]  Which\n way?']) {
    w = rec('rec-new', q, 'left', 'left')
    assert.deepEqual([w.status, w.stdout], [0, 'Work/Tasks/rec-new.md: Which way? → left [no-change]\n'], q)
  }
  assert.equal(fs.statSync(file('rec-new')).mtimeMs, mt)
  assert.ok(!read('rec-new').includes('[[rec-new]]'))
  // A second answer the same day extends the section; a new date makes a new section.
  rec('rec-new', 'Cache?', 'none', 'lru')
  assert.equal(read('rec-new'), `${before}\n## Decisions (asked ahead ${TODAY})\n\n${B('Which way?', 'left', 'left')}\n${B('Cache?', 'none', 'lru')}\n`)
  const later = py(['record', '--task', 'rec-new', '--question', 'Q?', '--answer', 'A', '--recommended', 'A', '--today', '2026-10-21', '--vault', VR])
  assert.equal(later.status, 0, later.stderr)
  assert.ok(read('rec-new').endsWith(`\n\n## Decisions (asked ahead 2026-10-21)\n\n${B('Q?', 'A', 'A')}\n`))
  // Extended in place, before a following ## Integration log.
  rec('rec-ext', 'Store?', 'sqlite', 'sqlite')
  assert.ok(read('rec-ext').includes(`(asked at /thread:schedule; recommended: yes)\n${B('Store?', 'sqlite', 'sqlite')}\n\n## Integration log\n`), read('rec-ext'))
  // No trailing newline.
  const nonl = read('rec-nonl')
  rec('rec-nonl', 'Q?', 'yes', 'yes')
  assert.equal(read('rec-nonl'), `${nonl}\n\n## Decisions (asked ahead ${TODAY})\n\n${B('Q?', 'yes', 'yes')}\n`)
  // The fold: line breaks and runs of spaces become one space, so the bullet is one line.
  const f0 = read('rec-ext')
  w = rec('rec-ext', 'Keep\n  it?', 'Keep v3\n\n  but  log it\n', 'Keep v3')
  assert.equal(w.status, 0, w.stderr)
  assert.ok(read('rec-ext').includes(`\n${B('Keep it?', 'Keep v3 but log it', 'Keep v3')}\n`))
  assert.equal(read('rec-ext').split('\n').length, f0.split('\n').length + 1, 'one line added')
  // --fork appends orient's ruling line as the last ## Notes line.
  w = rec('rec-fork', 'Keep v3 or v4?', 'v4', 'v4', ['--fork', 'Keep  v3 or v4'])
  assert.equal(w.status, 0, w.stderr)
  assert.match(read('rec-fork'), new RegExp(`${END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\n- \\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}Z orient ruling: Keep v3 or v4 → v4\n\n## Plan\n`))
  // An open task whose rollout is archived is not in flight: it records.
  assert.equal(rec('rec-arch', 'Q?', 'yes', 'yes').status, 0)
  // A leading link to another task is the question's own text, kept.
  assert.equal(rec('rec-arch', '[[rec-new]] first?', 'yes', 'yes').status, 0)
  assert.ok(read('rec-arch').includes(`\n${B('[[rec-new]] first?', 'yes', 'yes')}\n`), read('rec-arch'))
  // Refusals: exit 2, the file byte-identical.
  const cases = [
    ['no-such-task', [], /no task note/],
    ['rec-done', [], /not Active/],
    ['rec-inprog', [], /in flight/],
    ['rec-inprog2', [], /in flight/],
    ['rec-review', [], /not Active/],
    ['rec-live', [], /in flight/],
    ['rec-new', ['--fork', 'Keep v3 or v4'], /names no `fork for Lachy/],
    ['rec-fork', ['--fork', 'Something else'], /names no `fork for Lachy/],
  ]
  for (const [slug, more, re] of cases) {
    const held = fs.existsSync(file(slug)) ? read(slug) : null
    refusal(rec(slug, 'Q?', 'A', 'A', more), re)
    if (held !== null) assert.equal(read(slug), held, slug)
  }
  const held = read('rec-new')
  refusal(rec('rec-new', 'Q?', ' \n\t ', 'A'), /--answer is empty/)
  refusal(rec('rec-new', ' [[rec-new]] ', 'A', 'A'), /--question is empty once its leading \[\[rec-new\]\] is stripped/)
  assert.equal(read('rec-new'), held)
  assert.deepEqual(snap(V), BEFORE, 'only the copy was written')
})

// ---- D13. usage ---------------------------------------------------------------------------------------------------------
test('D13. usage: a bad verb, flag (log\'s included), input, budget, status or written note is exit 2 with one line; a missing vault exit 3', () => {
  ranked()
  const notJson = keep('not-json.json', 'not json\n')
  const scan2 = keep('scan-2.json', JSON.stringify({ ...scanned(), schema: 2 }))
  const rank2 = keep('rank-2.json', JSON.stringify({ ...ranked(), schema: 2 }))
  const plan2 = keep('plan-2.json', JSON.stringify({ ...ok(PLAN()), schema: 2 }))
  refusal(py(['frob']))
  refusal(py([]), /a verb is required: slices \| rounds \| plan \| sessions \| record \| decided-for-you \| log \| preflight$/)
  refusal(py(['log', '--rank', RANK_FILE]), /--scan/)
  refusal(py(['log', '--rank', RANK_FILE, '--scan', SCAN_FILE, '--budget', '5']), /--budget/)
  refusal(py(['rounds', '--rank', RANK_FILE, '--scan', SCAN_FILE, '--budget', '5', '--bogus']))
  refusal(py(['rounds', '--rank', RANK_FILE, '--scan', notJson, '--budget', '5']), /not JSON/)
  refusal(py(['rounds', '--rank', notJson, '--scan', SCAN_FILE, '--budget', '5']), /not JSON/)
  refusal(py(['rounds', '--rank', RANK_FILE, '--scan', scan2, '--budget', '5']), /schema/)
  refusal(py(['plan', '--rank', rank2, '--scan', SCAN_FILE]), /schema/)
  refusal(py(['rounds', '--rank', RANK_FILE, '--scan', SCAN_FILE, '--budget', '-1']), /--budget/)
  refusal(py(['rounds', '--rank', RANK_FILE, '--scan', SCAN_FILE, '--budget', 'lots']), /--budget/)
  refusal(sessions(plan2), /schema/)
  refusal(sessions(notJson), /not JSON/)
  refusal(sessions(PLAN_FILE(), ['--status', 'clean-rollout-2026-10-19=14']), /1 to 13/)
  refusal(sessions(PLAN_FILE(), ['--status', 'clean-rollout-2026-10-19=0']), /1 to 13/)
  refusal(sessions(PLAN_FILE(), ['--status', 'unknown=6']), /rollout of the plan/)
  refusal(plan(['--status', 'bad']), /rollout of the scan/)
  refusal(plan(['--status', 'clean-rollout-2026-10-19=14']), /1 to 13/)
  refusal(sessions(PLAN_FILE(), ['--open', 'Nope']), /--open Nope: no project on the plan's pick list/)
  const noPick = keep('plan-no-pick.json', JSON.stringify({ ...ok(PLAN()), pick: [], pickAsk: [], pickIndex: null }))
  refusal(sessions(noPick, ['--open', 'Act']), /--open Act: no project on the plan's pick list/)
  const unpicked = { ...ok(PLAN()) }
  delete unpicked.pick
  refusal(sessions(keep('plan-unpicked.json', JSON.stringify(unpicked))), /has no pick list/)
  refusal(sessions(PLAN_FILE(), ['--wrote', path.join(V, 'Work', 'Projects', 'Act.md')]), /directly in/)
  refusal(sessions(PLAN_FILE(), ['--wrote', path.join(TASKS, 'Archive', 'Rollouts', 'arch-rollout-2026-10-01.md')]), /directly in/)
  refusal(py(['record', '--task', 'rec-new', '--question', 'Q', '--answer', 'A', '--recommended', 'A', '--today', 'soon', '--vault', V]), /--today/)
  const none = path.join(S, 'no-vault')
  for (const run of [py(['rounds', '--rank', RANK_FILE, '--scan', SCAN_FILE, '--budget', '5', '--vault', none]),
    py(['plan', '--rank', RANK_FILE, '--scan', SCAN_FILE, '--vault', none]),
    sessions(PLAN_FILE(), ['--vault', none]),
    py(['record', '--task', 'x', '--question', 'Q', '--answer', 'A', '--recommended', 'A', '--vault', none])]) {
    refusal(run, /no vault/, 3)
  }
})

// ---- D14. read-only and determinism -----------------------------------------------------------------------------------
test('D14. read-only and determinism: rounds, plan and sessions write nothing in the vault, and reruns are byte-equal', () => {
  ranked()
  assert.ok(!('PYTHONDONTWRITEBYTECODE' in env), 'the runs leave bytecode to the script')
  const runs = [
    () => rounds(30),
    () => plan(['--decided', 'act-call', '--unparked', 'ParkA', '--signed', 'gate-so']),
    () => sessions(SIGNED_FILE(), ['--wrote', WROTE_PAR, '--wrote', WROTE_SER, '--status', 'clean-rollout-2026-10-19=13', '--open', 'Act']),
    () => py(['decided-for-you', '--rank', RANK_FILE, '--tasks', 'act-a,act-call,grl-a']),
  ]
  for (const run of runs) {
    const a = run()
    assert.equal(a.status, 0, a.stderr)
    assert.equal(run().stdout, a.stdout)
  }
  const d = path.join(S, 'slices-again')
  const s1 = py(['slices', '--scan', SCAN_FILE, '--dir', d])
  fs.rmSync(d, { recursive: true, force: true })
  assert.equal(py(['slices', '--scan', SCAN_FILE, '--dir', d]).stdout, s1.stdout)
  assert.deepEqual(snap(V), BEFORE, 'the vault is untouched')
  assert.ok(!fs.existsSync(path.join(root, 'skills', '_shared', 'scripts', '__pycache__')), 'no __pycache__ under skills/')
  assert.ok(!fs.existsSync(path.join(root, 'skills', 'execute', 'scripts', '__pycache__')), 'no __pycache__ under skills/execute')
})

// ---- D15. Acceptance: sessions start on the allow-list ----------------------------------------------------------------
test('D15. acceptance: sessions starts written notes, live rollouts only on the allow-list behind the plan holds, orients last', () => {
  const wrote = ok(sessions(PLAN_FILE(), ['--wrote', WROTE_PAR, '--wrote', WROTE_SER, '--wrote', WROTE_CX]))
  const [par, ser, cx] = wrote.items
  assert.deepEqual([par.kind, par.rollout, par.cwd, par.prompt, par.manual, par.title],
    ['execute', 'wrote-par-rollout-2026-10-20', path.join(S, 'root-act'), '/thread:execute [[wrote-par-rollout-2026-10-20]]', false,
      'Execute: wrote-par-rollout-2026-10-20'])
  assert.deepEqual([ser.kind, ser.cwd, ser.alias, ser.manual, ser.title], ['leg', W1, 'cc-thread', false, 'Leg 1: wrote-ser-rollout-2026-10-20'])
  assert.ok(ser.prompt.startsWith('/thread:execute [[wrote-ser-rollout-2026-10-20]]\n'))
  assert.deepEqual([cx.kind, cx.alias, cx.manual], ['leg', 'cx-ops', true])
  // The allow-list, on the clean rollout.
  const CLEAN = 'clean-rollout-2026-10-19'
  for (let n = 1; n <= 13; n++) {
    const j = ok(sessions(PLAN_FILE(), ['--status', `${CLEAN}=${n}`]))
    const item = j.items.find((x) => x.rollout === CLEAN)
    const want = { 6: 'execute', 7: 'repair', 11: 'repair', 13: 'execute' }[n]
    assert.equal(item?.kind, want, `action ${n}`)
    const left = j.left.find((x) => x.rollout === CLEAN)
    assert.equal(left ? left.action : null, want ? null : n, `action ${n} left`)
    if (item) assert.equal(item.prompt, `/thread:${want === 'repair' ? 'repair' : 'execute'} [[${CLEAN}]]`)
  }
  const one = (planPath, slug, n) => {
    const j = ok(sessions(planPath, ['--status', `${slug}=${n}`]))
    return { item: j.items.find((x) => x.rollout === slug), left: j.left.find((x) => x.rollout === slug) }
  }
  const vetoes = [
    ['paused-rollout-2026-10-19', 8, 'paused'], ['live-rollout-2026-10-19', 13, 'live queue'],
    ['live-rollout-2026-10-19', 6, 'live queue'], ['stamped-rollout-2026-10-19', 13, 'start stamp'],
    ['drain-rollout-2026-10-19', 9, 'draining'], ['sup-rollout-2026-10-18', 7, 'superseded'],
    ['ser-rollout-2026-10-19', 13, 'serial'],
  ]
  for (const [slug, n, hold] of vetoes) {
    const r = one(PLAN_FILE(), slug, n)
    assert.equal(r.item, undefined, `${slug} ${n}`)
    assert.ok(r.left.holds.includes(hold), `${slug}: ${JSON.stringify(r.left)}`)
    assert.equal(r.left.action, n)
  }
  assert.match(one(PLAN_FILE(), 'paused-rollout-2026-10-19', 8).left.why, /paused by you: the reinstate is yours/)
  assert.match(one(PLAN_FILE(), 'signoff-rollout-2026-10-19', 8).left.why, /a gate is still unsigned/)
  const re = one(SIGNED_FILE(), 'signoff-rollout-2026-10-19', 8)
  assert.deepEqual([re.item?.kind, re.item?.prompt], ['execute', '/thread:execute [[signoff-rollout-2026-10-19]]'])
  assert.equal(one(PLAN_FILE(), 'live-rollout-2026-10-19', 7).item?.kind, 'repair', 'repair runs beside a live lead')
  // A sign-off pause every gate signed but another hold stands on (a start stamp: the Stage starts it; serial: Legs
  // run it) gets no item at action 8: the reinstate needs canExecute too. Two copies of the sign-off rollout, each with
  // one more line, in a vault copy and a scan copy that carry them.
  const VS = copyVault('signoff-held')
  const so = fs.readFileSync(path.join(TASKS, 'signoff-rollout-2026-10-19.md'), 'utf8')
  const sc = scanned()
  const soRow = sc.rollouts.find((r) => r.slug === 'signoff-rollout-2026-10-19')
  const HELD = { 'sostamp-rollout-2026-10-19': ['\nstart: unattended', 'start stamp'], 'soserial-rollout-2026-10-19': ['\nshape: serial', 'serial'] }
  for (const [slug, [line]] of Object.entries(HELD)) {
    assert.ok(so.includes('\npaused_for: sign-off'))
    write(path.join(VS, 'Work', 'Tasks', `${slug}.md`), so.replace('\npaused_for: sign-off', `\npaused_for: sign-off${line}`))
    sc.rollouts.push({ ...structuredClone(soRow), slug, note: `Work/Tasks/${slug}.md` })
  }
  const heldPlan = ok(py(['plan', '--rank', RANK_FILE, '--scan', keep('scan-signoff-held.json', JSON.stringify(sc)), '--vault', VS,
    '--signed', 'gate-so']))
  const heldFile = keep('plan-signoff-held.json', JSON.stringify(heldPlan))
  for (const [slug, [, hold]] of Object.entries(HELD)) {
    const r = rolloutOf(heldPlan, slug)
    assert.deepEqual([r.reinstate, r.canExecute, r.holds.includes('paused'), r.holds.includes(hold)], [true, false, true, true], slug)
    for (const n of [8, 6, 13]) {
      const got = one(heldFile, slug, n)
      assert.equal(got.item, undefined, `${slug} at action ${n}`)
      assert.ok(got.left.holds.includes(hold), `${slug}: ${JSON.stringify(got.left)}`)
    }
    assert.equal(one(heldFile, slug, 8).left.why, `status action 8 (\`paused\`): every gate signed, but held by ${hold}`)
  }
  assert.equal(one(heldFile, 'signoff-rollout-2026-10-19', 8).item?.kind, 'execute', 'the signed sign-off pause alone reinstates')
  // No --status: status unread.
  const bare = ok(sessions(PLAN_FILE()))
  assert.deepEqual(bare.left.map((x) => [x.action, x.why]).filter(([a]) => a !== null), [])
  assert.equal(bare.left.length, ok(PLAN()).rollouts.length)
  // Order: written notes, live executes, repairs, orients last. Act and Bo are small projects with an Orient task, so
  // each is on the pick list and gets its orient only when ticked (ADR 0061).
  assert.ok(!bare.items.some((x) => x.kind === 'orient'), 'no orient starts unticked')
  const all = ok(sessions(SIGNED_FILE(), ['--wrote', WROTE_PAR, '--wrote', WROTE_SER, '--status', 'signoff-rollout-2026-10-19=8',
    '--status', `${CLEAN}=11`, '--status', 'live-rollout-2026-10-19=7', '--open', 'Act', '--open', 'Bo']))
  assert.deepEqual(all.items.map((x) => [x.kind, x.rollout ?? x.project]), [
    ['execute', 'wrote-par-rollout-2026-10-20'], ['leg', 'wrote-ser-rollout-2026-10-20'],
    ['execute', 'signoff-rollout-2026-10-19'], ['repair', CLEAN], ['repair', 'live-rollout-2026-10-19'],
    ['orient', 'Act'], ['orient', 'Bo']])
  const act = all.items.find((x) => x.kind === 'orient' && x.project === 'Act')
  assert.equal(act.prompt, `/thread:orient [[Act]]\norient-all wrote [[wrote-par-rollout-2026-10-20]] for this project on ${TODAY} ` +
    `and is starting its execute; leave that rollout to it, its tasks are in flight.\n${PICKED_SMALL('1 Orient task')}`)
  assert.equal(act.why, 'ticked on the pick list')
  assert.equal(all.items.find((x) => x.project === 'Bo').prompt, `/thread:orient [[Bo]]\n${PICKED_SMALL('1 Orient task')}`)
  assert.equal(ok(sessions(PLAN_FILE(), ['--open', 'Act'])).items.find((x) => x.project === 'Act').prompt,
    `/thread:orient [[Act]]\n${PICKED_SMALL('1 Orient task')}`)
  for (const x of all.items) {
    assert.ok(x.title.length <= 60, x.title)
    assert.ok(x.tldr && !x.tldr.includes('/'), `a tldr with no paths: ${x.tldr}`)
  }
})

// ---- D16. log: the Grade log (p25-4) ----------------------------------------------------------------------------------
test('D16. log: one grade line per graded task, Orient included, under one pass; reruns, a half pass, a dry run, a name that is no slug (skipped) and refusals', () => {
  const rk = ranked()
  const sc = scanned()
  const evOf = (name) => path.join(S, 'grade-ev', name)
  const log = (rankFile, scanFile, ev, more = []) => py(['log', '--rank', rankFile, '--scan', scanFile, ...more], { THREAD_EVENTS_DIR: ev })
  const fileOf = (ev) => path.join(ev, 'grades.jsonl')
  const linesOf = (ev) => fs.readFileSync(fileOf(ev), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  const PASS = /g-\d{8}T\d{6}Z-[0-9a-f]{6}/
  // The real rank and scan: one line per rank task, in rank order, Orient included.
  const EV = evOf('one')
  const first = log(RANK_FILE, SCAN_FILE, EV)
  assert.equal(first.status, 0, first.stderr)
  assert.equal(first.stderr, '')
  assert.match(first.stdout, new RegExp(`^logged ${rk.tasks.length} grade\\(s\\), pass ${PASS.source}\\n$`))
  const lines = linesOf(EV)
  assert.deepEqual(lines.map((l) => l.task), rk.tasks.map((t) => t.slug.toLowerCase()))
  assert.ok(lines.some((l) => l.grade === 'Orient') && lines.some((l) => l.grade === 'Ready'), 'Orient and Ready both logged')
  for (const k of ['pass', 'ts', 'digest']) assert.equal(new Set(lines.map((l) => l[k])).size, 1, `one ${k}`)
  assert.match(lines[0].pass, new RegExp(`^${PASS.source}$`))
  assert.match(lines[0].digest, /^[0-9a-f]{12}$/)
  assert.equal(first.stdout.trim().split(' ').at(-1), lines[0].pass)
  const rowOf = Object.fromEntries(sc.tasks.map((r) => [r.slug.toLowerCase(), r]))
  rk.tasks.forEach((t, i) => {
    const l = lines[i]
    const want = { v: 1, rollout: null, kind: 'grade', project: t.home, grade: t.grade, agentGrade: t.agentGrade, shape: t.shape,
      size: t.size, decisions: t.decisions.length, low: t.decisions.filter((d) => d.confidence === 'low').length,
      held: t.blockedBy.length > 0, gates: t.gates }
    for (const [k, v] of Object.entries(want)) assert.deepEqual(l[k], v, `${t.slug}: ${k}`)
    assert.deepEqual(l.raised, t.raised.length ? t.raised.map((r) => r.why) : undefined, `${t.slug}: raised`)
    assert.equal(l.rank, t.rank ?? undefined, `${t.slug}: rank`)
    assert.equal(rowOf[l.task]?.rollout ?? null, null, `${t.slug}: the fixture rows link no rollout`)
    assert.equal(l.linked, undefined)
  })
  const by = Object.fromEntries(lines.map((l) => [l.task, l]))
  assert.deepEqual([by['act-orient'].grade, by['act-orient'].shape, 'rank' in by['act-orient']], ['Orient', 'serial', false])
  assert.deepEqual([by['act-held'].held, by['act-a'].held, by['act-a'].size, by['act-a'].rank >= 1], [true, false, 'M', true])
  assert.deepEqual([by['act-call'].grade, by['act-call'].decisions, by['grl-a'].grade, by['grl-a'].decisions], ['One call', 1, 'Grill', 2])
  // A rerun of the same pass is `exists`, byte-identical.
  const bytes = fs.readFileSync(fileOf(EV))
  const again = log(RANK_FILE, SCAN_FILE, EV)
  assert.equal(again.status, 0, again.stderr)
  assert.equal(again.stdout, `exists ${lines[0].pass} (${lines.length} grade(s))\n`)
  assert.deepEqual(fs.readFileSync(fileOf(EV)), bytes)
  // A pass whose write stopped half-way: the rerun writes only the missing line, under the same pass and ts.
  fs.writeFileSync(fileOf(EV), bytes.toString('utf8').split('\n').filter(Boolean).slice(0, -1).map((l) => `${l}\n`).join(''))
  const half = log(RANK_FILE, SCAN_FILE, EV)
  assert.equal(half.status, 0, half.stderr)
  assert.equal(half.stdout, `completed ${lines[0].pass}: 1 more\n`)
  assert.deepEqual(fs.readFileSync(fileOf(EV)), bytes, 'the completed pass is the whole pass again')
  // The same rank at another path is another pass ($S is mktemp'd per pass).
  const copy = keep('rank-copy.json', fs.readFileSync(RANK_FILE, 'utf8'))
  const other = log(copy, SCAN_FILE, EV)
  assert.equal(other.status, 0, other.stderr)
  assert.match(other.stdout, /^logged \d+ grade\(s\), pass /)
  const both = linesOf(EV)
  assert.equal(both.length, 2 * lines.length)
  assert.equal(new Set(both.map((l) => l.pass)).size, 2)
  assert.equal(new Set(both.map((l) => l.digest)).size, 2)
  // The rarer fields, from a rank and scan copy: raised whys, gates, low decisions and the linked rollout, normalised; a
  // reserved or non-slug rollout links nothing.
  const rk2 = structuredClone(rk)
  const crown = rk2.tasks.find((t) => t.slug === 'crown-a')
  Object.assign(crown, { grade: 'Grill', gates: ['spend', 'credential'],
    raised: [{ from: 'Ready', to: 'One call', why: 'decisions' }, { from: 'One call', to: 'Grill', why: 'confidence' }],
    decisions: [{ question: 'Q?', recommendation: 'a', options: ['a', 'b'], confidence: 'low', why: 'w' }] })
  const sc2 = structuredClone(sc)
  const setRow = (slug, rollout) => { sc2.tasks.find((r) => r.slug === slug).rollout = rollout }
  setRow('crown-a', 'Crown-Rollout-2026-10-20')
  setRow('crown-b', 'grades')
  setRow('act-a', 'not a slug!')
  const EV2 = evOf('two')
  const two = log(keep('rank-fields.json', JSON.stringify(rk2)), keep('scan-fields.json', JSON.stringify(sc2)), EV2)
  assert.equal(two.status, 0, two.stderr)
  const by2 = Object.fromEntries(linesOf(EV2).map((l) => [l.task, l]))
  assert.deepEqual([by2['crown-a'].grade, by2['crown-a'].gates, by2['crown-a'].raised, by2['crown-a'].decisions, by2['crown-a'].low,
    by2['crown-a'].linked], ['Grill', ['spend', 'credential'], ['decisions', 'confidence'], 1, 1, 'crown-rollout-2026-10-20'])
  assert.deepEqual(['linked' in by2['crown-b'], 'linked' in by2['act-a']], [false, false])
  // A task whose name is no slug (estate-scan's slug is the raw file stem, so a vault note named with spaces or capitals)
  // is skipped and named, never a refusal: the rest are logged, and the outcome line counts it for orient-all § 8.
  const VAULT_NAME = 'Autorun next command after handoff'
  const rk3 = structuredClone(rk)
  rk3.tasks.splice(1, 0, { ...structuredClone(rk.tasks[0]), slug: VAULT_NAME })
  const EV5 = evOf('vault-name')
  const rank3 = keep('rank-vault-name.json', JSON.stringify(rk3))
  const named = log(rank3, SCAN_FILE, EV5)
  assert.equal(named.status, 0, named.stderr)
  assert.equal(named.stderr, `estate-dispatch: skipped ${VAULT_NAME}: task '${VAULT_NAME}' is not a slug ([a-z0-9][a-z0-9._-]*)\n`)
  const kept5 = linesOf(EV5)
  assert.match(named.stdout, new RegExp(`^logged ${rk.tasks.length} grade\\(s\\), pass ${PASS.source}; 1 skipped \\(not a slug\\): ${VAULT_NAME}\\n$`))
  assert.deepEqual(kept5.map((l) => l.task), rk.tasks.map((t) => t.slug.toLowerCase()), 'every other task logged, in rank order')
  const named2 = log(rank3, SCAN_FILE, EV5)
  assert.equal(named2.status, 0, named2.stderr)
  assert.equal(named2.stdout, `exists ${kept5[0].pass} (${rk.tasks.length} grade(s)); 1 skipped (not a slug): ${VAULT_NAME}\n`)
  assert.equal(linesOf(EV5).length, rk.tasks.length, 'the rerun writes nothing')
  // A refused field still refuses the whole pass, a skipped name beside it or not.
  const rk4 = structuredClone(rk3)
  rk4.tasks[0].grade = 'Maybe'
  const EV6 = evOf('vault-name-refused')
  refusal(log(keep('rank-vault-name-bad.json', JSON.stringify(rk4)), SCAN_FILE, EV6), /refused the grade line/)
  assert.ok(!fs.existsSync(EV6), 'nothing written')
  // --dry-run prints the lines and writes nothing.
  const EV3 = evOf('dry')
  const dry = log(RANK_FILE, SCAN_FILE, EV3, ['--dry-run'])
  assert.equal(dry.status, 0, dry.stderr)
  assert.equal(dry.stdout.split('\n').filter((l) => l.startsWith('would log grade ')).length, rk.tasks.length)
  assert.match(dry.stdout, /^dry run, nothing written: logged \d+ grade\(s\), pass /m)
  assert.ok(!fs.existsSync(EV3), 'a dry run creates nothing')
  // A rank or scan that is not JSON, or of another schema: exit 2, nothing written.
  const notJson = keep('log-not-json.json', 'nope\n')
  const scanSchema = keep('log-scan-2.json', JSON.stringify({ ...sc, schema: 2 }))
  const EV4 = evOf('refused')
  refusal(log(notJson, SCAN_FILE, EV4), /not JSON/)
  refusal(log(RANK_FILE, scanSchema, EV4), /schema/)
  refusal(log(keep('rank-bad-grade.json', JSON.stringify({ ...rk, tasks: [{ ...rk.tasks[0], grade: 'Maybe' }] })), SCAN_FILE, EV4), /refused/)
  assert.ok(!fs.existsSync(EV4), 'nothing written')
  // An events dir under a regular file: run_record warns and nothing lands, exit 1; the vault is untouched.
  const blocker = keep('events-blocker', 'a file\n')
  const blocked = log(RANK_FILE, SCAN_FILE, blocker)
  assert.equal(blocked.status, 1, blocked.stderr)
  assert.equal(blocked.stdout, '')
  assert.match(blocked.stderr, /run_record: warning: cannot write/)
  assert.match(blocked.stderr, /^estate-dispatch: .*grade/m)
  assert.equal(fs.readFileSync(blocker, 'utf8'), 'a file\n')
  assert.deepEqual(snap(V), BEFORE, 'the vault is untouched')
})

// ---- The Pre-flight fixture (D17-D21; schedule § 1.5, ADR 0047) --------------------------------------------------
// Its own vault VF, scanned with --deadline 0 like V: project Pf and a live, never-started prior rollout `prior`.
// r Ready, c One call, g a Grill of two decisions, o Orient; d1 depends on o and d2 on d1; q open and linked to the
// prior (carried, still queued); s in_progress and linked to it (carried, started), depending on o; u open and left
// ungraded; co a One call and uo open and ungraded, both depending on o, so they leave whatever Lachy answers; e
// linked to the prior at an empty status; x open and never named. The rank is the real one, run with
// `--superseding prior` as schedule § 1.5 runs it. record writes only copies of VF, log only its own events dir.
const VF = path.join(S, 'vf')
const VF_TASKS = path.join(VF, 'Work', 'Tasks')
const TF = (slug, status, rest = '') => write(path.join(VF_TASKS, `${slug}.md`),
  fm(`tags:\n  - task\nstatus: ${status}\nprojects:\n  - "[[Pf]]"${rest}`, `\n# Task ${slug}\n`))
write(path.join(VF, 'Work', 'Projects', 'Pf.md'), fm('tags:\n  - project\nstatus: active'))
write(path.join(VF_TASKS, 'prior.md'), fm('tags:\n  - rollout\nstatus: open\nprotocol_version: 5\nprojects:\n  - "[[Pf]]"'))
const CARRIED = '\nrollout: "[[prior]]"'
for (const s of ['r', 'c', 'g', 'o', 'u', 'x']) TF(s, 'open')
TF('d1', 'open', links('depends-on', ['o']))
TF('d2', 'open', links('depends-on', ['d1']))
TF('q', 'open', CARRIED)
TF('s', 'in_progress', CARRIED + links('depends-on', ['o']))
TF('e', '', CARRIED)
TF('co', 'open', links('depends-on', ['o']))
TF('uo', 'open', links('depends-on', ['o']))
const PF = ['r', 'c', 'g', 'o', 'd1', 'd2', 'q', 's', 'u', 'co', 'uo']
const vfScanRun = spawnSync('python3', [SCAN, '--vault', VF, '--today', TODAY, '--deadline', '0'], { encoding: 'utf8', cwd: S, env, timeout: 60000 })
const VF_SCAN = path.join(S, 'pf', 'scan.json')
if (vfScanRun.status === 0) write(VF_SCAN, vfScanRun.stdout)
const VF_GRADES = path.join(S, 'pf', 'grades-01.json')
write(VF_GRADES, JSON.stringify({ project: 'Pf', tasks: [R('r', 'serial'), G('c', 'One call', 'serial', { decisions: one() }),
  G('g', 'Grill', 'serial', { decisions: [D('Schema?', 'flat', ['flat', 'nested']), D('Cache?', 'none', ['none', 'lru'])] }),
  G('o', 'Orient', 'serial'), R('d1', 'serial'), R('d2', 'serial'), R('q', 'serial'),
  G('co', 'One call', 'serial', { decisions: one('Which side?') })] }, null, 2) + '\n')
const VF_RANK = path.join(S, 'pf', 'rank.json')
const vfRankRun = vfScanRun.status === 0 ? spawnSync('python3', [RANK, 'rank', '--scan', VF_SCAN, '--today', TODAY, '--grades', VF_GRADES,
  '--superseding', 'prior'], { encoding: 'utf8', cwd: S, env, timeout: 60000 }) : null
if (vfRankRun?.status === 0) write(VF_RANK, vfRankRun.stdout)
const pfRanked = () => {
  assert.equal(vfScanRun.status, 0, vfScanRun.stderr)
  assert.equal(vfRankRun?.status, 0, vfRankRun?.stderr)
  return JSON.parse(vfRankRun.stdout)
}
const VF_BEFORE = snap(VF)
const preflight = (more = [], rankFile = VF_RANK, scanFile = VF_SCAN) =>
  py(['preflight', '--rank', rankFile, '--scan', scanFile, ...more])
const PRE = (more = []) => { pfRanked(); return preflight(['--tasks', PF.join(','), '--kept', 's', ...more]) }
const outOf = (j) => j.out.map((o) => [o.slug, o.why, o.via ?? null])

// ---- D17. slices: the Pre-flight's graded set -----------------------------------------------------------------------
test('D17. slices --tasks keeps only the named gradeable tasks; --superseding makes a carried queued one gradeable', () => {
  assert.equal(vfScanRun.status, 0, vfScanRun.stderr)
  const sl = (name, more) => py(['slices', '--scan', VF_SCAN, '--dir', path.join(S, 'pf', name), '--tasks', 'r,c,g', '--tasks',
    'o,d1,d2,q,s,u,zz', ...more])
  const fileTasks = (j) => j.homes.flatMap((h) => JSON.parse(fs.readFileSync(h.file, 'utf8')).tasks.map((t) => t.slug))
  const plain = ok(sl('plain', []))
  assert.deepEqual(plain.homes.map((h) => [h.project, h.tasks]), [['Pf', ['c', 'd1', 'd2', 'g', 'o', 'r', 'u']]])
  assert.deepEqual(fileTasks(plain), ['c', 'd1', 'd2', 'g', 'o', 'r', 'u'])
  assert.deepEqual(plain.notGradeable, [{ slug: 'q', why: 'in flight' }, { slug: 's', why: 'in flight' },
    { slug: 'zz', why: 'not in the scan' }])
  const sup = ok(sl('sup', ['--superseding', 'prior']))
  assert.deepEqual(fileTasks(sup), ['c', 'd1', 'd2', 'g', 'o', 'q', 'r', 'u'])
  assert.deepEqual(sup.notGradeable, [{ slug: 's', why: 'in flight' }, { slug: 'zz', why: 'not in the scan' }])
  // gradeable and skipped still count the whole scan: x, co and uo are gradeable and named nowhere; e and s are skipped.
  assert.deepEqual([plain.gradeable, plain.skipped, sup.gradeable, sup.skipped], [10, 3, 11, 2])
  assert.ok(!fileTasks(sup).includes('x'), 'x is in no file')
  // Without --tasks: no notGradeable key, every gradeable task sliced (orient-all § 2's call, unchanged).
  const all = ok(py(['slices', '--scan', VF_SCAN, '--dir', path.join(S, 'pf', 'all')]))
  assert.ok(!('notGradeable' in all))
  assert.ok(fileTasks(all).includes('x'))
  // Rerunning into the same dir is exit 2, nothing written.
  refusal(sl('sup', ['--superseding', 'prior']), /already holds/)
})

// ---- D18. preflight: the queue, what leaves, and the round ------------------------------------------------------------
test('D18. preflight: Ready and kept tasks queue, One calls and Grills wait on the round, Orient leaves with its Dependent closure, unasked', () => {
  const rk = pfRanked()
  assert.deepEqual(rk.skipped.map((x) => x.slug).sort(), ['e', 's'], 'q is graded under --superseding prior')
  const j = ok(PRE())
  assert.equal(j.schema, 1)
  assert.deepEqual(j.queue, ['r', 'q', 's'])
  assert.deepEqual(outOf(j), [['c', 'undecided', null], ['g', 'undecided', null], ['o', 'orient', null], ['d1', 'dependency', 'o'],
    ['d2', 'dependency', 'd1'], ['u', 'ungraded', null], ['co', 'dependency', 'o'], ['uo', 'dependency', 'o']])
  const o = j.out.find((x) => x.slug === 'o')
  assert.deepEqual([o.grade, o.home, o.note], ['Orient', 'Pf', 'Work/Tasks/o.md'])
  assert.equal(j.out.find((x) => x.slug === 'u').reason, 'no grade')
  assert.deepEqual(j.tasks.map((t) => [t.slug, t.in, t.why]), [['r', true, 'ready'], ['c', false, 'undecided'], ['g', false, 'undecided'],
    ['o', false, 'orient'], ['d1', false, 'dependency'], ['d2', false, 'dependency'], ['q', true, 'ready'], ['s', true, 'kept'],
    ['u', false, 'ungraded'], ['co', false, 'dependency'], ['uo', false, 'dependency']])
  assert.deepEqual(j.counts, { candidates: 11, graded: 8, ready: 4, oneCall: 2, grill: 1, orient: 1, ungraded: 2, kept: 1, decided: 0,
    in: 3, out: 8 })
  // co (a One call) and uo (ungraded) depend on o, so they leave whatever Lachy answers: out through o, never asked.
  assert.deepEqual(j.out.filter((x) => ['co', 'uo'].includes(x.slug)), [
    { slug: 'co', grade: 'One call', why: 'dependency', via: 'o', note: 'Work/Tasks/co.md' },
    { slug: 'uo', grade: null, why: 'dependency', via: 'o', reason: 'no grade', note: 'Work/Tasks/uo.md' }])
  // One question per call: the One call, the Grill's two decisions, then the ungraded task; the recommendation first.
  assert.ok(j.asks.every((call) => call.length === 1), 'one question per AskUserQuestion call')
  const qs = j.asks.map((call) => call[0])
  assert.deepEqual(qs.map((q) => [q.question, q.header, q.multiSelect]), [
    [`[[c]] Which way? ${INVITE}`, 'One call', false],
    [`[[g]] (1/2) Schema? ${INVITE}`, 'Grill', false],
    [`[[g]] (2/2) Cache? ${INVITE}`, 'Grill', false],
    [`[[u]] could not be graded (no grade): leave it out of this rollout, or queue it as it stands? ${INVITE}`, 'Ungraded', false]])
  assert.deepEqual(qs.map((q) => q.options.map((x) => x.label)), [['left (Recommended)', 'right'], ['flat (Recommended)', 'nested'],
    ['none (Recommended)', 'lru'], ['Leave it out (Recommended)', 'Queue it as it stands']])
  for (const q of qs) assert.ok(q.header.length <= 12 && q.options.every((x) => x.label.length <= 40))
  for (const name of ['r', 'q', 's', 'o', 'd1', 'd2', 'co', 'uo']) assert.ok(!qs.some((q) => q.question.includes(`[[${name}]]`)), `no question names ${name}`)
  assert.ok(!j.index.some((x) => ['co', 'uo'].includes(x.slug)), 'no index entry for co or uo')
  // The index: each question to its task, its decision, its labels' full texts and the recommendation.
  assert.deepEqual(j.index.map((x) => [x.kind, x.slug, x.k ?? null, x.n ?? null, x.recommended, x.decision.question]), [
    ['one-call', 'c', null, null, 'left', 'Which way?'], ['grill', 'g', 1, 2, 'flat', 'Schema?'], ['grill', 'g', 2, 2, 'none', 'Cache?'],
    ['ungraded', 'u', null, null, 'Leave it out', 'could not be graded (no grade): leave it out of this rollout, or queue it as it stands?']])
  assert.deepEqual(j.index.map((x) => x.question), qs.map((q) => q.question))
  assert.deepEqual(j.index[0].texts, ['left', 'right'])
  assert.deepEqual(j.index[3].texts, ['Leave it out', 'Queue it as it stands'])
  assert.equal(j.index[0].note, 'Work/Tasks/c.md')
  // A started carried task that depends on a task left out keeps its place and is named once.
  assert.equal(j.warnings.length, 1)
  assert.match(j.warnings[0], /^\[\[s\]\] .*\[\[o\]\]/)
  // Without --kept s, s is ungraded (the ranker skipped it in flight), and it depends on o: out through o, unasked.
  const noKept = ok(preflight(['--tasks', PF.join(',')]))
  assert.deepEqual(noKept.queue, ['r', 'q'])
  assert.deepEqual(noKept.out.find((x) => x.slug === 's'),
    { slug: 's', grade: null, why: 'dependency', via: 'o', reason: 'in flight', note: 'Work/Tasks/s.md' })
  assert.ok(!noKept.asks.some((call) => call[0].question.includes('[[s]]')), 'no question names s')
  assert.deepEqual(noKept.warnings, [])
  // With o no candidate, nothing takes s out regardless: it is asked as ungraded, in flight.
  const alone = ok(preflight(['--tasks', 'r,s']))
  assert.deepEqual(outOf(alone), [['s', 'ungraded', null]])
  assert.deepEqual(alone.asks.map((call) => call[0].question),
    [`[[s]] could not be graded (in flight): leave it out of this rollout, or queue it as it stands? ${INVITE}`])
  // A carried task at an empty status: carry queues it, but the ranker skips it (in flight, as still_to_start reads
  // `open` alone). Its reason is its status, the real cause, never `in flight`.
  const empty = ok(preflight(['--tasks', 'r,e']))
  assert.deepEqual(empty.out, [{ slug: 'e', grade: null, why: 'ungraded', reason: 'status outside Active', note: 'Work/Tasks/e.md' }])
  assert.deepEqual(empty.asks.map((call) => call[0].question),
    [`[[e]] could not be graded (status outside Active): leave it out of this rollout, or queue it as it stands? ${INVITE}`])
  // The answers in: c, g and u decided join the queue; o and its closure stay out; nothing is asked.
  const decided = ok(PRE(['--decided', 'c,g', '--decided', 'u']))
  assert.deepEqual(decided.queue, ['r', 'c', 'g', 'q', 's', 'u'])
  assert.deepEqual(outOf(decided), [['o', 'orient', null], ['d1', 'dependency', 'o'], ['d2', 'dependency', 'd1'],
    ['co', 'dependency', 'o'], ['uo', 'dependency', 'o']])
  assert.deepEqual([decided.asks, decided.index], [[], []])
  assert.equal(decided.tasks.find((t) => t.slug === 'u').why, 'queued as it stands')
  assert.equal(decided.counts.decided, 3)
  // co and uo decided anyway (an answer cannot bring them in): still out through o, and still never asked.
  const overruled = ok(PRE(['--decided', 'co,uo']))
  assert.deepEqual(overruled.queue, ['r', 'q', 's'])
  assert.deepEqual(outOf(overruled).filter((x) => ['co', 'uo'].includes(x[0])), [['co', 'dependency', 'o'], ['uo', 'dependency', 'o']])
  assert.deepEqual(overruled.index.map((x) => x.slug), ['c', 'g', 'g', 'u'])
  assert.deepEqual(overruled.tasks.filter((t) => t.decided).map((t) => [t.slug, t.in, t.why]),
    [['co', false, 'dependency'], ['uo', false, 'dependency']])
  // Orient stays out, decided or not; a --dep adds an edge (schedule § 3's confirmed body dependency).
  assert.ok(ok(PRE(['--decided', 'o'])).out.some((x) => x.slug === 'o' && x.why === 'orient'))
  const dep = ok(PRE(['--dep', 'r=o']))
  assert.deepEqual(dep.out.find((x) => x.slug === 'r'), { slug: 'r', grade: 'Ready', why: 'dependency', via: 'o', note: 'Work/Tasks/r.md' })
  assert.deepEqual(dep.queue, ['q', 's'])
  // Refusals: exit 2 with one line.
  refusal(PRE(['--decided', 'zz']), /--decided zz/)
  refusal(PRE(['--kept', 'zz']), /--kept zz/)
  refusal(PRE(['--dep', 'r']), /--dep r/)
  refusal(PRE(['--dep', 'r=zz']), /--dep r=zz/)
  refusal(preflight(['--tasks', ' , ']), /--tasks/)
  refusal(preflight(['--tasks', 'r'], keep('pf-not-json.json', 'nope\n')), /not JSON/)
  refusal(preflight(['--tasks', 'r'], VF_RANK, keep('pf-scan-2.json', JSON.stringify({ ...JSON.parse(vfScanRun.stdout), schema: 2 }))), /schema/)
  // Byte-deterministic, and it writes nothing.
  assert.equal(PRE(['--decided', 'c']).stdout, PRE(['--decided', 'c']).stdout)
  assert.deepEqual(snap(VF), VF_BEFORE, 'the vault is untouched')
})

// ---- D19. preflight under orient-all ------------------------------------------------------------------------------------
test('D19. preflight under orient-all: a One call the round never reached leaves with its dependants; --decided is cut to the candidates', () => {
  ranked()
  // act-call ranks below the Lab One calls, so a 30-minute round leaves it in later[], and orient-all's --decided omits it.
  assert.ok(ok(R30()).later.some((x) => x.slug === 'act-call'), 'act-call is left for a later round')
  const j = ok(py(['preflight', '--rank', RANK_FILE, '--scan', SCAN_FILE, '--tasks', 'act-a,act-call,act-dep']))
  assert.deepEqual(j.queue, ['act-a'])
  assert.deepEqual(outOf(j), [['act-call', 'undecided', null], ['act-dep', 'dependency', 'act-call']])
  const p = ok(PLAN())
  assert.ok(!p.schedule.some((e) => e.members.includes('act-call')), 'plan schedules no undecided member')
  assert.ok(p.undecided.some((x) => x.slug === 'act-call'))
  // The fork passes its step 1's candidates as --tasks, and the line's decided slugs among them only.
  const cut = ok(py(['preflight', '--rank', RANK_FILE, '--scan', SCAN_FILE, '--tasks', 'act-a,act-call', '--decided', 'act-call']))
  assert.deepEqual(cut.queue, ['act-a', 'act-call'])
  for (const k of ['tasks', 'out']) assert.ok(!cut[k].some((x) => x.slug === 'lab-01'), k)
  assert.ok(!cut.queue.includes('lab-01'))
  refusal(py(['preflight', '--rank', RANK_FILE, '--scan', SCAN_FILE, '--tasks', 'act-a,act-call', '--decided', 'act-call,lab-01']),
    /--decided lab-01/)
})

// ---- D20. record --by schedule and --superseding ---------------------------------------------------------------------
test('D20. record --by schedule names the Pre-flight; --superseding writes a carried queued task, never a started one', () => {
  pfRanked()
  const VR = path.join(S, 'pf', 'record-vault')
  fs.cpSync(VF, VR, { recursive: true })
  const file = (slug) => path.join(VR, 'Work', 'Tasks', `${slug}.md`)
  const read = (slug) => fs.readFileSync(file(slug), 'utf8')
  const rec = (slug, more = []) => py(['record', '--task', slug, '--question', '[[' + slug + ']] Which way?', '--answer', 'left',
    '--recommended', 'left', '--today', TODAY, '--vault', VR, '--by', 'schedule', ...more])
  const B = '- Which way? → left (asked at /thread:schedule; recommended: left)'
  const before = read('c')
  let w = rec('c')
  assert.deepEqual([w.status, w.stdout], [0, 'recorded Work/Tasks/c.md: Which way? → left\n'])
  assert.equal(read('c'), `${before}\n## Decisions (asked ahead ${TODAY})\n\n${B}\n`)
  // q, carried and still queued: in flight to orient-all, written at schedule's Pre-flight on the supersede.
  const q0 = read('q')
  refusal(rec('q'), /in flight/)
  assert.equal(read('q'), q0)
  refusal(rec('q', ['--superseding', 'other-rollout']), /in flight/)
  w = rec('q', ['--superseding', 'prior'])
  assert.equal(w.status, 0, w.stderr)
  assert.ok(read('q').endsWith(`\n## Decisions (asked ahead ${TODAY})\n\n${B}\n`))
  // s has started: refused even under --superseding. e sits at an empty status: outside Active.
  for (const [slug, re] of [['s', /in flight/], ['e', /not Active/]]) {
    const held = read(slug)
    refusal(rec(slug, ['--superseding', 'prior']), re)
    assert.equal(read(slug), held, slug)
  }
  refusal(py(['record', '--task', 'c', '--question', 'Q', '--answer', 'A', '--recommended', 'A', '--vault', VR, '--by', 'orient']),
    /--by/)
  assert.deepEqual(snap(VF), VF_BEFORE, 'only the copy was written')
})

// ---- D21. log over the Pre-flight's rank ------------------------------------------------------------------------------
test('D21. log over the Pre-flight rank: one grade line per graded candidate, the carried one linked to its prior', () => {
  const rk = pfRanked()
  const EV = path.join(S, 'pf', 'events')
  const run = py(['log', '--rank', VF_RANK, '--scan', VF_SCAN], { THREAD_EVENTS_DIR: EV })
  assert.equal(run.status, 0, run.stderr)
  assert.match(run.stdout, /^logged 8 grade\(s\), pass g-/)
  const lines = fs.readFileSync(path.join(EV, 'grades.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  assert.deepEqual(lines.map((l) => l.task), rk.tasks.map((t) => t.slug))
  assert.deepEqual([...lines.map((l) => l.task)].sort(), ['c', 'co', 'd1', 'd2', 'g', 'o', 'q', 'r'])
  assert.deepEqual(lines.filter((l) => 'linked' in l).map((l) => [l.task, l.linked]), [['q', 'prior']])
  for (const s of ['u', 'uo', 's', 'x', 'e']) assert.ok(!lines.some((l) => l.task === s), `${s} has no line`)
  assert.deepEqual(snap(VF), VF_BEFORE)
})

// ---- D22. The question gate: only his decisions asked, in the Framing; the rest written as Decided for you -------
// The Verify's dry-run grill (ADR 0054): a second grades file over VF labels each decision's Owner. g is a Grill with
// two technical decisions (Schema? high, Cache? medium) and one of his (Who reads it?, with its goal and stakes); r is
// Ready with a priorities call; q (carried, queued) Ready with a technical one; d1 Ready with a technical guess (low,
// so dropped: the executing session's); c a One call written before ADR 0054 (no owner, no goal, no stakes); x a One
// call of his with its goal and stakes.
const FR = (goal, stakes) => ({ owner: 'yours', goal, stakes })
const WHO = D('Who reads it?', 'you', ['you', 'the team'],
  FR('The export exists so you can audit a run.', ['Keeps it legible for you; costs a day of formatting.', 'Faster to ship; you read raw JSON.']))
const TONE = D('Which tone?', 'plain', ['plain', 'playful'],
  FR('The notes are what you scan each morning.', ['Quick to read; less personality.', 'More fun; slower to scan.']))
const VF_GRADES_GATE = path.join(S, 'pf', 'grades-gate.json')
write(VF_GRADES_GATE, JSON.stringify({ project: 'Pf', tasks: [
  G('g', 'Grill', 'serial', { decisions: [D('Schema?', 'flat', ['flat', 'nested'], { owner: 'technical' }),
    D('Cache?', 'none', ['none', 'lru'], { owner: 'technical', confidence: 'medium' }), WHO] }),
  R('r', 'serial', { decisions: [D('Log format?', 'jsonl', ['jsonl', 'text'], { owner: 'priorities' })] }),
  R('q', 'serial', { decisions: [D('Lock file?', 'none', ['none', 'flock'], { owner: 'technical' })] }),
  R('d1', 'serial', { decisions: [D('Retry?', 'twice', ['twice', 'never'], { owner: 'technical', confidence: 'low' })] }),
  G('c', 'One call', 'serial', { decisions: one() }), G('o', 'Orient', 'serial'), R('d2', 'serial'),
  G('x', 'One call', 'serial', { decisions: [TONE] })] }, null, 2) + '\n')
const GATE_RANK = path.join(S, 'pf', 'rank-gate.json')
const gateRankRun = vfScanRun.status === 0 ? spawnSync('python3', [RANK, 'rank', '--scan', VF_SCAN, '--today', TODAY, '--grades',
  VF_GRADES_GATE, '--superseding', 'prior'], { encoding: 'utf8', cwd: S, env, timeout: 60000 }) : null
if (gateRankRun?.status === 0) write(GATE_RANK, gateRankRun.stdout)
// A question in the Framing: the goal in its text, the Note last, and every option described by its stakes line (the
// recommended one's ending " Recommended: <why>"), never by its bare label.
function framedRound(q, d) {
  if (!q.question.endsWith(` ${INVITE}`) || !q.question.includes(d.goal)) return false
  return q.options.length === d.stakes.length && q.options.every((o, i) => o.description !== o.label.replace(' (Recommended)', '') &&
    o.description.includes(d.stakes[i]) && (i > 0 || o.description.endsWith(` Recommended: ${d.why}`)))
}
test('D22. the question gate: preflight and rounds ask only his decisions, in the Framing; decided-for-you writes the rest', () => {
  pfRanked()
  assert.equal(gateRankRun?.status, 0, gateRankRun?.stderr)
  const rk = JSON.parse(gateRankRun.stdout)
  const row = (slug) => rk.tasks.find((t) => t.slug === slug)
  assert.deepEqual(row('g').decisions.map((d) => d.question), ['Who reads it?'])
  assert.deepEqual(row('g').decidedForYou.map((d) => [d.question, d.owner, d.confidence]), [['Cache?', 'technical', 'medium'],
    ['Schema?', 'technical', 'high']])
  assert.deepEqual([row('g').grade, row('r').grade, row('d1').grade, row('d1').decidedForYou], ['Grill', 'Ready', 'Ready', []])
  assert.ok(rk.warnings.some((w) => /^c decision 1: no owner, read as yours; asked without its goal and stakes$/.test(w)), rk.warnings.join('\n'))
  // (a) preflight asks c's and g's own decision, never a technical one; g's is in the Framing, c's (pre-ADR 0054) is not.
  const pre = ok(preflight(['--tasks', 'r,c,g,q,d1,s', '--kept', 's'], GATE_RANK))
  const qs = pre.asks.map((call) => call[0])
  assert.deepEqual(qs.map((q) => q.question), [`[[c]] Which way? ${INVITE}`, `[[g]] (1/1) Who reads it? ${WHO.goal} ${INVITE}`])
  assert.ok(!qs.some((q) => /Schema\?|Cache\?|Log format\?|Lock file\?|Retry\?/.test(q.question)), 'no ruled decision is asked')
  assert.ok(framedRound(qs[1], WHO), JSON.stringify(qs[1]))
  assert.equal(framedRound(qs[0], { ...one()[0], goal: '', stakes: ['left', 'right'] }), false, 'control: c has no stakes, so a bare label')
  assert.equal(qs[0].options[1].description, 'right')
  assert.deepEqual(pre.index[1].decision.question, 'Who reads it?', 'the index keeps the bare question for record')
  // (b) decided-for-you, read-only: g's two (the less sure first), r's and q's, never d1's dropped guess.
  const dry = () => py(['decided-for-you', '--rank', GATE_RANK, '--tasks', 'g,r', '--tasks', 'q,d1,c,zz'])
  const listed = ok(dry())
  assert.deepEqual(listed.items.map((x) => [x.slug, x.question, x.answer, x.owner]), [['g', 'Cache?', 'none', 'technical'],
    ['g', 'Schema?', 'flat', 'technical'], ['r', 'Log format?', 'jsonl', 'priorities'], ['q', 'Lock file?', 'none', 'technical']])
  assert.deepEqual([listed.today, listed.skipped, listed.written, listed.unchanged, listed.refused],
    [TODAY, [{ slug: 'zz', why: 'not in the rank' }], [], [], []])
  assert.equal(dry().stdout, dry().stdout)
  assert.deepEqual(snap(VF), VF_BEFORE, 'the vault is untouched')
  // (c) --write on a copy: the heading, the preamble, then a bullet per call; a rerun changes nothing.
  const VD = path.join(S, 'pf', 'decided-vault')
  fs.cpSync(VF, VD, { recursive: true })
  const read = (slug, v = VD) => fs.readFileSync(path.join(v, 'Work', 'Tasks', `${slug}.md`), 'utf8')
  const before = { g: read('g'), r: read('r'), q: read('q') }
  const write1 = (v, more = []) => py(['decided-for-you', '--rank', GATE_RANK, '--tasks', 'g,r,q,d1', '--by', 'schedule',
    '--superseding', 'prior', '--write', '--vault', v, ...more])
  const w = ok(write1(VD))
  assert.deepEqual([w.written.length, w.unchanged, w.refused], [4, [], []])
  const PRE_LINE = 'Calls made for Lachy, never asked (ADR 0054): each stands unless the code shows it wrong, a plan that ' +
    'departs from one says why, and none signs a gated input (ADR 0008); he can overturn any here.'
  const B = (q, a, owner) => `- ${q} → ${a} (decided for you at /thread:schedule, ${owner}: fixture: src/x.py:12)`
  assert.equal(read('g'), `${before.g}\n## Decided for you (${TODAY})\n\n${PRE_LINE}\n\n${B('Cache?', 'none', 'technical')}\n${B('Schema?', 'flat', 'technical')}\n`)
  assert.equal(read('r'), `${before.r}\n## Decided for you (${TODAY})\n\n${PRE_LINE}\n\n${B('Log format?', 'jsonl', 'priorities')}\n`)
  assert.ok(read('q').endsWith(`\n${B('Lock file?', 'none', 'technical')}\n`), 'the carried queued task is written under --superseding')
  assert.ok(!read('g').includes('## Decisions'), 'never a ## Decisions heading')
  const again = ok(write1(VD))
  assert.deepEqual([again.written, again.unchanged.length, again.refused], [[], 4, []])
  // (d) a task that went in flight is refused; the rest are still written, exit 0.
  const VE = path.join(S, 'pf', 'decided-vault-2')
  fs.cpSync(VF, VE, { recursive: true })
  const rPath = path.join(VE, 'Work', 'Tasks', 'r.md')
  fs.writeFileSync(rPath, fs.readFileSync(rPath, 'utf8').replace('status: open', 'status: in_progress'))
  const part = ok(write1(VE))
  assert.deepEqual(part.refused.map((x) => [x.slug, x.question]), [['r', 'Log format?']])
  assert.match(part.refused[0].why, /in flight/)
  assert.equal(part.written.length, 3)
  // (e) record --owner writes one call; --fork and --recommended never go with it, and write nothing; --by orient only
  // with it.
  const rec = (more) => py(['record', '--task', 'c', '--question', 'Which way?', '--answer', 'left', '--today', TODAY, '--vault', VE, ...more])
  const c0 = read('c', VE)
  refusal(rec(['--owner', 'technical', '--recommended', 'left', '--why', 'x.py:3 reads it']), /--owner takes no --recommended/)
  assert.equal(read('c', VE), c0, 'a refused --owner --recommended writes nothing')
  const r1 = rec(['--owner', 'technical', '--why', 'x.py:3 reads it', '--by', 'orient'])
  assert.deepEqual([r1.status, r1.stdout, r1.stderr], [0, 'recorded Work/Tasks/c.md: Which way? → left\n', ''])
  assert.equal(read('c', VE),
    `${c0}\n## Decided for you (${TODAY})\n\n${PRE_LINE}\n\n- Which way? → left (decided for you at /thread:orient, technical: x.py:3 reads it)\n`)
  refusal(rec(['--owner', 'technical', '--fork', 'Keep v3 or v4']), /--fork/)
  refusal(rec(['--recommended', 'left', '--by', 'orient']), /--by orient/)
  // (f) usage: an unknown owner, no --rank, a schema-2 rank.
  refusal(rec(['--owner', 'bogus']), /--owner/)
  refusal(py(['decided-for-you', '--tasks', 'g']), /--rank/)
  refusal(py(['decided-for-you', '--rank', keep('rank-gate-2.json', JSON.stringify({ ...rk, schema: 2 })), '--tasks', 'g']), /schema/)
  refusal(py(['decided-for-you', '--rank', GATE_RANK, '--tasks', ' , ']), /--tasks/)
  // (g) the ungraded question says why its recommendation goes against his autonomy (Q46).
  const un = ok(PRE())
  const uq = un.asks.map((call) => call[0]).find((q) => q.header === 'Ungraded')
  assert.match(uq.options[0].description, /a decision of yours/)
  assert.match(uq.options[0].description, /costs you more than one schedule's wait/)
  assert.match(un.index[3].decision.why, /decision of yours/)
  // (h) rounds over the same rank: x's One call is in the Framing, c's ends with the Note, and the Grill holds g's own.
  const rd = ok(py(['rounds', '--rank', GATE_RANK, '--scan', VF_SCAN, '--budget', '60']))
  const rq = rd.asks.flat()
  const xq = rq[rd.index.findIndex((e) => e.slug === 'x')]
  assert.ok(xq && framedRound(xq, TONE), JSON.stringify(xq))
  assert.ok(rq[rd.index.findIndex((e) => e.slug === 'c')].question.endsWith(` ${INVITE}`))
  assert.deepEqual(rd.grill.map((x) => [x.slug, x.decisions.map((d) => [d.question, d.goal, d.stakes])]),
    [['g', [['Who reads it?', WHO.goal, WHO.stakes]]]])
  assert.deepEqual(snap(VF), VF_BEFORE, 'only the copies were written')
})

// ---- The big-project fixture (D23; ADR 0061) ----------------------------------------------------------------------
// Its own vault VB, scanned with --deadline 0 like V, its three rollout summaries injected into a copy, ranked for real.
// Big (orient: own) has serial big-ready (Ready), big-call (One call), big-grill (Grill, two decisions) and big-orient
// (Orient), and a live rollout whose big-gated sign-off is pending. BigDue is big by its design record (HOME/repos/bigrec
// holds CONTEXT.md and docs/adr/0001-x.md), with one Ready task due within DUE_SOON_DAYS and one Ready session-shaped
// task (big-session). BigPark is big by key and parked, with one Ready task. BigSo is big by key, with only a live
// rollout under the sign-off pause, its bigso-gate unsigned (status action 8); Items and Bits big by key, with only a
// clean live rollout that `--status =13` gives an execute item. Small holds small-a (Ready), small-call (One call),
// small-ask (One call, depends on big-ready), small-held (One call, depends on big-call), small-dep (Ready, depends on
// big-ready) and small-session (Ready, session-shaped); SmallOr one Orient task captured 2026-10-01; Odd an
// `orient: maybe` key.
const VB = path.join(S, 'vb')
const VB_TASKS = path.join(VB, 'Work', 'Tasks')
const PB = (name, status, rest = '') => write(path.join(VB, 'Work', 'Projects', `${name}.md`),
  fm(`tags:\n  - project\nstatus: ${status}${rest}`))
const TB = (slug, status, project, rest = '', body = '') => write(path.join(VB_TASKS, `${slug}.md`),
  fm(`tags:\n  - task\nstatus: ${status}${links('projects', [project])}${rest}`, `\n# Task ${slug}\n${body}`))
PB('Big', 'active', '\norient: own')
PB('BigDue', 'active', '\nrepos:\n  - ~/repos/bigrec')
PB('BigPark', 'parked', '\norient: own')
PB('BigSo', 'active', '\norient: own')
PB('Items and Bits', 'active', '\norient: own')
PB('Small', 'active')
PB('SmallOr', 'active')
PB('Odd', 'active', '\norient: maybe')
for (const f of ['CONTEXT.md', 'docs/adr/0001-x.md']) write(path.join(ROOT('bigrec'), f), '# x\n')
for (const s of ['big-ready', 'big-call', 'big-grill', 'big-orient']) TB(s, 'open', 'Big')
TB('bigdue-a', 'open', 'BigDue', '\ndue: 2026-10-25')
TB('big-session', 'open', 'BigDue')
TB('bigpark-a', 'open', 'BigPark')
TB('small-a', 'open', 'Small')
TB('small-call', 'open', 'Small')
TB('small-ask', 'open', 'Small', links('depends-on', ['big-ready']))
TB('small-held', 'open', 'Small', links('depends-on', ['big-call']))
TB('small-dep', 'open', 'Small', links('depends-on', ['big-ready']))
TB('small-session', 'open', 'Small')
TB('small-orient', 'open', 'SmallOr', '\ncaptured: 2026-10-01')
const BIG_RO = 'big-rollout-2026-10-19'
const SO_RO = 'bigso-rollout-2026-10-19'
const IB_RO = 'items-rollout-2026-10-19'
for (const [slug, project] of [[BIG_RO, 'Big'], [SO_RO, 'BigSo'], [IB_RO, 'Items and Bits']]) {
  write(path.join(VB_TASKS, `${slug}.md`), fm(`tags:\n  - rollout\nstatus: open\nprotocol_version: 5\nprojects:\n  - "[[${project}]]"`,
    `\n# Rollout ${slug}\n\nProject root: \`${path.join(S, `root-${slug.split('-')[0]}`)}\`\n`))
}
TB('big-gated', 'gate-pending', 'Big', `\nrollout: "[[${BIG_RO}]]"`, '\n## Gated inputs (awaiting sign-off)\n\n- spend: a big spend — cap 5 USD\n')
TB('bigso-gate', 'gate-pending', 'BigSo', `\nrollout: "[[${SO_RO}]]"`, '\n## Gated inputs (awaiting sign-off)\n\n- irreversible: publish it\n')
const vbScanRun = spawnSync('python3', [SCAN, '--vault', VB, '--today', TODAY, '--deadline', '0'], { encoding: 'utf8', cwd: S, env, timeout: 60000 })
const VB_SUMMARIES = { [BIG_RO]: SUM({ setAside: [aside('big-gated')], pendingSignOffs: ['big-gated'] }),
  [SO_RO]: SUM({ paused: PAUSE, pausedFor: 'sign-off', awaitingSignOff: true, setAside: [aside('bigso-gate')],
    pendingSignOffs: ['bigso-gate'] }), [IB_RO]: SUM() }
let VB_RAW = null
try { VB_RAW = JSON.parse(vbScanRun.stdout) } catch { /* D23 names it */ }
const vbInjected = (raw) => {
  const s = structuredClone(raw)
  for (const r of s.rollouts) if (r.slug in VB_SUMMARIES) { r.summary = VB_SUMMARIES[r.slug]; r.error = null }
  return s
}
const VB_SCAN = path.join(S, 'vb-run', 'scan.json')
if (VB_RAW) write(VB_SCAN, JSON.stringify(vbInjected(VB_RAW)))
const VB_GRADES = path.join(S, 'vb-run', 'grades-01.json')
write(VB_GRADES, JSON.stringify([
  { project: 'Big', tasks: [R('big-ready', 'serial'), G('big-call', 'One call', 'serial', { decisions: one('Big way?') }),
    G('big-grill', 'Grill', 'serial', { decisions: [D('Big schema?', 'flat', ['flat', 'nested']), D('Big cache?', 'none', ['none', 'lru'])] }),
    G('big-orient', 'Orient', 'serial')] },
  { project: 'BigDue', tasks: [R('bigdue-a', 'serial'), R('big-session', 'session')] },
  { project: 'BigPark', tasks: [R('bigpark-a', 'serial')] },
  { project: 'Small', tasks: [R('small-a', 'serial'), G('small-call', 'One call', 'serial', { decisions: one('Small way?') }),
    G('small-ask', 'One call', 'serial', { decisions: one('Ask way?') }), G('small-held', 'One call', 'serial', { decisions: one('Held way?') }),
    R('small-dep', 'serial'), R('small-session', 'session')] },
  { project: 'SmallOr', tasks: [G('small-orient', 'Orient', 'serial')] },
], null, 2) + '\n')
const VB_RANK = path.join(S, 'vb-run', 'rank.json')
const vbRankRun = VB_RAW ? spawnSync('python3', [RANK, 'rank', '--scan', VB_SCAN, '--today', TODAY, '--grades', VB_GRADES],
  { encoding: 'utf8', cwd: S, env, timeout: 60000 }) : null
if (vbRankRun?.status === 0) write(VB_RANK, vbRankRun.stdout)
const VB_BEFORE = snap(VB)
// Twins (D23): vault VT holds two project notes named SEO in different folders, both big by key, each with a clean live
// rollout linking its own note by path, scanned with --deadline 0, summaries injected, ranked over no grades.
const VT = path.join(S, 'vt')
for (const rel of ['SEO', 'Web/SEO']) write(path.join(VT, 'Work', 'Projects', `${rel}.md`), fm('tags:\n  - project\nstatus: active\norient: own'))
const TWINS = { 'seo-rollout-2026-10-19': 'Work/Projects/SEO', 'webseo-rollout-2026-10-19': 'Work/Projects/Web/SEO' }
for (const [slug, link] of Object.entries(TWINS)) {
  write(path.join(VT, 'Work', 'Tasks', `${slug}.md`), fm(`tags:\n  - rollout\nstatus: open\nprotocol_version: 5\nprojects:\n  - "[[${link}]]"`,
    `\n# Rollout ${slug}\n\nProject root: \`${path.join(S, 'root-seo')}\`\n`))
}
const vtScanRun = spawnSync('python3', [SCAN, '--vault', VT, '--today', TODAY, '--deadline', '0'], { encoding: 'utf8', cwd: S, env, timeout: 60000 })
const VT_SCAN = path.join(S, 'vt-run', 'scan.json')
const VT_RANK = path.join(S, 'vt-run', 'rank.json')
let vtRankRun = null
try {
  const s = JSON.parse(vtScanRun.stdout)
  for (const r of s.rollouts) if (r.slug in TWINS) { r.summary = SUM(); r.error = null }
  write(VT_SCAN, JSON.stringify(s))
  write(path.join(S, 'vt-run', 'grades-01.json'), '[]\n')
  vtRankRun = spawnSync('python3', [RANK, 'rank', '--scan', VT_SCAN, '--today', TODAY, '--grades', path.join(S, 'vt-run', 'grades-01.json')],
    { encoding: 'utf8', cwd: S, env, timeout: 60000 })
  if (vtRankRun.status === 0) write(VT_RANK, vtRankRun.stdout)
} catch { /* D23 names it */ }

// ---- D23. Big projects keep their own sessions; one pick list at the end ------------------------------------------
test('D23. big projects: nothing of theirs asked, scheduled or started; one pick list, ranked, ticks open them', () => {
  assert.equal(vbScanRun.status, 0, vbScanRun.stderr)
  assert.equal(vbRankRun?.status, 0, vbRankRun?.stderr)
  const sc = vbInjected(VB_RAW)
  const own = (name) => sc.projects.find((p) => p.name === name).ownSession
  assert.deepEqual([own('Big'), own('BigDue'), own('Small'), own('Odd')], [{ own: true, by: 'key', repo: null },
    { own: true, by: 'design record', repo: '~/repos/bigrec' }, { own: false, by: null, repo: null },
    { own: false, by: null, repo: null, invalid: 'maybe' }])
  const rk = JSON.parse(vbRankRun.stdout)
  assert.deepEqual(rk.tasks.find((t) => t.slug === 'small-held').blockedBy, [{ slug: 'big-call', why: 'One call' }])
  assert.deepEqual(rk.tasks.find((t) => t.slug === 'small-ask').blockedBy, [], 'a Ready big dependency holds nothing in the rank')
  const BIG = ['big-ready', 'big-call', 'big-grill', 'big-orient', 'bigdue-a', 'big-session', 'bigpark-a']
  const vbRounds = (budget) => py(['rounds', '--rank', VB_RANK, '--scan', VB_SCAN, '--budget', String(budget)])
  const vbPlan = (more = [], rankFile = VB_RANK, scanFile = VB_SCAN) => py(['plan', '--rank', rankFile, '--scan', scanFile, ...more])

  // rounds: only the small project's own One call is asked; a big project's sign-offs, One calls, Grills and Unpark offer
  // wait on its own session, uncharged; a small decision on a big project's task is skipped, naming it.
  const r = ok(vbRounds(60))
  const qs = r.asks.flat()
  assert.deepEqual(r.index.map((x) => [x.kind, x.slug]), [['one-call', 'small-call']])
  for (const q of qs) assert.ok(q.question.endsWith(` ${INVITE}`), q.question)
  assert.deepEqual(r.signOffs.map((x) => [x.slug, x.ask, x.why]), [['big-gated', false, 'own session'], ['bigso-gate', false, 'own session']])
  assert.deepEqual([r.minutes.signOffs, r.oneCalls.map((x) => x.slug), r.grill, r.unpark], [0, ['small-call'], [], []])
  assert.ok(!qs.some((q) => q.question.includes('[[BigPark]]')), 'no Unpark question for a big project')
  assert.deepEqual(r.skipped.map((x) => [x.kind, x.slug, x.ownSession]), [['one-call', 'small-ask', { project: 'Big', slug: 'big-ready' }],
    ['one-call', 'small-held', { project: 'Big', slug: 'big-call' }]])
  assert.deepEqual(r.ownSession, [
    { project: 'Big', note: 'Work/Projects/Big.md', by: 'key', repo: null, ready: 1, oneCalls: 1, grills: 1, decisions: 3, orient: 1, signOffs: 1, unpark: false },
    { project: 'BigDue', note: 'Work/Projects/BigDue.md', by: 'design record', repo: '~/repos/bigrec', ready: 2, oneCalls: 0, grills: 0, decisions: 0, orient: 0, signOffs: 0, unpark: false },
    { project: 'BigSo', note: 'Work/Projects/BigSo.md', by: 'key', repo: null, ready: 0, oneCalls: 0, grills: 0, decisions: 0, orient: 0, signOffs: 1, unpark: false },
    { project: 'BigPark', note: 'Work/Projects/BigPark.md', by: 'key', repo: null, ready: 1, oneCalls: 0, grills: 0, decisions: 0, orient: 0, signOffs: 0, unpark: true }])
  assert.deepEqual(r.warnings, ['[[Odd]] (Work/Projects/Odd.md): orient: "maybe" is neither own nor sweep, so its design record decides: small'])
  assert.ok(r.top.length > 0 && !r.top.some((t) => BIG.includes(t.slug)), JSON.stringify(r.top.map((t) => t.slug)))
  assert.deepEqual(r.live.map((x) => [x.slug, x.project, x.ownSession]), [[BIG_RO, 'Big', true], [SO_RO, 'BigSo', true], [IB_RO, 'Items and Bits', true]])
  // Budget 0 asks the same sign-offs (none) and still never asks a big one.
  assert.deepEqual(ok(vbRounds(0)).signOffs.filter((x) => x.ask), [])

  // plan: every big run waits `own session`, checked before parked; nothing big is held, undecided or session lane (the
  // small session-shaped task is, alone); a small dependant of a big task is held, its dependency not scheduled.
  const STATUS = ['--status', `${IB_RO}=13`, '--status', `${SO_RO}=8`]
  const pl = ok(vbPlan(STATUS))
  const waitBy = (project) => pl.waiting.find((w) => w.project === project)
  for (const project of ['Big', 'BigDue', 'BigPark']) assert.equal(waitBy(project)?.why.kind, 'own session', project)
  assert.deepEqual(waitBy('Big').members, rk.tasks.filter((t) => ['big-ready', 'big-call', 'big-grill'].includes(t.slug)).map((t) => t.slug),
    'every slug of the run, in rank order')
  assert.deepEqual(pl.held.find((x) => x.slug === 'small-dep')?.blockedBy, [{ slug: 'big-ready', why: 'dependency not scheduled' }])
  for (const k of ['held', 'undecided']) assert.ok(!pl[k].some((x) => BIG.includes(x.slug)), `${k}: ${JSON.stringify(pl[k])}`)
  assert.equal(rk.tasks.find((t) => t.slug === 'big-session')?.shape, 'session', 'a session-shaped big task is ranked')
  assert.deepEqual(pl.sessionLane, [{ slug: 'small-session', home: 'Small', grade: 'Ready' }])
  assert.ok(!pl.schedule.some((e) => e.members.some((m) => BIG.includes(m))))
  assert.deepEqual(pl.schedule.map((e) => [e.project, e.members]), [['Small', ['small-a']]])
  assert.deepEqual(pl.rollouts.map((x) => [x.slug, x.project, x.ownSession]), [[BIG_RO, 'Big', true], [SO_RO, 'BigSo', true], [IB_RO, 'Items and Bits', true]])
  // By hand, a big task decided or its gate signed still schedules nothing of it.
  const forced = ok(vbPlan(['--decided', 'big-call', '--signed', 'big-gated', '--unparked', 'BigPark']))
  assert.ok(!forced.schedule.some((e) => e.members.some((m) => BIG.includes(m))))
  assert.equal(forced.waiting.find((w) => w.project === 'BigPark').why.kind, 'own session')
  // The pick list: parked last, due soon first, then weight, the ready count, the oldest captured, then name. BigSo's
  // unsigned gate under the sign-off pause reads action 8, which the allow-list gives nothing, so its held item is the
  // repair that asks it (own_item): weight 2.
  assert.deepEqual(pl.pick.map((e) => e.name), ['BigDue', 'Big', 'BigSo', 'SmallOr', 'Items and Bits', 'BigPark'])
  const pk = Object.fromEntries(pl.pick.map((e) => [e.name, e]))
  assert.deepEqual(pk.Big, { name: 'Big', link: 'Big', note: 'Work/Projects/Big.md', own: true, by: 'key', parked: false, crowned: false,
    dueSoon: false, deadline: null, ready: 1, decisions: 3, orient: 1, signOffs: 1, heldItems: 0, weight: 6, oldest: null, rollouts: [BIG_RO],
    signOffRepairs: [] })
  assert.deepEqual([pk.BigDue.dueSoon, pk.BigDue.deadline, pk.BigDue.by, pk.BigDue.ready], [true, '2026-10-25', 'design record', 2])
  assert.deepEqual([pk.SmallOr.own, pk.SmallOr.orient, pk.SmallOr.weight, pk.SmallOr.oldest, pk.SmallOr.rollouts], [false, 1, 1, '2026-10-01', []])
  assert.deepEqual([pk['Items and Bits'].heldItems, pk['Items and Bits'].signOffRepairs, pk.BigPark.parked], [1, [], true])
  assert.deepEqual([pk.BigSo.signOffs, pk.BigSo.heldItems, pk.BigSo.weight, pk.BigSo.signOffRepairs], [1, 1, 2, [SO_RO]])
  assert.deepEqual(rolloutOf(pl, SO_RO).pendingSignOffs, ['bigso-gate'])
  const bare = ok(vbPlan())
  assert.equal(bare.pick.find((e) => e.name === 'Items and Bits'), undefined, 'with no --status, no held item: no candidate')
  assert.deepEqual([bare.pick.find((e) => e.name === 'BigSo')?.heldItems, bare.pick.find((e) => e.name === 'BigSo')?.signOffRepairs], [0, []],
    'with no --status, BigSo is a candidate by its sign-off alone')
  // pickAsk: one multiSelect question, the top three and `Not now`, its text ending with the Note.
  assert.equal(pl.pickAsk.length, 1)
  const [pq] = pl.pickAsk
  assert.deepEqual([pq.multiSelect, pq.header], [true, 'Open'])
  assert.ok(pq.header.length <= 12)
  assert.ok(pq.question.endsWith(` ${INVITE}`), pq.question)
  assert.deepEqual(pq.options.map((o) => o.label), ['BigDue', 'Big', 'BigSo', 'Not now'])
  for (const o of pq.options) assert.ok(o.label.length <= 40 && o.description.length > 0, JSON.stringify(o))
  for (const [i, name] of ['BigDue', 'Big', 'BigSo'].entries()) assert.ok(pq.options[i].description.startsWith(`[[${name}]]`), pq.options[i].description)
  // Each option says where what it counts goes: the orient session asks One calls and Grills, never a sign-off; a
  // sign-off is asked only by the repair opening starts, and an option with none says nothing of one.
  for (const o of pq.options.slice(0, 3)) assert.ok(!/where these are asked/.test(o.description), o.description)
  assert.match(pq.options[1].description, /1 ready task, 3 waiting decisions, 1 Orient task, 1 pending sign-off\. Opening it starts its orient session, which asks its One calls and Grills and schedules its rollout\.$/)
  assert.match(pq.options[2].description, /^\[\[BigSo\]\]: 1 pending sign-off, 1 held rollout item\. .*and its 1 held rollout item\. Its pending sign-offs are asked by the repair it starts\.$/)
  assert.deepEqual(pl.pickIndex, { question: pq.question, labels: ['BigDue', 'Big', 'BigSo', 'Not now'], names: ['BigDue', 'Big', 'BigSo', null],
    notes: ['Work/Projects/BigDue.md', 'Work/Projects/Big.md', 'Work/Projects/BigSo.md', null] })
  // Every project small: only the Orient projects are candidates (Big by its big-orient), so three options; with only
  // SmallOr's left, one candidate and `Not now`; with no Orient task anywhere, nothing is asked.
  const allSmall = structuredClone(sc)
  for (const p of allSmall.projects) p.ownSession = { own: false, by: null, repo: null }
  const smallScan = keep('vb-scan-small.json', JSON.stringify(allSmall))
  const ps = ok(vbPlan([], VB_RANK, smallScan))
  assert.deepEqual(ps.pick.map((e) => e.name), ['SmallOr', 'Big'])
  assert.deepEqual(ps.pickAsk[0].options.map((o) => o.label), ['SmallOr', 'Big', 'Not now'])
  const rkOne = { ...rk, orient: rk.orient.filter((o) => o.project === 'SmallOr') }
  const p1 = ok(vbPlan([], keep('vb-rank-one.json', JSON.stringify(rkOne)), smallScan))
  assert.deepEqual(p1.pickAsk[0].options.map((o) => o.label), ['SmallOr', 'Not now'])
  const p0 = ok(vbPlan([], keep('vb-rank-none.json', JSON.stringify({ ...rk, orient: [] })), smallScan))
  assert.deepEqual([p0.pick, p0.pickAsk, p0.pickIndex], [[], [], null])

  // sessions: no tick, no orient and no big item; a tick opens its orient (last) and its held item; typed words match.
  const pf = keep('vb-plan.json', JSON.stringify(pl))
  const sesAt = (ib, more) => py(['sessions', '--plan', pf, '--status', `${IB_RO}=${ib}`, '--status', `${SO_RO}=8`, ...more])
  const ses = (more) => sesAt(13, more)
  const OWN_HELD = 'own session: open it from the pick list'
  const none = ok(ses([]))
  assert.deepEqual(none.items, [])
  assert.deepEqual(none.left.find((x) => x.rollout === IB_RO), { rollout: IB_RO, action: 13, holds: [], why: OWN_HELD, held: 'execute' })
  assert.deepEqual(none.left.find((x) => x.rollout === SO_RO), { rollout: SO_RO, action: 8, holds: ['paused'], why: OWN_HELD, held: 'repair' })
  assert.deepEqual(none.unmatched, [])
  // Ticking BigSo starts the repair that asks its unsigned gate (repair § 1's approve-gates), then its orient, whose
  // prompt names that repair and leaves the sign-off to it.
  const so = ok(ses(['--open', 'BigSo']))
  assert.deepEqual(so.items.map((x) => [x.kind, x.rollout ?? x.project]), [['repair', SO_RO], ['orient', 'BigSo']])
  const [soRepair, soOrient] = so.items
  assert.deepEqual([soRepair.prompt, soRepair.title, soRepair.manual], [`/thread:repair [[${SO_RO}]]`, `Repair: ${SO_RO}`, false])
  assert.match(soRepair.why, /^status action 8: 1 pending sign-off waiting on its own session, which repair asks$/)
  assert.ok(!soRepair.tldr.includes('/') && /sign-offs/.test(soRepair.tldr), soRepair.tldr)
  assert.deepEqual(soOrient.prompt.split('\n'), ['/thread:orient [[BigSo]]', ASKS(SO_RO, ['bigso-gate']),
    PICKED('1 pending sign-off, 1 held rollout item')])
  assert.ok(!so.left.some((x) => x.rollout === SO_RO))
  // The repair route of the own-session hold: Items and Bits at action 11 is held `repair` unticked, and repaired once
  // ticked (its own status, no sign-off line: it has none pending).
  const r11 = ok(sesAt(11, []))
  assert.deepEqual(r11.left.find((x) => x.rollout === IB_RO), { rollout: IB_RO, action: 11, holds: [], why: OWN_HELD, held: 'repair' })
  assert.deepEqual(r11.items, [])
  const r11o = ok(sesAt(11, ['--open', 'Items and Bits']))
  assert.deepEqual(r11o.items.map((x) => [x.kind, x.rollout ?? x.project]), [['repair', IB_RO], ['orient', 'Items and Bits']])
  assert.deepEqual([r11o.items[0].prompt, r11o.items[0].tldr], [`/thread:repair [[${IB_RO}]]`, 'Sorts out a live rollout that status says needs repair.'])
  assert.deepEqual(r11o.items[1].prompt.split('\n'), ['/thread:orient [[Items and Bits]]', PICKED('1 held rollout item')])
  const ib = ok(ses(['--open', 'items and bits']))
  assert.deepEqual(ib.items.map((x) => [x.kind, x.rollout ?? x.project]), [['execute', IB_RO], ['orient', 'Items and Bits']])
  const ibo = ib.items[1]
  assert.deepEqual(ibo.prompt.split('\n'), ['/thread:orient [[Items and Bits]]', PICKED('1 held rollout item')])
  assert.deepEqual([ibo.why, ibo.title, ibo.note], ['ticked on the pick list', 'Orient: Items and Bits', 'Work/Projects/Items and Bits.md'])
  assert.ok(!ibo.tldr.includes('/'))
  assert.ok(!ib.left.some((x) => x.rollout === IB_RO))
  assert.deepEqual(ok(ses(['--open', 'bigdue'])).items.map((x) => x.project), ['BigDue'], 'case-blind')
  // A small project ticked for its Orient tasks: its line says only that, never the big project's own-session line.
  const sm = ok(ses(['--open', '[[Work/Projects/SmallOr.md]]', '--open', 'Not now']))
  assert.deepEqual(sm.items.map((x) => x.project), ['SmallOr'])
  assert.deepEqual(sm.items[0].prompt.split('\n'), ['/thread:orient [[SmallOr]]', PICKED_SMALL('1 Orient task')])
  const typed = ok(ses(['--typed', 'items and bits, bigdue and nope']))
  assert.deepEqual(typed.items.map((x) => [x.kind, x.rollout ?? x.project]), [['execute', IB_RO], ['orient', 'BigDue'], ['orient', 'Items and Bits']])
  assert.deepEqual(typed.unmatched, ['nope'])
  const tNone = ok(ses(['--typed', 'none']))
  assert.deepEqual([tNone.items, tNone.unmatched], [[], []])
  refusal(ses(['--open', 'Nope']), /--open Nope/)
  // Twins: two projects named SEO. Every twin's label is numbered, the first included, its description and orient link
  // its note's path, and a ticked label opens its own project alone; typed, the bare name opens both.
  assert.equal(vtScanRun.status, 0, vtScanRun.stderr)
  assert.equal(vtRankRun?.status, 0, vtRankRun?.stderr)
  const [SEO_RO, WEB_RO] = Object.keys(TWINS)
  const tw = ok(py(['plan', '--rank', VT_RANK, '--scan', VT_SCAN, '--status', `${SEO_RO}=13`, '--status', `${WEB_RO}=13`]))
  assert.deepEqual(tw.pick.map((e) => [e.name, e.note, e.link, e.rollouts]), [['SEO', 'Work/Projects/SEO.md', 'Work/Projects/SEO', [SEO_RO]],
    ['SEO', 'Work/Projects/Web/SEO.md', 'Work/Projects/Web/SEO', [WEB_RO]]])
  assert.deepEqual(tw.pickIndex.labels, ['1. SEO', '2. SEO', 'Not now'])
  assert.deepEqual(tw.pickAsk[0].options.slice(0, 2).map((o) => o.description.split(':')[0]), ['[[Work/Projects/SEO]]', '[[Work/Projects/Web/SEO]]'])
  const twf = keep('vt-plan.json', JSON.stringify(tw))
  const twin = (more) => ok(py(['sessions', '--plan', twf, '--status', `${SEO_RO}=13`, '--status', `${WEB_RO}=13`, ...more]))
  const first = twin(['--open', '1. SEO'])
  assert.deepEqual(first.items.map((x) => [x.kind, x.rollout ?? x.note]), [['execute', SEO_RO], ['orient', 'Work/Projects/SEO.md']])
  assert.deepEqual([first.items[1].prompt.split('\n')[0], first.items[1].title], ['/thread:orient [[Work/Projects/SEO]]', 'Orient: Work/Projects/SEO'])
  assert.deepEqual(first.left.map((x) => [x.rollout, x.held]), [[WEB_RO, 'execute']])
  assert.deepEqual(twin(['--open', '2. SEO']).items.map((x) => [x.kind, x.rollout ?? x.note]), [['execute', WEB_RO], ['orient', 'Work/Projects/Web/SEO.md']])
  assert.deepEqual(twin(['--typed', 'SEO']).items.map((x) => x.rollout ?? x.note),
    [SEO_RO, WEB_RO, 'Work/Projects/SEO.md', 'Work/Projects/Web/SEO.md'])
  // Reruns are byte-equal, and VB is untouched.
  for (const run of [() => vbRounds(30), () => vbPlan(STATUS), () => ses(['--typed', 'big, nope'])]) {
    const a = run()
    assert.equal(a.status, 0, a.stderr)
    assert.equal(run().stdout, a.stdout)
  }
  assert.deepEqual(snap(VB), VB_BEFORE, 'the vault is untouched')
})
