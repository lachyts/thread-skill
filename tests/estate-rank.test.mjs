// skills/_shared/scripts/estate-rank.py — the estate pass's ranker and the snooze record's one writer and reader
// (CONTEXT.md **Readiness grade**, **Review load**, **Unpark offer**, **Ranked slate**; ADR 0041;
// skills/_shared/readiness-grade.md). Every case runs the shipped script under one temp dir S: the fixture vault V,
// a fake HOME and the grades files the per-project grading agents would return, written by hand here. The scan is
// the real one (`estate-scan.py --vault V --today 2026-10-20 --deadline 0`, which starts no subprocess), run once and
// shared, so the ranker is pinned to the scan's actual schema; the cases that need a blocker mutate that JSON in
// memory into S/scan-*.json. Every rank run passes --today 2026-10-20; the snooze, unpark and kill cases (R1-R4: the
// Unpark offer's writes, p25-3) write only copies of V.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { root } from './lib/contract-text.mjs'

const RANK = path.join(root, 'skills', '_shared', 'scripts', 'estate-rank.py')
const SCAN = path.join(root, 'skills', '_shared', 'scripts', 'estate-scan.py')
const TODAY = '2026-10-20'

// The estate-scan suite's base env: git's repo-local names scrubbed, the real user base pinned (a `pip install
// --user` PyYAML resolves under HOME, which every run swaps), HOME and the events dir inside S.
const drop = spawnSync('git', ['rev-parse', '--local-env-vars'], { encoding: 'utf8' }).stdout.split('\n').filter(Boolean)
const base = { ...process.env }
for (const name of drop) delete base[name]
base.PYTHONUSERBASE ??= spawnSync('python3', ['-c', 'import site; print(site.getuserbase())'], { encoding: 'utf8' }).stdout.trim()

const S = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'estate-rank-')))
after(() => fs.rmSync(S, { recursive: true, force: true }))
const HOME = path.join(S, 'home')
fs.mkdirSync(HOME, { recursive: true })
const env = { ...base }
for (const name of ['CLAUDE_PLUGIN_ROOT', 'PYTHONDONTWRITEBYTECODE']) delete env[name]
Object.assign(env, { HOME, THREAD_EVENTS_DIR: process.env.THREAD_TEST_EVENTS_DIR || path.join(S, 'events') })

const mkdir = (p) => fs.mkdirSync(p, { recursive: true })
const write = (p, text) => { mkdir(path.dirname(p)); fs.writeFileSync(p, text) }
const once = (fn) => { let v; return () => (v ??= fn()) }

// ---- Vault V -------------------------------------------------------------------------------------------------
const V = path.join(S, 'v')
const fm = (lines, body = '\n# Note\n') => `---\n${lines}\n---\n${body}`
const P = (name, status, rest = '') =>
  write(path.join(V, 'Work', 'Projects', `${name}.md`), fm(`tags:\n  - project${status ? `\nstatus: ${status}` : ''}${rest}`))
const T = (slug, status, projects, rest = '') => write(path.join(V, 'Work', 'Tasks', `${slug}.md`),
  fm(`tags:\n  - task\nstatus: ${status}\nprojects:${projects.length ? projects.map((p) => `\n  - "[[${p}]]"`).join('') : ' []'}${rest}`,
    `\n# Task ${slug}\n`))
const links = (key, list) => (list.length ? `\n${key}:${list.map((l) => `\n  - "${l.startsWith('[[') ? l : `[[${l}]]`}"`).join('')}` : '')

P('Crown', 'crowned', '\ncrowned: 2026-10-01\nrepos:\n  - ~/repos/crown')
P('Act', 'active', '\nrepos:\n  - ~/repos/act')
P('Shared', 'active', '\nrepos:\n  - ~/repos/act')
P('Two', 'active', '\nrepos:\n  - ~/repos/two-a\n  - ~/repos/two-b')
P('Que', 'queued')
P('QueCrowned', 'queued', '\ncrowned: 2026-09-01')  // a `crowned:` date on a queued project: not crowned
P('Lab', 'active')
P('Dep', 'active', '\nrepos:\n  - ~/repos/dep')
P('Hold', 'active')
P('Holdy', 'on-hold')  // standing other
P('Bare', '')  // standing none
P('Stale', 'active', '\nsnoozed_until: 2026-12-01\nsnoozed_ready: 9')  // snooze keys on an unparked project mean nothing
P('ParkOffer', 'parked')
P('ParkSnoozed', 'parked', '\nsnoozed_until: 2026-10-25\nsnoozed_ready: 2')
P('ParkGrown', 'parked', '\nsnoozed_until: 2026-10-25\nsnoozed_ready: 1')
P('ParkExpired', 'parked', '\nsnoozed_until: 2026-10-20\nsnoozed_ready: 1')
P('ParkDateOnly', 'parked', '\nsnoozed_until: 2026-10-30')
P('ParkBadDate', 'parked', '\nsnoozed_until: soon')
P('ParkNoReady', 'parked')
P('ParkDepOnly', 'parked')
P('ParkChain', 'parked')
P('ParkOrient', 'parked')  // its only task is Orient: no orient session and no Unpark offer
P('ParkCaps', 'Parked')  // a capitalised status reads as parked in the scan and in the snooze writer alike
P('DoneProj', 'parked', '\ndone: true')  // dead: not in the scan, refused by the snooze writer
write(path.join(V, 'Work', 'Projects', 'Area', 'Area.md'), fm('tags:\n  - area'))

T('crown-low', 'open', ['Crown'])
T('crown-par', 'open', ['Crown'])
for (const s of ['act-ready-l', 'act-call', 'act-grill', 'act-orient', 'act-tie-a', 'act-tie-b', 'act-event']) T(s, 'open', ['Act'])
T('act-later', 'open', ['Act'], '\ndue: 2026-11-20')
T('act-edge14', 'open', ['Act'], '\ndue: 2026-11-03')
T('act-edge15', 'open', ['Act'], '\ndue: 2026-11-04')
T('act-today', 'open', ['Act'], '\ndue: 2026-10-20')
T('act-baddue', 'open', ['Act'], '\ndue: soon-ish')
T('act-inprog', 'in-progress', ['Act'])
T('act-review', 'review', ['Act'])
T('act-hold', 'blocked', ['Act'])
T('multi-a', 'open', ['Act', 'Crown'])
for (const s of ['shared-par', 'shared-tie', 'shared-eye']) T(s, 'open', ['Shared'])
for (const s of ['two-repo', 'two-norepo', 'two-badrepo']) T(s, 'open', ['Two'])
T('que-call', 'open', ['Que'], '\ndue: 2026-10-25')
T('que-overdue', 'open', ['Que'], '\ndue: 2026-10-01')
for (const s of ['que-serial', 'que-orient', 'que-grill']) T(s, 'open', ['Que'])
T('qc-top', 'open', ['QueCrowned'])
const LAB = Array.from({ length: 24 }, (_, i) => `lab-${String(i + 1).padStart(2, '0')}`)
for (const s of LAB) T(s, 'open', ['Lab'])
T('loose', 'open', [])
T('hold-only', 'open', ['Hold'], links('depends-on', ['act-orient']))
// Dep's tasks and what each depends on (case 16's table).
const DEP_LINKS = {
  'dep-same-a': [], 'dep-same-b': ['dep-same-a'], 'dep-on-inflight': ['act-inprog'], 'dep-call': [],
  'dep-on-call': ['dep-call'], 'dep-on-grill': ['act-grill'], 'dep-on-orient': ['act-orient'], 'dep-ungraded': [],
  'dep-on-ungraded': ['dep-ungraded'], 'dep-invalid': [], 'dep-on-invalid': ['dep-invalid'], 'dep-on-hold': ['act-hold'],
  'dep-on-unhomed': ['loose'], 'dep-on-landed': ['dep-landed', 'no-such-task'], 'dep-on-held': ['dep-on-call'],
  'dep-cycle-a': ['dep-cycle-b'], 'dep-cycle-b': ['dep-cycle-a'], 'dep-self': ['dep-self'], 'dep-on-parked': ['po-a'],
  'dep-alias': ['[[Work/Tasks/dep-call|the call]]'], 'dep-case': ['DEP-CALL'], 'dep-call-held': ['dep-ungraded'],
}
for (const [s, l] of Object.entries(DEP_LINKS)) T(s, 'open', ['Dep'], links('depends-on', l))
T('dep-blocked-by', 'open', ['Dep'], links('blocked-by', ['dep-call']))
T('dep-landed', 'done', ['Dep'])
T('po-a', 'open', ['ParkOffer'])
T('po-b', 'open', ['ParkOffer'])
T('ps-a', 'open', ['ParkSnoozed'])
T('pg-a', 'open', ['ParkGrown'])
T('pg-b', 'open', ['ParkGrown'])
T('pe-a', 'open', ['ParkExpired'])
T('pd-a', 'open', ['ParkDateOnly'])
T('pb-a', 'open', ['ParkBadDate'])
T('pn-call', 'open', ['ParkNoReady'], '\ndue: 2026-10-21')
T('pdo-a', 'open', ['ParkDepOnly'], links('depends-on', ['act-orient']))
T('pc-a', 'open', ['ParkChain'])
T('pc-b', 'open', ['ParkChain'], links('depends-on', ['pc-a']))
T('por-orient', 'open', ['ParkOrient'])

