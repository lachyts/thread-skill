// A rollout runs on its Engine snapshot (ADR 0043, p29-1). Pins the prose an LLM lead follows: the four rollout
// verbs hand over to the rollout's engine root by a git `ident` prose id (never a disk hash), schedule cuts first
// and runs a prior's commands from the prior's own root, execute § 1.5 moves a rollout only by `move.due` (a sign-off
// pause never moves), the completion ceremonies retire snapshots after the commit, a Leg's close re-resolves when its
// snapshot was retired, and the glossary and ADR say the same. The mechanics are pinned by tests/engine-snapshot.test.sh.
//
// Same shape as tests/contracts/execute-signed-gate.test.mjs: every rule lives in one function, check(texts), which
// returns named failures, so the real tree and the controls run through identical logic; each control swaps one
// text in one place and must fail with exactly its rule. Reads files only.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { collapse, FENCE, read, section } from '../lib/contract-text.mjs'

const VERBS = ['schedule', 'execute', 'status', 'repair']
const real = {
  attrs: read('.gitattributes'),
  doc: read('skills/_shared/engine-snapshot.md'),
  schedule: read('skills/schedule/SKILL.md'),
  execute: read('skills/execute/SKILL.md'),
  status: read('skills/status/SKILL.md'),
  repair: read('skills/repair/SKILL.md'),
  legs: read('skills/execute/legs.md'),
  close: read('skills/close/SKILL.md'),
  pluginRoot: read('skills/_shared/plugin-root.md'),
  context: read('CONTEXT.md'),
  adr: read('docs/adr/0043-a-rollout-runs-on-its-engine-snapshot.md'),
  tpl: read('skills/schedule/rollout-template.md'),
  serialTpl: read('skills/schedule/serial-rollout-template.md'),
}

// The prose-id marker: bare in a tree checked out before the attribute, expanded in every later checkout.
const MARKER = /\$Id(?:: [0-9a-f]{40,64} )?\$/
const MARKERS = new RegExp(MARKER.source, 'g')
const unfenced = (text) => {
  let fence = false
  return text.split('\n').filter((l) => { if (FENCE.test(l)) { fence = !fence; return false } return !fence })
}
const before = (hay, a, b) => hay.indexOf(a) >= 0 && hay.indexOf(b) >= 0 && hay.indexOf(a) < hay.indexOf(b)
const lineIndex = (text, re) => text.split('\n').findIndex((l) => re.test(l))
const entry = (context, term) => collapse(context.split('\n- **').find((p) => p.startsWith(`${term}**`)) ?? '')

