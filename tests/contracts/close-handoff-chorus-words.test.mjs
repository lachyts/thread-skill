// Close and handoff end on words the Chorus Stage reads (thread-skill-p22-4). The Stage reads a Turn's last
// assistant message (Chorus src/stage/session.py: `response = ev["text"]`) with no model first: a Response that
// ENDS on the Agent's closing sentence and asks nothing anywhere reads *closed*, which archives its Session
// (Chorus ADR 0089 d2); a Response that asks, or a sentence more text follows, goes to the model leg and never
// archives on its own. A rollout lead's ROLLOUT-STATUS line is the one thing allowed after the sentence: the
// Stage takes it out before it reads, and at `state=done` reads *closed* by the same rule. A handoff on the
// Stage starts its next Session at once (ADR 0089 d1), so its closing words say so and never ask Lachy to
// start it. A handoff then runs `next` for this session, the parent (handoff § Next for this session), after its
// closing line, so on the Stage the Turn's last message is next's. The port reads two fixed template lines only:
// the handoff line, then next step 4's archive line (its archive part and close part) after it, which together read
// neither closed nor asking. What else next prints there is model-written text the port cannot read, so a prose pin
// in check() (`next:after-handoff`) holds next's rule that after this session's own handoff it prints no step-2
// summary or open question and asks nothing outside its menu: Chorus's close leg reads a closing message that
// asks anything, anywhere in it, as *question*.
//
// Four layers, reading files only (nothing is written anywhere):
//   1. the port: Chorus's readers, copied verbatim into JS (header below names each source line);
//   2. port self-tests: Chorus's documented behaviour, so a bad port fails here before it judges skill text;
//   3. the skill text read THROUGH the port: close's four banners, the paraphrase counter-example, the
//      NOT-closed form, the step-8 statement offer and rollout row (ADR 0057), rule (3)'s question line, a lead's status line, open
//      save's checkpoint line and handoff's closing line, then that line followed by next step 4's archive line
//      (two fixed lines), each extracted from the skill files themselves;
//   4. prose and order pins through check(files), which returns named failures, each with a mutation control:
//      among them execute's `done` route, which still runs the thread close (the ceremony's last step, after the
//      archive commit that makes `next` read `done`), handoff's closing line, printed only on a raised card, and
//      next's after-handoff run, which prints no step-2 summary or open question.
// A fifth, optional layer cross-checks the port against the real Python when CHORUS_SRC names Chorus's src/
// (`CHORUS_SRC=~/repos/tools/chorus/src node --test <this file>`); tests/run.sh never sets it, so it skips.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { read, slice, section, lineOf, collapse, fencedBlocks, FENCE } from '../lib/contract-text.mjs'

