// The shared fixtures of skills/reflect/scripts/reflect.py's weekly-reading suite (p49-3), one suite in four files
// so node's files at a time and the full suite's shards spread it: tests/reflect-weekly.test.mjs (span and
// window_flags), tests/reflect-weekly-watch.test.mjs (watch, raised and the Watch reader, declines, the suite
// readings, bug, knobs and knobs end to end), tests/reflect-weekly-decide.test.mjs (decide, close and held trades)
// and tests/reflect-weekly-verify.test.mjs (moot, rung, the Verify week, and span over a serial chain). Each part
// imports from here what more than one part uses, and every engine-script bind with the spawner that runs it and the
// env it passes, so tests/contracts/run-record-hermetic.test.mjs reads them together.
//
// Hermetic: each case gets its own mkdtemp HOME, THREAD_EVENTS_DIR and tasks dir (with Archive/2026/ and
// Archive/Rollouts/), TZ pinned to Melbourne, an env built from scratch that every spawn passes, and temp git repos
// whose origin is https://github.com/o/r.git (land.sh reads it locally, no network). Record lines go through
// run_record.emit in one python process per fixture. The writers' cases build span.json by hand (span's output
// shape), so they never wait on score.py; span's own cases and the Verify week run the real span.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync, execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
export const REFLECT = path.join(root, 'skills', 'reflect', 'scripts', 'reflect.py')
const RUN_RECORD = path.join(root, 'skills', '_shared', 'scripts', 'run_record.py')
export const REAL_GIT = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim()

// ---- helpers ----------------------------------------------------------------------------------------------

export function setup(t, { origin = 'https://github.com/o/r.git' } = {}) {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'reflect-weekly-')))
  t.after(() => fs.rmSync(home, { recursive: true, force: true }))
  const tasks = path.join(home, 'Tasks')
  for (const d of ['Archive/2026', 'Archive/Rollouts']) fs.mkdirSync(path.join(tasks, d), { recursive: true })
  fs.mkdirSync(path.join(home, 'events'), { recursive: true })
  fs.mkdirSync(path.join(home, 'out'), { recursive: true })
  const h = { home, tasks, ev: path.join(home, 'events'), out: path.join(home, 'out'), repo: path.join(home, 'repo') }
  fs.mkdirSync(h.repo)
  git(h, ['init', '-q', '-b', 'main'])
  if (origin) git(h, ['remote', 'add', 'origin', origin])
  return h
}

export const env = (h, extra = {}) => ({ PATH: process.env.PATH, HOME: h.home, PYTHONDONTWRITEBYTECODE: '1', TZ: 'Australia/Melbourne',
  THREAD_EVENTS_DIR: h.ev, GIT_CONFIG_GLOBAL: path.join(h.home, 'gitconfig'), ...extra })
