#!/usr/bin/env python3
"""land-carrier.py — the landing carrier (ADR 0078 d2): every open `landing` PR, and every PR on a land.sh-named
`close/` branch, keeps moving until it merges, with no one touching it.

    python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/land-carrier.py run [--state F] [--now ISO] [--every MIN]
        [--deadline S] [--settle-wait S] [--dry-run]
    python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/land-carrier.py stuck [--state F] [--now ISO]
    python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/land-carrier.py marker --login L < comments.json

The Primary refresh's launchd job runs `run` at the end of every installed pass (primary-refresh.py `_carrier`), and
the carrier paces itself (--every). This docstring is the one copy of every rule below.

Runtime. Stdlib only, python >= 3.9. background_job.py (BJ) is loaded by `run` and `stuck` only, by path, from this
file's own directory (the bundle's copy beside it, or the checkout's), never the Primary's; it calls only BJ's frozen
state_path, read_state, write_state and kill_group. When it cannot be loaded the verb prints one stderr line,
`land-carrier: cannot load <path>: <why>`, and exits 1 having made no call. `marker` loads nothing but the stdlib, so a
broken BJ never breaks land.sh's withdrawal read. Every child gets one environment: the repo-local GIT_* variables
scrubbed (the two config channels kept), GIT_TERMINAL_PROMPT=0 GH_PROMPT_DISABLED=1 GCM_INTERACTIVE=never (land.sh's),
and gc.auto=0 and maintenance.auto=false appended through GIT_CONFIG_COUNT. Each child runs in its own session under a
bound: gh 30 s, a clone or fetch 90 s, a push 60 s, local git 60 s, the classifier 30 s, each cut to what is left of
the pass's deadline; one that reaches it has its process group stopped (BJ.kill_group, 5 s grace). TERM, INT and HUP
stop the live child's group and the pass exits 128 + N, landings.json as the last per-PR write left it.

run, one pass:
  1. The rate limit. The state is read; a `_pass.lastPass` less than --every minutes (15) old is exit 3, not due, with
     no call and no write (a lastPass in the future never blocks). Otherwise lastPass is written first, then the
     carrier's own `land-carrier-*` scratch dirs older than an hour are removed. --dry-run ignores --every.
  2. Discovery: `gh search prs --state open --author @me --label landing --limit 100 --json repository,number,url`,
     and the same with `--head close` and no label (a close-out whose optional label POST failed). The work list is
     their union by URL, plus every entry landings.json holds that they missed (search-index lag, and tombstones).
     Either search failing prints `search failed: <why>` once, when the spell opens (`_pass.searchFailedSince`), and
     ends the pass (exit 0); `stuck` lists the spell 24 h on, and a search that works clears it. An empty work list is
     a silent exit 0: the searches run first, so `gh api user` is never called for one.
  3. The login: `gh api user --jq .login`, the only author whose PRs and markers count (a failure is the search spell).
  4. Order and the deadline. PRs are handled least recently handled first (`handledAt`, new PRs first; among PRs
     handled in the same pass, the one that took its repo's bring-current slot longest ago, `slotAt`, so the slot
     rotates), so a pass cut by --deadline (200 s, under the 240 s the Primary refresh gives it) starts the next where
     it stopped. The deadline
     is checked before each PR. landings.json is written after each PR, and earlier where a record must precede its
     act: a changed binding (5f) before that PR's first GitHub write, a resolver push's `pushed` and `pushedFrom`
     before the push. A pass cut mid-PR keeps that PR's old entry unless it already wrote to GitHub.
  5. Read, per PR (Phase A).
     a. `GET repos/<slug>/pulls/<n>`. Merged: the entry is dropped. Closed: the tombstone rule (8), else dropped. In
        scope only when its labels hold `landing` or its head.ref is land.sh's close-out branch (land.sh's
        `branch="close/$cdate-$s-$sha12"` and its slug rule): `^close/YYYY-MM-DD-<a-z0-9, - inside, 1-40>-<12 hex>$`.
        Out of scope (an unlabelled `close/issue-12`): dropped after this one read, no write, no entry. Another
        author's PR, a head in another repo, or a head repo that is gone: skipped with an outcome and no write.
     b. `mergeable_state: unknown` is re-read up to 3 more times, --settle-wait (5 s) apart, within the deadline; still
        unknown, the state-dependent steps (6.3, 6.5, 6.6) skip this pass ("GitHub has not settled its
        mergeability"). This is no author change.
     c. The kind: `close-out` (the grammar, labelled or not); `own-unqueued` (a draft); `own-auto` (auto_merge set);
        else the comments are read (`GET repos/<slug>/issues/<n>/comments?per_page=100`, paginated) and M is the newest
        marker-class comment by the login (the `marker` grammar below): a `Landing queued (ADR 0078 d2): <S>` M is
        evaluated by the binding (5f), `own-marked` when it holds or advances, else `own-unqueued`. A labelled PR on a
        branch outside the grammar (`close/fix-thing`) takes these own-branch kinds.
     d. The head, for the 24 h clock only (the binding is 5f's). `gh_update_merge(H, X)`, the one predicate: H is a
        GitHub-made update-branch merge from X when `GET commits/<H>` shows parents [X, P2] and the committer email
        `noreply@github.com` (GitHub stamps it on the update-branch merges it makes, the carrier's, land.sh's and a
        person's button alike), and `GET compare/<base.ref>...<P2>` reads behind or identical (P2 on base). A head
        that differs from entry.head is a carrier change when it is entry.pushed (the carrier's resolver push) or
        gh_update_merge(head, entry.head) holds; anything else is an author change, which restarts movedAt and the
        rerun count. A failed read counts as a carrier change: a failed read never restarts the clock.
     e. The checks on head.sha, land.sh LAND_CHECKS_PY's classes (`GET commits/<sha>/check-runs?per_page=100` and
        `/status`, a check run's latest id per name): red (a failure), infra (cancelled, timed_out, startup_failure,
        action_required, stale, a status error), pending, green. No check on the head reads the base tip's: any there
        is pending, none is `none` (green). The class says only whether the head is green; 6.4 decides any rerun.
     f. The binding, its one copy. Let id be M's comment id and S its sha. A cleared binding stays cleared: when
        entry.markerId is id and entry.cleared, the PR is own-unqueued and nothing is evaluated, even when the head
        returns to S; only a new `--queue` (a new marker id) starts over. B, by one rule: entry.bound when
        entry.markerId is id and bound is set, else S. It holds when head.sha is B (markerId=id, bound=B,
        cleared=false). It advances to head.sha (the same fields, bound=head.sha) when head.sha is entry.pushed and
        entry.pushedFrom is B (the carrier's resolver push from B), or when gh_update_merge(head.sha, B) holds and the
        head's tree is the clean `git merge-tree --write-tree B P2` of the scratch clone (land.sh's protected
        update-branch before its marker, the carrier's own, and a person's Update branch button make that merge).
        Otherwise it is cleared (markerId=id, bound=null, cleared=true). A failed read (commits, compare, the clone,
        merge-tree) leaves it unevaluated this pass: not own-marked, nothing recorded. Each carrier hop (an
        update-branch, a resolver push) starts from a head 5f has just bound, so a chain is followed hop by hop, each
        next head checked against the last bound, never against S; the step 4 write keeps that bound on disk first.
  6. Act (Phase B): the first step that applies is taken. Every write first runs `python3 <dir>/landing-register.py
     check --slug <slug>` and goes ahead only on exit 0 (the decided "re-check the register before each push", for
     every write), and needs the repo's `permissions.push` (one `GET repos/<slug>` per repo per pass, which also gives
     `allow_auto_merge`).
     0. own-unqueued or a draft: no write ("left to its session").
     1. A superseded close-out: supersession (below): a `Superseded (ADR 0078 d2): …` comment, then `PATCH
        pulls/<n> state=closed`.
     2. A close-out with auto_merge null and allow_auto_merge not false: `gh pr merge <n> -R <slug> --auto --merge`.
        A refusal, or allow_auto_merge false, is not terminal: the steps below still run.
     3. dirty: the resolver (below), when this repo's bring-current slot is free. An ineligible PR gets no write and
        an outcome naming why; a dirty PR gets nothing else this pass.
     4. red or infra, nothing pending, fewer than 2 reruns for this head: the rerun rule (ADR 0069 and 0073 d4, as
        merge-task.sh applies them). Every non-pass completed check (pass: success, neutral, skipped) must be proven
        re-runnable, or nothing on the head is re-run. Each GitHub Actions run a check run names (app.slug
        github-actions, details_url `/actions/runs/<run>/job/<job>`) has its jobs read (`GET
        repos/<slug>/actions/runs/<run>/jobs?per_page=100`, the latest attempt), and each non-pass job is classed:
        cancelled is re-runnable with no classifier (a GitHub-side stop: the job's timeout-minutes, a person's cancel,
        a newer run in its concurrency group; merge-task's cancelled_required); failure, timed_out or startup_failure
        gives the steps that concluded failure, and a job with no failed step is genuine (merge-task's per-run guard:
        a hang or a timeout is never proven to be setup); anything else is genuine (action_required, stale, a check run
        that is no Actions job, any failed or errored status context, a details_url naming no run, a jobs read that
        fails, a run whose jobs show no non-pass job). Every collected step name, from every job on the head, goes once
        to `bash <skills>/execute/scripts/merge-task.sh --classify-steps`, which prints classify_failed_steps' verdict,
        the classifier merge-task.sh itself runs on a red required check's failed steps before its own
        rerun-failed-jobs; anything but `infra`, or no merge-task.sh, is genuine. Not the brief's classifier:
        reconcile-rollout.py `_merge_task_infra_stop` reads merge-task.sh's own stop-reason text (MERGE_TASK_INFRA,
        FAIL_CELL_RE; ADR 0069 d3's one reader of the GitHub-side cause) and never a CI step name, and the carrier holds
        failed step names, so it runs the one classifier that reads them. A genuine failure anywhere on the head beats
        cancellations everywhere else: `rerun-failed-jobs` re-runs a run's failed jobs with its cancelled ones, so one
        genuine job (a fail-fast matrix's one real failure, its siblings cancelled) means no run is re-run. All proven:
        `POST repos/<slug>/actions/runs/<run>/rerun-failed-jobs` once per affected run, one rerun of the head, at most
        2 per head. The outcome names the genuine jobs and their steps, or `rerun budget spent`.
     5. behind and green or none: `PUT pulls/<n>/update-branch -f expected_head_sha=<sha>` when the slot is free;
        `updatedFrom` records the head it was asked from (named in the outcome, read by no rule).
     6. clean or has_hooks, green or none: a close-out whose auto-merge is off gets `PUT pulls/<n>/merge -f
        merge_method=merge -f sha=<head.sha>`; own-marked the same with sha=<bound> (REST's --match-head-commit);
        own-auto, or a close-out whose auto-merge is on, no call: GitHub merges it with the method its session chose.
     7. Otherwise nothing: pending, blocked, or waiting its turn.
     The bring-current slot: at most one update-branch or resolver push per repo per pass, to the first PR in order
     that needs it. Under a strict up-to-date rule only one can win, so the rest spend no CI run a merge then stales.
  7. Stuck: now - movedAt >= 24 h marks the entry `stuck` and prints `<slug>#<n>: stuck: unmoved since <movedAt16>:
     <outcome>` once. movedAt is first sight or the last author change; the carrier's own update-branch, resolver push
     or rerun never moves it, so a PR caught in update-branch cycles is listed after a day.
  8. Tombstones. A PR closed as superseded by L keeps its entry (`supersededBy`) while L is open; L merged drops it; L
     closed unmerged reopens it (a register check, a comment, `PATCH state=open`; `reopened`). A reopen that fails
     flags it stuck until it is open again or merged.
  9. Output: one stdout line per act or transition only (update-branch requested, resolved and pushed, re-ran,
     auto-merge queued, merged, closed as superseded, reopened, became stuck, search failed); failures go to the
     entry's outcome, so a pass that does nothing prints nothing. Exit 0 for a pass, whatever it did; 3 not due (no
     call, no write); 1 when BJ cannot be loaded; 2 on usage. --dry-run makes reads only, prints `would …` lines and
     writes no state.

The scratch clone: one bare partial clone per repo per pass, made lazily by the first step that needs it
(supersession, the resolver, the binding's tree check), in a `land-carrier-*` mkdtemp removed at pass end. Not the
note's scratch worktree: the carrier has no checkout of most repos and never touches the Primary or a session's; a bare
`--filter=blob:none` clone fetches trees and only the blobs a step reads. `git clone --bare --filter=blob:none
--no-tags --single-branch --branch <base.ref> -c credential.helper= -c 'credential.helper=!gh auth git-credential' -c
core.hooksPath=/dev/null -c gc.auto=0 -c maintenance.auto=false https://github.com/<slug>.git <scratch>/r<i>.git`: the
helpers live in its config, so merge-tree's and cat-file's lazy blob fetches use them, the empty one clearing inherited
helpers first. Then `fetch origin +refs/heads/<head.ref>:refs/carrier/<n>`. Each tip is checked against the PR's base.sha
and head.sha: a tip that moved is "the PR moved during the pass", for the next pass.

The resolver (step 6.3), for close-out, own-auto and own-marked PRs. `git merge-tree --write-tree -z <head> <base>`:
exit 0 (GitHub said dirty, the merge is clean) is left to update-branch; exit 1 is parsed (the tree, `<mode> <oid>
<stage>\\t<path>` conflict entries, then each message's path count, paths, type and text). Eligible only when every
message's type is `Auto-merging` or `CONFLICT (contents)` and every conflicted path is close-out shaped (THREAD.md,
*/THREAD.md, a file directly under (*/)docs/handoffs/: land.sh closeout_shaped); any other type (modify/delete,
add/add, rename, binary) is not. A clean `Auto-merging` of a code path is accepted on purpose: GitHub's update-branch
makes that very merge, and the required checks run on the pushed merge before anything merges. Each conflicted path's
stage 1, 2 and 3 blobs go through `git merge-file -p --diff3 --marker-size=32 -L head -L base -L origin`, and each
hunk: an empty base section (both sides only add) keeps both sides, the newer side first (`git log -1 --format=%ct
<mb>..<side> -- <path>`; a tie puts base first); THREAD.md's front matter, each section one `last_touched: YYYY-MM-DD`
line, takes the later date; anything else is ineligible (`a conflict hunk in <path> rewrites lines`). Then
`hash-object -w`, `read-tree` and `update-index --cacheinfo` in a scratch index, `write-tree --missing-ok`,
`commit-tree -p <head> -p <base>` (`Merge <base.ref> into <head.ref> (landing carrier, ADR 0078 d2)`, the resolved
paths in its body; the global git identity), `pushed`/`pushedFrom` written, a register check, and `-c
core.hooksPath=/dev/null push origin <commit>:refs/heads/<head.ref>`, never forced.

Supersession (step 6.1): both P and L close-outs by the grammar (an own branch is session work, never closed). C is
P's non-merge commits in base..head, read in the scratch clone. P's lines are carried into a target when, for every
path P changes from its merge base: a deletion, the target lacks the path; an addition or modification, every
non-blank line it adds is in the target's file and every non-blank line it removes and does not re-add is absent from
it, THREAD.md's `last_touched:` counting as carried when the target's date is the same or later; a binary change never
is. Superseded by base: carried with target = base, and |C| = 1 (a commit stranded under a close-out keeps it open, so
the Primary converges). Superseded by a later close-out L (open, a higher number, the same base.ref, not superseded
this pass; newest first): carried with target = base ∪ L.head (a line in either; a path absent from both), and C less
its newest commit within base..L.head; the entry records `supersededBy`. The verdict is cached in entry.checked by
(base sha, P's head, the later close-outs' heads).

marker --login L: stdin is one or more concatenated JSON arrays of issue comments (`gh api --paginate`); the newest
comment by L (by id) whose first line starts with a marker prefix (`Landing queued (ADR 0078 d2): `, `Landing withdrawn
(ADR 0078 d2)`, `Landing held (ADR 0028 § 3)`) decides: `queued <S>` when it is `Landing queued (ADR 0078 d2): <S>`,
whatever S is, else `none`. Exit 2 on unreadable or empty JSON, or no --login. The one copy of the marker grammar:
land.sh's withdrawal calls this verb, and step 5c parses with the same code.

stuck: a read that writes nothing. One JSON line, {"state", "stuck": [{key, url, kind, movedAt, outcome}], "line"},
oldest first; `line` is `Landings: <key>: <outcome> (unmoved since <16>) · …`, or null. Due: an open entry 24 h after
movedAt (never one in the future), a tombstone flagged stuck, a search spell 24 h old (key `search`). Exit 0, 1 when BJ
cannot be loaded, 2 on usage. Consumers (the Stage's machinery-health read, /thread:status, any later reader) call this
verb, never the file.

State: ${XDG_STATE_HOME:-~/.local/state}/thread/landings.json (or --state), {"v": 1, "landings": {"<owner>/<name>#<n>":
entry, "_pass": {...}}}; an entry holds url, kind, since, movedAt, head, handledAt, outcome, updatedFrom, slotAt,
pushed, pushedFrom, rerunHead, reruns, markerId, bound, cleared, stuck, supersededBy, closedAt and checked. `_pass` is no entry:
it is the pass record (lastPass, searchFailedSince, searchFailedWhy), in the same map only because BJ.write_state writes
one key; an entry key always holds `#` and `_pass` never does. landings.json is the carrier's own. A corrupt file is one
WARN and is rewritten valid; an entry with no readable since is dropped with a WARN.
"""
import argparse
import importlib.util
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timedelta
from pathlib import Path

