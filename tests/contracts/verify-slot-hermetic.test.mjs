// The machine's verify slots stay out of every test (p23-4, plan round 1's hermeticity point).
//
// verify-slot.py keeps a machine-wide pool of verify slots under ~/.local/state/thread/verify-slots. A suite that
// reached it would wait behind a live rollout's verifies (and end in `noslot`), or take a slot from one. So:
// - a shell suite (or tests/lib helper) that names verify-slot.py, `--slots` or the SKILL.md verify line
//   (`thread:integration-verify`) on a non-comment line exports THREAD_VERIFY_SLOTS_DIR itself or sources
//   tests/lib/merge-task-env.sh, which exports it; tests/run.sh, which runs every suite, exports it too (the
//   backstop for `make test`, and the pool an inner `make test` uses, so it never waits on its outer wrapper);
// - a node test that binds verify-slot.py's path with path.join and spawns python3, bash or sh passes
//   THREAD_VERIFY_SLOTS_DIR as an env key.
// The Heat hold (p31-4, estate ADR 0009 d5) reads the Mac's thermal pressure through verify-slot.py's heat_level(), in
// `run`, in lead-integrate.py's `verify` and in reconcile-rollout.py's `next` (completion-verify --run reaches it through
// verify). A hot Mac would flip their assertions, so the reading is pinned (THREAD_HEAT_LEVEL=0) by every suite that can
// reach it, even when run on its own:
// - tests/run.sh, tests/lib/rollout-fixtures.sh and tests/lib/merge-task-env.sh each export it, one top-level line;
// - a shell suite that names verify-slot.py, `--slots` or `thread:integration-verify`, or reconcile-rollout with a
//   `next --`, lead-integrate with a `verify --` or completion-verify with a `--run`, on a non-comment line, exports it
//   itself or sources one of the two libraries;
// - a node test that binds reconcile-rollout.py (with a 'next' or 'completion-verify' literal), lead-integrate.py
//   (with 'verify') or verify-slot.py with path.join and spawns python3, bash or sh passes THREAD_HEAT_LEVEL as an env
//   key, whether or not its env spreads process.env (the backstop is missing when it runs alone).
// The slot marker (p34-1): a command verify-slot.py runs in a held slot sees VERIFY_SLOT_HELD=1, and the gate and the
// lead's Integration verify run the whole suite inside one. So the marker never leaks into an arm:
// - tests/run.sh unsets it, one top-level line;
// - a shell suite that names VERIFY_SLOT_HELD on a non-comment line unsets it itself, one top-level line (it may run
//   alone, inside a slot), and tests/verify-slot-own.test.sh is among them.
// A heuristic, like tests/contracts/run-record-hermetic.test.mjs (copied in shape): a comment never counts.
// Pure matchers, so the real tree and the controls run through the same code. Reads files only.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { read, walk } from '../lib/contract-text.mjs'

const SELF = `tests/contracts/${path.basename(fileURLToPath(import.meta.url))}`

// ---- shell ---------------------------------------------------------------------------------------------------

