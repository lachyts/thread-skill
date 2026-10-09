// A rollout lead never holds a turn on a question while work is in flight (p16-1). An open question holds the
// turn, so every Workflow-completion and background-command notification queues behind it and neither the Stop
// driver nor the heartbeat can act: the 2026-10-05 overnight stall. Pins the prose an LLM lead follows in
// skills/execute/SKILL.md: § 6.5's rule (no question tool while a task call, an integrate call, a background
// Integration command or a merge hold is live: the bar is anything live, and in the loop that means a turn that
// ends `halted` or `done`), the needs-you items (a gate sign-off, an undecided RACE or UNVERIFIED, a set-aside
// only a person moves on, a merge hold's release, any other § 7 halt), a set-aside's fix clause read from its
// source run and a halt's fixed act (so two sessions word one item alike and the dedupe holds), one push per item
// deduped on a `## Needs-you log` line and led by its act, where that log lives in the rollout note, the turn
// ending `waiting`, the report's `Needs you:` block, the answers' existing routes, § 3.7's and § 7's sign-off,
// the § 8 guardrail and the Don't, CONTEXT.md's glossary entry, and no other ask site outside § 6.5, § 8 and the
// Don'ts but the exact exemptions below.
//
// A separate file from execute-queue.test.mjs (p12-9's rule count stays its own), the same shape as
// execute-signed-gate.test.mjs: every rule lives in one function, checkNeedsYou(skill, context), that returns
// named failures, so the real text and the controls run through identical logic; each control mutates the real
// text in one place and must fail with exactly its rule. Reads files only. Behaviour (a lead obeying it) is an
// eval.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { collapse, read, section, slice } from '../lib/contract-text.mjs'

const real = read('skills/execute/SKILL.md')
const realContext = read('CONTEXT.md')

const S1 = /^### 1\. /
const S37 = /^### 3\.7\. /
const S45 = /^### 4\.5\. /
const S6 = /^### 6\. /
const S65 = /^### 6\.5\. /
const S7 = /^### 7\. /
const S8 = /^### 8\. /
const DONTS = /^## Don'ts/

