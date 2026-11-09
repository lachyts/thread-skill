// The Backlog orient (p40-1, ADR 0071): `/thread:orient <area> --backlog` reads an area's whole Backlog by the Pulse's
// line rules, decides its dispositions and the rest as a record, forks schedule runs per batch under fixed answers,
// starts what they wrote, and only then puts his questions to him, one at a time. Its rules live in one file,
// skills/orient/backlog.md, which orient's SKILL.md, reshuffle.md, schedule, the vault grammar, asking.md, the README
// and CONTEXT.md point at. The rules, each with one control that fails it alone:
//   forms        orient's invocation forms show `--backlog` and `--backlog --look`;
//   flags        orient § 1 strips `--backlog` and refuses a project, a scoped target or `--steer` (B1 the same);
//   pointers     one separate `Under --backlog` paragraph in each of orient §§ 1, 2, 4, 5, 6, 7 and 9 and in
//                reshuffle's write surface, R1–R5 and Don'ts, each citing its § B<n>, none asking, none a
//                "background batch";
//   sweep-rule   B2 and the script's header hold the Pulse's line rules, the excludes and the statuses;
//   held         a held park is frozen: B3, the Don'ts, the script's refusal and the glossary;
//   dispositions park, reopen, obsolete, re-home, merge and unbundle; never for size; no Drop and no rename; obsolete
//                is not the phase retire, whose R2 bullet stays word for word;
//   record       B7 writes the record after every task write, its sections the script's SECTIONS, in order;
//   batches      B5's fork prompts, its root (the batch's repo as its project declares it in `repos:` or `Local:`;
//                undeclared, no fork) and orient-all § 6.2's batch rule;
//   answers      B6 answers schedule's questions in exactly 23 items, asking nothing, the clone with the Yes;
//   write-back   B7's write, its one fold and its hold; B9's re-stamp is its own `--restamp` mode, skipped after a
//                held write-back #1; the script writes as atomic_write_json does;
//   look         `--look` runs B2's steps 1–4 only (never its mend) and B10 writes nothing of any kind;
//   schedule     schedule's **Under the Backlog orient.**, § 0 item 4, § 1.2 and § Scope;
//   grammar      the vault grammar's Writers name `stamp-start --backlog`, never a held note, and list a serial note
//                only on the Chorus Stage (P44-4, ADR 0076 d4);
//   asking       asking.md § 1's clone bullet names the Backlog orient's exception;
//   script       the script's eight verbs, and `stamp-start --backlog` with its hold refusal, GUARD_EXEMPT unchanged;
//   adr          ADR 0071 in the house format, amending the ADRs it names, and ADR 0054's § B9 row;
//   unparseable  B2 and orient § 4 mend each unparseable row, then sweep again;
//   named        guard 2's named set, in B7 and the script's header;
//   prior        B6 answer 6 reads `unstarted` over three handoff homes and the prior's status, and stops on a hold;
//   departure    ADR 0071 names its departure from metrics ADR 0015 d2 and the Known race it narrows, not closes;
//   wait         B9 marks a decided task its round cannot queue with `wait` and an Answered, waiting row;
//   runtime      every "orient spawns no child" in orient § Runtime boundary, orient § 8 and README § Runtime support
//                says "outside `--backlog`", and each names `--backlog` and § B5;
//   start        B8 runs over the notes B5's forks and B7's fold wrote and, from B9, the post-question round's;
//   questions    B9's order: asks, § 3.5, the grill, the records, the round, § B8, then the re-stamp;
//   gate-answer  a kept § 3.5 gate is recorded as the `## Decisions` answer answer 15 dismisses; a held one writes
//                nothing, takes no wait line and never holds the re-stamp;
//   wording      only B9's unit asks; no exemption phrase, no retired word; every outside § B<n> names the file.
// One pure function, check(files), over { relPath: text }. Reads files only.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { collapse, proseUnits, read, readIf, section, slice, walk } from '../lib/contract-text.mjs'

const ORIENT = 'skills/orient/SKILL.md'
const RESH = 'skills/orient/reshuffle.md'
const BACK = 'skills/orient/backlog.md'
const SCHED = 'skills/schedule/SKILL.md'
const GRAMMAR = 'skills/_shared/vault-grammar.md'
const ASKING = 'skills/_shared/asking.md'
const SCRIPT = 'skills/_shared/scripts/backlog-orient.py'
const RR = 'skills/execute/scripts/reconcile-rollout.py'
const ADR54 = 'docs/adr/0054-a-question-gate-before-every-ask.md'
const README = 'README.md'
const CONTEXT = 'CONTEXT.md'
const ADR71 = walk('docs/adr').filter((f) => /^docs\/adr\/0071-/.test(f))
const ADR = ADR71[0] ?? 'docs/adr/0071-missing.md'

