// A Cap is a promise (ADR 0038 decisions 1-2, p23-1): a spend Gated input is ONE line, `spend: <what> — cap N USD`,
// whose Cap holds the whole spend, with how it splits in nested sub-bullets; the plan judge prices it while the
// standing approval is on.
//
// Pins, in the engine's rendered prompts (skills/execute/task.workflow.js): the planner's and the plan reviser's Gated
// inputs line, the plan judge's checklist bullet (sub-bullets allowed), its pricing fragment while args.gatePricer is
// set (each parsed spend gate with a ready `exposure -` command on stdin, the approved-gate exemption, gateBounce, the
// usd-null rule that bounces only a gate the pricer could not price, with PLAN_JUDGE_PRICED's gateBounce description
// saying the same, and the capless rule that keeps a gate without exactly one cap on ADR 0008's automatic `changes`),
// the fragment's absence without a pricer or a spend gate, and the mid-run agents' GATED_INPUTS_CHECK and IMPL_RESULT.
// The engine's bounce mark and reconcile-rollout.py's, which writes the bounce under `## Gate bounce (awaiting
// sign-off)`. In prose: schedule § 7's Planner line and reshuffle R5.2's copy of it; execute § 3.7's *The Cap's
// format*, § 4's `gatePricer` args and *Resolve `gatePricer`*, § 3's table row and § 6's bounce line;
// reconcile-rollout.py's `gate-pricer` verb; CONTEXT.md's Cap entry.
//
// Same shape as execute-standing-approval.test.mjs: every rule lives in one function, checkCap(files, E), returning
// named failures, so the real text and the controls run through identical logic; each control mutates one place and
// must fail with exactly its rule. The required control that drops the judge check swaps in a planJudgePrompt with
// gatePricingBlock removed: it fails judge-check, judge-capless and judge-absent's positive half, and nothing else.
// Behaviour is pinned elsewhere: tests/gated-inputs.test.mjs (`exposure -`), skills/execute/tests/task-engine.test.mjs
// (the bounce), prompt-invariants (the parse and the byte pins) and reconcile-rollout-standing.test.sh (gate-pricer, and
// S8: a bounced note the standing approval never signs).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { collapse, read, section } from '../lib/contract-text.mjs'
import { loadEngine } from '../lib/engine.mjs'

const real = {
  execute: read('skills/execute/SKILL.md'),
  schedule: read('skills/schedule/SKILL.md'),
  reshuffle: read('skills/orient/reshuffle.md'),
  reconcile: read('skills/execute/scripts/reconcile-rollout.py'),
  context: read('CONTEXT.md'),
}
const ENGINE = loadEngine(['plannerPrompt', 'planReviserPrompt', 'planJudgePrompt', 'gatePricingBlock', 'GATED_INPUTS_CHECK',
  'IMPL_RESULT', 'rungState', 'PLAN_JUDGE_PRICED', 'BOUNCE_MARK'])

const PRICER = '/home/x/.claude/plugins/cache/thread/thread/4.1.0/skills/_shared/scripts/gated_inputs.py'
const GATE = 'spend: claude plugin eval re-runs of the two close cases — cap 24 USD'
const PLAN_SPEND = `Planned on: abc\n### Files to modify\n- x\n### Gated inputs\n- ${GATE}\n  - up to 6 invocations at --max-cost-usd 4\n- credential: PROD_API_KEY\n### Risks / unknowns\n- none`
const PLAN_NONE = 'Planned on: abc\n### Files to modify\n- x\n### Gated inputs\nNone\n### Risks / unknowns\n- none'
const TASK = { slug: 'proj-cap', taskPath: '/vault/Tasks/proj-cap.md', scope: 'cross-cutting', maxIterations: 3 }
const A0 = { repoPath: '/repo', rolloutSlug: 'proj-rollout', verifier: 'make test' }
const AP = { ...A0, gatePricer: PRICER }

const S3 = /^### 3\. /
const S37 = /^### 3\.7\. /
const S4 = /^### 4\. /
const S6 = /^### 6\. /
const SCH7 = /^### 7\. /
const R5 = /^## R5\. /

