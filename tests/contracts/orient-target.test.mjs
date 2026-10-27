// Orient resolves its target before it reads (ADR 0036 d1–d4; CONTEXT.md **Target**). § 1 runs
// skills/_shared/scripts/resolve-target.py once, its argument quoted as one shell word (its behaviour is
// tests/resolve-target.test.mjs), and acts on its outcome before § 2 reads anything: a `resolved` pick is named
// in one line he can stop; `candidates` or `none` ask, with a stop option or a plain-text question when the
// tool would have fewer than two options; a resolver failure asks in plain text and never falls back to an area
// sweep. A project target narrows § 2 to that project and its sub-projects. The one learned write, `--learn`
// with the held project's vault-relative `note` field, waits for § 4 and never runs on Look only. The held
// `learn_dir` is the first (directory) answer's and survives a typed or `Other` answer and its re-resolution,
// whose own `learn_dir` is null, so an undeclared directory named by typing is still learned.
//
// One pure function, check(text), over orient's SKILL.md: the real file and the controls run through it, and
// each control mutates the real text in one place and must fail with exactly its rule. Reads files only.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { read, collapse, section, slice, lineOf } from '../lib/contract-text.mjs'

const ORIENT = 'skills/orient/SKILL.md'
const real = read(ORIENT)
const SCRIPT = '${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/resolve-target.py'

