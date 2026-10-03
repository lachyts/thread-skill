// The git-env canary's prose (p14-6): execute § 4.5 *Git-env canary* and every site the lead runs it at, status's
// Git-env trip flag and its RACE in-flight sentence, repair's § 3e (the evidence, restore's drop guard, the ack and
// the RACE follow-on), schedule's supersede, the ADR 0030 bullet, CONTEXT's terms and the README line. The script
// is executed by tests/git-env-canary.test.sh; the queue's hold by skills/execute/tests/reconcile-rollout-queue.test.sh.
//
// Every rule lives in one function, check(texts), that returns named failures, so the real files and the controls
// run through identical logic: each control mutates the real text in one place and must fail with exactly its rule.
// The marker constants are read from reconcile-rollout.py through python, never retyped here. Reads files only.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { collapse, read, root, section } from '../lib/contract-text.mjs'

const real = {
  execute: read('skills/execute/SKILL.md'),
  status: read('skills/status/SKILL.md'),
  repair: read('skills/repair/SKILL.md'),
  schedule: read('skills/schedule/SKILL.md'),
  context: read('CONTEXT.md'),
  readme: read('README.md'),
  adr: read('docs/adr/0030-a-rollout-is-a-queue-that-integrates-at-merge.md'),
  canary: read('skills/execute/scripts/git-env-canary.py'),
}

// The three markers, from the one source.
const consts = (() => {
  const py = 'import importlib.util, json, sys\n' +
    'spec = importlib.util.spec_from_file_location("r", sys.argv[1]); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)\n' +
    'print(json.dumps([m.GIT_ENV_LOG_SECTION, m.GIT_ENV_TRIP_MARK, m.GIT_ENV_ACK_MARK]))\n'
  const r = spawnSync('python3', ['-c', py, path.join(root, 'skills/execute/scripts/reconcile-rollout.py')],
    { encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } })
  assert.equal(r.status, 0, r.stderr)
  return JSON.parse(r.stdout)
})()
const [LOG, TRIP, ACK] = consts

// § 3c item 5 as it stood before p14-6: repair's § 3e carries the git-env reading, § 3c is never edited for it.
const C3_ITEM5 = "5. for a RACE only, the lead's re-verify verdict, so Lachy decides with it on screen: the owner session's halt\n" +
  "   reason (`RACE: origin/<default> fails the verifier`), and the verdict file\n" +
  "   `<repoPath>/.claude/integration/race-<slug>.rc` (`0` green; any other rc red, `124` a timeout; absent: it\n" +
  "   never finished, which reads as red) with the tail of `race-<slug>.log` beside it. An UNVERIFIED task was\n" +
  '   never re-verified: say so.'
// Heartbeat clause (4), byte for byte: the merge-result rule reaches it through "act on it as §4.5 would".
const HB4 = '(4) If a background Integration command this session launched (the verifier, merge-task.sh, a backoff) has not ' +
  'reported: when its result file exists (`<out>.rc`, or `.claude/merge-task.status`), act on it as §4.5 would; otherwise do nothing more.'

