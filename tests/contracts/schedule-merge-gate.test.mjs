// Schedule reads the merge gate (ADR 0068, giflab ADR 0012 d4): step 2.5 runs merge-gate.py and sets the repo's
// required merge checks against the verifier, deciding everything and asking nothing. tests/merge-gate.test.mjs pins
// the script's facts and reconcile-rollout-record.test.sh (12d) the `merge-gate` reasonClass; this file pins the prose:
// - step 2.5's merge-gate paragraph: the call, which jobs count (a callee by its caller), which are read (read gaps no
//   read by hand clears), compared / partly read / unread (only a compared context is covered), G's classes from what
//   the steps run, the statements (0)-(4) in their literal texts, the switch to the declared `Verifier:` for every
//   later step, the suffixes, and no tool name and no plain ask in it;
// - schedule's Scope, its Don't on git, the confirm batch, step 6's {{VERIFIER}}, step 8's `Verifier:` and `Merge gate:`
//   lines, § Verification's Merge-gate regression and the Don't on deriving a gate;
// - execute § 3's paragraph and § 4.5 step 4's exit-1 row (the reason from its last ERROR: line), reflect § 11's trace,
//   the run_record and reconcile docstrings, CONTEXT.md's **Merge gate** entry and the ADR;
// - merge-gate.py names no tool, and no touched file writes the possessive `giflab's ADR` (refs rule A would resolve
//   it against this repo's ADR of that number).
//
// One pure function, check(files), over { key: text }: the real files and the controls run through it, and each
// control mutates one real entry in memory and must fail with exactly its rule. Reads files only.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readIf, slice, collapse, section, fencedBlocks } from '../lib/contract-text.mjs'

const FILES = {
  schedule: 'skills/schedule/SKILL.md',
  script: 'skills/_shared/scripts/merge-gate.py',
  execute: 'skills/execute/SKILL.md',
  reflect: 'skills/reflect/SKILL.md',
  runRecord: 'skills/_shared/scripts/run_record.py',
  reconcile: 'skills/execute/scripts/reconcile-rollout.py',
  context: 'CONTEXT.md',
  adr: 'docs/adr/0068-schedule-reads-the-merge-gate.md',
}
const real = Object.fromEntries(Object.entries(FILES).map(([k, p]) => [k, readIf(p)]))

const CALL = "python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/merge-gate.py --repo <§ 0's resolved repo path> --branch <default> --tree origin/<default>"
const CALLEE = "An expanded callee job (`calledBy`) is counted by its caller's triggers (`onFrom`, `prTrigger`, `pushTrigger`) and its " +
  "caller job's `if:` (`calledBy.if`), together with its own `if:`: the callee's own `on: workflow_call` never excludes it."
const CLOSURE = "An entry's closure is every job whose `contexts` holds it."
const READ = 'A job is read when its `readGaps` is empty and the class of each of its steps shows in its `run`, its `uses:` ref and `with:`, or its expanded `action` steps.'
const GAPS = 'A cut step (`runTruncated`), a remote or nested reusable workflow and a local action the script did not expand are read gaps, and no read by hand clears one.'
const COMPARED = 'An entry is compared when it is not `cut`, has a counted job, and every counted job in its closure is read.'
const UNREAD = 'It is partly read when it is `cut` or some counted job is unread, and at least one counted job is read; it is unread when it is ' +
  '`unmatched`, has no counted job, or none is read. A partly read or unread entry is never covered.'
const NOT_READ = '`merge gate: not read (<n> required contexts unread: <context (its read gaps)>, …)`, never "covered"'
const COVERED = '`merge gate: <compared contexts>, covered by the verifier`'
const ONLY = '"covered" names only compared contexts'
const SWITCHED = '`verifier switched: <old> → <new>: the merge gate runs <classes> <old> skips (decided: the repo\'s declared Verifier:, ADR 0068)`'
const STEPS = 'The switched command is the verifier from here on: steps 2.6, 2.9, 6 and 8'
// The tools a "tool list" would hold: step 2.5 and merge-gate.py name none of them (whole words).
const TOOLS = /\b(?:ruff|black|flake8|mypy|pyright|eslint|prettier|tsc)\b/i
// question-gate.test.mjs's PLAIN_ASK: the plain-text ask phrasings.
const PLAIN_ASK = /(?<!\b(?:had|used) to )\b(?:and ask|ask (?:which|him|lachy|the user|in plain text|once)|asks? lachy for|confirm with the user|offer to create)\b/i

const C = (s) => (s == null ? '' : collapse(s))
const has = (text, p) => C(text).includes(p)
const all = (text, ps) => ps.every((p) => has(text, p))

