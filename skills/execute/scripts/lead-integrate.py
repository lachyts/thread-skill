#!/usr/bin/env python3
"""lead-integrate.py — the lead's side of Integration (ADR 0030 decision 3, p12-9; execute SKILL.md § 4.5).

The lead runs a clean Integration itself and launches the engine's mode-'integrate' call only for trouble.
Every git step, every timing rule and every marker rendering the lead needs lives here, so the skill's prose
only routes on a verdict. Prints JSON (verify prints one line); never merges a PR (merge-task.sh does) and
never force-pushes.

Subcommands:

  prepare --repo R --slug S --default D --note N [--tasks-dir T] [--verifier CMD [--bootstrap CMD]]
      Decide how one approved task integrates. Refuses (exit 1, nothing fetched or merged) a note with no
      `integrating:`: every route into execute § 4.5 step 3 runs mark-integrating first, so a skipped stamp
      stops here (p26-1). In order: fetch origin with --prune (retried once; failing
      twice is exit 8); H = origin/<branch> (absent: route `set-aside`, reason `origin/<branch> does not
      exist — the PR branch is gone`); the anchor A = the engine's ANCHOR_RECIPE (pinned copy) with
      WT=<repo> (a `stale-ref X` is deleted with `update-ref -d <ref> X`, guarded by X, and the recipe
      re-run: `staleRefDeleted`); TB = merge-base(A, origin/<default>); the record = the note's
      `## Integration log` LAST line when it is `integrated` with a full head and base; case (i) is H == A,
      case (ii) is record.head == H, anything else routes `trouble []`. When the task tree exists it aborts a
      merge left in progress and stashes tracked leftovers (`stashed: integration leftovers <head>`, never
      discarded). When B = origin/<default> equals TB (case i) or record.base (case ii) the route is
      `merge` (no merge commit, no verifier, no tree needed: merge H onto that base), whatever the tree's
      state. Otherwise a missing tree, a tree off its branch or one ahead of origin routes `trouble []`;
      else it fast-forwards the tree only, then merges B into the
      branch (`git merge --no-ff --no-edit -m "Merge origin/<default> into <branch> (Integration)"`, the
      engine's message): a conflict records `conflictFiles`, aborts and routes `trouble ["conflict"]`; any
      other failure aborts and routes `trouble []`; success routes `verify` with `mergeCommit` (unpushed),
      `sharedFiles` (task files over B...H that main changed over TB..B, or record.base..B in case ii)
      and `trouble` ["shared-file"] when there is one, else []. The Inert-path skip (ADR 0045, p29-3): with
      --verifier given and no shared file, one inert check runs there, all of it inside one `try/except
      Exception`: the lazy load of skills/_shared/scripts/inert-paths.py (never at module top, so a broken
      inert-paths.py cannot break push, undo or verify), the repo's `inert_paths` (rollout-settings.py resolve()),
      the path test on TB..B (record.base..B in case ii) and, only when every changed path is inert prose, the
      Inert proof of the matched globs on M's tree with the verifier and bootstrap as steps and places --repo and
      the task tree (inert-paths.py's header holds every rule). Held: route `skip` (mergeCommit M, trouble [],
      the green run stands: push M and merge, no verifier) and a `verify-skipped` Run-record line. Failed: route
      `verify` as today and an `inert-proof-failed` line with the readers. Any exception: no skip, `inert.why`
      `inert check error: <Type>: <msg>` (at most 200 characters), route `verify` exactly as today, exit 0, one
      stderr WARN line and no traceback, and an `inert-proof-failed` line with `error` and `readers: []`
      (best-effort, through reconcile-rollout.py's _event, which never raises). `inert` is always printed:
      {skip, why, globs, changed (at most 200), changedTotal, nonInert (at most 20), readers (at most 20)}; with
      no --verifier, no repo table, an empty list or a refused rollouts.toml (a land.sh timeout included) it gives
      no skip and a `why`. Always prints branch, worktreePath,
      prHead, anchor, taskBase, mainSha, case, route, trouble, reason, landed (one {prUrl, title,
      files, taskPath} per first-parent commit in TB..B whose subject ends ` (#N)` or starts
      `Merge pull request #N `), unlisted (one {sha, subject, files} per other first-parent commit in
      TB..B: pushed without a PR, skipped from landed, which it never empties) and note ("" or why: when
      origin is not a github.com remote and the task's pr: is not a PR URL, landed is [] and that reason
      comes first, then `<n> commit(s) in <TB>..<B> name no PR …` naming each unlisted commit).

  verify --tree T --out O --timeout S [--bootstrap CMD] --verifier CMD [--repo R --detach-at SHA]
         [--slots N --slot-wait W] [--outcome] [--rollout NOTE [--slug SLUG]] [--diff-base REV [--named-rerun CMD]]
      Run the env bootstrap, then the verifier, each `bash -c` in its own session (process group) in T,
      appending to O.log, under one deadline of S seconds. The exit code goes to O.rc, written LAST (tmp +
      rename); O.rc and O.log are removed first, so a missing O.rc means the run did not finish (red). A
      failed bootstrap gives its rc and `env_bootstrap failed; verifier not run`. At the deadline the group
      gets SIGTERM, 10 s, then SIGKILL: rc 124. TERM/INT/HUP to verify itself kill the group the same way:
      rc 128+n. They are held while a step starts, so one landing before its group is recorded still kills it,
      and each step starts with the caller's signal mask. --detach-at adds T as a detached worktree of R at SHA
      (refusing an existing path), locks it with `pid <this process's pid>` so the daily sweep's reaper leaves
      it alone, and removes it (`worktree remove --force --force`) whatever the verdict: the RACE re-verify. Only the verifier's rc is a verdict: a green bootstrap sets none, so a verifier step that never
      starts leaves no O.rc (red), never the bootstrap's 0.
      --slots N --slot-wait W (given together or not at all; one alone is exit 2 with no rc file) first waits,
      up to W seconds, for one of the machine's N verify slots (verify-slot.py, p23-4), as an Integration waiter
      (the priority: agents' runs wait while it does), logging `verify: waiting for one of N verify slots (…)`
      and then `== verify slot k of N after Ns`. Only then does the S-second deadline start: the slot wait never
      counts against it. Each step then runs under verify-slot.py's guard, which shares the slot's lock and ends
      the step's group when verify dies by any means, before the slot frees: so even a SIGKILL of verify, which
      leaves no rc (red), still ends the step. No slot within W: O.rc reads `noslot`, the log says `verify: no
      verify slot within Ws (held: …); verifier not run`, the exit is 75 and the race tree is still removed. An
      unusable slots dir logs a WARN and runs the steps unslotted, still under the guard, with no heat watch.
      The Heat hold (verify-slot.py contract 7, estate ADR 0009 d5): at heavy or worse no slot is free (`verify:
      waiting (heat: <name>)`); at trapping or sleeping a step that holds a slot (the bootstrap or the verifier) is
      stopped through its guard, logged `verify: heat stop (<name>) during the <step>: stopped its process group, no
      verdict; back in line`, its slot released, and verify goes back in line to rerun every step from the beginning,
      each pass under a fresh S-second deadline and from a clean result. Every slot wait, heat hold and heat-stopped
      run counts against W (the first pass always tries once, a re-queue only while W remains), so verify still ends
      within W + S plus one kill grace. When W runs out on a heat hold or after a heat stop: O.rc reads `heat`, the log
      says `verify: no verdict: the Mac was too hot (heat: <name>) within Ws; verifier not run to a verdict (rc
      heat)`, the exit is 76: no verdict, never red. The log keeps every attempt.
      --outcome (reconcile-rollout.py completion-verify --run's, which runs verify as its child while it holds
      the attempt's lock, ADR 0052) changes one thing and nothing else. Its result is O.outcome.json, in
      place of O.rc, which it never writes: removed first, then written at the start ({v, id, sha, ended:
      "running"}) and again at the end ({v, id, sha, ended, rc, step, signal}: ended done | deadline | bootstrap
      | signal | noslot | heat; step the step a deadline ended in), each by tmp + rename, so a reader classifies a run
      by its fields, never by log text, and one that still reads `running` never finished.
      --diff-base REV (the lead's Integration verify, `<mainSha>`, and the RACE re-verify, `<merge>^1`: the task's diff
      is `git diff --name-only REV HEAD` in T) turns on the Flake check (ADR 0050, p29-9), in this same invocation, on
      the same tree and sha, holding the same verify slot. It runs only after the verifier step itself returned
      non-zero (never after a deadline, a bootstrap failure or a signal): the first run's failing ids
      (rr._failing_ids, its `== verifier:` section only) are placed by rr.flake_verdict; no id (`unnamed`), the
      parser's cap reached (`too-many`), an id in no test file (`unplaced`), an unreadable diff (`diff`) or an id whose
      file the diff changes (`touched`) is red at once, as is a red with no --named-rerun (`no-named-rerun`).
      Otherwise --named-rerun CMD (verify-timeout's namedRerun, holding `{tests}` exactly once, replaced by the ids,
      each shlex-quoted) runs as `== named re-run: …` / `== named re-run rc N`, then, green, the verifier once more as
      `== confirming run: …` / `== confirming run rc N`, each under the slot's guard with its own deadline: --timeout
      from its start, capped at verify's own start + the harness bound (7200 s, THREAD_VERIFY_HARNESS_S shrinks it
      in tests) - 600 s; less than a second left is red (`no-time`), nothing run. A red named re-run (`named-red`) or
      confirming run (`confirm-red`) keeps its rc; a deadline is rc 124 (`timeout`); a green confirming run makes the
      rc 0, each first-run id a Flake. O.rc is that final verdict. O.flake.json (removed first, tmp + rename, written
      just before O.rc) records it whenever --diff-base was given and the verifier step started (never on noslot):
      {v: 1, sha (T's HEAD, or --detach-at), diffBase, verdict: green | flake | red, why: "" | unnamed | unplaced |
      too-many | touched | diff | no-named-rerun | named-red | confirm-red | timeout | no-time | signal, failing (the
      first run's ids), touched, flakes, timeout: {run: first | named | confirm, seconds} | null}; a signal mid-run
      leaves it red, why `signal`. reconcile-rollout.py record-verify reads it. --diff-base with --outcome, and a
      --named-rerun with no --diff-base or without exactly one `{tests}`, are exit 2 with no rc file. A heat stop (the
      Heat hold, above) in the named re-run or the confirming run is no verdict, as in the first run: the pass goes back
      in line and the next reruns every step, the Flake check included, from a clean result and a fresh record; the
      ids are always the last pass's first run's. With --rollout, a Flake ends its suite green, and a deadline in
      either run ends it timeout (step verifier).
      --rollout NOTE [--slug SLUG] (p29-10, ADR 0051; --slug only with --rollout, else exit 2) records the suite in
      the rollout's Run record (the note's stem; the tasks dir is its parent): by completion with --outcome, race with
      --detach-at, else integration (with SLUG as its task; a completion suite has none), runner lead. suite-started
      (reconcile-rollout.py suite_started: the tree's sha, dirty and diff, the load, the Mac-wide running count, the
      slot's wait) is written after the slot and before the deadline starts; a stop signal while it is written, the
      vault walk for the count included, takes the signal path as before (128+n, the verifier never started).
      suite-ended is written in the finally, after O.rc or O.outcome.json, with signals ignored there: green (the
      verifier's rc 0), timeout (--timeout and the step), unrun (the env_bootstrap failed), stopped (a signal: no
      vault scan, no log read), else red, with `failing` read from the log on red or timeout. No slot in time writes
      only suite-ended noslot with its wait, and a Heat hold that outlasts the wait only suite-ended heat with its
      wait; a heat stop ends its pass's suite heat (no verdict, no rc, its step), written once its slot is released
      with stops held, and the re-queued pass is a suite of its own. A SIGKILL leaves a started line with no ended
      line. Recording never changes verify's files, output or exit. Without --rollout nothing is recorded.

  base-moved --repo R --pr N --base SHA --main SHA --default B [--refusal N] [--tasks-dir T]
      Why main moved (p29-10, ADR 0051): merge-task.sh calls it at each newly counted exit-3 refusal (its
      record_base_moved; never on "this base was already counted"). It finds the task note whose `pr:` names N
      (_pr_index over the owner/repo of R's origin; none, or one naming no rollout: nothing written), fetches origin's
      B (FETCH_TIMEOUT), reads the first-parent commits base..main and classifies each, oldest first, at most 20
      (_mover: a rollout's merge, source record or note, or a peer's push), then the Inert path test over base..main
      (inert-paths.py's path_test with the repo's `inert_paths`, rollout-settings.py): inertOnly is true when the
      globs are non-empty, paths changed and none is non-Inert, else false, and null beside an `error` when the fetch,
      main's read, the settings or the test fail. It records one base-moved line in the task's rollout record and
      prints one JSON line ({written, why, rollout, task, the fields}). Exit 0 always; 2 on usage. Not guarded:
      merge-task.sh ran engine-snapshot.py guard-pr first.

  push --repo R --slug S --head M
      A plain push of the task tree's M to origin/<branch> (never forced); the ls-remote read-back must
      equal M. Exit 1 when refused.

  undo --repo R --slug S --merge M --to H
      Drop the lead's unpushed merge: only when the tree is on its branch at M, M^1 == H and origin's
      branch is not M. Stashes tracked leftovers, then `git reset --keep H`. Exit 1 otherwise.

  inputs --note N [--max-review-rounds K] [--repo R] [--row FILE|-] [--now T]
      What the lead needs to (re-)enter a set-aside or restarted task: status, scope, pr, prUrl and
      prUrlError (below), readyAt, rung (the
      note's rung record: {startRung: "", rung: <the note's `rung:` when it is a rung name, else "">,
      climbs: []}, so a note with no `rung:`, or only stale legacy stamps, gives the neutral record),
      branch (and worktreePath with --repo);
      the source run (the newer, by its
      `### Run N (<stamp>)` heading, of the latest `## Blocker diagnosis` and `## Review-blocked feedback`
      runs; a tie goes to review-blocked) parsed through a parseIntegrationMarker port (markerStage,
      markerReason, history, lastRound); reviewRoundsUsed = max(1, the note's, lastRound);
      lastIntegration (the log's last line, as fields); resumeAt — `revise` (a revise marker or a
      review-blocked run, and the last line `rejected`), `integration` (the source run starts
      `integration:`, or gate-pending with the last line `set-aside`), else `own`; and autoRevise —
      blocked, the source is the Blocker run, stage revise, markerReason empty, the last line `rejected`,
      a non-empty history and lastRound < K (false without --max-review-rounds).
      integrate (p17-1) is the integrate call's {prUrl, reviewHistory, reviewRoundsUsed, rung} (execute § 4.5
      step 3 passes those four verbatim) plus source, rungSource, rowRefused and prUrlError. --row names the approving
      row's result JSON (a file, or - for stdin: an envelope {rolloutSlug, tasks}, whose one entry for this
      slug is taken, or a bare row). The row is used (source "row") only when it is this note's, `review`,
      its prUrl a PR URL naming the note's pr:, its reviewHistory passing the engine's historyError and its
      reviewRoundsUsed an integer >= 1, >= the history's last round and >= the note's review_rounds_used;
      its rung record when it passes rungRecordError, else the note's (rungSource "note", rowRefused says
      why). Otherwise, and with no --row, the note's: pr, history, reviewRoundsUsed and rung (source "note");
      rowRefused is the one-line reason, or "" with no --row. An unreadable --row is refused, never exit 2.
      prUrl is the note's pr: as a PR URL the engine takes, for the two launches that pass it (step 1.2's
      seeded revise, and the integrate record's when no row is accepted): a bare `#N` (or `N`) is built on
      --repo's GitHub origin (owner/repo), and a trailing / is dropped. prUrlError (top level, and the
      integrate record's when it falls back to the note) is "" when prUrl is one, else why not and the fix
      (no pr:, another form, a bare number with no --repo or no GitHub origin): the lead launches nothing on
      it (a call it launched would fail the engine's args check, which reads as a Lost call).
      Then the automatic retry's verdict (p16-4, ADR 0033; auto_retry_verdict, its rules in order), which every
      caller gets and `reconcile-rollout.py auto-retry` re-runs before it writes: autoRetry, autoRetryWhy (the
      first rule that refused, "" on true), autoRetryError (an `auto_retries` or `max_review_rounds` stamp that is
      not a valid integer: execute § 3's halt, kept under a `## Needs you` question or a recorded answer; else
      null), autoRetryClass (agent | infra | quota, for a note set
      aside at its run or at Integration; else null), autoRetryBudget ({autoRetries, maxReviewRounds}, each
      {value, source}, resolved task -> rollout -> rollouts.toml -> built-in by reconcile-rollout.py
      _retry_budget; null until it resolves), autoRetriesUsed and quotaRetriesUsed (the note's counters, 0 when
      absent, null when malformed), fingerprint (the latest block's run sha), autoRetryRaise (lastRound + 1 when
      a retry re-enters a revise with no round left) and autoRetryAfter (a quota or infra block's cool-down
      end); then humanFix (ADR 0035: null, or {act, detail, handBack, label, raise}, the one fixed act that moves
      a block only a person may move, act one of HUMAN_FIX_ACTS; execute § 6.5 (c), status's Needs-you block and
      repair § 2 print it and never re-derive it) and answerRecorded (reconcile-rollout.py _answer_recorded, read
      for every note: the live `## Repair input` answer to the current block, {stamp, kind, form, line}, or
      null; an answered block is never retried). The rollout note (<note dir>/<rollout>.md) is read and the
      budget resolved only for a note set aside at its run or at Integration, so every other read stays cheap; a
      resolver failure is in the JSON and the exit stays 0.
      --max-review-rounds K that differs from the resolved max_review_rounds means no retry (an overlay: humanFix
      ignores it, and with no answer recorded every other key is as before). --now is the time a cool-down is
      read against (default: now).

  plan --note N
      The task's approved plan, for the one launch that passes it (execute § 4.5 step 1.2's seeded revise,
      as `resume.plan`): {slug, plan}, where plan is the note's `## Approved plan` quote unquoted
      (reconcile-rollout.py approved_plan), or "" when the note has none (its last own call was not
      plan-gated, or it predates p14-2). Step 3's integrate call passes no plan: its integrator reads the
      same `## Approved plan` from the note itself (p27-1). Kept out of `inputs`, which every status and
      repair read prints. Read-only.

  set-aside --note N --kind integration|revise-stopped|own     (the reason on stdin)
      The lead's own set-aside row, for `reconcile-rollout.py reconcile --result -`: {rolloutSlug,
      tasks:[{slug, taskPath, scope, status: blocked, prUrl, blockerDiagnosis, reviewHistory, leadSetAside}]},
      with no `integration` key (so no Integration-log line) and no rung (so reconcile keeps the note's
      `rung:`). leadSetAside is the --kind; the engine never reads it, and reconcile classifies the Run
      record's set-aside by it (p15-2).
      blockerDiagnosis is the
      engine's own rendering: integrationMarker('set-aside', reason, history) for `integration` (it strips
      one leading `integration:`, so merge-task's exit-4 text passes through unchanged, and escapes a reason
      that would read as one of the engine's two named markers, `integration: conflict unresolved in …` or
      `integration: verifier red: …`, as `integration: set aside: <reason>`: the lead never writes either, and
      prepare's own conflict routes to `trouble ["conflict"]`, never a set-aside),
      integrationMarker('revise-stopped', …) for `revise-stopped`, and stageDiagnosis's `own run: `
      escape for `own`; the history is `inputs`' history.

  stamp
      Now, in reconcile's `_stamp` form (the integrate call's startedAt, log-integration's --started).

Exit codes: 0 a verdict (or verify finished; its own exit is the rc), 1 refused (push, undo, prepare without
integrating:), 2 usage or environment, or the Engine snapshot guard (ADR 0043: prepare and set-aside first ask
engine-snapshot.py's guard_task() for the rollout the note's `rollout:` names, loaded from this tree, before any git
call; a rollout stamped with another usable snapshot than this plugin root, or a live one whose snapshot is
unusable, prints its `engine-snapshot: ` line and nothing else: re-run from the root it names; inputs, plan, verify,
push, undo, base-moved and stamp are exempt), 8 retryable (prepare's fetch failed twice), 75 verify got no verify slot in time (O.rc `noslot`),
76 verify's Heat hold outlasted the slot wait (O.rc `heat`). Stdlib only; `Note` and `_stamp` come from
reconcile-rollout.py (importlib), and every git and child process runs with git's repo-local variables
(`git rev-parse --local-env-vars`) scrubbed. The engine copies (ANCHOR_RECIPE, the branch and tree names,
the merge message, integrationMarker, parseIntegrationMarker, stageDiagnosis's escape, and inputs --row's
historyError, rungRecordError, PR_URL and STAGES) are pinned against task.workflow.js by
tests/lead-integrate.test.sh.
"""

