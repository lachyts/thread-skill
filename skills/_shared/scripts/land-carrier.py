#!/usr/bin/env python3
"""land-carrier.py — the landing carrier (ADR 0078 d2): every open `landing` PR, and every PR on a land.sh-named
`close/` branch, keeps moving until it merges, with no one touching it.

    python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/land-carrier.py run [--state F] [--now ISO] [--every MIN]
        [--deadline S] [--settle-wait S] [--dry-run] [--vault DIR]
    python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/land-carrier.py stuck [--state F] [--now ISO]
        [--slug OWNER/NAME]
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
bound: gh 30 s (a fix task's job-log read among them), a clone or fetch 90 s, a push 60 s, local git 60 s (a declared
checkout's `git config` and the fix task's `cp -p` clone among them), the classifier 30 s, the roll-up reader (6.4) 60
s, each cut to what is left of the pass's deadline; one that reaches it has its process group stopped (BJ.kill_group,
5 s grace). The note lock (the fix task paragraph) is waited for up to THREAD_NOTE_LOCK_TIMEOUT (30 s), cut the same
way. TERM, INT and HUP stop the live child's group and the pass exits 128 + N, landings.json as the last per-PR
write left it.

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
     before the push, and every vault write (a fix task filed or noted) at once. A pass cut mid-PR keeps that PR's old
     entry unless it already wrote to GitHub or the vault.
  5. Read, per PR (Phase A).
     a. `GET repos/<slug>/pulls/<n>`. Merged: the entry is dropped. Closed: the tombstone rule (8), else dropped. (Any
        drop of an entry whose fix task is open writes its closing line first: the fix task paragraph's drop rule.) In
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
        evaluated by the binding (5f), `own-marked` when it holds or advances, else `own-unqueued`. The carrier also
        reads which marker M is: a `Landing held (ADR 0028 § 3)` one is own-unqueued with the outcome `held (ADR 0028
        § 3): left to its session; its close follow-up task carries it`, and files no review fix task (6.0). A
        labelled PR on a branch outside the grammar (`close/fix-thing`) takes these own-branch kinds.
     d. The head, for the 24 h clock only (the binding is 5f's). `gh_update_merge(H, X)`, the one predicate: H is a
        GitHub-made update-branch merge from X when `GET commits/<H>` shows parents [X, P2] and the committer email
        `noreply@github.com` (GitHub stamps it on the update-branch merges it makes, the carrier's, land.sh's and a
        person's button alike), and `GET compare/<base.ref>...<P2>` reads behind or identical (P2 on base). A head
        that differs from entry.head is a carrier change when it is entry.pushed (the carrier's resolver push) or
        gh_update_merge(head, entry.head) holds; anything else is an author change, which restarts movedAt and the
        rerun count, and is a clearing verdict (the fix task paragraph's settle rule). A failed read counts as a
        carrier change: a failed read never restarts the clock. Any new head drops `redHeld` (6.4b's hold).
     e. The checks on head.sha, land.sh LAND_CHECKS_PY's classes (`GET commits/<sha>/check-runs?per_page=100` and
        `/status`, a check run's latest id per name): red (a failure), infra (cancelled, timed_out, startup_failure,
        action_required, stale, a status error), pending, green. No check on the head reads the base tip's (the
        scratch clone paragraph's): any there is pending, none is `none` (green). The class says only whether the head
        is green; 6.4 decides any rerun.
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
     `allow_auto_merge`): write_block, which says whether a refusal is definite (no push permission read, or the
     register's exit 3) or a read that failed (the repo read, a register check cut at its bound, any other exit). A
     definite refusal at any write (an update-branch, a re-run POST, a merge PUT, the auto-merge queue, the
     supersession close, the resolver's push) is the pass's clearing verdict.
     0. own-unqueued or a draft: no write ("left to its session"). An own PR so unmoved for a day gets the review fix
        task (the fix task paragraph) when its comments were read and its newest marker is no hold; an own draft, whose
        marker 5c never read, has it read once then, after the vault and project are found. Never a held landing (its
        close follow-up task carries it, ADR 0070 d5), never a failed read, and never a draft close-out (act's draft
        return is a clearing verdict).
     1. A superseded close-out: supersession (below): a `Superseded (ADR 0078 d2): …` comment, then `PATCH
        pulls/<n> state=closed`.
     2. A close-out with auto_merge null and allow_auto_merge not false: `gh pr merge <n> -R <slug> --auto --merge`.
        A refusal, or allow_auto_merge false, is not terminal: the steps below still run.
     3. dirty: the resolver (below), when this repo's bring-current slot is free. An ineligible PR gets no write and
        an outcome naming why; a dirty PR gets nothing else this pass. A close-out under 6.4b's hold (_held, checked
        just before the resolver) gets no push: `dirty: held for its fix task [[<stem>]]: …`, verdict `held`; once the
        hold lifts the resolver runs as for any dirty PR. The resolver's verdict: `dirty: waiting its turn …` unread;
        `… the merge is clean: left to update-branch` clean; every `not resolved: …` but a clone failure conflict; a
        clone failure unread; `not pushed: no write (<why>)` nowrite when write_block's refusal is definite, else
        unread; `would resolve …` and `resolved … and pushed …` pushed; `… but the push failed` failed. conflict and
        nowrite are clearing verdicts.
     4. red or infra, nothing pending, fewer than 2 reruns for this head: the rerun rule (ADR 0069 and 0073 d4, as
        merge-task.sh applies them). Every non-pass completed check (pass: success, neutral, skipped) must be proven
        re-runnable, or nothing on the head is re-run. Each GitHub Actions run a check run names (app.slug
        github-actions, details_url `/actions/runs/<run>/job/<job>`) has its jobs read (`GET
        repos/<slug>/actions/runs/<run>/jobs?per_page=100`, the latest attempt), and each non-pass job is classed:
        cancelled is re-runnable with no classifier (a GitHub-side stop: the job's timeout-minutes, a person's cancel,
        a newer run in its concurrency group; merge-task's cancelled_required); failure, timed_out or startup_failure
        gives the steps that concluded failure, and a job with no failed step is genuine (merge-task's per-run guard:
        a hang or a timeout is never proven to be setup); anything else is genuine (action_required, stale, a check run
        that is no Actions job, any failed or errored status context, a details_url naming no run); a jobs read that
        fails, or a run whose jobs show no non-pass job, re-runs nothing and is unread (below). A roll-up check is read
        through the jobs it needs first (p54-11,
        p54-12): a job with a non-empty `needs:` and a job-level `if:` holding `always()` or `!cancelled()`, like this
        repo's `make test (ubuntu-latest)` over its `fast tier (shard K/3)` jobs, fails whenever a job it needs failed
        or was cut, and its own failed step reads genuine. A run with two or more non-pass jobs, one of them not
        cancelled, is read through the head's workflow: the scratch clone (below) at the PR's head, then `python3
        <skills>/execute/scripts/lead-integrate.py shards --repo <clone> --head <head.sha> --jobs <the run's jobs>
        --whole --job-id <its non-pass jobs>` (_rollup and _stands_for, the reader merge-task.sh runs). Exit 0 leaves
        out each roll-up that stands for a non-pass job it needs, so only those jobs are classed (`rerun-failed-jobs`
        re-runs the roll-up with them); exit 3 (no roll-up, or one whose needed jobs all passed, so its red is its own)
        classes the run's jobs as they are; exit 1 (a roll-up not proven) or a non-pass job with no id is genuine;
        anything else (no lead-integrate.py, a clone or head fetch that fails, the reader cut at its bound, any other
        exit, unreadable JSON) is unread: nothing is re-run (fail-closed) and the red is no real one. A run with one
        non-pass job, or only cancelled ones, is never read so. Every collected step name, from every job on the head,
        goes once to `bash <skills>/execute/scripts/merge-task.sh --classify-steps`, which prints
        classify_failed_steps' verdict, the classifier merge-task.sh itself runs on a red required check's failed steps
        before its own rerun-failed-jobs; `genuine`, or no merge-task.sh (a fixed fact of the install), is genuine;
        `infra` is re-runnable; a cut, a non-zero exit or any other output is unread (`not re-run: the step classifier
        could not be read (<why>)`). Not the brief's classifier:
        reconcile-rollout.py `_merge_task_infra_stop` reads merge-task.sh's own stop-reason text (MERGE_TASK_INFRA,
        FAIL_CELL_RE; ADR 0069 d3's one reader of the GitHub-side cause) and never a CI step name, and the carrier holds
        failed step names, so it runs the one classifier that reads them. A genuine failure anywhere on the head beats
        cancellations everywhere else: `rerun-failed-jobs` re-runs a run's failed jobs with its cancelled ones, so one
        genuine job (a fail-fast matrix's one real failure, its siblings cancelled) means no run is re-run. All proven:
        `POST repos/<slug>/actions/runs/<run>/rerun-failed-jobs` once per affected run, one rerun of the head, at most
        2 per head. The outcome names the genuine jobs and their steps, or `rerun budget spent`. Real or unread, never
        parsed from the outcome: a red is real when the next pass would read the same head the same way: not an Actions
        job, a failed or errored status, `concluded <c>`, a job with no failed step, a roll-up not proven, `shows no
        failed job beside its roll-up checks`, a classifier `genuine`, and `rerun budget spent`. It is unread when a
        later pass may read it otherwise: a jobs read that fails, `run <r> shows no failed job`, an unread roll-up or
        classifier, no run to re-run, a re-run POST that fails, and a re-run made. A real red goes to 6.4b (a close-out)
        or to the red fix task at once (own-auto, own-marked: _own_red); an unread one files nothing.
     4b. A close-out's real red (_closeout_red), read against its base, the first rule that applies:
        - Held (_held: entry.redHeld is this head, its checks read neither green nor none, and its fix task is open,
          unreadable or absent): no GitHub write; the red key is computed again for the fix task (the same key on an
          open task writes nothing; no task, it is tried again). `<prev>; held for its fix task [[<stem>]]: red while
          up to date at <head12>, brought current again only once that task closes or its checks read green`, or with
          `; no fix task (<why>)` after it.
        - redHeld is this head and its task is closed (a carried fix counts): the same key is (d); a new key files the
          next numbered task, and the hold stays.
        - Otherwise the base tip and its checks (read_checks on it; one with no checks reads `none`). A read that fails
          is unread: `<prev>; cannot read <base_ref>'s checks (<why>)`, no key. A base neither green nor none, the
          landing unmoved under a day: `<prev>; its base <base_ref> reads <cls> at <tip12>: waiting for it to turn
          green`, no write and no key; a day or more: the base fix task, key `base:<head>`. A green base: `GET
          compare/<tip>...<head>` (a failed read is unread); behind or diverged: _bring_current (skipped while
          mergeability is unsettled); ahead or identical: the red fix task, key `red:<head>:<the failing check names,
          sorted>`, and entry.redHeld = head.
        The hold is head-specific (5d drops it on any new head); on its head it lifts when its task closes or its checks
        read green or none, never when the base moves, since a base move cannot show a fix landed.
     (d) The fix has landed: a real red whose fix task is closed (a carried fix counts) with the same key, a green
        base, and a compare that reads behind or diverged is brought current once (_bring_current), its mergeability
        settled. Otherwise the outcome gains `; its fix task [[<stem>]] is closed, and the landing has not moved (ADR
        0078 d1)`, and the landing is listed: the task is done at Live (it carries no `clears:`), so this row is the
        check that it did not move the landing.
     5. behind and green or none: `PUT pulls/<n>/update-branch -f expected_head_sha=<sha>` when the slot is free;
        `updatedFrom` records the head it was asked from (named in the outcome, read by no rule). _bring_current is
        this step, shared with 6.4b and (d).
     6. clean or has_hooks, green or none: a close-out whose auto-merge is off gets `PUT pulls/<n>/merge -f
        merge_method=merge -f sha=<head.sha>`; own-marked the same with sha=<bound> (REST's --match-head-commit);
        own-auto, or a close-out whose auto-merge is on, no call: GitHub merges it with the method its session chose.
     7. Otherwise nothing: pending, blocked, or waiting its turn.
     The bring-current slot: at most one update-branch or resolver push per repo per pass, to the first PR in order
     that needs it. Under a strict up-to-date rule only one can win, so the rest spend no CI run a merge then stales.
  7. Stuck: now - movedAt >= 24 h marks the entry `stuck` and prints `<slug>#<n>: stuck: unmoved since <movedAt16>:
     <outcome>` once. movedAt is first sight or the last author change; the carrier's own update-branch, resolver push
     or rerun never moves it, so a PR caught in update-branch cycles is listed after a day. A covered landing (_covered:
     its fix task open, never null, still covering it, and not taken out) is not stuck: _finish settles fix.current
     first, then reads it.
  8. Tombstones. A PR closed as superseded by L keeps its entry (`supersededBy`) while L is open; L merged drops it; L
     closed unmerged reopens it (a register check, a comment, `PATCH state=open`; `reopened`). A reopen that fails
     flags it stuck until it is open again or merged. The chain: when the carrier closes L itself as superseded, every
     tombstone naming L is passed on at that moment, never reopened: superseded by a later M, it names M (M carries
     L's lines, so P's), so a chain is always one link long; superseded by base, it is dropped (L's lines are on base,
     so P's). Passed on when L closes, not on P's next read, because L's own entry is dropped once M merges, and P's
     read can come after that. So only a target closed unmerged by someone else reopens a PR.
  9. Output: one stdout line per act or transition only (update-branch requested, resolved and pushed, re-ran,
     auto-merge queued, merged, closed as superseded, reopened, became stuck, search failed, fix task filed, fix task
     noted); failures go to the entry's outcome, so a pass that does nothing prints nothing. Exit 0 for a pass, whatever it did; 3 not due (no
     call, no write); 1 when BJ cannot be loaded; 2 on usage. --dry-run makes reads only, prints `would …` lines and
     writes no state.

The scratch clone: one bare partial clone per repo per pass, made lazily by the first step that needs it
(supersession, the resolver, the binding's tree check), in a `land-carrier-*` mkdtemp removed at pass end. Not the
note's scratch worktree: the carrier has no checkout of most repos and never touches the Primary or a session's; a bare
`--filter=blob:none` clone fetches trees and only the blobs a step reads. `git clone --bare --filter=blob:none
--no-tags --single-branch --branch <base.ref> -c credential.helper= -c 'credential.helper=!gh auth git-credential' -c
core.hooksPath=/dev/null -c gc.auto=0 -c maintenance.auto=false https://github.com/<slug>.git <scratch>/r<i>.git`: the
helpers live in its config, so merge-tree's and cat-file's lazy blob fetches use them, the empty one clearing inherited
helpers first. Then `fetch origin +refs/heads/<head.ref>:refs/carrier/<n>`, checked against the PR's head.sha: a head
that moved is "the PR moved during the pass (its head)", for the next pass. The base tip, `base` below, is the clone's
refs/heads/<base.ref>, and before there is a clone one `GET repos/<slug>/git/ref/heads/<base.ref>` per repo per pass (a
failed read fails the step that needed it). Never the PR's base.sha: GitHub moves it only when the head moves, so it
reads stale whenever the base moved after the PR's last push, the usual way a PR comes to be dirty or behind. The rerun
rule's roll-up read (6.4) makes one too.

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

Supersession (step 6.1): both P and L close-outs by the grammar (an own branch is session work, never closed). base is
the base tip. C is P's non-merge commits in base..head, read in the scratch clone. A target has an add side, where
what P adds must be, and a remove side, where what P removes must not be. P's lines are carried into it when, for
every path P changes from its merge base: a deletion, the remove side lacks the path; an addition or modification,
every non-blank line it adds is in the add side's file and every non-blank line it removes and does not re-add is
absent from the remove side's, THREAD.md's `last_touched:` counting as carried when the add side's date is the same or
later; a binary change never is. Superseded by base: both sides base, and |C| = 1 (a commit stranded under a close-out
keeps it open, so the Primary converges). Superseded by a later close-out L (open, a higher number, the same base.ref,
not superseded this pass; newest first): the add side base ∪ L.head (a line in either), the remove side L.head alone
(merging L applies a removal L carries, while base keeps what P removes until then, so a rewritten `Where we are` or
Resume line would otherwise never be carried), and C less its newest commit within base..L.head; the entry records
`supersededBy`. The verdict is cached in entry.checked by (the base tip, P's head, the later close-outs' heads).

The fix task (ADR 0078 d2 as amended by p47-20: Lachy's ruling of 2026-11-24, "File a fix task"). A landing the carrier
cannot move for a reason a task can carry gets one undated fix task in its project (ADR 0077: no approval), which the
Backlog orient grades and schedules like any other; every code change stays inside a scheduled, reviewed rollout.
  - Filed: a real red (6.4) on own-auto or own-marked, the red variant at once (_own_red); a close-out's real red, the
    red or base variant by 6.4b; the review variant, key `review:<head>`, for an own PR own-unqueued a day (6.0). A
    landing once held and queued again is own-marked, its newest marker a queued one, so no longer held. Never a held
    landing (it stays on the day stop, its close follow-up task carrying it: ADR 0070 d5), never a draft close-out,
    never a foreign PR, and never from a read that failed (a failed log read still files, without the excerpt).
  - Where: `run --vault DIR` (VAULT_DEFAULT, ~/repos/obsidian; primary-refresh's `run --now <stamp>` passes none). With
    no Work/Tasks/ there: `; no fix task (no vault at <dir>)`. The project (_project_for, read only when a task is to be
    filed, cached per pass): the live project notes under Work/Projects/** (Archive/ left out; `tags:` holding
    `project` and not `archived`; status not done, merged or dropped; `done:` not true) whose `repos:` (a block list, a
    flow list or a scalar) holds an entry that, through os.path.expanduser, is absolute and whose `git -C <dir> config
    --get remote.origin.url` (local git's bound; a failing call skips it) parses to the slug through
    landing-register.py's ORIGIN_RE and parse_slug, compared case-insensitively. On a tie status active wins, then
    path order. None: `; no fix task (no live project's repos: has origin <slug>)`.
  - Its name, the stem walk (_stem_walk): `landing-fix-<owner>-<name>-<n>`, each run outside [a-z0-9] of the lowercased
    key one `-`, then `-2`, `-3` and on, walked when there is no fix record or its task is closed and the key is new. A
    root note whose `landing_pr:` is this PR (case-insensitively) is adopted and noted when open, walked past when
    closed; an unreadable root note stops the walk (the unreadable rule below); a readable root note for another PR,
    or the name under Work/Tasks/Archive/ (any year folder), is walked past; nothing of that name is filed there.
  - Open (_fix_open): true when the note sits at Work/Tasks/<stem>.md, _fm reads it, its status is not done, merged,
    dropped or cancelled, it is no carried fix, and its tags hold no `archived`. A carried fix is `status: review` with
    a valued `merged:` (not empty, `null` or `~`, its ` # comment` dropped and quotes stripped; reconcile-rollout.py
    _carried_fix and _valued): it reads closed, since a held landing waiting on an open one would never move. False for
    any other readable root note, and for a note under Archive/ or gone. Null (unreadable) for a root note _fm cannot
    read: no write of any kind (no line, no `-2`, no retire), the outcome gains `; no fix task ([[<stem>]]'s
    frontmatter cannot be read)`, no key is set, so the landing is uncovered and listed after a day, and a held
    close-out stays held, (d) never firing.
  - _fm reads between the first two `---` lines: blank lines and lines whose first non-space character is `#` are
    skipped; top-level `key: value` scalars (` # comment` dropped, quotes stripped, as _scalar), flow lists, and block
    `- item` lists under an empty-valued key; a `[[x|y]]` item unwraps to x; any other line (a nested map, a block
    scalar) makes the frontmatter unreadable.
  - Its shape mirrors reconcile-rollout.py _new_task_fm, not imported, the carrier being stdlib-only and bundled:
    `tags: [task, <area tag>]` (the project's first `area:`, `[[ ]]` and an alias stripped, else its folder:
    resolve-target.py area_of; lowercased, each run outside [a-z0-9] one `-`), `status: open`, `priority: normal`,
    `work_depth: shallow`, `projects: ["[[<Project>]]", "[[<Area>]]"]` (no area, none), `contexts: []`, empty
    `scheduled:` and `due:` (ADR 0077), `captured:` the local date, `launch:` only when the project has one, and
    `landing_pr: "<slug>#<n>"`. No `fixes:` (an Escape is landed work) and no `clears:` (ADR 0078 Decided 12): it is
    proven at Live, and the carrier is the check that the landing moved, by (d) and the stuck list. The body: `## Notes`
    (who filed it; the PR url, head_ref → base_ref and its kind; the cause; for a red variant read `unstable`, that the
    failing check is not a required one, so GitHub would merge it, and the carrier holds it for green, ADR 0028 § 2;
    **What to do**; **Verify:** the carrier merges `<slug>#<n>`), `## Failing checks` for the red and base variants (up
    to 3 failing checks with their links, and a ```text fence of the first failing Actions job's log, `gh api
    repos/<slug>/actions/jobs/<id>/logs`, the 15 lines ending at its first `##[error]`, else its last 15, timestamps
    and ANSI codes dropped, each cut to 200 characters, ``` defused; read only when a task is filed, never under
    --dry-run), `## Launch` (the project's launch alias, else `claude` from the entry; `**Repo:**` the `repos:` entry
    as written; `**MCP:** none`), `## Resume prompt` (what is picked up, Launch, Read first, Next move; no capture
    line) and `## Carrier log`, its first line `- <stamp> <head12> (<variant>): filed: <reason>`. What to do, one line
    per variant (_fix_line): red on an own branch, fix the failing check on head_ref and queue it again, or fix it on
    base_ref; red on a close-out, its diff is THREAD.md and handoff docs only and it is up to date with a green
    base_ref, so fix it there or re-run it, then mark the task done; base, make base_ref green; review, finish its
    landing (/fresh-review, the fixes, `land.sh --queue`; a draft marked ready first) or close the PR.
  - The record, entry.fix {task, key, open, marker, current, at}, open true, false or null: a live task with the same
    key writes nothing; a new key on a live task adds one line, `- <stamp> <head12> (<variant>): <reason>`, with `;
    what to do now: <What to do>` when its variant differs from the note's last tagged line (or it has none) and the
    unstable clause when this pass reads `unstable` on a red variant and the note lacks it; a closed task with a new key
    gets the next numbered task; a closed task with the same key gets no write ((d), or the outcome names it); an
    unreadable task gets no write. Each pass with a record re-reads its note after 5a and before 5d (_refresh_fix):
    open, and marker from `taken_out_next:`; a missing vault keeps the last values.
  - Writes, all under Work/Tasks/: a new task is an `open(path, "x")` create (an existing name moves to the next); a
    line, a retire or both go under the note's lock: the note re-read (a frontmatter it cannot read: nothing written),
    the line appended under `## Carrier log` (the section added when missing), a retire's top-level `status:` set to
    `dropped`, then _replace_note. An OSError (the lock not taken among them): no task or no line, `; no fix task
    (cannot write <stem>: <why>)`, fix.key as it was. --dry-run prints `would file fix task [[<stem>]]`, `would note
    [[<stem>]]` or `would drop [[<stem>]]` and writes nothing. Each vault write sets ctx.wrote and saves the entry at
    once (step 4). stdout: `<key>: fix task filed: [[<stem>]]` or `<key>: fix task noted: [[<stem>]]`; a retire and the
    other note lines print nothing.
  - The settle rule (_settle_fix, once per pass, first in _finish): the pass holds a scratch {key, clear}, reset in
    handle. A key computed this pass (filed, noted, or the same key on a live task) sets fix.current true; else a
    clearing verdict sets it false, and when it was true on an open task writes one line, `- <stamp> <head12>: this
    task no longer covers the landing: <outcome>`; else it is kept. The clearing verdicts: checks green or none; the
    resolver's conflict or nowrite; a definite no-write at any other write; a draft close-out; a hold (5c's held
    marker); an author change at 5d (which records the verdict and writes nothing itself). Kept: unread results,
    pending checks, waiting for the base, a re-run or bring-current just asked for, the resolver's pushed, clean,
    failed, unread and held, a no-write that is a read failure, a held close-out, an unreadable task, a refused vault
    write.
  - The drop rule (_drop): every drop of an entry whose fix task is open (the PR merged, at 5a or 6.6: `the PR merged:
    nothing left for this landing`; closed: `the PR was closed`; out of scope: `the PR is no longer a landing`;
    supersession's close once it succeeds: `closed as superseded: <by>`, the tombstone case then dropping its fix
    record) re-reads the note under its lock and writes `- <stamp> <head12>: <why>; <tail>`. _retire: a note still
    `status: open` with no valued `rollout:` is set to `status: dropped` in the same replace (tail `dropped: nothing is
    left for it to fix`); any other live status is left to land (tail `left open (it is stamped rollout: <r> | its
    status is <s>)`). A closed, gone or unreadable note gets no write.
  - The note lock and the replace mirror reconcile-rollout.py's, so the carrier and the engine take one lock for a
    task note: _note_lock_path is `<dir>/<sha256 of the realpath of the note's directory, first 16>-<its basename,
    first 60>.lock`, dir THREAD_NOTE_LOCK_DIR when absolute, else XDG_STATE_HOME/thread/note-locks, else
    ~/.local/state/thread/note-locks; _NoteLock an fcntl flock waited for up to THREAD_NOTE_LOCK_TIMEOUT (30 s) cut to
    the pass's deadline, held only for the re-read and the replace; _replace_note _replace_keeping_metadata's temp file
    beside the note (a `cp -p` clone under local git's bound on macOS), mode and created time kept, then os.replace.

marker --login L: stdin is one or more concatenated JSON arrays of issue comments (`gh api --paginate`); the newest
comment by L (by id) whose first line starts with a marker prefix (`Landing queued (ADR 0078 d2): `, `Landing withdrawn
(ADR 0078 d2)`, `Landing held (ADR 0028 § 3)`) decides: `queued <S>` when it is `Landing queued (ADR 0078 d2): <S>`,
whatever S is, else `none`. Exit 2 on unreadable or empty JSON, or no --login. The one copy of the marker grammar:
land.sh's withdrawal calls this verb, and step 5c parses with the same code.

stuck: a read that writes nothing. One JSON line, {"state", "stuck": [{key, url, kind, movedAt, outcome}], "line"},
oldest first; `line` is `Landings: <key>: <outcome> (unmoved since <16>) · …`, or null. Due: an open entry 24 h after
movedAt (never one in the future), a tombstone flagged stuck, a search spell 24 h old (key `search`). --slug OWNER/NAME
keeps only the rows whose key's repo part (before its last `#`) is that slug, compared case-insensitively, as
landing-register.py `check --slug` matches, and the search spell, since a failed search carries nothing in any repo;
`line` is built from the rows kept, null when none is. A due row whose entry is covered (_covered, step 7) is left
out before --slug filters: its open fix task is ordinary backlog work. A row whose fix task carries ADR 0070's
take-out marker (`taken_out_next:`, `rewrite` or `you`) stays, its outcome prefixed `its fix task [[<stem>]] was taken
out (taken_out_next: <v>): `. The JSON keys stay as they are, and only landings.json is read. A slug outside land.sh origin_slug's form (`<owner>/<name>`, a
name not all dots) is usage. Without --slug the output is every due row, as it always was. Exit 0, 1 when BJ cannot be
loaded, 2 on usage. Consumers (the Stage's machinery-health read, /thread:status's Landings line, /thread:open's
landings line through --slug, any later reader) call this verb, never the file.

State: ${XDG_STATE_HOME:-~/.local/state}/thread/landings.json (or --state), {"v": 1, "landings": {"<owner>/<name>#<n>":
entry, "_pass": {...}}}; an entry holds url, kind, since, movedAt, head, handledAt, outcome, updatedFrom, slotAt,
pushed, pushedFrom, rerunHead, reruns, markerId, bound, cleared, stuck, supersededBy, closedAt, checked, redHeld (6.4b's
hold: the head a close-out was read red on while up to date) and fix ({task, key, open, marker, current, at}: the fix
task paragraph's record; a tombstone carries none). `_pass` is no entry:
it is the pass record (lastPass, searchFailedSince, searchFailedWhy), in the same map only because BJ.write_state writes
one key; an entry key always holds `#` and `_pass` never does. landings.json is the carrier's own. A corrupt file is one
WARN and is rewritten valid; an entry with no readable since is dropped with a WARN.
"""
import argparse
import hashlib
import importlib.util
import json
import os
import re
import shutil
import signal
import stat
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timedelta
from pathlib import Path
from urllib.parse import quote

