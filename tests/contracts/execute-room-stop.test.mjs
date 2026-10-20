// A Chorus room stop (p18-1; Chorus ADR 0071, the lead's half): execute § Room stop and every site it reaches. At a
// Login's line the lead starts nothing, frees the lane, stops each Workflow call at a step boundary
// (skills/execute/scripts/step-boundary.py, executed by skills/execute/tests/room-stop.test.mjs), records the stop on
// the rollout note, never pauses, and resumes every stopped call at the next loop entry. A transient row after a usage
// limit is a Lost call, never reconciled. Every Cold resume reads a believed-live call against /workflows, a room stop
// or not; a tripped integrate check drops the call for `prepare`; status and repair read a room stop, standing or
// lapsed, as a live queue while its owner session lives, whatever its tasks read. This pins the prose an LLM lead
// follows, in execute, status, handoff, repair and CONTEXT.md.
//
// Every rule lives in one function, checkRoomStop({ skill, status, handoff, repair, context }), that returns named failures,
// so the real files and the controls run through identical logic: each control mutates the real text in one place and
// must fail with exactly its rule. The status lines are parsed with the Stop hook's own STATUS_RE. Reads files only.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { collapse, read, root, section, slice } from '../lib/contract-text.mjs'

const real = {
  skill: read('skills/execute/SKILL.md'),
  status: read('skills/status/SKILL.md'),
  handoff: read('skills/handoff/SKILL.md'),
  repair: read('skills/repair/SKILL.md'),
  context: read('CONTEXT.md'),
}
const DRIVER = path.join(root, 'hooks', 'rollout-stop-driver.py')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'room-stop-contract-'))
after(() => fs.rmSync(tmp, { recursive: true, force: true }))

const ROOM = /^## Room stop \(/
const S45 = /^### 4\.5\. /
const before = (hay, a, b) => hay.indexOf(a) >= 0 && hay.indexOf(b) >= 0 && hay.indexOf(a) < hay.indexOf(b)
const lineAt = (text, re) => (text ?? '').split('\n').findIndex((l) => re.test(l))

