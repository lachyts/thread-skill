// `next` decides housekeeping and never drops an open confirm (thread-skill-p30-5, Chorus ADR 0110). The loop audit
// of 21-25 Oct found 13 of its 23 forced questions were `next`'s own "next move?" or "archive?", and two of them
// (Q55, Q57) each held a session 23 hours. And when Lachy ran `/thread:next` on three sessions in the same minute,
// one of them dropped an unanswered confirm (Q54, "write the regenerated rollout?") with nothing written, so the
// P29 rollout never started. The fix:
//
//   - step 1 reads an open question this session left, which `/thread:next` arriving never answers, in a sweep too;
//   - step 3 settles that open confirm before recommending, by how-lachy-decides.md's four Owner rows: a gate, a
//     technical or a priorities question is decided by the rule and said in one `Answered:` line (that file's
//     Decided for you); his question, and any act the shared action policy reserves for his approval (a send, a
//     publish, spend beyond the standing approval, an irreversible act, an ADR 0008 gated input), is carried word
//     for word into what the move leaves behind, the handoff doc's § What remains and its prompt's `Gates:` line
//     for a handoff; archive writes nothing, so its own paragraph gives the confirm a real carrier (done here,
//     relayed on the Stage, or handed to Lachy to pass on);
//   - step 4 decides the move with no AskUserQuestion when it is clear, saying so in one line, and asks the menu
//     only when the pick turns on what only Lachy knows; the archive move is always clear, so it is a line, which
//     never ends on a bare "Carried:";
//   - § Don't bans asking a clear "next move?" and dropping an open confirm;
//   - handoff no longer calls `next` an ask-first menu and names the carried confirm in § What remains, and
//     CONTEXT.md's Router and Handoff doc entries say `next` decides and dispatches.
//
// One pure check, decideFails, returns a failure list; the real files and the controls run through it, so each
// control proves its pin is not vacuous. Every pin has at least one control that breaks it and expects its
// failure: H0 (L), H1 (B), H2 (K), H3 (C, C2, C3), H3b (D3), H3c (D, D2), H3d (D4, D5), H4 (A), H5 (M), H6 (E),
// H7 (F), H8 (N), H8b (A, G), H9 (G, G2), H10 (H2), H10b (H), H11 (I), H11b (I2), H12 (J, J2), H13 (J3). Every
// line pin finds its line inside its own step slice, so a moved line fails. Phrase checks run on collapsed text.
// Reads files only.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { collapse, lineOf, read, slice } from '../lib/contract-text.mjs'

const NEXT = 'skills/next/SKILL.md'
const HANDOFF = 'skills/handoff/SKILL.md'
const CONTEXT = 'CONTEXT.md'

