// skills/_shared/scripts/estate-dispatch.py — the estate pass's deterministic half after the ranker (ADR 0041;
// CONTEXT.md **Decision round**, **Dispatch plan**; skills/orient-all/SKILL.md is its one caller). Every case runs the
// shipped script under one temp dir S: the fixture vault V, a fake HOME, and the grades files the grading agents
// would return, written by hand. The scan is the real one (`estate-scan.py --vault V --today 2026-10-20 --deadline 0`,
// which starts no subprocess, so every rollout summary is null and every repo check unchecked); the rollout summaries,
// one blocker and two clones' rolloutRoot are injected into a copy of its JSON, as the status probes and repo checks
// would have found them. The rank is the real `estate-rank.py rank` over that copy. Both run once and are shared.
// The notes three schedule forks would have written are added to V after the scan, as they land after it in a real
// pass. record writes only copies of V.
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
test('D13. usage: a bad verb, flag, input, budget, status or written note is exit 2 with one line; a missing vault exit 3', () => {
  ranked()
  const notJson = keep('not-json.json', 'not json\n')
  const scan2 = keep('scan-2.json', JSON.stringify({ ...scanned(), schema: 2 }))
  const rank2 = keep('rank-2.json', JSON.stringify({ ...ranked(), schema: 2 }))
  const plan2 = keep('plan-2.json', JSON.stringify({ ...ok(PLAN()), schema: 2 }))
  refusal(py(['frob']))
  refusal(py([]))
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
    () => sessions(SIGNED_FILE(), ['--wrote', WROTE_PAR, '--wrote', WROTE_SER, '--status', 'clean-rollout-2026-10-19=13']),
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
  // Order: written notes, live executes, repairs, orients last.
  const all = ok(sessions(SIGNED_FILE(), ['--wrote', WROTE_PAR, '--wrote', WROTE_SER, '--status', 'signoff-rollout-2026-10-19=8',
    '--status', `${CLEAN}=11`, '--status', 'live-rollout-2026-10-19=7']))
  assert.deepEqual(all.items.map((x) => [x.kind, x.rollout ?? x.project]), [
    ['execute', 'wrote-par-rollout-2026-10-20'], ['leg', 'wrote-ser-rollout-2026-10-20'],
    ['execute', 'signoff-rollout-2026-10-19'], ['repair', CLEAN], ['repair', 'live-rollout-2026-10-19'],
    ['orient', 'Act'], ['orient', 'Bo']])
  const act = all.items.find((x) => x.kind === 'orient' && x.project === 'Act')
  assert.equal(act.prompt, `/thread:orient [[Act]]\norient-all wrote [[wrote-par-rollout-2026-10-20]] for this project on ${TODAY} ` +
    'and is starting its execute; leave that rollout to it, its tasks are in flight.')
  assert.equal(all.items.find((x) => x.project === 'Bo').prompt, '/thread:orient [[Bo]]')
  assert.equal(ok(sessions(PLAN_FILE())).items.find((x) => x.project === 'Act').prompt, '/thread:orient [[Act]]')
  for (const x of all.items) {
    assert.ok(x.title.length <= 60, x.title)
    assert.ok(x.tldr && !x.tldr.includes('/'), `a tldr with no paths: ${x.tldr}`)
  }
})
