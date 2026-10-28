// p29-7 (ADR 0048): no single cause holds the whole queue, and a stall no hold explains is caught from outside the
// session. Text only: execute SKILL.md, status and repair SKILL.md, reconcile-rollout.py's and lead-integrate.py's
// source text, merge-task.sh and the ADRs. Each rule has a control that mutates the real text in one place and must
// fail with exactly that rule.
//   s7            § 7 states ADR 0048's rule, lists the kept and narrowed halts and hands a stop that is no halt to the
//                 Watchdog, never a second lead
//   kept          each kept `reason="…"` matches WHOLE_HALT_PATTERNS (or a LIVE_WHOLE_REASONS prefix), and each pattern
//                 and prefix matches a kept reason
//   narrowed      each narrowed site routes to a Set aside, a Lane hold or the Race log, never § 7
//   lane-hold     the *Lane hold* paragraph: its four causes, its one write, no free-lane, the session's own lane freed
//                 too, carry's refusal, the unreadable note, the soft pause, its own failure's route (an `engine-snapshot:`
//                 re-run, else § 7 kept whole); no `prepare-env` anywhere
//   needs-you     § 6.5 (c) carries `autoRetryError`, and (h) exists
//   merge-task    merge-task.sh's exit-2 header has three cases, and exactly four `merge-task args:` exits
//   task-scoped   lead-integrate.py raises TaskScoped at exactly the six task-scoped texts
//   moving-doc    the docstring's `moving` paragraph: sign-off before paused, regenerate before stall-after, paused in
//                 12(b) only on `halt: paused`
//   wait-clauses  step 1.5's *The wait clauses (ADR 0048)*: its arms, its four clauses in order, never § 7, an
//                 UNVERIFIED task included, the arm's item pushed; no UNVERIFIED exception on the cool-down; § 7's
//                 bullets name the clauses
//   exit2         *lead-integrate's exit 2*: its routes in order, § 7's bullet, step 3's exit 2, the marker raised
//                 twice, the no-flag clause at four sites
//   watchdog      status § The Watchdog's reading: the verb, the verdicts, the bounds, the safety wording, *Which waits
//                 silence judges* bound to SILENCE_JUDGED, the fallback's probe and *The interim gap*
//   reason-table  its table covers every `reason="…"` of steps 1.5 and 1.6, *Merge hold*, *Lane hold*, *lead-integrate's
//                 exit 2* and § Room stop item 8
//   repair-adrs   repair § 3g writes `lane-ack`; ADR 0048 says how p29-7 built it; ADRs 0033 and 0030 are amended
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { read, collapse, walk } from '../lib/contract-text.mjs'

const FILES = {
  execute: read('skills/execute/SKILL.md'),
  status: read('skills/status/SKILL.md'),
  repair: read('skills/repair/SKILL.md'),
  rr: read('skills/execute/scripts/reconcile-rollout.py'),
  li: read('skills/execute/scripts/lead-integrate.py'),
  mt: read('skills/execute/scripts/merge-task.sh'),
  adr48: read('docs/adr/0048-no-single-cause-holds-the-whole-queue.md'),
  adr33: read('docs/adr/0033-execute-retries-agent-fixable-set-asides.md'),
  adr30: read('docs/adr/0030-a-rollout-is-a-queue-that-integrates-at-merge.md'),
}
const RULES = ['s7', 'kept', 'narrowed', 'lane-hold', 'needs-you', 'merge-task', 'task-scoped', 'moving-doc', 'wait-clauses',
  'exit2', 'watchdog', 'reason-table', 'repair-adrs']

