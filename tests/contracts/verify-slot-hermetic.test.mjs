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

// ---- node ----------------------------------------------------------------------------------------------------

const NODE_BINDS = /=\s*path\.join\([^)]*['"`][^'"`]*verify-slot\.py['"`]\s*\)/
const NODE_SPAWNS = /\b(?:spawnSync|execFileSync|spawn|execFile|execSync)\(\s*['"](?:python3|bash|sh)['"]/
const NODE_ENV = /\bTHREAD_VERIFY_SLOTS_DIR\s*:/

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