// A bold-labelled paragraph inside a section, to the next bold label at column 0, collapsed.
function labelled(text, sectionRe, label) {
  const lines = (section(text, sectionRe) ?? '').split('\n')
  const i = lines.findIndex((l) => l.startsWith(`**${label}`))
  if (i < 0) return ''
  const j = lines.findIndex((l, k) => k > i && /^\*\*[A-Z`]/.test(l))
  return collapse(lines.slice(i, j < 0 ? undefined : j).join('\n'))
}
const has = (hay, ...needles) => needles.every((n) => hay.includes(n))

function checkCap(f, E) {
  const fails = []
  const st = E.rungState({ slug: TASK.slug }, A0)
  const planner = collapse(E.plannerPrompt(TASK, A0, st, ''))
  const reviser = collapse(E.planReviserPrompt(TASK, PLAN_SPEND, [{ round: 1, feedback: ['x'] }], 2, A0))
  const jAbsentRaw = E.planJudgePrompt(TASK, PLAN_SPEND, A0)
  const jPricedRaw = E.planJudgePrompt(TASK, PLAN_SPEND, AP)
  const jNoneRaw = E.planJudgePrompt(TASK, PLAN_NONE, AP)
  const jPriced = collapse(jPricedRaw)

  // planner: one column-0 bullet per authorisation, the one-line Cap, the split in nested sub-bullets; bullets only
  // forbids prose and footnotes, never the sub-bullet commentary.
  if (!has(planner, 'one markdown bullet ("- ") at column 0 per human authorisation', '"- spend: <what> — cap N USD" (a hard cap is mandatory: ONE line whose Cap holds the whole spend',
    'How a spend splits (run counts, per-call limits, iterations) goes in sub-bullets nested two spaces under its gate: commentary the engine never prices, which the Cap must hold.',
    'BULLETS ONLY — no prose or footnotes in this section') || planner.includes('no prose, commentary,')) {
    fails.push('planner')
  }

  // reviser: the same one-line gate on revision.
  if (!reviser.includes('Gated inputs — bullets only: declare spend as one line `- spend: <what> — cap N USD` whose Cap holds the whole spend (its split in nested sub-bullets)')) {
    fails.push('reviser')
  }

  // judge-list: the checklist's gate bullet, with or without the pricer: column 0, one line WITH a hard cap, the
  // sub-bullet allowance, and the automatic `changes` for a missing section, a capless gate and non-bullet prose.
  for (const j of [collapse(jAbsentRaw), jPriced]) {
    if (!has(j, 'BULLETS at column 0 ("- spend: <what> — cap N USD", one line WITH a hard cap',
      'Nested sub-bullets under a gate are commentary (how a spend splits) and are allowed; an indented bullet is never a gate.',
      'a spend gate without a cap, or non-bullet prose in the section', 'is an automatic "changes" (ADR 0008)') || j.includes('commentary does not belong')) {
      if (!fails.includes('judge-list')) fails.push('judge-list')
    }
  }

  // judge-check: the fragment, priced: each parsed spend gate in a quoted heredoc on stdin, the approved-gate
  // exemption, the pricer's why quoted, the sub-bullet mismatch, gateBounce for a gates-only `changes`, and a gate still
  // unpriced after the bounce going to Lachy, never to the standing approval.
  if (!jPricedRaw.includes(`\`\`\`bash\npython3 -I '${PRICER}' exposure - <<'EOF'\n${GATE}\nEOF\n\`\`\``) ||
    !has(jPriced, 'Spend gate pricing (ADR 0038; the standing approval is on for this task)', 'Price each EXACTLY as shown, the gate on stdin, never as a shell argument',
      'Skip a gate the task note\'s "## Approved gates" section already holds', 'quote its "why" verbatim and ask for one Cap that holds the whole spend',
      'when its sub-bullets name spend its Cap does not hold', 'when such gates are your ONLY reason for "changes", list each in gateBounce exactly as shown above',
      'the engine sends the plan back once without a climb, and a gate still unpriced after that goes to Lachy for sign-off, never to the standing approval.') ||
    jPricedRaw.includes('credential: PROD_API_KEY\nEOF')) {
    fails.push('judge-check')
  }

  // judge-usd-null: gateBounce is only for a gate whose `exposure -` printed "usd": null. A gate that prices but whose
  // sub-bullets break its Cap is an ordinary `changes` (it climbs), never the bounce-then-gate-pending override; the
  // fragment and PLAN_JUDGE_PRICED's gateBounce description both say so.
  const bounceDesc = collapse(String(((E.PLAN_JUDGE_PRICED || {}).properties || {}).gateBounce?.description || ''))
  if (!has(jPriced, 'gateBounce is ONLY for gates whose "usd" printed null:',
    'Never list a gate whose "usd" is an amount: a gate that prices but whose sub-bullets name spend its Cap does not hold is an ordinary "changes" (its planner raises the Cap or trims the split), never a bounce.') ||
    !has(bounceDesc, 'every bullet is about spend gates whose `exposure -` printed "usd": null', 'Never a gate that priced (an amount in "usd"; its sub-bullets breaking its Cap is an ordinary changes)')) {
    fails.push('judge-usd-null')
  }

  // judge-capless: the fragment keeps a spend gate without exactly one cap on ADR 0008's automatic `changes`.
  if (!has(jPriced, 'Never list a gate whose own line has no `cap` amount, or more than one: a spend gate without exactly one cap is the automatic "changes" above (ADR 0008), never a bounce.',
    'A cap in another currency, such as `cap 30 AUD`, which the pricer also reports as "no cap clause", may be listed.')) {
    fails.push('judge-capless')
  }

  // judge-absent: the fragment renders with a pricer and a spend gate (positive half), and never without a pricer or
  // with no spend gate (the absent form is byte-identical: the schema stays PLAN_JUDGE, task-engine C6).
  if (!jPricedRaw.includes('Spend gate pricing (ADR 0038') ||
    jAbsentRaw.includes('Spend gate pricing') || jAbsentRaw.includes('exposure -') || jNoneRaw.includes('Spend gate pricing') || jNoneRaw.includes('exposure -')) {
    fails.push('judge-absent')
  }

  // mid-run: a gate found mid-run is written as the one-line Cap, its split in blockerDiagnosis; still a ceiling.
  const midRun = 'one line whose Cap holds the whole spend, with how it splits in blockerDiagnosis'
  if (!collapse(E.GATED_INPUTS_CHECK).includes(`"spend: <what> — cap N USD", ${midRun}`) ||
    !collapse(E.IMPL_RESULT.properties.gatedInputs.description).includes(`"spend: <what> — cap N USD", ${midRun}`) ||
    !collapse(E.GATED_INPUTS_CHECK).includes('an approved cap is a CEILING to respect, never a target')) {
    fails.push('mid-run')
  }

  // schedule-planner: § 7's Planner line asks for the one-line gate, its split in nested sub-bullets.
  const sPlanner = collapse((section(f.schedule, SCH7) ?? '').split('\n').find((l) => l.startsWith('- Planner:')) ?? '')
  if (!has(sPlanner, 'word each spend gate as one line whose Cap is one priceable total', '`spend: <what> — cap 50 USD per Login per month across 3 Logins`',
    'put how it splits (run counts, per-call limits, iterations) in sub-bullets nested under the gate, which the Cap must hold',
    "off the gate's own line (ADR 0038)")) {
    fails.push('schedule-planner')
  }

  // reshuffle-planner: R5.2's copy of the Planner line asks for the same.
  if (!collapse(section(f.reshuffle, R5) ?? '').includes('its Planner line asking for one line whose Cap is one priceable total, e.g. `cap 50 USD per Login per month across 3 Logins`, with its split in sub-bullets nested under the gate, ADR 0038')) {
    fails.push('reshuffle-planner')
  }

  // execute-37: *The Cap's format*: the judge prices through `exposure -`; approved gates exempt; only an unpriceable
  // gate bounces: a gates-only `changes` never climbs and bounces once, then gate-pending, never plan-blocked, with the
  // bounce line, which reconcile writes under `## Gate bounce (awaiting sign-off)`, where the standing approval signs
  // nothing; a priced gate whose sub-bullets break its Cap, and a capless or two-cap gate, stay a climbing `changes`;
  // no check while the standing approval is off.
  const cap37 = labelled(f.execute, S37, "The Cap's format (ADR 0038).")
  if (!has(cap37, 'A spend gate is **one line**, `spend: <what> — cap N USD`', "While § 4's `gatePricer` is set (the task's standing approval is on)",
    'through `gated_inputs.py exposure -`, the gate on stdin', 'A gate already in `## Approved gates` is exempt.',
    'Only a gate the pricer cannot price (its `exposure -` printed `"usd": null`) may be bounced', '**never climbs**', '**bounces at most once per call**',
    '**gate-pending, never plan-blocked**', "the row's blockerDiagnosis carries `bounced by the plan judge (ADR 0038)`",
    'Reconcile writes that paragraph under **`## Gate bounce (awaiting sign-off)`**', 'while it stands `approve-gates --standing` signs nothing on the note',
    'A gate that prices but whose sub-bullets name spend its Cap does not hold is an ordinary `changes`, which climbs',
    "A spend gate with no cap, or more than one, stays ADR 0008's automatic `changes`, which climbs.", 'With the standing approval off there is no check.') ||
    cap37.includes('the fail-closed pricer asks')) {
    fails.push('execute-37')
  }

  // execute-args: § 4 passes `gatePricer` from the read-only verb, on a plan-gated own call only, never on a resume,
  // and omits the key when it is empty or the verb fails; § 3's row says the verb reads the limit.
  const resolve = labelled(f.execute, S4, 'Resolve `gatePricer` (ADR 0038)')
  const row3 = collapse((section(f.execute, S3) ?? '').split('\n').find((l) => l.startsWith('| `spend_approval_usd` |')) ?? '')
  if (!(section(f.execute, S4) ?? '').includes('  "gatePricer": ') ||
    !has(resolve, "only for a task's own call (a start or restart) whose `task.planGate` is `true`", 'never for a resume',
      'python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/reconcile-rollout.py gate-pricer --tasks <slug> --rollout <rollout-note>',
      'pass its `gatePricer` when it is non-empty', 'omit the key: the check is off, nothing halts') ||
    !row3.includes('The lead never resolves it: `reconcile-rollout.py gate-pricer` reads it to decide `gatePricer` (§ 4, ADR 0038).')) {
    fails.push('execute-args')
  }

  // execute-report: § 6 prints the bounce on its one line per event, and reconcile persists it on the note.
  if (!collapse(section(f.execute, S6) ?? '').includes(`per gate-pending call whose blockerDiagnosis carries \`bounced by the plan judge (ADR 0038)\` ("[[task-k]] → gate-pending after the plan judge's bounce (ADR 0038): <its first feedback bullet>", § 3.7: reconcile also writes the paragraph under \`## Gate bounce (awaiting sign-off)\``)) {
    fails.push('execute-report')
  }

  // bounce-mark: reconcile-rollout.py finds the engine's bounce paragraph by the engine's own mark and writes it under
  // `## Gate bounce (awaiting sign-off)`.
  if (typeof E.BOUNCE_MARK !== 'string' || !E.BOUNCE_MARK || !f.reconcile.includes(`GATE_BOUNCE_MARK = "${E.BOUNCE_MARK}"`) ||
    !f.reconcile.includes('GATE_BOUNCE_SECTION = "## Gate bounce (awaiting sign-off)"')) {
    fails.push('bounce-mark')
  }

  // reconcile-verb: the docstring names gate-pricer as read-only, and it is wired.
  if (!f.reconcile.includes('  gate-pricer  Read-only (ADR 0038;') || !f.reconcile.includes('sub.add_parser("gate-pricer"') ||
    !collapse(f.reconcile).includes('It writes nothing and records no Run-record event.')) {
    fails.push('reconcile-verb')
  }

  // context: the Cap entry says the plan judge sends an unpriceable Cap back once, without a climb, and one still
  // unpriced goes to Lachy, never to the Standing approval.
  if (!collapse(f.context).includes('While the Standing approval is on, the plan judge prices the line and sends a Cap that does not price back to its planner once, without a climb; one still unpriced then goes to Lachy, never to the Standing approval (ADR 0038).')) {
    fails.push('context')
  }
  return fails
}

