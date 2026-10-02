// Close flips a finished task itself, within a guard (ADR 0026 § Decision 4, amending ADR 0011).
// close § A finished task closes itself marks an existing vault task `done` without asking only when
// all three conditions hold: the session was explicitly working it, the work is on the default branch
// (or is not code), and its Verify line ran green. A worked task short of that becomes a mark-done
// option in step 6's question, never a silent flip; every flip is reported in step 8. Candidacy is the
// task's own work, never bookkeeping. The flip set is fixed at the head of step 4 and never becomes the
// set-down's next task. open's pickup completes only a capture, so an ordinary task stays open until
// close proves it done, and task-writer § 5 makes a capture taken mid-task name that task. Reads files only; a missing file or
// section is a named assertion failure, never a crash at load.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readIf, slice, section, assertHas, lineOf, collapse } from '../lib/contract-text.mjs'

const CLOSE = 'skills/close/SKILL.md'
const OPEN = 'skills/open/SKILL.md'
const ORIENT = 'skills/orient/SKILL.md'
const WRITER = 'skills/_shared/task-writer.md'

// The one sentence close § Why this exists and CONTEXT.md's Close entry share, byte for byte.
const WHY = 'For vault tasks close only proposes, with one exception: it marks a task this session explicitly worked `done` without asking when the work is on the default branch (or is not code) and its Verify line ran green; a task short of that becomes a mark-done question (ADR 0026).'

