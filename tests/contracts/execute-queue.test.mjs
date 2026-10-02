// Execute's lead runs the queue (ADR 0030 decisions 2 to 5, p12-9): the § 4.5 loop and its neighbours in
// skills/execute/SKILL.md, the Stop hook it drives and the heartbeat prompt that backs it up. The scripts the prose
// calls are executed elsewhere (tests/lead-integrate.test.sh, skills/execute/tests/reconcile-rollout-lead.test.sh,
// skills/execute/tests/rollout-stop-driver.test.sh); this pins the prose an LLM lead follows.
//
// Every rule lives in one function, checkExecute({ skill, hooksJson, exists }), that returns named failures, so the
// real files and the controls run through identical logic and no matcher can pass vacuously: each control mutates
// the real text in one place and must fail with exactly its rule. The status-line rule parses § 6's spec with the
// driver's own STATUS_RE (python, via spawnSync). Reads files only.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { collapse, read, root, section } from '../lib/contract-text.mjs'

const real = {
  skill: read('skills/execute/SKILL.md'),
  hooksJson: read('hooks/hooks.json'),
  exists: (p) => fs.existsSync(path.join(root, p)),
}
const DRIVER = path.join(root, 'hooks', 'rollout-stop-driver.py')

const S = (text, re) => collapse(section(text, re) ?? '')
const S2 = /^### 2\. /
const S45 = /^### 4\.5\. /
const S5 = /^### 5\. /
const S6 = /^### 6\. /
const INV = /^## Invocation forms/
const PAUSE = /^## Pausing \+ reinstating/
const DONTS = /^## Don'ts/
const description = (text) => (text.match(/^description: (.*)$/m) ?? [])[1] ?? ''

// A bold-labelled paragraph (or labelled list) inside § 4.5: from its label line to the next bold label at column 0.
function labelled(text, label) {
  const lines = (section(text, S45) ?? '').split('\n')
  const i = lines.findIndex((l) => l.startsWith(`**${label}`))
  if (i < 0) return ''
  const j = lines.findIndex((l, k) => k > i && /^\*\*[A-Z]/.test(l))
  return collapse(lines.slice(i, j < 0 ? undefined : j).join('\n'))
}
// § 4.5's numbered steps (the lines from `n. **` to the next top-level step), raw.
function stepRaw(text, n) {
  const lines = (section(text, S45) ?? '').split('\n')
  const i = lines.findIndex((l) => new RegExp(`^${n}\\. \\*\\*`).test(l))
  if (i < 0) return ''
  const j = lines.findIndex((l, k) => k > i && /^(\d+\. \*\*|\*\*[A-Z])/.test(l))
  return lines.slice(i, j < 0 ? undefined : j).join('\n')
}
const step = (text, n) => collapse(stepRaw(text, n))
// Step 1's sub-steps, in order: [{ n, text }].
function subSteps(text) {
  const out = []
  for (const l of stepRaw(text, 1).split('\n')) {
    const m = l.match(/^ {3}(\d)\. (.*)$/)
    if (m) out.push({ n: Number(m[1]), text: m[2] })
    else if (out.length && l.trim()) out[out.length - 1].text += ' ' + l.trim()
  }
  return out
}
// Step 4's exit table: first cell → the row's text.
function exitRows(text) {
  const rows = {}
  for (const l of stepRaw(text, 4).split('\n')) {
    const m = l.match(/^\s*\| ([^|]+?) \| (.*) \|\s*$/)
    if (m && !/^(Exit|-+)$/.test(m[1].trim())) rows[m[1].trim()] = m[2]
  }
  return rows
}
const before = (hay, a, b) => hay.indexOf(a) >= 0 && hay.indexOf(b) >= 0 && hay.indexOf(a) < hay.indexOf(b)

// The driver's STATUS_RE over candidate lines: [state group or null] per line.
function driverStates(lines) {
  const py = 'import importlib.util, json, sys\n' +
    'spec = importlib.util.spec_from_file_location("d", sys.argv[1]); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)\n' +
    'out = []\n' +
    'for l in json.loads(sys.argv[2]):\n' +
    '    h = m.STATUS_RE.search(l)\n' +
    '    out.append(h.group("state") if h else None)\n' +
    'print(json.dumps(out))\n'
  const r = spawnSync('python3', ['-c', py, DRIVER, JSON.stringify(lines)], { encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } })
  if (r.status !== 0) return lines.map(() => null)
  return JSON.parse(r.stdout)
}