test('the engine prompts, execute, schedule, reshuffle, reconcile-rollout.py and CONTEXT.md hold every Cap rule', () => {
  assert.deepEqual(checkCap(real, ENGINE), [])
})

// ---- controls: each mutates one place and must fail with exactly its rule ----------------------------------------

const RULES = ['planner', 'reviser', 'judge-list', 'judge-check', 'judge-usd-null', 'judge-capless', 'judge-absent', 'mid-run',
  'schedule-planner', 'reshuffle-planner', 'execute-37', 'execute-args', 'execute-report', 'bounce-mark', 'reconcile-verb', 'context']
const CONTROLLED = new Set()

function edit(text, from, to) {
  const hit = typeof from === 'string' ? text.includes(from) : from.test(text)
  assert.ok(hit, `control setup: ${String(from).slice(0, 80)} not found`)
  return text.replace(from, to)
}
const onlyFile = (file, from, to, rule, label) => {
  CONTROLLED.add(rule)
  assert.deepEqual(checkCap({ ...real, [file]: edit(real[file], from, to) }, ENGINE), [rule], label)
}
const onlyEngine = (over, rules, label) => {
  for (const r of rules) CONTROLLED.add(r)
  assert.deepEqual(checkCap(real, { ...ENGINE, ...over }), rules, label)
}

