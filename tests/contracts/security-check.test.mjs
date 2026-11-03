// The opt-in Security check (execute § 3 `security_checks`; task note thread-skill-verifier-security-checks). Pins the
// prose an LLM lead and its agents follow, and the one shape two scripts share:
//   s3-row        execute § 3's `security_checks` row: the opt-in, the entry check, what is scanned, what is Lachy's
//                 question and how his answer clears it, what is not scanned, the serial gap, both follow-up links
//   exit-5        § 3's *Exit 5* paragraph, right after *Exit 4*: its ERROR line, its halt, the order of the exits
//   pre-check     § 4's *Check verifySlot before the stamps* covers args.securityCheck: present exactly when
//                 verify-timeout printed it, never on an integrate call, its own halt, the resume exemption
//   args          § 4's args jsonc entry
//   halts         § 7's two bullets (verify-timeout's exit 5, the pre-check's mismatch), the integrate free-lane phrase
//                 still exactly twice in § 7 (execute-args-refusal's `halts` count)
//   kept          both reasons under *Threatens every task*, before `reason="ladder file refused"`, each matched by
//                 reconcile-rollout.py's WHOLE_HALT_PATTERNS (so `moving` reads the halt as a wait on Lachy)
//   context       CONTEXT.md's **Security check** term
//   template      rollout-template.md's commented `# security_checks:` line
//   carry-doc     schedule's step 1 preview and report, step 6's carry and template bullet, its Scope, and
//                 vault-grammar's carry line, as schedule-supersede.test.mjs's hold-carry pins the hold's
//   repair-accept repair's needs-you flow keeps a security question's accept token verbatim in the answer
//   entry-shape   the `## Repair input` entry the scan parses is the one record-answer writes
// Same shape as execute-args-refusal.test.mjs: every rule lives in check(files), which returns named failures, so the
// real text and the controls run through identical logic; each control edits one file in one place and must fail with
// exactly its rule. Reads files only.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { collapse, read, section } from '../lib/contract-text.mjs'

const FILES = {
  execute: read('skills/execute/SKILL.md'),
  rr: read('skills/execute/scripts/reconcile-rollout.py'),
  scan: read('skills/execute/scripts/security-check.py'),
  context: read('CONTEXT.md'),
  template: read('skills/schedule/rollout-template.md'),
  schedule: read('skills/schedule/SKILL.md'),
  grammar: read('skills/_shared/vault-grammar.md'),
  repair: read('skills/repair/SKILL.md'),
}

const FENCE = /^\s*(```|~~~)/
// A schedule section by heading, fence-aware (schedule-supersede.test.mjs's sectionOf, copied).
function sectionOf(text, re) {
  const lines = text.split('\n')
  const start = lines.findIndex((l) => re.test(l))
  if (start < 0) return ''
  const out = [lines[start]]
  let inFence = false
  for (const l of lines.slice(start + 1)) {
    if (FENCE.test(l)) inFence = !inFence
    else if (!inFence && /^#{2,3} /.test(l)) break
    out.push(l)
  }
  return out.join('\n')
}
// A bold-labelled paragraph inside a section: from its label line to the next bold label at column 0, collapsed.
function labelled(text, sectionRe, label) {
  const lines = (section(text, sectionRe) ?? '').split('\n')
  const i = lines.findIndex((l) => l.startsWith(`**${label}`))
  if (i < 0) return ''
  const j = lines.findIndex((l, k) => k > i && /^\*\*[A-Z`]/.test(l))
  return collapse(lines.slice(i, j < 0 ? undefined : j).join('\n'))
}
const lineAt = (text, head) => collapse((text ?? '').split('\n').find((l) => l.startsWith(head)) ?? '')
const before = (hay, a, b) => hay.indexOf(a) >= 0 && hay.indexOf(b) >= 0 && hay.indexOf(a) < hay.indexOf(b)
// reconcile-rollout.py's WHOLE_HALT_PATTERNS as anchored RegExps ({rollout} formatted with a stem), as `moving` matches.
function wholeHalts(rr) {
  const lines = rr.split('\n')
  const i = lines.findIndex((l) => l.startsWith('WHOLE_HALT_PATTERNS = ('))
  if (i < 0) return []
  const j = lines.findIndex((l, k) => k > i && l === ')')
  return [...lines.slice(i + 1, j).join('\n').matchAll(/r"((?:[^"\\]|\\.)*)"/g)].map((m) => new RegExp('^' + m[1].replace('{rollout}', 'ro')))
}
// A python string constant's value: NAME = '...' or NAME = r"..." (no escapes inside).
function pyConst(text, name) {
  const m = text.match(new RegExp(`^${name} = (?:re\\.compile\\()?r?(['"])(.*?)\\1\\)?$`, 'm'))
  return m ? m[2] : null
}