import argparse
import importlib.util
import json
import os
import re
import shlex
import signal
import subprocess
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path

sys.dont_write_bytecode = True
_spec = importlib.util.spec_from_file_location("reconcile_rollout", Path(__file__).resolve().parent / "reconcile-rollout.py")
rr = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(rr)
# The machine-wide verify slots and their guard (p23-4): `verify --slots N --slot-wait W`.
_vs_spec = importlib.util.spec_from_file_location("verify_slot", Path(__file__).resolve().parent / "verify-slot.py")
VS = importlib.util.module_from_spec(_vs_spec)
_vs_spec.loader.exec_module(VS)

# ---- engine copies (task.workflow.js; pinned by tests/lead-integrate.test.sh) --------------------------

ANCHOR_RECIPE = ('X=$(git -C "$WT" rev-parse -q --verify "refs/integration-anchor/$BR" 2>/dev/null); '
                 'if [ -n "$X" ]; then if git -C "$WT" merge-base --is-ancestor "$X" "$H"; then echo "anchor $X"; '
                 'else echo "stale-ref $X"; fi; '
                 'else M=$(git -C "$WT" rev-list --first-parent --merges "$D..$H" | tail -n 1); '
                 'if [ -n "$M" ]; then echo "anchor $(git -C "$WT" rev-parse "$M^1")"; '
                 'else echo "anchor $(git -C "$WT" rev-parse "$H")"; fi; fi')
INTEGRATION_PREFIX = "integration: "
REVISE_MARKER = "revise: rejected at Integration re-review — revise on the branch, then re-integrate"
OWN_RUN_PREFIX = "own run: "

# JavaScript's `\s` (and String.prototype.trim's set), so the ports split and trim exactly as the engine.
JS_WS = rr._JS_WS
JS_S = "[\\t\\n\\v\\f\\r \\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]"
JS_DOT = "[^\\n\\r\\u2028\\u2029]"
# The engine's PR_URL: `https://`, then JavaScript's `\S+` (no JS whitespace), `/pull/` and ASCII digits, whole.
ENGINE_PR_URL_RE = re.compile("https://[^" + JS_S[1:] + "+/pull/[0-9]+")
RUNG_STAGES = ("plan", "implement", "review")  # the engine's STAGES


def js_trim(s):
    return str(s).strip(JS_WS)


def short_alias(slug):
    """The engine's shortAlias: drop a leading `<project>-` segment."""
    i = slug.find("-")
    return slug if i == -1 else slug[i + 1:]


def branch_of(slug):
    return f"audit-fix/{short_alias(slug)}"


def worktree_dir(repo, slug):
    """The engine's worktreeDir."""
    return f"{repo}/.claude/worktrees/{slug}"


def merge_message(default, branch):
    """integrationMergeStep's merge message."""
    return f"Merge origin/{default} into {branch} (Integration)"


def flatten_line(s):
    return js_trim(re.sub(JS_S + "*\n" + JS_S + "*", " ", "" if s is None else str(s)))


def marker_history(history):
    out = []
    for r in history or []:
        fb = [f for f in (flatten_line(x) for x in (r.get("feedback") or [])) if f]
        if not fb:
            continue
        head = f"Round {r['round']}{' (Integration)' if r.get('stage') == 'integration' else ''} rejection:\n"
        out.append(head + "\n".join("- " + f for f in fb))
    return "\n\n".join(out)


def integration_marker(kind, reason, history):
    """The engine's integrationMarker: 'rejected', 'revise-stopped' or 'set-aside'."""
    h = marker_history(history)
    tail = "\n\n" + h if h else ""
    if kind == "rejected":
        return REVISE_MARKER + tail
    if kind == "revise-stopped":
        return REVISE_MARKER + "\nrevise stopped: " + flatten_line(reason) + tail
    body = flatten_line(re.sub("^" + JS_S + "*integration:" + JS_S + "*", "", str(reason or ""), flags=re.I))
    # The engine's escape (p27-4): a reason that would read as a named marker (rr.integration_block) is `set aside: `.
    if rr.integration_block(INTEGRATION_PREFIX + body):
        body = "set aside: " + body
    return INTEGRATION_PREFIX + body + tail


def parse_integration_marker(text):
    """The engine's parseIntegrationMarker: {stage: revise|integrate|own, reason, history}."""
    s = "" if text is None else str(text)
    lines = s.split("\n")
    at = next((i for i, l in enumerate(lines) if js_trim(l)), -1)
    first = "" if at == -1 else js_trim(lines[at])
    low = first.lower()
    stage = ("revise" if low.startswith(REVISE_MARKER.split(" — ")[0].lower())
             else "integrate" if low.startswith("integration:") else "own")
    reason = js_trim(s)
    if stage == "integrate":
        reason = re.sub("^integration:" + JS_S + "*", "", first, flags=re.I)
    if stage == "revise":
        stopped = next((l for l in lines if re.match("^revise stopped:", js_trim(l), re.I)), None)
        reason = re.sub("^revise stopped:" + JS_S + "*", "", js_trim(stopped), flags=re.I) if stopped is not None else ""
    history, cur = [], None
    for raw in lines[max(at, 0):]:
        l = js_trim(raw)
        m = re.fullmatch(r"Round ([0-9]+)( \(Integration\))?(?: rejection)?:", l, re.I)
        if m:
            cur = {"round": int(m.group(1)), "feedback": []}
            if m.group(2):
                cur["stage"] = "integration"
            history.append(cur)
            continue
        b = re.fullmatch("- (" + JS_DOT + "+)", l)
        if b and cur is not None:
            cur["feedback"].append(js_trim(b.group(1)))
            continue
        cur = None
    return {"stage": stage, "reason": reason, "history": [r for r in history if r["feedback"]]}


def own_run_diagnosis(d):
    """stageDiagnosis's escape for a task's own run: a diagnosis that would parse as a marker gets `own run: `."""
    return OWN_RUN_PREFIX + d if d and parse_integration_marker(d)["stage"] != "own" else d


def history_error(h, allow_empty):
    """The engine's historyError: '' for a review history it accepts, else why. An integer is a JSON integer
    (`type(x) is int`: never a bool, and a float such as 1.0 is refused, where the engine reads JSON 1.0 as 1)."""
    if not isinstance(h, list):
        return "must be an array"
    if not allow_empty and not h:
        return "must be non-empty"
    prev = 0
    for r in h:
        if not isinstance(r, dict):
            return "entries must be { round, feedback, stage? } objects"
        n = r.get("round")
        if not (type(n) is int and n >= 1):
            return "round must be an integer >= 1"
        if n <= prev:
            return "rounds must be strictly ascending"
        fb = r.get("feedback")
        if not isinstance(fb, list) or any(not isinstance(f, str) for f in fb):
            return f"round {n}: feedback must be an array of strings"
        if "stage" in r and r["stage"] != "integration":
            return f"round {n}: stage must be 'integration' when present"
        prev = n
    if not allow_empty and not any(js_trim(f) for r in h for f in r["feedback"]):
        return "must carry at least one round with feedback"
    return ""


def rung_record_error(g):
    """The engine's rungRecordError for the current shape only, { startRung, rung, climbs } (rung names or '',
    climbs [{ stage, from, to }]): '' or why. A pre-3.0.0 tier record, which the engine reads as neutral, is
    refused here, so a row carrying one falls back to the note's record."""
    name = lambda v: v == "" or rr.is_rung_name(v)  # noqa: E731
    climbs = g.get("climbs") if isinstance(g, dict) else None
    if (not isinstance(g, dict) or sorted(g) != ["climbs", "rung", "startRung"] or not name(g["startRung"])
            or not name(g["rung"]) or not isinstance(climbs, list)
            or any(not isinstance(c, dict) or sorted(c) != ["from", "stage", "to"] or c["stage"] not in RUNG_STAGES
                   or not rr.is_rung_name(c["from"]) or not rr.is_rung_name(c["to"]) for c in climbs)):
        return (f"must be {{ startRung, rung, climbs }} (rung names or '', climbs [{{ stage: {'|'.join(RUNG_STAGES)}, "
                f"from, to }}]), got {json.dumps(g)}")
    return ""


# ---- plumbing ------------------------------------------------------------------------------------------

class Refused(Exception):
    """Exit 1: the verb refused (push, undo, prepare)."""


class EnvError(Exception):
    """Exit 2: usage or environment."""


class Retryable(Exception):
    """Exit 8: nothing decided; retry after a backoff."""


def _scrubbed_env():
    env = dict(os.environ)
    try:
        names = subprocess.run(["git", "rev-parse", "--local-env-vars"], capture_output=True, text=True,
                               env=env).stdout.split()
    except OSError:
        names = []
    for n in names:
        env.pop(n, None)
    return env


ENV = _scrubbed_env()


def git(cwd, *argv):
    try:
        return subprocess.run(["git", "-C", str(cwd), *argv], capture_output=True, text=True, env=ENV)
    except OSError as e:
        raise EnvError(f"git not runnable: {e}")


def out_of(p):
    return p.stdout.strip()


def why(p):
    return (p.stderr.strip() or p.stdout.strip() or f"exit {p.returncode}").splitlines()[-1]


def rev(cwd, ref):
    """The commit a ref names, or '' when it does not resolve."""
    p = git(cwd, "rev-parse", "-q", "--verify", f"{ref}^{{commit}}")
    return out_of(p) if p.returncode == 0 else ""


def emit(obj):
    print(json.dumps(obj, indent=2, ensure_ascii=False))


def _load_note(path):
    p = Path(os.path.expanduser(path))
    if not p.is_file():
        raise EnvError(f"task note not found at {p}")
    try:
        return p, rr.Note(p)
    except ValueError as e:
        raise EnvError(str(e))