// ---- The scan, once ------------------------------------------------------------------------------------------
const scanRun = spawnSync('python3', [SCAN, '--vault', V, '--today', TODAY, '--deadline', '0'],
  { encoding: 'utf8', cwd: S, env, timeout: 60000 })
const SCAN_FILE = path.join(S, 'scan.json')
fs.writeFileSync(SCAN_FILE, scanRun.stdout)
let SCANNED = null
try { SCANNED = JSON.parse(scanRun.stdout) } catch { /* the first case names it */ }
const scanned = () => { assert.equal(scanRun.status, 0, scanRun.stderr); assert.ok(SCANNED, 'the scan printed JSON'); return SCANNED }

// ---- The grades ----------------------------------------------------------------------------------------------
const D = (question, recommendation, options, confidence = 'high') =>
  ({ question, recommendation, options, confidence, why: 'fixture: src/x.py:12' })
const one = () => [D('Which way?', 'left', ['left', 'right'])]
const G = (slug, grade, shape, extra = {}) => ({ slug, grade, shape, size: 'S', why: `fixture grade for ${slug}`, ...extra })
const DEP_READY = [...Object.keys(DEP_LINKS).filter((s) => !['dep-call', 'dep-ungraded', 'dep-invalid', 'dep-call-held'].includes(s)),
  'dep-blocked-by']
const MAIN = {
  Crown: [G('crown-low', 'Ready', 'session', { size: 'M' }), G('crown-par', 'Ready', 'parallel')],
  Act: [
    G('act-ready-l', 'Ready', 'parallel', { size: 'L' }),
    G('act-call', 'One call', 'parallel', { size: 'M', decisions: one() }),
    G('act-grill', 'Grill', 'serial', { size: 'M', decisions: [D('Schema?', 'flat', ['flat', 'nested'], 'medium'),
      D('Cache?', 'none', ['none', 'lru'], 'medium')] }),
    G('act-orient', 'Orient', 'serial', { size: 'L' }),
    ...['act-tie-a', 'act-tie-b', 'act-later', 'act-edge14', 'act-edge15', 'act-today', 'act-baddue'].map((s) => G(s, 'Ready', 'serial')),
    G('act-event', 'Ready', 'serial', { deadline: { date: '2026-10-22', why: 'the festival opens' } }),
    G('multi-a', 'Ready', 'serial', { size: 'M' }),
  ],
  Shared: [G('shared-par', 'Ready', 'parallel'), G('shared-tie', 'Ready', 'serial'),
    G('shared-eye', 'Ready', 'serial', { eyeCheck: true })],
  Two: [G('two-repo', 'Ready', 'parallel', { size: 'M', repo: '~/repos/two-a' }), G('two-norepo', 'Ready', 'parallel', { size: 'M' }),
    G('two-badrepo', 'Ready', 'parallel', { repo: '~/repos/elsewhere' })],
  Que: [
    G('que-call', 'One call', 'parallel', { gates: ['spend'], decisions: [D('Pay for the API?', 'yes, capped', ['yes, capped', 'no'])] }),
    G('que-serial', 'Ready', 'serial'), G('que-overdue', 'Ready', 'serial', { size: 'M' }), G('que-orient', 'Orient', 'session'),
    G('que-grill', 'Grill', 'serial', { decisions: [D('A?', 'a', ['a', 'b']), D('B?', 'a', ['a', 'b']), D('C?', 'a', ['a', 'b'])] }),
  ],
  QueCrowned: [G('qc-top', 'Ready', 'serial', { size: 'L' })],
  Hold: [G('hold-only', 'Ready', 'serial')],
  Dep: [...DEP_READY.map((s) => G(s, 'Ready', 'parallel')), G('dep-call', 'One call', 'parallel', { decisions: one() }),
    G('dep-call-held', 'One call', 'parallel', { decisions: one() }), G('dep-invalid', 'One call', 'parallel', { decisions: [] })],
}
const R = (slug) => G(slug, 'Ready', 'serial')
const PARKED = [
  { project: 'ParkOffer', tasks: [R('po-a'), G('po-b', 'One call', 'serial', { decisions: one() })] },
  { project: 'ParkSnoozed', tasks: [R('ps-a')] },
  { project: 'ParkGrown', tasks: [R('pg-a'), R('pg-b')] },
  { project: 'ParkExpired', tasks: [R('pe-a')] },
  { project: 'ParkDateOnly', tasks: [R('pd-a')] },
  { project: 'ParkBadDate', tasks: [R('pb-a')] },
  { project: 'ParkNoReady', tasks: [G('pn-call', 'One call', 'serial', { decisions: one() })] },
  { project: 'ParkDepOnly', tasks: [R('pdo-a')] },
  { project: 'ParkChain', tasks: [R('pc-a'), R('pc-b')] },
  { project: 'ParkOrient', tasks: [G('por-orient', 'Orient', 'serial')] },
]
const gradesFile = (name, data) => { const p = path.join(S, `grades-${name}.json`); write(p, JSON.stringify(data, null, 2) + '\n'); return p }
const MAIN_FILES = [...Object.entries(MAIN).map(([project, tasks]) => gradesFile(project, { project, tasks })),
  gradesFile('parked', PARKED)]  // the parked projects as one array file

// ---- Running it ----------------------------------------------------------------------------------------------
// `stdinFile` feeds a file to the child's stdin by descriptor: a spawnSync `input` larger than a pipe buffer (the scan is
// about 67 KB) intermittently never reaches EOF on macOS, which left `--scan -` blocked in read() until the timeout.
function py(args, { stdinFile, extra = {} } = {}) {
  const fd = stdinFile ? fs.openSync(stdinFile, 'r') : null
  let r
  try {
    r = spawnSync('python3', [RANK, ...args], { encoding: 'utf8', cwd: S, env: { ...env, ...extra }, timeout: 60000,
      stdio: [fd ?? 'ignore', 'pipe', 'pipe'] })
  } finally {
    if (fd !== null) fs.closeSync(fd)
  }
  let json = null
  try { json = JSON.parse(r.stdout) } catch { /* left null: the case's own assertion names it */ }
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, json }
}
const rank = (files, more = [], opts = {}) =>
  py(['rank', '--scan', SCAN_FILE, '--today', TODAY, ...files.flatMap((f) => ['--grades', f]), ...more], opts)
const ok = (run) => { assert.equal(run.status, 0, run.stderr); assert.ok(run.json, `no JSON on stdout: ${run.stdout.slice(0, 300)}`); return run.json }
const main = once(() => rank(MAIN_FILES))
const row = (j, slug) => { const r = j.tasks.find((t) => t.slug === slug); assert.ok(r, `a task row for ${slug}`); return r }
const runOf = (j, id) => { const r = j.runs.find((x) => x.id === id); assert.ok(r, `a run ${id}: ${j.runs.map((x) => x.id).join(', ')}`); return r }
const refusal = (run, re) => {
  assert.equal(run.status, 2, run.stderr)
  assert.equal(run.stdout, '')
  const lines = run.stderr.split('\n').filter(Boolean)
  assert.equal(lines.length, 1, run.stderr)
  assert.match(lines[0], /^estate-rank: /)
  if (re) assert.match(lines[0], re)
}
const ROOT = (name) => path.join(HOME, 'repos', name)

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
function bytes(dir) {
  const out = {}
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else out[path.relative(dir, p)] = fs.readFileSync(p, 'utf8')
    }
  }
  walk(dir)
  return out
}
const BEFORE = snap(V)
const copyVault = (name) => {
  const d = path.join(S, name)
  fs.rmSync(d, { recursive: true, force: true })
  mkdir(path.dirname(d))
  fs.cpSync(V, d, { recursive: true })
  return d
}
const gradeable = (j) => j.tasks.filter((t) => t.statusClass === 'active' && !t.inFlight && t.projects.length).map((t) => t.slug)

// Case 2's field check, run over every graded row of a run.
function fieldsHold(j) {
  for (const t of j.tasks) {
    assert.ok(['Ready', 'One call', 'Grill', 'Orient'].includes(t.grade), `${t.slug} grade ${t.grade}`)
    assert.ok(['parallel', 'serial', 'session'].includes(t.shape), `${t.slug} shape ${t.shape}`)
    if (t.grade === 'One call' || t.grade === 'Grill') assert.ok(t.decisions.length >= 1, `${t.slug}: a ${t.grade} with no decision`)
    for (const d of t.decisions) {
      assert.ok(typeof d.recommendation === 'string' && d.recommendation.trim(), `${t.slug}: a decision with no recommendation`)
      assert.ok(d.options.length >= 2 && d.options.length <= 4, `${t.slug}: ${d.options.length} options`)
      assert.equal(d.options[0], d.recommendation, `${t.slug}: the recommendation comes first`)
      assert.ok(['high', 'medium', 'low'].includes(d.confidence), `${t.slug}: confidence ${d.confidence}`)
    }
  }
}

