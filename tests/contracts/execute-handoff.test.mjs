// A scheduled rollout sweeps for pickups and hands itself off (ADR 0057, p30-9). Eleven rules over the prose; the two
// script verbs are pinned by tests/pickups.test.sh and the scan's `launch` status by tests/handoff-scan.test.sh:
//   h1  schedule § 1.2 sits between steps 1 and 1.5: a standalone parallel `--tasks` run only (never a project run,
//       the serial path, an orient-all fork, the chain or orient § 6's call), the `pickups` command with --repo,
//       --tasks and --misfit, the bounded fit walk (judge only `join[]`, re-run with --misfit, stop when nothing
//       joins unjudged), the fit and open-question tests, `join[]` joining the candidates, and the umbrella sentence.
//   h2  § 1.5 takes the pickups into its candidates and puts a pickup's questions only when it is in `needed[]`.
//   h3  step 2's pushed-base re-run drops a pickup whose path stops it; § 3.5 drops a pickup with a match, never puts
//       it to him, and words a kept gate for a lead that may start in this same turn (never "before executing").
//   h4  step 8's `Pickups:` line and **Pickup sweep.** block (its counted line aggregate), the `Picked up for you`
//       group with `/thread:repair`, and step 6's queue rationale naming each pickup.
//   h5  step 8's **Execute handoff.** (Owner *gate*, the cite, ADR 0057, its `Execute:` line, orient § 9's Fresh
//       session through **Rollout launch.**, the ladder hold, ADR 0048, "No other checklist holds it", the
//       exclusions), the chain's item 9, orient-all's answer 14, and step 8's checklists worded for a lead that may
//       start in this same turn (never "before executing" in step 8).
//   h6  orient § 9: its heading and anchor, decided and never asked, the Fresh session decided, the other moves on
//       his word, the one hold, several notes, and no question tool.
//   h7  handoff's **Invocation gate.** names schedule step 8 and close's row; **Rollout launch.** carries
//       `launches:`, skips Open captures and the Thread state row, and is a dispatch; the handoff-lifecycle's Front
//       matter, While pending, Withdrawn and Thread state say the same.
//   h8  close: the `launch` status, step 2's **Rollouts this session wrote.** (its evidence order, Not yet and the
//       by-hand lines no handover, a withdrawal later in the session no handover, the latest deciding), the
//       `unstarted` command, step 8's three rows, step 4's Resume clause, rule (3)'s statement, the edge cases, and
//       task-writer § 4b.
//   h9  next step 1 never counts a Rollout launch as the thread continuing elsewhere.
//   h10 "execute offer" survives only as CONTEXT.md **Execute handoff**'s `_Avoid_` in product files, and the
//       **Execute handoff** and **Pickup sweep** entries exist.
//   h11 ADR 0057's sections, decisions, Decided-for-him items and its description-trim follow-up; schedule's Scope and
//       Don'ts name `pickups`' read-only `git remote get-url origin` and the handoff.
// One pure function, check(files), returns the failed rule names; every rule has a mutation control that fails it
// alone. Phrase checks run on collapsed text; slices are taken before collapsing. Reads files only.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { collapse, root, section, slice } from '../lib/contract-text.mjs'

const SCHEDULE = 'skills/schedule/SKILL.md'
const ORIENT = 'skills/orient/SKILL.md'
const ORIENT_ALL = 'skills/orient-all/SKILL.md'
const HANDOFF = 'skills/handoff/SKILL.md'
const LIFECYCLE = 'skills/_shared/handoff-lifecycle.md'
const CLOSE = 'skills/close/SKILL.md'
const NEXT = 'skills/next/SKILL.md'
const WRITER = 'skills/_shared/task-writer.md'
const CONTEXT = 'CONTEXT.md'
const README = 'README.md'
const ADR = 'docs/adr/0057-a-scheduled-rollout-sweeps-for-pickups-and-hands-itself-off.md'

const SKILL_TESTS = /^skills\/[^/]+\/tests\//
const isProduct = (rel) => (rel.startsWith('skills/') && !SKILL_TESTS.test(rel)) || rel.startsWith('hooks/') ||
  rel === README || rel === CONTEXT

