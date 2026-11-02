// Close lands its own close-out (ADR 0028, amended: queue and finish). close SKILL.md hands its close-out
// paths (7.1's THREAD.md, 7.2's refreshed and deleted handoff docs) to one land.sh call per repo, at the end
// of sub-step 7.2, through the `# thread:land` snippet (tests/land.test.sh runs it). The guardrail is the
// own-work rule, step 8 prints a landing row per call and takes every close-out SHA from land.sh's stderr,
// and step 9 picks one of four banners by the landing rows (the fourth is the own-branch hold's,
// tests/contracts/close-lands-own-branch.test.mjs). Reads files only; a missing file or section
// is a named assertion failure, never a crash at load.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readIf, slice, section, assertHas, lineOf, fencedBlocks } from '../lib/contract-text.mjs'

const CLOSE = 'skills/close/SKILL.md'
const text = () => readIf(CLOSE)
const s71 = () => text()?.split('\n').find((l) => l.includes('Thread update — write THREAD.md')) ?? null
const s72 = () => text()?.split('\n').find((l) => /^\s*2\. Handoff lifecycle/.test(l)) ?? null
const LAND = () => section(text(), /^### Land the close-outs$/)
const STEP8 = () => slice(text(), /^8\. \*\*Print the "What landed" report/, /^9\. \*\*End with the closing banner/)
const STEP9 = () => slice(text(), /^9\. \*\*End with the closing banner/, /^## Edge cases/)
const EDGES = () => section(text(), /^## Edge cases/)
const GUARD = () => section(text(), /^## Guardrails/)

const BANNER_A = '**Thread closed. Safe to end this session — nothing valuable left in conversation state.**'
const BANNER_B = '**Thread closed. Safe to end this session — pushed where the landing rows say; any own-branch review ran clean here; queued PRs are not merged yet, and nothing here waits for CI.**'
const BANNER_C = '**Thread closed. Safe to end this session, but work is NOT queued to land in <repo>[, <repo>…]: see its landing row.**'
const BANNER_D = '**Thread closed. Safe to end this session, but the review loop stopped on <branch>[, <branch>…]: its PR stays open with the diagnosis, see its landing row.**'

test('description and Auto-execute name the landing; Auto-execute keeps step 7.1', () => {
  // p34-5 F25: the parenthesis shrank to "(pushed, or a queued `landing` PR; ADR 0028)" to fit the follow-up-task
  // clause under the description cap; "Landing does not wait" stays in the body's Rules
  assertHas(lineOf(text(), 'description:'), 'the description', ['lands its own close-out commits', 'a queued `landing` PR', 'ADR 0028'])
  assertHas(text(), 'close', ['Landing does not wait.'])
  const auto = lineOf(text(), '- **Auto-execute, no asking**')
  assertHas(auto, 'the Auto-execute line', ['**Land the close-outs**', 'ADR 0028', 'step 7.1'])
})

test('7.1: (a) to (e) intact, (f) hands the path to landing and never calls land.sh', () => {
  const l = s71()
  assertHas(l, 'step 7.1', [
    '(a) `top=$(git -C "$(dirname <path>)" rev-parse --show-toplevel)`',
    '(b) Scan `git -C "$top" diff --cached --name-only` first',
    '(c) The half-applied-operation guard, which sub-step 2 shares',
    '(d) `git -C "$top" add -- <path>`',
    '(e) `git -C "$top" diff --cached --quiet -- <path>` exits 0 → `unchanged`, no commit.',
    '(f) Otherwise hand `<path>` to § Land the close-outs',
    'at the end of sub-step 7.2',
    'Never call land.sh from this sub-step.',
    '`📝 docs(thread): save — <one line>` under `/thread:open save`',
  ])
  assert.ok(!l.includes('land.sh "'), 'step 7.1 invokes land.sh')
  assert.ok(!l.includes('commit -m'), 'step 7.1 still commits with commit -m')
})

test('7.2: one landing commit per repo, the guard and rm -f kept, landing is its last act', () => {
  const l = s72()
  assertHas(l, 'step 7.2', [
    'handed to landing', 'one commit per repo', 'rm -f <abs path>', 'guard kept is **not** carried',
    'A doc reported `not versioned` is not handed', 'the last act of this sub-step', 'before sub-step 3',
    'once per repo', 'It also runs when the handoff scan failed',
  ])
  for (const gone of ['one file per commit', 'on the branch the work is on', 'commit -m']) {
    assert.ok(!l.includes(gone), `step 7.2 still says ${gone}`)
  }
})

test('7.2: the half-applied guard is 7.1(c)\'s, located through git (p19-9)', () => {
  const l = s72()
  assertHas(l, 'step 7.2', [
    '`rebase-merge`, `rebase-apply`, `MERGE_HEAD`, `CHERRY_PICK_HEAD` or `BISECT_LOG`',
    '[ -e "$(git -C "$(dirname <doc>)" rev-parse --path-format=absolute --git-path <name>)" ]',
    'so a linked worktree works too', "7.1(c)'s guard",
  ])
  assert.ok(!l.includes('under `.git/`'), 'step 7.2 still locates the markers under .git/')
  assert.ok(!s71().includes('stricter form'), 'step 7.1 still calls its guard stricter than 7.2\'s')
})

test('§ Land the close-outs sits after Commit hygiene and before step 8', () => {
  const t = text()
  const h = t.indexOf('\n### Land the close-outs\n'), c = t.indexOf('\n### Commit hygiene (both repos)\n')
  const s8 = t.indexOf('\n8. **Print the "What landed" report')
  assert.ok(h > 0 && c > 0 && s8 > 0, 'a heading or step 8 is missing')
  assert.ok(c < h && h < s8, '§ Land the close-outs is not between Commit hygiene and step 8')
})

test('§ Land the close-outs: when, what is collected, the message, the call', () => {
  assertHas(LAND(), '§ Land the close-outs', [
    '`${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/land.sh`',
    'Only at the end of sub-step 7.2', 'once per repo', 'after every repo\'s handed paths are collected',
    '7.1\'s THREAD.md, unless it was `unchanged` or `not versioned`', '7.2\'s refreshed pending doc',
    '7.2\'s guard-allowed deletions outside `~/repos/workspaces`',
    'Never handed: kept docs', '`unchanged` refreshes, workspaces deletions',
    'even when THREAD.md is `unchanged`',
    '`📝 docs(handoff): refresh <slug> at close`', '`🔧 chore(handoff): <slug> consumed — delete (history keeps it)`',
    'the 7.1 close-out or save subject', 'a `mktemp` file written by a quoted heredoc',
    'effective slug', 'falls back to the repo\'s basename',
    '`top` may be a removed directory', 'nearest existing ancestor',
    'Landing does not wait', '`mode=\'\'` in close', 'set `mode=\'--commit-only\'` for every call',
    'its own Bash tool call', 'timeout 600000', 'Never chain', 'one after another',
    'stuck only when origin\'s new changes overlap a local change', 'never pre-staged work',
    '`queued: needs merge <url>`', '`land: commit <sha>`', '`land: carried <N> earlier close-out commit(s)`',
    '7.2\'s consumed review docs, still on disk (land.sh deletes them)',
    'A consumed review doc\'s deletion rides the close-out landing; there is no other route',
    'a `status: pending` review doc or any other `docs/reviews/` change',
    '`🔧 chore(review): consumed review docs — delete (history keeps them)`',
  ])
})

test('the # thread:land fence: one land.sh line, last, and no git add or git commit', () => {
  const fence = fencedBlocks(LAND() ?? '').find((b) => b.some((l) => l.startsWith('# thread:land')))
  assert.ok(fence, 'no # thread:land fence in § Land the close-outs')
  const body = fence.join('\n')
  assert.equal(fence.filter((l) => l.includes('land.sh') || l.includes('"$ld"')).length, 3, 'expected ld=, the guard, and one call')
  assert.equal(fence.filter((l) => l.startsWith('bash "$ld"')).length, 1, 'exactly one bash "$ld" line')
  assert.equal(fence.at(-2), 'bash "$ld" ${mode:+"$mode"} --slug "$slug" -F "$msg" -- "$top" <paths>')
  assert.equal(fence.at(-1), '# end thread:land')
  assert.ok(body.includes("<<'MSG'"), 'the message is not a quoted heredoc')
  for (const bad of ['git add', 'git commit']) assert.ok(!body.includes(bad), `the fence holds ${bad}`)
})

test('Guardrails: own work only; never touch a branch is gone', () => {
  assertHas(GUARD(), '§ Guardrails', [
    '**Own work only**', 'through land.sh', 'to the default branch or to a `close/…` branch it creates',
    'never force-pushes, rewrites a local merge, deletes a branch, or fetches into or moves a branch other than the default',
    "Another session's branch is still only reported",
  ])
  assert.ok(!text().includes('Never touch a branch'), 'the old guardrail survives')
})

test('step 8: landing rows, the SHA source, and the stuck and dropped mappings', () => {
  assertHas(STEP8(), 'step 8', [
    '`landing <top>: <result line>`', '` (carried <N> earlier close-out commit(s))`',
    'filled only after that repo\'s landing call', 'from its `land: commit <sha>` stderr line',
    'When they share a repo, they share one SHA',
    'No row for `landed` with `land: nothing to land`, for `not landed: swept by the daily sweep` or for `not landed: commit-only`',
    '`not landed: no push access` does get a row',
    '**`stuck:` together with `land: nothing committed`.**', 'each handed path maps to `not versioned: <path> (<reason>)`',
    '**A `dropped` path**', '`not versioned: <path> (not on disk)`',
    '`landing <top>: stuck: land.sh failed (<first stderr line>)`',
  ])
})

test('step 9: four banners byte for byte, C beats D, D beats B, and B beats A', () => {
  const s = STEP9()
  assertHas(s, 'step 9', [BANNER_A, BANNER_B, BANNER_C, BANNER_D, 'C beats D, D beats B, and B beats A', 'Thread NOT closed'])
  assert.ok(s.indexOf(BANNER_A) < s.indexOf(BANNER_B) && s.indexOf(BANNER_B) < s.indexOf(BANNER_C) && s.indexOf(BANNER_C) < s.indexOf(BANNER_D), 'banners out of order')
  assertHas(s, 'step 9 selection', ['No landing row is landed, queued or stuck', 'Some landing row is `landed` or `queued`', 'Any landing row is `stuck:`'])
})

test('Edge cases name the landing cases', () => {
  const e = EDGES()
  assertHas(e, '§ Edge cases', [
    'before landing\'s fetch', 'Landing runs once per repo at the end of 7.2', 'one Bash call per repo',
    'never commits pre-staged work', 'landing register', 'no GitHub origin', 'swept by the daily sweep',
    '`not landed: no push access`', 'Push access unknown',
    '**A non-default checkout**', 'never fetched into or fast-forwarded',
    '`queued: needs merge`', '`/thread:open save`', '`--commit-only`', 'An older close-out PR still queued',
    'refuses direct pushes', '**Origin moved with local changes** → landed unless a local change overlaps origin\'s, then stuck until that file is committed or stashed',
  ])
  assert.ok(!e.includes('close never fetches'), 'the old "close never fetches" edge case survives')
})

test('rollout clones (ADR 0042): the rungs, 7.2 and landing read a clone as its twin and never hand a path in it', () => {
  const ident = section(text(), /^## Identify the active thread/) ?? ''
  const rung = (n) => ident.split('\n').find((l) => l.startsWith(`${n}. `)) ?? ''
  assertHas(rung(1), 'close rung 1', ['a CWD inside a rollout clone reads as the same directory in its in-place twin', '`self-rollout-check.sh --in-place`'])
  assertHas(rung(3), 'close rung 3', ['or its twin when `self-rollout-check.sh --in-place` names one', "a rollout clone's copy"])
  const l = s72() ?? ''
  const reviews = l.slice(l.indexOf('**Consumed review docs.**'))
  assertHas(reviews, "7.2's Consumed review docs clause", ["in the CWD's repo, read as its in-place twin when `self-rollout-check.sh --in-place` names one",
    'A rollout clone is never handed'])
  assert.ok(!reviews.includes("and in the CWD's repo when that is another git repo"), "7.2 still hands the CWD's repo unqualified")
  assertHas(l, "7.2's **Rollout clones** sentence", ['**Rollout clones.**', 'git -C <clone> checkout -- <rel>', '`left in rollout clone: <path>',
    'A mark another session set is never touched'])
  assertHas(slice(LAND(), /^\*\*Collecting per repo\.\*\*/, /^\*\*Review docs\.\*\*/), '**Collecting per repo**', ['never a path inside a rollout clone'])
  assertHas(STEP8(), 'step 8', ['`left in rollout clone: <path> (written before ADR 0042: land its deletion by a PR from a worktree)`'])
  assertHas(EDGES(), '§ Edge cases', ['**Not inside `~/repos/workspaces/` or its rollout clone `~/repos/workspaces-rollout/`.**'])
})

test('condition 2 still never merges, pushes or fetches to prove it', () => {
  assertHas(lineOf(text(), '**Condition 2 — landed on the default branch.**'), 'condition 2', ['Close never merges, pushes or fetches to prove it.'])
})