// ---- 1. Integration --------------------------------------------------------------------------------------------
test('1. integration: schema 1, every gradeable task once across tasks, ungraded and invalid; skipped names each reason', () => {
  const s = scanned()
  const j = ok(main())
  assert.equal(j.schema, 1)
  assert.equal(j.today, TODAY)
  assert.deepEqual(j.scan, { today: TODAY, vault: s.vault, deadlineHit: s.deadlineHit, vaultErrors: 0 })
  const seen = [...j.tasks.map((t) => t.slug), ...j.ungraded.map((t) => t.slug), ...j.invalid.map((t) => t.slug)]
  assert.deepEqual([...seen].sort(), gradeable(s).sort(), 'every gradeable task exactly once')
  assert.equal(new Set(seen).size, seen.length)
  assert.deepEqual(j.skipped, [{ slug: 'act-hold', why: 'hold' }, { slug: 'act-inprog', why: 'in flight' },
    { slug: 'act-review', why: 'in flight' }, { slug: 'loose', why: 'unhomed' }])
  assert.deepEqual(j.ungraded.map((t) => t.slug), ['dep-ungraded', ...LAB])
  assert.deepEqual(j.ungraded[0], { slug: 'dep-ungraded', home: 'Dep', why: 'no grade' })
  assert.deepEqual(j.invalid.map((t) => [t.slug, t.home, t.errors]), [['dep-invalid', 'Dep', ['One call needs at least one decision']]])
  // A task linked to [[Act]] and then [[Crown]] is graded once, under its first live project.
  const m = row(j, 'multi-a')
  assert.equal(m.home, 'Act')
  assert.deepEqual(m.projects, ['Act', 'Crown'])
  assert.equal(m.standing, 'active')
  assert.equal(m.title, 'Task multi-a')
  assert.equal(j.counts.graded, j.tasks.length)
  assert.equal(j.counts.ungraded, j.ungraded.length)
  assert.equal(j.counts.invalid, j.invalid.length)
  assert.equal(j.counts.ranked, j.tasks.filter((t) => t.rank !== null).length)
  // The scan from stdin reads the same.
  const piped = py(['rank', '--scan', '-', '--today', TODAY, ...MAIN_FILES.flatMap((f) => ['--grades', f])],
    { stdinFile: SCAN_FILE })
  assert.equal(piped.status, 0, piped.stderr)
  assert.equal(piped.stdout, main().stdout)
})

// ---- 2. Acceptance: fields -------------------------------------------------------------------------------------
test('2. acceptance: every graded task carries its grade and shape, and every One call or Grill a recommended answer', () => {
  const j = ok(main())
  assert.ok(j.tasks.length > 40, `${j.tasks.length} graded rows`)
  fieldsHold(j)
  const c = row(j, 'que-call')
  assert.deepEqual(c.decisions, [{ question: 'Pay for the API?', recommendation: 'yes, capped', options: ['yes, capped', 'no'],
    confidence: 'high', why: 'fixture: src/x.py:12' }])
})

// ---- 3. The raise ----------------------------------------------------------------------------------------------
const hi = () => D('Q?', 'a', ['a', 'b'], 'high')
const lo = () => D('Q?', 'a', ['a', 'b'], 'low')
const md = () => D('Q?', 'a', ['a', 'b'], 'medium')
const nc = () => { const d = D('Q?', 'a', ['a', 'b']); delete d.confidence; return d }
const RAISE = [
  ['lab-01', 'Ready', [], 'Ready', []],
  ['lab-02', 'Ready', [hi()], 'One call', [['Ready', 'One call', 'decisions']]],
  ['lab-03', 'One call', [lo()], 'Grill', [['One call', 'Grill', 'confidence']]],
  ['lab-04', 'One call', [nc()], 'Grill', [['One call', 'Grill', 'confidence']]],
  ['lab-05', 'One call', [md(), md()], 'Grill', [['One call', 'Grill', 'decisions']]],
  ['lab-06', 'Grill', [hi()], 'Grill', []],
  ['lab-07', 'Grill', [lo()], 'Orient', [['Grill', 'Orient', 'confidence']]],
  ['lab-08', 'Orient', [lo()], 'Orient', []],
  ['lab-09', 'Ready', [lo()], 'Grill', [['Ready', 'One call', 'decisions'], ['One call', 'Grill', 'confidence']]],
  ['lab-10', 'one-call', [hi()], 'One call', []],
  ['lab-11', 'ONE CALL', [hi()], 'One call', []],
  ['lab-12', 'one_call', [hi()], 'One call', []],
]
test('3. the raise: decisions imply a grade, low (or missing) confidence raises one step, Orient never rises', () => {
  const file = gradesFile('raise', { project: 'Lab', tasks: RAISE.map(([slug, grade, decisions]) => G(slug, grade, 'serial', { decisions })) })
  const j = ok(rank([file]))
  fieldsHold(j)
  for (const [slug, agent, , grade, raised] of RAISE) {
    const t = row(j, slug)
    assert.equal(t.grade, grade, slug)
    assert.equal(t.agentGrade, agent.startsWith('one') || agent === 'ONE CALL' ? 'One call' : agent, `${slug} agentGrade`)
    assert.deepEqual(t.raised, raised.map(([from, to, why]) => ({ from, to, why })), slug)
  }
  assert.equal(row(j, 'lab-04').decisions[0].confidence, 'low')
  assert.ok(j.warnings.some((w) => w.includes('lab-04') && w.includes('confidence')), j.warnings.join('\n'))
})

