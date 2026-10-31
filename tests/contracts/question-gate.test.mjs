// The question gate (p30-1, ADR 0054; Chorus ADR 0110): skills/_shared/asking.md is the one rule every verb follows
// before it asks Lachy anything (label the Owner, ask only his questions in the Framing, list the rest as Decided for
// you), and ADR 0054 § Sites lists every ask unit in skills/ with its Owner and disposition. Seven rules:
//   q1  asking.md: at most 90 lines, `## 1.` to `## 6.`, the four Owners with their actions, Decided for you, the five
//       Framing points and the Note's words, the recommendation's "hands work back" and "spends less for lower
//       quality", the grill rule, ADR 0008, 0011 and 0042 (the rollout clone a *technical* call, never in the *yours*
//       row), the steering exception, a gated input never a gate, its sources, and no runnable plugin-root command.
//   q2  the cite: every prose unit of skills/**/*.md naming AskUserQuestion holds `_shared/asking.md`, unless it says
//       "never call(s) the question tool" (exactly three units); a non-markdown file under skills/ or hooks/ naming
//       AskUserQuestion names asking.md.
//   q3  the grills: reshuffle R3 passes the pinned `args`, asks only his questions and collects the Decided for you
//       list for R4 and R5.2; its two designed-out asks are gone; R4 is his (ADR 0036); orient § 6 says why a
//       Hands-on pick hands work back; grill-fit 2(b) is Owner *yours*.
//   q4  the record's readers: schedule § 1.5 writes `decided-for-you` after the final call and in the orient-all form,
//       step 8 shows it, § 3.5 and orient-all § 6 never settle on it, § 4.5 copies it, orient-all's answer 16 and its
//       dry run name the verb (the dry run never `--write`), engine-snapshot.md carries it; the preamble hits no gate
//       word and no § 3.5 phrase, says none signs a gated input, and the Reflection's ask-ahead reader misses it; the
//       Grade log's three definitions count his decisions only (owner yours, ADR 0054).
//   q5  ADR 0054 § Sites and § Follow-ups: each row has six cells, a file that exists, a known Owner and disposition;
//       every anchor but a designed-out one sits in exactly one unit of its file (a gone follow-up anchor says its
//       task landed it), every ask that stands (a cited or listed row) has its unit hold the cite, which is what
//       ADR 0054 d1 and asking.md § 6 claim, an `Owner *x*` label in a unit is its row's Owner, a designed-out anchor
//       appears nowhere; each follow-up row's task is in § Follow-ups with its row count, and the lead-in's counts are
//       the table's.
//   q6  one row per ask unit: every unit naming AskUserQuestion or matching PLAIN_ASK holds exactly one anchor of its
//       own file's rows.
//   q7  the Framing in script-built rounds: estate-dispatch.py's NOTE_INVITE is asking.md § 3's and orient-all § 5's
//       Note; asking.md § 6's table rows each kind against the five points (a sign-off's, an Unpark offer's and the pick
//       list's pick none, by ADR 0008, ADR 0041 and ADR 0061); readiness-grade § Each decision requires `goal` and `stakes` with
//       `owner: yours`; orient-all § 4 and schedule's **The round.** say the questions carry the grade's Framing.
// One pure function per rule over a files map, so every control mutates one place; a python child loads
// estate-dispatch.py, gated_inputs.py and reflect.py's ASKED_AHEAD_RE (by its source line). Reads files only.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { collapse, fencedBlocks, proseUnits, readIf, root, section, slice, textFiles } from '../lib/contract-text.mjs'

const ASKING = 'skills/_shared/asking.md'
const ADR = 'docs/adr/0054-a-question-gate-before-every-ask.md'
const SCHEDULE = 'skills/schedule/SKILL.md'
const ORIENT_ALL = 'skills/orient-all/SKILL.md'
const ORIENT = 'skills/orient/SKILL.md'
const RESHUFFLE = 'skills/orient/reshuffle.md'
const GRILL_FIT = 'skills/_shared/grill-fit.md'
const GRADE = 'skills/_shared/readiness-grade.md'
const SNAPSHOT = 'skills/_shared/engine-snapshot.md'
const DISPATCH = 'skills/_shared/scripts/estate-dispatch.py'
const RUN_RECORD = 'skills/_shared/scripts/run_record.py'
const GATED = 'skills/_shared/scripts/gated_inputs.py'
const REFLECT = 'skills/reflect/scripts/reflect.py'
const CONTEXT = 'CONTEXT.md'

const CITE = '_shared/asking.md'
const FIX = 'label its Owner by `skills/_shared/asking.md` § 1 and add (or delete) its row in ' +
  'docs/adr/0054-a-question-gate-before-every-ask.md § Sites'