try:
    import fcntl
except ImportError:  # no flock (Windows): the atomic replace alone, as reconcile-rollout.py's note lock
    fcntl = None

sys.dont_write_bytecode = True

HERE = Path(__file__).resolve().parent
SKILLS = HERE.parent.parent
BJ_FILE = HERE / "background_job.py"
REGISTER = HERE / "landing-register.py"
MERGE_TASK = SKILLS / "execute" / "scripts" / "merge-task.sh"
LEAD_INTEGRATE = SKILLS / "execute" / "scripts" / "lead-integrate.py"   # its `shards` verb: step 6.4's roll-up read
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
ROLLUP_TIMEOUT = 60
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
SLUG_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*/[A-Za-z0-9._-]+$")   # land.sh origin_slug's form (stuck --slug)
VAULT_DEFAULT = "~/repos/obsidian"   # run --vault: where the fix task is filed (the fix task paragraph)
NOTE_LOCK_TIMEOUT = 30.0             # reconcile-rollout.py's, read from THREAD_NOTE_LOCK_TIMEOUT the same way
FIX_LOG = "## Carrier log"
FIX_CLOSED = ("done", "merged", "dropped", "cancelled")
PROJECT_DEAD = ("done", "merged", "dropped")
LOG_LINES = 15
LOG_COLS = 200
FAILING_SHOWN = 3
STEM_TRIES = 1000
HELD_WHY = "held (ADR 0028 § 3): left to its session; its close follow-up task carries it"
UNSTABLE_MARK = "GitHub reads it unstable:"
TAGGED = re.compile(r"^- \S+ [0-9a-f]{12} \((red|base|review)\):")
FM_KEY = re.compile(r"^([A-Za-z0-9_][A-Za-z0-9_.-]*):(?:[ \t]+(.*))?$")
FM_ITEM = re.compile(r"^[ \t]*-(?:[ \t]+(.*))?$")
LINK = re.compile(r"\[\[(.*)\]\]", re.S)
LOG_TS = re.compile(r"^\ufeff?[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?Z ?")
ANSI = re.compile(r"\x1b\[[0-9;?]*[A-Za-z]")
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
    """(id, S or None, cls) for the newest marker-class comment by login, or None: the one copy of the marker grammar.
    cls is which marker it is, `queued`, `withdrawn` or `held`; S is set only for a queued one."""
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
    if first.startswith(QUEUED):
        return cid, first[len(QUEUED):].strip(), "queued"
    return cid, None, "withdrawn" if first.startswith(WITHDRAWN) else "held"


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
    """One bare partial clone of a repo's base branch for this pass; `base` is its tip (the base tip, never the PR's
    base.sha)."""

    def __init__(self, ctx, slug, base_ref):
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
        self.base = self.rev(f"refs/heads/{base_ref}")
        if not self.base:
            raise CloneError(f"the clone holds no {base_ref}")
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
        self.pulls, self.repos, self.slots, self.clones, self.gum, self.tips = {}, {}, {}, {}, {}, {}
        self.superseded = set()
        self._scratch = None
        self.wrote = False
        self.vault = Path(os.path.expanduser(args.vault))
        self.tasks = self.vault / "Work" / "Tasks"
        self.fx = {"key": None, "clear": None}   # this PR's fix verdicts, settled once in _finish (_settle_fix)
        self.projects, self.origins = {}, {}
        self._archived, self._register = None, False

    def vault_ok(self):
        return self.tasks.is_dir()

    def archived(self):
        """The fix-task names under Work/Tasks/Archive/ (any year folder), read once per pass."""
        if self._archived is None:
            try:
                self._archived = {p.name for p in (self.tasks / "Archive").rglob("landing-fix-*.md")}
            except OSError:
                self._archived = set()
        return self._archived

    def register(self):
        """landing-register.py, loaded by path once per pass (its ORIGIN_RE and parse_slug), or None."""
        if self._register is False:
            try:
                spec = importlib.util.spec_from_file_location("thread_landing_register", str(REGISTER))
                mod = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(mod)
                self._register = mod
            except Exception:  # noqa: BLE001 — an unloadable register matches no checkout: no fix task, said why
                self._register = None
        return self._register

    def keep(self, it, e):
        """A vault write saves the entry at once (step 4), so a cut pass keeps its fix record."""
        if not self.dry:
            self.state[it.key] = dict(e)
            self.save()

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

    def clone(self, slug, base_ref):
        k = (slug.lower(), base_ref)
        c = self.clones.get(k)
        if isinstance(c, CloneError):
            raise c
        if c is None:
            try:
                c = Clone(self, slug, base_ref)
            except CloneError as e:
                self.clones[k] = e
                raise
            self.clones[k] = c
        return c

    def base_tip(self, slug, base_ref):
        """The base tip (the module docstring's): the scratch clone's once there is one, else one `GET
        git/ref/heads/<base_ref>` per repo per pass. GhError when that read fails."""
        k = (slug.lower(), base_ref)
        c = self.clones.get(k)
        if isinstance(c, Clone):
            return c.base
        if k not in self.tips:
            try:
                r = api_json(f"repos/{slug}/git/ref/heads/{quote(base_ref, safe='/')}")
                sha = ((r.get("object") or {}).get("sha") or "") if isinstance(r, dict) else ""
            except GhError as e:
                self.tips[k] = e
            else:
                self.tips[k] = sha if HEX40.match(sha) else GhError(f"unexpected JSON for {slug}'s {base_ref}")
        if isinstance(self.tips[k], GhError):
            raise self.tips[k]
        return self.tips[k]

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

    def write_block(self, slug):
        """(why, definite): why is None when a write to slug may go ahead (push permission, then the register, read
        fresh), else why not; definite when the refusal is a verdict (no push permission read, or the register's exit
        3), not a read that failed."""
        info = self.repo(slug)
        if info["err"]:
            return info["err"], False
        if not info["push"]:
            return f"no push permission on {slug}", True
        t = _bound(GH_TIMEOUT)
        rc, out, err, timed_out = _run([sys.executable, "-B", str(REGISTER), "check", "--slug", slug], t)
        if timed_out:
            return f"the landing register check ran past {t:.0f} s", False
        if rc != 0:
            return f"landing register: {_flat(out) or _why(err) or f'exit {rc}'}", rc == 3
        return None, False

    def act(self, slug, key, desc, argv):
        """One GitHub write, after write_block: (True, None), or (False, why). --dry-run prints `would <desc>`. A
        definite refusal is this pass's clearing verdict (the fix task paragraph's settle rule)."""
        why, definite = self.write_block(slug)
        if why:
            if definite:
                self.fx["clear"] = f"no write ({why})"
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
        if items:
            try:
                ctx.me = _flat(gh("api", "user", "--jq", ".login"))
                if not ctx.me:
                    raise GhError("no login")
            except GhError as e:
                _search_failed(ctx, f"cannot read the GitHub login: {e}")
                items = None
        ctx.items = items or []
        for it in _order(ctx):
            if DEADLINE_AT - time.monotonic() < 1:
                break
            if not handle(ctx, it):
                break
    except _Deadline:
        pass  # the deadline came before the PRs: the next pass starts over
    finally:
        ctx.cleanup()
    ctx.save()
    return 0


