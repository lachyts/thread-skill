// A code project's thread lives in its repo (ADR 0039; CONTEXT.md **Thread home**, **Placement check**). The
// placement check is skills/_shared/scripts/thread-placement.py (its behaviour is tests/thread-placement.test.mjs);
// this contract pins where the prose calls it and what each caller does with it:
//   - open § Creating a new thread: the repo row first (`home`), one live THREAD.md per project, no seat homes;
//   - close: rung 1's `home --dir`, rung 2's picked-up doc (whose unfound `thread:` falls through, while a slug
//     named in the conversation never reaches rung 3), the ownership exception for an active thread outside
//     `<home>`, step 1's `audit --thread` and step 8's placement row, and the split edge cases;
//   - handoff **Split launch.**: the three cases, which thread the consumer's close writes, and the failure line;
//     § Success contract's call site (Chorus `create_thread` gets `cwd: <the Run from: directory>` when that
//     differs from this session's launch directory) and **Consumer home.**'s cwd clause, which case 1 leans on;
//   - handoff-lifecycle § Home: the Ownership exception and the Split launch bullet;
//   - orient § 2's Placement bullet and § 3's Placement line; task-writer § 6's creation site;
//   - CONTEXT.md's terms, ADR 0039's decisions and README's ADR list.
//
// One pure function, check(files), over the real files: the real text and the controls run through it, and each
// control mutates the real text in one place and must fail with exactly its rule. Reads files only.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { root, read, collapse, section, slice } from '../lib/contract-text.mjs'

const FILES = {
  open: 'skills/open/SKILL.md',
  close: 'skills/close/SKILL.md',
  handoff: 'skills/handoff/SKILL.md',
  life: 'skills/_shared/handoff-lifecycle.md',
  orient: 'skills/orient/SKILL.md',
  writer: 'skills/_shared/task-writer.md',
  context: 'CONTEXT.md',
  readme: 'README.md',
}
const adrFile = () => {
  const hits = fs.readdirSync(path.join(root, 'docs', 'adr')).filter((f) => f.startsWith('0039-'))
  return hits.length === 1 ? `docs/adr/${hits[0]}` : null
}
function realFiles() {
  const out = Object.fromEntries(Object.entries(FILES).map(([k, p]) => [k, read(p)]))
  const adr = adrFile()
  out.adr = adr ? read(adr) : ''
  return out
}
const SCRIPT = '"${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/thread-placement.py"'
const count = (text, s) => text.split(s).length - 1

// A bold-labelled paragraph or bullet, from its label to the next blank line, collapsed.
const para = (text, label) => collapse(slice(text, new RegExp(`^(- )?\\*\\*${label}`), /^$/) ?? '')
// A numbered list item (`1. `) of `text`, to the next item or blank line, collapsed.
const item = (text, n) => collapse(slice(text, new RegExp(`^${n}\\. `), /^\d+\. |^$/) ?? '')

