// A handoff ends by running `next` for this session, the parent (thread-skill-p27-5). Lachy's routine was: ask for a
// handoff, read it, then ask `/thread:next` by hand to learn what this session should do now. The handoff now takes
// that step itself:
//
//   - handoff § Next for this session runs `thread:next` once for this session, after the doc is handed to landing,
//     the task is created (or the run labelled a manual handoff) and the handoff's own output has ended; through the
//     Skill (args `after-handoff <abs doc path>`) or a read of next's SKILL.md, never re-implemented (ADR 0002);
//   - it is skipped on a dispatch: next's own step 5 ran the handoff, or the handoff is a Rollout launch (ADR 0057);
//     and on the resolver's failure path and a withdrawal. A dispatch's turn ends on handoff's own output, with
//     nothing after it that recommends, offers or asks about a move for this session (next's overturn note, wherever
//     it sits, is no second move) and none on ending or archiving this session;
//   - next step 1 counts the handed-off work as its consumer's, never this session's keep-going step, while the
//     detection bullet above it still settles where the thread lives; after the handoff next prints no step-2
//     summary and asks nothing outside its menu (step 2 and § Don't say so too); step 5 names the skip;
//     plugin-root.md lists handoff → next; README and CONTEXT say so;
//   - eval cases: a handoff that ends on one move for this session, a handoff that next dispatched with no second
//     next, and the two older handoff cases regraded (the trace now holds the doc) or given the longer turn budget.
//
// One pure function, fails(files), over { relPath: text } of skills/, evals/ (evals/results/ pruned), README.md and
// CONTEXT.md: the real tree gives [], and each control mutates one place in memory and must fail with exactly its
// pin. Pins N1-N12, each with at least one control. Reads files only.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { collapse, lineOf, root, section, slice } from '../lib/contract-text.mjs'

const HANDOFF = 'skills/handoff/SKILL.md'
const NEXT = 'skills/next/SKILL.md'
const PLUGIN_ROOT = 'skills/_shared/plugin-root.md'
const LIFECYCLE = 'skills/_shared/handoff-lifecycle.md'
const README = 'README.md'
const CONTEXT = 'CONTEXT.md'
const ENDS = 'evals/lifecycle/handoff-ends-with-next'
const ROUTER = 'evals/lifecycle/handoff-router-dispatch-skips-next'
const MANUAL = 'evals/lifecycle/handoff-manual-dry-run'
const FORK = 'evals/routing/continuity/handoff-fork-now'

const NEXT_HEAD = '## Next for this session'
const SKIPPED = /^\*\*Skipped on a dispatch\.\*\*/
const DETECT = /^\s*- \*\*Whether the work continues in another session\*\*/
const AFTER_HANDOFF = /^\s*- \*\*After this session's own handoff\*\*/

