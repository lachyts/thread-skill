// A signed gate resumes its own call on the plan the human signed while the lead holds its handle (p12-14;
// ADR 0008, ADR 0030 decision 4). Pins the prose an LLM lead follows in skills/execute/SKILL.md: approve-gates
// routes by the stage the gate stopped (Integration rejoins the queue; anything else restarts, with a
// `gates_signed:` marker), the lead keeps a gate-pending task call's signed-gate handle (its sha taken at
// launch), Restart routing resumes it with `resumeFromRunId` and only `task.approvedGates` added (the one
// sanctioned exception to "a resume re-passes the ORIGINAL args"), step 1.3 exempts resumes from the fresh
// `progress` arg, a call that can no longer resume takes a fresh call behind a printed warning on the restart
// that directly follows a sign-off only, the docs claim no more than that, and the report says so. The engine half is pinned by
// skills/execute/tests/approved-gates-resume.test.mjs, approve-gates' routing by reconcile-rollout-lead.test.sh.
//
// A separate file from execute-queue.test.mjs (p12-9's rule count stays its own). Same shape: every rule
// lives in one function, checkSignedGate(skill), that returns named failures, so the real text and the
// controls run through identical logic; each control mutates the real text in one place and must fail
// with exactly its rule. Reads files only.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { collapse, read, section } from '../lib/contract-text.mjs'

const real = read('skills/execute/SKILL.md')
const realContext = read('CONTEXT.md')

const S37 = /^### 3\.7\. /
const S4 = /^### 4\. /
const S45 = /^### 4\.5\. /
const S6 = /^### 6\. /
const S7 = /^### 7\. /
const DONTS = /^## Don'ts/