// The slice of `text` from the line matching `start` to the next line matching `stop`, or ''.
function section(text, start, stop) {
  const lines = text.split('\n')
  const i = lines.findIndex((l) => start.test(l))
  if (i < 0) return ''
  const j = lines.findIndex((l, k) => k > i && stop.test(l))
  return lines.slice(i, j < 0 ? undefined : j).join('\n')
}
const line = (text, prefix) => text.split('\n').find((l) => l.startsWith(prefix)) ?? ''
const reasons = (text) => [...text.matchAll(/reason="([^"]*)"/g)].map((m) => m[1])
// A Python tuple of string literals, `NAME = (...)` on one line or `NAME = (` … `)` over several: its strings, raw or not.
const pyTuple = (src, name) => {
  const lines = src.split('\n')
  const i = lines.findIndex((l) => l.startsWith(`${name} = (`))
  if (i < 0) return []
  let body = lines[i]
  if (!/\)\s*(#.*)?$/.test(body)) {
    const j = lines.findIndex((l, k) => k > i && l === ')')
    body = lines.slice(i, j + 1).join('\n')
  }
  return [...body.matchAll(/r?"((?:[^"\\]|\\.)*)"/g)].map((x) => x[1])
}
const before = (text, a, b) => text.includes(a) && text.includes(b) && text.indexOf(a) < text.indexOf(b)

