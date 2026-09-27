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
import { readIf, walk, slice, assertHas } from '../lib/contract-text.mjs'

const WRITER = 'skills/_shared/task-writer.md'
const CLOSE = 'skills/close/SKILL.md'
const STASH = 'skills/stash/SKILL.md'
const DEFER = 'skills/defer/SKILL.md'
const OPEN = 'skills/open/SKILL.md'
const ORIENT = 'skills/orient/SKILL.md'
const SCRIPT_CITE = '${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/next-action.py'
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
    /captures --slug <thread slug> --thread-file <THREAD\.md>/,
    /matched \*\*concretely\*\*/,
    /before sub-step 6 creates any task/,
    /includes `thread-tag` and also `slug` or `thread-file`/,
    /only by `thread-file`[\s\S]*never qualifies by itself/,
    /a\s+loose end never qualifies/,
    /never an older capture's\s+`Next move:`/,
    /write neither field and leave every\s+project slot as it is/,
  ])
})

test('task-writer § 4 leaves next_action to the script; § 2 finds captures through it', () => {
  const s4 = slice(readIf(WRITER), /^## 4\./, /^## 4b\./)
  assert.doesNotMatch(s4 ?? '', /^next_action:/m, `${WRITER} § 4's template must not hand-write next_action`)
  assertHas(s4, `${WRITER} § 4`, [/`next_action:` is not in this template/])
  const s2 = slice(readIf(WRITER), /^## 2\./, /^## 3\./)
  assertHas(s2, `${WRITER} § 2`, [
    `${SCRIPT_CITE} captures`, /inline or block-list `tags:`/, /rewrite § 4b's two fields/,
    // A follow-up or rollout task that merely links the THREAD.md is never overwritten as a capture.
    /Only a row whose match\s+includes `thread-tag` is a capture/,
  ])
  assert.doesNotMatch(s2, /rg -l '\^tags:/, `${WRITER} § 2 must not use the inline-only tags grep`)
  const s7 = slice(readIf(WRITER), /^## 7\./, null)
  assertHas(s7, `${WRITER} § 7`, [
    /Next action: <the § 4b line>/, /next task on <Project>/, /every `skip` row with its reason/, /Next action not written: <stderr>/,
  ])
})

test('the overwrite rule has one home under skills/', () => {
  const hits = walk('skills')
    .map((file) => ({ file, text: readIf(file) }))
    .filter(({ text }) => text != null && !text.includes('\0') && /most recent\s+set-down wins/.test(text))
    .map(({ file }) => file)
  assert.deepEqual(hits, [WRITER], `"most recent set-down wins" should occur only in ${WRITER}, found in: ${JSON.stringify(hits)}`)
})

test('stash, defer and close cite task-writer § 4b and its script', () => {
  for (const [file, step] of [
    [STASH, /^1\. \*\*Write the capture task\*\*/],
    [DEFER, /^2\. \*\*Write the capture task\*\*/],
  ]) {
    const write = slice(readIf(file), step, /^\d+\. /)
    assertHas(write, `${file} "Write the capture task" step`, [
      'skills/_shared/task-writer.md', /§ 4b\b/, /`next-action\.py set-down`/, /`next_action:`/, /`next_task:`/, /estate ADR 0008/,
    ])
  }
  const close = readIf(CLOSE)
  const sub6 = close == null ? null : (close.split('\n').find((l) => /^ {3}6\. Approved vault tasks/.test(l)) ?? null)
  assertHas(sub6, `${CLOSE} step 7.6`, [
    'skills/_shared/task-writer.md', /§ 4b, close's form/, /estate ADR 0008/, /`next-action\.py set-down`/,
    /no concrete next task, or while a pending handoff doc owns the continuation, write nothing and leave every project slot alone/,
    /Not under `\/thread:open save`/,
    /elsewhere the vault's daily sweep does/,
  ])
  const step5 = close == null ? null : (close.split('\n').find((l) => /^5\. \*\*Compute the full save set silently\*\*/.test(l)) ?? null)
  assertHas(step5, `${CLOSE} step 5`, [/its `captures` run is here, before sub-step 7\.6 creates any task/])
  const step8 = close == null ? null : (close.split('\n').find((l) => /^8\. \*\*Print the "What landed" report/.test(l)) ?? null)
  assertHas(step8, `${CLOSE} step 8`, [/`next task: \[\[<task>\]\] on <Project>/, /`next task: none \(no concrete next task/])
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
  const first = s2 == null ? null : (s2.split('\n').find((l) => l.startsWith('- ')) ?? null)
  assertHas(first, `${ORIENT} § 2 first bullet`, [/^- \*\*Next-action slots, first\*\*/])
  assertHas(slice(s2, /^- \*\*Next-action slots/, /^- /), `${ORIENT} § 2 slot bullet`, [
    /`next_task:`/, /`next_action:`/, `${SCRIPT_CITE} read`, /\*\*dead link\*\*/, /reads as a blank slot/,
    /`Archive\/` folder or tagged `archived`/,
  ])
  assertHas(slice(orient, /^### 3\./, /^### 4\./), `${ORIENT} § 3`, [
    /`No next action`/, /\*\*proposal against the slot\*\*/, /never read as competing answers/,
  ])
  const write = slice(slice(orient, /^### 5\./, /^### 6\./), /^- \*\*The slot write\*\*/, /^- /)
  assertHas(write, `${ORIENT} § 5 slot write`, [
    /fill-blank only/, /estate ADR 0008/, /but Report-only or a dry run/, `${SCRIPT_CITE} fill <task> [--action -]`,
    /whose slot is\s+blank/, /only if it is blank/, /A set slot is\s+never overwritten/, /task-writer\.md`\s+§ 4b/,
    // Hands-on pickup completes a capture: a pointer to it would be dead on arrival.
    /Skip the write when Hands-on\s+picks the task up/,
  ])
  assertHas(slice(orient, /^### 5\./, /^### 6\./), `${ORIENT} § 5`, [/\*\*Report-only\*\* → done, no writes \(the slot write included\)/])
  assertHas(slice(orient, /^## Don't/, null), `${ORIENT} § Don't`, [/the slot write included — in Report-only or dry runs/])
})

test('CONTEXT.md defines the next-action vocabulary', () => {
  const ctx = readIf('CONTEXT.md')
  assertHas(ctx, 'CONTEXT.md', [
    /^- \*\*Set-down\*\* — /m, /^- \*\*Next action\*\* — /m, /^- \*\*Next task\*\* — /m,
    '~/repos/workspaces/_shared/CONTEXT.md` § Next action',
  ])
})
