// Start when ready (p23-6): the execute offer's fourth answer stamps `start: unattended` on the rollout note
// just written and ends; the Chorus Stage starts the lead once the note is runnable, and that lead's first
// `reconcile-rollout.py next` clears the stamp (skills/_shared/vault-grammar.md § Rollout start stamp; the
// script half is pinned by skills/execute/tests/reconcile-rollout-queue.test.sh, orient § 9's answer by
// orient-reshuffle.test.mjs). This file pins the prose around it, one named check per rule:
//   - schedule step 8 prints a `start when ready` line in its To execute block and has a **Start when ready.**
//     paragraph that stamps `start: unattended` and leaves orient § 9 to ask under orient;
//   - schedule's **Supersede prep** removes a prior's `start: unattended` before step 1, step 1's confirm names
//     the clear, and its **Put back** restores the exact line when the run stops before step 6 writes its note
//     (the Don'ts allow that one write);
//   - the rollout template's How to execute names the stamp, and carries no frontmatter line for it;
//   - execute § 1 says § 4.5 step 1's `next` clears it (`startCleared`) and any halt before that `next` leaves it;
//   - status's Don'ts give the stamp's clear as a reason `next` is a writer;
//   - status § 1 reads the stamp straight from the frontmatter (its **Start stamp**), and action 13 reports a
//     stamped note nothing has started as waiting for the Chorus Stage, naming `/thread:execute` only by hand;
//   - CONTEXT.md has a **Start when ready** entry naming the stamp;
//   - the vault grammar's Readers and that entry say the Stage starts the lead in the rollout clone (ADR 0042).
// check(files) returns the names of the failed rules; every rule has a mutation control below, so none is
// vacuous. Reads files only.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { collapse, read, section } from '../lib/contract-text.mjs'

const STAMP = '`start: unattended`'

const real = {
  schedule: read('skills/schedule/SKILL.md'),
  template: read('skills/schedule/rollout-template.md'),
  execute: read('skills/execute/SKILL.md'),
  status: read('skills/status/SKILL.md'),
  context: read('CONTEXT.md'),
  grammar: read('skills/_shared/vault-grammar.md'),
}

// The blank-line paragraph of `text` that starts with `label`, collapsed; '' when absent.
const para = (text, label) => collapse(text.split(/\n\s*\n/).find((p) => p.trimStart().startsWith(label)) ?? '')
// The frontmatter of the template's fenced note (the first `---` block), '' when absent.
const frontmatter = (text) => text.match(/^---\n([\s\S]*?)\n---\n/m)?.[1] ?? ''