const before = (hay, a, b) => hay.indexOf(a) >= 0 && hay.indexOf(b) >= 0 && hay.indexOf(a) < hay.indexOf(b)
const S45 = /^### 4\.5\. /
// A bold-labelled block inside execute § 4.5, raw: from its label line to the next bold label at column 0.
function labelledRaw(text, label, sec = S45) {
  const lines = (section(text, sec) ?? '').split('\n')
  const i = lines.findIndex((l) => l.startsWith(`**${label}`))
  if (i < 0) return ''
  const j = lines.findIndex((l, k) => k > i && /^\*\*[A-Z0-9]/.test(l))
  return lines.slice(i, j < 0 ? undefined : j).join('\n')
}
const labelled = (text, label, sec) => collapse(labelledRaw(text, label, sec))
// A `- **<label>` bullet of a block with its indented continuation lines, collapsed.
function bullet(raw, label) {
  const lines = raw.split('\n')
  const i = lines.findIndex((l) => l.startsWith(`- **${label}`))
  if (i < 0) return ''
  const j = lines.findIndex((l, k) => k > i && !/^\s+\S/.test(l))
  return collapse(lines.slice(i, j < 0 ? undefined : j).join('\n'))
}
// § 4.5's numbered steps, raw.
function stepRaw(text, n) {
  const lines = (section(text, S45) ?? '').split('\n')
  const i = lines.findIndex((l) => new RegExp(`^${n}\\. \\*\\*`).test(l))
  if (i < 0) return ''
  const j = lines.findIndex((l, k) => k > i && /^(\d+\. \*\*|\*\*[A-Z])/.test(l))
  return lines.slice(i, j < 0 ? undefined : j).join('\n')
}
const step = (text, n) => collapse(stepRaw(text, n))
// Step 1's sub-steps, collapsed, in order.
function subSteps(text) {
  const out = []
  for (const l of stepRaw(text, 1).split('\n')) {
    const m = l.match(/^ {3}(\d)\. (.*)$/)
    if (m) out.push(m[2])
    else if (out.length && l.trim()) out[out.length - 1] += ' ' + l.trim()
  }
  return out
}
const snippet = (text, name) => (text.match(new RegExp(`^# thread:${name}[^\\n]*\\n([\\s\\S]*?)\\n# end thread:${name}`, 'm')) ?? [])[1] ?? ''