// Cut at bullet and paragraph starts on the raw text, then at sentences inside each chunk.
const sentences = (t) => t.split(/\n(?=[ \t]*- )|\n[ \t]*\n/)
  .flatMap((chunk) => collapse(chunk).trim().split(/(?<=\.) (?=[A-Z`(*\[])/))
  .filter((s) => s.length > 0)
const SEC = () => section(readIf(CLOSE), /^## A finished task closes itself/)

const REQUIRED = {
  // Headline rules.
  'adr': /ADR 0026/,
  'amends': /amends ADR 0011/,
  'all-three': /only when all three conditions hold/,
  'cond1': /\*\*Condition 1 — explicitly working it\.\*\*/,
  'cond2': /\*\*Condition 2 — landed on the default branch\.\*\*/,
  'cond3': /\*\*Condition 3 — its Verify line ran green\.\*\*/,
  'fallback': /fails any condition becomes a mark-done option/,
  'new-gated': /New tasks stay gated/,
  'no-search': /never searches the vault for tasks that look finished/,
  // Condition 1.
  'route-a': /open's `\[\[<task>\]\]` pickup ran on this task/,
  'pasted-capture': /or its pasted `## Resume prompt`, whose first instruction closes it/,
  'hands-on': /run by orient's Hands-on steer/,
  'either-branch': /picked this task note as its focus item, by either branch/,
  'opened-from': /counts as opened from it/,
  'elsewhere': /named only elsewhere in the capture or doc does not/,
  'pre-session': /as it stood before this session's first write to it/,
  'judged-before': /judged before this close/,
  'earlier-save': /earlier `\/thread:open save` in this session never count/,
  'similarity': /matched by topic or similarity never satisfies condition 1/,
  // Condition 2.
  'gh': /gh pr view <url> --json state,headRefOid/,
  'merged': /`MERGED`/,
  'ancestor': /merge-base --is-ancestor/,
  'open-pr': /An open PR or an unmerged branch fails condition 2/,
  'no-fetch': /never merges, pushes or fetches/,
  'code-default': /treat it as a code task/,
  // Condition 3.
  'verify': /`\*\*Verify:\*\*`/,
  'after-change': /after the last change to the work/,
  'no-verify': /No Verify line fails condition 3/,
  'merge-not-change': /a merge or squash commit does not count/,
  'head-tested': /`headRefOid` is the commit the Verify run tested/,
  'push-after': /A commit pushed after the run is a change/,
  // Evidence rule.
  'compaction': /survives only in a compaction summary/,
  'evidence-fails': /that condition fails and the task goes to the mark-done question/,
  'never-auto': /It never flips automatically/,
  // Candidacy.
  'candidacy': /at `status: open`, `in_progress` or `review`/,
  'worked-def': /Worked means this session did the task's own work/,
  'mention-not-work': /A bare mention in chat is not work/,
  'bookkeeping': /Bookkeeping writes \(orient's reshuffle, `\/thread:schedule`'s `rollout:` and `scope:` stamps, reconcile writes, slot fills, frontmatter edits\) never make a task a candidate/,
  'not-candidate': /any other status \(`done`, `blocked`, `parked`\) is not a candidate/,
  'first-match': /in this order, and the first that matches decides/,
  'partial-row': /task flip skipped: \[\[<task>\]\] partly landed \(<what remains>\)/,
  'unchecked': /unchecked `- \[ \]`/,
  // Ordering.
  'fixed-at-4': /The flip set is fixed at the head of step 4, before step 4 writes the Resume instructions and before step 6 asks/,
  'pre-close-judged': /Nothing steps 4–5 compute can change it/,
  // The write.
  'set-or-replace': /sets \(or replaces\) `completed: <today>`/,
  'never-duplicated': /is overwritten in place, as `reconcile-project\.py` does, and never duplicated/,
  'never-next': /A flipped task is never the next task/,
  'match-skips': /step 5's next-task match \(`[^`]*task-writer\.md` § 4b, close's form\) skips it/,
  'resume-skips': /step 4's Resume instructions never name it as the next step/,
  'ticked-dropped': /ticked in step 6 is dropped from both/,
  'flips-first': /writes the flips and ticked options first, before the new tasks and before the set-down/,
}

// Every violation of the section's contract, as a list (empty when it holds).
function checkFlip(text) {
  if (text == null) return ['no section']
  const out = []
  const flat = collapse(text)
  for (const [name, re] of Object.entries(REQUIRED)) if (!re.test(flat)) out.push(`missing: ${name}`)
  const ss = sentences(text)
  // Rule E: the execute row belongs to a live rollout, never to a `review` task.
  for (const s of ss) {
    if (!/`task left for execute:/.test(s)) continue
    if (!/live rollout/.test(s)) out.push('exec-row without live rollout')
    if (/\breview\b/.test(s)) out.push('exec-row names review')
  }
  // Rule R: a `review` task with no live owner becomes a mark-done option, never the execute row.
  const review = ss.filter((s) => /`review`/.test(s) && /no live rollout owner/.test(s))
  if (review.length === 0) out.push('review-rule: no sentence')
  for (const s of review) {
    if (!/mark-done option/.test(s)) out.push('review-rule without mark-done option')
    if (/task left for execute/.test(s)) out.push('review-rule names execute row')
  }
  return out
}

test('T0: the splitter cuts at bullets, then at sentences', () => {
  assert.deepEqual(sentences('- A one. B two.\n- C `review` three.'), ['- A one.', 'B two.', '- C `review` three.'])
})

test('T1–T5: close § A finished task closes itself holds the guard', () => {
  assert.deepEqual(checkFlip(SEC()), [])
})

// Each mutation must bite: its anchor is present, and checkFlip names exactly the listed violations.
const MUTATIONS = [
  ['m1 compaction sentence deleted',
    "When a condition's evidence survives only in a compaction summary, or is otherwise uncertain, that condition fails and the task goes to the mark-done question.", '',
    ['missing: compaction', 'missing: evidence-fails']],
  ['m2 any two conditions', 'only when all three conditions hold', 'when any two conditions hold', ['missing: all-three']],
  ['m3 earlier-save sentence deleted',
    "Lines written by an earlier `/thread:open save` in this session never count either: they are close's own flow certifying itself.", '',
    ['missing: earlier-save']],
  ['m4 similarity satisfies', 'never satisfies condition 1', 'satisfies condition 1', ['missing: similarity']],
  ['m5 review reported as execute row', 'exactly that question.',
    'exactly that question. A task at `review` is reported as `task left for execute: [[<task>]]`.',
    ['exec-row without live rollout', 'exec-row names review']],
  ['m6 first branch only', 'by either branch', 'by its first branch', ['missing: either-branch']],
  ['m7 review rule split from mark-done', 'is never flipped: it becomes a mark-done option',
    'is never flipped. It becomes a mark-done option', ['review-rule without mark-done option']],
  ['m8 execute row names review', 'for a task under a live rollout.',
    'for a task under a live rollout or at `review`.', ['exec-row names review']],
  ['m9 review bullet deleted', /\n- A task at `review` with no live rollout owner[^\n]*/, '', ['review-rule: no sentence']],
  ['m10 any status a candidate', 'any other status (`done`, `blocked`, `parked`) is not a candidate',
    'any status is a candidate', ['missing: not-candidate']],
  ['m11 landing is a change',
    'The landing itself is not a change to the work either: a merge or squash commit does not count when',
    'The landing itself is a change to the work: a merge or squash commit counts even when',
    ['missing: merge-not-change']],
  ['m12 flipped task may be next', 'A flipped task is never the next task: step 5',
    'A flipped task may be the next task: step 5', ['missing: never-next']],
  ['m13 flips after the set-down',
    'writes the flips and ticked options first, before the new tasks and before the set-down',
    'writes the flips and ticked options after the set-down', ['missing: flips-first']],
  ['m14 bookkeeping makes a candidate', 'frontmatter edits) never make a task a candidate',
    'frontmatter edits) make a task a candidate', ['missing: bookkeeping']],
  ['m15 pasted Resume prompt dropped from route (c)',
    ', or its pasted `## Resume prompt`, whose first instruction closes it', '', ['missing: pasted-capture']],
  ['m16 flip set fixed in step 5', 'fixed at the head of step 4', 'fixed in step 5', ['missing: fixed-at-4']],
  ['m17 completed always added', 'sets (or replaces) `completed: <today>`', 'adds `completed: <today>`',
    ['missing: set-or-replace']],
  ['m18 a chat mention is work', ' A bare mention in chat is not work.', '', ['missing: mention-not-work']],
  ['m19 worked undefined', "Worked means this session did the task's own work", 'Worked means this session touched the task',
    ['missing: worked-def']],
]

for (const [name, from, to, want] of MUTATIONS) {
  test(`T11 ${name}`, () => {
    const sec = SEC()
    if (sec == null) return assert.fail('section missing')
    if (typeof from === 'string') assert.ok(sec.includes(from), `${name}: anchor missing`)
    else assert.match(sec, from, `${name}: anchor missing`)
    assert.deepEqual(checkFlip(sec.replace(from, to)), want, name)
  })
}

test('T6: step 6 asks the mark-done options beside the new tasks', () => {
  const step6 = lineOf(readIf(CLOSE), /^6\. \*\*Vault tasks/)
  assertHas(step6, `${CLOSE} step 6`, [
    /proposed vault tasks or mark-done options/,
    /one multiSelect question per kind/,
    /`Mark <[^>]+> done`/,
    /fails condition/,
    /Skip — leave it open/,
    /so is a tracked one whose tracking task is in the flip set/,
    /Any other tracked branch is never a candidate/,
    /Zero task candidates and zero mark-done options/,
    /\*Mark all N done\*/,
    /never merged into the new-task question/,
    /a mark-done option is never continuation/,
  ])
})

test('T7: sub-step 7.6 writes the flips first; step 8 reports them', () => {
  const close = readIf(CLOSE)
  assertHas(lineOf(close, /^ {3}6\. Approved vault tasks/), `${CLOSE} sub-step 7.6`, [
    /guarded flips and ticked mark-done options/,
    /written first/,
    /before the new tasks and before the set-down/,
    /do run under save/,
    '`completed: <today>`',
    /never duplicated/,
    /elsewhere the vault's daily sweep does/,
  ])
  const step8 = lineOf(close, /^8\. \*\*Print the "What landed" report/)
  assertHas(step8, `${CLOSE} step 8`, [
    '`task done: [[<task>]] (<route>; <landing evidence>; <Verify run>)`',
    '`task done (ticked): [[<task>]]`',
    '`task left for execute: [[<task>]]`',
    '`task flip skipped: [[<task>]] partly landed (<what remains>)`',
    '`Repo state: <line> — tracked by [[<task>]] (flipped done this close)`',
    '`Repo state: <line> — tracked by [[<task>]] (ticked done this close)`',
    /all on one line, rows joined with ` · `/,
  ])
  assert.doesNotMatch(step8, /`task done: \[\[<task>\]\][^`]*·/, 'a task-row reason must not nest the row separator')
})

test('T8: the intro bullets name the guarded flip and the mark-done option', () => {
  const close = readIf(CLOSE)
  assertHas(lineOf(close, '- **Propose first, then wait**'), `${CLOSE} Propose bullet`, [
    /new vault tasks/, /mark-done option/, /ADR 0026/, /except the execute-owned and partly-landed tasks/,
  ])
  assertHas(lineOf(close, '- **Auto-execute, no asking**'), `${CLOSE} Auto-execute bullet`, [/guarded flip/, 'step 7.1'])
})

test('T9: open completes only a capture at pickup; save runs the guarded flip', () => {
  const open = readIf(OPEN)
  const pickup = slice(open, /^### `\/thread:open \[\[<task>\]\]`/, /^### /)
  const step3 = slice(pickup, /^3\. \*\*Complete the capture\*\*/, /^4\. /)
  assertHas(step3, `${OPEN} pickup step 3`, [
    /`tags:` include `thread`/,
    /task-writer\.md` § 4\b/,
    /Any other task stays at its status/,
    /close\/SKILL\.md` § A finished task closes itself/,
    /marks it done when the work passes its guard and otherwise asks/,
    /set \(or replace\) `completed: <today>`/,
  ])
  assert.doesNotMatch(step3, /once the work lands/, `${OPEN} pickup step 3 must not promise an unconditional flip`)
  assert.doesNotMatch(step3, /sweep/i, `${OPEN} pickup step 3 must not promise a sweep`)
  assert.doesNotMatch(step3, /\bclear/i, `${OPEN} pickup step 3 must not clear a next-action field`)
  assertHas(slice(pickup, /^4\. /, /^$/), `${OPEN} pickup step 4`, ['task left open until close'])
  const save = slice(open, /^### `\/thread:open save`/, /^## /)
  assertHas(save, `${OPEN} save`, [/guarded flip of a finished task runs as at close/, /mark-done options/])
})

test('T10: orient skips the slot write only for a capture; CONTEXT and Why share one sentence', () => {
  const write = slice(slice(readIf(ORIENT), /^### 6\./, /^### 7\./), /^- \*\*The slot write\*\*/, /^- /)
  assertHas(write, `${ORIENT} § 6 slot write`, [/Skip the write when Hands-on\s+picks the task up/, /and it is a capture/])
  const ctx = slice(readIf('CONTEXT.md'), /^- \*\*Close\*\*/, /^- \*\*/)
  assertHas(ctx == null ? null : collapse(ctx), 'CONTEXT.md Close entry', [WHY])
  const why = slice(readIf(CLOSE), /^## Why this exists/, /^## /)
  assertHas(why == null ? null : collapse(why), `${CLOSE} § Why this exists`, [WHY])
})

test('T12: § Destinations routes an existing finished task', () => {
  const dest = slice(readIf(CLOSE), /^## Destinations/, /^## (?!Destinations)/)
  assertHas(lineOf(dest, '| An existing vault task this session finished'), `${CLOSE} Destinations row`, [
    '§ A finished task closes itself', '`completed: <today>`', 'Auto within the guard', '**Propose** (mark-done option)',
  ])
})

const EDGE_LABELS = [
  'Condition evidence only in a compaction summary',
  'A task named only in THREAD.md lines this session wrote',
  'A picked-up capture or handoff doc names the task',
  'Orient Hands-on on a task note',
  'A capture without the `thread` tag',
  'A task worked but never opened',
  'A squash-merged PR',
  'A touched task already done or on hold',
  "The finished task was the thread's next step",
  "A capture's Resume prompt pasted into a fresh session",
  'A task this session only did bookkeeping on',
  'A branch whose tracking task flips this close',
  'A task that already carries `completed:`',
]

test('T13: the flip set is never the next task; edge cases are named', () => {
  const close = readIf(CLOSE)
  assertHas(lineOf(close, /^5\. \*\*Compute the full save set silently\*\*/), `${CLOSE} step 5`, [
    /it skips the flip set/, /the flip set and the mark-done options/,
  ])
  const step4 = slice(close, /^4\. \*\*Compute the thread-update diff/, /^5\. /)
  assertHas(step4, `${CLOSE} step 4`, [
    /never naming a task in the flip set as the next step/,
    /fix the flip set and the mark-done options first/,
  ])
  assert.ok(step4 != null && step4.indexOf('fix the flip set') < step4.indexOf('Resume instructions:'), `${CLOSE} step 4 fixes the flip set before the Resume bullet`)
  assertHas(lineOf(close, /^5\. \*\*Compute the full save set silently\*\*/), `${CLOSE} step 5 (carry-over)`, [
    /the flip set and the mark-done options as step 4 fixed them/,
  ])
  const form = slice(slice(readIf(WRITER), /^## 4b\./, /^## 5\./), /^\*\*Close's form\.\*\*/, /^$/)
  assertHas(form == null ? null : collapse(form), `${WRITER} § 4b Close's form`, [
    /A task this close marks done\s+\(`close\/SKILL\.md` § A finished task closes itself\) is never the match/,
  ])
  const edge = slice(close, /^## Edge cases/, /^## (?!Edge)/)
  assert.ok(edge != null, `${CLOSE} § Edge cases is missing`)
  const lines = edge.split('\n')
  for (const label of EDGE_LABELS) {
    assert.ok(lines.some((l) => l.startsWith(`- **${label}`)), `${CLOSE} § Edge cases has no "${label}" bullet`)
  }
  const next = lines.find((l) => l.startsWith("- **The finished task was the thread's next step"))
  assertHas(next, `${CLOSE} edge case "next step"`, [/before the set-down/, /never handed a done task/])
  const pasted = lines.find((l) => l.startsWith("- **A capture's Resume prompt pasted into a fresh session"))
  assertHas(pasted, `${CLOSE} edge case "pasted Resume prompt"`, [/`First:` line closes the capture/, /route \(c\)/])
  const mention = lines.find((l) => l.startsWith('- **A task worked but never opened'))
  assertHas(mention, `${CLOSE} edge case "worked but never opened"`, [/this session did its work/, /only mentioned in chat[^.]*is not a candidate/])
  assert.doesNotMatch(mention ?? '', /a bare chat mention[^.]*mark-done/, 'a bare chat mention must not become a mark-done option')
  const branch = lines.find((l) => l.startsWith('- **A branch whose tracking task flips this close'))
  assertHas(branch, `${CLOSE} edge case "tracking task flips"`, [/`Merge or retire <branch>` candidate/, /\(ticked done this close\)/])
})

test('T14: task-writer § 5 makes a capture taken mid-task name the worked task', () => {
  const body = slice(readIf(WRITER), /^## 5\./, /^## 6\./)
  assertHas(body, `${WRITER} § 5 template`, [/^Read first: <the worked task's note path, if any;/m])
  assertHas(body == null ? null : collapse(body), `${WRITER} § 5 The worked task`, [
    /\*\*The worked task\.\*\*/,
    /the Resume prompt's `Read first:` line names that task by its absolute path/,
    /route \(c\)/,
    /A § 2 re-capture keeps the line/,
  ])
})