sys.dont_write_bytecode = True

HERE = Path(__file__).resolve().parent
SKILLS = HERE.parent.parent
BJ_FILE = HERE / "background_job.py"
REGISTER = HERE / "landing-register.py"
MERGE_TASK = SKILLS / "execute" / "scripts" / "merge-task.sh"
STATE_NAME = "landings.json"
STATE_KEY = "landings"
STATE_VERSION = 1
PASS = "_pass"
STUCK_AFTER = timedelta(hours=24)
LEFTOVER_AGE = 3600
GH_TIMEOUT = 30
CLONE_TIMEOUT = 90
PUSH_TIMEOUT = 60
GIT_TIMEOUT = 60
CLASSIFY_TIMEOUT = 30
KILL_GRACE = 5
SETTLE_TRIES = 3
RERUN_MAX = 2
SEARCH_LIMIT = 100
SIGNALS = (signal.SIGTERM, signal.SIGINT, signal.SIGHUP)
HEX40 = re.compile(r"^[0-9a-f]{40}$")
CLOSE_RE = re.compile(r"^close/[0-9]{4}-[0-9]{2}-[0-9]{2}-[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?-[0-9a-f]{12}$")
QUEUED = "Landing queued (ADR 0078 d2): "
WITHDRAWN = "Landing withdrawn (ADR 0078 d2)"
HELD = "Landing held (ADR 0028 § 3)"
MARKERS = (QUEUED, WITHDRAWN, HELD)
GITHUB_EMAIL = "noreply@github.com"
PASS_CONC = ("success", "neutral", "skipped")
INFRA_CONC = ("cancelled", "timed_out", "startup_failure", "action_required", "stale")
JOB_URL = re.compile(r"/actions/runs/([0-9]+)/job/([0-9]+)")
DATE_LINE = re.compile(r"^last_touched:[ \t]*([0-9]{4}-[0-9]{2}-[0-9]{2})[ \t]*$")
MARK = 32
OURS, BASE, SEP, THEIRS = "<" * MARK + " head", "|" * MARK + " base", "=" * MARK, ">" * MARK + " origin"
DROP = object()   # a handler's verdict: no entry for this PR
KEEP = object()   # a handler's verdict: leave the entry as it was