const OPEN_Q = /^\s*- \*\*An open question this session left\*\*/
const SETTLE = /^\s*\*\*An open confirm, settled first\.\*\*/
const CARRIER = /^\s*\*\*An open confirm, while another session holds the thread\.\*\*/
const DECIDE = /^4\. \*\*Decide the move, and say so in one line\.\*\*/
const CLEAR = /^\s*- \*\*Clear\*\*/
const NOT_CLEAR = /^\s*- \*\*Not clear\*\*/
const THE_LINE = /^\s*- \*\*The line\.\*\*/
const MENU = /^\s*\*\*The menu, when the move is not clear\.\*\*/
const ARCHIVE_LINE = /^\s*\*\*The archive line\.\*\*/
const DONT_ASK = /^- Don't ask "next move\?"/
const DONT_DROP = /^- Don't drop an open confirm/
const ROUTER_ENTRY = /^- \*\*Router \(`next`\)\*\*/
const HANDOFF_DOC_ENTRY = /^- \*\*Handoff doc\*\*/
const WHAT_REMAINS = /^2\. \*\*What remains\*\*/

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

  // H3 — step 3 settles the open confirm before recommending, by all four Owner rows of how-lachy-decides.md: a
  // gate, a technical and a priorities question are decided by the rule, acted on and said in one Answered line.
  const settle = lineOf(s3, SETTLE)
  needLine(fails, 'H3 step-3 settle: decided by the rule', settle, [
    'never silently dropped', '`~/.agents/knowledge/how-lachy-decides.md`', 'Chorus ADR 0110',
    'its four rows split two ways', '**Decided by the rule:** a gate', 'a queue or plan he already approved',
    'a technical question (mechanism, architecture, config, a file format: "SQLite or Postgres?"), researched first',
    "unless the project's card names him as steering that detail, which makes it his",
    "a priorities question, one that file or the project's `## Priorities` card already answers",
    'act on the decision', 'one line of its own', '"Answered: <the question>: <the decision>, because <the reason>."',
    "that file's *Decided for you*",
  ])

  // H3b — an act the shared action policy reserves for Lachy is always carried, never answered by the rule.
  needLine(fails, 'H3b step-3 settle: the action policy is carried', settle, [
    '**Carried:** his question',
    'any act the shared action policy (`~/.agents/skills/_adapter-common/action-policy.md`) reserves for his approval',
    'never answered by the rule', 'an outbound send (an email, a message, a post)', 'publishing',
    'spend beyond the standing approval', 'an irreversible, destructive or device act',
    'a gated input a rollout plan declares (ADR 0008)',
  ])

  // H3c — where each move carries it: real slots, the handoff doc's § What remains and its prompt's Gates: line.
  needLine(fails, 'H3c step-3 settle: carry slots', settle, [
    'carried, word for word', 'keep going asks it again', "the capture's resume prompt",
    "the handoff doc's § What remains as a fork returned to Lachy", "the paste-ready prompt's `Gates:` line",
    "the THREAD.md's Resume instructions", 'archive writes nothing, so it takes the carrier below',
    'Carried: <the question>.',
  ])

  // H3d — archive writes nothing, so its paragraph gives the confirm a real carrier, the first that fits.
  needLine(fails, 'H3d step-3 archive carrier', lineOf(s3, CARRIER), [
    'The archive move writes nothing', 'Q54', 'a real carrier, the first that fits',
    'A decided act whose inputs only this session holds', 'is done here, in step 3',
    'its Answered line names what it wrote', 'the archive move itself still writes nothing',
    'on the Chorus Stage, relay the decision or the question, word for word, to the session that holds the thread',
    '`relay_session`', 'the archive line ends "Relayed to <the other session>: <the decision or the question>."',
    'Failing both (off the Stage, or the relay refused', 'the archive line ends plainly',
    '"Pass this on to <the other session> before you archive this chat, or it is lost:',
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

  // H9 — the archive move is always clear: a line, never a menu, ending on its carrier, never a bare Carried:.
  needLine(fails, 'H9 archive line lead', lineOf(s4, ARCHIVE_LINE), [
    'always clear', 'there is no menu', '"Relayed to …"', '"Pass this on to …"',
    'A bare "Carried: <the question>." never ends this line',
  ])

  // H10 — § Don't: never ask a clear "next move?"; H10b — never drop an open confirm, nor answer a reserved act.
  needLine(fails, "H10 § Don't ask bullet", lineOf(dont, DONT_ASK), [
    '"archive?"', 'when the recommendation is clear', 'say so in one line', 'only Lachy knows',
  ])
  needLine(fails, "H10b § Don't drop bullet", lineOf(dont, DONT_DROP), [
    'in a sweep', 'decide a gate, a technical or a priorities question by the rule',
    'carry his question and any act the action policy reserves for him', 'a real carrier when the move is archive',
    'Never answer a send, a publish, spend beyond the standing approval or an irreversible act by the rule',
  ])

  // H11 — handoff no longer calls `next` an ask-first menu.
  if (/ask-first/.test(handoff)) fails.push(`H11 ${HANDOFF}: still calls next ask-first`)
  need(fails, `H11 ${HANDOFF} invocation gate`, C(slice(handoff, /^\*\*Invocation gate\.\*\*/, /^$/)), [
    "belong to `thread:next`, which decides the move and says so in one line",
  ])

  // H11b — the handoff doc's § What remains is the slot a carried confirm lands in.
  needLine(fails, `H11b ${HANDOFF} What remains`, lineOf(handoff, WHAT_REMAINS), [
    'fork the grill-fit check returned to Lachy',
    'An open confirm a dispatching `thread:next` carried (its step 3) is one such fork, word for word',
  ])

  // H12 — CONTEXT.md's Router entry says it decides, asking only when the pick is Lachy's.
  need(fails, `H12 ${CONTEXT} Router entry`, C(slice(context, ROUTER_ENTRY, /^- \*\*/)), [
    'decides it and says so in one line', 'asking only when the pick turns on what only Lachy knows',
    'never drops an open confirm', 'a gate, technical or priorities question is decided by the rule',
    'any act the action policy reserves for him, is carried',
  ])

  // H13 — CONTEXT.md's Handoff doc entry: a router dispatches handoff, Lachy no longer picks it from a menu.
  need(fails, `H13 ${CONTEXT} Handoff doc entry`, C(slice(context, HANDOFF_DOC_ENTRY, /^- \*\*/)), [
    "on explicit fork intent only (Lachy's ask, or a router's dispatch; never self-initiated)",
  ])
  return fails
}

const files = { next: read(NEXT), handoff: read(HANDOFF), context: read(CONTEXT) }

const phraseRe = (phrase) =>
  new RegExp(phrase.trim().split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+'))
// Replace `phrase` (whitespace-tolerant) in files[key], failing loudly when it is absent.
function mutate(key, phrase, replacement) {
  const re = phraseRe(phrase)
  assert.ok(re.test(files[key]), `control precondition: ${JSON.stringify(phrase)} is not in ${key}`)
  return { ...files, [key]: files[key].replace(re, () => replacement) }
}
// The one line of files[key] matching `lineRe`, by index, failing loudly unless there is exactly one.
function onlyLine(key, lineRe) {
  const lines = files[key].split('\n')
  const hits = lines.flatMap((l, i) => (lineRe.test(l) ? [i] : []))
  assert.equal(hits.length, 1, `control precondition: ${lineRe} matches ${hits.length} lines of ${key}, not one`)
  return { lines, i: hits[0] }
}
// `mutate`, confined to the ONE line of files[key] (files.next by default) matching `lineRe`.
function mutateLine(lineRe, phrase, replacement, key = 'next') {
  const { lines, i } = onlyLine(key, lineRe)
  const re = phraseRe(phrase)
  assert.ok(re.test(lines[i]), `control precondition: ${JSON.stringify(phrase)} is not on ${lineRe}`)
  lines[i] = lines[i].replace(re, () => replacement)
  return { ...files, [key]: lines.join('\n') }
}
// files with the ONE line of files.next matching `lineRe` removed.
function dropLine(lineRe) {
  const { lines, i } = onlyLine('next', lineRe)
  lines.splice(i, 1)
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
  expectFail(mutateLine(SETTLE, '**Decided by the rule:** a gate', '**Asked again:** a gate'), 'H3 ')
})

test('control C2: a settle paragraph with no branch for a technical question fails', () => {
  expectFail(mutateLine(SETTLE,
    'a technical question (mechanism, architecture, config, a file format: "SQLite or Postgres?"), researched first, unless the project\'s card names him as steering that detail, which makes it his, and',
    ''), 'H3 ')
})

test('control C3: a settle paragraph with no branch for a priorities question fails', () => {
  expectFail(mutateLine(SETTLE,
    ", and a priorities question, one that file or the project's `## Priorities` card already answers", ''), 'H3 ')
})

test('control D: a settle paragraph that stops carrying his question into the capture fails', () => {
  expectFail(mutateLine(SETTLE, "the capture's resume prompt", 'nothing'), 'H3c ')
})

test("control D2: a settle paragraph that sends a handoff's carried question to a section the doc lacks fails", () => {
  expectFail(mutateLine(SETTLE,
    "handoff writes it into the handoff doc's § What remains as a fork returned to Lachy, so the paste-ready prompt's `Gates:` line carries it too",
    "handoff into the handoff doc's open questions"), 'H3c ')
})

test('control D3: a settle paragraph that lets the rule answer a send or a publish fails', () => {
  expectFail(mutateLine(SETTLE,
    ', and any act the shared action policy (`~/.agents/skills/_adapter-common/action-policy.md`) reserves for his approval, which is never answered by the rule, whatever its wording: an outbound send (an email, a message, a post), publishing, spend beyond the standing approval, an irreversible, destructive or device act, or a gated input a rollout plan declares (ADR 0008).',
    ', or a declared gate (ADR 0008: spend, a credential, an irreversible act).'), 'H3b ')
})

test('control D4: an archive carrier that no longer relays on the Stage fails', () => {
  expectFail(mutateLine(CARRIER,
    'Else, on the Chorus Stage, relay the decision or the question, word for word, to the session that holds the thread (`relay_session`, which it takes at its next rest), and the archive line ends "Relayed to <the other session>: <the decision or the question>."',
    ''), 'H3d ')
})

test('control D5: step 3 without the archive carrier paragraph fails', () => {
  expectFail(dropLine(CARRIER), 'H3d step-3 archive carrier: missing')
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

test('control G2: an archive line that ends on a bare "Carried:" again fails', () => {
  expectFail(mutateLine(ARCHIVE_LINE,
    'then, when step 3 relayed an open confirm or left it to Lachy to pass on, its carrier\'s closing sentence ("Relayed to …" or "Pass this on to …"). A bare "Carried: <the question>." never ends this line, since nothing the archive move writes would carry it:',
    'then "Carried: <the question>." when step 3 carried an open confirm:'), 'H9 ')
})

test("control H: § Don't without the drop bullet fails", () => {
  expectFail(mutate('next', "- Don't drop an open confirm", "- Don't lose track of an open confirm"), "H10b § Don't drop bullet: missing")
})

test("control H2: § Don't without the ask bullet fails", () => {
  expectFail(dropLine(DONT_ASK), "H10 § Don't ask bullet: missing")
})

test('control I: handoff still calling next an ask-first menu fails', () => {
  expectFail(mutate('handoff', 'which decides the move and says so in one line', "ask-first menu"), 'H11 ')
})

test("control I2: a handoff What remains that no longer takes next's carried confirm fails", () => {
  expectFail(mutateLine(WHAT_REMAINS,
    ' An open confirm a dispatching `thread:next` carried (its step 3) is one such fork, word for word.', '', 'handoff'), 'H11b ')
})

test('control J: a Router entry that no longer says next decides fails', () => {
  expectFail(mutate('context', 'decides it and says so in one line', 'asks which move'), 'H12 ')
})

test('control J2: a Router entry whose carried branch drops the action policy fails', () => {
  expectFail(mutate('context', 'his question, and any act the action policy reserves for him, is carried', 'his question is carried'), 'H12 ')
})

test("control J3: a Handoff doc entry back on Lachy's pick from a router's menu fails", () => {
  expectFail(mutate('context', "or a router's dispatch;", "or his pick from a router's menu;"), 'H13 ')
})

test('control K: step 2 that no longer names the carried confirm fails', () => {
  expectFail(mutate('next', 'A carried open confirm (step 3) is that question', ''), 'H2 ')
})

test('control L: an intro reverted to "recommends, and dispatches" fails', () => {
  expectFail(mutate('next', 'it reads the situation, decides, and dispatches, asking only when the pick is his',
    'it reads the situation, recommends, and dispatches'), 'H0 ')
})

test('control M: a clear bullet that drops handoff fails', () => {
  expectFail(mutateLine(CLEAR, ', or the next phase is unrelated or a spec is ready to execute (handoff)', ''), 'H5 ')
})

test('control N: a menu that no longer marks its recommended option fails', () => {
  expectFail(mutateLine(MENU, ' with "(Recommended)"', ''), 'H8 ')
})