function check(f) {
  const out = []
  const s8 = section(f.schedule, /^### 8\. Print summary/) ?? ''
  const toExecute = s8.split('\n').find((l) => /^\s+start when ready\s+#/.test(l)) ?? ''
  if (!toExecute.includes('start: unattended') || !toExecute.includes('Chorus Stage')) out.push('schedule step 8 line')
  const swr = para(s8, '**Start when ready.**')
  if (!swr.includes(`stamp ${STAMP}`) || !swr.includes('orient § 9') || !swr.includes('nothing runs')) {
    out.push('schedule step 8 paragraph')
  }
  const prep = para(f.schedule, '**Supersede prep.**')
  if (!/carries `start: unattended`.*?remove that line before step 1/.test(prep)) out.push('supersede prep clears')
  if (!/\*\*Put back\.\*\* A run that stops before step 6 writes its note .*?puts that exact line back/.test(prep)
    || !prep.includes('`restored [[<prior>]]')) out.push('supersede prep puts back')
  const s1Confirm = collapse(section(f.schedule, /^### 1\. Discover tasks/) ?? '')
  if (!s1Confirm.includes("`cleared [[<prior>]]'s start when ready` line")) out.push('step 1 confirm names the clear')
  const dont = collapse(f.schedule.split('\n').find((l) => l.startsWith('- Never write `start: unattended`')) ?? '')
  if (!dont.includes("§ 0's **Put back**")) out.push("schedule don'ts put back")
  const how = collapse(section(f.template, /^## How to execute$/) ?? '')
  if (!how.includes(`*Start when ready*: ${STAMP}`) || !how.includes('`next` clears it')) out.push('template how to execute')
  if (/^start:/m.test(frontmatter(f.template))) out.push('template frontmatter stamp')
  const s1 = collapse(section(f.execute, /^### 1\. Read the rollout note/) ?? '')
  if (!s1.includes(STAMP) || !s1.includes('`next` removes it (`startCleared: true`)')
    || !s1.includes('Any halt before that `next` leaves it for the Stage')) out.push('execute § 1')
  const donts = collapse(section(f.status, /^## Don'ts/) ?? '')
  if (!/`reconcile-rollout\.py next` \([^)]*clears a `start: unattended` stamp\)/.test(donts)) out.push("status don'ts")
  const stStamp = para(section(f.status, /^### 1\. Resolve the rollout note/) ?? '', '**Start stamp.**')
  if (!stStamp.includes('§ Rollout start stamp') || !stStamp.includes('`unattended` is the stamp')) {
    out.push('status start stamp read')
  }
  const s4 = section(f.status, /^### 4\. Render the situational report/) ?? ''
  const a13 = collapse(s4.split(/\n(?=\d+\. )/).find((l) => l.startsWith('13. '))?.split(/\n\s*\n/)[0] ?? '')
  if (!a13.includes("§ 1's **Start stamp**") || !a13.includes('waiting for the Chorus Stage (Start when ready)')
    || !a13.includes('`/thread:execute [[<rollout>]]` only as the way to start it by hand now')) {
    out.push('status action 13')
  }
  const entry = collapse(f.context.split('\n- ').find((e) => e.startsWith('**Start when ready**')) ?? '')
  if (!entry.includes(STAMP) || !entry.includes('Chorus Stage') || !entry.includes('`next`') ||
    !entry.includes("note's Project root, the **Rollout clone** (ADR 0042)")) out.push('context entry')
  // ADR 0042: the Stage starts the lead in the rollout clone, the Project root, so its launch passes execute § 2.8.
  const readers = collapse((section(f.grammar, /^## Rollout start stamp/) ?? '').split('\n- ').find((b) => b.startsWith('**Readers**')) ?? '')
  if (!readers.includes("in the note's Project root, the rollout clone for every rollout scheduled after P26 (ADR 0042)") ||
    !readers.includes('execute § 2.8')) out.push('stage starts in the clone')
  return out
}

// A control's copy of `real` with `from` replaced by `to` in `file`, asserting the replacement happened.
function mutate(file, from, to) {
  const text = real[file].replace(from, to)
  assert.notEqual(text, real[file], `control is vacuous: ${from} not found in ${file}`)
  return { ...real, [file]: text }
}

test('Start when ready: schedule, the template, execute, status and CONTEXT.md carry the stamp', () => {
  assert.deepEqual(check(real), [])
})

test('controls: each rule fails on its own known-bad shape', () => {
  const cases = [
    ['schedule step 8 line', mutate('schedule', /^\s+start when ready\s+#.*\n/m, '')],
    ['schedule step 8 paragraph', mutate('schedule', "because orient § 9's offer asks it", 'because the offer asks it')],
    ['supersede prep clears', mutate('schedule', 'remove that line before step 1', 'leave that line')],
    ['supersede prep puts back', mutate('schedule', 'puts that exact line back', 'leaves the prior')],
    ['step 1 confirm names the clear', mutate('schedule', "§ 0's `cleared [[<prior>]]'s start when ready` line when the Supersede prep removed one, ", '')],
    ["schedule don'ts put back", mutate('schedule', "or as § 0's **Put back**", 'or never')],
    ['template how to execute', mutate('template', '*Start when ready*: `start: unattended`', '*Start when ready*')],
    ['template frontmatter stamp', mutate('template', /^status: open$/m, 'status: open\nstart: unattended')],
    ['execute § 1', mutate('execute', '`next` removes it (`startCleared: true`)', '`next` reads it')],
    ['execute § 1', mutate('execute', 'Any halt before that `next` leaves it for the Stage', 'A halt at §§ 2–2.7 leaves it for the Stage')],
    ["status don'ts", mutate('status', 'and clears a\n  `start: unattended` stamp)', ')')],
    ['status start stamp read', mutate('status', '`unattended` is the stamp (*Start when ready*)', '`unattended` reads as set')],
    ['status action 13', mutate('status', /13\. Nothing started → `\/thread:execute \[\[<rollout>\]\]` to start\.[^]*?as Not yet does\./,
      '13. Nothing started → `/thread:execute [[<rollout>]]` to start.')],
    ['status action 13', mutate('status', 'only as the way to start it by hand now', 'to start it')],
    ['context entry', mutate('context', '- **Start when ready**', '- **Unattended start**')],
    ['stage starts in the clone', mutate('grammar', 'so its launch passes execute § 2.8', 'so it starts')],
    ['context entry', mutate('context', "note's Project root, the **Rollout clone** (ADR 0042)", "note's Project root")],
  ]
  for (const [want, files] of cases) assert.deepEqual(check(files), [want], `control ${want}`)
})