BJ = None
ENV = None
DEADLINE_AT = None


class _Signalled(BaseException):
    def __init__(self, signum):
        super().__init__(signum)
        self.signum = signum


class _Deadline(Exception):
    """The pass's deadline has passed: no further call starts."""


class GhError(Exception):
    """A gh call that failed, timed out or answered something unreadable."""


class CloneError(Exception):
    """The scratch clone could not be made, or a step in it failed."""


def _on_signal(signum, _frame):
    raise _Signalled(signum)


def _flat(s):
    return " ".join(str(s).split())


def _last(text, n=200):
    lines = [_flat(x) for x in str(text).splitlines() if x.strip()]
    return lines[-1][:n] if lines else ""


def _why(text, n=200):
    """A tool's reason: its last `fatal:`/`error:`/`gh:` line, else its last non-empty line."""
    lines = [_flat(x) for x in str(text).splitlines() if x.strip()]
    said = [x for x in lines if x.startswith(("fatal:", "error:", "gh:", "GraphQL:"))]
    return (said or lines or [""])[-1][:n]


def _parse_iso(s):
    if not isinstance(s, str) or not s:
        return None
    try:
        t = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None
    return t if t.tzinfo else t.astimezone()


def _parse_now(s):
    if not s:
        return datetime.now().astimezone()
    return _parse_iso(s)


def _env():
    """os.environ less the repo-local git vars, with land.sh's prompt rule and gc guard."""
    env = dict(os.environ)
    try:
        names = subprocess.run(["git", "rev-parse", "--local-env-vars"], capture_output=True, text=True,
                               timeout=GIT_TIMEOUT).stdout.split()
    except (OSError, subprocess.SubprocessError):
        names = []
    for n in names:
        if n not in ("GIT_CONFIG_COUNT", "GIT_CONFIG_PARAMETERS"):
            env.pop(n, None)
    env.update(GIT_TERMINAL_PROMPT="0", GH_PROMPT_DISABLED="1", GCM_INTERACTIVE="never")
    k = env.get("GIT_CONFIG_COUNT", "0")
    k = int(k) if k.isdigit() else 0
    env.update({f"GIT_CONFIG_KEY_{k}": "gc.auto", f"GIT_CONFIG_VALUE_{k}": "0",
                f"GIT_CONFIG_KEY_{k + 1}": "maintenance.auto", f"GIT_CONFIG_VALUE_{k + 1}": "false",
                "GIT_CONFIG_COUNT": str(k + 2)})
    return env


# ---- children: each in its own session, stopped with its whole group -------------------------------------------------

def _bound(t):
    """A call's bound: its own, cut to what is left of the pass's deadline; _Deadline once under a second is left."""
    if DEADLINE_AT is None:
        return t
    rem = DEADLINE_AT - time.monotonic()
    if rem < 1:
        raise _Deadline()
    return min(t, rem)


def _stop(p):
    mask = signal.pthread_sigmask(signal.SIG_BLOCK, SIGNALS)
    try:
        BJ.kill_group(p, KILL_GRACE, reap=5)
    finally:
        signal.pthread_sigmask(signal.SIG_SETMASK, mask)


def _run(argv, timeout, input=None, raw=False, env=None):
    """(rc, stdout, stderr, timed_out): the child in a new session; at its bound, or a signal, its group is stopped."""
    data = None if input is None else (input if isinstance(input, bytes) else input.encode("utf-8"))
    p = None
    timed_out = False
    mask = signal.pthread_sigmask(signal.SIG_BLOCK, SIGNALS)
    try:
        try:
            p = subprocess.Popen(argv, stdin=subprocess.DEVNULL if data is None else subprocess.PIPE,
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env or ENV,
                                 start_new_session=True,
                                 preexec_fn=lambda: signal.pthread_sigmask(signal.SIG_SETMASK, mask))
        except OSError as e:
            return 127, (b"" if raw else ""), str(e), False
        finally:
            signal.pthread_sigmask(signal.SIG_SETMASK, mask)
        try:
            out, err = p.communicate(input=data, timeout=timeout)
        except subprocess.TimeoutExpired:
            timed_out = True
            _stop(p)
            try:
                out, err = p.communicate(timeout=2)
            except (subprocess.TimeoutExpired, ValueError, OSError):
                out, err = b"", b""
    except BaseException:
        if p is not None:
            _stop(p)
        raise
    rc = p.returncode if p.returncode is not None else -signal.SIGKILL
    err_s = (err or b"").decode("utf-8", "replace").strip()
    if raw:
        return rc, out or b"", err_s, timed_out
    return rc, (out or b"").decode("utf-8", "replace").strip(), err_s, timed_out


def gh(*a, timeout=GH_TIMEOUT):
    t = _bound(timeout)
    rc, out, err, timed_out = _run(["gh", *a], t)
    if timed_out:
        raise GhError(f"gh ran past {t:.0f} s and was stopped")
    if rc != 0:
        raise GhError(_why(err or out) or f"gh exit {rc}")
    return out


def api_json(ep, paginate=False):
    out = gh("api", *(["--paginate"] if paginate else []), ep)
    try:
        return _pages(out) if paginate else json.loads(out)
    except ValueError:
        raise GhError(f"unreadable JSON from {ep.split('?')[0]}") from None


def _pages(text):
    """One or more concatenated JSON arrays (gh api --paginate) as one list; ValueError when unreadable or empty."""
    dec, i, out, seen = json.JSONDecoder(), 0, [], False
    while True:
        while i < len(text) and text[i].isspace():
            i += 1
        if i >= len(text):
            break
        v, i = dec.raw_decode(text, i)
        if not isinstance(v, list):
            raise ValueError("not an array")
        out.extend(v)
        seen = True
    if not seen:
        raise ValueError("no JSON")
    return out


def newest_marker(comments, login):
    """(id, S or None) for the newest marker-class comment by login, or None: the one copy of the marker grammar."""
    best = None
    for c in comments:
        if not isinstance(c, dict) or (c.get("user") or {}).get("login") != login:
            continue
        cid = c.get("id")
        first = str(c.get("body") or "").split("\n", 1)[0].rstrip("\r")
        if isinstance(cid, int) and first.startswith(MARKERS) and (best is None or cid > best[0]):
            best = (cid, first)
    if best is None:
        return None
    cid, first = best
    return (cid, first[len(QUEUED):].strip()) if first.startswith(QUEUED) else (cid, None)


def closeout_shaped(rel):
    """land.sh closeout_shaped: THREAD.md, */THREAD.md, or a file directly under (*/)docs/handoffs/."""
    if rel == "THREAD.md" or rel.endswith("/THREAD.md"):
        return True
    if rel.startswith("docs/handoffs/"):
        f = rel[len("docs/handoffs/"):]
    elif "/docs/handoffs/" in rel:
        f = rel.rsplit("/docs/handoffs/", 1)[1]
    else:
        return False
    return bool(f) and "/" not in f


def is_thread(rel):
    return rel == "THREAD.md" or rel.endswith("/THREAD.md")


def _date(line):
    m = DATE_LINE.match(line.rstrip("\r\n"))
    if not m:
        return None
    try:
        datetime.strptime(m.group(1), "%Y-%m-%d")
    except ValueError:
        return None
    return m.group(1)


# ---- the scratch clone --------------------------------------------------------------------------------------------------