def handle(ctx, it):
    """One PR: Phase A, then Phase B, then its entry written. False when the deadline cut it (the pass stops)."""
    old = ctx.state.get(it.key)
    e = dict(old) if isinstance(old, dict) else None
    if e is not None and isinstance(e.get("fix"), dict):
        e["fix"] = dict(e["fix"])
    ctx.wrote = False
    ctx.fx = {"key": None, "clear": None}
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


def _day_old(ctx, e):
    """The entry is unmoved for a day: movedAt (first sight or the last author change) 24 h or more before now."""
    moved = _parse_iso(e.get("movedAt"))
    return moved is not None and moved <= ctx.now and ctx.now - moved >= STUCK_AFTER


def _finish(ctx, it, e, kind, outcome):
    """The entry after its act: the kind, outcome, handledAt, fix.current settled (_settle_fix), then the stuck rule
    (step 7), which a covered landing never meets."""
    e["kind"], e["outcome"], e["handledAt"] = kind, outcome, ctx.stamp
    _settle_fix(ctx, it, e, outcome)
    if not _covered(e) and _day_old(ctx, e):
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
        if e.get("supersededBy"):  # a tombstone keeps its own stuck flag (step 8)
            e["outcome"], e["handledAt"] = f"cannot read the PR: {ex}", ctx.stamp
            return e
        return _finish(ctx, it, e, e.get("kind") or "unread", f"cannot read the PR: {ex}")
    head_ref, head = pr["head"]["ref"], pr["head"]["sha"]
    if pr.get("merged"):
        _drop(ctx, it, e, "the PR merged: nothing left for this landing", head)
        return DROP
    if pr["state"] == "closed":
        if e and e.get("supersededBy"):
            return tombstone(ctx, it, e)
        _drop(ctx, it, e, "the PR was closed", head)
        return DROP
    labels = {x.get("name") for x in (pr.get("labels") or []) if isinstance(x, dict)}
    base_ref = pr["base"]["ref"]
    grammar = bool(CLOSE_RE.match(head_ref))
    if "landing" not in labels and not grammar:
        _drop(ctx, it, e, "the PR is no longer a landing", head)
        return DROP
    url = pr.get("html_url") or it.url
    if e is None:
        e = _entry(ctx, it, url, head)
    e["url"] = url
    e.pop("supersededBy", None)
    e.pop("closedAt", None)
    _refresh_fix(ctx, e)

    # 5d: the head, for the clock only
    prev = e.get("head")
    if prev and prev != head:
        e.pop("redHeld", None)   # the hold is head-specific
        carrier = head == e.get("pushed") or ctx.gh_update_merge(slug, head, prev, base_ref)[0] is not False
        if not carrier:
            e["movedAt"], e["reruns"], e["rerunHead"] = ctx.stamp, 0, head
            ctx.fx["clear"] = "an author push"
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
    why, review = None, False
    if grammar:
        kind = "close-out"
    elif pr.get("draft"):
        kind, why, review = "own-unqueued", "a draft: left to its session", None   # None: its marker read at filing
    elif pr.get("auto_merge"):
        kind = "own-auto"
    else:
        kind, why, review = own_kind(ctx, it, pr, e)
    if (e.get("markerId"), e.get("bound"), e.get("cleared")) != before and not ctx.dry:
        ctx.state[it.key] = dict(e)   # O1: a changed binding is on disk before any write for this PR
        ctx.save()
    if kind == "own-unqueued":
        if _day_old(ctx, e):
            why = _review_fix(ctx, it, pr, e, why, review)
        return _finish(ctx, it, e, kind, why)

    # 5e: the checks
    try:
        checks = read_checks(ctx, slug, head, base_ref)
    except GhError as ex:
        checks = {"cls": "unread", "pending": False, "why": f"cannot read the checks: {ex}"}
    return act(ctx, it, pr, e, kind, checks)


