// A pre-dispatch args refusal halts the entry once and is never a *Lost call* (p32-1). Pins the prose an LLM lead follows
// in skills/execute/SKILL.md: § 4.5's *Args refusal* (an error whose text contains the engine's sentinel
// `thread:args-refused`, matched by contains, for a call or a resume of any kind: the canary check, the runId and any
// handle dropped, an integrate call's lane freed with `free-lane … || true` while the note keeps `integrating:`, no
// set-aside row, the error line printed, the halt, then a fresh call by *Restart routing* or step 1.4's `prepare`);
// *Lost call*'s exclusion in its definition, its dead-call bullet and its git-env-hold bullet; § 3.7's fifth *Can no
// longer resume* case; § 4's verifySlot check before the stamps (its halt, its integrate `free-lane`, the resume
// exemption); the *Run record*'s free-lane bullet; § 7's three halts; § 3's `verify-timeout` exit 4 and its shape
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

const S3 = /^### 3\. /
const S37 = /^### 3\.7\. /
const S4 = /^### 4\. /
const S45 = /^### 4\.5\. /
const S7 = /^### 7\. /

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

// Named failures; [] means every rule holds.
function check(skill) {
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

  // args-refusal: the paragraph sits right before *Lost call*; it covers every call kind and its resumes; it matches the
  // sentinel by contains; it is never a Lost call; the six steps in order (the check, the drops, the integrate
  // free-lane with `integrating:` kept, no row, the printed line, the halt); then the fresh call by Restart routing, the
  // integrate call's `prepare` re-entry by step 1.4, and the signed-gate warning printed at the halt.
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
      "(5) prints the error's first line", '(6) halts']) ||
    !ar.includes("the next entry's *Restart routing* holds no runId, so it makes a fresh call with args built afresh (§ 4)") ||
    !ar.includes("the next entry's step 1.4 takes its task through step 3's `prepare`") ||
    !ar.includes("For a refused § 3.7 signed-gate resume, the lead prints § 3.7's fresh-call warning above the halt line") ||
    !ar.includes('A fresh call refused again halts again')) {
    fails.push('args-refusal')
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

  // cannot-resume: § 3.7 counts five cases, the fifth the engine's refusal of a resumed call's args, whose fresh call
  // the next entry's Restart routing makes after the halt.
  if (!cannot.includes('Five cases') || /Four cases/.test(cannot) ||
    !cannot.includes("or the engine refuses the resumed call's args (*Args refusal*, § 4.5: e.g. a call launched without `verifySlot` before 5.0.0, resumed on a refusing engine)") ||
    !cannot.includes("that fresh call is made by the next entry's *Restart routing*, after the halt")) {
    fails.push('cannot-resume')
  }

  // pre-check: § 4 checks every fresh call's args.verifySlot against this entry's verify-timeout verifySlot beside
  // ladder.py, before the stamps for a task call or seeded revise (a write-nothing halt), after mark-integrating for an
  // integrate call (its free-lane, the note keeping `integrating:`); a resume is exempt (an *Args refusal* instead).
  if (!pre.includes('For every fresh call (a start, a restart\'s own call, a seeded revise, an integrate call)') ||
    !pre.includes("`args.verifySlot` must be exactly this entry's `verify-timeout` `verifySlot`") ||
    !before(pre, 'Check it beside `ladder.py`', "before § 4's `status: in_progress` and `owner:` stamps and before `mark-started`") ||
    !pre.includes('a missing or different value writes nothing (no stamp, no `mark-started`, no Workflow call)') || !pre.includes(PRE_HALT) ||
    !pre.includes("For an integrate call it is after step 3's `mark-integrating`, before its `startedAt` stamp and the canary arm") ||
    !pre.includes(`after ${FREE} while the note keeps \`integrating:\``) ||
    !pre.includes('A resume is exempt: it keeps the original-args rule (below), and a refusal there is an *Args refusal* (§ 4.5)')) {
    fails.push('pre-check')
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

  // verify-timeout: § 3's exit 4 (its ERROR line, the write-nothing halt, the order of the exits) and the printed shape,
  // with no `verifySlots` left anywhere in SKILL.md.
  if (!s3.includes('`ERROR: verify-timeout: <path> not found`') || !s3.includes('reason="verify-slot.py not found"') ||
    !s3.includes('The exits are checked in the order 1, 2, 3, then 4.') ||
    !s3.includes('Exit 0 prints `{"verifyTimeout": <verify_timeout>, "harnessTimeoutMs": <harnessTimeoutMs>, "slotWait": <slot_wait>, "verifySlot": {"script": <verify-slot.py>, "slots": <verify_slots>}}`') ||
    /verifySlots/.test(skill)) {
    fails.push('verify-timeout')
  }

  // prose-sites: no args refusal reads as a *Lost call* any more: the integrate call's prUrlError and rung clauses and
  // *Verify slots* name an *Args refusal*.
  if (/reads as a \*Lost call\*/.test(skill) ||
    !integrateCall.includes('with `prUrlError` as the reason, since the engine would refuse that call before dispatch (an *Args refusal*, which halts the entry)') ||
    !integrateCall.includes("fails the engine's args check before dispatch, an *Args refusal*") ||
    !slotsP.includes('refuses a call without it before any dispatch (an *Args refusal*, above;')) {
    fails.push('prose-sites')
  }
  return [...new Set(fails)]
}

test('execute § 3, § 3.7, § 4, § 4.5 and § 7 hold every args-refusal rule', () => {
  assert.deepEqual(check(real), [])
})

// ---- controls: each mutates the real text in one place and must fail with exactly its rule ---------

const RULES = ['args-refusal', 'lost-exclusion', 'cannot-resume', 'pre-check', 'free-lane', 'halts', 'verify-timeout', 'prose-sites']
const CONTROLLED = new Set()

function edit(text, from, to) {
  assert.ok(text.includes(from), `control setup: ${from.slice(0, 80)} not found`)
  return text.replace(from, to)
}
const only = (skill, rule, label) => {
  CONTROLLED.add(rule)
  assert.deepEqual(check(skill), [rule], label)
}

test('control: Args refusal without its integrate free-lane fails args-refusal', () => {
  only(edit(real, `(3) for an integrate call only, runs ${FREE}: the lane frees while the note keeps \`integrating:\`, as after step 3's tripped check; `, ''),
    'args-refusal', 'no free-lane')
})

test('control: a sentinel matched by "starts with" fails args-refusal', () => {
  only(edit(real, `whose text **contains** ${SENTINEL}`, `whose text **starts with** ${SENTINEL}`), 'args-refusal', 'starts with')
})

test('control: Args refusal moved away from Lost call fails args-refusal', () => {
  const lines = real.split('\n')
  const i = lines.findIndex((l) => l.startsWith('**Args refusal (p32-1).**'))
  const moved = [...lines.slice(0, i), ...lines.slice(i + 2)]
  const j = moved.findIndex((l) => l.startsWith('**Restart routing**'))
  moved.splice(j, 0, lines[i], '')
  only(moved.join('\n'), 'args-refusal', 'not right before Lost call')
})

test('control: Lost call without its Args refusal exclusion fails lost-exclusion', () => {
  only(edit(real, ` An error that contains ${SENTINEL} is never a *Lost call*: *Args refusal*, above.`, ''), 'lost-exclusion', 'definition')
  only(edit(real, `, except a resume whose error contains ${SENTINEL}, which is never a *Lost call* and never dead: *Args refusal*`, ''),
    'lost-exclusion', 'dead-call bullet')
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

test('control: the free-lane bullet without the integrate halts fails free-lane', () => {
  only(edit(real, ' (an *Args refusal* or verifySlot pre-check halt of an integrate call included)', ''), 'free-lane', 'bullet')
})

test('control: § 7 without verify-timeout exit 4 fails halts', () => {
  const b = real.split('\n').find((l) => l.startsWith('- `reconcile-rollout.py verify-timeout` exits 4 at an entry')) + '\n'
  only(edit(real, b, ''), 'halts', 'no exit 4')
})

test('control: verifySlots back in the printed shape fails verify-timeout', () => {
  only(edit(real, '"slotWait": <slot_wait>, "verifySlot": {', '"slotWait": <slot_wait>, "verifySlots": <verify_slots>, "verifySlot": {'), 'verify-timeout', 'verifySlots')
})

test('control: the prUrlError clause reading as a Lost call again fails prose-sites', () => {
  only(edit(real, 'before dispatch (an *Args refusal*, which halts the entry);', 'before dispatch and the refusal reads as a *Lost call*;'), 'prose-sites', 'prUrlError')
})

test('the rules are all named (8) and each has a control', () => {
  assert.equal(RULES.length, 8)
  assert.deepEqual(RULES.filter((r) => !CONTROLLED.has(r)), [])
})