// Every text file under skills/ and evals/ (but evals/results/, the git-ignored `make evals` output), README.md and
// CONTEXT.md, as { relPath: text }. __pycache__, .DS_Store and any file holding a NUL byte are skipped.
function readTree() {
  const files = {}
  const add = (rel) => {
    const buf = fs.readFileSync(path.join(root, rel))
    if (!buf.includes(0)) files[rel] = buf.toString('utf8')
  }
  const walk = (dir) => {
    for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`
      if (e.name === '__pycache__' || e.name === '.DS_Store' || rel === 'evals/results') continue
      if (e.isDirectory()) walk(rel)
      else if (e.isFile()) add(rel)
    }
  }
  for (const d of ['skills', 'evals']) walk(d)
  for (const f of [README, CONTEXT]) add(f)
  return files
}

const C = (s) => (s == null ? '' : collapse(s))
const stripFront = (text) => (text ?? '').replace(/^---\n[\s\S]*?\n---\n/, '')

// A markdown file's one-line `key: value` front matter, quoted values unquoted, and its body; null when absent.
function frontMatter(text) {
  if (text == null) return null
  const lines = text.split('\n')
  if (lines[0] !== '---') return null
  const close = lines.indexOf('---', 1)
  if (close < 0) return null
  const fm = {}
  for (const l of lines.slice(1, close)) {
    const m = l.match(/^([a-z_]+):\s*(.*?)\s*$/)
    if (!m) continue
    let v = m[2]
    if (/^'.*'$/.test(v)) v = v.slice(1, -1).replaceAll("''", "'")
    else if (/^".*"$/.test(v)) v = JSON.parse(v)
    fm[m[1]] = v
  }
  return { fm, body: lines.slice(close + 1).join('\n') }
}

const grader = (F, c, name) => frontMatter(F[`${c}/graders/${name}.md`])
// Does a Skill grader's input_match pick `skill` (thread:<skill> and the bare name), and no other verb tried here?
const OTHERS = ['handoff', 'next', 'close', 'stash', 'defer', 'open']
function picks(g, skill) {
  if (!g || g.fm.type !== 'tool_used' || g.fm.tool !== 'Skill' || g.fm.arm !== 'both' || !g.fm.input_match) return false
  let re
  try { re = new RegExp(g.fm.input_match) } catch { return false }
  const hit = (s) => re.test(JSON.stringify({ skill: s }))
  return hit(`thread:${skill}`) && hit(skill) && OTHERS.filter((o) => o !== skill).every((o) => !hit(`thread:${o}`))
}
const bounds = (g, min, max) => g != null && g.fm.min === min && g.fm.max === max

function fails(F) {
  const out = new Set()
  const need = (pin, text, phrases) => { for (const p of phrases) if (!C(text).includes(p)) out.add(pin) }

  // N1 — handoff's last section: after § Build the handoff prompt, before § Other hosts.
  const h = F[HANDOFF] ?? ''
  const hl = h.split('\n')
  const iBuild = hl.indexOf('## Build the handoff prompt')
  const iNext = hl.indexOf(NEXT_HEAD)
  const iHosts = hl.indexOf('## Other hosts')
  if (!(iBuild >= 0 && iBuild < iNext && iNext < iHosts)) out.add('N1')

  // N2 — its first paragraph: when it runs, how (Skill, or a read by plugin-root.md), and what it ends on.
  const sec = section(h, new RegExp(`^${NEXT_HEAD}$`)) ?? ''
  const first = slice(sec, new RegExp(`^${NEXT_HEAD}$`), SKIPPED) ?? ''
  need('N2', first, [
    '`thread:next`', 'args `after-handoff <abs doc path>`',
    '`${CLAUDE_PLUGIN_ROOT}/skills/next/SKILL.md`', '`${CLAUDE_PLUGIN_ROOT}/skills/_shared/plugin-root.md`',
    'never re-implemented here (ADR 0002)', 'counts as gone',
    'exactly one move for this session', "on Chorus that is § Build the handoff prompt's closing line",
    'Several handoffs in one turn get one `next`, after the last', 'A dry run ends with this step too',
    "close's **Wrong route?**",
  ])

  // N3 — skipped on a dispatch: next's own step 5 and every Rollout launch; and on the failure path and a withdrawal.
  // A dispatch's turn ends on handoff's own output and never says this session can be ended or archived: on the
  // Stage, Chorus's close leg reads "can be ended because its work carries on elsewhere" as *closed*, which archives
  // the Session, and a manual handoff's unopened prompt is no work carrying on elsewhere (next step 1). Its test is the
  // router case's grader's (ends-on-the-handoff.md): nothing after the output recommends, offers or asks about a
  // move, and next's overturn note, wherever it sits, is no second move (the eval record's B2 ruling).
  need('N3', slice(sec, SKIPPED, null), [
    "next's step 5", '**Rollout launch.**',
    "schedule step 8's **Execute handoff.**", "orient § 9's **Fresh session**",
    "close's `rollout not started:` row", 'ADR 0057',
    "Its turn ends on handoff's own output (the closing line, the directive, or the labelled manual handoff)",
    'with nothing after it that recommends, offers or asks about a move for this session',
    'none anywhere on ending or archiving this session',
    "The note on how Lachy can overturn next's decision (next step 4's **The line.**) is no second move, wherever it sits",
    'only Lachy archives a session', "Its turn ends the same way, on handoff's own output",
    '**Failure path.**', '**Lifecycle.**',
  ])

  // N4 — the wiring in handoff's own text: § Build's closing line, § Success contract item 5, the Rollout launch.
  need('N4', section(h, /^## Build the handoff prompt/), ['with nothing after it but § Next for this session'])
  need('N4', slice(section(h, /^## Success contract/) ?? '', /^5\. /, /^\S/), ['§ Next for this session follows it'])
  need('N4', slice(h, /^\*\*Rollout launch\.\*\*/, /^\*\*Split launch\.\*\*/), ['(§ Next for this session is skipped)'])

  // N5 — next step 1: the bullet directly after the detection bullet counts the handed-off work as gone, and after
  // the handoff next prints no step-2 summary and no question outside its menu (on the Stage the Turn's last message
  // is next's, and Chorus's close leg reads a '?' anywhere in it as *question*); step 2 says it has no summary then.
  const s1 = (slice(stripFront(F[NEXT]), /^1\. \*\*Read the situation/, /^2\. /) ?? '').split('\n')
  const iDetect = s1.findIndex((l) => DETECT.test(l))
  const after = iDetect >= 0 ? s1[iDetect + 1] ?? '' : ''
  if (!AFTER_HANDOFF.test(after)) out.add('N5')
  else need('N5', after, [
    'handoff § Next for this session', '`after-handoff <abs doc path>`',
    "never this session's keep-going step", 'never handed off again',
    "step 3's **While another session holds the thread.** rule and step 4's archive line govern, residual work or not",
    'Only a manual handoff', 'close § The handoff owns the continuation',
    ', which the fresh session will build on',
    "After this session's own handoff, next prints no step-2 summary and no open question",
    'it prints only its one line, or the menu when the pick is his, with no question outside that menu',
  ])
  need('N5', lineOf(stripFront(F[NEXT]), /^2\. \*\*Summarise/), ["None after this session's own handoff (step 1)"])
  need('N5', lineOf(stripFront(F[NEXT]), "- Don't pad the summary"), ["headline + top open question (none after this session's own handoff, step 2)"])

  // N6 — next step 5 names the skip, so a dispatched handoff never runs next again.
  need('N6', lineOf(F[NEXT], /^5\. \*\*Dispatch\.\*\*/), ['with handoff § Next for this session skipped'])

  // N7 — plugin-root.md lists handoff as a caller of next.
  need('N7', section(F[PLUGIN_ROOT], /^## When it applies/), ['handoff → next'])

  // N8 — README's handoff row and CONTEXT's Handoff entry say the parent runs next.
  need('N8', lineOf(F[README], '| `/thread:handoff`'), ['`/thread:next` once for this session'])
  const entry = C(slice(F[CONTEXT], /^- \*\*Handoff\*\* —/, /^- \*\*/))
  if (!entry.includes('runs `next` for its own move') || entry.includes('this session ends')) out.add('N8')

  // N9 — the new cases' grader shapes.
  if (!picks(grader(F, ENDS, 'routes-to-handoff'), 'handoff') ||
    !picks(grader(F, ENDS, 'runs-next-once'), 'next') || !bounds(grader(F, ENDS, 'runs-next-once'), '1', '1') ||
    !picks(grader(F, ENDS, 'not-close'), 'close') || grader(F, ENDS, 'not-close').fm.max !== '0' ||
    grader(F, ENDS, 'doc-path')?.fm.type !== 'regex' || grader(F, ENDS, 'doc-path')?.fm.target !== 'trace' ||
    grader(F, ENDS, 'parent-next')?.fm.type !== 'llm' || grader(F, ENDS, 'parent-next')?.fm.focus !== 'last_message' ||
    !picks(grader(F, ROUTER, 'routes-to-next'), 'next') || !bounds(grader(F, ROUTER, 'routes-to-next'), '1', '1') ||
    !picks(grader(F, ROUTER, 'not-close'), 'close') || grader(F, ROUTER, 'not-close').fm.max !== '0' ||
    grader(F, ROUTER, 'ends-on-the-handoff')?.fm.type !== 'llm' ||
    grader(F, ROUTER, 'ends-on-the-handoff')?.fm.focus !== 'last_message') out.add('N9')

  // N10 — handoff-manual-dry-run reads the doc from the trace (the last message is now next's), its two loaded-text
  // regexes are gone, and its prompt leaves work in this session; the new case's prompt never names next.
  const lc = grader(F, MANUAL, 'lifecycle')
  if (grader(F, MANUAL, 'doc-path')?.fm.target !== 'trace' || lc?.fm.focus !== 'trace' ||
    !C(lc.body).includes("Judge only the agent's own messages") ||
    !C(lc.body).includes("Not graded: anything after the handoff's own output") ||
    `${MANUAL}/graders/status-pending.md` in F || `${MANUAL}/graders/manual-handoff.md` in F ||
    !C(F[`${MANUAL}/prompt.md`]).includes("I'll stay in this session to update the changelog")) out.add('N10')
  const endsBody = frontMatter(F[`${ENDS}/prompt.md`])?.body ?? ''
  if (endsBody === '' || endsBody.includes('thread:next') || /next move/i.test(endsBody)) out.add('N10')

  // N11 — no trace regex can pass on loaded or quoted text: none matches its own case's prompt or any skills/ file.
  let traced = 0
  for (const [rel, text] of Object.entries(F)) {
    const m = rel.match(/^(evals\/.+)\/graders\/[^/]+\.md$/)
    const g = m && frontMatter(text)
    if (!g || g.fm.type !== 'regex' || g.fm.target !== 'trace') continue
    traced++
    const pattern = g.fm.pattern ?? g.body.trim()
    const flags = (g.fm.flags ?? '').replace('g', '')
    const hits = (t) => t != null && new RegExp(pattern, flags).test(t)
    if (hits(F[`${m[1]}/prompt.md`]) || Object.keys(F).some((k) => k.startsWith('skills/') && hits(F[k]))) out.add('N11')
  }
  if (traced === 0) out.add('N11')

  // N12 — a handoff that then runs next needs the longer budget.
  for (const c of [FORK, MANUAL, ENDS, ROUTER]) {
    const fm = frontMatter(F[`${c}/prompt.md`])?.fm ?? {}
    if (!(Number(fm.max_turns) >= 15 && Number(fm.timeout_seconds) >= 300)) out.add('N12')
  }
  return [...out].sort()
}

const real = readTree()
const only = (name, files, want) => assert.deepEqual(fails(files), want, `${name}: expected ${want}`)
const swap = (rel, from, to) => {
  assert.ok(real[rel]?.includes(from), `control setup: ${from.slice(0, 60)} not in ${rel}`)
  return { ...real, [rel]: real[rel].replace(from, to) }
}
const without = (rel) => {
  assert.ok(rel in real, `control setup: ${rel} is missing`)
  const { [rel]: _, ...rest } = real
  return rest
}

test('the real tree passes every pin', () => {
  assert.deepEqual(fails(real), [])
})

test('the scan reads the skills, the eval cases and the docs', () => {
  for (const f of [HANDOFF, NEXT, PLUGIN_ROOT, README, CONTEXT, `${ENDS}/prompt.md`, `${ROUTER}/prompt.md`,
    `${MANUAL}/prompt.md`, `${FORK}/prompt.md`]) assert.ok(f in real, `${f} is not scanned`)
  assert.ok(Object.keys(real).every((f) => !f.startsWith('evals/results/')), 'evals/results/ is pruned')
})

test('controls: N1 to N4, handoff\'s own text', () => {
  // N1: the section moved above § Build
  const h = real[HANDOFF]
  const i = h.indexOf(`${NEXT_HEAD}\n`)
  const j = h.indexOf('## Other hosts\n')
  assert.ok(i >= 0 && j > i, 'control setup: no section to move')
  const moved = h.slice(0, i) + h.slice(j)
  only('N1:moved', { ...real, [HANDOFF]: moved.replace('## Build the handoff prompt\n', `${h.slice(i, j)}## Build the handoff prompt\n`) }, ['N1'])
  only('N2:adr', swap(HANDOFF, 'never re-implemented here (ADR 0002)', 'never re-implemented here'), ['N2'])
  only('N2:several', swap(HANDOFF, 'Several handoffs in one turn get one `next`, after the last', 'Each handoff gets its own `next`'), ['N2'])
  only('N2:args', swap(HANDOFF, 'with args `after-handoff <abs doc path>`', 'with no args'), ['N2'])
  only('N2:wrong-route', swap(HANDOFF, "close's **Wrong route?**", 'a redirect'), ['N2'])
  only('N3:router', swap(HANDOFF, "When next's step 5 dispatched this handoff", 'When a router dispatched this handoff'), ['N3'])
  only('N3:orient', swap(HANDOFF, "orient § 9's **Fresh session**, ", ''), ['N3'])
  only('N3:failure', swap(HANDOFF, 'skipped on the **Failure path.**', 'skipped when the resolver fails'), ['N3'])
  // the dispatched turn free to tell Lachy he can end this session (invocation 6, run 2: "you can end this one")
  only('N3:archive', swap(HANDOFF, ' and none anywhere on ending or archiving this session', ''), ['N3'])
  only('N3:ends', swap(HANDOFF, "Its turn ends on handoff's own output (the closing line, the directive, or the labelled manual handoff)", "Its turn ends"), ['N3'])
  only('N3:launch', swap(HANDOFF, "Its turn ends the same way, on handoff's own output.", "Its turn ends on handoff's own closing line."), ['N3'])
  // b18d0e7's stricter words back: they forbid the overturn note the router case's grader passes
  only('N3:word', swap(HANDOFF, 'with nothing after it that recommends, offers or asks about a move for this session', "with no word after it on this session's move"), ['N3'])
  only('N3:overturn', swap(HANDOFF, " The note on how Lachy can overturn next's decision (next step 4's **The line.**) is no second move, wherever it sits: it restates that one decision.", ''), ['N3'])
  only('N4:build', swap(HANDOFF, ' but § Next for this session', ''), ['N4'])
  only('N4:contract', swap(HANDOFF, ', and § Next for this session follows it', ''), ['N4'])
  only('N4:launch', swap(HANDOFF, ' (§ Next for this session is skipped)', ''), ['N4'])
})