const EXEMPT = /\bnever calls? the question tool\b/i
// A plain-text ask: these phrasings, never past-tense narrative ("a lead had to ask Lachy whether …").
const PLAIN_ASK = /(?<!\b(?:had|used) to )\b(?:and ask|ask (?:which|him|lachy|the user|in plain text|once)|asks? lachy for|confirm with the user|offer to create)\b/i
const DISPOSITIONS = ['cited', 'listed', 'no ask', 'follow-up', 'designed out']
// The asks that stand: each unit cites the gate (ADR 0054 d1, asking.md § 6). A follow-up's owner task removes it.
const STANDS = ['cited', 'listed']
const OWNERS = ['yours', 'priorities', 'technical', 'gate']
const RUNNABLE = /(?:\b(?:python3|bash|sh|node)\s+"?|=\s*"?)\$\{CLAUDE_PLUGIN_ROOT\}/
// The grill skills' `args`, word for word (reshuffle R3): the only way the gate reaches a personal grill skill.
const ARGS = 'Ask Lachy only the questions he owns: intent, how important, how robust, who it is for, how it feels, and ' +
  'a credential or irreversible sign-off R3 (c) names (Owner yours). Ask each one at a time, in plain words, tied to ' +
  'the goal, with what each option gains and costs and your pick against his priorities, and end it with: what would ' +
  'make this wrong for you? Read the `## Priorities` card in <project note> first, when it has one: a call it answers ' +
  'is priorities, and a detail it says he steers is his. Walk every technical branch yourself from the repo\'s code, ADRs and CONTEXT.md, and never ' +
  'ask it: show it in the grill as `Decided for you: <the fork> → <the call> (technical|priorities: <one reason>)`, ' +
  'which he can overturn there. An ADR you write ends with its Decided for him (overturnable) list. Finish with every ' +
  'Decided for you line, his overturns applied, under one `Decided for you` heading. The rule in full: § 5 of ' +
  '<plugin root>/skills/_shared/asking.md.'