// ---- 1. The port ----------------------------------------------------------------------------------------
// Chorus 7a1c9b81c43c, src/summarise.py, verbatim but for the regex dialect:
//   _CODE_SPAN (588)                    re.compile(r"(`+)(.+?)\1")
//   _CLOSE_CHARS (1846)                 4000
//   _CLOSING (1879)                     re.compile(r"(thread closed)(\W+)(safe to end this session)", re.I)
//   _BLOCKS (1895)                      re.compile(r"\n\s*\n")
//   ends_closed (1922)
//   _ASKS_Q, _ASKS_FENCE, _ASKS_URL, _ASKS_QUESTION (1951-1954)
//   _without_fences (1957), asks (1974)
//   close (2091), its fast path only: `ends_closed(response) and not asks(response)` → *closed*
//   ROLLOUT_STATUS (2135), _last_line (2150), _cut_on_a_word (2220), CLOSE_VALUES (1869)
//   the lead's line, named here after Chorus's docstrings ("the lead's line"), as the queue-only register keeps
//   the retired word out: OLD_STATUS, LEAD_REASON, LEAD_HEAD, LEAD_TAIL, LEAD_FENCE, HALTED, WEDGED, REASON_CHARS
//   are WAVE_STATUS (2131), _WAVE_REASON, _WAVE_LINE_HEAD, _WAVE_LINE_TAIL, _WAVE_FENCE (2139-2142), WAVE_HALTED,
//   WAVE_WEDGED, _WAVE_REASON_CHARS; leadLine, leadStatus, withoutLeadLine and leadClose are _wave_line (2164),
//   wave_status (2195), _without_wave_line (2209) and wave_close (2232)
// Dialect: Python's Unicode `\w` / `\W` become `[\p{L}\p{N}_]` / `[^\p{L}\p{N}_]` (so `[^\W_]` is
// `[\p{L}\p{N}]`) under the `u` flag; `.` (no DOTALL) becomes `[^\n]`; `c.isalpha()` becomes `\p{L}`;
// `" ".join(s.split())` splits on `\s+`; a raw string's `\"` is a plain `"` (an identity escape the `u` flag
// refuses); `pattern.match(s, pos)` is a sticky regex at `pos`; `fullmatch` is `^…$`. Python's `$` also
// matches before a final newline, which `(?:\s|$)` already covers through `\s`. Python's `\d` and `\s` take a
// few more Unicode characters than JS's, and Python slices by code point where JS slices by UTF-16 unit, which
// differs only past 4000 characters holding astral characters: every fixture here is short and plain.
// A change to these readers in Chorus needs a re-copy; the CHORUS_SRC check below is what catches the drift.
const CLOSE_CHARS = 4000
const CLOSING = /(thread closed)([^\p{L}\p{N}_]+)(safe to end this session)/iu
const BLOCKS = /\n\s*\n/u
const CODE_SPAN = /(`+)([^\n]+?)\1/gu
const ASKS_Q = String.raw`\?(?!_*[\p{L}\p{N}]|[=&/%#])`
const ASKS_FENCE = /^[ \t>]*(`{3,}|~{3,})/u
const ASKS_URL = new RegExp(String.raw`[A-Za-z][A-Za-z0-9+.\-]*://\S*?(?=[.,;:!?"'”’*_~)\]]*(?:\s|$)|` + ASKS_Q + ')', 'gu')
const ASKS_QUESTION = new RegExp(ASKS_Q, 'u')
const OLD_STATUS = /WAVE-STATUS:\s+(?<slug>\S+)\s+cursor=(?<k>\d+)\/(?<n>\d+)\s+state=(?<state>running|waiting|halted|done)/gu
const ROLLOUT_STATUS = /ROLLOUT-STATUS:\s+(?<slug>\S+)\s+merged=(?<k>\d+)\/(?<n>\d+)\s+running=(?<r>\d+)\s+state=(?<state>running|waiting|halted|done)/gu
const LEAD_REASON = /\s+reason="(?<reason>[^"]*)"/uy
const LEAD_HEAD = new Set(' \t`>*_-')
const LEAD_TAIL = new Set(' \t`*_.')
const LEAD_FENCE = /^\s*(?:`{3,}|~{3,})\s*$/u
const CLOSE_VALUES = { question: 'a question', review: 'work to review', report: 'a report', nothing: 'nothing yet', closed: 'closed' }
const HALTED = 'halted'
const WEDGED = 'likely wedged'
const REASON_CHARS = 60

const words = (s) => s.split(/\s+/u).filter((w) => w !== '')

function lastLine(text) {
  let end = text.length
  let fence = true
  for (;;) {
    end = text.slice(0, end).trimEnd().length
    const start = end === 0 ? 0 : text.lastIndexOf('\n', end - 1) + 1
    if (fence && end && LEAD_FENCE.test(text.slice(start, end))) {
      end = start
      fence = false
      continue
    }
    return [start, end]
  }
}

function leadLine(text) {
  text = text || ''
  const [start, end] = lastLine(text)
  const line = text.slice(start, end)
  let found = null
  let at = -1
  for (const pattern of [OLD_STATUS, ROLLOUT_STATUS]) {
    for (const m of line.matchAll(pattern)) {
      if ([...line.slice(0, m.index)].some((c) => !LEAD_HEAD.has(c))) continue
      LEAD_REASON.lastIndex = m.index + m[0].length
      const reason = LEAD_REASON.exec(line)
      const after = reason ? reason.index + reason[0].length : m.index + m[0].length
      if ([...line.slice(after)].some((c) => !LEAD_TAIL.has(c))) continue
      if (m.index < at) continue
      const status = { slug: m.groups.slug, k: Number(m.groups.k), n: Number(m.groups.n) }
      if (pattern === ROLLOUT_STATUS) status.r = Number(m.groups.r)
      status.state = m.groups.state
      status.reason = reason ? reason.groups.reason : ''
      if (pattern === ROLLOUT_STATUS) status.queue = true
      found = [status, start, end]
      at = m.index
    }
  }
  return found
}

const leadStatus = (text) => leadLine(text)?.[0] ?? null

function withoutLeadLine(text) {
  const got = leadLine(text)
  if (got === null) return text || ''
  const [, start, end] = got
  return text.slice(0, start) + text.slice(end)
}

function endsClosed(response) {
  const tail = withoutLeadLine(response).slice(-CLOSE_CHARS)
  const blocks = tail.split(BLOCKS).map((b) => words(b).join(' ')).filter((one) => /\p{L}/u.test(one))
  return blocks.length > 0 && CLOSING.test(blocks[blocks.length - 1])
}

function withoutFences(text) {
  const kept = []
  let fence = null
  for (const line of text.split('\n')) {
    const m = ASKS_FENCE.exec(line)
    if (fence === null) {
      if (m) {
        fence = m[1]
        continue
      }
      kept.push(line)
    } else if (m && m[1][0] === fence[0] && m[1].length >= fence.length && !line.slice(m[0].length).trim()) {
      fence = null
    }
  }
  return kept.join('\n')
}

function asks(response) {
  const text = withoutFences(withoutLeadLine(response)).replace(CODE_SPAN, ' ')
  return ASKS_QUESTION.test(text.replace(ASKS_URL, ' '))
}

// `close`'s fast path: *closed* with no model, or null (the leg reads it).
const fastClose = (response) => ((response || '').trim() && endsClosed(response) && !asks(response) ? CLOSE_VALUES.closed : null)

function cutOnAWord(text, cap) {
  text = words(text).join(' ')
  if (text.length <= cap) return text
  const head = text.slice(0, cap)
  const cut = head.includes(' ') ? head.slice(0, head.lastIndexOf(' ')) : head
  return `${cut.replace(/[.,;:!]+$/u, '')}…`
}

function leadClose(status, response) {
  if (status === null) return null
  const { state } = status
  if (state === 'waiting' || (state === 'running' && status.queue)) return [CLOSE_VALUES.nothing, '']
  if (state === 'halted') return [HALTED, cutOnAWord(status.reason || '', REASON_CHARS)]
  if (state === 'done') {
    if (endsClosed(response) && !asks(response)) return [CLOSE_VALUES.closed, '']
    return [CLOSE_VALUES.review, 'the rollout']
  }
  if (state === 'running') return [HALTED, WEDGED]
  return null
}

// What the Stage reads off one Response; the drift check compares exactly this with the Python.
const reading = (t) => {
  const s = leadStatus(t)
  return { endsClosed: endsClosed(t), asks: asks(t), status: s, statusClose: leadClose(s, t) }
}

// ---- The skill text -------------------------------------------------------------------------------------
const real = {
  close: read('skills/close/SKILL.md'),
  handoff: read('skills/handoff/SKILL.md'),
  lifecycle: read('skills/_shared/handoff-lifecycle.md'),
  execute: read('skills/execute/SKILL.md'),
  template: read('skills/schedule/rollout-template.md'),
  next: read('skills/next/SKILL.md'),
  open: read('skills/open/SKILL.md'),
  legs: read('skills/execute/legs.md'),
}

const STEP8 = (t) => lineOf(t, /^8\. \*\*Print the "What landed" report/) ?? ''
const STEP9 = (t) => slice(t, /^9\. \*\*End with the closing banner/, /^## Edge cases/) ?? ''
const EDGES = (t) => section(t, /^## Edge cases/) ?? ''
const BUILD = (t) => section(t, /^## Build the handoff prompt/) ?? ''

// A placeholder's sample, by name; an unknown placeholder throws, so a new one is filled on purpose.
const SAMPLE = {
  repo: 'thread-skill',
  branch: 'feat/chorus-words',
  reason: 'a memory write was blocked and its redirect is unclear',
  pointer: 'THREAD.md § Research digest',
  'abs doc path': '/Users/lachlants/repos/tools/thread-skill/docs/handoffs/2026-10-17-chorus-words.md',
  slug: 'thread-skill-rollout-2026-10-28',
  root: '/Users/lachlants/repos/tools/thread-skill-rollout',
  'the other session': 'exports JSON writer (Session)',
}
function fill(s) {
  return s.replace(/<([a-z ]+)>(?:\[, <\1>…\])?/g, (_, name) => {
    if (!(name in SAMPLE)) throw new Error(`no sample for <${name}> in ${s}`)
    return SAMPLE[name]
  })
}

const banners = (t) => fencedBlocks(STEP9(t)).map((b) => b.map((l) => l.trim()).join(' '))
const pick = (text, re) => text.match(re)?.[1] ?? null
const paraphrase = (t) => pick(STEP9(t), /\*"(This thread is closed:[^"]*)"\*/)
const notClosed = (t) => pick(STEP9(t), /\*"(Thread NOT closed: [^"]*)"\*/)
const questionLine = (t) => pick(STEP9(t), /`(Which way on the Needs your call row\(s\) above\?)`/)
const offer = (t) => pick(STEP8(t), /`(research not landed: [^`]*)`/)
const rolloutRow = (t) => pick(STEP8(t), /`(rollout not started: [^`]*)`/)
const savedLine = (t) => pick(lineOf(t, '- In place of close') ?? '', /`(Thread saved[^`]*)`/)
const handoffLine = (t) => (fencedBlocks(BUILD(t))[1] ?? []).map((l) => l.trim()).join(' ') || null
// next step 4's archive line: the first double-quoted string of its archive part and of its close part.
const STEP4 = (t) => slice(t, /^4\. \*\*Decide the move/, /^5\. /) ?? ''
const archivePart = (t) => pick(lineOf(STEP4(t), /^\s*- the archive part,/) ?? '', /"([^"]*)"/)
const closePart = (t) => pick(lineOf(STEP4(t), /^\s*- the close part,/) ?? '', /"([^"]*)"/)

// A close's report: rows as step 8 prints them, a link with a query string among them.
const REPORT = [
  'THREAD.md updated · state: active · open questions: 0',
  'THREAD.md: 3f2a9c1 in /Users/lachlants/repos/tools/thread-skill',
  'ADD feedback_chorus_words.md (provisional)',
  'handoff: none in /Users/lachlants/repos/tools/thread-skill/docs/handoffs',
  'next task: [[thread-skill-p22-5]] on Thread Skill · obsidian://open?vault=obsidian&file=Work%2FTasks%2Fthread-skill-p22-5',
  'landing /Users/lachlants/repos/tools/thread-skill: queued https://github.com/lachyts/thread-skill/pull/158',
].join('\n')
const closing = (report, last) => `${report}\n\n---\n\n${last}`
const STATUS_DONE = 'ROLLOUT-STATUS: thread-skill-rollout-2026-10-17 merged=3/3 running=0 state=done'
const STATUS_SIGNOFF = 'ROLLOUT-STATUS: thread-skill-rollout-2026-10-17 merged=2/3 running=0 state=halted reason="awaiting sign-off: [[thread-skill-p22-9]]"'
const NEEDS_CALL = `Needs your call: ${SAMPLE.branch} PR https://github.com/lachyts/thread-skill/pull/159 — the finding needs an ADR change`
const DISCARD = 'Discarded: the scratch timing table (re-derivable from the Run record).'

// Every Response the tests read, so the drift check reads the same corpus.
const corpus = new Set()
const seen = (t) => { corpus.add(t); return t }
const R = (t) => reading(seen(t))

// ---- 2. Port self-tests ---------------------------------------------------------------------------------
const BANNER = '**Thread closed. Safe to end this session — nothing valuable left in conversation state.**'

test('port: asks ignores code, fences, quoted and unclosed fences, links and query strings', () => {
  for (const t of [
    'Run `x?` to check.',
    'Before:\n```\nwhy?\n```\nAfter.',
    'Before:\n~~~\nwhy?\n~~~\nAfter.',
    'Quoted:\n> ```\n> why?\n> ```\nAfter.',
    'Unclosed:\n```\nwhy?\nstill code',
    'Open obsidian://open?vault=obsidian&file=Work%2FTasks%2Fx to read it.',
    'see page?_ga=1 for the tracking key',
    'Long fence:\n````\n```\nstill code?\n````\nAfter.',
  ]) assert.equal(R(t).asks, false, JSON.stringify(t))
})

test('port: a fence closes only on the same character, at least as long', () => {
  assert.equal(R('````\n```\nwhy?\n').asks, false, 'a ``` line closed a ```` fence')
  assert.equal(R('~~~\n```\nwhy?\n').asks, false, 'a ``` line closed a ~~~ fence')
  assert.equal(R('```\ncode\n```\nwhy?').asks, true, 'text after a closed fence is read')
})

test('port: a real question asks, emphasis and brackets included, and a link never swallows one', () => {
  for (const t of [
    'Merge https://github.com/lachyts/thread-skill/pull/3?—or leave it',
    'See https://example.com/x?',
    '_Shall I merge?_',
    'Is it (done?)',
    'Want me to file it?',
  ]) assert.equal(R(t).asks, true, JSON.stringify(t))
})

test('port: the banner ends closed after a report and `---`, and a trailing rule is furniture', () => {
  assert.equal(R(closing(REPORT, BANNER)).endsClosed, true)
  assert.equal(R(`${closing(REPORT, BANNER)}\n\n---`).endsClosed, true)
  assert.equal(R(`${closing(REPORT, BANNER)}\n\nWant me to file it?`).endsClosed, false, 'text after the banner still ends closed')
  assert.equal(R(`${closing(REPORT, BANNER)}\n\nWant me to file it?`).asks, true)
})

test('port: a lead\'s status line after the banner is taken out, in a closing fence too, and alone ends nothing', () => {
  const plain = R(`${closing(REPORT, BANNER)}\n${STATUS_DONE}`)
  assert.equal(plain.endsClosed, true)
  assert.equal(plain.status?.state, 'done')
  const fenced = R(`${closing(REPORT, BANNER)}\n\n\`\`\`\n${STATUS_DONE}\n\`\`\``)
  assert.equal(fenced.endsClosed, true)
  assert.equal(fenced.asks, false)
  assert.equal(fenced.status?.state, 'done')
  const alone = R(STATUS_DONE)
  assert.equal(alone.endsClosed, false)
  assert.deepEqual(alone.statusClose, ['work to review', 'the rollout'])
})

// ---- 3. The skill text read through the port ------------------------------------------------------------
test('close step 9: exactly four banners, each ending its message closed with nothing asked', () => {
  const b = banners(real.close)
  assert.equal(b.length, 4, `step 9 holds ${b.length} fenced blocks, not the four banners`)
  for (const banner of b) {
    const t = closing(REPORT, fill(banner))
    const r = R(t)
    assert.equal(r.endsClosed, true, `banner does not end closed: ${banner}`)
    assert.equal(r.asks, false, `banner asks: ${banner}`)
    assert.equal(fastClose(t), 'closed', `banner misses the fast path: ${banner}`)
  }
})

test('close step 9: the paraphrase, the NOT-closed form and open save\'s line never read closed', () => {
  const p = paraphrase(real.close)
  assert.ok(p, 'step 9 quotes no "This thread is closed: …" counter-example')
  assert.equal(R(closing(REPORT, p)).endsClosed, false, 'the paraphrase reads closed')
  const n = notClosed(real.close)
  assert.ok(n, 'step 9 has no "Thread NOT closed: …" form')
  assert.equal(R(closing(REPORT, fill(n))).endsClosed, false, 'the NOT-closed form reads closed')
  const s = savedLine(real.open)
  assert.ok(s, 'open has no `Thread saved …` line')
  assert.equal(R(closing(REPORT, s)).endsClosed, false, 'a checkpoint reads closed and would archive')
})

test('close step 8: the research-landing offer is a statement, so the close still archives', () => {
  const o = offer(real.close)
  assert.ok(o, 'step 8 has no `research not landed: …` statement offer')
  const t = closing(`${REPORT}\n${fill(o)}`, BANNER)
  assert.equal(R(t).asks, false, `the offer asks: ${o}`)
  assert.equal(fastClose(t), 'closed')
  assert.equal(R(closing(`${REPORT}\nresearch not landed: ${SAMPLE.pointer}. Want me to land it?`, BANNER)).asks, true,
    'control: a question-form offer reads as asking')
})

test('close step 8: the rollout-not-started row (ADR 0057) is a statement, so the close still archives', () => {
  const o = rolloutRow(real.close)
  assert.ok(o, 'step 8 has no `rollout not started: …` statement row')
  const t = closing(`${REPORT}\n${fill(o)}`, BANNER)
  assert.equal(R(t).asks, false, `the row asks: ${o}`)
  assert.equal(fastClose(t), 'closed')
  assert.equal(R(closing(`${REPORT}\nrollout not started: [[${SAMPLE.slug}]]. Shall I hand it off to a fresh session?`, BANNER)).asks, true,
    'control: a question-form row reads as asking')
})

test('close step 9 rule (3): a Needs-your-call row\'s question line keeps the Session; without it, it archives', () => {
  const q = questionLine(real.close)
  assert.ok(q, 'step 9 has no rule (3) question line')
  const d = banners(real.close)[3]
  assert.ok(d, 'no banner D')
  const held = closing(`${REPORT}\n${NEEDS_CALL}\n${DISCARD}\n${q}`, fill(d))
  assert.equal(R(held).asks, true, 'the question line does not ask')
  assert.equal(R(held).endsClosed, true)
  assert.equal(fastClose(held), null, 'a close that leaves a decision archives')
  const bare = closing(`${REPORT}\n${NEEDS_CALL}\n${DISCARD}`, fill(d))
  assert.equal(R(bare).asks, false, 'control: the row alone asks')
  assert.equal(fastClose(bare), 'closed', 'control: the row alone keeps the Session')
})

test('close step 9 rule (2): banner then the lead\'s status line archives at done, never at halted', () => {
  const b = banners(real.close)[1]
  assert.ok(b, 'no banner B')
  const done = closing(REPORT, `${fill(b)}\n${STATUS_DONE}`)
  assert.equal(R(done).endsClosed, true)
  assert.equal(R(done).asks, false)
  assert.deepEqual(R(done).statusClose, ['closed', ''])
  const signoff = closing(REPORT, `${fill(b)}\n${STATUS_SIGNOFF}`)
  assert.deepEqual(R(signoff).statusClose, ['halted', 'awaiting sign-off: [[thread-skill-p22-9]]'])
  assert.equal(R(STATUS_DONE).endsClosed, false, 'control: the status line alone ends closed')
})

test('handoff § Build: the closing line says the next Session is starting and never asks', () => {
  const l = handoffLine(real.handoff)
  assert.ok(l, '§ Build has no second fenced block with the closing line')
  const t = `landing /Users/lachlants/repos/tools/thread-skill: landed\n\n${fill(l)}`
  assert.equal(R(t).endsClosed, false, 'the handoff line reads as a close')
  assert.equal(R(t).asks, false, 'the handoff line asks')
  assert.ok(l.includes('is starting'), 'the handoff line does not say the next Session is starting')
  for (const bad of ['Start it', 'open it']) assert.ok(!l.includes(bad), `the handoff line says ${bad}`)
})

// The two fixed lines only: next's own words around its archive line are pinned as prose (`next:after-handoff`).
test('handoff then next: the handoff line, then next step 4\'s archive line, reads neither closed nor asking', () => {
  const l = handoffLine(real.handoff)
  const a = archivePart(real.next)
  const c = closePart(real.next)
  assert.ok(l && a && c, 'no handoff line, or next step 4 has no archive part or close part')
  const t = `landing /Users/lachlants/repos/tools/thread-skill: landed\n\n${fill(l)}\n\n${fill(a)} ${fill(c)}`
  assert.equal(R(t).asks, false, 'the handoff line then next\'s archive line asks')
  assert.equal(R(t).endsClosed, false, 'the handoff line then next\'s archive line reads as a close')
})

// ---- 4. Prose and order pins ----------------------------------------------------------------------------
// Bullets (three-space `- ` items, continuation lines appended) from the line after `head` to the first blank
// line outside a fence.
function bulletsAfter(text, head) {
  const lines = text.split('\n')
  const at = lines.findIndex((l) => head.test(l))
  if (at < 0) return []
  const out = []
  let fence = false
  for (let i = at + 1; i < lines.length; i++) {
    const l = lines[i]
    if (FENCE.test(l)) fence = !fence
    else if (!fence && /^\s*$/.test(l)) break
    if (!fence && /^ {3}- /.test(l)) out.push(l)
    else if (out.length) out[out.length - 1] += `\n${l}`
  }
  return out
}
const CEREMONY = (t) => bulletsAfter(t, /^5\. \*\*Completion\.\*\*/)
const SIGNOFF = (t) => bulletsAfter(t, /^ {3}\*\*Completion awaiting sign-off \(ADR 0034\)\.\*\*/)
const CLOSE_LAST = '   - **Close out the associated thread, last:**'
const SIGNOFF_CLOSE = '   - `/thread:close`, last'
const SIGNOFF_COMMIT = "   - the heartbeat's `CronDelete`; then the vault commit"
const has = (s, list) => list.every((p) => collapse(s).includes(p))
const HALT_GUARD = (t) => lineOf(t, /^ {3}5\. \*\*Halt guard \(last\)\.\*\*/) ?? ''
const DONE_ROUTE = [
  '`done` → the completion ceremony already ran through its archive move',
  'run none of step 5 but its last bullet (no second Completion log, cron delete, `retire` or move), then that bullet, the thread close, as step 5 runs it, unless the Completion log recorded why the thread stays open',
  "the status line right after close's banner in the same message",
]
const GUARD = [
  '(the archive move below, the step before the last)',
  "runs none of these steps but the last, the thread close: the halt guard's `done` route",
  "a ceremony cut off between its archive commit and close's banner reads `done` too",
]
const STEP8_TAIL = "and a one-line discard note, then, only when a `Needs your call:` row printed, step 9's rule (3) question line as the report's last line, after the discard note."
const RAISED = 'When `create_thread` on Chorus returned `Raised (task_id: …)` (§ Success contract, step 2), the Stage starts the next Session'
const NOT_RAISED = 'that is § Fail closed, which never prints this line'
const FAIL_CLOSED = "On Chorus, never print § Build the handoff prompt's closing line (`Handed off. The next Session is starting on the Stage …`) without a `Raised (task_id: …)` result"

const RULES = [
  'Copy the banner exactly, never paraphrase it',
  'This thread is closed',
  'The one exception to step 9\'s "Nothing after this line"',
  'no text and no tool call',
  'same message',
  'Rules (1) to (3) cover the four closed banners above; rule (4) covers the NOT-closed form',
  'Which way on the Needs your call row(s) above?',
  'Chorus ADR 0089 d2',
]
const OFFER = '`research not landed: <pointer>; say "land it" to file it`, never as a question (step 9, rule (3))'
const AFTER_HANDOFF = [
  "After this session's own handoff, next prints no step-2 summary and no open question",
  'it prints only its one line, or the menu when the pick is his, with no question outside that menu',
]
const LIFE = [
  'On the Stage', '`dismiss_task`', '`already_started_by_stage`', '`not_found`', 'from its own row',
  'once he says it is stopped, or that he wants the doc gone', 'Chorus ADR 0089 § Amended 2026-10-15',
]

function check(files) {
  const fails = []
  const s9 = STEP9(files.close)
  if (!has(s9, RULES)) fails.push('close:rules')
  // step 8 and rule (3) agree: the question line comes after the discard note, the report's last line
  if (!collapse(STEP8(files.close)).endsWith(STEP8_TAIL) || !collapse(s9).includes("the report's last line, just before the `---`"))
    fails.push('close:order')
  if (!(lineOf(s9, /^9\. /) ?? '').includes('(rule (2) below names its one exception)')) fails.push('close:intro')
  if (!collapse(STEP8(files.close)).includes(OFFER)) fails.push('close:offer')
  if (!has(EDGES(files.close), ['**On the Chorus Stage**', "step 9's rule (3) question line", 'leaves it unarchived'])) fails.push('close:edge')
  if (['never as a question (the banner stays last)', 'Close never asks:', 'Close never calls the question tool', 'never a question, never a fought hook']
    .some((old) => collapse(files.close).includes(old))) fails.push('close:asks')

  const hg = HALT_GUARD(files.execute)
  if (!has(hg, DONE_ROUTE) || collapse(hg).includes('run no part of step 5')) fails.push('execute:done')
  const cer = CEREMONY(files.execute)
  const guard = cer.find((b) => b.startsWith('   - **Idempotence guard (p19-14).**')) ?? ''
  if (!has(guard, GUARD) || guard.includes('(its last step below)')) fails.push('execute:guard')
  const at = (p) => cer.findIndex(p)
  const iClose = at((b) => b.startsWith(CLOSE_LAST))
  const iMove = at((b) => b.startsWith('   - Move the rollout note'))
  const iRetire = at((b) => b.includes('git-env-canary.py retire'))
  const iCron = at((b) => b.startsWith("   - Delete the rollout's `ROLLOUT-HEARTBEAT` cron"))
  if (iClose < 0 || iClose !== cer.length - 1 || [iMove, iRetire, iCron].some((i) => i < 0 || i > iClose) ||
    !has(cer[iClose], ['same message', 'with no tool call between them']) ||
    cer.some((b, i) => i !== iClose && b.includes('/thread:close'))) fails.push('execute:last')
  const log = cer.find((b) => b.startsWith('   - Append a `## Completion log`')) ?? ''
  if (!collapse(log).includes('When the associated thread stays open, the log also records why')) fails.push('execute:log')
  const so = SIGNOFF(files.execute)
  const jClose = so.findIndex((b) => b.startsWith(SIGNOFF_CLOSE))
  const jCommit = so.findIndex((b) => b.startsWith(SIGNOFF_COMMIT))
  if (jClose < 0 || jClose !== so.length - 1 || jCommit < 0 || jCommit > jClose ||
    !has(so[jClose], ['same message', 'with no tool call between them']) ||
    so.some((b, i) => i !== jClose && b.includes('/thread:close'))) fails.push('execute:signoff')
  if (!has(files.execute, [
    "At completion, in § 4.5 step 5's sign-off form and on the halt guard's `done` route (§ 4.5 step 1.5), the report prints before step 5's last bullet runs `/thread:close`",
    "on a turn that ran `/thread:close`, right after close's banner in the same message",
  ])) fails.push('execute:report')

  const post = (files.template.split('## Post-rollout')[1] ?? '').split('\n')
  const steps = post.filter((l) => /^\d+\. /.test(l))
  const t5 = steps.find((l) => l.startsWith('5. ')) ?? ''
  if (!t5.includes('Record here why any associated thread stays open') ||
    !(steps.at(-1) ?? '').startsWith('7. Close out any associated thread (run `/thread:close`), last') ||
    !(steps.at(-1) ?? '').includes("close's banner, then the lead's `ROLLOUT-STATUS:` line, end the session's last message (close step 9, rule (2))"))
    fails.push('template')

  const h = files.handoff
  const intro = lineOf(h, 'Every handoff produces two artefacts') ?? ''
  if (!intro.includes('Chorus starts the next Session from it at once; if it cannot, the card says why and waits as an offer') ||
    ['the listener Starts', 'not yet a live Session'].some((old) => h.includes(old))) fails.push('handoff:intro')
  const contract = section(h, /^## Success contract/) ?? ''
  const c2 = lineOf(contract, /^2\. /) ?? ''
  const c5 = slice(contract, /^5\. /, /^\S/) ?? ''
  if (!c2.includes('`Raised (task_id: …)`') || !collapse(c5).includes('On Chorus no directive is emitted')) fails.push('handoff:contract')
  const hosts = section(h, /^## Other hosts/) ?? ''
  if (!collapse(hosts).includes('on Chorus the `task_id` in its `Raised (task_id: …)` result')) fails.push('handoff:hosts')
  if (!has(BUILD(h), ["shown fenced below, printed bare as close's banners are", 'with nothing after it'])) fails.push('handoff:build')
  // the handoff's own output ends on the closing line, and § Next for this session runs after it
  const hl = h.split('\n')
  const iBuild = hl.indexOf('## Build the handoff prompt')
  const iNext = hl.indexOf('## Next for this session')
  const iHosts = hl.indexOf('## Other hosts')
  if (!has(BUILD(h), ['with nothing after it but § Next for this session']) || !(iBuild >= 0 && iBuild < iNext && iNext < iHosts) ||
    !collapse(section(h, /^## Next for this session$/) ?? '').includes("on Chorus that is § Build the handoff prompt's closing line"))
    fails.push('handoff:next')
  if (!has(BUILD(h), [RAISED, NOT_RAISED]) || !collapse(section(h, /^## Fail closed/) ?? '').includes(FAIL_CLOSED))
    fails.push('handoff:raised')
  if (!has(lineOf(h, '**Lifecycle.**') ?? '', LIFE)) fails.push('handoff:lifecycle')
  if (!collapse(section(files.lifecycle, /^## Withdrawn/) ?? '').includes('keeps its brief')) fails.push('lifecycle:withdrawn')
  if (!(lineOf(files.next, /^5\. \*\*Dispatch\.\*\*/) ?? '').includes('(plus the native task in Codex Desktop or a Chorus Session)')) fails.push('next')
  // after this session's own handoff, next prints no step-2 summary or open question, so the Turn asks nothing
  // outside next's menu; handoff § Build points at that rule
  const afterHandoff = lineOf(files.next, /^\s*- \*\*After this session's own handoff\*\*/) ?? ''
  if (!has(afterHandoff, AFTER_HANDOFF) || !has(BUILD(h), ["`next`, run after it, asks none outside its menu (next step 1, **After this session's own handoff**)"]))
    fails.push('next:after-handoff')
  return fails
}

const only = (name, files, want) => assert.deepEqual(check(files), want, `${name}: expected ${want}`)
const swap = (key, from, to) => {
  assert.ok(real[key].includes(from), `control setup: ${from.slice(0, 60)} not in ${key}`)
  return { ...real, [key]: real[key].replace(from, to) }
}
const lineStarting = (key, prefix) => {
  const l = real[key].split('\n').find((x) => x.startsWith(prefix))
  assert.ok(l, `control setup: no ${key} line starts ${prefix}`)
  return l
}

test('the real skill files pass every pin', () => {
  assert.deepEqual(check(real), [])
})

test('controls: close pins fail on their own mutation', () => {
  only('rules:paraphrase', swap('close', 'Copy the banner exactly, never paraphrase it', 'Copy the banner'), ['close:rules'])
  only('rules:exception', swap('close', 'The one exception to step 9\'s "Nothing after this line"', 'Also'), ['close:rules'])
  only('rules:question', swap('close', '`Which way on the Needs your call row(s) above?`', '`Which way?`'), ['close:rules'])
  only('intro', swap('close', ' (rule (2) below names its one exception)', ''), ['close:intro'])
  only('offer', swap('close', 'never as a question (step 9, rule (3))', 'as a question'), ['close:offer'])
  only('edge', swap('close', '- **On the Chorus Stage** →', '- **On the Stage** →'), ['close:edge'])
  only('asks', swap('close', 'never the question tool, never a fought hook', 'never a question, never a fought hook'), ['close:asks'])
  only('asks:stop', swap('close', 'A stop never calls the question tool', 'Close never calls the question tool'), ['close:asks'])
  // step 8 back to the order rule (3) contradicts: the question line before the discard note
  only('order', swap('close', "lines, and a one-line discard note, then, only when a `Needs your call:` row printed, step 9's rule (3) question line as the report's last line, after the discard note.",
    "lines (followed by step 9's rule (3) question line when there is one), and a one-line discard note."), ['close:order'])
})

test('controls: execute pins fail on their own mutation', () => {
  // (1) the close bullet back before CronDelete, as the old ceremony ran it
  const closeBullet = CEREMONY(real.execute).find((b) => b.startsWith(CLOSE_LAST))
  assert.ok(closeBullet, 'control setup: no close-last bullet')
  const cron = lineStarting('execute', "   - Delete the rollout's `ROLLOUT-HEARTBEAT` cron")
  const moved = real.execute.replace(`\n${closeBullet}`, '').replace(cron, `${closeBullet}\n${cron}`)
  only('last:order', { ...real, execute: moved }, ['execute:last'])
  // (2) the full ceremony's close bullet without 'with no tool call between them'
  only('last:tool', { ...real, execute: real.execute.replace(closeBullet, closeBullet.replace('with no tool call between them', 'with a tool call between them')) }, ['execute:last'])
  only('last:second', swap('execute', '   - Stamp `status: done` + `completed: <date>` on the rollout frontmatter.',
    '   - Stamp `status: done` + `completed: <date>` on the rollout frontmatter, then run `/thread:close`.'), ['execute:last'])
  only('log', swap('execute', 'When the associated thread stays open, the log also records why', 'The log'), ['execute:log'])
  const so = SIGNOFF(real.execute)
  const soClose = so.find((b) => b.startsWith(SIGNOFF_CLOSE))
  const soCommit = so.find((b) => b.startsWith(SIGNOFF_COMMIT))
  assert.ok(soClose && soCommit, 'control setup: no sign-off close or commit bullet')
  only('signoff:order', { ...real, execute: real.execute.replace(`${soCommit}\n${soClose}`, `${soClose}\n${soCommit}`) }, ['execute:signoff'])
  only('signoff:tool', { ...real, execute: real.execute.replace(soClose, soClose.replace('with no tool call between them', 'after a tool call')) }, ['execute:signoff'])
  only('report', swap('execute', "At completion, in § 4.5 step 5's sign-off form and on the halt guard's `done` route (§ 4.5 step 1.5), the report prints before", 'At completion the report prints before'), ['execute:report'])
  // the `done` route back to running no part of step 5: a ceremony cut off after its archive commit never closes
  only('done', swap('execute', 'run none of step 5 but its last bullet (no second Completion log, cron delete, `retire` or move), then that bullet, the thread close, as step 5 runs it, unless the Completion log recorded why the thread stays open (step 5\'s *Idempotence guard* says why it runs again)',
    'run no part of step 5 (no second Completion log, thread close, cron delete, `retire` or move)'), ['execute:done'])
  only('done:status', swap('execute', "and end the turn `state=done`, the status line right after close's banner in the same message;", 'and end the turn `state=done`;'), ['execute:done'])
  // the guard back to calling the archive move the ceremony's last step
  only('guard', swap('execute', '(the archive move below, the step before the last)', '(its last step below)'), ['execute:guard'])
  only('guard:why', swap('execute', "a ceremony cut off between its archive commit and close's banner reads `done` too", 'an archived ceremony is finished'), ['execute:guard'])
})

test('controls: template, handoff, lifecycle and next pins fail on their own mutation', () => {
  only('template:5', swap('template', 'Record here why any associated thread stays open', 'record here why any associated thread stays open'), ['template'])
  const t7 = lineStarting('template', '7. Close out any associated thread')
  only('template:last', swap('template', t7, `${t7}\n8. Tidy up.`), ['template'])
  only('template:status', swap('template', "close's banner, then the lead's `ROLLOUT-STATUS:` line, end the session's last message (close step 9, rule (2))",
    "close's banner ends the session's last message (close step 9)"), ['template'])
  only('handoff:intro', swap('handoff', 'Chorus starts the next Session from it at once', 'the listener Starts it'), ['handoff:intro'])
  only('handoff:contract', swap('handoff', 'On Chorus no directive is emitted', 'On Chorus the directive is emitted'), ['handoff:contract'])
  only('handoff:hosts', swap('handoff', 'on Chorus the `task_id` in its `Raised (task_id: …)` result', 'on Chorus its result'), ['handoff:hosts'])
  only('handoff:build', swap('handoff', "shown fenced below, printed bare as close's banners are", 'fenced'), ['handoff:build'])
  // the closing line unconditional on Chorus again, or § Fail closed silent about it
  only('handoff:raised', swap('handoff', 'When `create_thread` on Chorus returned `Raised (task_id: …)` (§ Success contract, step 2), the Stage', 'On Chorus the Stage'), ['handoff:raised'])
  only('handoff:raised:else', swap('handoff', NOT_RAISED, 'that is § Fail closed'), ['handoff:raised'])
  only('handoff:raised:fail', swap('handoff', FAIL_CLOSED, 'On Chorus, print the closing line'), ['handoff:raised'])
  only('handoff:lifecycle', swap('handoff', 'from its own row', 'from the card'), ['handoff:lifecycle'])
  only('handoff:next', swap('handoff', ' but § Next for this session', ''), ['handoff:next'])
  only('handoff:next:chorus', swap('handoff', "on Chorus that is § Build the handoff prompt's closing line", 'on Chorus it is the card'), ['handoff:next'])
  // the section moved above § Build: the handoff's own output would end after next, not before it
  const i = real.handoff.indexOf('## Next for this session\n')
  const j = real.handoff.indexOf('## Other hosts\n')
  assert.ok(i >= 0 && j > i, 'control setup: no § Next for this session to move')
  const moved = real.handoff.slice(0, i) + real.handoff.slice(j)
  only('handoff:next:order', { ...real, handoff: moved.replace('## Build the handoff prompt\n', `${real.handoff.slice(i, j)}## Build the handoff prompt\n`) }, ['handoff:next'])
  only('lifecycle', swap('lifecycle', 'keeps its brief', 'loses its brief'), ['lifecycle:withdrawn'])
  only('next', swap('next', '(plus the native task in Codex Desktop or a Chorus Session)', '(plus the native task in Codex Desktop)'), ['next'])
  // step 2's summary and its open question back after the handoff, or the menu no longer the only place it asks
  only('next:after-handoff', swap('next', "After this session's own handoff, next prints no step-2 summary and no open question", "After this session's own handoff, next prints its step-2 summary"), ['next:after-handoff'])
  only('next:after-handoff:menu', swap('next', ', with no question outside that menu', ''), ['next:after-handoff'])
  only('next:after-handoff:build', swap('handoff', "; `next`, run after it, asks none outside its menu (next step 1, **After this session's own handoff**)", ''), ['next:after-handoff'])
})

// ---- 5. Optional drift check against the real Python ---------------------------------------------------
const PY = String.raw`
import importlib.util, json, sys
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("summarise", sys.argv[1])
s = importlib.util.module_from_spec(spec)
spec.loader.exec_module(s)
out = []
for t in json.load(sys.stdin):
    st = s.wave_status(t); wc = s.wave_close(st, t)
    out.append({"endsClosed": s.ends_closed(t), "asks": s.asks(t), "status": st, "statusClose": list(wc) if wc else None})
print(json.dumps(out))
`

test('drift: the port reads every fixture exactly as Chorus does', { skip: !process.env.CHORUS_SRC }, () => {
  const src = path.join(process.env.CHORUS_SRC, 'summarise.py')
  assert.ok(fs.existsSync(src), `no ${src}`)
  const texts = [...corpus]
  assert.ok(texts.length >= 20, `the corpus holds ${texts.length} fixtures: run the whole file`)
  const r = spawnSync('python3', ['-I', '-B', '-c', PY, src], { input: JSON.stringify(texts), encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  const py = JSON.parse(r.stdout)
  texts.forEach((t, i) => assert.deepEqual(reading(t), py[i], `port and Chorus disagree on ${JSON.stringify(t)}`))
})

// A serial rollout's Leg (execute legs.md § Report, p24-3): each turn end read through the port, and legs.md's own
// table names the same Close for each. A Leg's line is a rollout lead's line for close step 9's rule (2).
test('a Leg\'s turn ends read through the port as legs.md § Report says', () => {
  const RO = 'demo-rollout-2026-10-20'
  const line = (k, state, reason) => `ROLLOUT-STATUS: ${RO} merged=${k}/7 running=0 state=${state}${reason ? ` reason="${reason}"` : ''}`
  const [bA, bB] = banners(real.close).map(fill)
  assert.ok(bA && bB, 'close step 9 has banners A and B')
  const LEG_REPORT = 'landing /Users/lachlants/repos/tools/demo: not landed: commit-only\nhand-over: started task_x'
  const manual = 'manual handoff:\n\n```\n/thread:execute [[' + RO + ']]\nLeg 2 of the serial chain; the brief is the rollout note\'s ## Leg log: /x\n```\n\ncx-demo from /Users/lachlants/repos/tools/demo'
  const cases = [
    ['handoff, successor started', closing(LEG_REPORT, `${bB}\n${line(5, 'done', 'handed off to Leg 2')}`), ['closed', '']],
    ['complete', closing(REPORT, `${bB}\n${line(7, 'done')}`), ['closed', '']],
    ['handoff, manual', closing(`${REPORT}\n${manual}`, `${bA}\n${line(5, 'halted', 'manual handoff: Leg 2 in cx-demo from /Users/lachlants/repos/tools/demo')}`),
      ['halted', cutOnAWord('manual handoff: Leg 2 in cx-demo from /Users/lachlants/repos/tools/demo', REASON_CHARS)]],
    ['Mid-Leg, review in flight', line(3, 'waiting', 'review in flight: [[t3]]'), ['nothing yet', '']],
    // ADR 0055: a Complete Leg waiting on its completion verify's --run or --wait.
    ['Complete, completion verify running', line(7, 'waiting', 'completion verify in flight'), ['nothing yet', '']],
    ['stuck', closing(REPORT, `${bA}\n${line(3, 'halted', 'awaiting you: 1 set aside')}`), ['halted', 'awaiting you: 1 set aside']],
  ]
  for (const [, text, want] of cases) assert.deepEqual(R(text).statusClose, want, text.slice(-160))
  assert.equal(R(cases[2][1]).asks, false, 'a manual hand-over asks nothing')
  assert.equal(R('Leg 2 reported: handed off to Leg 3').asks, false, 'a report from a later Leg is one statement line')
  assert.deepEqual(R(line(7, 'done')).statusClose, ['work to review', 'the rollout'], 'control: done with no banner')
  // legs.md § Report's table: the Chorus Close column names the same reading for each turn end.
  const table = (section(real.legs, /^## Report/) ?? '').split('\n').filter((l) => l.startsWith('| ') && !l.startsWith('| Turn end'))
  const close = Object.fromEntries(table.map((l) => l.split('|').map((c) => c.trim())).map((c) => [c[1], c[3]]))
  const word = { closed: '*closed*', 'nothing yet': '*nothing yet*', halted: 'demand' }
  for (const [turn, , want] of cases) {
    assert.ok(close[turn], `legs.md § Report has no row for ${turn}`)
    assert.ok(close[turn].startsWith(word[want[0]]), `legs.md § Report reads ${turn} as ${close[turn]}, the port as ${want[0]}`)
  }
})
