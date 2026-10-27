// p32-1 (execute § 4.5 *Args refusal*): every refusal the engine makes before any dispatch carries one sentinel,
// `thread:args-refused`, at the head of its message, so the lead tells it from a *Lost call* by a *contains* match even
// when the notification wraps or cuts the text. Such a call dispatched nothing and the same args are refused again, so
// the lead halts the entry once and never resumes it.
//
// Three parts:
// - the constant and the message shape (loadEngine);
// - a table of refused args, run through the whole script (runTask): each is refused with the sentinel and its own kind
//   head right after it, with no agent() call and no log line;
// - a source check on the entry (from the orchestration marker to the integrate branch's first log line): every refusal
//   head is in it, it holds no plain `throw new Error(` and exactly 12 `throw argsRefused(`. Its controls swap a late
//   throw back to a plain Error (each must fail both the sentinel and the source check) and cut the end anchor (the
//   source check must fail, never pass on an empty slice).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { runTask, loadEngine, enginePath, VERIFY_SLOT } from '../../../tests/lib/engine.mjs'

const SENTINEL = 'thread:args-refused'
const PREFIX = SENTINEL + ': '
const sha = (c) => c.repeat(40)
const SLUG = 'proj-fix-a'
const PR = 'https://github.com/o/r/pull/7'
const BR = 'audit-fix/fix-a'
const WT = '/repo/.claude/worktrees/proj-fix-a'
const LADDER = { source: 'built-in', rungs: [{ name: 'opus-high', model: 'opus', effort: 'high', judge: 'high', review: 'xhigh' }] }

const mkTask = (over = {}) => ({
  slug: SLUG, taskPath: `/vault/Tasks/${SLUG}.md`, scope: 'cross-cutting', planGate: false,
  maxIterations: 3, maxReviewRounds: 3, maxPlanRounds: 3, ...over,
})
const mkI = (over = {}) => ({
  prUrl: PR, branch: BR, worktreePath: WT, headSha: sha('a'), taskBase: sha('b'), mainSha: sha('c'), trouble: [], landed: [],
  reviewHistory: [], reviewRoundsUsed: 1, rung: { startRung: '', rung: '', climbs: [] }, startedAt: '2026-10-01T10:00:00Z', ...over,
})
const mkResume = (over = {}) => ({
  stage: 'revise', prUrl: PR, branch: BR, worktreePath: WT, reviewHistory: [{ round: 1, feedback: ['fix it'] }], reviewRoundsUsed: 1, plan: '', ...over,
})
const taskArgs = (over = {}, taskOver = {}) => ({
  rolloutSlug: 'proj-rollout-2026-10-01', repoPath: '/repo', verifier: 'make test', date: '2026-10-01', ladder: LADDER,
  verifySlot: VERIFY_SLOT, task: mkTask(taskOver), ...over,
})
const integrateArgs = (over = {}, iOver = {}, taskOver = {}) => taskArgs({ mode: 'integrate', integration: mkI(iOver), ...over }, taskOver)
const omit = (o, k) => { const { [k]: _drop, ...rest } = o; return rest }

// [what, args, the kind head right after the prefix]
const CASES = [
  ['unparsable string args', '{"task": ', 'args: not JSON: '],
  ['undefined args', undefined, 'args must be one object, got '],
  ['null args', null, 'args must be one object, got '],
  ['a number', 5, 'args must be one object, got 5'],
  ['an array', [], 'args must be one object, got []'],
  ["the string 'null'", 'null', 'args must be one object, got null'],
  ['a bad defaultBranch', taskArgs({ defaultBranch: '-x' }), 'defaultBranch: refusing "-x"'],
  ['the pre-p12-5 waves shape', taskArgs({ waves: [{ wave: 1, tasks: [mkTask()] }] }), 'task.workflow.js takes one args.task, not args.waves'],
  ['an array task', taskArgs({ task: [mkTask()] }), 'args.task must be one task object'],
  ["mode 'merge'", taskArgs({ mode: 'merge' }), 'args.mode: refusing "merge"'],
  ['a malformed ladder', taskArgs({ ladder: 'built-in' }), 'args.ladder: '],
  ...[undefined, 'integrate'].flatMap((mode) => {
    const base = mode ? integrateArgs() : taskArgs()
    const m = mode || 'task'
    return [
      [`verifySlot absent (${m} mode)`, omit(base, 'verifySlot'), 'args.verifySlot: is required'],
      [`verifySlot absent, stringified args (${m} mode)`, JSON.stringify(omit(base, 'verifySlot')), 'args.verifySlot: is required'],
      [`verifySlot null (${m} mode)`, { ...base, verifySlot: null }, 'args.verifySlot: is required'],
      [`verifySlot a bad shape (${m} mode)`, { ...base, verifySlot: { ...VERIFY_SLOT, priority: true } }, 'args.verifySlot: must hold exactly script and slots'],
    ]
  }),
  ['a bad integration', integrateArgs({}, { headSha: 'x' }), 'args.integration: headSha must be a 40-hex commit sha'],
  ['integration without integrate mode', taskArgs({ integration: mkI() }), "args.integration: only with args.mode 'integrate'"],
  ['task.resume in integrate mode', integrateArgs({}, {}, { resume: mkResume() }), "args.task.resume: a seeded revise is its own call, never mode 'integrate'"],
  ['a bad task.resume in task mode', taskArgs({}, { resume: mkResume({ stage: 'implement' }) }), "args.task.resume: stage must be 'revise'"],
]