// schedule § 3.5's gate phrases: none may sit in the Decided for you preamble.
const GATE_PHRASES = /\b(?:don't action until|do not action until|hold for|until a release|until the next release|gated on a release|not decide)\b|\bsign(?:s|ed|ing)?[- ]?off\b/i

const C = (s) => (s == null ? '' : collapse(s))
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const sec = (text, re) => section(text ?? '', re) ?? ''
const para = (text, label) => C((text ?? '').split(/\n\s*\n/).find((p) => p.startsWith(label)) ?? '')
const isSkillMd = (f) => f.startsWith('skills/') && f.endsWith('.md') && f !== ASKING
const entry = (text, name) => slice(text ?? '', new RegExp(`^- \\*\\*${esc(name)}\\*\\*`), /^(- \*\*|#)/)

// ---- ADR 0054's tables ------------------------------------------------------------------------------------------
// { rows: [{ cells, file, sec, anchor, owner, disposition, task }], lead, followUps: { task: { slug, rows } } }
function sites(adr) {
  const table = sec(adr, /^## Sites$/)
  const rows = []
  for (const l of table.split('\n')) {
    if (!/^\|/.test(l) || /^\| File \|/.test(l) || /^\|\s*-/.test(l)) continue
    const cells = l.split('|').slice(1, -1).map((c) => c.trim())
    const anchor = (cells[2] ?? '').replace(/^``\s?/, '').replace(/\s?``$/, '')
    const owner = (cells[3] ?? '').match(/^\*(\w+)\*/)?.[1] ?? null
    rows.push({ cells, file: cells[0], sec: cells[1], anchor, owner, disposition: cells[4], task: cells[5] })
  }
  const followUps = {}
  for (const m of sec(adr, /^## Follow-ups$/).matchAll(/^- \[\[([^\]|]+)\]\] \((p\d+-\d+)\): (\d+) rows?\b/gm)) {
    followUps[m[2]] = { slug: m[1], rows: Number(m[3]) }
  }
  return { rows, lead: C(table), followUps }
}

// ---- the rules -------------------------------------------------------------------------------------------------
function q1(F) {
  const out = []
  const t = F[ASKING]
  if (t == null) return [`${ASKING} is missing`]
  const lines = t.trimEnd().split('\n')
  if (lines.length > 90) out.push(`${ASKING} has ${lines.length} lines (> 90)`)
  const heads = lines.filter((l) => /^## /.test(l)).map((l) => l.match(/^## (\d+)\. /)?.[1] ?? l)
  if (JSON.stringify(heads) !== JSON.stringify(['1', '2', '3', '4', '5', '6'])) out.push(`headings are ${JSON.stringify(heads)}`)
  const all = C(t)
  const need = (name, text, pats) => { for (const p of pats) if (!(typeof p === 'string' ? text.includes(p) : p.test(text))) out.push(`${name} lacks ${p}`) }
  need('the opening', all, ['before any AskUserQuestion', 'any plain-text question', 'any grill question', 'any recommendation'])
  const s1 = sec(t, /^## 1\. /)
  const row = (owner) => C(s1.split('\n').find((l) => l.startsWith(`| *${owner}* |`)) ?? '')
  for (const [owner, action] of [['yours', 'Ask it, in the Framing'], ['priorities', 'Decide it and list it'],
    ['technical', 'Research it, decide it and list it'], ['gate', 'Never ask: design it out, or decide and say so in one line']]) {
    if (!row(owner).includes(action)) out.push(`§ 1's *${owner}* row lacks "${action}"`)
  }
  need('§ 1', C(s1), ['ADR 0008', 'ADR 0011', 'ADR 0042', 'Chorus ADR 0110 d3', 'A gated input (ADR 0008) is never a *gate*',
    'Chorus ADR 0108 d4', 'An open `fork for Lachy` stays *yours*',
    'The rollout clone (schedule § 0) is a *technical* call that ADR 0042 keeps a question'])
  // One Owner for the rollout clone in all three places: schedule § 0 and its § Sites row say *technical* (q5 holds those).
  if (/ADR 0042|rollout clone/.test(row('yours'))) out.push("§ 1's *yours* row names ADR 0042's rollout clone, a *technical* call")
  need('§ 2', C(sec(t, /^## 2\. /)), ['Decided for you: <the fork> → <the call> (<owner>: <reason>)', 'the less sure calls first'])
  need('§ 3', C(sec(t, /^## 3\. /)), ['**Plain words**', '**The goal**', '**Gains and costs**', '**The pick**', '**The Note**',
    'What would make this wrong for you?'])
  need('§ 4', C(sec(t, /^## 4\. /)), ['hands work back', 'spends less for lower quality', 'his priority does not apply'])
  need('§ 5', C(sec(t, /^## 5\. /)), ['Ask only *yours*, one question at a time', 'Decided for you: <fork> → <call> (<owner>: <reason>)',
    'his overturns applied'])
  need('the sources', all, ['Chorus ADR 0110', 'ADR 0054', 'ADR 0054 § Sites', 'how-lachy-decides.md'])
  const runnable = [...fencedBlocks(t).flat(), ...[...t.matchAll(/`([^`\n]+)`/g)].map((m) => m[1])].filter((s) => RUNNABLE.test(s))
  if (runnable.length) out.push(`${ASKING} holds a runnable plugin-root command: ${runnable[0]}`)
  return out
}

function q2(F) {
  const out = []
  const exempt = []
  let named = 0
  for (const [f, t] of Object.entries(F)) {
    if (!isSkillMd(f) || t == null) continue
    for (const u of proseUnits(t)) {
      if (!u.includes('AskUserQuestion')) continue
      named++
      if (EXEMPT.test(u)) exempt.push(`${f}: ${u.slice(0, 80)}`)
      else if (!u.includes(CITE)) out.push(`${f}: names AskUserQuestion without citing ${CITE}: "${u.slice(0, 120)}…"; ${FIX}`)
    }
  }
  if (named < 15) out.push(`only ${named} units name AskUserQuestion: the scan is vacuous`)
  if (exempt.length !== 3) out.push(`${exempt.length} units say they never call the question tool, not 3: ${exempt.join(' | ')}`)
  for (const [f, t] of Object.entries(F)) {
    if (!/^(skills|hooks)\//.test(f) || f.endsWith('.md') || t == null) continue
    if (t.includes('AskUserQuestion') && !t.includes('asking.md')) out.push(`${f} builds or names AskUserQuestion without naming asking.md`)
  }
  return out
}

function q3(F) {
  const out = []
  // The pinned args sit in a blockquote: read them with its `>` marks dropped.
  const r3 = C(sec(F[RESHUFFLE], /^## R3\. /).replace(/^> ?/gm, ''))
  const r4 = C(sec(F[RESHUFFLE], /^## R4\. /))
  const r5 = C(sec(F[RESHUFFLE], /^## R5\. /))
  for (const p of [ARGS, "Lachy's questions only", "R4's footer", 'R5.2', '**Invoke it with these `args`**', 'asking.md` § 5']) {
    if (!r3.includes(p)) out.push(`reshuffle R3 lacks ${p.length > 60 ? 'the pinned args' : p}`)
  }
  for (const gone of ['start a `CONTEXT.md` for', 'still ambiguous → ask']) if (r3.includes(gone)) out.push(`reshuffle R3 still holds "${gone}"`)
  for (const p of ['**Owner *yours***', 'ADR 0036', 'decided for you: <n>']) if (!r4.includes(p)) out.push(`reshuffle R4 lacks ${p}`)
  for (const p of ['record --task <slug> --owner <technical|priorities>', '--by orient']) if (!r5.includes(p)) out.push(`reshuffle R5.2 lacks ${p}`)
  const steer = C(slice(sec(F[ORIENT], /^### 6\. /), /^- \*\*Serial-shaped and session-lane work → steer\.\*\*/, /^ {2}- \*\*Autonomous\*\*/) ?? '')
  if (!steer.includes('hands work back') || !steer.includes(CITE)) out.push('orient § 6 steer does not say why a Hands-on pick hands work back, citing the gate')
  const fit = C(slice(F[GRILL_FIT], /^2\. /, /^3\. /) ?? '')
  if (!fit.includes('Owner *yours*') || !fit.includes('`_shared/asking.md` § 1')) out.push('grill-fit step 2(b) does not name Owner *yours* by `_shared/asking.md` § 1')
  return out
}

function q4(F, K) {
  const out = []
  const sch = F[SCHEDULE] ?? ''
  const pf = sec(sch, /^### 1\.5\. Pre-flight/)
  const finalAt = pf.indexOf('**The final call.**')
  const decidedAt = pf.indexOf('**Decided for you.**')
  const decided = para(pf, '**Decided for you.**')
  if (finalAt < 0 || decidedAt < finalAt) out.push('schedule § 1.5 has no **Decided for you.** paragraph after **The final call.**')
  for (const p of ['estate-dispatch.py decided-for-you --rank "$S/rank.json"', '--by schedule', '--write', '`refused[]`',
    'A task dropped later keeps its bullets']) if (!decided.includes(p)) out.push(`schedule § 1.5 **Decided for you.** lacks ${p}`)
  if (!para(pf, '**The orient-all form.**').includes('decided-for-you --rank <R> --tasks <its queue[]> --by orient-all --write')) {
    out.push('schedule § 1.5 **The orient-all form.** does not write its decided-for-you')
  }
  const s8 = C(sec(sch, /^### 8\. /))
  for (const p of ["Decided for you (<n>; each in its task note's ## Decided for you, where you can overturn it):", 'not written: [[',
    'and <k> more in the task notes']) if (!s8.includes(p)) out.push(`schedule step 8 lacks ${p}`)
  if (!C(sec(sch, /^### 3\.5\. /)).includes('a `## Decided for you` bullet clears no gate')) out.push('schedule § 3.5 lacks its clause')
  const merge = para(sec(sch, /^### 4\.5\. /), '**After the Pre-flight.**')
  if (!merge.includes('`## Decided for you (<date>)`') || !merge.includes('[[<member>]]:')) out.push('schedule § 4.5 does not copy the Decided for you bullets')
  const oa = F[ORIENT_ALL] ?? ''
  const step3 = C(slice(sec(oa, /^### 6\. /), /^3\. \*\*Schedule's questions, answered\.\*\*/, /^ {3}1\. /) ?? '')
  if (!step3.includes("A `## Decided for you` bullet is an agent's call: it never settles a § 3.5 match (answer 8) or a decision")) {
    out.push('orient-all § 6 step 3 lacks the never-settles clause')
  }
  const answers = slice(sec(oa, /^### 6\. /), /^3\. \*\*Schedule's questions, answered\.\*\*/, /^4\. /) ?? ''
  if (!C(slice(answers, /^ {3}16\. /, /^ {3}\d+\. /) ?? '').includes('decided-for-you --write --by orient-all')) out.push('orient-all answer 16 does not name the verb')
  const s9 = C(sec(oa, /^### 9\. /))
  const cut = s9.indexOf('It never runs')
  const dry = cut < 0 ? s9 : s9.slice(0, cut)
  if (!dry.includes('estate-dispatch.py decided-for-you')) out.push('orient-all § 9 does not print decided-for-you')
  if (/decided-for-you[^`]*--write/.test(dry)) out.push('orient-all § 9 runs decided-for-you --write')
  if (cut < 0 || !s9.slice(cut).includes('`decided-for-you --write`')) out.push("orient-all § 9's never-runs list lacks `decided-for-you --write`")
  if (!C(F[SNAPSHOT]).includes('decided-for-you')) out.push('engine-snapshot.md does not name decided-for-you')
  // The constants: what the note carries.
  const pre = K.DECIDED_PREAMBLE ?? ''
  if (!pre.includes('none signs a gated input')) out.push('DECIDED_PREAMBLE does not say none signs a gated input')
  if (Object.values(K.preambleSweep ?? { x: ['?'] }).some((h) => h.length)) out.push(`the preamble hits the gate sweep: ${JSON.stringify(K.preambleSweep)}`)
  if (GATE_PHRASES.test(pre)) out.push(`the preamble holds a schedule § 3.5 phrase: ${pre.match(GATE_PHRASES)[0]}`)
  if (K.askedAhead !== false) out.push("the Reflection's ASKED_AHEAD_RE reads the heading, preamble or bullet as asked ahead")
  if (!/^## Decided for you \(\{date\}\)$/.test(K.DECIDED_HEADING ?? '')) out.push(`DECIDED_HEADING is ${K.DECIDED_HEADING}`)
  if (/^## Decisions/.test(K.DECIDED_HEADING ?? '')) out.push('DECIDED_HEADING is a ## Decisions heading')
  // The Grade log's three definitions count his decisions only.
  const defs = {
    'run_record.py grade row': C(slice(F[RUN_RECORD], /^ {2}grade\s+T\s/, /^ {2}reflection /) ?? ''),
    'estate-dispatch.py log docstring': C(slice(F[DISPATCH], /^log --rank R --scan S/, /^record --task/) ?? ''),
    'CONTEXT.md **Grade log**': C(entry(F[CONTEXT], 'Grade log') ?? ''),
  }
  for (const [name, text] of Object.entries(defs)) {
    if (!text.includes('owner yours') || !text.includes('ADR 0054')) out.push(`${name} does not count only his decisions (owner yours, ADR 0054)`)
  }
  return out
}

function q5(F) {
  const out = []
  const { rows, lead, followUps } = sites(F[ADR] ?? '')
  if (rows.length < 50) out.push(`${ADR} § Sites has ${rows.length} rows: the table is missing or unparsed`)
  const counts = {}
  const perTask = {}
  for (const r of rows) {
    const where = `${r.file} "${r.anchor}"`
    if (r.cells.length !== 6) { out.push(`${where}: ${r.cells.length} cells, not 6`); continue }
    if (F[r.file] == null || !isSkillMd(r.file)) { out.push(`${where}: no such skill file`); continue }
    if (!DISPOSITIONS.includes(r.disposition)) out.push(`${where}: unknown disposition ${r.disposition}`)
    if (!OWNERS.includes(r.owner)) out.push(`${where}: unknown Owner ${r.cells[3]}`)
    if (!r.anchor) { out.push(`${r.file}: an empty anchor`); continue }
    counts[r.disposition] = (counts[r.disposition] ?? 0) + 1
    if (r.disposition === 'designed out') {
      if (C(F[r.file]).includes(r.anchor)) out.push(`${where}: designed out, but the ask is still there`)
      continue
    }
    const hits = proseUnits(F[r.file]).filter((u) => u.includes(r.anchor))
    if (r.disposition === 'follow-up') {
      perTask[r.task] = (perTask[r.task] ?? 0) + 1
      if (!followUps[r.task]) out.push(`${where}: its task ${r.task} is not in § Follow-ups`)
      if (hits.length === 0) { out.push(`${where}: the ask is gone, so ${r.task} landed it: delete this row`); continue }
    }
    if (hits.length !== 1) { out.push(`${where}: the anchor is in ${hits.length} units, not 1; ${FIX}`); continue }
    if (STANDS.includes(r.disposition) && !hits[0].includes(CITE)) {
      out.push(`${where}: a ${r.disposition} row (an ask that stands) whose unit does not cite ${CITE}`)
    }
    const labels = [...hits[0].matchAll(/\bOwner \*(\w+)\*/g)].map((x) => x[1])
    if (labels.some((o) => o !== r.owner)) out.push(`${where}: its unit labels Owner *${labels.join('*, *')}*, its row *${r.owner}*`)
  }
  for (const [task, f] of Object.entries(followUps)) {
    if (!perTask[task]) out.push(`§ Follow-ups names ${task}, which owns no row`)
    else if (perTask[task] !== f.rows) out.push(`§ Follow-ups gives ${task} ${f.rows} rows; the table gives it ${perTask[task]}`)
  }
  const m = lead.match(/The table holds (\d+) rows: (\d+) cited, (\d+) follow-up \(([^)]*)\), (\d+) listed, (\d+) no ask, (\d+) designed out/)
  if (!m) out.push('§ Sites has no lead-in count line')
  else {
    const want = { total: rows.length, cited: counts.cited ?? 0, 'follow-up': counts['follow-up'] ?? 0, listed: counts.listed ?? 0,
      'no ask': counts['no ask'] ?? 0, 'designed out': counts['designed out'] ?? 0 }
    const got = { total: +m[1], cited: +m[2], 'follow-up': +m[3], listed: +m[5], 'no ask': +m[6], 'designed out': +m[7] }
    if (JSON.stringify(got) !== JSON.stringify(want)) out.push(`the lead-in counts ${JSON.stringify(got)}; the table holds ${JSON.stringify(want)}`)
    const split = Object.fromEntries([...m[4].matchAll(/(p\d+-\d+) (\d+)/g)].map((x) => [x[1], +x[2]]))
    if (JSON.stringify(split) !== JSON.stringify(perTask)) out.push(`the lead-in's follow-up split ${JSON.stringify(split)} ≠ the table's ${JSON.stringify(perTask)}`)
  }
  return out
}

function q6(F) {
  const out = []
  const { rows } = sites(F[ADR] ?? '')
  const anchors = {}
  for (const r of rows) if (r.anchor && r.disposition !== 'designed out') (anchors[r.file] ??= []).push(r.anchor)
  let asks = 0
  for (const [f, t] of Object.entries(F)) {
    if (!isSkillMd(f) || t == null) continue
    for (const u of proseUnits(t)) {
      if (!u.includes('AskUserQuestion') && !PLAIN_ASK.test(u)) continue
      asks++
      const n = (anchors[f] ?? []).filter((a) => u.includes(a)).length
      if (n !== 1) out.push(`${f}: an ask unit holds ${n} § Sites anchors, not 1: "${u.slice(0, 120)}…"; ${FIX}`)
    }
  }
  if (asks < 40) out.push(`only ${asks} ask units found: the scan is vacuous`)
  return out
}

function q7(F, K) {
  const out = []
  const invite = K.NOTE_INVITE ?? ''
  if (!/^What would make this wrong for you\?$/.test(invite)) out.push(`NOTE_INVITE is ${JSON.stringify(invite)}`)
  const low = (s) => C(s).toLowerCase()
  if (!invite || !low(sec(F[ASKING], /^## 3\. /)).includes(invite.toLowerCase())) out.push('asking.md § 3 lacks NOTE_INVITE')
  const s5 = C(sec(F[ORIENT_ALL], /^### 5\. /))
  if (!invite || !s5.toLowerCase().includes(invite.toLowerCase())) out.push('orient-all § 5 lacks NOTE_INVITE')
  for (const p of ['`goal`', '`stakes`', 'the recommendation first with its why', '_shared/asking.md` § 3']) if (!s5.includes(p)) out.push(`orient-all § 5 lacks ${p}`)
  const s6 = sec(F[ASKING], /^## 6\. /)
  const row = (kind) => (s6.split('\n').find((l) => l.startsWith(`| ${kind}`)) ?? '').split('|').slice(1, -1).map((c) => c.trim())
  for (const kind of ['One call', 'Ungraded', 'Sign-off', 'Unpark', 'Pick list']) if (row(kind).length !== 6) out.push(`asking.md § 6's table has no ${kind} row of six cells`)
  if (!row('One call')[2]?.includes('`goal`') || !row('One call')[3]?.includes('`stakes`')) out.push("asking.md § 6's One call row does not take `goal` and `stakes`")
  for (const [kind, adr] of [['Sign-off', 'ADR 0008'], ['Unpark', 'ADR 0041'], ['Pick list', 'ADR 0061']]) {
    const pick = row(kind)[4] ?? ''
    if (!pick.startsWith('none') || !pick.includes(adr)) out.push(`asking.md § 6's ${kind} pick is not none by ${adr}: ${pick}`)
  }
  for (const kind of ['One call', 'Ungraded', 'Sign-off', 'Unpark', 'Pick list']) if (row(kind)[5] !== 'yes') out.push(`asking.md § 6's ${kind} row carries no Note`)
  const each = C(sec(F[GRADE], /^## Each decision$/))
  for (const p of ['`goal`', '`stakes`', 'required with `owner: yours`']) if (!each.includes(p)) out.push(`readiness-grade § Each decision lacks ${p}`)
  if (!C(sec(F[ORIENT_ALL], /^### 4\. /)).includes('carries the Framing from the grade')) out.push('orient-all § 4 does not carry the Framing from the grade')
  if (!para(sec(F[SCHEDULE], /^### 1\.5\. /), '**The round.**').includes('carries the Framing from the grade')) out.push("schedule's **The round.** does not carry the Framing from the grade")
  return out
}

const RULES = { q1, q2, q3, q4, q5, q6, q7 }
function check(F, K) {
  const fails = []
  const details = []
  for (const [name, rule] of Object.entries(RULES)) {
    const r = rule(F, K)
    if (r.length) { fails.push(name); details.push(...r.map((x) => `${name}: ${x}`)) }
  }
  return { fails, details }
}

// ---- the inputs --------------------------------------------------------------------------------------------------
const PY = `
import importlib.util, json, re, sys
sys.dont_write_bytecode = True
def load(name, p):
    s = importlib.util.spec_from_file_location(name, p)
    m = importlib.util.module_from_spec(s)
    s.loader.exec_module(m)
    return m
ed, gi = load("thread_estate_dispatch", sys.argv[1]), load("thread_gated_inputs", sys.argv[2])
src = open(sys.argv[3], encoding="utf-8").read()
asked = re.compile(eval(re.search(r'^ASKED_AHEAD_RE = re\\.compile\\((r"[^"]*")', src, re.M).group(1)), re.M)
heading = ed.DECIDED_HEADING.format(date="2026-10-27")
bullet = ed.DECIDED_BULLET.format(question="Q?", answer="A", by="schedule", owner="technical", why="a reason")
print(json.dumps({"NOTE_INVITE": ed.NOTE_INVITE, "DECIDED_PREAMBLE": ed.DECIDED_PREAMBLE, "DECIDED_HEADING": ed.DECIDED_HEADING,
                  "DECIDED_BULLET": ed.DECIDED_BULLET, "preambleSweep": gi.sweep(ed.DECIDED_PREAMBLE),
                  "askedAhead": any(asked.search(x) for x in (heading, ed.DECIDED_PREAMBLE, bullet))}))
`
function constants() {
  const r = spawnSync('python3', ['-c', PY, path.join(root, DISPATCH), path.join(root, GATED), path.join(root, REFLECT)],
    { encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } })
  assert.equal(r.status, 0, r.stderr)
  return JSON.parse(r.stdout)
}
const FILES = Object.fromEntries([...textFiles('skills'), ...textFiles('hooks')].filter(({ file }) => !file.includes('__pycache__'))
  .map(({ file, text }) => [file, text]))
for (const f of [ADR, CONTEXT]) FILES[f] = readIf(f)
const CONSTS = constants()

// Mutate one place: `from` must be present, so a control never passes vacuously.
function swap(files, rel, from, to) {
  assert.ok(files[rel]?.includes(from), `${rel} no longer holds ${JSON.stringify(from)}: update this control`)
  return { ...files, [rel]: files[rel].replace(from, to) }
}
const only = (files, consts, rules, what) => {
  const r = check(files, consts)
  assert.deepEqual(r.fails, rules, `${what}: ${r.details.join('\n')}`)
}
const fails = (rule, files, consts, re, what) => {
  const r = RULES[rule](files, consts)
  assert.ok(r.some((x) => re.test(x)), `${what}: ${rule} gave ${JSON.stringify(r)}`)
}
// The controls never pin today's § Sites figures or a follow-up row: each owner task that lands deletes its rows, and
// p30-5's form N1 adds three, so the lead-in's count is read from the ADR and new rows go in at the table's top.
const LEAD = /The table holds (\d+)(\s+)rows: (\d+) cited/
function lead(files) {
  const m = (files[ADR] ?? '').match(LEAD)
  assert.ok(m, `${ADR} has no "The table holds <n> rows: <n> cited" lead-in: update this control`)
  return m
}
const SEP = '| --- | --- | --- | --- | --- | --- |\n'
const withRow = (files, row) => swap(files, ADR, SEP, `${SEP}${row}\n`)
// One more `cited` row, and the lead-in counts it.
function withCitedRow(files, row) {
  const m = lead(files)
  return swap(withRow(files, row), ADR, m[0], `The table holds ${+m[1] + 1}${m[2]}rows: ${+m[3] + 1} cited`)
}

test('the gate, its cites, its readers, ADR 0054 § Sites and the Framing agree (q1-q7)', () => {
  const r = check(FILES, CONSTS)
  assert.deepEqual(r.fails, [], r.details.join('\n'))
})

test('control q1: asking.md over 90 lines, without its "spends less for lower quality" reason, or with the rollout clone back in the *yours* row, fails q1 alone', () => {
  only(swap(FILES, ASKING, '## 1. Label the Owner', `${'filler\n'.repeat(40)}\n## 1. Label the Owner`), CONSTS, ['q1'], 'long')
  only(swap(FILES, ASKING, 'spends less for lower quality', 'spends less'), CONSTS, ['q1'], 'reason')
  only(swap(FILES, ASKING, "ADR 0011's vault tasks)", "ADR 0011's vault tasks, ADR 0042's rollout clone)"), CONSTS, ['q1'], 'clone yours')
})

test('control q2: an uncited ask fails q2; the exemption is exact and case-blind; a fourth exempt unit fails', () => {
  // A follow-up unit naming AskUserQuestion with no cite fails q2, while q5 asks no cite of its row (its owner task
  // removes the ask).
  const fu = withRow({ ...FILES, 'skills/new/SKILL.md': '- End with `AskUserQuestion`, one offer per note.\n' },
    '| skills/new/SKILL.md | § 1 | `` End with `AskUserQuestion`, one offer per note `` | *gate* | follow-up | p30-77 |')
  fails('q2', fu, CONSTS, /skills\/new\/SKILL\.md: names AskUserQuestion/, 'follow-up uncited')
  assert.ok(!q5(fu).some((x) => /does not cite/.test(x)), 'q5 asks no cite of a follow-up row')
  // execute's capitalised Don't is exempt; a fourth "never calls" unit is one too many.
  const dont = (FILES['skills/execute/SKILL.md'] ?? '').split('\n').find((l) => l.startsWith('- Never call the question tool (`AskUserQuestion`'))
  assert.ok(dont && EXEMPT.test(dont), 'execute\'s "Never call the question tool" line is exempt')
  fails('q2', swap(FILES, 'skills/execute/legs.md', 'A Leg never calls the question tool',
    'A fork never calls the question tool (`AskUserQuestion`).\n\nA Leg never calls the question tool'), CONSTS, /4 units say they never call/, 'fourth')
  // A new uncited ask, and next's step-4 lead as PR #226 words it, uncited and then cited.
  fails('q2', { ...FILES, 'skills/new/SKILL.md': '- Ask via `AskUserQuestion` which tree to use.\n' }, CONSTS, /skills\/new\/SKILL\.md: names AskUserQuestion/, 'new ask')
  const lead = '4. **Decide the move, and say so in one line.** When the recommendation is clear, take it with no AskUserQuestion: print one line.'
  fails('q2', { ...FILES, 'skills/new/SKILL.md': `${lead}\n` }, CONSTS, /skills\/new\/SKILL\.md/, '#226 uncited')
  assert.deepEqual(q2({ ...FILES, 'skills/new/SKILL.md': `${lead} The gate: \`\${CLAUDE_PLUGIN_ROOT}/skills/_shared/asking.md\` § 1.\n` }), [], '#226 cited')
})

test('control q3: the args reworded, or a designed-out ask back in R3, fails q3 alone', () => {
  only(swap(FILES, RESHUFFLE, 'Walk every technical branch yourself', 'Walk the technical branches you like'), CONSTS, ['q3'], 'args')
  only(swap(FILES, RESHUFFLE, '- **No resolvable repo**', '- Several matches: still ambiguous → ask.\n- **No resolvable repo**'), CONSTS, ['q3', 'q5'], 'designed out back')
})

test('control q4: the never-settles clause dropped, a preamble with a § 3.5 phrase, or a Grade log definition without owner yours, fails q4 alone', () => {
  only(swap(FILES, ORIENT_ALL, "A `## Decided for you` bullet is an agent's call: it", 'Every match is read: it'), CONSTS, ['q4'], 'step 3')
  only(FILES, { ...CONSTS, DECIDED_PREAMBLE: `${CONSTS.DECIDED_PREAMBLE} Hold for review.` }, ['q4'], 'preamble')
  only(swap(FILES, CONTEXT, 'his decisions (owner yours', 'the decisions (owner any'), CONSTS, ['q4'], 'grade log')
})

test('control q5: a renamed anchor, an uncited cited or listed row, an unlisted task, a designed-out ask still present, a count off by one, or an Owner label against its row, fails q5', () => {
  only(swap(FILES, ADR, '`` Then ask which proposals to apply ``', '`` Then ask what proposals to apply ``'), CONSTS, ['q5', 'q6'], 'renamed')
  only(swap(FILES, 'skills/repair/SKILL.md', 'quoting `setAside.summary` (Owner *yours*, `${CLAUDE_PLUGIN_ROOT}/skills/_shared/asking.md`)',
    'quoting `setAside.summary` (Owner *yours*)'), CONSTS, ['q2', 'q5'], 'uncited')
  fails('q5', withRow({ ...FILES, 'skills/new/SKILL.md': '- Several trees: list them and ask which one.\n' },
    '| skills/new/SKILL.md | § 1 | `` list them and ask which one `` | *technical* | follow-up | p30-77 |'),
  CONSTS, /p30-77 is not in § Follow-ups/, 'unlisted task')
  only(swap(FILES, 'skills/open/SKILL.md', '3. If not found → ask for the scope', '3. If not found → confirm with the user, ask for the scope'),
    CONSTS, ['q5'], 'designed out present')
  const m = lead(FILES)
  only(swap(FILES, ADR, m[0], `The table holds ${m[1]}${m[2]}rows: ${+m[3] + 1} cited`), CONSTS, ['q5'], 'count')
  // An ask that stands loses its cite: status § 1's cited ask, and a listed pointer (neither names AskUserQuestion, so
  // q2 cannot see them).
  only(swap(FILES, 'skills/status/SKILL.md', "don't assume (Owner *yours*: which rollout he means, `${CLAUDE_PLUGIN_ROOT}/skills/_shared/asking.md`).",
    "don't assume."), CONSTS, ['q5'], 'status uncited')
  only(swap(FILES, ORIENT, '(its Owner labelled above,\n  `${CLAUDE_PLUGIN_ROOT}/skills/_shared/asking.md`)', '(as above)'), CONSTS, ['q5'], 'listed uncited')
  // One Owner per ask: status § 1's ask labelled *technical* against its *yours* row.
  only(swap(FILES, 'skills/status/SKILL.md', "don't assume (Owner *yours*: which rollout he means,", "don't assume (Owner *technical*: which rollout he means,"),
    CONSTS, ['q5'], 'owner mismatch')
})

test('control q6: an uncovered "list them and ask which", a cited unit with no row, a unit with two anchors, and the past-tense narrative', () => {
  const add = (text) => ({ ...FILES, 'skills/status/SKILL.md': `${FILES['skills/status/SKILL.md']}\n- Several notes: list them and ask which one (Owner *yours*, \`_shared/asking.md\`).\n${text}` })
  only(add(''), CONSTS, ['q6'], 'no row')
  only(withCitedRow(add(''), '| skills/status/SKILL.md | § 1 | `` list them and ask which one `` | *yours* | cited | — |'), CONSTS, [], 'with its row')
  fails('q6', { ...FILES, 'skills/new/SKILL.md': '- Pick one (`AskUserQuestion`, `_shared/asking.md`).\n' }, CONSTS, /skills\/new\/SKILL\.md: an ask unit holds 0/, 'cited, no row')
  fails('q6', swap(FILES, 'skills/reflect/SKILL.md', 'Then ask which proposals to apply', 'Then ask which proposals to apply. Several matches for a loose name: list them and ask which'),
    CONSTS, /holds 2 § Sites anchors/, 'two anchors')
  assert.equal(PLAIN_ASK.test('so a lead had to ask Lachy whether one still stood (the 2026-10-25 loop audit\'s Q50)'), false, 'narrative')
  assert.equal(PLAIN_ASK.test('ask Lachy whether one still stands'), true, 'an ask')
})

test('control q7: asking.md without the Note, orient-all § 5 without `stakes`, the table without its Sign-off or Pick list row, or a pick list that recommends, fails q7 alone', () => {
  only(swap(FILES, ASKING, 'end with "What would make this wrong for you?"', 'end with a question'), CONSTS, ['q1', 'q7'], 'invite')
  only(swap(FILES, ORIENT_ALL, '`stakes`, the recommendation first', 'the recommendation first'), CONSTS, ['q7'], 'stakes')
  only(swap(FILES, ASKING, '| Sign-off |', '| Signing |'), CONSTS, ['q7'], 'sign-off row')
  only(swap(FILES, ASKING, '| none: where his attention goes is his (ADR 0061) |', '| the top project, recommended |'), CONSTS, ['q7'], 'pick list pick')
  only(swap(FILES, ASKING, '| Pick list |', '| Picks |'), CONSTS, ['q7'], 'pick list row')
})