test('control: the judge check dropped (gatePricingBlock removed from planJudgePrompt) fails judge-check, judge-usd-null, judge-capless and judge-absent only', () => {
  const dropped = (t, p, a) => ENGINE.planJudgePrompt(t, p, a).replace(ENGINE.gatePricingBlock(a, p), '')
  assert.notEqual(dropped(TASK, PLAN_SPEND, AP), ENGINE.planJudgePrompt(TASK, PLAN_SPEND, AP), 'the control removes the fragment')
  onlyEngine({ planJudgePrompt: dropped }, ['judge-check', 'judge-usd-null', 'judge-capless', 'judge-absent'], 'no pricing fragment')
})

test('control: a fragment that bounces a priced gate (the usd-null rule removed) fails judge-usd-null', () => {
  const loose = (...x) => ENGINE.planJudgePrompt(...x).replace(/gateBounce is ONLY for gates whose "usd" printed\s+null: /, '')
    .replace(/Never list a gate whose "usd" is an amount:[\s\S]*?never a bounce\.\s+/, '')
  const priced = ENGINE.planJudgePrompt(TASK, PLAN_SPEND, AP)
  assert.equal(priced.length - loose(TASK, PLAN_SPEND, AP).length > 200, true, 'the control removes both sentences')
  onlyEngine({ planJudgePrompt: loose }, ['judge-usd-null'], 'priced gates bounce')
})

