// Close lands the session's own branch (ADR 0028 §§ 1–3, 5, 7; task p11-4). close SKILL.md judges the own
// branch by exact name (§ The own branch, ADR 0026 condition 1's test), then sub-step 7.9 runs § Land the own
// branch: land.sh's own-branch mode through the `# thread:land-own` snippet (tests/land.test.sh cases 42–70
// run it), an inline /fresh-review loop at the xhigh floor with no round cap, and the merge queued only after
// a clean round. The loop stops only on ADR 0028 § 3's three conditions and then holds the PR open with the
// diagnosis; nothing waits for CI or the merge, and the banner waits for the review loop only. Reads files
// only; a missing file or section is a named assertion failure, never a crash at load.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readIf, slice, section, assertHas, lineOf, fencedBlocks, collapse } from '../lib/contract-text.mjs'

const CLOSE = 'skills/close/SKILL.md'
const ADR = 'docs/adr/0028-agents-land-their-own-work.md'
const text = () => readIf(CLOSE)
const OWN = () => section(text(), /^## The own branch$/)
const SEC = () => section(text(), /^### Land the own branch$/)
const STOP = () => slice(SEC(), /^#### The stop rule$/, /^\*\*Rules\.\*\*$/)
const STEP2 = () => slice(text(), /^2\. \*\*Check git state/, /^3\. /)
const STEP6 = () => lineOf(text(), /^6\. \*\*Vault tasks/)
const STEP8 = () => slice(text(), /^8\. \*\*Print the "What landed" report/, /^9\. \*\*End with the closing banner/)
const STEP9 = () => slice(text(), /^9\. \*\*End with the closing banner/, /^## Edge cases/)
const EDGES = () => section(text(), /^## Edge cases/)
const GUARD = () => section(text(), /^## Guardrails/)
const FENCE = () => fencedBlocks(SEC() ?? '').find((b) => b.some((l) => l.startsWith('# thread:land-own')))

const CALL = 'bash "$ld" --own-branch --branch "$br" ${act:+"$act"} ${rev:+--reviewed} ${rev:+"$rev"} ${note:+-F} ${note:+"$note"} -- "$top"'
const QUEUE_READS = 'land.sh reads failures from the clean round\'s `head:` (`--reviewed`), whose CI ran while the round reviewed it, and from the pushed HEAD; HEAD\'s own result for a check supersedes; the merge decision reads HEAD alone, and no checks on HEAD in a repo with CI is pending, never green'
const ADR_STOP = 'the review ledger\'s regression stop, the same check failing the same way twice after effort has risen to `max`, or a finding that needs Lachy\'s decision'
const DIRTY_FIX = 'commit them, ignore them (.gitignore, or .git/info/exclude for local scratch), or remove them'
const BANNERS = {
  A: '**Thread closed. Safe to end this session — nothing valuable left in conversation state.**',
  B: '**Thread closed. Safe to end this session — pushed where the landing rows say; any own-branch review ran clean here; queued PRs are not merged yet, and nothing here waits for CI.**',
  C: '**Thread closed. Safe to end this session, but work is NOT queued to land in <repo>[, <repo>…]: see its landing row.**',
  D: '**Thread closed. Safe to end this session, but the review loop stopped on <branch>[, <branch>…]: its PR stays open with the diagnosis, see its landing row.**',
}
// pos <text> <re>: the offset of the first line matching <re>, or -1.
const pos = (t, re) => { const l = lineOf(t, re); return l == null ? -1 : t.indexOf(l) }
const count = (t, s) => t.split(s).length - 1

test('§ The own branch: detection by exact name, evidence in context, report-only for another session', () => {
  const o = OWN()
  assertHas(o, '§ The own branch', [
    'ADR 0028, Decision 1', 'ADR 0026 condition 1',
    "step 2's repo-state check names, on its `on <branch>, <N> commit(s) unmerged to <default>` line",
    '- (a) this session created it', '`git checkout -b <branch>`', '`git switch -c <branch>`', '`git worktree add -b <branch>`', 'EnterWorktree',
    '- (b) this session picked up a capture, a handoff doc or a task', 'this session committed on `<branch>`',
    '- (c) the active THREAD.md, as it stood before this session\'s first write to it, names `<branch>`',
    'by its exact name',
    '**Evidence, not memory.**', 'only in a compaction summary fails',
    "Close's own close-out commit never makes a branch its own",
    'A branch matched by topic or similarity never counts',
    '`/thread:execute`', 'is never own',
    'every task branch `/thread:execute` makes is `audit-fix/<alias>`', 'an `audit-fix/…` branch is never own',
    'known by its name, never by where it is checked out', 'The checkout path decides nothing',
    'EnterWorktree also puts its worktrees under `.claude/worktrees/`, and a branch this session made there is own by route (a)',
    "Another session's branch keeps today's report-only handling",
    '`not landed: not the cwd checkout`',
  ])
  // Route (a) accepts EnterWorktree, whose worktrees live under .claude/worktrees/, so that path never rules a branch out.
  assert.ok(!(o ?? '').includes('`.claude/worktrees/` checkouts'), '§ The own branch rules out `.claude/worktrees/` checkouts, which contradicts route (a)')
  const t = text()
  const a = t.indexOf('\n## A finished task closes itself'), b = t.indexOf('\n## The own branch\n'), c = t.indexOf('\n## Memory scope discipline')
  assert.ok(a > 0 && a < b && b < c, '§ The own branch is not between § A finished task closes itself and § Memory scope discipline')
})

test('step 2 judges the own branch; step 6 never proposes it; repo-state phrases hold', () => {
  const s2 = STEP2()
  assertHas(s2, 'step 2', [
    'first gets the own-branch judgement (§ The own branch)', 'recorded for sub-step 7.9', 'runs no search',
    'it gets the same own-branch judgement',
    'check failed', 'never read as "no feature branch"', 'tracking unknown', 'command grep -rlF', 'report-only',
  ])
  assertHas(STEP6(), 'step 6', ['the own branch is never a `Merge or retire` candidate', 'Merge or retire'])
})

test('§ Land the own branch sits after § Land the close-outs and before step 8', () => {
  const t = text()
  const lc = t.indexOf('\n### Land the close-outs\n'), lo = t.indexOf('\n### Land the own branch\n')
  const s8 = t.indexOf('\n8. **Print the "What landed" report')
  assert.ok(lc > 0 && lo > lc && s8 > lo, '§ Land the own branch is not between § Land the close-outs and step 8')
})

test('§ Land the own branch exists and orders push → review → queue', () => {
  const sec = SEC()
  assert.ok(sec != null, '§ Land the own branch is missing')
  const fence = pos(sec, /^# thread:land-own/)
  const review = pos(sec, /\/fresh-review/)
  const clean = pos(sec, /^\*\*A clean round\*\*/)
  const queue = pos(sec, /act='--queue'/)
  assert.ok(fence >= 0 && review >= 0 && clean >= 0 && queue >= 0, `an anchor is missing (${fence}, ${review}, ${clean}, ${queue})`)
  assert.ok(fence < review, 'the first /fresh-review mention comes before the push snippet')
  assert.ok(review < clean, 'the clean-round definition comes before the review')
  assert.ok(clean < queue, "act='--queue' comes before the clean-round definition")
  assert.equal(count(text(), "act='--queue'"), 1, "act='--queue' must occur exactly once in close")
  assert.ok(!FENCE().join('\n').includes('--queue'), 'the snippet carries --queue')
  assert.ok(!STOP().includes('--queue'), 'the stop rule mentions --queue')
  assertHas(collapse(sec), '§ Land the own branch', [
    'the merge is queued only after a clean round', "`--reviewed` is the clean round's `head:`",
    'This is the one inline review', 'close waits for each round\'s findings',
    '`/fresh-review code <level>`', 'with no target', '`@{upstream}...HEAD`',
    'points `<B>`\'s upstream at `origin/<default>`', 'point it back at `origin/<B>`',
    'a new commit, by pathspec, never an amend',
  ])
})

test('never clean: the clean-round conditions, and what can never count', () => {
  const sec = collapse(SEC() ?? '')
  assertHas(sec, 'the clean round', [
    'A round that says "nothing in scope", fails, is lost, or leaves no review doc is never a clean round and never leads to `--queue`',
    '`mode: code`', '`effort:` equal to the current level', '`head:` equal to HEAD at dispatch',
    '`diff_digest:` equal to `land: digest` and not `da39a3`', 'no accepted finding',
    'a `simplify` round never counts as clean',
    'every dispatch follows a plain call that printed `land: digest`',
    'Every third round is `/fresh-review simplify <level>` instead, which never gates alone',
  ])
})

test('the tree rule: a dirty tree is never reviewed, never touched, and holds with its fix', () => {
  const sec = collapse(SEC() ?? '')
  assertHas(sec, 'the tree rule', [
    '`land: tree dirty` means no dispatch',
    'close never stages, stashes or deletes files outside `docs/reviews/`',
    `uncommitted changes outside <B>: <paths> — ${DIRTY_FIX}; ignored files never block a landing`,
    '`Needs your call: <B> PR <url> — uncommitted changes outside <B>: <paths>`',
    'the files are left untouched',
  ])
})

test('the review docs: consumed, deleted in one docs/reviews/-only commit before --queue or --hold', () => {
  const sec = SEC() ?? ''
  const c = collapse(sec)
  assertHas(c, 'the review docs', [
    'marked `status: consumed` in a `docs/reviews/`-only commit',
    'every doc this loop wrote is deleted in one `docs/reviews/`-only commit before `--queue` or `--hold`',
    'The ledger still reads deleted docs from git history',
    "stands in for fresh-review's close-out-commit deletion, because 7.2 runs before the loop",
    'A session ended mid-loop leaves its docs pending on `<B>`',
  ])
  const del = pos(sec, /every doc this loop wrote is deleted in one/)
  assert.ok(del >= 0 && del < pos(sec, /act='--queue'/), "the deletion rule does not come before act='--queue'")
})

test('what --queue reads: one snapshot of the reviewed commit and HEAD, never green on no checks', () => {
  const c = collapse(SEC() ?? '')
  assertHas(c, 'what --queue reads', [
    QUEUE_READS,
    'no checks on HEAD in a repo with CI is pending, never green',
    "after a `ci failed`, the next round's `head:` is a newer pushed commit, so its CI is a fresh run".replace(/^a/, 'A'),
    'every commit after it touches `docs/reviews/` only',
  ])
})

test('the loop re-runs Verify after fixes, before the next dispatch; ci failed goes through it and the ledger', () => {
  const sec = SEC() ?? ''
  const c = collapse(sec)
  assertHas(c, 'loop step 7', [
    "7. **Verify.** After the round's fix commits and before the next dispatch, re-run the task's `**Verify:**` line",
    "the repo's own test command",
    'Every commit outside `docs/reviews/` since the last green run needs it, a `ci failed` fix included',
    'A red run is handled like `ci failed`: count its key (§ The stop rule), fix the cause in a new commit, and run this step again.',
    'Only a green run goes on to the ledger.',
    'in a repo with no CI, `--queue` merges on no checks',
    '8. **Ledger.**', 'runs before every re-dispatch, after step 7',
    "Then loop steps 7 and 8 (Verify, Ledger), as after any round's fixes, which lead to the next round.",
  ])
  const fix = pos(sec, /^6\. \*\*Fix\.\*\*/), ver = pos(sec, /^7\. \*\*Verify\.\*\*/), led = pos(sec, /^8\. \*\*Ledger\.\*\*/)
  assert.ok(fix >= 0 && fix < ver && ver < led, 'the loop is not Fix → Verify → Ledger')
  assert.ok(!c.includes('Then the next round, from step 1'), 'ci failed skips the Verify and Ledger steps')
})

test('#### The stop rule: the three ADR conditions, keys, infra, max, and the hold', () => {
  const stop = STOP()
  const c = collapse(stop ?? '')
  assertHas(c, '#### The stop rule', [
    ADR_STOP, 'There is no round cap',
    'The key is the `ci failed:` line without its URL: check name, conclusion and title.',
    'Only `failure` conclusions reach the key: `cancelled`, `timed_out`, `startup_failure`, `action_required`, `stale` and a status `error` are infrastructure, which never count and never raise effort.',
    'The second failure with one key raises effort to `max`, and effort never lowers.',
    'The stop is two failures with one key, both counted on rounds that really ran at `max`',
    'failures from rounds below `max` never count towards it',
    'A `ci failed` belongs to the round whose clean `head:` it read, and a red Verify run to the round whose fixes it ran.',
    'A check with no title prints `(failure)`, so its key is the name and conclusion alone.',
    'A red Verify run (loop step 7) counts the same way, keyed `verify <command>: <first failing test or error line>`.',
    'A round counts as `max` only when its doc says `effort: max` and the wrapper reports a finder fan-out.',
    '`printenv CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`',
    /`max unavailable`[^.]*is a decision for Lachy: `--hold`/,
    'a `review-ledger.py` exit other than 0 or 1 is a hold (`review ledger failed`)',
    '`review-ledger.py` exit 1 is the stop (`ledger regression`)',
    "Every stop calls `--hold` with the diagnosis before step 8's report and the banner",
    'leaves the PR open with auto-merge off',
    'Close never asks: the question goes on a `Needs your call:` row',
    'xhigh floor', 'Opus lock',
    'the diagnosis as its comment',
  ])
  const adr = collapse(readIf(ADR) ?? '')
  assert.ok(adr.includes(ADR_STOP), 'the ADR 0028 § 3 wording has drifted from the stop rule')
})

test('mid-loop auto-merge is off, and nothing waits for CI', () => {
  const sec = SEC() ?? ''
  const c = collapse(sec)
  assertHas(c, '§ Land the own branch', [
    'every call but `--queue` switches it off',
    'close does not wait for CI',
    "A red CI or a PR left behind master after close ends is the daily lander's and the next close's",
    'It never waits for CI or for the merge',
  ])
  for (const bad of ['--watch', 'sleep', 'gh pr checks']) assert.ok(!sec.includes(bad), `§ Land the own branch holds ${bad}`)
  for (const bad of ['--watch', 'gh pr checks']) assert.ok(!text().includes(bad), `close holds ${bad}`)
  assertHas(c, 'the read-only CI log', ['`gh run view <run id> --log-failed`'])
})

test('the # thread:land-own fence: one land.sh call, last, and no push, gh, force or positional', () => {
  const fence = FENCE()
  assert.ok(fence, 'no # thread:land-own fence in § Land the own branch')
  assert.equal(fence.filter((l) => l.startsWith('bash "$ld"')).length, 1, 'exactly one bash "$ld" line')
  assert.equal(fence.at(-2), CALL)
  assert.equal(fence.at(-1), '# end thread:land-own')
  assert.ok(fence.includes("top='<top>' br='<branch>' act='' rev='' note=''"), 'the placeholders line has changed')
  assert.ok(!fence.join('\n').includes('slug'), 'the own snippet carries a slug land.sh does not read')
  assertHas(collapse(SEC() ?? ''), '§ Land the own branch', ['land.sh reads the GitHub slug from `origin` itself, so there is no `slug` to fill'])
  assert.ok(fence.join('\n').includes("<<'DIAG'"), 'the diagnosis is not a quoted heredoc')
  const body = fence.join('\n')
  for (const bad of ['git push', '--force', '-f ', '-f"', '-f\'']) assert.ok(!body.includes(bad), `the fence holds ${bad}`)
  assert.ok(!/(^|[^\w-])gh\b/.test(body), 'the fence calls gh')
  assert.ok(!/\$\{?[0-9]/.test(body), 'the fence holds a positional parameter')
})

test('step 8: the own-branch rows, verbatim', () => {
  assertHas(STEP8(), 'step 8', [
    '`landing <top> <branch>: <result line> · review: <N> round(s) at <level>, clean[ · ci: <K> red run(s) fixed]`',
    '`landing <top> <branch>: held <url> · review: <N> round(s) at <level>, stopped (<stop>)`',
    '`ledger regression`', '`ci <name> (failure: <title>) failed twice at max`', '`needs your call`', '`max unavailable`',
    '`uncommitted changes outside <branch>`',
    '`Needs your call: <branch> PR <url> — <finding or precondition>`',
    '`landing <top> <branch>: <not landed:|landed|stuck:> …` when the first call ends 7.9 before any review, with no review suffix',
    "` · rides <B>'s PR`",
    '`ci failed:` is never a final row',
    "`Repo state: <line> — own branch, see its landing row (7.9)` for an own branch (§ The own branch), whatever 7.9's outcome",
    '`verify <command> failed twice at max`',
  ])
})

test('step 9: four banners byte for byte, chosen C, D, B, A, after the loop and never waiting for CI', () => {
  const s = STEP9()
  assertHas(s, 'step 9', [
    ...Object.values(BANNERS), 'C beats D, D beats B, and B beats A',
    "The banner is printed only after § Land the own branch's loop ends", 'never waits for CI or the merge',
    'Any landing row is `held`, and none is stuck', 'and none is held or stuck', 'and none is held (no landing call',
  ])
  const at = (k) => s.indexOf(BANNERS[k])
  assert.ok(at('A') < at('B') && at('B') < at('C') && at('C') < at('D'), 'banners out of order')
})

test('placement, guardrails, edges and the Auto-execute line', () => {
  const t = text()
  const s78 = t.indexOf('\n   8. **Auto-commit vault repo**'), s79 = t.indexOf('\n   9. **Land the own branch**')
  assert.ok(s78 > 0 && s79 > s78, 'sub-step 7.9 does not follow 7.8')
  assertHas(lineOf(t, /^ {3}9\. \*\*Land the own branch\*\*/), 'sub-step 7.9', ['§ Land the own branch', 'Skipped under `/thread:open save`', "before step 8's report"])
  assertHas(GUARD(), '§ Guardrails', [
    'The one exception is the own branch (§ The own branch), also through land.sh: it pushes without force, moves `<B>` only forward, makes every fix a new commit, never deletes `<B>`, and never touches uncommitted files outside `docs/reviews/`.',
    'never force-pushes, rewrites a local merge, deletes a branch, or fetches into or moves a branch other than the default',
  ])
  assertHas(EDGES(), '§ Edge cases', [
    '`git branch --set-upstream-to origin/<B> <B>`', '**A session ended mid-loop',
    'the close-out landing pushes nothing', 'never fetched into or fast-forwarded',
    "When that branch is the own branch, § Land the own branch pushes it, the close-out commit included",
    '**A dirty tree on the own branch**', '**A `ci failed` with no cause in `<B>`**', '`not landed: not the cwd checkout`',
    "`not landed: PR <url> belongs to <login>`", 'closed unmerged is `stuck:`',
    'its condition 2 fails at step 4',
  ])
  const desc = lineOf(t, 'description:')
  assertHas(desc, 'the description', ["lands the session''s own branch: `/fresh-review` inline, fixes, merge queued only after a clean round (§ Land the own branch)"])
  assertHas(lineOf(t, '- **Auto-execute, no asking**'), 'the Auto-execute line', [
    "lands the session's own branch: `/fresh-review` inline, fixes, merge queued only after a clean round", 'step 7.1',
  ])
  assertHas(collapse(slice(t, /^## Why this exists/, /^## /) ?? ''), '§ Why this exists', ['land its close-out and its own branch'])
})

test('ADR 0028 Consequences: the upstream side effect and its restore command', () => {
  const cons = collapse(section(readIf(ADR), /^## Consequences/) ?? '')
  assertHas(cons, 'ADR 0028 § Consequences', [
    "points `<B>`'s upstream at `origin/<default>`", 'restores `origin/<B>` when it queues or holds',
    '`git branch --set-upstream-to origin/<B> <B>`',
  ])
})
