// skills/_shared/scripts/rollout-settings.py — the resolver for the operator's rollout settings (p15-4, ADR 0032).
//
// The file is `~/.config/thread/rollouts.toml`, ladder.toml's sibling: `[defaults]` (the seven rollout keys: the four
// Tuning keys, execute's `auto_retries`, p16-4, the standing approval's `spend_approval_usd`, ADR 0034, and the
// machine-wide `verify_slots`, p23-4, which a repo table may not hold),
// `[guardrails]` (the Reflection's bounds), `[notify]` (ADR 0038 d3: `ntfy_topic`, the needs-you push's ntfy fallback,
// machine-wide like the guardrails) and `[repo."owner/name"]` tables keyed by the GitHub origin that
// `land.sh --origin-slug` reads from the local clone. No file gives the built-in values. A present file that
// does not validate is refused with one `rollout-settings: <path>[:<line>]: <reason>` line (ADR 0016's typo
// rule), never a silent fall back to the built-ins.
//
// Hermetic: each case gets its own HOME under mkdtemp, so the script's `~` resolves there, and its own temp git
// repos. python3 runs with -B and PYTHONDONTWRITEBYTECODE so no __pycache__ lands next to the script. Fixtures
// are built line by line, so each asserted line number is the line the fixture puts the bad key on.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync, execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SCRIPT = path.join(root, 'skills', '_shared', 'scripts', 'rollout-settings.py')
// KEYS are the four Tuning keys (run_record.py's TUNING_KEYS, tune.py and score.py read them); SETTING_KEYS adds
// `auto_retries` (p16-4: execute's automatic retries, >= 0, not Reflection-tunable) and `spend_approval_usd` (ADR 0034: the
// standing approval's limit in US dollars, >= 0, built-in 0 = off, not Reflection-tunable) and `verify_slots` (p23-4: the
// machine's verify slots, >= 1, built-in 2, [defaults] only): every key a `settings` object holds.
const KEYS = ['parallel_ceiling', 'max_review_rounds', 'max_iterations', 'max_plan_rounds']
const SETTING_KEYS = [...KEYS, 'auto_retries', 'spend_approval_usd', 'verify_slots']
const MINIMUM = { parallel_ceiling: 1, max_review_rounds: 1, max_iterations: 1, max_plan_rounds: 1, auto_retries: 0, spend_approval_usd: 0,
  verify_slots: 1 }
// review_churn_pct (p21-3): Review churn's absolute bound, built-in 40.
// hours_per_task (p21-2): the Throughput Guardrail's bound, running hours per task whose Slot or lane holding overlaps
// the window.
const GUARDRAIL_KEYS = ['tokens_per_merge_pct', 'set_aside_rate_points', 'conflict_rate_points', 'quota_stalls', 'review_churn_pct',
  'hours_per_task']
const BUILT_IN = { parallel_ceiling: 4, max_review_rounds: 4, max_iterations: 3, max_plan_rounds: 3, auto_retries: 2, spend_approval_usd: 0,
  verify_slots: 2 }
const GUARDRAILS_BUILT_IN = { tokens_per_merge_pct: 25, set_aside_rate_points: 5, conflict_rate_points: 10, quota_stalls: 0,
  review_churn_pct: 40, hours_per_task: 1.5 }
// [notify] (ADR 0038 d3): the ntfy topic the needs-you fallback publishes to; unset (null) means no fallback. resolve()
// holds the topic; the CLI prints only whether it is set (redacted()), since on ntfy.sh a topic is its own read and
// publish credential and the CLI runs in schedule's, execute's, status' and repair's transcripts.
const NOTIFY_KEYS = ['ntfy_topic']
const NOTIFY_BUILT_IN = { ntfy_topic: null }
const UNSET = { ntfy_topic: { set: false, source: 'built-in' } }
const SET = { ntfy_topic: { set: true, source: 'file:notify' } }
const TABLES_LINE = 'rollouts.toml holds only a top-level schema and [defaults], [guardrails], [notify] and [repo."owner/name"] tables'
// The JSON's top-level keys: the repo's Inert paths (p29-3, ADR 0045) and its test-credential class (ADR 0062) follow the
// three tables, then the schema pair and the ignored keys (ADR 0043, p29-1).
const OUT_KEYS = ['path', 'file', 'repo', 'settings', 'guardrails', 'notify', 'inert_paths', 'test_credentials', 'schema', 'ignored']
const NO_INERT = { value: [], source: 'built-in' }
const NO_CREDS = { value: null, source: 'built-in' }
const REAL_GIT = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim()

// ---- helpers ------------------------------------------------------------------------------------------

function tmpHome(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'rollout-settings-'))
  t.after(() => fs.rmSync(home, { recursive: true, force: true }))
  return home
}

const settingsPath = (home) => path.join(home, '.config', 'thread', 'rollouts.toml')

function writeSettings(home, lines) {
  const p = settingsPath(home)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, Array.isArray(lines) ? lines.join('\n') + '\n' : lines)
  return p
}

// A git repo under home whose origin is `url` (no origin when url is null).
function gitRepo(home, name, url) {
  const dir = path.join(home, name)
  fs.mkdirSync(dir, { recursive: true })
  execFileSync(REAL_GIT, ['init', '-q', dir])
  if (url) execFileSync(REAL_GIT, ['-C', dir, 'remote', 'add', 'origin', url])
  return dir
}

function run(home, args = [], { env = {}, argv } = {}) {
  const r = spawnSync('python3', argv || ['-B', SCRIPT, ...args], {
    encoding: 'utf8',
    env: { ...process.env, HOME: home, PYTHONDONTWRITEBYTECODE: '1', ...env },
  })
  return { status: r.status, stdout: r.stdout, stderr: r.stderr }
}

function resolves(home, args = [], opts = {}) {
  const r = run(home, args, opts)
  assert.equal(r.stderr, '', 'nothing on stderr on success')
  assert.equal(r.status, 0)
  assert.match(r.stdout, /^\{.*\}\n$/, 'exactly one JSON line on stdout')
  return JSON.parse(r.stdout)
}

