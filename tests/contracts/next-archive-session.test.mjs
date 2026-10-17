// `next`'s archive-this-session move (thread-skill-p22-5). On 2026-10-15, once another session owned the thread,
// `/thread:next` offered "Leave it (Recommended)" against "Close here": its step 3 had no move for "the work
// already continues in another session", so the model invented one, and Lachy could not tell whether "leave it"
// meant archiving the thread, archiving the session or doing nothing. The fix names the move outright:
//
//   - step 1 detects the case (a consumed or consumer-deleted handoff doc, or a live session holding the thread);
//   - step 3 recommends **Archive this session** (not a route: nothing is written, the THREAD.md stays active),
//     drops keep going, handoff, stash and defer while another session holds the thread, and says why close
//     stays on the menu although it still writes to what the other session holds;
//   - step 4's archive menu is exactly two options, Archive first, and every close option says what close
//     writes; in wording Lachy reads, **session** is this chat and **thread** the durable work its THREAD.md
//     records (CONTEXT.md's **Thread** entry records that user-facing convention);
//   - step 5 writes nothing for it, and only Lachy archives a session;
//   - § Don't bans the bare "Leave it" / "Keep thread" labels.
//
// Two pure checks, nextFails and contextFails, each returning a failure list: the real files and the controls
// run through them, so a control proves its pin is not vacuous. Every line pin finds its line inside its own step
// slice, so a moved line fails. Phrase checks run on collapsed text. Reads files only.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { collapse, lineOf, read, slice } from '../lib/contract-text.mjs'

const NEXT = 'skills/next/SKILL.md'
const CONTEXT = 'CONTEXT.md'

// The one quoted literal the forbidden-wording pin exempts, in exactly two lines (the rule line and its § Don't).
const BANNED_QUOTE = '"Leave it" or "Keep thread"'
const ARCHIVE_LABEL = 'Archive this session (Recommended)'
const CLOSE_DESC = 'Log this session into the thread (it stays active).'
const RULE_LEAD = /^\s*\*\*Session and thread, in the menu\.\*\*/
const DONT_WORDS = "- Don't label an option"
const DONT_MOVES = "- Don't recommend or offer keep going"

const DETECT = /^\s*- \*\*Whether the work continues in another session\*\*/
const ARCHIVE_ROUTE = /^\s*- \*\*Archive this session\*\*/
const CLOSE_ROUTE = /^\s*- \*\*`close`\*\*/
const HOLDS = /^\s*\*\*While another session holds the thread\.\*\*/
const MENU_LEAD = /^\s*\*\*The archive menu\.\*\*/
const ARCHIVE_OPTION = /^\s*- label `Archive this session \(Recommended\)`/
const CLOSE_OPTION = /^\s*- label `Close`/
const DISPATCHED = /^\s*\*\*Archive this session, dispatched\.\*\*/
const LEAVE = /\bleave it\b/i
const KEEP = /\bkeep (the )?thread\b/i

const C = (s) => (s == null ? '' : collapse(s))
const has = (text, p) => (typeof p === 'string' ? text.includes(p) : p.test(text))
// Pushes `name: <pattern>` for each pattern `text` does not match (a string is a substring check).
const need = (fails, name, text, patterns) => {
  for (const p of patterns) if (!has(text, p)) fails.push(`${name}: ${p}`)
}
// Pushes `name: missing` when `line` is null, else checks its collapsed text.
const needLine = (fails, name, line, patterns) => {
  if (line == null) fails.push(`${name}: missing`)
  else need(fails, name, C(line), patterns)
}
// The forbidden-wording failure for one line, so a control can name it exactly.
const forbidden = (line) => `P6 forbidden wording: ${line.trim()}`
const count = (s, lit) => s.split(lit).length - 1

