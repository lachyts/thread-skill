// execute runs a serial rollout's Legs (ADR 0040, p24-3): the prose around skills/execute/legs.md and leg.py (their
// behaviour is pinned by tests/leg.test.sh, and land.sh --route by tests/land.test.sh case 74). Ten rules, one pure
// function, check(files), over { key: text }:
//   e1  routing: execute § 2's shape line sends a serial note to legs.md; § 1 and § Pausing say a serial note is never
//       paused; no product file still says Legs are not built yet;
//   e2  a Leg's order (preflight, smoke test, the inherited claim, fix tasks, new claims), up to five fresh claims, and
//       never closing mid-task;
//   e3  the review: the verbatim fresh-review ask (a session range, never a `...` range), § Session range and never §
//       Ranged scope, the resume point, no review-ledger.py and one round, a set-aside on non-convergence, done --review;
//   e4  set-aside: --revert, the halt and clear-halt, gates before any write, the standing approval, the chain goes on;
//   e5  fix tasks: `verifies:` on every fix, `fixes:` names the culprit (own: the task; chain: the later chain task;
//       outside and drift: none), the task stays done, its dependants held through `verifies:`;
//   e6  the hand-over and status: create_thread's fields (no brief, report_back on), a report per *closed* Leg, the §
//       Report table verbatim, never `running`, a `waiting` line from `next --waiting`, a labelled and pushed manual
//       hand-over;
//   e7  the close order (leg.py close before create_thread → pushes → /thread:close with the hand-over between 7 and
//       8 → handed → banner → ROLLOUT-STATUS), step 1's outcomes without a bare `complete` (it needs --reflection: §
//       Complete step 4), the lock and exit 5's retry-once, no question tool;
//   e8  the docs: CONTEXT's **Leg** and **Serial rollout** entries (the completion verify's detached verify tree
//       among its worktrees), execute § Scope's Legs sentence (that tree under `<state>/thread/completion-trees/`, not
//       a task worktree), ADR 0040's Decision line, its new bullet and its ADR 0055 amendment, the README row;
//   e9  close § Under a Leg: each rule (a follow-on after Complete filed with no pointer among them), placed after ##
//       Edge cases, no fence and no retired close:asks phrase, and the four appended pointers after their pinned
//       sentences;
//   e10 Complete: legs.md § Complete's five steps in order (phases, items, the score through close-score.py, close
//       with its --reflection, /thread:close) with the routed land follow-on, and the serial template's Post-rollout in
//       the same order (its seven steps); the completion verify before step 1 (ADR 0055): the read, `--run` and
//       `--wait` launches, the in-flight rule, the waiting line, its four halt reasons with the read's exit 1 or 2
//       mapped to `rollout note unreadable`, no origin read and no git-env canary; step 4's "not decided" refusal and
//       its summary line; line 7's `completion-verify --run` exception; the template's `completion_verifier:` preface;
//       execute § 3's row citing ADR 0055; and no product file still saying the serial chain does not run it.
// Each rule has a mutation control that must fail with exactly that rule. Phrase checks run on collapsed text. Reads
// files only.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { collapse, proseUnits, root, section, slice, read } from '../lib/contract-text.mjs'

const FILES = {
  legs: 'skills/execute/legs.md',
  execute: 'skills/execute/SKILL.md',
  close: 'skills/close/SKILL.md',
  context: 'CONTEXT.md',
  adr: 'docs/adr/0040-a-rollout-is-parallel-or-serial.md',
  readme: 'README.md',
  template: 'skills/schedule/serial-rollout-template.md',
}
const real = Object.fromEntries(Object.entries(FILES).map(([k, p]) => [k, read(p)]))

