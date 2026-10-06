// /thread:retro's wiring (p15-5, ADR 0032): execute's completion offers a Retro and never runs one, the verb is
// listed wherever its rollout siblings are, and its SKILL runs fold -> settings -> score -> Lachy's answer -> tune,
// with tune.py the only writer, run once per Retro, and a Tuning taking effect at the next /thread:schedule.
//
// One pure function, check(files), over { name: text }: the real files and the controls run through it, and each
// control mutates one real file in memory and must fail with exactly its rule. Reads files only.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { read, collapse, FENCE } from '../lib/contract-text.mjs'

const real = {
  execute: read('skills/execute/SKILL.md'),
  skill: read('skills/retro/SKILL.md'),
  readme: read('README.md'),
  plugin: read('.claude-plugin/plugin.json'),
  market: read('.claude-plugin/marketplace.json'),
}

// Execute § 4.5 step 5's bullets (three-space `- ` items up to the first blank line outside a fence).
function stepFive(text) {
  const lines = text.split('\n')
  const head = lines.findIndex((l) => /^5\. \*\*Completion\.\*\*/.test(l))
  if (head < 0) return []
  const bullets = []
  let fence = false
  for (let i = head + 1; i < lines.length; i++) {
    const l = lines[i]
    if (FENCE.test(l)) fence = !fence
    else if (!fence && /^\s*$/.test(l)) break
    if (!fence && /^ {3}- /.test(l)) bullets.push(l)
    else if (bullets.length) bullets[bullets.length - 1] += `\n${l}`
  }
  return bullets
}

// The index of the first line matching `re`, or -1.
const lineIndex = (text, re) => text.split('\n').findIndex((l) => re.test(l))

function fencedLines(text) {
  const out = []
  let fence = false
  for (const l of text.split('\n')) {
    if (FENCE.test(l)) { fence = !fence; continue }
    if (fence) out.push(l)
  }
  return out
}

