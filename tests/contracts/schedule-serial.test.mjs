// Schedule writes serial rollouts (ADR 0040, p24-2): the prose and templates around serial-chains.py and the
// serial check (their behaviour is pinned by tests/serial-chains.test.sh and tests/unfinished-rollout.test.sh S1-S12).
// Nine rules, one pure function, check(files), over { relPath: text }:
//   t1  the templates: the parallel template says `shape: parallel`; the serial one says `shape: serial`,
//       `protocol_version: 5`, `incomplete: true` and `surfaces:` + `{{SURFACES}}`, holds none of the parallel
//       engine's keys, and its `## Queue` holds `{{CHAIN_TABLE}}`, whose SKILL bullet names the four-column header,
//       a Task cell with step 6's `<short-alias>` (never the launch alias) and the Leg boundary
//       (schedule-queue.test.mjs and execution-fit-shapes.test.mjs keep the retired words out of it, as of every
//       schedule file);
//   t2  schedule's `## Serial path` comes after step 8 and holds no `###` heading (so step 8's section and the
//       contract helpers' section() read as before), and no product file still holds p24-1's interim stop;
//   t3  the Serial path's steps name serial-chains.py, the serial check with `--surface`, ruling (c)'s session lane,
//       one note per chain from serial-rollout-template.md, rollout-settings.py with its single-repo `--repo` rule,
//       the stamps S6 never writes, the stamp it removes last, no execute offer and no `start: unattended`, and
//       body-read surfaces only for members that declare none; and the Don'ts let S6's last write remove
//       `incomplete: true` beside step 7's, a stamp left on a serial note ending only by `status: dropped`;
//   t4  § 0's first check span is the parallel one, with `--shape parallel` and `--regenerate`, and a supersede
//       never crosses shapes;
//   t5  execute § 2's shape line, orient § 6's § 0 stop naming a live serial chain on the repo and its
//       `status: dropped` remedy, orient § 7's one note per chain, orient § 9's no-offer sentence for a serial
//       note, and the vault grammar's parallel-only Writers clause;
//   t6  CONTEXT.md's **Rollout**, **Shape**, **Serial rollout**, **Unfinished rollout**, **Surface** and
//       **Incomplete rollout** entries (a serial note's stamp ends only by `status: dropped`);
//   t7  § 0's mixed-set sentence gives the serial-shaped members their follow-up line;
//   t8  S3 checks every chain, stops the whole run before any write on any refusal, and reports every refusal
//       together;
//   t9  the schedule description names the parallel refusal and the serial notes.
// Each rule has a mutation control that must fail with exactly that rule. Phrase checks run on collapsed text.
// __pycache__, .DS_Store and any file holding a NUL byte are skipped. Reads files only.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { collapse, root, section, slice } from '../lib/contract-text.mjs'

const SCHEDULE = 'skills/schedule/SKILL.md'
const TEMPLATE = 'skills/schedule/rollout-template.md'
const SERIAL = 'skills/schedule/serial-rollout-template.md'
const EXECUTE = 'skills/execute/SKILL.md'
const ORIENT = 'skills/orient/SKILL.md'
const GRAMMAR = 'skills/_shared/vault-grammar.md'
const CONTEXT = 'CONTEXT.md'
const INTERIM = 'no serial writer yet'

const SKILL_TESTS = /^skills\/[^/]+\/tests\//
const isProduct = (rel) => (rel.startsWith('skills/') && !SKILL_TESTS.test(rel)) || rel.startsWith('hooks/') ||
  rel === 'README.md' || rel === CONTEXT

// Every product text file, as { relPath: text }.
function readTree() {
  const files = {}
  const add = (rel) => {
    const buf = fs.readFileSync(path.join(root, rel))
    if (!buf.includes(0)) files[rel] = buf.toString('utf8')
  }
  const walk = (dir) => {
    for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      if (e.name === '__pycache__' || e.name === '.DS_Store') continue
      const rel = `${dir}/${e.name}`
      if (e.isDirectory()) walk(rel)
      else if (e.isFile() && isProduct(rel)) add(rel)
    }
  }
  for (const d of ['skills', 'hooks']) walk(d)
  for (const f of ['README.md', CONTEXT]) add(f)
  return files
}

