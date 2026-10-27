// p29-9 (ADR 0050): a red that a named re-run and one confirming full run clear is a Flake. The scripts and the engine
// are pinned by tests/lead-integrate.test.sh (C41-C53: the Flake check inside `lead-integrate.py verify --diff-base`;
// C54 with p29-10's --rollout suite record), tests/verify-slot-heat.test.sh (L8: a heat stop in its named re-run),
// skills/execute/tests/reconcile-rollout-flake.test.sh (record-verify, the row's `flakes`, the follow-ups),
// tests/schedule-queue.test.sh (Q6: schedule's `named_rerun:` stamp read back by verify-timeout, the Flake check run),
// skills/execute/tests/prompt-invariants.test.mjs (the agents' Flake check blocks), task-engine.test.mjs and
// integrate.test.mjs (the row's `flakes`). This file pins the prose a lead follows:
// - execute SKILL.md's verify line carries `--diff-base <mainSha>` and the single-quoted `--named-rerun '<named_rerun>'`,
//   and the RACE re-verify `--diff-base '<the merge commit>^1'` and the same `--named-rerun`;
// - step 3's verify route and the RACE procedure run `record-verify` only once their canary check exited 0, before
//   routing on the rc, and never after a non-zero check or its exit 4; a verify that wrote no `.flake.json` (`noslot`,
//   a failed `env_bootstrap`) is `nothing to record`, exit 0;
// - § 3 has a `named_rerun` row and the verify-timeout paragraph its `namedRerun` key and exit 2; § 6 lists `flakes` as
//   the row's last key and has a reconcile bullet for it, an integrate row reconciled with `--no-verdict` recording
//   none; a Don't forbids fixing a Flake inside a task;
// - the rollout template carries a commented `# named_rerun:` line beside `# touched:`, pointing at schedule step 2.5;
// - schedule step 2.5 reads the project CLAUDE.md's `Named re-run:` line by `_named_rerun`'s rules into the verifier's
//   confirm, step 6 stamps it quoted and reads it back with the lead's own `verify-timeout` right after the adopt, and
//   the Verification checklist names the line;
// - CONTEXT.md's **Flake** entry reads the diff by test file, the named re-run first, one follow-up per test and the
//   twice rule, and a **Named re-run** entry exists.
// One pure function, check(files), over { key: text }: the real files and the controls run through it, and each
// control mutates one real file in memory and must fail with exactly its rule. Reads files only.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { read, section, collapse } from '../lib/contract-text.mjs'

const FILES = {
  skill: 'skills/execute/SKILL.md',
  template: 'skills/schedule/rollout-template.md',
  context: 'CONTEXT.md',
  schedule: 'skills/schedule/SKILL.md',
}
const real = Object.fromEntries(Object.entries(FILES).map(([k, p]) => [k, read(p)]))