class Clone:
    """One bare partial clone of a repo's base branch for this pass."""

    def __init__(self, ctx, slug, base_ref, base_sha):
        self.ctx, self.slug, self.base_ref = ctx, slug, base_ref
        self.dir = Path(ctx.scratch()) / f"r{len(ctx.clones)}.git"
        argv = ["git", "clone", "--bare", "--filter=blob:none", "--no-tags", "--single-branch", "--branch", base_ref,
                "-c", "credential.helper=", "-c", "credential.helper=!gh auth git-credential",
                "-c", "core.hooksPath=/dev/null", "-c", "gc.auto=0", "-c", "maintenance.auto=false",
                f"https://github.com/{slug}.git", str(self.dir)]
        t = _bound(CLONE_TIMEOUT)
        rc, _, err, timed_out = _run(argv, t)
        if timed_out:
            raise CloneError(f"the clone ran past {t:.0f} s and was stopped")
        if rc != 0:
            raise CloneError(f"the clone failed: {_why(err) or rc}")
        tip = self.rev(f"refs/heads/{base_ref}")
        if tip != base_sha:
            raise CloneError("the PR moved during the pass (its base)")
        self.heads = {}

    def git(self, *a, timeout=GIT_TIMEOUT, raw=False, input=None, env=None, ok=(0,)):
        t = _bound(timeout)
        rc, out, err, timed_out = _run(["git", "--git-dir", str(self.dir), *a], t, input=input, raw=raw,
                                       env=dict(ENV, **env) if env else None)
        if timed_out:
            raise CloneError(f"git {a[0]} ran past {t:.0f} s and was stopped")
        if rc not in ok:
            raise CloneError(f"git {a[0]} failed: {_why(err) or rc}")
        return (rc, out) if len(ok) > 1 else out

    def rev(self, ref):
        rc, out = self.git("rev-parse", "-q", "--verify", f"{ref}^{{commit}}", ok=(0, 1))
        return out if rc == 0 else ""

    def fetch_head(self, n, ref, sha):
        """The PR's head branch at refs/carrier/<n>, checked against the PR's head sha."""
        if self.heads.get(n) == sha:
            return
        self.git("fetch", "origin", f"+refs/heads/{ref}:refs/carrier/{n}", timeout=CLONE_TIMEOUT)
        if self.rev(f"refs/carrier/{n}") != sha:
            raise CloneError("the PR moved during the pass (its head)")
        self.heads[n] = sha

    def lines(self, commit, path):
        """The file's lines at commit, or None when the path is not there."""
        rc, oid = self.git("rev-parse", "-q", "--verify", f"{commit}:{path}", ok=(0, 1, 128))
        if rc != 0 or not oid:
            return None
        return self.git("cat-file", "blob", oid, raw=True).decode("utf-8", "replace").splitlines()

    def merge_tree(self, a, b):
        """The tree of a clean `merge-tree --write-tree a b`, or None for a conflicted one."""
        rc, out = self.git("merge-tree", "--write-tree", a, b, ok=(0, 1))
        return out.splitlines()[0] if rc == 0 and out else None


# ---- the pass ---------------------------------------------------------------------------------------------------------

class Item:
    def __init__(self, slug, n, url, labelled):
        self.slug, self.n, self.url, self.labelled = slug, n, url, labelled
        self.key = f"{slug}#{n}"


class Pass:
    def __init__(self, args, now, path, state):
        self.args, self.now, self.path, self.state = args, now, path, state
        self.stamp = now.isoformat(timespec="seconds")
        self.dry = args.dry_run
        self.me = None
        self.items = []
        self.pulls, self.repos, self.slots, self.clones, self.gum = {}, {}, {}, {}, {}
        self.superseded = set()
        self._scratch = None
        self.wrote = False

    # -- output and state --
    def say(self, line):
        print(line, flush=True)

    def save(self):
        if self.dry:
            return
        try:
            BJ.write_state(self.path, STATE_KEY, self.state, STATE_VERSION)
        except OSError as e:
            print(f"WARN: land-carrier: cannot write state {self.path}: {e}", file=sys.stderr)

    def scratch(self):
        if self._scratch is None:
            self._scratch = tempfile.mkdtemp(prefix="land-carrier-")
        return self._scratch

    def cleanup(self):
        if self._scratch is not None:
            shutil.rmtree(self._scratch, ignore_errors=True)

    # -- reads, cached for the pass --
    def pull(self, slug, n, fresh=False):
        k = (slug.lower(), n)
        if fresh or k not in self.pulls:
            pr = api_json(f"repos/{slug}/pulls/{n}")
            try:
                ok = (isinstance(pr, dict) and pr.get("state") in ("open", "closed")
                      and isinstance(pr["head"]["ref"], str) and HEX40.match(pr["head"]["sha"] or "")
                      and isinstance(pr["base"]["ref"], str))
            except (KeyError, TypeError):
                ok = False
            if not ok:
                raise GhError(f"unexpected JSON for {slug}#{n}")
            self.pulls[k] = pr
        return self.pulls[k]

    def repo(self, slug):
        k = slug.lower()
        if k not in self.repos:
            try:
                r = api_json(f"repos/{slug}")
                if not isinstance(r, dict):
                    raise GhError(f"unexpected JSON for {slug}")
                self.repos[k] = {"push": (r.get("permissions") or {}).get("push") is True,
                                 "auto": r.get("allow_auto_merge"), "err": None}
            except GhError as e:
                self.repos[k] = {"push": False, "auto": None, "err": f"cannot read {slug}: {e}"}
        return self.repos[k]

    def clone(self, slug, base_ref, base_sha):
        k = (slug.lower(), base_ref)
        c = self.clones.get(k)
        if isinstance(c, CloneError):
            raise c
        if c is None:
            try:
                c = Clone(self, slug, base_ref, base_sha)
            except CloneError as e:
                self.clones[k] = e
                raise
            self.clones[k] = c
        return c

    def gh_update_merge(self, slug, h, x, base_ref):
        """(verdict, P2): True when H is a GitHub-made update-branch merge from X, False when not, None when a read
        failed (the module docstring's 5d)."""
        k = (slug.lower(), h, x)
        if k not in self.gum:
            try:
                c = api_json(f"repos/{slug}/commits/{h}")
                parents = [p.get("sha") for p in (c.get("parents") or []) if isinstance(p, dict)]
                email = ((c.get("commit") or {}).get("committer") or {}).get("email")
                if len(parents) != 2 or parents[0] != x or email != GITHUB_EMAIL:
                    self.gum[k] = (False, None)
                else:
                    cmp = api_json(f"repos/{slug}/compare/{base_ref}...{parents[1]}")
                    self.gum[k] = (cmp.get("status") in ("behind", "identical"), parents[1])
            except (GhError, AttributeError):
                self.gum[k] = (None, None)
        return self.gum[k]

    def may_write(self, slug):
        """None when a write to slug may go ahead (push permission, then the register, read fresh), else why not."""
        info = self.repo(slug)
        if info["err"]:
            return info["err"]
        if not info["push"]:
            return f"no push permission on {slug}"
        t = _bound(GH_TIMEOUT)
        rc, out, err, timed_out = _run([sys.executable, "-B", str(REGISTER), "check", "--slug", slug], t)
        if timed_out:
            return f"the landing register check ran past {t:.0f} s"
        if rc != 0:
            return f"landing register: {_flat(out) or _why(err) or f'exit {rc}'}"
        return None

    def act(self, slug, key, desc, argv):
        """One GitHub write, after may_write: (True, None), or (False, why). --dry-run prints `would <desc>`."""
        why = self.may_write(slug)
        if why:
            return False, f"no write ({why})"
        if self.dry:
            self.say(f"{key}: would {desc}")
            return True, None
        self.wrote = True
        try:
            gh(*argv)
        except GhError as e:
            return False, str(e)
        return True, None


def _clean_leftovers():
    base = Path(tempfile.gettempdir())
    try:
        old = [p for p in base.glob("land-carrier-*") if p.is_dir() and not p.is_symlink()
               and time.time() - p.stat().st_mtime > LEFTOVER_AGE]
    except OSError:
        return
    for p in old:
        shutil.rmtree(p, ignore_errors=True)


def _search(extra):
    out = gh("search", "prs", "--state", "open", "--author", "@me", *extra, "--limit", str(SEARCH_LIMIT), "--json",
             "repository,number,url")
    try:
        data = json.loads(out)
        hits = []
        for d in data:
            slug = d["repository"]["nameWithOwner"]
            n = d["number"]
            if not isinstance(slug, str) or "/" not in slug or not isinstance(n, int):
                raise ValueError("a hit with no repository or number")
            hits.append((slug, n, d.get("url") or f"https://github.com/{slug}/pull/{n}"))
    except (ValueError, KeyError, TypeError) as e:
        raise GhError(f"unreadable search results ({_flat(e)[:80]})") from None
    if len(hits) >= SEARCH_LIMIT:
        print(f"WARN: land-carrier: a search returned {len(hits)} PRs: more may exist", file=sys.stderr)
    return hits


def _parse_key(k):
    slug, _, n = k.rpartition("#")
    return (slug, int(n)) if slug and n.isdigit() else (None, None)


def discover(ctx):
    """The work list, or None after a search spell line (the pass then ends)."""
    p = ctx.state.setdefault(PASS, {})
    try:
        labelled = _search(["--label", "landing"])
        headed = _search(["--head", "close"])
    except GhError as e:
        _search_failed(ctx, str(e))
        return None
    if p.pop("searchFailedSince", None) is not None:
        p.pop("searchFailedWhy", None)
    items = {}
    for slug, n, url in labelled:
        items.setdefault(f"{slug}#{n}", Item(slug, n, url, True))
    for slug, n, url in headed:
        items.setdefault(f"{slug}#{n}", Item(slug, n, url, False))
    for k, e in ctx.state.items():
        if k == PASS or k in items:
            continue
        slug, n = _parse_key(k)
        if slug:
            items[k] = Item(slug, n, e.get("url") or f"https://github.com/{slug}/pull/{n}", False)
    return list(items.values())


def _search_failed(ctx, why):
    p = ctx.state.setdefault(PASS, {})
    if not p.get("searchFailedSince"):
        p["searchFailedSince"] = ctx.stamp
        ctx.say(f"search failed: {why}")
    p["searchFailedWhy"] = why


