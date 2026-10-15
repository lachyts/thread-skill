// /thread:reflect's wiring (p15-5, ADR 0032; renamed by ADR 0037 d2, p21-1): execute's completion (and the
// template's manual one) offers a Reflection and never runs one, the verb is listed wherever its rollout siblings
// are, and its SKILL runs fold -> settings -> score -> Lachy's answer -> tune, with tune.py the only writer, run once
// per Reflection, and a Tuning taking effect at the next /thread:schedule. Its triggers name the rollout and never
// take Chorus's Companion (Chorus's own /reflect), and the retired name stays gone: no skills/ directory, verb,
// scratch path or noun of it in skills/**, hooks/**, evals/**, README.md or the manifests, but for ADR 0032's title
// in the README's ADR list (history).
//
// One pure function, check(files), over { name: text } plus `tree` (the paths under skills/) and `rest` ({ relPath:
// text } of every other file the retired-name scan reads): the real files and the controls run through it, and each
// control mutates one real entry in memory and must fail with exactly its rules. The retired name is built from
// parts (OLD), so this file never matches the task's Verify grep and adds no hit of its own. Reads files only.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { read, readIf, walk, root, collapse, FENCE } from '../lib/contract-text.mjs'

const OLD = ['re', 'tro'].join('')
const Old = OLD[0].toUpperCase() + OLD.slice(1)

// The named files, by key: `retired` scans the first six by their real path, `context` reads the last.
const NAMED = {
  execute: 'skills/execute/SKILL.md',
  template: 'skills/schedule/rollout-template.md',
  skill: 'skills/reflect/SKILL.md',
  readme: 'README.md',
  plugin: '.claude-plugin/plugin.json',
  market: '.claude-plugin/marketplace.json',
  context: 'CONTEXT.md',
}
const SCANNED = ['skill', 'execute', 'template', 'readme', 'plugin', 'market']

// The paths no scan reads: git-ignored `make evals` output (its transcripts can list an installed older verb),
// Python's byte-code caches and Finder's .DS_Store. A NUL-byte file is skipped where its text is read.
const skipped = (p) => p.split('/').includes('__pycache__') || path.basename(p) === '.DS_Store' || p.startsWith('evals/results/')

