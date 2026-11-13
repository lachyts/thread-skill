// A gate never holds an unattended rollout (ADR 0034, p18-2): the prose an LLM lead and planner follow.
//
// Pins, in skills/execute/SKILL.md: § 3.7's *Standing approval* (total exposure as the task's ceiling, never a target;
// irreversible gates never pass, a credential only as a declared test credential; a gate it cannot price asks); § 4.5 step 1.2's Standing approval
// sub-step (first in the step, skipped under a pause, judged once per session key, before the turn's needs-you items,
// counted as launched); the halt guard (awaiting-sign-off goes to step 5's sign-off form; only an UNVERIFIED stops a
// cool-down); step 5's sign-off form (await-sign-off, no `status: done`, no retire, no archive move, a `not landed`
// waiting bullet with the dependants counted, why reconcile-project never misreads it, a phase-close follow-on's
// re-run commands on the live note path that a later full ceremony re-points, and no question tool); § 6.5's
// halted-turn exception and (e) exclusion; § 7's designed awaiting-sign-off stop and a stuck bullet with no gate
// reason; *Reinstate* under a sign-off pause; the month line (p30-8, ADR 0034's 2026-10-27 amendment): § 3.7's
// calendar-month sum from the `signed under the standing approval:` lines, § 6.5's log sentence, step 1.2's `ASK:`
// reasons and the Don't. In skills/schedule/SKILL.md: § 3.6's sweep (the recall floor, never the verdict, every
// dismissal listed) and its spend rule (Chorus ADR 0108 d4: spend is recorded, never asked; a limit Lachy names is
// recorded), § 7's `## Decisions (asked ahead <date>)` section for a named limit, its `## Decisions (recorded <date>)`
// Planner line for every other spend hit, the sanctioned exceptions, and § 0's sign-off sentence. In orient's
// reshuffle.md: R3's gates ahead (a spend smell recorded, never grilled) and R5.2's records. Status recommendation
// 8's sign-off clause, README and CONTEXT.md. The test-credential rule (ADR 0063): § 3.7's *Test credentials* paragraph (its
// checks in order, the class its own switch, the refresh on a reused tree, the missing-key ASK, a Leg never signing one);
// schedule § 3.6's recorded-never-asked paragraph with its two re-sweep sentences (a hit inside the recorded Planner line
// is dismissed and listed; a task holding the line is recorded, never asked) and the serial-path sentence, and § 7's
// test-credential Planner line, and its Under the chain item 7 with orient-all's item 9 (the twin lists that give a
// credential hit § 3.6 records its Planner line with no ask-ahead); reshuffle R3's recorded clause with the same two
// sentences and R5.2's record; asking.md's bullet, execution-fit's ruling (a) qualifier, CONTEXT.md's entry, ADR 0008's amendment and the README.
// p37-4 (ADR 0034's 2026-11-05 amendment): § 3.7's *Cap-only pricing* sentence with what still asks, "cannot be priced
// even from its cap", ADR 0008's p37-4 line and CONTEXT.md's "even from its cap alone" (cap-only); the declared test
// Login: § 3.7's "or a declared test Login", *Test credentials*' first sentence, the *A declared test Login* paragraph,
// § 3's `test_logins` row, execution-fit's "and a declared test Login", engine-snapshot.md's schema-5 sentence,
// CONTEXT.md's **Test Login** entry and the README (test-login). p39-3: schedule § 3.6, reshuffle R3 (c) and R5.2,
// the Under the chain, orient-all and Backlog orient lists, and the docs record a declared test Login's hit, never asking
// it ahead; in § 3.6's and R3 (c)'s paragraphs each keeps-the-ask sentence follows its re-sweep sentence (b), so (b)
// never exempts a task's other credential hits (test-credential, test-login-sweep). p48-4 (ADR 0034's 2026-11-13
// amendment): § 3.7's *Widest pricing* sentence with its governed cap word and what still asks after it, "nor read at
// its widest", *The Cap's format*'s widest-amount sentence, ADR 0008's p48-4 line, CONTEXT.md's "read at its widest,
// is within the limit" and the README's widest clause (widest).
//
// Same shape as execute-signed-gate.test.mjs: every rule lives in one function, checkStanding(files), returning named
// failures, so the real text and the controls run through identical logic; each control mutates the real text in one
// place and must fail with exactly its rule. Reads files only. The scripts' behaviour is pinned by
// skills/execute/tests/reconcile-rollout-standing.test.sh and tests/gated-inputs.test.mjs (which also prices schedule's
// Planner example).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { collapse, read, section } from '../lib/contract-text.mjs'

const real = {
  execute: read('skills/execute/SKILL.md'),
  schedule: read('skills/schedule/SKILL.md'),
  reshuffle: read('skills/orient/reshuffle.md'),
  status: read('skills/status/SKILL.md'),
  readme: read('README.md'),
  context: read('CONTEXT.md'),
  execfit: read('skills/_shared/execution-fit.md'),
  asking: read('skills/_shared/asking.md'),
  orientAll: read('skills/orient-all/SKILL.md'),
  backlog: read('skills/orient/backlog.md'),
  adr0008: read('docs/adr/0008-a-declared-gate-always-pauses-for-a-human.md'),
  snapshot: read('skills/_shared/engine-snapshot.md'),
  grade: read('skills/_shared/readiness-grade.md'),
  settings: read('skills/_shared/scripts/rollout-settings.py'),
}

const S0 = /^### 0\. /
const S36 = /^### 3\.6\. /
const S37 = /^### 3\.7\. /
const S45 = /^### 4\.5\. /
const S65 = /^### 6\.5\. /
const S7 = /^### 7\. /
const SCH7 = /^### 7\. /
const S28 = /^### 2\.8\. /
const S8 = /^### 8\. /
const SCOPE = /^## Scope/
const R3 = /^## R3\. /
const R5 = /^## R5\. /
const DONTS = /^## Don'ts/
const before = (hay, a, b) => hay.indexOf(a) >= 0 && hay.indexOf(b) >= 0 && hay.indexOf(a) < hay.indexOf(b)
const lineOf = (text, prefix) => collapse(text.split('\n').find((l) => l.startsWith(prefix)) ?? '')