function check(t) {
  const fails = []
  const fail = (rule) => { if (!fails.includes(rule)) fails.push(rule) }

  // ident: the four verbs carry git's ident attribute; the existing *.sh line is kept.
  for (const v of VERBS) if (!t.attrs.split('\n').includes(`skills/${v}/SKILL.md ident`)) fail('ident')
  if (!t.attrs.split('\n').includes('*.sh text eol=lf')) fail('ident')

  // prose-id: one marker per file, outside any fence, on its prose-id line; its hand-over command passes
  // --prose-id; the doc says a bare marker is no id and only the followed text's id counts; nothing compares a hash.
  for (const v of VERBS) {
    const text = t[v]
    const hits = text.match(MARKERS) ?? []
    const lines = unfenced(text).filter((l) => MARKER.test(l))
    if (hits.length !== 1 || lines.length !== 1 || !lines[0].includes("This text's prose id: `") ||
      !lines[0].includes('pass its hex as `--prose-id`; when it shows no hex, pass none')) fail('prose-id')
    const handOver = v === 'schedule' ? 'engine-snapshot.py cut --verb schedule --prose-id <id>'
      : `engine-snapshot.py resolve --rollout <rollout-note> --verb ${v} --prose-id <id>`
    if (!text.includes(handOver)) fail('prose-id')
  }
  const doc = collapse(t.doc)
  if (!doc.includes('a bare `$Id$` (no hex) is no id') ||
    !doc.includes('Only the id carried by the text being followed counts, never a hash of a file on disk')) fail('prose-id')
  for (const text of [t.doc, ...VERBS.map((v) => t[v])]) {
    if (/compar\w*[^.\n]*SKILL\.md[^.\n]*hash/i.test(text) || /hash[^.\n]*session root[^.\n]*SKILL\.md/i.test(text)) fail('prose-id')
  }

  // schedule: the cut block comes before § 0 and stops on any exit but 0 and 4; the prior's root rule names the
  // Primary for an unstamped prior; step 6 and S5 adopt each note they write.
  const sch = t.schedule
  const iCut = lineIndex(sch, /^### Cut the Engine snapshot, first/)
  const i0 = lineIndex(sch, /^### 0\. /)
  const cut = collapse(section(sch, /^### Cut the Engine snapshot, first/) ?? '')
  if (iCut < 0 || i0 < 0 || iCut > i0 || !cut.includes('**Exit 4**') || !cut.includes('**Any other exit** stops the run before anything is written') ||
    !cut.includes('`timeout: 600000`')) fail('schedule')
  const s0 = collapse(section(sch, /^### 0\. /) ?? '')
  if (!s0.includes("**The prior's root (ADR 0043).**") || !s0.includes('the Primary for an unstamped prior') ||
    !s0.includes('engine-snapshot.py resolve --rollout <the prior note where it sits>')) fail('schedule')
  const s6 = collapse(section(sch, /^### 6\. /) ?? '')
  const serial = collapse(section(sch, /^## Serial path/) ?? '')
  if (!s6.includes('engine-snapshot.py adopt --rollout') || !serial.includes('engine-snapshot.py adopt --rollout')) fail('schedule')

  // execute: § 1.5 before § 2; move.due for both shapes; nothing else cuts; the handle drop at a moved Reinstate;
  // retire after the ceremony's commit, before its /thread:close; § 5's scriptPath from the engine root.
  const ex = t.execute
  const i15 = lineIndex(ex, /^### 1\.5\. Engine snapshot \(ADR 0043\)/)
  const i2 = lineIndex(ex, /^### 2\. /)
  const s15 = collapse(section(ex, /^### 1\.5\. /) ?? '')
  if (i15 < 0 || i2 < 0 || i15 > i2) fail('execute')
  if (!s15.includes('`move.due`') || !s15.includes('a hard-paused parallel note') || !s15.includes('a Leg closed `stopped`') ||
    !s15.includes('A launch, a heartbeat, a cold resume, a Stage re-send or a repair hand-off cuts no snapshot')) fail('execute')
  if (!s15.includes('**Exit 2** (a usage error') || !s15.includes('reason="engine snapshot resolve failed"') ||
    !s15.includes('a lead never goes on to § 2 from the rendered root')) fail('execute')
  const s45 = collapse(section(ex, /^### 4\.5\. /) ?? '')
  if (!s45.includes("drop this session's runIds and signed-gate handles from the old snapshot's calls")) fail('execute')
  if (!before(s45, '**Retire unneeded snapshots**', '**Close out the associated thread, last:**') ||
    !before(s45, 'commit -m <msg> --', '**Retire unneeded snapshots**')) fail('execute')
  const s5 = collapse(section(ex, /^### 5\. /) ?? '')
  if (!s5.includes("`${CLAUDE_PLUGIN_ROOT}` here is the rollout's engine root") || !s5.includes('the heartbeat prompt\'s command text')) {
    fail('execute')
  }

  // execute-pointers: every exit-2 route a guard can take points at the re-run rule.
  const s7 = collapse(section(ex, /^### 7\. /) ?? '')
  const PTR = 'starts `engine-snapshot:`'
  if (!s45.includes(`except an exit 2 whose stderr line ${PTR}`) || !s45.includes(`| 2 | Halt, unless its stderr line ${PTR}`) ||
    !s7.includes('an exit 2 whose stderr line starts `engine-snapshot:` is no halt') || !s7.includes('(but an `engine-snapshot:` stderr line, a wrong root')) {
    fail('execute-pointers')
  }

  // sign-off: § 1.5, the § 4.5 Reinstate's sign-off sentence and § Pausing's sign-off paragraph each say it never moves.
  const pausing = collapse(section(ex, /^## Pausing \+ reinstating a rollout/) ?? '')
  const reinstate = collapse(ex.split('\n').find((l) => l.includes('A note that also carries `paused_for: sign-off` (step 5')) ?? '')
  const signOffPara = collapse(ex.split('\n').find((l) => l.startsWith('**A sign-off pause** (§ 4.5 step 5')) ?? '')
  if (!s15.includes('**A sign-off pause** (`paused_for: sign-off`) never moves') ||
    !reinstate.includes('(step 5\'s sign-off form; it never moves the Engine snapshot, § 1.5)') ||
    !signOffPara.includes('It never moves the Engine snapshot (§ 1.5)') || !pausing.includes('It never moves the Engine snapshot')) fail('sign-off')

  // doc: engine-snapshot.md cites plugin-root.md, states the toplevel test, the sign-off rule, the archived grace and
  // the Leg close's re-resolve.
  const refusal = collapse(section(t.doc, /^## The refusal rule/) ?? '')
  const another = collapse(section(t.doc, /^## Another rollout's commands/) ?? '')
  if (!refusal.includes('`reconcile-rollout.py`, every verb but `status` and `fold-journals`') ||
    !refusal.includes('a task-keyed verb with `--rollout` left off') || !another.includes("orient-all's Sign-off")) fail('doc')
  if (!t.doc.includes('`${CLAUDE_PLUGIN_ROOT}/skills/_shared/plugin-root.md`') ||
    !doc.includes('The plugin root counts only when it is the toplevel of its own work tree') ||
    !doc.includes('A sign-off pause never moves') || !doc.includes('its reinstate keeps the signed-gate handles') ||
    !doc.includes('archived [[<slug>]] within 24h') ||
    !doc.includes('A Leg\'s close re-resolves when its root no longer holds `skills/execute/scripts/leg.py`')) fail('doc')

  // legs: the header's engine root; § Complete step 4 retires, step 5 is still /thread:close; both templates' step 6.
  const legs = collapse(t.legs)
  const complete = (section(t.legs, /^## Complete/) ?? '').split('\n')
  const step4 = collapse(complete.find((l) => l.startsWith('4. ')) ?? '')
  const step5 = collapse(complete.find((l) => l.startsWith('5. ')) ?? '')
  if (!legs.includes("It is read from the chain's engine root") || !step4.includes('engine-snapshot.py retire') ||
    !step5.startsWith('5. `/thread:close`')) fail('legs')
  for (const tpl of [t.tpl, t.serialTpl]) {
    const s6l = tpl.split('\n').find((l) => l.startsWith('6. ')) ?? ''
    if (!s6l.includes('Then run `engine-snapshot.py retire` (engine-snapshot.md § Retirement).')) fail('legs')
  }

  // close: § Under a Leg runs leg.py from the engine root and re-resolves when that root no longer holds leg.py.
  const ul = collapse(section(t.close, /^## Under a Leg/) ?? '')
  if (!ul.includes('`${CLAUDE_PLUGIN_ROOT}/skills/_shared/engine-snapshot.md`') ||
    !ul.includes("runs from the rollout's engine root")) fail('close')
  if (!ul.includes('When that root no longer holds `skills/execute/scripts/leg.py`') ||
    !ul.includes('engine-snapshot.py resolve --rollout <note>` again and use the `root` it prints')) fail('close')

  // status: § 1 resolves first, reports an unusable snapshot and goes on; § 4's three Engine forms.
  const st1 = collapse(section(t.status, /^### 1\. /) ?? '')
  const st4 = collapse(section(t.status, /^### 4\. /) ?? '')
  if (!st1.includes('**Engine snapshot first (ADR 0043).**') || !st1.includes('`ENGINE SNAPSHOT UNUSABLE: <why>`') ||
    !st1.includes('go on from the session root')) fail('status')
  if (!st1.includes('`ENGINE SNAPSHOT RESOLVE FAILED: <its stderr line>` and stop, with nothing read from the rendered root')) fail('status')
  for (const form of ['`Engine: snapshot <sha12> (<a> ahead, <b> behind the Primary checkout at <head12>)`', '`Engine: Primary checkout (no snapshot)`',
    '`Engine: plugin cache <root> (no snapshot)`']) if (!st4.includes(form)) fail('status')

  // repair: § 1 resolves first; exit 3 stops the run with the remedy; a hand-off cuts nothing.
  const rp1 = collapse(section(t.repair, /^### 1\. /) ?? '')
  if (!rp1.includes('**Engine snapshot first (ADR 0043).**') || !rp1.includes('Exit 3 (the snapshot is gone, moved or edited) stops the run') ||
    !rp1.includes('a hand-off cuts nothing')) fail('repair')
  if (!rp1.includes('or any other exit but 0 and 3, stops it the same way') || !rp1.includes('nothing runs from the rendered root')) fail('repair')

  // plugin-root: the When-it-applies bullet and rule 1's engine-root sentence.
  const pr = collapse(t.pluginRoot)
  if (!pr.includes("read from that rollout's Engine snapshot after its hand-over") ||
    !pr.includes("A rollout's commands take their root from `${CLAUDE_PLUGIN_ROOT}/skills/_shared/engine-snapshot.md`")) fail('plugin-root')

  // context: Engine root; Reinstate's serial and sign-off sentences; Sign-off pause never moves; the Primary's toplevel.
  if (!entry(t.context, 'Engine root').includes('its **Engine snapshot**; for a note that names none, the **Primary checkout**') ||
    !entry(t.context, 'Reinstate').includes('the first Leg begun after a Leg closed `stopped`') ||
    !entry(t.context, 'Reinstate').includes("never a **Sign-off pause**'s reinstate") ||
    !entry(t.context, 'Sign-off pause').includes('never moves the Engine snapshot') ||
    !entry(t.context, 'Primary checkout').includes("The plugin root counts only as its own work tree's toplevel")) fail('context')

  // adr: the serial, sign-off and grace consequences, and the prose id as the only evidence.
  const adr = collapse(t.adr)
  if (!adr.includes('its Reinstate is the first Leg begun after a Leg closed `stopped`') ||
    !adr.includes('A sign-off pause (ADR 0034) is the engine\'s own pause') || !adr.includes('its signed-gate handles keep their cache replay') ||
    !adr.includes('Retirement waits a grace (24 h) after the archive') || !adr.includes('a disk hash is never that evidence')) fail('adr')
  return fails
}

const RULES = ['ident', 'prose-id', 'schedule', 'execute', 'execute-pointers', 'sign-off', 'doc', 'legs', 'close', 'status', 'repair',
  'plugin-root', 'context', 'adr']
const CONTROLLED = new Set()

// edit(key, from, to): the real texts with one swap in one file; asserts the swap applies.
function edit(key, from, to) {
  assert.ok(real[key].includes(from), `the control's text is in ${key}: ${from.slice(0, 80)}`)
  return { ...real, [key]: real[key].replace(from, () => to) }   // a function: `$` in the texts is never a pattern
}
function only(texts, rule, why) {
  CONTROLLED.add(rule)
  assert.deepEqual(check(texts), [rule], why)
}

test('the real tree holds every rule', () => {
  assert.deepEqual(check(real), [])
})

test('control: a dropped ident line fails ident', () => {
  only(edit('attrs', 'skills/status/SKILL.md ident\n', ''), 'ident', 'status loses ident')
})

test('control: a deleted marker, and a disk-hash sentence, fail prose-id', () => {
  for (const v of VERBS) {
    const m = real[v].match(MARKER)[0]
    only(edit(v, `This text's prose id: \`${m}\``, "This text's prose id: `none`"), 'prose-id', `${v} loses its marker`)
  }
  only(edit('doc', '## When resolve runs', "Compare the session root's SKILL.md hash with the snapshot's to decide.\n\n## When resolve runs"),
    'prose-id', 'a disk-hash rule in the doc')
  only(edit('execute', '--verb execute --prose-id <id>', '--verb execute'), 'prose-id', 'resolve passes no id')
})

test('control: a cut after § 0, and a prior run from this snapshot, fail schedule', () => {
  const sch = real.schedule
  const block = section(sch, /^### Cut the Engine snapshot, first/)
  const moved = sch.replace(block + '\n', () => '').replace('### 1. Discover tasks', () => `${block}\n### 1. Discover tasks`)
  only({ ...real, schedule: moved }, 'schedule', 'cut block after § 0')
  only(edit('schedule', 'the Primary for an unstamped prior', "this run's snapshot"), 'schedule', 'the prior runs from the new snapshot')
})

test('control: a heartbeat that cuts, and a retire after /thread:close, fail execute', () => {
  only(edit('execute', 'A launch, a heartbeat, a cold resume, a Stage re-send or a repair hand-off cuts no snapshot',
    'A launch or a cold resume cuts no snapshot'), 'execute', 'heartbeat not named')
  const ex = real.execute
  const i = ex.indexOf('   - **Retire unneeded snapshots**')
  const j = ex.indexOf('\n', i)
  const line = ex.slice(i, j + 1)
  const moved = ex.replace(line, () => '').replace('\n\n   A done rollout left sitting in `Work/Tasks/`', () => `\n${line}\n   A done rollout left sitting in \`Work/Tasks/\``)
  only({ ...real, execute: moved }, 'execute', 'retire after the close')
})

test('control: § 1.5 without its resolve exit-2 halt fails execute', () => {
  const ex = real.execute
  const i = ex.indexOf('- **Exit 2** (a usage error')
  const line = ex.slice(i, ex.indexOf('\n', i) + 1)
  only(edit('execute', line, ''), 'execute', 'no exit-2 halt')
})

test('control: the refusal rule naming only --rollout verbs fails doc', () => {
  only(edit('doc', 'so a task-keyed verb with `--rollout` left off', 'so a verb with no `--rollout`'), 'doc', 'task-keyed verbs dropped')
})

test('control: a merge-task exit 2 that always halts fails execute-pointers', () => {
  only(edit('execute', '| 2 | Halt, unless its stderr line starts `engine-snapshot:` (a wrong root, § 1.5): re-run the same call once from the root it names |',
    '| 2 | Halt |'), 'execute-pointers', 'step 4 table')
})

test('control: § 1.5 without the sign-off sentence fails sign-off', () => {
  only(edit('execute', '- **A sign-off pause** (`paused_for: sign-off`) never moves: `move.due` is false, and its reinstate runs on the note\'s snapshot with this session\'s signed-gate handles (engine-snapshot.md), which keep their cache replay.\n', ''),
    'sign-off', '§ 1.5 drops it')
})

test('control: the doc without its sign-off sentence fails doc', () => {
  only(edit('doc', 'A sign-off pause\nnever moves:', 'A sign-off pause\nmoves too:'), 'doc', 'sign-off dropped from the doc')
})

test('control: § Complete step 4 without retire fails legs', () => {
  only(edit('legs', ' Then `python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/engine-snapshot.py retire`, best-effort', ' Then nothing'),
    'legs', 'no retire at Complete')
})

test('control: close § Under a Leg without its re-resolve fails close', () => {
  only(edit('close', 'When that root no longer holds `skills/execute/scripts/leg.py` (a snapshot retired after its grace), run `python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/engine-snapshot.py resolve --rollout <note>` again and use the `root` it prints: an archived note whose snapshot is gone resolves to the unstamped root, where the guard passes.', ''),
    'close', 're-resolve dropped')
})

test('control: status halting on an unusable snapshot fails status', () => {
  only(edit('status', 'and go on from the session root', 'and stop'), 'status', 'status stops')
})

test('control: repair cutting on its hand-off fails repair', () => {
  only(edit('repair', 'a hand-off cuts nothing', 'a hand-off cuts a fresh snapshot'), 'repair', 'repair cuts')
})

test('control: plugin-root.md without the engine-root sentence fails plugin-root', () => {
  only(edit('pluginRoot', "A rollout's commands take\n   their root from", 'Commands take\n   their root from'), 'plugin-root', 'rule 1 sentence')
})

test('control: CONTEXT.md\'s Reinstate moving a sign-off pause fails context', () => {
  only(edit('context', "never\n  a **Sign-off pause**'s reinstate.", "a\n  **Sign-off pause**'s reinstate too."), 'context', 'Reinstate')
})

test('control: ADR 0043 without the grace bullet fails adr', () => {
  only(edit('adr', '- Retirement waits a grace (24 h) after the archive', '- Retirement is immediate after the archive'), 'adr', 'grace bullet')
})

test('the rules are all named (14) and each has a control', () => {
  assert.equal(RULES.length, 14)
  assert.deepEqual(RULES.filter((r) => !CONTROLLED.has(r)), [])
})