// ---- 4. Validation ---------------------------------------------------------------------------------------------
test('4. validation: a bad entry is invalid with every error, never guessed; the soft fields warn and default', () => {
  const noRec = D('Q?', 'x', ['x', 'y']); delete noRec.recommendation
  const noOpts = D('Q?', 'x', ['x', 'y']); delete noOpts.options
  const lab = [
    G('lab-01', 'Maybe', 'serial'),
    G('lab-02', 'Ready', 'batch'),
    G('lab-03', 'One call', 'serial', { decisions: [noRec] }),
    G('lab-04', 'One call', 'serial', { decisions: [] }),
    G('lab-05', 'Grill', 'serial', { decisions: [] }),
    G('lab-06', 'One call', 'serial', { decisions: [noOpts] }),
    G('lab-07', 'One call', 'serial', { decisions: [D('Q?', 'left', 'left or right')] }),
    G('lab-08', 'One call', 'serial', { decisions: [D('Q?', 'left', ['left'])] }),
    G('lab-09', 'One call', 'serial', { decisions: [D('Q?', 'a', ['a', 'b', 'c', 'd', 'e'])] }),
    G('lab-10', 'One call', 'serial', { decisions: [D('Q?', 'left', ['left', 'Left'])] }),
    G('lab-11', 'One call', 'serial', { decisions: [D('Q?', 'left', ['left', ' '])] }),
    G('lab-12', 'One call', 'serial', { decisions: [D('Q?', 'up', ['left', 'right'])] }),
    G('lab-13', 'Ready', 'serial', { decisions: 'none' }),
    G('lab-14', 'Orient', 'session'),
    G('lab-15', 'Ready', 'serial'),
    G('lab-16', 'One call', 'serial', { decisions: [D('Q?', 'second', ['first', 'second'])] }),
    G('lab-17', 'One call', 'serial', { decisions: [D('Q?', ' keep it ', ['Keep It', 'drop it'])] }),
    G('lab-18', 'Ready', 'serial', { size: 'XL' }),
    G('lab-19', 'Ready', 'serial', { gates: ['spend', 'bribery'] }),
    G('lab-20', 'Ready', 'serial'),
    G('lab-22', 'Maybe', 'batch'),
    G('lab-23', 'Ready', 'serial', { deadline: { date: '2026-01-01', why: 'the launch was in January' } }),
    G('lab-24', 'Ready', 'serial', { deadline: { date: TODAY, why: 'the booking window closes tonight' } }),
    G('act-inprog', 'Ready', 'serial'),
    G('ghost', 'Ready', 'serial'),
  ]
  // The other file comes first and grades lab-20 too, but under another project: the home's entry wins.
  const elsewhere = gradesFile('elsewhere', { project: 'Elsewhere', tasks: [G('lab-20', 'Orient', 'serial')] })
  const j = ok(rank([elsewhere, gradesFile('validation', { project: 'Lab', tasks: lab })]))
  fieldsHold(j)
  const errs = Object.fromEntries(j.invalid.map((t) => [t.slug, t.errors]))
  const EXPECT = {
    'lab-01': /^grade "Maybe" is not one of Ready, One call, Grill, Orient$/,
    'lab-02': /^shape "batch" is not one of parallel, serial, session$/,
    'lab-03': /^decision 1: no recommendation$/,
    'lab-06': /^decision 1: no options$/,
    'lab-07': /^decision 1: options is not a list$/,
    'lab-08': /^decision 1: needs 2 to 4 options, has 1$/,
    'lab-09': /^decision 1: needs 2 to 4 options, has 5$/,
    'lab-10': /^decision 1: option "Left" is given twice$/,
    'lab-11': /^decision 1: option 2 is empty$/,
    'lab-12': /^decision 1: recommendation "up" is not one of its options$/,
    'lab-13': /^decisions is not a list$/,
  }
  assert.deepEqual(Object.keys(errs).sort(), [...Object.keys(EXPECT), 'lab-04', 'lab-05', 'lab-22'].sort())
  for (const [slug, re] of Object.entries(EXPECT)) assert.ok(errs[slug].some((e) => re.test(e)), `${slug}: ${JSON.stringify(errs[slug])}`)
  assert.deepEqual(errs['lab-04'], ['One call needs at least one decision'])
  assert.deepEqual(errs['lab-05'], ['Grill needs at least one decision'])
  assert.equal(errs['lab-22'].length, 2, 'every error is listed')
  assert.equal(row(j, 'lab-14').grade, 'Orient')
  assert.equal(row(j, 'lab-15').grade, 'Ready')
  const second = row(j, 'lab-16').decisions[0]
  assert.equal(second.recommendation, 'second')
  assert.deepEqual(second.options, ['second', 'first'])
  const cased = row(j, 'lab-17').decisions[0]
  assert.equal(cased.recommendation, 'Keep It')
  assert.deepEqual(cased.options, ['Keep It', 'drop it'])
  assert.equal(row(j, 'lab-18').size, 'M')
  assert.equal(row(j, 'lab-18').agentMinutes, 120)
  assert.deepEqual(row(j, 'lab-19').gates, ['spend'])
  assert.equal(row(j, 'lab-20').grade, 'Ready', "the home's entry wins over the first")
  const warned = (re) => assert.ok(j.warnings.some((w) => re.test(w)), `no warning ${re}: ${j.warnings.join('\n')}`)
  // A grader deadline before today has passed and cannot be met: dropped with a warning, never ranked as overdue
  // (the scan's overdue `due:` keeps its place: case 5's que-overdue). One on today counts.
  const past = row(j, 'lab-23')
  assert.deepEqual([past.deadline, past.dueSoon], [null, false])
  warned(/^lab-23: deadline 2026-01-01 is before today, already past; dropped$/)
  assert.ok(!j.warnings.some((w) => w.startsWith('lab-24')), j.warnings.join('\n'))
  assert.deepEqual(row(j, 'lab-24').deadline, { date: TODAY, source: 'grader', why: 'the booking window closes tonight' })
  assert.equal(row(j, 'lab-24').dueSoon, true)
  assert.ok(row(j, 'lab-24').rank < past.rank, 'the past deadline puts lab-23 nowhere near the top')
  warned(/lab-18.*size/)
  warned(/lab-19.*bribery/)
  warned(/lab-20/)
  warned(/act-inprog/)
  warned(/ghost/)
  assert.ok(!j.tasks.some((t) => t.slug === 'act-inprog'), 'in-flight work is never graded')
  assert.ok(j.ungraded.some((t) => t.slug === 'lab-21'))
})

// ---- 5. Acceptance: ranking --------------------------------------------------------------------------------------
test('5. acceptance: a due-soon task ranks above a higher-leverage undated one; parked comes last whatever its deadline', () => {
  const j = ok(main())
  const r = (slug) => row(j, slug).rank
  const call = row(j, 'que-call')
  assert.equal(call.dueSoon, true)
  assert.deepEqual(call.deadline, { date: '2026-10-25', source: 'due', why: null })
  assert.ok(row(j, 'act-ready-l').leverage > call.leverage)
  assert.ok(r('que-call') < r('act-ready-l'), 'due soon above the higher-leverage undated task')
  assert.ok(r('que-call') < r('crown-low') && r('que-call') < r('crown-par'), "due soon above the crowned project's undated work")
  assert.ok(r('que-overdue') < r('que-call'), 'an overdue task is due soon, and the earliest deadline goes first')
  assert.equal(row(j, 'act-later').dueSoon, false, 'a deadline beyond the fortnight is no deadline tier')
  assert.ok(r('act-later') > r('crown-low'))
  const ev = row(j, 'act-event')
  assert.deepEqual(ev.deadline, { date: '2026-10-22', source: 'grader', why: 'the festival opens' })
  assert.ok(r('act-today') < r('act-event') && r('act-event') < r('que-call'), "the grader's event deadline counts")
  assert.equal(row(j, 'act-today').dueSoon, true, 'due today is due soon')
  assert.equal(row(j, 'act-edge14').dueSoon, true, 'due on today + 14 is due soon')
  assert.equal(row(j, 'act-edge15').dueSoon, false, 'today + 15 is not')
  assert.equal(row(j, 'act-baddue').deadline, null, 'a raw due: that is not a date is ignored')
  const parked = row(j, 'pn-call')
  assert.equal(parked.dueSoon, true)
  for (const t of j.tasks) if (t.rank !== null && t.standing !== 'parked') assert.ok(t.rank < parked.rank, `${t.slug} above parked`)
  // The ranks are 1..n over the graded tasks other than Orient; Orient follows, unranked.
  const ranked = j.tasks.filter((t) => t.rank !== null)
  assert.deepEqual(ranked.map((t) => t.rank), ranked.map((_, i) => i + 1))
  assert.deepEqual(j.tasks.filter((t) => t.rank === null).map((t) => t.slug), ['act-orient', 'por-orient', 'que-orient'])
})

// ---- 6. Leverage ---------------------------------------------------------------------------------------------------
test('6. leverage: agent minutes over attention minutes (deciding plus reviewing), exactly', () => {
  const j = ok(main())
  const t = (slug) => row(j, slug)
  assert.equal(t('two-repo').leverage, 60)
  assert.deepEqual(t('two-repo').review, { pr: 1, signOff: 0, eyeCheck: 0, minutes: 2 })
  assert.equal(t('que-serial').leverage, 30)
  assert.equal(t('que-serial').attentionMinutes, 0)
  assert.equal(t('que-call').leverage, 7.5)
  assert.equal(t('que-call').decisionMinutes, 1)
  assert.deepEqual(t('que-call').review, { pr: 1, signOff: 1, eyeCheck: 0, minutes: 3 })
  assert.equal(t('que-call').attentionMinutes, 4)
  assert.equal(t('crown-low').leverage, 1)
  assert.equal(t('crown-low').attentionMinutes, 120, 'a session task holds Lachy for its whole length')
  assert.deepEqual(t('shared-eye').review, { pr: 0, signOff: 0, eyeCheck: 1, minutes: 3 })
  assert.equal(t('shared-eye').leverage, 10)
  assert.equal(t('act-grill').decisionMinutes, 4)
  assert.equal(t('que-grill').decisionMinutes, 6)
  assert.equal(t('act-orient').decisionMinutes, 0)
})

// ---- 7. Undated order -----------------------------------------------------------------------------------------------
test('7. undated work: crowned first (standing crowned only), then leverage, then standing, name and slug', () => {
  const j = ok(main())
  const r = (slug) => row(j, slug).rank
  assert.ok(r('crown-low') < r('act-ready-l'), 'a crowned low-leverage task above an active high-leverage one')
  const qc = row(j, 'qc-top')
  assert.equal(qc.standing, 'queued', 'a `crowned:` date on a queued project is not crowned')
  for (const slug of ['crown-low', 'crown-par']) assert.ok(r(slug) < qc.rank, `${slug} above qc-top`)
  const band = j.tasks.filter((t) => t.rank !== null && !t.dueSoon && t.standing !== 'crowned' && t.standing !== 'parked')
  assert.equal(band[0].slug, 'qc-top', 'the highest leverage leads the middle band')
  for (let i = 1; i < band.length; i++) assert.ok(band[i - 1].leverage >= band[i].leverage, `${band[i - 1].slug} before ${band[i].slug}`)
  // Leverage 30 four ways: active before queued, then name, then slug.
  assert.ok(r('act-tie-a') < r('act-tie-b') && r('act-tie-b') < r('shared-tie') && r('shared-tie') < r('que-serial'))
})