// The CONTEXT.md glossary entry that starts with `head`, up to the next entry, heading or blank line.
function entry(text, head) {
  const lines = (text ?? '').split('\n')
  const i = lines.findIndex((l) => l.startsWith(head))
  if (i < 0) return ''
  const out = [lines[i]]
  for (const l of lines.slice(i + 1)) {
    if (/^- \*\*|^#|^\s*$/.test(l)) break
    out.push(l)
  }
  return collapse(out.join('\n'))
}
const before = (hay, a, b) => hay.indexOf(a) >= 0 && hay.indexOf(b) >= 0 && hay.indexOf(a) < hay.indexOf(b)

function check(f) {
  const bad = []
  const need = (name, ok) => { if (!ok) bad.push(name) }
  const skill = f.skill
  const vline = (skill.match(/^# thread:integration-verify[^\n]*\n([^\n]*)\n# end thread:integration-verify/m) ?? [])[1] ?? ''
  const s45 = collapse(section(skill, /^### 4\.5\. /) ?? '')
  const race = s45.slice(s45.indexOf('**RACE procedure**'), s45.indexOf('5. **Completion.**'))
  const verifyRoute = s45.slice(s45.indexOf('- **`verify`** —'), s45.indexOf('- **`trouble`** —'))
  const s3 = collapse(section(skill, /^### 3\. /) ?? '')
  const s6 = collapse(section(skill, /^### 6\. /) ?? '')
  const donts = collapse(section(skill, /^## Don'ts/) ?? '')

  // the verify line and the RACE command
  need('verify-line', vline.includes("--verifier '<verifier>' --diff-base <mainSha> --named-rerun '<named_rerun>'"))
  need('race-line', race.includes("--verifier '<verifier>' --diff-base '<the merge commit>^1' --named-rerun '<named_rerun>'") &&
    race.includes('no `--named-rerun` when the entry\'s `verify-timeout` printed no `namedRerun`'))
  need('verify-prose', s45.includes('**The Flake check** (`--diff-base`, ADR 0050, p29-9)') && s45.includes('so `<out>.rc` is its verdict') &&
    s45.includes('`<out>.flake.json`') && s45.includes('and `--named-rerun \'<named_rerun>\'` when this entry\'s `verify-timeout` printed no `namedRerun`'))

  // record-verify after a check that exited 0, before routing on the rc
  const RV = 'reconcile-rollout.py record-verify --rollout <rollout-note> --tasks <slug> --site'
  need('step3-record', verifyRoute.includes('- Once the check exits 0, and before routing on the rc: `python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/' + RV +
    ' integration --from <repoPath>/.claude/integration/<slug>.flake.json || true`') &&
    before(verifyRoute, 'run the canary `check` first', RV) && before(verifyRoute, RV, 'green (rc 0) and no shared file'))
  need('race-record', race.includes('Otherwise, first `python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/' + RV +
    ' race --from <repoPath>/.claude/integration/race-<slug>.flake.json || true`') &&
    before(race, 'on a non-zero check append', RV) && before(race, RV, 'then green → `mark-done`') &&
    race.includes('red, rc 124 or a missing rc → the RACE revert'))
  need('run-record-bullet', s45.includes('- `record-verify --rollout <rollout-note> --tasks <slug> --site integration|race') &&
    s45.includes('Never after a non-zero check or its exit 4: that rc is never acted on.') &&
    s45.includes('A verify whose verifier never ran (`noslot`, a failed `env_bootstrap`) writes no `.flake.json`: `record-verify` then prints `nothing to record` and exits 0'))

  // § 3, § 6, Don'ts
  need('config-row', s3.includes('| `named_rerun` | none (omit): the lead\'s Flake check leaves a red red |') &&
    s3.includes('the line also carries `"namedRerun": <named_rerun>` after `verifySlot`') && s3.includes('A refused `named_rerun:` is exit 2 too'))
  need('row-shape', s6.includes('gatedInputs, plan, reviewVerdicts, flakes }] }') && s6.includes('and `flakes` (p29-9, ADR 0050) is every Flake'))
  need('reconcile-bullet', s6.includes("- any status's `flakes` (p29-9, ADR 0050) → each entry is logged") && s6.includes('never fix it in the task') &&
    s6.includes('An integrate row reconciled with `--no-verdict`') && s6.includes('records none of its `flakes`'))
  need('dont', donts.includes('- Never fix a Flake inside a task, at a task call, at Integration or after a RACE (ADR 0050)'))

  // the rollout template
  const tl = f.template.split('\n')
  const named = tl.findIndex((l) => l.startsWith('# named_rerun: "<cmd with {tests}>"'))
  const touched = tl.findIndex((l) => l.startsWith('# touched: '))
  need('template', named >= 0 && touched === named + 1 && tl[named].endsWith("`Named re-run:` command — thread:schedule step 2.5"))

  // schedule: step 2.5 reads it, step 6 stamps it and reads it back, the Verification checklist names it
  const sch = f.schedule
  const s25 = collapse(section(sch, /^### 2\.5\. /) ?? '')
  const s6s = collapse(section(sch, /^### 6\. /) ?? '')
  const ver = collapse(section(sch, /^## Verification/) ?? '')
  need('schedule-detect', s25.includes('**The named re-run (ADR 0050, p29-9).**') && s25.includes('a `Named re-run: \\`<cmd>\\`` line') &&
    s25.includes('print it beside the verifier') && s25.includes("`reconcile-rollout.py`'s `_named_rerun`") &&
    s25.includes('`{tests}` exactly once') && s25.includes('never stored') &&
    s25.includes('A `shape: serial` note never carries it: a Leg runs no Integration'))
  need('schedule-stamp', s6s.includes("- The `# named_rerun:` line — when step 2.5 stored the project's `Named re-run:`, replace the whole line") &&
    s6s.includes('`named_rerun: "<cmd>"`, on one line, always quoted'))
  const VT = 'reconcile-rollout.py verify-timeout --rollout ~/repos/obsidian/Work/Tasks/<this-slug>.md'
  need('schedule-check', s6s.includes('**Check the stamped commands.** Right after the adopt, before the carry') && s6s.includes(VT) &&
    s6s.includes('stops the run with its stderr, and the note keeps `incomplete: true`') &&
    before(s6s, 'engine-snapshot.py adopt --rollout', VT))
  need('schedule-checklist', ver.includes("a `named_rerun:` line, commented out unless step 2.5 stored the project's `Named re-run:`") &&
    ver.includes('prints as its `namedRerun`'))

  // CONTEXT.md
  const flake = entry(f.context, '- **Flake** —')
  const nr = entry(f.context, '- **Named re-run** —')
  need('context-flake', flake.includes('"Outside the diff" is read by test file') && flake.includes('The named re-run comes first') &&
    flake.includes('one follow-up per (repo, test); a test logged as a Flake twice is the repo\'s to fix'))
  need('context-named', nr.includes('`named_rerun:`') && nr.includes("the repo's own test runner"))
  return bad
}

test('the Flake rule (p29-9): the verify line, record-verify after the check, § 3, § 6, the Don\'t, the template, schedule, CONTEXT.md', () => {
  assert.deepEqual(check(real), [])
})

// Each control changes one real file in memory and must fail with exactly its rule.
function only(files, rule, label) {
  assert.deepEqual(check(files), [rule], label)
}
const sk = (from, to) => {
  assert.ok(real.skill.includes(from), `control anchor present: ${from.slice(0, 60)}`)
  return { ...real, skill: real.skill.replace(from, to) }
}
const sch = (from, to) => {
  assert.ok(real.schedule.includes(from), `control anchor present: ${from.slice(0, 60)}`)
  return { ...real, schedule: real.schedule.replace(from, to) }
}

test('control: a verify line without --diff-base fails verify-line', () => {
  only(sk("--verifier '<verifier>' --diff-base <mainSha> --named-rerun '<named_rerun>'\n", "--verifier '<verifier>'\n"), 'verify-line', 'no diff base')
})

test('control: a double-quoted --named-rerun fails verify-line', () => {
  only(sk("--diff-base <mainSha> --named-rerun '<named_rerun>'\n", '--diff-base <mainSha> --named-rerun "<named_rerun>"\n'), 'verify-line', 'dq named')
})

test('control: a RACE re-verify without its diff base fails race-line', () => {
  only(sk(" --diff-base '<the merge commit>^1'", ''), 'race-line', 'no race diff base')
})

test('control: step 3 without its record-verify bullet fails step3-record', () => {
  const RVL = "     - Once the check exits 0, and before routing on the rc: `python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/reconcile-rollout.py record-verify --rollout <rollout-note> --tasks <slug> --site integration --from <repoPath>/.claude/integration/<slug>.flake.json || true`"
  const line = real.skill.split('\n').find((l) => l.startsWith(RVL))
  assert.ok(line, 'the record-verify bullet')
  only(sk(line + '\n', ''), 'step3-record', 'dropped')
})

test('control: the RACE recording only after mark-done fails race-record', () => {
  only(sk('Otherwise, first `python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/reconcile-rollout.py record-verify --rollout <rollout-note> --tasks <slug> --site race',
    'Otherwise, `python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/reconcile-rollout.py record-verify --rollout <rollout-note> --tasks <slug> --site race'), 'race-record', 'no first')
})

test('control: a Run record bullet that records after any check fails run-record-bullet', () => {
  only(sk('Never after a non-zero check or its exit 4: that rc is never acted on.', 'Whatever the check said.'), 'run-record-bullet', 'any check')
})

test('control: § 3 without the named_rerun row fails config-row', () => {
  const row = real.skill.split('\n').find((l) => l.startsWith('| `named_rerun` |'))
  only(sk(row + '\n', ''), 'config-row', 'no row')
})

test('control: § 6 with reviewVerdicts last fails row-shape', () => {
  only(sk('gatedInputs, plan, reviewVerdicts, flakes }] }', 'gatedInputs, plan, reviewVerdicts }] }'), 'row-shape', 'old shape')
})

test('control: record-verify erroring on a verify that wrote no file fails run-record-bullet', () => {
  only(sk('`record-verify` then prints `nothing to record` and exits 0', '`record-verify` then exits 1'), 'run-record-bullet', 'missing is an error')
})

test('control: § 6 recording a --no-verdict integrate row\'s flakes fails reconcile-bullet', () => {
  only(sk('records none of its `flakes`', 'records its `flakes` as usual'), 'reconcile-bullet', 'void flakes recorded')
})

test('control: § 6 without the flakes bullet fails reconcile-bullet', () => {
  const b = real.skill.split('\n').find((l) => l.startsWith("- any status's `flakes` (p29-9, ADR 0050)"))
  only(sk(b + '\n', ''), 'reconcile-bullet', 'no bullet')
})

test('control: no Flake Don\'t fails dont', () => {
  only(sk('- Never fix a Flake inside a task, at a task call, at Integration or after a RACE (ADR 0050)', '- Fix a Flake where you find it'), 'dont', 'fix it')
})

test('control: a template without # named_rerun: fails template', () => {
  const l = real.template.split('\n').find((x) => x.startsWith('# named_rerun: '))
  only({ ...real, template: real.template.replace(l + '\n', '') }, 'template', 'no line')
})

test('control: a template line that never points at schedule fails template', () => {
  only({ ...real, template: real.template.replace(". Uncomment with the project CLAUDE.md's `Named re-run:` command — thread:schedule step 2.5", '') },
    'template', 'set by hand')
})

test('control: schedule step 2.5 without the named re-run paragraph fails schedule-detect', () => {
  const para = real.schedule.split('\n').find((l) => l.startsWith('**The named re-run (ADR 0050, p29-9).**'))
  assert.ok(para, 'the paragraph')
  only(sch(para + '\n', ''), 'schedule-detect', 'dropped')
  only(sch(' with why and never stored: the run goes on', ' with why and stored anyway: the run goes on'), 'schedule-detect', 'a refused line stored')
})

test('control: schedule step 6 without the named_rerun bullet fails schedule-stamp', () => {
  const b = real.schedule.split('\n').find((l) => l.startsWith('- The `# named_rerun:` line — '))
  assert.ok(b, 'the bullet')
  only(sch(b + '\n', ''), 'schedule-stamp', 'dropped')
})

test('control: schedule step 6 without the read-back, or with it before the adopt, fails schedule-check', () => {
  const para = real.schedule.split('\n').find((l) => l.startsWith('**Check the stamped commands.**'))
  assert.ok(para, 'the paragraph')
  only(sch(para + '\n', ''), 'schedule-check', 'dropped')
  const adopt = real.schedule.split('\n').find((l) => l.startsWith('**Stamp the Engine snapshot (ADR 0043).**'))
  assert.ok(adopt, 'the adopt paragraph')
  only(sch(adopt + '\n\n' + para + '\n', para + '\n\n' + adopt + '\n'), 'schedule-check', 'before the adopt')
})

test('control: a Verification checklist that never names named_rerun fails schedule-checklist', () => {
  only(sch(", and a `named_rerun:` line, commented out unless step 2.5 stored the project's `Named re-run:`", ''), 'schedule-checklist', 'not named')
})

test('control: CONTEXT.md without the Named re-run entry, or a Flake read by test name, fails its rule', () => {
  const ctx = real.context
  const start = ctx.indexOf('- **Named re-run** —')
  const end = ctx.indexOf('\n- **', start + 1)
  only({ ...real, context: ctx.slice(0, start) + ctx.slice(end + 1) }, 'context-named', 'no entry')
  only({ ...real, context: ctx.replace('"Outside the diff" is read by test file', '"Outside the diff" is read by test name') }, 'context-flake', 'by name')
})