export const git = (h, args, repo = h.repo) => execFileSync(REAL_GIT, ['-C', repo, ...args], { encoding: 'utf8',
  env: { PATH: process.env.PATH, HOME: h.home, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x', ...(h.gitEnv || {}) } }).trim()

export function reflect(h, args, extra = {}) {
  const r = spawnSync('python3', ['-B', REFLECT, ...args], { encoding: 'utf8', cwd: h.home, env: env(h, extra) })
  return { status: r.status, stdout: r.stdout, stderr: r.stderr }
}
export function ok(h, args, extra) {
  const r = reflect(h, args, extra)
  assert.equal(r.status, 0, `${args[0]}: ${r.stderr}`)
  return r
}

export const reflectionsFile = (h) => path.join(h.ev, 'reflections.jsonl')
export const tuningsFile = (h) => path.join(h.ev, 'tunings.jsonl')
export const parse = (l) => { try { return JSON.parse(l) } catch { return null } } // a torn line reads as nothing
export const rlines = (h) => (fs.existsSync(reflectionsFile(h)) ? fs.readFileSync(reflectionsFile(h), 'utf8').split('\n').map(parse).filter(Boolean) : [])
export const bytes = (f) => (fs.existsSync(f) ? fs.readFileSync(f) : null)
export const sha = (f) => (fs.existsSync(f) ? crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex') : 'absent')
export const listing = (d) => (fs.existsSync(d) ? fs.readdirSync(d, { recursive: true }).map(String).sort() : [])

// Every event through run_record.emit(strict=True): [ts, kind, task, fields, rollout?].
export function emitAll(h, rollout, events) {
  const body = ['import importlib.util, json, sys', 'spec = importlib.util.spec_from_file_location("run_record", sys.argv[1])',
    'm = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)',
    'for ts, kind, task, fields, r in json.load(sys.stdin):', '    assert m.emit(r, kind, task, fields, ts=ts, strict=True), (kind, task, ts)'].join('\n')
  const rows = events.map(([ts, kind, task = null, fields = {}, r = rollout]) => [ts, kind, task, fields, r])
  const r = spawnSync('python3', ['-B', '-c', body, RUN_RECORD], { encoding: 'utf8', cwd: h.home, env: env(h), input: JSON.stringify(rows) })
  assert.equal(r.status, 0, r.stderr)
}

// run_record's own ids, so a test never restates a hash
export function ids(h, calls) {
  const body = ['import importlib.util, json, sys', 'spec = importlib.util.spec_from_file_location("rr", sys.argv[1])',
    'm = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)',
    'print(json.dumps([m.watch_id(*c[1:]) if c[0] == "w" else m.knob_key(*c[1:]) for c in json.load(sys.stdin)]))'].join('\n')
  const r = spawnSync('python3', ['-B', '-c', body, RUN_RECORD], { encoding: 'utf8', env: env(h), input: JSON.stringify(calls) })
  assert.equal(r.status, 0, r.stderr)
  return JSON.parse(r.stdout)
}

// A rollout note under Tasks (or Archive/Rollouts), with its Project root and a ## Notes section.
export function rolloutNote(h, slug, { status = 'in_progress', archived = false, notes = [], root = h.repo, extra = '' } = {}) {
  const dir = archived ? path.join(h.tasks, 'Archive', 'Rollouts') : h.tasks
  const p = path.join(dir, `${slug}.md`)
  fs.writeFileSync(p, ['---', 'tags: [rollout]', `status: ${status}`, 'protocol_version: 5', '---', '', `# ${slug}`, '',
    root ? `Project root: \`${root}\`` : '', '', '## Notes', '', ...notes, '', extra].join('\n'))
  return p
}

export function taskNote(h, slug, { status = 'open', tags = '[task, ai]', captured = '2026-09-01', body = '', fm = [], archived = false } = {}) {
  const p = path.join(archived ? path.join(h.tasks, 'Archive', '2026') : h.tasks, `${slug}.md`)
  fs.writeFileSync(p, ['---', `tags: ${tags}`, `status: ${status}`, `captured: ${captured}`, ...fm, '---', '', `# ${slug}`, '', body, ''].join('\n'))
  return p
}

// One task's life: a Slot from..to, ready, then a lane holding and its merge.
export function life(slug, from, to, { lane = null, c = 2, pr = 7, merged = true } = {}) {
  const out = [[from, 'slot-taken', slug, { settings: { parallel_ceiling: c, max_review_rounds: 4, max_iterations: 3, max_plan_rounds: 3 }, start: 'start' }],
    [to, 'slot-freed', slug, { outcome: 'ready' }], [to, 'ready', slug, { pr }]]
  if (lane) {
    out.push([lane[0], 'lane-taken', slug, {}], [lane[1], 'lane-freed', slug, { release: 'merge', path: 'lead', triggers: [], conflict: false }])
    if (merged) out.push([lane[1], 'merged', slug, { pr }])
  }
  return out
}
export const byTs = (ev) => [...ev].sort((a, b) => Date.parse(a[0]) - Date.parse(b[0]))

// The default window for span's own cases: a past week, never clamped.
export const SINCE = '2026-09-03T00:00+10:00'
export const UNTIL = '2026-09-10T00:00+10:00'
export const W = (d, hm) => `2026-09-0${d}T${hm}:00Z` // a UTC stamp inside the window for d in 3..9

export function span(h, extra = [], { since = SINCE, until = UNTIL } = {}) {
  const out = path.join(h.out, 'span.json')
  const args = ['span', '--tasks-dir', h.tasks, '--config', path.join(h.home, 'rollouts.toml'), '--out', out, ...extra]
  if (since) args.push('--since', since)
  if (until) args.push('--until', until)
  const r = ok(h, args)
  assert.match(r.stderr, /^reflect: span r-\d{8}T\d{6}Z-[0-9a-f]{6} /, 'one summary line')
  const s = JSON.parse(fs.readFileSync(out, 'utf8'))
  // the window check (reflect.py's header): a `window: ` flag is a reader that read past its window, in any reading
  assert.ok(!s.flags.some((f) => f.startsWith('window: ')), JSON.stringify(s.flags))
  return s
}
export const entryOf = (s, slug) => s.rollouts.find((r) => r.rollout === slug)

// A span.json written by hand in span's shape (the writers read reflection, since, until and rollouts only, plus
// knobs for `knobs`).
let spanN = 0
export function fakeSpan(h, rid, rollouts, { since = '2026-09-03T14:00:00.000Z', until = '2026-09-10T14:00:00.000Z', knobs = { revert: [], land: [], held: [] }, entries = {}, grades } = {}) {
  const p = path.join(h.out, `span-${++spanN}.json`)
  fs.writeFileSync(p, JSON.stringify({ reflection: rid, since, until, previous: null, knobs,
    rollouts: rollouts.map((r) => ({ rollout: r, mode: 'read', repo: 'o/r', breached: [], breachCounts: false, proposals: [], friction: [], ...(entries[r] || {}) })),
    ...(grades ? { grades } : {}) }))
  return p
}
export const RID = (n) => `r-2026090${n}T000000Z-00000${n}`

// The writers' own wording (p22-7): tune.py's auto_check gives a held trade's reason, gated_inputs.annotation() the
// standing approval's `## Approved gates` suffix, so a change in either fails these fixtures.
export function pyOut(h, body, input) {
  const r = spawnSync('python3', ['-B', '-c', ['import importlib.util, json, sys',
    'spec = importlib.util.spec_from_file_location("m", sys.argv[1])', 'm = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)',
    'a = json.load(sys.stdin)', body].join('\n'), input[0]], { encoding: 'utf8', cwd: h.home, env: env(h), input: JSON.stringify(input[1]) })
  assert.equal(r.status, 0, r.stderr)
  return JSON.parse(r.stdout)
}
const TUNE_PY = path.join(root, 'skills', 'reflect', 'scripts', 'tune.py')
export const heldReason = (h, proposal) => pyOut(h, 'print(json.dumps(m.auto_check({}, a, None, [], [])[1]))', [TUNE_PY, proposal])

// ---- watch, raised and the Watch reader -----------------------------------------------------------------------------

export const RULE = 'orient § 5 grill'
export const SHAPE = 'a design fork asked mid-run'
export const watchArgs = (sp, rollouts, { rule = RULE, shape = SHAPE, count = rollouts.length } = {}) =>
  ['watch', '--span', sp, ...rollouts.flatMap((r) => ['--rollout', r]), '--rule', rule, '--shape', shape, '--count', String(count)]

// ---- bug ---------------------------------------------------------------------------------------------------------------

export const bugArgs = (h, sp, { slug = 'grill-misses-gates', rollouts = ['a', 'b'], fixes, rule = RULE, shape = SHAPE } = {}) =>
  ['bug', '--span', sp, '--rule', rule, '--shape', shape, '--slug', slug, '--title', 'Thread Skill: the grill misses gates',
    '--why', 'Two rollouts asked mid-run what the grill should have.', ...rollouts.flatMap((r) => ['--rollout', r]),
    '--tasks-dir', h.tasks, ...(fixes ? ['--fixes', fixes] : [])]

// ---- knobs end to end: a real span's land[], held[] and revert[] ------------------------------------------------------------

const TUNE = path.join(root, 'skills', 'reflect', 'scripts', 'tune.py')
export const KSINCE = '2026-10-09T00:00+11:00'
export const KUNTIL = '2026-10-15T12:00+11:00'

// c tasks all in their Slots from 00:00 on 2026-10-<day>, at ceiling c: Slot-bound, so score.py proposes a ceiling raise.
export function saturated(prefix, day, c) {
  const V = (hm) => `2026-10-${day}T${hm}:00Z`
  const out = []
  for (let i = 0; i < c; i++) out.push(...life(`${prefix}${i + 1}`, V('00:00'), V(`04:${i}0`), { c, lane: [V(`04:${i}0`), V(`04:${i}5`)] }))
  return byTs(out)
}

export function tune(h, args) {
  return spawnSync('python3', ['-B', TUNE, ...args], { encoding: 'utf8', cwd: h.home, env: env(h) })
}

// ---- held trades (p22-7, ADR 0037 d1 and d5) ---------------------------------------------------------------------------------

export const TRADE_KEY = ['k', 'o/r', 'max_plan_rounds', 'plan-rejected-raise', 1]
export const TRADE_LEAD = 'Trades for Lachy (ADR 0037 d1: a knob that trades one headline against the other, or a caution, is his call; a yes runs the by-hand Reflection, a no is recorded when this task is done):'
export const tradeProp = (kid, over = {}) => ({ key: 'max_plan_rounds', rule: 'plan-rejected-raise', direction: 1, from: 3, to: 4, ranAt: 3, knob_key: kid,
  evidence: 'e1', trade: { gains: ['handsOffRate'], costs: ['quality'] }, caution: null, ...over })
// A span whose one read rollout proposes `prop`, held in knobs with `reason`.
export function tradeSpan(h, rid, kid, { prop, reason, until, rollout = 'b', rollouts = [rollout], entries = {} }) {
  return fakeSpan(h, rid, rollouts, { until, entries: { [rollout]: { window: { activeEnd: '2026-09-07T00:00:00.000Z' }, proposals: [prop] }, ...entries },
    knobs: { revert: [], land: [], held: [{ id: kid, rollout, reason }] } })
}
export const tradeItem = (kid, reason, { from = 3, to = 4, rollout = 'b', caution = '' } = {}) =>
  `- trade ${kid} at ${from}: max_plan_rounds ${from} -> ${to} (plan-rejected-raise); ${reason}${caution ? `; caution ${caution}` : ''}; evidence e1; repo o/r; rollouts [[${rollout}]]; a yes runs /thread:reflect [[${rollout}]] and picks max_plan_rounds (plan-rejected-raise)`
export const setStatus = (p, status) => fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace(/\nstatus: \w+\n/, `\nstatus: ${status}\n`))
