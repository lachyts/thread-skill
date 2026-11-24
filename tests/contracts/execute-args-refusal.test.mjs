// A pre-dispatch args refusal is a Lead error the lead redoes, a halt only at its bound (p55-3, ADR 0085 d8), and is never a
// *Lost call* (p32-1). Pins the prose an LLM lead follows in skills/execute/SKILL.md: § 4.5's *Lead error* (its place
// right before *Args refusal*, its four signatures, the precedence sentence, the bound against reconcile-rollout.py's
// LEAD_ERROR_BOUND and the interim route at the bound); § 4.5's *Args refusal* (an error whose text contains the engine's
// sentinel `thread:args-refused`, matched by contains, for a call or a resume of any kind: the canary check, the runId
// and any handle dropped, an integrate call's lane freed with `free-lane … || true` while the note keeps `integrating:`,
// no set-aside row, the error line printed, the Lead error and its redo by *Restart routing* or step 1.4's `prepare`);
// *Lost call*'s exclusion in its definition, its dead-call bullet and its git-env-hold bullet; the lead's three
// decision points for a call that comes back (step 2, the integrate call's return, § 5's resume), each sending an error
// that contains the sentinel to *Args refusal* before its *Lost call* clause; § Room stop item 6 and *Lost call*'s
// room-stop bullet, each excluding such an error from room-stopped; § 3.7's fifth *Can no longer resume* case; § 4's
// verifySlot check before the stamps (its halt, its integrate `free-lane`, the resume exemption) and the three launch
// sequences that name it (step 1.2's seeded revise, step 1.3, the integrate call); the *Run record*'s free-lane bullet; § 7's three halts
// (each a Lead error's bound),
// each listed under ADR 0048's *Whole-rollout halts kept* and matched by reconcile-rollout.py's WHOLE_HALT_PATTERNS (so the
// Watchdog's `moving` reads it as a wait on Lachy, never `stalled`); § 3's `verify-timeout` exit 4 and its shape
// without `verifySlots`; and no "reads as a *Lost call*" left. The engine half (the sentinel on every refusal) is pinned
// by skills/execute/tests/args-refusal.test.mjs.
//
// Same shape as execute-signed-gate.test.mjs: every rule lives in one function, check(skill), that returns named
// failures, so the real text and the controls run through identical logic; each control mutates the real text in one
// place and must fail with exactly its rule. Reads files only.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { collapse, read, section } from '../lib/contract-text.mjs'

const real = read('skills/execute/SKILL.md')
const realRr = read('skills/execute/scripts/reconcile-rollout.py')

const S3 = /^### 3\. /
const S37 = /^### 3\.7\. /
const S4 = /^### 4\. /
const S45 = /^### 4\.5\. /
const S5 = /^### 5\. /
const S7 = /^### 7\. /
const ROOM = /^## Room stop \(/

