// Execute closes the phases it finishes (ADR 0026): the completion ceremony (execute §4.5 step 5) runs
// `reconcile-rollout.py touched-phases` and, for each line it prints, `reconcile-project.py <line> --kinds
// phase --apply`. A phase whose every task landed and that this rollout touched closes; an untouched
// finished phase is left alone; a failure is filed as a follow-on open task and the ceremony continues.
//
// Three layers, all tied to the doc so a reworded bullet can't drift from the behaviour:
//   - behaviour: the two commands are EXTRACTED from the SKILL.md bullet's fence and run against a temp
//     vault (fresh per test, removed after), with only test flags appended;
//   - classify: a test-side model of the bullet's mapping (literal `<slug>-p<N>-` prefix) and outcome
//     precedence (closed > ambiguous > failed, incl. a whole-line exit 2 > already closed > left open),
//     run on the real exit code, stdout and phase notes;
//   - checkCeremony: a pure function returning the names of the failed doc checks, run on the real
//     SKILL.md and on one control per check family, so no matcher can pass vacuously.
// The follow-on note's body rules (append only unlisted failures, `still failing` in place, resolve per
// line) are agent prose with no script behind them, so they are pinned as doc checks (`append`,
// `resolve`) rather than run.
// Nothing is written into the checkout.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')
const execute = read('skills/execute/SKILL.md')
const template = read('skills/schedule/rollout-template.md')

const collapse = (s) => s.replace(/\s+/g, ' ').trim()
const FENCE = /^\s*(```|~~~)/
const ROLLOUT = 'demo-rollout-2026-09-27'
const TODAY = '2026-09-27'

// ---- slicing §4.5 step 5 ------------------------------------------------------------------------

// The step-5 bullet list: from the line after `5. **Completion.**` up to the first
// blank line outside a fence. Bullets open at exactly three spaces of indent (`   - `) outside a fence.
function stepFive(text) {
  const lines = text.split('\n')
  const head = lines.findIndex((l) => /^5\. \*\*Completion\.\*\*/.test(l))
  if (head < 0) return null
  let end = head + 1
  let inFence = false
  const bullets = []
  for (; end < lines.length; end++) {
    const l = lines[end]
    if (FENCE.test(l)) inFence = !inFence
    else if (!inFence && /^\s*$/.test(l)) break
    if (!inFence && /^ {3}- /.test(l)) bullets.push({ start: end, end: end + 1 })
    else if (bullets.length) bullets[bullets.length - 1].end = end + 1
  }
  for (const b of bullets) {
    b.raw = lines.slice(b.start, b.end).join('\n')
    b.lead = b.raw.replace(/^ {3}- /, '')
  }
  return { lines, bullets }
}

// Fence lines inside a raw block, trimmed.
function fenceLines(raw) {
  const out = []
  let inFence = false
  for (const l of raw.split('\n')) {
    if (FENCE.test(l)) { inFence = !inFence; continue }
    if (inFence) out.push(l.trim())
  }
  return out
}

const isPhase = (b) => b.raw.includes('touched-phases')
const others = {
  straggler: (b) => !isPhase(b) && b.lead.startsWith('Sweep the rollout') && b.raw.includes('mark-done'),
  stamp: (b) => !isPhase(b) && /^Stamp `status: done` \+ `completed: <date>` on the rollout/.test(b.lead),
  followon: (b) => !isPhase(b) && b.lead.startsWith('File any follow-on work'),
  log: (b) => !isPhase(b) && b.lead.startsWith('Append a `## Completion log`'),
  move: (b) => !isPhase(b) && b.lead.startsWith('Move the rollout note to `Work/Tasks/Archive/Rollouts/`'),
}

// The documented follow-on filename (`Work/Tasks/<name>.md` with a `<rollout-slug>` placeholder).
function followupName(bulletRaw) {
  const m = bulletRaw.match(/`Work\/Tasks\/([^`/]*<rollout-slug>[^`/]*\.md)`/)
  return m ? m[1] : null
}

// Top-level keys of the line-224 bullet's fenced YAML block.
function followonYamlKeys(bulletRaw) {
  return fenceLines(bulletRaw).map((l) => (l.match(/^([a-z_]+):/) || [])[1]).filter(Boolean)
}

