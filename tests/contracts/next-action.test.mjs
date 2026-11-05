// The next-action slot (estate ADR 0008, decisions 4 and 7 — ~/repos/workspaces/_shared/docs/adr/
// 0008-next-action-slot.md; not this repo's ADR 0008). task-writer § 4b is the one set-down write, run
// through skills/_shared/scripts/next-action.py (its behaviour is tests/next-action.test.mjs): the
// capture's `next_action:` from the resume prompt's `Next move`, and `next_task:` on every project note
// the capture links, overwriting (most recent set-down wins, stash exactly like defer); close writes only
// for a concrete next task it never invents, and stands down for a pending handoff; `/thread:open save`
// is no set-down. stash, defer and close cite § 4b; open's pickup leaves both fields alone (a dead link
// reads as blank; nothing rewrites it); orient reads the slot first through the script, frames its one
// recommendation as a proposal against it, and fills it only when blank. Reads files only; a missing
// file or section is a named assertion failure, never a crash at load.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readIf, slice, assertHas, textFiles, lineOf, collapse } from '../lib/contract-text.mjs'

const WRITER = 'skills/_shared/task-writer.md'
const CLOSE = 'skills/close/SKILL.md'
const STASH = 'skills/stash/SKILL.md'
const DEFER = 'skills/defer/SKILL.md'
const OPEN = 'skills/open/SKILL.md'
const ORIENT = 'skills/orient/SKILL.md'
const SCRIPT = 'skills/_shared/scripts/next-action.py'
const SCRIPT_CITE = `\${CLAUDE_PLUGIN_ROOT}/${SCRIPT}`
const ESTATE_ADR = '~/repos/workspaces/_shared/docs/adr/0008-next-action-slot.md'