// The one line that names the retired per-wave form, to refuse it: exempt from no-wave-mechanics.
const REFUSAL = /^\*\*A wave number is refused\.\*\*/
const BANNED = /merged_through_wave|mark-dispatched|cursor --rollout|resume-filter|WAVE-STATUS|WAVE-HEARTBEAT|WAVE-DRIVER|wave-stop-driver|wave-driver|single-wave|[Ss]mart-halt|Wave [N1] of/

// Named failures for execute's queue prose, its hook wiring and the driver path; [] means every rule holds.
function checkExecute({ skill, hooksJson, exists }) {
  const fails = []
  const s2 = S(skill, S2)
  const s45 = S(skill, S45)
  const s5 = S(skill, S5)
  const s6raw = section(skill, S6) ?? ''
  const subs = subSteps(skill)
  const sub = (re) => subs.find((x) => re.test(x.text))
  const st1 = step(skill, 1)
  const st2 = step(skill, 2)
  const st3 = step(skill, 3)
  const st4 = step(skill, 4)
  const restart = labelled(skill, 'Restart routing')
  const lost = labelled(skill, 'Lost call.')
  const verifyP = labelled(skill, 'The background verify command.')
  const hold = labelled(skill, 'Merge hold')
  const backoff = labelled(skill, 'Backoff')
  const aside = labelled(skill, 'Set aside.')
  const recheck = labelled(skill, 'Landing-register re-check.')
  const slots = labelled(skill, 'Slots and the lane.')
  const pz = S(skill, PAUSE)
  const donts = S(skill, DONTS)
  const hb = (skill.split('\n').find((l) => l.startsWith('> ROLLOUT-HEARTBEAT')) ?? '')
  const hbPara = collapse((section(skill, S5) ?? '').split('\n\n').find((p) => p.startsWith('**Heartbeat (idempotent).**')) ?? '')

  // protocol-5: § 2 proceeds on 5 only and refuses absent/2/3 with the hard-pause + --regenerate remedy.
  if (!s2.includes('`protocol_version: 5` → proceed') || !/`protocol_version: 2` or `3`/.test(s2) ||
    !s2.includes('hard-pause it') || !s2.includes('/thread:schedule <project> --regenerate') ||
    !s2.includes('this executor supports protocol_version: 5') || /`protocol_version: 3` → proceed/.test(s2) ||
    !description(skill).includes('protocol_version: 5') || !description(skill).includes('queue')) fails.push('protocol-5')

  // launch: next --rollout with --running; restart before start; mark-started and owner:; Restart routing.
  const s3 = sub(/`restart`, then each in `start`/)
  if (!st1.includes('reconcile-rollout.py next --rollout') || !st1.includes('--running') || !s3 ||
    !s3.text.includes('mark-started') || !s3.text.includes('`owner:`') ||
    !restart.includes('*Lost call*') || !restart.includes('`resumeAt: revise`') || !restart.includes("the task's own call")) {
    fails.push('launch')
  }

  // slots: a slot is a task's own call (a seeded revise holds one); Integration holds none; one Integration at a
  // time; a revise launches only below the ceiling counting this step's launches, else waits; next is re-run.
  const s2sub = sub(/^\*\*Seeded revises/)
  if (!slots.includes("A **slot** is one task's own Workflow call") || !/a seeded revise — held/.test(slots) ||
    !slots.includes('Integration holds **no slot**') || !slots.includes('One Integration runs at a time') || !s2sub ||
    !s2sub.text.includes('`slotsInUse` (live plus restarts) plus the revises already launched in this step is below `ceiling`') ||
    !s2sub.text.includes('otherwise it waits') || !s2sub.text.includes('re-run `next --running <the live slugs, them included>`')) {
    fails.push('slots')
  }

  // auto-revise: only autoRevise: true, with --max-review-rounds; revise-stopped and review-blocked wait for hand-back.
  if (!s2sub || !s2sub.text.includes('Launch one only when it reports `autoRevise: true`') ||
    !s2sub.text.includes('--max-review-rounds') ||
    !/A `revise stopped:`, review-blocked or out-of-rounds note is never launched here: it waits for `hand-back`/.test(s2sub.text)) {
    fails.push('auto-revise')
  }

  // halt-guard: seeded revises < restart/start < the halt guard, which is the last sub-step before the turn ends;
  // it acts only with the lane free, no live call and nothing launched in sub-step 2; sub-step 1 defers `halt`.
  const iRev = subs.findIndex((x) => /^\*\*Seeded revises/.test(x.text))
  const iStart = subs.findIndex((x) => /`restart`, then each in `start`/.test(x.text))
  const iGuard = subs.findIndex((x) => /^\*\*Halt guard/.test(x.text))
  const guard = subs[iGuard]?.text ?? ''
  if (!(iRev >= 0 && iRev < iStart && iStart < iGuard) || iGuard !== subs.length - 2 ||
    !/^End the turn `waiting`/.test(subs[subs.length - 1]?.text ?? '') ||
    !guard.includes('only when the lane is free, no task call is live and sub-step 2 launched nothing') ||
    !guard.includes('otherwise end the turn `waiting`') || !(subs[0]?.text ?? '').includes('Do not act on its `halt` yet')) {
    fails.push('halt-guard')
  }

  // lost-call: paused:/hard-pause exempt; once: § 2.5, git-env, resumeFromRunId; then a lead-written row of the
  // call's kind; the lane frees; hand-back re-entry; the runId dropped once reconciled; every path routes to it.
  if (!lost.includes('`paused:`') || !lost.includes('stopped the call for a hard pause, write nothing') ||
    !before(lost, '§ 2.5', '`resumeFromRunId`') || !before(lost, "§ 4's git-env check", '`resumeFromRunId`') ||
    !lost.includes('once:') || !lost.includes('workflow call failed:') ||
    !lost.includes('--kind <own | revise-stopped | integration>') || !lost.includes('`own` for a task call') ||
    !lost.includes('`revise-stopped` for a seeded revise') || !lost.includes('`integration` for an integrate call') ||
    !lost.includes('frees the lane') || !lost.includes('re-enters only through `hand-back`') ||
    !lost.includes('dropped from this session\'s record once any row for it is reconciled') ||
    !st2.includes('*Lost call*') || !st3.includes('*Lost call*') || !restart.includes('*Lost call*') || !hb.includes('*Lost call*')) {
    fails.push('lost-call')
  }

  // clean-path: prepare routes; merge runs no verifier; log-integration on case (i) and after a verified push;
  // green → merge-task.sh → mark-done → step 1.
  const mergeB = st3.slice(st3.indexOf('**`merge`**'), st3.indexOf('**`verify`**'))
  const greenB = st3.slice(st3.indexOf('green (rc 0) and no shared file'), st3.indexOf('green with a shared file'))
  const rows = exitRows(skill)
  if (!st3.includes('lead-integrate.py prepare') || !mergeB.includes('no verifier runs') ||
    !mergeB.includes('Case (i) first records') || !mergeB.includes('log-integration') ||
    !before(greenB, 'push', 'log-integration') || !before(greenB, 'log-integration', 'step 4') ||
    !st4.includes('merge-task.sh') || !(rows['0 (`ok`)'] ?? '').includes('mark-done') || !(rows['0 (`ok`)'] ?? '').includes('step 1')) {
    fails.push('clean-path')
  }

  // verify-bound: --timeout in the command; run_in_background with timeout:; rc 124 and a missing rc are red;
  // env_bootstrap re-runs after the merge.
  const vline = (skill.match(/^# thread:integration-verify[^\n]*\n([^\n]*)\n# end thread:integration-verify/m) ?? [])[1] ?? ''
  if (!vline.includes('lead-integrate.py verify') || !vline.includes('--timeout 1800') ||
    !verifyP.includes('`run_in_background`') || !verifyP.includes('`timeout: 2400000`') ||
    !verifyP.includes('the rc is 124') || !verifyP.includes('leaves no rc, which reads as red') ||
    !verifyP.includes('`env_bootstrap` re-runs after the merge') ||
    !(st3.includes('red, rc 124, a failed bootstrap or a missing rc'))) fails.push('verify-bound')

  // trouble-path: conflict/red/shared-file → the integrate call, mode 'integrate'; leadMerge only on a green shared
  // file; integrated → step 4; rejected → step 1.2's seeded revise; max_review_rounds sets it aside.
  const sharedB = st3.slice(st3.indexOf('green with a shared file'), st3.indexOf('red, rc 124'))
  const redB = st3.slice(st3.indexOf('red, rc 124'), st3.indexOf('**`trouble`**'))
  if (!st3.includes("`mode: 'integrate'`") || !sharedB.includes('`leadMerge:') || !sharedB.includes('`trouble ["shared-file"]`') ||
    redB.includes('leadMerge') || !redB.includes('`trouble ["red"]`') || !st3.includes('`trouble` (`["conflict"]` or `[]`)') ||
    !st3.includes('`integrated` → step 4') || !st3.includes('`rejected` → the lane frees, step 1.2 launches the seeded revise') ||
    !st3.includes('`max_review_rounds` across those rounds sets it aside')) fails.push('trouble-path')

  // integrate-args: startedAt from stamp at launch; readyAt from ready:; history live, else inputs.
  if (!st3.includes('`startedAt` a fresh `lead-integrate.py stamp` taken at launch') ||
    !st3.includes("`readyAt` the note's `ready:`") ||
    !st3.includes('from the approving row when this session holds it, else from `lead-integrate.py inputs`')) {
    fails.push('integrate-args')
  }

  // set-aside: dependants wait; hand-back for Integration, revise and own; exit 3 integrates again; the exit-4
  // reason verbatim; no prefix written by hand; lead rows add no log line.
  if (!aside.includes('its dependants wait') || !aside.includes('at Integration: `hand-back` sets `review`') ||
    !aside.includes('`revise stopped:` or review-blocked: only after `hand-back`') ||
    !aside.includes('at its own run: `hand-back`') || !aside.includes('exit 3 is not a set-aside: the task integrates again') ||
    !aside.includes('add no `## Integration log` line') ||
    !(rows['4'] ?? '').includes("merge-task's text after `set-aside reason: `, verbatim") ||
    !donts.includes('Never write the `integration: ` prefix into a set-aside reason yourself')) fails.push('set-aside')

  // merge-exits: every exit has a row; 5 never re-called; 6 bounded; 7 a hold; 8 a bounded backoff; the merge runs
  // in the background with the harness maximum.
  const codes = ['0 (`ok`)', '1', '2', '3', '4', '5', '6', '7', '8', '70', '143 / 130 / 129, or a missing sentinel']
  if (!codes.every((c) => c in rows) || !rows['5']?.includes('Never re-call merge-task') ||
    !rows['6']?.includes('Re-run once. A second 6') || !rows['7']?.includes('*Merge hold*') ||
    !rows['8']?.includes('*Backoff*') || !rows['8']?.includes('A third 8 sets aside') ||
    !['rm -f', 'sleep 60', 'sleep 120', '`timeout: 7200000`'].every((k) => backoff.includes(k)) ||
    !st4.includes('`run_in_background` and `timeout: 7200000`')) fails.push('merge-exits')

  // holds: --gated and exit 7 end waiting with their reason, never halted; completions reconcile and slots fill;
  // the heartbeat stays; the release re-runs § 2.5 then merge-task with the same pair; a decline sets aside.
  if (!hold.includes('state=waiting reason="<hold reason>"`, never `halted`') || !hold.includes('completions reconcile') ||
    !hold.includes('step 1 keeps filling slots') || !hold.includes('no `CronDelete`') ||
    !before(hold, 're-runs § 2.5', '`merge-task.sh` with the same pair') || !hold.includes('a decline sets the task aside') ||
    !st4.includes('reason="gated: awaiting merge approval for [[slug]] (PR #N)"') ||
    !(rows['7'] ?? '').includes('reason="review required: approve PR #N (<url>)"')) fails.push('holds')

  // checks: the re-check runs before every Workflow call, every Integration push and every merge-task.sh call.
  if (!['Every entry into this loop', 'before every Workflow call', '`resumeFromRunId`', 'before every Integration push',
    'every `merge-task.sh` call (a merge-hold release and a backoff included)'].every((k) => recheck.includes(k))) {
    fails.push('checks')
  }

  // pauses: a soft pause drains; the hard pause stamps paused: before its TaskStop, which covers calls and commands.
  const hard = (section(skill, PAUSE) ?? '').split('\n').filter((l) => /^\d\. /.test(l))
  const iStamp = hard.findIndex((l) => l.includes('`paused: <timestamp>`'))
  const iStop = hard.findIndex((l) => l.includes('**TaskStop**'))
  if (!pz.includes('**the queue drains**') || !(iStamp >= 0 && iStamp < iStop) ||
    !(hard[iStop] ?? '').includes('every Workflow call') || !(hard[iStop] ?? '').includes('every background Integration command')) {
    fails.push('pauses')
  }

  // single-wave: the per-wave form is refused.
  const refusal = (section(skill, INV) ?? '').split('\n').find((l) => REFUSAL.test(l)) ?? ''
  if (!refusal.includes('single-wave mode is gone (ADR 0030)') || !refusal.includes('`execute Wave N of [[rollout]]`')) {
    fails.push('single-wave')
  }

  // status-line: § 6's spec, filled, parses with the driver's STATUS_RE in all four states; every ROLLOUT-STATUS:
  // in the skill has that shape; every reason is quote-free.
  const spec = s6raw.split('\n').find((l) => l.startsWith('ROLLOUT-STATUS: ')) ?? ''
  const fill = (state) => spec.replace('<rollout-slug>', 'demo').replace('<K>', '1').replace('<N>', '3').replace('<R>', '2')
    .replace('<running|waiting|halted|done>', state).replace(/\[ reason="<short reason>"\]$/, state === 'halted' ? ' reason="x"' : '')
  const states = ['running', 'waiting', 'halted', 'done']
  const all = skill.match(/ROLLOUT-STATUS: /g) ?? []
  const shaped = skill.match(/ROLLOUT-STATUS: <[a-z-]+> merged=<K>\/<N> running=<R> state=(?:<running\|waiting\|halted\|done>|(?:running|waiting|halted|done)\b)/g) ?? []
  const reasons = skill.match(/reason="/g) ?? []
  const clean = skill.match(/reason="[^"\n]*"(?=[`\]\s,.;)]|$)/g) ?? []
  if (!spec || JSON.stringify(driverStates(states.map(fill))) !== JSON.stringify(states) ||
    all.length !== shaped.length || reasons.length !== clean.length) fails.push('status-line')

  // heartbeat: the > ROLLOUT-HEARTBEAT prompt's clauses, in order.
  const at = (k) => hb.indexOf(k)
  if (!hb.includes('Read the last ROLLOUT-STATUS line') || !/state=done or state=halted.*CronDelete it and stop/.test(hb) ||
    !(at('`paused:`') >= 0 && at('`paused:`') < at('Lost calls') && at('Lost calls') < at('background Integration command') &&
      at('background Integration command') < at('starts `gated:`') && at('starts `gated:`') < at('starts `review required:`') &&
      at('starts `review required:`') < at('no Workflow call for this rollout is in flight')) ||
    !hb.includes('BEFORE any stall diagnosis') || !hb.includes('under a merge hold too') || !hb.includes('§4.5 *Lost call*') ||
    !hb.includes('`--running`') || !hb.includes('`<out>.rc`') || !hb.includes('merge-task.status') ||
    !hb.includes('work remains') || !hb.includes('§4.5 *Cold resume*') || !hb.includes('skips § 2.7')) fails.push('heartbeat')

  // heartbeat-register: idempotent, at each loop entry's first waiting turn, whatever the turn launched.
  if (!before(hbPara, '`CronList`', '`CronCreate`') || !/(each|every) loop entry/.test(hbPara) || !hbPara.includes('`state=waiting`') ||
    !['an integrate call', 'a background Integration command', 'a merge hold'].every((k) => hbPara.includes(k)) ||
    /first task call|first wave launch/i.test(skill)) fails.push('heartbeat-register')

  // no-wave-mechanics: none of the wave loop's names survive (the one refusal line excepted).
  if (skill.split('\n').some((l) => !REFUSAL.test(l) && BANNED.test(l))) fails.push('no-wave-mechanics')

  // driver: hooks.json runs rollout-stop-driver.py; the old name is gone, with no alias.
  if (!hooksJson.includes('${CLAUDE_PLUGIN_ROOT}/hooks/rollout-stop-driver.py') || hooksJson.includes('wave-stop-driver') ||
    !exists('hooks/rollout-stop-driver.py') || exists('hooks/wave-stop-driver.py')) fails.push('driver')

  // s5 (the dead-run resume keeps its shape for its consumers) is part of lost-call's routing: § 5 names *Lost call*.
  if (!s5.includes('(§ 4.5 *Lost call*)') || !before(s5, '(§ 4.5 *Lost call*)', 'resumeFromRunId: <runId>')) fails.push('lost-call')
  return [...new Set(fails)]
}

test('execute § 4.5, its neighbours, the heartbeat and the hook hold every queue rule', () => {
  assert.deepEqual(checkExecute(real), [])
})

// ---- controls: each mutates the real text in one place and must fail with exactly its rule ---------

const RULES = ['protocol-5', 'launch', 'slots', 'auto-revise', 'halt-guard', 'lost-call', 'clean-path', 'verify-bound',
  'trouble-path', 'integrate-args', 'set-aside', 'merge-exits', 'holds', 'checks', 'pauses', 'single-wave', 'status-line',
  'heartbeat', 'heartbeat-register', 'no-wave-mechanics', 'driver']
const CONTROLLED = new Set()

function edit(text, from, to) {
  assert.ok(text.includes(from), `control setup: ${from.slice(0, 80)} not found`)
  return text.replace(from, to)
}
const only = (mut, rule, label) => {
  CONTROLLED.add(rule)
  assert.deepEqual(checkExecute({ ...real, ...mut }), [rule], label)
}
const sk = (from, to) => ({ skill: edit(real.skill, from, to) })

test('control: protocol 3 proceeding fails protocol-5', () => {
  only(sk('- `protocol_version: 5` → proceed.', '- `protocol_version: 3` → proceed.'), 'protocol-5', 'protocol 3')
})

test('control: Restart routing without the revise route fails launch', () => {
  only(sk('reports `resumeAt: revise` → step 1.2', 'reports a revise marker → step 1.2'), 'launch', 'no resumeAt')
})

test('control: a seeded revise launched regardless of the ceiling fails slots', () => {
  only(sk('; otherwise it waits, blocked, for a later step 1', ''), 'slots', 'no wait')
})

test('control: launching every rejected note fails auto-revise', () => {
  only(sk('Launch one only when it reports `autoRevise: true`, and only', 'Launch each one, but only'), 'auto-revise', 'no autoRevise')
})

test('control: the halt guard read before the seeded revises fails halt-guard', () => {
  const subs = section(real.skill, S45).split('\n').filter((l) => /^ {3}\d\. /.test(l))
  const rev = subs.find((l) => l.includes('**Seeded revises'))
  const guard = subs.find((l) => l.includes('**Halt guard'))
  const swapped = real.skill.replace(rev, '\u0000').replace(guard, rev.replace(/^ {3}2\./, '   5.')).replace('\u0000', guard.replace(/^ {3}5\./, '   2.'))
  only({ skill: swapped }, 'halt-guard', 'guard first')
})

test('control: a Lost call resume without the git-env check fails lost-call', () => {
  only(sk("- Otherwise, once: § 2.5, § 4's git-env check, then", '- Otherwise, once: § 2.5, then'), 'lost-call', 'no git-env')
})

test('control: a merge route that verifies fails clean-path', () => {
  only(sk('nothing is merged and no verifier runs', 'nothing is merged'), 'clean-path', 'merge route verifies')
})

test('control: an unbounded verify command fails verify-bound', () => {
  const p = real.skill.split('\n').find((l) => l.startsWith('**The background verify command.**'))
  only(sk(p, p.replace('`run_in_background` and `timeout: 2400000`', '`run_in_background`')), 'verify-bound', 'no timeout')
})

test('control: leadMerge on a red verify fails trouble-path', () => {
  only(sk('then the integrate call with `trouble ["red"]`', 'then the integrate call with `trouble ["red"]` and `leadMerge`'), 'trouble-path', 'red leadMerge')
})

test('control: startedAt taken at prepare fails integrate-args', () => {
  only(sk('`startedAt` a fresh `lead-integrate.py stamp` taken at launch', '`startedAt` the stamp S taken at prepare'), 'integrate-args', 'stale startedAt')
})

test("control: the exit-4 reason not passed verbatim fails set-aside", () => {
  only(sk("merge-task's text after `set-aside reason: `, verbatim", "merge-task's reason, prefixed with `integration: `"), 'set-aside', 'reprefixed')
})

test('control: an exit table without its 6 row fails merge-exits', () => {
  const row = real.skill.split('\n').find((l) => /^ {3}\| 6 \|/.test(l))
  only(sk(row + '\n', ''), 'merge-exits', 'no 6')
})

test('control: a merge hold that halts fails holds', () => {
  only(sk('state=waiting reason="<hold reason>"`, never `halted`', 'state=halted reason="<hold reason>"`'), 'holds', 'hold halts')
})

test('control: no re-check before an Integration push fails checks', () => {
  only(sk('before every Integration push and before every', 'before every'), 'checks', 'no push check')
})

test('control: a hard pause that stops before it stamps fails pauses', () => {
  const lines = section(real.skill, PAUSE).split('\n').filter((l) => /^\d\. /.test(l))
  const swapped = real.skill.replace(lines[0], '\u0000').replace(lines[1], lines[0].replace(/^1\./, '2.')).replace('\u0000', lines[1].replace(/^2\./, '1.'))
  only({ skill: swapped }, 'pauses', 'stop first')
})

test('control: no refusal of the per-wave form fails single-wave', () => {
  const line = real.skill.split('\n').find((l) => REFUSAL.test(l))
  only(sk(line + '\n', ''), 'single-wave', 'no refusal')
})

test('control: a status line without running= fails status-line', () => {
  only(sk('ROLLOUT-STATUS: <rollout-slug> merged=<K>/<N> running=<R> state=<running|waiting|halted|done>[ reason="<short reason>"]',
    'ROLLOUT-STATUS: <rollout-slug> merged=<K>/<N> state=<running|waiting|halted|done>[ reason="<short reason>"]'), 'status-line', 'no running=')
})

test('control: a quoted reason fails status-line', () => {
  only(sk('reason="the rollout links no task"', 'reason="the rollout links "no" task"'), 'status-line', 'nested quotes')
})

test('control: a lost-call clause that skips holds fails heartbeat', () => {
  only(sk('(3) Lost calls (always run this clause, under a merge hold too):', '(3) Lost calls:'), 'heartbeat', 'not under a hold')
})

test('control: the stall clause before the hold clauses fails heartbeat', () => {
  const hb = real.skill.split('\n').find((l) => l.startsWith('> ROLLOUT-HEARTBEAT'))
  const c5 = hb.slice(hb.indexOf('(5)'), hb.indexOf('(6)'))
  const c7 = hb.slice(hb.indexOf('(7)'))
  only(sk(hb, hb.replace(c5, '\u0000').replace(c7, c5.trim()).replace('\u0000', c7 + ' ')), 'heartbeat', 'stall first')
})

test('control: registering the heartbeat at the first task call fails heartbeat-register', () => {
  only(sk('At each loop entry (top-down, *Cold resume*, *Reinstate*, `/thread:repair`\'s hand-off), the first turn that ends `state=waiting` runs',
    'At the first task call\'s launch, the turn runs'), 'heartbeat-register', 'first task call')
})

test('control: a WAVE-STATUS line anywhere fails no-wave-mechanics', () => {
  only({ skill: `${real.skill}\nEnd with WAVE-STATUS: demo cursor=1/3 state=waiting.\n` }, 'no-wave-mechanics', 'wave line')
})

test('control: the old hook name, or an alias left behind, fails driver', () => {
  only({ hooksJson: real.hooksJson.replace('rollout-stop-driver.py', 'wave-stop-driver.py') }, 'driver', 'old name')
  only({ exists: (p) => p === 'hooks/wave-stop-driver.py' || real.exists(p) }, 'driver', 'alias')
})

test('the rules are all named (21) and each has a control', () => {
  assert.equal(RULES.length, 21)
  assert.deepEqual(RULES.filter((r) => !CONTROLLED.has(r)), [])
})