// Every product text file, plus the ADR, as { relPath: text }.
function readTree() {
  const files = {}
  const add = (rel) => {
    const buf = fs.readFileSync(path.join(root, rel))
    if (!buf.includes(0)) files[rel] = buf.toString('utf8')
  }
  const walk = (dir) => {
    for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      if (e.name === '__pycache__' || e.name === '.DS_Store') continue
      const rel = `${dir}/${e.name}`
      if (e.isDirectory()) walk(rel)
      else if (e.isFile() && isProduct(rel)) add(rel)
    }
  }
  for (const d of ['skills', 'hooks']) walk(d)
  for (const f of [README, CONTEXT, ADR]) add(f)
  return files
}

const real = readTree()
const C = (s) => collapse(s ?? '')
const sec = (text, re) => section(text ?? '', re) ?? ''
// The blank-line paragraph of `text` that starts with `label`, raw; '' when absent.
const para = (text, label) => (text ?? '').split(/\n\s*\n/).find((p) => p.trimStart().startsWith(label)) ?? ''
// The glossary entry starting `- **<name>**`, collapsed, up to the next entry or heading.
const entry = (text, name) => C(slice(text, new RegExp(`^- \\*\\*${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\*\\*`), /^(- \*\*|#)/))

function check(F) {
  const fails = new Map()
  const flag = (rule, why) => { if (!fails.has(rule)) fails.set(rule, []); fails.get(rule).push(why) }
  const need = (rule, name, text, phrases) => {
    const t = C(text)
    for (const p of phrases) if (!t.includes(p)) flag(rule, `${name} lacks ${p}`)
  }
  const never = (rule, name, text, phrases) => {
    const t = C(text)
    for (const p of phrases) if (t.includes(p)) flag(rule, `${name} still holds ${p}`)
  }
  const sch = F[SCHEDULE] ?? ''
  const lines = sch.split('\n')
  const at = (re) => lines.findIndex((l) => re.test(l))

  // h1: § 1.2's place and clauses.
  const i1 = at(/^### 1\. /), i12 = at(/^### 1\.2\. Pickup sweep/), i15 = at(/^### 1\.5\. /)
  if (!(i1 >= 0 && i1 < i12 && i12 < i15)) flag('h1', `§ 1.2 is not between § 1 and § 1.5 (${i1}, ${i12}, ${i15})`)
  const s12 = sec(sch, /^### 1\.2\. /)
  need('h1', 'schedule § 1.2', s12, ['a standalone parallel run whose set came from `--tasks`', 'never on a project run',
    'on § Serial path', 'in an orient-all fork', 'under the chain', 'or under orient § 6',
    "unfinished-rollout.py pickups --repo <§ 0's resolved path> --tasks <step 1's candidates> [--misfit <slug>=<why>]",
    '**The fit walk.** Judge only the slugs in `join[]`', 'by the execution-fit test', 'an open-question test',
    'Re-run the command with one `--misfit <slug>=<why>` per misfit found so far', 'judge only the newly joined slugs',
    'Stop when no slug joins unjudged', '**`join[]` joins the candidate set.**',
    'That widening is intended, because the Repo rule filters it to this repo, and a task with no Repo line is counted, never read'])

  // h2: § 1.5's candidates and its needed-only questions.
  const s15 = sec(sch, /^### 1\.5\. /)
  need('h2', 'schedule § 1.5', s15, ["and step 1.2's pickups (its final `join[]`)"])
  need('h2', "schedule § 1.5's **The round.**", para(s15, '**The round.**'), [
    "A pickup's questions are put only when it is in step 1.2's `needed[]`",
    "an extra's are skipped, so it leaves undecided, with its Dependent closure"])

  // h3: step 2's drop, § 3.5's drop and its kept-gate wording.
  need('h3', 'schedule step 2', sec(sch, /^### 2\. /), ['A pickup (step 1.2) whose cited path makes the re-run exit 3 leaves the candidate set instead',
    "an exit 3 on another candidate's path, or an exit 2, stops exactly as in § 0"])
  const s35 = sec(sch, /^### 3\.5\. /)
  need('h3', 'schedule § 3.5', s35, ['A pickup (step 1.2) with an undismissed match leaves the candidate set instead',
    'is never put to him', 'clear the gate while it is still queued', 'A lead may start in this same turn',
    'sets that task aside for his answer or sign-off (`/thread:repair`), never the rollout'])
  never('h3', 'schedule § 3.5', s35, ['before executing'])

  // h4: step 8's sweep report and step 6's rationale.
  const s8 = sec(sch, /^### 8\. /)
  need('h4', 'schedule step 8', s8, ['Pickups: <j> joined (<n> needed by your tasks), <m> left alone, <c> counted, not read',
    'counted, not read: <a> on another repo, <b> with no ## Launch repo line', 'beyond the cap of 5:',
    "Picked up for you (<p>; in [[<slug>]]'s queue rationale; /thread:repair [[<slug>]] defers any of them, § 5):"])
  need('h4', "schedule step 8's **Pickup sweep.**", para(s8, '**Pickup sweep.**'), ['`counted` stays two numbers, naming no task'])
  need('h4', "schedule step 6's {{QUEUE_RATIONALE}}", sec(sch, /^### 6\. /), ['and each pickup step 1.2 joined with its why'])

  // h5: step 8's Execute handoff, the chain's item 9, orient-all's answer 14 and the reworded checklists.
  const eh = slice(s8, /^\*\*Execute handoff\.\*\*/, /^\*\*Start when ready\.\*\*/) ?? ''
  need('h5', "schedule step 8's **Execute handoff.**", eh, ['decided and never asked (Owner *gate*', '_shared/asking.md` § 1; ADR 0057',
    'Execute: a fresh session runs [[<slug>]] from <root> (decided: you scheduled it to run; say "not yet" to withdraw the handoff)',
    "then run orient § 9's **Fresh session**", 'through its **Rollout launch.**', 'whose doc carries `launches: <slug>`',
    "Handoff's closing line, or its labelled manual handoff, ends the turn", 'His words in the request choose another',
    'The one hold is a refused ladder file', 'ADR 0048', 'once it reads, say "hand it off"', 'No other checklist holds it',
    'Under orient § 6, orient § 9 runs the move', 'under orient-all and under the chain, nothing here runs'])
  need('h5', "schedule's **Under the chain.** item 9", para(sch, '**Under the chain.**'), ['9. Step 8: no To-execute block, no handoff and no `start when ready` line'])
  need('h5', 'orient-all answer 14', F[ORIENT_ALL], ['14. Step 8: no execute handoff, and no Start when ready.'])
  need('h5', 'schedule step 8 checklists', s8, ['so he clears each while its task is still queued',
    'Clear each while it is still queued, or its call sets it aside for your sign-off',
    'so a copy landed later reaches only the task calls that start after it lands',
    'Fix: edit the named line of ~/.config/thread/ladder.toml; once it reads, say "hand it off" (or run execute by hand).',
    'The execute handoff below starts it; by hand instead, start a session in the Project root, then:'])
  never('h5', 'schedule step 8', s8, ['before executing', 'then execute.'])

  // h6: orient § 9.
  const o = F[ORIENT] ?? ''
  if (!o.split('\n').includes('### 9. The execute handoff')) flag('h6', 'orient has no ### 9. The execute handoff')
  const o9 = sec(o, /^### 9\. /)
  need('h6', 'orient § 9', o9, ['end with the execute handoff, decided and never asked (Owner *gate*', '_shared/asking.md` § 1; ADR 0057',
    'Execute: a fresh session runs [[<slug>]] from <root> (decided: you scheduled it to run; say "not yet" to withdraw the handoff)',
    'then run **Fresh session** below, the decided move', 'Only his words choose another of the moves: Here, Not yet or Start when ready',
    'The one hold is a refused ladder file', 'ADR 0048', 'once it reads, say "hand it off"', 'No other checklist holds it',
    "With several notes, each gets its own handoff, and the last handoff's closing line ends the turn",
    '- **Fresh session** (the decided move', '- **Here** — on his word only',
    'and only when that check exits 0; otherwise it stays Fresh session and says why', '- **Not yet** — on his word, or held',
    '- **Start when ready** — on his word:', 'No rollout written → no handoff'])
  never('h6', 'orient § 9', o9, ['AskUserQuestion', 'recommended option first', 'Offer it only then'])

  // h7: handoff and the lifecycle.
  const h = F[HANDOFF] ?? ''
  const gate = slice(h, /^\*\*Invocation gate\.\*\*/, /^$/) ?? ''
  need('h7', "handoff's **Invocation gate.**", gate, ["or a **Rollout launch.** that schedule step 8's **Execute handoff.**",
    '"hand it off" on close\'s `rollout not started:` row dispatched', "never a fork of this conversation"])
  const rl = slice(h, /^\*\*Rollout launch\.\*\*/, /^\*\*Split launch\.\*\*/) ?? ''
  need('h7', "handoff's **Rollout launch.**", rl, ["orient § 9's Fresh session, or schedule step 8's **Execute handoff.**",
    'or his "hand it off" on close\'s `rollout not started:` row', 'Its front matter adds `launches: <rollout slug>`',
    '**Open captures.** and the **Thread state.** row are skipped', "close's scan reads it as `launch`",
    '`next` never counts it', "The launch is a dispatch, as a router's is (ADR 0057)"])
  need('h7', "handoff's **Open captures.**", para(h, '**Open captures.**'), ['and under **Rollout launch.**'])
  need('h7', "handoff's **Thread state.**", para(h, '**Thread state.**'), ['except under **Rollout launch.**'])
  need('h7', "handoff's **Lifecycle.**", para(h, '**Lifecycle.**'), ["A **Rollout launch.**'s withdrawal (his \"not yet\" after it) has no handoff row or captures to undo"])
  const lc = F[LIFECYCLE] ?? ''
  need('h7', 'lifecycle § Front matter', sec(lc, /^## Front matter/), ["launches: <rollout slug> # optional — a Rollout launch's doc only"])
  need('h7', 'lifecycle § While pending', sec(lc, /^## While pending/), ["A **Rollout launch**'s doc", 'is no continuation',
    "close's scan reads it as `launch`, never `pending`"])
  need('h7', 'lifecycle § Withdrawn', sec(lc, /^## Withdrawn/), ['lands the removal',
    "A Rollout launch's withdrawal has no handoff row or captures to undo, and close reads it as no handover (close step 2)"])
  need('h7', 'lifecycle § Thread state', sec(lc, /^## Thread state/), ['- A **Rollout launch** applies no row'])

  // h8: close and task-writer § 4b.
  const cl = F[CLOSE] ?? ''
  need('h8', 'close § The handoff owns the continuation', sec(cl, /^## The handoff owns the continuation/), [
    "`launch` → a Rollout launch's doc", 'never refreshed, never the Resume pointer, never a reason to suppress a task proposal or the set-down, left for its lead'])
  const rw = slice(cl, /^ {3}- \*\*Rollouts this session wrote\.\*\*/, /^3\. /) ?? ''
  const handed = C(rw).indexOf('1. **Handed over, by this transcript.**'), none = C(rw).indexOf('2. **No handover**')
  if (!(handed >= 0 && none > handed)) flag('h8', 'close step 2 does not check the transcript before the verb')
  need('h8', "close step 2's **Rollouts this session wrote.**", rw, ["schedule's `Queue for … written to [[<slug>]]`",
    'a compaction summary', 'a `relay_session` of `/thread:execute [[<slug>]]`',
    "Not yet's line, a held `Execute:` line and step 8's by-hand `execute [[<slug>]]` lines are no handover",
    'A handoff withdrawn later in this session is no handover', '`dismissed`, `already_dismissed` or `not_found`',
    'the latest decides', '`already_started_by_stage`, `already_started` and `already_kept` are no withdrawal',
    'unfinished-rollout.py unstarted --rollout <slug> [--handoffs <dir>]...', 'one `--handoffs` per `# scanned` directory',
    'It never blocks the close'])
  const s8c = cl.split('\n').find((l) => l.startsWith('8. **Print the "What landed" report')) ?? ''
  need('h8', 'close step 8', s8c, ['`handoff launch: <path> · launches [[<slug>]] · written <date> · left for its lead`',
    '`rollout not started: [[<slug>]]; say "hand it off" to start its lead in a fresh session, or run /thread:execute [[<slug>]] in <root>`',
    '`rollout check failed: [[<slug>]] (<first stderr line>)`'])
  need('h8', 'close step 4', cl, ['a pointer, never a copy (a `launch` doc never counts)'])
  need('h8', "close step 9's rule (3)", cl, ['the research-landing offer and the rollout row included'])
  need('h8', 'close § Edge cases', sec(cl, /^## Edge cases/), ['**His "hand it off" on a `rollout not started:` row**', 'never close itself',
    "handoff's Invocation gate names this route", '**A rollout note this session wrote**',
    'A note whose only handoff was withdrawn gets the row unless `unstarted` reads it as started'])
  need('h8', "task-writer § 4b's close form", F[WRITER], ["a Rollout launch's `launch` doc owns nothing"])

  // h9: next step 1.
  const detect = (F[NEXT] ?? '').split('\n').find((l) => /^\s*- \*\*Whether the work continues in another session\*\*/.test(l)) ?? ''
  need('h9', "next step 1's detection bullet", detect, ['A Rollout launch never counts (handoff **Rollout launch.**): a doc whose front matter carries `launches:`, and the lead it started, run a rollout, never this thread.'])

  // h10: the old name survives only as the glossary's alias.
  const hits = []
  for (const [rel, text] of Object.entries(F)) {
    if (!isProduct(rel)) continue
    for (const _ of C(text).matchAll(/\bexecute offer\b/gi)) hits.push(rel)
  }
  const avoid = entry(F[CONTEXT] ?? '', 'Execute handoff')
  if (hits.length !== 1 || hits[0] !== CONTEXT || !/_Avoid_: execute offer\.$/.test(avoid.trim())) {
    flag('h10', `"execute offer" in product files: ${JSON.stringify(hits)}; the Execute handoff entry's _Avoid_ must hold the one`)
  }
  if (!entry(F[CONTEXT] ?? '', 'Pickup sweep').includes('_Avoid_: backlog scan.')) flag('h10', 'CONTEXT.md has no **Pickup sweep** entry')

  // h11: ADR 0057 and schedule's Scope and Don'ts.
  const adr = F[ADR] ?? ''
  for (const hd of ['## Context', '## Decision', '## Decided for him (overturnable)', '## Considered options', '## Consequences', '## Follow-ups']) {
    if (!adr.split('\n').includes(hd)) flag('h11', `ADR 0057 has no ${hd}`)
  }
  need('h11', 'ADR 0057 § Decision', sec(adr, /^## Decision$/), ['**d1. The Pickup sweep.**', '**d2. The execute handoff, decided.**',
    '**d3. One hold.**', '**d4. A launch doc is no continuation.**', '**d5. Close names a rollout left unstarted.**', '**d6. Words.**',
    'a handoff withdrawn later in the session is no handover'])
  need('h11', 'ADR 0057 § Decided for him', sec(adr, /^## Decided for him/), ['`counted` is\n  two integers'.replace(/\s+/g, ' '),
    'Any gate-sweep hit (spend, credential, irreversible) leaves a pool task alone', 'The overturn route is',
    'The handoff is decided (Owner *gate*), its one hold the ladder file', 'An umbrella project widens the pool',
    'A pickup a named task needs is asked in the Pre-flight round'])
  need('h11', 'ADR 0057 § Follow-ups', sec(adr, /^## Follow-ups/), ['A description trim for orient', 'and schedule',
    'scored eval baseline', '`make evals`', '7950'])
  need('h11', 'schedule § Scope', sec(sch, /^## Scope/), ["step 1.2's `unfinished-rollout.py pickups` reads task notes and runs one read-only `git remote get-url origin`",
    "step 8's **Execute handoff.** runs `${CLAUDE_PLUGIN_ROOT}/skills/handoff/SKILL.md`"])
  const dontGit = lines.find((l) => l.startsWith("- Don't run `git`")) ?? ''
  need('h11', "schedule's git Don't", dontGit, ["step 1.2's `unfinished-rollout.py pickups`, whose `git remote get-url origin` calls are read-only",
    "step 8's **Execute handoff.**, whose doc handoff lands itself"])

  return { rules: [...fails.keys()].sort(), details: [...fails.values()].flat() }
}

// A control's copy of `real` with `from` replaced by `to` in `file`, asserting the replacement happened.
function swap(file, from, to) {
  const text = real[file].replace(from, to)
  assert.notEqual(text, real[file], `control is vacuous: ${from} not found in ${file}`)
  return { ...real, [file]: text }
}
const only = (files, rule, label) => assert.deepEqual(check(files).rules, [rule], `control ${label}: ${JSON.stringify(check(files).details)}`)

test('the pickup sweep and the execute handoff are wired through schedule, orient, handoff, close, next and the glossary', () => {
  const { rules, details } = check(real)
  assert.deepEqual(rules, [], details.join('\n'))
})

test('controls: each rule fails on its own known-bad shape', () => {
  only(swap(SCHEDULE, 'Stop when no slug joins unjudged', 'Stop when every pool task is judged'), 'h1', 'unbounded walk')
  only(swap(SCHEDULE, 'and a task with no Repo line is counted, never read', 'and a task with no Repo line is read'), 'h1', 'umbrella')
  only(swap(SCHEDULE, "A pickup's questions are\nput only when it is in step 1.2's `needed[]`", "A pickup's questions are\nput"), 'h2', 'needed only')
  only(swap(SCHEDULE, 'clear the gate while it is still queued', 'clear the gate before executing'), 'h3', 'gate before executing')
  only(swap(SCHEDULE, 'A pickup (step 1.2) with an undismissed match leaves the candidate set instead', 'A pickup is put to him'), 'h3', '§ 3.5 pickup')
  only(swap(SCHEDULE, "Picked up for you (<p>; in [[<slug>]]'s queue rationale; /thread:repair [[<slug>]] defers any of them, § 5):\n", ''), 'h4', 'picked up')
  only(swap(SCHEDULE, 'Clear each while it is still queued, or its call sets it aside for your sign-off',
    "Clear each before executing, or they'll refuse mid-dispatch"), 'h5', 'checklist before executing')
  only(swap(SCHEDULE, 'No other checklist holds it: a gate', 'Every checklist holds it: a gate'), 'h5', 'holds')
  only(swap(ORIENT, '- **Here** — on his word only:', '- **Here** — recommended when small:'), 'h6', 'here')
  only(swap(ORIENT, 'end with the execute handoff, decided and never asked', 'end with `AskUserQuestion`, recommended option first'), 'h6', 'asked')
  only(swap(HANDOFF, ' or Lachy\'s\n"hand it off" on close\'s `rollout not started:` row dispatched', ''), 'h7', 'gate close row')
  only(swap(HANDOFF, '**Open captures.** and the **Thread state.** row are skipped', '**Open captures.** runs'), 'h7', 'skips')
  only(swap(CLOSE, "Not yet's line, a held `Execute:` line and step 8's by-hand `execute [[<slug>]]` lines are no handover. ", ''), 'h8', 'not yet')
  only(swap(CLOSE, /A handoff withdrawn later in this session is no handover[^]*?are no withdrawal\./, ''), 'h8', 'withdrawn')
  only(swap(NEXT, ' A Rollout launch never counts (handoff **Rollout launch.**): a doc whose front matter carries `launches:`, and the lead it started, run a rollout, never this thread.', ''), 'h9', 'next')
  only(swap(README, 'and ends with the execute handoff.', 'and ends with the execute offer.'), 'h10', 'old name')
  only(swap(ADR, /## Follow-ups\n[^]*$/, '## Follow-ups\n\nNone.\n'), 'h11', 'follow-ups')
})