const s4b = () => slice(readIf(WRITER), /^## 4b\./, /^## 5\./)

test('task-writer § 4b is the set-down write, through the script', () => {
  assertHas(s4b(), `${WRITER} § 4b`, [
    ESTATE_ADR,
    /\*\*the most recent\s+set-down wins\.\*\*/,
    // Stash is not a weaker writer: it overwrites exactly as defer does.
    /Stash runs this\s+exactly as defer does/,
    /`\/thread:open save` is not a\s+set-down/,
    // The task's line: grain rule, sourced from the resume prompt.
    /verb-first, one physical action/,
    /resume prompt's\s+`Next move:` line/,
    // The write is the script, never a hand edit of YAML.
    /\*\*The write — never by hand\.\*\*/,
    `${SCRIPT_CITE} set-down`,
    /--action - <<'EOF'/,
    /never put the line in shell quotes/,
    /re-parses every edit before saving/,
    /Exit 3\s+means no vault or no PyYAML/,
    /never retry the write by hand/,
    // The project pointer: every linked project note, never an area note.
    /for every link in the task's\s+`projects:`/,
    'next_task: "[[<task-basename>]]"',
    /`tags:` include\s+`project`/,
    /area\s+landing note/,
    // The pointer never lands before its target.
    /The task\s+file goes first/,
  ])
})

test('task-writer § 4b gives close a no-invention form', () => {
  const close = slice(s4b(), /^\*\*Close's form\.\*\*/, /^$/)
  assertHas(close, `${WRITER} § 4b "Close's form"`, [
    /never invents one/,
    /pending handoff doc owns the thread's continuation/,
    /captures --slug <thread slug> --thread-file\s+<THREAD\.md> --for-close/,
    /matched \*\*concretely\*\*/,
    /before step 7\.6 creates\s+any task/,
    /A loose end never qualifies/,
    /never an older capture's\s+`Next move:`/,
    /write neither field and leave every\s+project slot as it is/,
  ])
})

// Close's Now refresh (p38-1): the agent writes the block from THREAD.md's Where we are, the script places it in each
// targeted project note's `## Now` that names the closing thread's file (its behaviour is tests/next-action.test.mjs).
test("task-writer § 4b gives close a Now refresh: the agent writes, the script places, only in this thread's Now", () => {
  const para = slice(s4b(), /^\*\*Close's Now\.\*\*/, /^This section is the only overwrite/)
  assertHas(para && collapse(para), `${WRITER} § 4b "Close's Now"`, [
    `${SCRIPT_CITE} now`,
    '--thread-file',
    "--text - <<'EOF'",
    'As of <today>, from the thread:',
    /at most five lines/,
    /Where we are/,
    // The path: the active thread's resolved file, a rollout clone's in-place twin's, never the clone's copy.
    /the same path step 5 passes to `captures --thread-file`/,
    /in-place twin/, /§ Repo-thread lookup/,
    // The thread guard, and its match recorded once.
    /names that thread file/, "not this thread's Now",
    /percent-encoded/, /`THREAD\.md\.bak` never counts/,
    /no `As of` line is left alone/,
    /never adds a `## Now`/,
    /stash and defer leave the Now alone/,
    'Now not written: <stderr>',
    /never edit the note by hand/,
    // The empty-root carve-out: python3's own exit 2 is no refusal, plugin-root.md rule 4's re-run.
    "can't open file '/skills/…'",
    /`plugin-root\.md` rule 4/,
  ])
})

test('task-writer § 4 leaves next_action to the script; § 2 finds captures through it', () => {
  const s4 = slice(readIf(WRITER), /^## 4\./, /^## 4b\./)
  assert.doesNotMatch(s4 ?? '', /^next_action:/m, `${WRITER} § 4's template must not hand-write next_action`)
  assertHas(s4, `${WRITER} § 4`, [/`next_action:` is not in this template/])
  const s2 = slice(readIf(WRITER), /^## 2\./, /^## 3\./)
  assertHas(s2, `${WRITER} § 2`, [
    `${SCRIPT_CITE} captures`, /inline or block-list `tags:`/, /rewrite § 4b's two fields/,
    // A follow-up or rollout task that merely links the THREAD.md is never listed as a capture.
    /merely links the THREAD\.md is not a capture\s+and is never listed/,
  ])
  assert.doesNotMatch(s2, /rg -l '\^tags:/, `${WRITER} § 2 must not use the inline-only tags grep`)
  const s7 = slice(readIf(WRITER), /^## 7\./, null)
  assertHas(s7, `${WRITER} § 7`, [
    /Next action: <the § 4b line>/, /next task on <Project>/, /every `skip` row with its reason/, /Next action not written: <stderr>/,
  ])
})

test('the overwrite rule and the dead-link rule each have one home under skills/', () => {
  const homes = (re) => textFiles('skills').filter(({ text }) => re.test(text)).map(({ file }) => file)
  assert.deepEqual(homes(/most recent\s+set-down wins/), [WRITER], `"most recent set-down wins" belongs to ${WRITER} only`)
  // The dead statuses are the script's DEAD_STATUSES; no skill's prose restates them, every one cites it.
  // (Other scripts may share the statuses for their own rules — reconcile-project.py's LANDED set.)
  const prose = homes(/done,\s+merged/).filter((f) => f.endsWith('.md'))
  assert.deepEqual(prose, [], `skill prose restates the dead-status list instead of citing ${SCRIPT}: ${JSON.stringify(prose)}`)
  assertHas(readIf(SCRIPT), SCRIPT, [/^DEAD_STATUSES = \{"done", "merged", "dropped"\}$/m])
})

test('stash, defer and close cite task-writer § 4b and its script', () => {
  for (const [file, step] of [
    [STASH, /^1\. \*\*Write the capture task\*\*/],
    [DEFER, /^2\. \*\*Write the capture task\*\*/],
  ]) {
    const write = slice(readIf(file), step, /^\d+\. /)
    assertHas(write, `${file} "Write the capture task" step`, [
      'skills/_shared/task-writer.md', /§ 4b\b/, /`next-action\.py set-down`/, /estate ADR 0008/,
    ])
    // Stash and defer never rewrite Where we are, so they never refresh the Now.
    assert.doesNotMatch(write, /next-action\.py now/, `${file} must not run the Now refresh`)
  }
  const close = readIf(CLOSE)
  const sub6 = lineOf(close, /^ {3}6\. Approved vault tasks/)
  assertHas(sub6, `${CLOSE} step 7.6`, [
    'skills/_shared/task-writer.md', /§ 4b, close's form/, /estate ADR 0008/, /`next-action\.py set-down`/,
    /the set-down write for the task step 5 matched/, /with no match, nothing/,
    /Not under `\/thread:open save`/,
    /elsewhere the vault's daily sweep does/,
    /`next-action\.py now`/, /Close's Now/, /--thread-file/, /step 5 gave `captures --thread-file`/,
  ])
  const step5 = lineOf(close, /^5\. \*\*Compute the full save set silently\*\*/)
  assertHas(step5, `${CLOSE} step 5`, [/its `captures --for-close` run is here, before sub-step 7\.6 creates any task/])
  const step8 = lineOf(close, /^8\. \*\*Print the "What landed" report/)
  assertHas(step8, `${CLOSE} step 8`, [
    /`next task: \[\[<task>\]\] on <Project>/, /`next task: none \(no concrete next task/,
    /· Now: <Project>/, /`?Now not written: <stderr>/,
  ])
})

test('open save is no set-down', () => {
  const save = slice(readIf(OPEN), /^### `\/thread:open save`/, /^## /)
  assertHas(save, `${OPEN} save`, [/set-down write does not run/, /neither next-action field changes/])
})

test('open pickup leaves both fields alone', () => {
  const pickup = slice(readIf(OPEN), /^### `\/thread:open \[\[<task>\]\]`/, /^### /)
  const step3 = slice(pickup, /^3\. \*\*Complete the capture\*\*/, /^4\. /)
  assertHas(step3, `${OPEN} pickup step 3`, [
    /Leave the capture's `next_action:` and every project's `next_task:` untouched/,
    /dead link/,
    /every reader treats as blank and nothing rewrites/,
  ])
  assert.doesNotMatch(step3, /sweep/i, `${OPEN} pickup step 3 must not promise a sweep (estate ADR 0008 d5, amended)`)
  assert.doesNotMatch(step3, /\bclear/i, `${OPEN} pickup step 3 must not clear a next-action field`)
})

test('orient reads the slot first, proposes against it, fills only blanks', () => {
  const orient = readIf(ORIENT)
  const s2 = slice(orient, /^### 2\./, /^### 3\./)
  const first = lineOf(s2, '- ')
  assertHas(first, `${ORIENT} § 2 first bullet`, [/^- \*\*Next-action slots, first\*\*/])
  assertHas(slice(s2, /^- \*\*Next-action slots/, /^- /), `${ORIENT} § 2 slot bullet`, [
    /`next_task:`/, /`next_action:`/, `${SCRIPT_CITE} read`, /\*\*dead link\*\* \(CONTEXT\.md \*\*Next task\*\*\)/,
    /reads as a blank slot/, /the script decides which links are dead/,
  ])
  assertHas(slice(orient, /^### 3\./, /^### 4\./), `${ORIENT} § 3`, [
    /`No next action`/, /\*\*proposal against the slot\*\*/, /never read as competing answers/,
  ])
  const write = slice(slice(orient, /^### 6\./, /^### 7\./), /^- \*\*The slot write\*\*/, /^- /)
  assertHas(write, `${ORIENT} § 6 slot write`, [
    /fill-blank only/, /estate ADR 0008/, /but Look only or a dry run/, `${SCRIPT_CITE} fill <task> [--action -]`,
    /fills only\s+a blank or dead slot and a blank `next_action:`/, /a set slot is never\s+overwritten/, /task-writer\.md`\s+§ 4b/,
    // Hands-on pickup completes a capture: a pointer to it would be dead on arrival.
    /Skip the write when Hands-on\s+picks the task up/,
  ])
  assertHas(slice(orient, /^### 4\./, /^### 5\./), `${ORIENT} § 4`, [/\*\*Look only\*\*[^.]*no writes of any kind/])
  assertHas(slice(orient, /^## Don't/, null), `${ORIENT} § Don't`, [/the slot write included — in Look only or dry runs/])
})

test('CONTEXT.md defines the next-action vocabulary', () => {
  const ctx = readIf('CONTEXT.md')
  assertHas(ctx, 'CONTEXT.md', [
    /^- \*\*Set-down\*\* — /m, /^- \*\*Next action\*\* — /m, /^- \*\*Next task\*\* — /m, /^- \*\*Now\*\* — /m,
    '~/repos/workspaces/_shared/CONTEXT.md` § Next action',
  ])
})
