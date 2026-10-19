// Escapes are traced by a `fixes:` key (p21-4, ADR 0037 d7): every task writer that can write a fix of landed
// work adds `fixes: [[<landed task>]]`, and /thread:reflect's score reads it (with reverts and later review
// findings from git) through skills/reflect/scripts/escapes.py. Pinned here, the writers' side:
// - task-writer § 4's template carries the key and its bullet says what it names (the task that landed, a folded
//   member accepted through `merged_into:`, never a phase, a rollout or a capture); § 2's in-place update keeps it;
// - stash, defer and close (its follow-up row and step 7.6) name the key where they cite task-writer § 4;
// - reshuffle R5.2 sets it on every task it writes, R5.3's rewrite covers it, R5.4's survivor takes the union;
// - schedule step 4.5's combined note takes the members' union;
// - CONTEXT.md's Escape entry names the key, and says a Leg's fix names its failed task in `verifies:`, never an Escape;
// - execute legs.md (a Leg's fix task, p24-3) writes `verifies:` on every fix and `fixes:` for the culprit only, citing
//   task-writer § 4;
// - reflect step 4 passes `--repo <Project root>`, and step 5 presents Quality, partial included (an unread source,
//   an unresolved task or a failed blame, any of them even with all three sources read);
// - reflect step 13 (the weekly reading's bug, p21-7) passes `--fixes`, so a bug fixing landed work carries `fixes:`.
// tests/reflect-escapes.test.mjs pins the reader's behaviour.
//
// One pure function, check(files), over { key: text }: the real files and the controls run through it, and each
// control mutates one real entry in memory and must fail with exactly its rule. Reads files only.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { read, slice, section, collapse, fencedBlocks, lineOf } from '../lib/contract-text.mjs'

const FILES = {
  writer: 'skills/_shared/task-writer.md',
  stash: 'skills/stash/SKILL.md',
  defer: 'skills/defer/SKILL.md',
  close: 'skills/close/SKILL.md',
  reshuffle: 'skills/orient/reshuffle.md',
  schedule: 'skills/schedule/SKILL.md',
  context: 'CONTEXT.md',
  reflect: 'skills/reflect/SKILL.md',
  legs: 'skills/execute/legs.md',
}
const real = Object.fromEntries(Object.entries(FILES).map(([k, p]) => [k, read(p)]))

const KEY = '`fixes:`'
const has = (text, p) => text != null && (typeof p === 'string' ? collapse(text).includes(p) : p.test(collapse(text)))
const all = (text, ps) => ps.every((p) => has(text, p))

// The bullet of `text` that starts with `head` (a `- ` item), up to the next item at the same indent or the end.
function bullet(text, head) {
  if (text == null) return null
  const lines = text.split('\n')
  const i = lines.findIndex((l) => head.test(l))
  if (i < 0) return null
  const indent = lines[i].match(/^\s*/)[0].length
  const out = [lines[i]]
  for (const l of lines.slice(i + 1)) {
    if (/^\s*$/.test(l)) break
    const ind = l.match(/^\s*/)[0].length
    if (ind <= indent && /^\s*(?:[-*+]|\d+\.)\s/.test(l)) break
    if (ind < indent) break
    out.push(l)
  }
  return out.join('\n')
}

