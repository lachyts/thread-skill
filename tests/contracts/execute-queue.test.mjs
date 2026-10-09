// Execute's lead runs the queue (ADR 0030 decisions 2 to 5, p12-9): the § 4.5 loop and its neighbours in
// skills/execute/SKILL.md, the Stop hook it drives and the heartbeat prompt that backs it up. The scripts the prose
// calls are executed elsewhere (tests/lead-integrate.test.sh, skills/execute/tests/reconcile-rollout-lead.test.sh,
// skills/execute/tests/rollout-stop-driver.test.sh); this pins the prose an LLM lead follows.
//
// Every rule lives in one function, checkExecute({ skill, hooksJson, exists, template }), that returns named failures, so the
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
  template: read('skills/schedule/rollout-template.md'),
}
const DRIVER = path.join(root, 'hooks', 'rollout-stop-driver.py')

const S = (text, re) => collapse(section(text, re) ?? '')
const S2 = /^### 2\. /
const S3 = /^### 3\. /
const S37 = /^### 3\.7\. /
const S4 = /^### 4\. /
const S45 = /^### 4\.5\. /
const S5 = /^### 5\. /
const S6 = /^### 6\. /
const S7 = /^### 7\. /
const S8 = /^### 8\. /
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

// The serial-Integration budget, one sentence shared word for word by execute's Resource budget and the rollout
// template's (p12-7's budget, made one by p12-12).
const BUDGET = 'Integrations run one at a time: each merges the latest `main` in, re-runs the verifier unless `main` has not moved, ' +
  "re-reviews when needed, and waits on the PR's required checks before the squash. Budget ≈ (merge-in + verifier + any re-review + " +
  'required checks + squash) per approved task, **sequentially**'