def log_fields(line):
    """One Integration log line as fields ('-' -> None), or None."""
    if not line:
        return None
    toks = line.split(" ")
    out = {"line": line, "startedAt": toks[0] if toks[0] != "-" else None,
           "outcome": toks[1] if len(toks) > 1 else None}
    for t in toks[2:]:
        k, _, v = t.partition("=")
        out[k] = None if v in ("", "-") else v
    for k in ("path", "pr", "anchor", "head", "base", "wait", "duration", "triggers"):
        out.setdefault(k, None)
    return out


def last_integration(note):
    """The Integration log's last line as fields, or None (rr._last_log_line: the one p12-16 reader)."""
    return log_fields(rr._last_log_line(note))


# ---- prepare -------------------------------------------------------------------------------------------

def _anchor(repo, br, default, head):
    p = subprocess.run(["bash", "-c", ANCHOR_RECIPE], capture_output=True, text=True,
                       env={**ENV, "WT": str(repo), "BR": br, "D": f"origin/{default}", "H": head})
    m = re.fullmatch(r"(anchor|stale-ref) ([0-9a-f]{40})", p.stdout.strip())
    if p.returncode != 0 or not m:
        raise EnvError(f"ANCHOR_RECIPE gave no anchor for {br} at {head}: {p.stdout.strip() or why(p)}")
    return m.group(1), m.group(2)


def _owner_repo(repo, note):
    m = rr.PR_URL_RE.match(rr._pr(note))
    if m:
        return m.group(1)
    url = out_of(git(repo, "remote", "get-url", "origin"))
    m = re.search(r"github\.com[:/]+([^/\s]+/[^/\s]+?)(?:\.git)?/*$", url)
    return m.group(1) if m else ""


def _pr_index(tasks_dir, owner_repo):
    """PR number -> task note path, over every note under tasks_dir (Archive included)."""
    out = {}
    if not tasks_dir.is_dir():
        return out
    for path in sorted(tasks_dir.rglob("*.md")):
        try:
            head = path.read_text(errors="replace").split("\n---\n", 1)[0]
        except OSError:
            continue
        m = re.search(r"^pr:[ \t]*(.*)$", head, re.M)
        if not m:
            continue
        pr = rr._scalar(m.group(1))
        u, n = rr.PR_URL_RE.match(pr), rr.PR_NUM_RE.match(pr)
        if u and (not owner_repo or u.group(1).lower() == owner_repo.lower()):
            out.setdefault(u.group(2), str(path))
        elif n:
            out.setdefault(n.group(1), str(path))
    return out


def _pr_of_subject(subject):
    """The PR number a first-parent commit's subject names (a squash's trailing ` (#N)`, or `Merge pull request #N `),
    or None: a commit pushed without a PR."""
    m = re.search(r" \(#([0-9]+)\)$", subject) or re.match(r"Merge pull request #([0-9]+) ", subject)
    return m.group(1) if m else None


def _landed(repo, tb, b, owner_repo, tasks_dir):
    """(landed, unlisted, note) over TB..B's first-parent commits, oldest first (p17-1). A commit whose subject
    ends ` (#N)` or starts `Merge pull request #N ` is a landed PR; any other was pushed without one, so it is
    skipped from `landed` and listed in `unlisted` as {sha, subject, files}: one PR-less commit never drops the
    list. `landed` is [] when origin is not a github.com remote and the task's pr: is not a PR URL (no URL to
    build); `note` says why, that reason first, then the unlisted commits."""
    if not tb or not b or tb == b:
        return [], [], ""
    commits = out_of(git(repo, "rev-list", "--first-parent", "--reverse", f"{tb}..{b}")).split()
    found, unlisted = [], []
    for c in commits:
        subject = out_of(git(repo, "log", "-1", "--format=%s", c))
        files = [f for f in out_of(git(repo, "diff", "--name-only", f"{c}^1", c)).split("\n") if f]
        n = _pr_of_subject(subject)
        if n:
            found.append((n, subject, files))
        else:
            unlisted.append({"sha": c, "subject": subject, "files": files})
    why = []
    if found and not owner_repo:
        why.append("origin is not a github.com remote and the task's pr: is not a PR URL")
    if unlisted:
        why.append(f"{len(unlisted)} commit(s) in {tb[:12]}..{b[:12]} name no PR (pushed without one), listed in "
                   "`unlisted`, not in `landed`: " + "; ".join(f"{u['sha'][:12]} {u['subject']!r}" for u in unlisted))
    if not found or not owner_repo:
        return [], unlisted, "; ".join(why)
    index = _pr_index(tasks_dir, owner_repo)
    return [{"prUrl": f"https://github.com/{owner_repo}/pull/{n}", "title": subject, "files": files,
             "taskPath": index.get(n, "")} for n, subject, files in found], unlisted, "; ".join(why)


def _clean_tree(tree):
    """Abort a merge left in progress and stash tracked leftovers (never discard them)."""
    aborted, stashed = False, ""
    if rev(tree, "MERGE_HEAD"):
        p = git(tree, "merge", "--abort")
        if p.returncode != 0:
            raise EnvError(f"could not abort the merge left in progress in {tree}: {why(p)}")
        aborted = True
    if out_of(git(tree, "status", "--porcelain", "--untracked-files=no")):
        stashed = f"integration leftovers {rev(tree, 'HEAD')}"
        p = git(tree, "stash", "push", "--quiet", "-m", stashed)
        if p.returncode != 0 or out_of(git(tree, "status", "--porcelain", "--untracked-files=no")):
            raise EnvError(f"tracked changes in {tree} could not be stashed: {why(p)}")
    return aborted, stashed


def _own_tree(tree):
    """True when `tree` is a git worktree of its own (never a plain directory inside the main checkout)."""
    if not Path(tree).is_dir():
        return False
    top = out_of(git(tree, "rev-parse", "--show-toplevel"))
    return bool(top) and os.path.realpath(top) == os.path.realpath(tree)


def _tree_trouble(tree, br):
    """Why the task tree cannot carry a lead merge ('' when it can), after a fast-forward to origin/<branch>."""
    if not _own_tree(tree):
        return f"no task tree of its own at {tree}"
    cur = out_of(git(tree, "symbolic-ref", "-q", "--short", "HEAD"))
    if cur != br:
        return f"the task tree is on {cur or 'a detached HEAD'}, not {br}"
    ahead = out_of(git(tree, "rev-list", "--count", f"refs/remotes/origin/{br}..HEAD"))
    if ahead != "0":
        return f"the task tree has {ahead} commit(s) origin/{br} lacks"
    p = git(tree, "merge", "--ff-only", "--quiet", f"refs/remotes/origin/{br}")
    if p.returncode != 0:
        return f"could not fast-forward the task tree to origin/{br}: {why(p)}"
    return ""


def cmd_prepare(args):
    repo = Path(os.path.expanduser(args.repo))
    if not out_of(git(repo, "rev-parse", "--git-dir")):
        raise EnvError(f"{repo} is not a git repo")
    _path, note = _load_note(args.note)
    # The lane's stamp (p26-1): step 3 runs mark-integrating before prepare on every route into it, so a note with
    # no `integrating:` is a skipped stamp. Refuse before the fetch, the anchor, any ref deletion, stash or merge.
    if not rr._scalar(note.get("integrating")):
        raise Refused(f"[[{args.slug}]] carries no integrating: — run reconcile-rollout.py mark-integrating --tasks "
                      f"{args.slug} first (execute § 4.5 step 3); nothing fetched or merged")
    tasks_dir = Path(os.path.expanduser(args.tasks_dir)) if args.tasks_dir else _path.parent
    br, tree = branch_of(args.slug), worktree_dir(str(repo), args.slug)
    out = {"slug": args.slug, "branch": br, "worktreePath": tree, "prHead": None, "anchor": None, "taskBase": None,
           "mainSha": None, "case": None, "route": None, "trouble": [], "reason": "", "landed": [], "unlisted": [],
           "mergeCommit": "", "sharedFiles": [], "conflictFiles": [], "staleRefDeleted": None,
           "abortedMerge": False, "stashed": "", "record": None, "note": "",
           "inert": _inert_off("no verify route: no verifier would run, so nothing to skip")}

    for attempt in (1, 2):
        p = git(repo, "fetch", "--prune", "--quiet", "origin")
        if p.returncode == 0:
            break
        if attempt == 2:
            raise Retryable(f"fetch origin failed twice: {why(p)}")
    h = rev(repo, f"refs/remotes/origin/{br}")
    if not h:
        out.update(route="set-aside", reason=f"origin/{br} does not exist — the PR branch is gone")
        return out
    b = rev(repo, f"refs/remotes/origin/{args.default}")
    if not b:
        raise EnvError(f"origin/{args.default} does not exist in {repo}")
    out.update(prHead=h, mainSha=b)

    kind, a = _anchor(repo, br, args.default, h)
    if kind == "stale-ref":
        p = git(repo, "update-ref", "-d", f"refs/integration-anchor/{br}", a)
        if p.returncode != 0:
            raise EnvError(f"could not delete the stale anchor ref refs/integration-anchor/{br} {a}: {why(p)}")
        out["staleRefDeleted"] = a
        kind, a = _anchor(repo, br, args.default, h)
        if kind != "anchor":
            raise EnvError(f"the anchor ref for {br} is still stale after its deletion ({a})")
    tb = out_of(git(repo, "merge-base", a, b))
    if not re.fullmatch(r"[0-9a-f]{40}", tb):
        raise EnvError(f"no merge-base of the anchor {a} and origin/{args.default}")
    out.update(anchor=a, taskBase=tb)
    landed, unlisted, note_why = _landed(repo, tb, b, _owner_repo(repo, note), tasks_dir)
    out.update(landed=landed, unlisted=unlisted, note=note_why)

    last = last_integration(note)
    # Only a complete `integrated` record can back case (ii): its head and base are the pair merge-task needs.
    record = last if (last and last.get("outcome") == "integrated" and re.fullmatch(r"[0-9a-f]{40}", last.get("head") or "")
                      and re.fullmatch(r"[0-9a-f]{40}", last.get("base") or "")) else None
    out["record"] = record
    if h == a:
        out["case"] = "i"
    elif record and record.get("head") == h:
        out["case"] = "ii"

    if _own_tree(tree):
        out["abortedMerge"], out["stashed"] = _clean_tree(tree)
    if out["case"] is None:
        out.update(route="trouble", reason=f"neither clean case: the PR head {h} is not the anchor {a} and "
                   + (f"the last Integration record is {last['outcome']}" if last else "no Integration is recorded")
                   + ("" if not record else f" at head {record.get('head')}"))
        return out
    base = tb if out["case"] == "i" else (record.get("base") or "")
    # The merge route touches no tree (merge-task merges origin's H onto `base`), so the tree's state is read
    # only when the lead must merge main into it: an agent runs only for real trouble (ADR 0030 decision 3).
    if b == base:
        out.update(route="merge", reason=f"origin/{args.default} has not moved since {'the task base' if out['case'] == 'i' else 'the recorded Integration'}")
        return out
    bad = _tree_trouble(tree, br)
    if bad:
        out.update(route="trouble", reason=bad)
        return out
    p = git(tree, "merge", "--no-ff", "--no-edit", "-m", merge_message(args.default, br), b)
    if p.returncode != 0:
        if rev(tree, "MERGE_HEAD"):
            out["conflictFiles"] = [f for f in out_of(git(tree, "diff", "--name-only", "--diff-filter=U")).split("\n") if f]
            git(tree, "merge", "--abort")
            out.update(route="trouble", trouble=["conflict"], reason="merging origin/%s conflicts" % args.default)
        else:
            out.update(route="trouble", reason=f"git merge failed with no conflict: {why(p)}")
        return out
    m = rev(tree, "HEAD")
    task_files = set(f for f in out_of(git(tree, "diff", "--name-only", f"{b}...{h}")).split("\n") if f)
    main_files = set(f for f in out_of(git(tree, "diff", "--name-only", base, b)).split("\n") if f)
    shared = sorted(task_files & main_files)
    if not getattr(args, "verifier", None):
        inert = _inert_off("no --verifier given: the verifier runs")
    elif shared:
        inert = _inert_off(f"{len(shared)} shared file(s) ({', '.join(shared[:3])}): the verifier runs")
    else:
        inert = _inert(args, repo, tree, base, b, m, note)
    if inert["skip"]:
        out.update(route="skip", mergeCommit=m, sharedFiles=[], trouble=[], inert=inert,
                   reason=f"merged origin/{args.default} ({b[:12]}) into {br} as {m[:12]}; main moved only in Inert paths "
                   "and the Inert proof held: the green run stands (ADR 0045): push it and merge, no verifier")
        return out
    out.update(route="verify", mergeCommit=m, sharedFiles=shared, trouble=["shared-file"] if shared else [], inert=inert,
               reason=f"merged origin/{args.default} ({b[:12]}) into {br}: run the verifier on {m[:12]}")
    return out


# ---- the Inert-path skip (ADR 0045, p29-3) -------------------------------------------------------------------

INERT_PATHS = 200
INERT_READERS = 20


def _inert_off(why):
    return {"skip": False, "why": why, "globs": [], "changed": [], "changedTotal": 0, "nonInert": [], "readers": []}


def _load_inert():
    """skills/_shared/scripts/inert-paths.py, loaded lazily (engine guard's pattern): only prepare's inert check reads it."""
    src = Path(__file__).resolve().parent.parent.parent / "_shared" / "scripts" / "inert-paths.py"
    spec = importlib.util.spec_from_file_location("thread_inert_paths", src)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _pick_readers(proof, failed, cap=INERT_READERS):
    """At most `cap` readers, each failed glob's first before any glob's second."""
    keys = ("glob", "path", "kind", "line", "text", "origin")
    queues = [list(proof[g]["readers"]) for g in failed]
    out = []
    while len(out) < cap and any(queues):
        for q in queues:
            if q and len(out) < cap:
                r = q.pop(0)
                out.append({k: r[k] for k in keys if k in r})
    return out


def _inert_event(note, slug, kind, fields):
    try:
        rr._event(rr._note_rollout(note), kind, slug, fields)
    except Exception:   # recording never breaks a verb
        pass