def own_kind(ctx, it, pr, e):
    """(kind, why, review) of an own PR with no auto-merge: its newest marker, then the binding (5f). review is True
    only when the comments were read and the newest marker is no hold: an own-unqueued PR may then get its review
    fix task a day on (step 6.0). A hold is a clearing verdict (the fix task paragraph's settle rule)."""
    slug, n = it.slug, it.n
    try:
        m = newest_marker(api_json(f"repos/{slug}/issues/{n}/comments?per_page=100", paginate=True), ctx.me)
    except GhError as ex:
        return "own-unqueued", f"cannot read its comments ({ex}): left to its session", False
    if m is not None and m[2] == "held":
        ctx.fx["clear"] = HELD_WHY
        return "own-unqueued", HELD_WHY, False
    if m is None or m[1] is None:
        return "own-unqueued", "not queued: left to its session", True
    cid, s, _ = m
    if e.get("markerId") == cid and e.get("cleared"):
        return "own-unqueued", "its queue marker no longer binds: left to its session", True
    b = e.get("bound") if e.get("markerId") == cid and e.get("bound") else s
    head = pr["head"]["sha"]
    if head == b or (head == e.get("pushed") and e.get("pushedFrom") == b):
        e.update(markerId=cid, bound=head, cleared=False)
        return "own-marked", None, False
    v, p2 = ctx.gh_update_merge(slug, head, b, pr["base"]["ref"])
    if v is None:
        return "own-unqueued", "cannot read whether the head follows its queue marker: left to its session", False
    if v:
        try:
            cl = ctx.clone(slug, pr["base"]["ref"])
            cl.fetch_head(n, pr["head"]["ref"], head)
            follows = cl.merge_tree(b, p2) == cl.git("rev-parse", f"{head}^{{tree}}")
        except CloneError as ex:
            return ("own-unqueued", f"cannot read whether the head follows its queue marker ({ex}): left to its session",
                    False)
        if follows:
            e.update(markerId=cid, bound=head, cleared=False)
            return "own-marked", None, False
    e.update(markerId=cid, bound=None, cleared=True)
    return ("own-unqueued", f"its queue marker is for {str(b)[:12]} and the head moved past it: left to its session",
            True)


def read_checks(ctx, slug, sha, base_ref):
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
        base_sha = ctx.base_tip(slug, base_ref)
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
    head = pr["head"]["sha"]
    st = pr.get("mergeable_state")
    settled = st != "unknown"
    green = checks["cls"] in ("green", "none")
    auto_on = bool(pr.get("auto_merge"))
    note = None
    if pr.get("draft"):
        ctx.fx["clear"] = "a draft close-out"
        return _finish(ctx, it, e, kind, "a draft: left to its session")
    if green:
        ctx.fx["clear"] = f"checks {checks['cls']}"

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
        if _held(e, head, checks):
            return done(f"dirty: {_hold_text(e, head)}")
        outcome, verdict = resolver(ctx, it, pr, e)
        if verdict in ("conflict", "nowrite"):
            ctx.fx["clear"] = outcome
        return done(outcome)
    if checks["cls"] in ("red", "infra") and not checks["pending"]:
        reruns = (e.get("reruns") or 0) if e.get("rerunHead") == head else 0
        if reruns >= RERUN_MAX:
            outcome, real = "rerun budget spent", True
        else:
            outcome, real = rerun(ctx, it, pr, e, checks, reruns)
        if real:
            outcome = (_closeout_red if kind == "close-out" else _own_red)(ctx, it, pr, e, checks, outcome)
        return done(outcome)
    if settled and st == "behind" and green:
        return done(_bring_current(ctx, it, e, head))
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
        _drop(ctx, it, e, "the PR merged: nothing left for this landing", head)
        return DROP
    return done(_wait_outcome(pr, checks, settled))


def _bring_current(ctx, it, e, head):
    """Step 6.5's bring-current, shared with 6.4b and (d): the repo's slot, then `PUT update-branch` pinned to the
    head; its outcome."""
    slug, n, key = it.slug, it.n, it.key
    if ctx.slots.get(slug.lower()):
        return "waiting its turn to be brought current"
    ctx.slots[slug.lower()] = key
    if not ctx.dry:
        e["slotAt"] = ctx.stamp
    ok, why = ctx.act(slug, key, f"request update-branch (from {head[:12]})",
                      ["api", "--method", "PUT", f"repos/{slug}/pulls/{n}/update-branch",
                       "-f", f"expected_head_sha={head}"])
    if not ok:
        return f"update-branch not requested: {why}"
    if not ctx.dry:
        e["updatedFrom"] = head
        ctx.say(f"{key}: update-branch requested (from {head[:12]})")
    return f"update-branch requested (from {head[:12]})"


# ---- step 6.4b and (d): a real red ------------------------------------------------------------------------------------

def _failing(checks):
    """The sorted names of the checks that read failing: a completed non-pass check run, a status neither success
    nor pending."""
    names = {n for n, r in checks.get("runs", {}).items()
             if r.get("status") == "completed" and (r.get("conclusion") or "") not in PASS_CONC}
    names |= {n for n, s in checks.get("statuses", {}).items() if (s.get("state") or "") not in ("success", "pending")}
    return sorted(names)


def _red_key(head, checks):
    return f"red:{head}:{','.join(_failing(checks))}"


def _held(e, head, checks):
    """The hold (6.4b): a close-out read red while up to date on this head, its checks reading neither green nor none,
    and its fix task open, unreadable or absent. 6.3 and 6.4b read it; nothing else reads redHeld."""
    if e.get("redHeld") != head or checks["cls"] in ("green", "none"):
        return False
    fx = e.get("fix")
    return not isinstance(fx, dict) or fx.get("open") is not False


def _hold_text(e, head):
    fx = e.get("fix") if isinstance(e.get("fix"), dict) else {}
    named = f" [[{fx['task']}]]" if fx.get("task") else ""
    return (f"held for its fix task{named}: red while up to date at {head[:12]}, brought current again only once that "
            "task closes or its checks read green")


def _closed_text(stem):
    return f"its fix task [[{stem}]] is closed, and the landing has not moved (ADR 0078 d1)"


def _compare(ctx, it, tip, head):
    """GET compare/<tip>...<head>'s status; GhError when unread."""
    try:
        status = api_json(f"repos/{it.slug}/compare/{tip}...{head}").get("status")
    except AttributeError:
        raise GhError("unexpected compare JSON") from None
    if not isinstance(status, str):
        raise GhError("no compare status")
    return status


def _rule_d(ctx, it, pr, e, prev, stem):
    """(d) the fix has landed: a real red whose fix task is closed with the same key is brought current once its
    base is green and it is behind or diverged; otherwise the closed task is named and the landing is listed."""
    head, base_ref = pr["head"]["sha"], pr["base"]["ref"]
    try:
        tip = ctx.base_tip(it.slug, base_ref)
        if read_checks(ctx, it.slug, tip, base_ref)["cls"] in ("green", "none") \
                and _compare(ctx, it, tip, head) in ("behind", "diverged") and pr.get("mergeable_state") != "unknown":
            return f"{prev}; its fix task [[{stem}]] is closed: {_bring_current(ctx, it, e, head)}"
    except GhError:
        pass
    return f"{prev}; {_closed_text(stem)}"


