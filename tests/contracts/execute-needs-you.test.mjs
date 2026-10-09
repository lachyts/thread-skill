// A rollout lead never holds a turn on a question while work is in flight (p16-1). An open question holds the
// turn, so every Workflow-completion and background-command notification queues behind it and neither the Stop
// driver nor the heartbeat can act: the 2026-10-05 overnight stall. Pins the prose an LLM lead follows in
// skills/execute/SKILL.md: § 6.5's rule (no question tool while a task call, an integrate call, a background
// Integration command or a merge hold is live; allowed only once the turn ends `halted` or `done` with nothing
// live), the needs-you items (a gate sign-off, an undecided RACE or UNVERIFIED, a set-aside only a person moves
// on, a merge hold's release, any other § 7 halt), one push per item deduped on a `## Needs-you log` line, where
// that log lives in the rollout note, the turn ending `waiting`, the report's `Needs you:` block, § 3.7's and
// § 7's sign-off, the § 8 guardrail and the Don't, and no other ask site outside § 6.5, § 8 and the Don'ts but
// the exact exemptions below.
//
// A separate file from execute-queue.test.mjs (p12-9's rule count stays its own), the same shape as
// execute-signed-gate.test.mjs: every rule lives in one function, checkNeedsYou(skill), that returns named
// failures, so the real text and the controls run through identical logic; each control mutates the real text in
// one place and must fail with exactly its rule. Reads files only. Behaviour (a lead obeying it) is an eval.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { collapse, read, section } from '../lib/contract-text.mjs'