function check(f) {
  const fails = []
  const fail = (rule, bad) => { if (bad && !fails.includes(rule)) fails.push(rule) }
  const ex = f.execute
  const s7raw = section(ex, /^### 7\. /, /^### 8\. /)
  const s7 = collapse(s7raw)
  const kept = collapse(section(s7raw, /^\*\*Whole-rollout halts kept \(ADR 0048\)\.\*\*/, /^The end-of-run verdicts|^\*\*Narrowed/))
  const narrowedL = collapse(section(s7raw, /^\*\*Narrowed \(ADR 0048\)\.\*\*/, /^A stop that is not a halt/))
  const s45raw = section(ex, /^### 4\.5\. /, /^### 5\. /)
  const laneP = collapse(line(ex, '**Lane hold (ADR 0048).**'))
  const exit2P = collapse(section(ex, /^\*\*lead-integrate's exit 2 \(ADR 0048\)\.\*\*/, /^\*\*The loop\*\*/))
  const s15 = collapse(line(ex, '   5. **Halt guard (last).**'))
  const waitP = collapse(line(ex, '   **The wait clauses (ADR 0048).**'))
  const s16 = collapse(line(ex, '   6. End the turn `waiting`'))
  const s12 = collapse(line(ex, '   2. **Standing approval (ADR 0034), first.**'))
  const s3 = collapse(section(ex, /^### 3\. Resolve effective config/, /^### 3\.5\./))
  const step3raw = section(s45raw, /^3\. \*\*Integrate one task\.\*\*/, /^4\. \*\*Merge it\.\*\*/)
  const step4raw = section(s45raw, /^4\. \*\*Merge it\.\*\*/, /^   \*\*RACE procedure\*\*/)
  const raceP = collapse(line(ex, '   **RACE procedure**'))
  const c65 = collapse(line(ex, '- (c) **A set-aside only a person moves on**'))
  const h65 = collapse(line(ex, '- (h) **An unacked Lane hold**'))
  const restart = collapse(line(ex, '- else `lead-integrate.py inputs --note <task note> --max-review-rounds <N>'))
  const bullet7 = (prefix) => collapse(s7raw.split('\n').find((l) => l.startsWith(prefix)) ?? '')

  // s7
  fail('s7', !s7.includes('**No single cause holds the whole queue (ADR 0048).** A cause that threatens one task sets that task aside; one that threatens merging holds the Integration lane') ||
    !s7.includes('A task waiting on Lachy is set aside, never a held queue, and the rest runs on.') ||
    !s7.includes('**Whole-rollout halts kept (ADR 0048).**') || !s7.includes('**Narrowed (ADR 0048).**') ||
    !s7.includes('it is the Watchdog\'s to catch (§ 8 *The Watchdog*; status § The Watchdog\'s reading), and its `stalled` never by itself starts a second lead') ||
    !bullet7('- `next` reports `halt: lane`').includes('`reason="lane held: <cause> on [[task]]"`'))

  // kept
  const stem = 'rollout'
  const patterns = pyTuple(f.rr, 'WHOLE_HALT_PATTERNS').map((p) => new RegExp('^' + p.replace(/\\\\/g, '\\').replace('{rollout}', stem)))
  const live = pyTuple(f.rr, 'LIVE_WHOLE_REASONS')
  const keptReasons = reasons(kept)
  fail('kept', patterns.length < 20 || live.length !== 2 || keptReasons.length < 25 ||
    !keptReasons.every((r) => patterns.some((p) => p.test(r)) || live.some((l) => r.startsWith(l))) ||
    !patterns.every((p) => keptReasons.some((r) => p.test(r))) || !live.every((l) => keptReasons.some((r) => r.startsWith(l))) ||
    !kept.includes('`reason="lead-integrate.py failed on [[task]]"`, kept for two causes'))

  // narrowed
  const row = (code) => collapse(step4raw.split('\n').find((l) => l.startsWith(`   | ${code} |`)) ?? '')
  const st3 = collapse(step3raw)
  const exit2Bullet = collapse(step3raw.split('\n').find((l) => l.startsWith('   - **exit 2**')) ?? '')
  const exit8Bullet = collapse(step3raw.split('\n').find((l) => l.startsWith('   - **exit 8**')) ?? '')
  const exit1Bullet = collapse(step3raw.split('\n').find((l) => l.startsWith('   - **exit 1**')) ?? '')
  const noslot = collapse(step3raw.split('\n').find((l) => l.startsWith('     - `noslot` (exit 75')) ?? '')
  fail('narrowed', !row(70).includes('The *Lane hold* (`--cause merge-task-abort`') || /\bHalt\b|§ 7/.test(row(70)) ||
    !row(2).includes('When it starts `ERROR: merge-task args:`') || !row(2).includes('*Set aside* at its own run (`--kind own`)') ||
    !row(2).includes('the *Lane hold* (`--cause merge-task-env`') || /\bHalt\b/.test(row(2)) ||
    !row('143 / 130 / 129, or a missing sentinel').includes('`merge-task signalled twice (<code>): <its last line>`, which retries as `infra`') ||
    !exit2Bullet.includes('the *Lane hold* (`--cause integrate-env`') || /halt \(§ 7\)/.test(exit2Bullet) ||
    !exit8Bullet.includes('`prepare: origin unreachable three times: <its stderr line>`, which retries as `infra`') || exit8Bullet.includes('halts') ||
    !exit1Bullet.includes('`prepare refused twice: no integrating: after mark-integrating`') || exit1Bullet.includes('halts') ||
    !noslot.includes('then the *Lane hold* (`--cause verify-noslot`') || noslot.includes('then halt') ||
    !raceP.includes('a third consecutive `noslot` appends `- <now> [[<slug>]] re-verify not run: no verify slot in 3 tries; the RACE waits for you`') ||
    !s3.includes('A **task-level** value threatens only that task (ADR 0048): the lead writes its own *Set aside* row at its run (`--kind own`') ||
    !st3.includes('a failure that threatens only this task (ADR 0048') ||
    !narrowedL.includes('to a *Lane hold* (§ 4.5)') || !narrowedL.includes('to a *Set aside*') || !narrowedL.includes('to the `## Race log`'))

  // lane-hold
  const causes = pyTuple(f.rr, 'LANE_HOLD_CAUSES')
  const prepareEnv = ['skills', 'docs', 'tests'].flatMap((d) => walk(d)).filter((p) => /\.(md|py|sh|mjs|js)$/.test(p) && p !== 'tests/contracts/no-single-cause.test.mjs')
    .some((p) => read(p).includes('prepare' + '-env'))
  fail('lane-hold', JSON.stringify(causes) !== JSON.stringify(['merge-task-abort', 'merge-task-env', 'integrate-env', 'verify-noslot']) ||
    !causes.every((c) => laneP.includes(`\`${c}\``)) ||
    !laneP.includes('reconcile-rollout.py lane-hold --rollout <rollout-note> --tasks <slug> --cause <cause>') ||
    !laneP.includes('so no `free-lane` follows it') || !laneP.includes('`/thread:repair` (its lane-hold step, 3g)') ||
    !laneP.includes('on its exit 0 the lead frees the lane (this session\'s state) too, as *The lane-free rule* does') ||
    !laneP.includes('`carry` refuses the rollout until then') ||
    !laneP.includes('one that cannot (`lead-integrate.py`\'s `task note unreadable:`) is out of `next`\'s scan, so the task shows only through `laneHold` and § 6.5 (h)') ||
    !laneP.includes('A `pause_requested` behind a lane verdict never drains, because the note keeps `integrating:`. Step 1.2 is skipped, so no wait clause holds, and the lane arm goes to § 7 `lane held:`. After the ack the held task integrates (a soft pause lets Integration carry on), and the pause drains after it.') ||
    !laneP.includes('*When `lane-hold` itself fails*') ||
    !laneP.includes('a stderr line starting `engine-snapshot:` → re-run it from the root it names (§ 1.5); any other non-zero exit') ||
    !laneP.includes('→ § 7 with `reason="lane hold not written on [[<slug>]]: <its ERROR line>"`, kept whole: the rollout note every task shares cannot carry the hold.') ||
    prepareEnv)

  // needs-you
  fail('needs-you', !c65.includes('a non-empty `autoRetryError` is (c) too, through its `humanFix` H12 (ADR 0048: no halt)') ||
    !h65.includes('`[[<rollout>]] lane held by <cause> (<the stamp of the first unacked lane hold line>): decide with /thread:repair [[<rollout>]]`') ||
    !h65.includes('on every turn, whatever the halt'))

  // merge-task
  const mtHead = collapse(f.mt.split('\n').slice(0, 120).map((l) => l.replace(/^#\s?/, '')).join('\n'))
  fail('merge-task', (f.mt.match(/finish 2 "ERROR: merge-task args: /g) ?? []).length !== 4 ||
    !mtHead.includes('`engine-snapshot:` → re-run from the root it names') ||
    !mtHead.includes('`ERROR: merge-task args:`') || !mtHead.includes('→ set this task aside at its own run') ||
    !mtHead.includes('hold the Integration lane for a human') || !mtHead.includes("A revert PR's 2 still halts the rollout") ||
    !mtHead.includes("A revert PR's 70 still halts the rollout"))

  // task-scoped
  const scoped = [...f.li.matchAll(/raise TaskScoped\(f?"([^"]*)"/g)].map((m) => m[1].split('{')[0].trim())
  fail('task-scoped', JSON.stringify(scoped) !== JSON.stringify(['ANCHOR_RECIPE gave no anchor for', 'could not abort the merge left in progress in',
    'tracked changes in', 'could not delete the stale anchor ref refs/integration-anchor/', 'the anchor ref for', 'no merge-base of the anchor']) ||
    !f.li.includes('except TaskScoped as e:') || !f.li.includes('out.update(route="set-aside", reason=str(e))'))

  // moving-doc
  const mdoc = collapse(section(f.rr, /^  moving      The Watchdog's reading/, /^Run record \(p15-2/))
  const step11 = mdoc.slice(mdoc.indexOf('11. With W:'), mdoc.indexOf('12. With no W:'))
  const step12b = mdoc.slice(mdoc.indexOf('(b) the waits judged by their own condition'), mdoc.indexOf('(c) otherwise waiting `you`'))
  fail('moving-doc', !before(mdoc, 'waiting `sign-off` when `paused_for: sign-off`', 'waiting `paused` when _pause_stands') ||
    !before(step11, "`halt: regenerate` → waiting `regenerating`", 'then the silence test at stall-after') ||
    !step11.includes('regenerate is judged before the stall-after test and in its place, whatever else is in W') ||
    !step12b.includes('`paused` only when `next` reports `halt: paused`'))

  // wait-clauses
  const arms = ['the `git-env` arm (a lane entry)', 'the `race` arm', 'the `lane` arm', 'the `stuck` arm', "the `held` arm's task-scope route"]
  const clauses = ['(i) step 1.2 noted an `autoRetryAfter`', '(ii) step 1.2 held an `autoRevise: true` seeded revise for want of `slotLimit` while `next` reports `heat`',
    '(iii) it held one only for want of `slotLimit`', '(iv) for the `git-env`, `race` and `lane` arms only, a `holdUntil` entry with `held: true` and `waits: merge`']
  fail('wait-clauses', !arms.every((a) => waitP.includes(a)) || !clauses.every((c, i) => waitP.includes(c) && (i === 0 || before(waitP, clauses[i - 1], c))) ||
    !waitP.includes('ends the turn `waiting`, never § 7, whatever else is set aside, an UNVERIFIED task included') ||
    !waitP.includes("The arm's own item is still pushed on that turn") ||
    /no UNVERIFIED task among/.test(s15) || !s15.includes('An UNVERIFIED task among them never stops a cool-down (ADR 0048, amending ADR 0033)') ||
    !s15.includes('*the wait clauses* below are read first') ||
    !bullet7('- `next` reports `halt: race`').includes("step 1.5's *wait clauses* find no wait") ||
    !bullet7('- `next` reports `halt: stuck`').includes("step 1.5's *wait clauses* find no wait") ||
    !bullet7('- `next` reports `halt: held`').includes("a task-scope one only after step 1.5's *wait clauses*") ||
    !bullet7('- the git-env canary').includes('a lane hold once nothing else moves and the wait clauses find no wait') ||
    !bullet7('- `next` reports `halt: lane`').includes("step 1.5's *wait clauses* find no wait") ||
    !s16.includes("a wait clause's reason (step 1.5) comes first"))

  // exit2
  const order = ['whose stderr line starts `engine-snapshot:` is re-run once from the root it names', '- `revert` → § 7 with `reason="lead-integrate.py failed on [[slug]]"`',
    '- `verify` → no route of its own: the lead reads only `<out>.rc`', '- `undo` at a room stop', '- Any other verb on the task that holds the lane → the *Lane hold* with `--cause integrate-env`',
    '- A verb on a task that holds no lane', '- A line holding `task note unreadable:` is that task\'s alone', '- Anything else → § 7 with `reason="lead-integrate.py failed on [[slug]]"`, kept.']
  const leadBullet = bullet7('- `lead-integrate.py revert` exits 2')
  const noFlag = [s12.includes('(no `--max-review-rounds` when that value is invalid, § 3; an `inputs` or `plan` exit 2: *lead-integrate\'s exit 2*)'),
    restart.includes('(none when N is invalid, § 3; an exit 2: *lead-integrate\'s exit 2*)'),
    c65.includes('no `--max-review-rounds` when the task\'s value is invalid, § 3'),
    s3.includes('A task whose resolved `max_review_rounds` is invalid is read with no `--max-review-rounds` wherever `inputs` takes it')]
  fail('exit2', !order.every((o, i) => exit2P.includes(collapse(o)) && (i === 0 || before(exit2P, collapse(order[i - 1]), collapse(o)))) ||
    !leadBullet.includes('or a `lead-integrate.py` verb on a task that holds no lane exits 2 with neither an `engine-snapshot:` nor a `task note unreadable:` line') ||
    s7.includes('origin unreachable while integrating') ||
    !exit2Bullet.includes('the *Lane hold*') ||
    (f.li.match(/raise EnvError\(f"\{NOTE_UNREADABLE\} /g) ?? []).length !== 2 || !f.li.includes('NOTE_UNREADABLE = "task note unreadable:"') ||
    !noFlag.every(Boolean))

  // watchdog
  const wd = section(f.status, /^## The Watchdog's reading \(ADR 0048\)/, /^## Loopable/)
  const wdc = collapse(wd)
  const silenceJudged = pyTuple(f.rr, 'SILENCE_JUDGED')
  const group = (from, to) => collapse(section(wd, from, to))
  const bySilence = group(/^- judged by silence/, /^- judged by its own bound/)
  const byBound = group(/^- judged by its own bound/, /^- judged by a condition/)
  const never = group(/^- never judged by silence/, /^\*\*What `stalled` means/)
  const CAUSES = ['sign-off', 'paused', 'room-stop', 'not-started', 'merge-hold', 'regenerating', 'cool-down', 'heat', 'away-cap', 'trickle',
    'last-start', 'approved-queue', 'pr-hold', 'you']
  const named = (txt) => CAUSES.filter((c) => new RegExp('`' + c + '`').test(txt))
  fail('watchdog', !wdc.includes('reconcile-rollout.py moving --rollout <rollout-note>') ||
    !['`moving`', '`stalled`', '`waiting`', '`skip`'].every((v) => wdc.includes(v)) ||
    !wdc.includes('is **45** minutes') || !wdc.includes('is **120** minutes') ||
    !wdc.includes('The suggested Companion poll is every 5 minutes') || !wdc.includes("a halt stall's notice (the Stop hook's fresh halt line) can be delayed by up to the threshold") ||
    !wdc.includes('confirms that the Session has no running Turn') || !wdc.includes('the launchd fallback only notifies') ||
    /a live lead never reads/i.test(wdc) ||
    JSON.stringify(silenceJudged) !== JSON.stringify(['merge-hold', 'regenerating']) ||
    JSON.stringify(named(bySilence).sort()) !== JSON.stringify([...silenceJudged].sort()) ||
    JSON.stringify(named(byBound)) !== JSON.stringify(['room-stop']) ||
    !['paused', 'sign-off', 'not-started', 'you'].every((c) => named(never).includes(c)) ||
    !bySilence.includes('judged in place of stall-after whatever else runs beside it') ||
    !never.includes('A soft pause behind a lane verdict is not drained') ||
    !wdc.includes('***The interim gap*.**') || !wdc.includes('as Chorus\'s ctl.sh status does') ||
    /takes? (the )?(Stage's )?host\.lock/.test(wdc))

  // reason-table
  const table = wd.split('\n').filter((l) => l.startsWith('| ')).join('\n')
  const roomP = collapse(section(ex, /^## Room stop/, /^## Don'ts/).split('\n').find((l) => /^8\. /.test(l)) ?? '')
  const mergeHold = collapse(line(ex, '**Merge hold**'))
  const sources = [...reasons(s15), ...reasons(waitP), ...reasons(s16), ...reasons(mergeHold), ...reasons(exit2P), ...reasons(laneP), ...reasons(roomP)]
  fail('reason-table', sources.length < 20 || !sources.every((r) => table.includes(r)))

  // repair-adrs
  const g3 = collapse(section(f.repair, /^\*\*3g — a lane hold/, /^### 4\. /))
  fail('repair-adrs', !g3.includes('reconcile-rollout.py lane-ack --rollout <rollout-note> --tasks <the slugs shown> --fix') ||
    !g3.includes('A Companion (ADR 0048) may gather this evidence and notify Lachy, never ack') ||
    !f.adr48.includes('## How p29-7 built it') || !f.adr48.includes('Built by p29-7') ||
    !/\*\(Amended by ADR 0048, [^)]*an invalid round-budget stamp on a task sets that task aside \(H12\), never a halt/.test(f.adr33) ||
    !/\*\(Amended by ADR 0048, [^)]*merge-task's exit 70 and its environment exit 2/.test(f.adr30))

  return fails
}

test('the real tree holds every rule', () => {
  assert.deepEqual(check(FILES), [])
})

// ---- controls: each mutates the real text in one place and must fail with exactly its rule ---------

const CONTROLLED = new Set()
// The *Lane hold* paragraph's own failure route, whole (execute § 4.5), which its control drops.
const LANE_HOLD_FAILS = ' *When `lane-hold` itself fails*, no line lands, the lane stays held and the task keeps `integrating:`, so the next ' +
  'turn\'s step 1.4 would take it again and re-run the failing command (row 70\'s abort repeats): a stderr line starting ' +
  '`engine-snapshot:` → re-run it from the root it names (§ 1.5); any other non-zero exit (its exit 1: the rollout note ' +
  'unreadable or its save failed, the line missing on re-read, the task another rollout\'s, or an unreadable task note the ' +
  '`## Queue` does not link; its usage exit 2) → § 7 with `reason="lane hold not written on [[<slug>]]: <its ERROR line>"`, ' +
  'kept whole: the rollout note every task shares cannot carry the hold.'
function only(key, from, to, rule) {
  assert.equal(FILES[key].split(from).length, 2, `control setup: ${from.slice(0, 80)} must occur exactly once in ${key}`)
  assert.deepEqual(check({ ...FILES, [key]: FILES[key].replace(from, () => to) }), [rule])
  CONTROLLED.add(rule)
}

test('control: § 7 without its rule, or a kept halt dropped, fails s7 or kept', () => {
  only('execute', '**No single cause holds the whole queue (ADR 0048).** A cause', '**Scoped holds.** A cause', 's7')
  only('execute', 'and its `stalled` never by itself starts a second lead.', 'and the Watchdog restarts it.', 's7')
  only('execute', '`reason="ladder file refused"`.\n- *Protects', 'nothing else.\n- *Protects', 'kept')
  only('execute', '; `reason="git-env trip: the shared checkout changed"` for a bare checkout', '', 'kept')
})

test('control: a WHOLE_HALT_PATTERNS entry no kept reason matches fails kept', () => {
  only('rr', '    r"ladder file refused",\n', '    r"ladder file refused",\n    r"stuck forever",\n', 'kept')
})

test('control: a narrowed site routed back to § 7 fails narrowed', () => {
  only('execute', '   | 70 | The *Lane hold* (`--cause merge-task-abort`', '   | 70 | Halt (§ 7). The *Lane hold* (`--cause merge-task-abort`', 'narrowed')
  only('execute', 'then the *Lane hold* (`--cause verify-noslot`', 'then halt (`--cause verify-noslot`', 'narrowed')
  only('execute', 'a third failure is a *Set aside* at Integration (`--kind integration`), reason `prepare: origin unreachable three times',
    'a third failure halts, reason `prepare: origin unreachable three times', 'narrowed')
})

test('control: the Lane hold paragraph without a cause, its no-free-lane rule, its soft-pause sentence or its own failure\'s route, or a prepare-env, fails lane-hold', () => {
  only('execute', '`verify-noslot` (the Integration verify\'s third consecutive `noslot`, step 3)', 'a verify slot (step 3)', 'lane-hold')
  only('execute', 'so no `free-lane` follows it', 'then `free-lane`', 'lane-hold')
  only('execute', '; on its exit 0 the lead frees the lane (this session\'s state) too, as *The lane-free rule* does,', ',', 'lane-hold')
  only('execute', ', and `carry` refuses the rollout until then', '', 'lane-hold')
  only('execute', 'and the pause drains after it. Its release', 'and the pause never drains. Its release', 'lane-hold')
  only('rr', '"integrate-env", "verify-noslot")', '"prepare' + '-env", "verify-noslot")', 'lane-hold')
  only('execute', LANE_HOLD_FAILS, '', 'lane-hold')
})

test('control: (c) reading autoRetryError as a halt, or no (h), fails needs-you', () => {
  only('execute', 'a non-empty `autoRetryError` is (c) too, through its `humanFix` H12 (ADR 0048: no halt)', 'a non-empty `autoRetryError` is (e)', 'needs-you')
  only('execute', '- (h) **An unacked Lane hold**', '- **An unacked Lane hold**', 'needs-you')
})

test('control: a fifth merge-task args: exit, or the header without its routes, fails merge-task', () => {
  only('mt', 'finish 2 "ERROR: no \'origin\' remote in $REPO_PATH"', 'finish 2 "ERROR: merge-task args: no \'origin\' remote in $REPO_PATH"', 'merge-task')
  only('mt', "#      § 4.5 *Lane hold*). A revert PR's 2 still halts the rollout (it protects main).", '#      § 4.5 *Lane hold*).', 'merge-task')
})

test('control: an environment raise turned TaskScoped fails task-scoped', () => {
  only('li', 'raise EnvError(f"origin/{args.default} does not exist in {repo}")', 'raise TaskScoped(f"origin/{args.default} does not exist in {repo}")', 'task-scoped')
})

test('control: paused before sign-off, stall-after before regenerate, or 12(b) paused on any pause, fails moving-doc', () => {
  only('rr', '3. Pauses: waiting `sign-off` when `paused_for: sign-off` (checked first: await-sign-off stamps `paused:`\n                 with it); then waiting `paused` when _pause_stands',
    '3. Pauses: waiting `paused` when _pause_stands; then waiting `sign-off` when `paused_for: sign-off` (await-sign-off stamps `paused:`\n                 with it)', 'moving-doc')
  only('rr', 'regenerate is judged before the stall-after test and in its\n                  place, whatever else is in W', 'regenerate is judged after the stall-after test', 'moving-doc')
  only('rr', '`paused` only when `next`\n                  reports `halt: paused`', '`paused` under any pause', 'moving-doc')
})

test('control: an arm dropped, a clause dropped, or the UNVERIFIED exception re-inserted fails wait-clauses', () => {
  only('execute', ' the `lane` arm, the `stuck` arm,', ' the `stuck` arm,', 'wait-clauses')
  only('execute', ' (iii) it held one only for want of `slotLimit` → the Trickle\'s reason, or the Away cap\'s while Away;', '', 'wait-clauses')
  only('execute', 'A `stuck` while step 1.2 found an `autoRetryAfter` (a quota or infra cool-down) ends the turn',
    'A `stuck` while step 1.2 found an `autoRetryAfter` (a quota or infra cool-down), and no UNVERIFIED task among the set-aside entries, ends the turn', 'wait-clauses')
  only('execute', ', and step 1.5\'s *wait clauses* find no wait (an undecided RACE', ' (an undecided RACE', 'wait-clauses')
})

test('control: a lane-site exit 2 routed to § 7, or the marker clause dropped, fails exit2', () => {
  only('execute', '- Any other verb on the task that holds the lane → the *Lane hold* with `--cause integrate-env`',
    '- Any other verb on the task that holds the lane → § 7 with `--cause integrate-env`', 'exit2')
  only('execute', '  - A line holding `task note unreadable:` is that task\'s alone', '  - A line holding an unreadable note is that task\'s alone', 'exit2')
  only('li', 'raise EnvError(f"{NOTE_UNREADABLE} {e}")', 'raise EnvError(str(e))', 'exit2')
  only('execute', ' (none when N is invalid, § 3; an exit 2: *lead-integrate\'s exit 2*)', '', 'exit2')
})

test('control: an absolute live-lead claim, a silence list off SILENCE_JUDGED, or no interim gap, fails watchdog', () => {
  only('status', 'So `stalled` is a reason to look', 'So a live lead never reads `stalled`; it is a reason to look', 'watchdog')
  only('rr', 'SILENCE_JUDGED = ("merge-hold", "regenerating")', 'SILENCE_JUDGED = ("merge-hold",)', 'watchdog')
  only('status', '  - `merge-hold` (at `--stall-after`:', '  - `pr-hold`, and `merge-hold` (at `--stall-after`:', 'watchdog')
  only('status', '***The interim gap*.**', '**Meanwhile.**', 'watchdog')
  only('status', 'judged in place of stall-after whatever else runs beside it', 'judged beside stall-after', 'watchdog')
})

test('control: a reason the table leaves out fails reason-table', () => {
  only('status', '| `last start: held until the Morning at <trickle.morning>` | `waiting last-start` |\n', '', 'reason-table')
})

test('control: § 3g without lane-ack, or ADR 0048 without its build section, fails repair-adrs', () => {
  only('repair', 'reconcile-rollout.py lane-ack --rollout <rollout-note>', 'reconcile-rollout.py lane-acknowledge --rollout <rollout-note>', 'repair-adrs')
  only('adr48', '## How p29-7 built it', '## Notes', 'repair-adrs')
})

test('every rule has a control', () => {
  assert.deepEqual([...CONTROLLED].sort(), [...RULES].sort())
})