const S3 = /^### 3\. /
const S4 = /^### 4\. /
const S7 = /^### 7\. /
const HALT5 = 'reason="security_checks refused on [[rollout]]"'
const PRE = 'reason="args.securityCheck is not this entry\'s verify-timeout securityCheck"'
const FREE_PHRASE = 'free-lane --tasks <slug> || true` while the note keeps `integrating:`'

const ROW = [
  '| `security_checks` | `false` (omit) | `securityCheck` (rollout-level; a task-level key is ignored).',
  "Opt-in: `security_checks: true` on a parallel rollout note, set by hand. Schedule never stamps it, and a `--regenerate` supersede's `carry` copies it onto the new note.",
  'At each entry `reconcile-rollout.py verify-timeout` reads it, runs `security-check.py preflight` and prints `securityCheck` (exit 5 otherwise, § 3).',
  'The lead passes it verbatim on every task call and seeded revise (§ 4), never on an integrate call.',
  "The engine's code-writing agents run `security-check.py scan` after the verifier is green and before they open or update the PR, and the review judge runs it again.",
  "a secret in the task's own non-merge commits since their merge base with `origin/<default>` (gitleaks)",
  'a new or changed dependency, outside test fixtures, with a known advisory (OSV)',
  'A red the agent can fix fails the try like a verifier red.',
  "These are a question for Lachy: a secret already pushed or behind a merge commit; a change to the scanner's own config; an advisory with no fixed release; a finding the agent reads as no credential.",
  "His answer clears it only through the scan. Each question names its `security-accept <kind>:<key>` answer, and the scan honours a token that an answer recorded in the task note's `## Repair input` repeats from its own question (`record-answer`, repair § 3, its 3b).",
  'A pushed secret is rotated first, then accepted or the branch recut (repair § 4), never force-pushed.',
  "Not scanned: Integration's own commits (the integrator's conflict resolution and fix commits) and any merge commit ([[thread-skill-security-check-integration-commits]]).",
  "Parallel rollouts only: a Leg never reads it, so a serial note's `security_checks:` is never read.",
  '`verify-timeout` refuses one only where it runs on a serial note (schedule § Serial path S5), which does not close that gap ([[thread-skill-security-check-serial-chains]]).',
  'A rollout on an Engine snapshot older than this key never reads it either, until a Reinstate moves it (§ 1.5).',
]
const PRE_SENTENCES = [
  "The same check covers `args.securityCheck` (§ 3's `security_checks`). On a task call or seeded revise it must equal this entry's `verify-timeout` `securityCheck`, compared as JSON: present exactly when that line printed one.",
  "An integrate call carries none: Integration's own commits are not scanned, and the engine refuses one (an *Args refusal*).",
  `A mismatch writes nothing and halts as above with \`${PRE}\`, an integrate call's lane freed as above. A resume is exempt from it too.`,
]
const BULLET_PRE = `- § 4's verifySlot pre-check finds a task call's or seeded revise's \`args.securityCheck\` not this entry's \`verify-timeout\` \`securityCheck\`, or an integrate call carrying one (\`${PRE}\`: the same writes as for \`args.verifySlot\`, an integrate call's lane freed the same way; a lead bug: re-invoke), or`
const BULLET_5 = `- \`reconcile-rollout.py verify-timeout\` exits 5 at an entry (§ 3: \`${HALT5}\`: nothing is stamped, cleared or dispatched; fix or remove the rollout's \`security_checks:\`, or install gitleaks, as its ERROR line says, then re-invoke), or`
const REPAIR_SENTENCE = "A security-check question (one that names `security-accept <kind>:<key>` answers, execute § 3 `security_checks`) offers each answer it names as its own option, the accept option's label holding its token verbatim, so record-answer's `--answer`, verbatim, carries it: the scan honours an accept only from an answer that repeats the token its own question named."