function check(text) {
  const fails = []
  const s1raw = section(text, /^### 1\./) ?? ''
  const s2raw = section(text, /^### 2\./) ?? ''
  const s1 = collapse(s1raw)
  const s4 = collapse(section(text, /^### 4\./) ?? '')
  // A § 1 bullet, from its `- **<label>` line to the next top-level bullet or blank line.
  const bullet = (label) => collapse(slice(s1raw, new RegExp(`^- \\*\\*${label}`), /^- |^$/) ?? '')

  if (!s1.includes(`${SCRIPT} "<argument>"`) || !['`resolved`', '`candidates`', '`none`', '`AskUserQuestion`'].every((t) => s1.includes(t)) ||
    !/runs? before § 2 reads anything/.test(s1)) fails.push('call')
  const failure = bullet('Resolver failure')
  if (!/exits non-zero/.test(failure) || !failure.includes('`resolve-target:` line') || !/ask in plain text/.test(failure) ||
    !/sweeping nothing before an answer/.test(failure) || !/a second failure ends the orient/.test(failure)) fails.push('failure')
  const named = bullet('`resolved`')
  if (!/in one line/.test(named) || !/say stop to change it/.test(named)) fails.push('naming')
  const ask = bullet('`candidates` or `none`')
  if (!/before any § 2 read/.test(ask) || !ask.includes('`Stop — orient nothing`') || !/ask in plain text/.test(ask)) fails.push('ask')
  const learned = bullet('The learned directory')
  if (!learned.includes('stops a `resolved` pick') || !learned.includes('`note` field') || !/The learn waits for § 4/.test(learned) ||
    !/Look only/.test(learned) || !/never written back/.test(learned)) fails.push('learned')
  if (!/comes from the first answer/.test(learned) || !/survives/.test(learned) || !learned.includes('a typed or `Other` answer') ||
    !learned.includes("re-resolved target's `note`")) fails.push('held')
  if (!bullet('Vault folder and area').includes('`folder` and `area`')) fails.push('area')
  if (/infers? the area/i.test(s1) || s1.includes('Ambiguous → `AskUserQuestion`')) fails.push('stale')

  const scope = collapse(slice(s2raw, /^\*\*Scope by target\.\*\*/, /^- |^$/) ?? '')
  if (!/link it or any swept sub-project/.test(scope) || !/An area target keeps the bullets below word for word/.test(scope)) fails.push('scope')
  if (!/^- \*\*Next-action slots, first\*\*/.test(lineOf(s2raw, '- ') ?? '')) fails.push('slots')

  const learn4 = s4.slice(Math.max(0, s4.indexOf('**The learned directory.**')))
  if (!s4.includes('**The learned directory.**') || !learn4.includes(`${SCRIPT} --learn "<learn_dir>" "<note>"`) ||
    !/vault-relative `note` field/.test(learn4) || !/re-resolved target's/.test(learn4) || !/never the bare name/.test(learn4) ||
    !/Look only learns nothing/.test(learn4)) fails.push('learn')
  if (!/\*\*Look only\*\*[^.]*no writes of any kind/.test(s4)) fails.push('look')

  if (!collapse(section(text, /^## Don't/) ?? '').includes("**Don't write before the reshuffle's gate**, drift fixes, the learned `repos:` entry (§ 4)")) fails.push('dont')
  const forms = section(text, /^## Invocation forms/) ?? ''
  if (/infer the area/i.test(forms) || !forms.includes('# resolve the target from the session directory')) fails.push('forms')
  return fails
}

// Replace the first `from` in the text after `anchor` (the whole text when anchor is null). A space in `from`
// matches any run of whitespace, so a reflowed line still meets its control.
function edit(text, from, to, anchor = null) {
  const i = anchor == null ? 0 : text.indexOf(anchor)
  assert.ok(i >= 0, `no ${anchor} in ${ORIENT}`)
  const re = new RegExp(from.split(' ').map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+'))
  const m = re.exec(text.slice(i))
  assert.ok(m, `control: no ${JSON.stringify(from)} in ${ORIENT}`)
  const at = i + m.index
  return text.slice(0, at) + to + text.slice(at + m[0].length)
}

test('orient § 1 resolves through the script, asks before it reads, and learns only at § 4', () => {
  assert.deepEqual(check(real), [])
})

test('each control fails with exactly its rule', () => {
  const s4 = '### 4.'
  const controls = {
    call: edit(real, 'before § 2 reads anything', 'first'),
    held: edit(real, 'comes from the first answer', 'comes from the latest answer'),
    failure: edit(real, 'sweeping nothing before an answer', 'then sweep'),
    naming: edit(real, 'say stop to change it', 'carry on'),
    ask: edit(real, '`Stop — orient nothing`', '`Stop`'),
    learned: edit(real, 'stops a `resolved` pick', 'declines it'),
    area: edit(real, '`folder` and `area`', 'both'),
    stale: edit(real, '- **A stop.**', '- Ambiguous → `AskUserQuestion` with the 2–3 most likely areas.\n- **A stop.**'),
    scope: edit(real, 'link it or any swept sub-project', 'link it'),
    slots: edit(real, '- **Next-action slots, first**', '- **Slots**'),
    look: edit(real, 'no writes of any kind', 'nothing more'),
    dont: edit(real, 'drift fixes, the learned `repos:` entry (§ 4) and', 'drift fixes (§ 4) and'),
    forms: edit(real, '# resolve the target from the session directory', '# infer the area from CWD'),
  }
  for (const [rule, text] of Object.entries(controls)) assert.deepEqual(check(text), [rule], rule)
  // § 1's learned-directory bullet loses its `note` field (the first one in the file; § 4's comes later).
  assert.deepEqual(check(edit(real, '`note` field', 'pick')), ['learned'])
  // The call loses its quotes, so a [[link]] argument meets zsh globbing before the script runs.
  assert.deepEqual(check(edit(real, 'resolve-target.py "<argument>"', 'resolve-target.py [<argument>]')), ['call'])
  // The held learn_dir: no longer survives a typed or `Other` answer, or no longer takes the re-resolved target's note.
  assert.deepEqual(check(edit(real, 'a typed or `Other` answer, and', 'and')), ['held'])
  assert.deepEqual(check(edit(real, "or the re-resolved target's `note` when a typed answer resolves to a project", '')), ['held'])
  assert.deepEqual(check(edit(real, "survives everything after it", 'is read again at each answer')), ['held'])
  // § 4: the vault-relative `note` clause, the bare-name argument, and the whole learn sentence.
  assert.deepEqual(check(edit(real, 'vault-relative `note` field', 'name', s4)), ['learn'])
  assert.deepEqual(check(edit(real, "picked option's or the re-resolved target's", "picked option's", s4)), ['learn'])
  assert.deepEqual(check(edit(real, '--learn "<learn_dir>" "<note>"', '--learn <learn_dir> <picked project>', s4)), ['learn'])
  const i = real.indexOf(s4)
  const whole = real.slice(0, i) + real.slice(i).replace(/\*\*The learned directory\.\*\*[\s\S]*?Look only\s+learns\s+nothing\.\n?/, '')
  assert.notEqual(whole, real, 'control: the § 4 learn sentence was found')
  assert.deepEqual(check(whole), ['learn'])
})
