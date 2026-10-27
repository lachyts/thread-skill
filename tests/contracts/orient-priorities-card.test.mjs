// Orient asks a project's Priorities card once (p30-6; Chorus ADR 0110 d5; CONTEXT.md **Priorities card**). § 2 reads
// each swept project note's `## Priorities` section; § 3.5 asks the card, for a project target whose note has none, in
// one AskUserQuestion call of four questions (how robust, who it is for, what matters most, where he steers), each in
// the Framing, and writes his answers into the note at once; a note with a card is never asked again, and Look only,
// a dry run, an area and a scoped target ask none. A Note of his that corrects the card is written back the same day.
// Reshuffle R3 passes the card to the grill skills through their pinned `args`; the Don't line names the card's write
// beside the drift fixes and the learned directory.
//
// One pure function, check(orient, reshuffle, context), over the real files: the real text and the controls run
// through it, and each control mutates the real text in one place and must fail with exactly its rule. Reads files only.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { read, collapse, section, slice } from '../lib/contract-text.mjs'

const ORIENT = 'skills/orient/SKILL.md'
const RESHUFFLE = 'skills/orient/reshuffle.md'
const CONTEXT = 'CONTEXT.md'
const real = { orient: read(ORIENT), reshuffle: read(RESHUFFLE), context: read(CONTEXT) }
const CITE = '${CLAUDE_PLUGIN_ROOT}/skills/_shared/asking.md'

function check({ orient, reshuffle, context }) {
  const fails = []
  const s2 = section(orient, /^### 2\./) ?? ''
  const card = collapse(slice(s2, /^- \*\*Priorities card\*\*/, /^- |^$/) ?? '')
  if (!card.includes('`## Priorities` section') || !/each swept project note/.test(card) ||
    !/Every later ask in this orient reads it/.test(card) || !card.includes(`${CITE}\` § 1`)) fails.push('audit')

  const raw = section(orient, /^### 3\.5\. The Priorities card$/) ?? ''
  const s35 = collapse(raw)
  const lead = collapse(raw.split(/\n\s*\n/).find((p) => p.includes('AskUserQuestion')) ?? '')
  if (!lead.includes('in one `AskUserQuestion` call of four questions') || !lead.includes(`${CITE}\` § 3`) ||
    !lead.includes('Owner *yours*') || !/has no `## Priorities` heading/.test(lead) ||
    !/the target is a project/.test(lead)) fails.push('ask')
  const items = [...raw.matchAll(/^(\d)\. \*\*([^*]+)\*\*/gm)].map((m) => `${m[1]} ${m[2]}`)
  if (JSON.stringify(items) !== JSON.stringify(['1 How robust', '2 Who it is for', '3 What matters most', '4 Where he steers']) ||
    !/production-ready or lightweight/.test(s35)) fails.push('questions')
  const para = (label) => collapse(raw.split(/\n\s*\n/).find((p) => p.startsWith(label)) ?? '')
  const write = para('**The write.**')
  if (!/into the project note at once/.test(write) || !/nothing else in the note changed/.test(write) ||
    !/A question he leaves unanswered is written `not answered/.test(s35) || !/If he stops the whole ask, nothing is written/.test(s35) ||
    !['- **How robust:**', '- **Who it is for:**', '- **What matters most:**', '- **Where he steers:**'].every((l) => raw.includes(l))) fails.push('write')
  const once = para('**Once.**')
  if (!/never asked again, whole or in part/.test(once) || !/Look only, a dry run, an area target and a scoped target ask none/.test(once) ||
    !/Steer only asks it/.test(once)) fails.push('once')
  const note = para('**A Note corrects it.**')
  if (!/written back into it the same day/.test(note) || !/the grill/.test(note) || !/the report says so/.test(note)) fails.push('note')

  // The grill skills get the card through their pinned args; R3 names where <project note> comes from.
  const r3 = collapse((section(reshuffle, /^## R3\. /) ?? '').replace(/^> ?/gm, ''))
  if (!r3.includes('Read the `## Priorities` card in <project note> first') || !r3.includes('`<project note>` the target project note')) fails.push('grill')

  if (!collapse(section(orient, /^## Don't/) ?? '').includes('drift fixes and the learned `repos:` entry (§ 4) aside, and the Priorities card (§ 3.5)')) fails.push('dont')
  if (!/^- \*\*Priorities card\*\* — a project note's `## Priorities` section/m.test(context ?? '')) fails.push('glossary')
  return fails
}

// Replace the first `from` after `anchor` (the whole text when anchor is null). A space in `from` matches any run of
// whitespace, so a reflowed line still meets its control.
function edit(text, from, to, anchor = null, file = '') {
  const i = anchor == null ? 0 : text.indexOf(anchor)
  assert.ok(i >= 0, `no ${anchor} in ${file}`)
  const re = new RegExp(from.split(' ').map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+'))
  const m = re.exec(text.slice(i))
  assert.ok(m, `control: no ${JSON.stringify(from)} in ${file}`)
  const at = i + m.index
  return text.slice(0, at) + to + text.slice(at + m[0].length)
}
const o = (from, to, anchor = '### 3.5. The Priorities card') => ({ ...real, orient: edit(real.orient, from, to, anchor, ORIENT) })

test('orient reads the Priorities card, asks it once when it is missing, and the grill reads it', () => {
  assert.deepEqual(check(real), [])
})

test('each control fails with exactly its rule', () => {
  const controls = {
    audit: o('Every later ask in this orient reads it', 'It is context', '- **Priorities card**'),
    ask: o('in one `AskUserQuestion` call of four questions', 'in four `AskUserQuestion` calls'),
    questions: o('4. **Where he steers**', '4. **What it costs**'),
    write: o('nothing else in the note changed', 'the note tidied'),
    once: o('never asked again, whole or in part', 'asked again when a line is thin'),
    note: o('written back into it the same day', 'noted for the next orient'),
    grill: { ...real, reshuffle: edit(real.reshuffle, 'Read the `## Priorities` card in <project note> first', 'Read the project first', '## R3.', RESHUFFLE) },
    dont: o('and the Priorities card (§ 3.5)', '', "## Don't"),
    glossary: { ...real, context: edit(real.context, "- **Priorities card** — a project note's", '- **Card** — a', null, CONTEXT) },
  }
  for (const [rule, files] of Object.entries(controls)) assert.deepEqual(check(files), [rule], rule)
  // The ask loses its gate cite or its Owner, or runs on an area target; Look only starts asking.
  assert.deepEqual(check(o(`${CITE}\` § 3`, 'the gate')), ['ask'])
  assert.deepEqual(check(o('Owner *yours*', 'Owner *technical*')), ['ask'])
  assert.deepEqual(check(o('Look only, a dry run, an area target and a scoped target ask none', 'A dry run asks none')), ['once'])
  // The write drops its unanswered line, or the stop that writes nothing.
  assert.deepEqual(check(o('not answered', 'blank')), ['write'])
  assert.deepEqual(check(o('nothing is written', 'a blank card is written')), ['write'])
})