def _inert(args, repo, tree, base, b, m, note):
    """prepare's inert check, failing closed: {skip, why, globs, changed, changedTotal, nonInert, readers}."""
    out = _inert_off("")
    paths, repo_id = [], str(repo)
    try:
        ip = _load_inert()
        try:
            res = ip.RS.resolve(repo=str(repo))
        except ip.RS.SettingsError as e:
            out["why"] = f"rollout settings refused ({e}): the verifier runs"
            return out
        repo_id = res.get("repo") or ip.RS._origin_slug(str(repo)) or str(repo)
        globs = list(res["inert_paths"]["value"])
        if not globs:
            out["why"] = ("inert_paths is empty for this repo" if res["inert_paths"]["source"] == "file:repo" else
                          "no inert_paths for this repo in rollouts.toml") + ": the verifier runs"
            return out
        pt = ip.path_test(str(repo), base, b, globs)
        paths = pt["changed"]
        out.update(globs=pt["globs"], changed=paths[:INERT_PATHS], changedTotal=len(paths),
                   nonInert=pt["nonInert"][:INERT_READERS])
        if pt["nonInert"]:
            out["why"] = (f"{len(pt['nonInert'])} of {len(paths)} changed path(s) are not inert prose "
                          f"({', '.join(pt['nonInert'][:3])}): the verifier runs")
            return out
        proof = ip.prove(str(repo), m, pt["globs"], [("verifier", args.verifier or ""), ("bootstrap", args.bootstrap or "")],
                         places=[str(repo), str(tree)])
        failed = [g for g in pt["globs"] if not proof[g]["held"]]
        fields = {"repo": repo_id, "paths": paths[:INERT_PATHS], "pathsTotal": len(paths), "base": base, "main": b,
                  "head": m, "globs": pt["globs"]}
        if failed:
            readers = _pick_readers(proof, failed)
            first = readers[0] if readers else {"path": "?", "kind": "?"}
            out.update(readers=readers, why=(f"the Inert proof failed for {', '.join(failed)}: {first['path']}"
                                             + (f":{first['line']}" if first.get("line") else "")
                                             + f" ({first['kind']}{', ' + first['origin'] if first.get('origin') else ''})"
                                             + ": the verifier runs"))
            _inert_event(note, args.slug, "inert-proof-failed", dict(fields, readers=readers, failed=failed))
            return out
        out.update(skip=True, why=f"main moved only in Inert paths ({len(paths)} path(s)) and the Inert proof held on "
                                  f"{m[:12]} for {', '.join(pt['globs'])}: the green run stands, no verifier (ADR 0045)")
        _inert_event(note, args.slug, "verify-skipped", fields)
        return out
    except Exception as e:  # fail closed: any error in the check means a re-run, never a crash of prepare
        msg = f"inert check error: {type(e).__name__}: {e}".replace("\n", " ")[:200]
        try:
            print(f"lead-integrate prepare: WARN: {msg}: the verifier runs", file=sys.stderr)
        except Exception:
            pass
        _inert_event(note, args.slug, "inert-proof-failed", {"repo": repo_id, "paths": paths[:INERT_PATHS],
                                                             "pathsTotal": len(paths), "readers": [], "error": msg})
        off = _inert_off(msg)
        off.update(changed=paths[:INERT_PATHS], changedTotal=len(paths))
        return off


# ---- verify --------------------------------------------------------------------------------------------

KILL_GRACE = 10
SIGNALS = (signal.SIGTERM, signal.SIGINT, signal.SIGHUP)
TIMED_OUT = object()


class _Signalled(Exception):
    def __init__(self, signum):
        super().__init__(signum)
        self.signum = signum


_live = {"proc": None, "heat": None}   # the live step; "heat": the level a heat stop read (verify-slot.py, contract 7)


def _on_signal(signum, _frame):
    raise _Signalled(signum)


def _kill_group(proc):
    """SIGTERM the process group, wait up to KILL_GRACE for it to empty, then SIGKILL it."""
    try:
        os.killpg(proc.pid, signal.SIGTERM)
    except (ProcessLookupError, PermissionError):
        proc.poll()
        return
    end = time.monotonic() + KILL_GRACE
    while time.monotonic() < end:
        proc.poll()
        try:
            os.killpg(proc.pid, 0)
        except (ProcessLookupError, PermissionError):
            return
        time.sleep(0.1)
    try:
        os.killpg(proc.pid, signal.SIGKILL)
    except (ProcessLookupError, PermissionError):
        pass
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        pass


def _run_step(cmd, tree, log, deadline, guard=False, slot=None):
    if guard:
        # The Heat hold's stop watches a step only while a slot is held: unslotted (a SlotDirError) it runs unwatched.
        return _run_guarded(cmd, tree, log, deadline, slot, heat=slot is not None)
    # The new group lives in its own session, so a signal that lands before `_live` holds it would leave it running
    # with no limit: hold SIGNALS until it does. The step itself starts with the caller's mask, not the held one.
    mask = signal.pthread_sigmask(signal.SIG_BLOCK, SIGNALS)
    try:
        proc = subprocess.Popen(["bash", "-c", cmd], cwd=tree, stdin=subprocess.DEVNULL, stdout=log,
                                stderr=subprocess.STDOUT, start_new_session=True, env=ENV,
                                preexec_fn=lambda: signal.pthread_sigmask(signal.SIG_SETMASK, mask))
        _live["proc"] = proc
    finally:
        signal.pthread_sigmask(signal.SIG_SETMASK, mask)
    try:
        return proc.wait(timeout=max(0.0, deadline - time.monotonic()))
    except subprocess.TimeoutExpired:
        _kill_group(proc)
        return TIMED_OUT
    finally:
        if proc.poll() is not None:
            _live["proc"] = None


def _run_guarded(cmd, tree, log, deadline, slot, heat=False):
    """A slotted step: `bash -c cmd` under verify-slot.py's guard, which shares the slot's lock and ends the step's
    group if verify dies by any means. Guarded holds SIGNALS across its spawn and records itself in `_live` inside
    that window (on_spawn), as the unslotted step does. A deadline stops it through the guard: TIMED_OUT. With
    `heat`, the Heat hold's stop (verify-slot.py contract 7) watches it too: VS.HEAT_STOPPED, the level in
    `_live["heat"]`."""
    g = VS.Guarded(["bash", "-c", cmd], hold=slot, on_spawn=lambda x: _live.__setitem__("proc", x), cwd=tree,
                   stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT, env=ENV)
    try:
        if slot is not None:
            VS.write_holder(slot, {"pid": os.getpid(), "guard": g.pid, "group": g.group, "cwd": tree,
                                   "since": rr._stamp(datetime.now()), "kind": "verify"})
        got = g.watch(timeout=max(0.0, deadline - time.monotonic()), heat=heat)
        if got is None:
            g.stop()
            return TIMED_OUT
        if got is VS.HEAT_STOPPED:
            _live["heat"] = g.heat
            return VS.HEAT_STOPPED
        return got
    finally:
        if g.done():
            _live["proc"] = None


def _stop_live(live):
    """The signal path's kill of the live step: through its guard when slotted, else its process group."""
    if isinstance(live, VS.Guarded):
        live.stop()
    else:
        _kill_group(live)


def _write_atomic(path, text):
    """O.rc and O.outcome.json: tmp + rename, so a reader never sees half a file."""
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(text)
    os.replace(tmp, path)


# The Flake check (ADR 0050, p29-9): verify --diff-base. A red first run whose failing ids rr.flake_verdict places in
# test files outside the task's diff re-runs them by name (--named-rerun), then confirms with one more verifier run on
# the same tree, under the same slot and guard: green is a Flake. Any other red stays red, with no re-run.
FLAKE_SUFFIX = ".flake.json"
FLAKE_RUN_LABELS = {"named": "named re-run", "confirm": "confirming run"}   # the log's `== <label>:` sections
FLAKE_RUN_WORDS = {run: "the " + label for run, label in FLAKE_RUN_LABELS.items()}
HARNESS_ENV = "THREAD_VERIFY_HARNESS_S"   # tests only: shrinks the harness bound the Flake check's runs fit inside


def _harness_s():
    """The lead's harness bound on the background verify command (7200 s, rr.HARNESS_MAX_S); THREAD_VERIFY_HARNESS_S
    (tests) may only shrink it."""
    try:
        v = float(os.environ.get(HARNESS_ENV) or rr.HARNESS_MAX_S)
    except ValueError:
        v = rr.HARNESS_MAX_S
    return min(v, rr.HARNESS_MAX_S)


def _diff_files(tree, base):
    """The paths `git diff --name-only <base> HEAD` lists in the tree, or None when it cannot be read."""
    p = git(tree, "diff", "--name-only", "--no-renames", base, "HEAD")
    if p.returncode != 0:
        return None
    return {line for line in p.stdout.split("\n") if line}


class _FlakeHeatStop(Exception):
    """A heat stop (verify-slot.py contract 7) in the Flake check's named re-run or confirming run: no verdict, so
    verify's pass goes back in line like a heat stop in the first run. `run` is named | confirm."""

    def __init__(self, run):
        super().__init__(run)
        self.run = run


def _flake_record(sha, base, verdict, why="", failing=(), touched=(), flakes=(), timeout=None):
    """<out>.flake.json: {v, sha, diffBase, verdict: green | flake | red, why, failing, touched, flakes, timeout}."""
    return {"v": 1, "sha": sha, "diffBase": base, "verdict": verdict, "why": why, "failing": list(failing),
            "touched": list(touched), "flakes": list(flakes), "timeout": timeout}


def _suite_record(args):
    """verify's suite in the Run record (p29-10, ADR 0051), or None with no --rollout: the rollout is the note's stem,
    the tasks dir its parent; by is completion with --outcome, race with --detach-at, else integration; runner lead."""
    if not args.rollout:
        return None
    note = Path(os.path.expanduser(args.rollout))
    by = "completion" if args.outcome else "race" if args.detach_at else "integration"
    return {"rollout": note.stem, "task": None if by == "completion" else args.slug, "by": by,
            "suite": rr.new_suite_id(), "tasks_dir": note.parent, "written": {}, "t0": None, "sha": None,
            "waited": None}


def _suite_pass(rec):
    """A fresh suite for verify's next pass (p29-10): the Heat hold's re-queue reruns every step from the beginning, so
    each pass that starts is its own suite-started and suite-ended pair."""
    rec.update(suite=rr.new_suite_id(), written={}, t0=None, sha=None, waited=None)


def _suite_end(rec, rc, result, log_path, args):
    """The suite-ended line: noslot, or heat when the Heat hold held it past the slot wait (no started line: it never
    ran), with its wait; else only after a started line landed: heat on a heat stop (`ended` heat-stop: no verdict, no
    rc, its step), stopped on a signal (no vault scan, no log read), green on the verifier's rc 0, timeout at the
    deadline (its --timeout and step), unrun when the env_bootstrap failed, red otherwise; failing read from the log
    (from `== verifier:` on) on red or timeout. Never raises."""
    try:
        ended = result.get("ended")
        common = (rec["rollout"], rec["task"], rec["suite"], rec["by"], "lead")
        if rc in ("noslot", "heat"):
            rr.suite_ended(*common, rc, 0, tasks_dir=rec["tasks_dir"], waited=rec["waited"],
                           sha=args.detach_at or None)
            return
        if not rec["written"].get("started") or rec["t0"] is None:
            return
        seconds = time.monotonic() - rec["t0"]
        if ended == "heat-stop":
            rr.suite_ended(*common, "heat", seconds, tasks_dir=rec["tasks_dir"], step=result.get("step"),
                           sha=rec["sha"])
            return
        extra = {"rc": rc if isinstance(rc, int) else None, "sha": rec["sha"]}
        if ended == "signal":
            rr.suite_ended(*common, "stopped", seconds, tasks_dir=rec["tasks_dir"], scan=False, **extra)
            return
        if ended == "done" and rc == 0:
            outcome = "green"
        elif ended == "deadline":
            outcome = "timeout"
            extra.update(timeout=args.timeout, step=result.get("step"))
        elif ended == "bootstrap":
            outcome = "unrun"
            extra["step"] = "env_bootstrap"
        else:
            outcome = "red"
        if outcome in ("red", "timeout"):
            try:
                with open(log_path, encoding="utf-8", errors="replace") as f:
                    extra["failing"] = rr._failing_ids(f)
            except OSError:
                pass
        rr.suite_ended(*common, outcome, seconds, tasks_dir=rec["tasks_dir"], **extra)
    except Exception:  # noqa: BLE001 — recording never changes verify's result
        pass