def _order(ctx):
    """Least recently handled first, new PRs first; among PRs handled in the same pass, the one that took a repo's
    bring-current slot longest ago (never first), so the slot rotates."""
    low = datetime.min.replace(tzinfo=ctx.now.tzinfo)

    def key(it):
        e = ctx.state.get(it.key) or {}
        t = _parse_iso(e.get("handledAt"))
        return (0, low, low, it.slug.lower(), it.n) if t is None \
            else (1, t, _parse_iso(e.get("slotAt")) or low, it.slug.lower(), it.n)
    return sorted(ctx.items, key=key)


def cmd_run(args):
    global ENV, DEADLINE_AT
    now = _parse_now(args.now)
    if now is None:
        print(f"ERROR: land-carrier run: usage: --now {args.now!r} is not an ISO timestamp", file=sys.stderr)
        return 2
    path = BJ.state_path(args.state, STATE_NAME)
    state, _ = read_state(path)
    p = state.get(PASS) or {}
    last = _parse_iso(p.get("lastPass"))
    if not args.dry_run and last is not None and last <= now and now - last < timedelta(minutes=args.every):
        return 3
    for s in SIGNALS:
        signal.signal(s, _on_signal)
    ENV = _env()
    DEADLINE_AT = time.monotonic() + args.deadline
    ctx = Pass(args, now, path, state)
    state[PASS] = dict(p, lastPass=ctx.stamp)
    ctx.save()
    try:
        _clean_leftovers()
        items = discover(ctx)
        if items is None or not items:
            ctx.save()
            return 0
        try:
            ctx.me = _flat(gh("api", "user", "--jq", ".login"))
            if not ctx.me:
                raise GhError("no login")
        except GhError as e:
            _search_failed(ctx, f"cannot read the GitHub login: {e}")
            ctx.save()
            return 0
        except _Deadline:
            ctx.save()
            return 0
        ctx.items = items
        for it in _order(ctx):
            if DEADLINE_AT - time.monotonic() < 1:
                break
            if not handle(ctx, it):
                break
        ctx.save()
        return 0
    finally:
        ctx.cleanup()


def handle(ctx, it):
    """One PR: Phase A, then Phase B, then its entry written. False when the deadline cut it (the pass stops)."""
    old = ctx.state.get(it.key)
    e = dict(old) if isinstance(old, dict) else None
    ctx.wrote = False
    try:
        res = pr_pass(ctx, it, e)
    except _Deadline:
        if ctx.wrote and e is not None:
            e["outcome"] = "cut by the pass's deadline"
            e["handledAt"] = ctx.stamp
            ctx.state[it.key] = e
            ctx.save()
        return False
    if res is DROP:
        ctx.state.pop(it.key, None)
    elif res is not KEEP:
        ctx.state[it.key] = res
    ctx.save()
    return True


def _entry(ctx, it, url, head):
    return {"url": url, "since": ctx.stamp, "movedAt": ctx.stamp, "head": head}


def _finish(ctx, it, e, kind, outcome):
    """The entry after its act: the kind, outcome, handledAt and the stuck rule (step 7)."""
    e["kind"], e["outcome"], e["handledAt"] = kind, outcome, ctx.stamp
    moved = _parse_iso(e.get("movedAt"))
    if moved is not None and moved <= ctx.now and ctx.now - moved >= STUCK_AFTER:
        if not e.get("stuck") and not ctx.dry:
            ctx.say(f"{it.key}: stuck: unmoved since {str(e.get('movedAt'))[:16]}: {outcome}")
        e["stuck"] = True
    else:
        e["stuck"] = False
    return e


def pr_pass(ctx, it, e):
    slug, n = it.slug, it.n
    try:
        pr = ctx.pull(slug, n)
        tries = 0
        while pr["state"] == "open" and pr.get("mergeable_state") == "unknown" and tries < SETTLE_TRIES:
            if DEADLINE_AT - time.monotonic() < ctx.args.settle_wait + 2:
                break
            time.sleep(ctx.args.settle_wait)
            pr = ctx.pull(slug, n, fresh=True)
            tries += 1
    except GhError as ex:
        if e is None and not it.labelled:
            return KEEP
        e = e or _entry(ctx, it, it.url, None)
        return _finish(ctx, it, e, e.get("kind") or "unread", f"cannot read the PR: {ex}")
    if pr.get("merged"):
        return DROP
    if pr["state"] == "closed":
        if e and e.get("supersededBy"):
            return tombstone(ctx, it, e)
        return DROP
    labels = {x.get("name") for x in (pr.get("labels") or []) if isinstance(x, dict)}
    head_ref, head = pr["head"]["ref"], pr["head"]["sha"]
    base_ref, base_sha = pr["base"]["ref"], pr["base"].get("sha") or ""
    grammar = bool(CLOSE_RE.match(head_ref))
    if "landing" not in labels and not grammar:
        return DROP
    url = pr.get("html_url") or it.url
    if e is None:
        e = _entry(ctx, it, url, head)
    e["url"] = url
    e.pop("supersededBy", None)
    e.pop("closedAt", None)

    # 5d: the head, for the clock only
    prev = e.get("head")
    if prev and prev != head:
        carrier = head == e.get("pushed") or ctx.gh_update_merge(slug, head, prev, base_ref)[0] is not False
        if not carrier:
            e["movedAt"], e["reruns"], e["rerunHead"] = ctx.stamp, 0, head
    e["head"] = head

    login = (pr.get("user") or {}).get("login")
    hrepo = pr["head"].get("repo")
    if login != ctx.me:
        return _finish(ctx, it, e, "foreign", f"skipped: the PR is {login or 'an unknown author'}'s, not {ctx.me}'s")
    if not isinstance(hrepo, dict):
        return _finish(ctx, it, e, "foreign", "skipped: its head repository is gone")
    if str(hrepo.get("full_name") or "").lower() != slug.lower():
        return _finish(ctx, it, e, "foreign", f"skipped: its head is in another repository ({hrepo.get('full_name')})")

    # 5c / 5f: the kind
    before = (e.get("markerId"), e.get("bound"), e.get("cleared"))
    why = None
    if grammar:
        kind = "close-out"
    elif pr.get("draft"):
        kind, why = "own-unqueued", "a draft: left to its session"
    elif pr.get("auto_merge"):
        kind = "own-auto"
    else:
        kind, why = own_kind(ctx, it, pr, e)
    if (e.get("markerId"), e.get("bound"), e.get("cleared")) != before and not ctx.dry:
        ctx.state[it.key] = dict(e)   # O1: a changed binding is on disk before any write for this PR
        ctx.save()
    if kind == "own-unqueued":
        return _finish(ctx, it, e, kind, why)

    # 5e: the checks
    try:
        checks = read_checks(slug, head, base_sha)
    except GhError as ex:
        checks = {"cls": "unread", "pending": False, "why": f"cannot read the checks: {ex}"}
    return act(ctx, it, pr, e, kind, checks)


def own_kind(ctx, it, pr, e):
    """(kind, why) of an own PR with no auto-merge: its newest marker, then the binding (5f)."""
    slug, n = it.slug, it.n
    try:
        m = newest_marker(api_json(f"repos/{slug}/issues/{n}/comments?per_page=100", paginate=True), ctx.me)
    except GhError as ex:
        return "own-unqueued", f"cannot read its comments ({ex}): left to its session"
    if m is None or m[1] is None:
        return "own-unqueued", "not queued: left to its session"
    cid, s = m
    if e.get("markerId") == cid and e.get("cleared"):
        return "own-unqueued", "its queue marker no longer binds: left to its session"
    b = e.get("bound") if e.get("markerId") == cid and e.get("bound") else s
    head = pr["head"]["sha"]
    if head == b or (head == e.get("pushed") and e.get("pushedFrom") == b):
        e.update(markerId=cid, bound=head, cleared=False)
        return "own-marked", None
    v, p2 = ctx.gh_update_merge(slug, head, b, pr["base"]["ref"])
    if v is None:
        return "own-unqueued", "cannot read whether the head follows its queue marker: left to its session"
    if v:
        try:
            cl = ctx.clone(slug, pr["base"]["ref"], pr["base"].get("sha") or "")
            cl.fetch_head(n, pr["head"]["ref"], head)
            follows = cl.merge_tree(b, p2) == cl.git("rev-parse", f"{head}^{{tree}}")
        except CloneError as ex:
            return "own-unqueued", f"cannot read whether the head follows its queue marker ({ex}): left to its session"
        if follows:
            e.update(markerId=cid, bound=head, cleared=False)
            return "own-marked", None
    e.update(markerId=cid, bound=None, cleared=True)
    return "own-unqueued", f"its queue marker is for {str(b)[:12]} and the head moved past it: left to its session"


