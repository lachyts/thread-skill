// status and repair read a serial rollout (ADR 0040, p24-4): the prose around `leg.py status` and `leg.py restarted`
// (their behaviour is pinned by tests/leg.test.sh L13), close-score.py's serial path and serial-score.py (pinned by
// tests/reflect-close-score.test.mjs and tests/reflect-serial-score.test.mjs). One pure function, check(files), over
// { key: text }; each rule has a mutation control that fails exactly that rule. Phrase checks run on collapsed text.
//   s-route      status § 1's **Shape** sends `shape: serial` to § 5 instead of §§ 2–4;
//   s-read       § 5's one read is `leg.py status`, fenced, and § 5 names no other `.py` verb in a code span;
//   s-report     § 5's report: the headline, the Legs, the Queue groups (a set-aside with its `dependants`), the
//                footer of deferred and missing rows, the smoke list, Needs you, the Stall and the Restart;
//   s-order      § 5's recommended actions S1–S13 in order, one chain state each; S9 runs a Complete Leg from
//                `restart.cwd` or any folder but this plugin's own checkout;
//   r-route      repair § 1 scans a serial note through status § 5 and, after the Stops, sends it to § 7;
//   r-halt       § 7 (c): the halt's evidence, then `leg.py clear-halt` only on Lachy's word;
//   r-takeover   § 7 (d): `list_sessions` present stops, gone (or his word) takes over, else ask; (e)'s open-Leg
//                clause needs (d)'s evidence and the take-over prompt;
//   r-restart    § 7 (e) step 1: every `restart.blockedBy` value in order with its evidence, the "checks only"
//                sentence, and the steps re-read → `restarted --pending` → `create_thread` → `--started`, or the
//                manual handoff → `--manual`; never `leg.py begin`;
//   r-restarting § 7 (e) step 2's outcomes: a standing restart stops, a begun Leg stops, no session id stops;
//   r-setaside   § 7 (b): `approve-gates` on sign-off, a declined gate deferred, a hand-back recorded first;
//   r-defer      § 7 (b)'s Defer: the `dependants`, the chain-or-fix ask, one `defer` of the closure, a held
//                dependant never written, and no retire block or `## Notes` line;
//   r-scope      the description, `## Scope` and `## Native runtime binding` name the serial chain's verbs and host;
//   r-allow      every `.py` verb in § 7 is on the serial Don't's allow-list, and the Don't forbids the Leg verbs;
//   r-notes      § 7 writes no `## Notes` line by hand;
//   l-score      legs.md § Complete scores the chain through close-score.py and closes with its line, and the serial
//                template scores in the same place.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { collapse, read, section, FENCE } from '../lib/contract-text.mjs'

const FILES = {
  status: 'skills/status/SKILL.md',
  repair: 'skills/repair/SKILL.md',
  legs: 'skills/execute/legs.md',
  template: 'skills/schedule/serial-rollout-template.md',
}
const real = Object.fromEntries(Object.entries(FILES).map(([k, p]) => [k, read(p)]))
const C = (s) => collapse(s ?? '')

