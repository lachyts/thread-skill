// `next` decides housekeeping and never drops an open confirm (thread-skill-p30-5, Chorus ADR 0110). The loop audit
// of 21-25 Oct found 13 of its 23 forced questions were `next`'s own "next move?" or "archive?", and two of them
// (Q55, Q57) each held a session 23 hours. And when Lachy ran `/thread:next` on three sessions in the same minute,
// one of them dropped an unanswered confirm (Q54, "write the regenerated rollout?") with nothing written, so the
// P29 rollout never started. The fix:
//
//   - step 1 reads an open question this session left, which `/thread:next` arriving never answers, in a sweep too;
//   - step 3 settles that open confirm before recommending: a gate is answered by the rule and said in one line,
//     his question (or a declared gate, ADR 0008) is carried word for word into what the move leaves behind;
//   - step 4 decides the move with no AskUserQuestion when it is clear, saying so in one line, and asks the menu
//     only when the pick turns on what only Lachy knows; the archive move is always clear, so it is a line;
//   - § Don't bans asking a clear "next move?" and dropping an open confirm;
//   - handoff no longer calls `next` an ask-first menu, and CONTEXT.md's Router entry says it decides.
//
// One pure check, decideFails, returns a failure list; the real files and the controls run through it, so each
// control proves its pin is not vacuous. Every line pin finds its line inside its own step slice, so a moved line
// fails. Phrase checks run on collapsed text. Reads files only.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { collapse, lineOf, read, slice } from '../lib/contract-text.mjs'

const NEXT = 'skills/next/SKILL.md'
const HANDOFF = 'skills/handoff/SKILL.md'
const CONTEXT = 'CONTEXT.md'

const OPEN_Q = /^\s*- \*\*An open question this session left\*\*/
const SETTLE = /^\s*\*\*An open confirm, settled first\.\*\*/
const DECIDE = /^4\. \*\*Decide the move, and say so in one line\.\*\*/
const CLEAR = /^\s*- \*\*Clear\*\*/
const NOT_CLEAR = /^\s*- \*\*Not clear\*\*/
const THE_LINE = /^\s*- \*\*The line\.\*\*/
const MENU = /^\s*\*\*The menu, when the move is not clear\.\*\*/
const ARCHIVE_LINE = /^\s*\*\*The archive line\.\*\*/
const DONT_ASK = /^- Don't ask "next move\?"/
const DONT_DROP = /^- Don't drop an open confirm/
const ROUTER_ENTRY = /^- \*\*Router \(`next`\)\*\*/

const C = (s) => (s == null ? '' : collapse(s))
const has = (text, p) => (typeof p === 'string' ? text.includes(p) : p.test(text))
const need = (fails, name, text, patterns) => {
  for (const p of patterns) if (!has(text, p)) fails.push(`${name}: ${p}`)
}
const needLine = (fails, name, line, patterns) => {
  if (line == null) fails.push(`${name}: missing`)
  else need(fails, name, C(line), patterns)
}