const never = async () => { throw new Error('agent() must not run') }
// [] when a run refused with the sentinel and its head, before any agent() call and any log line; else what failed.
function refusalFails(r, head) {
  const out = []
  const msg = r.error && typeof r.error.message === 'string' ? r.error.message : null
  if (msg === null) out.push('no error')
  else {
    if (!msg.startsWith(PREFIX)) out.push('sentinel')
    else if (!msg.slice(PREFIX.length).startsWith(head)) out.push('head')
  }
  if (r.calls.length !== 0) out.push('dispatched')
  if (r.logs.length !== 0) out.push('logged')
  return out
}

test('the sentinel: ARGS_REFUSED and argsRefused(why)', () => {
  const E = loadEngine(['ARGS_REFUSED', 'argsRefused'])
  assert.equal(E.ARGS_REFUSED, SENTINEL)
  const e = E.argsRefused('args.mode: x')
  assert.equal(e.message, 'thread:args-refused: args.mode: x')
  assert.equal(e.name, 'Error')
})

test('every pre-dispatch refusal carries the sentinel and its head, with no dispatch and no log', async () => {
  for (const [what, args, head] of CASES) {
    const r = await runTask(args, never)
    assert.deepEqual(refusalFails(r, head), [], `${what}: ${r.error && r.error.message}`)
  }
})

test('the valid args of both modes are not refused (the table is not vacuous)', async () => {
  for (const args of [taskArgs(), integrateArgs(), JSON.stringify(taskArgs())]) {
    const r = await runTask(args, async () => null)
    assert.ok(!(r.error && String(r.error.message).includes(SENTINEL)), String(r.error && r.error.message))
    assert.ok(r.calls.length > 0 || (r.error === undefined && r.logs.length > 0), 'reached the dispatch')
  }
})

// ---- the source check ------------------------------------------------------------------------------------------

const START = '// ---- Orchestration'
const END = "\nif (mode === 'integrate') {\n  log(`integrate: "
// [needle, how many times the entry's code (full-line comments dropped) must hold it]
const HEADS = [
  ["'args: not JSON: '", 1], ["'args must be one object, got '", 1], ['defaultBranch(a)', 1], ['not args.waves', 1],
  ['args.task must be one task object', 1], ['args.mode: ', 1], ["'args.ladder: '", 1], ["'args.verifySlot: '", 1],
  ['args.integration: ', 2], ['args.task.resume: ', 2],
]
const src = fs.readFileSync(enginePath, 'utf8')

// [] when the entry holds every refusal head, no plain throw and exactly 12 argsRefused throws; else what failed.
function sourceFails(text) {
  const from = text.indexOf(START)
  const to = text.indexOf(END)
  if (from < 0 || to < 0 || from >= to) return [`anchors (from ${from}, to ${to})`]
  const entry = text.slice(from, to).split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')
  const out = []
  for (const [needle, n] of HEADS) if (entry.split(needle).length - 1 < n) out.push(`head ${needle}`)
  if (entry.includes('throw new Error(')) out.push('a plain throw')
  const k = entry.split('throw argsRefused(').length - 1
  if (k !== 12) out.push(`${k} argsRefused throws`)
  return out
}

test('source: the entry refuses only through argsRefused, 12 sites, every head inside it', () => {
  assert.deepEqual(sourceFails(src), [])
})

function swap(text, from, to) {
  assert.ok(text.includes(from), `control setup: ${from} not found`)
  return text.replace(from, to)
}
const caseOf = (what) => CASES.find(([w]) => w === what)

test('control: the last throw (args.task.resume) back on a plain Error fails the sentinel and the source check', async () => {
  const v = swap(src, "throw argsRefused('args.task.resume: ' + bad)", "throw new Error('args.task.resume: ' + bad)")
  const [, args, head] = caseOf('a bad task.resume in task mode')
  const r = await runTask(args, never, { source: v })
  assert.deepEqual(refusalFails(r, head), ['sentinel'])
  assert.deepEqual(sourceFails(v), ['a plain throw', '11 argsRefused throws'])
})

test("control: the else-branch args.integration throw back on a plain Error fails the sentinel and the source check", async () => {
  const v = swap(src, "throw argsRefused(\"args.integration: only with args.mode 'integrate'\")", "throw new Error(\"args.integration: only with args.mode 'integrate'\")")
  const [, args, head] = caseOf('integration without integrate mode')
  const r = await runTask(args, never, { source: v })
  assert.deepEqual(refusalFails(r, head), ['sentinel'])
  assert.deepEqual(sourceFails(v), ['a plain throw', '11 argsRefused throws'])
})

test('control: the end anchor cut fails the source check, never an empty slice that passes', () => {
  const v = swap(src, END, "\nif (mode === 'integrate') {\n  log(`integrating: ")
  const f = sourceFails(v)
  assert.equal(f.length, 1)
  assert.match(f[0], /^anchors /)
})