def _own_red(ctx, it, pr, e, checks, prev):
    """A real red on own-auto or own-marked: the red variant at once, or (d) once its task is closed."""
    state, text = _file_fix(ctx, it, pr, e, "red", _red_key(pr["head"]["sha"], checks), prev, checks)
    if state == "closed":
        return _rule_d(ctx, it, pr, e, prev, text)
    return f"{prev}; {text}"


def _closeout_red(ctx, it, pr, e, checks, prev):
    """Step 6.4b: a close-out's real red read against its base (the module docstring's rules, in order)."""
    slug, head, base_ref = it.slug, pr["head"]["sha"], pr["base"]["ref"]
    fx = e.get("fix") if isinstance(e.get("fix"), dict) else None
    rkey = _red_key(head, checks)
    rwhy = f"{prev}, while up to date with a green {base_ref}"
    if _held(e, head, checks):
        state, text = _file_fix(ctx, it, pr, e, "red", rkey, rwhy, checks)
        return f"{prev}; {_hold_text(e, head)}" + (f"; {text}" if state == "none" else "")
    if e.get("redHeld") == head and fx and fx.get("open") is False:
        state, text = _file_fix(ctx, it, pr, e, "red", rkey, rwhy, checks)
        return _rule_d(ctx, it, pr, e, prev, text) if state == "closed" else f"{prev}; {text}"
    try:
        tip = ctx.base_tip(slug, base_ref)
        bchecks = read_checks(ctx, slug, tip, base_ref)
    except GhError as ex:
        return f"{prev}; cannot read {base_ref}'s checks ({ex})"
    bcls, at = bchecks["cls"], f"its base {base_ref} reads {bchecks['cls']} at {tip[:12]}"
    if bcls not in ("green", "none"):
        if not _day_old(ctx, e):
            return f"{prev}; {at}: waiting for it to turn green"
        state, text = _file_fix(ctx, it, pr, e, "base", f"base:{head}", f"{at}, a day on", bchecks)
        return f"{prev}; {at}; {_closed_text(text)}" if state == "closed" else f"{prev}; {at}: {text}"
    try:
        status = _compare(ctx, it, tip, head)
    except GhError as ex:
        return f"{prev}; cannot read how {head[:12]} compares with {base_ref} ({ex})"
    if status in ("behind", "diverged"):
        if pr.get("mergeable_state") == "unknown":
            return f"{prev}; GitHub has not settled its mergeability"
        return f"{prev}; {_bring_current(ctx, it, e, head)}"
    if status not in ("ahead", "identical"):
        return f"{prev}; cannot read how {head[:12]} compares with {base_ref} (status {status})"
    e["redHeld"] = head
    state, text = _file_fix(ctx, it, pr, e, "red", rkey, rwhy, checks)
    if state == "closed":
        return f"{prev}; {_closed_text(text)}"
    return f"{prev}; red while up to date with a green {base_ref}: {text}"


# ---- step 6.4: the rerun rule -----------------------------------------------------------------------------------------

def _classify(steps):
    """(verdict, why): merge-task.sh --classify-steps' `infra` or `genuine`, `genuine` too with no merge-task.sh (a
    fixed fact of the install), and `unread` (why says how) for a cut, a non-zero exit or any other output."""
    if not MERGE_TASK.is_file():
        return "genuine", None
    t = _bound(CLASSIFY_TIMEOUT)
    rc, out, err, timed_out = _run(["bash", str(MERGE_TASK), "--classify-steps"], t, input="\n".join(steps) + "\n")
    if timed_out:
        return "unread", f"it ran past {t:.0f} s and was stopped"
    if rc != 0:
        return "unread", f"exit {rc}: {_why(err or out) or 'no output'}"
    v = out.strip()
    if v in ("infra", "genuine"):
        return v, None
    return "unread", f"it printed {_flat(v)[:60]!r}"


def _rollups(ctx, it, pr, run, jobs, bad):
    """Step 6.4's roll-up read: (bad less each roll-up job that stands for a non-pass job it needs, None, None) on
    exit 0 or 3; (None, why, True) when a roll-up is not proven (exit 1) or a non-pass job has no id, a real red; and
    (None, why, False) when the head's workflow could not be read (no lead-integrate.py, a clone or head fetch that
    fails, the reader cut at its bound, any other exit, unreadable JSON), unread."""
    head = pr["head"]["sha"]
    if not LEAD_INTEGRATE.is_file():
        return None, f"run {run}'s roll-up checks cannot be read (no lead-integrate.py)", False
    try:
        cl = ctx.clone(it.slug, pr["base"]["ref"])
        cl.fetch_head(it.n, pr["head"]["ref"], head)
    except CloneError as ex:
        return None, f"run {run}'s roll-up checks cannot be read ({ex})", False
    ids = [str(j["id"]) for j in bad if isinstance(j.get("id"), int)]
    if len(ids) != len(bad):
        return None, f"run {run} has a non-pass job with no id", True
    doc = {"jobs": [dict(j, databaseId=j.get("id")) for j in jobs if isinstance(j, dict)]}
    wf = next((j.get("workflow_name") for j in jobs if isinstance(j, dict) and j.get("workflow_name")), None)
    if isinstance(wf, str):
        doc["workflowName"] = wf   # the file the run ran, as `gh run view --json workflowName` names it
    f = Path(ctx.scratch()) / f"jobs-{it.n}-{run}.json"
    f.write_text(json.dumps(doc))
    t = _bound(ROLLUP_TIMEOUT)
    rc, out, err, timed_out = _run([sys.executable, "-B", str(LEAD_INTEGRATE), "shards", "--repo", str(cl.dir),
                                    "--head", head, "--jobs", str(f), "--whole", "--job-id", *ids], t)
    if timed_out:
        return None, f"run {run}'s roll-up checks cannot be read (the reader ran past {t:.0f} s and was stopped)", False
    if rc == 3:
        return bad, None, None
    if rc == 1:
        return None, f"run {run}: a roll-up check is not proven ({_why(err) or 'lead-integrate.py shards exit 1'})", True
    if rc != 0:
        return None, (f"run {run}'s roll-up checks cannot be read (lead-integrate.py shards exit {rc}: "
                      f"{_why(err) or 'no output'})"), False
    try:
        kept = {j.get("databaseId") for j in json.loads(out)["jobs"]}
    except (ValueError, KeyError, TypeError, AttributeError):
        return None, f"run {run}'s roll-up checks cannot be read (unreadable JSON from lead-integrate.py shards)", False
    return [j for j in bad if j.get("id") in kept], None, None


def rerun(ctx, it, pr, e, checks, reruns):
    """Step 6.4: (outcome, real). real is True when the next pass would read the same head the same way (a red no
    re-run can clear), False when a later pass may read it otherwise (a read that failed, a re-run asked for)."""
    slug, key, head = it.slug, it.key, pr["head"]["sha"]
    stop, real, runs, steps, owners = None, True, [], [], []
    for name, r in checks["runs"].items():
        if r.get("status") != "completed" or (r.get("conclusion") or "") in PASS_CONC:
            continue
        m = JOB_URL.search(str(r.get("details_url") or ""))
        if ((r.get("app") or {}).get("slug")) != "github-actions" or not m:
            stop = f"{name} is not a GitHub Actions job"
            break
        if int(m.group(1)) not in runs:
            runs.append(int(m.group(1)))
    for name, s in checks["statuses"].items():
        if not stop and (s.get("state") or "") not in ("success", "pending"):
            stop = f"status {name} is {s.get('state')}"
    words = {"failure": "failed", "timed_out": "timed out", "startup_failure": "failed to start"}
    for run in ([] if stop else runs):
        try:
            jobs = api_json(f"repos/{slug}/actions/runs/{run}/jobs?per_page=100").get("jobs") or []
        except (GhError, AttributeError) as ex:
            stop, real = f"cannot read the jobs of run {run} ({ex})", False
            break
        bad = [j for j in jobs if isinstance(j, dict) and j.get("status") == "completed"
               and (j.get("conclusion") or "") not in PASS_CONC]
        if not bad:
            stop, real = f"run {run} shows no failed job", False
            break
        if len(bad) > 1 and any((j.get("conclusion") or "") != "cancelled" for j in bad):
            bad, why, rreal = _rollups(ctx, it, pr, run, jobs, bad)   # a roll-up is read through the jobs it needs
            if why:
                stop, real = why, rreal
                break
            if not bad:
                stop = f"run {run} shows no failed job beside its roll-up checks"
                break
        for j in bad:
            c, jn = j.get("conclusion") or "", _flat(j.get("name")) or str(j.get("id"))
            if c == "cancelled":
                continue
            if c not in words:
                stop = f"{jn} concluded {c}"
                break
            failed = [_flat(s.get("name")) for s in (j.get("steps") or [])
                      if isinstance(s, dict) and s.get("conclusion") == "failure"]
            if not failed:
                stop = f"{jn} {words[c]} with no failed step"
                break
            steps += failed
            owners.append(f"{jn} ({failed[0]})")
        if stop:
            break
    if not stop and steps:
        verdict, why = _classify(steps)
        if verdict == "unread":
            return f"not re-run: the step classifier could not be read ({why})", False
        if verdict != "infra":
            stop = "a genuine failure in " + "; ".join(owners[:3])
    if stop:
        return f"not re-run: {stop}", real
    if not runs:
        return "not re-run: no GitHub Actions run to re-run", False
    if not ctx.dry:
        e["rerunHead"], e["reruns"] = head, reruns + 1
    failed = []
    for run in runs:
        ok, why = ctx.act(slug, key, f"re-run run {run}", ["api", "--method", "POST",
                                                          f"repos/{slug}/actions/runs/{run}/rerun-failed-jobs"])
        if not ok:
            failed.append(f"run {run}: {why}")
    if failed:
        return "re-run failed: " + "; ".join(failed), False
    what = "cancelled jobs" if not steps else "infra steps " + ", ".join(sorted(set(steps)))[:120]
    if not ctx.dry:
        ctx.say(f"{key}: re-ran run{'s' if len(runs) > 1 else ''} {', '.join(map(str, runs))} ({what})")
    return (f"re-ran run{'s' if len(runs) > 1 else ''} {', '.join(map(str, runs))} ({what}; {reruns + 1} of "
            f"{RERUN_MAX})"), False


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
    """Step 6.3: (outcome, verdict), verdict one of unread, clean, conflict, nowrite, pushed, failed (the module
    docstring's step 6.3); conflict and nowrite are clearing verdicts."""
    slug, n, key = it.slug, it.n, it.key
    head, head_ref = pr["head"]["sha"], pr["head"]["ref"]
    base_ref = pr["base"]["ref"]
    if ctx.slots.get(slug.lower()):
        return "dirty: waiting its turn to be brought current", "unread"
    try:
        cl = ctx.clone(slug, base_ref)
        base = cl.base
        cl.fetch_head(n, head_ref, head)
        rc, out = cl.git("merge-tree", "--write-tree", "-z", head, base, ok=(0, 1), raw=True)
        if rc == 0:
            return "dirty on GitHub, but the merge is clean: left to update-branch", "clean"
        tree, conflicts, msgs = _parse_merge_tree(out.decode("utf-8", "replace"))
        for paths, typ in msgs:
            if typ not in ("Auto-merging", "CONFLICT (contents)"):
                return f"not resolved: a {typ} conflict on {', '.join(paths)}", "conflict"
        for path in sorted(conflicts):
            if not closeout_shaped(path):
                return f"not resolved: {path} conflicts, and it is no close-out path", "conflict"
        mb = cl.git("merge-base", head, base)
        resolved = {}
        for path in sorted(conflicts):
            stages = conflicts[path]
            if set(stages) != {1, 2, 3}:
                return f"not resolved: {path} is not changed on both sides", "conflict"
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
                return f"not resolved: {why}", "conflict"
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
        return f"not resolved: {ex}", "unread"
    names = ", ".join(sorted(resolved))
    if ctx.dry:
        why, definite = ctx.write_block(slug)
        if why:
            return f"not pushed: no write ({why})", "nowrite" if definite else "unread"
        ctx.say(f"{key}: would resolve {names} and push {commit[:12]}")
        return f"would resolve {names}", "pushed"
    e["pushed"], e["pushedFrom"] = commit, head
    ctx.state[key] = dict(e)   # O1: the push is recorded before it is made
    ctx.save()
    why, definite = ctx.write_block(slug)
    if why:
        return f"not pushed: no write ({why})", "nowrite" if definite else "unread"
    ctx.slots[slug.lower()] = key
    e["slotAt"] = ctx.stamp
    ctx.wrote = True
    try:
        cl.git("-c", "core.hooksPath=/dev/null", "push", "origin", f"{commit}:refs/heads/{head_ref}",
               timeout=PUSH_TIMEOUT)
    except CloneError as ex:
        return f"resolved {names}, but the push failed: {ex}", "failed"
    ctx.say(f"{key}: resolved {names} and pushed {commit[:12]}")
    return f"resolved {names} and pushed {commit[:12]}", "pushed"


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