// Named failures; [] means every rule holds.
function check(f) {
  const fails = []
  const fail = (rule, bad) => { if (bad) fails.push(rule) }

  // s3-row
  const row = lineAt(section(f.execute, S3), '| `security_checks` |')
  fail('s3-row', !ROW.every((p) => row.includes(p)))

  // exit-5: right after Exit 4, its ERROR line, its halt and the order of the exits.
  const s3raw = section(f.execute, S3) ?? ''
  const e5 = labelled(f.execute, S3, 'Exit 5 (security_checks refused).')
  const labels = s3raw.split('\n').filter((l) => /^\*\*[A-Z`]/.test(l)).map((l) => l.slice(0, 40))
  const i4 = labels.findIndex((l) => l.startsWith('**Exit 4 (verify-slot.py not found'))
  fail('exit-5', i4 < 0 || !(labels[i4 + 1] ?? '').startsWith('**Exit 5 (security_checks refused).**') ||
    !e5.includes('one `ERROR: security_checks: <why>` line on stderr and no stdout') ||
    !e5.includes('`true` on a `shape: serial` note ("parallel rollouts only")') || !e5.includes(HALT5) ||
    !e5.includes('The exits are checked in the order 1, 2, 3, 4, then 5.'))

  // pre-check
  const pre = labelled(f.execute, S4, 'Check verifySlot before the stamps (p32-1).')
  fail('pre-check', !PRE_SENTENCES.every((p) => pre.includes(p)) ||
    !before(pre, 'A resume is exempt: it keeps the original-args rule', PRE_SENTENCES[0]))

  // args: the jsonc entry and its comment, every task call and seeded revise, never an integrate call.
  const s4lines = (section(f.execute, S4) ?? '').split('\n')
  const at = s4lines.findIndex((l) => l === '  "securityCheck": { "script": "<verify-timeout securityCheck.script>" },')
  const comment = at < 0 ? '' : collapse(s4lines.slice(at + 1, at + 4).map((l) => l.replace(/^\s*\/\/\s?/, '')).join(' '))
  fail('args', at < 0 || !comment.includes("ONLY when this entry's verify-timeout printed securityCheck (§ 3), verbatim; OMIT otherwise (byte-identical prompts); every task call and seeded revise, NEVER an integrate call (the engine refuses it)"))

  // halts
  const s7 = collapse(section(f.execute, S7) ?? '')
  fail('halts', !s7.includes(collapse(BULLET_5)) || !s7.includes(collapse(BULLET_PRE)) || s7.split(FREE_PHRASE).length - 1 !== 2)

  // kept
  const kept = lineAt(section(f.execute, S7), '- *Threatens every task*')
  const pats = wholeHalts(f.rr)
  fail('kept', [HALT5, PRE].some((r) => !before(kept, '`' + r + '`', '`reason="ladder file refused"`')) ||
    !['security_checks refused on [[proj-rollout-2026-11-04]]', "args.securityCheck is not this entry's verify-timeout securityCheck"]
      .every((said) => pats.some((p) => p.test(said))))

  // context
  const term = (() => {
    const lines = f.context.split('\n')
    const i = lines.findIndex((l) => l.startsWith('- **Security check** — '))
    if (i < 0) return ''
    const j = lines.findIndex((l, k) => k > i && /^- \*\*/.test(l))
    return collapse(lines.slice(i, j < 0 ? undefined : j).join('\n'))
  })()
  fail('context', !term.includes('`security_checks: true`') || !term.includes('`security-accept <kind>:<key>` token the scan reads from the task note\'s `## Repair input`') ||
    !term.includes("Integration's own commits and merge commits are not scanned ([[thread-skill-security-check-integration-commits]])") ||
    !term.includes('no Leg ever runs it') || !term.includes('_Avoid_: secret scan (alone), audit, CI check.'))

  // template
  const tline = f.template.split('\n').find((l) => l.startsWith('# security_checks: true')) ?? ''
  fail('template', !tline.includes('parallel rollouts only (execute § 3)') || !tline.includes('Hand-set; carry copies it on a --regenerate') ||
    !tline.includes("a serial note's is never read"))

  // carry-doc
  const scope = collapse(sectionOf(f.schedule, /^## Scope/))
  const one = collapse(sectionOf(f.schedule, /^### 1\. /))
  const six = collapse(sectionOf(f.schedule, /^### 6\. /))
  fail('carry-doc', !scope.includes("step 6's carry also copies the prior's `hold_until` lines (`_shared/vault-grammar.md` § Hold until) and its `security_checks:` line (execute § 3)") ||
    !one.includes('the preview prints one `security_checks <value>` line, after the `hold_until` line (or after the carry, keep and restamp lines when there is none) and before the `order` lines: step 6\'s carry copies it into the new note, verbatim.') ||
    !one.includes("the `security_checks` line when the preview printed one (the new rollout keeps the operator's opt-in") ||
    !six.includes("It also copies the prior's `security_checks:` line verbatim into this note (step 1's `security_checks` line, execute § 3), in the same save as the hold, before any task write") ||
    !six.includes("`WARN: carry: security_checks on <this-slug> differs from <prior-slug>'s; <this-slug>'s kept`") ||
    !six.includes("The `# security_checks:` line — leave it commented out as written: the opt-in is Lachy's, set by hand (execute § 3)") ||
    !collapse(f.grammar).includes("Of an approved queue's keys, `carry` copies only the `hold_until` block"))

  // repair-accept: in the needs-you flow's step 1.
  const flow = (() => {
    const lines = f.repair.split('\n')
    const i = lines.findIndex((l) => l.startsWith('*The needs-you flow*'))
    if (i < 0) return ''
    const j = lines.findIndex((l, k) => k > i && /^2\. /.test(l))
    return collapse(lines.slice(i, j < 0 ? undefined : j).join('\n'))
  })()
  fail('repair-accept', !flow.includes(REPAIR_SENTENCE))

  // entry-shape: record-answer's body and ANY_ENTRY_RE against the scan's ENTRY_RE and its split; an entry written in
  // record-answer's shape splits back into its ask and answer.
  const body = f.rr.includes("    body = f'{kind} (block {fp}{key}): \"{ask}\" → {answer}'")
  const anyRe = pyConst(f.rr, 'ANY_ENTRY_RE')
  const entryRe = pyConst(f.scan, 'ENTRY_RE')
  const split = pyConst(f.scan, 'ASK_SPLIT')
  const normalised = entryRe && entryRe.replace('(needs you|decision)', '(?:needs you|decision)').replace('((?:;[^)]*)?)', '(?:;[^)]*)?')
  let roundTrip = false
  if (entryRe && split) {
    const ask = 'keep it (answer `security-accept advisory:0123456789ab`)?'
    const answer = 'keep it (security-accept advisory:0123456789ab)'
    const line = `- 2026-11-04T10:00+11:00 needs you (block 0123456789ab; handed back 2026-11-04T11:00+11:00): "${ask}" → ${answer}`
    const m = line.match(new RegExp(entryRe))
    if (m) {
      const rest = line.slice(m[0].length)
      const k = rest.lastIndexOf(split)
      roundTrip = k >= 0 && rest.slice(0, k) === ask && rest.slice(k + split.length) === answer
    }
  }
  // ANY_ENTRY_RE stops before the ask's opening quote; the scan's ENTRY_RE takes that quote too, so the ask starts at its end.
  fail('entry-shape', !body || !anyRe || normalised !== anyRe + '"' || split !== '" → ' || !roundTrip)

  return [...new Set(fails)]
}

const RULES = ['s3-row', 'exit-5', 'pre-check', 'args', 'halts', 'kept', 'context', 'template', 'carry-doc', 'repair-accept', 'entry-shape']
const CONTROLLED = new Set()
function only(key, from, to, rule, label) {
  assert.equal(FILES[key].split(from).length, 2, `control setup (${label}): ${from.slice(0, 80)} must occur exactly once in ${key}`)
  assert.deepEqual(check({ ...FILES, [key]: FILES[key].replace(from, () => to) }), [rule], label)
  CONTROLLED.add(rule)
}

test('the Security check holds every rule across execute, schedule, repair, the template, CONTEXT.md and the scripts', () => {
  assert.deepEqual(check(FILES), [])
})

test('control: the § 3 row without its accept sentence fails s3-row', () => {
  only('execute', "His answer clears it only through the scan. Each question names its `security-accept <kind>:<key>` answer, and the scan honours a token that an answer recorded in the task note's `## Repair input` repeats from its own question (`record-answer`, repair § 3, its 3b). ", '', 's3-row', 'no accept')
  only('execute', ' ([[thread-skill-security-check-serial-chains]])', '', 's3-row', 'no serial follow-up link')
})

test('control: Exit 5 with the old order sentence fails exit-5', () => {
  only('execute', 'The exits are checked in the order 1, 2, 3, 4, then 5.', 'The exits are checked in the order 1, 2, 3, then 4.', 'exit-5', 'old order')
})

test('control: the pre-check without its integrate clause fails pre-check', () => {
  only('execute', "An integrate call carries none: Integration's own commits are not scanned, and the engine refuses one (an *Args refusal*). ", '', 'pre-check', 'no integrate clause')
})

test('control: the jsonc entry on integrate calls too fails args', () => {
  only('execute', 'revise, NEVER an integrate call (the engine refuses it)', 'revise and every integrate call', 'args', 'integrate too')
})

test('control: § 7 without the exit-5 bullet, or a third free-lane phrase, fails halts', () => {
  only('execute', BULLET_5 + '\n', '', 'halts', 'no exit-5 bullet')
  only('execute', "an integrate call's lane freed the same way; a lead bug: re-invoke), or", `an integrate call's lane freed with \`${FREE_PHRASE}; a lead bug: re-invoke), or`, 'halts', 'a third free-lane phrase')
})

test('control: a reason off the kept list, or no pattern for it, fails kept', () => {
  only('execute', '`reason="security_checks refused on [[rollout]]"` (§ 3: every entry repeats it); ', '', 'kept', 'unlisted')
  only('rr', '    r"args\\.securityCheck is not this entry\'s verify-timeout securityCheck",\n', '', 'kept', 'no pattern')
})

test('control: the CONTEXT.md term without its follow-up link fails context', () => {
  only('context', 'scanned ([[thread-skill-security-check-integration-commits]]), and no Leg', 'scanned, and no Leg', 'context', 'no link')
})

test('control: the template line telling him to re-set it fails template', () => {
  only('template', 'Hand-set; carry copies it on a --regenerate', 'Hand-set; re-set it after a --regenerate', 'template', 're-set')
})

test('control: schedule losing any of its carry sentences fails carry-doc', () => {
  only('schedule', ", the `security_checks` line when the preview printed one (the new rollout keeps the operator's opt-in, so its agents scan their commits before each PR; to drop it, remove the line from the new note after the run)", '', 'carry-doc', 'no report item')
  only('schedule', "It also copies the prior's `security_checks:` line verbatim into this note", "It leaves the prior's `security_checks:` line behind", 'carry-doc', 'no step 6 copy')
  only('schedule', 'the preview prints one `security_checks <value>` line, after the `hold_until` line (or after the carry, keep and restamp lines when there is none) and before the `order` lines', 'the preview prints one `security_checks <value>` line', 'carry-doc', 'no position')
  only('schedule', ' and its `security_checks:` line (execute § 3) into the note this run wrote', ' into the note this run wrote', 'carry-doc', 'no Scope mention')
})

test("control: repair's needs-you flow without the token sentence fails repair-accept", () => {
  only('repair', " A security-check question\n   (one that names", ' A question\n   (one that names', 'repair-accept', 'reworded')
})

test('control: a changed separator in the scan, or in record-answer, fails entry-shape', () => {
  only('scan', `ASK_SPLIT = '" → '`, `ASK_SPLIT = '" -> '`, 'entry-shape', 'scan separator')
  only('rr', `"{ask}" → {answer}'`, `"{ask}" => {answer}'`, 'entry-shape', 'record-answer separator')
  only('scan', String.raw`(needs you|decision) \(block`, String.raw`(needs you) \(block`, 'entry-shape', 'kinds narrowed')
})

test('the rules are all named (11) and each has a control', () => {
  assert.equal(RULES.length, 11)
  assert.deepEqual(RULES.filter((r) => !CONTROLLED.has(r)), [])
})
