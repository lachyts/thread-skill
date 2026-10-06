// The Run record stays out of the real ~/.local/state under test (ADR 0032, p15-1; PR #87 review finding 9).
//
// Once p15-2 wires run_record.py into the engine scripts, every suite that drives them would append to the
// default events directory unless it points THREAD_EVENTS_DIR at temp. So the exports land now, ahead of the
// emitters, and this guard keeps them:
// - a shell suite (or tests/lib helper, or tests/run.sh) that invokes reconcile-rollout.py, merge-task.sh or
//   lead-integrate.py, by a variable holding its path or by `python3`/`bash` on it, exports THREAD_EVENTS_DIR
//   itself or sources tests/lib/merge-task-env.sh, which exports it;
// - a node test that binds one of those scripts' paths with path.join and spawns or execFiles python3 passes
//   THREAD_EVENTS_DIR as an env key.
// A heuristic (a prose mention never counts as an invocation); tests/run.sh's own export is the backstop for
// `make test`. p15-2 wired the emitters in (git-env-canary.py records its hold too, so it joins the names), and
// added one knob: each export may read `${THREAD_TEST_EVENTS_DIR:-<its temp>/events}` (node:
// `process.env.THREAD_TEST_EVENTS_DIR || <tmp>`), so `THREAD_TEST_EVENTS_DIR=<a file>/events make test` runs every
// such suite against an unwritable record. p15-5's tune.py writes the record too (tunings.jsonl), so it joins the
// names. Pure matchers, so the real tree and the controls run through the same code. Reads files only.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { read, walk } from '../lib/contract-text.mjs'

const SELF = `tests/contracts/${path.basename(fileURLToPath(import.meta.url))}`
const NAMES = '(?:reconcile-rollout\\.py|merge-task\\.sh|lead-integrate\\.py|git-env-canary\\.py|tune\\.py)'

// ---- shell ---------------------------------------------------------------------------------------------------

