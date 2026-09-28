// Handoff docs have one writer (thread-skill-p9-4). The session safe-point stop hook was deleted on
// 2026-09-27 (thread-skill-p9-1), so `thread:handoff` is the only writer of a handoff doc, on explicit
// fork intent only; no live surface may still describe the hook or a "hook-forced" handoff, and ADR 0017
// records the deletion as an amendment (its body stays as history, ADR 0015). The same task lets `next`
// recommend compacting within *keep going*: a ready `/compact <focus>` line Lachy types, never run by
// `next`, never a route, and never for a correction loop. Reads files only; a missing file or section is a
// named assertion failure, never a crash at load.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readIf, slice, assertHas, textFiles, lineOf, collapse } from '../lib/contract-text.mjs'

const CONTEXT = 'CONTEXT.md'
const README = 'README.md'
const LIFECYCLE = 'skills/_shared/handoff-lifecycle.md'
const HANDOFF = 'skills/handoff/SKILL.md'
const NEXT = 'skills/next/SKILL.md'
const ADR = 'docs/adr/0017-a-pending-handoff-owns-the-continuation.md'

// The hook's name is assembled from pieces so this file never matches the task's verify grep for the
// hook's one-word name, which must find ADR history only; a test naming the hook would count against it.
const HOOK_NAME = new RegExp('safe' + '[- ]?' + 'point', 'i')
const HOOK_SCRIPT = new RegExp('session_' + 'safe' + 'point', 'i')
const HOOK_FORCED = /hook-forced/i

test('no live surface names the deleted stop hook or a hook-forced handoff', () => {
  const files = [
    ...textFiles('skills'),
    ...textFiles('hooks'),
    ...textFiles('evals'),
    ...[CONTEXT, README].map((file) => ({ file, text: readIf(file) })),
  ]
  const hits = []
  for (const { file, text } of files) {
    assert.ok(text != null, `${file} is missing`)
    text.split('\n').forEach((l, i) => {
      if (HOOK_NAME.test(l) || HOOK_SCRIPT.test(l) || HOOK_FORCED.test(l)) hits.push(`${file}:${i + 1}`)
    })
  }
  assert.deepEqual(hits, [], `live text still names the deleted stop hook: ${hits.join(', ')}`)
})

test('CONTEXT.md Handoff doc: thread:handoff is the only writer, on explicit fork intent', () => {
  const entry = slice(readIf(CONTEXT), /^- \*\*Handoff doc\*\*/, /^- \*\*/)
  assertHas(entry && collapse(entry), `${CONTEXT} **Handoff doc**`, ['only writer', 'explicit fork intent'])
  assert.ok(!/stop hook/i.test(entry), `${CONTEXT} **Handoff doc** still names a stop hook`)
})

test('handoff-lifecycle.md: a handoff doc is written only by thread:handoff', () => {
  const line = lineOf(readIf(LIFECYCLE), 'A **handoff doc** is a file')
  assertHas(line, `${LIFECYCLE} handoff-doc definition`, ['written only by `thread:handoff`', 'explicit fork intent'])
})

test('handoff SKILL.md: the body-section list is the skill\'s own, sections unchanged', () => {
  const text = readIf(HANDOFF)
  const line = lineOf(text, 'Body sections')
  assert.ok(line != null, `${HANDOFF} has no "Body sections" line`)
  assert.ok(!/hook/i.test(line), `${HANDOFF} "Body sections" line still cites a hook: ${line}`)
  const labels = ['Done and verified', 'What remains', 'Decisions settled', 'Gotchas found the hard way',
    'Suggested skills', 'Paste-ready prompt']
  const at = labels.map((l, i) => text.indexOf(`${i + 1}. **${l}`))
  at.forEach((pos, i) => assert.ok(pos >= 0, `${HANDOFF} lost body section ${i + 1}. **${labels[i]}**`))
  assert.deepEqual([...at].sort((a, b) => a - b), at, `${HANDOFF} body sections are out of order`)
})

test('ADR 0017 records the hook deletion as an amendment after p2-7', () => {
  const status = slice(readIf(ADR), /^Status:/, /^## Context/)
  assertHas(status && collapse(status), `${ADR} Status block`, ['thread-skill-p9-4', '2026-09-27', 'deleted', 'only writer'])
  const p27 = status.indexOf('thread-skill-p2-7')
  const p94 = status.indexOf('thread-skill-p9-4')
  assert.ok(p27 >= 0 && p94 > p27, `${ADR} p9-4 amendment must follow the p2-7 one`)
})

test('next SKILL.md: keep going may carry a /compact line next never runs', () => {
  const text = readIf(NEXT)
  assert.ok(text != null, `${NEXT} is missing`)
  const body = text.replace(/^---\n[\s\S]*?\n---\n/, '')
  assertHas(collapse(body), `${NEXT} body`, [
    '`/compact <focus>`',
    /never runs `\/compact`/,
    'only Lachy can type',
    '`/rewind`',
    'correction loop',
    'fresh start',
  ])
  // Compact is a paragraph inside keep going, never a sixth route bullet in step 3.
  const step3 = slice(body, /^3\. \*\*Recommend ONE move/, /^4\. /)
  assert.ok(step3 != null, `${NEXT} step 3 is missing`)
  const routes = step3.split('\n').filter((l) => /^\s*- \*\*/.test(l))
  assert.ok(routes.length >= 5, `${NEXT} step 3 lost its route bullets`)
  const compactRoute = routes.filter((l) => /^\s*- \*\*`?\/?compact/i.test(l))
  assert.deepEqual(compactRoute, [], `${NEXT} step 3 lists compact as a route`)
  // The routing description is untouched: five moves, no compact.
  const desc = lineOf(text, 'description:')
  assertHas(desc, `${NEXT} description`, ['keep going / defer / stash / handoff / close'])
  assert.ok(!/compact/i.test(desc), `${NEXT} description names compact`)
})

test('CONTEXT.md Router (next): compact is a recommendation, never a route', () => {
  const entry = slice(readIf(CONTEXT), /^- \*\*Router \(`next`\)\*\*/, /^- \*\*/)
  assertHas(entry && collapse(entry), `${CONTEXT} **Router (\`next\`)**`, ['compact', 'never a route'])
})