// ---- 8. Runs ---------------------------------------------------------------------------------------------------------
test('8. runs: grouped by home, shape and root, with their Review load, blockers and the roots they share', () => {
  const j = ok(main())
  const act = ROOT('act')
  const two = runOf(j, `Two/parallel/${ROOT('two-a')}`)
  assert.deepEqual([two.root, two.why, two.ready], [ROOT('two-a'), null, ['two-repo']])
  const unknown = runOf(j, 'Two/parallel/-')
  assert.deepEqual([unknown.root, unknown.why, unknown.ready], [null, 'repo unknown', ['two-norepo', 'two-badrepo']])
  const que = runOf(j, 'Que/parallel/-')
  assert.deepEqual([que.root, que.why, que.waiting], [null, 'no repo declared', ['que-call']])
  const a = runOf(j, `Act/parallel/${act}`)
  assert.deepEqual(a.sameRoot, [`Shared/parallel/${act}`])
  assert.deepEqual(runOf(j, `Shared/parallel/${act}`).sameRoot, [`Act/parallel/${act}`])
  assert.deepEqual([a.ready, a.waiting, a.blocked], [['act-ready-l'], ['act-call'], []])
  assert.deepEqual([a.agentMinutes, a.decisionMinutes, a.review, a.leverage],
    [600, 1, { pr: 2, signOff: 0, eyeCheck: 0, minutes: 4 }, 120])
  // Review load sums only the members that can start or wait on a decision; blocked ones are listed, not summed.
  for (const run of j.runs) {
    const live = [...run.ready, ...run.waiting].map((s) => row(j, s))
    assert.equal(run.agentMinutes, live.reduce((n, t) => n + t.agentMinutes, 0), run.id)
    assert.equal(run.decisionMinutes, live.reduce((n, t) => n + t.decisionMinutes, 0), run.id)
    assert.equal(run.review.minutes, live.reduce((n, t) => n + t.review.minutes, 0), run.id)
    for (const s of run.blocked) assert.ok(row(j, s).blockedBy.length > 0, `${s} is held`)
    for (const s of [...run.ready, ...run.waiting]) assert.deepEqual(row(j, s).blockedBy, [], `${s} is not held`)
    if (run.shape === 'serial') assert.equal(run.root, null, `${run.id}: a serial run has no root`)
  }
  const dep = runOf(j, `Dep/parallel/${ROOT('dep')}`)
  assert.ok(dep.blocked.length > 5)
  assert.notEqual(dep.agentMinutes, [...dep.ready, ...dep.waiting, ...dep.blocked].length * 30)
  for (const t of j.tasks) {
    if (t.shape === 'session' || t.grade === 'Orient') {
      assert.equal(t.run, null, `${t.slug} is in no run`)
      assert.ok(!j.runs.some((x) => [...x.ready, ...x.waiting, ...x.blocked].includes(t.slug)), `${t.slug} in a run`)
    }
  }
  assert.equal(runOf(j, 'ParkOffer/serial/-').parked, true)
  assert.equal(a.parked, false)
  const hold = runOf(j, 'Hold/serial/-')
  assert.deepEqual([hold.ready, hold.waiting, hold.blocked, hold.rank], [[], [], ['hold-only'], null])
  const ranks = j.runs.map((x) => x.rank)
  const firstNull = ranks.indexOf(null)
  assert.ok(firstNull > 0 && ranks.slice(firstNull).every((x) => x === null), `null ranks last: ${JSON.stringify(ranks)}`)
  const live = ranks.slice(0, firstNull)
  assert.deepEqual(live, [...live].sort((x, y) => x - y), 'runs by the rank of their best startable member')
  for (const run of j.runs.filter((x) => x.rank !== null)) {
    assert.equal(run.rank, Math.min(...[...run.ready, ...run.waiting].map((s) => row(j, s).rank)), run.id)
  }
  assert.equal(row(j, 'two-repo').run, two.id)
  assert.equal(row(j, 'two-repo').root, ROOT('two-a'))
  // A blocker and an unchecked entry on the scan's repo row are copied verbatim (unchecked never means clear).
  const s = JSON.parse(fs.readFileSync(SCAN_FILE, 'utf8'))
  const repo = s.repos.find((x) => x.path === act)
  assert.ok(repo, `a scan repo row for ${act}`)
  repo.blockers = [{ check: 'landing-register', why: 'listed fixture/act: a fixture listing' }]
  repo.unchecked = [{ check: 'default-branch', why: 'deadline' }]
  const blockedScan = path.join(S, 'scan-blocked.json')
  write(blockedScan, JSON.stringify(s))
  const b = ok(py(['rank', '--scan', blockedScan, '--today', TODAY, ...MAIN_FILES.flatMap((f) => ['--grades', f])]))
  for (const id of [`Act/parallel/${act}`, `Shared/parallel/${act}`]) {
    assert.deepEqual(runOf(b, id).blockers, repo.blockers, id)
    assert.deepEqual(runOf(b, id).unchecked, repo.unchecked, id)
  }
})

// ---- 9. decisions[] ---------------------------------------------------------------------------------------------------
test('9. decisions: One calls first, then Grills, each in rank order, with minutes to cut at a budget', () => {
  const j = ok(main())
  assert.deepEqual(j.decisions.map((d) => [d.slug, d.round]), [['que-call', 'one-call'], ['act-call', 'one-call'],
    ['dep-call', 'one-call'], ['dep-call-held', 'one-call'], ['act-grill', 'grill'], ['que-grill', 'grill']])
  let cum = 0
  for (const d of j.decisions) {
    const t = row(j, d.slug)
    assert.ok(d.round === 'one-call' ? d.grade === 'One call' : d.grade === 'Grill')
    assert.equal(d.minutes, t.decisions.length * (d.grade === 'One call' ? 1 : 2), d.slug)
    cum += d.minutes
    assert.equal(d.cumulativeMinutes, cum, d.slug)
    assert.deepEqual(d.decisions, t.decisions)
    assert.equal(d.home, t.home)
  }
  const held = j.decisions.find((d) => d.slug === 'dep-call-held')
  assert.deepEqual(held.blockedBy, [{ slug: 'dep-ungraded', why: 'ungraded' }])
  for (const parked of ['po-b', 'pn-call']) assert.ok(!j.decisions.some((d) => d.slug === parked), `${parked} waits on its Unpark offer`)
  assert.equal(j.counts.decisionMinutes, cum)
})

// ---- 10. orient[] -------------------------------------------------------------------------------------------------------
test('10. orient: the Orient tasks, grouped by project; a parked project gets no orient session', () => {
  const j = ok(main())
  assert.deepEqual(j.orient, [{ project: 'Act', note: 'Work/Projects/Act.md', tasks: ['act-orient'] },
    { project: 'Que', note: 'Work/Projects/Que.md', tasks: ['que-orient'] }])
  // A parked project's Orient task stays in tasks[], unranked, and waits on its Unpark offer as its decisions do;
  // with no Ready work there is no offer either, so the pass leaves the shelved project alone.
  const po = row(j, 'por-orient')
  assert.deepEqual([po.grade, po.standing, po.rank, po.run], ['Orient', 'parked', null, null])
  assert.ok(!j.orient.some((o) => o.project === 'ParkOrient' || o.tasks.includes('por-orient')), JSON.stringify(j.orient))
  assert.ok(!j.unpark.some((u) => u.project === 'ParkOrient'))
  assert.equal(j.counts.orient, 3, 'counts.orient counts every Orient task, parked included')
})

// ---- 11. Acceptance: Unpark -----------------------------------------------------------------------------------------------
test('11. acceptance: each parked project with ready work yields an Unpark offer, unless snoozed and not grown', () => {
  const j = ok(main())
  const u = Object.fromEntries(j.unpark.map((x) => [x.project, x]))
  assert.deepEqual(j.unpark.map((x) => x.project), ['ParkBadDate', 'ParkChain', 'ParkDateOnly', 'ParkExpired', 'ParkGrown',
    'ParkOffer', 'ParkSnoozed'])
  assert.deepEqual(u.ParkOffer, { project: 'ParkOffer', note: 'Work/Projects/ParkOffer.md', ready: 1, readyTasks: ['po-a'],
    offer: true, why: u.ParkOffer.why, snooze: null, options: ['unpark', 'snooze', 'kill'],
    snoozeWrite: { snoozed_until: '2026-11-03', snoozed_ready: 1 } })
  const sn = u.ParkSnoozed
  assert.equal(sn.offer, false)
  assert.ok(!('options' in sn), 'no options when not offered')
  assert.deepEqual(sn.snooze, { until: '2026-10-25', ready: 2 })
  assert.ok(sn.why.includes('2026-10-25') && /1 ready now/.test(sn.why) && /2 at the snooze/.test(sn.why), sn.why)
  assert.equal(u.ParkGrown.offer, true, 'ready work grew')
  assert.equal(u.ParkGrown.ready, 2)
  assert.equal(u.ParkExpired.offer, true, 'the fortnight has passed')
  assert.equal(u.ParkDateOnly.offer, false)
  assert.deepEqual(u.ParkDateOnly.snooze, { until: '2026-10-30', ready: null })
  assert.equal(u.ParkBadDate.offer, true)
  assert.equal(u.ParkBadDate.snooze, null)
  assert.ok(j.warnings.some((w) => w.includes('ParkBadDate') && w.includes('snoozed_until')), j.warnings.join('\n'))
  assert.ok(!u.ParkNoReady, 'a One call is no ready work')
  assert.ok(!u.ParkDepOnly, 'its only Ready task is held by an Orient dependency')
  assert.ok(!u.ParkOrient, 'an Orient task is no ready work')
  assert.deepEqual([u.ParkChain.offer, u.ParkChain.ready, u.ParkChain.readyTasks], [true, 2, ['pc-a', 'pc-b']],
    'a dependency inside the same parked project does not hold')
  assert.equal(j.counts.unpark, 7)
  assert.equal(j.counts.offers, 5)
})

