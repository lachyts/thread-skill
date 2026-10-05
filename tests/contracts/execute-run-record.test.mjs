// The lead's Run record calls (p15-2, ADR 0032). Every Slot and lane transition is recorded by the verb that
// makes it (reconcile-rollout.py, git-env-canary.py); the lead adds only the transitions that live in its own
// state, through four thin verbs. Pins the prose an LLM lead follows in skills/execute/SKILL.md § 4.5 *Run
// record*: each call and form, the end-before-launch and end-before-set-aside order, best-effort; that each new
// verb is documented in reconcile-rollout.py's docstring and wired in main(); and run_record.py's pairing rules,
// which every reader of the record (a Retro, the record suite's checker) relies on. The behaviour is pinned by
// skills/execute/tests/reconcile-rollout-record.test.sh. Reads files only.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { collapse, read, section } from '../lib/contract-text.mjs'

const skill = read('skills/execute/SKILL.md')
const rrs = read('skills/execute/scripts/reconcile-rollout.py')
const writer = read('skills/_shared/scripts/run_record.py')

// The bold-labelled paragraph `label` inside § 4.5: from its label line to the next bold label at column 0.
function labelled(text, label) {
  const lines = (section(text, /^### 4\.5\. /) ?? '').split('\n')
  const i = lines.findIndex((l) => l.startsWith(`**${label}`))
  if (i < 0) return ''
  const j = lines.findIndex((l, k) => k > i && /^\*\*[A-Z`]/.test(l))
  return collapse(lines.slice(i, j < 0 ? undefined : j).join('\n'))
}
const before = (hay, a, b) => hay.indexOf(a) >= 0 && hay.indexOf(b) >= 0 && hay.indexOf(a) < hay.indexOf(b)

// Every rule in one place, returning named failures, so the real text and the controls run through the same code.
function checkRunRecord(md) {
  const p = labelled(md, 'Run record.')
  const bad = []
  const need = (name, ok) => { if (!ok) bad.push(name) }
  need('paragraph', p.length > 0)
  need('names the record', p.includes('run_record.py') && p.includes('ADR 0032'))
  need('verbs record their own', /record their own transitions/.test(p) && /never writes an event by hand/.test(p))
  need('best-effort', p.includes('|| true') && /never route on its exit/.test(p))
  need('bind-run after every launch', /`bind-run --tasks <slug> --run-id <runId> --call task\|revise\|integrate` right after every Workflow launch/.test(p))
  need('bind-run integrate resume', p.includes('`--call integrate --resumed-from <old>`'))
  need('journal dir source', p.includes('CLAUDE_CODE_SESSION_ID') && p.includes('--journal-dir <abs>'))
  need('restart routing first', /\*Restart routing\* is resolved first/.test(p) && p.includes('`--start resume`') && p.includes('`--start revise`'))
  need('step 1.2 revise', /step 1\.2's seeded revise passes `--start revise`/.test(p))
  need('merge hold start', p.includes('`hold --tasks <slug> --hold merge --state start` on entering a *Merge hold*') && p.includes('exit 7'))
  need('merge hold end before launch and set-aside',
    p.includes("--state end` before each release's `merge-task.sh` launch and before a decline's set-aside row"))
  need('end before start order', before(p, '--hold merge --state start', '--hold merge --state end'))
  need('race hold', p.includes("`hold --tasks <slug> --hold race --state start` right after the RACE procedure's `## Race log` line")
    && /`mark-done`, `resume` or `defer` ends it/.test(p))
  need('free-lane', p.includes('`free-lane --tasks <slug>` when the lane-free rule fires') && /§ 7 halt that leaves the lane held/.test(p))
  need('record-pause', p.includes('`record-pause --rollout <rollout-note>` right after hard-pause step 1'))
  need('next never knows a merge hold', /`next` never knows a merge hold/.test(p))
  const pause = collapse(section(md, /^## Pausing \+ reinstating a rollout/) ?? '')
  need('hard pause step 1 points to record-pause', /1\. Stamp the rollout note by hand FIRST:.*record-pause --rollout <rollout-note> \|\| true/.test(pause))
  return bad
}

test('execute § 4.5 Run record: the lead\'s calls, their forms and order, best-effort', () => {
  assert.deepEqual(checkRunRecord(skill), [])
})

test('each new verb is documented in the module docstring and wired in main()', () => {
  const doc = rrs.slice(0, rrs.indexOf('\nimport argparse'))
  for (const verb of ['bind-run', 'free-lane', 'hold', 'record-pause']) {
    assert.ok(new RegExp(`^  ${verb}\\s`, 'm').test(doc), `${verb} documented`)
    assert.ok(rrs.includes(`sub.add_parser("${verb}"`), `${verb} wired`)
  }
  assert.ok(/^Run record \(p15-2, ADR 0032\)/m.test(doc), 'the Run record section')
  for (const s of ['set-aside stage, first match', 'reasonClass, first match', 'idle-slots reason, first match', 'Departures from the p15-2 brief']) {
    assert.ok(collapse(doc).includes(s), `docstring: ${s}`)
  }
  assert.ok(rrs.includes('"leadSetAside"'), 'reconcile reads leadSetAside')
  assert.ok(read('skills/execute/scripts/lead-integrate.py').includes('"leadSetAside": args.kind'), 'lead-integrate writes it')
})

test("run_record.py's reader rules carry the pairing rules", () => {
  const r = collapse(writer.slice(writer.indexOf('Reading the record'), writer.indexOf('Mirror contract')))
  for (const s of [
    "A slot-taken while that task's Slot is open is the same Slot and keeps the first `start`",
    'A slot-freed or lane-freed with nothing open for that task is ignored',
    'A lane-taken while the same task holds the lane is the same holding; while another task holds it, that holding ends there, flagged as unrecorded',
    'A hold-started while that (hold, task) is open is the same hold',
    "A lane-freed also closes the task's open merge hold",
    'A paused while paused is the same pause; a resumed with no pause is ignored',
    "A `carried` line in the from-file (its `rollout` equals its `from`) closes that task's Slot, lane and holds there",
    "Anything still open at the record's last line ends there and is flagged",
    '`failed` is reserved',
    'setAsideAt is where it re-enters',
  ]) assert.ok(r.includes(s), `reader rule: ${s}`)
})

// ---- controls: each mutation of the real text must fail with exactly its rule ----

const controls = [
  ['best-effort', (t) => t.replace('and never route on its exit', 'and route on its exit')],
  ['bind-run integrate resume', (t) => t.replace('`--call integrate --resumed-from <old>`', '`--call resume`')],
  ['merge hold end before launch and set-aside', (t) => t.replace("before each release's `merge-task.sh` launch and before a decline's set-aside row", "after each release's `merge-task.sh` launch")],
  ['record-pause', (t) => t.replace('`record-pause --rollout <rollout-note>` right after hard-pause step 1', '`record-pause --rollout <rollout-note>` when convenient')],
  ['hard pause step 1 points to record-pause', (t) => t.replace('Then run `reconcile-rollout.py record-pause --rollout <rollout-note> || true` (§4.5 *Run record*).', '')],
  ['next never knows a merge hold', (t) => t.replace('`next` never knows a merge hold', '`next` records the merge hold')],
]
for (const [rule, mutate] of controls) {
  test(`control: ${rule}`, () => {
    const mutated = mutate(skill)
    assert.notEqual(mutated, skill, 'the mutation applied')
    assert.deepEqual(checkRunRecord(mutated), [rule])
  })
}