def cmd_verify(args):
    verify_t0 = time.monotonic()   # verify's own start: the Flake check's runs end by it + the harness bound - the margin
    out = Path(os.path.expanduser(args.out))
    rc_path, log_path = Path(f"{out}.rc"), Path(f"{out}.log")
    outcome_path = Path(f"{out}{rr.VERIFY_OUTCOME_SUFFIX}") if args.outcome else None
    flake_path = Path(f"{out}{FLAKE_SUFFIX}")
    out.parent.mkdir(parents=True, exist_ok=True)
    for p in (rc_path, log_path, outcome_path, flake_path):
        if p:
            p.unlink(missing_ok=True)
    if args.timeout <= 0:
        raise EnvError("--timeout must be a positive number of seconds")
    if args.diff_base is not None and args.outcome:
        # The completion verify keeps ADR 0052's own rule: its attempt 2 is the re-run, and there is no task diff.
        raise EnvError("--diff-base is refused with --outcome (the completion verify's Flake is its attempt 2)")
    if args.named_rerun is not None:
        if args.diff_base is None:
            raise EnvError("--named-rerun needs --diff-base (the Flake check)")
        if args.named_rerun.count(rr.NAMED_RERUN_SLOT) != 1:
            raise EnvError(f"--named-rerun must hold {rr.NAMED_RERUN_SLOT} exactly once (where the failing tests go)")
    slotted = args.slots is not None
    if slotted != (args.slot_wait is not None):
        raise EnvError("--slots and --slot-wait go together (both, or neither)")
    if slotted and args.slots < 1:
        raise EnvError("--slots must be an integer >= 1")
    if slotted and args.slot_wait < 0:
        raise EnvError("--slot-wait must be a number of seconds >= 0")
    if args.slug is not None and not args.rollout:
        raise EnvError("--slug goes with --rollout (the Run record's suite lines)")
    rec = _suite_record(args)
    tree = Path(os.path.expanduser(args.tree))
    added = False
    if args.detach_at:
        if not args.repo:
            raise EnvError("--detach-at needs --repo")
        if tree.exists():
            raise EnvError(f"{tree} already exists — refusing to reuse it for a detached verify")
        # A killed verify's registration, locked with its dead pid, outlives its directory: unlock and prune it, or
        # `worktree add` refuses a "missing but locked" path (completion-verify --run does the same for its tree).
        git(os.path.expanduser(args.repo), "worktree", "unlock", str(tree))
        git(os.path.expanduser(args.repo), "worktree", "prune")
        p = git(os.path.expanduser(args.repo), "worktree", "add", "--quiet", "--detach", str(tree), args.detach_at)
        if p.returncode != 0:
            raise EnvError(f"could not add a detached worktree at {tree} ({args.detach_at}): {why(p)}")
        added = True
    elif not tree.is_dir():
        raise EnvError(f"no tree at {tree}")
    rc = None
    slot = None
    result = {"v": 1, "id": rr._run_id(datetime.now(), os.getpid()), "sha": args.detach_at,
              "ended": "running"}
    # The Flake check's record, <out>.flake.json: written whenever --diff-base was given and the verifier step started
    # (never on noslot); a signal mid-check leaves it red, why `signal`.
    flake_on = args.diff_base is not None
    flake = None
    tree_sha = (args.detach_at or rev(str(tree), "HEAD")) if flake_on else ""
    try:
        for s in SIGNALS:   # inside the try, so a signal that lands at once still removes the tree
            signal.signal(s, _on_signal)
        if added:
            # Locked with this pid, best-effort as the engine's own tree lock is: the daily sweep's reaper skips a
            # tree locked by a live pid, so a RACE re-verify's tree is never removed under its suite. Inside the try,
            # so the finally's `remove --force --force` takes a tree a stop left locked.
            git(os.path.expanduser(args.repo), "worktree", "lock", "--reason", f"pid {os.getpid()}", str(tree))
        if outcome_path:
            _write_atomic(outcome_path, json.dumps(result) + "\n")
        with open(log_path, "ab", buffering=0) as log:
            note = lambda msg: log.write((msg + "\n").encode())  # noqa: E731
            # The Heat hold (verify-slot.py contract 7): a step a heat stop ended goes back in line and every step
            # reruns from the beginning, under a fresh deadline. Every slot wait, heat hold and heat-stopped run counts
            # against W (t0 is taken before the first acquire), and a pass starts only while W remains.
            t0 = time.monotonic()
            why = {"heat": None}   # acquire's: the level that held its last poll, or None
            stopped = None         # the heat name of the last heat stop
            first = True
            while True:
                # Each pass starts clean: no verdict, no step or signal, no live step, no slot, no Flake record.
                rc = None
                flake = None
                result["ended"] = "running"
                result.pop("step", None)
                result.pop("signal", None)
                _live["proc"] = _live["heat"] = None
                if slot is not None:
                    slot.release()  # a close, never LOCK_UN (verify-slot.py's contract)
                    slot = None
                if slotted:
                    # The Integration priority (p23-4): wait for a verify slot BEFORE the deadline starts, so the wait
                    # never counts against --timeout. An unusable slots dir fails open: unslotted, still guarded, with
                    # no heat watch, and that pass is the last. The first pass always tries (a W of 0: one try); a
                    # re-queue only while W remains.
                    budget = args.slot_wait - (0.0 if first else time.monotonic() - t0)
                    tries, first = first or budget > 0, False
                    waiting = time.monotonic()
                    try:
                        slot = (VS.acquire(args.slots, max_wait=max(0.0, budget), priority=True, kind="verify", why=why,
                                           on_wait=lambda m: note(f"verify: {m}")) if tries else None)
                    except VS.SlotDirError as e:
                        note(f"verify: WARN {e}; running unslotted")
                    else:
                        if slot is None:
                            if why["heat"] is not None or stopped is not None:
                                name = VS.heat_name(why["heat"]) if why["heat"] is not None else stopped
                                note(f"verify: no verdict: the Mac was too hot (heat: {name}) within "
                                     f"{args.slot_wait:g}s; verifier not run to a verdict (rc heat)")
                                rc = "heat"
                                result["ended"] = "heat"
                            else:
                                held = VS.held_by(args.slots) or "none read held"
                                note(f"verify: no verify slot within {args.slot_wait:g}s (held: {held}); "
                                     "verifier not run")
                                rc = "noslot"
                                result["ended"] = "noslot"
                            if rec is not None:
                                rec["waited"] = time.monotonic() - waiting
                            break
                        note(f"== verify slot {slot.index + 1} of {args.slots} after {slot.waited:.0f}s")
                        VS.write_holder(slot, {"pid": os.getpid(), "guard": None, "group": None, "cwd": str(tree),
                                               "since": rr._stamp(datetime.now()), "kind": "verify"})
                if rec is not None:
                    # p29-10: the suite's start, after the slot and before the deadline; a stop here takes the signal
                    # path below (reraise), and the record's own write never swallows it.
                    state = rr.tree_state(tree)
                    rec["sha"] = state.get("sha")
                    rec["t0"] = time.monotonic()   # before the write: a stop delivered as it ends still gets its end
                    rr.suite_started(rec["rollout"], rec["task"], rec["suite"], rec["by"], "lead", state,
                                     tasks_dir=rec["tasks_dir"], waited=slot.waited if slot is not None else None,
                                     reraise=(_Signalled,), written=rec["written"])
                deadline = time.monotonic() + args.timeout
                steps = ([("env_bootstrap", args.bootstrap)] if args.bootstrap else []) + [("verifier", args.verifier)]
                heat_step = heat_where = None
                for name, cmd in steps:
                    note(f"== {name}: {cmd}")
                    if name == "verifier" and flake_on:
                        flake = _flake_record(tree_sha, args.diff_base, "red", "signal")   # until the check decides
                    got = _run_step(cmd, str(tree), log, deadline, guard=slotted, slot=slot)
                    if got is VS.HEAT_STOPPED:
                        heat_step = name
                        break
                    if got is TIMED_OUT:
                        note(f"verify: timed out after {args.timeout:g}s during the {name}; killed its process group (rc 124)")
                        rc = 124
                        result.update(ended="deadline", step=name)
                        if flake is not None:
                            # A timeout names no failing test, so it is never a Flake: red, logged as load (ADR 0051).
                            flake = _flake_record(tree_sha, args.diff_base, "red", "timeout",
                                                  timeout={"run": "first", "seconds": max(1, int(round(args.timeout)))})
                        break
                    note(f"== {name} rc {got}")
                    if name == "env_bootstrap" and got != 0:
                        note("env_bootstrap failed; verifier not run")
                        rc = got
                        result["ended"] = "bootstrap"
                        break
                    if name == "verifier":
                        # Only the verifier's own rc is the verdict: a green bootstrap sets nothing, so a verifier
                        # step that never starts (a raise) leaves no rc, which reads as red.
                        rc = got
                        result["ended"] = "done"
                        if flake is not None:
                            try:
                                rc, flake = _flake_check(args, tree, tree_sha, log, log_path, note, slotted, slot, rc,
                                                         verify_t0)
                            except _FlakeHeatStop as h:
                                # A heat stop in the named re-run or the confirming run is no verdict, as in the first
                                # run: this pass goes back in line, and the next reruns every step from a clean result.
                                heat_step, heat_where = name, FLAKE_RUN_LABELS[h.run]
                            else:
                                if flake["timeout"] is not None:
                                    # A deadline in the named re-run or the confirming run: the suite ends timeout.
                                    result.update(ended="deadline", step=name)
                if heat_step is None:   # only a watched step (a slot held) is ever heat-stopped
                    break
                stopped = VS.heat_name(_live["heat"])
                note(f"verify: heat stop ({stopped}) during the {heat_where or heat_step}: stopped its process group, "
                     "no verdict; back in line")
                if rec is not None:
                    # p29-10: the heat-stopped pass's suite ends `heat` (no verdict, no rc) once its slot is released,
                    # with stops held for the write, so a stop meanwhile ends no suite twice; the next pass is a suite
                    # of its own.
                    with rr._signals_held():
                        if slot is not None:
                            slot.release()  # a close, never LOCK_UN (verify-slot.py's contract)
                            slot = None
                        _suite_end(rec, None, {"ended": "heat-stop", "step": heat_step}, log_path, args)
                        _suite_pass(rec)
    except _Signalled as s:
        if _live["proc"] is not None:
            _stop_live(_live["proc"])
        rc = 128 + s.signum
        result.update(ended="signal", signal=s.signum)
        try:
            with open(log_path, "ab") as log:
                log.write(f"verify: stopped by signal {s.signum}; killed the process group (rc {rc})\n".encode())
        except OSError:
            pass
    finally:
        for s in SIGNALS:
            signal.signal(s, signal.SIG_IGN)
        if slot is not None:
            slot.release()  # a close, never LOCK_UN (verify-slot.py's contract)
        if added:
            git(os.path.expanduser(args.repo), "worktree", "remove", "--force", "--force", str(tree))
            git(os.path.expanduser(args.repo), "worktree", "prune")
        if flake is not None:
            # Before the rc, which stays the last file written: a reader that sees the rc sees this run's record.
            try:
                _write_atomic(flake_path, json.dumps(flake, ensure_ascii=False) + "\n")
            except OSError:
                pass
        if rc is not None:
            if outcome_path:
                # --outcome's result is the outcome file alone: no O.rc, the file heartbeat clause (4) acts on.
                result["rc"] = rc
                _write_atomic(outcome_path, json.dumps(result) + "\n")
            else:
                _write_atomic(rc_path, f"{rc}\n")
        # p29-10: the suite's end, after the rc or outcome file, with signals ignored, so recording never delays the
        # result a caller waits on and only a SIGKILL cuts it (a started line with no ended line).
        if rec is not None:
            _suite_end(rec, rc, result, log_path, args)
    print(f"verify: rc={rc} (log {log_path})")
    if rc == "noslot":
        return 75
    if rc == "heat":
        return VS.HEAT_EXIT
    return rc if isinstance(rc, int) and 0 <= rc <= 255 else 1


def _flake_check(args, tree, sha, log, log_path, note, slotted, slot, rc, t0):
    """The Flake check on a finished first run (ADR 0050): (the final rc, the flake record). Green (rc 0) is green. A
    red reads its failing ids from the first run's log section (rr._failing_ids) and places them (rr.flake_verdict):
    anything but `candidates` is red at once; else, with --named-rerun, the named re-run, then one confirming verifier
    run, each under the slot and guard the first run held and its own deadline (_flake_deadline). The named re-run's
    red keeps its rc, the confirming run's red its own; the confirming run's green makes the rc 0 and each first-run
    id a Flake. A heat stop in either run raises _FlakeHeatStop: no verdict, and the caller's pass goes back in line.
    The ids are the last pass's first run's: rr._failing_ids reads the log's last `== verifier:` section."""
    base = args.diff_base
    if rc == 0:
        return 0, _flake_record(sha, base, "green")
    with open(log_path, errors="replace") as fh:
        ids = rr._failing_ids(fh)
    diff = _diff_files(str(tree), base) if ids else set()
    placed = rr.flake_verdict(ids, str(tree), diff)
    verdict = placed["verdict"]

    def red(why, code=rc, **kw):
        return code, _flake_record(sha, base, "red", why, ids, placed["touched"], **kw)

    if verdict != "candidates":
        note(f"verify: Flake check: red at once ({verdict}): " + (", ".join(ids[:10]) or "no failing test named"))
        return red(verdict)
    if not args.named_rerun:
        note("verify: Flake check: red (no --named-rerun, so the failing tests cannot be re-run by name)")
        return red("no-named-rerun")
    quoted = " ".join(shlex.quote(i) for i in ids)
    for run, cmd in (("named", args.named_rerun.replace(rr.NAMED_RERUN_SLOT, quoted)), ("confirm", args.verifier)):
        label = FLAKE_RUN_LABELS[run]
        deadline = _flake_deadline(args, t0)
        if deadline is None:
            note(f"verify: Flake check: red (no harness time left for {FLAKE_RUN_WORDS[run]})")
            return red("no-time")
        started = time.monotonic()
        note(f"== {label}: {cmd}")
        got = _run_step(cmd, str(tree), log, deadline, guard=slotted, slot=slot)
        if got is VS.HEAT_STOPPED:
            raise _FlakeHeatStop(run)
        if got is TIMED_OUT:
            secs = max(1, int(round(deadline - started)))
            note(f"verify: timed out after {secs}s during {FLAKE_RUN_WORDS[run]}; killed its process group (rc 124)")
            return red("timeout", 124, timeout={"run": run, "seconds": secs})
        note(f"== {label} rc {got}")
        if got != 0:
            note(f"verify: Flake check: red ({FLAKE_RUN_WORDS[run]} failed again)")
            return red("named-red" if run == "named" else "confirm-red", got)
    note("verify: Flake check: green on the confirming run; a Flake: " + ", ".join(ids))
    return 0, _flake_record(sha, base, "flake", "", ids, [], ids)


def _flake_deadline(args, t0):
    """A Flake-check run's deadline: --timeout from now, capped where the lead's harness bound (less its margin) ends,
    counted from verify's own start; None when that leaves under a second."""
    cap = t0 + _harness_s() - rr.VERIFY_HARNESS_MARGIN
    now = time.monotonic()
    if cap - now < 1:
        return None
    return min(now + args.timeout, cap)


# ---- base-moved: why main moved (p29-10, ADR 0051) ---------------------------------------------------------------

FETCH_TIMEOUT = 60   # the line's caps are run_record.py's: MAX_MOVERS, MAX_NON_INERT and MAX_GLOBS


def _pr_number(value):
    """argparse type for base-moved --pr: a positive PR number (merge-task.sh normalises a URL to it first)."""
    if not re.fullmatch(r"[1-9][0-9]*", value or ""):
        raise argparse.ArgumentTypeError(f"not a PR number: {value!r}")
    return int(value)


def _merged_prs():
    """[(rollout, task, pr)] for every `merged` line carrying a pr in every rollout's Run record (the reserved files
    never read). Unscoped: _mover matches each pr, a URL on owner/name and a bare number on the PR index's task."""
    run_record = rr._run_record()
    try:
        base = run_record.events_dir()
        names = sorted(os.listdir(base))
    except (OSError, ValueError):
        return []
    out = []
    reserved = {r + ".jsonl" for r in run_record.RESERVED}
    for name in names:
        if not name.endswith(".jsonl") or name in reserved:
            continue
        try:
            lines = rr._record_lines(os.path.join(base, name))[0]
        except OSError:
            continue
        for d in lines:
            if d.get("kind") == "merged" and d.get("pr") not in (None, "") and isinstance(d.get("task"), str):
                out.append((d.get("rollout") or name[:-6], d["task"], d["pr"]))
    return out


def _mover(sha, n, owner_repo, index, merged):
    """One commit that moved main: a rollout's merge (source record: a `merged` line names its PR, a URL matched on
    owner/name ignoring case, or a bare number whose line's task is the PR index's task; source note: else the PR's
    task note carries `rollout:`), or a peer's push (anything else, a PR-less commit included)."""
    mover = {"sha": sha, "kind": "peer"}
    if not n:
        return mover
    mover["pr"] = int(n)
    index_task = Path(index[n]).stem.lower() if n in index else None
    for rollout, task, pr in merged:
        u = rr.PR_URL_RE.match(pr) if isinstance(pr, str) else None
        if u:
            hit = u.group(2) == n and bool(owner_repo) and u.group(1).lower() == owner_repo.lower()
        else:
            num = rr.PR_NUM_RE.match(str(pr))
            hit = bool(num) and num.group(1) == n and index_task is not None and task == index_task
        if hit:
            mover.update(kind="rollout", rollout=rollout, task=task, source="record")
            return mover
    if n in index:
        try:
            note = rr.Note(Path(index[n]))
        except (OSError, ValueError):
            return mover
        ro = rr._note_rollout(note)
        if ro:
            mover.update(kind="rollout", rollout=ro.lower(), task=Path(index[n]).stem.lower(), source="note")
    return mover