function check(files) {
  const fails = []
  const bullets = stepFive(files.execute)
  const log = bullets.find((b) => b.startsWith('   - Append a `## Completion log`'))
  const move = bullets.findIndex((b) => b.startsWith('   - Move the rollout note'))
  if (!log || !collapse(log).includes('the Retro line `Retro: offered as /thread:retro [[<rollout-slug>]], not run (a Retro needs Lachy\'s picks, so the ceremony never runs one, attended or not)`') ||
    !collapse(log).includes('An unattended Stop-driver run writes the same line') ||
    move < 0 || bullets.slice(move + 1).some((b) => /retro/i.test(b))) fails.push('log')
  if (!collapse(files.execute).includes('At completion the report ends with one more line, in chat only (never written to the note): `Retro: /thread:retro [[<rollout-slug>]]`')) fails.push('report')
  if (!/^\| `\/thread:retro` \| tuner \| .*tune script.*`tunings\.jsonl`/m.test(files.readme)) fails.push('readme')
  let plugin = ''
  let market = {}
  try { plugin = JSON.parse(files.plugin).description } catch { /* fails below */ }
  try { market = JSON.parse(files.market) } catch { /* fails below */ }
  if (!plugin.includes('thread:status and thread:repair for oversight and thread:retro to score a run and propose Tunings') ||
    !(market.description || '').includes('/thread:schedule, /thread:execute, /thread:status, /thread:repair, /thread:retro)') ||
    !(market.plugins?.[0]?.description || '').includes('rollout family (schedule/execute/status/repair/retro: a queue of tasks')) fails.push('manifests')
  const s = files.skill
  const order = [/reconcile-rollout\.py fold-journals --rollout/, /rollout-settings\.py --repo <Project root>/, /land\.sh --origin-slug <Project root>/,
    /retro\/scripts\/score\.py --rollout/, /^### 6\. Lachy answers$/, /retro\/scripts\/tune\.py --scores/].map((re) => lineIndex(s, re))
  if (order.some((i) => i < 0) || order.some((i, k) => k > 0 && i <= order[k - 1])) fails.push('order')
  const fenced = fencedLines(s)
  if (!/`skills\/retro\/scripts\/tune\.py` is the \*\*only writer\*\* of `rollouts\.toml` and of `tunings\.jsonl`/.test(s) ||
    !/runs tune\.py \*\*exactly once\*\*/.test(s) ||
    fenced.some((l) => /rollouts\.toml|tunings\.jsonl/.test(l)) ||
    fenced.filter((l) => /tune\.py/.test(l)).some((l) => !/^python3 \$\{CLAUDE_PLUGIN_ROOT\}\/skills\/retro\/scripts\/tune\.py --scores /.test(l))) fails.push('writer')
  if (!collapse(s).includes('A picked Tuning takes effect at the next `/thread:schedule` (or its `--regenerate`, which stamps freshly resolved values)') ||
    !collapse(s).includes('A rollout note already stamped, running, paused or not yet started, keeps its own frontmatter values')) fails.push('effect')
  return fails
}

test('the retro verb is wired: execute offers it, the manifests and README list it, its SKILL keeps its order', () => {
  assert.deepEqual(check(real), [])
})

// ---- controls ---------------------------------------------------------------------------------------------

const only = (name, mut, rules) => {
  assert.notEqual(mut, real[name.split(':')[0]], `control setup changed nothing: ${name}`)
  assert.deepEqual(check({ ...real, [name.split(':')[0]]: mut }), rules, name)
}
const swap = (key, from, to) => {
  assert.ok(real[key].includes(from), `control setup: ${from.slice(0, 60)} not in ${key}`)
  return real[key].replace(from, to)
}

test('control: the Completion-log item gone, or a retro bullet after the move, fails log', () => {
  only('execute', swap('execute', ', not run (a Retro needs Lachy\'s picks', ', run (a Retro needs Lachy\'s picks'), ['log'])
  const moveLine = real.execute.split('\n').find((l) => l.startsWith('   - Move the rollout note'))
  only('execute:after', swap('execute', moveLine, `${moveLine}\n   - Run /thread:retro [[<rollout-slug>]] once the note is archived.`), ['log'])
})

test('control: the chat-only report line gone fails report', () => {
  only('execute', swap('execute', 'in chat only (never written to the note): `Retro: /thread:retro [[<rollout-slug>]]`', 'in the note: `Retro: run`'), ['report'])
})

test('control: the README row gone fails readme', () => {
  only('readme', swap('readme', '| `/thread:retro` | tuner |', '| `/thread:retro` | scorer |'), ['readme'])
})

test('control: each manifest string without retro fails manifests', () => {
  only('plugin', swap('plugin', ' and thread:retro to score a run and propose Tunings', ''), ['manifests'])
  only('market', swap('market', ', /thread:retro)', ')'), ['manifests'])
  only('market:entry', swap('market', 'schedule/execute/status/repair/retro:', 'schedule/execute/status/repair:'), ['manifests'])
})

test('control: tune before the score, or before Lachy answers, fails order', () => {
  only('skill', swap('skill', '### 6. Lachy answers', '### 6. Lachy answered'), ['order'])
  const tuneFirst = real.skill.replace('### 2. Fold the Workflow journals (idempotent)\n', '### 2. Fold the Workflow journals (idempotent)\n\n```\npython3 ${CLAUDE_PLUGIN_ROOT}/skills/retro/scripts/tune.py --scores /tmp/x/score.json --record-only\n```\n')
  only('skill:tune-first', tuneFirst, ['order'])
})

test('control: a second writer or a lost "exactly once" fails writer', () => {
  only('skill', swap('skill', 'runs tune.py **exactly once**', 'runs tune.py'), ['writer'])
  only('skill:sed', swap('skill', 'mkdir -p /tmp/thread-retro-<rollout-slug>\n', 'mkdir -p /tmp/thread-retro-<rollout-slug>\nsed -i "" "s/= 3/= 4/" ~/.config/thread/rollouts.toml\n'), ['writer'])
})

test('control: the takes-effect sentence gone fails effect', () => {
  only('skill', swap('skill', 'A picked Tuning takes effect at the next `/thread:schedule`', 'A picked Tuning takes effect at once'), ['effect'])
})