const stripFront = (text) => text.replace(/^---\n[\s\S]*?\n---\n/, '')
function steps(text) {
  const body = stripFront(text)
  return {
    s1: slice(body, /^1\. \*\*Read the situation/, /^2\. /),
    s3: slice(body, /^3\. \*\*Recommend ONE move/, /^4\. /),
    s4: slice(body, /^4\. \*\*Offer the routes/, /^5\. /),
    s5: slice(body, /^5\. \*\*Dispatch/, /^## /),
    dont: slice(body, /^## Don't/, /^## /),
  }
}

function nextFails(text) {
  const fails = []
  const { s1, s3, s4, s5, dont } = steps(text)
  for (const [name, s] of [['step 1', s1], ['step 3', s3], ['step 4', s4], ['step 5', s5], ["§ Don't", dont]]) {
    if (s == null) fails.push(`${NEXT}: ${name} is missing`)
  }
  if (fails.length) return fails

  // P1 — step 1 reads whether the work continues elsewhere, and what a close would land.
  needLine(fails, 'P1 step-1 detection bullet', lineOf(s1, DETECT), [
    'status: consumed', 'deleted', 'another live session', 'Chorus Stage', '`pending`', 'close § The own branch',
    '**Run from:**',
  ])

  // P2 — the step-3 Archive bullet alone: the compact paragraph's own "not a route" cannot satisfy it.
  needLine(fails, 'P2 step-3 Archive bullet', lineOf(s3, ARCHIVE_ROUTE), [
    /not a route/i, 'nothing is written', 'stays active', 'only Lachy archives',
  ])

  // P2b — which moves drop while another session holds the thread, and why close stays despite its writes.
  needLine(fails, 'P2b step-3 holds paragraph', lineOf(s3, HOLDS), [
    'Keep going, handoff, stash and defer drop', 'two sessions on the same work', "§ Thread state's close row",
    'Close stays on the menu', 'Resume instructions', 'current branch', 'sub-step 7.9', 'own branch',
    'Archive stays the recommendation',
  ])

  // P3 — the step-3 close bullet says the thread stays active, with the no-THREAD.md fallback.
  needLine(fails, 'P3 step-3 close bullet', lineOf(s3, CLOSE_ROUTE), [
    'log this session into the thread', '(it stays active)', 'unless Lachy says the thread is finished',
    'with no THREAD.md',
  ])

  // P4 — the archive menu: exactly two options, Archive (recommended) first, each saying what it does.
  const s4lines = s4.split('\n')
  const lead = s4lines.findIndex((l) => MENU_LEAD.test(l))
  if (lead < 0) fails.push('P4 archive menu: no **The archive menu.** line')
  else need(fails, 'P4 archive menu lead', C(s4lines[lead]), ['exactly two options'])
  const arch = s4lines.findIndex((l) => l.includes('label `' + ARCHIVE_LABEL + '`'))
  const close = s4lines.findIndex((l) => l.includes('label `Close`'))
  if (arch < 0) fails.push(`P4 archive menu: no label \`${ARCHIVE_LABEL}\` option`)
  else need(fails, 'P4 archive option', C(s4lines[arch]), [
    'Nothing is written.', 'The thread stays active in', 'archive this chat on the Stage', 'Codex Desktop',
  ])
  if (close < 0) fails.push('P4 archive menu: no label `Close` option')
  else need(fails, 'P4 close option', C(s4lines[close]), [
    CLOSE_DESC, 'queues its merge', 'is building on', 'With no THREAD.md',
  ])
  if (lead >= 0 && arch >= 0 && close >= 0 && !(lead < arch && arch < close)) {
    fails.push('P4 archive menu: the options are not lead, then Archive (Recommended), then Close')
  }

  // P5 — the vocabulary rule, scoped to wording Lachy reads and tied to CONTEXT.md's **Thread** entry.
  const rule = lineOf(s4, RULE_LEAD)
  needLine(fails, 'P5 vocabulary rule', rule, [
    '**session** for this chat and **thread** for the durable work its THREAD.md records',
    'option labels and descriptions', "CONTEXT.md's **Thread** entry", 'agent-facing prose', 'says what close writes',
  ])

  // P6 — no "Leave it" / "Keep thread" anywhere in steps 3-5 or § Don't, but for one exact quoted literal
  // removed from exactly two lines. The rest of those two lines is checked like every other line.
  const dontWords = lineOf(dont, DONT_WORDS)
  const exempt = new Map()
  for (const [name, line] of [['rule line', rule], ["§ Don't label bullet", dontWords]]) {
    if (line == null || count(line, BANNED_QUOTE) !== 1) {
      fails.push(`P6 exemption anchor: the ${name} does not quote ${BANNED_QUOTE} exactly once`)
    } else exempt.set(line, line.replace(BANNED_QUOTE, ''))
  }
  for (const s of [s3, s4, s5, dont]) {
    for (const l of s.split('\n')) {
      const checked = exempt.has(l) ? exempt.get(l) : l
      if (LEAVE.test(checked) || KEEP.test(checked)) fails.push(forbidden(l))
    }
  }

  // P7 — the step-5 dispatch paragraph alone: the compact clause's own "end the turn" cannot satisfy it.
  needLine(fails, 'P7 step-5 dispatch paragraph', lineOf(s5, DISPATCHED), [
    /write nothing/i, 'run no sibling', 'stays active', 'end the turn', '`next` never archives',
  ])

  // P8 — § Don't: the banned labels, and the moves that drop while another session holds the thread.
  needLine(fails, "P8 § Don't label bullet", dontWords, [BANNED_QUOTE, 'don\'t say "thread" for this chat'])
  needLine(fails, "P8 § Don't moves bullet", lineOf(dont, DONT_MOVES), [
    'handoff, stash or defer', 'another session holds the thread', 'only Lachy',
  ])
  return fails
}

function contextFails(text) {
  const fails = []
  // P9 — the **Thread** entry records the user-facing convention and keeps its agent-facing senses.
  need(fails, 'P9 CONTEXT **Thread** entry', C(slice(text, /^- \*\*Thread\*\* —/, /^- \*\*/)), [
    'user-facing', '**session** names the live conversation', '**thread** the durable work its THREAD.md records',
    'Agent-facing prose keeps the two senses', 'must never be confused in skill prose',
  ])
  // P10 — the **Router (`next`)** entry names the move, which is never a route either.
  need(fails, 'P10 CONTEXT **Router (`next`)** entry', C(slice(text, /^- \*\*Router \(`next`\)\*\*/, /^- \*\*/)), [
    'archive this session', 'never a route',
  ])
  return fails
}

const next = read(NEXT)
const context = read(CONTEXT)

// Replace `phrase` (whitespace-tolerant, so a reflowed line still matches) and fail loudly when it is absent,
// so a control can never pass by mutating nothing.
function mutate(text, phrase, replacement) {
  const re = new RegExp(phrase.trim().split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+'))
  assert.ok(re.test(text), `control precondition: ${JSON.stringify(phrase)} is not in the text`)
  return text.replace(re, () => replacement)
}

// `mutate`, confined to the ONE line matching `lineRe`.
function mutateLine(text, lineRe, phrase, replacement) {
  const lines = text.split('\n')
  const hits = lines.flatMap((l, i) => (lineRe.test(l) ? [i] : []))
  assert.equal(hits.length, 1, `control precondition: ${lineRe} matches ${hits.length} lines, not one`)
  lines[hits[0]] = mutate(lines[hits[0]], phrase, replacement)
  return lines.join('\n')
}

// The text without the one line matching `lineRe`.
function dropLine(text, lineRe) {
  const lines = text.split('\n')
  const hits = lines.flatMap((l, i) => (lineRe.test(l) ? [i] : []))
  assert.equal(hits.length, 1, `control precondition: ${lineRe} matches ${hits.length} lines, not one`)
  lines.splice(hits[0], 1)
  return lines.join('\n')
}

// The text with `newLine` inserted after the one line `pred` accepts.
function insertAfter(text, pred, newLine) {
  const lines = text.split('\n')
  const hits = lines.flatMap((l, i) => (pred(l) ? [i] : []))
  assert.equal(hits.length, 1, `control precondition: ${hits.length} lines match the insertion point, not one`)
  lines.splice(hits[0] + 1, 0, newLine)
  return lines.join('\n')
}

const failsWith = (fails, prefix) => fails.some((f) => f.startsWith(prefix))

test('next SKILL.md: detects the work continuing elsewhere, recommends Archive this session, and names session and thread apart', () => {
  assert.deepEqual(nextFails(next), [])
})

test('CONTEXT.md: the Thread entry records the user-facing convention and the Router entry names the move', () => {
  assert.deepEqual(contextFails(context), [])
})

test('control A: the archive label reverted to "Leave it (Recommended)" fails the menu and the forbidden wording', () => {
  const fails = nextFails(mutate(next, ARCHIVE_LABEL, 'Leave it (Recommended)'))
  assert.ok(failsWith(fails, 'P4 '), `no P4 failure: ${fails}`)
  assert.ok(failsWith(fails, 'P6 forbidden wording'), `no P6 failure: ${fails}`)
})

test('control B: a "Leave it" option beside the intact archive option fails the forbidden wording alone', () => {
  const added = '   - label `Leave it`, description "Do nothing for now."'
  const bad = insertAfter(next, (l) => l.includes('label `' + ARCHIVE_LABEL + '`'), added)
  assert.deepEqual(nextFails(bad), [forbidden(added)])
})

test('control B2: the exemption is the quoted literal, never the whole rule line', () => {
  const bad = mutateLine(next, RULE_LEAD, 'when close would land it.',
    'when close would land it. Or offer "Leave it (Recommended)".')
  const fails = nextFails(bad)
  assert.ok(failsWith(fails, 'P6 forbidden wording'), `no P6 failure: ${fails}`)
  assert.ok(!failsWith(fails, 'P6 exemption anchor'), `the exemption anchor broke instead: ${fails}`)
})

test('control C: a close option that drops "(it stays active)" fails the menu', () => {
  const fails = nextFails(mutateLine(next, CLOSE_OPTION, '(it stays active)', ''))
  assert.ok(failsWith(fails, 'P4 close option'), `no P4 failure: ${fails}`)
})

test('control D: an archive option that drops "archive this chat on the Stage" fails the menu', () => {
  const fails = nextFails(mutateLine(next, ARCHIVE_OPTION, 'archive this chat on the Stage', ''))
  assert.ok(failsWith(fails, 'P4 archive option'), `no P4 failure: ${fails}`)
})

test('control E: step 3 without the Archive this session bullet fails', () => {
  const fails = nextFails(dropLine(next, ARCHIVE_ROUTE))
  assert.ok(fails.includes('P2 step-3 Archive bullet: missing'), `no P2 failure: ${fails}`)
})

test('control F: a dispatch paragraph that no longer ends the turn fails, though the compact clause still does', () => {
  const bad = mutateLine(next, DISPATCHED, 'end the turn', '')
  assert.ok(C(steps(bad).s5).includes('end the turn'), 'control precondition: step 5 lost the compact clause too')
  const fails = nextFails(bad)
  assert.ok(failsWith(fails, 'P7 '), `no P7 failure: ${fails}`)
})

test('control G: an Archive bullet that drops "Not a route" fails, though the compact paragraph still says it', () => {
  const bad = mutateLine(next, ARCHIVE_ROUTE, 'Not a route', '')
  assert.ok(/not a route/i.test(C(steps(bad).s3)), 'control precondition: step 3 lost the compact paragraph too')
  const fails = nextFails(bad)
  assert.ok(failsWith(fails, 'P2 '), `no P2 failure: ${fails}`)
})

test('control H: a holds paragraph that no longer says why close stays on the menu fails', () => {
  const bad = mutateLine(next, HOLDS,
    "Close stays on the menu because it declares nothing false: it leaves `state:` unchanged (`handoff-lifecycle.md` § Thread state's close row) and prepends one session-log line.",
    '')
  const fails = nextFails(bad)
  assert.ok(failsWith(fails, 'P2b '), `no P2b failure: ${fails}`)
})

test('control I: a step-3 close bullet without the no-THREAD.md fallback fails', () => {
  const bad = mutateLine(next, CLOSE_ROUTE,
    "; with no THREAD.md, close saves the session's memory, knowledge and commits instead", '')
  const fails = nextFails(bad)
  assert.ok(failsWith(fails, 'P3 '), `no P3 failure: ${fails}`)
})

test('control J: a Thread entry without the user-facing convention fails', () => {
  const bad = mutate(context,
    "In wording Lachy reads (a router's menu options and their descriptions) the convention is user-facing: **session** names the live conversation and **thread** the durable work its THREAD.md records, because that is how he reads the word.",
    '')
  const fails = contextFails(bad)
  assert.ok(failsWith(fails, 'P9 '), `no P9 failure: ${fails}`)
})