function check(f) {
  const fails = []
  // ---- open ----
  const create = section(f.open, /^## Creating a new thread/) ?? ''
  const rows = create.split('\n').filter((l) => l.startsWith('| ') && !l.startsWith('| Question'))
  const row1 = rows[0] ?? ''
  if (!row1.includes('`<repo>/THREAD.md`') || !row1.includes('ADR 0039') || !row1.includes(`python3 ${SCRIPT} home --project "<note>"`) ||
    !row1.includes('`home --dir "$PWD"`') || !row1.includes('a main checkout') ||
    !/no code repo/.test(rows[1] ?? '')) fails.push('open-row')
  const one = para(create, 'One live thread per project\\.')
  if (!one.includes('`docs/threads/<slug>.md`') || !one.includes('`_archive/`') || !one.includes('never becomes a sibling `THREAD-<name>.md`') ||
    !/The hardcoded name is the contract/.test(one)) fails.push('open-one')
  const ws = para(create, 'Workspace subfolders\\.')
  if (!ws.includes('is not a thread home') || !ws.includes('`_shared/threads/<slug>.md`')) fails.push('open-ws')
  const donts = collapse(section(f.open, /^## Don't/) ?? '')
  if (!donts.includes("A code project's thread lives in its repo, any other project's next to its files") ||
    !donts.includes('sibling `THREAD-<name>.md`')) fails.push('open-dont')

  // ---- close ----
  const ident = section(f.close, /^## Identify the active thread/) ?? ''
  const r1 = item(ident, 1)
  const r2 = item(ident, 2)
  if (!r1.includes(`python3 ${SCRIPT} home --dir "$PWD"`) || !r1.includes('otherwise `<repo>/THREAD.md`') ||
    !r1.includes('never in the folder') || !r1.includes("step 8's `placement: check failed` row")) fails.push('close-r1')
  if (!r2.includes('**or this session picked up a handoff doc**') ||
    !r2.includes('for a slug named in the conversation → rung 4, **never rung 3**') ||
    !r2.includes("for a picked-up doc's `thread:` → no reference at all") ||
    !r2.includes("A slug named in the conversation wins over a picked-up doc's") ||
    !r2.includes('by its effective slug or its directory name') ||
    count(r2, 'never rung 3') !== 1) fails.push('close-r2')
  const edge = collapse(section(f.close, /^## Edge cases/) ?? '')
  if (!edge.includes('**A slug named in the conversation with no match** → rung 4') ||
    !edge.includes("**A picked-up handoff doc whose `thread:` has no match** → no reference; rungs 3–5 apply") ||
    !edge.includes("**A split launch's consumer** (handoff **Split launch.**) → rung 2 resolves the producer's `~/Projects` thread")) fails.push('close-edge')
  const own = collapse(slice(f.close, /^A \*\*handoff doc\*\* is a file in/, /^$/) ?? '')
  if (!own.includes('with two exceptions') || !own.includes('more than one THREAD.md-backed thread') ||
    !own.includes('**lies outside `<home>`**') || !own.includes('is **left alone**') ||
    !own.includes('In the second case a legacy doc is left alone too') ||
    !own.includes('ownership is by `thread:`')) fails.push('close-own')
  const s1 = item(section(f.close, /^## Process/) ?? '', 1)
  if (!s1.includes(`python3 ${SCRIPT} audit --thread "<abs path>"`) || !s1.includes('drop its `unchecked:` lines')) fails.push('close-s1')
  // Step 8 sits below § Process's ### sub-sections, so it is sliced on its own.
  const s8 = collapse(slice(f.close, /^8\. \*\*Print the "What landed" report\*\*/, /^$/) ?? '')
  if (!s8.includes('`placement: <kind> <path> — <detail> · fix: <fix>`') || !s8.includes('`placement: check failed (<first stderr line>)`') ||
    !s8.includes('never blocks')) fails.push('close-s8')

  // ---- handoff ----
  const doc = section(f.handoff, /^## Handoff document/) ?? ''
  const split = slice(doc, /^\*\*Split launch\.\*\*/, /^\*\*Shape\.\*\*/) ?? ''
  const sl = collapse(split)
  const c1 = item(split, 1)
  const c2 = item(split, 2)
  const c3 = item(split, 3)
  if (!sl.includes(`python3 ${SCRIPT} home --dir "$PWD"`) || !sl.includes('Before resolving `<home>`')) fails.push('ho-call')
  if (!c1.includes('`<repo>/THREAD.md`') || !c1.includes('no thread is active') || !c1.includes('**Consumer home.** with `--dir <repo>`') ||
    !c1.includes("the doc, `Run from:` and `create_thread`'s `cwd` all move to the repo") || c1.includes('not moved')) fails.push('ho-case1')
  if (!c2.includes("**This folder's own thread.**") || !c2.includes('`<home>/THREAD.md`') ||
    !c2.includes('§ Repo-thread lookup with `slug=<the doc\'s thread:>` prints exactly that path') ||
    !c2.includes("`Run from:` and `create_thread`'s `cwd` are `<repo>`") || !c2.includes('**`<home>` is not moved**')) fails.push('ho-case2')
  if (!c3.includes("`placement: split launch skipped — <reason>; Run from left at the launch directory`") ||
    !c3.includes("`active thread is not this folder's`") || !c3.includes('ADR 0039 d6')) fails.push('ho-case3')
  if (!sl.includes("**The thread the consumer's close writes is the producer's**") || !sl.includes('explicit reference (close rung 2)') ||
    !sl.includes("the repo's own THREAD.md never captures the session") ||
    !sl.includes("leaves the repo thread's docs alone")) fails.push('ho-consumer')
  if (!sl.includes('`placement: check failed (<first stderr line>) — Run from left at the launch directory`') ||
    !sl.includes('A destination Lachy names wins')) fails.push('ho-fail')
  if (!para(doc, 'Shape\\.').includes('**Split launch.**') || !para(doc, 'Consumer home\\.').includes('**Split launch.**')) fails.push('ho-shape')
  // The call site: create_thread launches where Run from: points, so a split launch's consumer leaves the folder.
  const call = collapse(slice(section(f.handoff, /^## Success contract/) ?? '', /^The user's explicit handoff request/, /^$/) ?? '')
  if (!call.includes("On Chorus, `create_thread` gets `cwd: <the Run from: directory>` whenever that directory differs from this session's launch directory") ||
    !call.includes('unless **Consumer home.** or **Split launch.** moved it') || !call.includes('A destination Lachy names wins') ||
    call.includes('in the same project/workspace')) fails.push('ho-cwd')
  // Consumer home moves the cwd itself, so case 1's "the doc, Run from: and cwd all move" holds by reference.
  const ch = para(doc, 'Consumer home\\.')
  if (!ch.includes('`Run from:` (**Shape.**) is that consumer launch directory') ||
    !ch.includes("`create_thread`'s `cwd` moves with it")) fails.push('ho-home-cwd')

  // ---- handoff-lifecycle § Home ----
  const home = section(f.life, /^## Home/) ?? ''
  const lown = para(home, 'Ownership\\.')
  if (!lown.includes('more than one THREAD.md-backed thread') || !lown.includes('active thread whose THREAD.md lies outside it') ||
    !lown.includes("a split launch's consumer") || !lown.includes('left alone (in the second case a legacy doc too)')) fails.push('life-own')
  const lsplit = para(home, 'Split launch\\.')
  if (!lsplit.includes('by **Consumer home.** when the active thread is the repo\'s THREAD.md or there is none') ||
    !lsplit.includes("only `Run from:` and the consumer's working directory move") ||
    !lsplit.includes('through close rung 2') || !lsplit.includes("never the repo's THREAD.md by rung 3") ||
    !lsplit.includes('Any other active thread → no move')) fails.push('life-split')

  // ---- orient ----
  const s2 = section(f.orient, /^### 2\./) ?? ''
  const place = collapse(slice(s2, /^- \*\*Placement\*\*/, /^- /) ?? '')
  if (!place.includes('python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/thread-placement.py audit --project "<note>"') ||
    !place.includes('Report-only') || !place.includes('A scoped target runs none') ||
    !place.includes('never a blocker')) fails.push('orient-s2')
  const p3 = collapse(slice(section(f.orient, /^### 3\./) ?? '', /^- \*\*Placement\*\*/, /^- /) ?? '')
  if (!p3.includes('Omit the line on `placement: none`')) fails.push('orient-s3')

  // ---- task-writer § 6 ----
  const w6 = collapse(slice(f.writer, /^## 6\./, /^## 7\./) ?? '')
  if (!w6.includes('`${CLAUDE_PLUGIN_ROOT}/skills/open/SKILL.md` § Creating a new thread')) fails.push('writer')

  // ---- CONTEXT.md ----
  const term = (name) => collapse(slice(f.context, new RegExp(`^- \\*\\*${name}\\*\\* —`), /^- \*\*/) ?? '')
  const thread = term('THREAD\\.md')
  if (!thread.includes('`<repo>/THREAD.md`') || !thread.includes('ADR 0039')) fails.push('ctx-thread')
  const pc = term('Placement check')
  if (!term('Thread home').includes('main checkout') || !pc.includes('`split-home` (not the retired reshuffle verb *split*') ||
    !pc.includes('once per thread identity') || /`split`/.test(pc)) fails.push('ctx-terms')

  // ---- ADR 0039 ----
  const adr = collapse(f.adr)
  if (!adr.includes('`closeout_shaped`') || !adr.includes('Why the tools are not taught named threads') ||
    !adr.includes('a main checkout') || !adr.includes('Workspace seat subfolders are not thread homes') ||
    !adr.includes('An ancestor entry') || !adr.includes('attributes nothing') ||
    !adr.includes('audit-only')) fails.push('adr-core')
  if (!adr.includes('reported once per thread identity') || !adr.includes('never once per copy') ||
    !adr.includes('Git checks run per main checkout, never for a linked worktree')) fails.push('adr-identity')
  if (!adr.includes('**Case 3 narrows "default to the repo".**') || !adr.includes("the work is not this folder's project's") ||
    !adr.includes('`Run from:` stays at the launch directory')) fails.push('adr-case3')
  const cons = collapse(section(f.adr, /^## Consequences/) ?? '')
  if (!cons.includes('Smart Slider') || !cons.includes('`prototype-simple-slider-ui`') || !cons.includes('`optimizer`')) fails.push('adr-smart')

  // ---- README ----
  if (!/`0039` — a code project's thread lives in its repo/.test(collapse(f.readme))) fails.push('readme')
  return fails
}

// Replace the first `from` in `key`'s text after `anchor` (the whole text when anchor is null). A space in `from`
// matches any run of whitespace, so a reflowed line still meets its control.
function edit(files, key, from, to, anchor = null) {
  const text = files[key]
  const i = anchor == null ? 0 : text.indexOf(anchor)
  assert.ok(i >= 0, `no ${anchor} in ${key}`)
  const re = new RegExp(from.split(' ').map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+'))
  const m = re.exec(text.slice(i))
  assert.ok(m, `control: no ${JSON.stringify(from)} in ${key}`)
  const at = i + m.index
  return { ...files, [key]: text.slice(0, at) + to + text.slice(at + m[0].length) }
}

test('ADR 0039 exists once, and every caller of the placement check is wired', () => {
  assert.ok(adrFile(), 'docs/adr/0039-*.md exists exactly once')
  assert.deepEqual(check(realFiles()), [])
})

test('each control fails with exactly its rule', () => {
  const real = realFiles()
  const e = (key, from, to, anchor) => edit(real, key, from, to, anchor)
  const controls = {
    'open-row': e('open', '`<repo>/THREAD.md`', '`<that project>/THREAD.md`', '## Creating a new thread'),
    'open-one': e('open', 'never becomes a sibling `THREAD-<name>.md`', 'may become a sibling', '**One live thread per project.**'),
    'open-ws': e('open', 'is not a thread home', 'is a thread home', '**Workspace subfolders.**'),
    'open-dont': e('open', "A code project's thread lives in its repo, any other project's next to its files", 'Project threads live next to the project files', "## Don't"),
    'close-r1': e('close', 'never in the folder', 'or in the folder', '## Identify the active thread'),
    // The conversation clause's "→ rung 4, never rung 3" copied over the picked-up clause.
    'close-r2': e('close', "for a picked-up doc's `thread:` → no reference at all", "for a picked-up doc's `thread:` → rung 4, **never rung 3**", '## Identify the active thread'),
    'close-edge': e('close', "**A split launch's consumer**", '**A consumer**', '## Edge cases'),
    // The ownership paragraph loses its outside-<home> exception.
    'close-own': e('close', '**lies outside `<home>`**', 'lies in `<home>`', '## The handoff owns the continuation'),
    'close-s1': e('close', 'audit --thread "<abs path>"', 'audit', '## Process'),
    'close-s8': e('close', '`placement: check failed (<first stderr line>)`', 'nothing', '8. **Print the "What landed" report**'),
    'ho-call': e('handoff', 'home --dir "$PWD"', 'home', '**Split launch.**'),
    // Case 1 keeps <home> instead of moving the doc.
    'ho-case1': e('handoff', "the doc, `Run from:` and `create_thread`'s `cwd` all move to the repo", "only `Run from:` moves, and `<home>` is not moved", '**Split launch.**'),
    'ho-case2': e('handoff', '**`<home>` is not moved**', '`<home>` moves too', '**Split launch.**'),
    // Case 3 loses its not-this-folder's condition.
    'ho-case3': e('handoff', "`active thread is not this folder's`", '`thread: <slug> resolves elsewhere`', '**Split launch.**'),
    'ho-consumer': e('handoff', "the repo's own THREAD.md never captures the session", "rung 3 may take the repo's THREAD.md", '**Split launch.**'),
    'ho-fail': e('handoff', '— Run from left at the launch directory`, then continue', '`, then stop', '**Split launch.**'),
    // Anchored on the paragraph's own lead: § Success contract and **Consumer home.** cite **Shape.** earlier.
    'ho-shape': e('handoff', '**Split launch.**', 'a split launch', '**Shape.** Front matter'),
    // The call site drops the cwd, so Chorus launches the consumer in this Session's own directory.
    'ho-cwd': e('handoff', '`cwd: <the Run from: directory>`', 'its default `cwd`', '## Success contract'),
    // Consumer home moves the doc and Run from: but leaves the cwd behind.
    'ho-home-cwd': e('handoff', ", and `create_thread`'s `cwd` moves with it", '', '**Consumer home.** When the consumer'),
    'life-own': e('life', 'active thread whose THREAD.md lies outside it', 'active thread', '- **Ownership.**'),
    'life-split': e('life', 'Any other active thread → no move', 'Any other active thread moves too', '- **Split launch.**'),
    'orient-s2': e('orient', 'A scoped target runs none', 'Every target runs it', '- **Placement**'),
    'orient-s3': e('orient', 'Omit the line on `placement: none`', 'Always print it', '### 3.'),
    writer: e('writer', '§ Creating a new thread', '§ Repo-thread lookup', '## 6.'),
    'ctx-thread': e('context', '`<repo>/THREAD.md`', '`<repo>/README.md`', '- **THREAD.md** —'),
    'ctx-terms': e('context', '`split-home` (not the retired reshuffle verb *split*', '`split` (the placement kind', '- **Placement check** —'),
    'adr-core': e('adr', '`closeout_shaped`', 'the lander'),
    'adr-identity': e('adr', 'never once per copy', 'once per copy'),
    // Deleting the Case 3 sentence's bold lead.
    'adr-case3': e('adr', '**Case 3 narrows "default to the repo".**', ''),
    'adr-smart': e('adr', '`prototype-simple-slider-ui`', 'its first repo', '## Consequences'),
    readme: e('readme', "`0039` — a code project's thread lives in its repo", '`0039` — threads'),
  }
  for (const [rule, files] of Object.entries(controls)) assert.deepEqual(check(files), [rule], rule)
  // close rung 2 merged into one clause, or the picked-up doc dropped; ownership keeps only one exception.
  assert.deepEqual(check(e('close', '**or this session picked up a handoff doc**', '', '## Identify the active thread')), ['close-r2'])
  assert.deepEqual(check(e('close', 'with two exceptions', 'with one exception', '## The handoff owns the continuation')), ['close-own'])
  // handoff case 2 loses its exact-path lookup; case 3 loses its ADR; the consumer sentence loses rung 2.
  assert.deepEqual(check(e('handoff', 'prints exactly that path', 'prints a path', '**Split launch.**')), ['ho-case2'])
  assert.deepEqual(check(e('handoff', 'ADR 0039 d6', 'ADR 0039', "`active thread is not this folder's`")), ['ho-case3'])
  assert.deepEqual(check(e('handoff', 'explicit reference (close rung 2)', 'reference', '**Split launch.**')), ['ho-consumer'])
  // The call site: the cwd only when Lachy asks, the old same-project default back, or no destination of Lachy's.
  assert.deepEqual(check(e('handoff', "whenever that directory differs from this session's launch directory", 'when Lachy names one', '## Success contract')), ['ho-cwd'])
  assert.deepEqual(check(e('handoff', 'Give the new task a concise title', 'Create the new task in the same project/workspace. Give it a concise title', '## Success contract')), ['ho-cwd'])
  assert.deepEqual(check(e('handoff', 'A destination Lachy names wins over all of this.', '', '## Success contract')), ['ho-cwd'])
  // Consumer home's Run from: left at this session's launch directory.
  assert.deepEqual(check(e('handoff', '`Run from:` (**Shape.**) is that consumer launch directory', '`Run from:` stays put', '**Consumer home.** When the consumer')), ['ho-home-cwd'])
  // The ADR loses its identity rule's git half, or the Case 3 sentence's reason.
  assert.deepEqual(check(e('adr', 'Git checks run per main checkout, never for a linked worktree', 'Git checks run per copy')), ['adr-identity'])
  assert.deepEqual(check(e('adr', "the work is not this folder's project's", 'it is unclear')), ['adr-case3'])
  // CONTEXT.md defining a bare `split` placement kind.
  assert.deepEqual(check(e('context', 'once per thread identity', 'once per thread identity (formerly `split`)', '- **Placement check** —')), ['ctx-terms'])
})
