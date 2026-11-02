// Orient asks a project's Priorities card once (p30-6; Chorus ADR 0110 d5; CONTEXT.md **Priorities card**). § 2 reads
// each swept project note's `## Priorities` section; § 3.5, which sits between § 3's report and § 4's question-free
// reshuffle, asks the card, for a project target whose note has none, in one AskUserQuestion call of four questions
// (how robust, who it is for, what matters most, where he steers), each in the Framing, and writes his answers into the
// note at once; a note with a card is never asked again. An area and a scoped target put no card and write no new one,
// but a Note of his that corrects a card § 2 read is still written back, whatever the target; only Look only and a dry
// run write nothing. A correction made in the grill is the one write the reshuffle makes before its gate, named in § 4,
// R3, R4 and the reshuffle's Don'ts. Reshuffle R3 passes the card to the grill skills through their pinned `args`,
// naming the note a project, a scoped and an area target pass; the Don't line names the card's write beside the drift
// fixes and the learned directory; ADR 0036 carries the amendment for its d4 and d5.
//
// One pure function, check(orient, reshuffle, context, adr), over the real files: the real text and the controls run
// through it, and each control mutates the real text in one place and must fail with exactly its rule. Reads files only.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { read, collapse, section, slice } from '../lib/contract-text.mjs'

const ORIENT = 'skills/orient/SKILL.md'
const RESHUFFLE = 'skills/orient/reshuffle.md'
const CONTEXT = 'CONTEXT.md'
const ADR36 = 'docs/adr/0036-orient-resolves-its-target-then-reshuffles.md'
const real = { orient: read(ORIENT), reshuffle: read(RESHUFFLE), context: read(CONTEXT), adr: read(ADR36) }
const CITE = '${CLAUDE_PLUGIN_ROOT}/skills/_shared/asking.md'
const H3 = /^### 3\. Present$/
const H35 = /^### 3\.5\. The Priorities card$/
const H4 = /^### 4\. Reshuffle by default$/