def read_checks(slug, sha, base_sha):
    """The head's checks (5e): {cls, pending, runs, statuses}."""
    cr = api_json(f"repos/{slug}/commits/{sha}/check-runs?per_page=100")
    stt = api_json(f"repos/{slug}/commits/{sha}/status")
    runs, sts = {}, {}
    try:
        for r in sorted(cr.get("check_runs") or [], key=lambda r: r.get("id") or 0):
            runs[_flat(r.get("name")) or "?"] = r
        for s in stt.get("statuses") or []:
            sts.setdefault(_flat(s.get("context")) or "?", s)
    except (AttributeError, TypeError):
        raise GhError("unexpected checks JSON") from None
    fail = infra = pending = False
    for name, r in runs.items():
        c = r.get("conclusion") or ""
        if r.get("status") != "completed":
            pending = True
        elif c == "failure":
            fail = True
        elif c in INFRA_CONC:
            infra = True
    for name, s in sts.items():
        if name in runs:
            continue
        stv = s.get("state") or ""
        if stv == "pending":
            pending = True
        elif stv == "failure":
            fail = True
        elif stv == "error":
            infra = True
    if not runs and not sts:
        if not base_sha:
            return {"cls": "none", "pending": False, "runs": {}, "statuses": {}}
        bcr = api_json(f"repos/{slug}/commits/{base_sha}/check-runs?per_page=100")
        bst = api_json(f"repos/{slug}/commits/{base_sha}/status")
        try:
            anyb = (bcr.get("total_count") or 0) > 0 or bool(bst.get("statuses"))
        except AttributeError:
            raise GhError("unexpected checks JSON") from None
        return {"cls": "pending" if anyb else "none", "pending": anyb, "runs": {}, "statuses": {}}
    cls = "red" if fail else "pending" if pending else "infra" if infra else "green"
    return {"cls": cls, "pending": pending, "runs": runs, "statuses": {k: v for k, v in sts.items() if k not in runs}}


def _wait_outcome(pr, checks, settled):
    if not settled:
        return "GitHub has not settled its mergeability"
    if checks["cls"] == "unread":
        return checks["why"]
    if checks["pending"]:
        return "waiting for its checks"
    st = pr.get("mergeable_state")
    return f"waiting (mergeable_state {st}, checks {checks['cls']})"


def act(ctx, it, pr, e, kind, checks):
    """Phase B: the first step of the module docstring's step 6 that applies."""
    slug, n, key = it.slug, it.n, it.key
    head, head_ref = pr["head"]["sha"], pr["head"]["ref"]
    st = pr.get("mergeable_state")
    settled = st != "unknown"
    green = checks["cls"] in ("green", "none")
    auto_on = bool(pr.get("auto_merge"))
    note = None

    if kind == "close-out":
        sup = supersession(ctx, it, pr, e)
        if isinstance(sup, str):
            note = sup
        elif sup is not None:
            return close_superseded(ctx, it, pr, e, sup)
        if not auto_on:
            if ctx.repo(slug)["auto"] is not False:
                ok, why = ctx.act(slug, key, "queue auto-merge", ["pr", "merge", str(n), "-R", slug, "--auto", "--merge"])
                if ok:
                    if not ctx.dry:
                        ctx.say(f"{key}: auto-merge queued")
                    return _finish(ctx, it, e, kind, "auto-merge queued")
                note = f"auto-merge not queued ({why})"
            else:
                note = f"auto-merge is off on {slug}"

    def done(outcome):
        return _finish(ctx, it, e, kind, f"{note}; {outcome}" if note else outcome)

    if settled and st == "dirty":
        return done(resolver(ctx, it, pr, e))
    if checks["cls"] in ("red", "infra") and not checks["pending"]:
        reruns = (e.get("reruns") or 0) if e.get("rerunHead") == head else 0
        if reruns >= RERUN_MAX:
            return done("rerun budget spent")
        return done(rerun(ctx, it, pr, e, checks, reruns))
    if settled and st == "behind" and green:
        if ctx.slots.get(slug.lower()):
            return done("waiting its turn to be brought current")
        ctx.slots[slug.lower()] = key
        if not ctx.dry:
            e["slotAt"] = ctx.stamp
        ok, why = ctx.act(slug, key, f"request update-branch (from {head[:12]})",
                          ["api", "--method", "PUT", f"repos/{slug}/pulls/{n}/update-branch",
                           "-f", f"expected_head_sha={head}"])
        if not ok:
            return done(f"update-branch not requested: {why}")
        if not ctx.dry:
            e["updatedFrom"] = head
            ctx.say(f"{key}: update-branch requested (from {head[:12]})")
        return done(f"update-branch requested (from {head[:12]})")
    if settled and st in ("clean", "has_hooks") and green:
        if kind == "close-out" and not auto_on:
            sha = head
        elif kind == "own-marked":
            sha = e.get("bound") or head
        else:
            return done("waiting for GitHub's auto-merge")
        ok, why = ctx.act(slug, key, f"merge at {sha[:12]}", ["api", "--method", "PUT", f"repos/{slug}/pulls/{n}/merge",
                                                              "-f", "merge_method=merge", "-f", f"sha={sha}"])
        if not ok:
            return done(f"merge failed: {why}")
        if ctx.dry:
            return done(f"would merge at {sha[:12]}")
        ctx.say(f"{key}: merged at {sha[:12]}")
        return DROP
    return done(_wait_outcome(pr, checks, settled))


# ---- step 6.4: the rerun rule -----------------------------------------------------------------------------------------

def _classify(steps):
    if not MERGE_TASK.is_file():
        return "genuine"
    t = _bound(CLASSIFY_TIMEOUT)
    rc, out, _, timed_out = _run(["bash", str(MERGE_TASK), "--classify-steps"], t, input="\n".join(steps) + "\n")
    return "infra" if not timed_out and rc == 0 and out.strip() == "infra" else "genuine"


def rerun(ctx, it, pr, e, checks, reruns):
    slug, key, head = it.slug, it.key, pr["head"]["sha"]
    genuine, runs, steps, owners = None, [], [], []
    for name, r in checks["runs"].items():
        if r.get("status") != "completed" or (r.get("conclusion") or "") in PASS_CONC:
            continue
        m = JOB_URL.search(str(r.get("details_url") or ""))
        if ((r.get("app") or {}).get("slug")) != "github-actions" or not m:
            genuine = f"{name} is not a GitHub Actions job"
            break
        if int(m.group(1)) not in runs:
            runs.append(int(m.group(1)))
    for name, s in checks["statuses"].items():
        if not genuine and (s.get("state") or "") not in ("success", "pending"):
            genuine = f"status {name} is {s.get('state')}"
    words = {"failure": "failed", "timed_out": "timed out", "startup_failure": "failed to start"}
    for run in ([] if genuine else runs):
        try:
            jobs = api_json(f"repos/{slug}/actions/runs/{run}/jobs?per_page=100").get("jobs") or []
        except (GhError, AttributeError) as ex:
            genuine = f"cannot read the jobs of run {run} ({ex})"
            break
        bad = [j for j in jobs if isinstance(j, dict) and j.get("status") == "completed"
               and (j.get("conclusion") or "") not in PASS_CONC]
        if not bad:
            genuine = f"run {run} shows no failed job"
            break
        for j in bad:
            c, jn = j.get("conclusion") or "", _flat(j.get("name")) or str(j.get("id"))
            if c == "cancelled":
                continue
            if c not in words:
                genuine = f"{jn} concluded {c}"
                break
            failed = [_flat(s.get("name")) for s in (j.get("steps") or [])
                      if isinstance(s, dict) and s.get("conclusion") == "failure"]
            if not failed:
                genuine = f"{jn} {words[c]} with no failed step"
                break
            steps += failed
            owners.append(f"{jn} ({failed[0]})")
        if genuine:
            break
    if not genuine and steps and _classify(steps) != "infra":
        genuine = "a genuine failure in " + "; ".join(owners[:3])
    if genuine:
        return f"not re-run: {genuine}"
    if not runs:
        return "not re-run: no GitHub Actions run to re-run"
    if not ctx.dry:
        e["rerunHead"], e["reruns"] = head, reruns + 1
    failed = []
    for run in runs:
        ok, why = ctx.act(slug, key, f"re-run run {run}", ["api", "--method", "POST",
                                                          f"repos/{slug}/actions/runs/{run}/rerun-failed-jobs"])
        if not ok:
            failed.append(f"run {run}: {why}")
    if failed:
        return "re-run failed: " + "; ".join(failed)
    what = "cancelled jobs" if not steps else "infra steps " + ", ".join(sorted(set(steps)))[:120]
    if not ctx.dry:
        ctx.say(f"{key}: re-ran run{'s' if len(runs) > 1 else ''} {', '.join(map(str, runs))} ({what})")
    return f"re-ran run{'s' if len(runs) > 1 else ''} {', '.join(map(str, runs))} ({what}; {reruns + 1} of {RERUN_MAX})"


# ---- step 6.3: the resolver -------------------------------------------------------------------------------------------

def _parse_merge_tree(out):
    """(tree, {path: {stage: (mode, oid)}}, [(paths, type)]) of `merge-tree --write-tree -z` output."""
    f = out.split("\0")
    tree, i, conflicts, msgs = f[0], 1, {}, []
    while i < len(f) and f[i]:
        meta, _, path = f[i].partition("\t")
        mode, oid, stage = meta.split(" ")
        conflicts.setdefault(path, {})[int(stage)] = (mode, oid)
        i += 1
    i += 1
    while i < len(f) and f[i]:
        k = int(f[i])
        paths = f[i + 1:i + 1 + k]
        msgs.append((paths, f[i + 1 + k]))
        i += k + 3
    return tree, conflicts, msgs


