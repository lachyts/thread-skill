// p27-4: an Integration conflict is a named state, distinct from a verifier red, and Integration reads as a merge
// queue. The engine, reconcile and the Run record are pinned by skills/execute/tests/integrate.test.mjs (e1b-e1h),
// tests/integration-marker-roundtrip.test.mjs (x16-x19), reconcile-rollout-record.test.sh (12c) and
// tests/lead-integrate.test.sh (C11). This file pins the prose that names them:
// - CONTEXT.md's **Integration** entry glosses it as a merge queue (GitHub's merge queue, bors); the **Integration
//   lane**'s _Avoid_ no longer bans the gloss outright (it is the whole step's, never the lane's alone); an
//   **Integration conflict** entry names the marker, status's `integrationBlock` and the reasonClass;
// - execute § 4.5 uses the gloss once;
// - status § 2 documents `integrationBlock`, and its example renders an `Integration conflict →` line; its Needs you
//   item names the block in its `<where>` (`at Integration (Integration conflict)`, `at Integration (verifier red)`);
// - run_record.py's and reconcile-rollout.py's docstrings list both new reasonClasses;
// - execute/subagent-prompt-template.md's diagnosis routing names the two forms of `integration: `, written only when
//   the integrator's blockKind agrees with the merge step's log, and the `integration: set aside: ` escape.
//
// One pure function, check(files), over { key: text }: the real files and the controls run through it, and each
// control mutates one real entry in memory and must fail with exactly its rule. Reads files only.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { read, slice, collapse, fencedBlocks } from '../lib/contract-text.mjs'

const FILES = {
  context: 'CONTEXT.md',
  execute: 'skills/execute/SKILL.md',
  status: 'skills/status/SKILL.md',
  runRecord: 'skills/_shared/scripts/run_record.py',
  reconcile: 'skills/execute/scripts/reconcile-rollout.py',
  template: 'skills/execute/subagent-prompt-template.md',
}
const real = Object.fromEntries(Object.entries(FILES).map(([k, p]) => [k, read(p)]))

const GLOSS = 'what the field calls a merge queue'
const has = (text, p) => text != null && collapse(text).includes(p)
const all = (text, ps) => ps.every((p) => has(text, p))
const count = (text, p) => (text == null ? 0 : collapse(text).split(p).length - 1)