test("control: PLAN_JUDGE_PRICED's old gateBounce description fails judge-usd-null", () => {
  const P = ENGINE.PLAN_JUDGE_PRICED
  const old = { ...P, properties: { ...P.properties, gateBounce: { ...P.properties.gateBounce, description: "ONLY on a changes verdict whose every bullet is about spend gates' format: each such gate exactly as the prompt lists it, never one without exactly one cap; empty otherwise" } } }
  onlyEngine({ PLAN_JUDGE_PRICED: old }, ['judge-usd-null'], 'old description')
})

test('control: a planner that keeps the split on the gate line fails planner', () => {
  onlyEngine({ plannerPrompt: (...x) => edit(ENGINE.plannerPrompt(...x), /How a spend splits[\s\S]*?which the Cap must hold\. /, '') }, ['planner'], 'no sub-bullets')
})

test('control: a reviser with the old hard-cap wording fails reviser', () => {
  onlyEngine({ planReviserPrompt: (...x) => edit(ENGINE.planReviserPrompt(...x), /declare spend as one line[\s\S]*?\(its split in nested sub-bullets\)/, 'declare spend with a hard cap') }, ['reviser'], 'old wording')
})

test('control: a checklist that forbids sub-bullets fails judge-list', () => {
  onlyEngine({ planJudgePrompt: (...x) => edit(ENGINE.planJudgePrompt(...x), /Nested sub-bullets under a gate[\s\S]*?never a gate\./, 'Commentary does not belong there.') }, ['judge-list'], 'no allowance')
})

test('control: a fragment without the capless rule fails judge-capless', () => {
  onlyEngine({ planJudgePrompt: (...x) => ENGINE.planJudgePrompt(...x).replace(/Never list a gate whose own line[\s\S]*?never a bounce\./, '') }, ['judge-capless'], 'capless bounced')
})

test('control: a fragment that names the gate as a shell argument fails judge-check', () => {
  onlyEngine({ planJudgePrompt: (...x) => ENGINE.planJudgePrompt(...x).replace(/exposure - <<'EOF'\n(.*)\nEOF/g, "exposure '$1'") }, ['judge-check'], 'argv gate')
})

