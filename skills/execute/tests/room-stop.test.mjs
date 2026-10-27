// A Chorus room stop, the lead's side (execute § Room stop; Chorus ADR 0071; p18-1): skills/execute/scripts/
// step-boundary.py, executed. When the Stage says a Login is at its line, or would reach it (a spread,
// Chorus ADR 0109), the lead stops each Workflow call the moment its running agent's result is in the run's journal,
// records the stop on the rollout note's `## Pause log`, and resumes every stopped call on the Stage's re-send.
// tests/contracts/execute-room-stop.test.mjs pins the prose.
//
// (a)  the journal model: open keys, the running agent, a stale key, labels, a torn line, a missing journal, usage;
// (a2) the gap re-mark: a relaunch after a gap marks afresh, so a watch never stops an agent that started later;
// (b)  the note verbs begin / end / stands;
// (c)  the task note's Verify, a fake two-call run on the real engine (tests/lib/engine.mjs): at the signal both
//      calls stop just after a result line, the resume replays every result, and no agent re-runs past its start.
//
// Hermetic: every journal, note and state file lives under one mkdtemp root, removed by its variable; each python3
// spawn passes THREAD_EVENTS_DIR and drops the session's own CLAUDE_CODE_SESSION_ID / CLAUDE_CONFIG_DIR.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { runTask, VERIFY_SLOT } from '../../../tests/lib/engine.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const SCRIPTS = path.join(here, '..', 'scripts')
const SB = path.join(SCRIPTS, 'step-boundary.py')
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'room-stop-'))
after(() => fs.rmSync(tmpRoot, { recursive: true, force: true }))
const EVENTS = process.env.THREAD_TEST_EVENTS_DIR || path.join(tmpRoot, 'events')

