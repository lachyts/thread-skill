// The next move starts a prepared rollout itself (thread-skill-p40-2, ADR 0072). Lachy: "if we've done all the
// planning steps towards that, then a session that is looking to close out should always be looking to set up the
// next rollout ... and it should be doing that mostly automatically." A parallel rollout note written and waiting
// with no lead is started by the session that ends, never offered and never left for him to ask about:
//   p1  next step 1's LAST bullet, **A rollout prepared, not started**: a note this session wrote or one the active
//       THREAD.md names, checked read-only exactly as close step 2 checks it (its handover order, its guard for a
//       THREAD.md-named note, whose (i) reads a carried hold, `unstarted` over the scan's dirs, its holds); only
//       `unstarted <slug> <root>` with no hold counts. Last in step 1, so it never sits directly after the detection
//       bullet (N5).
//   p2  next step 3's **A rollout prepared, not started, starts first.**, after **Compact** and before **While another
//       session holds the thread.**: Owner *gate*, decided and never asked; no move of this session's (step 5 runs
//       it first, then this session's own move, as if no rollout waited, in the same turn); a note this session wrote
//       launches while another session holds the thread, and the archive line follows; a held note gets no launch.
//   p3  next step 4's **The launch, first in the line.**, directly after **The line.**: its opening, its overturn
//       sentence before what the move leaves behind and any `Carried:`, several notes, a held note's sentence and
//       what his "hand it off" to it runs, and, with no line (the move not clear), those sentences on their own line
//       just before the menu; the archive line's lead opens with the launch's sentence before its two parts, whose
//       archive part then says "Nothing else is written.".
//   p4  next step 5's **A launch first.**, between **Dispatch.** and **Archive this session, dispatched.**: handoff's
//       Rollout launch with orient § 9's Fresh session continuation, § Next for this session skipped, then this
//       session's own move in the same turn; close as the move reads the launch as a handover; carriers name the
//       rollout handed; the launch runs before the menu, its sentence on its own line just above it. § Don't: no
//       session ends with a note waiting and no lead.
//   p5  close step 2's **Rollouts this session wrote.**: the THREAD.md-named source, item 1's thread-doc handover,
//       item 2's `unstarted <slug> <root>` → sub-step 7.10 unless held, item 3's guard (i)-(iii), (i) reading an
//       earlier close's held step for his not yet or orient-all's `left[]` as a hold that carries (and every other
//       held step as the bare step), item 4's holds and the two that carry.
//   p6  close sub-step 7.10, directly after 7.9 and before § Commit hygiene and step 8: its launch, its place after
//       every commit and 7.9, the launch doc's landing row in the banner choice, the skipped § Next and closing line,
//       the fenced manual prompt, Codex Desktop's directive above the report, nothing asked, the resolver's
//       `(launch failed: …)` row, § Fail closed, save and Leg.
//   p7  close step 8: the canonical `rollout not started:` span still first, its two suffixes, and the three
//       `rollout handed off:` rows (the Stage's, Codex Desktop's and the manual one).
//   p8  handoff's Invocation gate, Rollout launch, Skipped on a dispatch, Failure path carve-out and § Build name both
//       new dispatchers, and the first three his "hand it off" to next step 4's held-note line; handoff-lifecycle
//       § Withdrawn makes a launch's withdrawal his not yet.
//   p9  CONTEXT.md's **Execute handoff** and **Router (`next`)** entries.
//   p10 ADR 0072's sections and d1-d5, d3's holds that carry, and its filed follow-ups; ADR 0057's Status clause.
//   p11 close step 4's handover templates and its one held-step form, step 9's banner timing, flag read and rule (3),
//       and the new Edge cases.
// One pure function, check(files), returns the failed rule names; every rule has a control that fails it alone, and
// every control asserts its swap changed the text. Phrase checks run on collapsed text. Reads files only.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { collapse, lineOf, root, section, slice } from '../lib/contract-text.mjs'

const NEXT = 'skills/next/SKILL.md'
const CLOSE = 'skills/close/SKILL.md'
const HANDOFF = 'skills/handoff/SKILL.md'
const LIFECYCLE = 'skills/_shared/handoff-lifecycle.md'
const CONTEXT = 'CONTEXT.md'
const ADR = 'docs/adr/0072-the-next-move-starts-a-prepared-rollout.md'
const ADR57 = 'docs/adr/0057-a-scheduled-rollout-sweeps-for-pickups-and-hands-itself-off.md'
const FILES = [NEXT, CLOSE, HANDOFF, LIFECYCLE, CONTEXT, ADR, ADR57]