// A bold-labelled paragraph inside a section: from its label line to the next bold label at column 0
// (fenced lines included, so a paragraph's command block stays with it).
function labelled(text, sectionRe, label) {
  const lines = (section(text, sectionRe) ?? '').split('\n')
  const i = lines.findIndex((l) => l.startsWith(`**${label}`))
  if (i < 0) return ''
  const j = lines.findIndex((l, k) => k > i && /^\*\*[A-Z`]/.test(l))
  return collapse(lines.slice(i, j < 0 ? undefined : j).join('\n'))
}
const before = (hay, a, b) => hay.indexOf(a) >= 0 && hay.indexOf(b) >= 0 && hay.indexOf(a) < hay.indexOf(b)
const WARNING = "restarts on a fresh call, not a resume of its gate-pending call (<why>): it re-runs from its first agent (a plan-gated task's plan is re-judged), and a gate it words differently from ## Approved gates, a changed cap included, is asked again."

// Named failures for the signed-gate prose; [] means every rule holds.
function checkSignedGate(skill, context = realContext) {
  const fails = []
  const s37 = collapse(section(skill, S37) ?? '')
  const s4 = collapse(section(skill, S4) ?? '')
  const s6raw = section(skill, S6) ?? ''
  const s7 = collapse(section(skill, S7) ?? '')
  const donts = collapse(section(skill, DONTS) ?? '')
  const routing = labelled(skill, S37, 'Stage routing by `approve-gates`.')
  const handle = labelled(skill, S37, 'The signed-gate handle.')
  const resume = labelled(skill, S37, 'Signed-gate resume.')
  const cannot = labelled(skill, S37, 'Can no longer resume.')
  const restart = labelled(skill, S45, 'Restart routing')
  const lost = labelled(skill, S45, 'Lost call.')
  const aside = labelled(skill, S45, 'Set aside.')
  const s45raw = section(skill, S45) ?? ''
  const step2 = collapse((s45raw.split('\n').find((l) => /^2\. \*\*A task call returns\.\*\*/.test(l))) ?? '')
  const sub12 = collapse((s45raw.split('\n').find((l) => /^\s+2\. \*\*Seeded revises/.test(l))) ?? '')
  const sub13 = collapse((s45raw.split('\n').find((l) => /^\s+3\. For each slug in `restart`/.test(l))) ?? '')
  const lead = collapse((section(skill, S37) ?? '').split('\n').find((l) => l.startsWith('(moves the pending gates')) ?? '')
  const gated = collapse((context.split('\n- **').find((p) => p.startsWith('Gated input**')) ?? ''))
  const restartRaw = (() => {
    const lines = s45raw.split('\n')
    const i = lines.findIndex((l) => l.startsWith('**Restart routing'))
    if (i < 0) return []
    const out = []
    for (const l of lines.slice(i + 1)) { if (!l.startsWith('- ')) break; out.push(l) }
    return out
  })()
  const iLost = restartRaw.findIndex((l) => l.includes('→ *Lost call*'))
  const iHandle = restartRaw.findIndex((l) => l.includes('signed-gate handle') && l.includes("§ 3.7's signed-gate resume"))
  const iRevise = restartRaw.findIndex((l) => l.includes('`resumeAt: revise`'))

  // approve-routes: approve-gates flips by stage — Integration → review, ready: restamped, the Integration queue,
  // its integrate call never resumed (main is re-read); everything else → in_progress and Restart routing. The
  // placeholder is gone, and Set aside sends a signed gate through approve-gates, never hand-back.
  if (!s37.includes('flips the note by the stage it stopped: `review` at Integration, else `in_progress`') ||
    !routing.includes('the `## Integration log`\'s last line') || !routing.includes('`set-aside`') || !routing.includes('a `pr:`') ||
    !routing.includes('goes to `review` with `ready:` restamped') || !routing.includes('rejoins the Integration queue') ||
    !routing.includes('Its integrate call is never resumed') || !routing.includes('ADR 0030 decision 3') ||
    !routing.includes('goes to `in_progress` with a `gates_signed: <now>` marker') || !routing.includes('*Restart routing*') ||
    !routing.includes("The restart's `mark-started` removes the marker and prints `<slug>: signed-gate restart …`") ||
    /p12-14's change|until it lands/.test(s37) ||
    !aside.includes('a signed gate: `approve-gates`, never `hand-back` (§ 3.7): at Integration it rejoins the Integration queue; otherwise *Restart routing* resumes its gate-pending call while this session holds the handle, else takes a fresh call behind the warning') ||
    /§ 3\.7 \(p12-14\)/.test(aside)) {
    fails.push('approve-routes')
  }

  // handle: the lead keeps a gate-pending task call's runId, scriptPath, launch args and the sha taken just
  // before its launch (never at reconcile: an engine change between launch and stop must not pass unseen),
  // recorded at steps 1.2 and 1.3 and by Lost call's resume; it is dropped once resumed, deferred or
  // re-dispatched; step 2 and Lost call keep it (Lost call's pinned text intact); Restart routing's handle
  // bullet sits strictly between *Lost call* and `resumeAt: revise`.
  const SHA = '`shasum -a 256 <scriptPath>`'
  if (!handle.includes('returns `gate-pending`') || !handle.includes('its own call or a seeded revise') ||
    !['its `runId`', 'its `scriptPath`', 'the exact args object it was launched with',
      `the ${SHA} recorded with that runId just before its Workflow launch`, 'never one taken at reconcile']
      .every((k) => handle.includes(k)) || /taken at reconcile\./.test(handle) ||
    !before(sub12, `${SHA} (recorded with the call's runId, § 3.7)`, 'then the Workflow call') ||
    !sub13.includes(`Just before each task call's Workflow launch, a resume included, take ${SHA} and record it with the returned runId`) ||
    !lost.includes(`A task call's resume records the ${SHA} taken just before it with its new runId`) ||
    !handle.includes('dropped once it is resumed, or when the task is deferred or re-dispatched any other way') ||
    !step2.includes("drop its runId from this session's record (a `gate-pending` row from a task call keeps it as the task's signed-gate handle, § 3.7)") ||
    !lost.includes("dropped from this session's record once any row for it is reconciled") ||
    !lost.includes("except a `gate-pending` task call's, which stays as its signed-gate handle (§ 3.7) until *Restart routing* resumes it") ||
    !lost.includes('*Lost call* never resumes a handle') ||
    !(iLost >= 0 && iLost < iHandle && iHandle < iRevise)) {
    fails.push('handle')
  }

  // resume: after step 1.3's restart sequence (named, never repeated), the sha re-check against the handle's,
  // then resumeFromRunId with the handle's scriptPath and args plus task.approvedGates from the note; the
  // engine goes on past each newly signed gate; the one sanctioned exception, because it never reaches a
  // prompt; never rebuild args from the note; § 4's ORIGINAL-args sentence and the Don't name it. Step 1.3
  // passes mark-started's progress line to a fresh call only: a resume (Lost call, the signed-gate resume)
  // re-passes the args of the call it resumes.
  const call = 'Workflow({ scriptPath: <the handle\'s scriptPath>, args: <the handle\'s args, with task.approvedGates set from the note\'s ## Approved gates>, resumeFromRunId: <the handle\'s runId> })'
  if (!resume.includes(call) || !before(resume, "after §4.5 step 1.3's restart sequence", `${SHA} again`) ||
    !before(resume, `${SHA} again (a sha other than the handle's, or no file, is *Can no longer resume*)`, 'resumeFromRunId') ||
    /then the § 4 stamps|then `mark-started`|then § 4's git-env check/.test(resume) ||
    !resume.includes('Every agent up to the stop replays from cache') || !resume.includes('implements the plan the human signed') ||
    !resume.includes('once for each signed gate it has not yet passed at that site') || /re-dispatches it once/.test(resume) ||
    !sub13.includes("For a fresh call (a start, or a restart's seeded revise or own call) mark-started's `progress:` line becomes the args `progress`") ||
    !sub13.includes("A resume is exempt: *Lost call* and § 3.7's signed-gate resume re-pass the args of the call they resume (the handle's, for a signed gate), so its `progress:` line is shown to the user, not passed") ||
    /\(its `progress:` line becomes the args `progress`\)/.test(sub13) ||
    !resume.includes('`task.approvedGates` is the **one sanctioned exception**') || !resume.includes('never reaches a prompt') ||
    !resume.includes('**Never rebuild** a resumed call\'s args from the note') || !resume.includes('`model: fable`') ||
    !s4.includes("re-passes the run's ORIGINAL args unchanged") ||
    !s4.includes("The one sanctioned exception is § 3.7's signed-gate resume, which adds `task.approvedGates`: it never reaches a prompt.") ||
    !donts.includes("Never resume a runId whose row was reconciled — except § 3.7's signed-gate resume of a `gate-pending` task call after `approve-gates`, with only `task.approvedGates` added to its args.")) {
    fails.push('resume')
  }

  // fresh-warning: the four ways a call can no longer resume, the fresh call it takes instead (a seeded revise
  // on resumeAt: revise, else its own call), the warning printed first, Restart routing's closing line, and § 7.
  if (!['no handle', 'the script\'s sha differs', 'the script file is gone', 'the Workflow tool refuses the resume'].every((k) => cannot.includes(k)) ||
    !cannot.includes("*Restart routing*'s seeded revise when `resumeAt: revise`, else its own call") ||
    !cannot.includes(`[[task]] ${WARNING}`) || !before(cannot, 'prints', WARNING) ||
    !cannot.includes("On the restart whose `mark-started` printed `signed-gate restart`, the lead first prints") ||
    !restart.includes("A restart whose `mark-started` printed `signed-gate restart` (approve-gates' `gates_signed:` marker, which that `mark-started` consumed, so only the restart that directly follows a sign-off) and that takes either of the last two branches prints § 3.7's fresh-call warning first") ||
    !restart.includes('Any later restart, a hand-back included, prints nothing') ||
    /carries `## Approved gates` and takes/.test(restart) ||
    !s7.includes('re-invocation resumes (§ 3.7: on its signed plan while this session holds the handle, through the Integration queue for a stop at Integration, else a fresh call with the warning)')) {
    fails.push('fresh-warning')
  }

  // report: the template's gate line names the resume and the Integration route; the old restart wording is gone;
  // § 6 prints one event line per signed-gate resume.
  const gateLine = s6raw.split('\n').find((l) => l.includes('approve-gates --tasks task-k')) ?? ''
  if (!gateLine.includes('(it resumes its gate-pending call on the plan you signed while this session holds it, else takes a fresh call with a warning; a stop at Integration rejoins the Integration queue)') ||
    /the next `next` restarts it/.test(skill) ||
    !collapse(s6raw).includes('"[[task-k]] → resumed on its signed plan (run <runId>)"')) {
    fails.push('report')
  }

  // scope: § 3.7's lead paragraph and CONTEXT.md's *Gated input* claim no more than the design gives: the
  // gate-pending call resumes on the signed plan while the lead holds the handle; a stop at Integration
  // rejoins the queue; otherwise a fresh call behind the warning. Never "never re-planned".
  if (!lead.includes('while the lead holds its signed-gate handle it resumes its gate-pending call, on the plan the human signed; a stop at Integration rejoins the Integration queue; otherwise it takes a fresh call behind a printed warning') ||
    !gated.includes('resumes its gate-pending call on the signed plan while the lead holds its handle; a stop at Integration rejoins the Integration queue; otherwise it takes a fresh call behind a warning (execute § 3.7)') ||
    /never re-planned/.test(lead) || /never re-planned/.test(gated)) {
    fails.push('scope')
  }
  return [...new Set(fails)]
}

test('execute § 3.7, § 4, § 4.5, § 6, § 7, the Don\'ts and CONTEXT.md hold every signed-gate rule', () => {
  assert.deepEqual(checkSignedGate(real), [])
})

// ---- controls: each mutates the real text in one place and must fail with exactly its rule ---------

const RULES = ['approve-routes', 'handle', 'resume', 'fresh-warning', 'report', 'scope']
const CONTROLLED = new Set()

function edit(text, from, to) {
  assert.ok(text.includes(from), `control setup: ${from.slice(0, 80)} not found`)
  return text.replace(from, to)
}
const only = (skill, rule, label, context = realContext) => {
  CONTROLLED.add(rule)
  assert.deepEqual(checkSignedGate(skill, context), [rule], label)
}

test('control: approve-gates always flipping to in_progress fails approve-routes', () => {
  only(edit(real, 'flips the note by the stage it stopped: `review` at Integration, else `in_progress`', 'flips the note to `in_progress`'),
    'approve-routes', 'always in_progress')
})

test('control: a handle bullet after the revise route fails handle', () => {
  const lines = section(real, S45).split('\n')
  const i = lines.findIndex((l) => l.startsWith('**Restart routing'))
  const h = lines.slice(i).find((l) => l.includes('signed-gate handle'))
  const rv = lines.slice(i).find((l) => l.includes('`resumeAt: revise`'))
  only(real.replace(h + '\n', '').replace(rv, rv + '\n' + h), 'handle', 'handle after revise')
})

test('control: a resume that rebuilds its args from the note fails resume', () => {
  only(edit(real, "args: <the handle's args, with task.approvedGates set from the note's ## Approved gates>", 'args: <§ 4\'s args, rebuilt from the note>'),
    'resume', 'rebuilt args')
})

test('control: a fresh call with no warning fails fresh-warning', () => {
  only(edit(real, 'is asked again.', 'may be asked again.'), 'fresh-warning', 'warning reworded')
})

test('control: a warning keyed on ## Approved gates again fails fresh-warning', () => {
  only(edit(real, "A restart whose `mark-started` printed `signed-gate restart` (approve-gates' `gates_signed:` marker, which that `mark-started` consumed, so only the restart that directly follows a sign-off) and that takes",
    'A restart of a note that carries `## Approved gates` and takes'), 'fresh-warning', 'every later restart warns')
})

test('control: a handle sha taken at reconcile fails handle', () => {
  only(edit(real, 'recorded with that runId just before its Workflow launch (§4.5 steps 1.2 and 1.3, and *Lost call*), never one taken at reconcile: an engine change between the launch and the stop would otherwise pass unseen.',
    'taken at reconcile.'), 'handle', 'sha at reconcile')
  only(edit(real, " Just before each task call's Workflow launch, a resume included, take `shasum -a 256 <scriptPath>` and record it with the returned runId (§ 3.7 *The signed-gate handle*).", ''),
    'handle', 'step 1.3 takes no sha')
})

test('control: step 1.3 passing a fresh progress to every call fails resume', () => {
  only(edit(real, ' A resume is exempt: *Lost call* and § 3.7\'s signed-gate resume re-pass the args of the call they resume (the handle\'s, for a signed gate), so its `progress:` line is shown to the user, not passed.', ''),
    'resume', 'no exemption')
})

test('control: the signed-gate resume repeating step 1.3 fails resume', () => {
  only(edit(real, "after §4.5 step 1.3's restart sequence (it has run § 2.5, § 4's git-env check, the stamps and `mark-started`, and a resume passes no fresh `progress`):",
    "§ 2.5, then § 4's git-env check, then the § 4 stamps (`status: in_progress`, `owner:`), then `mark-started`, then"), 'resume', 'sequence repeated')
})

test('control: "never re-planned" in § 3.7 or CONTEXT.md fails scope', () => {
  only(edit(real, 'while the lead holds its signed-gate handle it resumes its gate-pending call, on the plan the human signed; a stop at Integration rejoins the Integration queue; otherwise it takes a fresh call behind a printed warning',
    'the task resumes at the stage it stopped, on the plan the human signed — never re-planned'), 'scope', 'lead overclaims')
  only(real, 'scope', 'CONTEXT.md overclaims', edit(realContext,
    'resumes its gate-pending call on the signed plan while the lead holds its\n  handle; a stop at Integration rejoins the Integration queue; otherwise it\n  takes a fresh call behind a warning (execute § 3.7).',
    'resumes its gate-pending call on the plan the human signed, never\n  re-planned (execute § 3.7).'))
})

test('control: the report template still restarting the task fails report', () => {
  only(edit(real, '(it resumes its gate-pending call on the plan you signed while this session holds it, else takes a fresh call with a warning; a stop at Integration rejoins the Integration queue)', '(the next `next` restarts it)'),
    'report', 'old template line')
})

test('the rules are all named (6) and each has a control', () => {
  assert.equal(RULES.length, 6)
  assert.deepEqual(RULES.filter((r) => !CONTROLLED.has(r)), [])
})