const C = (s) => (s == null ? '' : collapse(s))
const frontmatter = (text) => (text ?? '').match(/^---\n([\s\S]*?)\n---\n/)?.[1] ?? ''
const sentences = (text) => C(text).split(/(?<=[.!?])\s+/)
// The blank-line paragraph of `text` that starts with `label`, collapsed; '' when absent.
const para = (text, label) => C((text ?? '').split(/\n\s*\n/).find((p) => p.trimStart().startsWith(label)) ?? '')
// A CONTEXT.md entry: its `- **<name>**` line up to the next top-level entry.
const entry = (text, name) => C(slice(text, new RegExp(`^- \\*\\*${name}\\*\\* — `), /^- \*\*/))
const spans = (text) => [...(text ?? '').matchAll(/`([^`]+)`/g)].map((m) => m[1])

function check(files) {
  const fails = new Set()
  const details = []
  const flag = (rule, why) => { fails.add(rule); details.push(`${rule}: ${why}`) }
  const need = (rule, name, text, patterns) => {
    for (const p of patterns) {
      const ok = typeof p === 'string' ? (text ?? '').includes(p) : p.test(text ?? '')
      if (!ok) flag(rule, `${name} does not contain ${p}`)
    }
  }
  const schedule = files[SCHEDULE] ?? ''
  const serialPath = slice(schedule, /^## Serial path$/, /^## (?!Serial path$)/) ?? ''
  const sp = C(serialPath)

  // ---- t1: the templates ----
  if (!/^shape: parallel\b/m.test(frontmatter(files[TEMPLATE]))) flag('t1', `${TEMPLATE} frontmatter has no shape: parallel`)
  const sfm = frontmatter(files[SERIAL])
  for (const re of [/^shape: serial$/m, /^protocol_version: 5$/m, /^incomplete: true\b/m, /^surfaces:\n\{\{SURFACES\}\}$/m]) {
    if (!re.test(sfm)) flag('t1', `${SERIAL} frontmatter does not match ${re}`)
  }
  for (const k of ['Project root:', 'verifier', 'parallel_ceiling', 'max_', 'plan_approval', 'start:']) {
    if ((files[SERIAL] ?? '').includes(k)) flag('t1', `${SERIAL} holds ${k}`)
  }
  if (!(section(files[SERIAL], /^## Queue$/) ?? '').includes('{{CHAIN_TABLE}}')) flag('t1', `${SERIAL} ## Queue has no {{CHAIN_TABLE}}`)
  const chainBullet = schedule.split('\n').find((l) => l.startsWith('- `{{CHAIN_TABLE}}` — ')) ?? ''
  need('t1', `${SCHEDULE} {{CHAIN_TABLE}} bullet`, chainBullet, ['`| # | Task | Launch | Surfaces |`', 'Leg boundary',
    '`| <n> | [[<full-slug>\\|<short-alias>]] | <launch> | <tokens> |`'])

  // ---- t2: where the Serial path sits, and no interim stop left ----
  const lines = schedule.split('\n')
  const s8At = lines.findIndex((l) => /^### 8\. /.test(l))
  const spAt = lines.indexOf('## Serial path')
  if (s8At < 0 || spAt < s8At) flag('t2', `${SCHEDULE} has no ## Serial path after ### 8.`)
  if (serialPath.split('\n').some((l) => /^###\s/.test(l))) flag('t2', `${SCHEDULE} ## Serial path holds a ### heading`)
  for (const [rel, text] of Object.entries(files)) if (isProduct(rel) && text.includes(INTERIM)) flag('t2', `${rel} still holds ${INTERIM}`)

  // ---- t3: the Serial path's steps ----
  need('t3', `${SCHEDULE} § Serial path`, sp, [
    'serial-chains.py plan', "ruling (c)'s session lane", 'one **serial rollout** note per chain',
    '`${CLAUDE_PLUGIN_ROOT}/skills/schedule/serial-rollout-template.md`',
    'skills/_shared/scripts/rollout-settings.py`, with `--repo <path>` exactly when the chain holds one `repo:` token',
  ])
  const s2 = para(serialPath, '**S2. Plan.**')
  if (!sentences(s2).some((x) => x.includes('`--surface <slug>=<path>`') && x.includes('only for a member with no declared `surfaces:`'))) {
    flag('t3', 'S2 does not limit a body-read --surface to members that declare no surfaces:')
  }
  const s3 = para(serialPath, '**S3. Live chains.**')
  if (!spans(s3).some((x) => x.includes('unfinished-rollout.py check --shape serial') && x.includes('--surface'))) {
    flag('t3', 'S3 does not run unfinished-rollout.py check --shape serial --surface')
  }
  const s6 = para(serialPath, '**S6. Stamp.**')
  need('t3', 'S6', s6, ['no `scope:`, `plan_approval:`, `rung:` or `solo:`', 'never a derived or added `surfaces:`'])
  if (!sentences(s6).some((x) => /\bremove\b/i.test(x) && x.includes('`incomplete: true`') && x.includes('last write'))) {
    flag('t3', 'S6 does not remove incomplete: true as its last write')
  }
  need('t3', 'S7', para(serialPath, '**S7. Summary.**'), ['no execute offer, no `start: unattended`'])
  const dont = schedule.split('\n').find((l) => l.startsWith('- Never remove `incomplete: true`')) ?? ''
  need('t3', `${SCHEDULE} Don't on incomplete: true`, C(dont), ["except as step 7's (or § Serial path S6's) last write",
    'and one on a serial note, which a supersede never takes, ends only by `status: dropped`'])

  // ---- t4: § 0's parallel check, and no supersede across shapes ----
  const s0 = C(section(schedule, /^### 0\./))
  const first = spans(s0).find((x) => x.includes('unfinished-rollout.py check')) ?? ''
  if (!first.includes('--shape parallel') || !first.includes('--regenerate')) flag('t4', `§ 0's first check span is not the parallel one: ${first}`)
  if (!s0.includes('a supersede never crosses shapes')) flag('t4', '§ 0 does not say a supersede never crosses shapes')

  // ---- t5: execute, orient and the vault grammar ----
  need('t5', `${EXECUTE} § 2`, section(files[EXECUTE], /^### 2\. /) ?? '', [
    'Then the shape (`shape:`; no key reads as parallel): `shape: serial` → print `serial rollouts have no Leg runner yet: nothing runs` and stop; nothing is written and a `start: unattended` stays (p24-3 replaces this line).',
  ])
  const stop = C(slice(files[ORIENT], /^ {2}- \*\*Schedule stopped at § 0\*\*/, /^ {2}- \*\*Uncommitted grill docs\.\*\*/))
  need('t5', `${ORIENT} § 6's § 0 stop`, stop, ['or a live serial chain that writes the repo and so owns it',
    '`status: dropped` on a never-started serial chain\'s note'])
  need('t5', `${ORIENT} § 7`, C(section(files[ORIENT], /^### 7\./)), ['one serial rollout note per chain'])
  need('t5', `${ORIENT} § 9`, C(section(files[ORIENT], /^### 9\./)), [
    'one offer per parallel note written; a serial note (`shape: serial`) gets no offer until execute runs Legs (p24-3)',
  ])
  const writers = C(slice(files[GRAMMAR], /^- \*\*Writers\*\*/, /^- \*\*Readers\*\*/))
  need('t5', `${GRAMMAR} Writers`, writers, ['on a parallel note only until execute runs Legs (p24-3)'])

  // ---- t6: the glossary ----
  const ctx = files[CONTEXT] ?? ''
  need('t6', 'CONTEXT **Rollout**', entry(ctx, 'Rollout'), ['and none on a place a live serial chain writes', 'one chain per note'])
  need('t6', 'CONTEXT **Shape**', entry(ctx, 'Shape'), ['`shape:` key', 'reads as parallel', 'A supersede never crosses shapes'])
  need('t6', 'CONTEXT **Serial rollout**', entry(ctx, 'Serial rollout'), ['One chain per note', 'Leg boundary'])
  need('t6', 'CONTEXT **Unfinished rollout**', entry(ctx, 'Unfinished rollout'), ['both shapes meet in the same check'])
  need('t6', 'CONTEXT **Incomplete rollout**', entry(ctx, 'Incomplete rollout'), ['or S5 on § Serial path',
    "until step 7's last write (S6's) removes it",
    'the stamp on a serial note, which a supersede never takes, ends only by `status: dropped`'])
  need('t6', 'CONTEXT **Surface**', entry(ctx, 'Surface'), [
    '`repo:<absolute path>`', '`vault:<path>`', '`ext:<name>`', '`any`', "widens to that checkout's toplevel",
    'declared or derived', 'Working roots', '_Avoid_: footprint, file-set',
  ])

  // ---- t7: the mixed set's follow-up line ----
  const mixed = sentences(section(schedule, /^### 0\./)).find((x) => x.startsWith('A mixed set is fine')) ?? ''
  if (!mixed.includes('`/thread:schedule --tasks <serial members>`')) flag('t7', `§ 0's mixed-set sentence has no follow-up line: ${mixed}`)

  // ---- t8: S3 checks every chain and stops on any refusal, reporting all of them ----
  need('t8', 'S3', s3, ['Every chain is checked', 'Any refusal', 'stops the whole run before anything is written',
    "every refusal's stderr goes in one report"])

  // ---- t9: the description ----
  const d = schedule.match(/^description: (.*)$/m)?.[1] ?? ''
  need('t9', `${SCHEDULE} description`, d, ['refuses a second unfinished parallel rollout', '`shape: serial` note per serial chain'])

  return { fails: [...fails].sort(), details }
}

const real = readTree()

test('schedule writes serial rollouts: templates, the Serial path, § 0, execute, orient, the grammar and the glossary', () => {
  const { fails, details } = check(real)
  assert.deepEqual(fails, [], details.join('\n'))
})

test('the scan reads every file the rules need', () => {
  for (const f of [SCHEDULE, TEMPLATE, SERIAL, EXECUTE, ORIENT, GRAMMAR, CONTEXT, 'README.md']) assert.ok(f in real, `${f} is not scanned`)
})

// ---- controls: each mutates the real files in memory and must fail with exactly its rule ----------------

const only = (mut, rules, label) => {
  const { fails, details } = check({ ...real, ...mut })
  assert.deepEqual(fails, rules, `${label}\n${details.join('\n')}`)
}
const swap = (rel, from, to) => {
  assert.ok(real[rel]?.includes(from), `control setup: ${String(from).slice(0, 60)} not in ${rel}`)
  return { [rel]: real[rel].replace(from, to) }
}

test('control: a parallel template without shape: parallel fails t1', () => {
  only(swap(TEMPLATE, '\nshape: parallel', '\n# shape: parallel'), ['t1'], 'no parallel shape')
})

test('control: a serial template carrying a Project root or a ceiling fails t1', () => {
  only(swap(SERIAL, '\nshape: serial\n', '\nshape: serial\nparallel_ceiling: 4\n'), ['t1'], 'ceiling')
  only(swap(SERIAL, '{{THREAD_LINE}}', 'Project root: `~/x`\n{{THREAD_LINE}}'), ['t1'], 'project root')
})

test('control: a serial template whose Queue lost {{CHAIN_TABLE}} fails t1', () => {
  only(swap(SERIAL, '\n{{CHAIN_TABLE}}\n', '\nsee below\n'), ['t1'], 'no chain table')
})

test('control: a {{CHAIN_TABLE}} bullet without the Leg boundary fails t1', () => {
  only(swap(SCHEDULE, 'A launch change between two rows is a Leg boundary: a Leg works only rows of the launch it opened in.', ''),
    ['t1'], 'no boundary')
})

test('control: a {{CHAIN_TABLE}} Task cell with a bare alias fails t1', () => {
  only(swap(SCHEDULE, '[[<full-slug>\\|<short-alias>]] | <launch>', '[[<full-slug>\\|<alias>]] | <launch>'), ['t1'], 'alias')
})

test('control: a ### heading inside the Serial path fails t2', () => {
  only(swap(SCHEDULE, '**S3. Live chains.**', '### S3. Live chains\n\n**S3. Live chains.**'), ['t2'], 'heading')
})

test('control: the interim stop line back in a product file fails t2', () => {
  only({ [ORIENT]: `${real[ORIENT]}\nReport \`${INTERIM}: nothing stamped\`.\n` }, ['t2'], 'interim')
})

test('control: an S6 that stamps scope: fails t3', () => {
  only(swap(SCHEDULE, 'no `scope:`, `plan_approval:`, `rung:` or `solo:`', 'no `plan_approval:`, `rung:` or `solo:`'), ['t3'], 'S6 scope')
})

test('control: an S2 that adds body paths for a declared member fails t3', () => {
  only(swap(SCHEDULE, 'only for a member with no\ndeclared `surfaces:`', 'for every member'), ['t3'], 'S2 surface')
})

test('control: an S4 that always passes --repo fails t3', () => {
  only(swap(SCHEDULE, 'with `--repo <path>` exactly when the\nchain holds one `repo:` token', 'with `--repo <path>` for any\nchain'),
    ['t3'], 'S4 repo')
})

test('control: an S7 that makes an execute offer fails t3', () => {
  only(swap(SCHEDULE, 'no execute offer, no `start: unattended`', 'then the execute offer'), ['t3'], 'S7 offer')
})

test('control: a Don\'t that lets only step 7 remove incomplete: true fails t3', () => {
  only(swap(SCHEDULE, "except as step 7's (or § Serial path S6's) last write", "except as step 7's last write"), ['t3'], 'dont S6')
})

test('control: a Don\'t whose serial stamp waits on a supersede fails t3', () => {
  only(swap(SCHEDULE, 'and one on a serial note, which a supersede never takes, ends only by `status: dropped`',
    'and one on a serial note the same way'), ['t3'], 'dont dropped')
})

test('control: a § 0 check without --shape parallel fails t4', () => {
  only(swap(SCHEDULE, 'unfinished-rollout.py check --shape parallel --repo', 'unfinished-rollout.py check --repo'), ['t4'], 'no shape')
})

test('control: a § 0 that lets a supersede cross shapes fails t4', () => {
  only(swap(SCHEDULE, 'and a supersede never crosses shapes', 'and a supersede may take either shape'), ['t4'], 'cross')
})

test('control: an execute § 2 without its shape line fails t5', () => {
  only(swap(EXECUTE, '`shape: serial` → print `serial rollouts have no Leg runner yet: nothing runs` and stop',
    '`shape: serial` → proceed'), ['t5'], 'execute')
})

test('control: an orient § 0 stop that omits the live serial chain fails t5', () => {
  only(swap(ORIENT, ', or a live serial chain\n    that writes the repo and so owns it (ADR 0040), any project\'s)', ')'), ['t5'], 'orient chain')
})

test('control: an orient § 0 stop without the dropped remedy fails t5', () => {
  only(swap(ORIENT, '\n    `status: dropped` on a never-started serial chain\'s note (no Leg runner runs it yet, p24-3;\n    dropping it frees its tasks),', ''),
    ['t5'], 'orient dropped')
})

test('control: a vault grammar whose Writers drop the parallel-only clause fails t5', () => {
  only(swap(GRAMMAR, ', on a parallel\n  note only until execute runs Legs (p24-3)', ''), ['t5'], 'writers')
})

test('control: a Surface entry without the toplevel widening fails t6', () => {
  only(swap(CONTEXT, "widens to that checkout's toplevel", 'stays where it is'), ['t6'], 'widening')
})

test('control: a Surface entry that claims Working roots fails t6', () => {
  only(swap(CONTEXT, "never\n  its launch profile's other Working roots", "and\n  its launch profile's other roots"), ['t6'], 'working roots')
})

test('control: an Incomplete rollout entry whose serial stamp waits on a supersede fails t6', () => {
  only(swap(CONTEXT, 'and the stamp on a serial note, which a supersede never takes, ends\n  only by `status: dropped`',
    'and so does the stamp on a serial note'), ['t6'], 'incomplete dropped')
})

test('control: an Incomplete rollout entry that forgets S6 fails t6', () => {
  only(swap(CONTEXT, "until step 7's last\n  write (S6's) removes it", "until step 7's last\n  write removes it"), ['t6'], 'incomplete S6')
})

test('control: a § 0 mixed-set sentence without the follow-up line fails t7', () => {
  only(swap(SCHEDULE, ", and end the gate with the serial-shaped members'\nfollow-up line, `/thread:schedule --tasks <serial members>`, which takes them down the serial path once\nthis run is done", ''),
    ['t7'], 'follow-up')
})

test('control: an S3 that stops at its first refused chain fails t8', () => {
  only(swap(SCHEDULE, 'Every chain is checked, even after one is refused.', 'The first refused chain ends the check.'), ['t8'], 'every chain')
})

test('control: an S3 that writes the other chains fails t8', () => {
  only(swap(SCHEDULE, 'stops the whole run before anything is written, and\nevery refusal', 'stops that chain, and\nevery refusal'), ['t8'], 'whole run')
})

test('control: a description back on "a second unfinished rollout" fails t9', () => {
  only(swap(SCHEDULE, 'refuses a second unfinished parallel rollout', 'refuses a second unfinished rollout'), ['t9'], 'description')
})
