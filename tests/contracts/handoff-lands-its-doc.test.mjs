// Handoff lands its doc (ADR 0028 § 6, as amended: queue and finish). handoff SKILL.md § Commit it hands the
// doc to the shared land.sh through the `# thread:handoff-land` snippet (tests/land.test.sh case 41 runs it),
// mirroring close's `# thread:land` fence: committed by pathspec on the current branch, pushed or its merge
// queued, never waited on, and the checkout never leaves the default branch, so the doc stays on disk. Every
// landing outcome proceeds to task creation; only a committed-but-unlanded doc is retried later, a
// `not landed:` doc is committed only, and a `not versioned` doc is on disk only (close step 7.2 never
// commits it). The result rows are close step 8's **Landing rows**, in full. Withdrawal lands the removal through the same
// snippet; `/thread:open save` stays commit-only. Reads files only; a missing file or section is a named
// assertion failure, never a crash at load.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readIf, slice, section, assertHas, lineOf, fencedBlocks, collapse } from '../lib/contract-text.mjs'

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

const CLOSE_FENCE = () => fencedBlocks(section(readIf(CLOSE), /^### Land the close-outs/) ?? '')
  .find((b) => b.some((l) => l.startsWith('# thread:land')))

const LD = '${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/land.sh'
const CALL = 'bash "$ld" --slug "$slug" -F "$msg" -- "$home" "$doc"'
const VARS = "home='<home>' slug='<slug>' doc='<abs doc path>'"
const CLOSE_CALL = 'bash "$ld" ${mode:+"$mode"} --slug "$slug" -F "$msg" -- "$top" <paths>'
const CLOSE_VARS = "top='<top>' slug='<slug>' mode=''"

test('description, intro and README name the landing', () => {
  assertHas(lineOf(text(), 'description:'), 'the description', ['lands it', '`landing` PR', 'auto-merge', 'never waiting', 'ADR 0028'])
  assert.ok(!lineOf(text(), 'description:').includes('writes and commits'), 'the description still says writes and commits')
  assertHas(lineOf(text(), 'Every handoff produces two artefacts'), 'the intro', ['landed there', 'never waited on', 'ADR 0028'])
  const readme = lineOf(readIf('README.md'), '| `/thread:handoff`')
  assertHas(readme, 'README handoff row', ['land it', 'pushed or its merge queued', 'ADR 0028'])
  assert.ok(!readme.includes('Write and commit'), 'README still says Write and commit')
})

test('the Invocation gate states the misfire cost honestly', () => {
  const gate = collapse(slice(text(), /^\*\*Invocation gate\.\*\*/, /^## /) ?? '')
  assertHas(gate, 'the Invocation gate', [
    'a misfire reaches origin', '`landing` PR is opened with its merge queued',
    'withdrawing it lands a second push or PR', 'must still be removed',
  ])
  assert.ok(!gate.includes('Since ADR 0017 a misfire costs one committed doc'), 'the gate still prices a misfire at one committed doc')
})

test('§ Commit it calls land.sh in its own Bash call and holds no plain git commit', () => {
  const c = COMMIT()
  assertHas(c, 'handoff § Commit it', [LD, 'its own Bash tool call', 'timeout 600000'])
  for (const bad of ['commit -m', 'git -C "<home>" add', 'git -C "<home>" commit']) {
    assert.ok(!c.includes(bad), `§ Commit it still holds ${bad}`)
  }
})

test('the # thread:handoff-land fence mirrors close\'s # thread:land line for line', () => {
  const fence = FENCE(), closeFence = CLOSE_FENCE()
  assert.ok(fence, 'no # thread:handoff-land fence in § Commit it')
  assert.ok(closeFence, 'no # thread:land fence in close § Land the close-outs')
  assert.equal(fence.length, closeFence.length, 'the two fences differ in length')
  // Close's anchors must still be what the mapping below expects, so a close change fails here by name.
  assert.equal(closeFence.filter((l) => l === CLOSE_VARS).length, 1, `close's variable line is not ${CLOSE_VARS}`)
  assert.equal(closeFence.filter((l) => l === CLOSE_CALL).length, 1, `close's call line is not ${CLOSE_CALL}`)
  const marker = (l) => l.replace(/^# (end )?thread:land\b/, '# $1thread:handoff-land')
  closeFence.forEach((c, i) => {
    const want = c === CLOSE_VARS ? VARS : c === CLOSE_CALL ? CALL : marker(c)
    assert.equal(fence[i], want, `line ${i + 1} of the handoff fence drifted from close's`)
  })
  const body = fence.join('\n')
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
  assertHas(COMMIT(), 'handoff § Commit it', [
    'it never leaves the default branch', 'the doc is on disk from the moment it is written, whatever the result',
  ])
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
  assertHas(s, 'Success contract step 1', [
    'A doc committed but not yet landed (`stuck:` with `land: commit` on stderr, `queued: needs merge <url>`, or a queued merge that later fails) is retried',
    'a `not landed: <reason>` doc is committed only, by design, and no landing call retries it',
    'nothing retries committing it',
  ])
  assert.ok(!s.includes('A committed but unlanded doc is retried'), 'step 1 claims every unlanded doc is retried')
  assertHas(COMMIT(), 'handoff § Commit it', [
    'the daily lander finishes an open `landing` PR', 'nothing retries committing it',
    '`not landed: <reason>` is committed only, by design, and no landing call retries it',
    '`not versioned: <path> (never committed)`', 'refresh diff is not `unchanged`', 'not durable',
    'destroyed rather than archived', 'no fallback plain commit', 're-run the § Commit it snippet',
  ])
  // The claim leans on close step 7.2: if close changes, re-check handoff's prose.
  assertHas(readIf(CLOSE), CLOSE, ['skip when `unchanged`', 'reported `not versioned: <path> (never committed)`'])
})

test('result mapping follows close step 8\'s Landing rows in full', () => {
  assertHas(COMMIT(), 'handoff § Commit it', [
    "close step 8's **Landing rows**",
    '`land: commit <sha>`', '`stuck:` together with `land: nothing committed`', '`not versioned: <path> (<reason>)`',
    '`landing <top>: <result line>`', '`landing <top>: stuck: land.sh failed (<first stderr line>)`',
    ' (carried <N> earlier close-out commit(s))',
    'no row for `landed` with `land: nothing to land`', 'nor for `not landed: swept by the daily sweep`',
    '(`land: dropped <rel> (…)` on stderr) is listed as `not versioned: <path> (not on disk)`',
  ])
  // The rules mirror close's: if close changes one, re-check handoff's copy.
  const rows = slice(readIf(CLOSE), /^\s*\*\*Landing rows\*\*/, /^\d+\. \*\*/)
  assertHas(rows, 'close step 8 Landing rows', [
    'No row for `landed` with `land: nothing to land`, for `not landed: swept by the daily sweep`',
    '**A `dropped` path** (`land: dropped <rel> (…)`)', '`not versioned: <path> (not on disk)`',
    '**`stuck:` together with `land: nothing committed`.**', '`landing <top>: stuck: land.sh failed (<first stderr line>)`',
  ])
})

test('the sweep exemption is land.sh swept()\'s list, not every ~/Projects home', () => {
  const c = COMMIT()
  assertHas(c, 'handoff § Commit it', ['land.sh `swept()`', 'the `~/Projects` monorepo', 'any other nested project repo with a GitHub origin lands'])
  assert.ok(!c.includes('a home the daily sweep carries (`_shared`, `~/Projects/…`)'), '§ Commit it still exempts every ~/Projects home')
  assertHas(readIf('skills/_shared/scripts/land.sh'), 'land.sh', ['swept() {', '"$HOME/Projects" \\'])
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
  assertHas(lineOf(t, '- **`pending`**'), '§ States pending', ['handed to landing', 'committed only when `not landed:`', 'on disk only when `not versioned`'])
  assertHas(section(t, /^## Withdrawn/), '§ Withdrawn', ['lands the removal'])
  assertHas(lineOf(t, 'The one statement of what a handoff doc is'), 'the intro', ["handoff's landing call"])
})