def _resolve_text(text, path, head_first):
    """The merged file with each hunk resolved (the module docstring's rules), or (None, why)."""
    lines = text.splitlines(keepends=True)
    out, i = [], 0
    while i < len(lines):
        ln = lines[i].rstrip("\r\n")
        if ln != OURS:
            if ln in (BASE, SEP, THEIRS):
                return None, f"a conflict hunk in {path} cannot be read"
            out.append(lines[i])
            i += 1
            continue
        secs, cur, j = {"ours": [], "base": [], "theirs": []}, "ours", i + 1
        while j < len(lines):
            m = lines[j].rstrip("\r\n")
            if m == BASE and cur == "ours":
                cur = "base"
            elif m == SEP and cur == "base":
                cur = "theirs"
            elif m == THEIRS and cur == "theirs":
                break
            elif m in (OURS, BASE, SEP, THEIRS):
                return None, f"a conflict hunk in {path} cannot be read"
            else:
                secs[cur].append(lines[j])
            j += 1
        else:
            return None, f"a conflict hunk in {path} cannot be read"
        o, b, t = secs["ours"], secs["base"], secs["theirs"]
        if not b:
            for side in ((o, t) if head_first() else (t, o)):
                for x in side:
                    out.append(x if x.endswith("\n") else x + "\n")
        elif (is_thread(path) and len(o) == len(b) == len(t) == 1 and all(_date(x) for x in (o[0], b[0], t[0]))
              and out and out[0].rstrip("\r\n") == "---" and sum(1 for x in out if x.rstrip("\r\n") == "---") == 1):
            out.append(o[0] if _date(o[0]) >= _date(t[0]) else t[0])
        else:
            return None, f"a conflict hunk in {path} rewrites lines"
        i = j + 1
    return "".join(out), None


def resolver(ctx, it, pr, e):
    """Step 6.3: an outcome."""
    slug, n, key = it.slug, it.n, it.key
    head, head_ref = pr["head"]["sha"], pr["head"]["ref"]
    base_ref, base = pr["base"]["ref"], pr["base"].get("sha") or ""
    if ctx.slots.get(slug.lower()):
        return "dirty: waiting its turn to be brought current"
    try:
        cl = ctx.clone(slug, base_ref, base)
        cl.fetch_head(n, head_ref, head)
        rc, out = cl.git("merge-tree", "--write-tree", "-z", head, base, ok=(0, 1), raw=True)
        if rc == 0:
            return "dirty on GitHub, but the merge is clean: left to update-branch"
        tree, conflicts, msgs = _parse_merge_tree(out.decode("utf-8", "replace"))
        for paths, typ in msgs:
            if typ not in ("Auto-merging", "CONFLICT (contents)"):
                return f"not resolved: a {typ} conflict on {', '.join(paths)}"
        for path in sorted(conflicts):
            if not closeout_shaped(path):
                return f"not resolved: {path} conflicts, and it is no close-out path"
        mb = cl.git("merge-base", head, base)
        resolved = {}
        for path in sorted(conflicts):
            stages = conflicts[path]
            if set(stages) != {1, 2, 3}:
                return f"not resolved: {path} is not changed on both sides"
            files = {}
            d = Path(ctx.scratch()) / f"m{n}"
            d.mkdir(exist_ok=True)
            for s in (1, 2, 3):
                files[s] = d / f"{s}"
                files[s].write_bytes(cl.git("cat-file", "blob", stages[s][1], raw=True))
            mrc, merged = cl.git("merge-file", "-p", "--diff3", f"--marker-size={MARK}", "-L", "head", "-L", "base",
                                 "-L", "origin", str(files[2]), str(files[1]), str(files[3]), raw=True,
                                 ok=tuple(range(0, 128)))
            cache = {}

            def head_first(path=path):
                if "v" not in cache:
                    ts = [int(cl.git("log", "-1", "--format=%ct", f"{mb}..{side}", "--", path) or 0)
                          for side in (head, base)]
                    cache["v"] = ts[0] > ts[1]
                return cache["v"]

            text, why = _resolve_text(merged.decode("utf-8", "replace"), path, head_first)
            if text is None:
                return f"not resolved: {why}"
            resolved[path] = (stages[2][0], text)
        idx = {"GIT_INDEX_FILE": str(Path(ctx.scratch()) / f"index-{n}")}
        cl.git("read-tree", tree, env=idx)
        for path, (mode, text) in resolved.items():
            blob = cl.git("hash-object", "-w", "--stdin", input=text.encode("utf-8"))
            cl.git("update-index", "--cacheinfo", f"{mode},{blob},{path}", env=idx)
        new_tree = cl.git("write-tree", "--missing-ok", env=idx)
        msg = (f"Merge {base_ref} into {head_ref} (landing carrier, ADR 0078 d2)\n\n"
               + "Both sides only added lines; kept both, the newer side first:\n"
               + "".join(f"- {p}\n" for p in sorted(resolved)))
        commit = cl.git("commit-tree", new_tree, "-p", head, "-p", base, input=msg)
    except CloneError as ex:
        return f"not resolved: {ex}"
    names = ", ".join(sorted(resolved))
    if ctx.dry:
        why = ctx.may_write(slug)
        if why:
            return f"not pushed: no write ({why})"
        ctx.say(f"{key}: would resolve {names} and push {commit[:12]}")
        return f"would resolve {names}"
    e["pushed"], e["pushedFrom"] = commit, head
    ctx.state[key] = dict(e)   # O1: the push is recorded before it is made
    ctx.save()
    why = ctx.may_write(slug)
    if why:
        return f"not pushed: no write ({why})"
    ctx.slots[slug.lower()] = key
    e["slotAt"] = ctx.stamp
    ctx.wrote = True
    try:
        cl.git("-c", "core.hooksPath=/dev/null", "push", "origin", f"{commit}:refs/heads/{head_ref}",
               timeout=PUSH_TIMEOUT)
    except CloneError as ex:
        return f"resolved {names}, but the push failed: {ex}"
    ctx.say(f"{key}: resolved {names} and pushed {commit[:12]}")
    return f"resolved {names} and pushed {commit[:12]}"


# ---- step 6.1 and step 8: supersession and tombstones -----------------------------------------------------------------

def _changes(cl, mb, head):
    """[(status, path, added, removed, binary)] for each path head changes from mb."""
    out = cl.git("diff", "--no-renames", "--no-ext-diff", "--name-status", "-z", mb, head)
    f = [x for x in out.split("\0")]
    rows, i = [], 0
    while i + 1 < len(f):
        st, path = f[i], f[i + 1]
        i += 2
        if not st:
            break
        rows.append((st[0], path))
    num = {}
    nout = cl.git("diff", "--no-renames", "--no-ext-diff", "--numstat", "-z", mb, head)
    for rec in nout.split("\0"):
        parts = rec.split("\t")
        if len(parts) == 3:
            num[parts[2]] = parts[0] == "-"
    res = []
    for st, path in rows:
        added, removed = [], []
        if st in ("A", "M") and not num.get(path):
            patch = cl.git("diff", "--no-renames", "--no-ext-diff", "--no-color", "-U0", mb, head, "--", path)
            hunk = False
            for ln in patch.splitlines():
                if ln.startswith("@@"):
                    hunk = True
                    continue
                if not hunk:
                    continue
                if ln.startswith("+"):
                    added.append(ln[1:])
                elif ln.startswith("-"):
                    removed.append(ln[1:])
        res.append((st, path, added, removed, bool(num.get(path)) or st not in ("A", "M", "D")))
    return res


def _carried(cl, changes, targets):
    for st, path, added, removed, binary in changes:
        files = [cl.lines(t, path) for t in targets]
        present = [f for f in files if f is not None]
        if st == "D":
            if present:
                return False
            continue
        if binary:
            return False
        union = set()
        for f in present:
            union.update(f)
        dates = [d for f in present for d in (_date(x) for x in f) if d] if is_thread(path) else []
        for ln in added:
            if not ln.strip():
                continue
            d = _date(ln) if is_thread(path) else None
            if d:
                if not any(x >= d for x in dates):
                    return False
                continue
            if ln not in union:
                return False
        readded = set(added)
        for ln in removed:
            if not ln.strip() or ln in readded or (is_thread(path) and _date(ln)):
                continue
            if ln in union:
                return False
    return True


def supersession(ctx, it, pr, e):
    """Step 6.1: None, a string (why it was not evaluated), or ("base", None) / ("pr", (item, L's PR))."""
    slug, n = it.slug, it.n
    head, head_ref = pr["head"]["sha"], pr["head"]["ref"]
    base_ref, base = pr["base"]["ref"], pr["base"].get("sha") or ""
    cands = []
    for o in ctx.items:
        if o.slug.lower() != slug.lower() or o.n <= n or o.key in ctx.superseded:
            continue
        try:
            lp = ctx.pull(o.slug, o.n)
        except GhError:
            continue
        if (lp["state"] == "open" and not lp.get("merged") and CLOSE_RE.match(lp["head"]["ref"])
                and lp["base"]["ref"] == base_ref):
            cands.append((o, lp))
    cands.sort(key=lambda x: -x[0].n)
    ckey = f"{base}:{head}:" + ",".join(f"{o.n}={lp['head']['sha']}" for o, lp in cands)
    chk = e.get("checked") if isinstance(e.get("checked"), dict) else {}
    if chk.get("key") == ckey:
        verdict = chk.get("verdict")
    else:
        try:
            cl = ctx.clone(slug, base_ref, base)
            cl.fetch_head(n, head_ref, head)
            commits = cl.git("rev-list", "--no-merges", "--topo-order", f"{base}..{head}").split()
            verdict = None
            if commits:
                mb = cl.git("merge-base", base, head)
                changes = _changes(cl, mb, head)
                if len(commits) == 1 and _carried(cl, changes, [base]):
                    verdict = "base"
                else:
                    rest = set(commits[1:])
                    for o, lp in cands:
                        cl.fetch_head(o.n, lp["head"]["ref"], lp["head"]["sha"])
                        lset = set(cl.git("rev-list", f"{base}..{lp['head']['sha']}").split())
                        if rest <= lset and _carried(cl, changes, [base, lp["head"]["sha"]]):
                            verdict = o.key
                            break
        except CloneError as ex:
            return f"supersession not read ({ex})"
        e["checked"] = {"key": ckey, "verdict": verdict}
    if verdict is None:
        return None
    if verdict == "base":
        return ("base", None)
    for o, lp in cands:
        if o.key == verdict:
            return ("pr", (o, lp))
    return None