// { relPath: text } for every file under skills/, hooks/ and evals/ but the named ones and the skipped paths.
function restFiles() {
  const named = new Set(Object.values(NAMED))
  const out = {}
  const walkPruned = (dir) => {
    for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`
      if (skipped(rel) || skipped(`${rel}/`)) continue
      if (e.isDirectory()) walkPruned(rel)
      else if (e.isFile() && !named.has(rel)) {
        const buf = fs.readFileSync(path.join(root, rel))
        if (!buf.includes(0)) out[rel] = buf.toString('utf8')
      }
    }
  }
  for (const d of ['skills', 'hooks', 'evals']) if (fs.existsSync(path.join(root, d))) walkPruned(d)
  return out
}

const real = {
  ...Object.fromEntries(Object.entries(NAMED).map(([k, p]) => [k, readIf(p) ?? ''])),
  tree: walk('skills'),
  rest: restFiles(),
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

// The SKILL's frontmatter as { name, description } (the description unquoted from YAML's single quotes), or {}.
function frontmatter(text) {
  const lines = text.split('\n')
  if (lines[0] !== '---') return {}
  const close = lines.indexOf('---', 1)
  if (close < 0) return {}
  const fm = {}
  for (const l of lines.slice(1, close)) {
    const m = l.match(/^([a-z_-]+): (.*)$/)
    if (!m) continue
    const v = m[2]
    fm[m[1]] = v.startsWith("'") && v.endsWith("'") ? v.slice(1, -1).replaceAll("''", "'") : v
  }
  return fm
}

// The CONTEXT.md glossary entry that starts with `head`, up to the next entry, heading or blank line.
function entry(text, head) {
  const lines = text.split('\n')
  const i = lines.findIndex((l) => l.startsWith(head))
  if (i < 0) return null
  const out = [lines[i]]
  for (const l of lines.slice(i + 1)) {
    if (/^- \*\*|^#|^\s*$/.test(l)) break
    out.push(l)
  }
  return out.join('\n')
}

const OFFER = 'the Reflection line `Reflection: offered as /thread:reflect [[<rollout-slug>]], not run (a Reflection needs Lachy\'s picks, so the ceremony never runs one, attended or not)`'
const CHAT = 'At completion the report ends with one more line, in chat only (never written to the note): `Reflection: /thread:reflect [[<rollout-slug>]]`'
const TEMPLATE_CHAT = 'Then offer it in chat: `Reflection: /thread:reflect [[<rollout-slug>]]`.'
const RETIRED = [new RegExp(`thread:${OLD}\\b`), new RegExp(`skills/${OLD}\\b`), new RegExp(`thread-${OLD}-`)]
const NOUN = new RegExp(`\\b${OLD}s?\\b`, 'i')
const ADR_TITLE = new RegExp(`\\btune by ${Old}\\b`) // ADR 0032's title in the README's ADR list: history
const KEPT = ['skills/reflect/SKILL.md', 'skills/reflect/scripts/score.py', 'skills/reflect/scripts/tune.py']

// The rules that fail, in a fixed order. `notes` collects one line per retired-name finding.
function check(files, notes = []) {
  const fails = []
  const bullets = stepFive(files.execute)
  const log = bullets.find((b) => b.startsWith('   - Append a `## Completion log`'))
  const move = bullets.findIndex((b) => b.startsWith('   - Move the rollout note'))
  if (!log || !collapse(log).includes(OFFER) || !collapse(log).includes('An unattended Stop-driver run writes the same line') ||
    move < 0 || bullets.slice(move + 1).some((b) => /\/thread:reflect|\bReflection\b/.test(b))) fails.push('log')
  if (!collapse(files.execute).includes(CHAT)) fails.push('report')
  // the manual completion ceremony (a run that ended early or ran --gated) offers a Reflection the same way
  const manual = files.template.split('\n').find((l) => l.startsWith('4. Append a `## Completion log`')) || ''
  if (!collapse(manual).includes(OFFER) || !collapse(manual).includes(TEMPLATE_CHAT) ||
    !/so a Reflection \(`\/thread:reflect \[\[<rollout-slug>\]\]`\) proposes changes/.test(files.template)) fails.push('template')
  if (!/^\| `\/thread:reflect` \| tuner \| .*tune script.*`tunings\.jsonl`/m.test(files.readme)) fails.push('readme')
  let plugin = ''
  let market = {}
  try { plugin = JSON.parse(files.plugin).description } catch { /* fails below */ }
  try { market = JSON.parse(files.market) } catch { /* fails below */ }
  if (!plugin.includes('thread:status and thread:repair for oversight and thread:reflect to score a run and propose Tunings') ||
    !(market.description || '').includes('/thread:schedule, /thread:execute, /thread:status, /thread:repair, /thread:reflect)') ||
    !(market.plugins?.[0]?.description || '').includes('rollout family (schedule/execute/status/repair/reflect: a queue of tasks')) fails.push('manifests')
  const s = files.skill
  const order = [/reconcile-rollout\.py fold-journals --rollout/, /rollout-settings\.py --repo <Project root>/, /land\.sh --origin-slug <Project root>/,
    /reflect\/scripts\/score\.py --rollout/, /^### 6\. Lachy answers$/, /reflect\/scripts\/tune\.py --scores/].map((re) => lineIndex(s, re))
  if (order.some((i) => i < 0) || order.some((i, k) => k > 0 && i <= order[k - 1])) fails.push('order')
  const fenced = fencedLines(s)
  if (!/`skills\/reflect\/scripts\/tune\.py` is the \*\*only writer\*\* of `rollouts\.toml` and of `tunings\.jsonl`/.test(s) ||
    !/runs tune\.py \*\*exactly once\*\*/.test(s) ||
    fenced.some((l) => /rollouts\.toml|tunings\.jsonl/.test(l)) ||
    fenced.filter((l) => /tune\.py/.test(l)).some((l) => !/^python3 \$\{CLAUDE_PLUGIN_ROOT\}\/skills\/reflect\/scripts\/tune\.py --scores /.test(l))) fails.push('writer')
  if (!collapse(s).includes('A picked Tuning takes effect at the next `/thread:schedule` (or its `--regenerate`, which stamps freshly resolved values)') ||
    !collapse(s).includes('A rollout note already stamped, running, paused or not yet started, keeps its own frontmatter values')) fails.push('effect')
  // the triggers name the rollout, never Chorus's Companion, and the description sends the Companion to Chorus
  const fm = frontmatter(s)
  const desc = fm.description || ''
  const from = desc.indexOf('Triggers on')
  const to = from < 0 ? -1 : desc.indexOf('/thread:reflect', from)
  const triggers = to < 0 ? '' : desc.slice(from, to + '/thread:reflect'.length)
  if (fm.name !== 'reflect' || !triggers.includes('"reflect on [[rollout]]"') || !triggers.includes('"how did the rollout run"') ||
    triggers.includes('Companion') || !desc.includes('Not for Chorus\'s Companion record')) fails.push('triggers')
  // the old skill directory holds no tracked content (a leftover byte-code cache or .DS_Store aside)
  if (files.tree.some((p) => p.startsWith(`skills/${OLD}/`) && !skipped(p)) || KEPT.some((p) => !files.tree.includes(p))) fails.push('tree')
  // the retired name, in any form, over the product files
  const scan = { ...Object.fromEntries(SCANNED.map((k) => [NAMED[k], files[k]])), ...files.rest }
  let titles = 0
  let retired = false
  for (const [rel, text] of Object.entries(scan)) {
    if (skipped(rel) || text.includes('\0')) continue
    text.split('\n').forEach((l, i) => {
      const verb = RETIRED.some((re) => re.test(l))
      const noun = NOUN.test(l)
      if (!verb && !noun) return
      if (!verb && rel === 'README.md' && ADR_TITLE.test(l) && ++titles <= 1) return
      retired = true
      notes.push(`retired: ${rel}:${i + 1} ${l.trim().slice(0, 120)}`)
    })
  }
  if (retired) fails.push('retired')
  const glossary = entry(files.context, '- **Reflection** — ')
  if (!glossary || !collapse(glossary).includes('Its verb is `/thread:reflect`')) fails.push('context')
  return fails
}

test('the reflect verb is wired: execute offers it, the manifests and README list it, its SKILL keeps its order and triggers, the old name is gone', () => {
  const notes = []
  assert.deepEqual(check(real, notes), [], notes.join('\n'))
})

test('the scan is not vacuous: rest reads the scripts, the hook, the skill tests and the eval cases', () => {
  for (const p of ['skills/reflect/scripts/tune.py', 'hooks/rollout-stop-driver.py',
    'skills/execute/tests/reconcile-rollout-record.test.sh', 'evals/routing/rollout/reflect-score-the-run/prompt.md']) {
    assert.ok(p in real.rest, `${p} is scanned`)
  }
  for (const p of Object.values(NAMED)) assert.ok(!(p in real.rest), `${p} is read by its key, not twice`)
})

// ---- controls ---------------------------------------------------------------------------------------------

const only = (name, mut, rules) => {
  const key = name.split(':')[0]
  assert.notDeepEqual(mut, real[key], `control setup changed nothing: ${name}`)
  assert.deepEqual(check({ ...real, [key]: mut }), rules, name)
}
const swap = (key, from, to) => {
  assert.ok(real[key].includes(from), `control setup: ${from.slice(0, 60)} not in ${key}`)
  return real[key].replace(from, to)
}

test('control: the Completion-log item gone, or a reflect bullet after the move, fails log', () => {
  only('execute', swap('execute', ', not run (a Reflection needs Lachy\'s picks', ', run (a Reflection needs Lachy\'s picks'), ['log'])
  const moveLine = real.execute.split('\n').find((l) => l.startsWith('   - Move the rollout note'))
  only('execute:after', swap('execute', moveLine, `${moveLine}\n   - Run /thread:reflect [[<rollout-slug>]] once the note is archived.`), ['log'])
})

test('control: the manual ceremony without the Reflection line, its chat offer, or the ceiling line not naming the verb, fails template', () => {
  only('template', swap('template', ', and the Reflection line `Reflection: offered as', ', and the line `Reflection: offered as'), ['template'])
  only('template:verb', swap('template', 'so a Reflection (`/thread:reflect [[<rollout-slug>]]`) proposes', 'so a Reflection proposes'), ['template'])
  only('template:chat', swap('template', TEMPLATE_CHAT, 'Then offer it in chat.'), ['template'])
})

test('control: the chat-only report line gone fails report', () => {
  only('execute', swap('execute', 'in chat only (never written to the note): `Reflection: /thread:reflect [[<rollout-slug>]]`', 'in the note: `Reflection: run`'), ['report'])
})

test('control: the README row gone fails readme; the row or a line naming the old name fails retired', () => {
  only('readme', swap('readme', '| `/thread:reflect` | tuner |', '| `/thread:reflect` | scorer |'), ['readme'])
  only('readme:old', swap('readme', '| `/thread:reflect` | tuner |', `| \`/thread:${OLD}\` | tuner |`), ['readme', 'retired'])
  only('readme:noun', swap('readme', 'one line per Reflection.', `one line per ${Old}.`), ['retired'])
})

test('control: each manifest string without reflect fails manifests', () => {
  only('plugin', swap('plugin', ' and thread:reflect to score a run and propose Tunings', ''), ['manifests'])
  only('market', swap('market', ', /thread:reflect)', ')'), ['manifests'])
  only('market:entry', swap('market', 'schedule/execute/status/repair/reflect:', 'schedule/execute/status/repair:'), ['manifests'])
})

test('control: tune before the score, or before Lachy answers, fails order', () => {
  only('skill', swap('skill', '### 6. Lachy answers', '### 6. Lachy answered'), ['order'])
  const tuneFirst = swap('skill', '### 2. Fold the Workflow journals (idempotent)\n', '### 2. Fold the Workflow journals (idempotent)\n\n```\npython3 ${CLAUDE_PLUGIN_ROOT}/skills/reflect/scripts/tune.py --scores /tmp/x/score.json --record-only\n```\n')
  only('skill:tune-first', tuneFirst, ['order'])
})

test('control: a second writer or a lost "exactly once" fails writer', () => {
  only('skill', swap('skill', 'runs tune.py **exactly once**', 'runs tune.py'), ['writer'])
  only('skill:sed', swap('skill', 'mkdir -p /tmp/thread-reflect-<rollout-slug>\n', 'mkdir -p /tmp/thread-reflect-<rollout-slug>\nsed -i "" "s/= 3/= 4/" ~/.config/thread/rollouts.toml\n'), ['writer'])
})

test('control: the takes-effect sentence gone fails effect', () => {
  only('skill', swap('skill', 'A picked Tuning takes effect at the next `/thread:schedule`', 'A picked Tuning takes effect at once'), ['effect'])
})

test('control: a trigger dropped, or a Companion trigger added, fails triggers', () => {
  only('skill:triggers', swap('skill', '"reflect on [[rollout]]", ', ''), ['triggers'])
  only('skill:companion', swap('skill', '"how did the rollout run", ', '"how did the rollout run", "how did the Companion do", '), ['triggers'])
})

test('control: the old scratch path or the old noun in the SKILL fails retired', () => {
  only('skill:retired', swap('skill', '`/tmp/thread-reflect-<rollout-slug>/`', `\`/tmp/thread-${OLD}-<rollout-slug>/\``), ['retired'])
  only('skill:noun', swap('skill', 'stops the Reflection', `stops the ${Old}`), ['retired'])
})

test('control: tracked content under the old directory, or the SKILL gone, fails tree; a byte-code cache does not', () => {
  only('tree:dir', [...real.tree, `skills/${OLD}/SKILL.md`].sort(), ['tree'])
  only('tree:gone', real.tree.filter((p) => p !== 'skills/reflect/SKILL.md'), ['tree'])
  only('tree:cache', [...real.tree, `skills/${OLD}/scripts/__pycache__/x.pyc`, `skills/${OLD}/.DS_Store`].sort(), [])
})

test('control: a hook naming the old verb fails retired; eval output, a byte-code cache and a binary do not', () => {
  const hook = 'hooks/rollout-stop-driver.py'
  assert.ok(hook in real.rest, `control setup: ${hook} not in rest`)
  only('rest:hook', { ...real.rest, [hook]: `${real.rest[hook]}\n# offer \`thread:${OLD}\` at the end\n` }, ['retired'])
  only('rest:results', { ...real.rest, 'evals/results/x/run.json': `{"skill":"thread:${OLD}"}\n` }, [])
  only('rest:pycache', { ...real.rest, 'skills/reflect/scripts/__pycache__/tune.cpython-312.pyc': `skills/${OLD}/scripts/tune.py\n` }, [])
  only('rest:binary', { ...real.rest, 'skills/reflect/scripts/blob.bin': `\0thread:${OLD}\n` }, [])
})

test('control: the glossary entry not naming the verb fails context', () => {
  only('context', swap('context', 'Its verb is `/thread:reflect`', 'Its verb is `/thread:tune`'), ['context'])
})
