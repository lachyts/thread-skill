#!/usr/bin/env python3
"""arms.py — the weekly reading's arms: each drawn role's Opus and Fable arms side by side (p46-4, ADR 0079 d9). This
docstring is the one copy of its rules. Reads only; writes nothing.

python >= 3.9, stdlib only. skills/reflect/scripts/reflect.py's `span` loads it by path (as ARMS) and writes its block
into span.json as `arms`; reflect.py's `close` writes its `arms` line (line()), `decide` lists each ceiling it holds, and
the next span's agreement walk reads the line back. It is pure: its only I/O is loading run_record.py by path (RR:
verdict_key, arms_key, ARM_ROLES, ARMS_ROLES, ARMS_COUNT_KEYS), as grades.py does. Every vault, ladder and settings read
is span's, passed in as a value or a memoised callable:

    reading(records, since, until, *, read, arm_stamp, lead_stamp, hands_off, escapes, breaches, share, share_error,
            bounds, bounds_error, earlier, canon, built_in) -> block
    holds_row(block) -> bool                line(block, rid, since, until) -> the `arms` line's fields

records is span's whole read ({slug: [(ms, n, line)]}, every record's lines in time then file order, a --fold's role-call
lines included); since and until are ms; read the slugs span read this week (mode read); arm_stamp(task) a task note's
`arms:` stamp as {role: opus | fable | none}, or None (no key, or one that does not parse: span flags it);
lead_stamp(rollout) a rollout note's `arms: lead=` arm, or None; hands_off {rollout: {task: acts}}, each read rollout's
score.json handsOff.tasks (score.py's rule, read whole); escapes the Escape friction items of every span entry, read and
escapes-only; breaches the (rollout, Guardrail) pairs close counts (a read rollout whose breachCounts is true); share
ladder.toml's [share] table (or None: no ladder file, no table, or a refused ladder, whose reason is share_error);
bounds the [guardrails] bounds (score.py's guardrail_bounds of rollout-settings.py's resolve with no repo; bounds_error
names a refused settings file, read as the built-ins); earlier the `arms` lines of closed Reflections in file order,
never this Reflection's own; canon the slug rule every join goes through (escapes.py's _canon); built_in the built-in
ladder's rung names (ladder.py's BUILT_IN), bottom first.

The roles. ARMS_ROLES: the drawn roles (master-review, builder, investigator: run_record's ARM_ROLES) and a rollout's
lead. A task has a drawn role when its stamp names it or a role-call line of it carries it; a task with neither (begun
before the draw, or never dispatched) has every drawn role, in no arm. Planning has no arm: it gets a before and after
(Plans, below), never a comparison.

Row units. Each row is placed by its own time and held to [since, until]:
- a call: a (runId, role) pair of role-call lines (run_record's role-call; a resume keeps its runId, so a pair holds one
  line per journal segment, deduped on (runId, startTime, role)). It is in the window when any of its segment lines has
  a startTime there, never by ts, which is the fold's. Its arm, model, climbs and fableRung are its latest in-window
  segment's, and fellBack holds when any in-window segment holds it;
- a review: a review-verdict line by its ts. The lines up to until are deduped once by RR.verdict_key, the first line
  per key (by time, then record) kept, as score.py keeps them; firstApprove and firstChanges count each task's round-1
  verdict, its earliest in the window, so a round 1 before since gives the task no first verdict this week;
- a landed task: placed by its FIRST `merged` line across every record up to until, in the record that holds it (the
  task's landing rollout), as score.py's hands_off places a landing, never by score.py's landed_from (the latest line).
  It counts when that line is in the window, and a later re-merge, in its own record or another, never counts again;
- an Escape: the sweep's item (reflect.py's friction), by its evidence date: only items whose inWindow is true (the
  sweep's Span.in_window over its `at`) are taken. The task's landing never places one. For the lead an Escape is
  credited to the task's landing rollout (above), never to the item's `rollout`: the sweep credits a task landed in two
  records to the later one;
- a plan task: a task, by its first slot-taken across every record up to until;
- a plan rejection: a set-aside with stage plan and reasonClass plan-rejected, by its ts; each line counts once.

Attributes, read wider. They place no row and add nothing to any other window's sums:
- a task's arm for a drawn role: its note's `arms:` stamp, else the `arm` on its role-call lines of that role up to
  until (the latest line carrying one; lines of the role with none read `none`). When the two disagree the record
  wins, and flags names the task;
- a task's exclusion, read from every role-call line of the task up to until, the window's outside included:
  fableRung on any line leaves it out of every role, the lead's included (a Fable-rung climb runs every role on Fable);
  else fellBack on a line leaves it out of that line's role only (roles draw on their own: ADR 0079 decision 3);
- a rollout's lead arm: its note's `arms: lead=` stamp (none without one). A landed task and an Escape are credited to
  the lead arm of the task's landing rollout, a review and a call to that of the record that holds the line;
- a landed task's Hands-off: its acts in its landing rollout's score.json `handsOff.tasks` (score.py's rule: no act
  from the run's start to its first merge in the score's window, read whole). A missing score, or one that does not
  list the task, counts in handsOffUnknown, out of the rate;
- a landed task's tokens: every role-call segment line of the task up to until, all roles, over its whole life (before
  since included), summed per (runId, role) by run_record's reader rule. roleTokens is the role's own share (null for
  the lead). A task with a tokensPartial line, or with no role-call line, is left out of tokens and counted in
  tokensLeftOut;
- a plan task's side and model (Plans, below);
- plans.toDate: the plan rows over every record's whole life up to until.

Population notes. escapesPerLanded divides this week's Escapes, which fall on tasks of any landing age, by this week's
landed tasks, as score.py's Quality is read against the week. The week's per100 may count a rejection on a task whose
first Slot fell in an earlier week. tokensPerMerge is the whole-life tokens of the arm's landed tasks with tokens read
over how many there are (tokenTasks): both sides hold the same tasks.

Per role (ARMS_ROLES): `opus` and `fable` each hold landed, handsOff, handsOffUnknown, handsOffRate (handsOff over
landed less handsOffUnknown, to 4 places; null at 0), firstApprove, firstChanges, reviewRounds, reviewedTasks, escapes
(the distinct tasks with an in-window Escape: escapes.py counts a task with any evidence once), escapesPerLanded
(escapes over landed, to 4 places; null with nothing landed), climbs (summed over the arm's calls; a Fable arm's are
recorded no-ops, ADR 0079 decision 4), calls, tokens, roleTokens, tokenTasks, tokensLeftOut and tokensPerMerge (to 1
place; null with no token task). The lead's calls are every role's calls in its rollouts. `excluded` {fellBack,
fableRung, none} counts the distinct tasks with an in-window row of the role that sit out of both arms. Then verdict,
signal, direction, from, to, kid, agreement, agreedWith (the agreeing Reflections' ids), held, caution, item, ready,
breached (the Guardrails read below) and rollouts (the read rollouts whose rows fed an arm, sorted).

Verdict, on ADR 0037's two headlines alone (declared heuristics: MIN_LANDED 3 per arm, STEP 10 points, AGREE 3 as in ADR
0037 d5), compared exactly (as fractions, never the rounded rates):
- thin: either arm has fewer than MIN_LANDED landed, or a null Hands-off rate;
- win: Fable's Hands-off rate at least Opus's and its escapesPerLanded at most Opus's, one of the two strictly better;
- loss: the mirror of a win;
- trade: Fable strictly better on one and strictly worse on the other; its signal is trade-handsOff or trade-quality,
  after Fable's better headline;
- even: both equal.
signal is the verdict's (win, loss, or the trade's), null when thin or even; direction +1 for a win, -1 for a loss, and
+1 for a trade (posed as a widening: a yes widens, a no keeps).

Proposal. from = round(100 x share[role]), the role's Fable ceiling in percent. With no ladder file, a refused ladder,
no [share] table, or the role absent from it, from is null and held "no Fable ceiling for <role> (ladder.toml [share])";
only a refused ladder adds a flag. to = from + STEP x direction; outside [0, 100] there is no proposal (held "at the
edge"). kid = RR.arms_key(role, signal). agreement is run_record's arms Agreement rule: 1 for this week, then earlier's
lines newest first, a line with the role absent or thin skipped, the same signal at the same from adding 1, anything
else ending the walk.

Hold order, one rule, in this order (every listed item is item "ceiling", a decision-task line; nothing here or in any
writer lands a ceiling: the session deciding the task applies a yes, until p46-10):
1. thin or even: no proposal (held says which);
2. agreement under AGREE: held "agreement <n> of 3", no item;
3. a trade: held "a trade (gains <h>, costs <q>): Lachy decides", item;
4. a widening while a Guardrail is breached: held "a Guardrail is breached (<which>)", no item; step 17 reports it;
5. a narrowing while a Guardrail is breached: caution "risks <which>: a Guardrail against a Guardrail" and held "a
   caution: Lachy decides", item (as score.py's lowers);
6. otherwise ready: held READY_HELD, item.
A from that is null or at the edge stops at step 1's place, after thin and even.

Guardrails read. Tokens per merge in the direction's risk: a widening is breached when Fable's exceeds Opus's by more
than the `tokens_per_merge_pct` bound (built-in 25), or when either is null, so it fails closed; a narrowing is
breached only when Opus's exceeds Fable's by more than the bound. And every read rollout this week with breachCounts
true and a non-empty breached list (the pairs close counts), whichever role.

Plans (no arm; a before and after). The split is the earliest planner role-call segment, across every record up to
until, whose model is fable and which carries no fableRung (null with none): a planner call on the all-Fable top rung
climbs with the rung (ADR 0079 decisions 1 and 10), so it never places the split. A plan task is `before` when its first
slot-taken is earlier than the split (every task while it is null), else `after`. Both sides count every task with a
first slot-taken, planned or not: a task with no planner role-call (no plan gate, run before p46-2, or not folded yet)
counts on its side. Before, a task's plan model is its first slot-taken's settings.rung, else the bottom rung; left out
and counted on their own: onFable (any planner call of the task asked fable: a Fable-rung climb, or a replan after the
split), then leftOut (a rung that is no name in built_in: opus-high and opus-xhigh, every rung a live ladder named
before p46-7 wrote a plan key; flagged). After, its plan model is its planner role-calls'; left out: fellBack (any
planner call fell back), then onOpus (any planner call asked opus). Only those tasks leave, so both sides count the
same kind of task. A left-out task's rejections leave with it, and a rejection takes its task's side (one on a task
with no slot-taken is flagged and placed nowhere). per100 = round(100 x rejected / tasks, 1), null at 0 tasks. plans:
{split, week {before, after}, toDate {before, after}, note}: before {tasks, rejected, per100, leftOut, onFable}, after
{tasks, rejected, per100, fellBack, onOpus}; note is PLANS_NOTE.

Fable calls by kind: the in-window calls, each counted once, in this order: fableRung (its latest in-window segment on
the Fable rung), plans (a planner or plan-judge call that asked fable), each drawn role (a call whose arm is fable),
other (any other call that asked fable: an integrator on fable, a role on its own [role] model); then firstReviewer,
null until p52-2 (ADR 0081's first reviewer), and leads (the read rollouts stamped lead=fable). A call that fell back
counts only in fellBack {calls, byKind, line}, by the kind it would have counted under; line is FELL_BACK_LINE, written
only when calls is above 0.

Rows for the window check (reflect.py's window_flags): tasks[] (landedAt), calls[] (startTime, a UTC Z stamp),
reviews[] (at), escapes[] (at, with inWindow), planTasks[] (at) and rejections[] (at), the week's rows alone. flags and
cannotShow are promoted into span's only when the block holds a row. The block holds a row (holds_row) when a role has
an opus or fable count above 0, a fellBack or fableRung exclusion, a Fable call or a fell-back one (fableCalls, leads
among them), or a non-null split: an empty week, an all-none week and a plans-before-only week hold none, and close
writes no `arms` line for them.

line(): the `arms` line close writes (run_record's arms kind): reflection, since and until; roles, every role, each with
verdict and from, its to, signal, kid, agreement, held (cut to 300), item and ready when set, opus and fable cut to
ARMS_COUNT_KEYS, and excluded; plans with its counts (no per100 and no note); fableCalls; fellBack {calls, byKind}.

Output: {roles {<role>: ...}, plans, fableCalls, fellBack, tasks, calls, reviews, escapes, planTasks, rejections, notes
(the population notes above), bound (the tokens bound read), breaches, flags, cannotShow}.
"""
from __future__ import annotations

