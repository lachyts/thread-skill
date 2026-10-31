// p34-3 (ADR 0060): `lead-integrate.py verify --diff-base REV` names REV, resolved to its sha, to every step it runs as
// THREAD_VERIFY_BASE, so a fast tier's reach reads the task's diff even after merge-task refreshed origin/<default> (the
// RACE re-verify). The script is pinned by tests/lead-integrate.test.sh C57. This file pins the prose a lead and a
// project author follow:
// - execute SKILL.md § 4.5 names THREAD_VERIFY_BASE in *The Flake check* paragraph (*The verify base*), with the
//   unresolvable base's case (left unset, a WARN), and in the RACE procedure, with `<the merge commit>^1`;
// - schedule SKILL.md's completion verifier paragraph tells project authors to read it;
// - CONTEXT.md has a **Verify base** entry;
// - docs/adr/0060 exists;
// - tests/run.sh unsets it at top level, so an inner suite never inherits the outer verify's base.
// One pure function, check(files), over { key: text }: the real files and the controls run through it, and each
// control mutates one real file in memory and must fail with exactly its rule. Reads files only.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { read, readIf, section, collapse } from '../lib/contract-text.mjs'

const VAR = 'THREAD_VERIFY_BASE'
const FILES = {
  skill: 'skills/execute/SKILL.md',
  schedule: 'skills/schedule/SKILL.md',
  context: 'CONTEXT.md',
  run: 'tests/run.sh',
}
const ADR = 'docs/adr/0060-verify-names-its-diff-base.md'
const real = { ...Object.fromEntries(Object.entries(FILES).map(([k, p]) => [k, read(p)])), adr: readIf(ADR) }

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

function check(f) {
  const bad = []
  const need = (name, ok) => { if (!ok) bad.push(name) }
  const s45 = collapse(section(f.skill, /^### 4\.5\. /) ?? '')
  const flake = s45.slice(s45.indexOf('**The Flake check** (`--diff-base`'), s45.indexOf('**Verify slots'))
  const race = s45.slice(s45.indexOf('**RACE procedure**'), s45.indexOf('5. **Completion.**'))
  need('skill-verify', flake.includes('**The verify base** (ADR 0060') && flake.includes(`sees \`${VAR}\`, the diff base's sha`) &&
    flake.includes('a verify without `--diff-base` (the completion verify) never sets it') &&
    flake.includes('A `--diff-base` that does not resolve in the tree leaves it unset too, with one `verify: WARN'))
  need('skill-race', race.includes(`The re-verify's steps see \`${VAR}=<the merge commit>^1\``) &&
    race.includes('`origin/<default>` never moves for it'))
  const sch = collapse(f.schedule.split('\n').find((l) => l.startsWith('**The completion verifier (estate ADR 0009 d6).**')) ?? '')
  need('schedule', sch.includes(`a fast tier with a reach should take its base from \`${VAR}\` when it is set`))
  const vb = entry(f.context, '- **Verify base** —')
  need('context', vb.includes(`\`${VAR}\``) && vb.includes('never set at completion'))
  need('adr', (f.adr ?? '').startsWith('# 0060 — Verify names its diff base') && (f.adr ?? '').includes(VAR))
  need('run-sh-unset', f.run.split('\n').includes(`unset ${VAR}`))
  return bad
}

test('the verify base (p34-3, ADR 0060): § 4.5, the RACE procedure, schedule, CONTEXT.md, the ADR, run.sh', () => {
  assert.deepEqual(check(real), [])
})

// Each control changes one real file in memory and must fail with exactly its rule.
function only(files, rule, label) {
  assert.deepEqual(check(files), [rule], label)
}
const edit = (key, from, to) => {
  assert.ok(real[key].includes(from), `control anchor present: ${from.slice(0, 60)}`)
  return { ...real, [key]: real[key].replace(from, to) }
}

test('control: § 4.5 without the verify base fails skill-verify', () => {
  only(edit('skill', `sees \`${VAR}\`, the diff base's sha`, 'sees nothing'), 'skill-verify', 'no variable')
})

test('control: a completion verify that sets it fails skill-verify', () => {
  only(edit('skill', 'a verify without `--diff-base` (the completion verify) never sets it', 'every verify sets it'), 'skill-verify', 'completion sets it')
})

test('control: § 4.5 without the unresolvable base\'s case fails skill-verify', () => {
  only(edit('skill', 'A `--diff-base` that does not resolve in the tree leaves it unset too', 'A `--diff-base` that does not resolve is an error'), 'skill-verify', 'no unresolvable case')
})

test('control: a RACE procedure without the variable fails skill-race', () => {
  only(edit('skill', `The re-verify's steps see \`${VAR}=<the merge commit>^1\``, "The re-verify's steps see origin/<default>"), 'skill-race', 'no race base')
})

test('control: a RACE procedure that moves origin/<default> fails skill-race', () => {
  only(edit('skill', '`origin/<default>` never moves for it', '`origin/<default>` is reset to it'), 'skill-race', 'moved ref')
})

test('control: schedule without the project-author sentence fails schedule', () => {
  only(edit('schedule', `a fast tier with a reach should take its base from \`${VAR}\` when it is set`, 'a fast tier reads origin'), 'schedule', 'no sentence')
})

test('control: CONTEXT.md without a Verify base entry fails context', () => {
  only(edit('context', '- **Verify base** —', '- **Verify floor** —'), 'context', 'no entry')
})

test('control: no ADR 0060 fails adr', () => {
  only({ ...real, adr: null }, 'adr', 'no adr')
})

test('control: run.sh that never unsets it fails run-sh-unset', () => {
  only(edit('run', `unset ${VAR}\n`, ''), 'run-sh-unset', 'no unset')
})