function check({ orient, reshuffle, context, adr }) {
  const fails = []
  const s2 = section(orient, /^### 2\./) ?? ''
  const card = collapse(slice(s2, /^- \*\*Priorities card\*\*/, /^- |^$/) ?? '')
  if (!card.includes('`## Priorities` section') || !/each swept project note/.test(card) ||
    !card.includes("Every later ask in this orient reads it (§ 3.5's own ask excepted)") ||
    !card.includes(`${CITE}\` § 1`)) fails.push('audit')

  // § 3.5 sits after § 3's report and before § 4: Look only stops after § 3, and § 4 asks nothing.
  const lines = orient.split('\n')
  const [i3, i35, i4] = [H3, H35, H4].map((re) => lines.findIndex((l) => re.test(l)))
  if (i3 < 0 || i35 < 0 || i4 < 0 || !(i3 < i35 && i35 < i4)) fails.push('order')

  const raw = section(orient, H35) ?? ''
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
  // An area and a scoped target put no new card, yet a Note still corrects a card § 2 read; only Look only and a dry
  // run write nothing.
  const once = para('**Once.**')
  if (!/never asked again, whole or in part/.test(once) ||
    !once.includes('An area target and a scoped target put no card and write no new one') ||
    !once.includes('A card § 2 read for either still takes his Note that corrects it (below)') ||
    !once.includes('Only Look only and a dry run write nothing') || /ask none and write none/.test(once) ||
    !/Steer only asks it/.test(once)) fails.push('once')
  const note = para('**A Note corrects it.**')
  if (!note.startsWith('**A Note corrects it.** Whatever the target, a Note of his') ||
    !/written back into that card at once, the same day/.test(note) || !/the grill/.test(note) ||
    !/the report says so/.test(note)) fails.push('note')

  // When the grill's correction is written: at once, the one write before the reshuffle's gate, standing whatever
  // the grill or the gate does; § 4, R3, R4 and the reshuffle's Don'ts name it.
  const s4 = collapse(section(orient, H4) ?? '')
  const r3 = collapse((section(reshuffle, /^## R3\. /) ?? '').replace(/^> ?/gm, ''))
  const r4 = collapse(section(reshuffle, /^## R4\. /) ?? '')
  const donts = collapse(section(reshuffle, /^## Don'ts/) ?? '')
  if (!note.includes('A correction made in the grill is the one write the reshuffle makes before its gate (reshuffle R3), ' +
    'and it stands if he stops the grill or declines the gate') ||
    !s4.includes("which writes nothing before its gate but a Note's correction of a Priorities card (§ 3.5)") ||
    !r3.includes("it is the one write the reshuffle makes before R4's gate, and it stands if he stops the grill or declines the gate") ||
    !r4.includes("**before writing any file**, a Note's correction of a Priorities card that R3 already wrote back aside (orient § 3.5)") ||
    !donts.includes("**Don't write before the R4 gate**, a Note's correction of a Priorities card (R3) aside")) fails.push('gate')

  // The grill skills get the card through their pinned args; R3 names the note each target passes.
  if (!r3.includes('Read the `## Priorities` card in <project note> first') ||
    !r3.includes('`<project note>` the absolute path of the project note whose `## Priorities` card (orient § 3.5) the grill reads') ||
    !r3.includes("a project target's own note") || !r3.includes("a scoped target's resolved project note") ||
    !r3.includes('for an area target, the note of the project whose cluster is being grilled, one per grill invocation')) fails.push('grill')

  if (!collapse(section(orient, /^## Don't/) ?? '').includes("**Don't write before the reshuffle's gate**, drift fixes, the learned " +
    '`repos:` entry (§ 4) and the Priorities card with the Notes that correct it (§ 3.5) aside.')) fails.push('dont')
  if (!/^- \*\*Priorities card\*\* — a project note's `## Priorities` section/m.test(context ?? '')) fails.push('glossary')
  const head = collapse(slice(adr ?? '', /^# /, /^## /) ?? '')
  if (!head.includes('*(Amended 2026-10-27 by p30-6:') ||
    !head.includes("orient § 3.5 asks a project's Priorities card after the audit and before the reshuffle") ||
    !head.includes('(Chorus ADR 0110 d5)') || !head.includes('It is no question about the reshuffle')) fails.push('adr')
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
const r = (from, to, anchor) => ({ ...real, reshuffle: edit(real.reshuffle, from, to, anchor, RESHUFFLE) })

// § 3.5, whole, moved to just before § 5: after § 4 instead of before it.
function after4(text) {
  const s35 = section(text, H35)
  assert.ok(s35 && text.includes(`${s35}\n### 4. `) && text.includes('\n### 5. '), 'control: § 3.5 does not sit before § 4')
  const cut = text.replace(`${s35}\n`, '')
  return cut.replace('\n### 5. ', `\n${s35}\n### 5. `)
}

test('orient reads the Priorities card, asks it once when it is missing, and the grill reads it', () => {
  assert.deepEqual(check(real), [])
})

test('each control fails with exactly its rule', () => {
  const controls = {
    audit: o('Every later ask in this orient reads it', 'It is context', '- **Priorities card**'),
    order: { ...real, orient: after4(real.orient) },
    ask: o('in one `AskUserQuestion` call of four questions', 'in four `AskUserQuestion` calls'),
    questions: o('4. **Where he steers**', '4. **What it costs**'),
    write: o('nothing else in the note changed', 'the note tidied'),
    once: o('never asked again, whole or in part', 'asked again when a line is thin'),
    note: o('written back into that card at once, the same day', 'noted for the next orient'),
    gate: o("writes nothing before its gate but a Note's correction of a Priorities card (§ 3.5),", 'writes nothing before its gate',
      '### 4. Reshuffle by default'),
    grill: r('Read the `## Priorities` card in <project note> first', 'Read the project first', '## R3.'),
    dont: o('and the Priorities card with the Notes that correct it (§ 3.5)', '', "## Don't"),
    glossary: { ...real, context: edit(real.context, "- **Priorities card** — a project note's", '- **Card** — a', null, CONTEXT) },
    adr: { ...real, adr: edit(real.adr, 'It is no question about the reshuffle', 'It is a question', null, ADR36) },
  }
  for (const [rule, files] of Object.entries(controls)) assert.deepEqual(check(files), [rule], rule)
  // The ask loses its gate cite or its Owner.
  assert.deepEqual(check(o(`${CITE}\` § 3`, 'the gate')), ['ask'])
  assert.deepEqual(check(o('Owner *yours*', 'Owner *technical*')), ['ask'])
  // An area or a scoped target writes nothing again, so a Note no longer corrects its card; Look only alone writes
  // nothing; the Note's write-back is limited to a project target.
  assert.deepEqual(check(o('An area target and a scoped target put no card and write no new one',
    'Look only, a dry run, an area target and a scoped target ask none and write none')), ['once'])
  assert.deepEqual(check(o('A card § 2 read for either still takes his Note that corrects it (below).', '')), ['once'])
  assert.deepEqual(check(o('Only Look only and a dry run write nothing', 'Look only writes nothing')), ['once'])
  assert.deepEqual(check(o('Whatever the target, a Note of his', 'On a project target, a Note of his')), ['note'])
  // The write drops its unanswered line, or the stop that writes nothing.
  assert.deepEqual(check(o('not answered', 'blank')), ['write'])
  assert.deepEqual(check(o('nothing is written', 'a blank card is written')), ['write'])
  // The grill's correction loses its timing in § 3.5, R3 or R4.
  assert.deepEqual(check(o('and it stands if he stops the grill or declines the gate', 'and it waits for R5', '**A Note corrects it.**')), ['gate'])
  assert.deepEqual(check(r("it is the one write the reshuffle makes before R4's gate,", 'it is written at R5,', '## R3.')), ['gate'])
  assert.deepEqual(check(r("**before writing any file**, a Note's correction of a Priorities card that R3 already wrote back aside (orient § 3.5).",
    '**before writing any file**.', '## R4.')), ['gate'])
  assert.deepEqual(check(r("a Note's correction of a Priorities card (R3) aside, and", 'and', "## Don'ts")), ['gate'])
  // R3 no longer says what an area target passes as <project note>.
  assert.deepEqual(check(r('; and for an area target, the note of the project whose cluster is being grilled, one per grill invocation', '',
    '## R3.')), ['grill'])
  // The amendment is gone from ADR 0036's head.
  assert.deepEqual(check({ ...real, adr: edit(real.adr, '*(Amended 2026-10-27 by p30-6:', '*(Note:', null, ADR36) }), ['adr'])
})
