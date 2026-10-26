// `next`'s archive-this-session move (thread-skill-p22-5). On 2026-10-15, once another session owned the thread,
// `/thread:next` offered "Leave it (Recommended)" against "Close here": its step 3 had no move for "the work
// already continues in another session", so the model invented one, and Lachy could not tell whether "leave it"
// meant archiving the thread, archiving the session or doing nothing. The fix names the move outright:
//
//   - step 1 detects the case (a consumed or consumer-deleted handoff doc, or a live session holding the thread,
//     the handoff's own started successor included) and, in a bullet of its own, the own branch every close
//     option names;
//   - step 3 recommends **Archive this session** (not a route: nothing is written, the THREAD.md stays active),
//     drops keep going, handoff, stash and defer while another session holds the thread, and says why close
//     stays on the menu although it still writes to what the other session holds;
//   - step 4's archive line is exactly two parts, archive first (since thread-skill-p30-5 archiving is always
//     clear, so a line and never a menu: next-decides-housekeeping.test.mjs), and every close line, part or
//     option says what close writes; in wording Lachy reads, **session** is this chat and **thread** the
//     durable work its THREAD.md records (CONTEXT.md's **Thread** entry records that user-facing convention);
//   - step 5 writes nothing for it, and only Lachy archives a session;
//   - § Don't bans the bare "Leave it" / "Keep thread" labels.
//
// Two pure checks, nextFails and contextFails, each returning a failure list: the real files and the controls
// run through them, so a control proves its pin is not vacuous. Every numbered pin has at least one control that
// breaks it and expects its failure: P1 (M), P1b (N), P2 (E, G), P2b (H), P3 (I), P4 (A, B, C, D, L, L2), P5 (O),
// P6 (A, B, B2), P7 (F), P8 (P, Q), P9 (J), P10 (K). A control breaks one phrase or line of its pin, not every
// phrase the pin lists. Every line pin finds its line inside its own step slice, so a moved line fails. Phrase
// checks run on collapsed text. Reads files only.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { collapse, lineOf, read, slice } from '../lib/contract-text.mjs'

const NEXT = 'skills/next/SKILL.md'
const CONTEXT = 'CONTEXT.md'

// The one quoted literal the forbidden-wording pin exempts, in exactly two lines (the rule line and its § Don't).
const BANNED_QUOTE = '"Leave it" or "Keep thread"'
const ARCHIVE_LEAD = 'Next move: archive this session.'
const CLOSE_DESC = 'Say close instead to log this session into the thread (it stays active).'
const RULE_LEAD = /^\s*\*\*Session and thread, in the line and the menu\.\*\*/
const DONT_WORDS = "- Don't label an option"
const DONT_MOVES = "- Don't recommend or offer keep going"