// The section's numbered items, raw and in order: [{ n, raw }], sliced by `^\d+\. `.
function itemList(skill) {
  const out = []
  for (const l of (section(skill, ROOM) ?? '').split('\n').slice(1)) {
    const m = l.match(/^(\d+)\. /)
    if (m) out.push({ n: Number(m[1]), raw: l })
    else if (out.length) out[out.length - 1].raw += '\n' + l
  }
  return out
}
const item = (skill, n) => collapse(itemList(skill).find((x) => x.n === n)?.raw ?? '')
// A `   - **<label>` bullet inside item n, with its continuation, collapsed.
function bulletOf(skill, n, label) {
  const lines = (itemList(skill).find((x) => x.n === n)?.raw ?? '').split('\n')
  const i = lines.findIndex((l) => l.startsWith(`   - **${label}`))
  if (i < 0) return ''
  const j = lines.findIndex((l, k) => k > i && /^ {3}- /.test(l))
  return collapse(lines.slice(i, j < 0 ? undefined : j).join('\n'))
}
// A bold-labelled block inside § 4.5: from its label line to the next bold label at column 0.
function labelled(skill, label) {
  const lines = (section(skill, S45) ?? '').split('\n')
  const i = lines.findIndex((l) => l.startsWith(`**${label}`))
  if (i < 0) return ''
  const j = lines.findIndex((l, k) => k > i && /^\*\*[A-Z]/.test(l))
  return collapse(lines.slice(i, j < 0 ? undefined : j).join('\n'))
}
const lineStarting = (skill, prefix) => collapse((skill.split('\n').find((l) => l.startsWith(prefix))) ?? '')
// A `- <prefix>` bullet of a block, with its indented continuation, collapsed.
function bulletIn(block, prefix) {
  const lines = block.split('\n')
  const i = lines.findIndex((l) => l.startsWith(prefix))
  if (i < 0) return ''
  const j = lines.findIndex((l, k) => k > i && !/^\s+\S/.test(l))
  return collapse(lines.slice(i, j < 0 ? undefined : j).join('\n'))
}
const sentences = (text) => text.split(/(?<=\.)\s+/)
// A bold-labelled paragraph of a section: from its label line to the next blank line, collapsed.
function para(text, label) {
  const lines = (text ?? '').split('\n')
  const i = lines.findIndex((l) => l.startsWith(`**${label}`))
  if (i < 0) return ''
  const j = lines.findIndex((l, k) => k > i && !l.trim())
  return collapse(lines.slice(i, j < 0 ? undefined : j).join('\n'))
}
// Status § 4's recommended action n, with its indented continuation, collapsed.
function action(status, n) {
  const lines = (section(status, /^### 4\. /) ?? '').split('\n')
  const i = lines.findIndex((l) => l.startsWith(`${n}. `))
  if (i < 0) return ''
  const j = lines.findIndex((l, k) => k > i && !/^\s+\S/.test(l))
  return collapse(lines.slice(i, j < 0 ? undefined : j).join('\n'))
}

// The Stop hook's STATUS_RE over candidate lines: [state group or null] per line.
function driverStates(lines) {
  const py = 'import importlib.util, json, sys\n' +
    'spec = importlib.util.spec_from_file_location("d", sys.argv[1]); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)\n' +
    'print(json.dumps([(lambda h: h.group("state") if h else None)(m.STATUS_RE.search(l)) for l in json.loads(sys.argv[2])]))\n'
  const r = spawnSync('python3', ['-c', py, DRIVER, JSON.stringify(lines)],
    { encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', THREAD_EVENTS_DIR: path.join(tmp, 'events') } })
  if (r.status !== 0) return lines.map(() => null)
  return JSON.parse(r.stdout)
}

// The heartbeat's order tokens (execute-queue's heartbeat rule): clause (2)'s room-stop text carries none of them.
const ORDER = ['Lost calls', 'background Integration command', 'starts `gated:`', 'starts `review required:`',
  'no Workflow call for this rollout is in flight']

function checkRoomStop({ skill, status, handoff, repair, context }) {
  const fails = []
  const raw = section(skill, ROOM) ?? ''
  const sec = collapse(raw)
  const items = itemList(skill)
  const it = (n) => item(skill, n)
  const s45 = section(skill, S45) ?? ''
  const subLine = (prefix) => collapse(s45.split('\n').find((l) => l.startsWith(prefix)) ?? '')
  // Sub-step 2 opens with the Standing approval (ADR 0034); the Seeded revises follow on the same line.
  const s12 = collapse(s45.split('\n').find((l) => l.startsWith('   2. **') && l.includes('**Seeded revises')) ?? '')
  const s13 = subLine('   3. For each slug in `restart`')
  const s14 = subLine('   4. If the lane is free')
  const st2 = subLine('2. **A task call returns.**')
  const integ = subLine('   **The integrate call**')
  const lostRaw = (() => {
    const lines = s45.split('\n')
    const i = lines.findIndex((l) => l.startsWith('**Lost call.**'))
    if (i < 0) return ''
    const j = lines.findIndex((l, k) => k > i && /^\*\*[A-Z]/.test(l))
    return lines.slice(i, j < 0 ? undefined : j).join('\n')
  })()
  const lost = collapse(lostRaw)
  const lostDef = collapse(lostRaw.split('\n')[0] ?? '')
  const lostRoom = bulletIn(lostRaw, '- While a room stop stands')
  const lostUsage = bulletIn(lostRaw, '- **After a usage limit.**')
  const restart = labelled(skill, 'Restart routing')
  const cold = labelled(skill, 'Cold resume.')
  const rein = labelled(skill, 'Reinstate (resuming a paused rollout).')
  const checkSites = lineStarting(skill, '- **Check sites:**')
  const s27 = collapse(section(skill, /^### 2\.7\. /) ?? '')
  const s6 = collapse(section(skill, /^### 6\. /) ?? '')
  const s8 = collapse(section(skill, /^### 8\. /) ?? '')
  const donts = collapse(section(skill, /^## Don'ts/) ?? '')
  const soft = lineStarting(skill, '**Soft pause (default).**')
  const hb = skill.split('\n').find((l) => l.startsWith('> ROLLOUT-HEARTBEAT')) ?? ''
  const c2 = hb.indexOf('never resume a paused rollout.') >= 0 && hb.indexOf('(3)') >= 0
    ? hb.slice(hb.indexOf('never resume a paused rollout.'), hb.indexOf('(3)')) : ''

  // section: the heading sits between Pausing and Don'ts, holds no ##/### heading (the next heading is Don'ts), and
  // its one numbered list carries items 0 to 12, each once.
  const lines = skill.split('\n')
  const iP = lineAt(skill, /^## Pausing \+ reinstating a rollout/)
  const iR = lineAt(skill, ROOM)
  const iD = lineAt(skill, /^## Don'ts/)
  const nextHeading = lines.findIndex((l, k) => k > iR && /^#{2,3} /.test(l))
  const nums = items.map((x) => x.n).sort((a, b) => a - b)
  if (!(iP >= 0 && iP < iR && iR < iD) || nextHeading !== iD ||
    JSON.stringify(nums) !== JSON.stringify([...Array(13).keys()])) fails.push('section')

  // trigger: a `Chorus: ` Prompt or Steer, either line.
  if (!['`Chorus: `', "`is at its week's line`", '`is at its 5-hour line`'].every((k) => it(1).includes(k))) fails.push('trigger')

  // record-first: `begin` before any `mark`; no `paused:` stamp, no `record-pause`; bare slugs, which `begin` itself
  // enforces (exit 2, nothing written), so its exit 2 is re-run bare, never carried on as a non-durable stop.
  if (!before(sec, 'step-boundary.py begin', 'step-boundary.py mark') ||
    !['writes no `paused:` stamp', 'runs no `record-pause`', 'never as wikilinks', '`begin` refuses text holding `[[` (exit 2, nothing written): re-run it once with the slugs bare',
      'On any other non-zero exit, print its line and carry on'].every((k) => it(2).includes(k))) fails.push('record-first')

  // start-nothing: nothing launches; an integrate row's outcome waits; free-lane only after an `integrated` row, and
  // never on a row that already freed the lane.
  const freeing = sentences(it(3)).filter((x) => x.includes('`free-lane --tasks <slug>`'))
  if (!it(3).includes('launch nothing: no `next`, start, restart') || !it(3).includes('its `integration.outcome` is not acted on') ||
    !freeing.length || !freeing.every((x) => x.includes('After an `integrated` row')) ||
    !it(3).includes('A `rejected`, review-blocked or `set-aside` row has already freed the lane')) fails.push('start-nothing')

  // lane: the lane commands stop first, whatever is live; a stopped command leaves heartbeat clause (4)'s set; a merge
  // hold stands; a room-stopped integrate call keeps the lane, and step 1.4 resumes it first.
  if (!before(raw, 'TaskStopped at once', 'step-boundary.py mark') ||
    !it(4).includes('whether or not a Workflow call is live') || !it(4).includes('`free-lane --tasks <slug>`') ||
    !it(4).includes('A merge hold stands') ||
    !it(4).includes("leaves this session's set of unreported background Integration commands") ||
    !it(4).includes('heartbeat clause (4)') || !it(4).includes('never acts on its result file') ||
    !it(6).includes('A room-stopped integrate call keeps the lane held until step 1.4 resumes it: no `free-lane`, no `prepare` on its task') ||
    !s14.includes('a room-stopped integrate call (§ Room stop), which holds the lane, is resumed first') ||
    !s14.includes('(`--kind integrate`)') || !s14.includes('no `prepare` runs on its task')) fails.push('lane')

  // stopped-verify: item 9 undoes a stopped verify's M with no canary check (its rc is never a verify result, and a
  // check there trips `record not armed`); item 4 records what it needs; Check sites says it is none.
  const sv = bulletOf(skill, 9, 'A stopped verify.')
  if (!sv.includes('`lead-integrate.py undo --repo <repoPath> --slug <slug> --merge M --to <prHead>`, with no canary `check` before it') ||
    /check --kind verify/.test(sv) || sv.includes('`--kind verify`') ||
    !sv.includes('never read as a verify result') || !sv.includes('`record not armed`') ||
    !it(4).includes('M (`mergeCommit`), `prHead`') ||
    !checkSites.includes('A verify a room stop stopped is not a check site')) fails.push('stopped-verify')

  // stop-at-boundary: mark, then the background watch; TaskStop on `boundary`; relaunch until `all `; exit 3 relaunches;
  // exit 1 or 2 leaves the calls running; nothing live skips only the mark and watch; a gap relaunch re-marks first.
  if (!before(it(5), 'step-boundary.py mark', 'step-boundary.py watch') || !it(5).includes('`timeout: 7200000`') ||
    !it(5).includes('TaskStop each call it names `boundary`') || !it(5).includes('Unless its last line starts `all `') ||
    !it(5).includes('exit 3: launch it again') || !it(5).includes('exit 1 or 2: print its line and leave the calls running') ||
    !it(5).includes('run neither `mark` nor `watch`; every other item still applies') || /\bskip (?:to|past) item\b/i.test(sec) ||
    !it(5).includes('it first re-runs `mark` on the same `--out` over each call that /workflows still lists in flight and that this lead has not stopped, then runs `watch`')) {
    fails.push('stop-at-boundary')
  }

  // durable: the stop lives on the note. Every entry ends it once its gates and check-all pass; item 1 reads it after a
  // compaction; Lost call reads it; clause (2) reads it unguarded and goes on when none stands.
  const END = 'step-boundary.py end'
  const VT = "§ 3's `verify_timeout` check"
  const withStands = sentences(hb).find((x) => x.includes('step-boundary.py stands')) ?? ''
  if (!before(cold, 're-run § 2.5', END) || !before(cold, VT, END) || !before(cold, END, 'reconcile-rollout.py resume') ||
    !cold.includes("once the entry's `check-all` (*Landing-register re-check*) has exited 0") ||
    !before(rein, VT, END) || !before(rein, END, 'clear-pause') ||
    !it(1).includes('after a compaction') || !it(1).includes('exit 0 or 4') || !lost.includes('(§ Room stop; `step-boundary.py stands` exits 0 or 4)') ||
    withStands.includes('ROLLOUT-STATUS') || !hb.includes('On any other exit no room stop stands: go on to the next clause.')) fails.push('durable')

  // never-pause: item 7 names every never, and `paused:` only as one.
  const n7 = it(7)
  if (!['never stamps `paused:`', 'never runs `record-pause`', 'never CronDeletes the heartbeat', 'never hands off'].every((k) => n7.includes(k)) ||
    n7.split('`paused:`').length !== n7.split('never stamps `paused:`').length) fails.push('never-pause')

  // status-lines: item 8's two lines end `waiting` under the hook's STATUS_RE and are quote-free; § 6 allows the reason.
  const st = [...it(8).matchAll(/`(ROLLOUT-STATUS: [^`]*)`/g)].map((m) => m[1])
  const filled = st.map((l) => l.replace('<rollout-slug>', 'demo').replace('<K>', '1').replace('<N>', '3').replace('<R>', '0'))
  if (st.length !== 2 || JSON.stringify(driverStates(filled)) !== JSON.stringify(['waiting', 'waiting']) ||
    !st.every((l) => /state=waiting reason="room stop: [^"]*"$/.test(l)) ||
    !s6.includes('`reason` appears only on `halted`, on a hold and on a retry cool-down (§4.5 step 1.5), and on a room stop (§ Room stop)') ||
    !s6.includes('or a room stop stands (§ Room stop)')) fails.push('status-lines')

  // resume-entry: any loop entry ends it, whoever sends it, with or without a `Chorus: ` head; it runs as Cold resume
  // (the Stage's re-send skips § 2.7); right after `end`, a room stop or not, a call counts as live only while
  // /workflows lists it, and one gone with no row is room-stopped only when `end` ended a stop, else a Lost call.
  const calls9 = bulletOf(skill, 9, 'Calls it had not stopped.')
  if (!calls9.includes('whether or not a room stop stood') || !calls9.includes('it is a *Lost call* at this entry') ||
    !calls9.includes('each Workflow call this session still believes live counts as live only while /workflows lists it in flight') ||
    calls9.includes('Right after `end` prints `room stop ended`') ||
    !it(9).includes('whoever opens it') || !it(9).includes('with or without a `Chorus: ` head') ||
    !it(9).includes('The entry runs exactly as *Cold resume* does') || it(9).includes('§ 2.5 and § 2.6') ||
    !s27.includes("or on the Chorus Stage's re-send of `/thread:execute [[<slug>]] §4.5 resume` (§ Room stop), with or without a `Chorus: ` head") ||
    !it(9).includes('counts as live only while /workflows lists it in flight') || !it(9).includes('is room-stopped (item 6)') ||
    !it(6).includes('finds gone at the resume') ||
    !cold.includes('a call this session believed live counts as live only while /workflows lists it in flight') ||
    sec.includes('live as before')) fails.push('resume-entry')

  // resume-live: a room-stopped call stays live in `--running` until steps 1.3/1.4 resume it, pause_requested or not,
  // and a soft pause's drain waits for it.
  if (!it(6).includes("counts among the live task-call slugs in every `--running`, the heartbeat's included") ||
    !it(6).includes("a soft pause's drain waits for it") || !bulletOf(skill, 9, 'The resumes.').includes('`pause_requested` or not') ||
    !s13.includes('resumes each room-stopped task call and seeded revise (§ Room stop), `pause_requested` or not') ||
    !s13.includes('`mark-started --tasks <slug> --rollout <rollout-note> --start resume --arm-repo <repoPath> --arm-default <B>`') ||
    !cold.includes('A room-stopped task call this session holds the handle of counts as a live task call here and in every `--running` until step 1.3 resumes it') ||
    !soft.includes('A room-stopped call (§ Room stop) is in-flight work: it counts as running in `--running`, and the drain resumes it')) fails.push('resume-live')

  // git-env-hold: the resumes run after step 1.1, whose hold halts them all.
  if (!s13.includes('After step 1.1, and before the first restart, step 1.3 resumes') ||
    !s14.includes('After step 1.1, a room-stopped integrate call') ||
    !it(9).includes('After step 1.1, whose `gitEnvHold` halt resumes nothing')) fails.push('git-env-hold')

  // lost-call-room: while it stands a call that ends rowless writes nothing; after it, a fresh once at step 1.3/1.4.
  const lostHead = lostRaw.slice(0, Math.max(0, lostRaw.indexOf('- Otherwise, once:')))
  if (!lostRoom.startsWith('- While a room stop stands') || !lostRoom.includes('it takes the `Otherwise, once:` resume with a fresh once') ||
    !lostRoom.includes('at step 1.3 or 1.4') || lostHead.includes('resumeFromRunId')) fails.push('lost-call-room')

  // usage-limit: how the limit is known, and what a transient row after it is.
  if (!['`hit its usage limit`', 'Lost calls the limit cut', '`usage limit reached`', 'with or without a `Chorus: ` head',
    'contains `transient infrastructure failure`', 'is never reconciled', 'each usage limit grants a fresh once',
    "A call the CLI's respawn ended with no row at all (a usage-limit or signed-out re-send opened the entry, and *Cold resume* finds it gone) gets the same fresh once"].every((k) => lostUsage.includes(k))) {
    fails.push('usage-limit')
  }

  // transient-routing: every reconcile site routes that row to Lost call before it reconciles.
  if (!lostDef.includes('or a transient row after a usage limit (*After a usage limit*, below)') ||
    !st2.includes('Reconcile its row (§ 6), except a row whose `blockerDiagnosis` contains `transient infrastructure failure` from a call launched before a usage limit this Session knows of: that row is never reconciled') ||
    !st2.includes('it goes to *Lost call* (*After a usage limit*)') || !st2.includes('An error, no row, or a transient row after a usage limit: *Lost call*') ||
    !integ.includes('A transient row after a usage limit (its `blockerDiagnosis` contains `transient infrastructure failure`) is the exception, as at step 2: it is never reconciled, writes no `## Integration log` line, keeps `integrating:` and the lane held, and goes to *Lost call*') ||
    !s6.includes('One row is never reconciled: a transient row after a usage limit (its `blockerDiagnosis` contains `transient infrastructure failure`') ||
    !checkSites.includes('A transient row after a usage limit is checked there like any row but never reconciled')) fails.push('transient-routing')

  // lost-handle: a runId alone never resumes; a lost integrate handle frees the lane and re-enters through prepare.
  if (!/a runId alone is never a handle/i.test(it(6)) || !/a runId alone is never a handle/i.test(it(10)) ||
    !restart.includes('with the `scriptPath` and args it launched with (a runId alone is never a handle, § Room stop) → *Lost call*') ||
    !it(10).includes('An integrate call whose handle is lost frees the lane (`free-lane --tasks <slug>`), and its task re-enters through step 1.4 and `prepare`')) {
    fails.push('lost-handle')
  }

  // bound: clause (2) reads `stands` after the paused check and before clause (3); a lapse re-enters Cold resume
  // skipping § 2.7; a lost watch is relaunched with a re-mark first; no clause number or order token in it; 6 h is the
  // Stage's owed-resume horizon, never d3's wait.
  if (!(hb.indexOf('`paused:`') >= 0 && hb.indexOf('`paused:`') < hb.indexOf('step-boundary.py stands') && c2.includes('step-boundary.py stands')) ||
    !c2.includes('On exit 4') || !c2.includes('§4.5 *Cold resume*') || !c2.includes('skips § 2.7') ||
    !before(c2, 'first run `step-boundary.py mark` again', 'then the watch in the background') ||
    /\(\d\)/.test(c2.slice('never resume a paused rollout.'.length)) || ORDER.some((k) => c2.includes(k)) || c2.includes('ROLLOUT-STATUS: ') ||
    !it(11).includes('`OWED_MAX_S`') || it(11).includes('5-hour wait')) fails.push('bound')

  // step12-pointer: step 1.2's retry never sees such a row.
  if (!s12.includes('A transient row after a usage limit this Session knows of never reaches this retry: *Lost call* resumes it first (*After a usage limit*)')) {
    fails.push('step12-pointer')
  }

  // guardrail: § 8 says it ends waiting, never halted, never paused.
  if (!s8.includes('**A room stop ends `waiting`, never `halted`, and never stamps `paused:`** (§ Room stop)')) fails.push('guardrail')

  // donts: no pause on a room signal; no process stopped by name or pattern.
  if (!donts.includes('On a Chorus room signal, never stamp `paused:`, run `record-pause`, CronDelete the heartbeat, hand off or call the question tool (§ Room stop)') ||
    !['Never stop a process by name or pattern', '`pkill`', '`killall`', 'by its pid or task id'].every((k) => donts.includes(k))) fails.push('donts')

  // handoff: on the Stage a Login at its line is never a handoff.
  const gate = collapse(slice(handoff, /^\*\*Invocation gate\.\*\*/, /^## /) ?? '')
  if (!gate.includes("On the Chorus Stage a Login at its line is never a handoff: execute § Room stop stops the rollout's calls at a step boundary") ||
    !gate.includes('off the Stage a handoff stays the way to continue')) fails.push('handoff')

  // repair: its usage-limit class sees only the resume's row; repair never names resumeFromRunId.
  if (!collapse(repair).includes("When the limit is known to the lead's Session, execute § 4.5 *Lost call* first resumes such a transient row once from its own run") ||
    repair.includes('resumeFromRunId')) fails.push('repair')

  // context: the term, its span and Chorus's word for it.
  const term = collapse(context.split('\n- **').find((x) => x.startsWith('Room stop**')) ?? '')
  if (!context.includes('- **Room stop** —') || !term.includes('from its `## Pause log` line to `room stop ended`') ||
    !term.includes('"a drain, not a pause"')) fails.push('context')
  // live-check: EVERY Cold resume, a room stop or not, reads a believed-live call against /workflows. The Stage's d5
  // usage-limit or signed-out re-send respawns the CLI with no room stop standing (none signalled before the limit,
  // or item 11's lapse re-entry already ended it), and the dead calls must not ride `--running` as live until
  // heartbeat clause (3)'s first tick. Gone with no row: room-stopped when this entry's `end` ended a stop, else a
  // Lost call at this entry (a task call through Restart routing at step 1.3, an integrate call at step 1.4).
  if (!cold.includes('At every *Cold resume*, whether or not a room stop stood, a call this session believed live counts as live only while /workflows lists it in flight') ||
    !cold.includes("is room-stopped (§ Room stop) when this entry's `end` printed `room stop ended`; otherwise it is a *Lost call* at this entry, never left to heartbeat clause (3)'s first tick") ||
    !cold.includes('while /workflows lists them in flight they are running, never stalled') ||
    cold.includes('When `end` printed `room stop ended`, a call this session believed live') ||
    !s14.includes('Any other integrate call that holds the lane with no reconciled row is a *Lost call* (one *Cold resume* found gone, or one a git-env hold left)')) {
    fails.push('live-check')
  }

  // integrate-trip: at the integrate call's return a tripped check wins over Lost call and a room stop alike. A return
  // that reconciled no row (a transient row, an error, no row) drops its runId and frees the lane, the note keeping
  // `integrating:`, so after the ack `prepare` alone re-enters the task and no Lost call resume races it for the lane
  // (two Integrations on one branch). Only after a check that exited 0 does such a row go to Lost call. The lane-free
  // rule, item 6, Lost call's room and hold bullets and step 1.4 say the same.
  const laneFree = lineStarting(skill, '- **The lane-free rule.**')
  const lostHold = bulletIn(lostRaw, '- Under a git-env hold')
  if (!integ.includes(', and goes to *Lost call*, unless its check tripped (below)') ||
    !integ.includes('**A tripped check wins over *Lost call* and a room stop alike:** when the return reconciled no row (a transient row after a usage limit, an error, or no row), its runId is dropped too, so nothing resumes that call') ||
    !integ.includes("the lane frees while the note keeps `integrating:`. After the ack, step 1.4 takes the task through step 3's `prepare`") ||
    !integ.includes('An error, or no row, after a check that exited 0: *Lost call*') ||
    !laneFree.includes('At the integrate check, a return that reconciled no row (a transient row, an error, or no row) also drops its runId') ||
    !it(6).includes("An integrate call whose return's canary `check` tripped is never room-stopped: the trip wins (§ 4.5 step 3)") ||
    !lost.includes("it is room-stopped and keeps its handle (an integrate call whose return's canary `check` tripped excepted: step 3)") ||
    !lostHold.includes('and step 1.4 for an integrate call that still holds the lane') ||
    !s14.includes("An integrate call whose return's canary `check` tripped holds no lane and no runId (step 3)")) fails.push('integrate-trip')

  // status: it reads the durable record (`stands`, read-only), heads a standing room stop `ROOM STOP since <stamp>:
  // awaiting the Stage's resume` with no stalled framing, and never recommends `/thread:execute` under it: any loop
  // entry ends the stop on a Login still at its line, and the Stage then sends nothing. A lapsed one is the owner's
  // heartbeat's. While its owner session is alive a room stop, standing or lapsed, is a live queue whatever its tasks
  // read: every row can come in before its TaskStop, or the signal can come in a cool-down's `waiting` turn, so no
  // task need read running or integrating, and action 10 must still match ahead of action 12's resume ("the order is
  // the precedence"). Action 12 says so itself, and so does § 4's Precedence; action 9's drain waits on a lapsed stop
  // too. Once the owner session has ended, nothing owes the resume.
  const sts2 = collapse(section(status, /^### 2\. /) ?? '')
  const st4raw = section(status, /^### 4\. /) ?? ''
  const prec = para(st4raw, 'Precedence.')
  const ownerQ = para(st4raw, 'Owner-session qualifier.')
  const stRoom = para(st4raw, 'Room stop.')
  const stDonts = collapse(section(status, /^## Don'ts/) ?? '')
  if (!sts2.includes('python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/step-boundary.py stands --rollout <rollout-note>') ||
    !sts2.includes('It writes nothing. Exit 0: a room stop stands') || !sts2.includes('exit 4: it has lapsed') ||
    !para(st4raw, 'Headline.').includes("`ROOM STOP since <stamp>: awaiting the Stage's resume`") ||
    !para(st4raw, 'Headline.').includes("`room stop since <stamp> lapsed: the owner's heartbeat re-enters`") ||
    !['renders as a room stop, not a stall', 'no stalled framing', 'never `/thread:execute` from here',
      'any loop entry, whoever opens it, ends the room stop', 'the Stage then sends nothing',
      "the owner session's heartbeat re-enters *Cold resume* on its next tick",
      'the room stop is a live queue whatever its tasks read and whatever `/workflows` shows: action 10 matches it ahead of drift and every resume (11 to 13)',
      'a call whose row came in before its stop was reconciled', "the signal can come in a cool-down's `waiting` turn with nothing in flight",
      'it is a live queue the same way'].every((k) => stRoom.includes(k)) ||
    !action(status, 10).includes('A room stop, standing or lapsed, is one while its owner session is alive, whatever its tasks read and whatever `/workflows` shows, even when no task reads running or integrating') ||
    !action(status, 10).includes('"wait for the Stage\'s resume", never `/thread:execute`') ||
    !action(status, 10).includes("a lapsed one waits for the owner's heartbeat") ||
    !action(status, 12).includes('A room stop, standing or lapsed, whose owner session is alive is a live lead whatever its tasks read (§ 4\'s *Room stop*): action 10 matches it first, so this resume never runs under one') ||
    !action(status, 9).includes('Under a room stop, standing or lapsed (§ 4\'s *Room stop*), "no run" is no evidence while its owner session is alive') ||
    !action(status, 9).includes("a lapsed one for the owner's heartbeat") ||
    !prec.includes('A room stop needs no override either: while its owner session is alive it is a live queue (10) whatever its tasks read, so it waits ahead of drift and every resume (11 to 13)') ||
    !ownerQ.includes('or a room stop, standing or lapsed, whatever its tasks read') ||
    !stDonts.includes('and never under a room stop, standing or lapsed, while its owner session is alive, whatever `/workflows` shows and whatever its tasks read') ||
    !stRoom.includes('Under either, once the owner session has ended (the owner-session qualifier), nothing owes the resume and the room stop is no live queue') ||
    !stDonts.includes('never `step-boundary.py begin` or `step-boundary.py end`')) fails.push('status')

  // repair-live: repair's diagnosis reads the scan's room stop, standing or lapsed, as a live queue while its owner
  // session lives, so it never enters the loop or writes a lead-held note under either: a lapsed one's owner heartbeat
  // is about to resume the same calls by handle, and the hand-off's `--running ""` would give each task a second call.
  // Its hand-off, a loop entry, ends one an ended owner session left (lapsed or not) after `check-all`, before `resume`.
  const rc = collapse(repair)
  const LAPSED = 'neither the standing `ROOM STOP since <stamp>` nor the lapsed `room stop since <stamp> lapsed`'
  if (!rc.includes("A room stop, standing or lapsed (the scan's `ROOM STOP since <stamp>` or `room stop since <stamp> lapsed` headline, status § 4's *Room stop*), is a live queue too while its owner session has not ended, even with no run there and whatever its tasks read") ||
    !rc.includes('two calls per task') ||
    !rc.includes(`**No lead live.** No pause, and every owner session has ended (or shows no run there, under no room-stop headline, ${LAPSED})`) ||
    !rc.includes(`They run only when no lead is live (every owner session has ended, or shows no run there under no room-stop headline, ${LAPSED},`) ||
    !rc.includes('while a lead is live (the owner check below, under which a room stop counts as live)') ||
    !rc.includes('every loop entry ends a room stop, here one an ended owner session left, lapsed or not') ||
    !before(rc, "then the canary's `check-all` (execute § 4.5 *Git-env canary*; a non-zero exit halts), then `python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/step-boundary.py end --rollout <rollout-note>`",
      '`reconcile-rollout.py resume`, then the loop with')) fails.push('repair-live')
  return [...new Set(fails)]
}

test('execute § Room stop and every site it reaches hold every rule', () => {
  assert.deepEqual(checkRoomStop(real), [])
})

// ---- controls: each mutates the real text in one place and must fail with exactly its rule ---------------------

const RULES = ['section', 'trigger', 'record-first', 'start-nothing', 'lane', 'stopped-verify', 'stop-at-boundary', 'durable',
  'never-pause', 'status-lines', 'resume-entry', 'resume-live', 'git-env-hold', 'lost-call-room', 'usage-limit', 'transient-routing',
  'lost-handle', 'bound', 'step12-pointer', 'guardrail', 'donts', 'handoff', 'repair', 'context', 'live-check', 'integrate-trip',
  'status', 'repair-live']
const CONTROLLED = new Set()
function edit(text, from, to) {
  assert.ok(text.includes(from), `control setup: ${from.slice(0, 80)} not found`)
  return text.replace(from, to)
}
// The same, matching any run of whitespace in `from` (status and repair wrap their prose).
function wsEdit(text, from, to) {
  const re = new RegExp(from.trim().split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+'))
  assert.ok(re.test(text), `control setup: ${from.slice(0, 80)} not found`)
  return text.replace(re, () => to)
}
const only = (mut, rule, label) => {
  CONTROLLED.add(rule)
  assert.deepEqual(checkRoomStop({ ...real, ...mut }), [rule], label)
}
const sk = (from, to) => ({ skill: edit(real.skill, from, to) })
const rawItem = (n) => itemList(real.skill).find((x) => x.n === n).raw
const hbLine = real.skill.split('\n').find((l) => l.startsWith('> ROLLOUT-HEARTBEAT'))
const C2 = hbLine.slice(hbLine.indexOf(' Otherwise run `python3'), hbLine.indexOf(' (3)'))

test('control: the section before Pausing fails section', () => {
  const sec = section(real.skill, ROOM) + '\n'
  const moved = edit(edit(real.skill, sec, ''), '## Pausing + reinstating a rollout\n', sec + '## Pausing + reinstating a rollout\n')
  only({ skill: moved }, 'section', 'before Pausing')
})

test('control: no 5-hour line fails trigger', () => {
  only(sk(" or `is at its 5-hour line` (the 5-hour form", ' (the 5-hour form'), 'trigger', 'week only')
})

test('control: begin after the mark, or no bare slugs, fails record-first', () => {
  const two = rawItem(2) + '\n'
  only({ skill: edit(edit(real.skill, two, ''), rawItem(6), two + rawItem(6)) }, 'record-first', 'begin after mark')
  only(sk(' Slugs are written bare, never as wikilinks: `_schedule_positions` ranks the first wikilink on any list line, so a `## Pause log` above `## Queue` would reorder the queue.', ''),
    'record-first', 'no bare slugs')
  only(sk(' `begin` refuses text holding `[[` (exit 2, nothing written): re-run it once with the slugs bare.', ''), 'record-first', 'no refusal')
  only(sk('On any other non-zero exit, print its line', 'On a non-zero exit, print its line'), 'record-first', 'exit 2 carried on')
})

test('control: an unqualified free-lane, or no already-freed bullet, fails start-nothing', () => {
  only(sk('After an `integrated` row, the lane frees here with `free-lane --tasks <slug>`', 'Its lane frees here: `free-lane --tasks <slug>`'), 'start-nothing', 'unqualified')
  const l = rawItem(3).split('\n').find((x) => x.startsWith('   - **A `rejected`'))
  only(sk(l + '\n', ''), 'start-nothing', 'no already-freed bullet')
})

test('control: the lane freed after the mark, a freed integrate lane, step 1.4 with no resume, or no clause-(4) sentence fails lane', () => {
  const four = rawItem(4) + '\n'
  const five = rawItem(5) + '\n'
  only({ skill: edit(edit(real.skill, four, ''), five, five + four) }, 'lane', 'items 4 and 5 swapped')
  only(sk('A room-stopped integrate call keeps the lane held until step 1.4 resumes it: no `free-lane`, no `prepare` on its task, and no other task takes the lane.',
    'A room-stopped integrate call frees the lane (`free-lane --tasks <slug>`).'), 'lane', 'integrate lane freed')
  only(sk("is resumed first, `pause_requested` or not, through *Lost call*'s `Otherwise, once:` resume with a fresh once (`--kind integrate`), then `bind-run --call integrate --resumed-from <old runId>`",
    'waits for a later entry'), 'lane', 'step 1.4 with no resume')
  const l = rawItem(4).split('\n').find((x) => x.startsWith('   - **It leaves the unreported set at once.**'))
  only(sk(l + '\n', ''), 'lane', 'no clause-(4) sentence')
})

test('control: a canary check before the undo, no bullet, a routed rc, or no Check sites sentence fails stopped-verify', () => {
  only(sk('gets `lead-integrate.py undo --repo <repoPath> --slug <slug> --merge M --to <prHead>`, with no canary',
    'gets the canary `check` (`--kind verify`, with `--default` as passed to `prepare`), then `lead-integrate.py undo --repo <repoPath> --slug <slug> --merge M --to <prHead>`, with no canary'),
  'stopped-verify', 'check re-added')
  const l = rawItem(9).split('\n').find((x) => x.startsWith('   - **A stopped verify.**'))
  only(sk(l + '\n', ''), 'stopped-verify', 'no bullet')
  only(sk('Its rc is never read as a verify result', 'Its rc is routed as step 3 routes a verify rc'), 'stopped-verify', 'rc routed')
  only(sk(' A verify a room stop stopped is not a check site: its rc is never read, the entry\'s `check-all` has compared its window, and its `undo` runs with no `check` (§ Room stop).', ''),
    'stopped-verify', 'no Check sites sentence')
})

test('control: a skip past the lane, no nothing-live sentence, or a gap relaunch with no re-mark fails stop-at-boundary', () => {
  only(sk('With no Workflow call live, run neither `mark` nor `watch`; every other item still applies.', 'With none live, skip to item 8.'), 'stop-at-boundary', 'skip to item 8')
  only(sk(' With no Workflow call live, run neither `mark` nor `watch`; every other item still applies.', ''), 'stop-at-boundary', 'no nothing-live sentence')
  only(sk('it first re-runs `mark` on the same `--out` over each call that /workflows still lists in flight and that this lead has not stopped, then runs `watch`.',
    'it relaunches `watch` on the same state.'), 'stop-at-boundary', 'no re-mark')
})

test('control: an entry that never ends the stop, ends it before its gates, or a guarded or re-entering clause (2) fails durable', () => {
  const END = " then, once the entry's `check-all` (*Landing-register re-check*) has exited 0, end any standing room stop: `python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/step-boundary.py end --rollout <rollout-note>` (§ Room stop; with none standing it writes nothing, and a non-zero exit is printed and the entry goes on);"
  only(sk(END, ''), 'durable', 'Cold resume never ends it')
  only(sk(" then, once the entry's `check-all` has exited 0, end any standing room stop (`step-boundary.py end`, as at *Cold resume*);", ''), 'durable', 'Reinstate never ends it')
  only({ skill: edit(edit(real.skill, END, ''), 'on a rollout that has run: first re-run § 2.5', 'on a rollout that has run: first end any standing room stop (`step-boundary.py end`); then re-run § 2.5') },
    'durable', 'ended before the gates')
  only(sk('never resume a paused rollout. Otherwise run `python3', 'never resume a paused rollout. Otherwise, while the last ROLLOUT-STATUS reason starts `room stop:`, run `python3'),
    'durable', 'clause (2) guarded')
  only(sk('On any other exit no room stop stands: go on to the next clause.', 'On any other exit re-enter *Cold resume*.'), 'durable', 'last exit re-enters')
})

test('control: a paused: stamp in item 7 fails never-pause', () => {
  only(sk('and the hard pause also TaskStops the watch.', 'and the hard pause also TaskStops the watch. At a 5-hour line, stamp `paused:` too.'), 'never-pause', 'stamp')
})

test('control: a quoted reason fails status-lines', () => {
  only(sk('reason="room stop: stopping calls at a step boundary"', 'reason="room stop: "stopping" calls at a step boundary"'), 'status-lines', 'quote')
})

test('control: a Chorus-only resume, a re-listed entry, no § 2.7 entry, a live-as-before call, or no gone call fails resume-entry', () => {
  only(sk('`/thread:execute [[<rollout-slug>]] §4.5 resume`, with or without a `Chorus: ` head (the Stage', '`/thread:execute [[<rollout-slug>]] §4.5 resume` that starts `Chorus: ` (the Stage'),
    'resume-entry', 'Chorus only')
  only(sk('The entry runs exactly as *Cold resume* does,', 'The entry runs § 2.5 and § 2.6 as *Cold resume* does,'), 'resume-entry', 're-listed')
  only(sk(", or on the Chorus Stage's re-send of `/thread:execute [[<slug>]] §4.5 resume` (§ Room stop),\nwith or without a `Chorus: ` head.", '.'), 'resume-entry', 'no § 2.7 entry')
  const calls = rawItem(9).split('\n').find((x) => x.startsWith('   - **Calls it had not stopped.**'))
  only(sk(calls, '   - **Calls it had not stopped.** A call it had not stopped is live as before.'), 'resume-entry', 'live as before')
  only(sk('; and one that item 9 finds gone at the resume.', '.'), 'resume-entry', 'no gone call')
  only(sk('Right after `end`, and before anything else, each Workflow call', 'Right after `end` prints `room stop ended`, and before anything else, each Workflow call'),
    'resume-entry', 'item 9 qualifier back')
  only(sk('each Workflow call this session still believes live counts as live', 'each Workflow call this session still counts as live counts as live'),
    'resume-entry', 'item 9 old wording')
})

test('control: room-stopped calls sent to restart, no pause_requested, or no soft-pause sentence fails resume-live', () => {
  only(sk("counts among the live task-call slugs in every `--running`, the heartbeat's included", 'is left out of `--running`, so `next` lists it in `restart`'), 'resume-live', 'restart')
  only(sk('call first, both `pause_requested` or not, through', 'call first, both through'), 'resume-live', 'no pause_requested')
  only(sk(' A room-stopped call (§ Room stop) is in-flight work: it counts as running in `--running`, and the drain resumes it at step 1.3 or 1.4 before `next` stamps `paused:`.', ''),
    'resume-live', 'no soft-pause sentence')
})

test('control: resumes before step 1.1, or no hold clause, fails git-env-hold', () => {
  only(sk('Nothing is resumed before the loop. After step 1.1, whose `gitEnvHold` halt resumes nothing, step 1.3', 'Before step 1.1, step 1.3'), 'git-env-hold', 'before step 1.1')
  only(sk(', whose `gitEnvHold` halt resumes nothing,', ','), 'git-env-hold', 'no hold clause')
})

test('control: each Lost call room-bullet part missing, or resumeFromRunId in it, fails lost-call-room', () => {
  only(sk('- While a room stop stands (§ Room stop;', '- When a room stop is signalled (§ Room stop;'), 'lost-call-room', 'no while')
  only(sk(' with a fresh once, which a resume before the stop does not use up,', ','), 'lost-call-room', 'no fresh once')
  only(sk('does not use up, at step 1.3 or 1.4.', 'does not use up.'), 'lost-call-room', 'no steps')
  only(sk('Once the room stop has ended, it takes the `Otherwise, once:` resume', 'Once the room stop has ended, it takes the `resumeFromRunId` resume (`Otherwise, once:`)'), 'lost-call-room', 'resumeFromRunId')
})

test('control: each usage-limit part missing fails usage-limit', () => {
  only(sk("from a Prompt's `hit its usage limit`, ", ''), 'usage-limit', 'no Prompt form')
  only(sk('are Lost calls the limit cut', 'are cut'), 'usage-limit', 'no Stage sentence')
  only(sk(' or `usage limit reached`', ''), 'usage-limit', 'no CLI form')
  only(sk('Lost calls the limit cut, each with or without a `Chorus: ` head.', 'Lost calls the limit cut, each after a `Chorus: ` head.'), 'usage-limit', 'Chorus only')
  only(sk('A row whose `blockerDiagnosis` contains `transient infrastructure failure`, from a call launched before that limit',
    'A row whose `blockerDiagnosis` starts `transient infrastructure failure`, from a call launched before that limit'), 'usage-limit', 'starts')
  only(sk('from a call launched before that limit, is never reconciled:', 'from a call launched before that limit, is reconciled, then'), 'usage-limit', 'reconciled')
  only(sk(', and each usage limit grants a fresh once.', '.'), 'usage-limit', 'no fresh once')
  only(sk(" A call the CLI's respawn ended with no row at all (a usage-limit or signed-out re-send opened the entry, and *Cold resume* finds it gone) gets the same fresh once.", ''),
    'usage-limit', 'no fresh once for a respawn-cut call')
})

test('control: a reconcile site that reconciles the row, or reads "starts", fails transient-routing', () => {
  only(sk(" except a row whose `blockerDiagnosis` contains `transient infrastructure failure` from a call launched before a usage limit this Session knows of: that row is never reconciled, whatever the check's exit; it goes to *Lost call* (*After a usage limit*) and its runId stays in this session's record. Otherwise",
    ''), 'transient-routing', 'step 2')
  only(sk('is the exception, as at step 2: it is never reconciled, writes no `## Integration log` line, keeps `integrating:` and the lane held, and goes to *Lost call*, unless',
    'is reconciled like any row, and goes to *Lost call*, unless'), 'transient-routing', 'integrate return')
  only(sk(', or a transient row after a usage limit (*After a usage limit*, below), or which', ', or which'), 'transient-routing', 'definition')
  only(sk('except a row whose `blockerDiagnosis` contains `transient', 'except a row whose `blockerDiagnosis` starts `transient'), 'transient-routing', 'starts')
})

test('control: a runId alone as a handle, or a lost integrate handle kept, fails lost-handle', () => {
  const sec = section(real.skill, ROOM)
  only({ skill: real.skill.replace(sec, sec.replace('; a runId alone is never a handle', '').replace('A runId alone is never a handle, and args', 'Args')) }, 'lost-handle', 'section')
  only(sk(', with the `scriptPath` and args it launched with (a runId alone is never a handle, § Room stop) → *Lost call*', ' → *Lost call*'), 'lost-handle', 'Restart routing')
  only(sk('An integrate call whose handle is lost frees the lane (`free-lane --tasks <slug>`), and its task re-enters through step 1.4 and `prepare`.',
    'An integrate call whose handle is lost keeps the lane.'), 'lost-handle', 'integrate handle')
})

test('control: clause (2) without stands, before paused:, without its § 2.7 skip, without a re-marking relaunch, or a d3 bound fails bound', () => {
  only(sk('step-boundary.py stands --rollout <the rollout note', 'step-boundary.py check --rollout <the rollout note'), 'bound', 'no stands')
  only(sk(hbLine, hbLine.replace(C2, '').replace('(2) If the rollout note', C2.trim() + ' (2) If the rollout note')), 'bound', 'before paused:')
  only(sk(' (this re-entry skips § 2.7, as the stall re-entry\'s does)', ''), 'bound', 'no § 2.7 skip')
  only(sk(': first run `step-boundary.py mark` again, on the same state file, over each call this session launched that /workflows still lists in flight and that it has not stopped (with none, relaunch nothing), so the watch never stops an agent that started after the old mark, then the watch in the background', ''),
    'bound', 'no relaunch')
  only(sk('first run `step-boundary.py mark` again, on the same state file, over each call this session launched that /workflows still lists in flight and that it has not stopped (with none, relaunch nothing), so the watch never stops an agent that started after the old mark, then the watch in the background',
    'relaunch the watch in the background on the same state file'), 'bound', 'no re-mark')
  only(sk("6 h is the Stage's horizon for an owed resume: Chorus's `OWED_MAX_S` (21600 s) is the boot cut past which `room_owed` arms are not re-derived. Chorus ADR 0071 d3's same-Login wait applies only to a 5-hour reset about 30 minutes away.",
    "6 h outlasts d3's 5-hour wait."), 'bound', 'd3 bound')
})

test('control: step 1.2 without its pointer fails step12-pointer', () => {
  only(sk(' A transient row after a usage limit this Session knows of never reaches this retry: *Lost call* resumes it first (*After a usage limit*).', ''), 'step12-pointer', 'no pointer')
})

test('control: § 8 without its room-stop bullet fails guardrail', () => {
  const l = real.skill.split('\n').find((x) => x.startsWith('- **A room stop ends `waiting`'))
  only(sk(l + '\n', ''), 'guardrail', 'no bullet')
})

test("control: no room-signal Don't, or a kill Don't that misses killall, fails donts", () => {
  const l = real.skill.split('\n').find((x) => x.startsWith('- On a Chorus room signal'))
  only(sk(l + '\n', ''), 'donts', 'no room Don\'t')
  only(sk('(`pkill`, `killall`, `kill $(pgrep …)`)', '(`pkill`, `kill $(pgrep …)`)'), 'donts', 'no killall')
})

test('control: a handoff gate that still hands off on the Stage fails handoff', () => {
  only({ handoff: edit(real.handoff, "On the Chorus Stage a Login at its line is never a handoff: execute § Room stop\nstops the rollout's calls at a step boundary and the Stage moves the Session\n(Chorus ADR 0071); off the Stage a handoff stays the way to continue.\n", '') },
    'handoff', 'no Stage sentence')
})

test('control: repair without its pointer, or naming resumeFromRunId, fails repair', () => {
  only({ repair: edit(real.repair, " When the limit is known to the lead's Session,\nexecute § 4.5 *Lost call* first resumes such a transient row once from its own run, so only that resume's row, or\nthe dead call's row, reaches this class.", '') },
    'repair', 'no pointer')
  only({ repair: edit(real.repair, 'first resumes such a transient row once from its own run', 'first resumes such a transient row once by `resumeFromRunId`') }, 'repair', 'resumeFromRunId')
})

test('control: CONTEXT without the term, its span or Chorus\'s word fails context', () => {
  only({ context: edit(real.context, '- **Room stop** —', '- **Room halt** —') }, 'context', 'no term')
  only({ context: edit(real.context, 'from\n  its `## Pause log` line to `room stop ended`', 'while\n  the Login is at its line') }, 'context', 'no span')
  only({ context: edit(real.context, ' (Chorus\'s signal calls it "a drain, not a pause"; here the\n  soft pause is the drain)', '') }, 'context', 'no Chorus word')
})

test('control: the `room stop ended` qualifier put back on the Cold resume read fails live-check', () => {
  only(sk('At every *Cold resume*, whether or not a room stop stood, a call this session believed live',
    'When `end` printed `room stop ended`, a call this session believed live'), 'live-check', 'qualifier back')
  only(sk(' Any other integrate call that holds the lane with no reconciled row is a *Lost call* (one *Cold resume* found gone, or one a git-env hold left): after step 1.1 it is resumed first the same way, with *Lost call*\'s once in place of the room stop\'s fresh one (*After a usage limit* says when that once is fresh too).', ''),
    'live-check', 'no step 1.4 path for a lost integrate call')
})

test('control: a tripped integrate return kept for a Lost call resume, or the old contradiction, fails integrate-trip', () => {
  only(sk("its runId is dropped too, so nothing resumes that call (not *Lost call*, heartbeat clause (3) or step 1.4), and the lane frees while the note keeps `integrating:`. After the ack, step 1.4 takes the task through step 3's `prepare`",
    'it keeps its runId and the lane across the halt, and after the ack step 1.4 resumes it first, with no `prepare`'), 'integrate-trip', 'choice (a)')
  only(sk(', and goes to *Lost call*, unless its check tripped (below).', ', and goes to *Lost call*.'), 'integrate-trip', 'contradiction back')
  only(sk('An error, or no row, after a check that exited 0: *Lost call*', 'An error, or no row: *Lost call*'), 'integrate-trip', 'error case unqualified')
  only(sk(" An integrate call whose return's canary `check` tripped is never room-stopped: the trip wins (§ 4.5 step 3).", ''), 'integrate-trip', 'item 6')
  only(sk(' At the integrate check, a return that reconciled no row (a transient row, an error, or no row) also drops its runId, so no *Lost call* resume ever races `prepare` for the lane (step 3).', ''),
    'integrate-trip', 'lane-free rule')
})

const stat = (from, to) => ({ status: wsEdit(real.status, from, to) })
test('control: status with no stands read, no ROOM STOP headline, a resume under the stop, or no lapse fails status', () => {
  only(stat('python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/step-boundary.py stands --rollout <rollout-note>', 'true'), 'status', 'no read')
  only(stat("`ROOM STOP since <stamp>: awaiting the Stage's resume` or `room stop since <stamp> lapsed: the owner's heartbeat re-enters` (§ 2's *Room stop*, exit 0 or 4),", ''),
    'status', 'no headline')
  only(stat('A room stop, standing or lapsed, is one while its owner session is alive, whatever its tasks read and whatever `/workflows` shows, even when no task reads running or integrating (§ 4\'s *Room stop*): a standing one → "wait for the Stage\'s resume", never `/thread:execute`, which would end the room stop on a Login still at its line; a lapsed one waits for the owner\'s heartbeat. Otherwise check',
    'Check'), 'status', 'action 10 resumes')
  // Round 2's gap: action 10 matching only a room stop with a running or integrating task leaves an all-awaiting room
  // stop to action 12's resume.
  only(stat('whatever its tasks read and whatever `/workflows` shows, even when no task reads running or integrating (§ 4\'s *Room stop*): a standing one',
    'whatever `/workflows` shows (§ 4\'s *Room stop*): a standing one'), 'status', 'action 10 needs a running task')
  only(stat('A room stop, standing or lapsed, whose owner session is alive is a live lead whatever its tasks read (§ 4\'s *Room stop*): action 10 matches it first, so this resume never runs under one; a standing one waits for the Stage\'s resume, a lapsed one for the owner\'s heartbeat.', ''),
    'status', 'action 12 gate removed')
  only(stat('Under a room stop, standing or lapsed (§ 4\'s *Room stop*), "no run" is no evidence while its owner session is alive: a standing one waits for the Stage\'s resume, which drains it, and a lapsed one for the owner\'s heartbeat, whose *Cold resume* drains it; never `/thread:execute`.',
    'Under a standing room stop (§ 4\'s *Room stop*), "no run" is no evidence while its owner session is alive: wait for the Stage\'s resume, which drains it, never `/thread:execute`.'),
  'status', 'action 9 without the lapsed stop')
  only(stat('the room stop is a live queue whatever its tasks read and whatever `/workflows` shows: action 10 matches it ahead of drift and every resume (11 to 13), and',
    'it is a live queue whatever `/workflows` shows, and'), 'status', 'room paragraph reads the tasks')
  only(stat(' A room stop needs no override either: while its owner session is alive it is a live queue (10) whatever its tasks read, so it waits ahead of drift and every resume (11 to 13), a drain under it waits too (9), and only an open escalation (7) and a stamped pause\'s reinstate (8) come before it.', ''),
    'status', 'Precedence silent on the room stop')
  only(stat(', or a room stop, standing or lapsed, whatever its tasks read (*Room stop* above).', '.'), 'status', 'owner-session qualifier')
  only(stat('never `/thread:execute` from here', '`/thread:execute` once its owner session shows no run'), 'status', 'room paragraph resumes')
  only(stat("the owner session's heartbeat re-enters *Cold resume* on its next tick", 'nothing re-enters it'), 'status', 'no lapse')
  only(stat(', and never under a room stop, standing or lapsed, while its owner session is alive, whatever `/workflows` shows and whatever its tasks read (§ 4\'s *Room stop*), a stamped pause\'s reinstate excepted (action 8)', ''), 'status', "Don'ts")
  only(stat('Under either, once the owner session has ended (the owner-session qualifier), nothing owes the resume and the room stop is no live queue: action 10\'s or 12\'s resume applies as usual, and that *Cold resume* ends it.', ''),
    'status', 'a dead owner waited on forever')
})

test('control: repair that reads a room stop as no lead live, or a hand-off that never ends it, fails repair-live', () => {
  only({ repair: wsEdit(real.repair, "A room stop, standing or lapsed (the scan's `ROOM STOP since <stamp>` or `room stop since <stamp> lapsed` headline, status § 4's *Room stop*), is a live queue too while its owner session has not ended, even with no run there and whatever its tasks read", 'A room stop') },
    'repair-live', 'live queue')
  only({ repair: wsEdit(real.repair, "A room stop, standing or lapsed (the scan's `ROOM STOP since <stamp>` or `room stop since <stamp> lapsed` headline,", "A standing room stop (the scan's `ROOM STOP since <stamp>` headline,") },
    'repair-live', 'live queue without the lapsed form')
  only({ repair: wsEdit(real.repair, '(or shows no run there, under no room-stop headline, neither the standing `ROOM STOP since <stamp>` nor the lapsed `room stop since <stamp> lapsed`):', '(or shows no run there):') },
    'repair-live', 'no lead live')
  // Round 2's gap: excluding only the upper-case standing headline lets a lapsed stop with its owner alive take the
  // full flow, whose hand-off runs `--running ""` fresh calls beside the owner heartbeat's resume.
  only({ repair: wsEdit(real.repair, 'under no room-stop headline, neither the standing `ROOM STOP since <stamp>` nor the lapsed `room stop since <stamp> lapsed`): the full flow', 'under no `ROOM STOP` headline): the full flow') },
    'repair-live', 'no lead live without the lapsed form')
  only({ repair: wsEdit(real.repair, '(every owner session has ended, or shows no run there under no room-stop headline, neither the standing `ROOM STOP since <stamp>` nor the lapsed `room stop since <stamp> lapsed`,', '(every owner session has ended or shows no run there,') },
    'repair-live', 'lead-held notes')
  only({ repair: wsEdit(real.repair, 'under no room-stop headline, neither the standing `ROOM STOP since <stamp>` nor the lapsed `room stop since <stamp> lapsed`, a drain', 'under no `ROOM STOP` headline, a drain') },
    'repair-live', 'lead-held notes without the lapsed form')
  only({ repair: wsEdit(real.repair, '(the owner check below, under which a room stop counts as live)', '(the owner check below)') }, 'repair-live', 'drain owner check')
  only({ repair: wsEdit(real.repair, "then `python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/step-boundary.py end --rollout <rollout-note>` (execute § Room stop: every loop entry ends a room stop, here one an ended owner session left, lapsed or not; with none standing it writes nothing, and a non-zero exit is printed and the hand-off goes on),", '') },
    'repair-live', 'hand-off never ends it')
  only({ repair: wsEdit(real.repair, 'here one an ended owner session left, lapsed or not;', 'here a lapsed one an ended owner session left;') }, 'repair-live', 'hand-off names only a lapsed stop')
})

test(`the rules are all named (${RULES.length}) and each has a control`, () => {
  assert.deepEqual(RULES.filter((r) => !CONTROLLED.has(r)), [])
})