def close_superseded(ctx, it, pr, e, sup):
    slug, n, key = it.slug, it.n, it.key
    what, l = sup
    by = f"its lines are already on {pr['base']['ref']}" if what == "base" else f"{l[1].get('html_url') or l[0].url} carries its lines"
    ok, why = ctx.act(slug, key, f"close it as superseded ({by})",
                      ["api", "--method", "POST", f"repos/{slug}/issues/{n}/comments",
                       "-f", f"body=Superseded (ADR 0078 d2): {by}, so the landing carrier closed this PR."])
    if ok:
        ok, why = (True, None) if ctx.dry else ctx.act(slug, key, "close it",
                                                         ["api", "--method", "PATCH", f"repos/{slug}/pulls/{n}",
                                                          "-f", "state=closed"])
    if not ok:
        return _finish(ctx, it, e, "close-out", f"superseded ({by}), but not closed: {why}")
    if ctx.dry:
        return _finish(ctx, it, e, "close-out", f"would close as superseded ({by})")
    ctx.superseded.add(key)
    ctx.say(f"{key}: closed as superseded ({by})")
    if what == "base":
        return DROP
    e["supersededBy"], e["closedAt"] = l[0].key, ctx.stamp
    e["kind"], e["outcome"], e["handledAt"], e["stuck"] = "close-out", f"closed as superseded ({by})", ctx.stamp, False
    return e


def tombstone(ctx, it, e):
    """Step 8: a PR closed as superseded by L, read with L."""
    slug, n, key = it.slug, it.n, it.key
    lkey = e["supersededBy"]
    lslug, ln = _parse_key(lkey)
    e["handledAt"] = ctx.stamp
    try:
        if not lslug:
            raise GhError(f"no PR named by {lkey}")
        lp = ctx.pull(lslug, ln)
    except GhError as ex:
        e["outcome"] = f"closed as superseded by {lkey}, which cannot be read ({ex})"
        return e
    if lp.get("merged"):
        return DROP
    if lp["state"] == "open":
        if not e.get("stuck"):
            e["outcome"] = f"closed as superseded by {lp.get('html_url') or lkey}, which is open"
        return e
    lurl = lp.get("html_url") or lkey
    ok, why = ctx.act(slug, key, f"reopen it ({lurl} closed unmerged)",
                      ["api", "--method", "POST", f"repos/{slug}/issues/{n}/comments", "-f",
                       f"body=Reopened (ADR 0078 d2): {lurl} closed unmerged, so it no longer carries this PR's lines."])
    if ok and not ctx.dry:
        ok, why = ctx.act(slug, key, "reopen it", ["api", "--method", "PATCH", f"repos/{slug}/pulls/{n}", "-f",
                                                   "state=open"])
    if not ok:
        if not e.get("stuck") and not ctx.dry:
            ctx.say(f"{key}: stuck: closed as superseded by {lurl}, which closed unmerged, and the reopen failed: {why}")
        e["stuck"], e["outcome"] = True, f"reopen failed ({lurl} closed unmerged): {why}"
        return e
    if ctx.dry:
        return e
    ctx.say(f"{key}: reopened ({lurl} closed unmerged)")
    for k in ("supersededBy", "closedAt", "checked"):
        e.pop(k, None)
    e["stuck"], e["movedAt"], e["outcome"] = False, ctx.stamp, f"reopened ({lurl} closed unmerged)"
    return e


# ---- state, stuck and marker ------------------------------------------------------------------------------------------

def read_state(path):
    """(state, dirty): the entries, each with a readable since, and `_pass`."""
    entries, dirty = BJ.read_state(path, "land-carrier", STATE_KEY, STATE_VERSION)
    out = {}
    for k, v in entries.items():
        if k == PASS:
            out[k] = dict(v) if isinstance(v, dict) else {}
            continue
        if "#" not in k or not isinstance(v, dict) or _parse_iso(v.get("since")) is None:
            print(f"WARN: land-carrier: state {path}: entry {k} has no readable since: dropped", file=sys.stderr)
            dirty = True
            continue
        out[k] = dict(v)
    return out, dirty


def cmd_stuck(args):
    now = _parse_now(args.now)
    if now is None:
        print(f"ERROR: land-carrier stuck: usage: --now {args.now!r} is not an ISO timestamp", file=sys.stderr)
        return 2
    path = BJ.state_path(args.state, STATE_NAME)
    state, _ = read_state(path)
    due = []
    for k, e in state.items():
        if k == PASS:
            continue
        moved = _parse_iso(e.get("movedAt")) or _parse_iso(e.get("since"))
        if e.get("supersededBy"):
            if e.get("stuck"):
                due.append((moved or now, k, e))
            continue
        if moved is not None and moved <= now and now - moved >= STUCK_AFTER:
            due.append((moved, k, e))
    p = state.get(PASS) or {}
    sf = _parse_iso(p.get("searchFailedSince"))
    if sf is not None and sf <= now and now - sf >= STUCK_AFTER:
        due.append((sf, "search", {"url": None, "kind": "search", "movedAt": p.get("searchFailedSince"),
                                   "outcome": f"search failed: {p.get('searchFailedWhy') or 'unknown'}"}))
    due.sort(key=lambda x: (x[0], x[1]))
    rows = [{"key": k, "url": e.get("url"), "kind": e.get("kind"), "movedAt": e.get("movedAt") or e.get("since"),
             "outcome": _flat(e.get("outcome") or "")} for _, k, e in due]
    line = ("Landings: " + " · ".join(f"{r['key']}: {r['outcome']} (unmoved since {str(r['movedAt'] or '')[:16]})"
                                      for r in rows)) if rows else None
    print(json.dumps({"state": str(path), "stuck": rows, "line": line}, ensure_ascii=False))
    return 0


def cmd_marker(args):
    try:
        comments = _pages(sys.stdin.read())
    except ValueError as e:
        print(f"land-carrier marker: unreadable comments JSON ({_flat(e)[:80]})", file=sys.stderr)
        return 2
    m = newest_marker(comments, args.login)
    print(f"queued {m[1]}" if m and m[1] is not None else "none")
    return 0


def _load_bj():
    try:
        if not BJ_FILE.is_file():
            raise FileNotFoundError("no file")
        spec = importlib.util.spec_from_file_location("thread_background_job", str(BJ_FILE))
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        return mod
    except Exception as e:  # noqa: BLE001 — a broken module is this one line, never a traceback
        print(f"land-carrier: cannot load {BJ_FILE}: {type(e).__name__}: {_flat(e)[:160]}", file=sys.stderr)
        return None


def _positive(value):
    n = int(value)
    if n < 1:
        raise argparse.ArgumentTypeError(f"must be a positive integer, got {value}")
    return n


def _nonneg(value):
    n = int(value)
    if n < 0:
        raise argparse.ArgumentTypeError(f"must be zero or more, got {value}")
    return n


def main(argv=None):
    global BJ
    p = argparse.ArgumentParser(prog="land-carrier.py", allow_abbrev=False,
                                description="The landing carrier (ADR 0078 d2): every landing PR moves until it merges.")
    sub = p.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run", allow_abbrev=False, help="one pass over the open landing PRs")
    r.add_argument("--state", default=None, help="the state file (default ${XDG_STATE_HOME:-~/.local/state}/thread/"
                                                 "landings.json)")
    r.add_argument("--now", default=None, help="the time to read against, ISO (default: now)")
    r.add_argument("--every", type=_positive, default=15, help="minutes between passes (the rate limit)")
    r.add_argument("--deadline", type=_positive, default=200, help="the pass's own deadline, seconds")
    r.add_argument("--settle-wait", type=_nonneg, default=5, help="seconds between re-reads of an unknown mergeability")
    r.add_argument("--dry-run", action="store_true", help="reads only: print would-lines, write nothing")
    r.set_defaults(func=cmd_run)
    s = sub.add_parser("stuck", allow_abbrev=False, help="the landings stuck a day (a read that writes nothing)")
    s.add_argument("--state", default=None)
    s.add_argument("--now", default=None)
    s.set_defaults(func=cmd_stuck)
    m = sub.add_parser("marker", allow_abbrev=False, help="the live queue marker in stdin's comments")
    m.add_argument("--login", required=True)
    m.set_defaults(func=cmd_marker)
    args = p.parse_args(argv)
    if args.cmd in ("run", "stuck"):
        BJ = _load_bj()
        if BJ is None:
            return 1
    try:
        return args.func(args)
    except _Signalled as e:
        for sg in SIGNALS:
            signal.signal(sg, signal.SIG_DFL)
        print(f"land-carrier: stopped by signal {e.signum}", file=sys.stderr, flush=True)
        return 128 + e.signum


if __name__ == "__main__":
    sys.exit(main())
