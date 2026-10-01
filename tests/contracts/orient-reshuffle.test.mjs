// Orient-reshuffle contracts (ADR 0027): the reshape step orient runs, carrying the retired split and
// gather verbs' machinery, and the routing around it. The checks pin contract tokens (flags, statuses,
// file names, section order) rather than sentences, so a rewording that keeps the contract passes.
// Reads files only.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assertHas, collapse, fencedBlocks, read, section } from '../lib/contract-text.mjs'

const reshuffle = read('skills/orient/reshuffle.md')
const orient = read('skills/orient/SKILL.md')
const R = (n) => collapse(section(reshuffle, new RegExp(`^## R${n}\\.`)) ?? '')
const S = (n) => collapse(section(orient, new RegExp(`^### ${n}\\.`)) ?? '')
const donts = collapse(section(reshuffle, /^## Don'ts/) ?? '')

test('the reshape step carries no inline task template and defers to the writer specs', () => {
  const templated = fencedBlocks(reshuffle).filter((b) => /^status: open$/m.test(b.join('\n')))
  assert.equal(templated.length, 0, 'a fenced block in reshuffle.md spells out task frontmatter')
  assertHas(R(5), 'R5', ['add-task.md', 'Step 4', 'Launch context', 'add-phase.md', 'add-project.md',
    'phase: N', 'touches:', 'work_depth:', 'Phase N · Task M', '**Verify:**', 'Resume prompt',
    /`wave:` unset/, /Don't set `scope:`/])
  assertHas(donts, "reshuffle Don'ts", ['add-task.md', 'add-phase.md', 'add-project.md'])
})

test('phases number from N_max + 1, never from phase 0, and ordinals are never reused', () => {
  const c = collapse(reshuffle)
  assert.doesNotMatch(c, /=\s*phase\s+0\b/i)
  assert.doesNotMatch(c, /phase-0\s+tasks/i)
  assertHas(c, 'reshuffle.md', ['N_max + 1', 'states phases', '`p3.5` → P4', /never reused/])
  assert.deepEqual([...c.matchAll(/continu\w*\s+from\s+`?N_max`?(?!\s*\+)/g)].map((m) => m[0]), [])
})

test('in flight is defined once, in orient § 2, with TaskNotes spelling', () => {
  assertHas(S(2), 'orient § 2', ['`status: in-progress`', '`in_progress`', '`review`', '`dispatched:`'])
  assertHas(R(1), 'R1', [/[Oo]rient § 2's definition/, /never change/, /AMBIGUOUS/, /`thread`-tagged/,
    /contains `task` but not `thread`/, '`-p<N>-`'])
  // What orient § 4's bound apply left open (landed since the review, or withheld) is frozen with AMBIGUOUS:
  // the § 2 sweep predates the apply, so without this R1 could re-phase, drop or schedule finished work.
  assertHas(R(1), 'R1', [/Possibly landed — frozen too\.[^-]*AMBIGUOUS[^-]*`New since review`[^-]*`Reviewed, not applied`[^-]*never moved, restamped, dropped or scheduled/])
  assertHas(S(4), 'orient § 4', [/`New since review`[^.]*`Reviewed, not applied`[^.]*\. [^.]*join the reshuffle's frozen possibly-landed tier/])
  assert.doesNotMatch(R(1), /`status: in-progress`/, 'R1 restates the in-flight definition')
})

test('the grill is invoked by name and can stop at any point', () => {
  assertHas(R(3), 'R3', ['`grill-with-docs`', '`grill-me`', /stop at any point/, /Clear items are not grilled/])
})

test('backlinks: one pass, alias and heading forms, cache dirs excluded, out-of-vault links reported', () => {
  assertHas(R(5), 'R5.3', ['/usr/bin/grep -rlF -f', '`.git`', '`.obsidian`', '`.smart-env`', '`.trash`',
    '`]]`, `|`, `\\|` or `#`', /vault only/, /listed in the report/])
})

test('orient runs drift dry, reports it, and applies it only on an authorising answer', () => {
  assertHas(S(2), 'orient § 2', ['reconcile-project.py --project <slug> --json', /dry run/, /mktemp -d/,
    '`<dir>/<slug>.json`', /§ 4 binds the apply to that file/])
  assertHas(S(3), 'orient § 3', ['**Drift**'])
  assertHas(S(4), 'orient § 4', [/--apply --only <that project's saved dry-run file>/, /New since review/,
    /Reviewed, not applied/, /now\s+ambiguous/, /no longer drift/,
    /Ambiguous items are listed for Lachy and never applied/,
    /scoped target skips this question and applies no drift fixes/])
})

test('Look only writes nothing; Steer only exists', () => {
  assertHas(S(4), 'orient § 4', ['**Reshuffle**', '**Steer only**', /\*\*Look only\*\*[^.]*no writes of any kind/])
})

test('orient schedules only wave-shaped members and never runs another rollout', () => {
  assertHas(S(6), 'orient § 6', ['--tasks', '--regenerate', /At most one unfinished rollout per repo/,
    'unfinished-rollout check', /scoped target routes only the tasks its own reshuffle wrote/,
    /schedule nothing and touch nothing/, 'repair', /Uncommitted grill docs/])
  assert.doesNotMatch(collapse(orient), /pause_requested/, 'orient pauses rollouts')
  assert.ok(S(6).indexOf('**The slot write**') > S(6).indexOf('**Hands-on**'), 'the slot write precedes the steering answer')
})

// The sentence of § 6 that names schedule's SKILL.md must pass `--regenerate` and `--tasks` in one backtick
// span: superseding is orient's policy, and a `--regenerate` elsewhere in § 6 would pass a bare token check
// while orient called schedule without it (schedule § 0's check then refuses every supersede).
function scheduleCall(s6) {
  const sentence = s6.split(/(?<=[.!?])\s+/).find((x) => x.includes('skills/schedule/SKILL.md'))
  if (!sentence) return false
  return [...sentence.matchAll(/`([^`]+)`/g)].some((m) => m[1].includes('--regenerate') && m[1].includes('--tasks'))
}

test('orient calls schedule with --regenerate --tasks in the same span', () => {
  assert.ok(scheduleCall(S(6)), 'orient § 6 does not call schedule with `--regenerate --tasks <members>`')
})

test('control: --regenerate only in a later sentence fails scheduleCall', () => {
  const s6 = 'Run `${CLAUDE_PLUGIN_ROOT}/skills/schedule/SKILL.md` with `--tasks <members>`, naming the members. ' +
    'Pass `--regenerate` when superseding.'
  assert.equal(scheduleCall(s6), false)
  assert.equal(scheduleCall(s6.replace('`--tasks <members>`', '`--regenerate --tasks <members>`')), true)
})

test('the execute offer has three answers and never homes a commit on the target default branch', () => {
  assertHas(S(9), 'orient § 9', ['**Fresh session**', '**Here**', '**Not yet**', /default-branch/])
})