def _carried(cl, changes, add_in, remove_in):
    """P's lines carried into a target (the module docstring's Supersession): each line P adds is in one of the
    commits add_in, and each line P removes (a path P deletes) is in none of the commits remove_in."""
    for st, path, added, removed, binary in changes:
        files = {}

        def at(ts, path=path, files=files):
            for t in ts:
                if t not in files:
                    files[t] = cl.lines(t, path)
            return [files[t] for t in ts if files[t] is not None]
        gone = at(remove_in)
        if st == "D":
            if gone:
                return False
            continue
        if binary:
            return False
        present = at(add_in)
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
        kept = set()
        for f in gone:
            kept.update(f)
        for ln in removed:
            if not ln.strip() or ln in readded or (is_thread(path) and _date(ln)):
                continue
            if ln in kept:
                return False
    return True


def supersession(ctx, it, pr, e):
    """Step 6.1: None, a string (why it was not evaluated), or ("base", None) / ("pr", (item, L's PR))."""
    slug, n = it.slug, it.n
    head, head_ref = pr["head"]["sha"], pr["head"]["ref"]
    base_ref = pr["base"]["ref"]
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

    def ckey(base):
        return f"{base}:{head}:" + ",".join(f"{o.n}={lp['head']['sha']}" for o, lp in cands)
    try:
        base = ctx.base_tip(slug, base_ref)
    except GhError as ex:
        return f"supersession not read (cannot read {base_ref}'s tip: {ex})"
    chk = e.get("checked") if isinstance(e.get("checked"), dict) else {}
    if chk.get("key") == ckey(base):
        verdict = chk.get("verdict")
    else:
        try:
            cl = ctx.clone(slug, base_ref)
            base = cl.base
            cl.fetch_head(n, head_ref, head)
            commits = cl.git("rev-list", "--no-merges", "--topo-order", f"{base}..{head}").split()
            verdict = None
            if commits:
                mb = cl.git("merge-base", base, head)
                changes = _changes(cl, mb, head)
                if len(commits) == 1 and _carried(cl, changes, [base], [base]):
                    verdict = "base"
                else:
                    rest = set(commits[1:])
                    for o, lp in cands:
                        lh = lp["head"]["sha"]
                        cl.fetch_head(o.n, lp["head"]["ref"], lh)
                        lset = set(cl.git("rev-list", f"{base}..{lh}").split())
                        if rest <= lset and _carried(cl, changes, [base, lh], [lh]):
                            verdict = o.key
                            break
        except CloneError as ex:
            return f"supersession not read ({ex})"
        e["checked"] = {"key": ckey(base), "verdict": verdict}
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
    pass_on(ctx, key, None if what == "base" else l)
    _drop(ctx, it, e, f"closed as superseded: {by}", pr["head"]["sha"])
    if what == "base":
        return DROP
    e.pop("fix", None)   # a tombstone carries no fix record
    e["supersededBy"], e["closedAt"] = l[0].key, ctx.stamp
    e["kind"], e["outcome"], e["handledAt"], e["stuck"] = "close-out", f"closed as superseded ({by})", ctx.stamp, False
    return e


def pass_on(ctx, key, l):
    """Step 8's chain: the tombstones that name key, just closed as superseded, now name its target l (item, PR), or
    are dropped when l is None (key's lines are on base, so theirs are)."""
    for k in [k for k, x in ctx.state.items() if k != PASS and isinstance(x, dict) and x.get("supersededBy") == key]:
        if l is None:
            ctx.state.pop(k)
        else:
            ctx.state[k] = dict(ctx.state[k], supersededBy=l[0].key,
                                outcome=f"closed as superseded by {l[1].get('html_url') or l[0].url}, which is open")


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


# ---- the fix task (ADR 0078 d2 as amended by p47-20) ------------------------------------------------------------------

def _drop_comment(raw):
    """reconcile-rollout.py _drop_comment's rule: a value without its ` # comment`; a lone comment is ''."""
    return re.sub(r"\s+#.*$|^#(\s.*)?$", "", raw)


def _scalar(value):
    """reconcile-rollout.py _scalar's rule: ` # comment` dropped, quotes and whitespace stripped ('' for None or a
    list)."""
    if value is None or isinstance(value, list):
        return ""
    s = _drop_comment(str(value)).strip()
    return s.strip('"').strip("'").strip()


def _valued(value):
    """reconcile-rollout.py _valued: says something once quotes and a comment are dropped, and is not YAML's null; a
    non-empty list does."""
    if isinstance(value, list):
        return any(_valued(x) for x in value)
    return _scalar(value).lower() not in ("", "null", "~")


def _unlink(s):
    m = LINK.fullmatch(s.strip())
    return m.group(1).split("|")[0].split("#")[0].strip() if m else s


def _as_list(value):
    if value is None:
        return []
    return [x for x in value if x] if isinstance(value, list) else ([value] if value else [])


def _flow(val):
    """A flow list's items ([a, "[[b|c]]"]: each unquoted, a link unwrapped), or None when it does not close."""
    if not val.endswith("]"):
        return None
    items, cur, q, depth = [], "", None, 0
    for ch in val[1:-1]:
        if q:
            q = None if ch == q else q
        elif ch in "\"'":
            q = ch
        elif ch == "[":
            depth += 1
        elif ch == "]":
            depth -= 1
        elif ch == "," and depth == 0:
            items.append(cur)
            cur = ""
            continue
        cur += ch
    if q or depth:
        return None
    items.append(cur)
    return [x for x in (_unlink(_scalar(i)) for i in items) if x]


def _fm(text):
    """The note's frontmatter, {key: scalar | [items] | None}, or None when unreadable (the fix task paragraph's _fm
    grammar): between the first two `---` lines, blank and `#` lines skipped, top-level `key: value` scalars
    (_scalar's rule), flow lists, and block `- item` lists under an empty-valued key; any other line is unreadable."""
    lines = text.split("\n")
    if not lines or lines[0].rstrip("\r").rstrip() != "---":
        return None
    out, cur = {}, None
    for raw in lines[1:]:
        ln = raw.rstrip("\r")
        if ln.rstrip() == "---":
            return out
        s = ln.strip()
        if not s or s.startswith("#"):
            continue
        m = FM_KEY.match(ln)
        if m:
            key, val, cur = m.group(1), _drop_comment(m.group(2) or "").strip(), None
            if not val:
                out[key], cur = None, key
            elif val.startswith("[") and not (val.startswith("[[") and not val.startswith("[[[")):
                items = _flow(val)
                if items is None:
                    return None
                out[key] = items
            else:
                out[key] = _scalar(val)
            continue
        m = FM_ITEM.match(ln)
        if m and cur is not None:
            out[cur] = (out[cur] or []) + [x for x in [_unlink(_scalar(m.group(1) or ""))] if x]
            continue
        return None
    return None


def _tags(fm):
    return {str(t).strip().lstrip("#") for t in _as_list(fm.get("tags")) if str(t).strip()}


def _open_of(fm):
    """A readable note's Open rule: its status is not done, merged, dropped or cancelled, it is no carried fix
    (`status: review` with a valued `merged:`, reconcile-rollout.py _carried_fix), and its tags hold no `archived`."""
    st = _scalar(fm.get("status")).lower()
    if st in FIX_CLOSED or "archived" in _tags(fm):
        return False
    return not (st == "review" and _valued(fm.get("merged")))


def _fix_note(ctx, stem):
    return ctx.tasks / f"{stem}.md"


def _fix_open(path):
    """(open, fm): open True, False (closed, or no note at Work/Tasks/<stem>.md: archived or gone), or None (a root
    note whose frontmatter _fm cannot read); fm is its frontmatter when read."""
    try:
        text = Path(path).read_text(encoding="utf-8")
    except FileNotFoundError:
        return False, None
    except (OSError, UnicodeDecodeError):
        return None, None
    fm = _fm(text)
    return (None, None) if fm is None else (_open_of(fm), fm)


def _refresh_fix(ctx, e):
    """Each pass with a fix record re-reads its note (after 5a, before 5d): open, and the take-out marker from
    `taken_out_next:`. A missing vault keeps the last values."""
    fx = e.get("fix")
    if not isinstance(fx, dict) or not fx.get("task") or not ctx.vault_ok():
        return
    fx["open"], fm = _fix_open(_fix_note(ctx, fx["task"]))
    if fm is not None:
        fx["marker"] = _scalar(fm.get("taken_out_next")) or None


def _covered(e):
    """The landing is covered, so never stuck: its fix task open (never null), still covering it, and not taken out."""
    fx = e.get("fix") if isinstance(e, dict) else None
    return isinstance(fx, dict) and fx.get("open") is True and fx.get("current") is True and not fx.get("marker")


def _note_lock_path(path):
    """reconcile-rollout.py _note_lock_path's mirror: one lock per directory of notes, outside the vault, so the
    carrier and the engine take the same lock for a task note."""
    absolute = lambda v: v if v and os.path.isabs(v) else None   # noqa: E731  a relative dir is ignored (the XDG rule)
    base = absolute(os.environ.get("THREAD_NOTE_LOCK_DIR")) or os.path.join(
        absolute(os.environ.get("XDG_STATE_HOME")) or os.path.join(os.path.expanduser("~"), ".local", "state"),
        "thread", "note-locks")
    real = os.path.dirname(os.path.realpath(str(path)))
    return Path(base) / f"{hashlib.sha256(real.encode()).hexdigest()[:16]}-{os.path.basename(real)[:60]}.lock"