// ---- 12. Snooze round trip -------------------------------------------------------------------------------------------------
test('12. snooze: two keys written in place, then not offered until the ready work grows or the fortnight passes', () => {
  const VS = copyVault('v-snooze')
  const note = path.join(VS, 'Work', 'Projects', 'ParkOffer.md')
  const before = fs.readFileSync(note, 'utf8')
  const w = py(['snooze', 'ParkOffer', '--ready', '1', '--vault', VS, '--today', TODAY])
  assert.equal(w.status, 0, w.stderr)
  assert.equal(w.stdout, 'snoozed Work/Projects/ParkOffer.md until 2026-11-03 (ready 1)\n')
  assert.equal(w.stderr, '')
  assert.equal(fs.readFileSync(note, 'utf8'),
    before.replace('status: parked\n---', 'status: parked\nsnoozed_until: "2026-11-03"\nsnoozed_ready: 1\n---'))
  const offerOf = (run) => ok(run).unpark.find((x) => x.project === 'ParkOffer')
  const snoozed = offerOf(rank(MAIN_FILES, ['--vault', VS]))
  assert.equal(snoozed.offer, false)
  assert.deepEqual(snoozed.snooze, { until: '2026-11-03', ready: 1 })
  const grown = PARKED.map((p) => (p.project === 'ParkOffer' ? { ...p, tasks: [R('po-a'), R('po-b')] } : p))
  const files = [...MAIN_FILES.slice(0, -1), gradesFile('parked-grown', grown)]
  const more = offerOf(rank(files, ['--vault', VS]))
  assert.deepEqual([more.offer, more.ready], [true, 2], 'the ready work grew')
  assert.equal(offerOf(py(['rank', '--scan', SCAN_FILE, '--today', '2026-11-03', '--vault', VS,
    ...MAIN_FILES.flatMap((f) => ['--grades', f])])).offer, true, 'the fortnight has passed')
  const again = py(['snooze', 'ParkOffer', '--ready', '2', '--vault', VS, '--today', '2026-10-21'])
  assert.equal(again.status, 0, again.stderr)
  assert.equal(fs.readFileSync(note, 'utf8'),
    before.replace('status: parked\n---', 'status: parked\nsnoozed_until: "2026-11-04"\nsnoozed_ready: 2\n---'), 'both keys overwritten in place')
})