const C = (s) => collapse(s ?? '')
const sec = (text, re) => section(text ?? '', re) ?? ''
const B = (F, n) => sec(F[BACK], new RegExp(`^## B${n}\\. `))
const paras = (text) => (text ?? '').split(/\n\s*\n/)
const under = (text) => paras(text).filter((p) => p.startsWith('**Under `--backlog`.**')).map(C)
const item = (text, label) => C(slice(text ?? '', new RegExp(`^- \\*\\*${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`), /^- \*\*|^\*\*|^$/) ?? '')
const PLAIN_ASK = /(?<!\b(?:had|used) to )\b(?:and ask|ask (?:which|him|lachy|the user|in plain text|once)|asks? lachy for|confirm with the user|offer to create)\b/i
const ASKS = (u) => u.includes('AskUserQuestion') || PLAIN_ASK.test(u)
const RETIRED = [new RegExp(['wa', 've'].join(''), 'i'), new RegExp(['max', 'tier'].join('_')), new RegExp(['tier', 'capped'].join('_'))]
const SECTIONS = ['Trigger', 'Batches', 'Rollouts started', 'Parks', 'Reopens', 'Obsoletes', 'Re-homes', 'Merges and unbundles',
  'Held parks', 'Session lane and misfits', 'Left out', 'Drift fixes and mends', 'Decided for you', 'Questions asked',
  'Held by his answer', 'Questions waiting', 'Answered, waiting', 'Folded', 'Write-back', 'Touched']
const VERBS = ['sweep', 'park', 'reopen', 'obsolete', 'rehome', 'wait', 'record', 'trigger']