const baseEnv = (over = {}) => {
  const env = { ...process.env, THREAD_EVENTS_DIR: EVENTS, PYTHONDONTWRITEBYTECODE: '1', TZ: 'UTC', ...over }
  for (const k of ['CLAUDE_CODE_SESSION_ID', 'CLAUDE_CONFIG_DIR']) if (!(k in over)) delete env[k]
  return env
}
// sb(args, { input, env, script }) → { rc, out, err }
function sb(args, { input = '', env = {}, script = SB } = {}) {
  const r = spawnSync('python3', [script, ...args], { input, encoding: 'utf8', env: baseEnv(env) })
  return { rc: r.status, out: r.stdout, err: r.stderr }
}
let seq = 0
const mk = (name) => {
  const d = path.join(tmpRoot, `${name}-${++seq}`)
  fs.mkdirSync(d, { recursive: true })
  return d
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function until(cond, what) {
  for (let i = 0; i < 2000; i++) {
    if (cond()) return
    await sleep(5)
  }
  throw new Error(`timed out waiting for ${what}`)
}

// ---- journals ----------------------------------------------------------------------------------------------------
const K = (c) => 'v2:' + c.repeat(64)
const st = (k, label, agentId = 'a1') => ({ type: 'started', key: k, agentId, ...(label ? { label, phase: 'Implement' } : {}) })
const res = (k) => ({ type: 'result', key: k, agentId: 'a1', result: { ok: true } })
const failed = (k) => ({ type: 'failed', key: k, agentId: 'a1' })
const jpath = (root, run) => path.join(root, run, 'journal.jsonl')
function journal(root, run, lines, torn = '') {
  fs.mkdirSync(path.join(root, run), { recursive: true })
  fs.writeFileSync(jpath(root, run), lines.map((l) => JSON.stringify(l) + '\n').join('') + torn)
}
const add = (root, run, ...lines) => fs.appendFileSync(jpath(root, run), lines.map((l) => JSON.stringify(l) + '\n').join(''))
const mark = (root, runs, out) => sb(['mark', '--out', out, ...runs.flatMap((r) => ['--run', r]), '--journals-root', root])
const watch = (state, timeout = '0.3') => sb(['watch', '--state', state, '--interval', '0.05', '--timeout', timeout])
const readState = (p) => JSON.parse(fs.readFileSync(p, 'utf8'))

// ---- (a) the journal model -----------------------------------------------------------------------------------------

test('(a) mid-step, then a result line: a boundary after the running label', () => {
  const d = mk('a'); const s = path.join(d, 'state.json')
  journal(d, 'wf_r1', [{ type: 'launched' }, st(K('1'), 'implement:x@opus-high')])
  const m = mark(d, ['wf_r1'], s)
  assert.equal(m.rc, 0, m.err)
  assert.equal(m.out, 'wf_r1: mid-step implement:x@opus-high\n')
  const w0 = watch(s)
  assert.equal(w0.rc, 3, w0.err)
  assert.equal(w0.out, 'mid-step wf_r1 implement:x@opus-high\n')
  add(d, 'wf_r1', res(K('1')), st(K('2'), 'review:x r1@opus-high'))
  const w1 = watch(s)
  assert.equal(w1.rc, 0, w1.err)
  assert.equal(w1.out, 'boundary wf_r1 after implement:x@opus-high\nall at a boundary\n')
  assert.deepEqual(Object.keys(readState(s)).sort(), ['markedAt', 'runs', 'v'])
  const r = readState(s).runs.wf_r1
  assert.deepEqual([r.running, r.label, r.reported, r.unwatched, r.missing], [K('1'), 'implement:x@opus-high', true, false, false])
})

test('(a) a failed line is a boundary too (it cuts the in-run retry)', () => {
  const d = mk('a'); const s = path.join(d, 'state.json')
  journal(d, 'wf_r2', [st(K('1'), 'implement:x@opus-high')])
  mark(d, ['wf_r2'], s)
  add(d, 'wf_r2', failed(K('1')))
  const w0 = watch(s)
  assert.deepEqual([w0.rc, w0.out], [0, 'boundary wf_r2 after implement:x@opus-high\nall at a boundary\n'])
  const d2 = mk('a'); const s2 = path.join(d2, 'state.json')
  journal(d2, 'wf_r2', [st(K('1'), 'implement:x@opus-high')])
  mark(d2, ['wf_r2'], s2)
  add(d2, 'wf_r2', failed(K('1')), st(K('1'), 'implement:x@opus-high', 'a2'))
  const w = watch(s2)
  assert.equal(w.rc, 0, w.err)
  assert.equal(w.out, 'boundary wf_r2 after implement:x@opus-high\nall at a boundary\n')
})

test('(a) started K, failed K, started K is mid-step', () => {
  const d = mk('a'); const s = path.join(d, 'state.json')
  journal(d, 'wf_r3', [st(K('1'), 'implement:x@opus-high'), failed(K('1')), st(K('1'), 'implement:x@opus-high', 'a2')])
  assert.equal(mark(d, ['wf_r3'], s).out, 'wf_r3: mid-step implement:x@opus-high\n')
  assert.equal(watch(s).rc, 3)
  add(d, 'wf_r3', res(K('1')))
  assert.equal(watch(s).out, 'boundary wf_r3 after implement:x@opus-high\nall at a boundary\n')
})

test('(a) a key re-started under a new agentId stays mid-step until its result', () => {
  const d = mk('a'); const s = path.join(d, 'state.json')
  journal(d, 'wf_r4', [st(K('1'), 'implement:x@opus-high', 'a1'), st(K('1'), 'implement:x@opus-xhigh', 'a2')])
  assert.equal(mark(d, ['wf_r4'], s).out, 'wf_r4: mid-step implement:x@opus-xhigh\n')
  add(d, 'wf_r4', st(K('1'), 'implement:x@opus-xhigh', 'a3'))
  const w0 = watch(s)
  assert.equal(w0.rc, 3)
  assert.equal(w0.out, 'mid-step wf_r4 implement:x@opus-xhigh\n')
  add(d, 'wf_r4', res(K('1')))
  assert.equal(watch(s).out, 'boundary wf_r4 after implement:x@opus-xhigh\nall at a boundary\n')
})

test('(a) started, result, started is mid-step on the second start; then a boundary', () => {
  const d = mk('a'); const s = path.join(d, 'state.json')
  journal(d, 'wf_r5', [st(K('1'), 'implement:x@opus-high'), res(K('1')), st(K('1'), 'implement:x@opus-high', 'a2')])
  assert.equal(mark(d, ['wf_r5'], s).out, 'wf_r5: mid-step implement:x@opus-high\n')
  assert.equal(watch(s).rc, 3)
  add(d, 'wf_r5', res(K('1')))
  assert.equal(watch(s).rc, 0)
})

test('(a) started, result, started, result is a boundary at once', () => {
  const d = mk('a'); const s = path.join(d, 'state.json')
  journal(d, 'wf_r6', [st(K('1'), 'L'), res(K('1')), st(K('1'), 'L', 'a2'), res(K('1'))])
  assert.equal(mark(d, ['wf_r6'], s).out, 'wf_r6: at a boundary\n')
  assert.equal(watch(s).out, 'boundary wf_r6 (nothing running at the mark)\nall at a boundary\n')
})

test('(a) a stale open key is never waited on: the boundary is the running key', () => {
  const d = mk('a'); const s = path.join(d, 'state.json')
  journal(d, 'wf_r7', [st(K('0'), 'plan:x@opus-high'), st(K('1'), 'implement:x@opus-high')])
  assert.equal(mark(d, ['wf_r7'], s).out, 'wf_r7: mid-step implement:x@opus-high\n')
  assert.deepEqual(readState(s).runs.wf_r7.stale, [K('0')])
  add(d, 'wf_r7', res(K('0')))
  assert.equal(watch(s).rc, 3, 'a stale key\'s result is not the boundary')
  add(d, 'wf_r7', res(K('1')))
  assert.equal(watch(s).out, 'boundary wf_r7 after implement:x@opus-high\nall at a boundary\n')
})

test('(a) nothing running at the mark is a boundary at once', () => {
  const d = mk('a'); const s = path.join(d, 'state.json')
  journal(d, 'wf_r8', [{ type: 'launched' }])
  assert.equal(mark(d, ['wf_r8'], s).out, 'wf_r8: at a boundary\n')
  const w = watch(s)
  assert.deepEqual([w.rc, w.out], [0, 'boundary wf_r8 (nothing running at the mark)\nall at a boundary\n'])
})

test('(a) a torn trailing line is left for the next read', () => {
  const d = mk('a'); const s = path.join(d, 'state.json')
  const whole = JSON.stringify(res(K('1')))
  journal(d, 'wf_r9', [st(K('1'), 'implement:x@opus-high')], whole.slice(0, 20))
  const size = fs.statSync(jpath(d, 'wf_r9')).size
  assert.equal(mark(d, ['wf_r9'], s).out, 'wf_r9: mid-step implement:x@opus-high\n')
  assert.equal(readState(s).runs.wf_r9.offset, size - 20, 'the offset stops before the torn line')
  assert.equal(watch(s).rc, 3, 'a torn result is not read yet')
  fs.appendFileSync(jpath(d, 'wf_r9'), whole.slice(20) + '\n')
  assert.equal(watch(s).out, 'boundary wf_r9 after implement:x@opus-high\nall at a boundary\n')
})

test('(a) label fallbacks: the latest label the key carried, else the short key', () => {
  const d = mk('a'); const s = path.join(d, 'state.json')
  journal(d, 'wf_l1', [st(K('1'), 'implement:x@opus-high'), st(K('1'), '', 'a2')])
  journal(d, 'wf_l2', [st(K('a'))])
  const m = mark(d, ['wf_l1', 'wf_l2'], s)
  assert.equal(m.out, `wf_l1: mid-step implement:x@opus-high\nwf_l2: mid-step key v2:${'a'.repeat(12)}\n`)
})

test('(a) a missing journal is WARNed at the mark and unwatched at the first poll; the watch never loops', () => {
  const d = mk('a'); const s = path.join(d, 'state.json')
  journal(d, 'wf_have', [st(K('1'), 'implement:x@opus-high')])
  const m = mark(d, ['wf_have', 'wf_gone'], s)
  assert.equal(m.rc, 0)
  assert.equal(m.out, `wf_have: mid-step implement:x@opus-high\nWARN: wf_gone: no journal at ${jpath(d, 'wf_gone')}\n`)
  const w1 = watch(s)
  assert.deepEqual([w1.rc, w1.out], [0, 'unwatched wf_gone\n'])
  add(d, 'wf_have', res(K('1')))
  const w2 = watch(s)
  assert.deepEqual([w2.rc, w2.out], [0, 'boundary wf_have after implement:x@opus-high\nall reported; unwatched: wf_gone\n'])
  assert.ok(!w2.out.includes('all at a boundary'))
  const w3 = watch(s)
  assert.deepEqual([w3.rc, w3.out], [0, 'all reported; unwatched: wf_gone\n'], 'a relaunch with every run reported exits at once')
})

test('(a) a second watch skips the runs already reported', () => {
  const d = mk('a'); const s = path.join(d, 'state.json')
  journal(d, 'wf_done', [{ type: 'launched' }])
  journal(d, 'wf_busy', [st(K('1'), 'implement:y@opus-high')])
  mark(d, ['wf_done', 'wf_busy'], s)
  const w1 = watch(s)
  assert.deepEqual([w1.rc, w1.out], [0, 'boundary wf_done (nothing running at the mark)\n'])
  const w2 = watch(s)
  assert.deepEqual([w2.rc, w2.out], [3, 'mid-step wf_busy implement:y@opus-high\n'])
})

test('(a) usage and a missing root', () => {
  const d = mk('a'); const s = path.join(d, 'state.json')
  journal(d, 'wf_ok', [{ type: 'launched' }])
  assert.equal(mark(d, ['bad-id'], s).rc, 2, 'not a runId')
  assert.equal(mark(d, ['wf_a..b'], s).rc, 2, 'a runId with ..')
  assert.equal(sb(['mark', '--out', s, '--journals-root', d]).rc, 2, 'mark with no --run')
  assert.equal(sb(['mark', '--out', s, '--run', 'wf_ok', '--journals-root', 'rel/dir']).rc, 2, 'a relative root')
  assert.equal(sb(['watch', '--state', s, '--interval', '0']).rc, 2, 'a zero interval')
  assert.ok(!fs.existsSync(s), 'no state written on a usage error')
  const nr = sb(['mark', '--out', s, '--run', 'wf_ok'])
  assert.equal(nr.rc, 1, 'no session id: no root')
  assert.match(nr.err, /no journals root/)
  assert.equal(sb(['mark', '--out', s, '--run', 'wf_ok', '--journals-root', path.join(d, 'nope')]).rc, 1, 'a root that is not a dir')
  assert.equal(sb(['watch', '--state', path.join(d, 'nope.json')]).rc, 1, 'an unreadable state')
  fs.writeFileSync(path.join(d, 'bad.json'), '{"runs": []}')
  assert.equal(sb(['watch', '--state', path.join(d, 'bad.json')]).rc, 1, 'not a mark state')
})

test("(a) the root's leaf is <sid>/subagents/workflows, not _journal_dir's <sid>/workflows", () => {
  const cfg = mk('cfg'); const sid = 'sess-1234'
  const proj = path.join(cfg, 'projects', '-repo')
  fs.mkdirSync(proj, { recursive: true })
  fs.writeFileSync(path.join(proj, `${sid}.jsonl`), '')
  const sub = path.join(proj, sid, 'subagents', 'workflows')
  const runfiles = path.join(proj, sid, 'workflows')
  journal(sub, 'wf_here', [st(K('1'), 'implement:x@opus-high')])
  journal(runfiles, 'wf_there', [st(K('2'), 'implement:y@opus-high')])
  const s = path.join(cfg, 'state.json')
  const r = sb(['mark', '--out', s, '--run', 'wf_here', '--run', 'wf_there'], { env: { CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_SESSION_ID: sid } })
  assert.equal(r.rc, 0, r.err)
  assert.equal(r.out, `wf_here: mid-step implement:x@opus-high\nWARN: wf_there: no journal at ${jpath(sub, 'wf_there')}\n`)
})

// ---- (a2) the gap re-mark ----------------------------------------------------------------------------------------

test('(a2) a relaunch after a gap re-marks: the agent that started since is watched, never cut', () => {
  const d = mk('a2'); const s = path.join(d, 'state.json'); const old = path.join(d, 'old.json')
  journal(d, 'wf_g', [st(K('1'), 'L1')])
  assert.equal(mark(d, ['wf_g'], s).out, 'wf_g: mid-step L1\n')
  add(d, 'wf_g', res(K('1')), st(K('2'), 'L2'))
  fs.copyFileSync(s, old)
  assert.equal(mark(d, ['wf_g'], s).out, 'wf_g: mid-step L2\n', 'the re-mark reads the running agent afresh')
  const w = watch(s)
  assert.deepEqual([w.rc, w.out], [3, 'mid-step wf_g L2\n'])
  const stale = watch(old)
  assert.equal(stale.out, 'boundary wf_g after L1\nall at a boundary\n', 'control: the old mark would stop L2 mid-step')
  add(d, 'wf_g', res(K('2')))
  assert.equal(watch(s).out, 'boundary wf_g after L2\nall at a boundary\n')
  // A re-mark with nothing running fires at once.
  assert.equal(mark(d, ['wf_g'], s).out, 'wf_g: at a boundary\n')
  assert.equal(watch(s).out, 'boundary wf_g (nothing running at the mark)\nall at a boundary\n')
})

test('(a2) mark replaces the whole state', () => {
  const d = mk('a2'); const s = path.join(d, 'state.json')
  journal(d, 'wf_ra', [st(K('1'), 'LA')])
  journal(d, 'wf_rb', [st(K('2'), 'LB')])
  mark(d, ['wf_ra', 'wf_rb'], s)
  assert.deepEqual(Object.keys(readState(s).runs), ['wf_ra', 'wf_rb'])
  mark(d, ['wf_ra'], s)
  assert.deepEqual(Object.keys(readState(s).runs), ['wf_ra'])
  assert.deepEqual(fs.readdirSync(d).filter((f) => f.includes('.tmp')), [], 'no tmp file left')
})

// ---- (b) the note verbs ------------------------------------------------------------------------------------------

const ROLLOUT = '---\ntags: [task, rollout]\nstatus: open\nprotocol_version: 5\n---\n\n## Notes\n\nProject root: `/repo`\n\n## Queue\n\n- [[A]]\n'
const STAMP = /^- \d{4}-\d\d-\d\dT\d\d:\d\d[+-]\d\d:\d\d room stop: /
const note = (body = ROLLOUT) => {
  const p = path.join(mk('b'), 'ro.md')
  fs.writeFileSync(p, body)
  return p
}
const begin = (p, text) => sb(['begin', '--rollout', p], { input: text })
const stands = (p, ...more) => sb(['stands', '--rollout', p, ...more])

test('(b) begin creates ## Pause log at the note\'s end, below ## Queue, in _stamp form', () => {
  const p = note()
  const r = begin(p, "Lachy at its 5-hour line; stopping at a step boundary: wf_x proj-a (task); lane: none\n")
  assert.equal(r.rc, 0, r.err)
  assert.match(r.out, STAMP)
  const t = fs.readFileSync(p, 'utf8')
  assert.ok(t.startsWith(ROLLOUT), 'nothing above the new section moved')
  assert.ok(t.indexOf('## Pause log') > t.indexOf('## Queue'))
  assert.ok(t.endsWith(`## Pause log\n\n${r.out}`), t)
  assert.equal(stands(p).rc, 0)
})

test('(b) begin lands inside an existing ## Pause log and leaves ## Notes byte-equal', () => {
  const notes = '## Notes\n\nkeep this [[B]] line\n'
  const p = note('---\nstatus: open\n---\n\n## Queue\n\n- [[A]]\n\n## Pause log\n\n- 2026-10-13T09:00+00:00 paused: wf_1 [[A]]\n\n' + notes)
  const r = begin(p, 'Lachy at its week\'s line\n')
  assert.equal(r.rc, 0, r.err)
  const t = fs.readFileSync(p, 'utf8')
  assert.ok(t.endsWith(notes), 'the section after it is byte-equal')
  const log = t.slice(t.indexOf('## Pause log'), t.indexOf('## Notes'))
  assert.ok(log.includes('paused: wf_1') && log.includes(r.out.trim()), log)
})

test('(b) begin refuses empty or multi-line text and writes nothing; a second begin writes nothing', () => {
  const p = note()
  for (const bad of ['', '\n', '   \n', 'one\ntwo\n']) {
    const r = begin(p, bad)
    assert.equal(r.rc, 2, `stdin ${JSON.stringify(bad)}`)
    assert.equal(fs.readFileSync(p, 'utf8'), ROLLOUT)
  }
  const first = begin(p, 'x at its week\'s line\n')
  const after1 = fs.readFileSync(p, 'utf8')
  const second = begin(p, 'x at its 5-hour line\n')
  assert.equal(second.rc, 0)
  assert.equal(second.out, `room stop already stands since ${first.out.split(' ')[1]}\n`)
  assert.equal(fs.readFileSync(p, 'utf8'), after1)
  assert.equal(begin(path.join(mk('b'), 'none.md'), 'x\n').rc, 1, 'a missing note')
})

test('(b) begin refuses a wikilink and writes nothing: a [[slug]] above ## Queue would reorder the queue', () => {
  const p = note()
  const r = begin(p, 'Lachy at its week\'s line; stopping at a step boundary: wf_x [[proj-a]] (task); lane: none\n')
  assert.equal(r.rc, 2, r.err)
  assert.match(r.err, /bare/)
  assert.equal(r.out, '')
  assert.equal(fs.readFileSync(p, 'utf8'), ROLLOUT, 'the note is byte-equal')
  assert.equal(stands(p).rc, 5, 'no room stop stands')
  const bare = begin(p, 'Lachy at its week\'s line; stopping at a step boundary: wf_x proj-a (task); lane: none\n')
  assert.equal(bare.rc, 0, 'the same line with the slug bare is recorded')
})

test("(b) a spread's line records and stands like a line's; a line signal after it writes nothing", () => {
  const p = note()
  const spread = 'L spreading its Rollouts (would reach its 5-hour line ~17:51); stopping at a step boundary: wf_x proj-a (task); lane: none'
  const r = begin(p, spread + '\n')
  assert.equal(r.rc, 0, r.err)
  assert.match(r.out, STAMP)
  assert.ok(r.out.trimEnd().endsWith(` room stop: ${spread}`), r.out)
  assert.equal(stands(p).rc, 0, 'a spread room stop stands')
  const t = fs.readFileSync(p, 'utf8')
  const since = r.out.split(' ')[1]
  const line = begin(p, 'L at its 5-hour line; stopping at a step boundary: wf_x proj-a (task); lane: none\n')
  assert.deepEqual([line.rc, line.out], [0, `room stop already stands since ${since}\n`])
  assert.equal(fs.readFileSync(p, 'utf8'), t, 'the line signal writes nothing: the spread stays the record')
  const e = sb(['end', '--rollout', p])
  assert.deepEqual([e.rc, e.out], [0, `room stop ended (stood since ${since})\n`])
  assert.equal(stands(p).rc, 5)
})

test('(b) begin over a lapsed start line records a fresh one', () => {
  const p = note(ROLLOUT + '\n## Pause log\n\n- 2020-01-01T00:00+00:00 room stop: old\n')
  const r = begin(p, 'x at its week\'s line\n')
  assert.match(r.out, STAMP)
  assert.equal(stands(p).rc, 0)
})

test('(b) end appends room stop ended; a second end, or no section, writes nothing', () => {
  const p = note()
  const b = begin(p, 'x at its week\'s line\n')
  const since = b.out.split(' ')[1]
  const e = sb(['end', '--rollout', p])
  assert.deepEqual([e.rc, e.out], [0, `room stop ended (stood since ${since})\n`])
  const t = fs.readFileSync(p, 'utf8')
  assert.match(t.trimEnd().split('\n').pop(), /^- \S+ room stop ended$/)
  assert.equal(stands(p).rc, 5)
  const e2 = sb(['end', '--rollout', p])
  assert.deepEqual([e2.rc, e2.out], [0, 'no room stop stands\n'])
  assert.equal(fs.readFileSync(p, 'utf8'), t)
  const bare = note()
  assert.equal(sb(['end', '--rollout', bare]).out, 'no room stop stands\n')
  assert.equal(fs.readFileSync(bare, 'utf8'), ROLLOUT)
  assert.equal(sb(['end', '--rollout', path.join(mk('b'), 'none.md')]).rc, 1)
})

test('(b) stands reads the last room-stop line against its bound', () => {
  const log = (...lines) => note(ROLLOUT + '\n## Pause log\n\n' + lines.join('\n') + '\n')
  const S = '- 2026-10-14T10:00+00:00 room stop: x at its week\'s line'
  const E = '- 2026-10-14T10:30+00:00 room stop ended'
  const at = (h) => `2026-10-14T${String(10 + h).padStart(2, '0')}:00+00:00`
  assert.equal(stands(log(S), '--now', at(1)).rc, 0, '1 h')
  assert.equal(stands(log(S), '--now', at(7)).rc, 4, '7 h')
  assert.equal(stands(log(S), '--now', at(6)).rc, 4, 'at the bound')
  assert.equal(stands(log(S), '--hours', '2', '--now', at(3)).rc, 4, '--hours 2 at 3 h')
  assert.equal(stands(log('- yesterday room stop: x'), '--now', at(1)).rc, 4, 'an unparseable stamp')
  assert.equal(stands(note(), '--now', at(1)).rc, 5, 'no line')
  assert.equal(stands(log(S, E), '--now', at(1)).rc, 5, 'an ended line last')
  assert.equal(stands(log(S, E, '- 2026-10-14T10:45+00:00 room stop: again'), '--now', at(1)).rc, 0, 'start, ended, start')
  assert.equal(stands(log(S, '- 2026-10-14T10:40+00:00 paused: wf_1 [[A]], lane none'), '--now', at(1)).rc, 0, 'a hard-pause line is ignored')
  assert.equal(stands(log(S), '--hours', '0').rc, 2, '--hours 0')
  assert.equal(stands(log(S), '--now', 'soon').rc, 2, 'an unparseable --now')
  assert.equal(stands(path.join(mk('b'), 'none.md')).rc, 1, 'a missing note')
})

test('(b) no __pycache__ is written beside the scripts', () => {
  const d = mk('nopyc')
  for (const f of ['step-boundary.py', 'reconcile-rollout.py']) fs.copyFileSync(path.join(SCRIPTS, f), path.join(d, f))
  const env = baseEnv()
  delete env.PYTHONDONTWRITEBYTECODE
  const p = note()
  const r = spawnSync('python3', [path.join(d, 'step-boundary.py'), 'stands', '--rollout', p], { encoding: 'utf8', env })
  assert.equal(r.status, 5, r.stderr)
  assert.ok(!fs.existsSync(path.join(d, '__pycache__')), 'loading reconcile-rollout.py wrote bytecode')
})

// ---- (c) the Verify: a fake two-call run ---------------------------------------------------------------------------
// The runtime stand-in. A dispatch's key is v2 + sha256(label, prompt). A key whose result is cached replays it with no
// journal line (a resume); any other appends `started`, awaits its gate, then appends `result` (caching it), or
// `failed` when the script returns null. An unreleased gate is a TaskStop: the call never delivers a row.
function runtime(journalPath, script, { cache = new Map(), gated = true } = {}) {
  const gates = []
  let n = 0
  const impl = async (prompt, opts) => {
    const label = opts.label
    const key = 'v2:' + crypto.createHash('sha256').update(JSON.stringify([label, prompt])).digest('hex')
    if (cache.has(key)) return cache.get(key)
    const agentId = 'a' + crypto.randomBytes(8).toString('hex')
    fs.appendFileSync(journalPath, JSON.stringify({ type: 'started', key, agentId, label, phase: label.split(':')[0] }) + '\n')
    const i = n++
    if (gated) await new Promise((resolve) => { gates[i] = resolve })
    const r = script(label)
    if (r == null) {
      fs.appendFileSync(journalPath, JSON.stringify({ type: 'failed', key, agentId }) + '\n')
      return null
    }
    fs.appendFileSync(journalPath, JSON.stringify({ type: 'result', key, agentId, result: r }) + '\n')
    cache.set(key, r)
    return r
  }
  return { impl, cache, release: (i) => gates[i](), waitGate: (i) => until(() => gates[i], `gate ${i}`) }
}
// An implementer that verifies and a review judge that approves; nullOnce: the first implementer dispatch dies.
function script({ nullOnce = false } = {}) {
  let died = false
  return (label) => {
    const kind = label.split(':')[0]
    const s = label.split(':')[1].split(/[ @]/)[0]
    if (kind === 'review') return { verdict: 'approve', feedback: [] }
    if (kind !== 'implement') throw new Error('unexpected agent ' + label)
    if (nullOnce && !died) { died = true; return null }
    return { verified: true, blocked: false, escalate: false, prUrl: `https://github.com/o/r/pull/${s}`, branch: `audit-fix/${s}`,
      worktreePath: `/repo/.claude/worktrees/${s}`, blockerDiagnosis: '', summary: `${label} done` }
  }
}
// args.verifySlot is required (estate ADR 0009 d4): every call carries one.
const argsFor = (slug) => ({ rolloutSlug: 'proj-rollout-2026-10-14', repoPath: '/repo', verifier: 'make test', date: '2026-10-14',
  verifySlot: VERIFY_SLOT,
  task: { slug, taskPath: `/vault/Tasks/${slug}.md`, scope: 'cross-cutting', planGate: false, maxIterations: 3, maxReviewRounds: 3, maxPlanRounds: 3, rung: 'opus-xhigh' } })
function watchBg(state) {
  return new Promise((resolve) => {
    const c = spawn('python3', [SB, 'watch', '--state', state, '--interval', '0.05', '--timeout', '30'], { env: baseEnv() })
    let out = ''
    c.stdout.on('data', (b) => { out += b })
    c.stderr.on('data', (b) => { out += b })
    c.on('close', (rc) => resolve({ rc, out }))
  })
}
const lines = (p) => fs.readFileSync(p, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
const byKey = (p) => {
  const out = new Map()
  for (const l of lines(p)) out.set(l.key, [...(out.get(l.key) ?? []), l.type])
  return [...out.values()]
}
const NONE = 'none'
const noRow = (p) => Promise.race([p, sleep(150).then(() => NONE)])

test('(c) the Verify: both calls stop just after a result line, the resume replays every result, nothing re-runs past its start', async () => {
  const d = mk('c')
  const runs = { a: 'wf_c-a', b: 'wf_c-b' }
  const jp = (r) => { fs.mkdirSync(path.join(d, r), { recursive: true }); return jpath(d, r) }
  const rt = { a: runtime(jp(runs.a), script()), b: runtime(jp(runs.b), script()) }
  const first = { a: runTask(argsFor('proj-a'), rt.a.impl), b: runTask(argsFor('proj-b'), rt.b.impl) }
  await rt.a.waitGate(0)
  await rt.b.waitGate(0)
  const s = path.join(d, 'state.json')
  const m = mark(d, [runs.a, runs.b], s)
  assert.equal(m.rc, 0, m.err)
  assert.match(m.out, /^wf_c-a: mid-step implement:proj-a$/m)
  assert.match(m.out, /^wf_c-b: mid-step implement:proj-b$/m)
  // The signal: release B's running agent; the watch fires on its result line.
  const w1 = watchBg(s)
  rt.b.release(0)
  const r1 = await w1
  assert.equal(r1.rc, 0, r1.out)
  assert.equal(r1.out, 'boundary wf_c-b after implement:proj-b\n')
  // The lead TaskStops B: its next agent has started and never settles.
  await rt.b.waitGate(1)
  const w2 = watchBg(s)
  rt.a.release(0)
  const r2 = await w2
  assert.equal(r2.out, 'boundary wf_c-a after implement:proj-a\nall at a boundary\n')
  await rt.a.waitGate(1)
  for (const k of ['a', 'b']) {
    assert.equal(await noRow(first[k]), NONE, `${k}: a stopped call delivers no row`)
    assert.deepEqual(lines(jpath(d, runs[k])).map((l) => l.type), ['started', 'result', 'started'], `${k}: a result plus one dangling start`)
  }
  // The Stage's re-send: resume each call from its cache, appending to the same journal.
  const resumed = {}
  for (const k of ['a', 'b']) resumed[k] = await runTask(argsFor(`proj-${k}`), runtime(jpath(d, runs[k]), script(), { cache: rt[k].cache, gated: false }).impl)
  for (const k of ['a', 'b']) {
    assert.deepEqual(byKey(jpath(d, runs[k])), [['started', 'result'], ['started', 'started', 'result']],
      `${k}: no pre-stop key gains a second result; the dangling key re-runs once`)
    const ref = await runTask(argsFor(`proj-${k}`), runtime(path.join(d, `ref-${k}.jsonl`), script(), { gated: false }).impl)
    assert.equal(ref.result.tasks[0].status, 'review')
    assert.deepEqual(resumed[k].result, ref.result, `${k}: the resumed row is the reference row`)
  }
})

test('(c) the failed variant: a failed line is the boundary, and the resume re-dispatches that key fresh', async () => {
  const d = mk('c')
  const run = 'wf_c-f'
  fs.mkdirSync(path.join(d, run), { recursive: true })
  const rt = runtime(jpath(d, run), script({ nullOnce: true }))
  const p = runTask(argsFor('proj-f'), rt.impl)
  await rt.waitGate(0)
  const s = path.join(d, 'state.json')
  assert.equal(mark(d, [run], s).out, 'wf_c-f: mid-step implement:proj-f\n')
  const w = watchBg(s)
  rt.release(0)
  assert.equal((await w).out, 'boundary wf_c-f after implement:proj-f\nall at a boundary\n')
  await rt.waitGate(1)
  assert.equal(await noRow(p), NONE)
  const resumed = await runTask(argsFor('proj-f'), runtime(jpath(d, run), script(), { cache: rt.cache, gated: false }).impl)
  assert.deepEqual(byKey(jpath(d, run))[0], ['started', 'failed', 'started', 'started', 'result'])
  const ref = await runTask(argsFor('proj-f'), runtime(path.join(d, 'ref-f.jsonl'), script(), { gated: false }).impl)
  assert.deepEqual(resumed.result, ref.result)
})