def cmd_base_moved(args):
    """merge-task.sh's exit-3 record (p29-10): find the task whose note's pr: names --pr, fetch origin's default, read
    the first-parent commits base..main and classify each (_mover), run the Inert path test over base..main, and
    record one base-moved line in the task's rollout record. Prints one JSON line; exit 0 always (2 on usage)."""
    repo = Path(os.path.expanduser(args.repo))
    out = {"written": False, "why": ""}
    try:
        url = out_of(git(repo, "remote", "get-url", "origin"))
        m = re.search(r"github\.com[:/]+([^/\s]+/[^/\s]+?)(?:\.git)?/*$", url)
        owner_repo = m.group(1) if m else ""
        tasks_dir = Path(os.path.expanduser(args.tasks_dir)) if args.tasks_dir else rr.DEFAULT_TASKS_DIR
        index = _pr_index(tasks_dir, owner_repo)
        path = index.get(str(args.pr))
        note = rr.Note(Path(path)) if path else None
        rollout = rr._note_rollout(note) if note is not None else None
        if not rollout:
            out["why"] = (f"no task note's pr: names #{args.pr}" if note is None
                          else f"{Path(path).stem} names no rollout")
            print(json.dumps(out))
            return 0
        fields = {"repo": owner_repo or str(repo), "pr": args.pr, "base": args.base, "main": args.main}
        error, movers, total, inert = None, [], 0, None
        run_record = rr._run_record()
        try:
            f = subprocess.run(["git", "-C", str(repo), "fetch", "--quiet", "origin", args.default], capture_output=True,
                               text=True, env=ENV, timeout=FETCH_TIMEOUT)
            if f.returncode != 0:
                error = f"git fetch origin {args.default} failed: {why(f)}"
        except subprocess.TimeoutExpired:
            error = f"git fetch origin {args.default} timed out after {FETCH_TIMEOUT} s"
        except OSError as e:
            error = f"git fetch origin {args.default} would not run: {e}"
        if error is None:
            p = git(repo, "rev-list", "--first-parent", "--reverse", f"{args.base}..{args.main}")
            if p.returncode != 0:
                error = f"main {args.main[:12]} is not readable here: {why(p)}"
            else:
                commits = out_of(p).split()
                total = len(commits)
                merged = _merged_prs()
                for c in commits[:run_record.MAX_MOVERS]:
                    subject = out_of(git(repo, "log", "-1", "--format=%s", c))
                    movers.append(_mover(c, _pr_of_subject(subject), owner_repo, index, merged))
        if error is None:
            try:
                ip = _load_inert()
                res = ip.RS.resolve(repo=str(repo))
                globs = list(res["inert_paths"]["value"])
                pt = ip.path_test(str(repo), args.base, args.main, globs)
                paths = pt["changed"]
                fields.update(pathsTotal=len(paths), nonInert=pt["nonInert"][:run_record.MAX_NON_INERT])
                if globs:
                    fields["globs"] = globs[:run_record.MAX_GLOBS]
                inert = bool(globs) and bool(paths) and not pt["nonInert"]
            except Exception as e:  # noqa: BLE001 — the settings or the test failed: null beside its error
                error = f"inert test: {type(e).__name__}: {e}"
        fields.update(inertOnly=inert, moversTotal=total, movers=movers)
        if error is not None:
            fields["error"] = error.replace("\n", " ")[:200]
        if args.refusal is not None and args.refusal >= 1:
            fields["refusal"] = args.refusal
        out.update(rollout=rollout.lower(), task=Path(path).stem.lower(), **fields)
        out["written"] = bool(rr._event(rollout, "base-moved", Path(path).stem, fields))
    except Exception as e:  # noqa: BLE001 — recording never changes merge-task's exit
        out["why"] = f"{type(e).__name__}: {e}"
    print(json.dumps(out))
    return 0


# ---- push / undo ---------------------------------------------------------------------------------------

def _remote_head(tree, br):
    p = git(tree, "ls-remote", "origin", f"refs/heads/{br}")
    if p.returncode != 0:
        raise Refused(f"cannot read origin's {br}: {why(p)}")
    return (out_of(p).split() or [""])[0]


def cmd_push(args):
    br, tree = branch_of(args.slug), worktree_dir(os.path.expanduser(args.repo), args.slug)
    head = rev(tree, "HEAD")
    if head != args.head:
        raise Refused(f"the task tree {tree} is at {head or 'nothing'}, not {args.head}")
    p = git(tree, "push", "--quiet", "origin", f"{args.head}:refs/heads/{br}")
    if p.returncode != 0:
        raise Refused(f"push of {args.head} to origin/{br} refused: {why(p)}")
    got = _remote_head(tree, br)
    if got != args.head:
        raise Refused(f"origin/{br} reads {got or 'nothing'} after the push, not {args.head}")
    return {"pushed": args.head, "branch": br}


def cmd_undo(args):
    br, tree = branch_of(args.slug), worktree_dir(os.path.expanduser(args.repo), args.slug)
    if out_of(git(tree, "symbolic-ref", "-q", "--short", "HEAD")) != br:
        raise Refused(f"the task tree {tree} is not on {br}")
    if rev(tree, "HEAD") != args.merge:
        raise Refused(f"the task tree is not at the merge {args.merge}")
    if rev(tree, f"{args.merge}^1") != args.to:
        raise Refused(f"{args.merge}'s first parent is not {args.to}")
    if _remote_head(tree, br) == args.merge:
        raise Refused(f"origin/{br} already holds {args.merge} — never undo a pushed merge")
    stashed = ""
    if out_of(git(tree, "status", "--porcelain", "--untracked-files=no")):
        stashed = f"integration leftovers {args.merge}"
        p = git(tree, "stash", "push", "--quiet", "-m", stashed)
        if p.returncode != 0:
            raise Refused(f"tracked changes in {tree} could not be stashed: {why(p)}")
    p = git(tree, "reset", "--keep", "--quiet", args.to)
    if p.returncode != 0:
        raise Refused(f"git reset --keep {args.to} failed: {why(p)}")
    return {"undone": args.merge, "head": args.to, "stashed": stashed}


# ---- inputs / set-aside --------------------------------------------------------------------------------

def _latest_run(note, heading):
    """{text, at} of a section's latest run (at: its heading's stamp, None for legacy text), or None."""
    found = note._section_bounds(heading)
    if found is None:
        return None
    runs = note.run_blocks(heading)
    if runs:
        top = rr._top_run(runs)
        m = rr.RUN_HEAD_RE.match(found[0][top["head"]])
        text, at = top["content"], rr._parse_ts(m.group(2)) if m else None
    else:
        text, at = note.latest_run_text(heading), None
    return {"text": text, "at": at} if text else None


def _one_line(e):
    return (str(e).strip().splitlines() or [e.__class__.__name__])[0]


def _read_row(spec, slug):
    """(row, why): the approving row `--row` names (a file, or - for stdin). An envelope {rolloutSlug, tasks}
    gives its one entry whose slug is the note's (case-insensitive); a bare row (an object with a slug and no
    tasks) is taken as it is. Anything unreadable is (None, a one-line reason), never an exit."""
    try:
        text = sys.stdin.read() if spec == "-" else Path(os.path.expanduser(spec)).read_text()
    except (OSError, UnicodeDecodeError) as e:
        return None, f"--row {spec} is unreadable: {_one_line(e)}"
    if not text.strip():
        return None, f"--row {spec} is empty"
    try:
        data = json.loads(text)
    except ValueError as e:
        return None, f"--row {spec} is not JSON: {_one_line(e)}"
    if not isinstance(data, dict):
        return None, f"--row {spec} is not a JSON object"
    if "tasks" in data:
        tasks = data["tasks"] if isinstance(data["tasks"], list) else []
        hits = [r for r in tasks if isinstance(r, dict) and isinstance(r.get("slug"), str)
                and r["slug"].casefold() == slug.casefold()]
        if len(hits) != 1:
            return None, f"--row {spec} holds {len(hits)} entries for {slug} in its tasks, not one"
        return hits[0], ""
    if "slug" in data:
        return data, ""
    return None, f"--row {spec} is neither an envelope {{rolloutSlug, tasks}} nor a row with a slug"


def _same_pr(url, pr):
    """True when the row's PR URL names the note's `pr:` (a URL, one trailing / and case ignored, or a bare #N)."""
    n = rr.PR_NUM_RE.match(pr)
    if n:
        return int(url.rsplit("/", 1)[1]) == int(n.group(1))
    return url.lower() == (pr[:-1] if pr.endswith("/") else pr).lower()


def _row_error(inp, note, row):
    """Why the approving row cannot back the integrate call ('' when it can): it must be this note's, approved
    (`review`), carry the note's PR as a PR URL, and pass the engine's args check on its history and rounds,
    with at least the note's `review_rounds_used`."""
    slug = row.get("slug")
    if not isinstance(slug, str) or slug.casefold() != inp["slug"].casefold():
        return f"the row's slug {json.dumps(slug)} is not {inp['slug']}"
    if row.get("status") != "review":
        return f"the row's status is {json.dumps(row.get('status'))}, not \"review\" (only an approving row is used)"
    url = row.get("prUrl")
    if not isinstance(url, str) or not ENGINE_PR_URL_RE.fullmatch(url):
        return f"the row's prUrl {json.dumps(url)} is not a PR URL (…/pull/<n>)"
    if not inp["pr"]:
        return "the note has no pr: to check the row's prUrl against"
    if not _same_pr(url, inp["pr"]):
        return f"the row's prUrl {url} is not the note's pr: {inp['pr']}"
    he = history_error(row.get("reviewHistory"), True)
    if he:
        return "the row's reviewHistory " + he
    h, used = row["reviewHistory"], row.get("reviewRoundsUsed")
    last = h[-1]["round"] if h else 0
    floor = rr._int_field(note.get("review_rounds_used"), 0)
    if not (type(used) is int and used >= 1 and used >= last and used >= floor):
        return (f"the row's reviewRoundsUsed {json.dumps(used)} is not an integer >= 1, >= its history's last round "
                f"({last}) and >= the note's review_rounds_used ({floor})")
    return ""


def _note_pr_url(pr, note, repo):
    """(url, why): the note's `pr:` as the PR URL the engine's args check (prIdentityError) takes (p17-1), for the
    two launches that pass the note's PR: execute § 4.5 step 1.2's seeded revise (`inputs`' prUrl) and step 3's
    integrate call when no row is accepted (the integrate record's). A URL the engine takes passes verbatim; a
    GitHub PR URL with a trailing / loses it; a bare number (`#N` or `N`, a hand-written form _same_pr accepts) is
    built on origin's owner/repo (_owner_repo, read in --repo). Otherwise (no pr:, another form, or a bare number
    with no --repo or no GitHub origin) the note's value stays and `why` says what the engine would refuse and
    the fix; '' when url passes."""
    if not pr:
        return pr, "the note has no pr:, so there is no PR to launch on: stamp the task's PR URL as its pr:"
    if ENGINE_PR_URL_RE.fullmatch(pr):
        return pr, ""
    m, n = rr.PR_URL_RE.match(pr), rr.PR_NUM_RE.match(pr)
    if m:
        return f"https://github.com/{m.group(1)}/pull/{m.group(2)}", ""
    if n:
        owner = _owner_repo(os.path.expanduser(repo), note) if repo else ""
        if owner:
            return f"https://github.com/{owner}/pull/{int(n.group(1))}", ""
        where = "no --repo was given" if not repo else f"--repo {repo} has no GitHub origin to build it on"
        return pr, (f"the note's pr: {pr} is a bare number and {where}, so no PR URL can be built from it: stamp "
                    f"the task's PR URL as its pr:")
    return pr, f"the note's pr: {pr} is not a PR URL (…/pull/<n>) or a PR number: stamp the task's PR URL as its pr:"


def integrate_record(inp, note, row, why):
    """The integrate call's prUrl, reviewHistory, reviewRoundsUsed and rung (execute § 4.5 step 3, p17-1): the
    approving row's (source "row") when it was read and _row_error passes, else the note's: `inputs`' prUrl (the
    note's pr: as a PR URL, _note_pr_url), history, reviewRoundsUsed and rung record (source "note"). An accepted row whose rung record fails rung_record_error keeps the row and takes the note's
    rung record (rungSource "note"). rowRefused is the one reason ('' with no --row, or when nothing was
    refused); prUrlError is why prUrl is no PR URL the engine takes ('' when it is: the lead launches nothing
    on a non-empty one)."""
    rec = {"prUrl": inp["prUrl"], "reviewHistory": inp["history"], "reviewRoundsUsed": inp["reviewRoundsUsed"],
           "rung": inp["rung"], "source": "note", "rungSource": "note", "rowRefused": "", "prUrlError": inp["prUrlError"]}
    if row is None and not why:
        return rec
    refused = why or _row_error(inp, note, row)
    if refused:
        rec["rowRefused"] = refused
        return rec
    rung = {k: row.get(k) for k in ("startRung", "rung", "climbs")}
    bad = rung_record_error(rung)
    rec.update(prUrl=row["prUrl"], reviewHistory=row["reviewHistory"], reviewRoundsUsed=row["reviewRoundsUsed"],
               source="row", prUrlError="")
    if bad:
        rec["rowRefused"] = f"the row's rung record is missing or malformed ({bad}): the note's is used"
    else:
        rec.update(rung=rung, rungSource="row")
    return rec


def task_inputs(path, note, max_rounds=None, repo=None, row=None):
    status = rr._status(note)
    blk = _latest_run(note, rr.BLOCKED_SECTIONS["blocked"])
    rvb = _latest_run(note, rr.BLOCKED_SECTIONS["review-blocked"])
    if blk and rvb:
        newer = blk["at"] is not None and (rvb["at"] is None or blk["at"] > rvb["at"])
        source, run = ("blocker", blk) if newer else ("review-blocked", rvb)
    elif blk or rvb:
        source, run = ("blocker", blk) if blk else ("review-blocked", rvb)
    else:
        source, run = "", None
    parsed = parse_integration_marker(run["text"] if run else "")
    history = parsed["history"]
    last_round = history[-1]["round"] if history else 0
    last = last_integration(note)
    last_outcome = last.get("outcome") if last else None
    if (parsed["stage"] == "revise" or source == "review-blocked") and last_outcome == "rejected":
        resume_at = "revise"
    elif (source and parsed["stage"] == "integrate") or (status == rr.GATE_PENDING_STATUS and last_outcome == "set-aside"):
        resume_at = "integration"
    else:
        resume_at = "own"
    # The note's rung (ADR 0029) as the integrate call's rung record: Integration runs on the ladder's top rung
    # whatever this says, so a note with no valid `rung:` gives the neutral record, never a guess.
    rung = rr._scalar(note.get("rung"))
    if not rr.is_rung_name(rung):
        rung = ""
    pr = rr._pr(note) or None
    pr_url, pr_url_error = _note_pr_url(pr, note, repo)
    out = {
        "slug": path.stem, "status": status or None, "scope": rr._scope(note) or None, "pr": pr,
        "prUrl": pr_url, "prUrlError": pr_url_error,
        "readyAt": rr._scalar(note.get("ready")) or None,
        "rung": {"startRung": "", "rung": rung, "climbs": []}, "branch": branch_of(path.stem),
        "source": source or None, "markerStage": parsed["stage"] if run else None,
        "markerReason": parsed["reason"] if run else "", "history": history, "lastRound": last_round,
        "reviewRoundsUsed": max(1, rr._int_field(note.get("review_rounds_used"), 0) or 0, last_round),
        "lastIntegration": last, "resumeAt": resume_at,
    }
    out["autoRevise"] = bool(max_rounds is not None and _revise_shaped(out) and last_round < max_rounds)
    if repo:
        out["worktreePath"] = worktree_dir(os.path.expanduser(repo), path.stem)
    got, why = _read_row(row, path.stem) if row is not None else (None, "")
    out["integrate"] = integrate_record(out, note, got, why)
    return out


def _revise_shaped(inp):
    """autoRevise but its round test: blocked, the source is the Blocker run, stage revise, markerReason empty, the
    last Integration line `rejected` and a non-empty history (a plain rejection step 1.2's seeded revise takes)."""
    last = inp.get("lastIntegration") or {}
    return bool(inp.get("status") == "blocked" and inp.get("source") == "blocker" and inp.get("markerStage") == "revise"
                and inp.get("markerReason") == "" and last.get("outcome") == "rejected" and inp.get("history"))


# ---- the automatic retry's verdict (p16-4, ADR 0033) and its Human fix (ADR 0035) ---------------------------------

AUTO_RETRY_KEYS = ("autoRetry", "autoRetryWhy", "autoRetryError", "autoRetryClass", "autoRetryBudget",
                   "autoRetriesUsed", "quotaRetriesUsed", "fingerprint", "autoRetryRaise", "autoRetryAfter",
                   "humanFix", "answerRecorded")