test('control: a fragment rendered without a pricer fails judge-absent', () => {
  onlyEngine({ planJudgePrompt: (t, p, a) => ENGINE.planJudgePrompt(t, p, { ...a, gatePricer: PRICER }) }, ['judge-absent'], 'always on')
})

test('control: the old GATED_INPUTS_CHECK example fails mid-run', () => {
  onlyEngine({ GATED_INPUTS_CHECK: edit(ENGINE.GATED_INPUTS_CHECK, /"spend: <what> — cap N USD"[\s\S]*?blockerDiagnosis \//, '"spend: <what> — cap <amount>" /') }, ['mid-run'], 'old example')
})

test('control: a Planner line without the sub-bullets fails schedule-planner', () => {
  onlyFile('schedule', 'put how it splits (run counts, per-call limits, iterations) in sub-bullets nested under the gate, which the Cap must hold, and ', '',
    'schedule-planner', 'no sub-bullets')
})

test("control: R5.2's Planner clause without the split fails reshuffle-planner", () => {
  onlyFile('reshuffle', /, with its\s+split in sub-bullets nested under the gate, ADR 0038\)/, ')', 'reshuffle-planner', 'no split')
})

test('control: a format bounce that climbs fails execute-37', () => {
  onlyFile('execute', '**bounces at most once per call**', '**bounces until the last round**', 'execute-37', 'unbounded')
  onlyFile('execute', 'A gate already in `## Approved gates` is exempt. Only a gate', 'Only a gate', 'execute-37', 'no exemption')
})

test("control: *The Cap's format* that bounces a priced gate, or signs a bounced note at sign-off, fails execute-37", () => {
  onlyFile('execute', 'Only a gate the pricer cannot price (its `exposure -` printed `"usd": null`) may be bounced: a `changes` over such gates alone',
    "A `changes` over spend gates' format alone", 'execute-37', 'any gate bounces')
  onlyFile('execute', /Reconcile writes that paragraph under[\s\S]*?Lachy's sign-off removes the section\. /, 'At sign-off the fail-closed pricer asks with its why. ',
    'execute-37', 'the pricer signs it')
})

test('control: a gatePricer resolved on a resume fails execute-args', () => {
  onlyFile('execute', "never for a resume (the original-args rule above and § 5: a resume re-passes its call's own `gatePricer`, or none), ", '', 'execute-args', 'resume')
})

test('control: § 6 without the bounce line fails execute-report', () => {
  onlyFile('execute', "per gate-pending call whose blockerDiagnosis carries `bounced by the plan judge (ADR 0038)`", 'per bounce', 'execute-report', 'no line')
  onlyFile('execute', '§ 3.7: reconcile also writes the paragraph under `## Gate bounce (awaiting sign-off)`', '§ 3.7: reconcile writes only the gate bullets for gate-pending',
    'execute-report', 'not persisted')
})

test("control: an engine bounce mark reconcile-rollout.py does not find fails bounce-mark", () => {
  onlyEngine({ BOUNCE_MARK: 'bounced by the plan judge:' }, ['bounce-mark'], 'mark drift')
  onlyFile('reconcile', 'GATE_BOUNCE_SECTION = "## Gate bounce (awaiting sign-off)"', 'GATE_BOUNCE_SECTION = "## Gate bounce"', 'bounce-mark', 'section renamed')
})

test('control: gate-pricer unwired fails reconcile-verb', () => {
  onlyFile('reconcile', 'sub.add_parser("gate-pricer"', 'sub.add_parser("gate-price"', 'reconcile-verb', 'unwired')
})

test("control: CONTEXT.md's Cap entry without the bounce fails context", () => {
  onlyFile('context', /While the\s+Standing approval is on, the plan judge prices the line and sends a Cap that\s+does not price back to its planner once, without a climb; one still unpriced\s+then goes to Lachy, never to the Standing approval \(ADR 0038\)\./, '', 'context', 'no sentence')
  onlyFile('context', /; one still unpriced\s+then goes to Lachy, never to the Standing approval \(ADR 0038\)\./, ' (ADR 0038).', 'context', 'no sign-off clause')
})

test('the rules are all named (16) and each has a control', () => {
  assert.equal(RULES.length, 16)
  assert.deepEqual(RULES.filter((r) => !CONTROLLED.has(r)), [])
})
