// Execute's lead runs the queue (ADR 0030 decisions 2 to 5, p12-9): the § 4.5 loop and its neighbours in
// skills/execute/SKILL.md (the rollout clone's § 2.7 refresh and cited paths, § 2.8 launch gate and completion twin
// refresh among them, ADR 0042), the Stop hook it drives and the heartbeat prompt that backs it up. The scripts the prose
// calls are executed elsewhere (tests/lead-integrate.test.sh, skills/execute/tests/reconcile-rollout-lead.test.sh,
// skills/execute/tests/rollout-stop-driver.test.sh); this pins the prose an LLM lead follows.
//
// Every rule lives in one function, checkExecute({ skill, hooksJson, exists, template, driver }), that returns named failures, so the
// real files and the controls run through identical logic and no matcher can pass vacuously: each control mutates
// the real text in one place and must fail with exactly its rule. The status-line rule parses § 6's spec with the
// driver's own STATUS_RE (python, via spawnSync). Reads files only.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { collapse, read, root, section } from '../lib/contract-text.mjs'

const real = {
  skill: read('skills/execute/SKILL.md'),
  hooksJson: read('hooks/hooks.json'),
  exists: (p) => fs.existsSync(path.join(root, p)),
  template: read('skills/schedule/rollout-template.md'),
  driver: read('hooks/rollout-stop-driver.py'),
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
const S65 = /^### 6\.5\. /
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
  // The driver only loads here (STATUS_RE), recording nothing; its Run record still points at temp (p29-10: it records halts).
  const r = spawnSync('python3', ['-c', py, DRIVER, JSON.stringify(lines)],
    { encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', THREAD_EVENTS_DIR: path.join(os.tmpdir(), 'execute-queue-no-events') } })
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
function checkExecute({ skill, hooksJson, exists, template, driver }) {
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
  // Sub-step 2 opens with the Standing approval (ADR 0034), then the seeded revises.
  const s2sub = sub(/\*\*Seeded revises \(automatic\)/)
  if (!slots.includes("A **slot** is one task's own Workflow call") || !/a seeded revise — held/.test(slots) ||
    !slots.includes('Integration holds **no slot**') || !slots.includes('One Integration runs at a time') || !s2sub ||
    !s2sub.text.includes('`slotsInUse` (live plus restarts) plus the revises already launched in this step is below `slotLimit`') ||
    !s2sub.text.includes('otherwise it waits') || !s2sub.text.includes('re-run `next --running <the live slugs, them included>`')) {
    fails.push('slots')
  }

  // auto-revise: only autoRevise: true, with --max-review-rounds; revise-stopped and review-blocked wait for hand-back;
  // the resume's prUrl is inputs' prUrl (p17-1: the note's pr: as a PR URL), and a prUrlError launches nothing; an
  // answered entry (ADR 0035's answerRecorded) is skipped: the answer's route moves it.
  if (!s2sub || !s2sub.text.includes('Launch one only when it reports `autoRevise: true`') ||
    !s2sub.text.includes('Skip an entry whose `answerRecorded` is non-null: an answered block is the answer\'s') ||
    !s2sub.text.includes('--max-review-rounds') ||
    !s2sub.text.includes("resume: {stage: 'revise', prUrl: <inputs.prUrl>,") ||
    !s2sub.text.includes('A non-empty `prUrlError` (the note\'s `pr:` gives no PR URL the engine takes, step 3) launches nothing') ||
    !/A `revise stopped:`, review-blocked or out-of-rounds note is never launched here: it waits for `hand-back`/.test(s2sub.text)) {
    fails.push('auto-revise')
  }

  // halt-guard: seeded revises < restart/start < the halt guard, which is the last sub-step before the turn ends;
  // it acts only with the lane free, no live call and nothing launched in sub-step 2; sub-step 1 defers `halt`.
  const iRev = subs.findIndex((x) => /\*\*Seeded revises \(automatic\)/.test(x.text))
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
  // is), a non-empty rowRefused printed, a non-empty prUrlError (a note pr: with no PR URL, e.g. a bare #N and no GitHub
  // origin) set aside at Integration, never launched; the rung is the task's own record, the accepted row's, else the note's
  // (neutral when the note has no rung:), never the ladder's top rung, and no tier vocabulary left. prepare's
  // `unlisted`, `note` and `inert` only inform.
  if (!st3.includes('`startedAt` a fresh `lead-integrate.py stamp` taken at launch') ||
    !st3.includes("`readyAt` the note's `ready:`") ||
    !st3.includes('`prUrl`, `reviewHistory`, `reviewRoundsUsed` and `rung` are, verbatim, the `integrate` record of `python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/lead-integrate.py inputs --note <task note> --repo <repoPath> [--row') ||
    !st3.includes('the lead prints a non-empty `rowRefused`') || st3.includes('from the approving row when this session holds it') ||
    !st3.includes("A non-empty `prUrlError` (the note's `pr:` gives no PR URL the engine takes) launches nothing: the lead's own *Set aside* row at Integration (`--kind integration`) with `prUrlError` as the reason") ||
    !st3.includes("`rung` is the task's own rung record, the accepted row's (`startRung`, `rung`, `climbs`), else the note's `rung` record") ||
    !st3.includes('(neutral, `{startRung: "", rung: "", climbs: []}`, when the note has no `rung:`)') ||
    !st3.includes("never the ladder's top rung: Integration runs on the top rung whatever the record says") ||
    !st3.includes('`unlisted`, the commits in `taskBase..mainSha` that name no PR,') || !st3.includes('pass none of them to the integrate call') ||
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

  // heartbeat: the > ROLLOUT-HEARTBEAT prompt's clauses, in order. The stall re-entry is read on clause (7)'s own
  // span (p18-1): clause (2) now re-enters *Cold resume* too, on a lapsed room stop, so a whole-prompt match would
  // pass with clause (7)'s re-entry or its § 2.7 skip gone.
  const at = (k) => hb.indexOf(k)
  const hb7 = hb.indexOf('(7)') >= 0 ? hb.slice(hb.indexOf('(7)')) : ''
  if (!hb.includes('Read the last ROLLOUT-STATUS line') || !/state=done or state=halted.*CronDelete it and stop/.test(hb) ||
    !(at('`paused:`') >= 0 && at('`paused:`') < at('Lost calls') && at('Lost calls') < at('background Integration command') &&
      at('background Integration command') < at('starts `gated:`') && at('starts `gated:`') < at('starts `review required:`') &&
      at('starts `review required:`') < at('no Workflow call for this rollout is in flight')) ||
    !hb.includes('BEFORE any stall diagnosis') || !hb.includes('under a merge hold too') || !hb.includes('§4.5 *Lost call*') ||
    // *Lost call* resumes without re-checking liveness, so clause (3) applies it only to calls no longer in flight.
    !hb.includes('apply §4.5 *Lost call* to each call this session launched that is no longer in flight in /workflows with no reconciled row (never to a call still in flight') ||
    !hb.includes('`--running`') || !hb.includes('`<out>.rc`') || !hb.includes('merge-task.status') ||
    !hb7.includes('work remains') || !hb7.includes('§4.5 *Cold resume*') || !hb7.includes('skips § 2.7')) fails.push('heartbeat')

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
  const stuck7 = collapse(skill.split('\n').find((l) => l.startsWith('- `next` reports `halt: stuck`')) ?? '')
  const signOff7 = collapse(skill.split('\n').find((l) => l.startsWith('- `next` reports `halt: awaiting-sign-off`')) ?? '')
  if (!s1.includes('`raceHold`') || !s1.includes('the lane is free') || !s1.includes('`reason="RACE undecided: [[<slug>]]"`') ||
    !s1.includes('An `UNVERIFIED` entry stays set aside like any other') ||
    !coldR.includes('Exit 3 means `resume` held back an undecided RACE or UNVERIFIED') || !coldR.includes('print the lines and go on') ||
    !s7.includes('`next` reports a `RACE` in `raceHold` while the lane is free') || !s7.includes('`reason="RACE undecided: [[task]]"`') ||
    // ADR 0034: the stuck bullet names an UNVERIFIED first and no gate reason; a gate alone is § 7's awaiting-sign-off stop.
    !stuck7.includes('`reason="UNVERIFIED undecided: [[task]]"`, checked first') || stuck7.includes('gated inputs await sign-off') ||
    !signOff7.includes('`reason="awaiting sign-off: [[task]]"`') ||
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

  // verify-timeout (p14-2, L3; p23-4): the rollout key's default and its use. § 3's table row (default 1800, not
  // passed to the engine, read by `reconcile-rollout.py verify-timeout`); § 3's once-per-entry check, before anything
  // the entry writes, with its write-nothing halt and its four JSON keys; the verify line and the RACE re-verify bound
  // by it, with no literal 1800 left; the harness bound, now the harness maximum 7200000 (p23-4: the verify-slot wait,
  // the verifier and the margin fit inside it; no `(+ 600) × 1000` or 2400000 left), on the verify paragraph and § 8's
  // timeout guardrail; every entry description runs the check before its first write (§ 4.5's entry paragraph, Cold
  // resume, both Reinstates); § 7 lists the halt.
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
    !verifyP.includes("(7200000, the harness maximum, from this entry's § 3 `verify_timeout` check") || /\b2400000\b/.test(skill) ||
    /\+ 600\) × 1000/.test(skill) ||
    !vtP.includes('Exit 0 prints `{"verifyTimeout": <verify_timeout>, "harnessTimeoutMs": <harnessTimeoutMs>, "slotWait": <slot_wait>, "verifySlots": <verify_slots>, "verifySlot": {"script": <verify-slot.py>, "slots": <verify_slots>}}`') ||
    !timeoutGuard.includes('`timeout: <harnessTimeoutMs>` (7200000; their own `--slot-wait <slot_wait>` bounds the verify-slot wait and `--timeout <verify_timeout>` the verifier)') ||
    !recheck.includes("Every entry then runs § 3's `verify_timeout` check once, before anything it writes") ||
    !before(coldVT, VT, 'reconcile-rollout.py resume') || !before(reinstateVT, VT, 'clear-pause') || !before(pzReinstate, VT, 'clear-pause') ||
    !S(skill, S7).includes('`reconcile-rollout.py verify-timeout` exits 1 at an entry (`reason="invalid verify_timeout on [[rollout]]"`')) {
    fails.push('verify-timeout')
  }

  // verify-slots (p23-4): the machine's verify slots. The verify line and the RACE re-verify each take one
  // (`--slots <verify_slots> --slot-wait <slot_wait>`); `noslot` is no verdict: step 3 re-arms and re-runs with M
  // unpushed and the RACE re-runs with the lane held, and a third in a row halts (step 3 after `undo`); the verify
  // paragraph says the wait never counts against the deadline and the guard ends a SIGKILLed verify's verifier; § 3
  // has the machine-wide `verify_slots` row and verify-timeout's exit-3 halt with its "does not clear" remedy; § 4
  // passes `verifySlot` (and a resume never adds it); the *Verify slots* paragraph names both Integration waiters (the
  // lead's `lead-integrate.py verify` and the integrate call's `run --priority`), the guard and `status`, and (p31-3)
  // that an agent waits for its verdict inside its turn with `verify-slot.py wait`; § 7 lists the three halts.
  {
    const SLOTS = '--slots <verify_slots> --slot-wait <slot_wait>'
    const vsRow = s3raw.split('\n').find((l) => l.startsWith('| `verify_slots` |')) ?? ''
    const exit3 = collapse(s3raw.split('\n\n').find((x) => x.startsWith('**Exit 3 (the rollout settings refused).**')) ?? '')
    const vsP = labelled(skill, 'Verify slots')
    const s4 = S(skill, S4)
    const s7 = S(skill, S7)
    // p29-10: the Run record's --rollout and --slug ride between the slot flags and the bootstrap (execute-run-record).
    const REC = '--rollout "<rollout-note>" --slug <slug>'
    if (!vline.includes(` ${SLOTS} ${REC} --bootstrap`) || !raceLine.includes(` ${SLOTS} ${REC} --bootstrap`) ||
      !verifyP.includes('its `--timeout` deadline starts only once it holds one, so the wait never counts against `verify_timeout`') ||
      !verifyP.includes('only a SIGKILL leaves no rc, which reads as red; its guard still ends the verifier') ||
      !verifyP.includes('Any rc but 0 is red, except `noslot` (exit 75: no verify slot within `<slot_wait>`, the verifier never ran), which is no verdict') ||
      !st3.includes('`noslot` (exit 75: no verify slot came within `<slot_wait>`; the verifier never ran, so this is no verdict, never red): M stays unpushed and the lane held. After the canary `check`, re-arm (`--kind verify`) and re-run *The background verify command*.') ||
      !st3.includes('A third consecutive `noslot` on this verify: `undo`, then halt with `reason="no verify slot for [[slug]] in 3 tries"`') ||
      !raceLine.includes('`noslot` (no verify slot came within `<slot_wait>`: the verifier never ran, no verdict) → re-run the re-verify with the lane held') ||
      !raceLine.includes('a third consecutive `noslot` halts with `reason="RACE: no verify slot for the re-verify of [[slug]]"`') ||
      !vsRow.startsWith('| `verify_slots` | `2` | machine-wide; `[defaults]` only') || !vsRow.includes('never stamped on a rollout note') ||
      !vsRow.includes('read by `verify-timeout`') || !vsRow.includes('becomes `--slots`') || !vsRow.includes('`args.verifySlot.slots`') ||
      !exit3.includes('reason="rollout settings refused"') || !exit3.includes('The lead writes nothing') ||
      !exit3.includes('Stamping a key on the rollout note does not clear a `verify-timeout` exit 3: `verify_slots` is never stamped and the whole file is validated, so only fixing `~/.config/thread/rollouts.toml` at the line its stderr names') ||
      !s4.includes('"verifySlot": { "script": "<verify-timeout verifySlot.script>", "slots": 2 }') ||
      !s4.includes('adding `defaultBranch` or `verifySlot` to a run that started without it changes prompt bytes') ||
      !vsP.includes("The lead's `lead-integrate.py verify` (the Integration verify and the RACE re-verify) and the integrate call's agent verifier (`run --priority`, rendered only by the engine's integrate mode) register as Integration waiters") ||
      !vsP.includes('before the verify slot frees') || !vsP.includes('`python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/verify-slot.py status --slots <verify_slots>`') ||
      !vsP.includes('verify-slot.py wait --log') || !vsP.includes('waits inside its turn') ||
      !s7.includes('`reason="RACE: no verify slot for the re-verify of [[slug]]"`') || !s7.includes('`reason="no verify slot for [[slug]] in 3 tries"`') ||
      !s7.includes('`reconcile-rollout.py verify-timeout` exits 3 at an entry (§ 3: `reason="rollout settings refused"`') ||
      !s7.includes('stamping a key does not clear it')) {
      fails.push('verify-slots')
    }
  }

  // approved-plan (p14-2, L2; p27-1): the seeded revise (step 1.2) takes the approved plan from `lead-integrate.py
  // plan`, read at that launch only (Restart routing's revise reuses step 1.2's) and passed verbatim. The integrate
  // call (step 3) carries no `plan`: its integrator reads the note's `## Approved plan` itself (p27-1), so § 4.5 names
  // `lead-integrate.py plan` once. No empty-plan literal is left; § 6 lists the row's `plan` (then p21-3's
  // `reviewVerdicts` and p29-9's `flakes`, the row's last key), reconcile's three outcomes and who reads the section back.
  const planHits = (section(skill, S45) ?? '').split('lead-integrate.py plan').length - 1
  const s6 = S(skill, S6)
  const VERBATIM = 'passed verbatim as the same JSON string, never retyped, summarised or truncated'
  if (!s2sub || !s2sub.text.includes('`python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/lead-integrate.py plan --note <task note>`, then the Workflow call') ||
    !s2sub.text.includes('plan: <plan.plan>}') || !s2sub.text.includes(VERBATIM) ||
    !st3.includes('trouble, landed, reviewHistory') || st3.includes('landed, plan') ||
    !st3.includes("It carries no `plan` (p27-1): the integrator reads the task note's `## Approved plan` itself") ||
    planHits !== 1 || /plan: ''|plan: ""|`plan` is `""`/.test(s45) ||
    !s6.includes('gatedInputs, plan, reviewVerdicts, flakes }] }') || !s6.includes('upserts it, quoted, under `## Approved plan`') ||
    !s6.includes('`""` removes that section') || !s6.includes('`null` or absent leaves it') ||
    !s6.includes("`lead-integrate.py plan` reads it back for §4.5 step 1.2's seeded revise")) {
    fails.push('approved-plan')
  }

  // descope (p14-4): step 1.2's **Automatic descope** shares sub-step 2's line, so it runs before the halt guard
  // (halt-guard pins that order). Skipped under a pause; a `plan-blocked` set-aside judged once per session key (its
  // highest Plan-blocked run and that run's sha), never again on a heartbeat or another loop entry; the guarded verb
  // writes; exit 0 → `hand-back`, then `next` again; exit 3 leaves it set aside for `/thread:repair`, never a
  // hand-back, its refusal recorded (ADR 0035), so an answered entry and one whose `humanFix` reads `decide scope or
  // defer` are skipped, never re-judged by a new session. § 8 says the lead runs this one verb itself and its refusal routes to repair; *Set aside* names the
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
    !dsc.includes("skipping an entry whose `inputs` (*Recorded answer*'s read) reports a non-null `answerRecorded`") ||
    !dsc.includes('or a `humanFix.act` of `decide scope or defer`') ||
    !dsc.includes('the verb recorded the refusal on the task note, so its `humanFix` reads `decide scope or defer`') ||
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

  // auto-retry (p16-4, ADR 0033): step 1.2's **Automatic retry** shares sub-step 2's line after *Automatic descope*, so it
  // runs before the halt guard (halt-guard pins that order). Skipped under a pause; it reads `inputs … --repo`, halts on
  // `autoRetryError` (§ 3's round-budget halt), acts only on `autoRetry: true`, runs the guarded verb with the two
  // assertions copied from that read (never resolved by hand), skips a plan-blocked key whose descope exited 3, notes an
  // `autoRetryAfter` and re-runs `next`. The halt guard ends a quota or infra cool-down `waiting` with its reason, which
  // § 6 allows on `waiting`, but only while no UNVERIFIED task is set aside: with one, the `stuck` goes to § 7 (its
  // reason, with the item in the report's `Needs you:` block, § 6.5), so a cool-down never hides a human's item. A
  // gate-pending task never stops a cool-down (ADR 0034: a gate never holds the rollout; once only gates remain, step 5's
  // sign-off form closes the run); § 3 has the key's row (resolved by the verbs, never the lead); *Set aside* names the re-entry first;
  // § 6 has the event line, the `Auto-retried:` report row, and step 5's Completion log copies the `auto-retry:` lines;
  // § 7's stuck halt waits for the retries; § 8 names the lead's verb and its route to repair; a Don't forbids a
  // hand-written retry, a hand-resolved budget and hand-written markers. Every block whose way back is Lachy's (its
  // `humanFix`, ADR 0035) and a recorded answer are never retried, the why only a log line; and § 6.5 (c) counts a null
  // `humanFix` as the lead's own re-entry, so a task the lead re-enters is never pushed (p16-1).
  const ar = s2t.slice(Math.max(0, s2t.indexOf('**Automatic retry')))
  const arRow = (section(skill, S3) ?? '').split('\n').find((l) => l.startsWith('| `auto_retries` |')) ?? ''
  const arStuck = collapse(skill.split('\n').find((l) => l.startsWith('- `next` reports `halt: stuck`')) ?? '')
  const arLog = collapse(stepRaw(skill, 5).split('\n').find((l) => l.startsWith('   - Append a `## Completion log`')) ?? '')
  const s6all = collapse(s6raw)
  if (!s2t.includes('**Automatic retry (p16-4, ADR 0033).**') || !before(s2t, '**Automatic descope', '**Automatic retry') ||
    !ar.includes('Skip it when `paused` or `pauseRequested` is set') ||
    !ar.includes('`python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/lead-integrate.py inputs --note <task note> --repo <repoPath>`') ||
    !ar.includes("Its `autoRetryError` is § 3's round-budget halt") || !ar.includes('Act only on `autoRetry: true`') ||
    !ar.includes('`python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/reconcile-rollout.py auto-retry --tasks <slug> --rollout <rollout-note> --auto-retries <inputs.autoRetryBudget.autoRetries.value> --fingerprint <inputs.fingerprint>`') ||
    !ar.includes('both values copied from that `inputs`, never resolved by hand') ||
    !ar.includes('skipping a `plan-blocked` key whose descope exited 3 this session') ||
    !ar.includes('Note any `autoRetryAfter` (a quota or infra cool-down), with its `autoRetryClass`, for the halt guard') ||
    !ar.includes('each of its retries first waits a short cool-down, 15, then 60, then 240 minutes') ||
    !ar.includes('If any retry ran, re-run `next --running <the live slugs>`') ||
    !guard.includes('A `stuck` while step 1.2 found an `autoRetryAfter` (a quota or infra cool-down), and no UNVERIFIED task among the set-aside entries, ends the turn `waiting` with `reason="<autoRetryClass> cool-down: [[<slug>]] retries at <autoRetryAfter>"`') ||
    !guard.includes('With an UNVERIFIED task among them, a cool-down holds nothing back: the `stuck` goes to § 7 as usual') ||
    !guard.includes('A gate-pending task never stops a cool-down') ||
    !guard.includes("with the item in the report's `Needs you:` block, § 6.5)") ||
    !s6all.includes('`reason` appears only on `halted`, on a hold and on a retry cool-down') ||
    !arRow.includes('resolved by `lead-integrate.py inputs` and `reconcile-rollout.py auto-retry` themselves (built-in `2`)') ||
    !arRow.includes('not passed to the engine') || !arRow.includes('`0` disables every automatic retry') ||
    !arRow.includes('The lead never resolves it') ||
    !aside.includes("- first, automatically: a run, revise-stopped, review-blocked, plan-blocked or Integration set-aside is re-entered by step 1.2's *Automatic retry*, up to `auto_retries` times (ADR 0033), before the routes below") ||
    !s6all.includes('"[[task-q]] → auto-retry 1/2 (plan; feedback <sha>); restarting"') || !s6all.includes('Auto-retried: [[task-q]]') ||
    !s6all.includes('The `Auto-retried:` line lists every automatic retry this rollout has recorded (its `## Notes` `auto-retry:` lines)') ||
    !arLog.includes('the automatic retries copied from its `auto-retry:` lines') ||
    !arStuck.includes("acted on only once step 1.2's *Automatic retry* re-entered nothing and found no cool-down, or found one with an UNVERIFIED task set aside") ||
    !never.includes("The lead runs `reconcile-rollout.py auto-retry` itself too (§ 4.5 step 1.2's *Automatic retry*)") ||
    !never.includes('a spent budget, a repeated fingerprint or a `needsHuman` question routes the task to repair') ||
    !donts.includes('Never auto-retry unless `inputs` reports `autoRetry: true`, never pass a budget you resolved yourself') ||
    !donts.includes('`auto_retries_used`, `quota_retries_used`, `auto_retry_sha` or `auto_retry_at` by hand: `reconcile-rollout.py auto-retry` writes them') ||
    !ar.includes("for every block whose way back is Lachy's (its `humanFix` names the one act that moves it, ADR 0035, § 6.5) and for a recorded answer (`answerRecorded`") ||
    !ar.includes("its `autoRetryWhy` is the log line only, never Lachy's reason") ||
    !S(skill, S65).includes("A null `humanFix` is the lead's own re-entry (step 1.2's seeded revise, its *Automatic retry* now or once a cool-down ends,") ||
    !S(skill, S65).includes('under a pause step 1.2 is skipped, so such an entry waits for the reinstate and stays excluded')) {
    fails.push('auto-retry')
  }

  // recorded-answer (ADR 0035 decision 3): step 1.2's **Recorded answer**, after the seeded revises and before the
  // automatic descope and retry, hands back a `hand-back` answer once nothing is paused: skipped under a pause, it acts
  // only on answerRecorded non-null, form `hand-back` and a null humanFix (the script's predicate, never the lead's
  // reading of the answer), through `hand-back --answer <stamp>` (a compare-and-swap), and re-runs `next`. Set aside
  // names the route, § 6 its event line, § 8 the verb as the lead's, a Don't bars any other hand-back on an answer and
  // any key written by hand, and "retry [[task]]" leaves the spend to the verb.
  const rec0 = s2t.indexOf('**Recorded answer')
  const recA = rec0 >= 0 ? s2t.slice(rec0, s2t.indexOf('**Automatic descope') > rec0 ? s2t.indexOf('**Automatic descope') : undefined) : ''
  const retryInv = collapse(skill.split('\n').find((l) => l.startsWith('In a live session, "retry [[task]]"')) ?? '')
  if (!recA.includes('**Recorded answer (ADR 0035).**') || !before(s2t, '**Seeded revises', '**Recorded answer') ||
    !before(s2t, '**Recorded answer', '**Automatic descope') || !before(s2t, '**Recorded answer', '**Automatic retry') ||
    !recA.includes('Skip it when `paused` or `pauseRequested` is set') ||
    !recA.includes('Act only when its `answerRecorded` is non-null, its `answerRecorded.form` is `hand-back` and its `humanFix` is null') ||
    !recA.includes('`python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/reconcile-rollout.py hand-back --tasks <slug> --answer <answerRecorded.stamp>`') ||
    !recA.includes('is a compare-and-swap') ||
    !recA.includes('After any hand-back, re-run `next --running <the live slugs>` and use that output from here on') ||
    !recA.includes('a hand-back counts as "sub-step 2 launched"') ||
    !aside.includes("- a recorded answer: step 1.2's *Recorded answer*, once nothing is paused") ||
    !collapse(s6raw).includes('"[[task-r]] → handed back on your answer of <stamp>; restarting"') ||
    !never.includes("The lead runs `reconcile-rollout.py hand-back --answer <stamp>` itself too (§ 4.5 step 1.2's *Recorded answer*)") ||
    !donts.includes('Never hand back on a recorded answer except through `reconcile-rollout.py hand-back --answer <stamp>`') ||
    !donts.includes('never write, supersede or spend a `## Repair input` key by hand') ||
    !retryInv.includes('which spends the answers its `## Repair input` holds in the same save') || /spend the answers its/.test(retryInv)) {
    fails.push('recorded-answer')
  }

  // lane-order (p17-1): sub-step 4 takes the Integration queue in `next`'s order and says what that order is, a
  // dependency on a folded member (an affine tombstone's `merged_into:`) included.
  const s4sub = sub(/^If the lane is free, take `next`'s first `integrating` task/)
  if (!s4sub || !s4sub.text.includes("else its first `awaitingIntegration` task (`next` orders the Integration queue: a task a queued task depends on, directly or through a folded member (`merged_into:`), first, then the oldest `ready:`, then schedule order)")) {
    fails.push('lane-order')
  }

  // clone-root (ADR 0042, p26-2): § 2.7 refreshes the rollout clone before the pushed-base check and passes the
  // not-yet-merged tasks' cited paths (`reconcile-rollout.py cited`), with the clone-rooted sentence; § 2.8 gates the
  // launch directory; step 5 refreshes the in-place twin between the `status: done` stamp and the Completion log; and
  // Scope names the twin refresh.
  const s27c = S(skill, /^### 2\.7\. /)
  const s28c = S(skill, /^### 2\.8\. /)
  const s5raw = stepRaw(skill, 5)
  const stampAt = s5raw.indexOf('   - Stamp `status: done` + `completed: <date>` on the rollout frontmatter.')
  const ripAt = s5raw.indexOf('self-rollout-check.sh --refresh-in-place <Project root>')
  const logAt = s5raw.indexOf('   - Append a `## Completion log`')
  if (!s27c.includes('reconcile-rollout.py cited --rollout <rollout-note>') ||
    // A failed `cited` call fails closed: with no cited paths no peer blocks, so passing none would fail open.
    !s27c.includes('A non-zero exit there fails closed: the pushed-base check never runs, and the entry takes the write-nothing halt below with `reason="pushed-base check failed"`') ||
    !s27c.includes('or `reconcile-rollout.py cited` exiting non-zero before it: the same write-nothing halt with `reason="pushed-base check failed"`') ||
    /passes none/.test(s27c) ||
    !before(s27c, 'self-rollout-check.sh --refresh <Project root>', 'Then run the pushed-base check') ||
    !s27c.includes('In a clone-rooted rollout (every rollout scheduled after P26, and every self-rollout), a commit in any other clone of the set') ||
    !s27c.includes('In an in-place-rooted rollout, one in another clone of the set is still named first') ||
    !s28c.includes('--launch-check') || !s28c.includes('reason="launched outside the Project root"') ||
    // Repair's hand-off enters the loop past § 2.7, so it runs § 2.8 itself (repair § 4), never exempt from it.
    /repair hand-off/.test(s28c) ||
    !s28c.includes("Repair's hand-off (`/thread:repair` § 4) enters the loop past § 2.7, so it runs this snippet itself before it hands off, and on exit 3 stops at its diagnosis with no hand-off") ||
    stampAt < 0 || ripAt < stampAt || logAt < ripAt || !S(skill, /^## Scope/).includes('--refresh-in-place')) fails.push('clone-root')

  // s5 (the dead-run resume keeps its shape for its consumers) is part of lost-call's routing: § 5 names *Lost call*.
  if (!s5.includes('(§ 4.5 *Lost call*)') || !before(s5, '(§ 4.5 *Lost call*)', 'resumeFromRunId: <runId>')) fails.push('lost-call')

  // trickle (p28-1, Chorus ADR 0104): § 4.5's *The Trickle* paragraph names the state file, its spec, slotLimit and the
  // `trickle:` hold that never halts; step 1.1 relays the WARN line verbatim, once per session; step 1.6 waits on a
  // `trickle:` hold with its reason=; § 5's Heartbeat paragraph covers that waiting turn and clause (7) reads its reason
  // as no hold; § 6's waiting bullet, § 8's Stop-hook paragraph and the driver's docstring and block reason name it.
  // A restart waits on the ceiling alone (the round-1 respawn deadlock), so the paragraph says so, and step 1.2's
  // automatic retry restarts within the ceiling, never held by the Trickle. Step 1.5's halt guard turns a `stuck` over
  // a seeded revise step 1.2 held only for want of `slotLimit` into a Trickle wait, never § 7 (the round-1 false stuck),
  // and step 1.2's seeded revise names that clause. p29-8 (ADR 0049): while Away the Away cap takes the Trickle's place,
  // so the paragraph gives its slotLimit and its `away cap:` hold that never halts (a meant wait, never Stalled), and
  // steps 1.5 and 1.6, clause (7), § 6, § 8 and the driver name the Away-cap wait beside the Trickle wait. p28-3: the
  // paragraph names the **Trickle claim** `next` takes for each start, and step 1.1 relays its `WARN: trickle claims` line.
  const trickleP = labelled(skill, 'The Trickle (Chorus ADR 0104).')
  const tr1 = subs[0]?.text ?? ''
  const tr6 = sub(/^End the turn `waiting`/)?.text ?? ''
  const trGuard = sub(/^\*\*Halt guard/)?.text ?? ''
  const trRev = sub(/\*\*Seeded revises \(automatic\)/)?.text ?? ''
  const waitingB = collapse(s6raw.split('\n').find((l) => l.startsWith('- `waiting` — ')) ?? '')
  const hookP = collapse(skill.split('\n').find((l) => l.startsWith('**The Stop-hook driver**')) ?? '')
  const drvDoc = collapse((driver ?? '').split('"""')[1] ?? '')
  const drv = driver ?? ''
  const drvBlock = drv.indexOf('ROLLOUT-DRIVER:') >= 0 ? drv.slice(drv.indexOf('ROLLOUT-DRIVER:'), drv.indexOf('Do not end the turn while')) : ''
  if (!trickleP.includes('`~/.config/thread/away.json`') || !trickleP.includes('`skills/execute/away.md` holds the spec') ||
    !trickleP.includes('`slotLimit`') || !trickleP.includes('`trickle: <running>/<N> tasks running on this Mac`') ||
    !trickleP.includes('a `trickle:` hold never halts the rollout') || !trickleP.includes('A running call is never stopped') ||
    !trickleP.includes('`WARN: ~/.config/thread/away.json …` line') || !trickleP.includes('The lead never reads or writes the file') ||
    !tr1.includes('A `WARN: ~/.config/thread/away.json` line on its stderr') ||
    !tr1.includes('is printed verbatim the first time this session sees that exact line') ||
    !trickleP.includes('a **Trickle claim**') || !tr1.includes('A `WARN: trickle claims` line on its stderr') ||
    !tr6.includes('A `trickle:` hold (*The Trickle*) ends the turn `waiting` too') ||
    !tr6.includes('`reason="trickle: <trickle.running>/<trickle.limit> tasks running on this Mac"`') ||
    !tr6.includes('a Trickle wait can stand with nothing of this rollout in flight') ||
    !hbPara.includes("a Trickle wait's `waiting` turn (§4.5 step 1.6)") ||
    !hb7.includes('(a `trickle:` or `away cap:` reason is no hold: the Trickle or the Away cap may have room now)') ||
    !waitingB.includes('or `next` holds a task on the Trickle (§4.5 step 1.6)') || !waitingB.includes("a Trickle wait's (`trickle: …`)") ||
    !hookP.includes('or a Trickle wait stands)') ||
    !drvDoc.includes('or a Trickle wait stands') || !drvBlock.includes('or a Trickle wait stands') ||
    !trickleP.includes('A restart waits on the ceiling alone') ||
    !trickleP.includes('counting every `in_progress` task of this rollout, live or stalled') ||
    !trRev.includes('within the ceiling like any restart, never held by the Trickle') ||
    !trRev.includes('A revise held only by `slotLimit`, below `ceiling`, is a Trickle wait: the halt guard (step 1.5) never halts on it') ||
    !trGuard.includes('A `stuck` while step 1.2 held an `autoRevise: true` seeded revise only for want of `slotLimit`') ||
    !trGuard.includes('ends the turn `waiting` with `reason="trickle: <trickle.running>/<trickle.limit> tasks running on this Mac"`, never § 7') ||
    !trGuard.includes("Like `next`'s own `trickle:` hold, it waits whatever else is set aside") ||
    !(S(skill, S7) ?? '').includes('and never while step 1.2 holds a seeded revise on the Trickle, a Trickle wait (§4.5 step 1.5)') ||
    // the Away cap (p29-8)
    !trickleP.includes('`min(ceiling, max(0, A − that count))` while Away') ||
    !trickleP.includes('While Away the same row reads `away cap: <running>/<A> tasks running on this Mac`, and an `away cap:` hold never halts the rollout either') ||
    !trickleP.includes('a rollout the Away cap alone holds is a meant wait, never Stalled (ADR 0048)') ||
    !trGuard.includes('While Away (`trickle.away` true) it is an Away-cap wait, the same in every way but its reason, `reason="away cap: <trickle.running>/<trickle.awayCap> tasks running on this Mac"`') ||
    !tr6.includes('An `away cap:` hold, or step 1.5\'s revise held while Away, ends the turn `waiting` the same way with `reason="away cap: <trickle.running>/<trickle.awayCap> tasks running on this Mac"`') ||
    !waitingB.includes('or on the Away cap while Away') || !waitingB.includes("an Away-cap wait's (`away cap: …`)") ||
    !hookP.includes('an Away-cap wait stands') || !hbPara.includes("a Trickle wait's `waiting` turn (§4.5 step 1.6), an Away-cap wait's included") ||
    !trRev.includes('never halts on it (while Away, an Away-cap wait, the same)') ||
    !drvDoc.includes('or an Away-cap wait does (on the machine-wide Away cap while Lachy is Away, ADR 0049)') ||
    !drvBlock.includes('or an Away-cap wait does (on the Away cap, ')) fails.push('trickle')

  // heat (p31-4, estate ADR 0009 d5): § 4.5's *The Heat hold* paragraph names slotLimit 0 Away included, the restart on
  // the ceiling alone, the `heat:` reason that never halts, exit 76 as no verdict and its spec; step 1.2's revise held at
  // heat is a Heat hold; step 1.5's heat clause waits with its reason=, never § 7, ahead of the Trickle's; step 1.6 ends
  // the turn `waiting` on a `heat:` hold, its reason before the Trickle's; step 3 and the RACE procedure re-run on `heat`
  // and never count it toward the third-`noslot` halt; step 5's completion verify lists `heat` as no verdict that never
  // counts; *The background verify command* reads `heat` as no verdict with W covering the heat; *Verify slots* names the
  // hold; § 5's Heartbeat paragraph covers the waiting turn and clause (7) reads a `heat:` reason as no hold (beside the
  // pinned trickle parenthetical); § 6's waiting bullet and reason list, § 7's stuck bullet, § 8's Stop-hook paragraph
  // and the driver's docstring and block reason name it.
  {
    const heatP = labelled(skill, 'The Heat hold (estate ADR 0009 d5).')
    const st5 = step(skill, 5)
    const vsP = labelled(skill, 'Verify slots')
    const reasonL = collapse(s6raw.split('\n').find((l) => l.startsWith('`reason` appears only on')) ?? '')
    if (!heatP.includes('`slotLimit` 0, Away included') || !heatP.includes('a restart still waits on the ceiling alone') ||
      !heatP.includes('`heat: the Mac is hot (<name>)`') || !heatP.includes('a `heat:` hold never halts the rollout') ||
      !heatP.includes('exit 76: no verdict, never red') || !heatP.includes('A running call is never stopped') ||
      !heatP.includes('`skills/execute/away.md` § Heat holds the spec') ||
      !trRev.includes('such a revise is a Heat hold instead, the same wait') ||
      !trGuard.includes('is a Heat hold, and takes the place of the Trickle clause that follows') ||
      !trGuard.includes('ends the turn `waiting` with `reason="heat: the Mac is hot (<heat.name>)"`, never § 7, whatever else is set aside') ||
      !tr6.includes('A `heat:` hold (*The Heat hold*) ends the turn `waiting` the same way') ||
      !tr6.includes("and it comes before the Trickle's, since a hot Mac holds every row the Trickle would") ||
      !st3.includes('- `heat` (exit 76: the Mac was too hot for the whole `<slot_wait>`') ||
      !st3.includes('a `heat` never counts toward the third-`noslot` halt, nor resets its count') ||
      !raceLine.includes('`heat` (exit 76: the Mac was too hot for the whole `<slot_wait>`, *The Heat hold*: no verdict) → re-run the re-verify the same way with the lane held, never counted toward that halt') ||
      !st5.includes('`heat`: the Mac was too hot to run the suite within the slot wait, a Heat hold') ||
      !st5.includes('a `stopped` or `heat` one never counts') ||
      !verifyP.includes('So is `heat` (exit 76, *The Heat hold*)') ||
      !verifyP.includes('every slot wait, heat hold and heat-stopped run counts against `<slot_wait>`') ||
      !vsP.includes('**The Heat hold:** at heavy no verify slot is free') ||
      !hbPara.includes("A Heat hold's `waiting` turn (§4.5 step 1.6, *The Heat hold*) is covered the same way") ||
      !hb7.includes('and a `heat:` reason no hold either (the Mac may have cooled)') ||
      !waitingB.includes('or a Heat hold stands (§4.5 step 1.6, *The Heat hold*)') || !waitingB.includes("a Heat hold's (`heat: …`)") ||
      !reasonL.includes('and on a Heat hold (§4.5 step 1.6)') ||
      !(S(skill, S7) ?? '').includes('or on the Heat hold, the same wait') ||
      !hookP.includes("a Heat hold's `waiting` included") ||
      !drvDoc.includes('or a Heat hold stands (`heat: …`') || !drvBlock.includes('or a Heat hold stands (`heat: …`, the "')) {
      fails.push('heat')
    }
  }

  // skip-path (ADR 0045, p29-3): step 3's prepare carries the verifier and bootstrap, single-quoted; a `skip` bullet after
  // set-aside re-checks (§ 2.5 then § 2.6), pushes M, logs (M, mainSha) and goes to step 4 with no verifier, a refused
  // push undoes and integrates with trouble []; the lead prints inert.why (an inert check error included); the exit-3 row
  // names the skip and § 3's verifier row the prepare flag.
  const skipB = st3.slice(st3.indexOf('**`skip`**'), st3.indexOf('**exit 8**'))
  const verifierRow = (section(skill, S3) ?? '').split('\n').find((l) => l.startsWith('| `verifier` |')) ?? ''
  if (!st3.includes("lead-integrate.py prepare --repo <repoPath> --slug <slug> --default <defaultBranch> --note <task note> --verifier '<verifier>' --bootstrap '<env_bootstrap>'") ||
    st3.indexOf('**`set-aside`**') < 0 || st3.indexOf('**`skip`**') < st3.indexOf('**`set-aside`**') ||
    !skipB.includes('no verifier runs') || !before(skipB, 'Re-run § 2.5', 'then § 2.6') ||
    !before(skipB, 'then § 2.6', 'lead-integrate.py push --repo <repoPath> --slug <slug> --head M') ||
    !before(skipB, '--head M`', 'log-integration --tasks <slug> --started "$S" --anchor <anchor> --head M --base <mainSha>') ||
    !before(skipB, 'log-integration', 'then step 4 with (M, `mainSha`)') ||
    !skipB.includes('Push refused (exit 1): `undo') || !skipB.includes('then the integrate call with `trouble []`') ||
    !skipB.includes('Print `inert.why`') || !st3.includes('print `inert.why` whenever the route is `verify` or `skip` (an `inert check error: …` included') ||
    !(rows['3'] ?? '').includes('it may route `skip`') || !verifierRow.includes('`lead-integrate.py prepare --verifier`')) fails.push('skip-path')

  // last-starts (p28-2, Chorus ADR 0104 d4): § 4.5's *The last starts* paragraph says `next` holds the start and
  // reports `lastStarts`, the lead never reads the file, the hold never halts and restarts are exempt, pointing at
  // away.md; step 1.6 waits on a `last start:` hold with its reason=; § 5's Heartbeat paragraph covers that waiting turn
  // and clause (7) reads its reason as no hold; § 6's waiting bullet and reason list, § 8's Stop-hook paragraph and the
  // driver's docstring and block reason name it. Each site is its own clause, so one control per site.
  const lastP = labelled(skill, 'The last starts (Chorus ADR 0104 d4).')
  if (!lastP.includes('`next` holds the start itself and reports `lastStarts`') || !lastP.includes('the lead never reads the file or the history') ||
    !lastP.includes('A `last start:` hold never halts the rollout: the turn ends `waiting` (step 1.6)') ||
    !lastP.includes('Restarts are exempt, a set-aside task\'s hand-back and a seeded revise included') ||
    !lastP.includes('`skills/execute/away.md` § The last starts and § The night record hold the spec') ||
    !tr6.includes('A `last start:` hold (*The last starts*) ends the turn `waiting` too') ||
    !tr6.includes('`reason="last start: held until the Morning at <trickle.morning>"`') ||
    !hbPara.includes("It covers a last-starts wait's `waiting` turn (§4.5 step 1.6) too.") ||
    !hb7.includes('A `last start:` reason is no hold either (the Morning may have come)') ||
    !waitingB.includes('or `next` holds a task on the last starts (§4.5 step 1.6)') ||
    !waitingB.includes("a last-starts wait's (`last start: …`)") ||
    !s6all.includes('and on a last-starts wait (§4.5 step 1.6)') ||
    !hookP.includes('a last-starts wait stands,') ||
    !drvDoc.includes('or a last-starts wait stands (`next` holds a task on the last starts') ||
    !drvBlock.includes('or a last-starts wait stands (`next` holds a "') || !drvBlock.includes('reason=\\"last start: …\\"')) fails.push('last-starts')

  // hold (p30-3; vault-grammar § Hold until): `next` reads a PR hold itself, so the lead never asks whether one stands.
  // Step 1.1 prints each cleared hold and makes a hold that waits on Lachy an (f) item; a rollout hold skips step 1.2
  // whole, as a pause does (every part of it launches a call or re-queues a task), Integration carrying on, and a
  // set-aside with its own hold is skipped the same way; step 1.5's `held` goes to § 7 only when Lachy must act (a
  // rollout hold waiting on him, or no hold waiting on a merge), else ends `waiting` on `held until <pr> merges`; step
  // 1.6 and § 5 register the heartbeat for that wait, and clause (7) reads its reason as no hold, so each tick re-runs
  // `next`, which sees the merge; § 6's waiting bullet, § 7, § 8 and the driver's docstring and block reason name it.
  const hoStand = sub(/^\*\*Standing approval \(ADR 0034\), first\.\*\*/)?.text ?? ''
  const hookP8 = collapse(skill.split('\n').find((l) => l.startsWith('**The Stop-hook driver**')) ?? '')
  const hbCron8 = collapse(skill.split('\n').find((l) => l.startsWith('**The heartbeat cron**')) ?? '')
  const s7c = S(skill, S7)
  if (!tr1.includes('Its `holdUntil` (a PR hold, `skills/_shared/vault-grammar.md` § Hold until) is read now too') ||
    !tr1.includes('print `hold released: <pr> merged; hold_until cleared on [[<note>]]`') ||
    !hoStand.includes('**A PR hold skips this whole step.** While any `holdUntil` entry with `scope: rollout` reads `held: true`, none of step 1.2 runs, as under a pause') ||
    !hoStand.includes('Integration of the tasks that already have a PR carries on (sub-step 4)') ||
    !hoStand.includes('A `setAside` entry that carries its own `holdUntil` (a task-scope hold) is skipped by every part of this step in the same way') ||
    !hoStand.includes('`next` reads `halt: held`, never `stuck`') ||
    !trGuard.includes('`held` → a PR hold') ||
    !trGuard.includes('when a held entry with `scope: rollout` has `waits: you`, or no held entry has `waits: merge`, go to § 7 with `reason="hold_until needs you on [[<note>]]: <pr> closed unmerged"`') ||
    !trGuard.includes('otherwise end the turn `waiting` with `reason="held until <pr> merges"` (the first held entry with `waits: merge`), never § 7') ||
    !tr6.includes("A PR hold's wait (step 1.5's `held until …`) can stand with nothing in flight too: it registers the heartbeat, and each tick re-enters *Cold resume* through clause (7)") ||
    !hbPara.includes("a PR hold's `waiting` turn (§4.5 step 1.5)") ||
    !hb7.includes('nor is a `held until` reason (a PR hold: the PR may have merged, and only `next` reads it)') ||
    !waitingB.includes('or a PR hold waits on its merge (`next` reports `halt: held`, §4.5 step 1.5)') ||
    !waitingB.includes("a PR hold's (`held until …`)") ||
    !s7c.includes('- `next` reports `halt: held` with a hold that waits on Lachy') ||
    !s7c.includes('A **PR hold** that can release itself is not a halt: it ends `waiting`') ||
    !hookP8.includes('a merge hold is in flight, a PR hold waits on its merge,') ||
    !hbCron8.includes("as it does under a PR hold's wait") ||
    !drvDoc.includes('or a PR hold waits on its merge (`next` reports `halt: held`, reason="held until …", execute §4.5 step 1.5') ||
    !drvBlock.includes('a PR hold waits on its merge (`next` reports `halt: held`, ') ||
    !drvBlock.includes('with its reason=\\"held until …\\", §4.5 step 1.5)')) fails.push('hold')
  return [...new Set(fails)]
}

test('execute § 4.5, its neighbours, the heartbeat and the hook hold every queue rule', () => {
  assert.deepEqual(checkExecute(real), [])
})

// ---- controls: each mutates the real text in one place and must fail with exactly its rule ---------

const RULES = ['protocol-5', 'launch', 'slots', 'auto-revise', 'halt-guard', 'lost-call', 'clean-path', 'verify-bound',
  'trouble-path', 'integrate-args', 'set-aside', 'merge-exits', 'holds', 'checks', 'pauses', 'single-wave', 'status-line',
  'heartbeat', 'heartbeat-register', 'no-wave-mechanics', 'driver', 'resume-running', 'lineage', 'race-hold', 'budget',
  'ladder', 'verify-timeout', 'approved-plan', 'descope', 'settings', 'lane-order', 'auto-retry', 'recorded-answer',
  'verify-slots', 'clone-root', 'trickle', 'skip-path', 'last-starts', 'hold', 'heat']
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

test('control: § 2.7 without the cited paths, or step 5 without the twin refresh, fails clone-root', () => {
  only(sk('`python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/reconcile-rollout.py cited --rollout <rollout-note>`', '`nothing`'),
    'clone-root', 'no cited paths')
  only(sk('   - Refresh the in-place checkout once: `bash ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/self-rollout-check.sh --refresh-in-place <Project root>`',
    '   - Leave the in-place checkout alone'), 'clone-root', 'no twin refresh')
  only(sk('reason="launched outside the Project root"`.', 'reason="elsewhere"`.'), 'clone-root', 'no launch gate reason')
  only(sk('`resumeFromRunId` resume or Stage re-send. Repair\'s hand-off (`/thread:repair` § 4) enters the loop past\n§ 2.7, so it runs this snippet itself before it hands off, and on exit 3 stops at its diagnosis with no hand-off,\ntelling Lachy to run `/thread:execute` from the Project root.',
    '`resumeFromRunId` resume, repair hand-off or Stage re-send.'), 'clone-root', "§ 2.8 exempting repair's hand-off")
  only(sk('A non-zero exit there fails closed: the pushed-base check never runs, and the\nentry takes the write-nothing halt below with `reason="pushed-base check failed"`, its stderr printed verbatim.\nRunning it with no cited paths instead would let no peer block, so a commit a task needs would pass silently.',
    'A non-zero exit there passes none and is a `WARN:` for the report.'), 'clone-root', 'a failed cited call fails open')
})

test('control: protocol 3 proceeding fails protocol-5', () => {
  only(sk('- `protocol_version: 5` → proceed.', '- `protocol_version: 3` → proceed.'), 'protocol-5', 'protocol 3')
})

test('control: Restart routing without the revise route fails launch', () => {
  only(sk('reports `resumeAt: revise` → step 1.2', 'reports a revise marker → step 1.2'), 'launch', 'no resumeAt')
})

test('control: a seeded revise launched regardless of the ceiling fails slots', () => {
  only(sk('; otherwise it waits, blocked, for a later step 1', ''), 'slots', 'no wait')
})

test("control: a seeded revise on the note's raw pr: fails auto-revise", () => {
  only(sk("resume: {stage: 'revise', prUrl: <inputs.prUrl>,", "resume: {stage: 'revise', prUrl: <inputs.pr>,"), 'auto-revise', 'raw pr')
})

test('control: Seeded revises without the answered skip fails auto-revise', () => {
  only(sk(" Skip an entry whose `answerRecorded` is non-null: an answered block is the answer's (*Recorded answer* below, or `/thread:repair`).", ''),
    'auto-revise', 'no answered skip')
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

test("control: clause (7) without its stall re-entry fails heartbeat, though clause (2) re-enters too", () => {
  only(sk('re-enter /thread:execute [[<rollout-slug>]] §4.5 *Cold resume* (this re-entry skips § 2.7, execute\'s entry-point-only pushed-base gate); else end the turn silently.',
    'end the turn silently.'), 'heartbeat', 'no stall re-entry')
})

test("control: clause (7) without its § 2.7 skip fails heartbeat, though clause (2) skips it too", () => {
  only(sk(" (this re-entry skips § 2.7, execute's entry-point-only pushed-base gate)", ''), 'heartbeat', 'no § 2.7 skip')
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
  only(sk("--bootstrap '<env_bootstrap>' --verifier '<verifier>' --diff-base '<the merge commit>^1'", '--bootstrap "<env_bootstrap>" --verifier "<verifier>" --diff-base \'<the merge commit>^1\''),
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

test('control: an integrate call launched on a prUrlError fails integrate-args', () => {
  only(sk("A non-empty `prUrlError` (the note's `pr:` gives no PR URL the engine takes) launches nothing: the lead's own *Set aside* row at Integration (`--kind integration`) with `prUrlError` as the reason, since",
    'The integrate call launches whatever `prUrl` reads, since'), 'integrate-args', 'prUrlError launched')
})

test('control: the lane order dropped fails lane-order', () => {
  only(sk(" (`next` orders the Integration queue: a task a queued task depends on, directly or through a folded member (`merged_into:`), first, then the oldest `ready:`, then schedule order)", ''),
    'lane-order', 'no lane order')
})

test('control: a lane order blind to folded members fails lane-order', () => {
  only(sk('a task a queued task depends on, directly or through a folded member (`merged_into:`), first,', 'a task a queued task depends on first,'),
    'lane-order', 'no folded member')
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

test('control: a stuck bullet that names a gate reason fails race-hold', () => {
  const l = real.skill.split('\n').find((x) => x.startsWith('- `next` reports `halt: stuck`'))
  only(sk(l, l.replace('checked first; ', 'checked first; with a gate-pending task among them, `reason="gated inputs await sign-off: …"`; ')),
    'race-hold', 'gate reason back on stuck')
})
test('control: § 7 without the awaiting-sign-off stop fails race-hold', () => {
  const l = real.skill.split('\n').find((x) => x.startsWith('- `next` reports `halt: awaiting-sign-off`'))
  only(sk(l + '\n', ''), 'race-hold', 'no sign-off stop')
})

test('control: a template budget that drifts from execute fails budget', () => {
  only({ template: real.template.replace('any re-review + required checks + squash', 'any re-review + squash') }, 'budget', 'template drift')
})

// verify-timeout (p14-2)
test('control: a verify_timeout default of 3600 fails verify-timeout', () => {
  only(sk('| `verify_timeout` | `1800` |', '| `verify_timeout` | `3600` |'), 'verify-timeout', 'default 3600')
})

test('control: a RACE re-verify back on --timeout 1800 fails verify-timeout', () => {
  only(sk('race-<slug> --timeout <verify_timeout> --slots', 'race-<slug> --timeout 1800 --slots'), 'verify-timeout', 'race 1800')
})

test('control: a verify paragraph back on (<verify_timeout> + 600) × 1000 fails verify-timeout', () => {
  only(sk("(7200000, the harness maximum, from this entry's § 3 `verify_timeout` check:", "((<verify_timeout> + 600) × 1000, from this entry's § 3 `verify_timeout` check:"),
    'verify-timeout', 'old harness bound')
})

test('control: a verify-timeout JSON without slotWait fails verify-timeout', () => {
  only(sk('"harnessTimeoutMs": <harnessTimeoutMs>, "slotWait": <slot_wait>, "verifySlots": <verify_slots>, "verifySlot": {"script": <verify-slot.py>, "slots": <verify_slots>}}`:', '"harnessTimeoutMs": <harnessTimeoutMs>}`:'),
    'verify-timeout', 'two keys')
})

// verify-slots (p23-4)
test('control: the verify line without --slots fails verify-slots', () => {
  only(sk('"<repoPath>/.claude/integration/<slug>" --timeout <verify_timeout> --slots <verify_slots> --slot-wait <slot_wait>', '"<repoPath>/.claude/integration/<slug>" --timeout <verify_timeout>'),
    'verify-slots', 'no --slots')
})

test('control: a noslot read as green fails verify-slots', () => {
  only(sk('so this is no verdict, never red): M stays unpushed and the lane held. After the canary `check`, re-arm (`--kind verify`) and re-run *The background verify command*.',
    'read it as green): push as on rc 0.'), 'verify-slots', 'noslot green')
})

test('control: step 3 without the third-noslot halt fails verify-slots', () => {
  only(sk(' A third consecutive `noslot` on this verify: `undo`, then halt with `reason="no verify slot for [[slug]] in 3 tries"` (a verify slot held that long is a hung holder: `verify-slot.py status` names it).', ''),
    'verify-slots', 'no third-noslot halt')
})

test('control: § 3 without the "does not clear" remedy fails verify-slots', () => {
  only(sk(' Stamping a key on the rollout note does not clear a `verify-timeout` exit 3: `verify_slots` is never stamped and the whole file is validated, so only fixing `~/.config/thread/rollouts.toml` at the line its stderr names (or a python >= 3.11 when it names tomllib) does.', ''),
    'verify-slots', 'no remedy')
})

test('control: a priority sentence without the integrator fails verify-slots', () => {
  only(sk(" and the integrate call's agent verifier (`run --priority`, rendered only by the engine's integrate mode)", ''), 'verify-slots', 'no integrator')
})

test('control: Verify slots without the in-turn wait (p31-3) fails verify-slots', () => {
  const p = real.skill.split('**An agent waits for its verdict** (p31-3)')[1].split(' **Every suite is recorded**')[0]
  only(sk(' **An agent waits for its verdict** (p31-3)' + p, ''), 'verify-slots', 'no in-turn wait')
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
  const RESUME = '`python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/reconcile-rollout.py resume --rollout <rollout-note>`'
  const moved = edit(edit(real.skill, "then § 3's `verify_timeout` check; then, once the entry's `check-all`", "then, once the entry's `check-all`"),
    `then ${RESUME} (a PR`, `then ${RESUME}, then § 3's \`verify_timeout\` check (a PR`)
  only({ skill: moved }, 'verify-timeout', 'check after resume')
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

test('control: step 3 passing plan again fails approved-plan', () => {
  only(sk('trouble, landed, reviewHistory', 'trouble, landed, plan, reviewHistory'), 'approved-plan', 'step 3 plan')
})

test('control: step 1.2 without verbatim fails approved-plan', () => {
  only(sk("where `plan.plan` is the `plan` output's `plan`, passed verbatim as the same JSON string, never retyped, summarised or truncated.",
    "where `plan.plan` is the `plan` output's `plan`."), 'approved-plan', 'no verbatim')
})

test('control: step 3 without the note pointer fails approved-plan', () => {
  only(sk("the integrator reads the task note's `## Approved plan` itself", 'the integrator works from the brief alone'), 'approved-plan', 'no note pointer')
})

test('control: step 3 re-reading lead-integrate.py plan fails approved-plan', () => {
  only(sk('The lead copies no plan into the call.', 'The lead runs `lead-integrate.py plan --note <task note>` and copies no plan into the call.'),
    'approved-plan', 'step 3 read')
})

test('control: a second lead-integrate.py plan read in Restart routing fails approved-plan', () => {
  only(sk("- else the task's own call.", "- else `lead-integrate.py plan --note <task note>`, then the task's own call."), 'approved-plan', 'second read')
})

test('control: § 6 back on steps 1.2 and 3 fails approved-plan', () => {
  only(sk("for §4.5 step 1.2's seeded revise", 'for §4.5 steps 1.2 and 3'), 'approved-plan', '§ 6 steps 1.2 and 3')
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

test('control: an Automatic descope that re-judges an answered or refused block fails descope', () => {
  only(sk("skipping an entry whose `inputs` (*Recorded answer*'s read) reports a non-null `answerRecorded` (an answered block is the answer's) or", 'skipping an entry whose'),
    'descope', 'no answered skip')
  only(sk(' or a `humanFix.act` of `decide scope or defer` (a refused descope, or a block after one, is Lachy\'s in every session)', ''),
    'descope', 'no decide-scope skip')
})

test('control: § 8 without the descope sentence fails descope', () => {
  only(sk(" The lead runs `reconcile-rollout.py descope` itself (§ 4.5 step 1.2), a guarded deterministic verb that checks the lead's judgement, and its refusal (exit 3) routes the task to repair, which asks Lachy.", ''),
    'descope', 'no § 8 sentence')
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

// auto-retry (p16-4)
test('control: an Automatic retry that resolves the budget by hand fails auto-retry', () => {
  only(sk('both values copied from that `inputs`, never resolved by hand', 'the values resolved from § 3'), 'auto-retry', 'hand budget')
})
test('control: an Automatic retry that acts on every set-aside fails auto-retry', () => {
  only(sk('Act only on `autoRetry: true`: run', 'Act on each: run'), 'auto-retry', 'no autoRetry')
})
test('control: an Automatic retry before the Automatic descope fails auto-retry', () => {
  const l = real.skill.split('\n').find((x) => x.startsWith('   2. **') && x.includes('**Seeded revises'))
  const desc = l.slice(l.indexOf('**Automatic descope'), l.indexOf(' **Automatic retry'))
  const retry = l.slice(l.indexOf(' **Automatic retry'))
  only(sk(l, l.replace(desc, '\u0000').replace(retry, '').replace('\u0000', retry.trim() + ' ' + desc)), 'auto-retry', 'retry first')
})
test('control: an Automatic retry without the autoRetryError halt fails auto-retry', () => {
  only(sk(" Its `autoRetryError` is § 3's round-budget halt.", ''), 'auto-retry', 'no error halt')
})
test('control: an Automatic retry that re-judges a descope refusal fails auto-retry', () => {
  only(sk(', skipping a `plan-blocked` key whose descope exited 3 this session', ''), 'auto-retry', 'descope exit 3')
})
test('control: a cool-down that halts fails auto-retry', () => {
  only(sk('set-aside entries, ends the turn `waiting` with `reason="<autoRetryClass> cool-down', 'set-aside entries, halts with `reason="<autoRetryClass> cool-down'), 'auto-retry', 'cool-down halts')
})
test('control: a cool-down that waits over an UNVERIFIED task fails auto-retry', () => {
  only(sk(', and no UNVERIFIED task among the set-aside entries,', ''), 'auto-retry', 'cool-down hides an UNVERIFIED')
})
test("control: a cool-down that never routes an UNVERIFIED to § 7 fails auto-retry", () => {
  only(sk(" With an UNVERIFIED task among them, a cool-down holds nothing back: the `stuck` goes to § 7 as usual (its `UNVERIFIED undecided` reason, with the item in the report's `Needs you:` block, § 6.5), since a human is needed anyway, and the cooling task retries at the re-invocation after it.", ''),
    'auto-retry', 'no § 7 route')
})
test('control: a gate-pending task that stops a cool-down fails auto-retry', () => {
  only(sk(' A gate-pending task never stops a cool-down: the turn waits for the retry, and once only gates remain the queue ends in step 5\'s sign-off form.', ''),
    'auto-retry', 'a gate stops the cool-down')
})
test('control: an infra retry with no cool-down fails auto-retry', () => {
  only(sk('; each of its retries first waits a short cool-down, 15, then 60, then 240 minutes (the last repeating), counted by the retries already spent', ''), 'auto-retry', 'no infra cool-down')
})
test('control: § 3 without the auto_retries row fails auto-retry', () => {
  const l = real.skill.split('\n').find((x) => x.startsWith('| `auto_retries` |'))
  only(sk(l + '\n', ''), 'auto-retry', 'no row')
})
test('control: Set aside without the automatic re-entry fails auto-retry', () => {
  const l = real.skill.split('\n').find((x) => x.startsWith('- first, automatically:'))
  only(sk(l + '\n', ''), 'auto-retry', 'no set-aside bullet')
})
test('control: § 6 without the Auto-retried row fails auto-retry', () => {
  only(sk('Auto-retried: [[task-q]] — 1/2 (plan; feedback 3f2a9c1b0d4e) (automatic; restarted)\n', ''), 'auto-retry', 'no report row')
})
test('control: a Completion log that drops the auto-retry lines fails auto-retry', () => {
  only(sk(' the automatic retries copied from its `auto-retry:` lines (task, count, stage, feedback sha, any raise),', ''), 'auto-retry', 'no log copy')
})
test('control: a § 7 stuck halt that ignores the retries fails auto-retry', () => {
  only(sk(", acted on only once step 1.2's *Automatic retry* re-entered nothing and found no cool-down, or found one with an UNVERIFIED task set aside, which a cool-down never holds back, §4.5 step 1.5", ''), 'auto-retry', 'stuck early')
})
test('control: § 8 without the auto-retry sentence fails auto-retry', () => {
  only(sk(" The lead runs `reconcile-rollout.py auto-retry` itself too (§ 4.5 step 1.2's *Automatic retry*), a guarded deterministic verb with its own budget: a spent budget, a repeated fingerprint or a `needsHuman` question routes the task to repair.", ''),
    'auto-retry', 'no § 8 sentence')
})
test('control: a needs-you block that pushes a task the lead re-enters fails auto-retry', () => {
  only(sk("(step 1.2's seeded revise, its *Automatic retry* now or once a cool-down ends, its", "(step 1.2's seeded revise, its"), 'auto-retry', 'retried task pushed')
})
test("control: an Automatic retry that reads its why as Lachy's reason fails auto-retry", () => {
  only(sk("; its `autoRetryWhy` is the log line only, never Lachy's reason.", '; its `autoRetryWhy` is the reason to give Lachy.'), 'auto-retry', 'why as reason')
  only(sk(" for every block whose way back is Lachy's (its `humanFix` names the one act that moves it, ADR 0035, § 6.5) and for a recorded answer (`answerRecorded`: *Recorded answer* above, or `/thread:repair`),",
    ' for a spent budget,'), 'auto-retry', 'a cause list again')
})
test("control: no Don't on hand-written retry markers fails auto-retry", () => {
  const l = real.skill.split('\n').find((x) => x.startsWith('- Never auto-retry unless'))
  only(sk(l + '\n', ''), 'auto-retry', "no Don't")
})

// recorded-answer (ADR 0035)
test('control: a Recorded answer without the script predicate fails recorded-answer', () => {
  only(sk('Act only when its `answerRecorded` is non-null, its `answerRecorded.form` is `hand-back` and its `humanFix` is null', 'Act when its `answerRecorded` is non-null'),
    'recorded-answer', 'no humanFix-null predicate')
})
test('control: a Recorded answer without the next re-run fails recorded-answer', () => {
  only(sk(' After any hand-back, re-run `next --running <the live slugs>` and use that output from here on;', ''), 'recorded-answer', 'no next re-run')
})
test('control: a Recorded answer after the Automatic retry fails recorded-answer', () => {
  const l = real.skill.split('\n').find((x) => x.startsWith('   2. **') && x.includes('**Seeded revises'))
  const recorded = l.slice(l.indexOf(' **Recorded answer'), l.indexOf(' **Automatic descope'))
  only(sk(l, l.replace(recorded, '') + recorded), 'recorded-answer', 'after the retry')
})
test('control: a Recorded answer under a pause fails recorded-answer', () => {
  only(sk('**Recorded answer (ADR 0035).** Skip it when `paused` or `pauseRequested` is set: an answer waits for the reinstate.', '**Recorded answer (ADR 0035).**'),
    'recorded-answer', 'not skipped under a pause')
})
test("control: \"retry [[task]]\" spending by hand fails recorded-answer", () => {
  only(sk('run `reconcile-rollout.py hand-back --tasks <slug>` (§4.5 *Set aside*), which spends the answers its `## Repair input` holds in the same save',
    'spend the answers its `## Repair input` holds, then run `reconcile-rollout.py hand-back --tasks <slug>` (§4.5 *Set aside*)'), 'recorded-answer', 'spend by hand')
})
test("control: no Don't on a hand-written key fails recorded-answer", () => {
  only(sk(', and never write, supersede or spend a `## Repair input` key by hand', ''), 'recorded-answer', 'keys by hand')
})

// trickle (p28-1)
test('control: § 4.5 without the Trickle at any one site fails trickle', () => {
  const p = real.skill.split('\n').find((l) => l.startsWith('**The Trickle (Chorus ADR 0104).**'))
  only(sk(p + '\n\n', ''), 'trickle', 'no Trickle paragraph')
  only(sk('N from `~/.config/thread/away.json`, else 2', 'N from `~/.config/chorus/away.json`, else 2'), 'trickle', 'another path')
  only(sk('`skills/execute/away.md` holds the spec', 'the Chorus brief holds the spec'), 'trickle', 'no spec pointer')
  only(sk('and a `trickle:` hold never halts the rollout', 'and a `trickle:` hold halts the rollout `stuck`'), 'trickle', 'a Trickle hold halts')
  only(sk(' A `WARN: ~/.config/thread/away.json` line on its stderr (a stale or unreadable Away state file, `skills/execute/away.md` § Reading it) is printed verbatim the first time this session sees that exact line, which is held for the session\'s life like step 1.2\'s judged keys; nothing else changes.', ''),
    'trickle', 'no WARN relay in step 1.1')
  only(sk(' A `trickle:` hold (*The Trickle*) ends the turn `waiting` too,', ' A `trickle:` hold (*The Trickle*) halts the turn,'), 'trickle', 'no Trickle wait in step 1.6')
  only(sk('`reason="trickle: <trickle.running>/<trickle.limit> tasks running on this Mac"`', '`reason="trickle"`'), 'trickle', 'no Trickle reason=')
  only(sk(" and a Trickle wait's `waiting` turn (§4.5 step 1.6), an Away-cap wait's included.", '.'), 'trickle', 'heartbeat paragraph without the Trickle wait')
  only(sk(' (a `trickle:` or `away cap:` reason is no hold: the Trickle or the Away cap may have room now)', ''), 'trickle', 'clause (7) without its parenthetical')
  only(sk(', or `next` holds a task on the Trickle (§4.5 step 1.6) or step 1.2 holds a seeded revise on it (§4.5 step 1.5), or on the Away cap while Away; nothing to do until', '; nothing to do until'),
    'trickle', "§ 6's waiting bullet without it")
  only(sk(', a retry cool-down is pending, or a Trickle wait stands)', ', or a retry cool-down is pending)'), 'trickle', "§ 8's Stop-hook paragraph without it")
  // p28-3: the Trickle claim and its WARN relay
  only(sk(' (a **Trickle claim**)', ''), 'trickle', 'no Trickle claim named')
  only(sk(' A `WARN: trickle claims` line on its stderr (`skills/execute/away.md` § The Trickle, *Trickle claims*) is relayed the same way.', ''),
    'trickle', 'no claims WARN relay in step 1.1')
})
test('control: a restart held by the Trickle, or a Trickle-held revise that halts stuck, fails trickle', () => {
  only(sk(' A restart waits on the ceiling alone:', ' A restart waits on `slotLimit` too:'), 'trickle', 'a restart held by the Trickle')
  only(sk('counting every `in_progress` task of this rollout, live or stalled, as every other lead counts them. A restart',
    'counting its live tasks only. A restart'), 'trickle', 'stalled tasks uncounted')
  only(sk('within the ceiling like any restart, never held by the Trickle', 'within `slotLimit`'), 'trickle', 'an automatic retry held by the Trickle')
  only(sk(' A revise held only by `slotLimit`, below `ceiling`, is a Trickle wait: the halt guard (step 1.5) never halts on it (while Away, an Away-cap wait, the same).', ''),
    'trickle', 'step 1.2 without the pointer to the guard')
  only(sk(', never § 7: the revise launches once the Mac has room', ', then § 7: the revise launches once the Mac has room'), 'trickle', 'the guard halts')
  const guard = real.skill.split('\n').find((l) => l.includes('**Halt guard (last).**'))
  const clause = guard.slice(guard.indexOf(' A `stuck` while step 1.2 held an `autoRevise: true`'))
  only(sk(clause, ''), 'trickle', 'no Trickle clause in the halt guard')
  only(sk("Like `next`'s own `trickle:` hold, it waits whatever else is set aside", 'It waits unless an UNVERIFIED task is set aside'),
    'trickle', 'an UNVERIFIED task halts the Trickle wait')
  only(sk(', and never while step 1.2 holds a seeded revise on the Trickle, a Trickle wait (§4.5 step 1.5)', ''), 'trickle', "§ 7's stuck halts over a Trickle-held revise")
})
test('control: § 4.5 without the Away cap at any one site fails trickle', () => {
  only(sk(', `min(ceiling, max(0, A − that count))` while Away', ''), 'trickle', 'no Away-cap slotLimit')
  only(sk(' While Away the same row reads `away cap: <running>/<A> tasks running on this Mac`, and an `away cap:` hold never halts the rollout either',
    ' While Away the same row reads `away cap: <running>/<A> tasks running on this Mac`, and an `away cap:` hold halts the rollout `stuck`'), 'trickle', 'an Away-cap hold halts')
  only(sk('a rollout the Away cap alone holds is a meant wait, never Stalled (ADR 0048)', 'a rollout the Away cap alone holds is Stalled'), 'trickle', 'Stalled')
  only(sk(' While Away (`trickle.away` true) it is an Away-cap wait, the same in every way but its reason, `reason="away cap: <trickle.running>/<trickle.awayCap> tasks running on this Mac"`.', ''),
    'trickle', 'the halt guard without the Away-cap wait')
  only(sk(' An `away cap:` hold, or step 1.5\'s revise held while Away, ends the turn `waiting` the same way with', ' An `away cap:` hold, or step 1.5\'s revise held while Away, halts the turn with'),
    'trickle', 'no Away-cap wait in step 1.6')
  only(sk(' (a `trickle:` or `away cap:` reason is no hold: the Trickle or the Away cap may have room now)', ' (a `trickle:` reason is no hold: the Trickle may have room now)'),
    'trickle', 'clause (7) holding on an Away-cap reason')
  only(sk(', or on the Away cap while Away; nothing to do until', '; nothing to do until'), 'trickle', "§ 6's waiting bullet without the Away cap")
  only(sk(", an Away-cap wait's (`away cap: …`) and the completion verify's", ' and the completion verify\'s'), 'trickle', "§ 6's reason list without the Away cap")
  only(sk(' an Away-cap wait stands, a retry cool-down is pending,', ' a retry cool-down is pending,'), 'trickle', "§ 8's Stop-hook paragraph without the Away cap")
  only(sk(" (§4.5 step 1.6), an Away-cap wait's included.", ' (§4.5 step 1.6).'), 'trickle', 'heartbeat paragraph without the Away-cap wait')
  only(sk(' never halts on it (while Away, an Away-cap wait, the same).', ' never halts on it.'), 'trickle', 'step 1.2 without the Away-cap wait')
})
test("control: the driver's docstring or block reason without the Away-cap wait fails trickle", () => {
  const drv = (from, to) => { assert.ok(real.driver.includes(from), from); return { driver: real.driver.replace(from, to) } }
  only(drv(' or an Away-cap\n              wait does (on the machine-wide Away cap while Lachy is Away,\n              ADR 0049)', ''), 'trickle', 'docstring')
  only(drv(' or an Away-cap wait does (on the Away cap, "\n            "with its reason=\\"away cap: …\\")', ''), 'trickle', 'block reason')
})
test("control: the driver's docstring or block reason without the Trickle wait fails trickle", () => {
  const drv = (from, to) => { assert.ok(real.driver.includes(from), from); return { driver: real.driver.replace(from, to) } }
  only(drv('or a Trickle wait stands (`next` holds a task on the machine-wide', 'or (`next` holds a task on the machine-wide'), 'trickle', 'docstring')
  only(drv('or a Trickle wait stands (`next` holds a task on the "', 'or (`next` holds a task on the "'), 'trickle', 'block reason')
})

// skip-path (ADR 0045, p29-3)
test('control: step 3 without the skip bullet, its order, its undo or its why print fails skip-path', () => {
  const bullet = real.skill.split('\n').find((l) => l.startsWith('   - **`skip`**'))
  only(sk(bullet + '\n', ''), 'skip-path', 'no skip bullet')
  only(sk(" --verifier '<verifier>' --bootstrap '<env_bootstrap>'` (§ 3's", "` (§ 3's"), 'skip-path', 'prepare without the verifier')
  only(sk('Re-run § 2.5, then § 2.6 (the push re-check, *Landing-register re-check*), then `python3',
    'Then `python3'), 'skip-path', 'no re-check before the push')
  only(sk('Push refused (exit 1): `undo --repo <repoPath> --slug <slug> --merge M --to <prHead>`, then the integrate call with `trouble []`.',
    'Push refused (exit 1): halt.'), 'skip-path', 'a refused push halts')
  only(sk(' Print `inert.why`. Re-run', ' Re-run'), 'skip-path', 'no why print in the bullet')
  only(sk(', print `inert.why` whenever the route is `verify` or `skip` (an `inert check error: …` included: that check failed closed, so the verifier runs as before)', ''),
    'skip-path', 'no why print on verify')
  only(sk(' it may route `skip` when `main` moved only in Inert paths, ADR 0045);', ');'), 'skip-path', 'the exit-3 row without the skip')
})

// last-starts (p28-2)
test('control: § 4.5 without the last starts at any one site fails last-starts', () => {
  const p = real.skill.split('\n').find((l) => l.startsWith('**The last starts (Chorus ADR 0104 d4).**'))
  only(sk(p + '\n\n', ''), 'last-starts', 'no last-starts paragraph')
  only(sk('A `last start:` hold never halts the rollout: the turn ends `waiting` (step 1.6)', 'A `last start:` hold halts the rollout `stuck`'),
    'last-starts', 'the hold halts')
  only(sk('Restarts are exempt, a set-aside task\'s hand-back and a seeded revise included', 'Restarts wait on it too'), 'last-starts', 'restarts held')
  only(sk(' A `last start:` hold (*The last starts*) ends the turn `waiting` too:', ' A `last start:` hold (*The last starts*) halts the turn:'),
    'last-starts', 'no last-starts wait in step 1.6')
  only(sk('`reason="last start: held until the Morning at <trickle.morning>"`', '`reason="last start"`'), 'last-starts', 'no last-starts reason=')
  only(sk(" It covers a last-starts wait's `waiting` turn (§4.5 step 1.6) too.", ''), 'last-starts', 'heartbeat paragraph without it')
  only(sk(' A `last start:` reason is no hold either (the Morning may have come), so this clause re-enters on it too.', ''),
    'last-starts', 'clause (7) without it')
  only(sk(', or `next` holds a task on the last starts (§4.5 step 1.6)', ''), 'last-starts', "§ 6's waiting bullet without it")
  only(sk(", a last-starts wait's (`last start: …`)", ''), 'last-starts', "§ 6's reason forms without it")
  only(sk(', and on a last-starts wait (§4.5 step 1.6)', ''), 'last-starts', "§ 6's reason list without it")
  only(sk(' a last-starts wait stands,', ''), 'last-starts', "§ 8's Stop-hook paragraph without it")
})
test("control: the driver's docstring or block reason without the last-starts wait fails last-starts", () => {
  const drv = (from, to) => { assert.ok(real.driver.includes(from), from); return { driver: real.driver.replace(from, to) } }
  only(drv(', or a last-starts\n              wait stands (`next` holds a task on the last starts', ', or (`next` holds a task on the last starts'),
    'last-starts', 'docstring')
  only(drv(' or a last-starts wait stands (`next` holds a "', ' or (`next` holds a "'), 'last-starts', 'block reason')
})

// hold (p30-3)
test('control: the PR hold missing from any one lead site fails hold', () => {
  only(sk(' Its `holdUntil` (a PR hold, `skills/_shared/vault-grammar.md` § Hold until) is read now too:', ' Its `holdUntil` is ignored:'), 'hold', 'step 1.1 reads no hold')
  only(sk(', none of step 1.2 runs, as under a pause:', ', step 1.2 runs as usual:'), 'hold', 'step 1.2 runs under a rollout hold')
  only(sk(' A `setAside` entry that carries its own `holdUntil` (a task-scope hold) is skipped by every part of this step in the same way.', ''),
    'hold', 'step 1.2 re-enters a task-scope hold')
  only(sk('otherwise end the turn `waiting` with `reason="held until <pr> merges"`', 'otherwise go to § 7 with `reason="held until <pr> merges"`'),
    'hold', 'the guard halts on a merge wait')
  only(sk(" A PR hold's wait (step 1.5's `held until …`) can stand with nothing in flight too: it registers the heartbeat, and each tick re-enters *Cold resume* through clause (7), whose `next` reads the PR again and clears a merged hold.", ''),
    'hold', 'step 1.6 without the PR hold wait')
  only(sk(", a PR hold's `waiting` turn (§4.5 step 1.5)", ''), 'hold', 'the heartbeat not registered for it')
  only(sk(', nor is a `held until` reason (a PR hold: the PR may have merged, and only `next` reads it)', ''), 'hold', 'clause (7) reads it as a hold')
  only(sk(' or a PR hold waits on its merge (`next` reports `halt: held`, §4.5 step 1.5),', ''), 'hold', "§ 6's waiting bullet without it")
  only(sk("a PR hold's (`held until …`), ", ''), 'hold', "§ 6's reasons without it")
  only(sk('A **PR hold** that can release itself is not a halt: it ends `waiting`', 'A **PR hold** halts'), 'hold', '§ 7 halts on a merge wait')
  const bullet7 = real.skill.split('\n').find((l) => l.startsWith('- `next` reports `halt: held` with a hold that waits on Lachy'))
  only(sk(bullet7 + '\n', ''), 'hold', 'no § 7 bullet')
  only(sk(', a PR hold waits on its merge, a last-starts wait stands', ', a last-starts wait stands'), 'hold', "§ 8's Stop-hook paragraph without it")
  only(sk(", as it does under a PR hold's wait (a `held until` reason is no hold to clause (7): only `next` sees the merge, and it releases the hold itself)", ''),
    'hold', "§ 8's heartbeat paragraph without it")
})
test("control: the driver's docstring or block reason without the PR hold fails hold", () => {
  const drv = (from, to) => { assert.ok(real.driver.includes(from), from); return { driver: real.driver.replace(from, to) } }
  only(drv('or a PR hold waits on its merge (`next` reports `halt: held`,\n              reason="held until …", execute §4.5 step 1.5, vault-grammar\n              § Hold until),\n', ''),
    'hold', 'docstring')
  only(drv('a PR hold waits on its merge (`next` reports `halt: held`, "\n            "with its reason=\\"held until …\\", §4.5 step 1.5) or ', 'or '), 'hold', 'block reason')
})

// heat (p31-4)
test('control: the Heat hold missing at any one site fails heat', () => {
  const p = real.skill.split('\n').find((l) => l.startsWith('**The Heat hold (estate ADR 0009 d5).**'))
  only(sk(p + '\n\n', ''), 'heat', 'no Heat hold paragraph')
  only(sk('`slotLimit` 0, Away included', '`slotLimit` 0 by day'), 'heat', 'heat not held Away')
  only(sk('and a `heat:` hold never halts the rollout', 'and a `heat:` hold halts the rollout `stuck`'), 'heat', 'a Heat hold halts')
  only(sk(' While `next` reports `heat` at heavy or worse (`slotLimit` 0, *The Heat hold*), such a revise is a Heat hold instead, the same wait.', ''),
    'heat', 'step 1.2 without the heat-held revise')
  only(sk('`reason="heat: the Mac is hot (<heat.name>)"`, never § 7, whatever else is set aside', '`reason="heat"`, then § 7'), 'heat', 'the guard halts on heat')
  only(sk(' A `heat:` hold (*The Heat hold*) ends the turn `waiting` the same way,', ' A `heat:` hold (*The Heat hold*) halts the turn,'), 'heat', 'no heat wait in step 1.6')
  only(sk("and it comes before the Trickle's, since a hot Mac holds every row the Trickle would", "and it comes after the Trickle's"), 'heat', 'the Trickle reason first')
  only(sk('but a `heat` never counts toward the third-`noslot` halt, nor resets its count', 'and a `heat` counts toward the third-`noslot` halt'),
    'heat', 'step 3 counts heat toward the halt')
  only(sk(' → re-run the re-verify the same way with the lane held, never counted toward that halt nor resetting it', ' → halt'), 'heat', 'the RACE halts on heat')
  only(sk("; `heat`: the Mac was too hot to run the suite within the slot wait, a Heat hold) leaves", ') leaves'), 'heat', 'step 5 without heat')
  only(sk('a `stopped` or `heat` one never counts', 'a `stopped` one never counts'), 'heat', "step 5's halt counts heat")
  only(sk('every slot wait, heat hold and heat-stopped run counts against `<slot_wait>`', 'the slot wait alone counts against `<slot_wait>`'),
    'heat', 'W without the heat')
  only(sk(' **The Heat hold:** at heavy no verify slot is free,', ' At heavy a verify slot is still free,'), 'heat', 'Verify slots without the hold')
  only(sk(" A Heat hold's `waiting` turn (§4.5 step 1.6, *The Heat hold*) is covered the same way.", ''), 'heat', 'heartbeat paragraph without the Heat hold')
  only(sk(', and a `heat:` reason no hold either (the Mac may have cooled)', ''), 'heat', 'clause (7) reads heat as a hold')
  only(sk(' or a Heat hold stands (§4.5 step 1.6, *The Heat hold*),', ''), 'heat', "§ 6's waiting bullet without it")
  only(sk(', and on a Heat hold (§4.5 step 1.6)', ''), 'heat', "§ 6's reason list without it")
  only(sk(', or on the Heat hold, the same wait', ''), 'heat', "§ 7's stuck halts over a heat-held revise")
  only(sk(", a Heat hold's `waiting` included", ''), 'heat', "§ 8's Stop-hook paragraph without it")
})
test("control: the driver's docstring or block reason without the Heat hold fails heat", () => {
  const drv = (from, to) => { assert.ok(real.driver.includes(from), from); return { driver: real.driver.replace(from, to) } }
  only(drv(', or a Heat hold\n              stands (`heat: …`', ''), 'heat', 'docstring')
  only(drv(' or a Heat hold stands (`heat: …`, the "\n            "same wait)', ''), 'heat', 'block reason')
})

test('the rules are all named (40) and each has a control', () => {
  assert.equal(RULES.length, 40)
  assert.deepEqual(RULES.filter((r) => !CONTROLLED.has(r)), [])
})