import datetime
import importlib.util
import os
import sys
from fractions import Fraction

sys.dont_write_bytecode = True

HERE = os.path.dirname(os.path.abspath(__file__))
SHARED = os.path.join(os.path.dirname(os.path.dirname(HERE)), "_shared", "scripts")


def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise ImportError("no loader for %s" % path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


RR = _load("thread_run_record", os.path.join(SHARED, "run_record.py"))

ROLES = RR.ARMS_ROLES
ARM_ROLES = RR.ARM_ROLES
LEAD = "lead"
ARMS = ("opus", "fable")
PLAN_ROLES = ("planner", "plan-judge")
FABLE_KINDS = RR.ARMS_FABLE_KINDS
MIN_LANDED = 3                  # a declared heuristic: landed tasks per arm before a verdict reads
STEP = 10                       # a ceiling moves this many points per agreed move
AGREE = 3                       # ADR 0037 d5: three Reflections agree
TOKENS_BOUND = "tokens_per_merge_pct"
TOKENS_BOUND_BUILT_IN = 25      # score.py's GUARDRAILS_BUILT_IN value, read when bounds carries none
P46_10 = "[[thread-skill-p46-10-an-agreed-fable-ceiling-lands-on-its-own]]"
READY_HELD = ("agreed by 3 Reflections (ADR 0037 d5); no writer lands a Fable ceiling until %s: Lachy decides" % P46_10)
PLANS_NOTE = "planning has no Opus arm: a before and after, not a comparison"
FELL_BACK_LINE = "%d Fable call(s) fell back to Opus: another Login with Fable room would have carried them"
STAT_KEYS = ("landed", "handsOff", "handsOffUnknown", "handsOffRate", "firstApprove", "firstChanges", "reviewRounds",
             "reviewedTasks", "escapes", "escapesPerLanded", "climbs", "calls", "tokens", "roleTokens", "tokenTasks",
             "tokensLeftOut", "tokensPerMerge")
NOTES = (
    "escapesPerLanded divides this week's Escapes, which fall on tasks of any landing age, by this week's landed tasks",
    "the week's per100 may count a rejection on a task whose first Slot fell in an earlier week",
    "tokensPerMerge is the whole-life tokens of an arm's landed tasks with tokens read over tokenTasks: both sides hold "
    "the same tasks",
)
CANNOT_SHOW = (
    "arms: the lead's own tokens and fall-backs are in no Run record line (the lead's model is Chorus's to record): the "
    "lead arm reads its tasks' calls and tokens",
    "arms: ADR 0081's first reviewer is no call kind until p52-2: fableCalls.firstReviewer is null",
    "arms: whether another Login had Fable room is no Run record line: the fell-back line counts the calls it would have "
    "carried, never the Login that would have",
)


def _fmt(ms):
    """An instant (ms) as run_record's UTC Z stamp."""
    dt = datetime.datetime.fromtimestamp(ms / 1000.0, tz=datetime.timezone.utc)
    return dt.strftime("%Y-%m-%dT%H:%M:%S.") + "%03dZ" % (dt.microsecond // 1000)


def _int0(v):
    return isinstance(v, int) and not isinstance(v, bool) and v >= 0


def _rate(num, den, places):
    return round(num / den, places) if den else None


def _new():
    return {"landed": 0, "handsOff": 0, "handsOffUnknown": 0, "firstApprove": 0, "firstChanges": 0, "reviewRounds": 0,
            "climbs": 0, "calls": 0, "tokens": 0, "roleTokens": 0, "tokenTasks": 0, "tokensLeftOut": 0}


def _lower(v):
    return v.lower() if isinstance(v, str) else ""


# ---- the verdict, the proposal and the hold order ---------------------------------------------------------------------

def _exact(s):
    """(Hands-off rate, escapes per landed) of an arm's counts as fractions, each None when it has no denominator."""
    den = s["landed"] - s["handsOffUnknown"]
    ho = Fraction(s["handsOff"], den) if den > 0 else None
    epl = Fraction(s["escapes"], s["landed"]) if s["landed"] > 0 else None
    return ho, epl


def verdict(o, f):
    """(verdict, signal, direction) of a role's two arms (the docstring's Verdict)."""
    (o_ho, o_epl), (f_ho, f_epl) = _exact(o), _exact(f)
    if o["landed"] < MIN_LANDED or f["landed"] < MIN_LANDED or o_ho is None or f_ho is None:
        return "thin", None, 0
    ho = (f_ho > o_ho) - (f_ho < o_ho)          # +1: Fable's Hands-off rate is better
    q = (f_epl < o_epl) - (f_epl > o_epl)       # +1: Fable's Escapes per landed are fewer
    if ho == 0 and q == 0:
        return "even", None, 0
    if ho >= 0 and q >= 0:
        return "win", "win", 1
    if ho <= 0 and q <= 0:
        return "loss", "loss", -1
    return "trade", "trade-handsOff" if ho > 0 else "trade-quality", 1


def agreement(earlier, role, signal, frm):
    """(agreement, the agreeing Reflections' ids newest first): run_record's arms Agreement rule."""
    n, rids = 1, []
    for d in reversed(list(earlier)):
        roles = d.get("roles") if isinstance(d, dict) else None
        r = roles.get(role) if isinstance(roles, dict) else None
        if not isinstance(r, dict) or r.get("verdict") == "thin":
            continue
        same = r.get("signal") == signal and isinstance(r.get("from"), int) and not isinstance(r.get("from"), bool) \
            and r.get("from") == frm
        if not same:
            break
        n += 1
        rids.append(d.get("reflection"))
    return n, rids


def _tpm(s):
    return Fraction(s["tokens"], s["tokenTasks"]) if s["tokenTasks"] else None


def guardrails(direction, o, f, breaches, bound):
    """The Guardrails a move reads (the docstring's Guardrails read): the rollouts' breaches, then tokens per merge."""
    out = ["[[%s]] %s" % (r, g) for r, g in sorted(breaches)]
    po, pf = _tpm(o), _tpm(f)
    b = Fraction(str(bound))
    if direction > 0:
        if po is None or pf is None:
            out.append("tokens per merge unknown on an arm: a widening fails closed")
        elif pf * 100 > po * (100 + b):
            out.append("tokens per merge: fable %s over opus %s by more than %s %%" % (round(float(pf), 1),
                                                                                       round(float(po), 1), bound))
    elif direction < 0 and po is not None and pf is not None and po * 100 > pf * (100 + b):
        out.append("tokens per merge: opus %s over fable %s by more than %s %%" % (round(float(po), 1), round(float(pf), 1),
                                                                                   bound))
    return out


def propose(role, o, f, frm, earlier, breaches, bound):
    """A role's verdict and proposal through the hold order (the docstring's Proposal and Hold order)."""
    v, signal, direction = verdict(o, f)
    out = {"verdict": v, "signal": signal, "direction": direction, "from": frm, "to": None, "kid": None,
           "agreement": None, "agreedWith": [], "held": None, "caution": "", "item": None, "ready": False,
           "breached": []}
    if v == "thin":
        out["held"] = "thin: fewer than %d landed on an arm, or no Hands-off rate (opus %d, fable %d)" % (
            MIN_LANDED, o["landed"], f["landed"])
        return out
    if v == "even":
        out["held"] = "even: the two arms read the same on both headlines"
        return out
    if frm is None:
        out["held"] = "no Fable ceiling for %s (ladder.toml [share])" % role
        return out
    to = frm + STEP * direction
    if not 0 <= to <= 100:
        out["held"] = "at the edge: a Fable ceiling of %d%% cannot move %s" % (frm, "up" if direction > 0 else "down")
        return out
    n, rids = agreement(earlier, role, signal, frm)
    breached = guardrails(direction, o, f, breaches, bound)
    out.update(to=to, kid=RR.arms_key(role, signal), agreement=n, agreedWith=rids, breached=breached)
    if n < AGREE:
        out["held"] = "agreement %d of %d" % (n, AGREE)
    elif v == "trade":
        gains = "handsOffRate" if signal == "trade-handsOff" else "quality"
        costs = "quality" if gains == "handsOffRate" else "handsOffRate"
        out.update(held="a trade (gains %s, costs %s): Lachy decides" % (gains, costs), item="ceiling")
    elif direction > 0 and breached:
        out["held"] = ("a Guardrail is breached (%s)" % "; ".join(breached))[:RR.ARMS_HELD]
    elif direction < 0 and breached:
        out.update(caution="risks %s: a Guardrail against a Guardrail" % "; ".join(breached),
                   held="a caution: Lachy decides", item="ceiling")
    else:
        out.update(ready=True, held=READY_HELD, item="ceiling")
    return out


# ---- the reading ------------------------------------------------------------------------------------------------------

def reading(records, since, until, *, read=(), arm_stamp=None, lead_stamp=None, hands_off=None, escapes=(),
            breaches=(), share=None, share_error=None, bounds=None, bounds_error=None, earlier=(), canon=None,
            built_in=()):
    """The arms block (the docstring's Output) over span's records and the values span passes in."""
    canon = canon or _lower
    arm_stamp = arm_stamp or (lambda _t: None)
    lead_stamp = lead_stamp or (lambda _r: None)
    hands_off = hands_off or {}
    read = set(read)
    flags = []
    if share_error:
        flags.append("arms: the ladder is refused (%s): no Fable ceiling is read" % share_error)
    if bounds_error:
        flags.append("arms: rollout-settings refused (%s): the built-in Guardrail bounds are read" % bounds_error)
    bound = (bounds or {}).get(TOKENS_BOUND, TOKENS_BOUND_BUILT_IN)
    if isinstance(bound, bool) or not isinstance(bound, (int, float)):
        bound = TOKENS_BOUND_BUILT_IN

    # one pass over every record up to until: role-call by its startTime, everything else by its ts
    calls, merges, first_slot, verdicts, rejections, segs_seen = {}, {}, {}, {}, [], set()
    for slug in sorted(records):
        for t, n, d in records[slug]:
            if not isinstance(d, dict):
                continue
            kind, task = d.get("kind"), d.get("task")
            if not isinstance(task, str) or not task:
                continue
            key = canon(task)
            if kind == "role-call":
                st, run = d.get("startTime"), d.get("runId")
                if not _int0(st) or st > until or not isinstance(run, str) or not run:
                    continue
                seg = (run, st, d.get("role"))
                if seg in segs_seen:
                    continue
                segs_seen.add(seg)
                c = calls.setdefault((run, d.get("role")), {"task": key, "rollout": slug, "role": d.get("role"), "segs": []})
                c["segs"].append((st, d))
                continue
            if t > until:
                continue
            if kind == "merged":
                if key not in merges or t < merges[key][0]:
                    merges[key] = (t, slug)
            elif kind == "slot-taken":
                if key not in first_slot or t < first_slot[key][0]:
                    first_slot[key] = (t, slug, d)
            elif kind == "review-verdict":
                vk = RR.verdict_key(dict(d, task=key))
                if vk not in verdicts or t < verdicts[vk][0]:
                    verdicts[vk] = (t, slug, key, d)
            elif kind == "set-aside" and d.get("stage") == "plan" and d.get("reasonClass") == "plan-rejected":
                rejections.append((t, slug, key))

    lines_of = {}   # task -> every role-call line of it up to until (deduped segments), whole life
    for c in calls.values():
        lines_of.setdefault(c["task"], []).extend(d for _st, d in c["segs"])

    stamps, disagree = {}, []

    def stamp(task):
        if task not in stamps:
            s = arm_stamp(task)
            stamps[task] = s if isinstance(s, dict) else None
        return stamps[task]

    def roles_of(task):
        s = stamp(task) or {}
        rs = {r for r in s if r in ARM_ROLES} | {d.get("role") for d in lines_of.get(task, []) if d.get("role") in ARM_ROLES}
        return rs or set(ARM_ROLES)

    arm_memo = {}

    def arm_of(task, role):
        if (task, role) in arm_memo:
            return arm_memo[(task, role)]
        s = stamp(task)
        st = s.get(role) if s else None
        mine = sorted((d for d in lines_of.get(task, []) if d.get("role") == role), key=lambda d: d["startTime"])
        rec = None
        if mine:
            armed = [d["arm"] for d in mine if d.get("arm") in ARMS]
            rec = armed[-1] if armed else "none"
        if rec is None:
            arm = st if st in ARMS else "none"
        else:
            if st is not None and st != rec:
                disagree.append("[[%s]] %s: stamp %s, record %s" % (task, role, st, rec))
            arm = rec
        arm_memo[(task, role)] = arm
        return arm

    lead_memo = {}

    def lead_arm(rollout):
        if rollout is None:
            return "none"
        if rollout not in lead_memo:
            a = lead_stamp(rollout)
            lead_memo[rollout] = a if a in ARMS else "none"
        return lead_memo[rollout]

    def exclusion(task, role):
        mine = lines_of.get(task, [])
        if any(d.get("fableRung") is True for d in mine):
            return "fableRung"
        if role != LEAD and any(d.get("fellBack") is True and d.get("role") == role for d in mine):
            return "fellBack"
        return None

    stats = {r: {a: _new() for a in ARMS} for r in ROLES}
    reviewed = {r: {a: set() for a in ARMS} for r in ROLES}
    escaped = {r: {a: set() for a in ARMS} for r in ROLES}
    excluded = {r: {k: set() for k in RR.ARMS_EXCLUDED} for r in ROLES}
    fed = {r: set() for r in ROLES}

    def place(role, task, rollout):
        """The arm a row of `task` feeds under `role` (rollout: the lead's), or None: out of both arms (counted in
        excluded) or not a row of the role at all."""
        if role != LEAD and role not in roles_of(task):
            return None
        why = exclusion(task, role)
        if why:
            excluded[role][why].add(task)
            return None
        arm = lead_arm(rollout) if role == LEAD else arm_of(task, role)
        if arm not in ARMS:
            excluded[role]["none"].add(task)
            return None
        return arm

    def task_tokens(task):
        mine = lines_of.get(task)
        if not mine or any(d.get("tokensPartial") is True for d in mine):
            return None
        by_role = {}
        for d in mine:
            if _int0(d.get("tokens")):
                by_role[d.get("role")] = by_role.get(d.get("role"), 0) + d["tokens"]
        return sum(by_role.values()), by_role

    # landed tasks: the first merge, in the window
    task_rows = []
    for task, (t, slug) in sorted(merges.items(), key=lambda kv: (kv[1][0], kv[0])):
        if not since <= t <= until:
            continue
        listed = hands_off.get(slug)
        acts = listed.get(task) if isinstance(listed, dict) else None
        hands = None if acts is None else not acts
        tok = task_tokens(task)
        row = {"task": task, "rollout": slug, "landedAt": _fmt(t), "handsOff": hands,
               "tokens": tok[0] if tok else None, "arms": {}}
        for role in ROLES:
            arm = place(role, task, slug)
            row["arms"][role] = arm if arm else (exclusion(task, role) or ("none" if role == LEAD or role in roles_of(task)
                                                                           else None))
            if arm is None:
                continue
            s = stats[role][arm]
            s["landed"] += 1
            if hands is None:
                s["handsOffUnknown"] += 1
            elif hands:
                s["handsOff"] += 1
            if tok is None:
                s["tokensLeftOut"] += 1
            else:
                s["tokens"] += tok[0]
                s["tokenTasks"] += 1
                s["roleTokens"] += tok[1].get(role, 0)
            fed[role].add(slug)
        task_rows.append(row)

    # calls: in the window by any segment's startTime; the latest in-window segment speaks for the call
    call_rows, fable_calls, fell = [], {k: 0 for k in FABLE_KINDS}, {k: 0 for k in FABLE_KINDS}
    for (run, role), c in sorted(calls.items(), key=lambda kv: (min(st for st, _d in kv[1]["segs"]), kv[0][0], str(kv[0][1]))):
        inside = [(st, d) for st, d in c["segs"] if since <= st <= until]
        if not inside:
            continue
        st, last = max(inside, key=lambda x: x[0])
        fell_back = any(d.get("fellBack") is True for _s, d in inside)
        rung = last.get("fableRung") is True
        climbs = last.get("climbs") if _int0(last.get("climbs")) else 0
        model, arm = last.get("model"), last.get("arm")
        if rung:
            kind = "fableRung"
        elif role in PLAN_ROLES and model == "fable":
            kind = "plans"
        elif role in ARM_ROLES and arm == "fable":
            kind = role
        elif model == "fable" or fell_back:
            kind = "other"
        else:
            kind = None
        if kind is not None:
            (fell if fell_back else fable_calls)[kind] += 1
        call_rows.append({"runId": run, "role": role, "task": c["task"], "rollout": c["rollout"], "startTime": _fmt(st),
                          "model": model, "arm": arm if arm in ARMS else None, "climbs": climbs, "fellBack": fell_back,
                          "fableRung": rung, "fable": kind})
        for r in ROLES:
            if r != LEAD and r != role:
                continue
            a = place(r, c["task"], c["rollout"] if r == LEAD else None)
            if a is None:
                continue
            stats[r][a]["calls"] += 1
            stats[r][a]["climbs"] += climbs
            fed[r].add(c["rollout"])

    # reviews: deduped up to until, in the window by ts; round 1's earliest in the window is the first verdict
    review_rows, first = [], {}
    for t, slug, task, d in sorted(verdicts.values(), key=lambda x: (x[0], x[1], x[2])):
        if not since <= t <= until:
            continue
        review_rows.append({"task": task, "rollout": slug, "round": d.get("round"), "verdict": d.get("verdict"),
                            "at": _fmt(t)})
        if d.get("round") == 1 and task not in first:
            first[task] = (slug, d.get("verdict"))
        for r in ROLES:
            a = place(r, task, slug)
            if a is None:
                continue
            stats[r][a]["reviewRounds"] += 1
            reviewed[r][a].add(task)
            fed[r].add(slug)
    for task, (slug, v) in sorted(first.items()):
        for r in ROLES:
            a = place(r, task, slug)
            if a is not None and v in ("approve", "changes"):
                stats[r][a]["firstApprove" if v == "approve" else "firstChanges"] += 1

    # Escapes: the sweep's in-window items; the lead's credited to the task's landing rollout
    escape_rows = []
    for x in escapes or ():
        if not isinstance(x, dict) or x.get("kind") != "escape" or x.get("inWindow") is not True:
            continue
        task = canon(x.get("task"))
        landing = merges[task][1] if task in merges else None
        escape_rows.append({"task": task, "rollout": landing, "source": x.get("source"), "at": x.get("at"),
                            "inWindow": True})
        for r in ROLES:
            a = place(r, task, landing)
            if a is None:
                continue
            escaped[r][a].add(task)
            fed[r].add(landing or x.get("rollout"))

    # the roles: counts, rates, verdict, proposal
    pct = {}
    if isinstance(share, dict):
        for r, v in share.items():
            if isinstance(v, (int, float)) and not isinstance(v, bool):
                pct[r] = int(round(100 * v))
    roles_out = {}
    for r in ROLES:
        arms = {}
        for a in ARMS:
            s = stats[r][a]
            s["reviewedTasks"] = len(reviewed[r][a])
            s["escapes"] = len(escaped[r][a])
            out = {k: s.get(k) for k in STAT_KEYS}
            out["handsOffRate"] = _rate(s["handsOff"], s["landed"] - s["handsOffUnknown"], 4)
            out["escapesPerLanded"] = _rate(s["escapes"], s["landed"], 4)
            out["tokensPerMerge"] = _rate(s["tokens"], s["tokenTasks"], 1)
            if r == LEAD:
                out["roleTokens"] = None
            arms[a] = out
        prop = propose(r, stats[r]["opus"], stats[r]["fable"], pct.get(r), earlier, breaches, bound)
        roles_out[r] = dict({"opus": arms["opus"], "fable": arms["fable"],
                             "excluded": {k: len(excluded[r][k]) for k in RR.ARMS_EXCLUDED}},
                            **prop, rollouts=sorted(x for x in fed[r] if x in read))

    plans, plan_rows, rejection_rows, plan_flags = _plans(calls, lines_of, first_slot, rejections, since, until,
                                                          list(built_in))
    flags.extend(plan_flags)
    for line in disagree:
        flags.append("arms: a stamp the record overrides: %s" % line)
    leads = sum(1 for x in sorted(read) if lead_arm(x) == "fable")
    fable_out = dict(fable_calls, firstReviewer=None, leads=leads)
    fell_n = sum(fell.values())
    return {
        "roles": roles_out, "plans": plans, "fableCalls": fable_out,
        "fellBack": {"calls": fell_n, "byKind": fell, "line": FELL_BACK_LINE % fell_n if fell_n else None},
        "tasks": task_rows, "calls": call_rows, "reviews": review_rows, "escapes": escape_rows,
        "planTasks": plan_rows, "rejections": rejection_rows, "notes": list(NOTES), "bound": bound,
        "breaches": ["[[%s]] %s" % (r, g) for r, g in sorted(breaches)], "flags": flags, "cannotShow": list(CANNOT_SHOW),
    }


def _plans(calls, lines_of, first_slot, rejections, since, until, built_in):
    """(plans, planTasks rows, rejections rows, flags): the docstring's Plans."""
    split = None
    for c in calls.values():
        if c["role"] != "planner":
            continue
        for st, d in c["segs"]:
            if d.get("model") == "fable" and d.get("fableRung") is not True and (split is None or st < split):
                split = st
    bottom = built_in[0] if built_in else None
    sides, left_rungs = {}, []
    for task, (t, slug, d) in first_slot.items():
        planner = [x for x in lines_of.get(task, []) if x.get("role") == "planner"]
        side = "before" if split is None or t < split else "after"
        why, model = None, None
        if side == "before":
            settings = d.get("settings") if isinstance(d.get("settings"), dict) else {}
            rung = settings.get("rung") if isinstance(settings.get("rung"), str) and settings.get("rung") else bottom
            model = rung
            if any(x.get("model") == "fable" for x in planner):
                why = "onFable"
            elif rung not in built_in:
                why = "leftOut"
                left_rungs.append("%s (%s)" % (task, rung))
        else:
            models = sorted({x.get("model") for x in planner if isinstance(x.get("model"), str)})
            model = "/".join(models) or None
            if any(x.get("fellBack") is True for x in planner):
                why = "fellBack"
            elif "opus" in models:
                why = "onOpus"
        sides[task] = (side, why, t, slug, model)

    def count(tasks, rejected):
        out = {"before": {"tasks": 0, "rejected": 0, "per100": None, "leftOut": 0, "onFable": 0},
               "after": {"tasks": 0, "rejected": 0, "per100": None, "fellBack": 0, "onOpus": 0}}
        for task in tasks:
            side, why = sides[task][0], sides[task][1]
            out[side][why or "tasks"] += 1
        for _t, _slug, task in rejected:
            if task in sides and sides[task][1] is None:
                out[sides[task][0]]["rejected"] += 1
        for part in out.values():
            part["per100"] = round(100.0 * part["rejected"] / part["tasks"], 1) if part["tasks"] else None
        return out

    week_tasks = sorted(task for task, x in sides.items() if since <= x[2] <= until)
    week_rej = [x for x in rejections if since <= x[0] <= until]
    flags = []
    if left_rungs:
        flags.append("arms: plans: %d task(s) left out of the before side, a first Slot on a rung the built-in ladder "
                     "does not name: %s" % (len(left_rungs), ", ".join(sorted(left_rungs)[:10])))
    lost = sorted({task for _t, _s, task in rejections if task not in sides})
    if lost:
        flags.append("arms: plans: %d plan rejection(s) on a task with no slot-taken: placed on no side: %s"
                     % (len(lost), ", ".join(lost[:10])))
    plan_rows = [{"task": task, "rollout": sides[task][3], "at": _fmt(sides[task][2]), "side": sides[task][0],
                  "model": sides[task][4], "leftOut": sides[task][1]} for task in
                 sorted(week_tasks, key=lambda x: (sides[x][2], x))]
    rejection_rows = [{"task": task, "rollout": slug, "at": _fmt(t), "side": sides[task][0] if task in sides else None,
                       "counted": task in sides and sides[task][1] is None} for t, slug, task in sorted(week_rej)]
    plans = {"split": _fmt(split) if split is not None else None, "week": count(week_tasks, week_rej),
             "toDate": count(sorted(sides), rejections), "note": PLANS_NOTE}
    return plans, plan_rows, rejection_rows, flags


# ---- the line close writes, and whether one is due ----------------------------------------------------------------------

def holds_row(block):
    """Whether the arms block holds a row (the docstring's Rows): close writes the `arms` line only then."""
    if not isinstance(block, dict):
        return False
    for r in (block.get("roles") or {}).values():
        if not isinstance(r, dict):
            continue
        for a in ARMS:
            if any(_int0(v) and v > 0 for k, v in (r.get(a) or {}).items() if k in RR.ARMS_COUNT_KEYS):
                return True
        ex = r.get("excluded") or {}
        if (_int0(ex.get("fellBack")) and ex["fellBack"] > 0) or (_int0(ex.get("fableRung")) and ex["fableRung"] > 0):
            return True
    calls = block.get("fableCalls") or {}
    if any(_int0(v) and v > 0 for v in calls.values()):
        return True
    if _int0((block.get("fellBack") or {}).get("calls")) and block["fellBack"]["calls"] > 0:
        return True
    return (block.get("plans") or {}).get("split") is not None


def line(block, rid, since, until):
    """The `arms` line's fields (run_record's arms kind) for the Reflection `rid` over [since, until] (UTC Z stamps)."""
    roles = {}
    for r in ROLES:
        x = (block.get("roles") or {}).get(r)
        if not isinstance(x, dict):
            continue
        e = {"verdict": x["verdict"], "from": x.get("from")}
        for k in ("to", "signal", "kid", "agreement"):
            if x.get(k) is not None:
                e[k] = x[k]
        if x.get("held"):
            e["held"] = str(x["held"])[:RR.ARMS_HELD]
        if x.get("item"):
            e["item"] = x["item"]
        if x.get("ready") is True:
            e["ready"] = True
        for a in ARMS:
            e[a] = {k: x[a][k] for k in RR.ARMS_COUNT_KEYS}
        e["excluded"] = {k: x["excluded"][k] for k in RR.ARMS_EXCLUDED}
        roles[r] = e
    fields = {"reflection": rid, "since": since, "until": until, "roles": roles}
    plans = block.get("plans")
    if isinstance(plans, dict):
        fields["plans"] = {"split": plans.get("split")}
        for part in ("week", "toDate"):
            fields["plans"][part] = {side: {k: plans[part][side][k] for k in keys}
                                     for side, keys in RR.ARMS_PLAN_SIDES.items()}
    if isinstance(block.get("fableCalls"), dict):
        fields["fableCalls"] = dict(block["fableCalls"])
    fb = block.get("fellBack")
    if isinstance(fb, dict):
        fields["fellBack"] = {"calls": fb.get("calls", 0), "byKind": dict(fb.get("byKind") or {})}
    return fields