const stripFront = (text) => text.replace(/^---\n[\s\S]*?\n---\n/, '')
function steps(text) {
  const body = stripFront(text)
  return {
    intro: slice(body, /^# /, /^## Process/),
    s1: slice(body, /^1\. \*\*Read the situation/, /^2\. /),
    s2: slice(body, /^2\. \*\*Summarise/, /^3\. /),
    s3: slice(body, /^3\. \*\*Recommend ONE move/, /^4\. /),
    s4: slice(body, /^4\. /, /^5\. /),
    s5: slice(body, /^5\. \*\*Dispatch/, /^## /),
    dont: slice(body, /^## Don't/, /^## /),
  }
}

function decideFails({ next, handoff, context }) {
  const fails = []
  const { intro, s1, s2, s3, s4, s5, dont } = steps(next)
  for (const [name, s] of [['intro', intro], ['step 1', s1], ['step 2', s2], ['step 3', s3], ['step 4', s4],
    ['step 5', s5], ["§ Don't", dont]]) {
    if (s == null) fails.push(`${NEXT}: ${name} is missing`)
  }
  if (fails.length) return fails

  // H0 — the intro: next decides, and asks only when the pick is his.
  need(fails, 'H0 intro', C(intro), ['it reads the situation, decides, and dispatches, asking only when the pick is his'])

  // H1 — step 1 reads the open question this session left; `/thread:next` arriving answers nothing, a sweep included.
  needLine(fails, 'H1 step-1 open-question bullet', lineOf(s1, OPEN_Q), [
    'AskUserQuestion', 'dismissed when `/thread:next` arrived', '`/thread:next` arriving answers nothing',
    '**open confirm**', 'step 3 settles', 'sweep', 'each session settles its own',
  ])

  // H2 — step 2's top open question is the carried confirm when there is one.
  need(fails, 'H2 step 2', C(s2), ['A carried open confirm (step 3) is that question'])

  // H3 — step 3 settles the open confirm before recommending: a gate by the rule, his question carried.
  needLine(fails, 'H3 step-3 settle paragraph', lineOf(s3, SETTLE), [
    'never silently dropped', '`~/.agents/knowledge/how-lachy-decides.md`', 'Chorus ADR 0110',
    '**A gate**', 'a queue or plan he already approved', 'answered by the rule', 'act on the decision',
    'one line of its own', '**His question**', 'a declared gate (ADR 0008', 'carried, word for word',
    'keep going asks it again', "the capture's resume prompt", "the handoff doc's open questions",
    "the THREAD.md's Resume instructions", 'the archive line', 'Carried: <the question>.',
  ])

  // H4 — step 4 decides a clear move with no AskUserQuestion and says so in one line.
  needLine(fails, 'H4 step-4 lead', lineOf(s4, DECIDE), [
    "a gate, never Lachy's question", 'Chorus ADR 0110', '23 hours', 'with no AskUserQuestion', 'one line',
    'straight to step 5',
  ])
  needLine(fails, 'H5 clear bullet', lineOf(s4, CLEAR), [
    '(archive)', '(close)', '(keep going)', '(defer)', '(stash)', '(handoff)', 'Most moments are clear',
  ])
  needLine(fails, 'H6 not-clear bullet', lineOf(s4, NOT_CLEAR), [
    'only when the pick turns on something only Lachy knows', 'whether the thread is finished', 'the menu below',
  ])
  needLine(fails, 'H7 the-line bullet', lineOf(s4, THE_LINE), [
    '`Next move: <move>, because <reason>.', 'overturn', 'Carried: <the question>.',
  ])
  needLine(fails, 'H8 menu paragraph', lineOf(s4, MENU), ['AskUserQuestion', '(Recommended)', 'keep ≤4'])

  // H8b — AskUserQuestion appears in steps 3-5 only on the step-4 lead (as "no AskUserQuestion") and the menu line.
  const asks = [s3, s4, s5].flatMap((s) => s.split('\n')).filter((l) => l.includes('AskUserQuestion'))
  const allowed = asks.filter((l) => DECIDE.test(l) || MENU.test(l))
  for (const l of asks) if (!allowed.includes(l)) fails.push(`H8b AskUserQuestion outside the menu: ${l.trim()}`)

  // H9 — the archive move is always clear: a line, never a menu.
  needLine(fails, 'H9 archive line lead', lineOf(s4, ARCHIVE_LINE), ['always clear', 'there is no menu'])

  // H10 — § Don't: never ask a clear "next move?", never drop an open confirm.
  needLine(fails, "H10 § Don't ask bullet", lineOf(dont, DONT_ASK), [
    '"archive?"', 'when the recommendation is clear', 'say so in one line', 'only Lachy knows',
  ])
  needLine(fails, "H10 § Don't drop bullet", lineOf(dont, DONT_DROP), [
    'answer a gate by the rule', 'carry his question', 'in a sweep',
  ])

  // H11 — handoff no longer calls `next` an ask-first menu.
  if (/ask-first/.test(handoff)) fails.push(`H11 ${HANDOFF}: still calls next ask-first`)
  need(fails, `H11 ${HANDOFF} invocation gate`, C(slice(handoff, /^\*\*Invocation gate\.\*\*/, /^$/)), [
    "belong to `thread:next`, which decides the move and says so in one line",
  ])

  // H12 — CONTEXT.md's Router entry says it decides, asking only when the pick is Lachy's.
  need(fails, `H12 ${CONTEXT} Router entry`, C(slice(context, ROUTER_ENTRY, /^- \*\*/)), [
    'decides it and says so in one line', 'asking only when the pick turns on what only Lachy knows',
    'never drops an open confirm',
  ])
  return fails
}

const files = { next: read(NEXT), handoff: read(HANDOFF), context: read(CONTEXT) }

// Replace `phrase` (whitespace-tolerant) in files[key], failing loudly when it is absent.
function mutate(key, phrase, replacement) {
  const re = new RegExp(phrase.trim().split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+'))
  assert.ok(re.test(files[key]), `control precondition: ${JSON.stringify(phrase)} is not in ${key}`)
  return { ...files, [key]: files[key].replace(re, () => replacement) }
}
// `mutate`, confined to the ONE line of files.next matching `lineRe`.
function mutateLine(lineRe, phrase, replacement) {
  const lines = files.next.split('\n')
  const hits = lines.flatMap((l, i) => (lineRe.test(l) ? [i] : []))
  assert.equal(hits.length, 1, `control precondition: ${lineRe} matches ${hits.length} lines, not one`)
  const re = new RegExp(phrase.trim().split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+'))
  assert.ok(re.test(lines[hits[0]]), `control precondition: ${JSON.stringify(phrase)} is not on ${lineRe}`)
  lines[hits[0]] = lines[hits[0]].replace(re, () => replacement)
  return { ...files, next: lines.join('\n') }
}
const failsWith = (fails, prefix) => fails.some((f) => f.startsWith(prefix))
const expectFail = (bad, prefix) => {
  const fails = decideFails(bad)
  assert.ok(failsWith(fails, prefix), `no ${prefix} failure: ${fails}`)
}

test('next decides a clear move in one line, asks only his questions, and settles or carries an open confirm', () => {
  assert.deepEqual(decideFails(files), [])
})

test('control A: the step-4 lead reverted to "Offer the routes via AskUserQuestion" fails', () => {
  const bad = mutate('next', '4. **Decide the move, and say so in one line.**', '4. **Offer the routes via `AskUserQuestion`.**')
  expectFail(bad, 'H4 ')
  expectFail(bad, 'H8b ')
})

test('control B: a step-1 bullet that lets /thread:next answer the open question fails', () => {
  expectFail(mutateLine(OPEN_Q, '`/thread:next` arriving answers nothing', '`/thread:next` arriving dismisses it'), 'H1 ')
})

test('control C: a settle paragraph that lets a gate wait on Lachy fails', () => {
  expectFail(mutateLine(SETTLE, 'answered by the rule', 'asked again'), 'H3 ')
})

test('control D: a settle paragraph that stops carrying his question into the capture fails', () => {
  expectFail(mutateLine(SETTLE, "the capture's resume prompt", 'nothing'), 'H3 ')
})

test('control E: a not-clear bullet that asks whenever two moves fit fails', () => {
  expectFail(mutateLine(NOT_CLEAR, 'only when the pick turns on something only Lachy knows', 'whenever two moves fit'), 'H6 ')
})

test('control F: a line that no longer carries the open confirm fails', () => {
  expectFail(mutateLine(THE_LINE, 'Carried: <the question>.', ''), 'H7 ')
})

test('control G: an archive move asked through AskUserQuestion fails', () => {
  const bad = mutateLine(ARCHIVE_LINE, 'there is no menu', 'ask it via AskUserQuestion')
  expectFail(bad, 'H9 ')
  expectFail(bad, 'H8b ')
})

test("control H: § Don't without the drop bullet fails", () => {
  expectFail(mutate('next', "- Don't drop an open confirm", "- Don't lose track of an open confirm"), "H10 § Don't drop bullet: missing")
})

test('control I: handoff still calling next an ask-first menu fails', () => {
  expectFail(mutate('handoff', 'which decides the move and says so in one line', "ask-first menu"), 'H11 ')
})

test('control J: a Router entry that no longer says next decides fails', () => {
  expectFail(mutate('context', 'decides it and says so in one line', 'asks which move'), 'H12 ')
})

test('control K: step 2 that no longer names the carried confirm fails', () => {
  expectFail(mutate('next', 'A carried open confirm (step 3) is that question', ''), 'H2 ')
})