// The CONTEXT.md glossary entry that starts with `head`, up to the next entry, heading or blank line.
function entry(text, head) {
  const lines = text.split('\n')
  const i = lines.findIndex((l) => l.startsWith(head))
  if (i < 0) return null
  const out = [lines[i]]
  for (const l of lines.slice(i + 1)) {
    if (/^- \*\*|^#|^\s*$/.test(l)) break
    out.push(l)
  }
  return out.join('\n')
}

// The rules that fail, in a fixed order.
function check(f) {
  const fails = []
  const s4 = slice(f.writer, /^## 4\./, /^## 4b\./)
  const yaml = fencedBlocks(s4 ?? '').find((b) => b.includes('---'))
  if (!yaml?.some((l) => /^fixes: \["\[\[<landed task>\]\]"\]\s+# OMIT unless the task fixes landed work/.test(l))) fails.push('writer-template')
  const fb = bullet(s4, /^- `fixes:`/)
  if (!all(fb, ['names the task that landed', '`merged_into:`', 'never a phase, a rollout or a capture', 'ADR 0037 d7'])) fails.push('writer-bullet')
  const s2 = slice(f.writer, /^## 2\./, /^## 3\./)
  if (!has(bullet(s2, /^\s+- \*\*Found, and its match includes `marked`\*\*/), `keep an existing ${KEY} line`)) fails.push('writer-recapture')
  if (!all(lineOf(f.stash, /^\s+- § 4 frontmatter/), [KEY, 'fixes landed work', 'task-writer § 4'])) fails.push('stash')
  if (!all(lineOf(f.defer, /^2\. \*\*Write the capture task\*\*/), [KEY, 'fixes landed work', 'task-writer § 4'])) fails.push('defer')
  if (!all(lineOf(f.close, /^\| Concrete follow-up actions/), [`a follow-up that fixes landed work carries ${KEY}`, 'task-writer § 4'])) fails.push('close-row')
  if (!all(lineOf(f.close, /^\s+6\. Approved vault tasks/), [KEY, 'fixes landed work', '`task-writer.md` § 4'])) fails.push('close-7.6')
  const r5 = section(f.reshuffle, /^## R5\./)
  const r52 = slice(r5, /^2\. \*\*Tasks\*\*/, /^3\. /)
  if (!all(bullet(r52, /^\s+- \*\*A task that fixes landed work\*\*/),
    ['phased, moved or respecced', 'fixes: ["[[<landed task>]]"]', 'naming the task that landed', '`merged_into:`', 'R3 (b)',
      `An existing ${KEY} survives the rename`])) fails.push('reshuffle-r5.2')
  if (!has(slice(r5, /^3\. \*\*Renames rewrite backlinks/, /^4\. /), `covers a ${KEY} wikilink`)) fails.push('reshuffle-r5.3')
  if (!has(slice(r5, /^4\. \*\*Other dispositions\.\*\*/, /^5\. /), /survivor first takes the union of the merged items' `fixes:`.*gets `status: dropped`/)) fails.push('reshuffle-r5.4')
  if (!all(bullet(section(f.schedule, /^### 4\.5\./), /^- `fixes:` = /), ['the **union** of the members\' `fixes:`', 'status: merged', 'dedupes per landed task'])) fails.push('schedule-4.5')
  if (!has(entry(f.context, '- **Escape** — '), `traced to it by its ${KEY} key`)) fails.push('context')
  if (!has(entry(f.context, '- **Escape** — '), 'names the task whose Verify failed in `verifies:`, which is never an Escape'))
    fails.push('context-verifies')
  if (!all(f.legs, ['Every fix task names t in `verifies:`', '`verifies:` is never an Escape', '`fixes:` names the culprit',
    'task-writer § 4'])) fails.push('legs')
  const step4 = section(f.reflect, /^### 4\. Score/)
  if (!fencedBlocks(step4 ?? '').some((b) => b.some((l) => l.includes('--repo <Project root>')))) fails.push('reflect-4')
  if (!all(bullet(section(f.reflect, /^### 5\. Present/), /^- \*\*Quality\*\*/),
    ['`escapes.count`', '`headline.quality`', '`escapes.bySource`', '`escapes.partial`', 'even with all three sources read',
      '`escapes.excluded.unresolved`', '`escapes.excluded.unresolvedRows`', 'can only read too high', 'a later re-score can lower Quality'])) fails.push('reflect-5')
  const step13 = section(f.reflect, /^### 13\. Bugs/)
  if (!all(step13, ['Pass `--fixes <landed task>` when the bug fixes work that already landed', `carries its ${KEY} key`, '(task-writer § 4)']) ||
    !fencedBlocks(step13 ?? '').some((b) => b.some((l) => l.includes('[--fixes <landed task>]')))) fails.push('reflect-13')
  return fails
}

test('every writer of a fix of landed work adds `fixes:`, and the Reflection presents Quality', () => {
  assert.deepEqual(check(real), [])
})

// ---- controls ---------------------------------------------------------------------------------------------

const only = (key, from, to, rules) => {
  assert.ok(real[key].includes(from), `control setup: ${from.slice(0, 60)} not in ${key}`)
  const mut = real[key].replace(from, to)
  assert.notEqual(mut, real[key], `control setup changed nothing: ${key}`)
  assert.deepEqual(check({ ...real, [key]: mut }), rules, `${key}: ${from.slice(0, 60)}`)
}

test('control: task-writer § 4 without the template line, or its bullet without what the key names, fails', () => {
  only('writer', 'fixes: ["[[<landed task>]]"]', 'fixes: <landed task>', ['writer-template'])
  only('writer', 'It names the task', 'It names the work', ['writer-bullet'])
  only('writer', 'through its `merged_into:`', 'through its combined note', ['writer-bullet'])
  only('writer', 'never a phase, a rollout or a capture', 'never a phase', ['writer-bullet'])
})

test('control: task-writer § 2\'s in-place update dropping the key fails writer-recapture', () => {
  only('writer', 'keep an existing `fixes:` line', 'drop any `fixes:` line', ['writer-recapture'])
})

test('control: stash, defer and close each without the key fail their own rule', () => {
  only('stash', 'plus `fixes:` when the set-down work fixes landed work', 'plus nothing more', ['stash'])
  only('defer', 'plus `fixes:` when the set-down work fixes landed work', 'plus nothing more', ['defer'])
  only('close', 'a follow-up that fixes landed work carries `fixes:`', 'a follow-up carries nothing extra', ['close-row'])
  only('close', 'plus `fixes:` per `task-writer.md` § 4 when one fixes landed work', 'and nothing more', ['close-7.6'])
})

test('control: reshuffle R5.2, R5.3 and R5.4 each without the key fail their own rule', () => {
  only('reshuffle', 'decomposed, phased, moved or respecced', 'decomposed', ['reshuffle-r5.2'])
  only('reshuffle', 'An existing `fixes:` survives the rename', 'An existing key is dropped', ['reshuffle-r5.2'])
  only('reshuffle', 'covers a `fixes:` wikilink', 'covers body links', ['reshuffle-r5.3'])
  only('reshuffle', 'survivor first takes the union of the merged items\' `fixes:`', 'survivor keeps its own keys', ['reshuffle-r5.4'])
})

test('control: schedule 4.5 without the union bullet fails schedule-4.5', () => {
  only('schedule', '- `fixes:` = the **union** of the members\' `fixes:`', '- `fixes:` = the first member\'s', ['schedule-4.5'])
})

test('control: CONTEXT.md\'s Escape entry without the key fails context', () => {
  only('context', 'traced to it by its `fixes:` key', 'traced to it', ['context'])
})

test('control: CONTEXT.md\'s Escape entry calling verifies: an Escape fails context-verifies', () => {
  only('context', 'which is\n  never an Escape', 'which is\n  an Escape', ['context-verifies'])
})

test('control: legs.md without verifies: on every fix, or with fixes: naming the failed task, fails legs', () => {
  only('legs', 'Every fix task names t in `verifies:`', 'A fix task may name t', ['legs'])
  only('legs', '`fixes:` names the culprit', '`fixes:` names t', ['legs'])
  only('legs', '(task-writer § 4, ADR 0037 d7)', '(ADR 0037 d7)', ['legs'])
})

test('control: reflect step 4 without --repo, or step 5 without Quality\'s partial reading, fails its rule', () => {
  only('reflect', '--repo-slug <owner/name> --repo <Project root>', '--repo-slug <owner/name>', ['reflect-4'])
  only('reflect', '`escapes.partial`', '`escapes.flags`', ['reflect-5'])
  only('reflect', '(`escapes.excluded.unresolvedRows`)', '(the review rows)', ['reflect-5'])
  only('reflect', '- **Quality**', '- **Escapes**', ['reflect-5'])
})

test('control: reflect step 13 without --fixes, or without the key it sets, fails reflect-13', () => {
  only('reflect', ' [--fixes <landed task>]\n```', '\n```', ['reflect-13'])
  only('reflect', 'carries its `fixes:` key', 'carries a link', ['reflect-13'])
  only('reflect', '(task-writer § 4). An open bug task', '. An open bug task', ['reflect-13'])
})