# The fixed acts a Human fix names (ADR 0035 decision 1), one per refusal cause a person owns. auto_retry_verdict sets
# `humanFix.act` to one of these; execute § 6.5 (c), status's Needs-you block and repair § 2 print it and never
# re-derive a cause, so a new cause is one branch here plus one test.
HUMAN_FIX_ACTS = (
    "finish the recorded answer",                      # H0  an answer whose way back is more than a bare hand-back
    "sign off gated input",                            # H1  gate-pending
    "fix its rollout: or defer",                       # H2  no rollout note
    "decide RACE", "decide UNVERIFIED",                # H3  an undecided RACE or UNVERIFIED
    "answer the question",                             # H4  a `## Needs you` question
    "decide scope or defer",                           # H5  plan-blocked after a descope, or a refused descope
    "restore, recut or defer",                         # H6  at Integration with no pr: (repair § 4, or § 3c's merge)
                                                       # H8  the PR branch is gone
    "fix the note's pr: or defer",                     # H7  a pr: the engine refuses, on a way back that launches on it
    "raise max_plan_rounds, hand back or defer",       # H9  a spent budget: the run's own
    "raise max_review_rounds, hand back or defer",
    "raise max_iterations, hand back or defer",
    "hand back or defer",                              # H10 every other refusal; H11 a code-writing review with no PR
    "fix the round budget",                            # H12 an invalid budget stamp
)
# The fixed openings the engine, its prompts and the lead write for a code-writing task's own run. None of them spends a
# budget (a dead call, merge-task's exit 1, a dead agent, a plan divergence, the engine's two fallbacks), so a run that
# starts with one never raises max_iterations: only the implementer's or reviser's own paragraph does.
NO_BUDGET_OPENINGS = ("workflow call failed:", "merge-task:", "transient infrastructure failure", "plan-divergence:",
                      "agent returned neither verified nor blocked", "workflow stage threw")
PLAN_BUDGET_OPENINGS = ("plan not approved after", "plan round budget exhausted")


def human_fix_label(note):
    """humanFix's label: `(<status>, <section> run <n>)`, the section the status writes and its top run (a legacy section
    with no run: `(<status>, <section>)`); `(review, no PR)` for a code-writing review note with no pr:; `(gate-pending)`
    for a gate. When k answers to the current block were spent by a hand-back it adds `, ask <k+1>`, so an identical
    re-block after a spent answer is a new item, pushed again (ADR 0035 decision 3)."""
    status = rr._status(note)
    if status == rr.GATE_PENDING_STATUS:
        return "(gate-pending)"
    if status == "review" and not rr._pr(note):
        base = "(review, no PR"
    else:
        heading = rr.BLOCKED_SECTIONS.get(status)
        if heading is None:
            base = f"({status or 'no status'}"
        else:
            runs = note.run_blocks(heading)
            base = f"({status}, {heading[3:]}" + (f" run {rr._top_run(runs)['n']}" if runs else "")
    k = rr._spent_count(note, rr._block_fingerprint(note))
    return base + (f", ask {k + 1}" if k else "") + ")"


def _raise_field(note, inp, k, at):
    """The budget a refused block's source run spent (execute § 6.5's former (c) rule 3), or None. Never at Integration,
    and never on a note carrying a `## Needs you` question (the engine stops on the question, never on a budget run out).
    `max_plan_rounds` for a Plan-blocked run that starts `plan not approved after` or `plan round budget exhausted`;
    `max_review_rounds` for a review-blocked note, or a plain-rejection revise marker (markerStage revise, markerReason
    empty) with lastRound >= the resolved k; `max_iterations` for a code-writing task's own Blocker diagnosis run that
    starts with none of NO_BUDGET_OPENINGS (the implementer's or reviser's own paragraph)."""
    if at == "integration" or rr.needs_human(note):
        return None
    status = rr._status(note)
    if status == "plan-blocked":
        first = note.latest_run_text(rr.BLOCKED_SECTIONS["plan-blocked"]).split("\n", 1)[0].strip().lower()
        return "max_plan_rounds" if first.startswith(PLAN_BUDGET_OPENINGS) else None
    if status == "review-blocked":
        return "max_review_rounds"
    if status != "blocked" or inp.get("source") != "blocker":
        return None
    stage = inp.get("markerStage")
    if stage == "revise" and inp.get("markerReason") == "":
        return "max_review_rounds" if k is not None and inp.get("lastRound", 0) >= k else None
    if stage == "own" and rr._scope(note) != "read-only":
        text = note.latest_run_text(rr.BLOCKED_SECTIONS["blocked"])
        first = rr._lead_reason("own", text).split("\n", 1)[0].strip().lower()
        return None if first.startswith(NO_BUDGET_OPENINGS) else "max_iterations"
    return None


def _pending_gates(note):
    return [l.strip()[2:].strip() for l in note.section_text(rr.GATE_PENDING_SECTION).split("\n") if l.strip().startswith("- ")]


def _hold_line(rollout_note, slug, kind, note):
    """H3's detail: the latest `## Race log` line naming the task (a RACE), else its blocker's `UNVERIFIED:` line."""
    if kind == "RACE" and rollout_note is not None:
        lines = [l.strip() for l in rollout_note.section_text(rr.RACE_LOG_SECTION).split("\n")
                 if any((rr._wikilink_slug(m.group(1)) or "").lower() == slug.lower() for m in rr.WIKILINK_OPEN_RE.finditer(l))]
        if lines:
            return lines[-1]
    text = rr._blocker_summary(note)
    return next((l.strip() for l in text.split("\n") if rr.UNVERIFIED_MARK in l), text.split("\n", 1)[0].strip())


def auto_retry_verdict(path, note, inp, rollout_note, now, max_rounds_flag=None):
    """Whether execute's lead re-enters a set-aside task by itself (`reconcile-rollout.py auto-retry`), and, when it may
    not, the one Human fix that moves it (ADR 0035), as `inputs`' AUTO_RETRY_KEYS. The one decision function: `inputs`
    prints it to every caller and the verb re-runs it before it writes. `inp` is task_inputs' output for the note,
    `rollout_note` the rollout its `rollout:` names (None: no retry), `max_rounds_flag` inputs' --max-review-rounds
    (None: not given). `answerRecorded` (reconcile-rollout.py _answer_recorded) is read for every note.

    The core (_verdict) is an ordered list of causes; the first that refuses is `autoRetry: false` with its
    `autoRetryWhy` and its `humanFix` ({act, detail, handBack, label, raise}, act one of HUMAN_FIX_ACTS; handBack true
    only when, once Lachy has answered, a bare `hand-back` is the whole way back; raise the budget a H9 names, else
    null; label human_fix_label's), or a null humanFix when the way back is the lead's own:
      1. gate-pending: H1 `sign off gated input` (the pending gates);
      2. not set aside at its run or at Integration (running, queued, awaiting Integration, landed): null;
      3. a code-writing review note with no pr:: H11 `hand back or defer`, handBack true, label `(review, no PR)`;
      4. no rollout note: H2 `fix its rollout: or defer`;
      5. an undecided RACE or UNVERIFIED: H3 `decide RACE` / `decide UNVERIFIED` (the hold's line); then a note whose
         `pr:` the RACE revert reverted on main (reconcile-rollout.py _reverted_pr, ADR 0046): H7 `fix the note's pr: or
         defer` (its latest `## Race log` line), handBack false: a re-land needs a new `pr:`;
      6. a `## Needs you` question: H4 `answer the question` (the question), its handBack that of the first cause
         below that refuses (7 skipped), true when none;
      7. a recorded answer (answerRecorded non-null): `answered for this block (<form>, <stamp>): <the cause's why>`,
         its fix the answer overlay on the cause below (8 onwards): a `hand-back` answer is null when the cause's fix is
         null or has handBack true (the lead hands it back), else H0 `finish the recorded answer` (the entry); an
         `awaiting repair` answer is always H0; a `left` answer keeps its cause's fix, its detail prefixed `left on
         your answer of <stamp>` (H10 when the cause's fix is null). So an answered block is never retried. Both 6 and
         7 keep the cause's `autoRetryError` and `autoRetryClass` (_keep_cause_flags), so an invalid budget stamp is
         still execute § 3's halt under a question or an answer;
      8. plan-blocked after an automatic descope (a descope marker and no `descope_armed:`): H5 `decide scope or defer`;
      9. a refused descope recorded for this block (_descope_refusal, never while `descope_armed:` stands: the armed
         descope's hand-back is its way back): H5 with the record as its detail;
     10. autoRevise under the resolved max_review_rounds: null (step 1.2's seeded revise), or H7 when `prUrlError` is
         non-empty (step 1.2 launches nothing on it);
     11. set aside at Integration with no pr:: H6 `restore, recut or defer` (repair § 4's restore, or § 3c's PR-less merge
         for a MERGED PR; never hand-back, which refuses it);
     12. a non-empty `prUrlError` (p17-1) on a way back that launches on the note's PR (resumeAt revise, or at
         Integration): H7 `fix the note's pr: or defer`, handBack false (the fix changes the note first);
     13. prepare's `the PR branch is gone`: H8 `restore, recut or defer`;
     14. a `--gated` decline; 15. a merge-task exit-1 text outside MERGE_TASK_FIXABLE: H9 or H10 (_raise_field gives none);
     16. an invalid budget stamp: `autoRetryError` (execute § 3's halt), H12 `fix the round budget`;
     17. an unresolvable budget: H9 or H10;
     18. `auto_retries: 0`; 19. no feedback fingerprint; 20. malformed counters; 21. a malformed `auto_retry_at`;
     22. a quota block past its 5 free retries; 23. an agent or infra block past its budget; 24. an agent block whose
         fingerprint equals `auto_retry_sha`: each H9 `raise <field>, hand back or defer` when _raise_field names the
         source run's spent budget, else H10 `hand back or defer`, the detail its autoRetryWhy;
     and a quota block still cooling (QUOTA_COOLDOWN_MIN[quota_retries_used] from the later of the block's run stamp and
     `auto_retry_at`, setting `autoRetryAfter`) or an infra block still cooling (INFRA_COOLDOWN_MIN[auto_retries_used],
     the last repeating; no stamp fails closed) refuses with a null humanFix: the lead retries it once the cool-down ends.
    Otherwise `autoRetry: true`, with `autoRetryRaise` = lastRound + 1 when resumeAt is revise and the resolved
    max_review_rounds is <= lastRound (one round per retry).

    --max-review-rounds is an overlay the core ignores, so humanFix never depends on a hand-resolved K: only with no
    answer recorded and the core past the budget point (autoRetryBudget non-null), a K other than the resolved one sets
    `autoRetry: false` with today's mismatch why and clears autoRetryAfter and autoRetryRaise."""
    answer = rr._answer_recorded(note)
    out = _verdict(path, note, inp, rollout_note, now, answer)
    budget = out["autoRetryBudget"]
    if answer is None and budget is not None and max_rounds_flag is not None:
        k = budget["maxReviewRounds"]["value"]
        if max_rounds_flag != k:
            out.update(autoRetry=False, autoRetryWhy=f"--max-review-rounds {max_rounds_flag} is not the resolved "
                                                     f"max_review_rounds {k}", autoRetryAfter=None, autoRetryRaise=None)
    return out


def cause_fix(path, note, inp, rollout_note, now):
    """The core's Human fix with the answer overlay skipped: the cause a recorded answer answers. record-answer reads it
    before its save to check a --raise against `humanFix.raise`."""
    return _verdict(path, note, inp, rollout_note, now, None)["humanFix"]


def _keep_cause_flags(out, cause):
    """Carry the cause's `autoRetryError` and `autoRetryClass` into a verdict that refuses above it (a `## Needs you`
    question, a recorded answer): an invalid budget stamp stays execute § 3's round-budget halt and status's "invalid
    round budget" flag (execute § 6.5 (e)) whatever answers or asks the block."""
    out.update(autoRetryError=cause["autoRetryError"], autoRetryClass=cause["autoRetryClass"])