test('controls: N5 to N8, next, plugin-root, README and CONTEXT', () => {
  const line = real[NEXT].split('\n').find((l) => AFTER_HANDOFF.test(l))
  assert.ok(line, 'control setup: no after-handoff bullet')
  only('N5:gone', swap(NEXT, `${line}\n`, ''), ['N5'])
  only('N5:moved', swap(NEXT, `${line}\n`, `   - **An unrelated bullet** — between them.\n${line}\n`), ['N5'])
  only('N5:govern', swap(NEXT, ', residual work or not', ''), ['N5'])
  only('N5:manual', swap(NEXT, 'Only a manual handoff', 'A handoff'), ['N5'])
  only('N5:branch', swap(NEXT, ', which the fresh session will build on', ''), ['N5'])
  // step 2's summary and its open question back after the handoff: on the Stage the Turn would end asking
  only('N5:summary', swap(NEXT, "After this session's own handoff, next prints no step-2 summary and no open question", 'After this session\'s own handoff, next prints its step-2 summary'), ['N5'])
  only('N5:question', swap(NEXT, ', with no question outside that menu', ''), ['N5'])
  only('N5:step2', swap(NEXT, " None after this session's own handoff (step 1), whose output already said where the work is.", ''), ['N5'])
  only('N5:dont', swap(NEXT, " (none after this session's own handoff, step 2)", ''), ['N5'])
  only('N6', swap(NEXT, ", with handoff § Next for this session skipped (this step already decided this session's move)", ''), ['N6'])
  only('N7', swap(PLUGIN_ROOT, '; handoff → next,', '; handoff,'), ['N7'])
  only('N8:readme', swap(README, ' Then it runs `/thread:next` once for this session, unless `next` or a Rollout launch dispatched it.', ''), ['N8'])
  only('N8:context', swap(CONTEXT, 'and this session then runs `next` for its own move', 'and this session ends'), ['N8'])
})