function check({ execute, status, repair, schedule, context, readme, adr, canary }) {
  const fails = []
  const can = labelled(execute, 'Git-env canary.')
  const canRaw = labelledRaw(execute, 'Git-env canary.')
  const subs = subSteps(execute)
  const st2 = step(execute, 2)
  const st3 = step(execute, 3)
  const st4 = step(execute, 4)
  const st5 = step(execute, 5)
  const integ = st3.slice(st3.indexOf('**The integrate call**'), st3.indexOf('Otherwise, by `integration.outcome`'))
  const verifyB = st3.slice(st3.indexOf('**`verify`**'), st3.indexOf('green (rc 0) and no shared file'))
  const race = st4.slice(st4.indexOf('**RACE procedure**'))
  const sentinel = st4.slice(st4.indexOf('**The sentinel is authoritative'), st4.indexOf('| Exit |'))
  const lost = labelled(execute, 'Lost call.')
  const hold = labelled(execute, 'Merge hold')
  const backoff = labelled(execute, 'Backoff')
  const recheck = labelled(execute, 'Landing-register re-check.')
  const s27 = collapse(section(execute, /^### 2\.7\. /) ?? '')
  const s37 = collapse(section(execute, /^### 3\.7\. /) ?? '')
  const s5 = collapse(section(execute, /^### 5\. /) ?? '')
  const s7 = collapse(section(execute, /^### 7\. /) ?? '')
  const donts = collapse(section(execute, /^## Don'ts/) ?? '')
  const pz = collapse(section(execute, /^## Pausing \+ reinstating/) ?? '')
  const status3 = collapse(section(status, /^### 3\. /) ?? '')
  const status3raw = section(status, /^### 3\. /) ?? ''
  const inFlight = collapse((status3raw.split('\n- **').find((x) => x.startsWith('In flight:**')) ?? ''))
  const gflag = collapse((status3raw.split('\n- **').find((x) => x.startsWith('Git-env trip:**')) ?? ''))
  const status4 = collapse(section(status, /^### 4\. /) ?? '')
  const status2 = collapse(section(status, /^### 2\. /) ?? '')
  const r1 = collapse(section(repair, /^### 1\. /) ?? '')
  const r2raw = section(repair, /^### 2\. /) ?? ''
  const rifRow = r2raw.split('\n').find((l) => l.startsWith('| **RACE re-verify in flight** |')) ?? ''
  const r3raw = section(repair, /^### 3\. /) ?? ''
  const c3raw = labelledRaw(repair, '3c', /^### 3\. /)
  const d3raw = labelledRaw(repair, '3e', /^### 3\. /)
  const follow = labelled(repair, 'RACE follow-on.', /^### 3\. /)
  const d3 = collapse(d3raw)
  const r4 = collapse(section(repair, /^### 4\. /) ?? '')
  const r6 = collapse(section(repair, /^### 6\. /) ?? '')
  const rDonts = collapse(section(repair, /^## Don'ts/) ?? '')
  const sch1 = collapse(section(schedule, /^### 1\. /) ?? '')
  const sch6 = collapse(section(schedule, /^### 6\. /) ?? '')
  const adrB = collapse((adr.split('\n- ').find((b) => b.startsWith('**A git-env canary watches the shared checkout')) ?? ''))
  const hb = execute.split('\n').find((l) => l.startsWith('> ROLLOUT-HEARTBEAT')) ?? ''

  // marker-tie: the three markers (read from reconcile-rollout.py) reach every consumer, and the canary never
  // carries a literal copy of any of them.
  if (![LOG, TRIP, ACK].every((k) => can.includes(k)) || ![LOG, TRIP, ACK].every((k) => gflag.includes(k)) ||
    !d3.includes(LOG) || !['ack --rollout', '--slugs', '--ref', 'restore --rollout', '--drop-local'].every((k) => d3.includes(k)) ||
    !sch1.includes(LOG) || [LOG, TRIP, ACK].some((k) => canary.includes(k))) fails.push('marker-tie')

  // arm-sites: an arm beside each launch (next to its shasum), in order where it matters.
  const sub12 = subs.find((x) => x.startsWith('**Seeded revises')) ?? ''
  const sub13 = subs.find((x) => x.includes('`restart`, then each in `start`')) ?? ''
  const resume37 = s37.slice(s37.indexOf('**Signed-gate resume.**'))
  const s5resume = s5.slice(s5.indexOf('If a call dies'))
  if (!before(sub12, '`shasum -a 256 <scriptPath>` (recorded', 'the canary arm') || !before(sub12, 'the canary arm', 'then the Workflow call') ||
    !before(sub13, 'record it with the returned runId', 'the canary arm') ||
    !before(resume37, '`shasum -a 256 <scriptPath>` again', 'the canary arm') || !before(resume37, 'the canary arm', 'resumeFromRunId') ||
    !before(lost, "§ 4's git-env check", 'the canary arm') || !before(lost, 'the canary arm', '`resumeFromRunId` with the same') ||
    !before(s5resume, "§ 4's git-env check", 'the canary arm') || !before(s5resume, 'the canary arm', 'resume once') ||
    !integ.includes('The canary arm (*Git-env canary*: `--kind integrate`) runs right before its launch') ||
    !before(verifyB, '`--kind verify`', '*The background verify command*') ||
    !before(race, "`## Race log`", '`--kind race-verify`') || !before(race, '`--kind race-verify`', 'lead-integrate.py verify')) fails.push('arm-sites')

  // check-sites: a check at each return and at the dead-call row.
  if (!before(st2, 'Run the canary `check` for its window first', 'Reconcile its row') || !st2.includes('whatever the exit') ||
    !before(integ, 'When it returns, run the canary `check`', 'reconcile the row') ||
    !before(verifyB, 'run the canary `check` first, before `push` or `undo`', 'Otherwise:') ||
    !before(race, 'run the canary `check` first', 'green → `mark-done`') ||
    !before(lost, 'Run the canary `check` for that call\'s window first', 'workflow call failed:')) fails.push('check-sites')

  // check-all-sites: every entry after verify_timeout; step 3 before mark-integrating; before every merge-task
  // launch (step 4, the hold release, the backoff, the two re-runs); completion before the sweep, retire before the move.
  const rows = Object.fromEntries(stepRaw(execute, 4).split('\n').map((l) => l.match(/^\s*\| ([^|]+?) \| (.*) \|\s*$/)).filter(Boolean).map((m) => [m[1].trim(), m[2]]))
  const bo = snippet(execute, 'git-env-backoff')
  const bulletsOf5 = stepRaw(execute, 5).split('\n').filter((l) => /^ {3}- /.test(l))
  const iCA = bulletsOf5.findIndex((l) => l.includes('check-all'))
  const iSweep = bulletsOf5.findIndex((l) => l.startsWith('   - Sweep the rollout'))
  const iRetire = bulletsOf5.findIndex((l) => l.includes('git-env-canary.py retire'))
  const iMove = bulletsOf5.findIndex((l) => l.startsWith('   - Move the rollout note'))
  if (!before(recheck, "§ 3's `verify_timeout` check once", "the canary's `check-all`") || !recheck.includes('before `resume`, `clear-pause`, `next` or any stamp') ||
    !before(st3, "the canary's `python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/git-env-canary.py check-all", 'mark-integrating --tasks') ||
    !before(st4, "the canary's `check-all` (*Git-env canary*: before EVERY `merge-task.sh` launch", '`run_in_background`') ||
    !before(hold, "the canary's `check-all`", '`merge-task.sh` with the same pair') ||
    !before(bo, 'check-all', 'merge-task.sh <the same four args>') || !bo.includes("failed:git-env") ||
    !(rows['6'] ?? '').includes("check-all") || !(rows['143 / 130 / 129, or a missing sentinel'] ?? '').includes('check-all') ||
    !(iCA >= 0 && iCA < iSweep) || !(iRetire >= 0 && iRetire < iMove) ||
    !bullet(canRaw, 'check-all sites:').includes('before EVERY `merge-task.sh` launch') ||
    !['step 4', '*Merge hold* release', '*Backoff* chain', 'exit-6 re-run', '143/130/129/missing-sentinel re-run'].every((k) => bullet(canRaw, 'check-all sites:').includes(k))) fails.push('check-all-sites')

  // integrate-check: the integrate return checks, then reconciles whatever the exit, and acts on no outcome.
  if (!integ.includes('run the canary `check` for its window first, then reconcile the row whatever the exit') ||
    !integ.includes('no step 4, no seeded revise, no stale-anchor-ref deletion')) fails.push('integrate-check')

  // prepare-cases: after the ack, prepare re-derives the case.
  const lane = bullet(canRaw, 'The lane-free rule.')
  if (!lane.includes("through step 3's `prepare`, which re-derives the case") ||
    !/\*\*case \(i\)\*\* when the PR head is still the anchor \([^)]*after `undo`/.test(lane) ||
    !/\*\*case \(ii\)\*\* when a pushed Integration was logged \([^)]*(`log-integration`|`integrated` row)/.test(lane) ||
    !lane.includes('**`trouble []`** after a pushed shared-file merge that has no log line') ||
    /an Integration log line makes it case \(ii\)/.test(execute)) fails.push('prepare-cases')

  // step11-halt: step 1.1 halts at once on a hold and names what it never launches; Lost call writes nothing under it.
  const s11 = subs[0] ?? ''
  if (!s11.includes('Its `gitEnvHold` comes first of all') || !s11.includes('whatever the lane or live calls say') ||
    !s11.includes('no *Lost call* `resumeFromRunId`') || !s11.includes('no § 3.7 signed-gate resume') || !s11.includes('no merge-task') ||
    !lost.includes('*Lost call* writes nothing and resumes nothing; after the ack the next entry\'s *Restart routing* handles it')) fails.push('step11-halt')

  // lane-free: the lane frees at every lane-holding site; undo first after a verify trip; the RACE path ends undecided.
  if (!lane.includes("*Lost call*'s `integrate` arm") || !lane.includes('`lead-integrate.py undo') ||
    !lane.includes('step 1.1 halts `reason="RACE undecided: [[<slug>]]"`') || !lane.includes('frees the lane')) fails.push('lane-free')

  // race-gitenv: the `git-env halt` phrase at every RACE site and every definition of the in-flight state.
  const exit5 = sentinel.slice(sentinel.indexOf('the hold route'))
  if (!race.includes('`- <now> [[<slug>]] re-verify not run: git-env halt`') ||
    !race.includes('`- <now> [[<slug>]] re-verify stopped: git-env halt (rc <rc|absent>)`') ||
    !exit5.includes("<the script's RACE line>; re-verify not run: git-env halt") ||
    !before(inFlight, 'status cannot tell which, so say so.', 'carries `git-env halt`') ||
    !before(r1, 'its owner session shows the `RACE: …` halt or no run, or has ended.', 'A git-env halt ends it too') || !r1.includes('carries `git-env halt`') ||
    !before(rifRow, 'it is **RACE**', 'carries a `git-env halt` line naming it')) fails.push('race-gitenv')

  // race-followon: § 3e carries the git-env reading of the verdict and hands the slug to § 3c; § 3c is unchanged.
  if (!follow.includes('go straight to § 3c') || !follow.includes('skipped or stopped by the git-env halt') ||
    !follow.includes('not `RACE: origin/<default> fails the verifier`') || !follow.includes('absent means the re-verify never ran') ||
    !follow.includes("replaces § 3c item 5's halt-reason reading for this slug only") ||
    !c3raw.includes(C3_ITEM5) || /git-env/.test(c3raw)) fails.push('race-followon')

  // drop-guard: § 3e's restore drops nothing unseen.
  const optA = bullet(d3raw, '(a) Restore and ack')
  if (!optA.includes('--drop-local <the B sha shown>') || !optA.includes('close-out') || !optA.includes('`git-env-rescue`') ||
    !optA.includes('only when no Workflow call or background Integration command of the rollout is in flight') ||
    !rDonts.includes('never pass `--drop-local` for commits Lachy was not shown')) fails.push('drop-guard')

  // merge-result (contract 7): check-all before routing ANY merge-task result, heartbeat clause (4) inherits it
  // with its bytes unchanged, the failed:git-env row and backoff, the hold route 0/5/2/70.
  const mr = bullet(canRaw, 'The merge-result rule.')
  if (!mr.includes('Before routing ANY merge-task result') || !mr.includes('run `check-all`') ||
    !mr.includes('§ 5 heartbeat clause (4)\'s "act on it as §4.5 would"') || !hb.includes(HB4) ||
    !sentinel.includes('Before routing ANY merge-task result, run the canary\'s `check-all`') ||
    !(rows['`failed:git-env`'] ?? '').includes('reason="git-env trip: the shared checkout changed"') ||
    !backoff.includes('`# thread:git-env-backoff` snippet') ||
    !['0 → `mark-done`', '5 → the `## Race log` line only', '2/70 → halt', '`failed:git-env` → halt', 'anything else does nothing'].every((k) => mr.includes(k)) ||
    !donts.includes('never take a route under a git-env hold but 0/5/2/70')) fails.push('merge-result')

  // exit-rule: any non-zero exit halts with one of two reasons, in the paragraph and in § 7; never ack from execute.
  const ex = bullet(canRaw, 'The exit rule.')
  if (!ex.includes('Any non-zero exit halts: exit 3 `reason="git-env trip: the shared checkout changed"`, anything else `reason="git-env canary failed"`') ||
    !s7.includes('`reason="git-env trip: the shared checkout changed"`') || !s7.includes('`reason="git-env canary failed"`') ||
    !donts.includes('never ack from execute') || !pz.includes("TaskStop'd calls keep their open git-env records")) fails.push('exit-rule')

  // owner-closeout: the owner rule and the close-out rule, stricter than S9, everywhere they are stated.
  const ctxCanary = collapse((context.split('\n- **').find((x) => x.startsWith('Git-env canary**')) ?? ''))
  const ctxWindow = collapse((context.split('\n- **').find((x) => x.startsWith('Window**')) ?? ''))
  if (!bullet(canRaw, 'The owner rule.').includes('A window can only be open while its vault owner holds') ||
    !bullet(canRaw, 'The close-out rule.').includes("land.sh's `closeout_shaped` paths, stricter than S9: no merge commit and no empty commit") ||
    !ctxCanary.includes('stricter than land.sh S9') || !ctxWindow.includes('can only be open while its vault owner holds') ||
    !adrB.includes('**stricter than S9**') || !adrB.includes('open only while its vault owner holds') ||
    !s27.includes("land.sh's `closeout_shaped`; stricter than its S9, so no merge and no empty commit") ||
    !s27.includes('a close-out committed on the local default branch mid-rollout must not halt an unattended run. The git-env canary (§ 4.5) honours this')) fails.push('owner-closeout')

  // status: § 2 reads gitEnvHold, § 3 flags it (offline too), § 4's headline and action 7 route it to repair.
  if (!status2.includes('plus `gitEnvHold`') || !gflag.includes('it holds offline too') ||
    !status4.includes('`GIT-ENV HOLD: [[a]], [[b]]`') ||
    !status4.includes('An unacked git-env trip (§ 3\'s Git-env trip flag) is an open escalation too → `/thread:repair [[<rollout>]]`')) fails.push('status')

  // schedule: the supersede runs check-all on the prior before the preview and the carry, says the evidence write
  // is intended, and retires the prior after the carry.
  if (!before(sch1, 'git-env-canary.py check-all --rollout ~/repos/obsidian/Work/Tasks/<prior>.md', 'carry --from ~/repos/obsidian/Work/Tasks/<prior>.md --dry-run') ||
    !sch1.includes("This preview may append a trip line to the prior rollout note's `## Git-env log` before you confirm anything. That write is intended: it records evidence that a window changed. The decision to accept it stays with `/thread:repair`.") ||
    !sch6.includes('git-env-canary.py check-all --rollout ~/repos/obsidian/Work/Tasks/<prior-slug>.md') ||
    !sch6.includes('git-env-canary.py retire --rollout ~/repos/obsidian/Work/Tasks/<prior-slug>.md')) fails.push('schedule')

  // repair: the evidence list, the hand-off held, § 6's record, the every-mode ack.
  if (!d3.includes('git -C R rev-parse --is-bare-repository') || !d3.includes('git -C R config --show-origin --show-scope --get-all core.bare') ||
    !d3.includes('git -C R ls-remote origin refs/heads/<B>') || !d3.includes('If `ack` exits 3') ||
    !r4.includes('a git-env hold stands (§ 3e; report it and stop there)') || !r6.includes('each git-env trip (§ 3e') ||
    !r1.includes('§ 3e: the git-env ack, on Lachy\'s word') || !rDonts.includes("Never ack trips or a ref Lachy was not shown") ||
    !rifRow.includes('(§ 3e hands it to § 3c)') ||
    // The git-env step is 3e: § 3 holds exactly one `**3d` label (p14-4's descope) and one `**3e`, and no file
    // names the git-env step 3d, so every `§ 3d` reads as the descope.
    r3raw.split('\n').filter((l) => l.startsWith('**3d')).length !== 1 || r3raw.split('\n').filter((l) => l.startsWith('**3e')).length !== 1 ||
    !d3raw.startsWith('**3e — a git-env trip') ||
    [execute, status, repair, context, adr].some((t) => /git-env step, 3d|§ 3d: the git-env|§ 3d ack|§ 3d hands|\(§ 3d; report it/.test(t))) fails.push('repair')

  // adr: the bullet records the decisions and the gaps.
  if (!['The close-out decision (option (a))', 'The read order.', 'reads B before O', 'The RACE path.', 'The integrate-call return.',
    "`restore`'s drop guard.", '`--drop-local`', 'a forged `refs/remotes/origin/<default>`', 'close-out-path contents are not inspected',
    'the upgrade path', 'Considered:', 'wrapping the verifier', 'prompt-only'].every((k) => adrB.includes(k))) fails.push('adr')

  // context-readme: the four terms and the script's README line.
  if (!['- **Git-env canary** —', '- **Window** —', '- **Git-env hold** —', '- **Git-env ack** —'].every((k) => context.includes(k)) ||
    !collapse(readme).includes("`skills/execute/scripts/git-env-canary.py` is the lead's git-env canary")) fails.push('context-readme')
  return [...new Set(fails)]
}

test('the git-env canary holds at every site, consumer and record', () => {
  assert.deepEqual(check(real), [])
})

// ---- controls: each mutates the real text in one place and must fail with exactly its rule ---------------------

const RULES = ['marker-tie', 'arm-sites', 'check-sites', 'check-all-sites', 'integrate-check', 'prepare-cases', 'step11-halt',
  'lane-free', 'race-gitenv', 'race-followon', 'drop-guard', 'merge-result', 'exit-rule', 'owner-closeout', 'status', 'schedule',
  'repair', 'adr', 'context-readme']
const CONTROLLED = new Set()
function edit(text, from, to) {
  assert.ok(text.includes(from), `control setup: ${from.slice(0, 80)} not found`)
  return text.replace(from, to)
}
const only = (key, from, to, rule, label) => {
  CONTROLLED.add(rule)
  assert.deepEqual(check({ ...real, [key]: edit(real[key], from, to) }), [rule], label)
}

test('control: status without the log section, or a literal marker in the canary, fails marker-tie', () => {
  only('status', `rollout note's \`${LOG}\` that no later`, "rollout note's log that no later", 'marker-tie', 'status')
  only('canary', 'KINDS = (', `X = "${TRIP}"\nKINDS = (`, 'marker-tie', 'literal copy')
})

test('control: each arm site without its arm fails arm-sites', () => {
  only('execute', ', the canary arm (*Git-env canary*, `--kind task`; a non-zero exit halts and launches nothing), `python3', ', `python3', 'arm-sites', 'step 1.2')
  only('execute', ', then the canary arm (§ 4.5 *Git-env canary*, `--kind task`; a non-zero exit halts and resumes nothing), then:', ', then:', 'arm-sites', '§ 3.7')
  only('execute', ' then the canary arm (§ 4.5 *Git-env canary*: `--kind task`, or `integrate` for an integrate call; a non-zero exit halts and resumes nothing), then resume once', ' then resume once', 'arm-sites', '§ 5')
  only('execute', 'then the canary arm (*Git-env canary*: `--kind race-verify`;', 'then (', 'arm-sites', 'RACE')
})

test('control: step 2 reconciling before its check fails check-sites', () => {
  only('execute', '2. **A task call returns.** Run the canary `check` for its window first (*Git-env canary*: `--kind task`); a non-zero exit halts, but the row is still reconciled whatever the exit. Reconcile its row (§ 6),',
    '2. **A task call returns.** Reconcile its row (§ 6),', 'check-sites', 'step 2')
})

test('control: a merge hold release without check-all fails check-all-sites', () => {
  only('execute', "re-runs § 2.5, then the canary's `check-all` (a non-zero exit halts and releases nothing), and then step 4's", "re-runs § 2.5 and then step 4's", 'check-all-sites', 'hold release')
})

test('control: an integrate return that drops "whatever the exit" fails integrate-check', () => {
  only('execute', 'then reconcile the row whatever the exit, exactly as at step 2', 'then reconcile the row, exactly as at step 2', 'integrate-check', 'integrate')
})

test('control: the old "an Integration log line makes it case (ii)" wording fails prepare-cases', () => {
  const lane = real.execute.split('\n').find((l) => l.startsWith('- **The lane-free rule.**'))
  const from = lane.slice(lane.indexOf('**case (ii)**'), lane.indexOf('; and **`trouble []`**'))
  only('execute', from, 'an Integration log line makes it case (ii)', 'prepare-cases', 'old wording')
})

test('control: Lost call without its under-hold sentence fails step11-halt', () => {
  only('execute', "- Under a git-env hold (`gitEnvHold` non-empty, step 1.1), *Lost call* writes nothing and resumes nothing; after the ack the next entry's *Restart routing* handles it.\n", '',
    'step11-halt', 'lost call')
})

test("control: the lane-free rule without Lost call's integrate arm fails lane-free", () => {
  only('execute', "*Lost call*'s `integrate` arm, the verify arm", 'the verify arm', 'lane-free', 'lost call arm')
})

test('control: each RACE site or in-flight definition without its git-env halt fails race-gitenv', () => {
  only('execute', 'on a non-zero exit append `- <now> [[<slug>]] re-verify not run: git-env halt` to the `## Race log`, launch nothing and halt', 'on a non-zero exit launch nothing and halt', 'race-gitenv', 'race arm')
  only('execute', 'on a non-zero check append `- <now> [[<slug>]] re-verify stopped: git-env halt (rc <rc|absent>)` to the `## Race log`, never', 'on a non-zero check never', 'race-gitenv', 'race check')
  only('execute', "5 → the `## Race log` line only, `- <now> [[<slug>]] <the script's RACE line>; re-verify not run: git-env halt`;", '5 → the `## Race log` line only;', 'race-gitenv', 'exit 5')
  only('status', 'It turns undecided too once a `## Race log` line naming it carries\n  `git-env halt`', 'It turns undecided too once a `## Race log` line names it', 'race-gitenv', 'status in flight')
  only('repair', ' A git-env halt ends it too:', ' A halt ends it too:', 'race-gitenv', 'repair § 1')
  only('repair', '. So is one whose `## Race log` carries a `git-env halt` line naming it, or whose owner session shows a git-env halt (', '. So is one whose owner session shows a git-env halt (', 'race-gitenv', 'repair § 2 row')
})

test('control: the follow-on reading moved into § 3c fails race-followon', () => {
  const s = 'For this slug only, absent means the re-verify\n  never ran, or was skipped or stopped by the git-env halt, not a red result; `0` means it ran green but the\n  lead never acted on it.'
  const moved = edit(edit(real.repair, s, ''), '   never re-verified: say so.\n', `   never re-verified: say so. ${s.replace(/\n {2}/g, ' ')}\n`)
  CONTROLLED.add('race-followon')
  assert.deepEqual(check({ ...real, repair: moved }), ['race-followon'], 'moved into § 3c')
})

test('control: § 3e option (a) without --drop-local fails drop-guard', () => {
  only('repair', '  `--drop-local <the B sha shown>` only when that range was shown non-empty.', '  nothing more.', 'drop-guard', 'no drop-local')
})

test('control: no failed:git-env row, or heartbeat clause (4) reworded, fails merge-result', () => {
  const row = real.execute.split('\n').find((l) => l.startsWith('   | `failed:git-env` |'))
  only('execute', row + '\n', '', 'merge-result', 'no row')
  only('execute', 'act on it as §4.5 would; otherwise do nothing more.', 'act on it; otherwise do nothing more.', 'merge-result', 'heartbeat bytes')
})

test('control: § 7 without the canary-failed reason fails exit-rule', () => {
  only('execute', ', `reason="git-env canary failed"` on anything else — a **designed** stop', ' — a **designed** stop', 'exit-rule', '§ 7')
})

test('control: the close-out rule losing "stricter than S9" fails owner-closeout', () => {
  only('execute', "land.sh's `closeout_shaped` paths, stricter than S9: no merge commit and no empty commit", "land.sh's `closeout_shaped` paths", 'owner-closeout', 'stricter')
})

test("control: status's action 7 without the git-env trip fails status", () => {
  only('status', "   An unacked git-env trip (§ 3's Git-env trip flag) is an open escalation too → `/thread:repair [[<rollout>]]`,\n   ahead of every reinstate or resume: only its § 3e ack, on Lachy's word, lifts the hold.\n", '', 'status', 'action 7')
})

test('control: schedule without the intended-write sentence fails schedule', () => {
  only('schedule', ' That write is intended: it records evidence that a window changed.', '', 'schedule', 'intended')
})

test('control: a repair hand-off not held behind the git-env hold fails repair', () => {
  only('repair', ', a git-env hold stands (§ 3e; report it and stop there)', '', 'repair', 'hand-off')
  only('repair', '**3e — a git-env trip', '**3d — a git-env trip (old label).**\n\n**3e — a git-env trip', 'repair', 'a second 3d label')
  only('status', '(its git-env step, 3e)', '(its git-env step, 3d)', 'repair', 'status names the step 3d')
  only('repair', ' (§ 3e hands it to § 3c) |', ' |', 'repair', '§ 2 RACE row')
})

test('control: an ADR bullet without the upgrade gap fails adr', () => {
  only('adr', 'and the upgrade path:', 'and', 'adr', 'upgrade')
})

test('control: no README line fails context-readme', () => {
  only('readme', "`skills/execute/scripts/git-env-canary.py` is the lead's git-env canary", '`x` is something', 'context-readme', 'readme')
})

test(`the rules are all named (${RULES.length}) and each has a control`, () => {
  assert.deepEqual(RULES.filter((r) => !CONTROLLED.has(r)), [])
})