const SH_BINDS = new RegExp(`^\\s*(?:export\\s+)?[A-Za-z_][A-Za-z0-9_]*=["']?[^"'\\s]*scripts/${NAMES}["']?\\s*(?:#.*)?$`, 'm')
const SH_RUNS = new RegExp(`(?:^|[\\s;&|(])(?:python3|bash|sh)\\s+(?:-\\S+\\s+)*["']?[^"'\\s]*scripts/${NAMES}`, 'm')
const SH_EXPORTS = /^\s*export\s+(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*THREAD_EVENTS_DIR=\S/m
const SH_SOURCES_ENV = /^\s*(?:\.|source)\s+["']?\S*tests\/lib\/merge-task-env\.sh/m

export const shellInvokes = (text) => SH_BINDS.test(text) || SH_RUNS.test(text)
export const shellHermetic = (text) => SH_EXPORTS.test(text) || SH_SOURCES_ENV.test(text)

// ---- node ----------------------------------------------------------------------------------------------------

const NODE_BINDS = new RegExp(`=\\s*path\\.join\\([^)]*['"\`][^'"\`]*${NAMES}['"\`]\\s*\\)`)
const NODE_SPAWNS = /\b(?:spawnSync|execFileSync|spawn|execFile)\(\s*['"]python3['"]/
const NODE_ENV = /\bTHREAD_EVENTS_DIR\s*:/

export const nodeSpawns = (text) => NODE_BINDS.test(text) && NODE_SPAWNS.test(text)
export const nodeHermetic = (text) => NODE_ENV.test(text)

// ---- the files -----------------------------------------------------------------------------------------------

const shellFiles = () => [
  ...walk('tests').filter((f) => /^tests\/[^/]+\.test\.sh$/.test(f) || /^tests\/lib\/[^/]+\.sh$/.test(f) || f === 'tests/run.sh'),
  ...walk('skills/execute/tests').filter((f) => f.endsWith('.test.sh')),
]
const nodeFiles = () => [
  ...walk('tests').filter((f) => /^tests\/(?:contracts\/)?[^/]+\.test\.mjs$/.test(f)),
  ...walk('skills/execute/tests').filter((f) => f.endsWith('.test.mjs')),
].filter((f) => f !== SELF)

test('every shell suite that invokes an engine script points THREAD_EVENTS_DIR at temp', () => {
  const invoking = shellFiles().filter((f) => shellInvokes(read(f)))
  // Not vacuous: the known engine-driving suites are all seen as invoking.
  for (const f of ['tests/run.sh', 'tests/lib/merge-task-env.sh', 'tests/git-env-canary.test.sh', 'tests/lead-integrate.test.sh',
    'skills/execute/tests/reconcile-rollout.test.sh', 'skills/execute/tests/reconcile-rollout-runs.test.sh']) {
    assert.ok(invoking.includes(f), `${f} is seen as invoking an engine script`)
  }
  const bad = invoking.filter((f) => !shellHermetic(read(f)))
  assert.deepEqual(bad, [], 'export THREAD_EVENTS_DIR="<suite temp>/events" (or source tests/lib/merge-task-env.sh)')
})

test('every node test that spawns an engine script passes THREAD_EVENTS_DIR in its env', () => {
  const spawning = nodeFiles().filter((f) => nodeSpawns(read(f)))
  for (const f of ['tests/integration-marker-roundtrip.test.mjs', 'tests/contracts/status-repair-queue.test.mjs', 'tests/ladder.test.mjs',
    'tests/retro-tune.test.mjs']) {
    assert.ok(spawning.includes(f), `${f} is seen as spawning an engine script`)
  }
  const bad = spawning.filter((f) => !nodeHermetic(read(f)))
  assert.deepEqual(bad, [], 'pass THREAD_EVENTS_DIR: <an mkdtemp dir> in the spawn env')
})

// ---- controls ------------------------------------------------------------------------------------------------

test('control: the shell matchers', () => {
  assert.ok(shellInvokes('SCRIPT="$HERE/../scripts/reconcile-rollout.py"\n'))
  assert.ok(shellInvokes('x\n  bash skills/execute/scripts/merge-task.sh --self-test-base\n'))
  assert.ok(shellInvokes('out=$(python3 -B "$root/skills/execute/scripts/lead-integrate.py" inputs)\n'))
  assert.ok(!shellInvokes('ok "$(grep -c x skills/execute/scripts/merge-task.sh)" 0 "prose"\n'), 'a grep of the file is not a run')
  assert.ok(!shellInvokes('has "$s" "reconcile-rollout.py resume" "a prose check"\n'), 'a prose mention is not a run')
  assert.ok(shellHermetic('export THREAD_EVENTS_DIR="$TMP/events"\n'))
  assert.ok(shellHermetic('export HOME="$s/home" THREAD_EVENTS_DIR="$s/events"\n'))
  assert.ok(shellHermetic('. tests/lib/merge-task-env.sh\n'))
  assert.ok(shellHermetic('export THREAD_EVENTS_DIR="${THREAD_TEST_EVENTS_DIR:-$TMP/events}"  # x\n'), 'the knob form')
  assert.ok(shellInvokes('CAN="$root/skills/execute/scripts/git-env-canary.py"\n'), 'the canary is an engine script')
  assert.ok(shellInvokes('python3 -B skills/retro/scripts/tune.py --record-only\n'), 'the tune script writes the record')
  assert.ok(!shellHermetic('THREAD_EVENTS_DIR="$TMP/events"\n'), 'an unexported assignment does not reach the child')
  assert.ok(!shellHermetic('# export THREAD_EVENTS_DIR=x\n'))
})

test('control: the node matchers', () => {
  const binds = "const RECONCILE = path.join(root, 'skills', 'execute', 'scripts', 'reconcile-rollout.py')\n"
  const runs = "spawnSync('python3', [RECONCILE], { env: { ...process.env } })\n"
  assert.ok(nodeSpawns(binds + runs))
  assert.ok(!nodeSpawns(binds), 'a path with no python spawn')
  assert.ok(!nodeSpawns("spawnSync('python3', ['-c', 'x'])\nconst s = 'reconcile-rollout.py next'\n"), 'a prose mention')
  assert.ok(nodeHermetic("{ ...process.env, THREAD_EVENTS_DIR: ev }"))
  assert.ok(nodeHermetic("{ ...process.env, THREAD_EVENTS_DIR: process.env.THREAD_TEST_EVENTS_DIR || ev }"), 'the knob form')
  assert.ok(!nodeHermetic('// THREAD_EVENTS_DIR is set by run.sh'))
})