const readTree = () => Object.fromEntries(FILES.map((f) => {
  const p = path.join(root, f)
  return [f, fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null]
}))

const C = (s) => collapse(s ?? '')
const stripFront = (text) => (text ?? '').replace(/^---\n[\s\S]*?\n---\n/, '')
const linesOf = (text) => (text ?? '').split('\n')
const at = (lines, re) => lines.findIndex((l) => (typeof re === 'string' ? l.startsWith(re) : re.test(l)))
// The blank-line paragraph of `text` that starts with `label`, raw; '' when absent.
const para = (text, label) => (text ?? '').split(/\n\s*\n/).find((p) => p.trimStart().startsWith(label)) ?? ''
const entry = (text, name) => C(slice(text ?? '', new RegExp(`^- \\*\\*${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\*\\*`), /^(- \*\*|#)/))

const DETECT = /^\s*- \*\*Whether the work continues in another session\*\*/
const OWN_BRANCH = /^\s*- \*\*This session's own branch\*\*/
const PREPARED = /^\s*- \*\*A rollout prepared, not started\*\*/
const COMPACT = /^\s*\*\*Compact, within keep going\.\*\*/
const STARTS_FIRST = /^\s*\*\*A rollout prepared, not started, starts first\.\*\*/
const HOLDS = /^\s*\*\*While another session holds the thread\.\*\*/
const THE_LINE = /^\s*- \*\*The line\.\*\*/
const LAUNCH_LINE = /^\s*- \*\*The launch, first in the line\.\*\*/
const ARCHIVE_LINE = /^\s*\*\*The archive line\.\*\*/
const DISPATCH = /^5\. \*\*Dispatch\.\*\*/
const LAUNCH_FIRST = /^\s*\*\*A launch first\.\*\*/
const DISPATCHED = /^\s*\*\*Archive this session, dispatched\.\*\*/
const DONT = "- Don't end a session with a rollout note waiting and no lead"
const ITEM9 = /^ {3}9\. \*\*Land the own branch\*\*/
const ITEM10 = /^ {3}10\. \*\*Launch the unstarted rollout\*\*/
const HYGIENE = '### Commit hygiene (both repos)'
const STEP8 = /^8\. \*\*Print the "What landed" report/
const CANONICAL = 'rollout not started: [[<slug>]]; say "hand it off" to start its lead in a fresh session, or run /thread:execute [[<slug>]] in <root>'

function check(F) {
  const fails = new Map()
  const flag = (rule, why) => { if (!fails.has(rule)) fails.set(rule, []); fails.get(rule).push(why) }
  const need = (rule, name, text, phrases) => {
    const t = C(text)
    for (const p of phrases) if (!t.includes(p)) flag(rule, `${name} lacks ${p}`)
  }
  const nx = stripFront(F[NEXT])

  // p1: next step 1's last bullet.
  const s1 = linesOf(slice(nx, /^1\. \*\*Read the situation/, /^2\. /))
  const iPrep = at(s1, PREPARED), iOwn = at(s1, OWN_BRANCH), iDetect = at(s1, DETECT)
  const bullets = s1.flatMap((l, i) => (/^\s*- \*\*/.test(l) ? [i] : []))
  if (iPrep < 0 || iPrep !== bullets.at(-1) || !(iOwn >= 0 && iOwn < iPrep) || iPrep === iDetect + 1) {
    flag('p1', `step 1's prepared-rollout bullet is not its last, after the own-branch bullet (${iPrep}, ${iOwn}, ${bullets.at(-1)})`)
  }
  need('p1', "next step 1's prepared-rollout bullet", s1[iPrep], [
    '— a parallel rollout note this session wrote, or one the active THREAD.md names (a **THREAD.md-named** note), that no lead runs yet',
    "exactly as close step 2's **Rollouts this session wrote.** checks it", 'its handover order',
    'its guard for a THREAD.md-named note',
    "whose (i) reads an earlier close's held step for his not yet or orient-all's `left[]` (`/thread:execute [[<slug>]] (held: not yet)` or `(held: orient-all left it)`) as a hold",
    "its `unstarted` call over the handoff scan's `# scanned` dirs",
    'the scan and `unstarted` write nothing', 'and its holds', 'Only `unstarted <slug> <root>` with no hold counts',
    'While another session holds the thread, a note only THREAD.md names is not checked here.'])

  // p2: next step 3's paragraph, after Compact and before While another session holds the thread.
  const s3 = linesOf(slice(nx, /^3\. \*\*Recommend ONE move/, /^4\. /))
  const iCompact = at(s3, COMPACT), iFirst = at(s3, STARTS_FIRST), iHolds = at(s3, HOLDS)
  if (!(iCompact >= 0 && iCompact < iFirst && iFirst < iHolds)) flag('p2', `step 3's paragraph is out of place (${iCompact}, ${iFirst}, ${iHolds})`)
  need('p2', "next step 3's **A rollout prepared, not started, starts first.**", s3[iFirst], [
    'decided and never asked (Owner *gate*', '`${CLAUDE_PLUGIN_ROOT}/skills/_shared/asking.md` § 1', 'ADR 0057 d2', 'ADR 0072',
    "The launch is no move of this session's", "step 5 runs it first, then this session's own move",
    'as if no rollout waited', 'in the same turn', "The rollout is never this session's keep-going step",
    'its launch never makes the work continue elsewhere',
    'While another session holds the thread, a note this session wrote launches all the same', 'the archive line follows it',
    'A held note gets no launch: the line names it'])

  // p3: next step 4's launch bullet, directly after The line., and the archive line's lead.
  const s4 = linesOf(slice(nx, /^4\. /, /^5\. /))
  const iLine = at(s4, THE_LINE), iLaunch = at(s4, LAUNCH_LINE)
  if (iLine < 0 || iLaunch !== iLine + 1) flag('p3', `step 4's launch bullet is not directly after **The line.** (${iLine}, ${iLaunch})`)
  need('p3', "next step 4's **The launch, first in the line.**", s4[iLaunch], [
    '`Next move: hand [[<slug>]] to a fresh lead, then <move>, because its note is written and no lead runs it, and <reason>.`',
    'before what the move leaves behind and before any `Carried:`',
    '`A fresh session runs /thread:execute [[<slug>]] from <root>; say "not yet" to withdraw the handoff.`',
    'Several notes are named together',
    '`[[<slug>]] is not started (<the hold>); say "hand it off" to start its lead, or run /thread:execute [[<slug>]] in <root>.`',
    'His "hand it off" to that held-note line runs `${CLAUDE_PLUGIN_ROOT}/skills/handoff/SKILL.md` through its **Rollout launch.** for that note',
    'never a handoff of this thread',
    'When the move is not clear there is no line: each launch\'s `A fresh session runs …` sentence, and each held note\'s sentence, prints on its own line just before the menu'])
  need('p3', "next step 4's archive line lead", s4[at(s4, ARCHIVE_LINE)], ['After a launch (step 3)',
    'the line is exactly two parts, after the launch\'s sentence when there was a launch',
    '(**The launch, first in the line.**) opens the line, before its two parts',
    'and the archive part\'s "Nothing is written." reads "Nothing else is written."'])

  // p4: next step 5's A launch first., and § Don't.
  const s5 = linesOf(slice(nx, DISPATCH, /^## /))
  const iDispatch = at(s5, DISPATCH), iLF = at(s5, LAUNCH_FIRST), iArch = at(s5, DISPATCHED)
  if (!(iDispatch >= 0 && iDispatch < iLF && iLF < iArch)) flag('p4', `step 5's **A launch first.** is out of place (${iDispatch}, ${iLF}, ${iArch})`)
  need('p4', "next step 5's **A launch first.**", s5[iLF], [
    '`${CLAUDE_PLUGIN_ROOT}/skills/handoff/SKILL.md` through its **Rollout launch.**',
    "orient § 9's **Fresh session** continuation", 'start in its Project root `<root>`, then `/thread:execute [[<slug>]]`',
    'handoff § Next for this session is skipped for the launch', "then dispatches this session's own move",
    'as if no rollout waited', 'in the same turn', 'With close as the move, close step 2 reads the launch as a handover',
    'never as a `/thread:execute` step left to do', 'When the move is not clear, the launch runs before the menu is asked',
    "and its sentence (step 4's **The launch, first in the line.**) prints on its own line just before the menu"])
  need('p4', "next § Don't", lineOf(slice(nx, /^## Don't/, /^## /), DONT), ["its launch runs first, whatever this session's move",
    'is never put to him as a question', 'only his "not yet" or a hold (close step 2) stops it'])

  // p5: close step 2's Rollouts this session wrote.
  const cl = F[CLOSE] ?? ''
  const rw = slice(cl, /^ {3}- \*\*Rollouts this session wrote\.\*\*/, /^3\. /) ?? ''
  const rwl = linesOf(rw)
  const items = [/^ {5}1\. \*\*Handed over/, /^ {5}2\. \*\*No handover\*\*/, /^ {5}3\. \*\*A THREAD\.md-named note's guard\.\*\*/, /^ {5}4\. \*\*Holds\.\*\*/]
    .map((re) => at(rwl, re))
  if (items.some((i, k) => i < 0 || (k > 0 && i <= items[k - 1]))) flag('p5', `close step 2's items are not 1 to 4 in order (${items})`)
  need('p5', "close step 2's lead", rwl[0], [
    'A note the active THREAD.md names (ADR 0072 d4) is checked the same way, as a **THREAD.md-named** note, unless this session wrote it',
    '`[[<project-slug>-rollout-<YYYY-MM-DD>[-N]]]` link or a `/thread:execute [[<slug>]]` line',
    "Where we are, Next steps or Resume instructions, as they stood before this session's first write to it", 'never only as history'])
  need('p5', "close step 2's item 1", rwl[items[0]], [
    "A thread handoff doc this session wrote whose § What remains or Paste-ready prompt names the note as its consumer's step is a handover too"])
  need('p5', "close step 2's item 2", rwl[items[1]], ['`unstarted <slug> <root>` → sub-step 7.10', 'unless a hold applies (item 4)',
    "step 8's `rollout not started:` row ending `(held: <why>)`", '`unstarted <slug> (no Project root line)` is such a hold'])
  need('p5', "close step 2's item 3", rwl[items[2]], ['(i) THREAD.md records no handover and no carried hold for it', '`handed [[<slug>]] to a fresh lead`',
    "and none is a held step (step 4's one form) whose hold carries, `/thread:execute [[<slug>]] (held: not yet)` or `/thread:execute [[<slug>]] (held: orient-all left it)`",
    "His not yet and orient-all's `left[]` live only in the transcript that saw them",
    'A held step naming any other hold carries nothing, since each of those is read fresh here',
    '(i) reads it as the bare `/thread:execute [[<slug>]]` step it holds',
    "A carried hold gives the row ending that held step's own `(held: not yet)` or `(held: orient-all left it)`, and launches nothing",
    '`close hands [[<slug>]] to a fresh lead`', 'a `Raised (task_id` line, start when ready, or `start: unattended`',
    "(ii) on the Chorus Stage, Chorus's `list_sessions` shows no session named for the rollout or running, waiting on, or resting after `/thread:execute [[<slug>]]`",
    'off the Stage this check is skipped',
    "(iii) after item 2's `unstarted <slug> <root>`, run `bash \"${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/handoff-home.sh\" --dir <root>`",
    'when `<home>/docs/handoffs` is not among the scanned dirs, re-run `unstarted` with it added, and that line decides',
    '`(held: THREAD.md records a handover: <line>)`', '`(held: <session> may hold it)`', '`(held: handoff scan failed)`'])
  need('p5', "close step 2's item 4", rwl.slice(items[3]).join('\n'), [
    "Only his not yet and orient-all's `left[]` carry into a later session, through step 4's held step and guard (i) (item 3)",
    'His "not yet" for that note: Not yet\'s line, or a withdrawal of its launch', 'item 1): `(held: not yet)`',
    'or it is a pick he did not tick: `(held: orient-all left it)`',
    '`python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/ladder.py` (read-only) exits non-zero',
    'It runs once, fresh, when any note is launchable', 'A held `Execute:` line is no hold by itself',
    '`(held: no Project root line)`', 'Orient-all § 7 left the note: its `left[]` names it, or it is a pick he did not tick',
    'A THREAD.md-named note fails its guard (item 3)', "`/thread:open save`, and a Leg's close (§ Under a Leg): neither launches"])

  // p6: close sub-step 7.10.
  const cll = linesOf(cl)
  const i9 = at(cll, ITEM9), i10 = at(cll, ITEM10), iHyg = cll.indexOf(HYGIENE), i8 = at(cll, STEP8)
  if (!(i9 >= 0 && i10 === i9 + 1 && iHyg > i10 && i8 > iHyg)) flag('p6', `sub-step 7.10 is not directly after 7.9 and before § Commit hygiene and step 8 (${i9}, ${i10}, ${iHyg}, ${i8})`)
  need('p6', 'close sub-step 7.10', cll[i10], ['`${CLAUDE_PLUGIN_ROOT}/skills/handoff/SKILL.md` through its **Rollout launch.**',
    "orient § 9's **Fresh session** continuation", 'start in the Project root `<root>`, then `/thread:execute [[<slug>]]`',
    'ADR 0072', 'after every commit above and after 7.9', "before step 8's report", 'Handoff lands its own doc',
    'marked `(launch doc for [[<slug>]])`', "counts in step 9's banner choice", 'handoff § Next for this session is skipped',
    'its § Build closing line is not printed', "A manual handoff's labelled prompt prints fenced, just above the report",
    "In Codex Desktop, the created task's directive (handoff § Success contract, step 5: `::created-thread{threadId=\"…\"}`",
    'prints bare, on its own line, just above the report too, where a manual prompt prints, so nothing follows the banner (step 9, rule (2))',
    "its id fills the row's `(<threadId>)`",
    'Nothing here asks', '`(launch failed: <first stderr line>)`', 'a `create_thread` error is handoff § Fail closed',
    'Skipped under `/thread:open save`', 'Skipped under a Leg (§ Under a Leg)'])

  // p7: close step 8's rows.
  const s8 = cll[i8] ?? ''
  need('p7', 'close step 8', s8, ['ending ` (held: <why>)` or ` (launch failed: <first stderr line>)`',
    '`rollout handed off: [[<slug>]] · <abs doc path> · starting on the Stage (task_id <task id>)`',
    '`rollout handed off: [[<slug>]] · <abs doc path> · started as a Codex Desktop task (<threadId>)`',
    '`rollout handed off: [[<slug>]] · <abs doc path> · manual handoff: its prompt is above; run it from <root>`'])
  if (s8.match(/`(rollout not started: [^`]*)`/)?.[1] !== CANONICAL) flag('p7', "step 8's first `rollout not started:` span is not the canonical row")

  // p8: handoff and the lifecycle.
  const h = F[HANDOFF] ?? ''
  need('p8', "handoff's **Invocation gate.**", slice(h, /^\*\*Invocation gate\.\*\*/, /^$/), [
    '"hand it off" on close\'s `rollout not started:` row or on next step 4\'s held-note line dispatched, or close step 7.10 or next step 5 runs (it starts a rollout\'s lead'])
  need('p8', "handoff's **Rollout launch.**", slice(h, /^\*\*Rollout launch\.\*\*/, /^\*\*Split launch\.\*\*/), [
    'or his "hand it off" on close\'s `rollout not started:` row or on next step 4\'s held-note line, or close step 7.10, or next step 5)',
    "(§ Next for this session is skipped). Under close step 7.10 and next step 5 its caller goes on after it (ADR 0072): close to its report and banner, next to this session's own move."])
  const skipped = slice(section(h, /^## Next for this session$/) ?? '', /^- Every \*\*Rollout launch\.\*\*/, /^\s*$/)
  need('p8', "handoff's **Skipped on a dispatch.**", skipped, ["close step 7.10's launch and next step 5's",
    'his "hand it off" on close\'s `rollout not started:` row or on next step 4\'s held-note line',
    "Its turn ends the same way, on handoff's own output. Under close step 7.10 and next step 5 its caller goes on after that output (ADR 0072): close to its report and banner, next to this session's own move."])
  need('p8', "handoff's **Failure path.**", para(h, '**Failure path.**'), ["Under close step 7.10's launch nothing is asked",
    "close prints its `rollout not started: … (launch failed: <first stderr line>)` row and ends as it would",
    "next step 5's launch still asks, as above, and next's own move follows once he answers"])
  need('p8', 'handoff § Build', section(h, /^## Build the handoff prompt/), [
    "Under close step 7.10 this line is not printed: close's `rollout handed off:` row says it, and close's report and banner follow. Under next step 5 it prints, and next's own move follows."])
  need('p8', 'lifecycle § Withdrawn', section(F[LIFECYCLE] ?? '', /^## Withdrawn/), [
    'and close reads it as no handover (close step 2). That is his not yet, so close holds it: its row, never a fresh launch (ADR 0072).'])

  // p9: the glossary.
  const ctx = F[CONTEXT] ?? ''
  const eh = entry(ctx, 'Execute handoff')
  need('p9', 'CONTEXT **Execute handoff**', eh, ['and at orient § 9 and schedule step 8 only a refused ladder file holds it',
    "For a note this session wrote, or its THREAD.md names, that no lead runs, `next` runs it first, before this session's own move, and close ends with it (ADR 0072); only his not yet or a hold close step 2 names leaves close's `rollout not started:` row instead."])
  if (eh.includes("Close's `rollout not started:` row names it again") || !/_Avoid_: execute offer\.$/.test(eh.trim())) {
    flag('p9', 'CONTEXT **Execute handoff** keeps the old close sentence, or no longer ends on its _Avoid_')
  }
  need('p9', 'CONTEXT **Router (`next`)**', entry(ctx, 'Router (`next`)'), [
    'A rollout note written and waiting with no lead gets its **execute handoff** first, before the move (ADR 0072).'])

  // p10: ADR 0072 and ADR 0057's Status.
  const adr = F[ADR] ?? ''
  const adrLines = linesOf(adr)
  for (const hd of ['## Context', '## Decision', '## Decided for him (overturnable)', '## Considered options', '## Consequences', '## Follow-ups']) {
    if (!adrLines.includes(hd)) flag('p10', `ADR 0072 has no ${hd}`)
  }
  need('p10', 'ADR 0072 Status', slice(adr, /^Status:/, /^\s*$/), ['thread-skill-p40-2-next-starts-a-prepared-handoff-itself'])
  need('p10', 'ADR 0072 § Decision', section(adr, /^## Decision$/), ['**d1. `next` launches first, then makes its own move.**',
    '**d2. Close ends with the launch.**', '**d3. The holds.**', '**d4. THREAD.md-named notes.**', '**d5. THREAD.md records the handover.**',
    "Only his not yet and orient-all's `left[]` carry into a later session", '`/thread:execute [[<slug>]] (held: <why>)`',
    '`(held: not yet)` or `(held: orient-all left it)`', 'a held step naming one reads as the bare step it holds',
    '`· started as a Codex Desktop task (<threadId>)`', 'no carried hold (d3)'])
  need('p10', 'ADR 0072 § Follow-ups', section(adr, /^## Follow-ups$/), [
    'Filed as the vault task `thread-skill-followup-next-and-close-descriptions-name-the-launch`',
    'Filed as the vault task `thread-skill-followup-readme-next-and-close-rows-name-the-launch`'])
  need('p10', 'ADR 0072 § Decided for him', section(adr, /^## Decided for him/), ['Launch first, then the own move',
    'after its commits and 7.9', 'The ladder is read fresh', 'handoff-router-dispatch-skips-next'])
  need('p10', 'ADR 0057 Status', slice(F[ADR57] ?? '', /^Status:/, /^\s*$/), ['d5 and its close-row item amended by ADR 0072'])

  // p11: close step 4, step 9 and the edge cases.
  const s4c = linesOf(slice(cl, /^4\. \*\*Compute the thread-update diff/, /^5\. /))
  const firstBullet = s4c.find((l) => /^ {3}- /.test(l)) ?? ''
  const iLog = at(s4c, '   - Session log:'), iRoll = at(s4c, '   - Rollout handovers:')
  if (!firstBullet.startsWith('   - Flip set, first') || !(iLog >= 0 && iRoll === iLog + 1)) flag('p11', `step 4's rollout bullet is not right after Session log, or the flip set is not first (${iLog}, ${iRoll})`)
  need('p11', "close step 4's rollout bullet", s4c[iRoll], ['never keep a bare `/thread:execute [[<slug>]]` step',
    '`close hands [[<slug>]] to a fresh lead (see the step-8 row)`', 'which stays true if the launch fails',
    '`handed [[<slug>]] to a fresh lead`', 'A held note keeps its step in one fixed form, `/thread:execute [[<slug>]] (held: <why>)`',
    "`<why>` its step-8 row's", 'reads `(held: not yet)` and `(held: orient-all left it)` as holds that carry, so it holds the note again',
    'and reads any other `<why>` fresh'])
  const s9 = slice(cl, /^9\. \*\*End with the closing banner/, /^## Edge cases/) ?? ''
  need('p11', 'close step 9', s9, ["only after sub-step 7.10's launches end",
    'A `rollout handed off: … starting on the Stage` row is no follow-up; a manual one is, since its prompt is his to open',
    'the research-landing offer and the rollout row included, and so is each `rollout handed off:` row'])
  need('p11', 'close § Edge cases', section(cl, /^## Edge cases/), ['- **A THREAD.md-named rollout note**',
    'so his not yet outlives the session that heard it', 'and the same reply to next step 4\'s held-note line runs it the same way',
    '- **His "not yet" after close\'s launch**', '- **A rollout an orient-all pass left unstarted**'])

  return { rules: [...fails.keys()].sort(), details: [...fails.values()].flat() }
}

const real = readTree()

// A control's copy of `real` with `from` replaced by `to` in `file`, asserting the replacement happened.
function swap(file, from, to) {
  const text = (real[file] ?? '').replace(from, to)
  assert.notEqual(text, real[file], `control is vacuous: ${from} not found in ${file}`)
  return { ...real, [file]: text }
}
const only = (files, rule, label) => assert.deepEqual(check(files).rules, [rule], `control ${label}: ${JSON.stringify(check(files).details)}`)

test('next and close start a prepared rollout themselves, wired through handoff, the lifecycle, the glossary and ADR 0072', () => {
  const { rules, details } = check(real)
  assert.deepEqual(rules, [], details.join('\n'))
})

test('controls: next (p1 to p4)', () => {
  only(swap(NEXT, 'its guard for a THREAD.md-named note, ', ''), 'p1', 'guard dropped')
  const prep = real[NEXT].split('\n').find((l) => PREPARED.test(l))
  const own = real[NEXT].split('\n').find((l) => OWN_BRANCH.test(l))
  assert.ok(prep && own, 'control setup: no prepared or own-branch bullet')
  only(swap(NEXT, `${own}\n${prep}`, `${prep}\n${own}`), 'p1', 'bullet above the own branch')
  only(swap(NEXT, "step 5 runs it first, then this session's own move", 'step 5 runs it first and the turn ends there'), 'p2', 'turn ends on the launch')
  only(swap(NEXT, 'a note this session wrote launches all the same', 'nothing launches'), 'p2', 'no launch beside another session')
  only(swap(NEXT, '; say "not yet" to withdraw the handoff.`', '.`'), 'p3', 'no overturn sentence')
  only(swap(NEXT, "then dispatches this session's own move", 'and ends the turn'), 'p4', 'launch ends the turn')
  only(swap(NEXT, 'is never put to him as a question', 'is offered to him'), 'p4', "§ Don't offers it")
  // the move not clear: the overturn sentence with nowhere to go, in step 4 and then in step 5
  only(swap(NEXT, ' When the move is not clear there is no line: each launch\'s `A fresh session runs …` sentence, and each held note\'s sentence, prints on its own line just before the menu (**The menu, when the move is not clear.**), so his overturn still has its place.', ''),
    'p3', 'no sentence before the menu')
  only(swap(NEXT, ", and its sentence (step 4's **The launch, first in the line.**) prints on its own line just before the menu", ''),
    'p4', 'step 5 prints no sentence before the menu')
  // his "hand it off" to a held-note line read as a handoff of this thread
  only(swap(NEXT, 'never a handoff of this thread', 'or a handoff of this thread'), 'p3', 'held-note reply')
  // the archive line back to its pre-launch lead: "exactly two parts" unqualified, "Nothing is written." after a launch
  only(swap(NEXT, ', and the archive part\'s "Nothing is written." reads "Nothing else is written.", since the launch wrote and landed its doc', ''),
    'p3', 'archive part unqualified after a launch')
  // the carried hold dropped from next step 1's guard
  only(swap(NEXT, ", whose (i) reads an earlier close's held step for his not yet or orient-all's `left[]` (`/thread:execute [[<slug>]] (held: not yet)` or `(held: orient-all left it)`) as a hold", ''),
    'p1', 'next reads no carried hold')
})

test('controls: close (p5 to p7, p11)', () => {
  only(swap(CLOSE, '(i) THREAD.md records no handover and no carried hold for it', '(i) THREAD.md'), 'p5', 'guard (i)')
  // session 2 loses session 1's not yet: guard (i) reads no held step, or reads every held step as a hold
  only(swap(CLOSE, ", and none is a held step (step 4's one form) whose hold carries, `/thread:execute [[<slug>]] (held: not yet)` or `/thread:execute [[<slug>]] (held: orient-all left it)`", ''),
    'p5', 'guard (i) reads no carried hold')
  only(swap(CLOSE, '(i) reads it as the bare `/thread:execute [[<slug>]]` step it holds', '(i) reads it as a hold'), 'p5', 'a fresh hold carries')
  only(swap(CLOSE, "Only his not yet and orient-all's `left[]` carry into a later session, through step 4's held step and guard (i) (item 3); every other hold here is read fresh by the session that closes.", ''),
    'p5', 'item 4 names no carried hold')
  only(swap(CLOSE, /\(ii\) on the Chorus Stage, Chorus's `list_sessions`[^;]*;/, ''), 'p5', 'guard (ii)')
  only(swap(CLOSE, '`unstarted <slug> <root>` → sub-step 7.10', '`unstarted <slug> <root>` → the `rollout not started:` row'), 'p5', 'no launch')
  const l9 = real[CLOSE].split('\n').find((l) => ITEM9.test(l))
  const l10 = real[CLOSE].split('\n').find((l) => ITEM10.test(l))
  assert.ok(l9 && l10, 'control setup: no item 9 or 10')
  only(swap(CLOSE, `${l9}\n${l10}`, `${l10}\n${l9}`), 'p6', '7.10 above 7.9')
  only(swap(CLOSE, 'Nothing here asks', 'Ask him whether to start it first'), 'p6', '7.10 asks')
  only(swap(CLOSE, ', `rollout handed off: [[<slug>]] · <abs doc path> · manual handoff: its prompt is above; run it from <root>`', ''), 'p7', 'manual row')
  only(swap(CLOSE, ', `rollout handed off: [[<slug>]] · <abs doc path> · started as a Codex Desktop task (<threadId>)`', ''), 'p7', 'Codex Desktop row')
  only(swap(CLOSE, / In Codex Desktop, the created task's directive [^]*?fills the row's `\(<threadId>\)`\./, ''), 'p6', 'Codex Desktop directive placement')
  only(swap(CLOSE, '`close hands [[<slug>]] to a fresh lead (see the step-8 row)`', '`/thread:execute [[<slug>]]`'), 'p11', 'close hands template')
  // the held step back to a free-form line, which no later guard can read
  only(swap(CLOSE, 'A held note keeps its step in one fixed form, `/thread:execute [[<slug>]] (held: <why>)`', 'A held note keeps its `/thread:execute [[<slug>]]` step, with its hold named'),
    'p11', 'held-step form')
  only(swap(CLOSE, ', and so is each `rollout handed off:` row', ''), 'p11', 'rule (3)')
})

test('controls: handoff, lifecycle, glossary and ADRs (p8 to p10)', () => {
  only(swap(HANDOFF, / Under close step 7\.10's launch nothing is asked:[^\n]*once he answers\./, ''), 'p8', 'carve-out')
  only(swap(HANDOFF, ', or close step 7.10\nor next step 5 runs', ', or close step 7.10 runs'), 'p8', 'gate without next')
  // next step 4's held-note line dropped from the gate, then from the Rollout launch list
  only(swap(HANDOFF, ' row or on next step 4\'s held-note line dispatched,', ' row dispatched,'), 'p8', 'gate without the held-note line')
  only(swap(HANDOFF, ' row or on next step 4\'s held-note line, or close step 7.10, or next step 5)', ' row, or close step 7.10, or next step 5)'),
    'p8', 'Rollout launch without the held-note line')
  only(swap(LIFECYCLE, ' That is his not yet, so close holds it: its row, never a fresh launch (ADR 0072).', ''), 'p8', 'withdrawn')
  only(swap(CONTEXT, /For a note this session\s+wrote, or its THREAD\.md names,[^]*?row\s+instead\./,
    "Close's `rollout not started:` row names it again for a\n  note this session wrote and left with no lead."), 'p9', 'old sentence back')
  only(swap(CONTEXT, /\s+A rollout note written and\s+waiting with no lead gets its \*\*execute handoff\*\* first, before the move\s+\(ADR 0072\)\./, ''), 'p9', 'router')
  only(swap(ADR, '**d4. THREAD.md-named notes.**', '**d4.**'), 'p10', 'd4')
  only(swap(ADR57, /d5 and\s+its close-row item amended by ADR 0072/, 'unchanged'), 'p10', 'ADR 0057 status')
  only(swap(ADR, /\nOnly his not yet and orient-all's `left\[\]` carry into a later session:[^]*?the bare step it holds\.\n/, '\n'), 'p10', 'd3 carried holds')
  only(swap(ADR, /Filed as the vault task\s+`thread-skill-followup-readme-next-and-close-rows-name-the-launch`\./, ''), 'p10', 'README follow-up unfiled')
})
