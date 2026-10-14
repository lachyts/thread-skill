// A rollout lead never holds a turn on a question while work is in flight (p16-1). An open question holds the
// turn, so every Workflow-completion and background-command notification queues behind it and neither the Stop
// driver nor the heartbeat can act: the 2026-10-05 overnight stall. Pins the prose an LLM lead follows in
// skills/execute/SKILL.md: § 6.5's rule (no question tool while a task call, an integrate call, a background
// Integration command or a merge hold is live: the bar is anything live, and in the loop that means a turn that
// ends `halted` or `done`), the needs-you items (a gate sign-off, an undecided RACE or UNVERIFIED, a set-aside
// only a person moves on, a merge hold's release, any other § 7 halt), a set-aside's act and label read from
// `inputs`' `humanFix` (ADR 0035: the script names the one fix, so the prose re-derives no cause and keeps no rule
// list), the answered set-asides (under a pause, `awaiting repair`, `left`), and
// a halt's fixed act (so two sessions word one item alike and the dedupe holds), the engine's needs-human
// question shown on the item's detail line and carried by its push, one push per item
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
  // `raceHold` (not one whose re-verify still runs here); (c) every set-aside at its run or at Integration whose
  // `inputs` reports a non-null `humanFix` (ADR 0035: the script names the cause's one fix), a gate (a), a RACE (b) and
  // an `autoRetryError` (e) placed, and a null `humanFix` named the lead's own re-entry; (d) a merge hold's release;
  // (e) any other § 7 halt. (c) keeps no list of the causes it includes: `humanFix` is the membership.
  if (!items.includes('`## Gated inputs (awaiting sign-off)`') || !items.includes('`[[<slug>]] sign off gated input: <gate>`') ||
    !items.includes("(`next`'s `raceHold`, except a RACE whose re-verify this session still runs") ||
    !items.includes('`[[<slug>]] RACE undecided: decide with /thread:repair [[<rollout>]]`') ||
    !items.includes('`[[<slug>]] UNVERIFIED undecided: decide with /thread:repair [[<rollout>]]`') ||
    !kindC.includes('every `setAside` entry at its run or at Integration whose `lead-integrate.py inputs`') ||
    !kindC.includes('reports a non-null `humanFix`') ||
    !kindC.includes('A gate-pending entry is (a), an entry in `raceHold` is (b), and a non-empty `autoRetryError` is (e)') ||
    !kindC.includes("A null `humanFix` is the lead's own re-entry") ||
    /It includes:|plan-blocked with `max_plan_rounds` spent|blocked at its run with `autoRevise/.test(kindC) ||
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
  // autoRevise); a review-blocked needs-human stop ([[task-n]], round 1, below the cap) reads `humanFix`'s `answer the
  // question` with the engine's question on the `→` line under it, never a raise; a turn that adds an item prints the
  // report; the block is derived from the current state on every turn, never rebuilt from the log, and a resolved
  // item drops out of it.
  const lines6 = s6raw.split('\n')
  const iNeeds = lines6.findIndex((l) => l.startsWith('Needs you ('))
  const iGate = lines6.findIndex((l) => l.includes('approve-gates --tasks task-k'))
  const iHeld = lines6.findIndex((l) => l.startsWith('Held:'))
  const iTaskI = lines6.indexOf('- [[task-i]] set aside at Integration (blocked, Blocker diagnosis run 1): hand back or defer with /thread:repair [[<rollout-slug>]]')
  const iTaskH = lines6.findIndex((l) => l.startsWith('- at its run: [[task-h]] — blocked (plain rejection, autoRevise'))
  const iTaskN = lines6.indexOf('- [[task-n]] set aside at its run (review-blocked, Review-blocked feedback run 1): answer the question with /thread:repair [[<rollout-slug>]]')
  const iAsideN = lines6.indexOf('- review-blocked: [[task-n]] — a needs-human question (see "## Needs you")')
  if (!(iNeeds >= 0 && iNeeds < iGate && iGate < iHeld) || s6raw.includes('Gate-pending (awaiting YOUR sign-off') ||
    !(iNeeds < iTaskI && iTaskI < iHeld) || !(iTaskH >= 0 && iTaskH < iNeeds) ||
    !(iNeeds < iTaskN && iTaskN < iHeld) || lines6[iTaskN + 1] !== '  → asks: <its needsHuman question, verbatim>' ||
    !(iAsideN >= 0 && iAsideN < iNeeds) ||
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

  // set-aside-fix: (c)'s question is read, never chosen, so the exact-text dedupe holds across sessions: <where> from
  // `setAsideAt`, then `humanFix`'s label and act verbatim (ADR 0035: lead-integrate.py's one fix per cause, so the
  // lead never re-derives a cause, never picks an act and keeps no numbered rule list), its `→` detail `humanFix.detail`,
  // and a new block (a new run, or `ask <k>` after a spent answer) a new item.
  if (!kindC.includes('`[[<slug>]] set aside <where> <humanFix.label>: <humanFix.act> with /thread:repair [[<rollout>]]`') ||
    !kindC.includes('never chosen, so two sessions word one block alike') ||
    !kindC.includes("`<where>` is `at Integration` when the entry's `setAsideAt` is `integration`, else `at its run`") ||
    !kindC.includes("the label and the act are `humanFix`'s, verbatim") ||
    !kindC.includes('so the lead never re-derives a cause or chooses a fix') ||
    !kindC.includes('Its `→` detail is `humanFix.detail`.') || !kindC.includes('`ask <k>`') ||
    /the first of these that applies|<fix>|`raise <field>, hand back or defer`|writes nothing, so it changes no item text/.test(kindC) ||
    /^ {4}[1-4]\. /m.test(kind(section(skill, S65) ?? '', '- (c) **A set-aside only a person moves on**'))) {
    fails.push('set-aside-fix')
  }

  // needs-human-shown: the question the engine stopped on (p16-3's `needsHuman`, the task note's `## Needs you`)
  // reaches Lachy. It goes verbatim on a `→` line under the item whenever the entry carries one, never on the
  // item line (the item text is the dedupe key and stays fixed), because a review judge's stop opens its section
  // with a feedback bullet; and a (c) push for such an entry takes the question as its what, so the push carries
  // it and a cut shortens it, never the act.
  if (!items.includes('never on the item line, so the item text stays fixed') ||
    !items.includes("an entry's `needsHuman` question, verbatim, on its own `→` line whenever the entry carries one") ||
    !items.includes("for a review judge's stop the section's first line is a feedback bullet, never the question") ||
    !kindC.includes("For an entry that carries `needsHuman`, the what is that question, verbatim, in place of `set aside …`: the push carries the question the engine stopped on, and a cut shortens it, never the act.")) {
    fails.push('needs-human-shown')
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
    !kindC.includes('Act `<humanFix.act> with /thread:repair [[<rollout>]]`; what `set aside <where> <humanFix.label>`') ||
    !items.includes('Act `go ahead or decline the merge` or `approve PR #N (<url>)`; what `gated hold (PR #N)` or `review required`.') ||
    !kindE.includes('Act `<act>`; what `halted (<YYYY-MM-DD>): <reason>`.')) {
    fails.push('push-message')
  }

  // answers: an answer takes the route that already exists for it; a declined gate (§ 3.7), a declined `--gated`
  // merge (§ 4.5 *Merge hold*, the lead's own set-aside) and an answer repair recorded as `hand-back` (step 1.2's
  // *Recorded answer*, ADR 0035) are named before the `/thread:repair` catch-all, so § 6.5 never contradicts them.
  const rest = 'anything else goes through `/thread:repair`'
  if (!answers.includes('by the route that already exists for it') ||
    !before(answers, "is handed back by step 1.2's *Recorded answer* once nothing is paused", rest) ||
    !before(answers, 'a declined gate defers the task or leaves it set aside (§ 3.7)', rest) ||
    !before(answers, 'a declined `--gated` merge is set aside at Integration with `merge declined at the --gated hold` by the lead itself (§ 4.5 *Merge hold*)', rest)) {
    fails.push('answers')
  }

  // answered-items (ADR 0035): an answered set-aside is treated by its form. Under a pause step 1.2 is skipped, so an
  // entry whose way back is the lead's own (a null `humanFix`, a `hand-back` answer included) waits for the reinstate and
  // is never listed; an `awaiting repair` answer is an item (`finish the recorded answer`), pushed once; a `left` one
  // keeps its cause's item text, so the log line dedupes it: listed, never pushed again.
  if (!kindC.includes('under a pause step 1.2 is skipped, so such an entry waits for the reinstate and stays excluded, a `hand-back` answer included') ||
    !kindC.includes('An `awaiting repair` answer is an item whose act is `finish the recorded answer`, pushed once') ||
    !kindC.includes("a `left` answer keeps its cause's item text, so it is listed but never pushed again")) {
    fails.push('answered-items')
  }

  // glossary: CONTEXT.md defines the term, with its block, its log, § 6.5 and an Avoid list, so later tasks reuse it,
  // and tells the rollout note's `## Needs-you log` (the lead's push record) apart from the task note's
  // `## Needs you` (p16-3, the engine's question), two near-identical section names.
  const entry = collapse(slice(context, /^- \*\*Needs-you item\*\*/, /^(- \*\*|#)/) ?? '')
  if (!['`Needs you:` block', '`## Needs-you log`', 'execute § 6.5', '_Avoid_: pending question, ask item'].every((k) => entry.includes(k)) ||
    !entry.includes("never the task note's `## Needs you` (p16-3), which holds the question the engine stopped on")) {
    fails.push('glossary')
  }
  return [...new Set(fails)]
}

test('execute § 1, § 3.7, § 4.5, § 6, § 6.5, § 7, § 8, the Don\'ts and CONTEXT.md hold every needs-you rule', () => {
  assert.deepEqual(checkNeedsYou(real), [], `stray asks: ${JSON.stringify(strayAsks(real), null, 1)}`)
})

// lead-integrate.py's _raise_field (the Human fix's H9, ADR 0035) names each budget by what its source run is, so each
// opening it reads (NO_BUDGET_OPENINGS, PLAN_BUDGET_OPENINGS) must still be the text its writer writes: an engine or lead
// rewording fails here, never silently as a push naming the wrong fix. Its needs-human exclusion reads the note's
// `## Needs you`, so the engine's needs-human exits (the plan judge's plan-blocked, the review judge's review-blocked
// below the cap, the implementer's and investigator's first-pass block before any climb, the reviser's block) and
// `next`'s `needsHuman` key must still be there. H7 reads `inputs`' `prUrlError` and `resumeAt`, and step 1.2 and step 3
// must still launch nothing on a non-empty `prUrlError` (p17-1), or the item would ask for a `pr:` fix no launch waits on.
test('the openings _raise_field reads, the needs-human exits it excludes, and the prUrlError H7 reads are still written by the engine, its prompts and the lead', () => {
  const engine = read('skills/execute/task.workflow.js')
  const reconcile = read('skills/execute/scripts/reconcile-rollout.py')
  const leadIntegrate = read('skills/execute/scripts/lead-integrate.py')
  const firstAsk = engine.indexOf('if (askedFirst) return askedFirst')
  const climb = engine.indexOf('if (r.escalate || r.blocked) {')
  assert.ok(firstAsk >= 0 && climb > firstAsk, 'the implementer\'s needs-human stop no longer comes before the climb branch')
  const written = [
    [engine, "status: 'plan-blocked', planRoundsUsed: round, needsHuman: q,", 'the plan judge\'s needs-human exit'],
    [engine, "return { ...current, status: 'review-blocked', reviewRoundsUsed: round, reviewFeedback: verdict.feedback, reviewHistory: priorFeedback, needsHuman: q }",
      'the review judge\'s needs-human exit, below the cap'],
    [engine, 'const asks = (r) => (r.blocked && askOf(r) ? { ...r, blocked: true, needsHuman: askOf(r), ...(planExtra || {}) } : null)',
      'the implementer\'s needs-human exit'],
    [engine, 'if (r.blocked && askOf(r)) return { ...r, blocked: true, needsHuman: askOf(r) }', 'the investigator\'s needs-human exit'],
    [engine, "return { stop: { ...current, status: 'blocked', blockerDiagnosis: revised.blockerDiagnosis, needsHuman: askOf(revised) } }",
      'the reviser\'s needs-human exit'],
    [engine, "needsHuman: status === 'review' ? '' : askOf(norm),", 'the row\'s needsHuman'],
    [reconcile, 'entry["needsHuman"] = ask', '`next`\'s setAside entry key'],
    [reconcile, '"setAside": [_set_aside_entry(r) for r in by_state.get("set-aside", [])]', '`next`\'s setAside entries'],
    [engine, "'plan not approved after '", 'plan-loop budget run out'],
    [engine, '`plan round budget exhausted without a verdict', 'plan-loop guard'],
    [engine, "'transient infrastructure failure — ", 'TRANSIENT_DIAGNOSIS'],
    [engine, 'blockerDiagnosis="plan-divergence: <one line>"', 'the implementer\'s plan-divergence stop'],
    [engine, "'agent returned neither verified nor blocked'", 'implement()\'s fallback'],
    [engine, "blockerDiagnosis: 'workflow stage threw — see /workflows'", 'taskResult\'s fallback'],
    [reconcile, 'CALL_FAILED_PREFIX = "workflow call failed:"', 'the lead\'s dead-call row'],
    [real, 'reason `merge-task: <its message>`', 'the lead\'s exit-1 row'],
    [leadIntegrate, '"prUrl": pr_url, "prUrlError": pr_url_error,', '`inputs`\' prUrlError'],
    [leadIntegrate, '"lastIntegration": last, "resumeAt": resume_at,', '`inputs`\' resumeAt'],
    [real, 'A non-empty `prUrlError` (the note\'s `pr:` gives no PR URL the engine takes, step 3) launches nothing', 'step 1.2\'s prUrlError hold'],
    [real, 'A non-empty `prUrlError` (the note\'s `pr:` gives no PR URL the engine takes) launches nothing: the lead\'s own *Set aside* row at Integration',
      'step 3\'s prUrlError set-aside'],
  ]
  for (const [src, text, what] of written) assert.ok(src.includes(text), `${what}: ${text} is no longer written`)
  // Each opening is _raise_field's: the six own-run openings in NO_BUDGET_OPENINGS, the plan budget's in PLAN_BUDGET_OPENINGS.
  const tuple = (name) => JSON.parse('[' + ((leadIntegrate.match(new RegExp(`^${name} = \\(([^)]*)\\)`, 'm')) ?? [])[1] ?? '').replace(/\s+/g, ' ').replace(/,\s*$/, '') + ']')
  assert.deepEqual(tuple('NO_BUDGET_OPENINGS'), ['workflow call failed:', 'merge-task:', 'transient infrastructure failure', 'plan-divergence:',
    'agent returned neither verified nor blocked', 'workflow stage threw'], 'NO_BUDGET_OPENINGS lists the six own-run openings')
  assert.deepEqual(tuple('PLAN_BUDGET_OPENINGS'), ['plan not approved after', 'plan round budget exhausted'], 'PLAN_BUDGET_OPENINGS')
})

// ---- controls: each mutates the real text in one place and must fail with exactly its rule ---------

const RULES = ['no-ask-in-flight', 'push-dedupe', 'kinds', 'turn-waiting', 'report-block', 'sign-off', 'guardrails',
  'no-other-ask', 'log-placement', 'set-aside-fix', 'needs-human-shown', 'halt-act', 'push-message', 'answers', 'answered-items', 'glossary']
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

test('control: an item kind dropped, or (c) re-deriving its causes, fails kinds', () => {
  only(edit(real, ', or `[[<slug>]] UNVERIFIED undecided: decide with /thread:repair [[<rollout>]]`', ''), 'kinds', 'no UNVERIFIED item')
  only(edit(real, ", except a RACE whose re-verify this session still runs: a green one lands it with no decision)", ')'),
    'kinds', 'a RACE pushed while its re-verify runs')
  only(edit(real, 'reports a non-null `humanFix`. The script', 'reports `autoRetry: false`. The script'), 'kinds', 'membership by autoRetry')
  only(edit(real, ' A gate-pending entry is (a), an entry in `raceHold` is (b), and a non-empty `autoRetryError` is (e), § 3\'s round-budget halt.', ''),
    'kinds', 'a, b and e unplaced')
  only(edit(real, 'listed but never pushed again.\n', 'listed but never pushed again. It includes:\n  - plan-blocked with `max_plan_rounds` spent;\n'),
    'kinds', 'the old includes list back')
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
  only(edit(real, '- [[task-n]] set aside at its run (review-blocked, Review-blocked feedback run 1): answer the question with',
    '- [[task-n]] set aside at its run (review-blocked, Review-blocked feedback run 1): raise max_review_rounds, hand back or defer with'),
  'report-block', 'a needs-human stop raises the review budget')
  only(edit(real, lineIn(real, S6, '  → asks: <its needsHuman question'), ''), 'report-block', 'the needs-human question left off')
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

test('control: a (c) rule list reinstated, or an act the lead chooses, fails set-aside-fix', () => {
  only(edit(real, 'Its `→` detail is `humanFix.detail`.', 'Its `→` detail is `humanFix.detail`. Its `<fix>`, the first of these that applies:\n    1. a plan-block after an automatic descope: `decide scope or defer`;\n    4. every other source run spends no budget: `hand back or defer`.'),
    'set-aside-fix', 'a rule list reinstated')
  only(edit(real, "and the label and the act are `humanFix`'s, verbatim.", 'and the lead picks the act that fits the block.'), 'set-aside-fix', 'an act the lead chooses')
  only(edit(real, ' Its `→` detail is `humanFix.detail`.', ' Its `→` detail is `autoRetryWhy`.'), 'set-aside-fix', 'detail re-derived')
  only(edit(real, '`[[<slug>]] set aside <where> <humanFix.label>: <humanFix.act> with /thread:repair [[<rollout>]]`',
    '`[[<slug>]] set aside <where> (<status>, <section> run <n>): <fix> with /thread:repair [[<rollout>]]`'), 'set-aside-fix', 'the old template')
})

test('control: the needs-human question kept off the detail line or the push fails needs-human-shown', () => {
  only(edit(real, "an entry's `needsHuman` question, verbatim, on its own `→` line whenever the entry carries one", "a stop's first line"),
    'needs-human-shown', 'the question left off the detail line')
  only(edit(real, " For an entry that carries `needsHuman`, the what is that question, verbatim, in place of `set aside …`: the push carries the question the engine stopped on, and a cut shortens it, never the act.", ''),
    'needs-human-shown', 'the question left out of the push')
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
  only(edit(real, ' Act `<humanFix.act> with /thread:repair [[<rollout>]]`; what `set aside <where> <humanFix.label>`.', ''),
    'push-message', '(c) without its act')
})

test('control: an answer route that drops a decline, or the Recorded answer, fails answers', () => {
  only(edit(real, " an answer `/thread:repair` recorded as `hand-back`, with a null `humanFix`, is handed back by step 1.2's *Recorded answer* once nothing is paused;", ''),
    'answers', 'no Recorded answer route')
  only(edit(real, ', and a declined gate defers the task or leaves it set aside (§ 3.7)', ' (§ 3.7)'), 'answers', 'gate decline to repair')
  only(edit(real, ', and a declined `--gated` merge is set aside at Integration with `merge declined at the --gated hold` by the lead itself (§ 4.5 *Merge hold*)', ' (§ 4.5 *Merge hold*)'),
    'answers', 'merge decline to repair')
})

test('control: an answered set-aside pushed under a pause, re-pushed, or unlisted fails answered-items', () => {
  only(edit(real, ', a `hand-back` answer included. An', '. An'), 'answered-items', 'a hand-back answer under a pause')
  only(edit(real, 'whose act is `finish the recorded answer`, pushed once', 'whose act is `finish the recorded answer`'), 'answered-items', 'awaiting repair re-pushed')
  only(edit(real, "a `left` answer keeps its cause's item text, so it is listed but never pushed again", 'a `left` answer is no item'), 'answered-items', 'left unlisted')
})

test('control: CONTEXT.md without the entry, or without its Avoid list, fails glossary', () => {
  const entry = slice(realContext, /^- \*\*Needs-you item\*\*/, /^(- \*\*|#)/)
  assert.ok(entry, 'control setup: no Needs-you item entry')
  only(real, 'glossary', 'no entry', edit(realContext, `${entry}\n`, ''))
  only(real, 'glossary', 'no Avoid list', edit(realContext, '_Avoid_: pending question, ask item,', ''))
  only(real, 'glossary', 'the two sections not told apart', edit(realContext, "never the task note's `## Needs you` (p16-3)", "the task note's `## Needs you` (p16-3)"))
})

test('the rules are all named (16) and each has a control', () => {
  assert.equal(RULES.length, 16)
  assert.deepEqual(RULES.filter((r) => !CONTROLLED.has(r)), [])
})