// Every product text file (skills/** outside skills/*/tests/, hooks/**, README.md, CONTEXT.md), for e1's sweep.
const SKILL_TESTS = /^skills\/[^/]+\/tests\//
function productTree() {
  const out = {}
  const walk = (dir) => {
    for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      if (e.name === '__pycache__' || e.name === '.DS_Store') continue
      const rel = `${dir}/${e.name}`
      if (e.isDirectory()) { if (!SKILL_TESTS.test(`${rel}/`)) walk(rel) } else if (e.isFile()) {
        const buf = fs.readFileSync(path.join(root, rel))
        if (!buf.includes(0)) out[rel] = buf.toString('utf8')
      }
    }
  }
  for (const d of ['skills', 'hooks']) walk(d)
  for (const f of ['README.md', 'CONTEXT.md']) out[f] = read(f)
  return out
}
const tree = productTree()
const INTERIM = ['no Leg runner', 'until execute runs Legs', 'until Legs ship', '(p24-3)']
// The words of the serial chain that did not run its completion verifier (ADR 0055 retired them).
const NOT_YET = ['does not run it yet', "A parallel rollout's only"]

const C = (s) => (s == null ? '' : collapse(s))
// A legs.md `## ` section, up to the next `## ` heading.
const sec = (text, name) => slice(text, new RegExp(`^## ${name}$`), /^## /) ?? ''
// The numbered items (`1. `…) of `text`, each with its continuation lines.
const items = (text) => {
  const out = []
  for (const l of (text ?? '').split('\n')) {
    if (/^\d+\. /.test(l)) out.push(l)
    else if (out.length && /^\s+\S/.test(l)) out[out.length - 1] += ` ${l.trim()}`
    else if (out.length && !l.trim()) continue
  }
  return out.map(C)
}
const entry = (text, name) => C(slice(text, new RegExp(`^- \\*\\*${name}\\*\\* — `), /^- \*\*|^#/))

const ASK = 'args `code xhigh session range on <top> from base <leg_base sha40>, paths set by hand at the resume point: ' +
  '<p1> <p2> …; Leg review (skills/execute/legs.md § Review): one round, no review-ledger.py, no fix re-dispatch`'
const TABLE = [
  '| Turn end | `state` and `reason` | Chorus Close | Stop hook |',
  '|---|---|---|---|',
  '| Mid-Leg, review in flight | `waiting reason="review in flight: [[t]]"` | *nothing yet* | allow |',
  '| Room stop | `waiting reason="room stop: …"` | *nothing yet* | allow |',
  '| Complete, completion verify running | `waiting reason="completion verify in flight"` | *nothing yet* | allow |',
  '| handoff, successor started | `done reason="handed off to Leg <N+1>"` after the banner | *closed*: reports to the origin, archives | allow |',
  '| handoff, manual | `halted reason="manual handoff: Leg <N+1> in <alias> from <folder>"` | demand | allow |',
  '| complete | `done` after the banner | *closed*: the final report | allow |',
  '| stuck | `halted reason="awaiting you: <k> set aside"` | demand | allow |',
  '| stopped | `halted reason="stopped: <reason>"` | demand | allow |',
  '| halt (incl. a second lock timeout) | `halted reason="halt: <reason>"` | demand | allow |',
  '| `begin` refused (exit 1, 3 or 4) | `halted reason="<refusal>"`, no /thread:close | demand | allow |',
]
const RETIRED_ASKS = ['never as a question (the banner stays last)', 'Close never asks:', 'Close never calls the question tool',
  'never a question, never a fought hook']
const POINTERS = [
  "The `not on origin/<default>` line is report-only too: no search, no candidate, whatever its queued or stranded count. Under a Leg, step 6 asks nothing (§ Under a Leg).",
  "Under `/thread:open save`, set `mode='--commit-only'` for every call, 7.2's other repos included: save stays commit-only (ADR 0028, Decision 6). Under a Leg, set `mode='--commit-only'` for each top in `leg.py close`'s `commit_only` list (§ Under a Leg).",
  'Skipped under `/thread:open save`: a checkpoint lands nothing. Skipped under a Leg (§ Under a Leg).',
  "the Stage takes that machine line out before it reads the sentence. A Leg's `ROLLOUT-STATUS:` line is a rollout lead's line here (§ Under a Leg).",
  '- **Under a Leg** → § Under a Leg',
]

function check(f, product = tree) {
  const fails = new Set()
  const details = []
  const flag = (rule, why) => { fails.add(rule); details.push(`${rule}: ${why}`) }
  const need = (rule, name, text, patterns) => {
    for (const p of patterns) {
      const ok = typeof p === 'string' ? C(text).includes(p) : p.test(C(text))
      if (!ok) flag(rule, `${name} does not contain ${p}`)
    }
  }
  const legs = f.legs ?? ''

  // ---- e1: routing ----
  need('e1', 'execute § 2', section(f.execute, /^### 2\. /), [
    'Then the shape (`shape:`; no key reads as parallel): `shape: serial` → run `${CLAUDE_PLUGIN_ROOT}/skills/execute/legs.md` instead of §§ 2.5–8, and write nothing here.'])
  need('e1', 'execute § 1', section(f.execute, /^### 1\. /), [
    'A serial note (`shape: serial`) is never paused: a Leg stops through `leg.py close --outcome stopped`',
    "and \"pause the rollout\" in a Leg means that", 'is not a reinstate', 'whose `begin` refuses it with its remedy'])
  need('e1', 'execute § Pausing', section(f.execute, /^## Pausing \+ reinstating/), [
    'A serial rollout is never paused: its Leg stops through `leg.py close --outcome stopped`'])
  for (const [rel, text] of Object.entries({ ...product, [FILES.legs]: legs, [FILES.execute]: f.execute })) {
    for (const w of INTERIM) if (text.includes(w)) flag('e1', `${rel} still holds ${w}`)
  }

  // ---- e2: order ----
  const entry2 = items(sec(legs, 'Entry'))
  const at = (re) => entry2.findIndex((x) => re.test(x))
  const order = [/git-env check/, /`leg\.py begin`/, /The preflight/, /The smoke test/, /inherited claimed task/,
    /Work the fix tasks/, /Claim new tasks one at a time/].map(at)
  if (order.some((i) => i < 0) || order.some((i, k) => k > 0 && i <= order[k - 1])) flag('e2', `§ Entry's order is ${order}`)
  need('e2', 'legs.md § Entry', sec(legs, 'Entry'), ['up to five fresh claims per Leg, fix tasks included',
    'The inherited task never counts', 'never mid-task'])

  // ---- e3: review ----
  const loop = sec(legs, 'The task loop')
  need('e3', 'legs.md § Review', loop, [ASK, '§ Session range, never § Ranged scope', 'from its `resume point`',
    'no `review-ledger.py`', 'exactly one review round', 'there is no second round',
    'A review that does not converge sets the task aside', 'leg.py done --task <t> --verify pass --review <abs doc>'])
  const ask = C(loop).match(/args `(code xhigh[^`]*)`/)?.[1] ?? ''
  if (!ask || ask.includes('...')) flag('e3', `the ask is a ranged scope or missing: ${ask}`)

  // ---- e4: set-aside ----
  need('e4', 'legs.md set-aside', loop, ['`--revert` reverts the task\'s trailered commits', '`--outcome halt`',
    '`leg.py clear-halt --reason <why>`', '**Gates, before any write.**', 'approve-gates --standing',
    'A gate never stops the chain', 'reverts nothing'])

  // ---- e5: fixes ----
  const fx = sec(legs, 'Fix tasks')
  need('e5', 'legs.md § Fix tasks', fx, ['Every fix task names t in `verifies:`', '`fixes:` names the culprit',
    't stays done', 'awaiting fix [[f]]', 'never stops the chain'])
  const row = (cause) => (fx.split('\n').find((l) => l.startsWith(`| \`${cause}`)) ?? '').split('|').map((c) => c.trim())
  if (!row('own')[3]?.startsWith('`[[t]]`')) flag('e5', `own's fixes: is ${row('own')[3]}`)
  if (!row('chain --culprit L')[3]?.startsWith('`[[L]]`')) flag('e5', `chain's fixes: is ${row('chain --culprit L')[3]}`)
  for (const c of ['outside', 'drift']) if (row(c)[3] !== 'none') flag('e5', `${c}'s fixes: is ${row(c)[3]}`)

  // ---- e6: hand-over and status ----
  const ho = sec(legs, 'Hand over')
  need('e6', 'legs.md § Hand over', ho, ['call `create_thread`', '`title`', '`prompt`', '`tldr`', '`cwd`', 'Pass no `brief`',
    'leave `report_back` at its default (on)', 'labelled `manual handoff`, and pushes it once', 'leg.py handed --started <id>',
    'leg.py handed --manual "<why>"'])
  const rep = sec(legs, 'Report')
  need('e6', 'legs.md § Report', rep, ['it is never `running`', 'a `waiting` turn end takes `leg.py next --waiting "<reason>"`\'s',
    'Every Leg whose Close reads *closed* reports to the origin when it closes', 'A `halted` or `waiting` Leg never reports'])
  const table = rep.split('\n').filter((l) => l.startsWith('|'))
  if (JSON.stringify(table) !== JSON.stringify(TABLE)) flag('e6', 'legs.md § Report\'s table is not the pinned table')
  if (/state=running|`running reason/.test(rep)) flag('e6', 'legs.md § Report names a running line')

  // ---- e7: close order, concurrency, no question tool ----
  const cl = items(sec(legs, 'Close'))
  const ci = [/^1\. `leg\.py close .*before any `create_thread`/, /^2\. Push each `needs_you` item once/,
    /^3\. `\/thread:close`.*runs between sub-step 7 and step 8/, /^4\. `leg\.py handed`/,
    /^5\. close's banner, then the `ROLLOUT-STATUS:` line/].map((re) => cl.findIndex((x) => re.test(x)))
  if (ci.some((i, k) => i !== k)) flag('e7', `§ Close's steps are out of order: ${ci}`)
  const close1 = cl[0] ?? ''
  const cmd1 = (close1.match(/^1\. `([^`]*)`/) ?? ['', ''])[1]
  if (/\bcomplete\b/.test(cmd1) && !cmd1.includes('--reflection')) flag('e7', `§ Close step 1 offers complete without --reflection: ${cmd1}`)
  if (!close1.includes('closes in § Complete step 4 instead, with `--outcome complete --reflection`')) {
    flag('e7', '§ Close step 1 does not send a completing Leg to § Complete step 4')
  }
  need('e7', 'legs.md § Concurrency', sec(legs, 'Concurrency'), ['holds the rollout\'s lock', 'exit 5',
    'retry the verb once', '`halted reason="halt: rollout note locked"`'])
  need('e7', 'legs.md § Don\'ts', sec(legs, "Don'ts"), ['Never call the question tool in a Leg', 'Never make a Workflow call',
    'Never stamp `paused:` or `pause_requested:` on a serial note'])

  // ---- e8: docs ----
  need('e8', 'CONTEXT **Leg**', entry(f.context, 'Leg'), ['`leg.py begin`', 'the preflight', 'the smoke test',
    'up to five fresh claims', 'never closing mid-task', 'commit-only', 'reports to the origin'])
  need('e8', 'CONTEXT **Serial rollout**', entry(f.context, 'Serial rollout'), ['No task worktrees', 'execute runs its Legs',
    'A serial note is never paused', "the completion verify's detached verify tree outside the checkout"])
  const scopeLegs = C(section(f.execute, /^## Scope$/) ?? '')
  need('e8', 'execute § Scope', scopeLegs, ["A serial rollout's Legs (`legs.md`) write its task notes",
    'for a detached verify tree under `<state>/thread/completion-trees/` (not a task worktree)'])
  need('e8', 'ADR 0040', f.adr, ["with no task worktrees (a Leg's scratch revert aside, § Build-grill rulings)", 'Amended by ADR 0055',
    '**How a Leg runs** (the p24-3 plan, 2026-10-19)', '`verifies:`', 'refines the ruling\'s "`fixes:` that task"',
    '`land.sh --route`', 'A serial note is never paused'])
  need('e8', 'README /thread:execute row', (f.readme ?? '').split('\n').find((l) => l.startsWith('| `/thread:execute`')) ?? '',
    ['A serial rollout runs as Legs: this session works its tasks and hands the rest to a fresh Leg'])

  // ---- e9: close § Under a Leg ----
  const close = f.close ?? ''
  const lines = close.split('\n')
  const iEdge = lines.indexOf('## Edge cases')
  const iLeg = lines.indexOf('## Under a Leg')
  const iWhy = lines.indexOf('## Why this exists')
  if (!(iEdge >= 0 && iLeg > iEdge && iWhy > iLeg)) flag('e9', `## Under a Leg is not between ## Edge cases and ## Why this exists`)
  const ul = sec(close, 'Under a Leg')
  need('e9', 'close § Under a Leg', ul, ["sets `mode='--commit-only'` for each top in `commit_only`", 'Sub-step 7.9 is skipped',
    '`leg.py file-followup --title <t> --why <w>`', 'Each mark-done option becomes a statement row', '`Left for Lachy: …` row',
    "Rule (3)'s question line never prints", 'runs after sub-step 7 and before step 8', "prints after step 8's landing rows",
    "a Leg's `ROLLOUT-STATUS:` line is a rollout lead's line for rule (2)",
    'After Complete, `leg.py close` has already moved the note to `Archive/Rollouts/`: file-followup reads it there and files the task with no pointer'])
  if (/^\s*(```|~~~)/m.test(ul)) flag('e9', '§ Under a Leg holds a fenced block')
  for (const old of RETIRED_ASKS) if (C(ul).includes(old)) flag('e9', `§ Under a Leg holds ${old}`)
  for (const p of POINTERS) if (!C(close).includes(p)) flag('e9', `close does not hold: ${p}`)

  // ---- e10: Complete ----
  const cp = items(sec(legs, 'Complete'))
  const want = [/^1\. \*\*Phases\.\*\*/, /^2\. \*\*Post-rollout items\.\*\*/,
    /^3\. \*\*Score\.\*\* `python3 \$\{CLAUDE_PLUGIN_ROOT\}\/skills\/reflect\/scripts\/close-score\.py --rollout <rollout note> --close completion`/,
    /^4\. \*\*`leg\.py close --outcome complete .*--reflection "<step 3's line>"`/, /^5\. `\/thread:close`/]
  if (cp.length !== 5 || want.some((re, k) => !re.test(cp[k] ?? ''))) flag('e10', 'legs.md § Complete\'s steps are not phases, items, score, close, /thread:close')
  need('e10', 'legs.md § Complete step 4', cp[3] ?? '', ['`land.sh --route`', 'On `landable <d>`',
    "the chain's commits are only its `Task:`-trailered ones", 'On `not landed: <reason>` it files nothing'])
  // The completion verify (ADR 0055): the block before step 1, its launches, halts and exit mapping.
  const cpText = sec(legs, 'Complete')
  const pre = cpText.split('\n').slice(0, Math.max(0, cpText.split('\n').findIndex((l) => /^1\. /.test(l)))).join('\n')
  const RR = '`python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/reconcile-rollout.py completion-verify --rollout <rollout note>'
  need('e10', 'legs.md § Complete\'s completion verify', pre, ['**The completion verify (ADR 0055).**', `${RR}\``,
    `${RR} --run\``, `${RR} --wait\``, 'a `--run` or `--wait` this session launched is still running',
    '`leg.py next --waiting "completion verify in flight"`\'s `status_line`', 'no origin read and no git-env canary',
    '"completion verify: no verdict in three runs"', '"completion verify failed:', '"completion verify: rollout note unreadable"',
    '"completion verify: in flight past its deadline"', "the read's exit 1 or 2"])
  const bullets = proseUnits(pre)
  const inflight = bullets.find((u) => u.startsWith('- `in-flight` →')) ?? ''
  if (!inflight.includes(`${RR} --wait\``)) flag('e10', 'the in-flight bullet does not launch --wait')
  const unreadable = bullets.find((u) => u.includes('"completion verify: rollout note unreadable"')) ?? ''
  if (!unreadable.includes("the read's exit 1 or 2")) flag('e10', "the read's exit 1 is not mapped to rollout note unreadable")
  for (const u of bullets) {
    if (u.includes('"completion verify failed:') && /the read's exit 1\b/.test(u)) flag('e10', "the read's exit 1 is mapped to failed")
  }
  need('e10', 'legs.md § Complete step 4', cp[3] ?? '', ['refuses a completion verify that is not decided ("not decided"',
    "a decided one's `summary` is a Completion log line", "a red's fix task goes in the vault commit"])
  need('e10', 'legs.md line 7', legs.split('\n').find((l) => l.startsWith('Every vault and git write a Leg makes')) ?? '',
    ["except § Complete's own commands", '`reconcile-rollout.py completion-verify --run` writes the `## Completion verify log` line',
      'its read and `--wait` write nothing'])
  need('e10', 'the serial template § Post-rollout', section(f.template, /^## Post-rollout/) ?? '',
    ['When this note declares `completion_verifier:`, the Leg first runs it once on the chain checkout\'s HEAD'])
  const cvRow = (f.execute ?? '').split('\n').find((l) => l.startsWith('| `completion_verifier` |')) ?? ''
  need('e10', 'execute § 3\'s completion_verifier row', cvRow, ['`skills/execute/legs.md` § Complete, ADR 0055',
    'with no origin read and no git-env canary'])
  for (const [rel, text] of Object.entries({ ...product, [FILES.legs]: legs, [FILES.execute]: f.execute })) {
    for (const w of NOT_YET) if (C(text).includes(w)) flag('e10', `${rel} still holds ${w}`)
  }
  const tp = items(section(f.template, /^## Post-rollout/))
  const tw = [/phases/, /follow-on.*land-chain follow-on/, /`close-score\.py --rollout <this note> --close completion`/, /`status: done`/,
    /`## Completion log`/, /Archive\/Rollouts\/.*commit it/, /`\/thread:close`/]
  if (tp.length !== tw.length || tw.some((re, k) => !re.test(tp[k] ?? ''))) flag('e10', `the template's Post-rollout steps are not in the Complete order: ${tp.length}`)

  return { fails: [...fails].sort(), details }
}

test('execute runs a serial rollout\'s Legs: routing, order, review, set-aside, fixes, hand-over, close, docs and Complete', () => {
  const { fails, details } = check(real)
  assert.deepEqual(fails, [], details.join('\n'))
})

test('the product sweep reads the files e1 needs', () => {
  for (const f of ['skills/execute/SKILL.md', 'skills/execute/legs.md', 'skills/orient/SKILL.md', 'skills/_shared/vault-grammar.md',
    'skills/schedule/serial-rollout-template.md', 'skills/_shared/scripts/unfinished-rollout.py', 'CONTEXT.md', 'README.md']) {
    assert.ok(f in tree, `${f} is not swept`)
  }
})

// ---- controls: each mutates one real file in memory and must fail with exactly its rule -------------------------------

const only = (key, from, to, rules, label) => {
  assert.ok(real[key].includes(from), `control setup: ${String(from).slice(0, 70)} not in ${key}`)
  const { fails, details } = check({ ...real, [key]: real[key].replace(from, to) })
  assert.deepEqual(fails, rules, `${label}\n${details.join('\n')}`)
}

test('control: execute § 2 back to its interim stop fails e1', () => {
  only('execute', '`shape: serial` → run `${CLAUDE_PLUGIN_ROOT}/skills/execute/legs.md` instead of §§ 2.5–8, and write nothing here.',
    '`shape: serial` → print `serial rollouts have no Leg runner yet: nothing runs` and stop.', ['e1'], 'interim')
})
test('control: a § 1 that reinstates a paused serial note fails e1', () => {
  only('execute', 'A `paused:` or `pause_requested:` stamp on one is not a reinstate', 'A `paused:` stamp on one is a reinstate',
    ['e1'], 'reinstate')
})
test('control: the interim words in a product file fail e1', () => {
  const { fails } = check(real, { ...tree, 'skills/orient/SKILL.md': `${tree['skills/orient/SKILL.md']}\nNothing runs it until Legs ship.\n` })
  assert.deepEqual(fails, ['e1'])
})
test('control: a smoke test after the claims fails e2', () => {
  only('legs', '4. The smoke test (§ Smoke test).', '4. Run the smoke test later.', ['e2'], 'order')
})
test('control: a Leg that may close mid-task fails e2', () => {
  only('legs', 'It closes only between tasks, never mid-task.', 'It closes when its context is heavy.', ['e2'], 'mid-task')
})
test('control: an ask holding a ...HEAD range fails e3', () => {
  only('legs', 'session range on <top> from base <leg_base sha40>', 'review <leg_base sha40>...HEAD on <top>', ['e3'], 'range')
})
test('control: a review that runs the ledger fails e3', () => {
  only('legs', '§ Step 2, check 3, is skipped: no `review-ledger.py`.', '§ Step 2, check 3, runs `review-ledger.py`.', ['e3'], 'ledger')
})
test('control: a gate that stops the chain fails e4', () => {
  only('legs', 'A gate never stops the chain', 'A gate stops the chain', ['e4'], 'gate')
})
test('control: drift writing fixes: fails e5', () => {
  only('legs', '| `drift` | an external API, account or tool changed | none |', '| `drift` | an external API, account or tool changed | `[[t]]` |',
    ['e5'], 'drift')
})
test('control: a chain cause charging the failed task fails e5', () => {
  only('legs', '| `chain --culprit L` | a later chain task L broke t | `[[L]]`', '| `chain --culprit L` | a later chain task L broke t | `[[t]]`',
    ['e5'], 'chain')
})
test('control: a hand-over with a brief fails e6', () => {
  only('legs', 'Pass no `brief`', 'Pass a `brief`', ['e6'], 'brief')
})
test('control: a status table row that drifts fails e6', () => {
  only('legs', '| stuck | `halted reason="awaiting you: <k> set aside"` | demand | allow |',
    '| stuck | `done` | *closed* | allow |', ['e6'], 'table')
})
test('control: create_thread before leg.py close fails e7', () => {
  only('legs', '--cwd "$PWD"`, before any `create_thread`, so', '--cwd "$PWD"`, after `create_thread`, so', ['e7'], 'order')
})
test('control: § Close step 1 offering a bare complete fails e7', () => {
  only('legs', '1. `leg.py close --outcome handoff|stuck|stopped|halt [--reason <r>]', '1. `leg.py close --outcome handoff|complete|stuck|stopped|halt [--reason <r>]',
    ['e7'], 'complete')
})
test('control: a Leg that may call the question tool fails e7', () => {
  only('legs', '- Never call the question tool in a Leg:', '- Call the question tool when unsure:', ['e7'], 'question')
})
test('control: a Serial rollout entry back on "No worktrees" fails e8', () => {
  only('context', 'No task worktrees (leg.py\'s transient scratch\n  revert, and', 'No worktrees (leg.py\'s transient scratch\n  revert, and', ['e8'], 'worktrees')
})
test('control: a README row without Legs fails e8', () => {
  only('readme', ' A serial rollout runs as Legs: this session works its tasks and hands the rest to a fresh Leg.', '', ['e8'], 'readme')
})
test('control: § Under a Leg moved before ## Edge cases fails e9', () => {
  const ul = slice(real.close, /^## Under a Leg$/, /^## Why this exists$/)
  assert.ok(ul, 'control setup: no § Under a Leg')
  const moved = real.close.replace(`${ul}\n`, '').replace('## Edge cases\n', `${ul}\n## Edge cases\n`)
  const { fails } = check({ ...real, close: moved })
  assert.deepEqual(fails, ['e9'])
})
test('control: a waiting line built by hand fails e6', () => {
  only('legs', 'a `waiting` turn end takes `leg.py next --waiting "<reason>"`\'s, with', 'a `waiting` turn end is written by hand, with',
    ['e6'], 'waiting')
})
test('control: a pointer written into the archived note fails e9', () => {
  only('close', 'files the task with no pointer and no log line', 'files the task with a pointer in the archived note', ['e9'], 'archived')
})
test('control: a retired close:asks phrase in § Under a Leg fails e9', () => {
  only('close', 'and is pushed once (execute § 6.5).', 'and is pushed once (execute § 6.5). Close never asks: it pushes.', ['e9'], 'asks')
})
test('control: a step 6 pointer that rewords its pinned sentence fails e9', () => {
  only('close', 'whatever its queued or stranded count. Under a Leg', 'whatever its count. Under a Leg', ['e9'], 'pinned')
})
test('control: a Complete without the routed land follow-on fails e10', () => {
  only('legs', 'It asks land.sh\'s own route for each chain checkout (`land.sh --route`, read-only).',
    'It pushes each chain checkout.', ['e10'], 'route')
})
test('control: a Complete without its score step fails e10', () => {
  const s = real.legs.split('\n').find((l) => l.startsWith('3. **Score.**'))
  assert.ok(s, 'control setup: legs.md § Complete step 3')
  only('legs', `${s}\n`, '', ['e10'], 'score')
})
test('control: a close without --reflection fails e10', () => {
  only('legs', ' --reflection "<step 3\'s line>"`.**', '`.**', ['e10'], 'reflection')
})
test('control: a template Post-rollout with its phases step last fails e10', () => {
  const lines = real.template.split('\n')
  const i = lines.findIndex((l) => l.startsWith('1. Close the phases this chain touched'))
  const j = lines.findIndex((l) => l.startsWith('7. Run `/thread:close`'))
  assert.ok(i >= 0 && j > i, 'control setup: the template\'s steps 1 and 6')
  const moved = [...lines.slice(0, i), ...lines.slice(i + 1, j + 1), lines[i], ...lines.slice(j + 1)].join('\n')
  const { fails } = check({ ...real, template: moved })
  assert.deepEqual(fails, ['e10'])
})

test('control: § Scope\'s Legs sentence without the completion verify\'s tree fails e8', () => {
  only('execute', ' for a detached verify tree under `<state>/thread/completion-trees/` (not a task worktree)', '', ['e8'], 'scope tree')
})
test('control: the read\'s exit 1 mapped to failed fails e10', () => {
  only('legs', '  - 1 → § Close `--outcome halt --reason "completion verify failed:', '  - 1, or the read\'s exit 1 → § Close `--outcome halt --reason "completion verify failed:',
    ['e10'], 'read exit 1')
})
test('control: a completion verify with no --run launch fails e10', () => {
  only('legs', '- `run` or `rerun` → launch `python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/reconcile-rollout.py completion-verify --rollout <rollout note> --run` in the background',
    '- `run` or `rerun` → run the suite by hand', ['e10'], 'no --run')
})
test('control: the in-flight bullet without its --wait launch fails e10', () => {
  only('legs', 'launch `python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/reconcile-rollout.py completion-verify --rollout <rollout note> --wait` in the background with `timeout: 7200000`. Either way, end',
    'launch nothing either. Either way, end', ['e10'], 'no --wait')
})
test('control: the in-flight-past-its-deadline halt removed fails e10', () => {
  only('legs', 'still `in-flight` → § Close `--outcome halt --reason "completion verify: in flight past its deadline"`',
    'still `in-flight` → launch the wait again', ['e10'], 'past its deadline')
})
test('control: § Complete step 4 without the completion verify refusal fails e10', () => {
  only('legs', 'it also refuses a completion verify that is not decided ("not decided": run the block above first) and a value its reader refuses; ',
    'it also ', ['e10'], 'step 4 refusal')
})
test('control: line 7 without the completion-verify exception fails e10', () => {
  only('legs', ', except § Complete\'s own commands:', ', with no exception:', ['e10'], 'line 7')
})
test('control: "does not run it yet" re-added fails e10', () => {
  const { fails } = check(real, { ...tree, 'skills/orient/SKILL.md': `${tree['skills/orient/SKILL.md']}\nA serial chain's Complete does not run it yet.\n` })
  assert.deepEqual(fails, ['e10'])
})