test('controls: N9 to N12, the eval cases', () => {
  only('N9:max', swap(`${ENDS}/graders/runs-next-once.md`, 'max: 1', 'max: 2'), ['N9'])
  only('N9:router-min', swap(`${ROUTER}/graders/routes-to-next.md`, 'min: 1', 'min: 0'), ['N9'])
  only('N9:focus', swap(`${ENDS}/graders/parent-next.md`, 'focus: last_message', 'focus: trace'), ['N9'])
  only('N9:skill', swap(`${ROUTER}/graders/not-close.md`, '?close"', '?stash"'), ['N9'])
  // the old last_message regex back (as a trace regex it would match handoff-lifecycle.md's text too: N11)
  only('N10:pending', { ...real, [`${MANUAL}/graders/status-pending.md`]: "---\ntype: regex\ntarget: last_message\npattern: 'status:\\s*pending'\n---\n" }, ['N10'])
  only('N11:pending', { ...real, [`${MANUAL}/graders/status-pending.md`]: "---\ntype: regex\ntarget: trace\npattern: 'status:\\s*pending'\n---\n" }, ['N10', 'N11'])
  only('N10:focus', swap(`${MANUAL}/graders/lifecycle.md`, 'focus: trace', 'focus: last_message'), ['N10'])
  only('N10:target', swap(`${MANUAL}/graders/doc-path.md`, 'target: trace', 'target: last_message'), ['N10'])
  only('N10:residual', swap(`${MANUAL}/prompt.md`, "I'll stay in this session to update the changelog", 'I updated the changelog'), ['N10'])
  only('N10:named', swap(`${ENDS}/prompt.md`, 'Hand the JSON writer off', 'Run thread:next, then hand the JSON writer off'), ['N10'])
  only('N11:skill', swap(LIFECYCLE, '\n', '\nA doc such as docs/handoffs/2026-01-01-x.md.\n'), ['N11'])
  only('N11:prompt', swap(`${ENDS}/prompt.md`, 'Hand the JSON writer off', 'See docs/handoffs/2026-01-01-x.md. Hand the JSON writer off'), ['N11'])
  // no trace regex left: N11 checks nothing, and the two doc-path graders it would have checked fail their own pins
  const none = without(`${ENDS}/graders/doc-path.md`)
  none[`${MANUAL}/graders/doc-path.md`] = none[`${MANUAL}/graders/doc-path.md`].replace('target: trace', 'target: last_message')
  only('N11:vacuous', none, ['N10', 'N11', 'N9'])
  only('N12', swap(`${FORK}/prompt.md`, 'max_turns: 15', 'max_turns: 8'), ['N12'])
})