function check(F) {
  const fails = new Set()
  const details = []
  const flag = (rule, why) => { fails.add(rule); details.push(`${rule}: ${why}`) }
  const need = (rule, name, text, phrases) => {
    const t = C(text)
    for (const p of phrases) if (!(typeof p === 'string' ? t.includes(p) : p.test(t))) flag(rule, `${name} lacks ${p}`)
  }
  const never = (rule, name, text, phrases) => {
    const t = C(text)
    for (const p of phrases) if (typeof p === 'string' ? t.includes(p) : p.test(t)) flag(rule, `${name} holds ${p}`)
  }
  const o = F[ORIENT] ?? ''
  const r = F[RESH] ?? ''
  const b = F[BACK] ?? ''
  const py = F[SCRIPT] ?? ''
  const d0 = py.indexOf('"""')
  const head = d0 < 0 ? '' : py.slice(d0, py.indexOf('"""', d0 + 3))

  // forms
  const forms = sec(o, /^## Invocation forms/)
  if (!/^\/thread:orient Animately --backlog +# /m.test(forms)) flag('forms', 'no `/thread:orient Animately --backlog` form')
  if (!/^\/thread:orient Animately --backlog --look +# /m.test(forms)) flag('forms', 'no `--backlog --look` form')

  // flags
  const s1 = sec(o, /^### 1\. /)
  need('flags', 'orient § 1', s1, ["orient's own flags (`--steer`, `--look`, `--backlog`"])
  const u1 = under(s1)[0] ?? ''
  need('flags', "orient § 1's Under paragraph", u1, ['--backlog takes an area: <name> is a <kind>; run /thread:orient <area> --backlog',
    'and reads nothing', 'and so does `--steer` with it', 'never with a question'])
  need('flags', 'B1', B(F, 1), ['--backlog takes an area: <name> is a <kind>; run /thread:orient <area> --backlog',
    '`--steer` with `--backlog` is refused the same way', 'no learned directory is held', "§ 3.5's Priorities card is never put"])

  // pointers
  for (const [n, bn] of [['1', 'B1'], ['2', 'B2'], ['4', 'B2'], ['5', 'B3'], ['6', 'B5'], ['7', 'B5'], ['9', 'B8']]) {
    const us = under(sec(o, new RegExp(`^### ${n}\\. `)))
    if (us.length !== 1) { flag('pointers', `orient § ${n} has ${us.length} Under \`--backlog\` paragraphs, not 1`); continue }
    if (!us[0].includes('`skills/orient/backlog.md` § B') || !us[0].includes(`§ ${bn}`)) flag('pointers', `orient § ${n}'s Under paragraph does not cite § ${bn}`)
    if (ASKS(us[0]) || /background batch/i.test(us[0])) flag('pointers', `orient § ${n}'s Under paragraph asks or names a background batch`)
  }
  if (!C(sec(o, /^## Don't/)).includes("**Under `--backlog`, don't put a question before the start, or start a serial note**: its questions come last, a serial note is listed on the Chorus Stage at B8, never started through `create_thread`")) {
    flag('pointers', "orient's Don't has no `--backlog` bullet")
  }
  const preamble = r.slice(0, r.indexOf('## Scoped targets'))
  for (const [name, text, bn] of [['the write surface', preamble, 'B5'], ['R1', sec(r, /^## R1\. /), 'B2'],
    ['R2', sec(r, /^## R2\. /), 'B3'], ['R3', sec(r, /^## R3\. /), 'B9'], ['R4', sec(r, /^## R4\. /), 'B4'], ['R5', sec(r, /^## R5\. /), 'B5']]) {
    const us = under(text)
    if (us.length !== 1) { flag('pointers', `reshuffle ${name} has ${us.length} Under paragraphs, not 1`); continue }
    if (!us[0].includes('`skills/orient/backlog.md` § B') || !us[0].includes(`§ ${bn}`)) flag('pointers', `reshuffle ${name}'s Under paragraph does not cite § ${bn}`)
    if (ASKS(us[0])) flag('pointers', `reshuffle ${name}'s Under paragraph asks`)
  }
  if (!C(sec(r, /^## Don'ts/)).includes("**Under `--backlog`, B4's record stands in for R4's gate** (`skills/orient/backlog.md` § B4)")) {
    flag('pointers', "reshuffle's Don'ts have no `--backlog` bullet")
  }

  // sweep-rule
  need('sweep-rule', 'B2', B(F, 2), ["the Pulse's line rules (backlog_trigger.py's Projects, Task and read_vault",
    'never PyYAML', 'still a member', 'at status `open` or `parked`', 'not tagged `rollout`', 'by stem or by `aliases:`',
    'casefolded, starts with a name the area note\'s `backlog_excludes:` lists', 'only the `project`-tagged notes'])
  need('sweep-rule', "the script's header", head, ["line for line the Pulse's", 'backlog_trigger.py', 'EXCLUDED_PROJECT_PREFIX',
    'a task PyYAML cannot parse is still a member'])
  if (!/^BACKLOG_STATUSES = \("open", "parked"\)/m.test(py)) flag('sweep-rule', 'BACKLOG_STATUSES is not ("open", "parked")')

  // held
  need('held', 'B3', B(F, 3), ['**A held park is frozen context.**', 'never reopened, scheduled, obsoleted or parked again'])
  need('held', "B's Don'ts", sec(b, /^## Don'ts/), ['**Never reopen, schedule or obsolete a held park.**'])
  need('held', 'the script', py, ['a held park (no `parked-by: backlog-orient`): frozen, never written here'])
  const disp = C(slice(F[CONTEXT] ?? '', /^- \*\*Backlog disposition\*\* — /, /^- \*\*|^#/) ?? '')
  need('held', 'CONTEXT.md **Backlog disposition**', disp, ['A **held park** is any park without `parked-by: backlog-orient`',
    'frozen, never reopened, scheduled, obsoleted or parked again'])

  // dispositions
  need('dispositions', 'B3', B(F, 3), ['**park**', '**reopen**', '**obsolete**', '**re-home**', '**merge**', '**unbundle**',
    'never for being unclear', 'an urgent task is never parked', 'distinct from the phase **retire**',
    '**Not under `--backlog`:** no **Drop**', 'no rename', 'Phase **retire** applies unchanged'])
  need('dispositions', 'reshuffle R2', sec(r, /^## R2\. /), ['**retire** — an unstarted phase emptied by moves or drops',
    'never the phase **retire** above'])
  need('dispositions', 'CONTEXT.md **Backlog disposition**', disp, ['not the phase **retire**', 'never for size'])

  // record
  const b7 = B(F, 7)
  need('record', 'B7', b7, ['After every task write', 'backlog-orient.py record --area <note> --date <D>'])
  const listed = `Its sections: ${SECTIONS.slice(0, -1).join(', ')} and ${SECTIONS.at(-1)}.`
  if (!C(b7).includes(listed)) flag('record', 'B7 does not list the record\'s sections, in order')
  const constant = py.match(/^SECTIONS = \(([\s\S]*?)\)$/m)?.[1] ?? ''
  if (JSON.stringify([...constant.matchAll(/"([^"]+)"/g)].map((m) => m[1])) !== JSON.stringify(SECTIONS)) flag('record', 'the script\'s SECTIONS differ')

  // batches
  need('batches', 'B5', B(F, 5), ["by orient-all § 6.2's rule", 'land.sh --origin-slug <root>', "urgent members' forks go in batch 1",
    'serial forks run one per batch, after every parallel batch', 'never two batches at once', '/thread:schedule --regenerate --tasks <members>',
    "`Under the Backlog orient: <area>; name the note with slug <projectSlug>; root <the batch's root>; decided none`",
    '`Under the Backlog orient: <area>; decided none`', 'and **touched**, every task note it wrote',
    "A parallel batch is one (repo, project): the repo its members' files sit in, as its home project declares it",
    "That declared path is the batch's root", '**A batch with no root gets no fork**',
    '`no root: [[<project>]] declares no repos: and no Local:`', '`no root: <repo> is not declared by [[<project>]]`',
    'Serial-shaped members still fork below'])
  need('batches', 'B9', B(F, 9), ["B5's root, grouping and batch rules", 'A decided task whose batch has no root gets `wait`'])
  need('batches', 'B10', sec(b, /^## B10\. /), ['each batch with no root with its misfit line'])
  need('batches', "the script's header", head, ['`local`, the two places B5 roots a parallel fork from'])

  // answers
  const b6 = B(F, 6)
  const nums = b6.split('\n').filter((l) => /^\d+\. /.test(l)).map((l) => Number(l.split('.')[0]))
  if (JSON.stringify(nums) !== JSON.stringify(Array.from({ length: 23 }, (_, i) => i + 1))) flag('answers', `B6 is numbered ${JSON.stringify(nums)}`)
  need('answers', 'B6', b6, ['A fork asks nothing', 'Yes, without the question (ADR 0071)', '`timeout: 600000`', 'the fork routes nothing',
    "Step 2.6's baseline: `none`", '`plan_approval: required`', "the prompt's `projectSlug`", 'because B8 owns the start',
    "its own read-only grading agents", 'there is no round and no `record`'])

  // write-back
  need('write-back', 'B7', b7, ["backlog-orient.py trigger --area <note> --write --reason <B2's reason> --record <path>",
    '**Exit 4: one fold.**', 're-forks with `--regenerate`', '`seen … urgent`', 'A second exit 4', '**holds the write-back**', 'the stamp stays pending'])
  need('write-back', 'the script', py, ['def _before_replace():', 'os.replace(fd.name, path)', 'json.dump(obj, fd, indent=1, ensure_ascii=False)',
    'FUTURE_TOLERANCE_MINUTES = 15', 'rounded up to the next whole second', 'restamp = args.restamp',
    'tg.add_argument("--restamp", action="store_true")'])
  if (/restamp = rec\.front/.test(py)) flag('write-back', 'the script infers the re-stamp from the record')
  need('write-back', 'B7', b7, ['A held write-back #1 takes no re-stamp'])
  need('write-back', 'B9', B(F, 9), ['`backlog-orient.py trigger --area <note> --write --restamp --reason <reason> --record <path>`',
    '**The re-stamp is skipped when write-back #1 was held**', '`no write-back #1 <record>`'])
  need('write-back', "B's Don'ts", sec(b, /^## Don'ts/), ['write-back #1 never before the last task write of B5 and its forks (B7)',
    "the re-stamp (`--restamp`) only after B9's last write, never after a held write-back #1"])

  // look
  need('look', 'B1', B(F, 1), ["runs B1, B2's steps 1–4 and B10 only"])
  need('look', 'B2', B(F, 2), ['Not under `--look`, which lists them unmended (B10)'])
  need('look', 'B10', sec(b, /^## B10\. /), ['It writes nothing of any kind', 'no mend', 'no drift apply', 'no learn',
    'no script write verb', 'no record', 'no fork', 'no stamp', 'no `create_thread` and no write-back'])

  // schedule
  const sch = F[SCHED] ?? ''
  const usch = C(paras(sch).find((p) => p.startsWith('**Under the Backlog orient.**')) ?? '')
  need('schedule', "schedule's **Under the Backlog orient.**", usch, ['`skills/orient/backlog.md` § B6', 'so the run asks nothing',
    'step 6 names the note with the slug its prompt gives', 'step 8 starts nothing'])
  if (ASKS(usch)) flag('schedule', "schedule's **Under the Backlog orient.** asks")
  need('schedule', 'schedule § 0', sec(sch, /^### 0\. /), ['Under the Backlog orient the run takes the Yes without the question (ADR 0071'])
  need('schedule', 'schedule § 1.2', sec(sch, /^### 1\.2\. /), ['under the Backlog orient (`skills/orient/backlog.md` § B6), or under orient § 6'])
  need('schedule', 'schedule § Scope', sec(sch, /^## Scope/), ['under the Backlog orient, without asking (ADR 0071)'])

  // grammar
  const writers = C(slice(sec(F[GRAMMAR], /^## Rollout start stamp/), /^- \*\*Writers\*\*/, /^- \*\*/) ?? '')
  need('grammar', "the vault grammar's Writers", writers, ['`reconcile-rollout.py stamp-start --backlog`', '`skills/orient/backlog.md` § B8',
    'never a held one', 'the Backlog orient B8 (`stamp-start --backlog`)', 'Off the Stage nothing stamps a serial note'])

  // asking
  need('asking', 'asking.md § 1', sec(F[ASKING], /^## 1\. /), ['except under the Backlog orient, which creates it (ADR 0071)'])

  // script
  const verbs = [...py.matchAll(/sub\.add_parser\("([^"]+)"\)/g)].map((m) => m[1])
  if (JSON.stringify(verbs) !== JSON.stringify(VERBS)) flag('script', `the script's verbs are ${JSON.stringify(verbs)}`)
  const rr = F[RR] ?? ''
  if (!rr.includes('ss.add_argument("--backlog"')) flag('script', 'stamp-start has no --backlog')
  need('script', 'reconcile-rollout.py', rr, ["a held queue starts on Lachy's word", '`--backlog` (ADR 0071)', 'the Backlog orient stamped it'])
  if (!/^GUARD_EXEMPT = \("status", "fold-journals", "moving"\)$/m.test(rr)) flag('script', 'GUARD_EXEMPT changed')

  // adr
  const adr = F[ADR] ?? ''
  if (ADR71.length !== 1 || !adr) flag('adr', `${ADR71.length} docs/adr/0071-*.md files`)
  if (!/^Status: accepted\./m.test(adr)) flag('adr', 'ADR 0071 is not accepted')
  for (const h of ['Context', 'Decision', 'Considered options', 'Consequences', 'Decided for him (overturnable)']) {
    if (!new RegExp(`^## ${h.replace(/[()]/g, '\\$&')}$`, 'm').test(adr)) flag('adr', `ADR 0071 has no ## ${h}`)
  }
  need('adr', 'ADR 0071', adr.split('\n## ')[0], ['Amends ADR 0036', 'ADR 0042 and `skills/_shared/asking.md` § 1', 'ADR 0057', 'ADR 0054',
    "ADR 0040's retired batches stay retired"])
  need('adr', 'ADR 0071 § Context', sec(adr, /^## Context$/), ['Animately ADR 0016', 'metrics ADR 0015'])
  const dnums = sec(adr, /^## Decision$/).split('\n').filter((l) => /^\d+\. \*\*/.test(l)).map((l) => Number(l.split('.')[0]))
  if (JSON.stringify(dnums) !== '[1,2,3,4,5,6,7]') flag('adr', `ADR 0071's decisions are ${JSON.stringify(dnums)}`)
  if (!(F[ADR54] ?? '').includes('| skills/orient/backlog.md | § B9 | `` puts each of his questions through AskUserQuestion, one at a time `` | *yours* | cited | — |')) {
    flag('adr', 'ADR 0054 § Sites has no § B9 row')
  }

  // unparseable
  need('unparseable', 'B2', B(F, 2), ['`python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/next-action.py mend <task>`', '**Unparseable slots**',
    "Then `sweep` runs once more, and its rows and `read_at` replace this step's", 'A row that still reads `unparseable` is frozen'])
  need('unparseable', "orient § 4's Under paragraph", under(sec(o, /^### 4\. /))[0] ?? '', ['the mend once for each `unparseable` row',
    'the sweep runs once more'])

  // named
  need('named', 'B7', b7, ['linked by the record outside Answered, waiting', "linked from the body of a rollout note the record's Batches links",
    'holding its own `rollout:` that links one'])
  need('named', "the script's header", head, ["a rollout note the record's `## Batches` links (in Work/Tasks/ or Work/Tasks/Archive/Rollouts/)"])

  // prior
  const a6 = C(slice(b6, /^6\. /, /^7\. /) ?? '')
  need('prior', 'B6 answer 6', a6, ['unfinished-rollout.py unstarted --rollout <prior>',
    'handoff-home.sh --dir <§ 0\'s resolved path>)/docs/handoffs', 'handoff-home.sh --shared-root)/docs/handoffs',
    'handoff-home.sh)/docs/handoffs', 'reconcile-rollout.py status --rollout <prior>', 'both `holdUntil` and `onMerge` are null',
    '`stamped <prior> (start: unattended)`', '`launched …`', 'any rollout hold, readable or not, and an `on_merge:`',
    '`waits on [[<prior>]]: <the unstarted line | hold_until <pr> | on_merge>; it stands (/thread:status [[<prior>]])`'])
  need('prior', "B's Don'ts", sec(b, /^## Don'ts/), ['**Never supersede a prior that answer 6 stops on.**'])

  // departure
  need('departure', 'ADR 0071 d7', sec(adr, /^## Decision$/), ['departs from metrics ADR 0015 d2', 'd9 Baseline bullet',
    "narrows the orient's side of metrics ADR 0015's Known race", 'without closing it', '`pulse-adr-0015-records-the-backlog-orient-write-back`'])

  // wait
  const b9 = B(F, 9)
  need('wait', 'B9', b9, ['`python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/backlog-orient.py wait --task <slug> --why "<its why>"`',
    '`## Answered, waiting` row', '**A fork that stopped**', '`wait` for each decided member, and an `## Answered, waiting` row each'])
  need('wait', 'the script', py, ['waits for the next Backlog orient: %s'])

  // runtime
  const runtimeSites = [[`${ORIENT} § Runtime boundary`, sec(o, /^## Runtime boundary/)], [`${ORIENT} § 8`, sec(o, /^### 8\. /)],
    [`${README} § Runtime support`, sec(F[README], /^## Runtime support/)]]
  for (const [name, raw] of runtimeSites) {
    const t = C(raw)
    const hits = [...t.matchAll(/orient spawns no child/g)]
    if (!hits.length) flag('runtime', `${name} has no "orient spawns no child"`)
    for (const m of hits) {
      const rest = t.slice(m.index)
      const end = rest.search(/[.;](?:\s|$)/)
      if (!(end < 0 ? rest : rest.slice(0, end)).includes('outside `--backlog`')) flag('runtime', `${name}: a bare "orient spawns no child"`)
    }
    if (!t.includes('under `--backlog`') && !t.includes('Under `--backlog`')) flag('runtime', `${name} does not name --backlog`)
    if (!t.includes('§ B5')) flag('runtime', `${name} does not cite § B5`)
  }

  // start
  const b8 = B(F, 8)
  need('start', 'B8', b8, ['each note B5\'s forks or B7\'s fold wrote', 'then from B9, with each note its post-question round wrote',
    'reconcile-rollout.py stamp-start --backlog --rollout <note>', '**A serial note is listed on the Chorus Stage.**', '`list_sessions`',
    "`leg.py status`'s `restart.launch`", 'Never `/thread:repair`', 'Every result is a Rollouts started row',
    // P44-4 (R1): off the Stage nothing is stamped; each serial Leg 1 is a paste-ready prompt, never listed.
    '**Off the Stage** nothing is stamped there, parallel or serial: the parallel stamps wait like Not yet, and each serial note\'s Leg 1 is a paste-ready prompt in the record',
    'never listed, its one start path'])
  if (/leads the Rollout <slug>|`create_thread` with the title `Leg 1/.test(C(b8))) flag('start', 'B8 still starts a serial Leg 1 through create_thread')
  need('start', 'B9', b9, ['then § B8 on that note; then its Rollouts started row'])

  // questions
  const c9 = C(b9)
  // § B8's presence in B9 is `start`'s; here it only has to sit between the round and the re-stamp when it is there.
  const order = ["each fork's `asks[i]`", 'one § 3.5 question per task', "then R3's grill", '**After each answer**',
    '**Then one post-question round**', '§ B8 on that note', '**Then one re-stamp, last:**', 'backlog-orient.py trigger --area <note> --write']
  const at = order.map((p) => c9.indexOf(p)).filter((i, k) => i >= 0 || order[k] !== '§ B8 on that note')
  if (at.some((i) => i < 0) || at.some((i, k) => k && i < at[k - 1])) flag('questions', `B9's order is ${JSON.stringify(at)}`)
  const anchor = proseUnits(b9).filter((u) => u.includes('puts each of his questions through AskUserQuestion, one at a time'))
  if (anchor.length !== 1 || !anchor[0].includes('${CLAUDE_PLUGIN_ROOT}/skills/_shared/asking.md') || !anchor[0].includes('Owner *yours*')) {
    flag('questions', "B9's ask unit does not cite asking.md with Owner *yours*")
  }

  // gate-answer
  const no = item(b9, '§ 3.5 No')
  need('gate-answer', "B9's § 3.5 No", no, ['estate-dispatch.py record', '--by schedule',
    `'§ 3.5 gate: does "<the matched words>" hold this task out of a rollout?'`, '`## Decisions (asked ahead <D>)`', 'joins the post-question round'])
  const yes = item(b9, '§ 3.5 Yes')
  need('gate-answer', "B9's § 3.5 Yes", yes, ['nothing is written to the task', 'It stays out', '`## Held by his answer`', 'no `wait` line'])
  never('gate-answer', "B9's § 3.5 Yes", yes, ['backlog-orient.py wait', 'estate-dispatch.py record'])
  need('gate-answer', 'B6 answer 15', C(slice(b6, /^15\. /, /^16\. /) ?? ''), ['a match that a recorded `## Decisions` answer settles is dismissed'])
  if (!constant.includes('"Held by his answer"')) flag('gate-answer', "the script's SECTIONS lack Held by his answer")
  if (!/^WAITING = "Answered, waiting"$/m.test(py) || /rec\.rows\("Held by his answer"\)/.test(py)) flag('gate-answer', 'guard 4 reads another section')

  // wording
  const askUnits = proseUnits(b).filter(ASKS)
  if (askUnits.length !== 1 || !C(b9).includes(askUnits[0])) flag('wording', `${askUnits.length} units of ${BACK} ask, not B9's one`)
  if (/\bnever calls? the question tool\b/i.test(C(b))) flag('wording', `${BACK} says it never calls the question tool`)
  for (const re of RETIRED) if (re.test(b)) flag('wording', `${BACK} holds ${re}`)
  for (const f of [ORIENT, RESH, SCHED, GRAMMAR, README, ASKING]) {
    for (const u of proseUnits(F[f] ?? '')) if (/§ B\d/.test(u) && !u.includes('`skills/orient/backlog.md` § B')) flag('wording', `${f}: a § B<n> without the file: ${u.slice(0, 80)}`)
  }

  return { fails: [...fails].sort(), details }
}

const FILES = Object.fromEntries([ORIENT, RESH, BACK, SCHED, GRAMMAR, ASKING, SCRIPT, RR, ADR54, README, CONTEXT, ADR].map((f) => [f, readIf(f)]))

function swap(files, rel, from, to) {
  assert.ok(files[rel]?.includes(from), `${rel} no longer holds ${JSON.stringify(from.slice(0, 80))}: update this control`)
  return { ...files, [rel]: files[rel].replace(from, to) }
}
const only = (files, rules, what) => {
  const r = check(files)
  assert.deepEqual(r.fails, rules, `${what}: ${r.details.join('\n')}`)
}

test('the Backlog orient: its file, its pointers, its script, its start, its questions and its write-back agree', () => {
  const r = check(FILES)
  assert.deepEqual(r.fails, [], r.details.join('\n'))
  assert.ok(read(BACK).length > 1000, 'backlog.md is read')
})

const CONTROLS = [
  ['forms', [ORIENT, '/thread:orient Animately --backlog --look # ', '/thread:orient Animately --look-only # ']],
  ['flags', [ORIENT, "orient's own flags (`--steer`, `--look`, `--backlog`,", "orient's own flags (`--steer`, `--look`,"]],
  ['pointers', [ORIENT, "**Under `--backlog`.** The reshuffle has no gate: B3's dispositions", "Under backlog the reshuffle has no gate: B3's dispositions"]],
  ['sweep-rule', [BACK, 'never PyYAML', 'by PyYAML']],
  ['held', [BACK, '**A held park is frozen context.**', '**A held park is context.**']],
  ['dispositions', [BACK, '**Not under `--backlog`:** no **Drop**', '**Not under `--backlog`:** a **Drop**']],
  ['record', [BACK, 'Answered, waiting,\n   Folded, Write-back and Touched.', 'Answered, waiting,\n   Write-back and Touched.']],
  ['batches', [BACK, "urgent\n  members' forks go in batch 1", "urgent\n  members' forks go in batch 2"]],
  ['batches', [BACK, '**A batch with no root gets\n  no fork**', '**A batch with no root forks\n  anyway**']],
  ['answers', [BACK, "18. Step 4.7's rungs: none, with the hard tasks named.\n", '']],
  ['write-back', [BACK, '4. A second exit 4, or guard 3', '4. Each exit 4, or guard 3']],
  ['write-back', [SCRIPT, 'restamp = args.restamp', 'restamp = rec.front["last_orient_at"] is not None']],
  ['write-back', [BACK, '--write --restamp --reason <reason> --record <path>`.', '--write --reason <reason> --record <path>`.']],
  ['look', [BACK, 'no `create_thread` and no write-back', 'no `create_thread`, and then the write-back']],
  ['look', [BACK, "runs B1, B2's steps 1–4 and B10 only", 'runs B1, B2 and B10 only']],
  ['schedule', [SCHED, 'under the Backlog orient (`skills/orient/backlog.md` § B6), or under orient § 6', 'or under orient § 6']],
  ['grammar', [GRAMMAR, ', never a held one', '']],
  ['start', [BACK, '- **Off the Stage** nothing is stamped there, parallel or serial: the parallel stamps wait like Not yet, and each\n  serial note\'s Leg 1 is a paste-ready prompt',
    '- **Off the Stage** each serial note is stamped too: the parallel stamps wait like Not yet, and each\n  serial note\'s Leg 1 is a paste-ready prompt']],
  ['asking', [ASKING, ', except under the Backlog orient, which creates it (ADR 0071)', '']],
  ['script', [SCRIPT, 'rh = sub.add_parser("rehome")', 'rh = sub.add_parser("re-home")']],
  ['adr', [ADR, '## Considered options', '## Options']],
  ['unparseable', [BACK, "Then `sweep` runs once more, and its\n   rows and `read_at` replace this step's. ", '']],
  ['named', [BACK, "linked from the body of a rollout note the record's Batches links, or holding", 'or holding']],
  ['prior', [BACK, '     `$(bash ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/handoff-home.sh --shared-root)/docs/handoffs` and\n', '     and\n']],
  ['departure', [ADR, 'without closing it', 'and closes it']],
  ['wait', [BACK, '  `python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/backlog-orient.py wait --task <slug> --why "<its why>"` and an\n', '  a note line and an\n']],
  ['start', [BACK, 'then § B8 on that note; then its\n  Rollouts started row', 'then its\n  Rollouts started row']],
  ['gate-answer', [BACK, '  `python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/estate-dispatch.py record --task <slug> --question \'§ 3.5 gate:', '  `record --task <slug> --question \'§ 3.5 gate:']],
  ['gate-answer', [BACK, 'with no `wait` line and no', 'with a `backlog-orient.py wait` line and no']],
  ['gate-answer', [BACK, 'a match that a recorded `## Decisions` answer settles is dismissed', 'every match is a drop']],
  ['wording', [BACK, '- **Frozen**, listed and never touched:', '- **Frozen**, listed (and ask him first):']],
  ['wording', [BACK, '- **Never rename a task**', '- **Never rename a task or a ' + ['wa', 've'].join('')]],
]

for (const [rule, [rel, from, to]] of CONTROLS) {
  test(`control ${rule}: ${JSON.stringify(from.slice(0, 50))} mutated in ${rel} fails ${rule} alone`, () => {
    only(swap(FILES, rel, from, to), [rule], rule)
  })
}

test('control runtime: each of the three sites with its bare sentence back fails runtime alone', () => {
  only(swap(FILES, ORIENT, 'orient spawns no child agents outside `--backlog`: ADR 0040', 'orient spawns no child agents: ADR 0040'), ['runtime'], 'boundary')
  only(swap(FILES, ORIENT, 'orient spawns no child outside `--backlog` and writes no', 'orient spawns no child and writes no'), ['runtime'], '§ 8')
  only(swap(FILES, README, 'orient spawns no child\nagents outside `--backlog` (ADR 0040', 'orient spawns no child\nagents (ADR 0040'), ['runtime'], 'README')
})

test('control questions: the re-stamp moved above the post-question round fails questions alone', () => {
  const b = FILES[BACK]
  const restamp = b.slice(b.indexOf('**Then one re-stamp, last:**'), b.indexOf('## B10.'))
  const round = '**Then one post-question round**'
  assert.ok(restamp.length > 50 && b.includes(round), 'control setup')
  only({ ...FILES, [BACK]: b.replace(restamp, '').replace(round, `${restamp}${round}`) }, ['questions'], 'moved')
})