// A bold-labelled paragraph inside a section, to the next bold label at column 0, collapsed.
function labelled(text, sectionRe, label) {
  const lines = (section(text, sectionRe) ?? '').split('\n')
  const i = lines.findIndex((l) => l.startsWith(`**${label}`))
  if (i < 0) return ''
  const j = lines.findIndex((l, k) => k > i && /^\*\*[A-Z`]/.test(l))
  return collapse(lines.slice(i, j < 0 ? undefined : j).join('\n'))
}

function checkStanding(f) {
  const fails = []
  const s45raw = section(f.execute, S45) ?? ''
  const sub2 = collapse(s45raw.split('\n').find((l) => /^ {3}2\. \*\*/.test(l)) ?? '').trim()
  const guard = collapse(s45raw.split('\n').find((l) => /^ {3}5\. \*\*Halt guard/.test(l)) ?? '').trim()
  const step5 = collapse(s45raw.slice(Math.max(0, s45raw.indexOf('5. **Completion.**')), s45raw.indexOf('**Lost call.**')))
  const form = step5.slice(Math.max(0, step5.indexOf('**Completion awaiting sign-off (ADR 0034).**')))
  const ceremony = step5.slice(0, Math.max(0, step5.indexOf('**Completion awaiting sign-off (ADR 0034).**')))
  const standing = labelled(f.execute, S37, 'Standing approval (ADR 0034).')
  const reinstate = labelled(f.execute, S45, 'Reinstate (resuming a paused rollout).')
  const turn = labelled(f.execute, S65, 'The turn.')
  const items = labelled(f.execute, S65, 'Needs-you items.')
  const logLives = labelled(f.execute, S65, 'Where the log lives.')
  const donts = collapse(section(f.execute, DONTS) ?? '')
  const stuck7 = lineOf(section(f.execute, S7) ?? '', '- `next` reports `halt: stuck`')
  const signOff7 = lineOf(section(f.execute, S7) ?? '', '- `next` reports `halt: awaiting-sign-off`')
  const s36 = collapse(section(f.schedule, S36) ?? '')
  const sch7raw = section(f.schedule, SCH7) ?? ''
  const sch7 = collapse(sch7raw)
  const sch0 = collapse(section(f.schedule, S0) ?? '')
  const r3 = collapse(section(f.reshuffle, R3) ?? '')
  const r5 = collapse(section(f.reshuffle, R5) ?? '')

  // step12: the Standing approval opens step 1.2, before the seeded revises, skipped under a pause, judged once per
  // session key, run before the turn derives its needs-you items, and counted as "sub-step 2 launched".
  if (!sub2.startsWith('2. **Standing approval (ADR 0034), first.**') || !before(sub2, '**Standing approval', '**Seeded revises') ||
    !sub2.includes('Skip it when `paused` or `pauseRequested` is set. For each `setAside` entry with status `gate-pending`') ||
    !sub2.includes('whose key this session has not yet judged') || !sub2.includes("held for the session's life") ||
    !sub2.includes('`python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/reconcile-rollout.py approve-gates --standing --tasks <slug> --rollout <rollout-note>`') ||
    !sub2.includes('it counts as "sub-step 2 launched"') ||
    !sub2.includes("Exit 3: the gates it left stay (a) items (§ 6.5), each with its `ASK:` reason as the item's `→` detail") ||
    !sub2.includes("It runs before this turn's needs-you items are derived from `next`, so a covered gate is never listed")) {
    fails.push('step12')
  }

  // halt-guard: awaiting-sign-off goes to step 5's form; nothing set aside stops a cool-down (ADR 0048); a gate never does.
  if (!guard.includes("`awaiting-sign-off` → step 5's *Completion awaiting sign-off* form") ||
    !guard.includes('(a quota or infra cool-down) ends the turn `waiting`') ||
    !guard.includes('A gate-pending task never stops a cool-down') || guard.includes('gated inputs await sign-off')) {
    fails.push('halt-guard')
  }

  // form: the sign-off form closes the run but leaves the rollout open and paused: await-sign-off, no done stamp, no
  // retire, no archive move; its waiting bullet carries `not landed`, the dependants are counted, not named, and its
  // rationale says why reconcile-project never misreads the log, now or once a later ceremony archives it. A phase-close
  // follow-on the form files points its re-run commands' `--rollout` at the live note (the form never moves it, so the
  // full ceremony's archive path would exit 1), and the full ceremony re-points them when it archives the note.
  if (!form.includes('`python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/reconcile-rollout.py await-sign-off --rollout <rollout-note>`') ||
    !form.includes("It skips the `status: done` stamp, the Post-rollout follow-ons, the canary's `retire` and the archive move") ||
    !form.includes('`- [[<slug>]] not landed: awaiting your sign-off: <gate verbatim>`') ||
    !form.includes('`- and <n> queued task(s) that wait on them (named in ## Pause log): sign off, then /thread:execute [[<rollout>]]`') ||
    !form.includes('The dependants are counted, not named') || !form.includes('never reads this log') ||
    !form.includes('A later full ceremony archives the note') ||
    !form.includes('schedule picks up only `status: open` tasks, so an archived rollout would strand the gate-pending task') ||
    !form.includes("a follow-on filed or appended to here (*Failure*) points each re-run command's `--rollout` at the live `Work/Tasks/<rollout-slug>.md`, never the archive path, because this form never moves the note (a later full ceremony re-points it at the post-move path)") ||
    !ceremony.includes('The full ceremony (never the sign-off form below) also re-points at the post-move path every re-run command whose `--rollout` still names the live `Work/Tasks/<rollout-slug>.md`') ||
    !before(form, 'the phase close', 'await-sign-off --rollout') || !before(form, 'await-sign-off --rollout', '`/thread:close`')) {
    fails.push('form')
  }

  // question-tool: the form never calls it, live work or not; § 6.5's turn names the exception.
  if (!form.includes('**the sign-off form never calls the question tool**, live work or not') ||
    !form.includes('the turn ends on its `ROLLOUT-STATUS … state=halted reason="awaiting sign-off: [[<slug>]]"` line') ||
    !turn.includes("The sign-off form's halt is the one `halted` turn that never asks through the question tool (§ 4.5 step 5)") ||
    /may put the sign-off to Lachy through the question tool/.test(form)) {
    fails.push('question-tool')
  }

  // standing-37: § 3.7's paragraph: total exposure, the task's ceiling never a target, irreversible never passes and a
  // credential only as a declared test credential, a gate it cannot price asks, the month line summed from the log's standing lines, and spend never asked
  // ahead; the sign-off flow says a covered gate never reaches Lachy.
  if (!standing.includes('**total exposure**') || !standing.includes("it records the total exposure as the task's ceiling, never a target") ||
    !standing.includes('Irreversible gates never pass under it; a credential gate passes only as a declared test credential (ADR 0063') ||
    !standing.includes('a gate it cannot price asks') ||
    !standing.includes('`(approved <date> under the standing approval: …)`') ||
    !standing.includes("this calendar month's standing-approved spend") || !standing.includes('`signed under the standing approval:`') ||
    !standing.includes('Spend is never asked ahead (schedule § 3.6)') ||
    !collapse(section(f.execute, S37) ?? '').includes("A spend gate the standing approval covers never reaches you: step 1.2's *Standing approval* signs it before the turn derives its needs-you items (ADR 0034).")) {
    fails.push('standing-37')
  }

  // s7: § 7's awaiting-sign-off bullet is a designed stop with its reason, and the stuck bullet names no gate reason.
  if (!signOff7.includes('`reason="awaiting sign-off: [[task]]"` — a **designed** stop (ADR 0034), not a failure') ||
    !signOff7.includes("The halted turn lists each gate in the report's `Needs you:` block") ||
    !stuck7 || stuck7.includes('gated inputs await sign-off') || !stuck7.includes('the gate as an (a) item')) {
    fails.push('s7')
  }

  // reinstate: under `paused_for: sign-off`, the standing approval runs, then clear-pause; its exit 3 halts with both
  // stamps kept and no resume, loop, ceremony or heartbeat.
  if (!reinstate.includes('`paused_for: sign-off`') || !before(reinstate, 'approve-gates --standing', 'then `clear-pause`') ||
    !reinstate.includes('on its exit 3, print `[[<rollout>]] still awaiting sign-off:` with each `STILL-AWAITING` line') ||
    !reinstate.includes('leave both stamps, run no `resume`, loop, ceremony or heartbeat') ||
    !reinstate.includes('state=halted reason="awaiting sign-off: [[<slug>]]"')) {
    fails.push('reinstate')
  }

  // exclusion-e: (e) never doubles the sign-off halt's items, which are (a).
  if (!items.includes('not the awaiting-sign-off halt, whose items are (a)')) fails.push('exclusion-e')

  // schedule-sweep: § 3.6 runs the script; the output is the recall floor, never the verdict; a currency amount is never
  // dismissed; each dismissal is listed at step 8.
  if (!s36.includes('python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/gated_inputs.py sweep <note>...') ||
    !s36.includes('**The sweep is the recall floor, never the verdict**') ||
    !s36.includes('a currency amount, or a spend word about something the task buys or runs, is never dismissed') ||
    !s36.includes('step 8 lists each dismissal on one line (`swept, dismissed: [[task]] <word> (<why>)`)') ||
    !s36.includes('never a shell variable') || !collapse(f.schedule).includes('swept, dismissed: [[task-u]]')) {
    fails.push('schedule-sweep')
  }

  // spend-recorded (Chorus ADR 0108 d4): § 3.6 never asks spend; a spend hit is recorded (step 7's Planner line under
  // `(recorded <date>)`), a limit Lachy names is shown and honoured, and with the approval off every spend gate reaches
  // him mid-run. Step 7 keeps the `(asked ahead)` section for a named limit (its Spend and Planner lines: the Planner
  // line's example and its per-item rule), adds the `(recorded)` heading, and the sanctioned-exceptions sentence names
  // all three records.
  const planner = sch7raw.split('\n').find((l) => l.startsWith('- Planner:')) ?? ''
  if (!s36.includes('**Spend is recorded, never asked** (Chorus ADR 0108 d4).') ||
    !s36.includes('step 7 writes its Planner line under `## Decisions (recorded <YYYY-MM-DD>)`') ||
    !s36.includes('with the standing approval off (built-in 0), every spend gate reaches him mid-run') ||
    !s36.includes('is shown and honoured, never asked again') || s36.includes('up to what total exposure in USD') ||
    !sch7raw.includes('## Decisions (asked ahead <YYYY-MM-DD>)') ||
    !sch7raw.includes('- Spend: Lachy approved up to <N> USD total exposure for this task at /thread:schedule') ||
    !sch7raw.includes('## Decisions (recorded <YYYY-MM-DD>)') ||
    !planner.includes('`spend: <what> — cap 50 USD per Login per month across 3 Logins`') ||
    !planner.includes('(never "every push" or "each image")') ||
    !sch7.includes('the § 3.6 records: `spend_approval_usd: <N>` above the standing approval and the `## Decisions (asked ahead <date>)` section for a limit Lachy named, the `## Decisions (recorded <date>)` Planner line for every other spend hit, and a credential or irreversible sign-off\'s `## Approved gates` bullet')) {
    fails.push('spend-recorded')
  }

  // reshuffle: R3 records a spend smell, never grilled, and keeps § 3.6's ask-ahead for a credential or irreversible
  // gate; R5.2 writes the records as schedule step 7 does, the `(recorded)` section among them.
  if (!r3.includes('**(c) gates ahead** (ADR 0034)') || !r3.includes('a spend smell is recorded, never grilled') ||
    !r3.includes("§ 3.6's ask-ahead question") || r3.includes('up to what total exposure in USD') ||
    !r5.includes('exactly as schedule step 7 does') || !r5.includes('`## Decisions (recorded <date>)`')) {
    fails.push('reshuffle')
  }

  // month-line (p30-8; ADR 0075 d2): § 6.5 says the log's one writer is approve-gates --standing, whose lines are the
  // month line's ledger; step 1.2's left gates name the month line among their reasons; the Don't forbids writing the
  // log line by hand.
  if (!logLives.includes('Its one writer is `reconcile-rollout.py approve-gates --standing`, which appends') ||
    !logLives.includes("the month line's ledger (§ 3.7)") ||
    !sub2.includes('past the month line') ||
    !donts.includes('nor its `signed under the standing approval:` Needs-you log line')) {
    fails.push('month-line')
  }

  // one-unfinished: a sign-off pause is still the repo's one unfinished rollout, and schedule and status name the path.
  if (!sch0.includes('A rollout awaiting sign-off (`paused_for: sign-off`') ||
    !sch0.includes('sign off, then `/thread:execute`, or `/thread:repair` to defer them') ||
    !collapse(f.status).includes('With `pausedFor: sign-off` → "sign off each waiting gate (or /thread:repair to defer), then /thread:execute [[<rollout>]]; until then it is this project\'s one unfinished rollout on this repo"')) {
    fails.push('one-unfinished')
  }

  // docs: README and CONTEXT.md name the key; the Gated input entry sets the task aside, never the rollout.
  if (!collapse(f.readme).includes('sets `spend_approval_usd` (whole US dollars) under `[defaults]`') ||
    !collapse(f.readme).includes('pause the task for sign-off, never the rollout') ||
    !collapse(f.context).includes('Sets its task aside for sign-off, never the rollout (ADR 0008, ADR 0034).') ||
    !collapse(f.context).includes('the Rollout settings key `spend_approval_usd`')) {
    fails.push('docs')
  }
  // test-credential (ADR 0063): a declared test credential signs itself at the stop, recorded and never asked ahead.
  const tc = labelled(f.execute, S37, 'Test credentials (ADR 0063).')
  const SENT_A = 'A hit inside the recorded test-credential Planner line is dismissed and listed as `swept, dismissed: [[task]] <word> (the recorded test-credential Planner line)`.'
  const SENT_B = 'A task that already holds that line is recorded, never asked.'
  // review round 2: read in order, a keeps-the-ask sentence before (b) is overridden by it, so it comes after
  const R3_KEEP = 'A non-zero exit, or no class, keeps the ask, and so does a hit naming live or production use, a key the class does not hold, or no mode.'
  if (!tc.includes("the reading's class-independent steps") || !before(tc, "the reading's class-independent steps", 'the class is set') ||
    !before(tc, 'the class is set', 'the class-dependent steps') ||
    !before(tc, 'the class-dependent steps', "the rollout's `env_bootstrap` refreshes the declared file into the task tree with a plain, unconditional `cp`") ||
    !before(tc, 'with a plain, unconditional `cp`', 'each named key is set in that file') ||
    !tc.includes('The class is its own switch') ||
    !tc.includes('re-runs `env_bootstrap` in the task tree before it builds, on a reused tree too') ||
    !tc.includes('A key missing from the file is an `ASK:` naming it at the stop') ||
    !tc.includes('A Leg never signs one') ||
    !s36.includes('**A declared test credential is recorded, never asked** (ADR 0063).') || !s36.includes(SENT_A) || !s36.includes(SENT_B) ||
    !s36.includes('On § Serial path every class credential keeps the ask-ahead: a Leg resolves no class.') ||
    !sch7raw.split('\n').some((l) => l.startsWith('- Planner: word each test-credential gate')) ||
    !collapse(f.schedule).includes("a spend hit, or a credential hit § 3.6 records in the repo's test-credential class") ||
    !collapse(f.orientAll).includes("and a spend hit, or a credential hit § 3.6 records in the repo's test-credential class (ADR 0063)") ||
    !r3.includes("A credential hit whose context names only test-mode or staging use of keys the repo's declared class holds is recorded, never grilled (ADR 0063)") ||
    !r3.includes(SENT_A) || !r3.includes(SENT_B) || !before(r3, SENT_B, R3_KEEP) ||
    !r5.includes("the test-credential Planner line (schedule step 7's, ADR 0063)") ||
    !collapse(f.asking).includes("A credential in its repo's declared test-credential class is never asked ahead (ADR 0063)") ||
    !collapse(f.execfit).includes("a repo's declared test credential (ADR 0063)") ||
    !f.context.includes('**Test credential**') ||
    !f.adr0008.includes('Amended by ADR 0063') ||
    !collapse(f.readme).includes('The class is its own switch, independent of `spend_approval_usd`')) {
    fails.push('test-credential')
  }

  // cap-only (p37-4): a gate the full reading refuses is priced from its readable cap; what still asks is named; the
  // limit's ask is "cannot be priced even from its cap"; ADR 0008 and CONTEXT.md carry it.
  if (!standing.includes('**Cap-only pricing** (p37-4, ADR 0034\'s 2026-11-05 amendment: unpriceable never means asked)') ||
    !standing.includes("when the full reading refuses a gate whose cap reads, its exposure is the cap times the clause's count plus every other USD amount it names, and prose around the cap never asks") ||
    !standing.includes('Still asking: a non-USD amount, a rate, multiplier, `%` or widening word on the cap itself, a plural Logins/accounts/seats/users, or a per-Login, per-account, per-seat or per-user word anywhere.') ||
    !standing.includes('or when it cannot be priced even from its cap') || !standing.includes("`gated_inputs.py`'s standing reading") ||
    !f.adr0008.includes('*(Amended 2026-11-05 by p37-4') ||
    !collapse(f.context).includes('a shape it cannot price, even from its cap alone, asks')) {
    fails.push('cap-only')
  }

  // widest (p48-4, ADR 0034's 2026-11-13 amendment): a gate neither earlier reading prices is read at its widest, so
  // long as a cap word governs one of its amounts; what still asks after it is named; the limit's ask adds "nor read at
  // its widest"; *The Cap's format* says `exposure -` prints the widest amount; ADR 0008, CONTEXT.md and the README
  // carry it.
  const cap37 = labelled(f.execute, S37, "The Cap's format (ADR 0038).")
  if (!standing.includes("**Widest pricing** (p48-4, ADR 0034's 2026-11-13 amendment: a spend plainly under the limit never asks)") ||
    !standing.includes('so long as one amount comes straight after a cap word') ||
    !standing.includes('Still asking after it: a gate that names no amount, or none straight after a cap word, a negated or undecided cap') ||
    !standing.includes(', nor read at its widest.') ||
    !cap37.includes('Since p48-4 a gate neither of those readings prices prints its widest amount') ||
    !f.adr0008.includes('*(Amended 2026-11-13 by p48-4') ||
    !collapse(f.context).includes('read at its widest, is within the limit') ||
    !collapse(f.readme).includes('one whose cap cannot be read either is read at its widest')) {
    fails.push('widest')
  }

  // test-login (p37-4): a credential gate naming only a declared test Login signs itself; machine-wide, operator-only.
  const tl = labelled(f.execute, S37, "A declared test Login (p37-4, ADR 0034's 2026-11-05 amendment).")
  const row3 = collapse((section(f.execute, /^### 3\. /) ?? '').split('\n').find((l) => l.startsWith('| `test_logins` |')) ?? '')
  // § 4.5 step 1.2's Exit 3 and § 6.5 (a) list the same ASK reasons as § 3.7 (review round 1: sibling sites)
  const askReasons = 'unpriceable even at its widest, a bounce, a credential outside the declared test class, an `env_bootstrap` that may not refresh its file, a key missing from it, or a Login gate that names an undeclared Login or anything beside it'
  if (collapse(f.execute).split(askReasons).length !== 3 ||
    !tl.includes('nothing joined beside it (an `@` address, or a conjunction that joins a second thing') ||
    !standing.includes('or a declared test Login (*A declared test Login* below)') ||
    !tc.startsWith('**Test credentials (ADR 0063).** A credential gate passes the standing approval only as a declared test credential or a declared test Login (below). A declared test credential is one of') ||
    !tc.includes('so no class resolves and every class credential there asks') ||
    !tl.includes('one of the machine\'s declared test Logins') || !tl.includes('`(approved <date> under the standing approval: test Login <name>, from <source>)`') ||
    !tl.includes('with no limit, no ledger, no month line and no Needs-you line') ||
    !tl.includes("It is machine-wide, so a Leg's serial note signs one too, and a bounced note signs none") ||
    !tl.includes('Operator-only: no agent or script writes `test_logins`') ||
    !row3.includes('one line under `[defaults]` of `~/.config/thread/rollouts.toml`') ||
    !collapse(f.execfit).includes("and a declared test Login (ADR 0034's 2026-11-05 amendment), a publish never uses") ||
    !collapse(f.snapshot).includes('`test_logins` (p37-4) is the first schema-5 key: an older snapshot ignores it, so its rollouts ask the Login gate as before.') ||
    !f.context.includes('- **Test Login** —') || !collapse(f.context).includes('a Leg never signs one (a Test Login is machine-wide)') ||
    !collapse(f.readme).includes('test_logins = ["dummy"]') || !collapse(f.readme).includes('It is operator-only: no skill or script writes it.')) {
    fails.push('test-login')
  }

  // test-login-sweep (p39-3): schedule and orient record a credential hit the sweep reads as a declared test Login,
  // never asking it ahead (on § Serial path too, a Leg signs one), and so do the Under the chain, orient-all and
  // Backlog orient lists, each to its Planner line; each keeps-the-ask sentence follows TL_B (review round 2), so a
  // task holding the line still has its other credential hits asked; the sweep's `login` field and its `test_logins`
  // stderr line are worded where it is read (§ 3.6, R3 (c), readiness-grade.md); § 7's test-Login Planner line sits
  // after the test-credential one, so spend-recorded's first `- Planner:` line stays the spend one.
  const tls = labelled(f.schedule, S36, 'A declared test Login is recorded, never asked')
  const sch7lines = sch7raw.split('\n')
  const tcAt = sch7lines.findIndex((l) => l.startsWith('- Planner: word each test-credential gate'))
  const tlAt = sch7lines.findIndex((l) => l.startsWith('- Planner: word each test-Login gate'))
  const s28 = collapse(section(f.schedule, S28) ?? '')
  const s8 = collapse(section(f.schedule, S8) ?? '')
  const scope = collapse(section(f.schedule, SCOPE) ?? '')
  const TL_A = 'A hit inside the recorded test-Login Planner line is dismissed and listed as `swept, dismissed: [[task]] <word> (the recorded test-Login Planner line)`.'
  const TL_B = 'A task that already holds the test-Login Planner line is recorded, never asked.'
  // review round 2: each keeps-the-ask sentence follows TL_B, so TL_B never exempts the task's other credential hits
  const TL_KEEP = 'A hit with no `login`, or with `login.names` null, keeps the ask-ahead above'
  const TL_KEEP_R3 = 'A hit with no `login`, or with `login.names` null, keeps the ask.'
  const TL_STDERR_R3 = 'A `gated_inputs: test_logins:` stderr line (exit 1) means the declared test Logins could not be read: those hits carry no `login` and keep the ask'
  if (!s36.includes('**A declared test Login is recorded, never asked** (p37-4).') ||
    !tls.includes('A credential hit whose `login.names` the sweep set') || !tls.includes(TL_A) || !tls.includes(TL_B) ||
    !before(tls, TL_B, TL_KEEP) ||
    !tls.includes('The test Logins are machine-wide, so on § Serial path a declared test Login is recorded too: a Leg signs one.') ||
    !s36.includes('A credential hit on a `credential:` gate line naming a Login also carries its `login` reading (`{names, why}`)') ||
    !s36.includes('A `gated_inputs: test_logins:` stderr line (exit 1) means they could not be read: those hits carry no `login` and keep the ask, and every note still printed.') ||
    !s36.includes('(not a test credential or test Login recorded below)') ||
    !sch7.includes('For each credential hit § 3.6 recorded as a declared test Login, append the recorded section with the test-Login Planner line below') ||
    tlAt < 0 || tlAt < tcAt ||
    !s28.includes('**`test_logins`** resolves here too (p37-4') || !s28.includes("§ 3.6's sweep reads it itself") ||
    !s8.includes('; test Logins <name>, … (<source>), or none (built-in)') ||
    !s8.includes('[[task-l]] — smells of a credential ("the dummy Claude Login") → plan_approval: required; a declared test Login') ||
    !collapse(f.schedule).includes('or as a declared test Login, gets its Planner line as on every run') ||
    !collapse(f.schedule).includes("section for a member with a spend hit or a declared test Login's hit (the test-Login Planner line)") ||
    !scope.includes('§ 3.6 runs `gated_inputs.py sweep`, which reads task notes and, only when a `credential:` gate line naming a Login needs the declaration, `[defaults] test_logins`') ||
    !collapse(f.orientAll).includes('or as a declared test Login (p37-4), also gets its step 7 `## Decisions (recorded <date>)` Planner line.') ||
    !collapse(f.backlog).includes('A spend or a test-credential hit gets its Planner line, or a credential hit § 3.6 records as a declared test Login (p37-4), the test-Login Planner line.') ||
    !r3.includes('A credential hit the sweep reads as a declared test Login (its `login.names` set) is recorded, never grilled (p37-4)') ||
    !r3.includes(TL_STDERR_R3) ||
    !r3.includes(TL_A) || !r3.includes(TL_B) || !before(r3, TL_B, TL_KEEP_R3) || !before(r3, TL_B, TL_STDERR_R3) ||
    !r5.includes("for a credential recorded as a declared test Login, the test-Login Planner line (schedule step 7's, p37-4)") ||
    !collapse(f.reshuffle).includes("The sweep R3 (c) runs reads `[defaults] test_logins` from the same file through `rollout-settings.py`'s resolve(repo=None), in process") ||
    !collapse(f.asking).includes('A credential gate naming only a declared test Login (`[defaults] test_logins`) is never asked ahead (p37-4)') ||
    !collapse(f.grade).includes('The sweep reads only the notes, and `[defaults] test_logins` from `~/.config/thread/rollouts.toml` (read-only, no git) when a `credential:` gate line naming a Login needs it.') ||
    !collapse(f.grade).includes('means only that the declared test Logins could not be read: every note still printed, so the hits stand as read (fail closed), never a sweep failure.') ||
    !collapse(f.settings).includes("gated_inputs.py's `sweep` CLI (its part 1: schedule § 3.6, orient reshuffle R3 (c)) reads it too") ||
    !collapse(f.context).includes('Schedule and orient record such a gate, never ask it ahead, on a serial chain too.') ||
    !collapse(f.readme).includes('Schedule and orient record such a gate ahead and never ask it: the planner words it as the standing approval reads it.')) {
    fails.push('test-login-sweep')
  }
  return fails
}

test('execute, schedule, reshuffle, status, README and CONTEXT.md hold every standing-approval rule', () => {
  assert.deepEqual(checkStanding(real), [])
})

// ---- controls: each mutates the real text in one place and must fail with exactly its rule ---------

const RULES = ['step12', 'halt-guard', 'form', 'question-tool', 'standing-37', 's7', 'reinstate', 'exclusion-e',
  'schedule-sweep', 'spend-recorded', 'reshuffle', 'month-line', 'one-unfinished', 'docs', 'test-credential', 'cap-only', 'test-login',
  'test-login-sweep', 'widest']
const CONTROLLED = new Set()

function edit(text, from, to) {
  assert.ok(text.includes(from), `control setup: ${from.slice(0, 80)} not found`)
  return text.replace(from, to)
}
const only = (file, from, to, rule, label) => {
  CONTROLLED.add(rule)
  assert.deepEqual(checkStanding({ ...real, [file]: edit(real[file], from, to) }), [rule], label)
}
// The raw span of `phrase` in `text`, each space in it matching any run of whitespace, so a control survives a reflow.
function span(text, phrase) {
  const re = new RegExp(phrase.split(' ').map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+'))
  const m = text.match(re)
  assert.ok(m, `control setup: ${phrase.slice(0, 80)} not found`)
  return m[0]
}
// Move `phrase` (a sentence with its leading space) to just before `anchor` in `file`, raw spans found by span().
function movedBefore(file, phrase, anchor) {
  const p = span(real[file], phrase)
  const rest = real[file].replace(p, '')
  const a = span(rest, anchor)
  return { ...real, [file]: rest.replace(a, () => `${p.trimStart()} ${a}`) }
}

test('control: the Standing approval after the seeded revises fails step12', () => {
  const l = real.execute.split('\n').find((x) => /^ {3}2\. \*\*Standing approval/.test(x))
  const sa = l.slice(0, l.indexOf(' **Seeded revises'))
  const rest = l.slice(l.indexOf('**Seeded revises'))
  CONTROLLED.add('step12')
  assert.deepEqual(checkStanding({ ...real, execute: real.execute.replace(l, `   2. ${rest} ${sa.replace(/^ {3}2\. /, '')}`) }), ['step12'])
  only('execute', 'it counts as "sub-step 2 launched", so', 'so', 'step12', 'not counted as launched')
})

test('control: a halt guard that sends awaiting-sign-off to § 7 fails halt-guard', () => {
  only('execute', "`awaiting-sign-off` → step 5's *Completion awaiting sign-off* form; ", '', 'halt-guard', 'no form route')
})

test('control: a waiting bullet without `not landed` fails form', () => {
  only('execute', '`- [[<slug>]] not landed: awaiting your sign-off: <gate verbatim>`', '`- [[<slug>]] awaiting your sign-off: <gate verbatim>`',
    'form', 'landing evidence')
  only('execute', "It skips the `status: done` stamp, the Post-rollout follow-ons, the canary's `retire` and the archive move",
    "It also stamps `status: done` and archives the note", 'form', 'archived')
})

test("control: a sign-off form whose phase-close follow-on uses the archive path, or a ceremony that never re-points it, fails form", () => {
  only('execute', "points each re-run command's `--rollout` at the live `Work/Tasks/<rollout-slug>.md`, never the archive path",
    "points each re-run command's `--rollout` at `Work/Tasks/Archive/Rollouts/<rollout-slug>.md`", 'form', 'archive path in the form')
  only('execute', ' The full ceremony (never the sign-off form below) also re-points at the post-move path every re-run command whose `--rollout` still names the live `Work/Tasks/<rollout-slug>.md` (the sign-off form writes them so), since the move below archives the note.',
    '', 'form', 'no re-point in the full ceremony')
})

test('control: a form that asks through the question tool fails question-tool', () => {
  only('execute', '**the sign-off form never calls the question tool**, live work or not',
    'the sign-off form may put the sign-off to Lachy through the question tool', 'question-tool', 'asks')
})

test('control: an exposure read as a target fails standing-37', () => {
  only('execute', "it records the total exposure as the task's ceiling, never a target", 'it records the total exposure as the budget to spend',
    'standing-37', 'a target')
})

test('control: an awaiting-sign-off stop read as a failure fails s7', () => {
  only('execute', '— a **designed** stop (ADR 0034), not a failure', '— a failure', 's7', 'not designed')
})

test('control: a reinstate that clears the pause before the standing approval fails reinstate', () => {
  only('execute', 'first runs `reconcile-rollout.py approve-gates --standing --tasks <slug> --rollout <rollout-note>` for each gate-pending task (a limit raised meanwhile, or a task stamp, now applies), then `clear-pause`',
    'first runs `clear-pause`, then `reconcile-rollout.py approve-gates --standing --tasks <slug> --rollout <rollout-note>` for each gate-pending task', 'reinstate', 'order')
})

test('control: (e) that also lists the sign-off halt fails exclusion-e', () => {
  only('execute', ' not the awaiting-sign-off halt, whose items are (a), §4.5 step 5;', '', 'exclusion-e', 'doubled')
})

test('control: § 3.6 dropping the dismissal listing fails schedule-sweep', () => {
  only('schedule', '- step 8 lists each dismissal on one line (`swept, dismissed: [[task]] <word> (<why>)`), so nothing drops silently;\n', '',
    'schedule-sweep', 'silent dismissals')
})

test('control: § 3.6 asking the spend question again fails spend-recorded', () => {
  only('schedule', '**Spend is recorded, never asked** (Chorus ADR 0108 d4).',
    '**Spend is recorded, never asked** (Chorus ADR 0108 d4). Ask: "up to what total exposure in USD?"', 'spend-recorded', 'asks again')
})

test('control: § 7 dropping the Planner line fails spend-recorded', () => {
  const l = real.schedule.split('\n').find((x) => x.startsWith('- Planner:'))
  only('schedule', l + '\n', '', 'spend-recorded', 'no Planner line')
})

test('control: R3 grilling a spend smell, or R5.2 without the step-7 write, fails reshuffle', () => {
  only('reshuffle', 'a spend smell is recorded, never grilled', 'a spend smell gets the spend question', 'reshuffle', 'grilled')
  only('reshuffle', 'exactly as schedule step 7 does', 'as the task-writer prefers', 'reshuffle', 'no write')
})

test('control: § 6.5 without the standing lines, or step 1.2 without the month line, fails month-line', () => {
  const l = real.execute.split('\n').find((x) => x.startsWith('**Where the log lives.**')) ?? ''
  const END = "the month line's ledger (§ 3.7)."
  const from = l.slice(l.indexOf(' Its one writer is `reconcile-rollout.py approve-gates --standing`'))
  assert.ok(from.length > 1 && from.includes(END), 'control setup: the standing-lines sentence')
  const sentence = from.slice(0, from.indexOf(END) + END.length)
  only('execute', sentence, '', 'month-line', 'no standing lines')
  only('execute', "the item's `→` detail (over the limit, past the month line, unpriceable even at its widest,",
    "the item's `→` detail (over the limit, unpriceable even at its widest,", 'month-line', 'no month line in step 1.2')
})

test('control: schedule § 0 without the sign-off sentence fails one-unfinished', () => {
  only('schedule', 'A rollout awaiting sign-off (`paused_for: sign-off`', 'A rollout (`paused_for: sign-off`', 'one-unfinished', 'no § 0 sentence')
})

test('control: a README without the key fails docs', () => {
  only('readme', 'sets\n`spend_approval_usd` (whole US dollars) under `[defaults]`', 'sets it', 'docs', 'no README line')
})

test('control: each test-credential pin, removed in one place, fails test-credential alone', () => {
  const TC = 'test-credential'
  only('execute', ' The class is its own switch: it signs at', ' It signs at', TC, '§ 3.7: no own switch')
  only('execute', ', on a reused tree too, so the plain `cp` brings the key in', ', so the plain `cp` brings the key in', TC, '§ 3.7: no reused-tree refresh')
  only('execute', 'A key missing from the file is an `ASK:` naming it at the stop', 'A missing key is signed anyway at the stop', TC, '§ 3.7: no missing-key ask')
  only('execute', ' A Leg never signs one:', ' A Leg may sign one:', TC, '§ 3.7: a Leg signs one')
  only('execute', "the rollout's `env_bootstrap` refreshes the declared file into the task tree with a plain, unconditional `cp`; ", '', TC, '§ 3.7: no refresh check')
  only('schedule', '**A declared test credential is recorded, never asked** (ADR 0063).', '**A declared test credential is asked ahead** (ADR 0063).', TC, '§ 3.6: asked ahead')
  only('schedule', ' A hit inside the recorded test-credential Planner line is dismissed and listed as `swept, dismissed: [[task]] <word> (the recorded test-credential Planner line)`.', '', TC, '§ 3.6: no sentence (a)')
  only('schedule', ' A task that already holds that line is recorded, never asked.', '', TC, '§ 3.6: no sentence (b)')
  only('schedule', ' On § Serial path every class credential keeps the ask-ahead: a Leg resolves no class.', '', TC, '§ 3.6: no serial sentence')
  const l = real.schedule.split('\n').find((x) => x.startsWith('- Planner: word each test-credential gate'))
  only('schedule', l + '\n', '', TC, '§ 7: no test-credential Planner line')
  only('schedule', ", or a credential hit § 3.6 records in the repo's test-credential\n   class", '', TC, 'Under the chain 7: no class')
  only('orientAll', ", or a credential hit § 3.6 records in the repo's test-credential class (ADR 0063)", '', TC, 'orient-all 9: no class')
  only('reshuffle', 'is recorded, never grilled (ADR 0063)', 'is grilled ahead (ADR 0063)', TC, 'R3: grilled')
  only('reshuffle', span(real.reshuffle, 'A hit inside the recorded test-credential Planner line is dismissed'), 'A hit inside the recorded test-credential Planner line is asked', TC, 'R3: no sentence (a)')
  only('reshuffle', span(real.reshuffle, 'A task that already holds that line is recorded, never asked.'), 'A task that already holds that line is asked again.', TC, 'R3: no sentence (b)')
  CONTROLLED.add(TC)
  assert.deepEqual(checkStanding(movedBefore('reshuffle', ' A non-zero exit, or no class, keeps the ask, and so does a hit naming live or production use, a key the class does not hold, or no mode.',
    'A hit inside the recorded test-credential Planner line')), [TC], 'R3: the keeps-the-ask sentence before (b)')
  only('reshuffle', "the test-credential Planner line (schedule step 7's, ADR 0063)", 'nothing', TC, 'R5: no record')
  only('asking', "- A credential in its repo's declared test-credential class is never asked ahead (ADR 0063): the standing approval signs it at the stop, or asks then.\n", '', TC, 'asking.md: no bullet')
  only('execfit', "a repo's declared test credential (ADR 0063)", 'none', TC, 'execution-fit: no qualifier')
  only('context', '- **Test credential** —', '- **Safe key** —', TC, 'CONTEXT.md: no entry')
  only('adr0008', 'Amended by ADR 0063', 'Amended by a later ADR', TC, 'ADR 0008: no amendment')
  only('readme', 'The class is its own switch, independent of\n`spend_approval_usd`', 'The class needs\n`spend_approval_usd`', TC, 'README: no own switch')
})

test('control: each cap-only pin, removed in one place, fails cap-only alone', () => {
  const C = 'cap-only'
  only('execute', '**Cap-only pricing** (p37-4,', 'Pricing (p37-4,', C, '§ 3.7: no label')
  only('execute', ', and prose around the cap never asks (', ', and prose around the cap asks (', C, '§ 3.7: prose asks')
  only('execute', ' Still asking: a non-USD amount, a rate,', ' Still asking: a rate,', C, '§ 3.7: currency dropped from what asks')
  only('execute', 'or when it cannot be priced even from its cap, nor', 'or when it cannot be priced, nor', C, '§ 3.7: no cap in the limit sentence')
  only('execute', "with `gated_inputs.py`'s standing reading,", "with `gated_inputs.py`'s exposure reading,", C, '§ 3.7: the exposure reading')
  only('adr0008', '*(Amended 2026-11-05 by p37-4', '*(Amended 2026-11-05 by a later task', C, 'ADR 0008: no p37-4 line')
  only('context', 'a shape it cannot price, even from its cap alone,\n  asks', 'a shape it cannot price\n  asks', C, 'CONTEXT.md: no cap alone')
})

test('control: each widest pin, removed in one place, fails widest alone', () => {
  const W = 'widest'
  only('execute', '**Widest pricing** (p48-4,', 'Pricing (p48-4,', W, '§ 3.7: no label')
  only('execute', 'so long as one amount comes straight after a cap word', 'whatever its words', W, '§ 3.7: no governed cap word')
  only('execute', 'Still asking after it: a gate that names no amount, or none straight after a cap word, a negated or undecided cap',
    'Still asking after it: a gate that names no amount', W, '§ 3.7: what still asks')
  only('execute', ', nor read at its widest.', '.', W, '§ 3.7: no widest in the limit sentence')
  only('execute', 'Since p48-4 a gate neither of those readings prices prints its widest amount', 'Since p48-4 a gate neither of those readings prices prints null',
    W, "the Cap's format: no widest amount")
  only('adr0008', '*(Amended 2026-11-13 by p48-4', '*(Amended 2026-11-13 by a later task', W, 'ADR 0008: no p48-4 line')
  only('context', 'read at its widest, is within the limit', 'read at its cap, is within the limit', W, 'CONTEXT.md: no widest')
  only('readme', 'is read at its widest', 'asks', W, 'README: no widest')
})

test('control: each test-login pin, removed in one place, fails test-login alone', () => {
  const L = 'test-login'
  only('execute', ' or a declared test Login (*A declared test Login* below).', '.', L, '§ 3.7: standing names no test Login')
  only('execute', 'only as a declared test credential or a declared test Login (below). A declared test credential is one of', 'only as a declared test credential: one of', L, 'Test credentials: old first sentence')
  only('execute', 'so no class resolves and every class credential there asks', 'so no class resolves and every credential there asks', L, 'Test credentials: every credential asks on a Leg')
  only('execute', ' It is machine-wide, so a Leg\'s serial note signs one too, and a bounced note signs none.', '', L, 'the paragraph: not machine-wide')
  only('execute', 'Operator-only: no agent or script writes `test_logins`', 'An agent may write `test_logins`', L, 'the paragraph: not operator-only')
  only('execute', ', with no limit, no ledger, no month line and no Needs-you line:', ', against the limit:', L, 'the paragraph: a limit')
  const row = real.execute.split('\n').find((x) => x.startsWith('| `test_logins` |'))
  only('execute', row + '\n', '', L, '§ 3: no test_logins row')
  only('execfit', 'and a\n  declared test Login', 'and no\n  test Login', L, 'execution-fit: no test Login')
  only('snapshot', '`test_logins` (p37-4) is the first schema-5 key', '`test_logins` (p37-4) is a key', L, 'engine-snapshot.md: no schema-5 sentence')
  only('context', '- **Test Login** —', '- **Dummy Login** —', L, 'CONTEXT.md: no entry')
  only('context', '(a Test Login is machine-wide)', '(none is)', L, 'CONTEXT.md: Test credential entry')
  only('readme', 'It is\noperator-only: no skill or script writes it.', 'Any agent may write it.', L, 'README: not operator-only')
  // review round 1: step 1.2's Exit 3 and § 6.5 (a) name the test-Login asks, and § 3.7 names step 5 (nothing joined)
  only('execute', "a key missing from it, or a Login gate that names an undeclared Login or anything beside it, § 3.7's *A declared test Login*). Exit 1:",
    'or a key missing from it). Exit 1:', L, 'step 1.2: no test-Login asks')
  only('execute', "a key missing from it, or a Login gate that names an undeclared Login or anything beside it, § 3.7's *A declared test Login*) carries",
    'or a key missing from it) carries', L, '§ 6.5 (a): no test-Login asks')
  only('execute', 'nothing joined beside it (an `@` address, or a conjunction that joins a second thing', 'nothing beside it (a second thing', L,
    'the paragraph: no step 5')
})

test('control: each test-login-sweep pin, removed in one place, fails test-login-sweep alone', () => {
  const TLS = 'test-login-sweep'
  only('schedule', '**A declared test Login is recorded, never asked** (p37-4).', '**A declared test Login is asked ahead** (p37-4).', TLS, '§ 3.6: asked ahead')
  only('schedule', 'A credential hit whose `login.names` the sweep set', 'A credential hit whose context names a Login', TLS, '§ 3.6: not the sweep field')
  only('schedule', ' A hit inside the recorded test-Login Planner line is dismissed and listed as `swept, dismissed: [[task]] <word> (the recorded test-Login Planner line)`.', '', TLS, '§ 3.6: no sentence (a)')
  only('schedule', ' A task that already holds the test-Login Planner line is recorded, never asked.', '', TLS, '§ 3.6: no sentence (b)')
  only('schedule', ' The test Logins are machine-wide, so on § Serial path a declared test Login is recorded too: a Leg signs one.', '', TLS, '§ 3.6: no serial sentence')
  only('schedule', ' A credential hit on a `credential:` gate line naming a Login also carries its `login` reading (`{names, why}`)', ' It', TLS, '§ 3.6: no login field')
  only('schedule', 'A `gated_inputs: test_logins:` stderr line (exit 1) means they could not be read: those hits carry no `login` and keep the ask, and every note still printed.',
    'A `gated_inputs: test_logins:` stderr line is a broken sweep.', TLS, '§ 3.6: the stderr line a failure')
  only('schedule', '(not a test credential or test Login recorded below)', '(not a test credential recorded below)', TLS, '§ 3.6: Ask ahead holds the Login')
  only('schedule', '- For each credential hit § 3.6 recorded as a declared test Login, append', '- For each credential hit § 3.6 recorded as a declared test Login, skip', TLS, '§ 7: no bullet')
  const tl = real.schedule.split('\n').find((x) => x.startsWith('- Planner: word each test-Login gate'))
  const tc = real.schedule.split('\n').find((x) => x.startsWith('- Planner: word each test-credential gate'))
  only('schedule', tl + '\n', '', TLS, '§ 7: no test-Login Planner line')
  CONTROLLED.add(TLS)
  const moved = real.schedule.replace(tl + '\n', '').replace(tc, `${tl}\n${tc}`)
  assert.deepEqual(checkStanding({ ...real, schedule: moved }), [TLS], '§ 7: the test-Login line before the test-credential one')
  only('schedule', "§ 3.6's sweep reads it itself", '§ 3.6 asks it', TLS, '§ 2.8: no test_logins bullet')
  only('schedule', '; test Logins <name>, … (<source>), or none (built-in)', '', TLS, 'step 8: no Settings clause')
  only('schedule', '  - [[task-l]] — smells of a credential', '  - [[task-q]] — smells of a credential', TLS, 'step 8: no [[task-l]] line')
  only('schedule', ' or as a declared test Login,', ',', TLS, 'Under the chain 7: no test Login')
  only('schedule', " or a declared test Login's hit (the test-Login Planner line)", '', TLS, 'S6: no test-Login Planner line')
  only('schedule', ", which reads task notes and, only when a `credential:` gate line naming a Login needs the declaration,", ' (it reads task notes only), and', TLS, '§ Scope: task notes only')
  only('orientAll', ' or as a declared test Login (p37-4),', ',', TLS, 'orient-all 9: no test Login')
  only('orientAll', ' also gets its step 7 `## Decisions (recorded <date>)` Planner line.', ' also gets its step 7 line.', TLS, 'orient-all 9: no recorded section')
  only('backlog', span(real.backlog, ', or a credential hit § 3.6 records as a declared test Login (p37-4), the test-Login Planner line.'), '.', TLS, 'backlog 16: no test Login')
  only('reshuffle', span(real.reshuffle, 'is recorded, never grilled (p37-4)'), 'is grilled ahead (p37-4)', TLS, 'R3: grilled')
  only('reshuffle', span(real.reshuffle, 'A `gated_inputs: test_logins:` stderr line (exit 1) means the declared test Logins could not be read'),
    'a `gated_inputs: test_logins:` stderr line is a broken sweep. It means the declared test Logins could not be read', TLS, 'R3: the stderr line a broken sweep')
  only('reshuffle', span(real.reshuffle, 'A hit inside the recorded test-Login Planner line is dismissed'), 'A hit inside the recorded test-Login Planner line is asked', TLS, 'R3: no sentence (a)')
  only('reshuffle', span(real.reshuffle, 'A task that already holds the test-Login Planner line is recorded, never asked.'), 'A task that already holds the test-Login Planner line is asked again.', TLS, 'R3: no sentence (b)')
  // review round 2: a keeps-the-ask sentence before (b) reads as overridden by it
  assert.deepEqual(checkStanding(movedBefore('schedule', ' A hit with no `login`, or with `login.names` null, keeps the ask-ahead above; its why (a deny word, an undeclared Login, none declared) may be named in the batch.',
    'A hit inside the recorded test-Login Planner line')), [TLS], '§ 3.6: the keeps-the-ask sentence before (b)')
  assert.deepEqual(checkStanding(movedBefore('reshuffle', ' A hit with no `login`, or with `login.names` null, keeps the ask.',
    'A hit inside the recorded test-Login Planner line')), [TLS], 'R3: the keeps-the-ask sentence before (b)')
  assert.deepEqual(checkStanding(movedBefore('reshuffle', ' A `gated_inputs: test_logins:` stderr line (exit 1) means the declared test Logins could not be read: those hits carry no `login` and keep the ask; every note still printed.',
    'A hit inside the recorded test-Login Planner line')), [TLS], 'R3: the stderr sentence before (b)')
  only('reshuffle', 'for a credential recorded as a declared test Login, the test-Login\n     Planner line', 'for a credential recorded as a declared test Login, nothing, not the test-Login\n     Planner line', TLS, 'R5.2: no record')
  only('reshuffle', ' The sweep R3 (c) runs reads `[defaults] test_logins`', ' The sweep R3 (c) runs reads task notes only, not `[defaults] test_logins`', TLS, 'write surface: no settings read')
  only('asking', '- A credential gate naming only a declared test Login (`[defaults] test_logins`) is never asked ahead (p37-4): the standing approval signs it at the stop, or asks then.\n', '', TLS, 'asking.md: no bullet')
  only('grade', 'The sweep reads only the notes, and', 'The sweep reads the notes, git and', TLS, 'readiness-grade: no read clause')
  only('grade', ', never a sweep failure.', '.', TLS, 'readiness-grade: exit 1 a sweep failure')
  const i = real.settings.indexOf("gated_inputs.py's `sweep` CLI")
  const j = real.settings.indexOf('exit 1). ', i) + 'exit 1). '.length
  assert.ok(i >= 0 && j > i, 'control setup: the settings sentence')
  only('settings', real.settings.slice(i, j), '', TLS, 'rollout-settings.py: one reader only')
  only('context', 'Schedule\n  and orient record such a gate, never ask it ahead, on a serial chain too.', '', TLS, 'CONTEXT.md: no record sentence')
  only('readme', 'Schedule and orient\nrecord such a gate ahead and never ask it', 'Schedule and orient\nask such a gate ahead', TLS, 'README: asked ahead')
})

test('the rules are all named (19) and each has a control', () => {
  assert.equal(RULES.length, 19)
  assert.deepEqual(RULES.filter((r) => !CONTROLLED.has(r)), [])
})