// ---- 13. Snooze refusals and parity ------------------------------------------------------------------------------------------
test('13. snooze refuses anything but a parked project, writing nothing; it agrees with the scan on what is parked', () => {
  const VR = copyVault('v-refuse')
  write(path.join(VR, 'Work', 'Projects', 'ParkDup.md'),
    fm('tags:\n  - project\nstatus: parked\nsnoozed_until: 2026-10-01\nsnoozed_until: 2026-10-02'))
  // A flow-mapping frontmatter: cutting the snooze line would cut the whole mapping, so --clear refuses it.
  write(path.join(VR, 'Work', 'Projects', 'ParkFlow.md'),
    fm('{tags: [project], status: parked, snoozed_until: "2026-10-30", snoozed_ready: 1}'))
  const held = bytes(VR)
  const cases = [
    [['Act'], /Work\/Projects\/Act\.md is not parked \(standing: active\); only a parked project is snoozed/],
    [['Nope'], /no note/],
    [['Area'], /area note/],
    [['DoneProj'], /done/],
    [['ParkDup'], /more than once/],
    [['ParkOffer', '-1'], /--ready/],
    [['ParkOffer', 'x'], /--ready/],
  ]
  for (const [[name, ready = '0'], re] of cases) {
    refusal(py(['snooze', name, '--ready', ready, '--vault', VR, '--today', TODAY]), re)
  }
  const clears = [
    [['DoneProj', '--clear'], /done.*only a live project's snooze is cleared/],
    [['Nope', '--clear'], /no note/],
    [['ParkFlow', '--clear'], /clearing the snooze would change other frontmatter; left alone/],
    [['ParkOffer', '--clear', '--ready', '1'], /not allowed with/],
    [['ParkOffer'], /required/],
  ]
  for (const [args, re] of clears) refusal(py(['snooze', ...args, '--vault', VR, '--today', TODAY]), re)
  assert.deepEqual(bytes(VR), held, 'nothing written')
  // Parity: for every project the scan lists, the writer accepts it exactly when the scan's standing is parked.
  const s = scanned()
  assert.ok(s.projects.some((p) => p.name === 'ParkCaps' && p.standing === 'parked' && p.status === 'Parked'))
  assert.ok(s.projects.some((p) => p.standing === 'other') && s.projects.some((p) => p.standing === 'none'))
  for (const [i, p] of s.projects.entries()) {
    const d = copyVault(path.join('parity', String(i)))
    const r = py(['snooze', p.name, '--ready', '0', '--vault', d, '--today', TODAY])
    assert.equal(r.status === 0, p.standing === 'parked', `${p.name} (${p.standing}): exit ${r.status} ${r.stderr}`)
  }
})

// ---- 14. Usage ------------------------------------------------------------------------------------------------------------
test('14. usage: a bad verb, flag, scan or grades file is exit 2 with one line; a missing vault exit 3; empty grades are fine', () => {
  const g = MAIN_FILES[0]
  const notJson = path.join(S, 'not-json.json')
  write(notJson, 'not json\n')
  const schema2 = path.join(S, 'scan-schema-2.json')
  write(schema2, JSON.stringify({ ...scanned(), schema: 2 }))
  const number = path.join(S, 'grades-number.json')
  write(number, '42\n')
  refusal(py(['frob']))
  refusal(py([]))
  refusal(py(['rank', '--scan', SCAN_FILE, '--grades', g, '--bogus']))
  refusal(py(['rank', '--scan', notJson, '--grades', g]), /not JSON/)
  refusal(py(['rank', '--scan', schema2, '--grades', g]), /schema/)
  refusal(py(['rank', '--scan', SCAN_FILE, '--grades', notJson]), /not JSON/)
  refusal(py(['rank', '--scan', SCAN_FILE, '--grades', number]), /not an object or array/)
  refusal(py(['rank', '--scan', SCAN_FILE, '--grades', g, '--today', '2026-13-45']), /--today/)
  for (const run of [py(['rank', '--scan', SCAN_FILE, '--grades', g, '--vault', path.join(S, 'no-vault')]),
    py(['snooze', 'ParkOffer', '--ready', '0', '--vault', path.join(S, 'no-vault')])]) {
    assert.equal(run.status, 3, run.stderr)
    assert.match(run.stderr, /^estate-rank: /)
  }
  const empty = path.join(S, 'grades-empty.json')
  write(empty, '[]\n')
  const j = ok(rank([empty]))
  assert.deepEqual([j.tasks, j.runs, j.decisions, j.orient, j.unpark, j.invalid], [[], [], [], [], [], []])
  assert.equal(j.ungraded.length, gradeable(scanned()).length)
})

// ---- 15. Determinism and read-only -------------------------------------------------------------------------------------------
test('15. determinism and read-only: reruns are byte-equal, the vault is untouched, no bytecode is written', () => {
  assert.equal(rank(MAIN_FILES).stdout, main().stdout)
  assert.ok(!('PYTHONDONTWRITEBYTECODE' in env), 'the runs leave bytecode to the script')
  assert.deepEqual(snap(V), BEFORE, 'rank writes nothing in the vault')
  assert.ok(!fs.existsSync(path.join(root, 'skills', '_shared', 'scripts', '__pycache__')), 'no __pycache__ under skills/')
})

// ---- 16. Dependencies -------------------------------------------------------------------------------------------------------
test('16. dependencies: what holds a task, why, and which group of its run it sits in', () => {
  const j = ok(main())
  const dep = runOf(j, `Dep/parallel/${ROOT('dep')}`)
  const groupOf = (slug) => ['ready', 'waiting', 'blocked'].find((g) => dep[g].includes(slug))
  const H = (slug, why) => [{ slug, why }]
  const TABLE = [
    ['dep-same-b', [], 'ready'],  // a Ready dependency in the same run
    ['dep-same-a', [], 'ready'],
    ['dep-on-inflight', [], 'ready'],  // in flight: it lands without Lachy
    ['dep-on-call', H('dep-call', 'One call'), 'blocked'],
    ['dep-on-grill', H('act-grill', 'Grill'), 'blocked'],
    ['dep-on-orient', H('act-orient', 'Orient'), 'blocked'],
    ['dep-on-ungraded', H('dep-ungraded', 'ungraded'), 'blocked'],
    ['dep-on-invalid', H('dep-invalid', 'invalid'), 'blocked'],
    ['dep-on-hold', H('act-hold', 'hold'), 'blocked'],
    ['dep-on-unhomed', H('loose', 'unhomed'), 'blocked'],
    ['dep-on-landed', [], 'ready'],  // landed, or no task at all: satisfied
    ['dep-on-held', H('dep-on-call', 'held'), 'blocked'],  // transitive
    ['dep-cycle-a', H('dep-cycle-b', 'cycle'), 'blocked'],
    ['dep-cycle-b', H('dep-cycle-a', 'cycle'), 'blocked'],
    ['dep-self', H('dep-self', 'cycle'), 'blocked'],
    ['dep-on-parked', H('po-a', 'parked'), 'blocked'],  // Ready, but in another, parked project
    ['dep-alias', H('dep-call', 'One call'), 'blocked'],  // [[Work/Tasks/dep-call|the call]]
    ['dep-case', H('dep-call', 'One call'), 'blocked'],  // [[DEP-CALL]]
    ['dep-blocked-by', H('dep-call', 'One call'), 'blocked'],  // the blocked-by: key
    ['dep-call-held', H('dep-ungraded', 'ungraded'), 'blocked'],  // a held One call
    ['dep-call', [], 'waiting'],
  ]
  for (const [slug, blockedBy, group] of TABLE) {
    assert.deepEqual(row(j, slug).blockedBy, blockedBy, slug)
    assert.equal(groupOf(slug), group, slug)
  }
  assert.deepEqual(row(j, 'dep-on-landed').dependsOn, ['dep-landed', 'no-such-task'])
  assert.deepEqual(row(j, 'pdo-a').blockedBy, H('act-orient', 'Orient'))
  assert.deepEqual(row(j, 'pc-b').blockedBy, [])
  assert.deepEqual(row(j, 'act-orient').blockedBy, [], 'an Orient task carries no hold')
  // A hold never moves a rank: the held task keeps its leverage place.
  assert.ok(row(j, 'dep-on-call').rank < row(j, 'dep-call').rank, 'leverage 15 above 10, held or not')
  const whys = new Set(j.tasks.flatMap((t) => t.blockedBy.map((b) => b.why)))
  assert.deepEqual([...whys].sort(), ['Grill', 'One call', 'Orient', 'cycle', 'held', 'hold', 'invalid', 'parked', 'ungraded', 'unhomed'])
  assert.equal(j.counts.held, j.tasks.filter((t) => t.blockedBy.length).length)
})

// ---- 17. Snooze --clear -----------------------------------------------------------------------------------------------
test('17. snooze --clear: clearing the record means a project parked again is offered again', () => {
  const VC = copyVault('v-clear')
  const note = path.join(VC, 'Work', 'Projects', 'ParkOffer.md')
  const before = fs.readFileSync(note, 'utf8')
  const offerOf = (vault) => ok(rank(MAIN_FILES, ['--vault', vault])).unpark.find((x) => x.project === 'ParkOffer')
  const parkedAgain = () => fs.writeFileSync(note, fs.readFileSync(note, 'utf8').replace('status: queued', 'status: parked'))
  const unparked = () => fs.writeFileSync(note, fs.readFileSync(note, 'utf8').replace('status: parked', 'status: queued'))
  assert.equal(py(['snooze', 'ParkOffer', '--ready', '1', '--vault', VC, '--today', TODAY]).status, 0)
  assert.equal(offerOf(VC).offer, false, 'snoozed')
  // The gap the clear closes: unparked without it, then parked again inside the fortnight, the old snooze comes back
  // and hides the offer.
  unparked()
  parkedAgain()
  assert.equal(offerOf(VC).offer, false, 'a stale snooze outlives the parking it was given for')
  // A hand unpark with --clear (unpark itself makes the same removal in its own save, R1). Parked again, it is offered.
  const c = py(['snooze', 'ParkOffer', '--clear', '--vault', VC])
  assert.equal(c.status, 0, c.stderr)
  assert.equal(c.stdout, 'cleared the snooze on Work/Projects/ParkOffer.md\n')
  assert.equal(c.stderr, '')
  assert.equal(fs.readFileSync(note, 'utf8'), before, 'both keys gone, every other byte kept')
  unparked()
  parkedAgain()
  assert.deepEqual([offerOf(VC).offer, offerOf(VC).snooze], [true, null], 'offered again: no stale snooze')
  // Nothing to clear: untouched, exit 0.
  const st = fs.statSync(note).mtimeMs
  const none = py(['snooze', 'ParkOffer', '--clear', '--vault', VC])
  assert.deepEqual([none.status, none.stdout, none.stderr], [0, 'no snooze on Work/Projects/ParkOffer.md\n', ''])
  assert.equal(fs.statSync(note).mtimeMs, st)
  // Any live project, parked or not: an unparked project's stale keys go too.
  const stale = path.join(VC, 'Work', 'Projects', 'Stale.md')
  const s0 = fs.readFileSync(stale, 'utf8')
  assert.equal(py(['snooze', 'Stale', '--clear', '--vault', VC]).status, 0)
  assert.equal(fs.readFileSync(stale, 'utf8'), s0.replace('\nsnoozed_until: 2026-12-01\nsnoozed_ready: 9', ''))
  // A key given twice is removed both times; a date-only record (one key) is cleared too.
  const dup = path.join(VC, 'Work', 'Projects', 'ParkDup.md')
  write(dup, fm('tags:\n  - project\nstatus: parked\nsnoozed_until: 2026-10-01\nsnoozed_until: 2026-10-02\ncolour: blue'))
  assert.equal(py(['snooze', 'ParkDup', '--clear', '--vault', VC]).status, 0)
  assert.equal(fs.readFileSync(dup, 'utf8'), fm('tags:\n  - project\nstatus: parked\ncolour: blue'))
  const dateOnly = path.join(VC, 'Work', 'Projects', 'ParkDateOnly.md')
  assert.equal(py(['snooze', 'ParkDateOnly', '--clear', '--vault', VC]).status, 0)
  assert.ok(!fs.readFileSync(dateOnly, 'utf8').includes('snoozed_'))
  assert.deepEqual(snap(V), BEFORE, 'only the copy was written')
})

// ---- R1-R5. The Unpark offer's other writes: unpark and kill (p25-3), and a decision's fork -------------------------
const projectNote = (vault, name) => path.join(vault, 'Work', 'Projects', `${name}.md`)
const rescan = (vault) => {
  const r = spawnSync('python3', [SCAN, '--vault', vault, '--today', TODAY, '--deadline', '0'], { encoding: 'utf8', cwd: S, env, timeout: 60000 })
  assert.equal(r.status, 0, r.stderr)
  return JSON.parse(r.stdout)
}

test('R1. unpark: one save sets status queued and clears the snooze; the project leaves the parked set', () => {
  const VU = copyVault('v-unpark')
  const note = projectNote(VU, 'ParkSnoozed')
  const before = fs.readFileSync(note, 'utf8')
  const ino = fs.statSync(note).ino
  const r = py(['unpark', 'ParkSnoozed', '--vault', VU])
  assert.deepEqual([r.status, r.stdout, r.stderr], [0, 'unparked Work/Projects/ParkSnoozed.md (status: queued)\n', ''])
  assert.equal(fs.readFileSync(note, 'utf8'),
    before.replace('status: parked\nsnoozed_until: 2026-10-25\nsnoozed_ready: 2', 'status: "queued"'))
  assert.equal(fs.statSync(note).ino, ino, 'written in place')
  const p = rescan(VU).projects.find((x) => x.name === 'ParkSnoozed')
  assert.deepEqual([p.standing, p.parked], ['queued', false])
  // A parked project with no snooze: only the status line changes.
  const plain = projectNote(VU, 'ParkOffer')
  const b2 = fs.readFileSync(plain, 'utf8')
  assert.equal(py(['unpark', 'ParkOffer', '--vault', VU]).status, 0)
  assert.equal(fs.readFileSync(plain, 'utf8'), b2.replace('status: parked', 'status: "queued"'))
  assert.deepEqual(snap(V), BEFORE, 'only the copy was written')
})

test('R2. kill: Mark done in one save (done, completed, no crowned stamp, no snooze); the project leaves the scan', () => {
  const VK = copyVault('v-kill')
  write(projectNote(VK, 'ParkCrowned'), fm('tags:\n  - project\nstatus: parked\ncrowned: 2026-09-01\nsnoozed_until: 2026-10-25\nsnoozed_ready: 1\ncolour: blue'))
  const note = projectNote(VK, 'ParkCrowned')
  const r = py(['kill', 'ParkCrowned', '--vault', VK, '--today', TODAY])
  assert.deepEqual([r.status, r.stdout, r.stderr], [0, `killed Work/Projects/ParkCrowned.md (done: true, completed ${TODAY})\n`, ''])
  assert.equal(fs.readFileSync(note, 'utf8'),
    fm(`tags:\n  - project\nstatus: parked\ncolour: blue\ndone: true\ncompleted: "${TODAY}"`))
  const offer = projectNote(VK, 'ParkOffer')
  const before = fs.readFileSync(offer, 'utf8')
  assert.equal(py(['kill', 'ParkOffer', '--vault', VK, '--today', TODAY]).status, 0)
  assert.equal(fs.readFileSync(offer, 'utf8'), before.replace('status: parked\n---', `status: parked\ndone: true\ncompleted: "${TODAY}"\n---`))
  const names = rescan(VK).projects.map((x) => x.name)
  for (const n of ['ParkOffer', 'ParkCrowned']) assert.ok(!names.includes(n), `${n} is done: out of the scan`)
  // An umbrella whose only sub-project is done, or archived, is killed like any other.
  write(path.join(VK, 'Work', 'Projects', 'Umb2', 'Umb2.md'), fm('tags:\n  - project\nstatus: parked'))
  write(path.join(VK, 'Work', 'Projects', 'Umb2', 'Old.md'), fm('tags:\n  - project\nstatus: active\ndone: true'))
  write(path.join(VK, 'Work', 'Projects', 'Umb2', 'Archive', 'Gone.md'), fm('tags:\n  - project\nstatus: active'))
  assert.equal(py(['kill', 'Umb2', '--vault', VK, '--today', TODAY]).status, 0)
  assert.deepEqual(snap(V), BEFORE, 'only the copy was written')
})

test('R3. unpark and kill refuse anything but a parked live project, an umbrella with a live sub-project, and a key held twice', () => {
  const VR = copyVault('v-unpark-refuse')
  write(path.join(VR, 'Work', 'Projects', 'Umb', 'Umb.md'), fm('tags:\n  - project\nstatus: parked'))
  write(path.join(VR, 'Work', 'Projects', 'Umb', 'Sub.md'), fm('tags:\n  - project\nstatus: active'))
  write(projectNote(VR, 'ParkTwice'), fm('tags:\n  - project\nstatus: parked\nstatus: parked\ndone: false\ndone: false'))
  const held = bytes(VR)
  for (const verb of ['unpark', 'kill']) {
    const cases = [
      ['Act', /Work\/Projects\/Act\.md is not parked \(standing: active\)/],
      ['DoneProj', /done/],
      ['Area', /area note/],
      ['Nope', /no note/],
      ['ParkTwice', /more than once/],
    ]
    for (const [name, re] of cases) refusal(py([verb, name, '--vault', VR, ...(verb === 'kill' ? ['--today', TODAY] : [])]), re)
  }
  refusal(py(['kill', 'Umb', '--vault', VR, '--today', TODAY]), /umbrella with 1 live sub-project \(Work\/Projects\/Umb\/Sub\.md\)/)
  refusal(py(['unpark', 'ParkOffer', '--today', TODAY, '--vault', VR]), /unrecognized arguments: --today/)
  refusal(py(['kill', 'ParkOffer', '--ready', '1', '--vault', VR]))
  assert.deepEqual(bytes(VR), held, 'nothing written')
})

test('R4. unpark and kill agree with the scan on what is parked', () => {
  const s = scanned()
  for (const [i, p] of s.projects.entries()) {
    for (const verb of ['unpark', 'kill']) {
      const d = copyVault(path.join(`parity-${verb}`, String(i)))
      const r = py([verb, p.name, '--vault', d, ...(verb === 'kill' ? ['--today', TODAY] : [])])
      assert.equal(r.status === 0, p.standing === 'parked', `${verb} ${p.name} (${p.standing}): exit ${r.status} ${r.stderr}`)
    }
  }
})

test('R5. a decision fork passes through the ranker when given, and nothing changes when it is not', () => {
  assert.ok(!main().stdout.includes('"fork"'), 'no fork key without one in the grades')
  const forked = (fork) => gradesFile(`fork-${fork === '' ? 'empty' : 'set'}`, { project: 'Lab', tasks: [G('lab-01', 'One call', 'serial',
    { decisions: [{ ...D('Keep v3 or v4?', 'v4', ['v4', 'v3']), fork }] })] })
  const t = row(ok(rank([forked('Keep v3 or v4')])), 'lab-01')
  assert.deepEqual(t.decisions[0], { question: 'Keep v3 or v4?', recommendation: 'v4', options: ['v4', 'v3'], confidence: 'high',
    why: 'fixture: src/x.py:12', fork: 'Keep v3 or v4' })
  assert.ok(!('fork' in row(ok(rank([forked('')])), 'lab-01').decisions[0]), 'an empty fork is left out')
})

// ---- R6. A carried task still queued is gradeable at schedule's Pre-flight (ADR 0047) -----------------------------
// Its own vault VP: project Pf and a live, never-started prior rollout `prior`. q is open and linked to it (carried,
// still queued), s is in_progress and linked to it (carried, started), r-on-q is Ready work that depends on q.
// Without --superseding q is in flight, skipped, and its grade warned and ignored, so nothing waits on it; with
// `--superseding prior` (schedule § 1.5) q is graded, and r-on-q is held by q's grade; s stays in flight either way.
test('R6. rank --superseding: a carried queued task is graded and holds its dependants; a started one stays in flight', () => {
  const VP = path.join(S, 'pf')
  const TP = (slug, status, rest = '') => write(path.join(VP, 'Work', 'Tasks', `${slug}.md`),
    fm(`tags:\n  - task\nstatus: ${status}\nprojects:\n  - "[[Pf]]"${rest}`, `\n# Task ${slug}\n`))
  write(path.join(VP, 'Work', 'Projects', 'Pf.md'), fm('tags:\n  - project\nstatus: active'))
  write(path.join(VP, 'Work', 'Tasks', 'prior.md'), fm('tags:\n  - rollout\nstatus: open\nprotocol_version: 5\nprojects:\n  - "[[Pf]]"'))
  TP('q', 'open', '\nrollout: "[[prior]]"')
  TP('s', 'in_progress', '\nrollout: "[[prior]]"')
  TP('r-on-q', 'open', links('depends-on', ['q']))
  const sc = spawnSync('python3', [SCAN, '--vault', VP, '--today', TODAY, '--deadline', '0'], { encoding: 'utf8', cwd: S, env, timeout: 60000 })
  assert.equal(sc.status, 0, sc.stderr)
  const scanFile = path.join(S, 'scan-pf.json')
  write(scanFile, sc.stdout)
  assert.deepEqual(JSON.parse(sc.stdout).tasks.filter((t) => t.slug !== 'r-on-q').map((t) => [t.slug, t.inFlight]), [['q', true], ['s', true]],
    'the scan leaves both carried tasks in flight: the exception is the ranker\'s, at the Pre-flight only')
  const grades = gradesFile('pf', { project: 'Pf', tasks: [G('q', 'One call', 'parallel', { decisions: one() }), G('s', 'Ready', 'parallel'),
    G('r-on-q', 'Ready', 'parallel')] })
  const pf = (more = []) => ok(py(['rank', '--scan', scanFile, '--today', TODAY, '--grades', grades, ...more]))
  const plain = pf()
  assert.deepEqual(plain.skipped, [{ slug: 'q', why: 'in flight' }, { slug: 's', why: 'in flight' }])
  assert.ok(plain.warnings.some((w) => /^grade for q .*the task is in flight, never graded; ignored$/.test(w)), plain.warnings.join('\n'))
  assert.deepEqual(row(plain, 'r-on-q').blockedBy, [], 'an in-flight dependency holds nothing')
  assert.ok(!plain.tasks.some((t) => t.slug === 'q'))
  for (const sup of ['prior', '[[prior]]', path.join(VP, 'Work', 'Tasks', 'prior.md')]) {
    const j = pf(['--superseding', sup])
    assert.deepEqual(j.skipped, [{ slug: 's', why: 'in flight' }], sup)
    assert.equal(row(j, 'q').grade, 'One call', sup)
    assert.deepEqual(row(j, 'r-on-q').blockedBy, [{ slug: 'q', why: 'One call' }], `${sup}: held by q's grade`)
    assert.ok(j.warnings.some((w) => /^grade for s .*the task is in flight, never graded; ignored$/.test(w)), j.warnings.join('\n'))
    assert.equal(j.counts.gradeable, 2)
  }
  // Another rollout's name leaves q in flight.
  assert.deepEqual(pf(['--superseding', 'other-rollout']).skipped, plain.skipped)
})