class _NoteLock:
    """reconcile-rollout.py _note_lock's mirror: an flock on _note_lock_path, waited for up to
    THREAD_NOTE_LOCK_TIMEOUT (30 s) cut to what is left of the pass's deadline, held only for a re-read and a
    replace. Not taken: an OSError, nothing written. No fcntl: no lock, the atomic replace alone."""

    def __init__(self, path):
        self.lock_path, self.fh = _note_lock_path(path), None

    def __enter__(self):
        if fcntl is None:
            return self
        try:
            timeout = float(os.environ.get("THREAD_NOTE_LOCK_TIMEOUT") or NOTE_LOCK_TIMEOUT)
        except ValueError:
            timeout = NOTE_LOCK_TIMEOUT
        if DEADLINE_AT is not None:
            timeout = max(0.0, min(timeout, DEADLINE_AT - time.monotonic() - 1))
        self.lock_path.parent.mkdir(parents=True, exist_ok=True)
        self.fh = open(self.lock_path, "a")
        end = time.monotonic() + timeout
        try:
            while True:
                try:
                    fcntl.flock(self.fh, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    return self
                except BlockingIOError:
                    if time.monotonic() >= end:
                        raise OSError(f"timed out after {timeout:g}s waiting for the note lock {self.lock_path}")
                    time.sleep(0.05)
        except BaseException:
            self.fh.close()
            self.fh = None
            raise

    def __exit__(self, *exc):
        if self.fh is not None:
            self.fh.close()   # closing the file drops the flock
        return False


def _replace_note(target, text):
    """reconcile-rollout.py _replace_keeping_metadata's mirror: a temp file beside the note (on macOS a `cp -p`
    clone, under its bound), written, its mode and created time kept, then renamed over the note."""
    tmp = target.with_name(f".{target.name}.{os.getpid()}.tmp")
    try:
        st = os.stat(target)
        if sys.platform == "darwin":
            _run(["/bin/cp", "-p", str(target), str(tmp)], _bound(GIT_TIMEOUT))   # best-effort
            if tmp.exists():
                os.chmod(tmp, 0o600)
        with open(tmp, "w", encoding="utf-8") as f:
            f.write(text)
            f.flush()
            os.fsync(f.fileno())
        os.chmod(tmp, stat.S_IMODE(st.st_mode))
        birth = getattr(st, "st_birthtime", None)
        if birth is not None:
            os.utime(tmp, (st.st_atime, birth))
            now = time.time()
            os.utime(tmp, (now, now))
        os.replace(tmp, target)
    finally:
        tmp.unlink(missing_ok=True)


def _rewrite(ctx, path, edit):
    """Under the note's lock: re-read it, edit(text, fm) -> the new text (None: no write), then the replace. True
    written, False not (the edit declined), None the frontmatter cannot be read (nothing written). OSError when the
    lock is not taken or the note cannot be read or written."""
    target = Path(os.path.realpath(str(path)))
    with _NoteLock(target):
        try:
            text = target.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            return None
        fm = _fm(text)
        if fm is None:
            return None
        new = edit(text, fm)
        if new is None or new == text:
            return False
        _replace_note(target, new)
    ctx.wrote = True
    return True


def _append_log(text, line):
    """The note with line appended under `## Carrier log`, the section added at the end when missing."""
    lines = text.split("\n")
    if lines and lines[-1] == "":
        lines.pop()
    if FIX_LOG not in lines:
        while lines and not lines[-1].strip():
            lines.pop()
        return "\n".join(lines + ["", FIX_LOG, "", line]) + "\n"
    i = lines.index(FIX_LOG)
    j = i + 1
    while j < len(lines) and not lines[j].startswith("## "):
        j += 1
    k = j
    while k > i + 1 and not lines[k - 1].strip():
        k -= 1
    return "\n".join(lines[:k] + ([line] if k > i + 1 else ["", line]) + lines[k:]) + "\n"


def _last_variant(text):
    """The variant of the Carrier log's last tagged line, or None."""
    lines = text.split("\n")
    if FIX_LOG not in lines:
        return None
    last = None
    for ln in lines[lines.index(FIX_LOG) + 1:]:
        if ln.startswith("## "):
            break
        m = TAGGED.match(ln)
        if m:
            last = m.group(1)
    return last


def _set_status(text, value):
    """The note with its top-level frontmatter `status:` line set to value."""
    lines = text.split("\n")
    for i in range(1, len(lines)):
        if lines[i].rstrip("\r").rstrip() == "---":
            break
        if re.match(r"^status:", lines[i]):
            lines[i] = f"status: {value}"
            break
    return "\n".join(lines)


def _fix_line(variant, pr):
    """The fix task's one-line What to do, per variant (reused on a variant change)."""
    hr, br = pr["head"]["ref"], pr["base"]["ref"]
    if variant == "red" and CLOSE_RE.match(hr):
        return (f"its diff is THREAD.md and handoff docs only and it is up to date with a green `{br}`, so the red is "
                f"the workflow's own or a flake: fix it on `{br}` or re-run it, then mark this task done, which lets "
                "the carrier bring the PR current")
    if variant == "red":
        return f"fix the failing check on `{hr}` and queue it again (`land.sh --queue`), or fix it on `{br}`"
    if variant == "base":
        return f"make `{br}` green; the carrier brings the PR current once it is"
    return ("finish its landing (/fresh-review, the fixes, then `land.sh --queue`; a draft is marked ready first), "
            "or close the PR")


def _unstable(names, br):
    which = ", ".join(f"`{x}`" for x in names) or "its failing check"
    verb = "are not required checks" if len(names) > 1 else "is not a required check"
    return (f"{UNSTABLE_MARK} {which} {verb}, so GitHub would merge it as is; the carrier holds it for green (ADR "
            f"0028 § 2), so making it pass on `{br}`, or retiring it from the workflow, is the fix")


def _log_excerpt(ctx, it, checks):
    """(lines, why): the first failing Actions job's log, the 15 lines ending at its first `##[error]` (else its
    last 15), timestamps and ANSI codes dropped, each line cut to 200 characters and ``` defused; why when the read
    failed. (None, None) when no failing check is an Actions job."""
    for _name, r in (checks or {}).get("runs", {}).items():
        if r.get("status") != "completed" or (r.get("conclusion") or "") in PASS_CONC:
            continue
        m = JOB_URL.search(str(r.get("details_url") or ""))
        if ((r.get("app") or {}).get("slug")) != "github-actions" or not m:
            continue
        try:
            text = gh("api", f"repos/{it.slug}/actions/jobs/{m.group(2)}/logs")
        except GhError as ex:
            return None, f"its log could not be read: {ex}"
        lines = [ANSI.sub("", LOG_TS.sub("", ln.rstrip("\r"))) for ln in text.split("\n")]
        while lines and not lines[-1].strip():
            lines.pop()
        err = next((i for i, ln in enumerate(lines) if ln.lstrip().startswith("##[error]")), None)
        pick = lines[max(0, err - LOG_LINES + 1):err + 1] if err is not None else lines[-LOG_LINES:]
        return [re.sub(r"`{3,}", lambda x: "'" * len(x.group()), ln[:LOG_COLS]) for ln in pick], None
    return None, None


def _project_for(ctx, slug):
    """(project, why): the live project note whose `repos:` holds a checkout with origin slug (the fix task
    paragraph's rule), cached per pass; project is {name, links, tag, launch, entry}, or None with why."""
    k = slug.lower()
    if k in ctx.projects:
        return ctx.projects[k]
    reg = ctx.register()
    root = ctx.vault / "Work" / "Projects"
    found = []
    try:
        paths = sorted(root.rglob("*.md")) if reg is not None else []
    except OSError:
        paths = []
    for p in paths:
        rel = p.relative_to(root).parts
        if "Archive" in rel[:-1]:
            continue
        try:
            fm = _fm(p.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError):
            continue
        if fm is None:
            continue
        tags, st = _tags(fm), _scalar(fm.get("status")).lower()
        if "project" not in tags or "archived" in tags or st in PROJECT_DEAD or _scalar(fm.get("done")).lower() == "true":
            continue
        for entry in _as_list(fm.get("repos")):
            d = os.path.expanduser(str(entry).strip())
            if os.path.isabs(d) and _origin_of(ctx, reg, d) == k:
                found.append((st != "active", len(found), rel, fm, str(entry).strip()))
                break
    if reg is None:
        res = None, f"cannot load {REGISTER.name}"
    elif not found:
        res = None, f"no live project's repos: has origin {slug}"
    else:
        _, _, rel, fm, entry = min(found)
        name = rel[-1][:-3]
        folder = re.sub(r"\s*\(area\)", "", rel[0]).strip() if len(rel) > 1 else None
        area = next((_unlink(str(a)) for a in _as_list(fm.get("area")) if _unlink(str(a))), None) or folder or None
        res = {"name": name, "links": [name] + ([area] if area and area != name else []),
               "tag": re.sub(r"[^a-z0-9]+", "-", area.lower()).strip("-") if area else "",
               "launch": _scalar(fm.get("launch")), "entry": entry}, None
    ctx.projects[k] = res
    return res


def _origin_of(ctx, reg, d):
    """The lowercased owner/name of d's `remote.origin.url` (landing-register.py's ORIGIN_RE and parse_slug), or None;
    cached per pass, each git call under its bound."""
    if d not in ctx.origins:
        rc, out, _, timed_out = _run(["git", "-C", d, "config", "--get", "remote.origin.url"], _bound(GIT_TIMEOUT))
        slug = None
        if rc == 0 and not timed_out:
            m = reg.ORIGIN_RE.fullmatch(out.strip())
            rest = m.group(1) if m else ""
            rest = rest[:-1] if rest.endswith("/") else rest
            s = reg.parse_slug(rest) if rest else None
            slug = f"{s[0]}/{s[1]}".lower() if s else None
        ctx.origins[d] = slug
    return ctx.origins[d]


def _stem_walk(ctx, it):
    """(what, stem): the stem walk (the fix task paragraph's): `adopt` an open root note for this PR, `file` at the
    first free name, or `unreadable` at a root note _fm cannot read."""
    owner, _, name = it.slug.partition("/")
    base = "landing-fix-" + re.sub(r"[^a-z0-9]+", "-", f"{owner}-{name}-{it.n}".lower()).strip("-")
    for k in range(1, STEM_TRIES + 1):
        stem = base if k == 1 else f"{base}-{k}"
        p = _fix_note(ctx, stem)
        if os.path.lexists(p):
            op, fm = _fix_open(p)
            if op is None:
                return "unreadable", stem
            if op and fm is not None and _scalar(fm.get("landing_pr")).lower() == it.key.lower():
                return "adopt", stem
        elif f"{stem}.md" not in ctx.archived():
            return "file", stem
    return "unreadable", base


def _fix_text(ctx, it, pr, e, stem, variant, reason, proj, checks, log, lwhy):
    """The new fix task: reconcile-rollout.py _new_task_fm's frontmatter (mirrored, the carrier being stdlib-only
    and bundled), then its Notes, Failing checks, Launch, Resume prompt and Carrier log."""
    hr, br, head = pr["head"]["ref"], pr["base"]["ref"], pr["head"]["sha"]
    url = pr.get("html_url") or it.url
    what = _fix_line(variant, pr)
    names = _failing(checks) if checks else []
    fm = ["---", f"tags: [task, {proj['tag']}]" if proj["tag"] else "tags: [task]", "status: open", "priority: normal",
          "work_depth: shallow", "projects: [" + ", ".join(f'"[[{x}]]"' for x in proj["links"]) + "]", "contexts: []",
          "scheduled:", "due:", f"captured: {ctx.now.astimezone().date().isoformat()}"]
    if proj["launch"]:
        fm.append(f"launch: {proj['launch']}")
    fm += [f'landing_pr: "{it.key}"', "---"]
    notes = ["Filed by the landing carrier (ADR 0078 d2 as amended by p47-20; ADR 0077: undated, no approval).",
             f"PR: {url} (`{hr}` → `{br}`, {'a close-out' if CLOSE_RE.match(hr) else 'an own branch'}).",
             f"Cause: {reason}."]
    if variant == "red" and pr.get("mergeable_state") == "unstable":
        notes.append(_unstable(names, br) + ".")
    notes += [f"**What to do:** {what}.", f"**Verify:** the carrier merges `{it.key}`."]
    body = ["", "## Notes", "", *notes]
    if variant in ("red", "base"):
        body += ["", "## Failing checks", ""]
        runs, sts = checks.get("runs", {}), checks.get("statuses", {})
        for x in names[:FAILING_SHOWN]:
            r = runs.get(x) or {}
            link = r.get("details_url") or r.get("html_url") or (sts.get(x) or {}).get("target_url") or "no link"
            body.append(f"- `{x}`: {link}")
        if not names:
            body.append(f"- none reads failing yet (its checks read {checks.get('cls')})")
        if log:
            body += ["", "```text", *log, "```"]
        elif lwhy:
            body += ["", f"({lwhy})"]
    launch = f"`{proj['launch']}`" if proj["launch"] else f"`claude` from `{proj['entry']}`"
    body += ["", "## Launch", "", f"- **Launch:** {launch}", f"- **Repo:** `{proj['entry']}`", "- **MCP:** none",
             "", "## Resume prompt", "", "```",
             f'You\'re picking up "{stem}" ({proj["name"]}): the landing {it.key} the carrier cannot move ({variant}).',
             f"Launch: `{proj['launch']}`, in {proj['entry']}" if proj["launch"] else f"Launch: `claude` from {proj['entry']}",
             f"Read first: {os.path.abspath(_fix_note(ctx, stem))}, {url}",
             f"Next move: {what}.", "```",
             "", FIX_LOG, "", f"- {ctx.stamp} {head[:12]} ({variant}): filed: {reason}"]
    return "\n".join(fm + body) + "\n"


def _fix_record(e, stem, key):
    old = e.get("fix") if isinstance(e.get("fix"), dict) else {}
    e["fix"] = {"task": stem, "key": key, "open": True, "marker": None if old.get("task") != stem else old.get("marker"),
                "current": bool(old.get("current")) if old.get("task") == stem else False, "at": None}
    return e["fix"]


def _note_fix(ctx, it, pr, e, stem, variant, key, reason, checks):
    """A new key on a live task: one tagged Carrier log line, with the new What to do when the variant changes and the
    unstable clause once per note."""
    head = pr["head"]["sha"]
    if ctx.dry:
        ctx.say(f"{it.key}: would note [[{stem}]]")
        return "dry", f"would note its fix task [[{stem}]]"
    unstable = variant == "red" and pr.get("mergeable_state") == "unstable"

    def edit(text, _fm_):
        line = f"- {ctx.stamp} {head[:12]} ({variant}): {_flat(reason)}"
        if _last_variant(text) != variant:
            line += f"; what to do now: {_fix_line(variant, pr)}"
        if unstable and UNSTABLE_MARK not in text:
            line += f"; {_unstable(_failing(checks or {}), pr['base']['ref'])}"
        return _append_log(text, line)
    try:
        done = _rewrite(ctx, _fix_note(ctx, stem), edit)
    except OSError as ex:
        return "none", f"no fix task (cannot write {stem}: {_flat(ex)[:160]})"
    if done is None:
        if isinstance(e.get("fix"), dict) and e["fix"].get("task") == stem:
            e["fix"]["open"] = None
        return "none", f"no fix task ([[{stem}]]'s frontmatter cannot be read)"
    fx = _fix_record(e, stem, key)
    fx["at"] = ctx.stamp
    ctx.fx["key"] = key
    ctx.say(f"{it.key}: fix task noted: [[{stem}]]")
    ctx.keep(it, e)
    return "noted", f"its fix task [[{stem}]] is noted"


def _new_fix(ctx, it, pr, e, stem, variant, key, reason, checks):
    """A new fix task at stem: an `x` create, so an existing name moves on to the next."""
    proj, why = _project_for(ctx, it.slug)
    if proj is None:
        return "none", f"no fix task ({why})"
    if ctx.dry:
        ctx.say(f"{it.key}: would file fix task [[{stem}]]")
        return "dry", f"would file fix task [[{stem}]]"
    log, lwhy = _log_excerpt(ctx, it, checks) if variant in ("red", "base") else (None, None)
    for _ in range(STEM_TRIES):
        try:
            with open(_fix_note(ctx, stem), "x", encoding="utf-8") as f:
                f.write(_fix_text(ctx, it, pr, e, stem, variant, _flat(reason), proj, checks, log, lwhy))
            break
        except FileExistsError:
            what, stem = _stem_walk(ctx, it)
            if what == "adopt":
                return _note_fix(ctx, it, pr, e, stem, variant, key, reason, checks)
            if what == "unreadable":
                return "none", f"no fix task ([[{stem}]]'s frontmatter cannot be read)"
        except OSError as ex:
            return "none", f"no fix task (cannot write {stem}: {_flat(ex)[:160]})"
    else:
        return "none", f"no fix task (no free name for {stem})"
    ctx.wrote = True
    fx = _fix_record(e, stem, key)
    fx["at"] = ctx.stamp
    ctx.fx["key"] = key
    ctx.say(f"{it.key}: fix task filed: [[{stem}]]")
    ctx.keep(it, e)
    return "filed", f"its fix task [[{stem}]] is filed"


def _file_fix(ctx, it, pr, e, variant, key, reason, checks):
    """The fix task for a red, base or review key (the fix task paragraph's rules): (state, text). state is `filed`,
    `noted`, `same` (a live task with this key), `dry`, `none` (text says why: nothing written) or `closed` (its
    closed task has this key: text is its stem, for (d))."""
    if not ctx.vault_ok():
        return "none", f"no fix task (no vault at {ctx.vault})"
    fx = e.get("fix") if isinstance(e.get("fix"), dict) else None
    stem = fx.get("task") if fx else None
    if stem:
        if fx.get("open") is None:
            return "none", f"no fix task ([[{stem}]]'s frontmatter cannot be read)"
        if fx.get("open"):
            if fx.get("key") == key:
                ctx.fx["key"] = key
                return "same", f"its fix task [[{stem}]] covers it"
            return _note_fix(ctx, it, pr, e, stem, variant, key, reason, checks)
        if fx.get("key") == key:
            return "closed", stem
    what, stem = _stem_walk(ctx, it)
    if what == "unreadable":
        return "none", f"no fix task ([[{stem}]]'s frontmatter cannot be read)"
    if what == "adopt":
        return _note_fix(ctx, it, pr, e, stem, variant, key, reason, checks)
    return _new_fix(ctx, it, pr, e, stem, variant, key, reason, checks)


def _review_fix(ctx, it, pr, e, why, review):
    """Step 6.0's review fix task, for an own PR left unqueued a day: review True (own_kind's), or for a draft (None)
    a newest-marker read made now, once the vault and project are found, that succeeds and is no hold."""
    if review is None:
        if not ctx.vault_ok():
            return f"{why}; no fix task (no vault at {ctx.vault})"
        fx = e.get("fix") if isinstance(e.get("fix"), dict) else {}
        if not fx.get("open"):
            proj, pwhy = _project_for(ctx, it.slug)
            if proj is None:
                return f"{why}; no fix task ({pwhy})"
        try:
            m = newest_marker(api_json(f"repos/{it.slug}/issues/{it.n}/comments?per_page=100", paginate=True), ctx.me)
        except GhError as ex:
            return f"{why}; no fix task (cannot read its comments: {ex})"
        if m is not None and m[2] == "held":
            ctx.fx["clear"] = HELD_WHY
            return f"{why}; {HELD_WHY}"
    elif not review:
        return why
    state, text = _file_fix(ctx, it, pr, e, "review", f"review:{pr['head']['sha']}", f"unqueued a day on ({why})", None)
    return f"{why}; {_closed_text(text)}" if state == "closed" else f"{why}; {text}"


def _note_line(ctx, it, e, stem, line):
    """One untagged Carrier log line on the open fix task, best-effort (a refused write is no line)."""
    if ctx.dry:
        ctx.say(f"{it.key}: would note [[{stem}]]")
        return
    try:
        if _rewrite(ctx, _fix_note(ctx, stem), lambda text, _fm_: _append_log(text, line)):
            ctx.keep(it, e)
    except OSError:
        pass


def _settle_fix(ctx, it, e, outcome):
    """fix.current, settled once per pass: True when this pass computed a fix key; else False when a clearing verdict
    happened (one line on the open task when it was True); else kept."""
    fx = e.get("fix")
    if not isinstance(fx, dict):
        return
    if ctx.fx["key"]:
        fx["current"] = True
    elif ctx.fx["clear"]:
        was, fx["current"] = fx.get("current"), False
        if was and fx.get("open") is True and fx.get("task") and ctx.vault_ok():
            _note_line(ctx, it, e, fx["task"], f"- {ctx.stamp} {str(e.get('head') or '')[:12]}: this task no longer "
                                               f"covers the landing: {_flat(outcome)}")


def _drop(ctx, it, e, why, head):
    """A dropped entry's open fix task gets one closing line under its lock; one still `status: open` with no valued
    `rollout:` is retired (`status: dropped`) in the same replace (_retire). A closed, gone or unreadable note: no
    write."""
    fx = e.get("fix") if isinstance(e, dict) else None
    if not isinstance(fx, dict) or not fx.get("task") or not ctx.vault_ok():
        return
    stem, h12 = fx["task"], str(head or e.get("head") or "")[:12]
    if ctx.dry:
        op, fm = _fix_open(_fix_note(ctx, stem))
        if op:
            ctx.say(f"{it.key}: would {'drop' if _retire(fm) else 'note'} [[{stem}]]")
        return

    def edit(text, fm):
        if not _open_of(fm):
            return None
        tail = "dropped: nothing is left for it to fix" if _retire(fm) else (
            f"left open (it is stamped rollout: {_scalar(fm.get('rollout')) or 'a rollout'})" if _valued(fm.get("rollout"))
            else f"left open (its status is {_scalar(fm.get('status')).lower() or 'empty'})")
        new = _append_log(text, f"- {ctx.stamp} {h12}: {why}; {tail}")
        return _set_status(new, "dropped") if _retire(fm) else new
    try:
        _rewrite(ctx, _fix_note(ctx, stem), edit)
    except OSError:
        pass


def _retire(fm):
    """An unworked fix task: `status: open` exactly and no valued `rollout:`."""
    return _scalar(fm.get("status")).lower() == "open" and not _valued(fm.get("rollout"))


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
        if k == PASS or _covered(e):   # an open fix task still covers its stop: ordinary backlog work
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
    if args.slug is not None:
        want = args.slug.casefold()
        due = [d for d in due if d[1] == "search" or d[1].rpartition("#")[0].casefold() == want]
    due.sort(key=lambda x: (x[0], x[1]))
    rows = [{"key": k, "url": e.get("url"), "kind": e.get("kind"), "movedAt": e.get("movedAt") or e.get("since"),
             "outcome": _row_outcome(e)} for _, k, e in due]
    line = ("Landings: " + " · ".join(f"{r['key']}: {r['outcome']} (unmoved since {str(r['movedAt'] or '')[:16]})"
                                      for r in rows)) if rows else None
    print(json.dumps({"state": str(path), "stuck": rows, "line": line}, ensure_ascii=False))
    return 0


def _row_outcome(e):
    """A stuck row's outcome: a fix task taken out (ADR 0070's marker) is named before it."""
    out = _flat(e.get("outcome") or "")
    fx = e.get("fix")
    if isinstance(fx, dict) and fx.get("task") and fx.get("marker"):
        out = f"its fix task [[{fx['task']}]] was taken out (taken_out_next: {fx['marker']}): {out}"
    return out


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


def _slug(value):
    if not SLUG_RE.fullmatch(value) or not value.partition("/")[2].strip("."):
        raise argparse.ArgumentTypeError(f"not an <owner>/<name> GitHub slug: {value!r}")
    return value


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
    r.add_argument("--vault", default=VAULT_DEFAULT, help="the Obsidian vault a fix task is filed in (default "
                                                          f"{VAULT_DEFAULT})")
    r.set_defaults(func=cmd_run)
    s = sub.add_parser("stuck", allow_abbrev=False, help="the landings stuck a day (a read that writes nothing)")
    s.add_argument("--state", default=None)
    s.add_argument("--now", default=None)
    s.add_argument("--slug", type=_slug, default=None, help="only this repo's rows (and the search spell)")
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