// Clauses of collapsed text (split on `;` and sentence ends), as schedule-supersede.test does.
const clauses = (s) => s.split(/;\s*|\.\s+(?=[A-Z`*(])/)

// ---- checkCeremony: named failures, [] = every rule holds ---------------------------------------

function checkCeremony(text) {
  const s5 = stepFive(text)
  if (!s5) return ['missing-step']
  const bs = s5.bullets
  const pi = bs.findIndex(isPhase)
  if (pi < 0) return ['missing-bullet']
  const phase = bs[pi]
  const para = collapse(phase.raw)
  const cs = clauses(para)
  const idx = Object.fromEntries(Object.entries(others).map(([k, f]) => [k, bs.findIndex(f)]))
  const fails = []

  // order: after the mark-done straggler sweep, before the rollout stamp, follow-on, log and move.
  if (Object.values(idx).some((i) => i < 0) || !(pi > idx.straggler) ||
    !['stamp', 'followon', 'log', 'move'].every((k) => pi < idx[k])) fails.push('order')

  // flags: phase kind only, applied, phases only from touched-phases.
  const cmds = fenceLines(phase.raw).filter((l) => l.startsWith('python3 ${CLAUDE_PLUGIN_ROOT}/'))
  const rp = cmds.find((l) => l.includes('reconcile-project.py'))
  if (!cmds.some((l) => l.includes('reconcile-rollout.py touched-phases')) || !rp ||
    !rp.includes('--kinds phase') || !rp.includes('--apply') ||
    !/Phases come only from `touched-phases`/.test(para)) fails.push('flags')

  // ambiguous: listed for the user, never applied.
  if (!cs.some((c) => /\*\*ambiguous\*\*/.test(c) && /never applied/.test(c))) fails.push('ambiguous')

  // mapping: the literal prefix match and the three line shapes.
  if (!cs.some((c) => /literal `<slug>-p<N>-` prefix/.test(c)) ||
    !['`-p1-` never matches `-p10-`', ': status: done, completed:', 'skipped: dependency', 'not written:']
      .every((k) => para.includes(k))) fails.push('mapping')

  // leftopen: touched minus Written, Ambiguous and Errors (and the already closed), with the fixed reason.
  if (!cs.some((c) => /\*\*left open\*\*/.test(c) && /touched minus Written, Ambiguous and Errors/.test(c)) ||
    !para.includes('`not closed: a task is still open or held, or the phase note is missing or not open`')) fails.push('leftopen')

  // wholeline: a line that exited non-zero and printed no sections fails every phase on it.
  if (!cs.some((c) => /\*\*failed\*\*/.test(c) && /printed no sections/.test(c)) ||
    !para.includes('without its own Written, Ambiguous or Errors entry is failed, never left open')) fails.push('wholeline')

  // already: a phase note already at `status: done` (root or Archive) is already closed, not left open.
  if (!cs.some((c) => /\*\*already closed\*\*/.test(c) && c.includes('`Work/Phases/<slug>-p<N>-*.md`') &&
    c.includes('`Work/Phases/Archive/**`') && c.includes('`status: done`'))) fails.push('already')

  // empty: nothing printed is recorded, not treated as a failure.
  if (!para.includes('If `touched-phases` exits 0 and prints nothing, record "no phased tasks: nothing to close"')) {
    fails.push('empty')
  }

  // failure: a non-zero exit from EITHER command files a follow-on open task and the ceremony continues.
  if (!para.includes('`touched-phases` exits non-zero') || !para.includes('reconcile-project exits non-zero') ||
    !para.includes('follow-on open task') || !para.includes('exited <code>') ||
    !/continue the ceremony/i.test(para)) fails.push('failure')

  // followup-name: never prefix-matches a rollout name, never looks like a phase task.
  const tpl = followupName(phase.raw)
  const name = tpl && tpl.replace('<rollout-slug>', ROLLOUT)
  if (!name || name.startsWith('demo-rollout') || /^(.+?)-p\d+-/.test(name)) fails.push('followup-name')

  // rerun-path: the recorded re-run command names the rollout note where the move leaves it.
  if (!para.includes('`--rollout` given the post-move path `Work/Tasks/Archive/Rollouts/<rollout-slug>.md`')) {
    fails.push('rerun-path')
  }

  // append: an already-listed failure is annotated in place; only unlisted failures become new lines.
  if (!cs.some((c) => /already listed/.test(c) && c.includes('gets only the in-place `still failing` annotation')) ||
    !para.includes('only failures not yet listed are appended as new lines')) fails.push('append')

  // followup-fm: same new-task shape as the follow-on bullet's YAML, minus rollout/wave/phase.
  const keys = idx.followon >= 0 ? followonYamlKeys(bs[idx.followon].raw) : []
  if (!cs.some((c) => /\bsame new-task shape\b/.test(c) && /follow-on/.test(c)) ||
    !cs.some((c) => /\bminus\b/.test(c) && ['`rollout:`', '`wave:`', '`phase:`'].every((k) => c.includes(k))) ||
    !['priority', 'captured', 'contexts', 'scheduled', 'due', 'projects'].every((k) => keys.includes(k)) ||
    ['rollout', 'wave', 'phase', 'owner'].some((k) => keys.includes(k))) fails.push('followup-fm')

  // resolve: a successful re-run appends `resolved`, done once every line is resolved; an archived
  // follow-on is reopened, never duplicated.
  if (!para.includes('`resolved <date>: <outcome>`') ||
    !para.includes('absent from Errors in a run of its line that printed sections, whatever the exit code') ||
    !para.includes('no longer exits 2 or crashes') ||
    !para.includes('`still failing <date>: exited <code>: <message>` in place') ||
    !cs.some((c) => /every line is resolved/.test(c) && c.includes('`status: done`')) ||
    !cs.some((c) => /archived/.test(c) && c.includes('reset `status: open`')) ||
    !/never create a second same-named note/.test(para)) fails.push('resolve')

  // log: the Completion log names each outcome.
  const logText = idx.log >= 0 ? collapse(bs[idx.log].raw) : ''
  if (!['phase closure', 'closed', 'already closed', 'ambiguous', 'failed', 'left open'].every((k) => logText.includes(k))) {
    fails.push('log')
  }
  return fails
}

// ---- the real doc -------------------------------------------------------------------------------

const s5 = stepFive(execute)
const phaseBullet = s5 && s5.bullets.find(isPhase)

test('execute §4.5 step 5: the phase-close bullet holds every ceremony rule', () => {
  assert.deepEqual(checkCeremony(execute), [])
})

function swapBullets(text, i, j) {
  const { lines, bullets } = stepFive(text)
  const [a, b] = i < j ? [bullets[i], bullets[j]] : [bullets[j], bullets[i]]
  const seg = (x) => lines.slice(x.start, x.end)
  return [...lines.slice(0, a.start), ...seg(b), ...lines.slice(a.end, b.start), ...seg(a),
    ...lines.slice(b.end)].join('\n')
}

// Each control changes the real text and must fail exactly its own check.
function mutate(text, from, to) {
  const out = typeof from === 'string' ? text.split(from).join(to) : text.replace(from, to)
  assert.notEqual(out, text, `control is vacuous: ${from} not found`)
  return out
}

test('controls: each check family rejects its own known-bad shape, and only that one', () => {
  const bs = s5.bullets
  const pi = bs.findIndex(isPhase)
  const si = bs.findIndex(others.stamp)
  const phaseRaw = bs[pi].raw
  const gSub = phaseRaw.split('\n').filter((l) => /^ {5}- \*\*Resolving a stale follow-on/.test(l))
  assert.equal(gSub.length, 1, 'the resolve sub-bullet is not a single line')
  const followonRaw = bs[bs.findIndex(others.followon)].raw
  const logRaw = bs[bs.findIndex(others.log)].raw
  const cases = [
    ['order', swapBullets(execute, pi, si)],
    ['flags', mutate(execute, '--kinds phase', '')],
    ['ambiguous', mutate(execute, 'is never applied', 'is applied')],
    ['mapping', mutate(execute, /literal `<slug>-p<N>-` prefix/, 'prefix')],
    ['leftopen', mutate(execute, 'touched minus Written, Ambiguous and Errors', 'the rest')],
    ['wholeline', mutate(execute, ' without its own Written, Ambiguous or Errors entry is failed, never left open', ' is left open')],
    ['already', mutate(execute, '**already closed**: any other', '**done**: any other')],
    ['empty', mutate(execute, 'record "no phased tasks: nothing to close"', 'treat it as a failure')],
    ['failure', mutate(execute, 'follow-on open task', 'note')],
    ['followup-name', mutate(execute, 'phase-close-followup-<rollout-slug>', '<rollout-slug>-phase-close-followup')],
    ['rerun-path', mutate(execute, 'post-move path `Work/Tasks/Archive/Rollouts/<rollout-slug>.md`', 'path `Work/Tasks/<rollout-slug>.md`')],
    ['append', mutate(execute, 'only failures not yet listed are appended as new lines', 'append the failure')],
    ['followup-fm', mutate(execute, followonRaw, followonRaw.replace(/\n\s*priority: normal/, ''))],
    ['resolve', mutate(execute, gSub[0] + '\n', '')],
    ['log', mutate(execute, logRaw, logRaw.replace(/,? left open \([^)]*\)/, ''))],
  ]
  const covered = new Set(cases.map(([k]) => k))
  const families = ['order', 'flags', 'ambiguous', 'mapping', 'leftopen', 'wholeline', 'already', 'empty', 'failure',
    'followup-name', 'rerun-path', 'append', 'followup-fm', 'resolve', 'log']
  assert.deepEqual(families.filter((f) => !covered.has(f)), [], 'a check family has no control')
  for (const [want, text] of cases) assert.deepEqual(checkCeremony(text), [want], `control ${want}`)
})

test('rollout template Post-rollout: closing phases comes first, with the same follow-on rules', () => {
  const post = template.slice(template.indexOf('## Post-rollout'))
  const steps = post.split('\n').filter((l) => /^\d+\. /.test(l))
  const at = (re) => steps.findIndex((l) => re.test(l))
  const close = at(/touched-phases|Close the phases/)
  assert.ok(close >= 0, 'no Post-rollout step closes the phases')
  assert.ok(close < at(/Mark this rollout `status: done`/), 'phase close must precede the rollout stamp')
  assert.ok(close < at(/Move this note/), 'phase close must precede the archive move')
  const step = collapse(steps[close])
  assert.ok(step.includes('phase-close-followup-<rollout-slug>'), 'template names another follow-on')
  assert.ok(/--kinds phase --apply/.test(step), 'template drops --kinds phase --apply')
  assert.ok(/resolved/.test(step) && /set it done/.test(step), 'template drops the resolve-then-done rule')
  assert.ok(step.includes('already closed'), 'template drops the already closed outcome')
  assert.ok(step.includes('`Work/Tasks/Archive/Rollouts/<rollout-slug>.md`'), 'template re-run points at the pre-move path')
  assert.ok(step.includes('`still failing <date>`') && /never a second line/.test(step), 'template drops the in-place still failing rule')
})

// ---- fixture ------------------------------------------------------------------------------------

const tmps = []
after(() => { for (const d of tmps) fs.rmSync(d, { recursive: true, force: true }) })

const fm = (lines) => `---\n${lines.join('\n')}\n---\n\nBody.\n`
const LINK = `rollout: "[[${ROLLOUT}]]"`
function phaseNote(n) {
  return fm(['tags: [phase]', `phase: ${n}`, 'status: open', 'projects: ["[[Demo]]"]', 'captured: 2026-09-20'])
}
function taskNote(n, status, extra = []) {
  return fm(['tags: [task]', `phase: ${n}`, `status: ${status}`, ...extra])
}

function buildVault() {
  const v = fs.mkdtempSync(path.join(os.tmpdir(), 'phase-close-'))
  tmps.push(v)
  const P = path.join(v, 'Work/Phases')
  const T = path.join(v, 'Work/Tasks')
  const A = path.join(T, 'Archive/2026')
  for (const d of [P, T, A]) fs.mkdirSync(d, { recursive: true })
  const w = (dir, name, body) => fs.writeFileSync(path.join(dir, `${name}.md`), body)
  w(T, ROLLOUT, fm(['tags: [task, rollout]', 'status: open', 'projects: ["[[Demo]]"]']))
  w(P, 'demo-p1-alpha', phaseNote(1))
  w(T, 'demo-p1-1-a', taskNote(1, 'done', [LINK]))
  w(A, 'demo-p1-2-b', taskNote(1, 'done', [LINK]))
  w(P, 'demo-p2-beta', phaseNote(2))
  w(T, 'demo-p2-1-a', taskNote(2, 'done', [LINK]))
  w(T, 'demo-p2-2-b', taskNote(2, 'open'))
  w(P, 'demo-p3-gamma', phaseNote(3))
  w(T, 'demo-p3-1-a', taskNote(3, 'done'))
  w(P, 'demo-p10-delta', phaseNote(10))
  w(T, 'demo-p10-1-a', taskNote(10, 'done'))
  w(P, 'demo-p5-eps', phaseNote(5))
  w(T, 'demo-p5-1-a', taskNote(5, 'done', [LINK]))
  w(T, 'demo-p5-2-b', taskNote(5, 'open', ['pr: 7']))
  w(P, 'other-p4-x', phaseNote(4))
  w(T, 'other-p4-1-y', taskNote(4, 'done', [LINK]))
  w(T, 'demo-fix-thing', fm(['tags: [task]', 'status: done', LINK]))
  return v
}

function manifest(v) {
  const out = {}
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else out[path.relative(v, p)] = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')
    }
  }
  walk(v)
  return out
}

// ---- running the doc's commands -----------------------------------------------------------------

const DOC_CMDS = phaseBullet ? fenceLines(phaseBullet.raw).filter((l) => l.startsWith('python3 ${CLAUDE_PLUGIN_ROOT}/')) : []
const TOUCHED_CMD = DOC_CMDS.find((l) => l.includes('touched-phases'))
const CLOSE_CMD = DOC_CMDS.find((l) => l.includes('reconcile-project.py'))

// Tokenise the doc command, then substitute per token so paths with spaces stay one argv entry.
function argv(cmd, subs) {
  return cmd.split(/\s+/).flatMap((t) => {
    if (t in subs) return subs[t]
    return [t.replace('${CLAUDE_PLUGIN_ROOT}', root)]
  })
}
function run(args) {
  const r = spawnSync(args[0], args.slice(1), { encoding: 'utf8' })
  return { code: r.status, stdout: r.stdout, stderr: r.stderr }
}
const rolloutPath = (v) => path.join(v, 'Work/Tasks', `${ROLLOUT}.md`)

function touched(v, rollout = rolloutPath(v)) {
  assert.ok(TOUCHED_CMD, 'no touched-phases command in the bullet fence')
  return run([...argv(TOUCHED_CMD, { '<rollout-note>': [rollout] }), '--tasks-dir', path.join(v, 'Work/Tasks')])
}
function close(v, line) {
  assert.ok(CLOSE_CMD, 'no reconcile-project command in the bullet fence')
  return run([...argv(CLOSE_CMD, { '<line>': line.split(/\s+/) }), '--vault', v, '--today', TODAY, '--no-gh'])
}
// The whole ceremony step: touched-phases, then one close per printed line, keyed by project slug.
function ceremony(v) {
  const t = touched(v)
  assert.equal(t.code, 0, t.stderr)
  const lines = t.stdout.split('\n').filter(Boolean)
  const runs = {}
  for (const line of lines) {
    const slug = line.match(/^--project (\S+) --phases /)[1]
    runs[slug] = { line, touched: line.match(/--phases (\S+)$/)[1].split(',').map(Number), ...close(v, line) }
  }
  return { touched: t, lines, runs }
}
const norm = (s, v) => s.split(v).join('<V>')

// ---- classify: the bullet's mapping + precedence, test-side ------------------------------------

// A touched phase's note already at `status: done`: Work/Phases root first, then Work/Phases/Archive/**.
function phaseNoteDone(vault, slug, n) {
  if (!vault) return false
  const prefix = `${slug}-p${n}-`
  const find = (dir, deep) => {
    if (!fs.existsSync(dir)) return []
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) return deep ? find(p, true) : []
      return e.name.startsWith(prefix) && e.name.endsWith('.md') ? [p] : []
    })
  }
  const P = path.join(vault, 'Work/Phases')
  return [...find(P, false), ...find(path.join(P, 'Archive'), true)].some((f) => {
    const m = fs.readFileSync(f, 'utf8').match(/^---\n([\s\S]*?)\n---/)
    return !!m && /^status: done\s*$/m.test(m[1])
  })
}

// `r` is one reconcile-project run ({code, stdout}); `vault` is where its phase notes live.
function classify(r, slug, touchedNs, vault) {
  const sections = {}
  let cur = null
  for (const l of r.stdout.split('\n')) {
    const h = l.match(/^(Unambiguous|Ambiguous|Skipped|Written|Errors) \(\d+\)$/)
    if (h) { cur = h[1]; sections[cur] = []; continue }
    const it = l.match(/^ {2}- phase (\S+?)(:| skipped:| not written:)/)
    if (cur && it) sections[cur].push(it[1])
  }
  const numOf = (stem) => touchedNs.find((n) => stem.startsWith(`${slug}-p${n}-`))
  const hit = (sec) => new Set((sections[sec] || []).map(numOf).filter((n) => n !== undefined))
  const [W, A, E] = [hit('Written'), hit('Ambiguous'), hit('Errors')]
  const wholeLine = r.code !== 0 && !('Errors' in sections) // exit 2 or a crash: no sections printed
  const out = {}
  for (const n of touchedNs) {
    out[n] = W.has(n) ? 'closed' : A.has(n) ? 'ambiguous' : E.has(n) || wholeLine ? 'failed'
      : phaseNoteDone(vault, slug, n) ? 'already closed' : 'left open'
  }
  return out
}

test('classify: the literal <slug>-p<N>- prefix keeps -p10- from closing -p1-', () => {
  const stdout = 'Written (1)\n  - phase demo-p10-delta: status: done, completed: 2026-09-27\nErrors (0)\n'
  assert.deepEqual(classify({ code: 0, stdout }, 'demo', [1]), { 1: 'left open' })
})

// The ceremony has no review between detection and write, so it keeps the plain (recomputing) --apply;
// --only binds an apply to a human-reviewed dry run (orient's drift fixes), never the ceremony.
test('the ceremony close command is a plain --apply, never bound with --only', () => {
  assert.ok(CLOSE_CMD, 'no reconcile-project command in the bullet fence')
  assert.ok(CLOSE_CMD.includes('--apply'), 'the ceremony close command drops --apply')
  assert.ok(!CLOSE_CMD.includes('--only'), 'the ceremony close command binds its apply with --only')
})

// ---- behaviour ----------------------------------------------------------------------------------

test('touched-phases: one line per slug, phases from linked phased tasks only, read-only', () => {
  const v = buildVault()
  const before = manifest(v)
  const t = touched(v)
  assert.equal(t.code, 0, t.stderr)
  assert.equal(t.stdout, '--project demo --phases 1,2,5\n--project other --phases 4\n')
  assert.deepEqual(manifest(v), before)
})

function assertCeremonyResult(v, before, c) {
  assert.deepEqual(c.lines, ['--project demo --phases 1,2,5', '--project other --phases 4'])
  for (const r of Object.values(c.runs)) assert.equal(r.code, 0, r.stdout + r.stderr)
  const after = manifest(v)
  const changed = Object.keys(before).filter((k) => before[k] !== after[k]).sort()
  assert.deepEqual(changed, ['Work/Phases/demo-p1-alpha.md', 'Work/Phases/other-p4-x.md'])
  for (const n of ['demo-p1-alpha', 'other-p4-x']) {
    const text = fs.readFileSync(path.join(v, 'Work/Phases', `${n}.md`), 'utf8')
    assert.match(text, /\nstatus: done\ncompleted: 2026-09-27\nprojects: /, `${n} not closed in place`)
  }
  const demo = c.runs.demo.stdout.split('\n')
  for (const l of ['Written (1)', '  - phase demo-p1-alpha: status: done, completed: 2026-09-27', 'Ambiguous (1)',
    '  - phase demo-p5-eps: task demo-p5-2-b is ambiguous (pr: 7 is not a URL; cannot verify)', 'Errors (0)']) {
    assert.ok(demo.includes(l), `demo stdout lacks ${JSON.stringify(l)}:\n${c.runs.demo.stdout}`)
  }
  assert.ok(c.runs.other.stdout.split('\n').includes('  - phase other-p4-x: status: done, completed: 2026-09-27'),
    c.runs.other.stdout)
  assert.deepEqual(classify(c.runs.demo, 'demo', c.runs.demo.touched, v), { 1: 'closed', 2: 'left open', 5: 'ambiguous' })
  assert.deepEqual(classify(c.runs.other, 'other', c.runs.other.touched, v), { 4: 'closed' })
}

test('ceremony closes exactly the touched finished phases; a re-run is a byte-for-byte no-op that reads them already closed', () => {
  const v = buildVault()
  const before = manifest(v)
  const c = ceremony(v)
  assertCeremonyResult(v, before, c)

  const mid = manifest(v)
  const again = ceremony(v)
  assert.deepEqual(manifest(v), mid, 'second run wrote something')
  for (const r of Object.values(again.runs)) assert.equal(r.code, 0, r.stdout + r.stderr)
  assert.deepEqual(classify(again.runs.demo, 'demo', again.runs.demo.touched, v),
    { 1: 'already closed', 2: 'left open', 5: 'ambiguous' })
  assert.deepEqual(classify(again.runs.other, 'other', again.runs.other.touched, v), { 4: 'already closed' })
})

test('a resumed ceremony reads a phase swept to Phases/Archive, or closed by hand, as already closed', () => {
  const v = buildVault()
  ceremony(v)
  const P = path.join(v, 'Work/Phases')
  fs.mkdirSync(path.join(P, 'Archive/2026'), { recursive: true })
  fs.renameSync(path.join(P, 'demo-p1-alpha.md'), path.join(P, 'Archive/2026/demo-p1-alpha.md'))
  const p2 = path.join(P, 'demo-p2-beta.md')
  fs.writeFileSync(p2, fs.readFileSync(p2, 'utf8').replace('status: open', 'status: done'))
  const again = ceremony(v)
  for (const r of Object.values(again.runs)) assert.equal(r.code, 0, r.stdout + r.stderr)
  assert.deepEqual(classify(again.runs.demo, 'demo', again.runs.demo.touched, v),
    { 1: 'already closed', 2: 'already closed', 5: 'ambiguous' })
})

test('a whole-line failure (exit 2, no sections printed) reads every phase on the line as failed', () => {
  const v = fs.mkdtempSync(path.join(os.tmpdir(), 'phase-close-nowork-'))
  tmps.push(v)
  const r = close(v, '--project demo --phases 1,2,5')
  assert.equal(r.code, 2, r.stdout + r.stderr)
  assert.equal(r.stdout, '')
  assert.match(r.stderr, /no Work\/ under --vault/)
  assert.deepEqual(classify(r, 'demo', [1, 2, 5], v), { 1: 'failed', 2: 'failed', 5: 'failed' })
})

test('positive control: unscoped, the fixture really does close p3 and p10 (so scoping kept them open)', () => {
  const v = buildVault()
  const r = run(['python3', path.join(root, 'skills/_shared/scripts/reconcile-project.py'), '--project', 'demo',
    '--vault', v, '--phases', '1,2,3,5,10', '--kinds', 'phase', '--apply', '--today', TODAY, '--no-gh'])
  assert.equal(r.code, 0, r.stdout + r.stderr)
  assert.deepEqual(classify(r, 'demo', [1, 2, 3, 5, 10], v),
    { 1: 'closed', 2: 'left open', 3: 'closed', 5: 'ambiguous', 10: 'closed' })
})

test('touched-phases: a rollout with only loose tasks prints nothing and exits 0', () => {
  const v = buildVault()
  const T = path.join(v, 'Work/Tasks')
  const loose = path.join(T, 'solo-rollout-2026-09-27.md')
  fs.writeFileSync(loose, fm(['tags: [task, rollout]', 'status: open']))
  fs.writeFileSync(path.join(T, 'solo-fix-thing.md'), fm(['tags: [task]', 'status: done',
    'rollout: "[[solo-rollout-2026-09-27]]"']))
  const t = touched(v, loose)
  assert.equal(t.code, 0, t.stderr)
  assert.equal(t.stdout, '')
})

test('touched-phases: the documented re-run path (rollout already archived) prints the same lines', () => {
  const v = buildVault()
  const moved = path.join(v, 'Work/Tasks/Archive/Rollouts', `${ROLLOUT}.md`)
  fs.mkdirSync(path.dirname(moved), { recursive: true })
  fs.renameSync(rolloutPath(v), moved)
  const t = touched(v, moved)
  assert.equal(t.code, 0, t.stderr)
  assert.equal(t.stdout, '--project demo --phases 1,2,5\n--project other --phases 4\n')
})

test('touched-phases: a missing rollout note exits 1 with ERROR on stderr', () => {
  const v = buildVault()
  const t = touched(v, path.join(v, 'Work/Tasks/nope-rollout-2026-09-27.md'))
  assert.equal(t.code, 1)
  assert.match(t.stderr, /ERROR/)
  assert.equal(t.stdout, '')
})

test('a phase write that fails exits 1 with the Errors line shape the bullet maps to failed', {
  skip: typeof process.getuid === 'function' && process.getuid() === 0 ? 'root ignores file modes' : false,
}, () => {
  const v = buildVault()
  const p1 = path.join(v, 'Work/Phases/demo-p1-alpha.md')
  fs.chmodSync(p1, 0o444)
  const r = close(v, '--project demo --phases 1,2,5')
  fs.chmodSync(p1, 0o644)
  assert.equal(r.code, 1, r.stdout + r.stderr)
  assert.ok(r.stdout.split('\n').some((l) => l.startsWith('  - phase demo-p1-alpha not written: ')), r.stdout)
  // exit 1 still printed its sections, so only the phase under Errors fails; its siblings keep their outcome.
  assert.deepEqual(classify(r, 'demo', [1, 2, 5], v), { 1: 'failed', 2: 'left open', 5: 'ambiguous' })
})

test('the documented phase-close follow-on note is inert to both commands', () => {
  const tpl = followupName(phaseBullet.raw)
  assert.ok(tpl, 'no follow-on filename in the bullet')
  const name = tpl.replace('<rollout-slug>', ROLLOUT)
  const followon = s5.bullets.find(others.followon)
  const yaml = fenceLines(followon.raw).map((l) => l
    .replace(/^projects:.*$/, 'projects: ["[[Demo]]"]')
    .replace(/^captured:.*$/, `captured: ${TODAY}`))
  const keys = yaml.map((l) => (l.match(/^([a-z_]+):/) || [])[1]).filter(Boolean)
  for (const k of ['priority', 'captured', 'contexts', 'scheduled', 'due', 'projects']) assert.ok(keys.includes(k), k)
  for (const k of ['rollout', 'wave', 'phase']) assert.ok(!keys.includes(k), k)
  const body = `---\n${yaml.join('\n')}\n---\n\nclose phase demo-p1: reconcile-project exited 1: boom\n`

  const plain = buildVault()
  const plainRun = ceremony(plain)
  const v = buildVault()
  const file = path.join(v, 'Work/Tasks', name)
  fs.writeFileSync(file, body)
  const before = manifest(v)
  const c = ceremony(v)
  assertCeremonyResult(v, before, c)
  assert.equal(norm(c.touched.stdout, v), norm(plainRun.touched.stdout, plain))
  for (const slug of ['demo', 'other']) {
    assert.equal(norm(c.runs[slug].stdout, v), norm(plainRun.runs[slug].stdout, plain), slug)
  }
  assert.equal(fs.readFileSync(file, 'utf8'), body)
})
