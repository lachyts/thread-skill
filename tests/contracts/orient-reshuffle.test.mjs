// Orient-reshuffle contracts (ADR 0027): the reshape step orient runs, carrying the retired split and
// gather verbs' machinery, and the routing around it. The checks pin contract tokens (flags, statuses,
// file names, section order) rather than sentences, so a rewording that keeps the contract passes.
// Reads files only.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assertHas, collapse, fencedBlocks, read, section, slice, walk } from '../lib/contract-text.mjs'

const reshuffle = read('skills/orient/reshuffle.md')
const orient = read('skills/orient/SKILL.md')
const grammar = read('skills/_shared/vault-grammar.md')
const R = (n) => collapse(section(reshuffle, new RegExp(`^## R${n}\\.`)) ?? '')
const S = (n) => collapse(section(orient, new RegExp(`^### ${n}\\.`)) ?? '')
const donts = collapse(section(reshuffle, /^## Don'ts/) ?? '')

test('the reshape step carries no inline task template and defers to the writer specs', () => {
  const templated = fencedBlocks(reshuffle).filter((b) => /^status: open$/m.test(b.join('\n')))
  assert.equal(templated.length, 0, 'a fenced block in reshuffle.md spells out task frontmatter')
  assertHas(R(5), 'R5', ['add-task.md', 'Step 4', 'Launch context', 'add-phase.md', 'add-project.md',
    'phase: N', 'touches:', 'work_depth:', 'Phase N · Task M', '**Verify:**', 'Resume prompt',
    /Don't set `rollout:` or `scope:`/])
  assertHas(donts, "reshuffle Don'ts", ['add-task.md', 'add-phase.md', 'add-project.md'])
})

test('phases number from N_max + 1, never from phase 0, and ordinals are never reused', () => {
  const c = collapse(reshuffle)
  assert.doesNotMatch(c, /=\s*phase\s+0\b/i)
  assert.doesNotMatch(c, /phase-0\s+tasks/i)
  assertHas(c, 'reshuffle.md', ['N_max + 1', 'states phases', '`p3.5` → P4', /never reused/])
  assert.deepEqual([...c.matchAll(/continu\w*\s+from\s+`?N_max`?(?!\s*\+)/g)].map((m) => m[0]), [])
})

test('in flight is defined once, in the vault grammar, with TaskNotes spelling', () => {
  const inFlight = collapse(section(grammar, /^## In flight$/) ?? '')
  assertHas(inFlight, 'vault-grammar.md § In flight', ['`status: in-progress`', '`in_progress`', '`review`', '**Live rollout**'])
  // ADR 0040 retired orient's batches: a `dispatched:` stamp no longer puts a task in flight.
  assert.doesNotMatch(inFlight, /`dispatched:`/, 'vault-grammar.md § In flight still reads the retired stamp')
  assertHas(S(2), 'orient § 2', ['_shared/vault-grammar.md` § In flight', /never route it again/, /never reshuffle it/])
  assert.doesNotMatch(S(2), /`dispatched:` stamp/, 'orient § 2 restates the in-flight definition')
  assertHas(R(1), 'R1', [/vault grammar's definition/, /never change/, /AMBIGUOUS/, /`thread`-tagged/,
    /contains `task` but not `thread`/, '`-p<N>-`'])
  // What orient § 4's bound apply left open (landed since the review, or withheld) is frozen with AMBIGUOUS:
  // the § 2 sweep predates the apply, so without this R1 could re-phase, drop or schedule finished work.
  assertHas(R(1), 'R1', [/Possibly landed — frozen too\.[^-]*AMBIGUOUS[^-]*`New since review`[^-]*`Reviewed, not applied`[^-]*never moved, restamped, dropped or scheduled/])
  assertHas(S(4), 'orient § 4', [/`New since review`[^.]*`Reviewed, not applied`[^.]*\. [^.]*join the reshuffle's frozen possibly-landed tier/])
  assert.doesNotMatch(R(1), /`status: in-progress`/, 'R1 restates the in-flight definition')
})

test('the grill is invoked by name and can stop at any point', () => {
  assertHas(R(3), 'R3', ['`grill-with-docs`', '`grill-me`', /stop at any point/, /Clear items are not grilled/])
})

test('backlinks: one pass, alias and heading forms, cache dirs excluded, out-of-vault links reported', () => {
  assertHas(R(5), 'R5.3', ['/usr/bin/grep -rlF -f', '`.git`', '`.obsidian`', '`.smart-env`', '`.trash`',
    '`]]`, `|`, `\\|` or `#`', /vault only/, /listed in the report/])
})

test('orient runs drift dry, reports it, and applies it on a default or --steer run, never --look', () => {
  assertHas(S(2), 'orient § 2', ['reconcile-project.py --project <slug> --json', /dry run/, /mktemp -d/,
    '`<dir>/<slug>.json`', /§ 4 binds the apply to that file/])
  assertHas(S(3), 'orient § 3', ['**Drift**'])
  assertHas(S(4), 'orient § 4', [/--apply --only <that project's saved dry-run file>/, /New since review/,
    /Reviewed, not applied/, /now\s+ambiguous/, /no longer drift/,
    /Ambiguous items are listed for Lachy and never applied/,
    /A default run and Steer only authorise them/, /the § 3 Drift line is the notice/, /`--look` applies none/,
    /scoped target applies no drift fixes/])
})

// A scoped target applies no drift fixes (§ 4), so its Drift line is report-only: § 3 must not tell the model
// to announce fixes for it, and CONTEXT.md's Drift entry must not say every non-look run fixes drift.
test('the Drift line is the notice only when fixes follow; a scoped target is report-only', () => {
  const s3 = S(3)
  const drift = s3.slice(s3.indexOf('**Drift**'), s3.indexOf('**Shape**'))
  assertHas(drift, 'orient § 3 Drift bullet', [/unless `--look` or a scoped target \(report-only then\)/,
    /notice[^.]*only when fixes will follow/, /scoped target, say it is report-only/])
  const entry = collapse(slice(read('CONTEXT.md'), /^- \*\*Drift\*\* —/, /^- \*\*/) ?? '')
  assertHas(entry, 'CONTEXT.md Drift entry', [/never a look-only one or a scoped target/])
  assert.doesNotMatch(entry, /any run but a look-only one(?! or a scoped target)/,
    'CONTEXT.md says drift is fixed on any run but a look-only one, scoped targets included')
})

// Every ADR whose ADR 0027 amendment still describes the three-way question carries ADR 0036's amendment
// beside it, so no ADR header reads as if orient still asks.
test('every ADR amended for the three-way question also carries ADR 0036\'s amendment', () => {
  const asked = /Amended by ADR 0027[^)]*(Reshuffle, Steer only or Look only|a Reshuffle or Steer only answer)/
  const hits = walk('docs/adr').filter((f) => f.endsWith('.md'))
    .map((file) => ({ file, head: collapse(slice(read(file), /^# /, /^## /) ?? '') }))
    .filter(({ head }) => asked.test(head))
  assert.deepEqual(hits.map((h) => h.file).sort(),
    ['docs/adr/0003-orient-is-project-altitude-next.md', 'docs/adr/0026-finished-work-closes-itself.md'])
  for (const { file, head } of hits) assert.match(head, /Amended by ADR 0036, 2026-10-14/, `${file} lacks ADR 0036's amendment`)
})

// ADR 0036 d5: Reshuffle is the default, not a question. § 4 asks nothing; `--steer` and `--look` (or the
// words in the arguments) are the opt-outs, an empty shape goes straight to steering, and `--look` writes nothing.
test('orient reshuffles by default; --steer and --look opt out, and Look only writes nothing', () => {
  const s4 = S(4)
  assert.doesNotMatch(s4, /AskUserQuestion/, 'orient § 4 still asks Reshuffle / Steer only / Look only')
  assertHas(s4, 'orient § 4', [/no question/i, /straight into the reshuffle \(§ 5\)/,
    /\*\*Steer only\*\* \(`--steer`, or "steer only" in the arguments\)[^.]*§ 6/,
    /\*\*Look only\*\* \(`--look`, or "look only" in the arguments\)[^.]*stop after § 3[^.]*no writes of any kind/,
    /\*\*An empty shape\*\*[^.]*nothing loose, unclear or unphased[^.]*no pull-ins[^.]*§ 6's steering/])
  const forms = section(orient, /^## Invocation forms/) ?? ''
  assertHas(forms, 'orient § Invocation forms', [/--steer\s+# /, /--look\s+# /])
  assert.doesNotMatch(forms, /Reshuffle \/ Steer only \/ Look only/, 'the invocation forms still offer the three-way question')
  // § 1 strips the opt-outs before the resolver sees the argument; `--debrief` stops before it (§ 10, ADR 0040).
  assertHas(S(1), 'orient § 1', [/orient's own flags \(`--steer`, `--look`/])
})

// The three-way question is gone from every surface Lachy or the model reads; only the flag wording stays.
test('no surface still offers Reshuffle / Steer only / Look only as a question', () => {
  const surfaces = { 'skills/orient/SKILL.md': orient, 'skills/orient/reshuffle.md': reshuffle, 'README.md': read('README.md'),
    'CONTEXT.md': read('CONTEXT.md') }
  for (const [file, text] of Object.entries(surfaces)) {
    const c = collapse(text)
    assert.doesNotMatch(c, /Steer only or Look only/, `${file} still offers the three-way question`)
    assert.doesNotMatch(c, /Reshuffle \/ Steer only/, `${file} still offers the three-way question`)
    assert.doesNotMatch(c, /picks \*\*Reshuffle\*\*|a Reshuffle or Steer only answer|or \*\*Look only\*\*\./, `${file} still treats Reshuffle as an answer`)
  }
})

test('orient schedules only parallel-shaped members and never runs another rollout', () => {
  assertHas(S(6), 'orient § 6', ['--tasks', '--regenerate', /At most one unfinished rollout per repo/,
    'unfinished-rollout check', /scoped target routes only the tasks its own reshuffle wrote/,
    /schedule nothing and touch nothing/, 'repair', /Uncommitted grill docs/])
  assert.doesNotMatch(collapse(orient), /pause_requested/, 'orient pauses rollouts')
  assert.ok(S(6).indexOf('**The slot write**') > S(6).indexOf('**Hands-on**'), 'the slot write precedes the steering answer')
})

// The sentence of § 6 that names schedule's SKILL.md must pass `--regenerate` and `--tasks` in one backtick
// span: superseding is orient's policy, and a `--regenerate` elsewhere in § 6 would pass a bare token check
// while orient called schedule without it (schedule § 0's check then refuses every supersede).
function scheduleCall(s6) {
  const sentence = s6.split(/(?<=[.!?])\s+/).find((x) => x.includes('skills/schedule/SKILL.md'))
  if (!sentence) return false
  return [...sentence.matchAll(/`([^`]+)`/g)].some((m) => m[1].includes('--regenerate') && m[1].includes('--tasks'))
}

// Schedule § 0 names one exception to "stop before step 1, nothing written": a `file` move or an
// `interrupted` finish made before a later refusal stays (the finish re-points task notes and closes out
// the prior rollout). Orient's stop branch must mirror it, not claim nothing was written.
test('orient\'s § 0-stop branch mirrors schedule\'s file/interrupted exception', () => {
  const stop = S(6).slice(S(6).indexOf('**Schedule stopped at § 0**'), S(6).indexOf('**Uncommitted grill docs.**'))
  assertHas(stop, 'orient § 6 stop branch', [/`file` move or an `interrupted` finish/, /re-points task notes/,
    /reports any such finish/])
  assert.doesNotMatch(stop, /wrote no note\b/, 'orient § 6 says schedule wrote no note at all')
})

test('orient calls schedule with --regenerate --tasks in the same span', () => {
  assert.ok(scheduleCall(S(6)), 'orient § 6 does not call schedule with `--regenerate --tasks <members>`')
})

test('control: --regenerate only in a later sentence fails scheduleCall', () => {
  const s6 = 'Run `${CLAUDE_PLUGIN_ROOT}/skills/schedule/SKILL.md` with `--tasks <members>`, naming the members. ' +
    'Pass `--regenerate` when superseding.'
  assert.equal(scheduleCall(s6), false)
  assert.equal(scheduleCall(s6.replace('`--tasks <members>`', '`--regenerate --tasks <members>`')), true)
})

// The Start when ready answer of § 9 (p23-6), collapsed: from its bold label to the next answer or the end of the
// list; null when absent.
const startWhenReady = (s9) => s9.match(/- \*\*Start when ready\*\*(.*?)(?= - \*\*|Execute's own runtime gate|$)/)?.[1] ?? null

test('the execute offer has four answers and never homes a commit on the target default branch', () => {
  assertHas(S(9), 'orient § 9', ['**Fresh session**', '**Here**', '**Not yet**', '**Start when ready**',
    /`start: unattended`/, /default-branch/])
})

test('the execute offer starts the lead in the Project root, the rollout clone (ADR 0042), and § 2 skips clone threads', () => {
  const s9 = S(9)
  assertHas(s9, 'orient § 9', ['Project root', '**Rollout launch.**', '--launch-check', 'start in the Project root, then `/thread:execute [[<rollout>]]`',
    'handoff-home.sh reads a rollout clone as its in-place twin'])
  assert.ok(!s9.includes('start in the target repo'), 'orient § 9 no longer says start in the target repo')
  assert.ok(!s9.includes('launched in the target repo'), 'orient § 9 Here no longer keys on the target repo')
  const threads = collapse(slice(section(orient, /^### 2\./) ?? '', /^- \*\*Threads\*\*/, /^- /) ?? '')
  assertHas(threads, 'orient § 2 Threads', ['--in-place', "read its in-place twin's file instead", 'never a thread'])
})

test('Start when ready stamps the note and runs neither execute nor handoff', () => {
  const answer = startWhenReady(S(9))
  assertHas(answer, 'orient § 9 Start when ready', [/stamp `start: unattended`/, /nothing runs/, /no handoff/,
    /Chorus Stage/, /`\/thread:execute \[\[<rollout>\]\]`/])
  for (const run of ['execute/SKILL.md', 'handoff/SKILL.md']) {
    assert.ok(!answer.includes(run), `the Start when ready answer runs ${run}`)
  }
  // control: an answer that runs execute fails the check
  const ran = S(9).replace('then end: nothing runs here', 'then run `${CLAUDE_PLUGIN_ROOT}/skills/execute/SKILL.md`; nothing runs here')
  assert.notEqual(ran, S(9), 'control is vacuous: the answer text moved')
  assert.ok(startWhenReady(ran).includes('execute/SKILL.md'), 'control: the mutated answer names execute')
})