// A bold-labelled paragraph inside a section: from its label line to the next bold label at column 0.
function labelled(text, sectionRe, label) {
  const lines = (section(text, sectionRe) ?? '').split('\n')
  const i = lines.findIndex((l) => l.startsWith(`**${label}`))
  if (i < 0) return ''
  const j = lines.findIndex((l, k) => k > i && /^\*\*[A-Z`]/.test(l))
  return collapse(lines.slice(i, j < 0 ? undefined : j).join('\n'))
}
// The first line of `text` starting with `head`, collapsed ('' when none).
const lineAt = (text, head) => collapse((text ?? '').split('\n').find((l) => l.startsWith(head)) ?? '')
const before = (hay, a, b) => hay.indexOf(a) >= 0 && hay.indexOf(b) >= 0 && hay.indexOf(a) < hay.indexOf(b)
const inOrder = (hay, parts) => parts.every((p, i) => i === 0 || before(hay, parts[i - 1], p))

const SENTINEL = '`thread:args-refused`'
const FREE = '`python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/reconcile-rollout.py free-lane --tasks <slug> || true`'
const HALT = 'reason="engine refused the args of [[<slug>]]"'
const PRE_HALT = 'reason="args.verifySlot is not this entry\'s verify-timeout verifySlot"'
// § 7's three p32-1 halts as *Whole-rollout halts kept* words each, and the reason a halt's Run-record line carries.
const KEPT = [
  ['reason="verify-slot.py not found"', 'verify-slot.py not found'],
  [PRE_HALT, "args.verifySlot is not this entry's verify-timeout verifySlot"],
  ['reason="engine refused the args of [[task]]"', 'engine refused the args of [[p32-1-some-task]]'],
]
// reconcile-rollout.py's WHOLE_HALT_PATTERNS as anchored RegExps ({rollout} formatted with a stem), as `moving` matches.
function wholeHalts(rr) {
  const lines = rr.split('\n')
  const i = lines.findIndex((l) => l.startsWith('WHOLE_HALT_PATTERNS = ('))
  if (i < 0) return []
  const j = lines.findIndex((l, k) => k > i && l === ')')
  return [...lines.slice(i + 1, j).join('\n').matchAll(/r"((?:[^"\\]|\\.)*)"/g)].map((m) => new RegExp('^' + m[1].replace('{rollout}', 'ro')))
}

// § 4.5's *Lead error* (p55-3, ADR 0085 d8), its pinned clauses.
const LE_HEAD = '**Lead error (ADR 0085 d8).**'
const LE_SITES = ["(a) an *Args refusal* (below: an error that contains `thread:args-refused`)",
  "(b) § 4's pre-check mismatch (`args.verifySlot`, `args.securityCheck`), only when a second `reconcile-rollout.py verify-timeout --rollout <rollout-note>` still prints this entry's line, so the args are what differ",
  '(c) an integrate row whose merge step STOPped on a value it was passed while naming another',
  "(d) a loop command that never ran, read on the lead's own engine command by four signatures"]
const LE_SIGNATURES = ['**S1** exit 2 and a stderr line that contains `usage:` (under `|| true` the line alone counts)',
  "**S2** exit 2 and a stderr line that contains `can't open file` (python's, for a script path that is not there)",
  "**S3** the shell's exit 126 or 127 for the command typed (`command not found`, `No such file or directory`, `Permission denied`)",
  // S4 and LE_NEVER are pinned without the script's name: this file reads the prose, never the script (tests/fast-tier.map)
  'set-aside` exit 2 whose stderr line holds `lead error:`']
const LE_NEVER = "Never a Lead error: an exit 2 whose line starts `engine-snapshot:` (re-run it from the root it names, § 1.5), and `"
const LE_NEVER_VERIFY = " verify` once its `<out>.rc` exists (its exit is the verifier's)."
const LE_FIRST = "**A Lead error is read first**, before any route the skill gives a command's exit (a halt, a *Lane hold*, a *Set aside*, a red, `|| true`)."
const LE_CMD = "`printf '%s' \"<the refusal's or the stderr's first line>\" | python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/reconcile-rollout.py lead-error --rollout <rollout-note> [--tasks <slug>] --site args-refusal|pre-check|command [--call task|revise|integrate]`"
const LE_REDO = ["(a) back to loop step 1, where *Restart routing*, or step 1.4's `prepare` then `call`, builds the fresh launch",
  '(b) rebuild the args (§ 4 for a task call, `call` again for a seeded revise or an integrate call) and check again',
  '(c) back to step 1: the note reads `review`, so step 1.4 runs `prepare` then `call`, and the lead types no sha',
  '(d) run the command as the step writes it', 'No set-aside row, no retry counter, no halt, no `## Needs you` item.']
const LE_INTERIM = "the lead hands over (*Lead hand-over*) while the line's `handOver` is true, that is while the task's `total` (every session's count, this line included) is below `LEAD_ERROR_HANDOVER_TOTAL` (6, twice the bound), so a refusal every fresh lead repeats stops at two hand-overs; from it the line reads `handOver: false` and the stop takes the route its site had before, (a) and (b) the § 7 halt with today's reason, (c) the engine's set-aside row (reconcile writes it), (d) the exit's existing route"
const LE_EXIT1 = "A `lead-error` exit 1 (its line not written: the Run record unreadable or unwritable) is no Lead error: the site's old route stands"

// Named failures; [] means every rule holds.
function check(skill, rr = realRr) {
  const fails = []
  const s45raw = section(skill, S45) ?? ''
  const ar = labelled(skill, S45, 'Args refusal (p32-1).')
  const lost = labelled(skill, S45, 'Lost call.')
  const lostRaw = (() => {
    const lines = s45raw.split('\n')
    const i = lines.findIndex((l) => l.startsWith('**Lost call.**'))
    return i < 0 ? [] : lines.slice(i)
  })()
  const lostDef = collapse(lostRaw[0] ?? '')
  const dead = lineAt(lostRaw.join('\n'), '- If the resume errors or returns no row too')
  const hold = lineAt(lostRaw.join('\n'), '- Under a git-env hold')
  const cannot = labelled(skill, S37, 'Can no longer resume.')
  const pre = labelled(skill, S4, 'Check verifySlot before the stamps (p32-1).')
  const s3 = collapse(section(skill, S3) ?? '')
  const s7 = collapse(section(skill, S7) ?? '')
  const freeBullet = lineAt(s45raw, '- `free-lane --tasks <slug>`')
  const integrateCall = lineAt(s45raw, '   **The integrate call**')
  const slotsP = labelled(skill, S45, 'Verify slots')
  const step2 = lineAt(s45raw, '2. **A task call returns.**')
  const s5 = collapse(section(skill, S5) ?? '')
  const lostRoom = lineAt(lostRaw.join('\n'), '- While a room stop stands')
  const item6 = lineAt(section(skill, ROOM), '6. **Room-stopped.**')
  const seeded = lineAt(s45raw, '   2. **Standing approval (ADR 0034), first.**')
  const step13 = lineAt(s45raw, '   3. For each slug in `restart`')

  // args-refusal: the paragraph sits right before *Lost call*; it covers every call kind and its resumes; it matches the
  // sentinel by contains; it is never a Lost call; the six steps in order (the check, the drops, the integrate
  // free-lane with `integrating:` kept, no row, the printed line, the Lead error with its halt only at the bound); then the
  // redo's fresh call by Restart routing, the integrate call's `prepare` re-entry by step 1.4, and the signed-gate warning
  // printed before the redo.
  const lines = s45raw.split('\n')
  const iAr = lines.findIndex((l) => l.startsWith('**Args refusal (p32-1).**'))
  const iNext = lines.findIndex((l, k) => k > iAr && /^\*\*[A-Z`]/.test(l))
  if (iAr < 0 || iNext < 0 || !lines[iNext].startsWith('**Lost call.**') ||
    !ar.includes('a task call, a seeded revise or an integrate call, or a resume of any of them') ||
    !ar.includes("*Lost call*'s `resumeFromRunId`, § 3.7's signed-gate resume, a room-stopped call's resume") ||
    !ar.includes(`whose text **contains** ${SENTINEL}`) || !ar.includes('a notification that wraps or cuts the error still carries it') ||
    !ar.includes('so it is never a *Lost call*: no resume, no dead-call row, no automatic retry') ||
    !ar.includes("runs the canary `check` for that call's window") ||
    !ar.includes("drops the runId, and any signed-gate or room-stop handle it resumed, from this session's record") ||
    !ar.includes(`for an integrate call only, runs ${FREE}: the lane frees while the note keeps \`integrating:\``) ||
    !ar.includes('writes no set-aside row, reconciles nothing and resumes nothing') ||
    !ar.includes("prints the error's first line verbatim above the status line") || !ar.includes(HALT) ||
    !inOrder(ar, ["(1) runs the canary `check`", '(2) drops the runId', '(3) for an integrate call only', '(4) writes no set-aside row',
      "(5) prints the error's first line", '(6) takes it as a Lead error']) ||
    !ar.includes('`lead-error --site args-refusal --call task|revise|integrate`') || !ar.includes('only at its bound does it halt (§ 7)') ||
    !ar.includes("the redo's *Restart routing* holds no runId, so it makes a fresh call with args built afresh (§ 4)") ||
    !ar.includes("the redo's step 1.4 takes its task through step 3's `prepare`") ||
    !ar.includes("For a refused § 3.7 signed-gate resume, the lead prints § 3.7's fresh-call warning before the redo") ||
    !ar.includes('A fresh call refused again is the next Lead error, and the one at the bound is the halt') ||
    !ar.includes('`securityCheck`, `unreachablePaths`, `task.arms`, `task.unreachable`, `integration` or `task.resume`')) {
    fails.push('args-refusal')
  }

  // lead-error (p55-3, ADR 0085 d8): § 4.5's *Lead error* sits right before *Args refusal*, with only its own two labels
  // between; it names the four sites, the four signatures and what is never one, the precedence sentence, the lead's
  // `lead-error` command and the redo per site, the bound against reconcile-rollout.py's LEAD_ERROR_BOUND, the hand-over at
  // the bound while `handOver` holds (p55-5) and the old route from LEAD_ERROR_HANDOVER_TOTAL, and `lead-error`'s exit 1.
  const iLe = lines.findIndex((l) => l.startsWith(LE_HEAD))
  const labels = iLe < 0 || iAr < iLe ? [] : lines.slice(iLe, iAr).filter((l) => /^\*\*[A-Z`]/.test(l))
  const le = labels.length ? collapse(lines.slice(iLe, iAr).join('\n')) : ''
  const bound = (rr.match(/^LEAD_ERROR_BOUND = (\d+)$/m) ?? [])[1]
  if (labels.length !== 2 || !labels[1].startsWith('**A Lead error is read first**') ||
    !LE_SITES.every((s) => le.includes(s)) || !LE_SIGNATURES.every((s) => le.includes(s)) || !le.includes(LE_NEVER) || !le.includes(LE_NEVER_VERIFY) ||
    !le.includes(LE_FIRST) || !le.includes(LE_CMD) || !LE_REDO.every((s) => le.includes(s)) ||
    !bound || !le.includes(`\`LEAD_ERROR_BOUND\` (${bound}) Lead errors per task per lead session`) ||
    !le.includes(LE_INTERIM) || !le.includes(LE_EXIT1)) {
    fails.push('lead-error')
  }

  // lost-exclusion: *Lost call*'s definition, its dead-call bullet and its git-env-hold bullet each send an error that
  // contains the sentinel to *Args refusal*, so no route (step 2, the integrate return, heartbeat clause (3), *Cold
  // resume*) resumes, sets aside or retries it.
  if (!lostDef.includes(`An error that contains ${SENTINEL} is never a *Lost call*: *Args refusal*`) ||
    !dead.includes(`except a resume whose error contains ${SENTINEL}, which is never a *Lost call* and never dead: *Args refusal*`) ||
    !hold.includes(`An error that contains ${SENTINEL} is no *Lost call* under a hold either: *Args refusal* still drops its runId and frees an integrate call's lane`) ||
    !lost.includes('*Args refusal*')) {
    fails.push('lost-exclusion')
  }

  // routing-sites: the lead's three decision points for a call that comes back each send an error that contains the
  // sentinel to *Args refusal* before their *Lost call* clause, so none resumes a refused call: step 2 (the check it ran
  // first is the refusal's step (1), never run twice), the integrate call's return (whatever the check's exit; its
  // step (3) frees the lane) and § 5's resume procedure (never resumed); each names the Lead error (a halt only at its bound).
  const ST2_AR = `An error that contains ${SENTINEL}: *Args refusal*, never a *Lost call*: the check this step ran first is its step (1), never run twice, and it is a Lead error (a halt only at its bound).`
  const ST2_LOST = 'Any other error, no row, or a transient row after a usage limit: *Lost call*.'
  const INT_AR = `An error that contains ${SENTINEL}, whatever the check's exit: *Args refusal*, never a *Lost call*: the check run first is its step (1), never run twice, its step (3) frees the lane while the note keeps \`integrating:\`, and it is a Lead error (a halt only at its bound).`
  const INT_LOST = 'Any other error, or no row, after a check that exited 0: *Lost call*'
  const S5_AR = `An error that contains ${SENTINEL} is an *Args refusal* (§ 4.5), never resumed: the engine refused the call's args before any dispatch, and the same args are refused again, so it is a Lead error (a halt only at its bound).`
  const S5_LOST = 'If a call dies otherwise or its notification never arrives (§ 4.5 *Lost call*), re-run § 2.5'
  if (!step2.includes(ST2_AR) || !before(step2, ST2_AR, ST2_LOST) || /An error, no row, or a transient row/.test(step2) ||
    !integrateCall.includes(INT_AR) || !before(integrateCall, INT_AR, INT_LOST) || /An error, or no row, after a check/.test(integrateCall) ||
    !s5.includes(S5_AR) || !before(s5, S5_AR, S5_LOST) || /If a call dies or its notification/.test(s5)) {
    fails.push('routing-sites')
  }

  // room-stop: a call that ends with an error is room-stopped while a room stop stands (it keeps its handle, counts in
  // `--running`, an integrate call keeps the lane, and it is resumed after the stop), except an error that contains the
  // sentinel: § Room stop item 6 and *Lost call*'s room-stop bullet each send it to *Args refusal*, which drops its runId
  // and frees an integrate call's lane.
  if (!item6.includes(`An error that contains ${SENTINEL} is never room-stopped either: *Args refusal* (§ 4.5) drops its runId and frees an integrate call's lane.`) ||
    !lostRoom.includes(`An error that contains ${SENTINEL} is never room-stopped: *Args refusal* drops its runId and frees an integrate call's lane.`)) {
    fails.push('room-stop')
  }

  // cannot-resume: § 3.7 counts five cases, the fifth the engine's refusal of a resumed call's args, whose fresh call
  // its Lead error's redo makes (Restart routing again), a halt only at its bound.
  if (!cannot.includes('Five cases') || /Four cases/.test(cannot) ||
    !cannot.includes("or the engine refuses the resumed call's args (*Args refusal*, § 4.5: e.g. a call launched without `verifySlot` before 5.0.0, resumed on a refusing engine)") ||
    !cannot.includes("that fresh call is made by its Lead error's redo (§ 4.5 *Lead error*: *Restart routing* again, a halt only at its bound)")) {
    fails.push('cannot-resume')
  }

  // pre-check: § 4 checks every fresh call's args.verifySlot against this entry's verify-timeout verifySlot beside
  // ladder.py, before the stamps for a task call or seeded revise (a write-nothing halt), after mark-integrating for an
  // integrate call (its free-lane, the note keeping `integrating:`); a resume is exempt (an *Args refusal* instead).
  if (!pre.includes('For every fresh call (a start, a restart\'s own call, a seeded revise, an integrate call)') ||
    !pre.includes("`args.verifySlot` must be exactly this entry's `verify-timeout` `verifySlot`") ||
    !before(pre, 'Check it beside `ladder.py`', "before § 4's `status: in_progress` and `owner:` stamps and before `mark-started`") ||
    !pre.includes('a missing or different value writes nothing (no stamp, no `mark-started`, no Workflow call)') || !pre.includes(PRE_HALT) ||
    !pre.includes("For an integrate call it is on `call`'s printed `args`, after step 3's `mark-integrating` and before the canary arm") ||
    !pre.includes(`after ${FREE} while the note keeps \`integrating:\``) ||
    !pre.includes('A resume is exempt: it keeps the original-args rule (below), and a refusal there is an *Args refusal* (§ 4.5)')) {
    fails.push('pre-check')
  }

  // launch-sites: the launch sequences a lead follows name § 4's check at the point it runs, before any stamp: step
  // 1.2's seeded-revise launch right after § 3's config, step 1.3 after a restart's *Restart routing* (whether the check
  // applies is routing's result: a resume is exempt), and the integrate call on `call`'s printed `args`, after
  // `mark-integrating` and before the canary arm.
  const CHECK = "§ 4's *Check verifySlot before the stamps*"
  const SEEDED = `A launch is: § 2.5, § 3's config, ${CHECK} (a missing or different \`args.verifySlot\` writes nothing: a Lead error, a halt only at its bound), stamp \`status: in_progress\``
  const ST13 = `§ 2.5, § 3's config, for a restart resolve *Restart routing* (it writes nothing), then ${CHECK} for a fresh call (a start, or the own call or seeded revise that routing chose for a restart; a resume is exempt), stamp \`status: in_progress\``
  const INT = `${CHECK} runs on \`call\`'s printed \`args\`, after step 3's \`mark-integrating\` and before the canary arm: a mismatch is a Lead error (\`call\` again, the lane still held), and only at its bound, or on an operator's edit, does it free the lane and halt.`
  if (!seeded.includes(SEEDED) || !before(seeded, SEEDED, '`mark-started --tasks <slug>') ||
    !step13.includes(ST13) || !before(step13, ST13, 'mark-started --tasks <slug>') ||
    !integrateCall.includes(INT) || !before(integrateCall, INT, 'The canary arm (*Git-env canary*: `--kind integrate`) runs right before its launch') ||
    !pre.includes("at the point each launch sequence names it: § 4.5 step 1.2's seeded-revise launch right after § 3's config, step 1.3 once a restart's *Restart routing* has chosen its call (a start's, right after § 3's config), and the integrate call (step 3)")) {
    fails.push('launch-sites')
  }

  // free-lane: the Run record's free-lane bullet names both integrate halts among the § 7 halts that leave the lane held.
  if (!freeBullet.includes('at any § 7 halt that leaves the lane held (an *Args refusal* or verifySlot pre-check halt of an integrate call included)')) {
    fails.push('free-lane')
  }

  // halts: § 7 lists the Args refusal halt and the pre-check halt, each with its integrate free-lane, and verify-timeout's
  // exit 4.
  if (!s7.includes(`the engine refuses a call's args (§ 4.5 *Args refusal*: an error that contains ${SENTINEL}, \`${HALT}\``) ||
    !s7.includes("§ 4's verifySlot pre-check finds a fresh call's `args.verifySlot` missing or not this entry's `verify-timeout` `verifySlot` (`" + PRE_HALT + '`') ||
    (s7.split('free-lane --tasks <slug> || true` while the note keeps `integrating:`').length - 1) !== 2 ||
    !s7.includes('`reconcile-rollout.py verify-timeout` exits 4 at an entry (§ 3: `reason="verify-slot.py not found"`')) {
    fails.push('halts')
  }

  // kept: each of the three is a whole-rollout halt by design (a missing script every entry repeats, a Lead error at its
  // bound in the args § 4 builds for every call), so ADR 0048 lists it under § 7's *Whole-rollout halts kept* and WHOLE_HALT_PATTERNS
  // matches its reason; without both, `moving` reads the halt beside pending work as `stalled`.
  const keptEvery = lineAt(section(skill, S7), '- *Threatens every task*')
  const pats = wholeHalts(rr)
  if (KEPT.some(([text, said]) => !keptEvery.includes('`' + text + '`') || !pats.some((p) => p.test(said)))) {
    fails.push('kept')
  }

  // verify-timeout: § 3's exit 4 (its ERROR line, the write-nothing halt, the order of the exits) and the printed shape,
  // with no `verifySlots` left anywhere in SKILL.md.
  if (!s3.includes('`ERROR: verify-timeout: <path> not found`') || !s3.includes('reason="verify-slot.py not found"') ||
    !s3.includes('The exits are checked in the order 1, 2, 3, 4, then 5.') ||
    !s3.includes('Exit 0 prints `{"verifyTimeout": <verify_timeout>, "harnessTimeoutMs": <harnessTimeoutMs>, "slotWait": <slot_wait>, "verifySlot": {"script": <verify-slot.py>, "slots": <verify_slots>}}`') ||
    /verifySlots/.test(skill)) {
    fails.push('verify-timeout')
  }

  // prose-sites: no args refusal reads as a *Lost call* any more: the integrate call's prUrlError and rung clauses and
  // *Verify slots* name an *Args refusal*.
  if (/reads as a \*Lost call\*/.test(skill) ||
    !integrateCall.includes('with `prUrlError` as the reason, since the engine would refuse that call before dispatch (an *Args refusal*, a Lead error)') ||
    !integrateCall.includes("fails the engine's args check before dispatch, an *Args refusal*") ||
    !slotsP.includes('refuses a call without it before any dispatch (an *Args refusal*, above;')) {
    fails.push('prose-sites')
  }
  return [...new Set(fails)]
}

test('execute § 3, § 3.7, § 4, § 4.5, § 5 and § 7 hold every args-refusal rule', () => {
  assert.deepEqual(check(real), [])
})

// ---- controls: each mutates the real text in one place and must fail with exactly its rule ---------

const RULES = ['args-refusal', 'lead-error', 'lost-exclusion', 'routing-sites', 'room-stop', 'cannot-resume', 'pre-check', 'launch-sites', 'free-lane', 'halts', 'kept', 'verify-timeout', 'prose-sites']
const CONTROLLED = new Set()

function edit(text, from, to) {
  assert.ok(text.includes(from), `control setup: ${from.slice(0, 80)} not found`)
  return text.replace(from, to)
}
const only = (skill, rule, label, rr = realRr) => {
  CONTROLLED.add(rule)
  assert.deepEqual(check(skill, rr), [rule], label)
}

test('control: Args refusal without its integrate free-lane fails args-refusal', () => {
  only(edit(real, `(3) for an integrate call only, runs ${FREE}: the lane frees while the note keeps \`integrating:\`, as after step 3's tripped check; `, ''),
    'args-refusal', 'no free-lane')
})

test('control: the refused args list without task.unreachable (p52-2) fails args-refusal', () => {
  only(edit(real, '`task.arms`, `task.unreachable`, `integration`', '`task.arms`, `integration`'), 'args-refusal', 'no task.unreachable')
})

test('control: a sentinel matched by "starts with" fails args-refusal', () => {
  only(edit(real, `whose text **contains** ${SENTINEL}`, `whose text **starts with** ${SENTINEL}`), 'args-refusal', 'starts with')
})

test('control: Args refusal moved away from Lost call fails args-refusal', () => {
  // *Lead error* moves with it (the paragraph right before, p55-3), so only args-refusal's own place breaks.
  const lines = real.split('\n')
  const i = lines.findIndex((l) => l.startsWith(LE_HEAD))
  const end = lines.findIndex((l) => l.startsWith('**Args refusal (p32-1).**')) + 2
  const moved = [...lines.slice(0, i), ...lines.slice(end)]
  const j = moved.findIndex((l) => l.startsWith('**Restart routing**'))
  moved.splice(j, 0, ...lines.slice(i, end))
  only(moved.join('\n'), 'args-refusal', 'not right before Lost call')
})

test('control: Lost call without its Args refusal exclusion fails lost-exclusion', () => {
  only(edit(real, ` An error that contains ${SENTINEL} is never a *Lost call*: *Args refusal*, above.`, ''), 'lost-exclusion', 'definition')
  only(edit(real, `, except a resume whose error contains ${SENTINEL}, which is never a *Lost call* and never dead: *Args refusal*`, ''),
    'lost-exclusion', 'dead-call bullet')
})

test('control: a decision point that sends every error to Lost call again fails routing-sites', () => {
  only(edit(real, `An error that contains ${SENTINEL}: *Args refusal*, never a *Lost call*: the check this step ran first is its step (1), never run twice, and it is a Lead error (a halt only at its bound). Any other error, no row,`,
    'An error, no row,'), 'routing-sites', 'step 2')
  only(edit(real, `An error that contains ${SENTINEL}, whatever the check's exit: *Args refusal*, never a *Lost call*: the check run first is its step (1), never run twice, its step (3) frees the lane while the note keeps \`integrating:\`, and it is a Lead error (a halt only at its bound). Any other error, or no row, after a check`,
    'An error, or no row, after a check'), 'routing-sites', 'integrate return')
  only(edit(real, `An error that contains ${SENTINEL} is an *Args refusal* (§ 4.5), never resumed: the engine refused the call's args before any dispatch, and the same args are refused again, so it is a Lead error (a halt only at its bound). If a call dies otherwise or`,
    'If a call dies or'), 'routing-sites', '§ 5')
})

test('control: a refused call counted room-stopped again fails room-stop', () => {
  only(edit(real, ` An error that contains ${SENTINEL} is never room-stopped either: *Args refusal* (§ 4.5) drops its runId and frees an integrate call's lane.`, ''),
    'room-stop', 'item 6')
  only(edit(real, ` An error that contains ${SENTINEL} is never room-stopped: *Args refusal* drops its runId and frees an integrate call's lane.`, ''),
    'room-stop', 'Lost call room-stop bullet')
})

test('control: Can no longer resume back on four cases fails cannot-resume', () => {
  only(edit(real, "Five cases: no handle (another session, or the record was lost), the script's sha differs, the script file is gone, the Workflow tool refuses the resume, or the engine refuses the resumed call's args (*Args refusal*, § 4.5: e.g. a call launched without `verifySlot` before 5.0.0, resumed on a refusing engine).",
    "Four cases: no handle (another session, or the record was lost), the script's sha differs, the script file is gone, or the Workflow tool refuses the resume."),
  'cannot-resume', 'four cases')
})

test('control: the pre-check without its integrate free-lane fails pre-check', () => {
  only(edit(real, `a mismatch halts the same way, after ${FREE} while the note keeps \`integrating:\`; that is its only write (the Run record's lane-freed line), and`,
    'a mismatch halts the same way, and'), 'pre-check', 'no free-lane')
})

test('control: the pre-check moved after the stamps fails pre-check', () => {
  only(edit(real, "For a task call or seeded revise that is before § 4's `status: in_progress` and `owner:` stamps and before `mark-started`:",
    "For a task call or seeded revise that is after § 4's `status: in_progress` and `owner:` stamps and `mark-started`:"), 'pre-check', 'after the stamps')
})

test('control: a launch sequence that no longer names the verifySlot check fails launch-sites', () => {
  only(edit(real, "A launch is: § 2.5, § 3's config, § 4's *Check verifySlot before the stamps* (a missing or different `args.verifySlot` writes nothing: a Lead error, a halt only at its bound), stamp",
    "A launch is: § 2.5, § 3's config, stamp"), 'launch-sites', 'seeded revise')
  only(edit(real, " § 4's *Check verifySlot before the stamps* runs on `call`'s printed `args`, after step 3's `mark-integrating` and before the canary arm: a mismatch is a Lead error (`call` again, the lane still held), and only at its bound, or on an operator's edit, does it free the lane and halt.", ''),
    'launch-sites', 'integrate call')
})

test('control: step 1.3 naming the verifySlot check before Restart routing resolves fails launch-sites', () => {
  only(edit(real, "§ 2.5, § 3's config, for a restart resolve *Restart routing* (it writes nothing), then § 4's *Check verifySlot before the stamps* for a fresh call (a start, or the own call or seeded revise that routing chose for a restart; a resume is exempt), stamp",
    "§ 2.5, § 3's config, § 4's *Check verifySlot before the stamps* for a fresh call (a start, or the own call or seeded revise that routing chose for a restart; a resume is exempt), for a restart resolve *Restart routing* (it writes nothing), stamp"),
  'launch-sites', 'check before routing')
})

test('control: the free-lane bullet without the integrate halts fails free-lane', () => {
  only(edit(real, ' (an *Args refusal* or verifySlot pre-check halt of an integrate call included)', ''), 'free-lane', 'bullet')
})

test('control: § 7 without verify-timeout exit 4 fails halts', () => {
  const b = real.split('\n').find((l) => l.startsWith('- `reconcile-rollout.py verify-timeout` exits 4 at an entry')) + '\n'
  only(edit(real, b, ''), 'halts', 'no exit 4')
})

test('control: a p32-1 halt left off the kept list, or no pattern matching it, fails kept', () => {
  only(edit(real, ' `reason="verify-slot.py not found"` (§ 3: the plugin install every entry runs from;', ' (§ 3: the plugin install every entry runs from;'),
    'kept', 'verify-slot.py not found unlisted')
  only(edit(real, ' and `reason="engine refused the args of [[task]]"` (§ 4.5 *Args refusal*)', ''), 'kept', 'Args refusal unlisted')
  only(real, 'kept', 'no pattern for the pre-check halt',
    edit(realRr, '    r"args\\.verifySlot is not this entry\'s verify-timeout verifySlot",\n', ''))
})

test('control: verifySlots back in the printed shape fails verify-timeout', () => {
  only(edit(real, '"slotWait": <slot_wait>, "verifySlot": {', '"slotWait": <slot_wait>, "verifySlots": <verify_slots>, "verifySlot": {'), 'verify-timeout', 'verifySlots')
})

test('control: the prUrlError clause reading as a Lost call again fails prose-sites', () => {
  only(edit(real, 'before dispatch (an *Args refusal*, a Lead error);', 'before dispatch and the refusal reads as a *Lost call*;'), 'prose-sites', 'prUrlError')
})

test('control (p55-3): the Lead error paragraph moved after Args refusal fails lead-error', () => {
  const lines = real.split('\n')
  const i = lines.findIndex((l) => l.startsWith(LE_HEAD))
  const j = lines.findIndex((l) => l.startsWith('**Args refusal (p32-1).**'))
  const block = lines.slice(i, j)
  const rest = [...lines.slice(0, i), ...lines.slice(j)]
  const k = rest.findIndex((l) => l.startsWith('**Restart routing**'))
  rest.splice(k, 0, ...block)
  only(rest.join('\n'), 'lead-error', 'after Args refusal')
})

test('control (p55-3): a signature dropped, the precedence sentence, the interim or exit 1 changed fails lead-error', () => {
  only(edit(real, " **S3** the shell's exit 126 or 127 for the command typed (`command not found`, `No such file or directory`, `Permission denied`);", ''),
    'lead-error', 'no S3')
  only(edit(real, '**A Lead error is read first**, before any route', '**A Lead error is read last**, after any route'), 'lead-error', 'read last')
  only(edit(real, ', (c) the engine\'s set-aside row (reconcile writes it), (d) the exit\'s existing route', ''), 'lead-error', 'no interim for (c), (d)')
  only(edit(real, ' is no Lead error: the site\'s old route stands', ' is a Lead error too'), 'lead-error', 'exit 1 redone')
})

test("control (p55-3): a bound the prose and LEAD_ERROR_BOUND disagree on fails lead-error", () => {
  only(real, 'lead-error', 'LEAD_ERROR_BOUND = 4', edit(realRr, '\nLEAD_ERROR_BOUND = 3\n', '\nLEAD_ERROR_BOUND = 4\n'))
})

test('the rules are all named (13) and each has a control', () => {
  assert.equal(RULES.length, 13)
  assert.deepEqual(RULES.filter((r) => !CONTROLLED.has(r)), [])
})