// A bold-labelled paragraph inside a section: from its label line to the next bold label at column 0 (its list
// items and fenced lines included), collapsed.
function labelled(text, sectionRe, label) {
  const lines = (section(text, sectionRe) ?? '').split('\n')
  const i = lines.findIndex((l) => l.startsWith(`**${label}`))
  if (i < 0) return ''
  const j = lines.findIndex((l, k) => k > i && /^\*\*[A-Z`]/.test(l))
  return collapse(lines.slice(i, j < 0 ? undefined : j).join('\n'))
}
const before = (hay, a, b) => hay.indexOf(a) >= 0 && hay.indexOf(b) >= 0 && hay.indexOf(a) < hay.indexOf(b)

// One kind of the collapsed *Needs-you items* list: from its `- (x) **…**` head to the next kind's head, or ''.
function kind(items, head) {
  const i = items.indexOf(head)
  if (i < 0) return ''
  const j = items.indexOf(' - (', i + head.length)
  return items.slice(i, j < 0 ? undefined : j)
}

// The ask sites allowed outside § 6.5, § 8 and the Don'ts, exactly: a hit must lie inside one of these.
const EXEMPT = [
  'list the matches and ask which** (the question tool only with nothing live in this session, § 6.5)', // § 1
  'fail with a message asking the user to provide one', // § 3's config table
  'never the question tool while anything is live', // § 3.7
  '`/thread:repair` asks Lachy', // § 4.5 step 1.2
  'only with nothing live may the question tool put the sign-off to Lachy', // § 7
  'Legacy in-conversation playbook', // Protocol versions
  'asks the user to regenerate', // Protocol versions
]
const ASKS = [/AskUserQuestion/g, /in-conversation/gi,
  /\bask(?:s|ed|ing)?\s+(?:the user|the human|lachy|him|for|which)\b/gi, /question tool/gi]

// Every ask outside § 6.5, § 8 and the Don'ts that no exemption covers.
function strayAsks(skill) {
  let rest = skill
  for (const re of [S65, S8, DONTS]) {
    const s = section(rest, re)
    if (s) rest = rest.replace(s, '')
  }
  rest = collapse(rest)
  const spans = EXEMPT.flatMap((e) => {
    const out = []
    for (let i = rest.indexOf(e); i >= 0; i = rest.indexOf(e, i + 1)) out.push([i, i + e.length])
    return out
  })
  const hits = []
  for (const re of ASKS) {
    for (const m of rest.matchAll(re)) {
      const a = m.index
      const b = a + m[0].length
      if (!spans.some(([s, e]) => s <= a && b <= e)) hits.push(rest.slice(Math.max(0, a - 40), b + 40))
    }
  }
  return hits
}

// Named failures for the needs-you prose; [] means every rule holds.
function checkNeedsYou(skill, context = realContext) {
  const fails = []
  const rule = labelled(skill, S65, 'The rule.')
  const items = labelled(skill, S65, 'Needs-you items.')
  const push = labelled(skill, S65, 'Push once.')
  const log = labelled(skill, S65, 'Where the log lives.')
  const turn = labelled(skill, S65, 'The turn.')
  const answers = labelled(skill, S65, 'Answers.')
  const kindB = kind(items, '- (b) **An undecided RACE or UNVERIFIED**')
  const kindC = kind(items, '- (c) **A set-aside only a person moves on**')
  const kindE = kind(items, '- (e) **Any other § 7 halt**')
  const s37 = collapse(section(skill, S37) ?? '')
  const s45raw = section(skill, S45) ?? ''
  const s6raw = section(skill, S6) ?? ''
  const s6 = collapse(s6raw)
  const s7raw = section(skill, S7) ?? ''
  const s8 = collapse(section(skill, S8) ?? '')
  const donts = collapse(section(skill, DONTS) ?? '')

  // no-ask-in-flight: the lead never calls the question tool (AskUserQuestion in Claude Code, the harness's own
  // ask tool elsewhere) while any of the four live kinds stands. The bar is anything live, never the turn's state:
  // before the loop's first launch nothing is live (§ 1's exemption), and in the loop it waits for a `halted` or
  // `done` turn with nothing live, in *The rule* and *The turn* alike.
  if (!rule.includes('never calls the question tool') || !rule.includes('`AskUserQuestion` in Claude Code') ||
    !rule.includes("elsewhere the harness's own ask-the-user tool") ||
    !['a task call', 'an integrate call', 'a background Integration command', 'a merge hold'].every((k) => rule.includes(k)) ||
    !rule.includes('The bar is anything live: the question tool waits until nothing is.') ||
    !rule.includes("Before the loop's first launch nothing is live yet, so § 1's which-rollout question may use it.") ||
    !rule.includes('In the loop it waits for a turn that ends `halted` or `done` with nothing live') ||
    !turn.includes('In the loop, only a turn ending `halted` or `done` with nothing live may put a question to Lachy')) {
    fails.push('no-ask-in-flight')
  }

  // push-dedupe: the push goes through PushNotification (loaded with ToolSearch, status "proactive"), only when no
  // `## Needs-you log` line names the same slug and question, and is logged after the call returns; an item is
  // never pushed again, a "not sent" counts as pushed, a tool error is logged as `push failed`, and nothing pushes
  // on every turn or report.
  if (!push.includes('ToolSearch `select:PushNotification`') || !push.includes('`PushNotification`') ||
    !push.includes('`status: "proactive"`') || !push.includes('`## Needs-you log`') ||
    !push.includes('the same `[[<slug>]]` and question') || !push.includes('never push it again') ||
    !push.includes('**"Not sent"**') || !push.includes('still counts as pushed and is logged') ||
    !push.includes('is logged as `- <now> [[<slug>]] push failed: <question>`') ||
    !before(push, 'PushNotification', 'pushed: <question>') || /on every (turn|report)/i.test(push)) {
    fails.push('push-dedupe')
  }

  // kinds: (a) a gate sign-off from `## Gated inputs (awaiting sign-off)`; (b) an undecided RACE or UNVERIFIED from
  // `raceHold` (not one whose re-verify still runs here); (c) every set-aside only a person moves on, the
  // plan-blocked, review-blocked, autoRevise: false and Integration cases named; (d) a merge hold's release;
  // (e) any other § 7 halt.
  if (!items.includes('`## Gated inputs (awaiting sign-off)`') || !items.includes('`[[<slug>]] sign off gated input: <gate>`') ||
    !items.includes("(`next`'s `raceHold`, except a RACE whose re-verify this session still runs") ||
    !items.includes('`[[<slug>]] RACE undecided: decide with /thread:repair [[<rollout>]]`') ||
    !items.includes('`[[<slug>]] UNVERIFIED undecided: decide with /thread:repair [[<rollout>]]`') ||
    !items.includes('only way back is `hand-back`, `/thread:repair` or a raised budget') ||
    !items.includes('plan-blocked with `max_plan_rounds` spent') || !items.includes('not descopable') ||
    !items.includes('a descope refusal (exit 3)') || !items.includes('review-blocked with `max_review_rounds` spent') ||
    !items.includes('blocked at its run with `autoRevise: false`') ||
    !items.includes("set aside at Integration: merge-task's exit 4, a third exit 8") ||
    !items.includes('`[[<slug>]] gated: awaiting merge approval for [[<slug>]] (PR #N)`') ||
    !items.includes('`[[<slug>]] review required: approve PR #N (<url>)`') || !items.includes('**Any other § 7 halt**')) {
    fails.push('kinds')
  }

  // turn-waiting: while anything is live the turn ends `waiting`, a needs-you item never halts it, and the block
  // ends on no question; § 4.5 step 1.6 never ends a turn on an open question.
  const step16 = collapse(s45raw.split('\n').find((l) => /^\s+6\. End the turn `waiting`/.test(l)) ?? '')
  if (!turn.includes('While anything is live the turn ends `waiting`') ||
    !turn.includes('a needs-you item never turns a turn `halted`') || !turn.includes('never a closing question') ||
    !step16.includes('never on an open question (§ 6.5)')) {
    fails.push('turn-waiting')
  }

  // report-block: § 6's template lists `Needs you (` before the approve-gates line, before `Held:`; the old
  // gate-pending heading is gone; the Integration set-aside ([[task-i]], merge-task's exit-4 text) has its
  // needs-you line inside the block, and [[task-h]]'s Set aside line says why it has none (a plain rejection,
  // autoRevise); a turn that adds an item prints the report; the block is derived from the current state on every
  // turn, never rebuilt from the log, and a resolved item drops out of it.
  const lines6 = s6raw.split('\n')
  const iNeeds = lines6.findIndex((l) => l.startsWith('Needs you ('))
  const iGate = lines6.findIndex((l) => l.includes('approve-gates --tasks task-k'))
  const iHeld = lines6.findIndex((l) => l.startsWith('Held:'))
  const iTaskI = lines6.indexOf('- [[task-i]] set aside at Integration (blocked, Blocker diagnosis run 1): hand back or defer with /thread:repair [[<rollout-slug>]]')
  const iTaskH = lines6.findIndex((l) => l.startsWith('- at its run: [[task-h]] — blocked (plain rejection, autoRevise'))
  if (!(iNeeds >= 0 && iNeeds < iGate && iGate < iHeld) || s6raw.includes('Gate-pending (awaiting YOUR sign-off') ||
    !(iNeeds < iTaskI && iTaskI < iHeld) || !(iTaskH >= 0 && iTaskH < iNeeds) ||
    !s6.includes('(at a halt, a merge hold, completion, or a turn that adds a needs-you item, § 6.5)') ||
    !items.includes('from the current state, never from `## Needs-you log`') || !items.includes('drops out of the block')) {
    fails.push('report-block')
  }

  // sign-off: § 3.7 presents a gate as a needs-you item, never through the question tool while anything is live;
  // § 7's stuck halt lists it in the `Needs you:` block and puts it to Lachy only with nothing live.
  const stuck = collapse(s7raw.split('\n').find((l) => l.startsWith('- `next` reports `halt: stuck`')) ?? '')
  if (!s37.includes('Present each gate **verbatim** as a needs-you item (§ 6.5)') ||
    !s37.includes('never the question tool while anything is live') || !stuck.includes('`Needs you:` block') ||
    !stuck.includes('only with nothing live may the question tool put the sign-off to Lachy')) {
    fails.push('sign-off')
  }

  // guardrails: the § 8 bullet and the Don't.
  if (!s8.includes('- **No question tool while work is in flight** (§ 6.5): an open question holds the turn, so neither the Stop hook nor the heartbeat runs and every notification queues; needs-you items go in the report with one push each.') ||
    !donts.includes("- Never call the question tool (`AskUserQuestion`, or the harness's own ask tool) while a task call, an integrate call, a background Integration command or a merge hold is live, and never push a needs-you item a `## Needs-you log` line already names (§ 6.5).")) {
    fails.push('guardrails')
  }

  // no-other-ask: outside § 6.5, § 8 and the Don'ts, every AskUserQuestion, in-conversation, "ask the user / for /
  // which / Lachy …" and "question tool" lies inside an exact exemption.
  if (strayAsks(skill).length) fails.push('no-other-ask')

  // log-placement: `## Needs-you log` is created at the note's end, below `## Queue`, and its lines are appended
  // inside it (a line under `## Race log`, `## Notes` or `## Git-env log` would be read as a hold, a decision or a
  // trip); `_schedule_positions` reads its links but the first link wins; no item carries a log mark.
  if (!log.includes("created on first use at the note's end, below `## Queue`") || !log.includes('appended inside that section') ||
    !['`## Race log`', '`## Notes`', '`## Git-env log`', '`_schedule_positions`', 'first link wins'].every((k) => log.includes(k)) ||
    !items.includes('ever carries the log marks `git-env trip`, `git-env ack` or `RACE decided:`')) {
    fails.push('log-placement')
  }

  // set-aside-fix: (c)'s question is read, never chosen, so the exact-text dedupe holds across sessions: <where>
  // from `setAsideAt`, the source run's section, and a <fix> that carries "raise <field>, " only when the source
  // run spent a budget, <field> taken from that run (a plain-rejection revise marker spends max_review_rounds,
  // never max_iterations). max_iterations is named by what the run is, the implementer's or reviser's own
  // paragraph, never by a default: rule 2 lists every fixed opening the engine, its prompts and the lead write
  // for an own run (a dead call, merge-task's exit 1, a dead agent, a plan divergence, the engine's two fallbacks),
  // the transient one glossed as a dead agent and the spent budget glossed on max_iterations itself, and rule 3
  // drops the raise for each. A plan-block after a descope asks for scope, and a descope refusal (which writes
  // nothing) changes no text.
  const r2 = kindC.indexOf('2. a source run that spent a budget')
  const r3 = kindC.indexOf('3. every other source run spends no budget')
  const rule2 = r2 >= 0 && r3 > r2 ? kindC.slice(r2, r3) : ''
  const iters = rule2.slice(rule2.indexOf("`max_iterations` for a code-writing task's"))
  if (!kindC.includes('`[[<slug>]] set aside <where> (<status>, <section> run <n>): <fix> with /thread:repair [[<rollout>]]`') ||
    !kindC.includes('never chosen, so two sessions word one block alike') ||
    !kindC.includes("`<where>`: `at Integration` when the entry's `setAsideAt` is `integration`, else `at its run`") ||
    !kindC.includes('`decide scope or defer`') ||
    !rule2.includes("`raise <field>, hand back or defer`, with `<field>` the source run's own budget, each named by what the run is, never by a default") ||
    !rule2.includes('`max_plan_rounds` for a Plan-blocked feedback run that starts `plan not approved after` or `plan round budget exhausted`') ||
    !rule2.includes('`max_review_rounds` for a Review-blocked feedback run, or for a Blocker diagnosis run that `inputs` reads as a plain rejection (`markerStage: revise`, `markerReason` empty) with `lastRound` at or above `max_review_rounds`') ||
    !iters.startsWith("`max_iterations` for a code-writing task's Blocker diagnosis run that `inputs` reads as its own (`markerStage: own`) and that is the implementer's or reviser's own paragraph: its verifier budget ran out.") ||
    !['`workflow call failed:` (a dead call)', "`merge-task:` (merge-task's exit 1)", '`transient infrastructure failure` (a dead agent)',
      '`plan-divergence:`', '`agent returned neither verified nor blocked`', '`workflow stage threw`'].every((k) => iters.includes(k)) ||
    /engine's own block|transient infrastructure failure` \([^)]*budget/.test(rule2) ||
    !kindC.includes("every other source run spends no budget: `hand back or defer`. That is every entry at Integration, a `revise stopped:` run, a dead call, merge-task's exit 1, a transient failure (a dead agent), a plan divergence, a result with neither verified nor blocked, a stage that threw, any other plan-block and a review with no PR.") ||
    !kindC.includes('A descope refusal (exit 3) or error (exit 1) writes nothing, so it changes no item text') ||
    kindC.includes('the spent budget')) {
    fails.push('set-aside-fix')
  }

  // halt-act: (e)'s act is fixed per halt, never taken from § 7's prose (whose remedies are prose, not commands);
  // a red RACE re-verify's halt is (b), never also (e), so it is one item with one push.
  if (!kindE.includes('`[[<rollout>]] halted (<YYYY-MM-DD>): <reason>: <act>`') ||
    !kindE.includes("never taken from § 7's prose") ||
    !kindE.includes('`decide with /thread:repair [[<rollout>]]` for a git-env halt') ||
    !kindE.includes('`see /thread:status [[<rollout>]], fix it and re-invoke` for every other') ||
    !kindE.includes("the red re-verify's included, which is (b)") || kindE.includes('the command § 7 names') ||
    !kindB.includes("A red RACE re-verify's halt (`RACE: origin/<default> fails the verifier`, § 7) is this item, never (e)")) {
    fails.push('halt-act')
  }

  // push-message: the push leads with the act (its command included), then the slug, then the what, every
  // wikilink bare, so the 200-character cut shortens the what, never the command; each kind names its act and what.
  if (!push.includes('the message `<act> — <slug>: <what>`') ||
    !push.includes('every wikilink written bare (`[[x]]` becomes `x`)') ||
    !push.includes('The act, its command included, leads and the what comes last, so a cut shortens the what first') ||
    push.includes('`<rollout-slug>: <slug> <question>`') ||
    !items.includes('Act `sign off gated input`; what `<gate>`.') ||
    !kindB.includes('Act `decide with /thread:repair [[<rollout>]]`; what `RACE undecided` or `UNVERIFIED undecided`.') ||
    !kindC.includes('Act `<fix> with /thread:repair [[<rollout>]]`; what `set aside <where> (<status>, <section> run <n>)`.') ||
    !items.includes('Act `go ahead or decline the merge` or `approve PR #N (<url>)`; what `gated hold (PR #N)` or `review required`.') ||
    !kindE.includes('Act `<act>`; what `halted (<YYYY-MM-DD>): <reason>`.')) {
    fails.push('push-message')
  }

  // answers: an answer takes the route that already exists for it; a declined gate (§ 3.7) and a declined
  // `--gated` merge (§ 4.5 *Merge hold*, the lead's own set-aside) are named before the `/thread:repair`
  // catch-all, so § 6.5 never contradicts them.
  const rest = 'anything else goes through `/thread:repair`'
  if (!answers.includes('by the route that already exists for it') ||
    !before(answers, 'a declined gate defers the task or leaves it set aside (§ 3.7)', rest) ||
    !before(answers, 'a declined `--gated` merge is set aside at Integration with `merge declined at the --gated hold` by the lead itself (§ 4.5 *Merge hold*)', rest)) {
    fails.push('answers')
  }

  // glossary: CONTEXT.md defines the term, with its block, its log, § 6.5 and an Avoid list, so later tasks reuse it.
  const entry = collapse(slice(context, /^- \*\*Needs-you item\*\*/, /^(- \*\*|#)/) ?? '')
  if (!['`Needs you:` block', '`## Needs-you log`', 'execute § 6.5', '_Avoid_: pending question, ask item'].every((k) => entry.includes(k))) {
    fails.push('glossary')
  }
  return [...new Set(fails)]
}

test('execute § 1, § 3.7, § 4.5, § 6, § 6.5, § 7, § 8, the Don\'ts and CONTEXT.md hold every needs-you rule', () => {
  assert.deepEqual(checkNeedsYou(real), [], `stray asks: ${JSON.stringify(strayAsks(real), null, 1)}`)
})

// (c)'s rule 2 names each budget by what its source run is, so each opening it reads must still be the text its
// writer writes: an engine or lead rewording fails here, never silently as a push naming the wrong fix.
test('the openings (c)\'s rule 2 reads are still written by the engine, its prompts and the lead', () => {
  const engine = read('skills/execute/task.workflow.js')
  const reconcile = read('skills/execute/scripts/reconcile-rollout.py')
  const written = [
    [engine, "'plan not approved after '", 'plan-loop budget run out'],
    [engine, '`plan round budget exhausted without a verdict', 'plan-loop guard'],
    [engine, "'transient infrastructure failure — ", 'TRANSIENT_DIAGNOSIS'],
    [engine, 'blockerDiagnosis="plan-divergence: <one line>"', 'the implementer\'s plan-divergence stop'],
    [engine, "'agent returned neither verified nor blocked'", 'implement()\'s fallback'],
    [engine, "blockerDiagnosis: 'workflow stage threw — see /workflows'", 'taskResult\'s fallback'],
    [reconcile, 'CALL_FAILED_PREFIX = "workflow call failed:"', 'the lead\'s dead-call row'],
    [real, 'reason `merge-task: <its message>`', 'the lead\'s exit-1 row'],
  ]
  for (const [src, text, what] of written) assert.ok(src.includes(text), `${what}: ${text} is no longer written`)
})

// ---- controls: each mutates the real text in one place and must fail with exactly its rule ---------

const RULES = ['no-ask-in-flight', 'push-dedupe', 'kinds', 'turn-waiting', 'report-block', 'sign-off', 'guardrails',
  'no-other-ask', 'log-placement', 'set-aside-fix', 'halt-act', 'push-message', 'answers', 'glossary']
const CONTROLLED = new Set()

// Replaces the one occurrence of `from`; a control whose target is missing or ambiguous fails its setup.
function edit(text, from, to) {
  assert.equal(text.split(from).length, 2, `control setup: ${from.slice(0, 80)} must occur exactly once`)
  return text.replace(from, () => to)
}
// The whole line of `text` that starts with `prefix` inside `sectionRe`'s section, newline included.
function lineIn(text, sectionRe, prefix) {
  const l = (section(text, sectionRe) ?? '').split('\n').find((x) => x.startsWith(prefix))
  assert.ok(l, `control setup: no line starting ${prefix}`)
  return `${l}\n`
}
const only = (skill, rule, label, context = realContext) => {
  CONTROLLED.add(rule)
  assert.deepEqual(checkNeedsYou(skill, context), [rule], label)
}

test('control: the rule removed, narrowed, or barred by the turn\'s state fails no-ask-in-flight', () => {
  only(edit(real, lineIn(real, S65, '**The rule.**'), ''), 'no-ask-in-flight', 'rule removed')
  only(edit(real, '`merge-task.sh` or a backoff) or a merge hold.', '`merge-task.sh` or a backoff).'), 'no-ask-in-flight', 'no merge hold')
  only(edit(real, 'In the loop it waits for a turn that ends `halted` or `done` with nothing live', 'In the loop it may ask at a turn that ends `waiting`'),
    'no-ask-in-flight', 'allowed while waiting')
  only(edit(real, "; elsewhere the harness's own ask-the-user tool, a Codex session-driven `--gated` run's included", ''),
    'no-ask-in-flight', 'Claude Code only')
  only(edit(real, 'The bar is anything live: the question tool waits until nothing is.', 'The bar is the turn\'s state: the question tool waits for a halted turn.'),
    'no-ask-in-flight', 'the bar is the turn\'s state')
  only(edit(real, "Before the loop's first launch nothing is live yet, so § 1's which-rollout question may use it. ", ''),
    'no-ask-in-flight', '§ 1\'s exemption contradicted')
  only(edit(real, 'In the loop, only a turn ending `halted` or `done`', 'Only a turn ending `halted` or `done`'),
    'no-ask-in-flight', 'The turn drops the in-loop scope')
})

test('control: the push dedupe removed, a push on every report, or the log line first fails push-dedupe', () => {
  only(edit(real, lineIn(real, S65, '- **A matching line exists:**'), ''), 'push-dedupe', 'push dedupe removed')
  only(edit(real, 'on any later turn, heartbeat tick or session.', 'on any later turn, heartbeat tick or session. Re-push every open item on every report.'),
    'push-dedupe', 'push on every report')
  only(edit(real, 'load the deferred tool with ToolSearch `select:PushNotification`, then call',
    'append `- <now> [[<slug>]] pushed: <question>` to the log, then load the deferred tool with ToolSearch `select:PushNotification`, then call'),
  'push-dedupe', 'logged before the push')
})

test('control: an item kind dropped fails kinds', () => {
  only(edit(real, ', or `[[<slug>]] UNVERIFIED undecided: decide with /thread:repair [[<rollout>]]`', ''), 'kinds', 'no UNVERIFIED item')
  only(edit(real, lineIn(real, S65, '  - plan-blocked with `max_plan_rounds` spent'), ''), 'kinds', 'no plan-blocked')
  only(edit(real, lineIn(real, S65, '  - blocked at its run with `autoRevise: false`'), ''), 'kinds', 'no autoRevise: false')
  only(edit(real, ", except a RACE whose re-verify this session still runs: a green one lands it with no decision)", ')'),
    'kinds', 'a RACE pushed while its re-verify runs')
})

test('control: a needs-you turn that halts, or step 1.6 without its clause, fails turn-waiting', () => {
  only(edit(real, 'While anything is live the turn ends `waiting`', 'While anything is live the turn ends `halted`'), 'turn-waiting', 'ends halted')
  only(edit(real, ', never on an open question (§ 6.5).', '.'), 'turn-waiting', 'step 1.6 bare')
})

test('control: the old heading, a block rebuilt from the log, or the Integration item left out fails report-block', () => {
  only(edit(real, 'Needs you (each pushed once; the queue runs on without your answer — § 6.5):',
    'Gate-pending (awaiting YOUR sign-off — a declared gate always pauses, ADR 0008):'), 'report-block', 'old heading')
  only(edit(real, 'derived from the current state, never from `## Needs-you log`', 'rebuilt from `## Needs-you log`'),
    'report-block', 'rebuilt from the log')
  only(edit(real, lineIn(real, S6, '- [[task-i]] set aside at Integration'), ''), 'report-block', 'no Integration item')
  only(edit(real, '- at its run: [[task-h]] — blocked (plain rejection, autoRevise: its seeded revise waits for a free slot)',
    '- at its run: [[task-h]] — blocked, see "## Blocker diagnosis"'), 'report-block', 'task-h unexplained')
})

test('control: § 3.7 or § 7 without the needs-you sign-off fails sign-off', () => {
  only(edit(real, 'Present each gate **verbatim** as a needs-you item (§ 6.5): its line in the report\'s `Needs you:` block and one push, never the question tool while anything is live —',
    'Present each gate **verbatim** in the report —'), 'sign-off', '§ 3.7 reworded')
  only(edit(real, "; the halted turn lists it in the report's `Needs you:` block, and only with nothing live may the question tool put the sign-off to Lachy (§ 6.5))", ')'),
    'sign-off', '§ 7 tail removed')
})

test('control: the Don\'t or the § 8 bullet removed fails guardrails', () => {
  only(edit(real, lineIn(real, DONTS, '- Never call the question tool'), ''), 'guardrails', 'no Don\'t')
  only(edit(real, lineIn(real, S8, '- **No question tool while work is in flight**'), ''), 'guardrails', 'no § 8 bullet')
})

test('control: an ask outside § 6.5, or an inexact exemption, fails no-other-ask', () => {
  only(edit(real, 'else takes a fresh call behind the warning;', 'else takes a fresh call behind the warning; ask the user for sign-off;'),
    'no-other-ask', 'Set aside asks')
  only(edit(real, "**Release:** the user's go-ahead (`gated:`)", "**Release:** the user's go-ahead through `AskUserQuestion` (`gated:`)"),
    'no-other-ask', 'Merge hold release asks')
  only(edit(real, 'never the question tool while anything is live —', 'never the question tool while anything is live. Then ask for sign-off —'),
    'no-other-ask', '§ 3.7 asks again')
  only(edit(real, 'put the sign-off to Lachy (§ 6.5))', 'put the sign-off to Lachy (§ 6.5); when the user IS present, ask for the sign-off in-conversation instead of halting)'),
    'no-other-ask', '§ 7 asks in-conversation')
  only(edit(real, 'asks the user to regenerate', 'asks the user to sign off'), 'no-other-ask', 'inexact exemption')
})

test('control: a log at the note\'s top, or items carrying a log mark, fails log-placement', () => {
  only(edit(real, "created on first use at the note's end, below `## Queue`", "created on first use at the note's top, below `## Queue`"),
    'log-placement', 'at the top')
  only(edit(real, 'No item text ever carries the log marks `git-env trip`, `git-env ack` or `RACE decided:`, so the git-env trip halt\'s reason is written `the shared checkout changed`. ', ''),
    'log-placement', 'no marks sentence')
})

test('control: a raise where no budget was spent, or the wrong field, fails set-aside-fix', () => {
  only(edit(real, lineIn(real, S65, '    3. every other source run spends no budget'), ''), 'set-aside-fix', 'no-budget cases unruled')
  only(edit(real, '`max_review_rounds` for a Review-blocked feedback run, or for a Blocker diagnosis run that `inputs` reads as a plain rejection (`markerStage: revise`, `markerReason` empty) with `lastRound` at or above `max_review_rounds`: its review rounds ran out;',
    '`max_review_rounds` for a Review-blocked feedback run: its review rounds ran out;'), 'set-aside-fix', 'a spent revise marker left to max_iterations')
  only(edit(real, "with `<field>` the source run's own budget", 'with `<field>` the spent budget'), 'set-aside-fix', 'field not from the source run')
  only(edit(real, ', `plan-divergence:` (the implementer\'s designed stop for a broken plan)', ''), 'set-aside-fix',
    'a plan divergence left to max_iterations')
  only(edit(real, ', `agent returned neither verified nor blocked` (the engine\'s fallback for a result with neither) and `workflow stage threw` (the engine\'s fallback for a stage that returned no result)', ''),
    'set-aside-fix', 'the engine\'s fallbacks left to max_iterations')
  only(edit(real, '`transient infrastructure failure` (a dead agent)', '`transient infrastructure failure` (the engine\'s own block: its verifier budget ran out)'),
    'set-aside-fix', 'the spent budget glossed on the transient opening')
  only(edit(real, "and that is the implementer's or reviser's own paragraph: its verifier budget ran out. A run that starts with one of the fixed openings the engine, its prompts or the lead write is never that paragraph, and none of them spends a budget:",
    'and that starts with none of'), 'set-aside-fix', 'max_iterations named by a default')
  only(edit(real, 'A descope refusal (exit 3) or error (exit 1) writes nothing, so it changes no item text (a later session that judged the same run otherwise would word it apart and push it twice): its `ASK:` or ERROR line is the item\'s `→` detail. ', ''),
    'set-aside-fix', 'a refusal rewords the item')
})

test('control: (e) naming § 7\'s prose, or a red RACE re-verify in both (b) and (e), fails halt-act', () => {
  only(edit(real, "`[[<rollout>]] halted (<YYYY-MM-DD>): <reason>: <act>`. `<reason>` is the halt's `reason=` text, and `<act>` is fixed by the halt, never taken from § 7's prose: `decide with /thread:repair [[<rollout>]]` for a git-env halt (the trip or `git-env canary failed`: repair's step 3e shows the evidence and records the ack), and `see /thread:status [[<rollout>]], fix it and re-invoke` for every other.",
    '`[[<rollout>]] halted (<YYYY-MM-DD>): <the reason text>: <the command § 7 names for it>`.'), 'halt-act', 'the command § 7 names')
  only(edit(real, " A red RACE re-verify's halt (`RACE: origin/<default> fails the verifier`, § 7) is this item, never (e): its `## Race log` line keeps the task in `raceHold`, so it is one item with one push.", ''),
    'halt-act', 'red re-verify unplaced')
})

test('control: slugs first, bracketed links, or a kind without its act fails push-message', () => {
  only(edit(real, 'the message `<act> — <slug>: <what>`', 'the message `<rollout-slug>: <slug> <question>`'), 'push-message', 'slugs first')
  only(edit(real, ', every wikilink written bare (`[[x]]` becomes `x`)', ''), 'push-message', 'brackets kept')
  only(edit(real, ' Act `<fix> with /thread:repair [[<rollout>]]`; what `set aside <where> (<status>, <section> run <n>)`.', ''),
    'push-message', '(c) without its act')
})

test('control: an answer route that drops a decline fails answers', () => {
  only(edit(real, ', and a declined gate defers the task or leaves it set aside (§ 3.7)', ' (§ 3.7)'), 'answers', 'gate decline to repair')
  only(edit(real, ', and a declined `--gated` merge is set aside at Integration with `merge declined at the --gated hold` by the lead itself (§ 4.5 *Merge hold*)', ' (§ 4.5 *Merge hold*)'),
    'answers', 'merge decline to repair')
})

test('control: CONTEXT.md without the entry, or without its Avoid list, fails glossary', () => {
  const entry = slice(realContext, /^- \*\*Needs-you item\*\*/, /^(- \*\*|#)/)
  assert.ok(entry, 'control setup: no Needs-you item entry')
  only(real, 'glossary', 'no entry', edit(realContext, `${entry}\n`, ''))
  only(real, 'glossary', 'no Avoid list', edit(realContext, '_Avoid_: pending question, ask item,', ''))
})

test('the rules are all named (14) and each has a control', () => {
  assert.equal(RULES.length, 14)
  assert.deepEqual(RULES.filter((r) => !CONTROLLED.has(r)), [])
})