// The CONTEXT.md glossary entry that starts with `head`, up to the next entry, heading or blank line.
function entry(text, head) {
  const lines = (text ?? '').split('\n')
  const i = lines.findIndex((l) => l.startsWith(head))
  if (i < 0) return null
  const out = [lines[i]]
  for (const l of lines.slice(i + 1)) {
    if (/^- \*\*|^#|^\s*$/.test(l)) break
    out.push(l)
  }
  return out.join('\n')
}

// The module docstring of a Python file: from its first `"""` to the next.
function docstring(text) {
  const i = (text ?? '').indexOf('"""')
  if (i < 0) return null
  const j = text.indexOf('"""', i + 3)
  return j < 0 ? null : text.slice(i + 3, j)
}

// The rules that fail, in a fixed order.
function check(f) {
  const fails = []
  const integ = entry(f.context, '- **Integration** — ')
  if (!all(integ, ['a **merge queue**', "GitHub's merge queue", 'bors', 'one approved change at a time', 'run by the lead'])) fails.push('context-gloss')
  const lane = collapse(entry(f.context, '- **Integration lane** — ') ?? '')
  const avoid = lane.slice(lane.indexOf('_Avoid_:'))
  if (!lane.includes('_Avoid_:') || /_Avoid_: merge queue\.\s*$/.test(lane) || !avoid.includes("Integration's gloss: the whole step, never the lane alone")) {
    fails.push('context-lane')
  }
  const conflict = entry(f.context, '- **Integration conflict** — ')
  if (!all(conflict, ['`integration: conflict unresolved in <paths>`', 'resolution brief', '`integrationBlock: conflict`', '`integration-conflict`',
    '`integration-red`', "Vibe Kanban's 'rebase conflicts'", '_Avoid_: rebase conflict'])) fails.push('context-entry')
  const s45 = slice(f.execute, /^### 4\.5\. /, /^### 5\. /)
  if (count(s45, GLOSS) !== 1 || count(f.execute, GLOSS) !== 1 || !has(s45, `${GLOSS} (GitHub's merge queue, bors)`)) fails.push('execute-gloss')
  const s2 = slice(f.status, /^### 2\. /, /^### 3\. /)
  const s4 = slice(f.status, /^### 4\. /, /^### 5\. /)
  const example = fencedBlocks(s4 ?? '').find((b) => b.includes('Drift:')) ?? []
  if (!all(s2, ['also carries `integrationBlock`', '`conflict` (an **Integration conflict**, `integration: conflict unresolved in …`',
    '`red` (a verifier red at Integration, `integration: verifier red: …`)', 'the key is absent otherwise'])) fails.push('status-key')
  if (!has(s4, '`Integration conflict → …` in place of `at Integration → …` for `conflict`') ||
    !example.some((l) => /^\s+\[\[[^\]]+\]\]\s+Integration conflict → .* · integration: conflict unresolved in /.test(l))) fails.push('status-render')
  if (!all(s4, ['`[[<slug>]] set aside <where> <humanFix.label>', 'a task with an `integrationBlock` names it',
    '`at Integration (Integration conflict)` for `conflict`', '`at Integration (verifier red)` for `red`'])) fails.push('status-needs-you')
  if (!all(docstring(f.runRecord), ['integration-conflict | integration-red | integration-set-aside', 'an unresolved Integration conflict'])) fails.push('run-record')
  if (!all(docstring(f.reconcile), ['integration-conflict (an Integration conflict', 'integration-red (`integration: verifier red: …`)',
    'carries `integrationBlock`'])) fails.push('reconcile')
  if (!all(f.template, ['Two diagnosis prefixes route a set-aside task', "only when the integrator's `blockKind` agrees with the merge step's own log",
    'an Integration conflict (`integration: conflict unresolved in …`, then its resolution brief)', 'a verifier red (`integration: verifier red: …`)',
    'any other reason that would read as one is written `integration: set aside: …`'])) fails.push('template-routing')
  return fails
}

test('Integration reads as a merge queue, and an Integration conflict is named in the glossary, status and the record', () => {
  assert.deepEqual(check(real), [])
})

// ---- controls ---------------------------------------------------------------------------------------------

const only = (key, from, to, rules) => {
  assert.ok(real[key].includes(from), `control setup: ${from.slice(0, 60)} not in ${key}`)
  const mut = real[key].replace(from, to)
  assert.notEqual(mut, real[key], `control setup changed nothing: ${key}`)
  assert.deepEqual(check({ ...real, [key]: mut }), rules, `${key}: ${from.slice(0, 60)}`)
}

test('control: CONTEXT.md\'s Integration entry without the gloss fails context-gloss', () => {
  only('context', "In plain English, a **merge queue** (GitHub's merge\n  queue, bors,", 'In plain English, a serial step (', ['context-gloss'])
})

test('control: the Integration lane banning the gloss outright fails context-lane', () => {
  only('context', "_Avoid_: merge queue\n  (Integration's gloss: the whole step, never the lane alone).", '_Avoid_: merge queue.', ['context-lane'])
})

test('control: an Integration conflict entry missing, or without its marker or reasonClass, fails context-entry', () => {
  only('context', '- **Integration conflict** — ', '- **Merge conflict** — ', ['context-entry'])
  only('context', '`integration: conflict unresolved in <paths>`', '`integration: conflict`', ['context-entry'])
  only('context', 'as reasonClass `integration-conflict`', 'as reasonClass `integration-set-aside`', ['context-entry'])
})

test('control: execute § 4.5 without the gloss, or with it twice, fails execute-gloss', () => {
  only('execute', " — what the field calls a merge queue (GitHub's merge queue, bors) —", '', ['execute-gloss'])
  only('execute', '### 5. Call the Workflow', "### 5. Call the Workflow\n\nAgain, what the field calls a merge queue.", ['execute-gloss'])
})

test('control: status § 2 without integrationBlock fails status-key; the example without the named line fails status-render', () => {
  only('status', 'also carries `integrationBlock`', 'also carries `block`', ['status-key'])
  only('status', 'Integration conflict → the lead\'s automatic retry · integration: conflict unresolved in a.js',
    'at Integration → the lead\'s automatic retry · integration: conflict in a.js cannot be resolved', ['status-render'])
  only('status', '`Integration conflict → …` in place of `at Integration → …` for `conflict`', '`at Integration → …`', ['status-render'])
})

test('control: a Needs you item whose <where> does not name the Integration block fails status-needs-you', () => {
  only('status', '`at Integration (Integration conflict)` for `conflict`', '`at Integration` for `conflict`', ['status-needs-you'])
  only('status', '`at Integration (verifier red)` for `red`', '`at Integration` for `red`', ['status-needs-you'])
})

test('control: the template\'s routing without the named forms or the escape fails template-routing', () => {
  only('template', 'an Integration conflict (`integration: conflict unresolved in …`, then its resolution brief)', 'an Integration conflict', ['template-routing'])
  only('template', 'any other reason that would read as one is written `integration: set aside: …`', 'nothing else is escaped', ['template-routing'])
  only('template', "only when the integrator's `blockKind` agrees with the merge step's own log", 'whenever the integrator says so', ['template-routing'])
})

test('control: run_record.py or reconcile-rollout.py without the new reasonClasses fails its rule', () => {
  only('runRecord', 'integration-conflict |\n                     integration-red | integration-set-aside', 'integration-set-aside', ['run-record'])
  only('reconcile', 'integration-red (`integration: verifier red: …`)', 'integration-set-aside', ['reconcile'])
})