// The CONTEXT.md glossary entry that starts with `head`, up to the next entry, heading or blank line.
function entry(text, head) {
  const lines = (text ?? '').split('\n')
  const i = lines.findIndex((l) => l.startsWith(head))
  if (i < 0) return null
  const out = [lines[i]]
  for (const l of lines.slice(i + 1)) {
    if (/^- \*\*|^#|^\s*$/.test(l)) break
    out.push(l)
  }
  return out.join('\n')
}

// The module docstring of a Python file: from its first `"""` to the next.
function docstring(text) {
  const i = (text ?? '').indexOf('"""')
  if (i < 0) return null
  const j = text.indexOf('"""', i + 3)
  return j < 0 ? null : text.slice(i + 3, j)
}

// The rules that fail, in a fixed order.
function check(f) {
  const fails = []
  const need = (rule, ok) => { if (!ok && !fails.includes(rule)) fails.push(rule) }
  const s25 = section(f.schedule, /^### 2\.5\. /) ?? ''
  const gate = slice(s25, /^\*\*The merge gate \(giflab ADR 0012 d4\)\.\*\*/, null) ?? ''

  need('call', gate.includes(CALL) && has(gate, "with the Bash tool's `timeout: 120000`") &&
    has(s25, 'Print the detected command and use it (the merge gate below may switch it). Store it for step 6.') &&
    has(gate, 'decides everything and asks nothing'))
  need('count', all(gate, ['A job counts when it can run on a task\'s PR into `<default>`: `prTrigger`',
    "`branches`/`branches-ignore`/`types` filters admitting `<default>`", '`pushTrigger`', "admitting `audit-fix/*`",
    'a push filter of `tags` alone admits no branch', 'its `if:` must not exclude that event',
    'A path filter, a path-conditional `if:`, and an `if:` that cannot be read either way all count.']))
  need('callee', has(gate, CALLEE))
  need('closure', has(gate, CLOSURE))
  need('read', has(gate, READ) && has(gate, GAPS))
  need('verifier-runs', all(gate, ['with `git show origin/<default>:<path>`', 'at most three levels deep',
    'A job class counts as run by the verifier only when the command that runs it was found there.']))
  need('compared', has(gate, COMPARED))
  need('unread', has(gate, UNREAD))
  need('classes', all(gate, ['a lint or format check, a type check, a test tier the verifier\'s runner never collects, a build, or another',
    'A class comes from what the steps run, never from a tool list this skill keeps.']))
  need('statements', all(gate, ['The statement, in order, with no question and no stop:',
    '(0) Status `none` → `merge gate: none on <branch>`',
    'Status `unreadable`, `jobs: null`, a `partial` read with nothing required, or a non-zero exit → `merge gate: not read (<why>)`',
    "(3) Classes still in G that the declared `Completion verifier:` runs → `merge gate: <classes> run at the completion verifier, not per task (the repo's declared split, estate ADR 0009 d6)`",
    "(4) Any class left → `merge gate runs <classes> the verifier skips: a PR can converge green and halt at merge; declare a covering Verifier: (and a Completion verifier: for a slower tier) in <repo>'s CLAUDE.md, then --regenerate`"]))
  need('covered', all(gate, [`(1) G empty and no compared entry → ${NOT_READ}`, `G empty otherwise → ${COVERED}: ${ONLY}`]))
  need('switch', all(gate, ["(2) When the verifier in hand is not the project's declared `Verifier:` (it was user-provided), and the declared " +
    "command's own G is a strict subset of the in-hand verifier's G", SWITCHED, STEPS]))
  need('suffixes', all(gate, ['`; unread: <context (its read gaps)>, …` for each partly read or unread entry', '`(partial: <why>)`',
    '`(truncated)`', "It goes in the confirm batch and in step 8's `Merge gate:` line.",
    'The orient-all fork and the chain run the same rule, with no question.']))
  need('no-tools', !TOOLS.test(gate) && !TOOLS.test(f.script ?? ''))
  need('no-ask', !PLAIN_ASK.test(C(gate)))

  const scope = section(f.schedule, /^## Scope$/) ?? ''
  need('scope', has(scope, "step 2.5's `merge-gate.py` makes two read-only `gh api` GETs (`repos/<o>/<n>/branches/<b>`, " +
    "`repos/<o>/<n>/rules/branches/<b>`), runs `land.sh --origin-slug` (a read-only `git remote get-url origin`) and read-only " +
    "`git rev-parse`, `git ls-tree` and `git show` of `origin/<default>`, and writes nothing, and step 2.5 also reads the verifier's " +
    'recipe with read-only `git show origin/<default>:<path>`'))
  const noGit = (f.schedule ?? '').split('\n').find((l) => l.startsWith("- Don't run `git` operations")) ?? ''
  need('dont-git', has(noGit, "step 2.5's `merge-gate.py` and its `git show origin/<default>:<path>` reads, read-only (listed under Scope)"))
  const s5 = section(f.schedule, /^### 5\. /) ?? ''
  need('confirm', has(s5, "statements (step 1's report, step 1.2's sweep, step 2.5's merge gate, step 2.8's settings,"))
  need('step6', has(section(f.schedule, /^### 6\. /), "- `{{VERIFIER}}` — the verifier command detected in step 2.5 (or user-provided), or the one step 2.5's merge gate switched to"))
  const block = fencedBlocks(section(f.schedule, /^### 8\. /) ?? '')[0] ?? []
  const v = block.findIndex((l) => l === "Verifier: <detected command, or step 2.5's switched one>")
  need('step8', v >= 0 && (block[v + 1] ?? '').startsWith("Merge gate: <step 2.5's statement>") &&
    (block[v + 1] ?? '').includes('`verifier switched: …`'))
  const reg = section(f.schedule, /^### Merge-gate regression \(step 2\.5\)$/) ?? ''
  need('verification', all(reg, ['1. A repo whose required check runs a lint job, with a tests-only declared `Verifier:`: statement (4)',
    'in the confirm batch and in step 8\'s `Merge gate:` line. Nothing is asked and the run goes on',
    '2. The same lint in a local reusable workflow (`on: workflow_call`) called from a `pull_request` workflow: still statement (4)',
    '5. Every required context unread', '`merge gate: not read (1 required contexts unread: …)`, never covered',
    '6. A `Checks Complete` roll-up whose lint need is a remote reusable workflow', 'remote reusable workflow …))`, never covered']))
  const donts = section(f.schedule, /^## Don'ts$/) ?? ''
  need('donts', has(donts, "- Never derive a gate command from CI or name a tool in step 2.5: its switch takes only the project's `CLAUDE.md` `Verifier:`. " +
    'A merge-gate gap with no declared cover is a statement, never a question or a stop, and never say "covered" for a context that is not compared.'))

  const s3 = section(f.execute, /^### 3\. /) ?? ''
  const row1 = (f.execute ?? '').split('\n').find((l) => l.startsWith('   | 1 | *Set aside* at its own run')) ?? ''
  need('execute', all(s3, ['**The verifier and the merge gate (giflab ADR 0012 d4).**', 'reasonClass `merge-gate`',
    "read off the stop's own cause: the reason's last `ERROR:` line", 'that is a schedule-time miss of schedule § 2.5 (its merge gate), and reflect § 11 traces it there']) &&
    has(row1, 'reason `merge-task: <its output from its last ERROR: line to the end>`'))
  need('reflect', all(section(f.reflect, /^### 11\. /), ['`merge-gate`', 'traces to schedule § 2.5 (its merge gate), a schedule-time miss']))
  need('records', all(docstring(f.runRecord), ['merge-task | merge-gate | declined', 'a merge-task stop whose own cause (its last `ERROR:` line) is a red required check']) &&
    all(docstring(f.reconcile), ['merge-gate (a reason starting `merge-task` whose last `ERROR:` line',
      'the mark printed before an infra rerun that a later `ERROR:` line follows stays merge-task)']))
  need('context', all(entry(f.context, '- **Merge gate** — '), ['`merge-gate.py`', '**closure**', '**job class**', '**compared**',
    'reasonClass `merge-gate`', '`integration-red`', '_Avoid_: CI green, CLEAN.']))
  need('adr', (f.adr ?? '').startsWith('# 0068 — Schedule reads the merge gate\n'))
  need('possessive', Object.values(f).every((t) => !/\b(?:giflab|GifLab)'s ADR\b/.test(t ?? '')))
  return fails
}

test('schedule reads the merge gate: step 2.5, its siblings in schedule, execute, reflect, the records, CONTEXT.md, the ADR', () => {
  assert.deepEqual(check(real), [])
})

// Replaces the one occurrence of `from` in real[key]; a control whose target is missing or ambiguous fails its setup.
function edit(key, from, to) {
  const text = real[key]
  assert.equal(text.split(from).length, 2, `control setup: ${from.slice(0, 80)} must occur exactly once in ${key}`)
  return { ...real, [key]: text.replace(from, to) }
}
const only = (files, rule, label) => assert.deepEqual(check(files), [rule], label)

test('control: each step 2.5 rule fails alone', () => {
  only(edit('schedule', "with the Bash tool's `timeout: 120000`", 'with the Bash tool'), 'call', 'no timeout')
  only(edit('schedule', 'a push filter of `tags` alone admits no branch', 'a push filter of `tags` counts'), 'count', 'tags-only counts')
  only(edit('schedule', ` ${CALLEE}`, ''), 'callee', 'the callee sentence deleted')
  only(edit('schedule', ` ${CLOSURE}`, ''), 'closure', 'the closure sentence deleted')
  only(edit('schedule', ', and no read by hand clears one', ''), 'read', 'a read by hand may clear a gap')
  only(edit('schedule', 'at most three levels deep', 'as deep as it goes'), 'verifier-runs', 'unbounded')
  only(edit('schedule', 'and every counted job in its closure is read', 'and one counted job in its closure is read'), 'compared', 'every → one')
  only(edit('schedule', ' A partly read or unread entry is never covered.', ''), 'unread', 'the never-covered sentence deleted')
  only(edit('schedule', ', never from a tool list this skill keeps', ''), 'classes', 'a tool list allowed')
  only(edit('schedule', ' with no question and no stop:', ':'), 'statements', 'the no-question clause deleted')
})

test('control: "covered" names only compared contexts', () => {
  only(edit('schedule', NOT_READ, '`merge gate: <contexts>, covered by the verifier`'), 'covered', 'nothing compared reads covered')
  only(edit('schedule', `: ${ONLY}`, ''), 'covered', 'the only-compared clause deleted')
})

test('control: the switch reaches every later step, and the statement its places', () => {
  only(edit('schedule', 'is a strict subset of', 'differs from'), 'switch', 'no strict subset')
  only(edit('schedule', 'steps 2.6, 2.9, 6 and 8', 'step 6'), 'switch', 'only step 6')
  only(edit('schedule', "It goes in the confirm batch and in step 8's `Merge gate:` line.", 'It is printed.'), 'suffixes', 'no places')
})

test('control: no tool name and no plain ask in step 2.5, and no tool name in merge-gate.py', () => {
  only(edit('schedule', 'Setup steps (checkout, install, cache) run no class.', 'Setup steps (checkout, install, cache, Prettier) run no class.'),
    'no-tools', 'a tool in step 2.5')
  only(edit('script', 'GH_TIMEOUT = 20 ', 'GH_TIMEOUT = 20  # mypy '), 'no-tools', 'a tool in merge-gate.py')
  only(edit('schedule', 'Setup steps (checkout, install, cache) run no class.', 'Setup steps (checkout, install, cache) run no class; when unsure, ask Lachy which.'),
    'no-ask', 'a plain ask')
})

test('control: schedule\'s Scope, Don\'ts, confirm batch, step 6, step 8 and § Verification each fail their rule', () => {
  only(edit('schedule', ", and writes nothing, and step 2.5 also reads the verifier's recipe", ", and step 2.5 also reads the verifier's recipe"), 'scope', 'no writes-nothing')
  only(edit('schedule', "step 2.5's `merge-gate.py` and its `git show origin/<default>:<path>` reads, read-only (listed under Scope), ", ''), 'dont-git', 'not listed')
  only(edit('schedule', "1.2's sweep, step 2.5's merge gate, step 2.8's settings,", "1.2's sweep, step 2.8's settings,"), 'confirm', 'not in the batch')
  only(edit('schedule', ", or the one step 2.5's merge gate switched to", ''), 'step6', 'no switched verifier')
  only(edit('schedule', "Merge gate: <step 2.5's statement>", "Gate: <step 2.5's statement>"), 'step8', 'no Merge gate line')
  only(edit('schedule', '`merge gate: not read (1 required contexts unread: …)`, never covered', '`merge gate: not read (…)`'), 'verification', 'case 5 loosened')
  only(edit('schedule', ' and never say "covered" for a context that is not compared', ''), 'donts', 'covered allowed')
})

test('control: execute, reflect, the records, CONTEXT.md and the ADR each fail their rule', () => {
  only(edit('execute', 'reason `merge-task: <its output from its last ERROR: line to the end>`', 'reason `merge-task: <its output>`'), 'execute', 'the whole output')
  only(edit('reflect', 'traces to\n  schedule § 2.5 (its merge gate), a schedule-time miss', 'traces to\n  execute § 4.5'), 'reflect', 'traced elsewhere')
  only(edit('runRecord', 'merge-task | merge-gate | declined', 'merge-task | declined'), 'records', 'run_record lacks it')
  only(edit('reconcile', 'printed before an infra rerun that a later `ERROR:` line follows stays merge-task)', 'anywhere)'), 'records', 'the mark anywhere')
  only(edit('context', '_Avoid_: CI\n  green, CLEAN.', ''), 'context', 'no Avoid')
  only({ ...real, adr: null }, 'adr', 'no ADR')
  only(edit('adr', "It is thread-skill's side of giflab ADR 0012 d4.", "It is thread-skill's side of giflab's ADR 0012 d4."), 'possessive', 'the possessive')
})