// `name.py verb` in a code span or a fenced line (status-repair-queue's invocations(), the .py part).
function pyVerbs(text) {
  const fenced = []
  const prose = []
  let inFence = false
  for (const l of (text ?? '').split('\n')) {
    if (FENCE.test(l)) { inFence = !inFence; continue }
    if (inFence) fenced.push(l)
    else prose.push(l)
  }
  const spans = [...fenced, ...[...prose.join('\n').matchAll(/`([^`]+)`/g)].map((m) => m[1])]
  const out = []
  for (const s of spans) for (const m of s.matchAll(/([\w-]+\.py)\s+([a-z][\w-]*)/g)) out.push(`${m[1]} ${m[2]}`)
  return out
}
// The lines from the first one matching `start` to the first later one matching `stop` (exclusive).
function between(text, start, stop) {
  const lines = (text ?? '').split('\n')
  const i = lines.findIndex((l) => start.test(l))
  if (i < 0) return ''
  const j = lines.findIndex((l, k) => k > i && stop.test(l))
  return lines.slice(i, j < 0 ? undefined : j).join('\n')
}
// A list item (its first line matching `start`) with its deeper-indented continuation lines.
function item(text, start) {
  const lines = (text ?? '').split('\n')
  const i = lines.findIndex((l) => start.test(l))
  if (i < 0) return ''
  const indent = lines[i].match(/^\s*/)[0].length
  let j = i + 1
  while (j < lines.length && lines[j].trim() && lines[j].match(/^\s*/)[0].length > indent) j++
  return lines.slice(i, j).join('\n')
}
const S_STATES = [['complete'], ['dropped', 'superseded'], ['incomplete'], ['paused'], ['halted'], ['restarting'], ['live'],
  ['awaiting-successor'], ['completable'], ['stopped'], ['stalled'], ['stuck'], ['not-started', 'ready']]
const BLOCKERS = [/^`halt` → never: \(c\) first\.$/, /^`open Leg K \(session <id>\)` → /, /^`handover started <X>` → /, /^`restart Leg N \(<how>\)` → /,
  /^null → by `chain`: /, /^Anything else → report it, and stop\.$/]
const LEG_VERBS = ['begin', 'claim', 'done', 'close', 'set-aside', 'smoke', 'file-fix', 'handed', 'file-followup']

function check(f) {
  const fails = new Set()
  const details = []
  const flag = (rule, why) => { fails.add(rule); details.push(`${rule}: ${why}`) }
  const need = (rule, name, text, patterns) => {
    for (const p of patterns) {
      const ok = typeof p === 'string' ? C(text).includes(p) : p.test(C(text))
      if (!ok) flag(rule, `${name} does not contain ${p}`)
    }
  }

  // ---- status ----
  const s1 = section(f.status, /^### 1\. /) ?? ''
  need('s-route', 'status § 1', s1, ['**Shape.**', '`shape: serial` → § 5 instead of §§ 2–4'])
  const s5 = section(f.status, /^### 5\. A serial chain$/) ?? ''
  if (!s5) flag('s-read', 'status has no § 5')
  if (!s5.split('\n').some((l) => l.trim() === 'python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/leg.py status --rollout <rollout-note>')) {
    flag('s-read', '§ 5 does not run leg.py status, fenced')
  }
  const verbs = pyVerbs(s5)
  if (!verbs.length || verbs.some((v) => v !== 'leg.py status')) flag('s-read', `§ 5 names ${verbs.join(', ')}`)
  need('s-report', 'status § 5', s5, ['**Headline.**', '**Legs.**', '**Queue.**', '**Done**', '**Claimed**', '**Queued**', '**Set aside**',
    'and its `dependants`', 'Outside the count', 'each `deferred` row', "each `missing` one", '**Smoke list.**', '**Needs you.**',
    '`needsYou`, verbatim', '**Stall.**', '`stall.why`', '**Restart.**', '"blocked by `<restart.blockedBy>`"'])
  const acts = s5.split('\n').filter((l) => /^- S\d+ /.test(l)).map((l) => item(s5, new RegExp(`^${l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)))
  const nums = acts.map((a) => Number(a.match(/^- S(\d+) /)[1]))
  if (JSON.stringify(nums) !== JSON.stringify(S_STATES.map((_s, i) => i + 1))) flag('s-order', `§ 5's actions are S${nums.join(', S')}`)
  acts.forEach((a, i) => {
    const head = a.split('→')[0]
    const named = [...head.matchAll(/`([a-z-]+)`/g)].map((m) => m[1])
    if (JSON.stringify(named) !== JSON.stringify(S_STATES[i] ?? [])) flag('s-order', `S${i + 1} names ${named.join(', ')}`)
  })
  const s9 = C(acts[8])
  if (!s9.includes('`restart.cwd` (the last Leg\'s folder)') || !s9.includes('any folder but this plugin\'s own checkout') ||
    !s9.includes('a Complete Leg works no row')) flag('s-order', `S9 is ${s9}`)
  for (const k of [4, 10, 11]) if (!C(acts[k]).includes('`/thread:repair [[<rollout>]]`')) flag('s-order', `S${k + 1} does not route to repair`)
  if (!C(acts[6]).includes('check that session first')) flag('s-order', 'S7 does not check the session first')

  // ---- repair ----
  const r1 = section(f.repair, /^### 1\. /) ?? ''
  need('r-route', 'repair § 1', r1, ["On a `shape: serial` note the scan is status § 5's `leg.py status` instead, with no live cross-check"])
  const lines = r1.split('\n')
  const iStops = lines.findIndex((l) => l.startsWith('**Stops**'))
  const iSerial = lines.findIndex((l) => l.startsWith('**A serial chain.**'))
  const iModes = lines.findIndex((l) => l.startsWith('Then one of three modes holds'))
  if (!(iStops >= 0 && iSerial > iStops && iModes > iSerial)) flag('r-route', `the serial paragraph is not between the Stops and the modes: ${iStops}, ${iSerial}, ${iModes}`)
  need('r-route', 'repair § 1 **A serial chain.**', between(r1, /^\*\*A serial chain\.\*\*/, /^$/), ['After the Stops',
    'goes to § 7, instead of the modes below and §§ 2–6'])

  const r7 = section(f.repair, /^### 7\. A serial chain$/) ?? ''
  const part = (label, stop) => between(r7, new RegExp(`^\\*\\*\\(${label}\\)`), stop)
  const b = part('b', /^\*\*\(c\)/)
  const c = part('c', /^\*\*\(d\)/)
  const d = part('d', /^\*\*\(e\)/)
  const e = part('e', /^§ 7 writes no/)
  need('r-halt', '§ 7 (c)', c, ['`closed: halted:`', '`## Blocker diagnosis`', '`git -C <top> status --porcelain`', 'Ask. Only on his word:',
    '`python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/leg.py clear-halt --rollout <rollout-note> --reason "<his words>"`'])

  need('r-takeover', '§ 7 (d)', d, ['with `list_sessions`', 'the session is present → "Leg K is live', 'and stop',
    'it is gone from `list_sessions`, or Lachy says Leg K is dead → (e), with the take-over', '→ ask Lachy'])
  const step1 = item(e, /^1\. \*\*Restartable\?\*\*/)
  const bullets = step1.split('\n').filter((l) => /^\s+- /.test(l)).map((l) => item(step1, new RegExp(`^${l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)))
    .map((x) => C(x).replace(/^\s*- /, ''))
  const openLeg = bullets.find((x) => x.startsWith('`open Leg K (session <id>)`')) ?? ''
  need('r-takeover', "(e)'s open-Leg clause", openLeg, ['only after (d) found `<id>` gone from `list_sessions`', 'or Lachy said Leg K is dead',
    'the take-over form (`restart.takeOver`)'])

  if (bullets.length !== BLOCKERS.length || BLOCKERS.some((re, k) => !re.test(bullets[k] ?? ''))) {
    flag('r-restart', `(e) step 1's blockers are not halt, open Leg, handover, restart, null, else: ${bullets.map((x) => x.slice(0, 30)).join(' | ')}`)
  }
  const ho = bullets.find((x) => x.startsWith('`handover started <X>`')) ?? ''
  const rs = bullets.find((x) => x.startsWith('`restart Leg N (<how>)`')) ?? ''
  const nul = bullets.find((x) => x.startsWith('null →')) ?? ''
  if (!ho.includes('only after `list_sessions` shows X gone, or Lachy says X never ran')) flag('r-restart', `handover clause: ${ho}`)
  if (!rs.includes('only with `--replace` in step 2, after its own check') || !rs.includes('`list_sessions` shows that id gone') ||
    !rs.includes('Lachy says it never started')) flag('r-restart', `restart clause: ${rs}`)
  for (const w of ['stalled', 'awaiting-successor with no hand-over line', 'stopped, on his word', 'completable, not-started or ready, on his ask']) {
    if (!nul.includes(w)) flag('r-restart', `the null clause lacks ${w}`)
  }
  need('r-restart', '§ 7 (e)', e, ['`leg.py restarted` checks only the halt, the numbering (Leg N not begun, N = last_n + 1) and a standing restart',
    'It never checks the open Leg or the hand-over, so that evidence is this step\'s'])
  const ce = C(e)
  const order = ['Re-read `leg.py status`', 'leg.py restarted --rollout <rollout-note> --leg <restart.leg> --pending', "the host's `create_thread`",
    '`title`, `prompt`, `tldr` and `cwd` from `restart`', 'leg.py restarted --rollout <rollout-note> --leg <N> --started <its id>',
    'labelled `manual handoff`', 'leg.py restarted --rollout <rollout-note> --leg <N> --manual "<why>"'].map((p) => ce.indexOf(p))
  if (order.some((i) => i < 0) || order.some((i, k) => k > 0 && i <= order[k - 1])) flag('r-restart', `(e)'s steps are out of order: ${order}`)
  if (pyVerbs(e).includes('leg.py begin')) flag('r-restart', '(e) runs leg.py begin')

  const step2 = C(item(e, /^2\. \*\*Mark it\.\*\*/))
  for (const p of ['with `--replace` only on the `restart Leg N` branch', 'Exit 3 → report the standing restart, and stop',
    '`recorded: false` → Leg N began meanwhile: stop', 'Exit 1 naming `--session` → this session has no id: report it, and stop; never invent one']) {
    if (!step2.includes(p)) flag('r-restarting', `step 2 lacks ${p}`)
  }

  const gate = C(item(b, /^- \*\*A gate\*\*/))
  if (!gate.includes('On his sign-off, `python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/reconcile-rollout.py approve-gates --tasks <t> --rollout <rollout-note>`') ||
    !gate.includes('If he declines it, Defer (below)')) flag('r-setaside', `the gate bullet: ${gate}`)
  const block = C(item(b, /^- \*\*A block\*\*/))
  const iRec = block.indexOf('reconcile-rollout.py record-answer --tasks <t> --rollout <rollout-note> --kind decision')
  const iHb = block.indexOf('reconcile-rollout.py hand-back --tasks <t> --answer <the stamp record-answer printed>')
  if (iRec < 0 || iHb < iRec || !block.includes('--fingerprint <row.setAside.fingerprint> --form hand-back') ||
    !block.includes('`AskUserQuestion` quoting `setAside.summary`')) flag('r-setaside', `the block bullet: ${block}`)

  const defer = C(item(b, /^- \*\*Defer, dependency-aware\*\*/))
  for (const p of ["read the row's `dependants` from `leg.py status`", 'transitive, through `merged_into:` tombstones',
    'None → `python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/reconcile-rollout.py defer --tasks <t> --rollout <rollout-note>`',
    'defer the whole chain, or keep and fix [[A]]?', '`reconcile-rollout.py defer --tasks <t>,<each dependant> --rollout <rollout-note>`',
    'A dependant a Leg holds', 'never write it or defer A alone']) {
    if (!defer.includes(p)) flag('r-defer', `the Defer bullet lacks ${p}`)
  }
  for (const w of ['worktree remove', 'gh pr close', 'update-ref', '## Notes']) if (defer.includes(w)) flag('r-defer', `the Defer bullet holds ${w}`)

  const fm = (f.repair.match(/^---\n([\s\S]*?)\n---\n/) ?? ['', ''])[1]
  const desc = (fm.match(/^description: (.*)$/m) ?? ['', ''])[1]
  if (!desc.includes('the Chorus Stage') || !desc.includes("starts a serial chain''s next Leg")) flag('r-scope', 'the description')
  need('r-scope', 'repair ## Scope', section(f.repair, /^## Scope$/), ['`leg.py status` (read-only), `leg.py restarted` and, on Lachy\'s word, `leg.py clear-halt`',
    'These are the only Leg-log writes it makes, under leg.py\'s lock', '`list_sessions`', '`create_thread`, which starts a new Session',
    'It makes no `gh` call and no task call there'])
  need('r-scope', 'repair ## Native runtime binding', section(f.repair, /^## Native runtime binding$/), ['A serial chain (§ 7) makes no task call',
    'as `skills/execute/legs.md` § Hand over does', 'the new Leg\'s `begin` takes the chain under leg.py\'s lock',
    'The host tool is the one `skills/execute/legs.md` § Hand over picks'])

  const donts = section(f.repair, /^## Don'ts$/) ?? ''
  const dont = C(item(donts, /^- \*\*Don't run a serial chain's Legs\.\*\*/))
  const allow = dont.slice(0, Math.max(0, dont.indexOf(' Never ')))
  const forbid = dont.slice(Math.max(0, dont.indexOf(' Never ')))
  if (!allow.includes('§ 7 runs only')) flag('r-allow', 'the serial Don\'t has no allow-list')
  for (const v of pyVerbs(r7)) {
    const [script, verb] = v.split(' ')
    const ok = script === 'leg.py' ? allow.includes(`\`${v}\``) : script === 'reconcile-rollout.py' && allow.includes(`\`${verb}\``)
    if (!ok) flag('r-allow', `§ 7 runs ${v}, which the allow-list lacks`)
  }
  if (!forbid.includes('`leg.py begin`') || LEG_VERBS.slice(1).some((v) => !forbid.includes(`\`${v}\``))) flag('r-allow', `the forbidden list: ${forbid}`)

  if (!C(r7).includes('§ 7 writes no `## Notes` line by hand')) flag('r-notes', '§ 7 does not say it writes no ## Notes line')
  if (/repair: \[\[/.test(r7)) flag('r-notes', '§ 7 holds a dated repair: line')

  // ---- legs.md § Complete and the serial template ----
  const complete = section(f.legs, /^## Complete$/) ?? ''
  const step = (n) => C(item(complete, new RegExp(`^${n}\\. `)))
  if (!step(1).includes('The canary and fold-journals stay parallel-only.') || /p24-4|not scored \(serial/.test(f.legs)) flag('l-score', 'step 1, or a leftover stub')
  for (const p of ['`python3 ${CLAUDE_PLUGIN_ROOT}/skills/reflect/scripts/close-score.py --rollout <rollout note> --close completion`',
    "with the Bash tool's `timeout: 600000`", 'Its one stdout line, verbatim, or `not scored: close-score printed nothing`, is the reflection',
    'A non-zero exit never stops the ceremony']) {
    if (!step(3).includes(p)) flag('l-score', `step 3 lacks ${p}`)
  }
  if (!step(4).includes('--reflection "<step 3\'s line>"') || !step(4).includes('`Reflection: <step 3\'s line>`')) flag('l-score', 'step 4')
  const tpl = C(item(section(f.template, /^## Post-rollout/) ?? '', /^3\. /))
  if (!tpl.includes('`close-score.py --rollout <this note> --close completion`') || !tpl.includes('a failed score never stops the ceremony')) {
    flag('l-score', `the template's step 3: ${tpl}`)
  }
  return { fails: [...fails].sort(), details }
}

test('status and repair read a serial chain: § 5, § 7, the Don\'ts, the Scope and the Complete score', () => {
  const { fails, details } = check(real)
  assert.deepEqual(fails, [], details.join('\n'))
})

// ---- controls: each mutates one real file in memory and must fail with exactly its rule ---------------------------

const only = (key, from, to, rules, label) => {
  assert.ok(real[key].includes(from), `control setup (${label}): ${String(from).slice(0, 80)} not in ${key}`)
  const { fails, details } = check({ ...real, [key]: real[key].replace(from, to) })
  assert.deepEqual(fails, rules, `${label}\n${details.join('\n')}`)
}
const lineOf = (key, start) => {
  const l = real[key].split('\n').find((x) => x.startsWith(start))
  assert.ok(l, `control setup: no line starting ${start} in ${key}`)
  return l
}

test('control: status § 1 sending a serial note to § 2 fails s-route', () => {
  only('status', '`shape: serial` → § 5 instead of §§ 2–4', '`shape: serial` → § 2', ['s-route'], 'route')
})
test('control: a second leg.py verb in status § 5 fails s-read', () => {
  only('status', '- **Smoke list.** The `smoke` entries:', '- **Smoke list.** `leg.py restarted` lists the `smoke` entries:', ['s-read'], 'verb')
})
test('control: a Set aside group without its dependants fails s-report', () => {
  only('status', ' and its `dependants`, "[[b]], [[c]] wait on it"', '', ['s-report'], 'dependants')
})
test('control: S9 from any folder fails s-order only', () => {
  const s9 = lineOf('status', '- S9 ')
  const cont = real.status.split('\n')[real.status.split('\n').indexOf(s9) + 1]
  only('status', `${s9}\n${cont}\n`, '- S9 `completable` → "`/thread:execute [[<rollout>]]` from any folder"\n', ['s-order'], 's9')
})
test('control: S5 and S6 swapped fails s-order', () => {
  only('status', '- S5 `halted`', '- S5 `restarting`', ['s-order'], 'swap')
})
test('control: repair § 1\'s serial paragraph before the Stops fails r-route', () => {
  const p = real.repair.split('\n').find((l) => l.startsWith('**A serial chain.**'))
  const next = real.repair.split('\n')[real.repair.split('\n').indexOf(p) + 1]
  const para = `${p}\n${next}\n\n`
  const moved = real.repair.replace(para, '').replace('**Stops**, first match', `${para}**Stops**, first match`)
  const { fails } = check({ ...real, repair: moved })
  assert.deepEqual(fails, ['r-route'])
})
test('control: clear-halt without his word fails r-halt', () => {
  only('repair', 'Ask. Only on his word:', 'Then:', ['r-halt'], 'word')
})
test('control: an open-Leg clause without list_sessions fails r-takeover', () => {
  only('repair', 'only after (d) found `<id>` gone from `list_sessions`, or Lachy said', 'only after (d), or Lachy said', ['r-takeover'], 'list_sessions')
})
test('control: an open-Leg clause that just restarts fails r-takeover', () => {
  const l = lineOf('repair', '   - `open Leg K (session <id>)` → ')
  const next = real.repair.split('\n')[real.repair.split('\n').indexOf(l) + 1]
  only('repair', `${l}\n${next}\n`, '   - `open Leg K (session <id>)` → restart.\n', ['r-takeover'], 'restart')
})
test('control: (e) without the halt clause fails r-restart', () => {
  only('repair', '   - `halt` → never: (c) first.\n', '', ['r-restart'], 'halt')
})
test('control: (e) without the "checks only" sentence fails r-restart', () => {
  only('repair', '   `leg.py restarted` checks only the halt, the numbering (Leg N not begun, N = last_n + 1) and a standing restart.\n', '',
    ['r-restart'], 'checks only')
})
test('control: create_thread before --pending fails r-restart', () => {
  const lines = real.repair.split('\n')
  const i2 = lines.findIndex((l) => l.startsWith('2. **Mark it.**'))
  const i3 = lines.findIndex((l) => l.startsWith('3. **Start it**'))
  const i4 = lines.findIndex((l) => l.startsWith('4. **Otherwise**'))
  assert.ok(i2 > 0 && i3 > i2 && i4 > i3, 'control setup: steps 2–4')
  const swapped = [...lines.slice(0, i2), ...lines.slice(i3, i4), ...lines.slice(i2, i3), ...lines.slice(i4)].join('\n')
  const { fails } = check({ ...real, repair: swapped })
  assert.deepEqual(fails, ['r-restart'])
})
test('control: a handover clause without its evidence fails r-restart', () => {
  only('repair', 'only after `list_sessions` shows X gone, or Lachy says X never ran.', 'restart it.', ['r-restart'], 'handover')
})
test('control: a step 2 that invents a session id fails r-restarting', () => {
  only('repair', 'report it,\n   and stop; never invent one.', 'pass a made-up one.', ['r-restarting'], 'invent')
})
test('control: a hand-back before its record-answer fails r-setaside', () => {
  only('repair', '  - Hand back: `python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/reconcile-rollout.py record-answer',
    '  - Hand back: `python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/reconcile-rollout.py hand-back --tasks <t> --answer <the stamp record-answer printed>` first, then `python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/reconcile-rollout.py record-answer',
    ['r-setaside'], 'order')
})
test('control: a declined gate left set aside fails r-setaside', () => {
  only('repair', 'If he declines it, Defer (below).', 'If he declines it, leave it.', ['r-setaside'], 'declined')
})
test('control: a defer of the set-aside alone fails r-defer only', () => {
  only('repair', '`reconcile-rollout.py defer --tasks <t>,<each dependant> --rollout <rollout-note>`',
    '`reconcile-rollout.py defer --tasks <t> --rollout <rollout-note>`', ['r-defer'], 'closure')
})
test('control: § 5\'s retire block pasted into the serial Defer fails r-defer only', () => {
  only('repair', '  - A dependant a Leg holds (its `state` running, with an `owner`) → ask, and never write it or defer A alone.',
    '  - A dependant a Leg holds (its `state` running, with an `owner`) → ask, and never write it or defer A alone.\n' +
    '  - Then retire it: `git -C <repoPath> worktree remove -f -f <repoPath>/.claude/worktrees/<slug>`, `gh pr close <pr> --delete-branch`, ' +
    '`git -C <repoPath> update-ref -d refs/integration-anchor/<inputs.branch> <X>`.', ['r-defer'], 'retire')
})
test('control: a description without the Chorus Stage fails r-scope', () => {
  only('repair', ' + the execute engine + the Chorus Stage.\'', ' + the execute engine.\'', ['r-scope'], 'description')
})
test('control: a Scope without create_thread fails r-scope', () => {
  only('repair', 'and the Chorus Stage\'s `list_sessions` and\n`create_thread`, which starts a new Session.', 'and the Chorus Stage\'s `list_sessions`.',
    ['r-scope'], 'scope')
})
test('control: a binding that makes a task call fails r-scope', () => {
  only('repair', 'A serial chain (§ 7) makes no task call.', 'A serial chain (§ 7) makes a task call.', ['r-scope'], 'binding')
})
test('control: leg.py begin in § 7 fails r-allow only', () => {
  only('repair', '**(a) Diagnose.** Show status § 5\'s report:', '**(a) Diagnose.** Run `leg.py begin`, then show status § 5\'s report:', ['r-allow'], 'begin')
})
test('control: a Notes line written by § 7 fails r-notes', () => {
  only('repair', 're-read `leg.py status`: the chain reads stalled, and (e) restarts it.',
    're-read `leg.py status`: the chain reads stalled, and (e) restarts it. Record it as `- <YYYY-MM-DD> repair: [[<rollout>]] halt cleared`.',
    ['r-notes'], 'notes')
})
test('control: a Complete whose failed score stops the ceremony fails l-score', () => {
  only('legs', 'A non-zero exit never stops the ceremony.', 'A non-zero exit stops the ceremony.', ['l-score'], 'score')
})
test('control: a template that scores nowhere fails l-score', () => {
  only('template', '3. Score the chain: run `close-score.py --rollout <this note> --close completion`', '3. Score the chain by hand', ['l-score'], 'template')
})