// Named failures for execute's queue prose, its hook wiring and the driver path; [] means every rule holds.
function checkExecute({ skill, hooksJson, exists, template }) {
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

  // verify-bound: --timeout in the command; run_in_background with timeout:; rc 124, a TERM's rc 143 and a
  // missing rc (only a SIGKILL) are red; env_bootstrap re-runs after the merge. The verifier and the bootstrap are
  // single-quoted (' written '\'') in the verify line and the RACE re-verify alike, so nothing expands in the
  // lead's shell: a double-quoted form anywhere fails.
  const vline = (skill.match(/^# thread:integration-verify[^\n]*\n([^\n]*)\n# end thread:integration-verify/m) ?? [])[1] ?? ''
  const raceLine = st4.slice(st4.indexOf('**RACE procedure**'))
  const sq = (l) => l.includes("--bootstrap '<env_bootstrap>' --verifier '<verifier>'")
  if (!vline.includes('lead-integrate.py verify') || !vline.includes('--timeout <verify_timeout>') ||
    !verifyP.includes('`run_in_background` and `timeout: <harnessTimeoutMs>`') ||
    !verifyP.includes('the rc is 124') || !verifyP.includes('leaves no rc, which reads as red') ||
    !verifyP.includes('write rc 143; only a SIGKILL leaves no rc') ||
    !verifyP.includes("**single quotes**, with each `'` in them written as `'\\''`") ||
    !verifyP.includes('no `$`, `$(…)`, backtick or backslash expands in the lead\'s shell') ||
    !sq(vline) || !sq(raceLine) || /--(verifier|bootstrap) "</.test(skill) ||
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

  // integrate-args: startedAt from stamp at launch; readyAt from ready:; prUrl, the history, the rounds and the rung are
  // `inputs --row`'s integrate record verbatim (p17-1: a saved row is checked against the note, never trusted as it
  // is), a non-empty rowRefused printed; the rung is the task's own record, the accepted row's, else the note's
  // (neutral when the note has no rung:), never the ladder's top rung, and no tier vocabulary left. prepare's
  // `unlisted` and `note` only inform.
  if (!st3.includes('`startedAt` a fresh `lead-integrate.py stamp` taken at launch') ||
    !st3.includes("`readyAt` the note's `ready:`") ||
    !st3.includes('`prUrl`, `reviewHistory`, `reviewRoundsUsed` and `rung` are, verbatim, the `integrate` record of `python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/lead-integrate.py inputs --note <task note> [--row') ||
    !st3.includes('the lead prints a non-empty `rowRefused`') || st3.includes('from the approving row when this session holds it') ||
    !st3.includes("`rung` is the task's own rung record, the accepted row's (`startRung`, `rung`, `climbs`), else the note's `rung` record") ||
    !st3.includes('(neutral, `{startRung: "", rung: "", climbs: []}`, when the note has no `rung:`)') ||
    !st3.includes("never the ladder's top rung: Integration runs on the top rung whatever the record says") ||
    !st3.includes('`unlisted`, the commits in `taskBase..mainSha` that name no PR,') || !st3.includes('pass neither to the integrate call') ||
    /tierCapped|tier_capped|escalated/.test(st3)) {
    fails.push('integrate-args')
  }

  // ladder (ADR 0029 decision 6, p13-2): § 3 reads ladder.py at each call's start — a start or restart, a seeded
  // revise and each integrate call — before any stamp, and passes it as args.ladder; prepare and push need none;
  // both resumes re-pass their call's own ladder; a refusal writes nothing and halts `ladder file refused`, which
  // § 7 lists; the skill warns about `max_tier:` exactly once and passes nothing for it; § 4's args carry `ladder`
  // and the task's `rung`; the integrate call carries a freshly resolved ladder; § 5's launch names it.
  const ladderP = collapse((section(skill, S3) ?? '').split('\n\n').find((x) => x.startsWith("**The ladder, at each call's start (ADR 0029 decision 6).**")) ?? '')
  const tierLines = skill.split('\n').filter((l) => /max_tier|maxTier/.test(l))
  const s4 = section(skill, S4) ?? ''
  const resume37 = collapse(section(skill, S37) ?? '')
  if (!ladderP.includes('`python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/ladder.py` at the start of each Workflow call that starts agents') ||
    !ladderP.includes("a start or restart (the task's own call), a seeded revise, and each integrate call") ||
    !ladderP.includes('as `args.ladder`') || !ladderP.includes('It runs before any stamp for that call') ||
    !ladderP.includes('(`lead-integrate.py prepare` and `push`) starts no agent and needs none') ||
    !ladderP.includes("*Lost call*'s `resumeFromRunId`, or § 3.7's signed-gate resume — re-passes its call's own ladder") ||
    !ladderP.includes('write nothing for that call') || !ladderP.includes('reason="ladder file refused"') ||
    tierLines.length !== 1 || !tierLines[0].includes("\"`max_tier:` ignored; the ceiling is the ladder's top rung\"") ||
    !tierLines[0].includes('nothing is passed to the engine') ||
    !s4.includes('"ladder": {') || !s4.includes('"rung": "opus-high" }') ||
    !st3.includes("a freshly resolved `ladder` (§ 3: read at this call's start)") ||
    !lost.includes('the same `scriptPath` and args, the ladder included') ||
    !resume37.includes("The resume keeps its call's own `ladder`.") ||
    !s5.includes("the ladder it runs on (its `source`: the file's path, or `built-in`)") ||
    !S(skill, S7).includes('`ladder.py` exits non-zero at a call\'s start (§ 3: `reason="ladder file refused"`')) {
    fails.push('ladder')
  }

  // set-aside: dependants wait; hand-back for Integration, revise and own (a PR-less code-writing review note
  // included); exit 3 integrates again; the exit-4 reason verbatim; no prefix written by hand; lead rows add no
  // log line; an engine row that sets a task aside (a task call's, an integrate call's review-blocked or
  // set-aside) gets no lead row.
  const engineAside = st3.slice(st3.indexOf('review-blocked or `set-aside` →'))
  if (!aside.includes('its dependants wait') || !aside.includes('at Integration: `hand-back` sets `review`') ||
    !aside.includes('is already reconciled (§ 6): the lead writes no row for it') ||
    !engineAside.includes('reconcile has already written the engine\'s row') ||
    !engineAside.includes('the lead writes **no** set-aside row of its own') ||
    !st2.includes('the lead writes no row of its own') ||
    !aside.includes('a code-writing `review` note with no `pr:`') ||
    !aside.includes('`revise stopped:` or review-blocked: only after `hand-back`') ||
    !aside.includes('at its own run: `hand-back`') || !aside.includes('exit 3 is not a set-aside: the task integrates again') ||
    !aside.includes('add no `## Integration log` line') ||
    !aside.includes('a later `hand-back` merges through case (ii) when main has not moved since that Integration; otherwise `prepare` integrates it again') ||
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
    !pz.includes('`/thread:repair` only records escalations and decisions (a `RACE decided:` line included) and defers a set-aside task') ||
    !pz.includes('It never hands back') || pz.includes('nothing-to-fix') ||
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
    // *Lost call* resumes without re-checking liveness, so clause (3) applies it only to calls no longer in flight.
    !hb.includes('apply §4.5 *Lost call* to each call this session launched that is no longer in flight in /workflows with no reconciled row (never to a call still in flight') ||
    !hb.includes('`--running`') || !hb.includes('`<out>.rc`') || !hb.includes('merge-task.status') ||
    !hb.includes('work remains') || !hb.includes('§4.5 *Cold resume*') || !hb.includes('skips § 2.7')) fails.push('heartbeat')

  // resume-running: a cold resume and a reinstate pass --running = this session's live task-call slugs, so a
  // re-invocation in the launching session never reports its own live calls as stalled (Restart routing would send
  // each to *Lost call*, resuming a running call). `--running ""` appears only with its condition.
  const cold = labelled(skill, 'Cold resume.')
  const reinstate = labelled(skill, 'Reinstate (resuming a paused rollout).')
  const emptyRunning = skill.match(/--running ""/g) ?? []
  const guardedEmpty = skill.match(/--running ""` only when this session holds no live task call/g) ?? []
  if (!cold.includes("with `--running` = this session's live task-call slugs") ||
    !cold.includes('they are running, never stalled, and are never sent to *Restart routing* or *Lost call*') ||
    !reinstate.includes("the loop with `--running` = this session's live task-call slugs, exactly as there") ||
    emptyRunning.length !== guardedEmpty.length) fails.push('resume-running')

  // heartbeat-register: idempotent, at each loop entry's first waiting turn, whatever the turn launched.
  if (!before(hbPara, '`CronList`', '`CronCreate`') || !/(each|every) loop entry/.test(hbPara) || !hbPara.includes('`state=waiting`') ||
    !['an integrate call', 'a background Integration command', 'a merge hold'].every((k) => hbPara.includes(k)) ||
    /first task call|first wave launch/i.test(skill)) fails.push('heartbeat-register')

  // lineage: § 2 reads the lineage first, whatever the version (as status § 1 and repair § 1 do): superseded_by:,
  // then the reverse lineage with both N cases, before the version bullets.
  const s2raw = section(skill, S2) ?? ''
  const vAt = s2raw.search(/^- (`protocol_version|Missing `protocol_version`)/m)
  const ahead = (k) => s2raw.indexOf(k) >= 0 && vAt >= 0 && s2raw.indexOf(k) < vAt
  if (!ahead('**Lineage first, whatever the version**') || !ahead('`superseded_by:` → print "superseded by [[N]]') ||
    !ahead("status § 1's reverse-lineage grep") ||
    !s2.includes('print "supersede interrupted: `/thread:schedule <project> --regenerate`"') ||
    !s2.includes('print "close-out interrupted: `/thread:repair [[this]]`"')) fails.push('lineage')

  // race-hold: step 1.1 halts on a RACE in raceHold once the lane is free; a cold resume's exit 3 is printed and
  // the loop goes on (step 1.1 holds the task); § 7 names both stops; § 8's duplicate-free re-entry rests on it.
  const s1 = subs[0]?.text ?? ''
  const coldR = labelled(skill, 'Cold resume.')
  const s7 = S(skill, S7)
  const s8 = S(skill, S8)
  if (!s1.includes('`raceHold`') || !s1.includes('the lane is free') || !s1.includes('`reason="RACE undecided: [[<slug>]]"`') ||
    !s1.includes('An `UNVERIFIED` entry stays set aside like any other') ||
    !coldR.includes('Exit 3 means `resume` held back an undecided RACE or UNVERIFIED') || !coldR.includes('print the lines and go on') ||
    !s7.includes('`next` reports a `RACE` in `raceHold` while the lane is free') || !s7.includes('`reason="RACE undecided: [[task]]"`') ||
    !before(s7, '`reason="UNVERIFIED undecided: [[task]]"`', '`reason="gated inputs await sign-off: …"`') ||
    !s8.includes('`resume` flips merged PRs done and skips a held RACE or UNVERIFIED task, and `next` keeps a held task out of Integration')) {
    fails.push('race-hold')
  }

  // budget: the serial-Integration budget is the same sentence in execute and in the rollout template.
  if (!collapse(skill).includes('**Continuous auto-merge adds serial Integration time.** ' + BUDGET) ||
    !collapse(template ?? '').includes(BUDGET + ', on top of the convergence time above.')) fails.push('budget')

  // no-wave-mechanics: none of the wave loop's names survive (the one refusal line excepted).
  if (skill.split('\n').some((l) => !REFUSAL.test(l) && BANNED.test(l))) fails.push('no-wave-mechanics')

  // driver: hooks.json runs rollout-stop-driver.py; the old name is gone, with no alias.
  if (!hooksJson.includes('${CLAUDE_PLUGIN_ROOT}/hooks/rollout-stop-driver.py') || hooksJson.includes('wave-stop-driver') ||
    !exists('hooks/rollout-stop-driver.py') || exists('hooks/wave-stop-driver.py')) fails.push('driver')

  // verify-timeout (p14-2, L3): the rollout key's default and its use. § 3's table row (default 1800, not passed to
  // the engine, read by `reconcile-rollout.py verify-timeout`); § 3's once-per-entry check, before anything the
  // entry writes, with its write-nothing halt; the verify line and the RACE re-verify bound by it, with no literal
  // 1800 left; the harness bound (2400000 at the default) on the verify paragraph and § 8's timeout guardrail;
  // every entry description runs the check before its first write (§ 4.5's entry paragraph, Cold resume, both
  // Reinstates); § 7 lists the halt.
  const s3raw = section(skill, S3) ?? ''
  const vtRow = s3raw.split('\n').find((l) => l.startsWith('| `verify_timeout` |')) ?? ''
  const vtP = collapse(s3raw.split('\n\n').find((x) => x.startsWith('**Validate `verify_timeout` once per loop entry, before anything the entry writes.**')) ?? '')
  const VT = "§ 3's `verify_timeout` check"
  const coldVT = labelled(skill, 'Cold resume.')
  const reinstateVT = labelled(skill, 'Reinstate (resuming a paused rollout).')
  const pzReinstate = collapse((section(skill, PAUSE) ?? '').split('\n').find((l) => l.startsWith('**Reinstate.**')) ?? '')
  const timeoutGuard = collapse((section(skill, S8) ?? '').split('\n').find((l) => l.startsWith('- **Every background command names its `timeout:`.**')) ?? '')
  if (!vtRow.startsWith('| `verify_timeout` | `1800` | not passed to the engine.') || !vtRow.includes('`reconcile-rollout.py verify-timeout`') ||
    !vtRow.includes('`harnessTimeoutMs`') ||
    !vtP.includes("Every entry into §4.5's loop (top-down, *Cold resume*, *Reinstate*, the § 5 heartbeat's re-entry and `/thread:repair`'s hand-off)") ||
    !vtP.includes('`python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/reconcile-rollout.py verify-timeout --rollout <rollout-note>` once') ||
    !vtP.includes('before `resume`, `clear-pause`, `next` and any stamp') || !vtP.includes('never at the verify line') ||
    !vtP.includes('the lead writes nothing') || !vtP.includes('reason="invalid verify_timeout on [[rollout]]"') ||
    !vline.includes('--timeout <verify_timeout>') || !raceLine.includes('--timeout <verify_timeout>') ||
    !raceLine.includes('`timeout: <harnessTimeoutMs>`') || /--timeout 1800\b/.test(skill) ||
    !verifyP.includes('(<verify_timeout> + 600) × 1000') || !verifyP.includes('`timeout: 2400000` at the default') ||
    !timeoutGuard.includes('`timeout: <harnessTimeoutMs>` (their own `--timeout <verify_timeout>` bounds the verifier; `timeout: 2400000` at the default)') ||
    !recheck.includes("Every entry then runs § 3's `verify_timeout` check once, before anything it writes") ||
    !before(coldVT, VT, 'reconcile-rollout.py resume') || !before(reinstateVT, VT, 'clear-pause') || !before(pzReinstate, VT, 'clear-pause') ||
    !S(skill, S7).includes('`reconcile-rollout.py verify-timeout` exits 1 at an entry (`reason="invalid verify_timeout on [[rollout]]"`')) {
    fails.push('verify-timeout')
  }

  // approved-plan (p14-2, L2): the approved plan reaches the seeded revise (step 1.2) and the integrate call (step 3)
  // from `lead-integrate.py plan`, read at those two launches only (Restart routing's revise reuses step 1.2's) and
  // passed verbatim; no empty-plan literal is left; § 6 lists the row's `plan` and reconcile's three outcomes.
  const planHits = (section(skill, S45) ?? '').split('lead-integrate.py plan').length - 1
  const s6 = S(skill, S6)
  const VERBATIM = 'passed verbatim as the same JSON string, never retyped, summarised or truncated'
  if (!s2sub || !s2sub.text.includes('`python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/lead-integrate.py plan --note <task note>`, then the Workflow call') ||
    !s2sub.text.includes('plan: <plan.plan>}') || !s2sub.text.includes(VERBATIM) ||
    !st3.includes('trouble, landed, plan, reviewHistory') ||
    !st3.includes("`plan` is `lead-integrate.py plan --note <task note>`'s `plan`, read at this launch (after the approving row is reconciled) and " + VERBATIM) ||
    planHits !== 2 || /plan: ''|plan: ""|`plan` is `""`/.test(s45) ||
    !s6.includes('gatedInputs, plan }] }') || !s6.includes('upserts it, quoted, under `## Approved plan`') ||
    !s6.includes('`""` removes that section') || !s6.includes('`null` or absent leaves it')) {
    fails.push('approved-plan')
  }

  // descope (p14-4): step 1.2's **Automatic descope** shares sub-step 2's line, so it runs before the halt guard
  // (halt-guard pins that order). Skipped under a pause; a `plan-blocked` set-aside judged once per session key (its
  // highest Plan-blocked run and that run's sha), never again on a heartbeat or another loop entry; the guarded verb
  // writes; exit 0 → `hand-back`, then `next` again; exit 3 leaves it set aside for `/thread:repair`, never a
  // hand-back. § 8 says the lead runs this one verb itself and its refusal routes to repair; *Set aside* names the
  // re-entry; a Don't forbids a hand-written or second descope. A block after the restart routes to repair's
  // **plan-blocked after a descope**, never a silent hand-back; § 6's undo lists every record (the marker, the
  // follow-up set `status: dropped`, the `## Notes` line).
  const s2t = s2sub?.text ?? ''
  const undo6 = collapse(s6raw.split('\n').find((l) => l.startsWith('The `Descoped:` line lists')) ?? '')
  const dsc = s2t.slice(Math.max(0, s2t.indexOf('**Automatic descope')))
  const never = collapse((section(skill, S8) ?? '').split('\n').find((l) => l.startsWith('- **Never automate `/thread:repair`**')) ?? '')
  if (!s2t.includes('**Automatic descope') || !dsc.includes('`plan-blocked`') ||
    !dsc.includes('`python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/reconcile-rollout.py descope --tasks <slug>') ||
    !dsc.includes('Skip it when `paused` or `pauseRequested` is set') ||
    !dsc.includes('whose key this session has not judged') || !dsc.includes('held for the session\'s life') ||
    !dsc.includes('never re-judges it') ||
    !dsc.includes('exit 0 → `hand-back --tasks <slug>`') || !dsc.includes('then re-run `next --running') ||
    !dsc.includes('exit 3 → leave it set aside') || !dsc.includes('`/thread:repair` asks Lachy') ||
    !never.includes('The lead runs `reconcile-rollout.py descope` itself (§ 4.5 step 1.2)') ||
    !never.includes('its refusal (exit 3) routes the task to repair') ||
    !dsc.includes("a block after the restart always asks (repair § 2's **plan-blocked after a descope**, never a silent hand-back)") ||
    !['`<!-- descope run=… -->` marker', '`descope_armed:`', '`status: dropped`', '`descope undone:`', 'a second one'].every((k) => undo6.includes(k)) ||
    !aside.includes('- a `plan-blocked` task the notes settle: automatically (step 1.2\'s *Automatic descope*: `descope`, then `hand-back`)') ||
    !donts.includes('Never write a descope by hand') || !donts.includes('its exit 3 goes to `/thread:repair`, never to `hand-back`')) {
    fails.push('descope')
  }

  // settings (p15-4, the operator's rollout settings): § 3 resolves a round-budget key absent at both levels
  // through rollout-settings.py once per loop entry; its exit 2 or 3 is the round-budget write-nothing halt,
  // `reason="rollout settings refused"`, its fix read off the stderr line (the file's line, or a stamp for a `--repo`
  // one); § 7 lists that halt, and `next`'s exit 1 for an absent ceiling it could not resolve.
  const settingsP = collapse((section(skill, S3) ?? '').split('\n\n').find((x) => x.startsWith("**The operator's rollout settings (p15-4).**")) ?? '')
  const s7set = S(skill, S7)
  if (!settingsP.includes('`python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/rollout-settings.py --repo <Project root>` once per loop entry') ||
    !settingsP.includes('Its exit 2 or 3 is the round-budget write-nothing halt') || !settingsP.includes('reason="rollout settings refused"') ||
    !settingsP.includes('one naming `--repo` (the Project root is gone or its origin unreadable) is fixed by stamping the key') ||
    !s7set.includes('`rollout-settings.py` exits 2 or 3 for a round-budget key absent at both levels (§ 3: `reason="rollout settings refused"`') ||
    !s7set.includes('an absent one `rollout-settings.py` could not resolve')) {
    fails.push('settings')
  }

  // lane-order (p17-1): sub-step 4 takes the Integration queue in `next`'s order and says what that order is.
  const s4sub = sub(/^If the lane is free, take `next`'s first `integrating` task/)
  if (!s4sub || !s4sub.text.includes("else its first `awaitingIntegration` task (`next` orders the Integration queue: a task a queued task depends on first, then the oldest `ready:`, then schedule order)")) {
    fails.push('lane-order')
  }

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
  'heartbeat', 'heartbeat-register', 'no-wave-mechanics', 'driver', 'resume-running', 'lineage', 'race-hold', 'budget',
  'ladder', 'verify-timeout', 'approved-plan', 'descope', 'settings', 'lane-order']
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
  only(sk(p, p.replace('`run_in_background` and `timeout: <harnessTimeoutMs>`', '`run_in_background`')), 'verify-bound', 'no timeout')
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

test('control: a cold resume with an unconditional empty --running fails resume-running', () => {
  only(sk("then the loop, an `integrating` task first, with `--running` = this session's live task-call slugs",
    'then the loop with `--running ""`, an `integrating` task first'), 'resume-running', 'cold resume --running ""')
})

test('control: a reinstate with an unconditional empty --running fails resume-running', () => {
  only(sk("the loop with `--running` = this session's live task-call slugs, exactly as there:", 'the loop with `--running ""`:'),
    'resume-running', 'reinstate --running ""')
})

test('control: a heartbeat that applies Lost call to every launched call fails heartbeat', () => {
  only(sk('to each call this session launched that is no longer in flight in /workflows with no reconciled row (never to a call still in flight: *Lost call* resumes without re-checking),',
    'to each call this session launched,'), 'heartbeat', 'live calls resumed')
})

test('control: a double-quoted verifier on the verify line fails verify-bound', () => {
  const v = real.skill.split('\n').find((l) => l.includes('lead-integrate.py verify --tree "<tree>"'))
  only(sk(v, v.replace("--verifier '<verifier>'", '--verifier "<verifier>"')), 'verify-bound', 'dq verifier')
})

test('control: a double-quoted RACE re-verify fails verify-bound', () => {
  only(sk("--bootstrap '<env_bootstrap>' --verifier '<verifier>'` in the background", '--bootstrap "<env_bootstrap>" --verifier "<verifier>"` in the background'),
    'verify-bound', 'dq race')
})

test("control: a rung fallback naming the ladder's top rung fails integrate-args", () => {
  const p = real.skill.split('\n').find((l) => l.startsWith('   **The integrate call**'))
  const from = p.slice(p.indexOf("else the note's `rung` record"), p.indexOf('; `readyAt`'))
  only(sk(from, "else `{startRung: \"\", rung: <the ladder's top rung>, climbs: []}`"), 'integrate-args', 'top-rung fallback')
})

test('control: the approving row trusted unchecked fails integrate-args', () => {
  const p = real.skill.split('\n').find((l) => l.startsWith('   **The integrate call**'))
  const from = p.slice(p.indexOf('`prUrl`, `reviewHistory`, `reviewRoundsUsed` and `rung` are, verbatim,'), p.indexOf("; `rung` is the task's own rung record"))
  only(sk(from, '`reviewHistory` and `reviewRoundsUsed` come from the approving row when this session holds it, else from `lead-integrate.py inputs`'),
    'integrate-args', 'unchecked row')
})

test('control: the lane order dropped fails lane-order', () => {
  only(sk(" (`next` orders the Integration queue: a task a queued task depends on first, then the oldest `ready:`, then schedule order)", ''),
    'lane-order', 'no lane order')
})

test("control: an integrate call without a freshly resolved ladder fails ladder", () => {
  only(sk(", a freshly resolved `ladder` (§ 3: read at this call's start), `mode: 'integrate'`", ", `mode: 'integrate'`"), 'ladder', 'no fresh ladder')
})

test('control: a second max_tier: line fails ladder', () => {
  only(sk('| `env_bootstrap` | none (omit) |', '| `max_tier` | none (omit) | ignored |\n| `env_bootstrap` | none (omit) |'), 'ladder', 'second max_tier line')
})

test('control: a lead row written for an integrate call\'s review-blocked fails set-aside', () => {
  only(sk('so the lead writes **no** set-aside row of its own', 'so the lead writes its set-aside row'), 'set-aside', 'lead row')
})

test('control: hand-back with no remedy for a PR-less review note fails set-aside', () => {
  const l = real.skill.split('\n').find((x) => x.startsWith('- at its own run: `hand-back`'))
  only(sk(l, '- at its own run: `hand-back` (or `/thread:repair` § 4) sets `in_progress`, then *Restart routing*;'), 'set-aside', 'no PR-less remedy')
})

test('control: an unconditional case (ii) after a hand-back fails set-aside', () => {
  only(sk('merges through case (ii) when main has not moved since that Integration; otherwise `prepare` integrates it again.',
    'merges through case (ii) with no re-integration.'), 'set-aside', 'case (ii)')
})

test('control: repair treating a pause as nothing-to-fix fails pauses', () => {
  const p = real.skill.split('\n').find((l) => l.startsWith('A paused rollout is **intentional**'))
  only(sk(p, p.slice(0, p.indexOf(' Under a pause')) + ' `/thread:repair` treats it as nothing-to-fix.'), 'pauses', 'nothing-to-fix')
})

test('control: the version gate read before the lineage fails lineage', () => {
  const s2 = section(real.skill, S2)
  const lin = s2.slice(s2.indexOf('**Lineage first'), s2.indexOf('Then the version:'))
  const moved = edit(edit(real.skill, lin, ''), '**Incomplete check', lin + '**Incomplete check')
  only({ skill: moved }, 'lineage', 'version first')
})

test('control: no close-out case in § 2 fails lineage', () => {
  only(sk('otherwise → print "close-out interrupted: `/thread:repair [[this]]`"', 'otherwise → proceed'), 'lineage', 'no close-out')
})

test('control: step 1.1 without the RACE halt fails race-hold', () => {
  only(sk(' Its `raceHold` is read now: if it names a `RACE` task and the lane is free, halt (§ 7) with `reason="RACE undecided: [[<slug>]]"`.', ''),
    'race-hold', 'no step 1.1 halt')
})

test('control: a cold resume that halts on exit 3 fails race-hold', () => {
  only(sk('print the lines and go on, since the loop\'s step 1.1 holds them', 'halt with its lines'), 'race-hold', 'cold resume halts')
})

test('control: the gate-pending reason checked before UNVERIFIED fails race-hold', () => {
  const l = real.skill.split('\n').find((x) => x.startsWith('- `next` reports `halt: stuck`'))
  const u = 'with an UNVERIFIED hold among them, `reason="UNVERIFIED undecided: [[task]]"`, checked first; '
  only(sk(l, l.replace(u, '').replace(' — a **designed** pause', `; ${u.replace(', checked first; ', '')} — a **designed** pause`)), 'race-hold', 'UNVERIFIED late')
})

test('control: a template budget that drifts from execute fails budget', () => {
  only({ template: real.template.replace('any re-review + required checks + squash', 'any re-review + squash') }, 'budget', 'template drift')
})

// verify-timeout (p14-2)
test('control: a verify_timeout default of 3600 fails verify-timeout', () => {
  only(sk('| `verify_timeout` | `1800` |', '| `verify_timeout` | `3600` |'), 'verify-timeout', 'default 3600')
})

test('control: a RACE re-verify back on --timeout 1800 fails verify-timeout', () => {
  only(sk('race-<slug> --timeout <verify_timeout> --bootstrap', 'race-<slug> --timeout 1800 --bootstrap'), 'verify-timeout', 'race 1800')
})

test('control: a verify_timeout check read as each task starts fails verify-timeout', () => {
  only(sk('**Validate `verify_timeout` once per loop entry, before anything the entry writes.**', '**Validate `verify_timeout` as each task starts.**'),
    'verify-timeout', 'per task')
})

test("control: § 4.5's entry paragraph without the check fails verify-timeout", () => {
  only(sk(" Every entry then runs § 3's `verify_timeout` check once, before anything it writes; the lane uses that value until the next entry.", ''),
    'verify-timeout', 'no entry sentence')
})

test('control: a cold resume that checks after resume fails verify-timeout', () => {
  only(sk("then § 3's `verify_timeout` check; then `python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/reconcile-rollout.py resume --rollout <rollout-note>`",
    "then `python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/reconcile-rollout.py resume --rollout <rollout-note>`, then § 3's `verify_timeout` check"),
  'verify-timeout', 'check after resume')
})

test("control: the Pausing Reinstate without the check fails verify-timeout", () => {
  only(sk("re-runs § 2.5 and § 2.7, then § 3's `verify_timeout` check, then sees the `paused:` stamp", 're-runs § 2.5 and § 2.7, then sees the `paused:` stamp'),
    'verify-timeout', 'pausing reinstate')
})

test('control: § 7 without the verify_timeout halt fails verify-timeout', () => {
  const l = real.skill.split('\n').find((x) => x.startsWith('- `reconcile-rollout.py verify-timeout` exits 1 at an entry'))
  only(sk(l + '\n', ''), 'verify-timeout', 'no § 7 bullet')
})

// approved-plan (p14-2)
test("control: step 1.2 back on plan: '' fails approved-plan", () => {
  only(sk('plan: <plan.plan>}', "plan: ''}"), 'approved-plan', "plan ''")
})

test('control: step 3 back on plan: "" fails approved-plan', () => {
  only(sk('trouble, landed, plan, reviewHistory', 'trouble, landed, plan: "", reviewHistory'), 'approved-plan', 'plan ""')
})

test('control: step 3 without "verbatim" fails approved-plan', () => {
  only(sk('read at this launch (after the approving row is reconciled) and passed verbatim as the same JSON string, never retyped, summarised or truncated;',
    'read at this launch (after the approving row is reconciled);'), 'approved-plan', 'no verbatim')
})

test('control: a third lead-integrate.py plan read in Restart routing fails approved-plan', () => {
  only(sk("- else the task's own call.", "- else `lead-integrate.py plan --note <task note>`, then the task's own call."), 'approved-plan', 'third read')
})

test("control: § 6 without the '' removal fails approved-plan", () => {
  only(sk('`""` removes that section', '`""` leaves it too'), 'approved-plan', 'no removal')
})

// descope (p14-4)
test('control: an Automatic descope that re-judges on every loop entry fails descope', () => {
  only(sk('whose key this session has not judged', 'on each loop entry'), 'descope', 'no session key')
})

test('control: an Automatic descope that hands back on exit 3 fails descope', () => {
  only(sk('exit 3 → leave it set aside', 'exit 3 → `hand-back` it anyway'), 'descope', 'exit 3 handed back')
})

test('control: § 8 without the descope sentence fails descope', () => {
  const l = real.skill.split('\n').find((x) => x.startsWith('- **Never automate `/thread:repair`**'))
  only(sk(l, l.slice(0, l.indexOf(" One verb is the lead's as well as repair's"))), 'descope', 'no § 8 sentence')
})

test("control: § 6's undo that leaves the follow-up open fails descope", () => {
  only(sk('the follow-up note set to `status: dropped`', 'the follow-up note left as it is'), 'descope', 'follow-up left open')
})

test('control: a § 3 settings refusal without its halt reason fails settings', () => {
  only(sk('state=halted reason="rollout settings refused"`. The fix follows', 'state=waiting`. The fix follows'), 'settings', 'no § 3 reason')
})
test('control: a § 3 settings refusal that writes fails settings', () => {
  only(sk('Its exit 2 or 3 is the round-budget write-nothing halt', 'Its exit 2 or 3 is a warning; carry on with the built-in'), 'settings', 'writes on refusal')
})
test('control: § 7 without the settings halt fails settings', () => {
  only(sk('- `rollout-settings.py` exits 2 or 3 for a round-budget key absent at both levels', '- a resolver exits 2 or 3 for a round-budget key absent at both levels'), 'settings', 'no § 7 halt')
})
test('control: a --repo refusal fixed in the file fails settings', () => {
  only(sk('one naming `--repo` (the Project root is gone or its origin unreadable) is fixed by stamping the key', 'any other is fixed in the file'), 'settings', '--repo remedy')
})

test('the rules are all named (31) and each has a control', () => {
  assert.equal(RULES.length, 31)
  assert.deepEqual(RULES.filter((r) => !CONTROLLED.has(r)), [])
})