const real = read('skills/execute/SKILL.md')

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
function checkNeedsYou(skill) {
  const fails = []
  const rule = labelled(skill, S65, 'The rule.')
  const items = labelled(skill, S65, 'Needs-you items.')
  const push = labelled(skill, S65, 'Push once.')
  const log = labelled(skill, S65, 'Where the log lives.')
  const turn = labelled(skill, S65, 'The turn.')
  const s37 = collapse(section(skill, S37) ?? '')
  const s45raw = section(skill, S45) ?? ''
  const s6raw = section(skill, S6) ?? ''
  const s6 = collapse(s6raw)
  const s7raw = section(skill, S7) ?? ''
  const s8 = collapse(section(skill, S8) ?? '')
  const donts = collapse(section(skill, DONTS) ?? '')

  // no-ask-in-flight: the lead never calls the question tool (AskUserQuestion in Claude Code, the harness's own
  // ask tool elsewhere) while any of the four live kinds stands; it is allowed only at a halted or done turn with
  // nothing live.
  if (!rule.includes('never calls the question tool') || !rule.includes('`AskUserQuestion` in Claude Code') ||
    !rule.includes("elsewhere the harness's own ask-the-user tool") ||
    !['a task call', 'an integrate call', 'a background Integration command', 'a merge hold'].every((k) => rule.includes(k)) ||
    !rule.includes("allowed only once the rollout's turn ends `halted` or `done` and nothing is live")) {
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
  // `raceHold`; (c) every set-aside only a person moves on, the plan-blocked, review-blocked, autoRevise: false and
  // Integration cases named; (d) a merge hold's release; (e) any other § 7 halt.
  if (!items.includes('`## Gated inputs (awaiting sign-off)`') || !items.includes('`[[<slug>]] sign off gated input: <gate>`') ||
    !items.includes("(`next`'s `raceHold`)") ||
    !items.includes('`[[<slug>]] RACE undecided: decide with /thread:repair [[<rollout>]]`') ||
    !items.includes('`[[<slug>]] UNVERIFIED undecided: decide with /thread:repair [[<rollout>]]`') ||
    !items.includes('only way back is `hand-back`, `/thread:repair` or a raised budget') ||
    !items.includes('plan-blocked with `max_plan_rounds` spent') || !items.includes('not descopable') ||
    !items.includes('a descope refusal (exit 3)') || !items.includes('review-blocked with `max_review_rounds` spent') ||
    !items.includes('blocked at its run with `autoRevise: false`') ||
    !items.includes("set aside at Integration: merge-task's exit 4, a third exit 8") ||
    !items.includes('`[[<slug>]] gated: awaiting merge approval for [[<slug>]] (PR #N)`') ||
    !items.includes('`[[<slug>]] review required: approve PR #N (<url>)`') ||!items.includes('**Any other § 7 halt**')) {
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
  // gate-pending heading is gone; a turn that adds an item prints the report; the block is derived from the
  // current state on every turn, never rebuilt from the log, and a resolved item drops out of it.
  const lines6 = s6raw.split('\n')
  const iNeeds = lines6.findIndex((l) => l.startsWith('Needs you ('))
  const iGate = lines6.findIndex((l) => l.includes('approve-gates --tasks task-k'))
  const iHeld = lines6.findIndex((l) => l.startsWith('Held:'))
  if (!(iNeeds >= 0 && iNeeds < iGate && iGate < iHeld) || s6raw.includes('Gate-pending (awaiting YOUR sign-off') ||
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
  return [...new Set(fails)]
}

test('execute § 1, § 3.7, § 4.5, § 6, § 6.5, § 7, § 8 and the Don\'ts hold every needs-you rule', () => {
  assert.deepEqual(checkNeedsYou(real), [], `stray asks: ${JSON.stringify(strayAsks(real), null, 1)}`)
})

// ---- controls: each mutates the real text in one place and must fail with exactly its rule ---------

const RULES = ['no-ask-in-flight', 'push-dedupe', 'kinds', 'turn-waiting', 'report-block', 'sign-off', 'guardrails',
  'no-other-ask', 'log-placement']
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
const only = (skill, rule, label) => {
  CONTROLLED.add(rule)
  assert.deepEqual(checkNeedsYou(skill), [rule], label)
}

test('control: the rule removed, or narrowed, fails no-ask-in-flight', () => {
  only(edit(real, lineIn(real, S65, '**The rule.**'), ''), 'no-ask-in-flight', 'rule removed')
  only(edit(real, '`merge-task.sh` or a backoff) or a merge hold.', '`merge-task.sh` or a backoff).'), 'no-ask-in-flight', 'no merge hold')
  only(edit(real, "allowed only once the rollout's turn ends `halted` or `done` and nothing is live", 'allowed while the turn ends `waiting`'),
    'no-ask-in-flight', 'allowed while waiting')
  only(edit(real, "; elsewhere the harness's own ask-the-user tool, a Codex session-driven `--gated` run's included", ''),
    'no-ask-in-flight', 'Claude Code only')
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
  only(edit(real, lineIn(real, S65, '- (b) **An undecided RACE or UNVERIFIED**'), ''), 'kinds', 'no RACE item')
  only(edit(real, lineIn(real, S65, '  - plan-blocked with `max_plan_rounds` spent'), ''), 'kinds', 'no plan-blocked')
  only(edit(real, lineIn(real, S65, '  - blocked at its run with `autoRevise: false`'), ''), 'kinds', 'no autoRevise: false')
})

test('control: a needs-you turn that halts, or step 1.6 without its clause, fails turn-waiting', () => {
  only(edit(real, 'While anything is live the turn ends `waiting`', 'While anything is live the turn ends `halted`'), 'turn-waiting', 'ends halted')
  only(edit(real, ', never on an open question (§ 6.5).', '.'), 'turn-waiting', 'step 1.6 bare')
})

test('control: the old gate-pending heading, or a block rebuilt from the log, fails report-block', () => {
  only(edit(real, 'Needs you (each pushed once; the queue runs on without your answer — § 6.5):',
    'Gate-pending (awaiting YOUR sign-off — a declared gate always pauses, ADR 0008):'), 'report-block', 'old heading')
  only(edit(real, 'derived from the current state, never from `## Needs-you log`', 'rebuilt from `## Needs-you log`'),
    'report-block', 'rebuilt from the log')
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

test('the rules are all named (9) and each has a control', () => {
  assert.equal(RULES.length, 9)
  assert.deepEqual(RULES.filter((r) => !CONTROLLED.has(r)), [])
})