const DETECT = /^\s*- \*\*Whether the work continues in another session\*\*/
const OWN_BRANCH = /^\s*- \*\*This session's own branch\*\*/
const ARCHIVE_ROUTE = /^\s*- \*\*Archive this session\*\*/
const CLOSE_ROUTE = /^\s*- \*\*`close`\*\*/
const HOLDS = /^\s*\*\*While another session holds the thread\.\*\*/
const MENU_LEAD = /^\s*\*\*The archive line\.\*\*/
const ARCHIVE_OPTION = /^\s*- the archive part,/
const CLOSE_OPTION = /^\s*- the close part,/
const OPTION_LABEL = /^\s*- the (\w+) part,/
const MENU_LABELS = ['archive', 'close']
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
    s4: slice(body, /^4\. \*\*Decide the move/, /^5\. /),
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

  // P1 — step 1 reads whether the work continues elsewhere, as one rule: a successor the handoff itself started
  // counts whatever its doc reads, and nothing else does.
  needLine(fails, 'P1 step-1 detection bullet', lineOf(s1, DETECT), [
    'status: consumed', 'deleted', 'another live session', "the Chorus Stage's session list shows it",
    'the handoff itself started the successor (the Chorus Stage, or the native task in Codex Desktop)',
    'whatever its doc still reads', 'Nothing else counts', 'a doc still `pending` whose successor the handoff never started',
    '**Run from:**',
  ])

  // P1b — the own-branch fact, in a step-1 bullet of its own, so every menu's close option gets it.
  needLine(fails, 'P1b step-1 own-branch bullet', lineOf(s1, OWN_BRANCH), [
    'close § The own branch', 'Every close line, part or option', "the move's line and the menu's as well as the archive line's",
  ])

  // P2 — the step-3 Archive bullet alone: the compact paragraph's own "not a route" cannot satisfy it.
  needLine(fails, 'P2 step-3 Archive bullet', lineOf(s3, ARCHIVE_ROUTE), [
    /not a route/i, 'nothing is written', 'stays active', 'only Lachy archives',
  ])

  // P2b — which moves drop while another session holds the thread, and why close stays despite its writes.
  needLine(fails, 'P2b step-3 holds paragraph', lineOf(s3, HOLDS), [
    'Keep going, handoff, stash and defer drop', 'two sessions on the same work', "§ Thread state's close row",
    "Close stays offered, as the archive line's close part", 'Resume instructions', 'current branch', 'sub-step 7.9', 'own branch',
    'Archive stays the recommendation',
  ])

  // P3 — the step-3 close bullet says the thread stays active, with the no-THREAD.md fallback.
  needLine(fails, 'P3 step-3 close bullet', lineOf(s3, CLOSE_ROUTE), [
    'log this session into the thread', '(it stays active)', 'unless Lachy says the thread is finished',
    'with no THREAD.md',
  ])

  // P4 — the archive line: exactly two parts, archive first, each saying what it does. The parts are every list
  // item from the lead to the next blank line, so a third one fails wherever it sits.
  const s4lines = s4.split('\n')
  const lead = s4lines.findIndex((l) => MENU_LEAD.test(l))
  if (lead < 0) fails.push('P4 archive menu: no **The archive line.** line')
  else {
    need(fails, 'P4 archive menu lead', C(s4lines[lead]), ['exactly two parts'])
    const end = s4lines.findIndex((l, i) => i > lead && l.trim() === '')
    const items = s4lines.slice(lead + 1, end < 0 ? undefined : end).filter((l) => /^\s*- /.test(l))
    const labels = items.map((l) => l.match(OPTION_LABEL)?.[1] ?? l.trim())
    if (JSON.stringify(labels) !== JSON.stringify(MENU_LABELS)) {
      fails.push(`P4 archive menu options: ${JSON.stringify(labels)}, not ${JSON.stringify(MENU_LABELS)}`)
    } else {
      need(fails, 'P4 archive option', C(items[0]), [
        ARCHIVE_LEAD, 'Nothing is written.', 'The thread stays active in', 'archive this chat on the Stage', 'Codex Desktop',
      ])
      need(fails, 'P4 close option', C(items[1]), [
        CLOSE_DESC, 'queues its merge', 'is building on', 'With no THREAD.md',
      ])
    }
  }

  // P5 — the vocabulary rule, scoped to wording Lachy reads and tied to CONTEXT.md's **Thread** entry.
  const rule = lineOf(s4, RULE_LEAD)
  needLine(fails, 'P5 vocabulary rule', rule, [
    '**session** for this chat and **thread** for the durable work its THREAD.md records',
    '(the line, option labels and descriptions)', "CONTEXT.md's **Thread** entry", 'agent-facing prose',
    'Every close line, part or option says what close writes',
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

const ROUTER_ENTRY = /^- \*\*Router \(`next`\)\*\*/
const ROUTER_ARCHIVE = 'it recommends **archive this session** instead, which writes nothing and is never a route either.'
const ROUTER_COMPACT = 'compact is a recommendation inside keep going, never a route.'

function contextFails(text) {
  const fails = []
  // P9 — the **Thread** entry records the user-facing convention and keeps its agent-facing senses.
  need(fails, 'P9 CONTEXT **Thread** entry', C(slice(text, /^- \*\*Thread\*\* —/, /^- \*\*/)), [
    'user-facing', '**session** names the live conversation', '**thread** the durable work its THREAD.md records',
    'Agent-facing prose keeps the two senses', 'must never be confused in skill prose',
  ])
  // P10 — the **Router (`next`)** entry names the move, which is never a route either. The compact clause before
  // it already says "never a route", so the pin is the archive sentence's own words.
  need(fails, 'P10 CONTEXT **Router (`next`)** entry', C(slice(text, ROUTER_ENTRY, /^- \*\*/)), [
    ROUTER_ARCHIVE,
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

test('control A: the archive part reverted to "Leave it" fails the line and the forbidden wording', () => {
  const fails = nextFails(mutate(next, ARCHIVE_LEAD, 'Next move: leave it.'))
  assert.ok(failsWith(fails, 'P4 '), `no P4 failure: ${fails}`)
  assert.ok(failsWith(fails, 'P6 forbidden wording'), `no P6 failure: ${fails}`)
})

test('control B: a "Leave it" part beside the intact archive part fails the line and the forbidden wording, nothing else', () => {
  const added = '   - the leave part, "Or leave it: do nothing for now."'
  const bad = insertAfter(next, (l) => ARCHIVE_OPTION.test(l), added)
  assert.deepEqual(nextFails(bad), [
    `P4 archive menu options: ${JSON.stringify(['archive', 'leave', 'close'])}, not ${JSON.stringify(MENU_LABELS)}`,
    forbidden(added),
  ])
})

test('control B2: the exemption is the quoted literal, never the whole rule line', () => {
  const bad = mutateLine(next, RULE_LEAD, 'when close would land it.',
    'when close would land it. Or offer "Leave it (Recommended)".')
  const fails = nextFails(bad)
  assert.ok(failsWith(fails, 'P6 forbidden wording'), `no P6 failure: ${fails}`)
  assert.ok(!failsWith(fails, 'P6 exemption anchor'), `the exemption anchor broke instead: ${fails}`)
})

test('control C: a close part that drops "(it stays active)" fails the line', () => {
  const fails = nextFails(mutateLine(next, CLOSE_OPTION, '(it stays active)', ''))
  assert.ok(failsWith(fails, 'P4 close option'), `no P4 failure: ${fails}`)
})

test('control D: an archive part that drops "archive this chat on the Stage" fails the line', () => {
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

test('control H: a holds paragraph that no longer says why close stays offered fails', () => {
  const bad = mutateLine(next, HOLDS,
    "Close stays offered, as the archive line's close part, because it declares nothing false: it leaves `state:` unchanged (`handoff-lifecycle.md` § Thread state's close row) and prepends one session-log line.",
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

test('control K: a Router entry whose archive sentence makes it a route fails, though the compact clause still says "never a route"', () => {
  const bad = mutate(context, 'which writes nothing and is never a route either.', 'which is a route like close.')
  assert.ok(C(slice(bad, ROUTER_ENTRY, /^- \*\*/)).includes(ROUTER_COMPACT),
    'control precondition: the Router entry lost the compact clause too')
  assert.deepEqual(contextFails(bad), [`P10 CONTEXT **Router (\`next\`)** entry: ${ROUTER_ARCHIVE}`])
})

test('control L: a third part after close fails the archive line alone', () => {
  const bad = insertAfter(next, (l) => CLOSE_OPTION.test(l), '   - the handoff part, "Or hand off to a fresh session."')
  assert.deepEqual(nextFails(bad), [
    `P4 archive menu options: ${JSON.stringify([...MENU_LABELS, 'handoff'])}, not ${JSON.stringify(MENU_LABELS)}`,
  ])
})

test('control L2: a third part that is not a part line fails the archive line too', () => {
  const bad = insertAfter(next, (l) => ARCHIVE_OPTION.test(l), '   - `Hand off`: start a fresh session.')
  const fails = nextFails(bad)
  assert.ok(failsWith(fails, 'P4 archive menu options'), `no P4 failure: ${fails}`)
})

test('control M: a detection bullet that drops the successor the handoff itself started fails', () => {
  const bad = mutateLine(next, DETECT,
    ', or the handoff itself started the successor (the Chorus Stage, or the native task in Codex Desktop), whatever its doc still reads',
    '')
  const fails = nextFails(bad)
  assert.ok(failsWith(fails, 'P1 '), `no P1 failure: ${fails}`)
})

test('control N: step 1 without its own-branch bullet fails, so the normal menu would lose the fact', () => {
  const fails = nextFails(dropLine(next, OWN_BRANCH))
  assert.ok(fails.includes('P1b step-1 own-branch bullet: missing'), `no P1b failure: ${fails}`)
})

test('control O: a vocabulary rule that no longer ties itself to CONTEXT.md fails', () => {
  const bad = mutateLine(next, RULE_LEAD, "the user-facing convention in CONTEXT.md's **Thread** entry", 'by convention')
  const fails = nextFails(bad)
  assert.ok(failsWith(fails, 'P5 '), `no P5 failure: ${fails}`)
})

test("control P: a § Don't moves bullet that drops handoff, stash or defer fails", () => {
  const bad = mutateLine(next, /^- Don't recommend or offer keep going/, 'keep going, handoff, stash or defer', 'keep going')
  const fails = nextFails(bad)
  assert.ok(failsWith(fails, "P8 § Don't moves bullet"), `no P8 failure: ${fails}`)
})

test("control Q: a § Don't label bullet that drops the session-for-this-chat clause fails", () => {
  const bad = mutateLine(next, /^- Don't label an option/, ', and don\'t say "thread" for this chat in the line or the menu', '')
  const fails = nextFails(bad)
  assert.ok(failsWith(fails, "P8 § Don't label bullet"), `no P8 failure: ${fails}`)
})