const SH_NAMES = /verify-slot\.py|--slots\b|thread:integration-verify/
const SH_EXPORTS = /^\s*export\s+(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*THREAD_VERIFY_SLOTS_DIR=\S/m
const SH_SOURCES_ENV = /^\s*(?:\.|source)\s+["']?\S*tests\/lib\/merge-task-env\.sh/m
const code = (text) => text.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n')

export const shellNames = (text) => SH_NAMES.test(code(text))
export const shellHermetic = (text) => SH_EXPORTS.test(text) || SH_SOURCES_ENV.test(text)

// The Heat hold's pin.
const HEAT_PIN = /^\s*export\s+(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*THREAD_HEAT_LEVEL=0(?:\s|$)/m
const HEAT_LIB_PIN = /^export THREAD_HEAT_LEVEL=0$/m
const SH_SOURCES_PIN = /^\s*(?:\.|source)\s+["']?\S*tests\/lib\/(?:merge-task-env|rollout-fixtures)\.sh/m
export const shellHeat = (text) => {
  const c = code(text)
  return SH_NAMES.test(c) || (/reconcile-rollout/.test(c) && /\bnext\s+--/.test(c)) ||
    (/lead-integrate/.test(c) && /\bverify\s+--/.test(c)) || (/completion-verify/.test(c) && /--run\b/.test(c))
}
export const shellHeatPinned = (text) => HEAT_PIN.test(text) || SH_SOURCES_PIN.test(text)

// The slot marker's unset: one top-level line (never indented, so never inside a function), other names allowed before it.
const HELD_UNSET = /^unset (?:\S+ )*VERIFY_SLOT_HELD(?:\s|$)/m
export const shellNamesHeld = (text) => /\bVERIFY_SLOT_HELD\b/.test(code(text))
export const shellUnsetsHeld = (text) => HELD_UNSET.test(text)

// ---- node ----------------------------------------------------------------------------------------------------

const NODE_BINDS = /=\s*path\.join\([^)]*['"`][^'"`]*verify-slot\.py['"`]\s*\)/
const NODE_SPAWNS = /\b(?:spawnSync|execFileSync|spawn|execFile|execSync)\(\s*['"](?:python3|bash|sh)['"]/
const NODE_ENV = /\bTHREAD_VERIFY_SLOTS_DIR\s*:/

export const nodeSpawns = (text) => NODE_BINDS.test(text) && NODE_SPAWNS.test(text)
export const nodeHermetic = (text) => NODE_ENV.test(text)

const binds = (name) => new RegExp(`=\\s*path\\.join\\([^)]*['"\`][^'"\`]*${name.replace(/\./g, '\\.')}['"\`]\\s*\\)`)
export const nodeHeat = (text) => NODE_SPAWNS.test(text) && (
  (binds('reconcile-rollout.py').test(text) && /['"](?:next|completion-verify)['"]/.test(text)) ||
  (binds('lead-integrate.py').test(text) && /['"]verify['"]/.test(text)) || binds('verify-slot.py').test(text))
export const nodeHeatPinned = (text) => /\bTHREAD_HEAT_LEVEL\s*:/.test(text)

// ---- the files -----------------------------------------------------------------------------------------------

const shellFiles = () => [
  ...walk('tests').filter((f) => /^tests\/[^/]+\.test\.sh$/.test(f) || /^tests\/lib\/[^/]+\.sh$/.test(f) || f === 'tests/run.sh'),
  ...walk('skills/execute/tests').filter((f) => f.endsWith('.test.sh')),
]
const nodeFiles = () => [
  ...walk('tests').filter((f) => /^tests\/(?:contracts\/)?[^/]+\.test\.mjs$/.test(f)),
  ...walk('skills/execute/tests').filter((f) => f.endsWith('.test.mjs')),
].filter((f) => f !== SELF)

test('every shell suite that reaches a verify-slot pool points THREAD_VERIFY_SLOTS_DIR at temp', () => {
  const naming = shellFiles().filter((f) => shellNames(read(f)))
  // Not vacuous: the suites that take verify slots are all seen.
  for (const f of ['tests/lead-integrate.test.sh', 'tests/verify-slot.test.sh', 'tests/git-env-scrub.test.sh']) {
    assert.ok(naming.includes(f), `${f} is seen as reaching a verify-slot pool`)
  }
  const bad = naming.filter((f) => !shellHermetic(read(f)))
  assert.deepEqual(bad, [], 'export THREAD_VERIFY_SLOTS_DIR="<suite temp>/verify-slots" (or source tests/lib/merge-task-env.sh)')
})

test('tests/run.sh and tests/lib/merge-task-env.sh export THREAD_VERIFY_SLOTS_DIR into temp', () => {
  assert.ok(SH_EXPORTS.test(read('tests/run.sh')), 'tests/run.sh: the backstop for every suite under make test')
  assert.match(read('tests/run.sh'), /^export THREAD_VERIFY_SLOTS_DIR="\$scratch\/verify-slots"$/m)
  assert.match(read('tests/lib/merge-task-env.sh'), /^export THREAD_VERIFY_SLOTS_DIR="\$tmp\/verify-slots"/m)
})

test('every node test that spawns verify-slot.py passes THREAD_VERIFY_SLOTS_DIR in its env', () => {
  const spawning = nodeFiles().filter((f) => nodeSpawns(read(f)))
  const bad = spawning.filter((f) => !nodeHermetic(read(f)))
  assert.deepEqual(bad, [], 'pass THREAD_VERIFY_SLOTS_DIR: <an mkdtemp dir> in the spawn env')
})

test('the Heat hold (p31-4): run.sh and both test libraries export THREAD_HEAT_LEVEL=0, one top-level line each', () => {
  for (const f of ['tests/run.sh', 'tests/lib/rollout-fixtures.sh', 'tests/lib/merge-task-env.sh']) {
    assert.match(read(f), HEAT_LIB_PIN, `${f}: export THREAD_HEAT_LEVEL=0`)
  }
})

test('the Heat hold (p31-4): every shell suite that reaches the heat reading pins it', () => {
  const reaching = shellFiles().filter((f) => shellHeat(read(f)))
  // Not vacuous: the suites that read the heat through next, verify, run or completion-verify --run are all seen.
  for (const f of ['skills/execute/tests/reconcile-rollout-auto-retry.test.sh', 'skills/execute/tests/reconcile-rollout-completion.test.sh',
    'skills/execute/tests/reconcile-rollout-runs.test.sh', 'skills/execute/tests/reconcile-rollout-standing.test.sh',
    'skills/execute/tests/reconcile-rollout.test.sh', 'skills/execute/tests/reconcile-rollout-trickle.test.sh',
    'skills/execute/tests/reconcile-rollout-heat.test.sh', 'tests/verify-slot.test.sh', 'tests/verify-slot-heat.test.sh',
    'tests/lead-integrate.test.sh', 'tests/leg.test.sh', 'tests/engine-snapshot.test.sh']) {
    assert.ok(reaching.includes(f), `${f} is seen as reaching the heat reading`)
  }
  const bad = reaching.filter((f) => !shellHeatPinned(read(f)))
  assert.deepEqual(bad, [], 'export THREAD_HEAT_LEVEL=0 (or source tests/lib/rollout-fixtures.sh or tests/lib/merge-task-env.sh)')
})

test('the Heat hold (p31-4): every node test that spawns next, verify or verify-slot.py passes THREAD_HEAT_LEVEL', () => {
  const spawning = nodeFiles().filter((f) => nodeHeat(read(f)))
  for (const f of ['tests/contracts/status-repair-queue.test.mjs', 'tests/needs-human-roundtrip.test.mjs']) {
    assert.ok(spawning.includes(f), `${f} is seen as spawning the heat reading`)
  }
  const bad = spawning.filter((f) => !nodeHeatPinned(read(f)))
  assert.deepEqual(bad, [], "pass THREAD_HEAT_LEVEL: '0' in the spawn env")
})

test('the slot marker (p34-1): tests/run.sh unsets VERIFY_SLOT_HELD, one top-level line', () => {
  assert.match(read('tests/run.sh'), /^unset VERIFY_SLOT_HELD$/m, 'tests/run.sh: unset VERIFY_SLOT_HELD')
})

test('the slot marker (p34-1): every shell suite that names VERIFY_SLOT_HELD unsets it at top level', () => {
  const naming = shellFiles().filter((f) => shellNamesHeld(read(f)))
  // Not vacuous: the suite that tests the marker is seen.
  assert.ok(naming.includes('tests/verify-slot-own.test.sh'), 'tests/verify-slot-own.test.sh is seen as naming the marker')
  const bad = naming.filter((f) => !shellUnsetsHeld(read(f)))
  assert.deepEqual(bad, [], 'unset VERIFY_SLOT_HELD, one top-level line')
})

// ---- controls ------------------------------------------------------------------------------------------------

test('control: the shell matchers', () => {
  assert.ok(shellNames('VS="$root/skills/execute/scripts/verify-slot.py"\n'))
  assert.ok(shellNames('python3 "$LI" verify --tree t --out o --timeout 9 --slots 1 --slot-wait 9 --verifier true\n'))
  assert.ok(shellNames("m = re.search(r'^# thread:integration-verify', text)\n"), 'the SKILL.md verify line, extracted')
  assert.ok(!shellNames('# a prose comment: verify-slot.py takes --slots N\n'), 'a comment is not a use')
  assert.ok(!shellNames('  # thread:integration-verify, in prose\n'), 'an indented comment is not a use')
  assert.ok(shellHermetic('export THREAD_VERIFY_SLOTS_DIR="$tmp/slots"\n'))
  assert.ok(shellHermetic('export HOME="$s/home" THREAD_VERIFY_SLOTS_DIR="$s/slots"\n'))
  assert.ok(shellHermetic('. tests/lib/merge-task-env.sh\n'))
  assert.ok(!shellHermetic('THREAD_VERIFY_SLOTS_DIR="$tmp/slots"\n'), 'an unexported assignment does not reach the child')
  assert.ok(!shellHermetic('# export THREAD_VERIFY_SLOTS_DIR="$tmp/slots"\n'), 'a commented export')
  assert.ok(!shellHermetic('# THREAD_VERIFY_SLOTS_DIR is set by run.sh\n'), 'a prose comment')
})

test('control: the node matchers', () => {
  const binds = "const VS = path.join(root, 'skills', 'execute', 'scripts', 'verify-slot.py')\n"
  const runs = "spawnSync('python3', [VS, 'status'], { env: { ...process.env } })\n"
  assert.ok(nodeSpawns(binds + runs))
  assert.ok(nodeSpawns(binds + "spawnSync('bash', ['-c', line])\n"), 'the wrapped line run through bash')
  assert.ok(!nodeSpawns(binds), 'a path with no spawn')
  assert.ok(!nodeSpawns("spawnSync('python3', ['-c', 'x'])\nconst s = 'verify-slot.py run'\n"), 'a prose mention')
  assert.ok(nodeHermetic('{ ...process.env, THREAD_VERIFY_SLOTS_DIR: dir }'))
  assert.ok(!nodeHermetic('// THREAD_VERIFY_SLOTS_DIR is set by run.sh'))
})

test('control: the heat matchers', () => {
  assert.ok(shellHeat('python3 "$SCRIPT" next --rollout "$D/ro.md"\nSCRIPT=x/reconcile-rollout.py\n'), 'a next call')
  assert.ok(shellHeat('nx() { python3 "$LEG" next --rollout "$1"; }\n# reconcile-rollout runs below\nRR=reconcile-rollout.py\n'), 'a leg next -- line beside reconcile-rollout')
  assert.ok(shellHeat('LI=lead-integrate.py\npython3 "$LI" verify --tree t --out o --timeout 9 --verifier true\n'), 'a verify call')
  assert.ok(shellHeat('python3 "$S" completion-verify --rollout "$RO" "$@"\ncv --run\n'), 'a cv --run call site')
  assert.ok(!shellHeat('# python3 reconcile-rollout.py next --rollout x\n'), 'a comment is not a use')
  assert.ok(!shellHeat('python3 reconcile-rollout.py status --rollout x\n'), 'another verb never reads the heat')
  assert.ok(shellHeatPinned('export THREAD_HEAT_LEVEL=0\n'))
  assert.ok(shellHeatPinned('export TZ=UTC THREAD_HEAT_LEVEL=0   # pinned\n'))
  assert.ok(shellHeatPinned('. "$HERE/../../../tests/lib/rollout-fixtures.sh"\n'))
  assert.ok(!shellHeatPinned('# export THREAD_HEAT_LEVEL=0\n'), 'a commented export')
  assert.ok(!shellHeatPinned('THREAD_HEAT_LEVEL=0\n'), 'an unexported assignment does not reach the child')
  assert.ok(!shellHeatPinned('export THREAD_HEAT_LEVEL=2\n'), 'a pin at heavy is no pin at nominal')
  assert.ok(!HEAT_LIB_PIN.test('  export THREAD_HEAT_LEVEL=0 # inside a function\n'), 'a library pin is one top-level line')
  const rr = "const RECONCILE = path.join(SCRIPTS, 'reconcile-rollout.py')\npy(RECONCILE, ['next', '--rollout', R])\nspawnSync('python3', [s, ...a], { env })\n"
  assert.ok(nodeHeat(rr), 'next through a bound reconcile-rollout.py')
  assert.ok(!nodeHeat(rr.replace("'next'", "'status'")), 'another verb never reads the heat')
  assert.ok(nodeHeat("const LI = path.join(root, 'lead-integrate.py')\nspawnSync('python3', [LI, 'verify'])\n"), 'verify through lead-integrate.py')
  assert.ok(nodeHeatPinned("{ ...process.env, THREAD_HEAT_LEVEL: '0' }"))
  assert.ok(!nodeHeatPinned('{ ...process.env, THREAD_EVENTS_DIR: d }'), 'a node env missing the key')
  assert.ok(!nodeHeatPinned('// THREAD_HEAT_LEVEL is set by run.sh'), 'a comment')
})

test('control: the slot marker matchers (p34-1)', () => {
  assert.ok(shellUnsetsHeld('unset VERIFY_SLOT_HELD\n'))
  assert.ok(shellUnsetsHeld('unset THREAD_TOML_PYTHONS VERIFY_SLOT_HELD   # the gate runs this suite in a slot\n'))
  assert.ok(!shellUnsetsHeld('# unset VERIFY_SLOT_HELD\n'), 'a commented unset')
  assert.ok(!shellUnsetsHeld('  unset VERIFY_SLOT_HELD\n'), 'an indented unset (inside a function) is no top-level line')
  assert.ok(!shellUnsetsHeld('unset VERIFY_SLOT_HELD_X\n'), 'another name')
  assert.ok(shellNamesHeld('out=$(sh -c \'echo "${VERIFY_SLOT_HELD-unset}"\')\n'))
  assert.ok(!shellNamesHeld('# a command in a slot sees VERIFY_SLOT_HELD=1\n'), 'a mention only in prose (a comment)')
})