// The importable resolve(repo, None) in process, as ntfy-push.py and tune.py call it: the topic itself, unredacted.
function resolvedInProcess(home, repo = null) {
  const r = run(home, [], {
    argv: ['-B', '-c', `import importlib.util, json, sys
spec = importlib.util.spec_from_file_location('rs', sys.argv[1]); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
print(json.dumps(m.resolve(repo=sys.argv[2] if len(sys.argv) > 2 else None)))`, SCRIPT, ...(repo ? [repo] : [])],
  })
  assert.equal(r.status, 0, r.stderr)
  return JSON.parse(r.stdout)
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Refused: exit `code`, nothing on stdout, one `rollout-settings: <path>[:<line>]: <reason>` line on stderr.
function refused(home, { line = null, reason, code = 2, args = [], argv } = {}) {
  const r = run(home, args, { argv })
  const p = escapeRe(settingsPath(home))
  assert.equal(r.status, code, `exit ${code}; stderr: ${r.stderr}`)
  assert.equal(r.stdout, '', 'nothing on stdout on failure')
  assert.doesNotMatch(r.stderr, /Traceback/)
  const where = line === null ? p : `${p}:${line}`
  assert.match(r.stderr, new RegExp(`^rollout-settings: ${where}: .+\\n$`), `one line naming ${line === null ? 'no line' : `line ${line}`}; got ${r.stderr}`)
  if (reason) assert.match(r.stderr, reason)
  return r.stderr
}

function expectValues(out, values, sources) {
  for (const k of SETTING_KEYS) {
    assert.deepEqual(out.settings[k], { value: values[k] ?? BUILT_IN[k], source: sources[k] ?? 'built-in' }, k)
  }
}

function assertAllBuiltIn(out) {
  assert.deepEqual(Object.keys(out), OUT_KEYS)
  assert.deepEqual(Object.keys(out.settings), SETTING_KEYS)
  assert.deepEqual(Object.keys(out.guardrails), GUARDRAIL_KEYS)
  for (const k of SETTING_KEYS) assert.deepEqual(out.settings[k], { value: BUILT_IN[k], source: 'built-in' })
  for (const k of GUARDRAIL_KEYS) assert.deepEqual(out.guardrails[k], { value: GUARDRAILS_BUILT_IN[k], source: 'built-in' })
  // An absent [notify] table resolves to no topic: the needs-you push has no ntfy fallback.
  assert.deepEqual(out.notify, UNSET)
  assert.deepEqual(out.inert_paths, NO_INERT)
  assert.deepEqual(out.test_credentials, NO_CREDS)
}

// ---- R1: no file ----------------------------------------------------------------------------------------

test('R1 no file: every value is built-in, file false, repo null, one JSON line', (t) => {
  const home = tmpHome(t)
  const out = resolves(home)
  assertAllBuiltIn(out)
  assert.equal(out.path, settingsPath(home))
  assert.equal(out.file, false)
  assert.equal(out.repo, null)
})

test('R1 no file, with --repo on a GitHub clone: built-in, and land.sh is not needed (repo null)', (t) => {
  const home = tmpHome(t)
  const out = resolves(home, ['--repo', gitRepo(home, 'r', 'https://github.com/o/r')])
  assertAllBuiltIn(out)
  assert.equal(out.repo, null)
})

test('R1 ~/.config/thread as a plain file (a step on the way is no directory) gives the built-ins', (t) => {
  const home = tmpHome(t)
  fs.mkdirSync(path.join(home, '.config'))
  fs.writeFileSync(path.join(home, '.config', 'thread'), 'not a dir\n')
  assertAllBuiltIn(resolves(home))
})

// ---- R2: [defaults] -------------------------------------------------------------------------------------

test('R2 [defaults] only: its keys are file:defaults, the rest built-in', (t) => {
  const home = tmpHome(t)
  writeSettings(home, ['[defaults]', 'parallel_ceiling = 2', 'max_review_rounds = 6'])
  const out = resolves(home)
  assert.equal(out.file, true)
  expectValues(out, { parallel_ceiling: 2, max_review_rounds: 6 },
    { parallel_ceiling: 'file:defaults', max_review_rounds: 'file:defaults' })
})

test('R2 [defaults] only, with --repo on a clone: still file:defaults, repo null (no repo table, no land.sh)', (t) => {
  const home = tmpHome(t)
  writeSettings(home, ['[defaults]', 'parallel_ceiling = 2'])
  const out = resolves(home, ['--repo', gitRepo(home, 'r', 'https://github.com/o/r')])
  assert.equal(out.repo, null)
  expectValues(out, { parallel_ceiling: 2 }, { parallel_ceiling: 'file:defaults' })
})

test('R2 auto_retries (p16-4): built-in 2, and 0 is a valid [defaults] value (it disables automatic retries)', (t) => {
  const home = tmpHome(t)
  assert.deepEqual(resolves(home).settings.auto_retries, { value: 2, source: 'built-in' })
  writeSettings(home, ['[defaults]', 'auto_retries = 0'])
  const out = resolves(home)
  expectValues(out, { auto_retries: 0 }, { auto_retries: 'file:defaults' })
  writeSettings(home, ['[defaults]', 'auto_retries = 3'])
  expectValues(resolves(home), { auto_retries: 3 }, { auto_retries: 'file:defaults' })
})

test('R2 spend_approval_usd (ADR 0034): built-in 0 (off); [defaults] sets it, a repo table overrides it, 0 is valid', (t) => {
  const home = tmpHome(t)
  assert.deepEqual(resolves(home).settings.spend_approval_usd, { value: 0, source: 'built-in' })
  writeSettings(home, ['[defaults]', 'spend_approval_usd = 50'])
  expectValues(resolves(home), { spend_approval_usd: 50 }, { spend_approval_usd: 'file:defaults' })
  writeSettings(home, ['[defaults]', 'spend_approval_usd = 0'])
  expectValues(resolves(home), { spend_approval_usd: 0 }, { spend_approval_usd: 'file:defaults' })
  writeSettings(home, ['[defaults]', 'spend_approval_usd = 50', '[repo."o/r"]', 'spend_approval_usd = 20'])
  const out = resolves(home, ['--repo', gitRepo(home, 'r', 'https://github.com/o/r')])
  expectValues(out, { spend_approval_usd: 20 }, { spend_approval_usd: 'file:repo' })
})

test('R2 verify_slots (p23-4): built-in 2; [defaults] sets it (file:defaults)', (t) => {
  const home = tmpHome(t)
  assert.deepEqual(resolves(home).settings.verify_slots, { value: 2, source: 'built-in' })
  writeSettings(home, ['[defaults]', 'verify_slots = 3'])
  expectValues(resolves(home), { verify_slots: 3 }, { verify_slots: 'file:defaults' })
  writeSettings(home, ['[defaults]', 'verify_slots = 1'])
  expectValues(resolves(home), { verify_slots: 1 }, { verify_slots: 'file:defaults' })
  writeSettings(home, ['[defaults]', 'verify_slots = 4', '[repo."o/r"]', 'parallel_ceiling = 2'])
  const out = resolves(home, ['--repo', gitRepo(home, 'r', 'https://github.com/o/r')])
  expectValues(out, { verify_slots: 4, parallel_ceiling: 2 }, { verify_slots: 'file:defaults', parallel_ceiling: 'file:repo' })
})

test('R2 verify_slots in a repo table is refused at its line (machine-wide), with and without --repo', (t) => {
  const home = tmpHome(t)
  writeSettings(home, ['[defaults]', 'verify_slots = 2', '[repo."o/r"]', 'parallel_ceiling = 2', 'verify_slots = 1'])
  const why = /\[repo\."o\/r"\] verify_slots is machine-wide: set it under \[defaults\]/
  refused(home, { line: 5, reason: why })
  refused(home, { line: 5, reason: why, args: ['--repo', gitRepo(home, 'r', 'https://github.com/o/r')] })
})

// ---- R3: a repo override -----------------------------------------------------------------------------------

test('R3 auto_retries in a repo table overrides [defaults] (file:repo)', (t) => {
  const home = tmpHome(t)
  writeSettings(home, ['[defaults]', 'auto_retries = 3', '[repo."o/r"]', 'auto_retries = 1'])
  const out = resolves(home, ['--repo', gitRepo(home, 'r', 'https://github.com/o/r')])
  assert.equal(out.repo, 'o/r')
  expectValues(out, { auto_retries: 1 }, { auto_retries: 'file:repo' })
})

test('R3 a [repo."owner/name"] table matches the clone\'s GitHub origin, ignoring case', (t) => {
  const home = tmpHome(t)
  writeSettings(home, ['[defaults]', 'max_review_rounds = 5', '', '[repo."Lachyts/Thread-Skill"]', 'parallel_ceiling = 6'])
  const one = resolves(home, ['--repo', gitRepo(home, 'a', 'https://github.com/lachyts/thread-skill.git')])
  assert.equal(one.repo, 'lachyts/thread-skill')
  expectValues(one, { parallel_ceiling: 6, max_review_rounds: 5 },
    { parallel_ceiling: 'file:repo', max_review_rounds: 'file:defaults' })
  // A self-rollout's separate clone, over SSH and in another case, resolves the same values.
  const two = resolves(home, ['--repo', gitRepo(home, 'b', 'git@github.com:LACHYTS/thread-skill')])
  assert.equal(two.repo, 'LACHYTS/thread-skill')
  assert.deepEqual(two.settings, one.settings)
})

test('R3 a subdirectory of the clone resolves through its repo, and ~ in --repo is expanded', (t) => {
  const home = tmpHome(t)
  writeSettings(home, ['[repo."o/r"]', 'max_plan_rounds = 7'])
  const dir = gitRepo(home, 'proj', 'ssh://git@github.com/o/r.git/')
  fs.mkdirSync(path.join(dir, 'sub'))
  const out = resolves(home, ['--repo', '~/proj/sub'])
  assert.equal(out.repo, 'o/r')
  expectValues(out, { max_plan_rounds: 7 }, { max_plan_rounds: 'file:repo' })
})

test('R3 a repo table for another repo does not apply: defaults, with the clone\'s slug reported', (t) => {
  const home = tmpHome(t)
  writeSettings(home, ['[defaults]', 'parallel_ceiling = 3', '[repo."o/other"]', 'parallel_ceiling = 9'])
  const out = resolves(home, ['--repo', gitRepo(home, 'r', 'https://github.com/o/r')])
  assert.equal(out.repo, 'o/r')
  expectValues(out, { parallel_ceiling: 3 }, { parallel_ceiling: 'file:defaults' })
})

test('R3 dotted keys and inline tables resolve like table form', (t) => {
  const home = tmpHome(t)
  writeSettings(home, ['defaults = { max_iterations = 2 }', 'repo."o/r".parallel_ceiling = 5'])
  const out = resolves(home, ['--repo', gitRepo(home, 'r', 'https://github.com/o/r')])
  expectValues(out, { parallel_ceiling: 5, max_iterations: 2 },
    { parallel_ceiling: 'file:repo', max_iterations: 'file:defaults' })
})

// ---- R4: refusals ---------------------------------------------------------------------------------------

const REFUSALS = [
  ['parallel_ceiling = 0', ['[defaults]', 'parallel_ceiling = 0'], 2, /\[defaults\] parallel_ceiling must be an integer >= 1, got 0/],
  ['parallel_ceiling = "4"', ['[defaults]', 'parallel_ceiling = "4"'], 2, /must be an integer >= 1, got a string/],
  ['parallel_ceiling = true', ['[defaults]', 'parallel_ceiling = true'], 2, /must be an integer >= 1, got a boolean/],
  ['parallel_ceiling = 2.5', ['[defaults]', 'parallel_ceiling = 2.5'], 2, /must be an integer >= 1, got a float/],
  ['auto_retries = -1', ['[defaults]', 'auto_retries = -1'], 2, /\[defaults\] auto_retries must be an integer >= 0, got -1/],
  ['auto_retries = true', ['# settings', '[defaults]', 'auto_retries = true'], 3, /auto_retries must be an integer >= 0, got a boolean/],
  ['auto_retries = 1.5', ['[defaults]', 'max_review_rounds = 3', 'auto_retries = 1.5'], 3, /auto_retries must be an integer >= 0, got a float/],
  ['auto_retries = "2"', ['[defaults]', 'auto_retries = "2"'], 2, /auto_retries must be an integer >= 0, got a string/],
  ['auto_retries = -1 in a repo table', ['[repo."o/r"]', 'parallel_ceiling = 3', 'auto_retries = -1'], 3,
    /\[repo\."o\/r"\] auto_retries must be an integer >= 0, got -1/],
  ['an unknown key in [defaults]', ['[defaults]', 'max_review_rounds = 3', 'paralel_ceiling = 3'], 3,
    /\[defaults\]: unknown key "paralel_ceiling"/],
  ['an unknown key in a repo table', ['[repo."o/r"]', 'max_rounds = 3'], 2, /\[repo\."o\/r"\]: unknown key "max_rounds"/],
  ['an unknown key names all eight rollout keys', ['[defaults]', 'auto_retry = 1'], 2,
    /unknown key "auto_retry" \(a rollout table holds parallel_ceiling, max_review_rounds, max_iterations, max_plan_rounds, auto_retries, spend_approval_usd, verify_slots, inert_paths, test_credentials\)/],
  ['verify_slots = 0', ['[defaults]', 'verify_slots = 0'], 2, /\[defaults\] verify_slots must be an integer >= 1, got 0/],
  ['verify_slots = true', ['[defaults]', 'verify_slots = true'], 2, /verify_slots must be an integer >= 1, got a boolean/],
  ['verify_slots = 1.5', ['[defaults]', 'verify_slots = 1.5'], 2, /verify_slots must be an integer >= 1, got a float/],
  ['verify_slots = "2"', ['[defaults]', 'verify_slots = "2"'], 2, /verify_slots must be an integer >= 1, got a string/],
  ['a dotted repo verify_slots', ['repo."o/r".verify_slots = 2'], 1, /\[repo\."o\/r"\] verify_slots is machine-wide/],
  ['spend_approval_usd = -1', ['[defaults]', 'spend_approval_usd = -1'], 2, /\[defaults\] spend_approval_usd must be an integer >= 0, got -1/],
  ['spend_approval_usd = 50.5', ['[defaults]', 'spend_approval_usd = 50.5'], 2, /spend_approval_usd must be an integer >= 0, got a float/],
  ['spend_approval_usd = "50"', ['[defaults]', 'spend_approval_usd = "50"'], 2, /spend_approval_usd must be an integer >= 0, got a string/],
  ['an unknown table [default]', ['# settings', '[default]', 'parallel_ceiling = 3'], 2,
    new RegExp(`unknown top-level key "default" \\(${escapeRe(TABLES_LINE)}\\)`)],
  ['a repo key ending .git', ['[repo."o/r.git"]', 'parallel_ceiling = 3'], 1, /\.git/],
  ['a repo key that is no owner/name', ['[repo."not-a-slug"]', 'parallel_ceiling = 3'], 1, /owner\/name/],
  ['an all-dots repo name', ['[repo."o/..."]', 'parallel_ceiling = 3'], 1, /owner\/name/],
  ['a guardrail below zero', ['[guardrails]', 'tokens_per_merge_pct = -1'], 2, /tokens_per_merge_pct must be a non-negative number/],
  ['a boolean guardrail', ['[guardrails]', 'tokens_per_merge_pct = true'], 2, /tokens_per_merge_pct must be a non-negative number, got a boolean/],
  ['a fractional quota_stalls', ['[guardrails]', 'quota_stalls = 1.5'], 2, /quota_stalls must be an integer >= 0/],
  ['a negative review_churn_pct', ['[guardrails]', 'review_churn_pct = -5'], 2, /review_churn_pct must be a non-negative number, got -5/],
  ['a boolean review_churn_pct', ['[guardrails]', 'review_churn_pct = false'], 2, /review_churn_pct must be a non-negative number, got a boolean/],
  ['a guardrail in a repo table (guardrails are machine-wide)', ['[repo."o/r"]', 'quota_stalls = 1'], 2, /unknown key "quota_stalls"/],
  ['an unknown guardrail', ['[guardrails]', 'tokens_pct = 3'], 2, /\[guardrails\]: unknown key "tokens_pct"/],
  ['hours_per_task = 0 (a run allowed no running time)', ['[guardrails]', 'hours_per_task = 0'], 2, /\[guardrails\] hours_per_task must be a number > 0, got 0/],
  ['hours_per_task = -1', ['# settings', '[guardrails]', 'hours_per_task = -1'], 3, /\[guardrails\] hours_per_task must be a number > 0, got -1/],
  ['hours_per_task = true', ['[guardrails]', 'hours_per_task = true'], 2, /hours_per_task must be a number > 0, got a boolean/],
  ['hours_per_task = "2"', ['[guardrails]', 'hours_per_task = "2"'], 2, /hours_per_task must be a number > 0, got a string/],
  ['repo as a scalar', ['repo = 5'], 1, /repo must be a table of tables/],
  ['repo as an array of tables', ['[[repo]]', 'parallel_ceiling = 3'], 1, /repo must be a table of tables/],
  ['a scalar under repo names its key and value', ['# settings', 'repo."o/r" = 5'], 2, /\[repo\."o\/r"\] must be a table, got 5 /],
  ['a rollout key straight under [repo] names that key', ['[repo]', 'parallel_ceiling = 3'], 2,
    /\[repo\."parallel_ceiling"\] must be a table, got 3 /],
  ['defaults as a scalar', ['defaults = 4'], 1, /defaults must be a table/],
  ['a dotted unknown key', ['repo."o/r".paralel_ceiling = 5'], 1, /unknown key "paralel_ceiling"/],
  ['a dotted guardrail in [defaults]\'s place', ['defaults.quota_stalls = 1'], 1, /\[defaults\]: unknown key "quota_stalls"/],
  ['an inline table with a bad nested key names the repo = line', ['# settings', 'repo = { "o/r" = { paralel_ceiling = 5 } }'], 2,
    /unknown key "paralel_ceiling"/],
  ['a TOML syntax error', ['[defaults]', 'parallel_ceiling = '], 2, /invalid TOML/],
  // [notify] (ADR 0038 d3): a table holding only ntfy_topic, an ntfy topic (1 to 64 of A-Z, a-z, 0-9, - and _). A refused
  // string is described, never echoed, so a near-miss topic never reaches a transcript.
  ['notify as a scalar', ['notify = 5'], 1, /notify must be a table \(\[notify\]\), got 5/],
  ['an unknown key in [notify]', ['[notify]', 'topic = "x"'], 2, /\[notify\]: unknown key "topic" \(\[notify\] holds ntfy_topic\)/],
  ['an empty ntfy_topic', ['[notify]', 'ntfy_topic = ""'], 2, /\[notify\] ntfy_topic must be an ntfy topic .*, got an empty string/],
  ['a URL as ntfy_topic (the topic alone, never the server)', ['# settings', '[notify]', 'ntfy_topic = "https://ntfy.sh/x"'], 3,
    /\[notify\] ntfy_topic must be an ntfy topic .*, got a string holding another character$/m],
  ['a boolean ntfy_topic', ['[notify]', 'ntfy_topic = true'], 2, /ntfy_topic must be an ntfy topic .*, got a boolean/],
  ['a number as ntfy_topic', ['[notify]', 'ntfy_topic = 3'], 2, /ntfy_topic must be an ntfy topic .*, got 3/],
  ['a 65-character ntfy_topic', ['[notify]', `ntfy_topic = "${'a'.repeat(65)}"`], 2, /ntfy_topic must be an ntfy topic .*, got a string of 65 characters/],
  ['ntfy_topic in [defaults] (it is machine-wide, under [notify])', ['[defaults]', 'ntfy_topic = "x"'], 2, /\[defaults\]: unknown key "ntfy_topic"/],
  ['ntfy_topic in a repo table', ['[repo."o/r"]', 'ntfy_topic = "x"'], 2, /\[repo\."o\/r"\]: unknown key "ntfy_topic"/],
  ['a dotted bad ntfy_topic', ['notify.ntfy_topic = "a b"'], 1, /\[notify\] ntfy_topic must be an ntfy topic/],
]

for (const [name, lines, line, reason] of REFUSALS) {
  test(`R4 refused: ${name}`, (t) => {
    const home = tmpHome(t)
    writeSettings(home, lines)
    refused(home, { line, reason })
  })
}

test('R4 case-duplicate repo tables are refused at the second, naming the first one\'s line', (t) => {
  const home = tmpHome(t)
  writeSettings(home, ['[repo."o/r"]', 'parallel_ceiling = 3', '[repo."O/R"]', 'parallel_ceiling = 4'])
  refused(home, { line: 3, reason: /duplicate repo "O\/R" \(same as "o\/r", first at line 1, ignoring case\)/ })
})

test('R4 a dotted case-duplicate names line 1', (t) => {
  const home = tmpHome(t)
  writeSettings(home, ['repo."o/r".parallel_ceiling = 5', 'repo."O/R".parallel_ceiling = 6'])
  refused(home, { line: 2, reason: /duplicate repo "O\/R" \(same as "o\/r", first at line 1, ignoring case\)/ })
})

test('R4 a case-duplicate across the table and dotted forms is refused', (t) => {
  const home = tmpHome(t)
  writeSettings(home, ['repo."O/r".max_iterations = 2', '[repo."o/R"]', 'parallel_ceiling = 4'])
  refused(home, { line: 2, reason: /duplicate repo "o\/R" \(same as "O\/r", first at line 1/ })
})

test('R4 non-UTF-8 bytes name the line they are on', (t) => {
  const home = tmpHome(t)
  writeSettings(home, Buffer.concat([Buffer.from('[defaults]\n# '), Buffer.from([0xff]), Buffer.from('\nparallel_ceiling = 3\n')]))
  refused(home, { line: 2, reason: /UTF-8/ })
})

test('R4 a dangling rollouts.toml symlink is refused, never read as absent', (t) => {
  const home = tmpHome(t)
  fs.mkdirSync(path.dirname(settingsPath(home)), { recursive: true })
  fs.symlinkSync(path.join(home, 'nowhere.toml'), settingsPath(home))
  refused(home, { reason: /cannot read it: a symlink to a missing file/ })
})

test('R4 a key the line scan cannot place is refused in the exact no-line form', (t) => {
  const home = tmpHome(t)
  // \U escapes are TOML-only, so the scan cannot read this key's name back and has no line for it.
  writeSettings(home, ['"x\\U00000041" = 1'])
  const r = run(home)
  assert.equal(r.status, 2)
  assert.equal(r.stdout, '')
  assert.equal(r.stderr, `rollout-settings: ${settingsPath(home)}: unknown top-level key "xA" (${TABLES_LINE})\n`)
})

test('R4 a refused file is refused with --repo too, and land.sh never runs for it', (t) => {
  const home = tmpHome(t)
  writeSettings(home, ['[repo."o/r"]', 'parallel_ceiling = 0'])
  refused(home, { line: 2, args: ['--repo', gitRepo(home, 'r', 'https://github.com/o/r')], reason: /\[repo\."o\/r"\] parallel_ceiling/ })
})

const NO_TOMLLIB = ['-B', '-c',
  "import sys, runpy; s = sys.argv[1]; sys.modules['tomllib'] = None; sys.argv = ['rollout-settings.py']; runpy.run_path(s, run_name='__main__')",
  SCRIPT]

test('R4 without tomllib an absent file still gives the built-ins; a present file exits 3', (t) => {
  const home = tmpHome(t)
  const r = run(home, [], { argv: NO_TOMLLIB })
  assert.equal(r.status, 0, r.stderr)
  assertAllBuiltIn(JSON.parse(r.stdout))
  writeSettings(home, ['[defaults]', 'parallel_ceiling = 3'])
  refused(home, { code: 3, reason: /python >= 3\.11/, argv: NO_TOMLLIB })
})

// ---- R5: empty and comment-only files ---------------------------------------------------------------------

test('R5 an empty file and a comment-only file give the built-ins (file true)', (t) => {
  const home = tmpHome(t)
  writeSettings(home, '')
  let out = resolves(home)
  assertAllBuiltIn(out)
  assert.equal(out.file, true)
  writeSettings(home, ['# nothing set yet', '   # still nothing'])
  out = resolves(home)
  assertAllBuiltIn(out)
})

// ---- R6: --repo that names no GitHub clone ---------------------------------------------------------------

test('R6 --repo that is not a directory exits 2 with its own reason, whatever the file holds', (t) => {
  const home = tmpHome(t)
  for (const lines of [null, ['[repo."o/r"]', 'parallel_ceiling = 5'], ['[defaults]', 'parallel_ceiling = 0']]) {
    if (lines) writeSettings(home, lines)
    const r = run(home, ['--repo', '/nonexistent/x'])
    assert.equal(r.status, 2)
    assert.equal(r.stdout, '')
    assert.equal(r.stderr, 'rollout-settings: --repo /nonexistent/x: not a directory\n')
  }
})

test('R6 --repo on a plain directory or a non-GitHub origin: repo null, defaults apply', (t) => {
  const home = tmpHome(t)
  writeSettings(home, ['[defaults]', 'parallel_ceiling = 3', '[repo."o/r"]', 'parallel_ceiling = 9'])
  const plain = path.join(home, 'plain'); fs.mkdirSync(plain)
  for (const dir of [plain, gitRepo(home, 'gl', 'https://gitlab.com/o/r'), gitRepo(home, 'none', null)]) {
    const out = resolves(home, ['--repo', dir])
    assert.equal(out.repo, null, dir)
    expectValues(out, { parallel_ceiling: 3 }, { parallel_ceiling: 'file:defaults' })
  }
})

test('R6 a usage error is one line, exit 2', (t) => {
  const r = run(tmpHome(t), ['--bogus'])
  assert.equal(r.status, 2)
  assert.equal(r.stdout, '')
  assert.match(r.stderr, /^rollout-settings: [^\n]+\n$/)
})

// ---- R7: guardrails --------------------------------------------------------------------------------------

test('R7 a guardrails override is file:guardrails; floats and quota_stalls = 0 are valid', (t) => {
  const home = tmpHome(t)
  writeSettings(home, ['[guardrails]', 'tokens_per_merge_pct = 30', 'set_aside_rate_points = 2.5', 'quota_stalls = 0', 'review_churn_pct = 60'])
  const out = resolves(home)
  assert.deepEqual(out.guardrails, {
    tokens_per_merge_pct: { value: 30, source: 'file:guardrails' },
    set_aside_rate_points: { value: 2.5, source: 'file:guardrails' },
    conflict_rate_points: { value: 10, source: 'built-in' },
    quota_stalls: { value: 0, source: 'file:guardrails' },
    review_churn_pct: { value: 60, source: 'file:guardrails' },
    hours_per_task: { value: 1.5, source: 'built-in' },
  })
  for (const k of SETTING_KEYS) assert.equal(out.settings[k].source, 'built-in')
})

test('R7 hours_per_task (p21-2) takes an integer or a float > 0, as file:guardrails', (t) => {
  for (const [v, want] of [['2.5', 2.5], ['3', 3]]) {
    const home = tmpHome(t)
    writeSettings(home, ['[guardrails]', `hours_per_task = ${v}`])
    assert.deepEqual(resolves(home).guardrails.hours_per_task, { value: want, source: 'file:guardrails' }, v)
  }
})

// ---- R8: the importable resolve() --------------------------------------------------------------------------

test('R8 the importable resolve() and constants agree with the CLI, which prints resolve() redacted', (t) => {
  const home = tmpHome(t)
  writeSettings(home, ['[defaults]', 'max_iterations = 2', '[notify]', 'ntfy_topic = "t-1"', '[repo."o/r"]', 'parallel_ceiling = 6'])
  const repo = gitRepo(home, 'r', 'https://github.com/o/r')
  const cli = resolves(home, ['--repo', repo])
  assert.deepEqual(cli.notify, SET)
  const r = run(home, [], {
    argv: ['-B', '-c', `import importlib.util, json, sys
spec = importlib.util.spec_from_file_location('rs', sys.argv[1]); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
out = m.resolve(repo=sys.argv[2])
print(json.dumps({'out': out, 'view': m.redacted(out), 'keys': list(m.KEYS), 'gkeys': list(m.GUARDRAIL_KEYS),
  'skeys': list(m.SETTING_KEYS), 'min': m.MINIMUM, 'nkeys': list(m.NOTIFY_KEYS), 'nbuilt': m.NOTIFY_BUILT_IN,
  'built': m.BUILT_IN, 'gbuilt': m.GUARDRAILS_BUILT_IN, 'timeout': m.ORIGIN_TIMEOUT, 'path': m.default_path()}))
try:
    m.resolve(repo='/nonexistent/x')
except m.SettingsError as e:
    print(json.dumps([str(e), e.code, e.line]))`, SCRIPT, repo],
  })
  assert.equal(r.status, 0, r.stderr)
  const [first, second] = r.stdout.trim().split('\n').map((l) => JSON.parse(l))
  // resolve() keeps the topic for its in-process readers; redacted() is exactly the CLI's line, and only notify differs.
  assert.deepEqual(first.out.notify, { ntfy_topic: { value: 't-1', source: 'file:notify' } })
  assert.deepEqual(first.view, cli)
  assert.deepEqual({ ...first.out, notify: cli.notify }, cli)
  assert.deepEqual(first.keys, KEYS)
  assert.deepEqual(first.skeys, SETTING_KEYS)
  assert.deepEqual(first.min, MINIMUM)
  assert.deepEqual(first.gkeys, GUARDRAIL_KEYS)
  assert.deepEqual(first.built, BUILT_IN)
  assert.deepEqual(first.gbuilt, GUARDRAILS_BUILT_IN)
  assert.deepEqual(first.nkeys, NOTIFY_KEYS)
  assert.deepEqual(first.nbuilt, NOTIFY_BUILT_IN)
  assert.equal(first.timeout, 20)
  assert.equal(first.path, settingsPath(home))
  assert.deepEqual(second, ['--repo /nonexistent/x: not a directory', 2, null])
})

// ---- R9: land.sh runs only when a repo table exists ------------------------------------------------------------

function fakeGitBin(home, body) {
  const bin = path.join(home, 'fakebin')
  fs.mkdirSync(bin, { recursive: true })
  fs.writeFileSync(path.join(bin, 'git'), `#!/bin/sh\n${body}\n`, { mode: 0o755 })
  return bin
}

test('R9 lazy: git is never run without a repo table, and is run with one', (t) => {
  const home = tmpHome(t)
  const repo = gitRepo(home, 'r', 'https://github.com/o/r')
  const marker = path.join(home, 'git-ran')
  const bin = fakeGitBin(home, `touch "${marker}"\nexec "${REAL_GIT}" "$@"`)
  const env = { PATH: `${bin}:${process.env.PATH}` }
  writeSettings(home, ['repo = {}', '[defaults]', 'parallel_ceiling = 2'])
  resolves(home, ['--repo', repo], { env })
  assert.equal(fs.existsSync(marker), false, 'no git call without a repo table')
  writeSettings(home, ['[repo."o/r"]', 'parallel_ceiling = 2'])
  const out = resolves(home, ['--repo', repo], { env })
  assert.equal(fs.existsSync(marker), true, 'git ran once a repo table exists')
  assert.equal(out.settings.parallel_ceiling.source, 'file:repo')
})

// ---- R10: a hung origin read is bounded -------------------------------------------------------------------------

test('R10 a hung git is killed with its process group at ORIGIN_TIMEOUT, and the call refuses', (t) => {
  const home = tmpHome(t)
  writeSettings(home, ['[repo."o/r"]', 'parallel_ceiling = 2'])
  const repo = path.join(home, 'r'); fs.mkdirSync(repo)
  const uniq = `29.${process.pid}${Date.now() % 100000}`
  const bin = fakeGitBin(home, `case " $* " in *" remote "*) exec sleep ${uniq} ;; *) exit 0 ;; esac`)
  const started = Date.now()
  const r = run(home, [], {
    env: { PATH: `${bin}:${process.env.PATH}` },
    argv: ['-B', '-c', `import importlib.util, sys
spec = importlib.util.spec_from_file_location('rs', sys.argv[1]); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
m.ORIGIN_TIMEOUT = 1
try:
    m.resolve(repo=sys.argv[2]); print('NO-RAISE')
except m.SettingsError as e:
    print(str(e))`, SCRIPT, repo],
  })
  const elapsed = Date.now() - started
  t.after(() => spawnSync('pkill', ['-f', `sleep ${uniq}`]))
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.stdout, `--repo ${repo}: reading its origin timed out after 1s\n`)
  assert.ok(elapsed < 5000, `bounded: took ${elapsed}ms`)
  const left = spawnSync('pgrep', ['-f', `sleep ${uniq}`], { encoding: 'utf8' })
  assert.equal(left.stdout.trim(), '', 'no sleep child survives')
})

// ---- R11: [notify] (ADR 0038 d3) ------------------------------------------------------------------------------

test('R11 [notify] ntfy_topic resolves as file:notify beside [defaults] and a repo table; the rest is unchanged', (t) => {
  const home = tmpHome(t)
  writeSettings(home, ['[defaults]', 'parallel_ceiling = 2', '', '[notify]', 'ntfy_topic = "thread-needs-you"   # a dedicated topic',
    '', '[repo."o/r"]', 'max_iterations = 5'])
  const repo = gitRepo(home, 'r', 'https://github.com/o/r')
  const out = resolves(home, ['--repo', repo])
  assert.deepEqual(Object.keys(out), OUT_KEYS)
  assert.deepEqual(out.notify, SET)
  assert.deepEqual(resolvedInProcess(home, repo).notify, { ntfy_topic: { value: 'thread-needs-you', source: 'file:notify' } })
  expectValues(out, { parallel_ceiling: 2, max_iterations: 5 }, { parallel_ceiling: 'file:defaults', max_iterations: 'file:repo' })
  for (const k of GUARDRAIL_KEYS) assert.equal(out.guardrails[k].source, 'built-in')
})

test('R11 [notify] in dotted and inline-table form resolves like table form; an empty [notify] is no topic', (t) => {
  for (const [lines, want] of [
    [['notify.ntfy_topic = "x"'], { value: 'x', source: 'file:notify' }],
    [['notify = { ntfy_topic = "A_b-9" }'], { value: 'A_b-9', source: 'file:notify' }],
    [['[notify]', `ntfy_topic = "${'z'.repeat(64)}"`], { value: 'z'.repeat(64), source: 'file:notify' }],
    [['[notify]', '# set once ntfy-noise-audit names a topic'], { value: null, source: 'built-in' }],
  ]) {
    const home = tmpHome(t)
    writeSettings(home, lines)
    assert.deepEqual(resolvedInProcess(home).notify, { ntfy_topic: want }, lines.join(' | '))
    assert.deepEqual(resolves(home).notify, want.value === null ? UNSET : SET, lines.join(' | '))
  }
})

test('R11 the CLI never prints the topic: stdout carries `set`, never the topic string or a `value` under notify', (t) => {
  const home = tmpHome(t)
  writeSettings(home, ['[notify]', 'ntfy_topic = "a-topic-only-resolve-sees"'])
  const r = run(home)
  assert.equal(r.status, 0, r.stderr)
  assert.ok(!r.stdout.includes('a-topic-only-resolve-sees') && !r.stderr.includes('a-topic-only-resolve-sees'), 'the topic is unprinted')
  assert.deepEqual(JSON.parse(r.stdout).notify, SET)
  assert.equal(resolvedInProcess(home).notify.ntfy_topic.value, 'a-topic-only-resolve-sees')
})

// ---- K2-K10: the file's schema (ADR 0043, p29-1) --------------------------------------------------------------
// Two rollouts can run on two Engine snapshots, so an older reader meets a newer file: under a `schema` above the
// reader's SCHEMA an unknown key is ignored (and listed), a near-miss of a known key is still refused as a typo, and a
// known key the file's `schema` is too old for is refused with the remedy. Patched cases run resolve() in process.

// inProcess(home, patch): resolve() with `patch` (python lines run on module m first); {status, out, err}
function inProcess(home, patch = '') {
  const r = run(home, [], {
    argv: ['-B', '-c', `import importlib.util, json, sys
spec = importlib.util.spec_from_file_location('rs', sys.argv[1]); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
${patch}
try:
    print(json.dumps(m.resolve()))
except m.SettingsError as e:
    sys.stderr.write("rollout-settings: %s\\n" % e); sys.exit(e.code)`, SCRIPT],
  })
  return { status: r.status, out: r.status === 0 ? JSON.parse(r.stdout) : null, err: r.stderr }
}

test('K2 an absent schema reads as 1, and an unknown key is refused as ever', (t) => {
  const home = tmpHome(t)
  writeSettings(home, ['[defaults]', 'parallel_ceiling = 2'])
  const out = resolves(home)
  assert.deepEqual(out.schema, { file: 1, engine: 3 })
  assert.deepEqual(out.ignored, [])
  writeSettings(home, ['[defaults]', 'foo_bar = 2'])
  refused(home, { line: 2, reason: /\[defaults\]: unknown key "foo_bar" \(a rollout table holds/ })
  writeSettings(home, ['schema = 1', '[defaults]', 'foo_bar = 2'])
  refused(home, { line: 3, reason: /\[defaults\]: unknown key "foo_bar"/ })
  const none = resolves(tmpHome(t))
  assert.deepEqual([none.file, none.schema, none.ignored], [false, { file: 1, engine: 3 }, []], 'no file: schema 1')
})

test('K3 a schema that is not an integer >= 1 is refused, a boolean included', (t) => {
  for (const v of ['0', '-1', '1.5', '"2"', 'true', '[1]']) {
    const home = tmpHome(t)
    writeSettings(home, [`schema = ${v}`, '[defaults]', 'parallel_ceiling = 2'])
    refused(home, { line: 1, reason: /schema must be an integer >= 1 \(the file's schema version\), got / })
  }
})

test('K4 under a schema above SCHEMA an unknown key is ignored and listed, at every scope', (t) => {
  const home = tmpHome(t)
  writeSettings(home, ['schema = 4', '', '[defaults]', 'merge_train = 3', 'parallel_ceiling = 3', '', '[guardrails]',
    'away_hours = 2', '', '[notify]', 'chorus_topic = "x"', '', '[away]', 'cap = 1', '', '[repo."o/r"]', 'merge_train = 1'])
  const out = resolves(home)
  assert.deepEqual(out.ignored, ['away', 'defaults.merge_train', 'guardrails.away_hours', 'notify.chorus_topic', 'repo."o/r".merge_train'])
  assert.deepEqual(out.schema, { file: 4, engine: 3 })
  expectValues(out, { parallel_ceiling: 3 }, { parallel_ceiling: 'file:defaults' })
  assert.deepEqual(out.notify, UNSET)
})

test('K5 a near-miss by case or _/- is refused even under a newer schema', (t) => {
  for (const [table, key] of [['defaults', 'Parallel_Ceiling'], ['defaults', 'parallel-ceiling'], ['guardrails', 'quotastalls'],
    ['notify', 'NTFY_TOPIC']]) {
    const home = tmpHome(t)
    writeSettings(home, ['schema = 4', `[${table}]`, `${key} = 1`])
    refused(home, { line: 3, reason: new RegExp(`unknown key "${escapeRe(key)}".*a near-miss of`) })
  }
  const home = tmpHome(t)
  writeSettings(home, ['schema = 4', '[Defaults]', 'parallel_ceiling = 1'])
  refused(home, { line: 2, reason: /unknown top-level key "Defaults".*a near-miss of "defaults"/ })
})

test('K6 a near-miss within OSA distance 2 is refused; a key three edits away is ignored', (t) => {
  for (const key of ['paralel_ceiling', 'parallel_cieling', 'max_iteratoins', 'max_review_round', 'verify_slot', 'inert_path', 'test_credential']) {
    const home = tmpHome(t)
    writeSettings(home, ['schema = 4', '[defaults]', `${key} = 1`])
    refused(home, { line: 3, reason: new RegExp(`unknown key "${key}".*a near-miss of`) })
  }
  const home = tmpHome(t)
  writeSettings(home, ['schema = 4', '[defaults]', 'max_iter = 1'])
  assert.deepEqual(resolves(home).ignored, ['defaults.max_iter'])
})

test('K7 a known key the file is too old for is refused with the remedy naming the schema line (patched)', (t) => {
  const home = tmpHome(t)
  writeSettings(home, ['[defaults]', 'parallel_ceiling = 2'])
  const patch = 'm.SCHEMA = 2; m.KEY_SCHEMA[("rollout", "parallel_ceiling")] = 2'
  const r = inProcess(home, patch)
  assert.equal(r.status, 2, r.err)
  assert.equal(r.err, `rollout-settings: ${settingsPath(home)}:2: rollout.parallel_ceiling is a schema-2 key but the file says schema = 1: ` +
    "raise the file's top-level `schema` line to 2 in the same edit\n")
  writeSettings(home, ['schema = 2', '[defaults]', 'parallel_ceiling = 2'])
  const ok2 = inProcess(home, patch)
  assert.equal(ok2.status, 0, ok2.err)
  assert.deepEqual(ok2.out.schema, { file: 2, engine: 2 })
  assert.equal(ok2.out.settings.parallel_ceiling.value, 2)
})

test('K8 no two registered keys at one scope are near-misses of each other', () => {
  const r = spawnSync('python3', ['-B', '-c', `import importlib.util, json, sys
spec = importlib.util.spec_from_file_location('rs', sys.argv[1]); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
bad = []
for scope in sorted({s for s, _ in m.KEY_SCHEMA}):
    keys = sorted(k for s, k in m.KEY_SCHEMA if s == scope)
    for k in keys:
        hit = m.near_miss(k, [x for x in keys if x != k])
        if hit:
            bad.append([scope, k, hit])
print(json.dumps(bad))`, SCRIPT], { encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } })
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(JSON.parse(r.stdout), [], 'a registered key that is a near-miss of another would be refused as its typo')
})

test('K9 the JSON carries schema {file, engine} and ignored, in process too', (t) => {
  const home = tmpHome(t)
  writeSettings(home, ['schema = 4', '[defaults]', 'later_key = 1'])
  const out = resolves(home)
  assert.deepEqual(Object.keys(out), OUT_KEYS)
  assert.deepEqual([out.schema, out.ignored], [{ file: 4, engine: 3 }, ['defaults.later_key']])
  const inp = resolvedInProcess(home)
  assert.deepEqual([inp.schema, inp.ignored], [{ file: 4, engine: 3 }, ['defaults.later_key']])
})

// K10's failure message is the add-a-key recipe (rollout-settings.py's header), the writer rule included.
const RECIPE = 'adding a key: bump SCHEMA; register the key in KEY_SCHEMA at the new number; keep it no near-miss of any key ' +
  "registered at its scope (K8); and any writer adding it to a file whose schema is lower raises the file's top-level " +
  '`schema` line in the same edit (tune.py does: raise_schema(), KT1; a hand edit must)'
const SCHEMA_1 = [
  ...['defaults', 'guardrails', 'notify', 'repo', 'schema'].map((k) => `top.${k}`),
  ...SETTING_KEYS.map((k) => `rollout.${k}`),
  ...GUARDRAIL_KEYS.map((k) => `guardrails.${k}`),
  ...NOTIFY_KEYS.map((k) => `notify.${k}`),
].sort()

test('K10 the schema-1 key set is frozen, and SCHEMA is the highest registered schema', () => {
  const r = spawnSync('python3', ['-B', '-c', `import importlib.util, json, sys
spec = importlib.util.spec_from_file_location('rs', sys.argv[1]); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
print(json.dumps({"one": sorted("%s.%s" % k for k, n in m.KEY_SCHEMA.items() if n == 1), "schema": m.SCHEMA,
                  "max": max(m.KEY_SCHEMA.values())}))`, SCRIPT], { encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } })
  assert.equal(r.status, 0, r.stderr)
  const got = JSON.parse(r.stdout)
  assert.deepEqual(got.one, SCHEMA_1, RECIPE)
  assert.equal(got.schema, got.max, `SCHEMA must equal the highest KEY_SCHEMA number: ${RECIPE}`)
  const header = fs.readFileSync(SCRIPT, 'utf8').replace(/\s+/g, ' ')
  for (const part of ['bump SCHEMA', 'register the key in KEY_SCHEMA at the new number', 'no near-miss',
    "raises the file's `schema` line to that number in the same edit: tune.py does it", 'and so must a hand edit']) {
    assert.ok(header.includes(part), `rollout-settings.py's header recipe names: ${part}`)
  }
})

// ---- K11-K12: inert_paths, the first schema-2 key (p29-3, ADR 0045) --------------------------------------------------
// A repo's Inert paths: a list of git pathspec globs in a [repo."o/r"] table only, resolved as its own top-level field
// (never in `settings`), built-in []. A schema-1 file holding it is refused with the raise remedy; an older reader
// (schema 1, patched in process as K7 is) ignores it under a schema-2 file, so that rollout always re-runs.

test('K11 inert_paths in a repo table resolves as file:repo, outside settings; another repo and no table read built-in []', (t) => {
  const home = tmpHome(t)
  writeSettings(home, ['schema = 2', '', '[repo."o/r"]', 'parallel_ceiling = 3', 'inert_paths = ["THREAD.md", "docs/handoffs/**"]'])
  const out = resolves(home, ['--repo', gitRepo(home, 'r', 'https://github.com/o/r')])
  assert.deepEqual(Object.keys(out), OUT_KEYS)
  assert.deepEqual(out.inert_paths, { value: ['THREAD.md', 'docs/handoffs/**'], source: 'file:repo' })
  assert.deepEqual(Object.keys(out.settings), SETTING_KEYS, 'inert_paths is never a settings key')
  assert.deepEqual(out.schema, { file: 2, engine: 3 })
  assert.deepEqual(resolvedInProcess(home, gitRepo(home, 'r2', 'https://github.com/o/r')).inert_paths.value, ['THREAD.md', 'docs/handoffs/**'])
  assert.deepEqual(resolves(home, ['--repo', gitRepo(home, 'other', 'https://github.com/o/other')]).inert_paths, NO_INERT)
  assert.deepEqual(resolves(home).inert_paths, NO_INERT, 'no --repo: built-in []')
  writeSettings(home, ['schema = 2', '[repo."o/r"]', 'inert_paths = []'])
  assert.deepEqual(resolves(home, ['--repo', gitRepo(home, 'r3', 'https://github.com/o/r')]).inert_paths, { value: [], source: 'file:repo' })
})

test('K11 inert_paths dotted and inline forms resolve like table form', (t) => {
  for (const lines of [['schema = 2', 'repo."o/r".inert_paths = ["THREAD.md"]'], ['schema = 2', 'repo = { "o/r" = { inert_paths = ["THREAD.md"] } }']]) {
    const home = tmpHome(t)
    writeSettings(home, lines)
    assert.deepEqual(resolves(home, ['--repo', gitRepo(home, 'r', 'https://github.com/o/r')]).inert_paths,
      { value: ['THREAD.md'], source: 'file:repo' }, lines.join(' | '))
  }
})

const INERT_REFUSALS = [
  ['under [defaults] (per repo)', ['schema = 2', '[defaults]', 'inert_paths = ["THREAD.md"]'], 3,
    /inert_paths is per repo: set it under \[repo\."owner\/name"\]/],
  ['in a schema-1 file (the raise remedy)', ['[repo."o/r"]', 'inert_paths = ["THREAD.md"]'], 2,
    /rollout\.inert_paths is a schema-2 key but the file says schema = 1: raise the file's top-level `schema` line to 2 in the same edit/],
  ['a string, not a list', ['schema = 2', '[repo."o/r"]', 'inert_paths = "THREAD.md"'], 3, /inert_paths must be a list of git pathspec globs, got a string/],
  ['a number in the list', ['schema = 2', '[repo."o/r"]', 'inert_paths = [3]'], 3, /each glob must be a string, got 3/],
  ['an empty glob', ['schema = 2', '[repo."o/r"]', 'inert_paths = [""]'], 3, /the glob "" is empty/],
  ['a 201-character glob', ['schema = 2', '[repo."o/r"]', `inert_paths = ["${'a'.repeat(201)}"]`], 3, /is 201 characters \(at most 200\)/],
  ['leading whitespace', ['schema = 2', '[repo."o/r"]', 'inert_paths = [" THREAD.md"]'], 3, /has leading or trailing whitespace/],
  ['a control character', ['schema = 2', '[repo."o/r"]', 'inert_paths = ["a\\tb"]'], 3, /holds a control character/],
  ['a backslash', ['schema = 2', '[repo."o/r"]', 'inert_paths = ["docs\\\\x.md"]'], 3, /holds a backslash/],
  ['an absolute glob', ['schema = 2', '[repo."o/r"]', 'inert_paths = ["/THREAD.md"]'], 3, /starts with "\/"/],
  ['pathspec magic', ['schema = 2', '[repo."o/r"]', 'inert_paths = [":(glob)THREAD.md"]'], 3, /starts with ":"/],
  ['a negation', ['schema = 2', '[repo."o/r"]', 'inert_paths = ["!THREAD.md"]'], 3, /starts with "!"/],
  ['an empty segment', ['schema = 2', '[repo."o/r"]', 'inert_paths = ["docs//x.md"]'], 3, /has an empty, \. or \.\. segment/],
  ['a .. segment', ['schema = 2', '[repo."o/r"]', 'inert_paths = ["docs/../x.md"]'], 3, /has an empty, \. or \.\. segment/],
  ['a . segment', ['schema = 2', '[repo."o/r"]', 'inert_paths = ["./THREAD.md"]'], 3, /has an empty, \. or \.\. segment/],
  ['a trailing slash (the dir/** hint)', ['schema = 2', '[repo."o/r"]', 'inert_paths = ["docs/handoffs/"]'], 3, /ends in \/ \(write "docs\/handoffs\/\*\*"\)/],
  ['a duplicate glob', ['schema = 2', '[repo."o/r"]', 'inert_paths = ["THREAD.md", "THREAD.md"]'], 3, /the glob "THREAD\.md" is listed twice/],
  ['65 globs', ['schema = 2', '[repo."o/r"]', `inert_paths = [${Array.from({ length: 65 }, (_, i) => `"d${i}/**"`).join(', ')}]`], 3,
    /holds 65 globs \(at most 64\)/],
]

for (const [name, lines, line, reason] of INERT_REFUSALS) {
  test(`K11 refused: inert_paths ${name}`, (t) => {
    const home = tmpHome(t)
    writeSettings(home, lines)
    refused(home, { line, reason })
  })
}

test('K11 64 distinct globs are valid', (t) => {
  const home = tmpHome(t)
  writeSettings(home, ['schema = 2', '[repo."o/r"]', `inert_paths = [${Array.from({ length: 64 }, (_, i) => `"d${i}/**"`).join(', ')}]`])
  assert.equal(resolves(home, ['--repo', gitRepo(home, 'r', 'https://github.com/o/r')]).inert_paths.value.length, 64)
})

test('K12 an older reader (schema 1, patched) ignores repo."o/r".inert_paths under a schema-2 file and resolves the rest', (t) => {
  const home = tmpHome(t)
  writeSettings(home, ['schema = 2', '', '[defaults]', 'max_iterations = 2', '', '[repo."o/r"]', 'parallel_ceiling = 5',
    'inert_paths = ["THREAD.md", "docs/handoffs/**"]'])
  const older = 'm.SCHEMA = 1; del m.KEY_SCHEMA[("rollout", "inert_paths")]; m.REPO_ONLY = ()'
  const r = inProcess(home, older)
  assert.equal(r.status, 0, r.err)
  assert.deepEqual(r.out.ignored, ['repo."o/r".inert_paths'])
  assert.deepEqual(r.out.schema, { file: 2, engine: 1 })
  assert.equal(r.out.settings.max_iterations.value, 2)
  assert.deepEqual(r.out.inert_paths, NO_INERT, 'the older reader resolves no Inert paths: that rollout always re-runs')
  // ...and a near-miss of a key it knows is still refused under the newer file.
  writeSettings(home, ['schema = 2', '[repo."o/r"]', 'paralel_ceiling = 5'])
  const typo = inProcess(home, older)
  assert.equal(typo.status, 2)
  assert.match(typo.err, /unknown key "paralel_ceiling".*a near-miss of/)
})

test('K12 raise_schema_lines raises, never lowers, keeps a comment, and refuses a form it will not edit', () => {
  const r = spawnSync('python3', ['-B', '-c', `import importlib.util, json, sys
spec = importlib.util.spec_from_file_location('rs', sys.argv[1]); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
out = [m.raise_schema_lines(['# s', '[defaults]', 'x = 1'], 2, 1), m.raise_schema_lines(['schema = 1 # v', '', '[defaults]'], 2, 1),
       m.raise_schema_lines(['schema = 3', '[defaults]'], 2, 3), m.raise_schema_lines(['[repo."o/r"]'], 2, 1)]
try:
    m.raise_schema_lines(['schema =   # no value', '[defaults]'], 2, 1); out.append('NO-RAISE')
except m.SettingsError as e:
    out.append(str(e))
print(json.dumps(out))`, SCRIPT], { encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } })
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(JSON.parse(r.stdout), [['schema = 2', '', '# s', '[defaults]', 'x = 1'], ['schema = 2 # v', '', '[defaults]'],
    ['schema = 3', '[defaults]'], ['schema = 2', '', '[repo."o/r"]'], 'cannot read the top-level schema line (line 1): edit it by hand'])
})

// ---- K13-K14: test_credentials, the first schema-3 key (ADR 0062) ------------------------------------------------------
// A repo's test-credential class: ONE inline-table line inside its [repo."o/r"] table (the line-by-line writers, inert-paths.py
// and tune.py, keep it byte-identical), resolved as its own top-level field, null by default. Every other form is refused at
// its line with the remedy, and so is any value credential_problem() refuses, described, never echoed.

const CRED_LINE = 'test_credentials = { file = "~/repos/x/.env.local", keys = [{ name = "STRIPE_SECRET", prefix = "sk_test_" }, ' +
  '{ name = "STRIPE_PUBLISHABLE_KEY", prefix = "pk_test_" }, { name = "SUPABASE_SERVICE_ROLE_KEY", supabase_project = "geyyptxqiovujgbiecsp" }] }'
const CRED_VALUE = { file: '~/repos/x/.env.local', keys: [{ name: 'STRIPE_SECRET', prefix: 'sk_test_' },
  { name: 'STRIPE_PUBLISHABLE_KEY', prefix: 'pk_test_' }, { name: 'SUPABASE_SERVICE_ROLE_KEY', supabase_project: 'geyyptxqiovujgbiecsp' }] }
const credLine = (keys, file = '/x/.env.local') => `test_credentials = { file = "${file}", keys = [${keys}] }`
const ONE_KEY = '{ name = "STRIPE_SECRET", prefix = "sk_test_" }'
const ONE_LINE_REMEDY = /\[repo\."o\/r"\] test_credentials must be one line in that table: test_credentials = \{ file = "…", keys = \[ … \] \} \(inert-paths\.py and tune\.py edit this file line by line\)/

test('K13 the one-line class resolves as file:repo, in file order, outside settings; another repo and no --repo read null', (t) => {
  const home = tmpHome(t)
  writeSettings(home, ['schema = 3', '', '[repo."o/r"]', 'parallel_ceiling = 3', `${CRED_LINE}   # Stripe test mode and staging only`])
  const out = resolves(home, ['--repo', gitRepo(home, 'r', 'https://github.com/o/r')])
  assert.deepEqual(Object.keys(out), OUT_KEYS)
  assert.deepEqual(out.test_credentials, { value: CRED_VALUE, source: 'file:repo' })
  assert.deepEqual(Object.keys(out.settings), SETTING_KEYS, 'test_credentials is never a settings key')
  assert.deepEqual(out.schema, { file: 3, engine: 3 })
  assert.deepEqual(resolvedInProcess(home, gitRepo(home, 'r2', 'https://github.com/o/r')).test_credentials.value, CRED_VALUE)
  assert.deepEqual(resolves(home, ['--repo', gitRepo(home, 'other', 'https://github.com/o/other')]).test_credentials, NO_CREDS)
  assert.deepEqual(resolves(home).test_credentials, NO_CREDS, 'no --repo: no class')
})

const CRED_FORM_REFUSALS = [
  ['the sub-table', ['schema = 3', '[repo."o/r"]', 'parallel_ceiling = 3', '[repo."o/r".test_credentials]', 'file = "/x/.env.local"',
    `keys = [${ONE_KEY}]`], 4],
  ['top-level dotted', ['schema = 3', `repo."o/r".${credLine(ONE_KEY)}`], 2],
  ['in-table dotted', ['schema = 3', '[repo]', `"o/r".${credLine(ONE_KEY)}`], 3],
  ['repo = {…}', ['schema = 3', `repo = { "o/r" = { ${credLine(ONE_KEY)} } }`], 2],
  ['a multi-line keys', ['schema = 3', '[repo."o/r"]', 'test_credentials = { file = "/x/.env.local", keys = [', `${ONE_KEY}] }`], 3],
]
for (const [name, lines, line] of CRED_FORM_REFUSALS) {
  test(`K13 refused form: ${name}, at its line with the one-line remedy`, (t) => {
    const home = tmpHome(t)
    writeSettings(home, lines)
    refused(home, { line, reason: ONE_LINE_REMEDY })
  })
}

const CRED_VALUE_REFUSALS = [
  ['under [defaults] (per repo)', ['schema = 3', '[defaults]', credLine(ONE_KEY)], 3, /test_credentials is per repo: set it under \[repo\."owner\/name"\]/],
  ['in a schema-2 file (the raise remedy)', ['schema = 2', '[repo."o/r"]', credLine(ONE_KEY)], 3,
    /rollout\.test_credentials is a schema-3 key but the file says schema = 2: raise the file's top-level `schema` line to 3 in the same edit/],
  ['a lower-case name', ['schema = 3', '[repo."o/r"]', credLine('{ name = "stripe_secret", prefix = "sk_test_" }')], 3,
    /test_credentials: keys entry 1: name must be an upper-snake env name/],
  ['a name with no _', ['schema = 3', '[repo."o/r"]', credLine('{ name = "STRIPE", prefix = "sk_test_" }')], 3, /keys entry 1: name must be an upper-snake env name/],
  ['STRIPE_LIVE_SECRET', ['schema = 3', '[repo."o/r"]', credLine('{ name = "STRIPE_LIVE_SECRET", prefix = "sk_test_" }')], 3,
    /keys entry 1: name holds a LIVE or PROD segment/],
  ['PROD_SUPABASE_KEY', ['schema = 3', '[repo."o/r"]', credLine('{ name = "PROD_SUPABASE_KEY", supabase_project = "geyyptxqiovujgbiecsp" }')], 3,
    /keys entry 1: name holds a LIVE or PROD segment/],
  ['SUPABASE_PRODUCTION_KEY', ['schema = 3', '[repo."o/r"]', credLine(`${ONE_KEY}, { name = "SUPABASE_PRODUCTION_KEY", supabase_project = "geyyptxqiovujgbiecsp" }`)], 3,
    /keys entry 2: name holds a LIVE or PROD segment/],
  ['the prefix sb_secret_', ['schema = 3', '[repo."o/r"]', credLine('{ name = "SUPABASE_SERVICE_ROLE_KEY", prefix = "sb_secret_" }')], 3,
    /keys entry 1: prefix holds no test or sandbox/],
  ['the prefix sk_live_', ['schema = 3', '[repo."o/r"]', credLine('{ name = "STRIPE_SECRET", prefix = "sk_live_" }')], 3,
    /keys entry 1: prefix holds live or prod/],
  ['a two-character prefix', ['schema = 3', '[repo."o/r"]', credLine('{ name = "STRIPE_SECRET", prefix = "sk" }')], 3,
    /keys entry 1: prefix must be 3 to 40 of A-Z, a-z, 0-9 and _, got a string of another form/],
  ['a bad project ref', ['schema = 3', '[repo."o/r"]', credLine('{ name = "SUPABASE_SERVICE_ROLE_KEY", supabase_project = "GEYYPTXQIOVUJGBIECSP" }')], 3,
    /keys entry 1: supabase_project must be a Supabase project ref \(20 lowercase letters\)/],
  ['both proof keys', ['schema = 3', '[repo."o/r"]', credLine('{ name = "STRIPE_SECRET", prefix = "sk_test_", supabase_project = "geyyptxqiovujgbiecsp" }')], 3,
    /keys entry 1 must hold exactly one of prefix or supabase_project/],
  ['neither proof key', ['schema = 3', '[repo."o/r"]', credLine('{ name = "STRIPE_SECRET" }')], 3,
    /keys entry 1 must hold exactly one of prefix or supabase_project/],
  ['a duplicate name', ['schema = 3', '[repo."o/r"]', credLine(`${ONE_KEY}, ${ONE_KEY}`)], 3, /keys entry 2: its name is listed twice/],
  ['33 keys', ['schema = 3', '[repo."o/r"]', credLine(Array.from({ length: 33 }, (_, i) => `{ name = "K_${i}", prefix = "k_test_" }`).join(', '))], 3,
    /test_credentials: keys holds 33 entries \(at most 32\)/],
  ['no keys', ['schema = 3', '[repo."o/r"]', credLine('')], 3, /test_credentials: keys is empty/],
  ['a relative file', ['schema = 3', '[repo."o/r"]', credLine(ONE_KEY, 'repos/x/.env.local')], 3, /test_credentials: file must be an absolute path \(starting \/ or ~\/\)/],
  ['a file holding )', ['schema = 3', '[repo."o/r"]', credLine(ONE_KEY, '/x/(old).env.local')], 3, /test_credentials: file holds a \( or \)/],
  ['an unknown sub-key', ['schema = 3', '[repo."o/r"]', 'test_credentials = { file = "/x/.env.local", keys = [{ name = "STRIPE_SECRET", prefix = "sk_test_" }], value = "x" }'], 3,
    /test_credentials: holds an unknown key "value" \(it holds exactly file and keys\)/],
  ['an unknown key sub-key', ['schema = 3', '[repo."o/r"]', credLine('{ name = "STRIPE_SECRET", prefix = "sk_test_", value = "sk_test_x" }')], 3,
    /keys entry 1 holds an unknown key "value"/],
  ['not a table', ['schema = 3', '[repo."o/r"]', 'test_credentials = "/x/.env.local"'], 3, /test_credentials: must be an inline table \{ file = "…", keys = \[ … \] \}, got a string/],
]
for (const [name, lines, line, reason] of CRED_VALUE_REFUSALS) {
  test(`K13 refused value: ${name}`, (t) => {
    const home = tmpHome(t)
    writeSettings(home, lines)
    const err = refused(home, { line, reason })
    assert.ok(!err.includes('sk_test_x'), 'a refused value is described, never echoed')
  })
}

test('K13 32 keys and a sandbox prefix are valid', (t) => {
  const home = tmpHome(t)
  writeSettings(home, ['schema = 3', '[repo."o/r"]', credLine(Array.from({ length: 32 }, (_, i) => `{ name = "K_${i}", prefix = "k_Sandbox_" }`).join(', '))])
  assert.equal(resolves(home, ['--repo', gitRepo(home, 'r', 'https://github.com/o/r')]).test_credentials.value.keys.length, 32)
})

test('K14 an older reader (schema 2, patched) ignores repo."o/r".test_credentials under a schema-3 file and resolves the rest', (t) => {
  const home = tmpHome(t)
  writeSettings(home, ['schema = 3', '', '[defaults]', 'max_iterations = 2', '', '[repo."o/r"]', 'parallel_ceiling = 5', 'inert_paths = ["THREAD.md"]', CRED_LINE])
  const older = 'm.SCHEMA = 2; del m.KEY_SCHEMA[("rollout", "test_credentials")]; m.REPO_ONLY = ("inert_paths",)'
  const r = inProcess(home, older)
  assert.equal(r.status, 0, r.err)
  assert.deepEqual(r.out.ignored, ['repo."o/r".test_credentials'])
  assert.deepEqual(r.out.schema, { file: 3, engine: 2 })
  assert.equal(r.out.settings.max_iterations.value, 2)
  // ...and resolved for the repo itself, the older reader keeps its table's other keys and resolves no class, so that
  // rollout asks every credential gate (the control: the real reader resolves the class for the same repo).
  const repo = gitRepo(home, 'r', 'https://github.com/o/r')
  const forRepo = run(home, [], { argv: ['-B', '-c', `import importlib.util, json, sys
spec = importlib.util.spec_from_file_location('rs', sys.argv[1]); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
${older}
print(json.dumps(m.resolve(repo=sys.argv[2])))`, SCRIPT, repo] })
  assert.equal(forRepo.status, 0, forRepo.stderr)
  const o = JSON.parse(forRepo.stdout)
  assert.deepEqual([o.settings.parallel_ceiling.value, o.inert_paths.value, o.test_credentials], [5, ['THREAD.md'], NO_CREDS])
  assert.deepEqual(resolves(home, ['--repo', repo]).test_credentials.source, 'file:repo', 'control: the schema-3 reader resolves it')
})
