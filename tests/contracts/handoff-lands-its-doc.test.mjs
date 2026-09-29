// Handoff lands its doc (ADR 0028 § 6, as amended: queue and finish). handoff SKILL.md § Commit it hands the
// doc to the shared land.sh through the `# thread:handoff-land` snippet (tests/land.test.sh case 41 runs it),
// mirroring close's `# thread:land` fence: committed by pathspec on the current branch, pushed or its merge
// queued, never waited on, and the checkout never leaves the default branch, so the doc stays on disk. Every
// landing outcome proceeds to task creation; only a committed doc is retried later, and a `not versioned`
// doc is on disk only (close step 7.2 never commits it). Withdrawal lands the removal through the same
// snippet; `/thread:open save` stays commit-only. Reads files only; a missing file or section is a named
// assertion failure, never a crash at load.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readIf, slice, section, assertHas, lineOf, fencedBlocks } from '../lib/contract-text.mjs'

const HANDOFF = 'skills/handoff/SKILL.md'
const CLOSE = 'skills/close/SKILL.md'
const LIFECYCLE = 'skills/_shared/handoff-lifecycle.md'
const text = () => readIf(HANDOFF)
// § Commit it: from its bold label to the next bold label (the fence included).
const COMMIT = () => slice(text(), /^\*\*Commit it\*\*/, /^\*\*[A-Z]/)
const STEP1 = () => lineOf(text(), '1. The handoff doc below')
const FAIL = () => section(text(), /^## Fail closed/)
const LIFE = () => lineOf(text(), '**Lifecycle.**')
const FENCE = () => fencedBlocks(COMMIT() ?? '').find((b) => b.some((l) => l.startsWith('# thread:handoff-land')))

const LD = '${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/land.sh'
const CALL = 'bash "$ld" --slug "$slug" -F "$msg" -- "$home" "$doc"'
const MKTEMP = 'msg=$(mktemp "${TMPDIR:-/tmp}/land-msg.XXXXXX") || exit 2'
const TRAP = 'trap \'rm -f "$msg"\' EXIT'

test('§ Commit it calls land.sh in its own Bash call and holds no plain git commit', () => {
  const c = COMMIT()
  assertHas(c, 'handoff § Commit it', [LD, 'its own Bash tool call', 'timeout 600000'])
  for (const bad of ['commit -m', 'git -C "<home>" add', 'git -C "<home>" commit']) {
    assert.ok(!c.includes(bad), `§ Commit it still holds ${bad}`)
  }
})

test('the # thread:handoff-land fence mirrors close\'s # thread:land', () => {
  const fence = FENCE()
  assert.ok(fence, 'no # thread:handoff-land fence in § Commit it')
  const body = fence.join('\n')
  assert.equal(fence[0], '# thread:handoff-land (extracted and run by tests/land.test.sh)', 'the opening marker')
  assert.equal(fence.filter((l) => l.includes('land.sh') || l.includes('"$ld"')).length, 3, 'expected ld=, the guard, and one call')
  assert.equal(fence.filter((l) => l.startsWith('bash "$ld"')).length, 1, 'exactly one bash "$ld" line')
  assert.equal(fence.at(-2), CALL)
  assert.equal(fence.at(-1), '# end thread:handoff-land')
  assert.ok(fence.includes(MKTEMP), 'the mktemp line is missing or changed')
  const t = fence.indexOf(TRAP), cat = fence.findIndex((l) => l.startsWith('cat > "$msg"'))
  assert.ok(t >= 0, 'no trap removes the message file')
  assert.ok(cat > t, 'the trap is not set before cat > "$msg"')
  assert.ok(body.includes("<<'MSG'"), 'the message is not a quoted heredoc')
  for (const bad of ['git add', 'git commit', '--commit-only', 'mode=']) assert.ok(!body.includes(bad), `the fence holds ${bad}`)
})

test('landing does not wait: nothing polls, and § Commit it holds no wait', () => {
  assertHas(text(), HANDOFF, ['Landing does not wait', 'nothing polls'])
  const c = COMMIT()
  assert.ok(c != null, '§ Commit it is missing')
  for (const bad of ['gh pr checks', '--watch', 'gh pr view', 'sleep ', 'until ']) {
    assert.ok(!c.includes(bad), `§ Commit it holds ${bad}`)
  }
})

test('the doc stays on disk and every landing outcome proceeds to create_thread', () => {
  assertHas(text(), HANDOFF, ['never leaves the default branch', 'on disk'])
  assertHas(STEP1(), 'Success contract step 1', [
    '§ Commit it', /\*?before\*? the task is created/,
    'Every landing outcome, `stuck:` and `not versioned` included, proceeds to `create_thread`',
    'a landing result never blocks the handoff',
  ])
  const f = FAIL()
  assertHas(f, '§ Fail closed', ['handed to landing'])
  assert.ok(!f.includes('written and committed'), '§ Fail closed still says written and committed')
})

test('retry is scoped to committed docs; a not-versioned doc is not durable', () => {
  const s = STEP1()
  assertHas(s, 'Success contract step 1', ['A committed but unlanded doc is retried', 'nothing retries committing it'])
  assert.ok(!s.includes('retries it'), 'step 1 claims a universal retry')
  assertHas(COMMIT(), 'handoff § Commit it', [
    'the daily lander finishes an open `landing` PR', 'nothing retries committing it',
    '`not versioned: <path> (never committed)`', 'refresh diff is not `unchanged`', 'not durable',
    'destroyed rather than archived', 'no fallback plain commit', 're-run the § Commit it snippet',
  ])
  // The claim leans on close step 7.2: if close changes, re-check handoff's prose.
  assertHas(readIf(CLOSE), CLOSE, ['skip when `unchanged`', 'reported `not versioned: <path> (never committed)`'])
})

test('result mapping follows close step 8', () => {
  assertHas(text(), HANDOFF, [
    '`land: commit <sha>`', '`stuck:` together with `land: nothing committed`', '`not versioned: <path> (<reason>)`',
    '`landing <top>: <result line>`', '`landing <top>: stuck: land.sh failed (<first stderr line>)`',
  ])
})

test('the refresh is stated: fast-forward only, a refused one says so, nothing discarded', () => {
  assertHas(COMMIT(), 'handoff § Commit it', ['--ff-only', '`land: ff refused', 'never discarded'])
})

test('withdrawal lands the removal through the same snippet', () => {
  const l = LIFE()
  assertHas(l, 'handoff **Lifecycle.**', [
    'rm -f', '§ Commit it', '`🔧 chore(handoff): withdraw <slug>`', 'plain `rm` if it was never committed',
    'undo the handoff row', 'Resume instructions', 'reopen', 'Superseded by handoff',
  ])
  assert.ok(!l.includes('commit -m'), 'withdrawal still commits with commit -m')
})

test('/thread:open save stays commit-only; handoff never is', () => {
  assertHas(readIf(CLOSE), CLOSE, ["set `mode='--commit-only'` for every call"])
  assertHas(readIf(LIFECYCLE), LIFECYCLE, ['`/thread:open save` stays commit-only'])
  assert.ok(!text().includes('--commit-only'), 'handoff SKILL.md names --commit-only')
})

test('handoff-lifecycle.md: the landing call, pending on disk, the removal landed', () => {
  const t = readIf(LIFECYCLE)
  assertHas(lineOf(t, '- **`pending`**'), '§ States pending', ['handed to landing', 'on disk only when `not versioned`'])
  assertHas(section(t, /^## Withdrawn/), '§ Withdrawn', ['lands the removal'])
  assertHas(lineOf(t, 'The one statement of what a handoff doc is'), 'the intro', ["handoff's landing call"])
})
