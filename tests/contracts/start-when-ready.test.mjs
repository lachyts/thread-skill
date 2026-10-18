// Start when ready (p23-6): the execute offer's fourth answer stamps `start: unattended` on the rollout note
// just written and ends; the Chorus Stage starts the lead once the note is runnable, and that lead's first
// `reconcile-rollout.py next` clears the stamp (skills/_shared/vault-grammar.md § Rollout start stamp; the
// script half is pinned by skills/execute/tests/reconcile-rollout-queue.test.sh, orient § 9's answer by
// orient-reshuffle.test.mjs). This file pins the prose around it, one named check per rule:
//   - schedule step 8 prints a `start when ready` line in its To execute block and has a **Start when ready.**
//     paragraph that stamps `start: unattended` and leaves orient § 9 to ask under orient;
//   - schedule's **Supersede prep** removes a prior's `start: unattended` before step 1;
//   - the rollout template's How to execute names the stamp, and carries no frontmatter line for it;
//   - execute § 1 says § 4.5 step 1's `next` clears it (`startCleared`);
//   - status's Don'ts give the stamp's clear as a reason `next` is a writer;
//   - CONTEXT.md has a **Start when ready** entry naming the stamp.
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
  const how = collapse(section(f.template, /^## How to execute$/) ?? '')
  if (!how.includes(`*Start when ready*: ${STAMP}`) || !how.includes('`next` clears it')) out.push('template how to execute')
  if (/^start:/m.test(frontmatter(f.template))) out.push('template frontmatter stamp')
  const s1 = collapse(section(f.execute, /^### 1\. Read the rollout note/) ?? '')
  if (!s1.includes(STAMP) || !s1.includes('`next` removes it (`startCleared: true`)')) out.push('execute § 1')
  const donts = collapse(section(f.status, /^## Don'ts/) ?? '')
  if (!/`reconcile-rollout\.py next` \([^)]*clears a `start: unattended` stamp\)/.test(donts)) out.push("status don'ts")
  const entry = collapse(f.context.split('\n- ').find((e) => e.startsWith('**Start when ready**')) ?? '')
  if (!entry.includes(STAMP) || !entry.includes('Chorus Stage') || !entry.includes('`next`')) out.push('context entry')
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
    ['template how to execute', mutate('template', '*Start when ready*: `start: unattended`', '*Start when ready*')],
    ['template frontmatter stamp', mutate('template', /^status: open$/m, 'status: open\nstart: unattended')],
    ['execute § 1', mutate('execute', '`next` removes it (`startCleared: true`)', '`next` reads it')],
    ["status don'ts", mutate('status', 'and clears a\n  `start: unattended` stamp)', ')')],
    ['context entry', mutate('context', '- **Start when ready**', '- **Unattended start**')],
  ]
  for (const [want, files] of cases) assert.deepEqual(check(files), [want], `control ${want}`)
})
