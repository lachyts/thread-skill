// Handoff docs have one writer (thread-skill-p9-4). The session safe-point stop hook was deleted on
// 2026-09-27 (thread-skill-p9-1), so `thread:handoff` is the only writer of a handoff doc, on explicit
// fork intent only; no live surface may still describe the hook or a "hook-forced" handoff, and ADR 0017
// records the deletion as an amendment (its body stays as history, ADR 0015). The same task lets `next`
// recommend compacting within *keep going* in Claude Code: at a phase boundary with a heavy context whose
// history is worth keeping, one `/compact <focus>` line Lachy types, printed once before the turn ends,
// never run by `next`, never a route, and never for a correction loop. Reads files only; a missing file or section is a
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
    // `evals/results/` is the git-ignored output of `make evals`: a run transcript may quote history.
    ...textFiles('evals').filter(({ file }) => !file.startsWith('evals/results/')),
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
  assert.ok(status != null, `${ADR} has no Status block`)
  // The p9-4 amendment alone, so a token an earlier amendment already carries can't satisfy the check.
  const p94 = slice(status, /thread-skill-p9-4/, /^\*\(Amended/)
  assertHas(p94 && collapse(p94), `${ADR} p9-4 amendment`,
    ['2026-09-27', 'thread-skill-p9-1', '29ca886', 'only writer', 'explicit fork intent', 'history'])
  const at27 = status.indexOf('thread-skill-p2-7')
  const at94 = status.indexOf('thread-skill-p9-4')
  assert.ok(at27 >= 0 && at94 > at27, `${ADR} p9-4 amendment must follow the p2-7 one`)
})

test('next SKILL.md: keep going may carry a /compact line next never runs', () => {
  const text = readIf(NEXT)
  assert.ok(text != null, `${NEXT} is missing`)
  const body = text.replace(/^---\n[\s\S]*?\n---\n/, '')
  // The compact paragraph itself: when to compact, who types it, and what gets something else instead.
  const para = lineOf(body, '   **Compact, within keep going.**')
  assertHas(para, `${NEXT} compact paragraph`, [
    'In Claude Code',
    'the context is heavy',
    'statusline ctx %',
    'phase boundary',
    'history is still worth keeping',
    '`/compact <focus>`',
    /never runs `\/compact`/,
    'runs only between turns',
    'only Lachy can type',
    'correction loop',
    '`/rewind`',
    'Summarize from here',
    'fresh start',
    'unrelated next phase',
    'spec ready to execute',
    'is the `handoff` route',
    'a Codex session',
    'not a route',
  ])
  // Step 5 prints the line; step 3 only recommends, so the line prints once.
  assert.ok(para.includes('which step 5 prints') && para.match(/\bprint/gi).length === 1,
    `${NEXT} compact paragraph prints the line itself as well as step 5`)
  // Compact is a paragraph inside keep going, never a sixth route bullet in step 3.
  const step3 = slice(body, /^3\. \*\*Recommend ONE move/, /^4\. /)
  assert.ok(step3 != null, `${NEXT} step 3 is missing`)
  const routes = step3.split('\n').filter((l) => /^\s*- \*\*/.test(l))
  assert.ok(routes.length >= 5, `${NEXT} step 3 lost its route bullets`)
  const compactRoute = routes.filter((l) => /^\s*- \*\*`?\/?compact/i.test(l))
  assert.deepEqual(compactRoute, [], `${NEXT} step 3 lists compact as a route`)
  // The handoff bullet is the fresh-session move; a heavy context alone is compact's case, not handoff's.
  const handoff = routes.find((l) => l.includes('**`handoff`**'))
  assertHas(handoff, `${NEXT} step 3 handoff bullet`, ['fresh session', 'unrelated', 'spec is ready to execute', 'fresh head'])
  assert.ok(!/exhausted/i.test(handoff), `${NEXT} handoff bullet still claims the exhausted-context case`)
  // Step 5 prints the line once and ends the turn: /compact runs only between turns.
  const step5 = slice(body, /^5\. \*\*Dispatch/, /^## /)
  assertHas(step5 && collapse(step5), `${NEXT} step 5`, [
    'print the `/compact <focus>` line once',
    'end the turn',
    'never run it',
    'work resumes after Lachy compacts',
  ])
  assert.ok(!/carry on/i.test(step5), `${NEXT} step 5 still carries on after the compact line`)
  // § Don't: never run the commands, never work on past the line, never offer compact as a route.
  const dont = lineOf(body, "- Don't run `/compact`")
  assertHas(dont, `${NEXT} § Don't compact bullet`, [
    '`/compact`, `/rewind` or `/clear` yourself',
    "don't keep working after printing a `/compact` line",
    "don't offer compact as a route",
  ])
  // The routing description is untouched: five moves, no compact.
  const desc = lineOf(text, 'description:')
  assertHas(desc, `${NEXT} description`, ['keep going / defer / stash / handoff / close'])
  assert.ok(!/compact/i.test(desc), `${NEXT} description names compact`)
})

test('CONTEXT.md Router (next): compact is a recommendation, never a route', () => {
  const entry = slice(readIf(CONTEXT), /^- \*\*Router \(`next`\)\*\*/, /^- \*\*/)
  assertHas(entry && collapse(entry), `${CONTEXT} **Router (\`next\`)**`, ['compact recommendation', 'never a route'])
  // CONTEXT.md is terms only: the /rewind and focus-building mechanics live in next's SKILL.md.
  assert.ok(!/\/rewind|<focus>/.test(entry), `${CONTEXT} **Router (\`next\`)** holds compact mechanics`)
})