def _verdict(path, note, inp, rollout_note, now, answer, skip_needs=False):
    """auto_retry_verdict's core (its docstring lists the causes). `answer` is the note's answerRecorded (None skips
    cause 7); `skip_needs` skips cause 6, for H4's handBack."""
    out = {k: None for k in AUTO_RETRY_KEYS}
    out.update(autoRetry=False, autoRetryWhy="", answerRecorded=answer)
    used = rr._stamp_value(note.get(rr.AUTO_RETRIES_USED_KEY), 0) if note.get(rr.AUTO_RETRIES_USED_KEY) is not None else 0
    quota = rr._stamp_value(note.get(rr.QUOTA_RETRIES_USED_KEY), 0) if note.get(rr.QUOTA_RETRIES_USED_KEY) is not None else 0
    out.update(autoRetriesUsed=used, quotaRetriesUsed=quota, fingerprint=rr._block_fingerprint(note))
    label = human_fix_label(note)

    def fix(act, detail, hand_back, raise_=None):
        if act not in HUMAN_FIX_ACTS:  # the fixed vocabulary execute's dedupe and status's lines rely on
            raise ValueError(f"humanFix act {act!r} is not one of HUMAN_FIX_ACTS")
        return {"act": act, "detail": detail, "handBack": hand_back, "label": label, "raise": raise_}

    def no(why, human=None):
        out["autoRetryWhy"] = why
        out["humanFix"] = human
        return out

    status = rr._status(note)
    state, at = rr._queue_state(note)
    k = None

    def spent(why):
        """H9 when the source run spent its own budget (_raise_field), else H10; the detail is the why."""
        field = _raise_field(note, inp, k, at)
        if field:
            return no(why, fix(f"raise {field}, hand back or defer", why, True, field))
        return no(why, fix("hand back or defer", why, True))

    if state == "set-aside" and at == "gate":
        return no("gate-pending: sign-off is the human's (approve-gates)",
                  fix("sign off gated input", "; ".join(_pending_gates(note)), False))
    if state != "set-aside" or at not in ("run", "integration"):
        return no(f"not set aside ({state})")
    if status == "review":
        why = "approved without a PR: a code-writing review note with no pr: is repair's call"
        return no(why, fix("hand back or defer", why, True))
    if rollout_note is None:
        return no("no rollout note", fix("fix its rollout: or defer", "no rollout note: the note's rollout: names no "
                                         "readable rollout note", False))
    out["autoRetryClass"] = rr._retry_class(note)
    hold = rr._race_holds(rollout_note, [(path, note)]).get(path.stem.lower())
    if hold:
        return no(f"{hold[1]} undecided: only Lachy's RACE decided: line (through /thread:repair) releases it",
                  fix(f"decide {hold[1]}", _hold_line(rollout_note, path.stem, hold[1], note), False))
    if rr._reverted_pr(rollout_note, note):
        # The RACE revert undid this pr:'s merge on main (ADR 0046): re-entering would integrate or land a reverted PR.
        return no("its merge was reverted on main: re-land it through a new pr: or defer",
                  fix("fix the note's pr: or defer", _hold_line(rollout_note, path.stem, "RACE", note), False))
    question = rr.needs_human(note)
    if question and not skip_needs:
        below = _verdict(path, note, inp, rollout_note, now, None, skip_needs=True)
        _keep_cause_flags(out, below)
        return no("needs a human: the note's ## Needs you question",
                  fix("answer the question", question, below["humanFix"]["handBack"] if below["humanFix"] else True))
    if answer is not None:
        cause = _verdict(path, note, inp, rollout_note, now, None, skip_needs)
        _keep_cause_flags(out, cause)
        cf, form, stamp = cause["humanFix"], answer["form"], answer["stamp"]
        if form == "hand-back":
            human = None if cf is None or cf["handBack"] else fix("finish the recorded answer", answer["line"], False)
        elif form == "awaiting repair":
            human = fix("finish the recorded answer", answer["line"], False)
        elif cf is None:
            human = fix("hand back or defer", f"left on your answer of {stamp}: {cause['autoRetryWhy'] or 'nothing else holds it'}",
                        True)
        else:
            human = dict(cf, detail=f"left on your answer of {stamp}: {cf['detail']}")
        return no(f"answered for this block ({form}, {stamp}): {cause['autoRetryWhy'] or 'nothing else holds it'}", human)
    plan_runs = note.run_blocks(rr.BLOCKED_SECTIONS["plan-blocked"]) if status == "plan-blocked" else []
    plan_n = rr._top_run(plan_runs)["n"] if plan_runs else "?"
    if status == "plan-blocked" and not rr._scalar(note.get(rr.DESCOPE_ARMED_KEY)) and any(
            rr.DESCOPE_MARK_RE.match(l.strip()) for l in note.section_text(rr.SCOPE_AUTO_SECTION).split("\n")):
        return no("plan-blocked again after an automatic descope: repair asks Lachy",
                  fix("decide scope or defer", f"plan-blocked again after an automatic descope (Plan-blocked feedback run "
                                               f"{plan_n})", True))
    refusal = rr._descope_refusal(note)
    if refusal is not None:
        return no(f"descope refused at Plan-blocked feedback run {refusal[0]}: Lachy decides the scope",
                  fix("decide scope or defer", refusal[1], True))
    budget = rr._retry_budget(note, rollout_note)
    k = budget["maxReviewRounds"]["value"] if budget["maxReviewRounds"] else None
    if k is not None and _revise_shaped(inp) and inp["lastRound"] < k:
        return no("autoRevise: step 1.2's seeded revise owns it",
                  fix("fix the note's pr: or defer", inp["prUrlError"], False) if inp.get("prUrlError") else None)
    kind, reason = rr._note_reason(note)
    first = reason.split("\n", 1)[0].strip()
    if at == "integration" and not rr._pr(note):
        return no("set aside at Integration with no pr: a human restores or recuts it",
                  fix("restore, recut or defer", f"{first}; restore finds its branch's PR (repair § 4), and a MERGED one is "
                                                 "§ 3c's PR-less merge", False))
    if inp.get("prUrlError") and (at == "integration" or inp.get("resumeAt") == "revise"):
        return no(f"the note's pr: gives no PR URL the engine takes, so no launch would go ahead: a human fixes it "
                  f"({inp['prUrlError']})", fix("fix the note's pr: or defer", inp["prUrlError"], False))
    if status == "blocked" and kind == "integration" and rr.BRANCH_GONE_MARK in reason:
        return no("the PR branch is gone: a human restores or recuts it", fix("restore, recut or defer", first, False))
    if status == "blocked" and rr.DECLINED_MARK in reason:
        return spent("merge declined at the --gated hold: a human's decision")
    if status == "blocked" and kind == "own" and first.lower().startswith("merge-task") and \
            not any(f in reason for f in rr.MERGE_TASK_FIXABLE):
        return spent(f"merge-task needs a human: {first}")
    if budget["error"]:
        out["autoRetryError"] = budget["error"]
        return no(f"invalid round budget: {budget['error']}", fix("fix the round budget", budget["error"], False))
    if budget["unresolved"]:
        return spent(f"auto_retries unresolved: {budget['unresolved']}")
    out["autoRetryBudget"] = {"autoRetries": budget["autoRetries"], "maxReviewRounds": budget["maxReviewRounds"]}
    n = budget["autoRetries"]["value"]
    if n == 0:
        return spent("auto_retries is 0: automatic retries are off")
    if not out["fingerprint"]:
        return spent("no feedback fingerprint: the block recorded no feedback")
    for key, value in ((rr.AUTO_RETRIES_USED_KEY, used), (rr.QUOTA_RETRIES_USED_KEY, quota)):
        if value is None:
            return spent(f"malformed {key}: {note.get(key)!r} (fails closed)")
    last_at = rr._parse_ts(note.get(rr.AUTO_RETRY_AT_KEY)) if note.get(rr.AUTO_RETRY_AT_KEY) is not None else None
    if note.get(rr.AUTO_RETRY_AT_KEY) is not None and last_at is None:
        return spent(f"malformed {rr.AUTO_RETRY_AT_KEY}: {note.get(rr.AUTO_RETRY_AT_KEY)!r} (fails closed)")
    cls = out["autoRetryClass"]

    def cooling(minutes):
        """The cool-down's refusal while `now` is before the later of the block's run stamp and the last retry, plus
        `minutes` (setting `autoRetryAfter`), or None once it has passed. No stamp at all fails closed (H10)."""
        stamps = [s for s in (rr._block_stamp(note), last_at) if s is not None]
        if not stamps:
            return spent(f"{cls}: no block stamp to time the cool-down from (fails closed)")
        after = max(stamps) + timedelta(minutes=minutes)
        if now < after:
            out["autoRetryAfter"] = rr._stamp(after)
            return no(f"{cls} cool-down: retries at {out['autoRetryAfter']}")
        return None

    if cls == "quota":
        if quota >= len(rr.QUOTA_COOLDOWN_MIN):
            return spent(f"quota: {quota}/{len(rr.QUOTA_COOLDOWN_MIN)} free retries outlasted: a human")
        refused = cooling(rr.QUOTA_COOLDOWN_MIN[quota])
        if refused:
            return refused
    else:
        if used >= n:
            return spent(f"budget: {used}/{n} used")
        if cls == "agent" and out["fingerprint"] == rr._scalar(note.get(rr.AUTO_RETRY_SHA_KEY)):
            return spent("same feedback as the block last re-entered")
        if cls == "infra":
            refused = cooling(rr.INFRA_COOLDOWN_MIN[min(used, len(rr.INFRA_COOLDOWN_MIN) - 1)])
            if refused:
                return refused
    if inp.get("resumeAt") == "revise" and k <= inp.get("lastRound", 0):
        out["autoRetryRaise"] = inp["lastRound"] + 1
    out["autoRetry"] = True
    return out


def _rollout_note_of(path, note):
    """The rollout note the task's `rollout:` names, read beside the task note (<note dir>/<rollout>.md), or None."""
    slug = rr._wikilink_slug(note.get("rollout"))
    p = path.parent / f"{slug}.md" if slug else None
    try:
        return rr.Note(p) if p is not None and p.is_file() else None
    except (OSError, ValueError):
        return None


def cmd_inputs(args):
    path, note = _load_note(args.note)
    if args.max_review_rounds is not None and args.max_review_rounds < 1:
        raise EnvError("--max-review-rounds must be an integer >= 1")
    out = task_inputs(path, note, args.max_review_rounds, args.repo, args.row)
    # The verdict reads the rollout note and resolves the budget only for a note set aside at its run or at
    # Integration, so the restart and status reads of every other note stay cheap.
    state, at = rr._queue_state(note)
    ro = _rollout_note_of(path, note) if state == "set-aside" and at in ("run", "integration") else None
    out.update(auto_retry_verdict(path, note, out, ro, args.now or datetime.now().astimezone(), args.max_review_rounds))
    return out


def cmd_plan(args):
    path, note = _load_note(args.note)
    return {"slug": path.stem, "plan": rr.approved_plan(note)}


def cmd_set_aside(args):
    path, note = _load_note(args.note)
    reason = sys.stdin.read().rstrip("\r\n")
    if not reason.strip():
        raise EnvError("set-aside: the reason (on stdin) is empty")
    inp = task_inputs(path, note)
    if args.kind == "integration":
        diag = integration_marker("set-aside", reason, inp["history"])
    elif args.kind == "revise-stopped":
        diag = integration_marker("revise-stopped", reason, inp["history"])
    else:
        diag = own_run_diagnosis(reason)
    rollout = rr._wikilink_slug(note.get("rollout")) or ""
    return {"rolloutSlug": rollout, "tasks": [{
        "slug": path.stem, "taskPath": str(path), "scope": inp["scope"] or "", "status": "blocked",
        "prUrl": inp["pr"] or "", "blockerDiagnosis": diag, "reviewHistory": inp["history"],
        "leadSetAside": args.kind,
    }]}


# ---- CLI -----------------------------------------------------------------------------------------------

def _sha(value):
    if not re.fullmatch(r"[0-9a-f]{40}", value or ""):
        raise argparse.ArgumentTypeError(f"not a 40-hex commit sha: {value!r}")
    return value


# The verbs that act on one task of a rollout from the lead's root (ADR 0043): its Integration and its own set-aside
# row. inputs and plan are readers (status reads inputs); verify, push and undo follow a guarded prepare in one flow.
GUARDED = ("prepare", "set-aside")


def _engine_guard(note, tasks_dir):
    """engine-snapshot.py's guard_task() for the task note's rollout, loaded from this tree: its refusal, else None."""
    try:
        src = Path(__file__).resolve().parent.parent.parent / "_shared" / "scripts" / "engine-snapshot.py"
        spec = importlib.util.spec_from_file_location("thread_engine_snapshot", src)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
    except Exception:  # only positive evidence refuses
        return None
    return mod.guard_task(note, mod.ROOT, "skills/execute/scripts/lead-integrate.py", tasks_dir)


def main(argv=None):
    p = argparse.ArgumentParser(description="The lead's side of Integration (ADR 0030 decision 3, p12-9).")
    sub = p.add_subparsers(dest="cmd", required=True)

    pr = sub.add_parser("prepare", help="decide how one approved task integrates: merge, verify, trouble or set-aside")
    pr.add_argument("--repo", required=True)
    pr.add_argument("--slug", required=True)
    pr.add_argument("--default", required=True, help="the repo's default branch (execute § 4's resolver)")
    pr.add_argument("--note", required=True, help="the task note's path")
    pr.add_argument("--tasks-dir", default=None, help="where landed PRs' task notes are looked up (default: the note's dir)")
    pr.add_argument("--verifier", default=None, help="the rollout's verifier: given, prepare may route `skip` when main "
                    "moved only in the repo's Inert paths and the Inert proof holds (ADR 0045)")
    pr.add_argument("--bootstrap", default=None, help="the rollout's env_bootstrap, a step of the Inert proof too")

    vf = sub.add_parser("verify", help="run the env bootstrap and the verifier, bounded; the rc goes to <out>.rc")
    vf.add_argument("--tree", required=True)
    vf.add_argument("--out", required=True, help="<out>.rc and <out>.log are written")
    vf.add_argument("--timeout", required=True, type=float, help="seconds for bootstrap + verifier together")
    vf.add_argument("--bootstrap", default="")
    vf.add_argument("--verifier", required=True)
    vf.add_argument("--repo", default=None)
    vf.add_argument("--detach-at", default=None, type=_sha)
    vf.add_argument("--outcome", action="store_true",
                    help="completion-verify --run's: write <out>.outcome.json (its structured result) in place of <out>.rc")
    vf.add_argument("--slots", default=None, type=int, help="the machine's verify slots (rollouts.toml verify_slots); "
                    "with --slot-wait, wait for one first (verify-slot.py, p23-4)")
    vf.add_argument("--slot-wait", default=None, type=float, help="seconds to wait for a verify slot (verify-timeout's "
                    "slotWait), heat holds and heat-stopped runs included; none in time is rc `noslot`, exit 75, or "
                    "`heat`, exit 76, when the Mac was too hot")
    vf.add_argument("--rollout", default=None, help="the rollout note: record the suite in its Run record (p29-10)")
    vf.add_argument("--slug", default=None, help="with --rollout: the task the suite is for (none for a completion suite)")
    vf.add_argument("--diff-base", default=None, help="the Flake check (ADR 0050): the rev the task's diff is read from "
                    "(git diff --name-only REV HEAD in the tree); <out>.flake.json records the verdict")
    vf.add_argument("--named-rerun", default=None, help="with --diff-base: the repo's runner for named tests, holding "
                    "{tests} exactly once (verify-timeout's namedRerun)")

    bm = sub.add_parser("base-moved", help="record why main moved at a merge-task exit-3 refusal (p29-10): exit 0 always")
    bm.add_argument("--repo", required=True)
    bm.add_argument("--pr", required=True, type=_pr_number, help="the refused PR's number")
    bm.add_argument("--base", required=True, help="the refused integrated base")
    bm.add_argument("--main", required=True, help="the live origin/<default> merge-task read")
    bm.add_argument("--default", required=True, help="the repo's default branch")
    bm.add_argument("--refusal", default=None, type=int, help="merge-task's refusal count")
    bm.add_argument("--tasks-dir", default=None, help="the vault's task notes (default: reconcile's DEFAULT_TASKS_DIR)")

    pu = sub.add_parser("push", help="a plain push of the tree's merge commit; the read-back must equal it")
    pu.add_argument("--repo", required=True)
    pu.add_argument("--slug", required=True)
    pu.add_argument("--head", required=True, type=_sha)

    ud = sub.add_parser("undo", help="drop the lead's unpushed merge commit")
    ud.add_argument("--repo", required=True)
    ud.add_argument("--slug", required=True)
    ud.add_argument("--merge", required=True, type=_sha)
    ud.add_argument("--to", required=True, type=_sha)

    ip = sub.add_parser("inputs", help="a task note's re-entry inputs (history, rounds, resumeAt, autoRevise)")
    ip.add_argument("--note", required=True)
    ip.add_argument("--max-review-rounds", type=int, default=None)
    ip.add_argument("--repo", default=None, help="also print the task tree's worktreePath")
    ip.add_argument("--row", default=None, help="the approving row's result JSON (file, or - for stdin): checked "
                    "against the note for the integrate record")
    ip.add_argument("--now", type=rr._iso_arg, default=None, help="the time a retry cool-down is read against (default: now)")

    pl = sub.add_parser("plan", help="the task note's approved plan, for a seeded revise's resume.plan")
    pl.add_argument("--note", required=True)

    sa = sub.add_parser("set-aside", help="the lead's own set-aside row (reason on stdin) for reconcile --result -")
    sa.add_argument("--note", required=True)
    sa.add_argument("--kind", required=True, choices=["integration", "revise-stopped", "own"])

    sub.add_parser("stamp", help="now, in reconcile's _stamp form")

    args = p.parse_args(argv)
    if args.cmd in GUARDED:
        refusal = _engine_guard(args.note, getattr(args, "tasks_dir", None))
        if refusal:   # ADR 0043: before any git call; nothing fetched, merged or printed
            print(refusal, file=sys.stderr)
            return 2
    try:
        if args.cmd == "stamp":
            print(rr._stamp(datetime.now()))
            return 0
        if args.cmd == "verify":
            return cmd_verify(args)
        if args.cmd == "base-moved":
            return cmd_base_moved(args)
        handler = {"prepare": cmd_prepare, "push": cmd_push, "undo": cmd_undo, "inputs": cmd_inputs,
                   "plan": cmd_plan, "set-aside": cmd_set_aside}[args.cmd]
        emit(handler(args))
        return 0
    except Refused as e:
        print(f"lead-integrate {args.cmd}: refused: {e}", file=sys.stderr)
        return 1
    except EnvError as e:
        print(f"lead-integrate {args.cmd}: {e}", file=sys.stderr)
        return 2
    except Retryable as e:
        print(f"lead-integrate {args.cmd}: retryable: {e}", file=sys.stderr)
        return 8


if __name__ == "__main__":
    sys.exit(main())
