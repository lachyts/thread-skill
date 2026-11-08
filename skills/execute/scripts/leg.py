#!/usr/bin/env python3
"""leg.py — a serial rollout's Leg bookkeeping (ADR 0040; skills/execute/legs.md is its one caller's protocol).

    python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/leg.py <verb> --rollout <note> [common flags] [verb flags]

A serial rollout (`shape: serial`) runs as a chain of Legs: visible sessions that each work tasks themselves, close
and hand the rest to a fresh successor. This helper does every vault and git write a Leg makes but a task's own work
commits, a land conflict's hand resolution (legs.md § The task loop's Land: the merge of the primary's default branch
into `chain/<rollout>` in the copy, and its commit) and legs.md § Complete's own commands (its phase close,
`reconcile-project.py --apply`, and its completion verify, `reconcile-rollout.py completion-verify --run`, ADR 0055), so
a Leg never hand-edits frontmatter. Stdlib only,
python >= 3.9, POSIX (fcntl). It loads reconcile-rollout.py as a module (Note, _scan, _queue_state, _dep_status,
incomplete, _stamp, PHASED_STEM_RE, _norm_gate, _fm_block; _leg_tops, the one parser of `leg_base:` and `leg_head:`;
the completion verify's _completion_config, _completion_state, _completion_summary, _find_note,
COMPLETION_DECIDED, COMPLETION_RED_PREFIX and CompletionValueError; and the Security check's _security_check,
SECURITY_CHECKS_KEY and SECURITY_CHECK_PY), as serial-chains.py and unfinished-rollout.py
do, and serial-chains.py for norm_origin, the surface grammar and required_mcp. begin and status run unfinished-rollout.py's
read-only `check --shape serial --resume` (the surface re-check, ADR 0060), and unfinished-rollout.py loads this file
in turn for hold_of, order_key and first_by (no recursion: none of them spawns). estate-dispatch.py's rank-stamp loads it
for order_key and parse_log.

Common flags: --rollout <path, or a slug under --tasks-dir; once that note is gone, its `Archive/Rollouts/` copy
(read as archived by that path too), which every writing verb but file-followup refuses (exit 1)> · --tasks-dir
(default <vault>/Work/Tasks) · --vault (default the tasks dir's grandparent when --tasks-dir is given, else
~/repos/obsidian) · --now <ISO> (stamps; the clock otherwise) · --session <id> (default CLAUDE_CODE_SESSION_ID, then
CODEX_THREAD_ID, else `unknown`) · --harness claude|codex (default: codex under CODEX_THREAD_ID alone, else claude) ·
--dry-run (compute and print, write nothing, take no lock).

Output: one JSON line on stdout for every exit but a usage error and the Engine snapshot guard. Exit codes: 0 ok · 1
refusal (nothing written) · 2 usage (stdout empty, one `leg:` line on stderr), or the Engine snapshot guard (ADR 0043:
every verb but status first asks engine-snapshot.py's guard(), loaded from this tree; a note stamped with another
usable snapshot than this plugin root, or a live note whose snapshot is unusable, prints its `engine-snapshot: ` line,
stdout empty, nothing written: re-run from the root it names; an archived note whose snapshot is gone passes, so
file-followup after Complete still runs) · 3 a stand (an unclosed Leg of another session, a standing halt,
a surface another rollout holds (begin's surface re-check, ADR 0060), a revert that would conflict or a dirty path to
revert, a claim the Capacity holds (ADR 0067 d8: *The Capacity*, below); nothing written) · 4 wrong launch (nothing written to the Leg log: in a chain with `chain_copies:` begin may
first remake a missing copy and stamp a newly needed pair) · 5 the
rollout's lock was held past its timeout (nothing written). A refusal's JSON carries `exit`, `error` and, from
begin, the `status_line` its turn ends on. Every git call runs with git's repo-local env vars removed (`git rev-parse
--local-env-vars`), so an exported GIT_DIR never redirects it.

The Queue. Each `## Queue` table row is `| <n> | [[<slug>\\|<alias>]] | `<launch alias>` from `<folder>` |
<surfaces> |` (schedule § S5). A row whose task note exists but no longer names this rollout in `rollout:` was
deferred out of the chain: skipped and not counted. A row whose note is missing is held `note not found`. K is the
done rows, fix rows included; N every counted row.

Chain copies (ADR 0067 d2; CONTEXT.md **Chain copy**). A note that carries `chain_copies:` (serial-chains.py's
read_chain_copies: `["<checkout> -> <copy>", …]`) works each git checkout it writes in its own Chain copy: a git worktree
of that primary checkout on `chain/<rollout slug>` at `<copy dir>/<repo name>-<rollout slug>` (`-<k>-` before the slug
for a second checkout of one name), where `<copy dir>` is $THREAD_CHAIN_COPY_DIR, else
${XDG_STATE_HOME:-~/.local/state}/thread/chains, never at or under ~/repos or ~/Projects (exit 1). Queue folders, the Leg
log's folders and every token stay primary paths; each Leg-facing folder (begin's launch check, the hand-over, the
restart, the manual lines) maps into the copy (serial-chains.py's copy_folder), and a Leg's launch line there is
`cd <copy folder> && <the generated alias's command after its own cd>` (the alias's `cd` opens the primary; its whole
command when it has no `cd`; read from $THREAD_LAUNCH_ALIASES, else
~/repos/workspaces/_shared/generated/launch-aliases.zsh), else prose that says never to run the alias itself. A note with
no `chain_copies:` key works every checkout in place, exactly as before; a malformed key is exit 1 (`chain_copies: <why>:
fix the note`) for begin, claim and copies.

Verbs (writing verbs: begin, claim, wait, smoke, file-fix, done, security, set-aside, file-followup, close, handed,
clear-halt, restarted, copies, land):
  begin [--cwd <dir>] [--take-over | --resume <N>]
      Refuses (exit 1): a note not found, a non-serial note, an incomplete note (`incomplete: true`, or
      reconcile-rollout.py's incomplete), a dropped or superseded note, a done note, a `paused:` or
      `pause_requested:` stamp (`a serial note is never paused: delete its paused: (and pause_requested:) line, then
      /thread:execute [[<slug>]]`), and a cwd whose checkout's origin is this plugin's own repo (plugin.json's
      repository, norm_origin). A standing halt (the last `closed: halted:` line has no `halt cleared:` line after
      it) is exit 3. The Security check's preflight (execute § 3 `security_checks`; rr._security_check, at most 30 s)
      runs read-only before the lock; right after the halt check, every begin (fresh, take-over, --resume, a silent
      resume and --dry-run) refuses exit 1, status line `halted reason="security_checks refused on [[<slug>]]"`, on a key
      the lock's re-read finds changed (`security_checks changed while begin ran: run begin again`) or one it refused
      (`security_checks: <why>: fix or remove the key, or install gitleaks, then /thread:execute [[<slug>]] again`: a
      value neither true nor false, no security-check.py, a failed preflight); with the key true, begin prints
      `securityCheck` {script}, else no key. An unclosed Leg K: this session's own (its latest began or resumed session
      id, never `unknown`) resumes silently and writes nothing but the Leg lease (*The Capacity*); `--resume K` logs `resumed` (another K is exit 1); `--take-over` closes K
      `lost` and begins K+1 that inherits K's claim; anything else is exit 3 naming K, `--resume K` and `--take-over`.
      Otherwise Leg N (the last + 1) begins, after the surface re-check and the launch check. The surface re-check (ADR
      0060 d3), on a fresh Leg or a take-over only (never a silent resume or --resume, and --dry-run included): the
      Leg's write set (write_set: the Surfaces cells of its unlanded rows and of its smoke list's rows) goes to one
      read-only `unfinished-rollout.py check --shape serial --resume <slug> --surface <token>…` (sys.executable, 60 s,
      stdin closed), which compares it with the other unfinished serial notes' unlanded rows and the held Project roots
      of the unfinished parallel rollouts. A hit is exit 3 with `held: [{rollout, token}]` and the status line
      `halted reason="surface held: [[<B>]] holds <token>"`: the chain waits its turn; a check that fails is exit 3,
      `surface re-check failed: <its line>` (fail closed). An empty write set skips it. The launch check: the cwd's
      realpath, case-folded, must be the
      folder of the first row the Leg must work (an inherited claim, else the first fix task, else the first
      claimable row), read from next's contention-aware plan (*The rank*: a `wait` uses its row, so a first row
      another chain holds, in another launch, is skipped for the row the Leg claims), and a `cx-*` alias needs codex
      (any other, claude); a mismatch is exit 4 with the row's launch line and the Leg prompt, nothing written to the
      Leg log. A resume skips the check. In a chain with
      `chain_copies:`, after the re-check and before the launch check, begin runs `copies` (below) under its lock, so a
      deleted copy is remade on its branch and a newly needed checkout gets its pair; the launch check then compares the
      cwd with the row's folder inside its copy, exit 4 naming that folder and the copy's launch line; a row-less Leg
      (complete or stuck) logs the primary folder of its cwd (primary_folder), so the Leg log names Queue folders only;
      and on a fresh Leg or a take-over each copy is fast-forwarded (`merge --ff-only`) to its primary's default branch
      when that branch resolves, the chain branch is a strict ancestor of it, the copy is clean and no row is in
      progress, whatever the primary has checked out (the merge reads only refs/heads/<d>; a skip but an
      already-current copy, or a failed merge, is a WARN; never the primary). A copy skipped because its chain branch
      has commits <d> lacks (a land that stood at the last close) WARNs `… has commits <d> lacks (run leg.py land before
      the first claim: it merges <d> in)` and sets `landFirst`, false in place, on a resume, on --dry-run and while a
      row is in progress (legs.md § Begin 0). Prints `copies` ({checkout, copy, branch, made, fastForwarded}, [] in
      place), `cwd` (the Leg's launch folder inside its copy, else that folder), `landFirst` and `warns`. Prints the
      Leg, its inherited tasks, its
      smoke list (every done task stamped `leg: K`, K < N, with no `smoke:` line from a Leg after K: the previous
      Leg's, and an earlier Leg's that a lost, stopped or halted Leg never smoke-tested; every done task a not-done
      fix names in `verifies:`; every task whose latest smoke result is `fail` with no fix filed for it since; each
      with its `**Verify:**` line or null), the not-done fix tasks, the required MCP namespaces of this launch's
      unlanded rows (their `## Launch` `**MCP:**` items, as serial-chains.py's `required_mcp` reads them), `next` and
      `progress`.
  next [--waiting <reason>]                  (no lock; writes only this Leg's lease, ADR 0067 d8, never under --dry-run)
      The Leg's next act: `finish` (a task this Leg owns, or an inherited claim of a closed Leg: `inherit: true`),
      else `handoff` at five fresh claims (distinct tasks with a `claimed` line in this Leg, so a task re-claimed
      after a gate or a hand-back counts once; an inherited `took` never counts), else `claim` of the
      first claimable fix task (`verifies:`), else of the first claimable row in Queue order (status open, or
      in_progress with no owner: a hand-back's or a sign-off's re-entry), else `complete` (every counted row done),
      else `stuck`. A claimable row in another launch than the Leg's is a Leg boundary: `handoff`. A row whose
      dependency (depends-on/blocked-by) is not done is held `depends on [[d]] (<why>)`, and one whose done
      dependency has a not-done fix is held `depends on [[d]] (awaiting fix [[f]])`. In a chain with `chain_copies:`
      the rank reads too (*The rank*, below): a row another chain in Chain copies holds or reserves on a code file is
      set aside (a die, held `rank: …`) or waited on (the pick, marked); after the cap and the Leg boundary, a marked
      pick is `wait` of kind wait, (H) `wait` of kind land; with no pick and a die-held row, `wait` of kind retry
      (`stalled: true` on a holder with no open Leg), ahead of `stuck`. `wait` is {task (the row it claims once the wait
      clears: the pick for kinds wait and land, the held row for retry), kind, on, token, why, landFirst, stalled,
      lands (kind land: its own rows waiting to land)}; stalled is also true past RANK_WAIT_MAX_MINUTES (180) since the
      task's earliest standing line. While Capacity is in force (*The Capacity*), a `claim` (a fix task's included) the
      Mac has no room for is `wait` of kind `capacity` (why its `trickle: …`, `away cap: …` or `heat: …` hold line),
      or of kind `quota` (why `quota: <login> is inside its line`), with on and token null, landFirst and lands [],
      stalled false and `capacity` (rr.capacity_gate's block); a stale or unreadable reading's WARN line goes to
      stderr. --waiting adds the turn's `status_line`, `state=waiting reason="<reason>"` (a review in flight, a room
      stop, a completion verify in flight, a Capacity wait: legs.md § Complete and § Report), and writes the Leg lease
      with `waiting: true`. It renews the lease only when this session is the open Leg's own (both ids known and
      equal), so an `unknown` caller never renews a dead Leg.
  claim --task <t> [--inherit] [--gate <gate>]...
      Re-runs next under the lock and then the rank lock (*The rank*), its contention read again: <t> must be what it
      proposes (with --inherit, an inherited `finish`), so a holder planted since next makes the claim refuse. Stamps
      `status: in_progress`, `owner: leg-N`, `leg: N`, `started:` (the first wins), consumes `handed_back:` and
      `gates_signed:`, and on a fresh claim `leg_base: ["<toplevel>@<sha40>", …]`: one entry per checkout the row
      works (stamp_bases: the checkout of each `repo:` surface of the row, `repo:<toplevel>//<path>` or bare, that is
      a git toplevel, then its launch folder's toplevel, where its commits land), the vault never, so a file token
      never leaves a code row unstamped (an inherited claim keeps its stamp). A fresh claim also removes `leg_scan:`
      and the `## Security check` section (an inherited claim keeps both, as it keeps leg_base). In a chain with
      `chain_copies:` each entry is the checkout's copy at its HEAD, and `leg_primary_base: ["<checkout>@<sha40>", …]` (the primaries' HEADs)
      follows it, printed too; a checkout with no pair is exit 1 naming `leg.py copies`, and a pair whose copy is
      missing exit 1 naming begin. A fresh claim there also refuses (exit 1, `unlandedDeps` [{task, dep, rollout, sha,
      copy, why}]) a row with a dependency another rollout's chain finished whose `leg_head` commit in this repository
      the copy's HEAD lacks (unlanded_deps: `done on chain/<X>, not yet on <d>: it lands at [[<X>]]'s next done or
      close`, or `on <d>, not yet in <C>: run leg.py land, which brings <d> in`; legs.md § The task loop). Its error
      names one gap, a set-aside one first, and ends by its cause: `run leg.py land, then claim again` on `on <d>`, else
      `set it aside` with its `leg.py set-aside` line, `until that work is in <C>`. Logs `claimed` or `took`.
      Each --gate is compared with the note's `## Approved gates` (reconcile-rollout.py's _norm_gate): the
      unapproved ones are printed for `set-aside --kind gate`. An exact `None` (execute § 3.7's grammar, bullet,
      case and one trailing `.` aside, as the engine's parseGatedInputs reads it) is no gate, never unapproved.
      The Capacity (ADR 0067 d8) is read last, after every refusal above: a fresh claim while it is in force stands
      exit 3 on the quota hold (the heat aside) with `capacity`, `quota` and `status_line` `state=waiting
      reason="quota: …"`, no lock taken and nothing written; else it takes the trickle claim lock inside the rank
      lock (not taken within THREAD_NOTE_LOCK_TIMEOUT: exit 5, nothing written), recounts (rr.capacity_gate), and
      with no room writes the chain's waiting record and stands exit 3 (`capacity`, `status_line` `state=waiting
      reason="<why>"`), no note written; with room it writes the Leg lease, saves the task note, then the claims
      write (its own record and wake dropped, a wake for each rollout it keeps places for). An inherited claim, and
      every claim under the fallback, takes no trickle lock: the lease, then the save, as before.
  wait --task <t> [--for <s>=540]
      The Leg's rank wait on row t (ADR 0067 d9; legs.md § The task loop's `wait`). Exit 1 for a t not in the Queue, or
      no Leg of this session. When next is no `wait` on t, `cleared: true` and nothing logged. Else, unless the hold is
      stalled at this first check (nothing logged), under the rollout's lock and then the rank lock, kind wait or
      retry logs `Leg <N> rank wait: [[t]] on [[X]] (<token>; ranks above it)` or `Leg <N> rank retry: [[t]] on [[X]]
      (<token>; [[X]] ranks above)` whenever t has no standing line yet or its latest standing line is of the other
      kind, so t's latest line always records the kind it waits as (kind land logs nothing). A kind that differs from
      that latest line prints `flipped: true` and the call polls on (the Leg's `next` already read the new kind). It
      polls read-only every RANK_POLL_SECONDS (15), recomputing the contention and the plan, and stops when it clears,
      when the kind flips during the poll (`flipped`), when the hold is stalled, or when --for runs out; --for 0 is one
      check, --dry-run logs nothing. Kinds `capacity` and `quota` (ADR 0067 d8, *The Capacity*) log no rank line: at
      its start (the lease written, off --dry-run) kind capacity records the chain waiting (want 1) under the trickle
      claim lock alone (a lock not taken within 30 s adds one `warns` entry and the poll reads on), kind quota drops
      its earlier record; it polls read-only every RANK_POLL_SECONDS, re-recording and renewing the lease every
      CAPACITY_WAIT_REFRESH (600 s), and ends cleared (room), flipped (another kind) or at --for, never stalled.
      Every wait writes the Leg lease at its start. Prints {verb, task, kind, cleared, flipped, stalled, why, on,
      token, landFirst, waitedMinutes, lifts, logged, capacity, warns, next}; waitedMinutes is t's standing line's age,
      or the call's own minutes from its start to its return when longer (p41-7: a Capacity wait has no standing line).
  change --task <t> [--top <toplevel>]       (read-only, no lock)
      Per `leg_base` checkout: the commits in `<sha>..HEAD` whose message has a `Task: [[<t>]]` line, their paths
      minus `docs/reviews/`, the `:(literal)` pathspecs, and a WARN per commit on the range's first-parent line with no
      `Task:` line at all, unless it touches only `docs/reviews/` (what a land merge brought in is never this
      checkout's own). `codeWriting` is any such commit. `stray` is one WARN per commit of
      the task's that went into a Chain copy's primary instead (stray_of: per `leg_primary_base` entry, the trailered
      commits in `<primary base>..HEAD --not refs/heads/chain/<rollout>`, so a hand merge of the chain is never stray).
  smoke --task <t> --result pass|fail|not-run [--why <text>]
      Logs `smoke: [[t]] pass|fail|not run[: <why>]` for a chain task (one on begin's smoke list).
  file-fix --target <t> --cause own|chain|outside|drift [--culprit <L>] --evidence <line> [--excerpt <text>]
      A done chain task t whose Verify failed gets a fix task: `verifies: "[[t]]"` always; `fixes:` names the
      culprit only for own (`[[t]]`) and chain (`[[L]]`). The cause is checked against git, else exit 1: chain needs
      L a done chain row other than t with a `Task: [[L]]` commit in t's checkout that touches one of t's paths and
      came after t's last trailered commit there (in `<last>..HEAD`, so L is a later chain task); outside
      needs a commit after t's last trailered commit there that touches t's paths and carries no chain task's
      trailer, or a `🔀 land: merge ` commit on `<last>..HEAD`'s first-parent line (a land brought another chain's work
      in, ADR 0067 d3); drift needs t's paths unchanged since t's last trailered commit (working tree included). A task
      with no paths (vault-only) passes own or drift only. The note `<project>-followup-fix-<t's descriptive
      tail>[-<k>]` copies t's `projects:` and `**Verify:**` line, takes this Leg's launch alias and `rollout:`; its
      Queue row (this Leg's launch, t's surfaces) goes ahead of the first queued row and every `#` cell is
      renumbered. Idempotent per `verifies:` target while a not-done fix exists, and a fix note left with no row
      (a crash between the two writes) gets its row and no second note.
  done --task <t> [--verify pass|none] [--review <abs doc>]... [--cwd <dir>]
      Refuses (exit 1) unless t is this Leg's in_progress claim; `--verify pass` when the note has a `**Verify:**`
      line; a stray commit (change's) in a Chain copy's primary (`committed in the primary <P>, not its chain copy <C>:
      set it aside with --revert, which reverts it there, and redo it in <C>`); and, for each `leg_base` checkout with
      trailered commits, that checkout is the cwd's (in a copy chain the copy holding the cwd) and a --review doc
      whose front matter has `repo:` that toplevel, `mode: code`, `effort:` xhigh or max, `status: consumed`, and a
      `head:` that descends from the leg_base sha, is an ancestor of HEAD and holds a trailered commit. The rollout
      note's `security_checks:` is read through security_on: a value neither true nor false (nor absent or empty) is
      exit 1, `security_checks: must be true or false, got '<v>': fix the note`, nothing written, whatever scan the note
      records. With it true, each security_tops entry (below) needs `security`'s latest `leg_scan` record to be `clean`
      and still cover it (covering), else exit 1, nothing written: `[[t]]: the Security check (security_checks) has no
      clean scan covering <top> (a Chain copy's must be at its HEAD; latest: <verdict> at <sha12> | none): run `leg.py
      security --task <t>``; done runs no scan. With the key off, or no tops, it is today's path. Stamps
      `status: done`, `completed:`, `leg: N`, `reviewed:` (the docs), keeps `leg_base`, and, when the task has a
      `leg_base` entry, `leg_head: ["<toplevel>@<sha40>", …]` after it (ADR 0055): per checkout, the task's own newest
      `Task:`-trailered commit (change's last commit there, never HEAD, which may be a peer's), a checkout where it
      committed nothing (or whose range could not be listed) left out, so `[]` when it committed nowhere; no key with
      no `leg_base` entry. A serial chain's completion verify anchors its HEAD guard on it. In a chain with
      `chain_copies:` it then stamps `leg_claims: ["repo:<primary>//<path>", …]` after it (ADR 0067 d4's actual claims:
      change's paths on the primary's paths, bookkeeping aside, a quoted inline list read_list reads back; a path
      holding `"` or ` #` claims `repo:<primary>`), which land checks and hold_of reads; never in place. Logs `done`.
  set-aside --task <t> (--reason <text> | --scan-ask) [--kind block|gate] [--status blocked|review-blocked|plan-blocked]
            [--revert] [--gate <gate>]...
      --reason and --scan-ask are one required, exclusive choice; --scan-ask without --revert, or with --kind gate, is
      usage (exit 2). The Security check gate (security_gate) runs after the owner checks, before any write, and only
      for this Leg's own claim (in progress, owned leg-<n>), never a gate set-aside. There a `security_checks:` neither
      true nor false is exit 1 (security_on: `security_checks: must be true or false, got '<v>': fix the note`); with it
      true and a non-empty security_tops, a task with `Task:` commits (change_of) or strays and no --revert is exit 1
      (`set it aside with --revert, after `leg.py security --task <t>``), and each top needs a covering record (none:
      `run `leg.py security --task <t>` first`; `unscanned`: `close the Leg --outcome halt instead`, the claim stays;
      `secret` in a Chain copy: `rewrite it out first`, since a revert keeps it in the history the next land puts on
      <d>). --scan-ask needs a
      covering red or secret record and the section's `Ask:` line, and records `security check: <ask>` as the reason
      (the diagnosis, the `Set-aside:` line and the log line), else exit 1 (`--scan-ask quotes the latest Security
      check question, and none covers HEAD: give --reason`). A queued or handed-back row, and every row with the key
      off, take today's path.
      Removes `owner:`. gate: `status: gate-pending` and `## Gated inputs (awaiting sign-off)` (no revert; a `None`
      --gate is no gate, so one with only `None` is a usage error, exit 2). block:
      the status (blocked by default) and a `## Blocker diagnosis` run. --revert reverts each checkout's trailered
      commits, and each stray one in a Chain copy's primary there: exit 3 first when a path to revert has staged or
      unstaged changes; the commits are reverted
      newest-first in a scratch `git worktree add --detach` tree; a conflict removes it and exits 3 with the checkout
      untouched (no REVERT_HEAD, CHERRY_PICK_HEAD or sequencer state); success applies the scratch diff with `git
      apply --index` over those paths and commits them by pathspec with `Task: [[t]]` and `Set-aside: <reason>`
      lines. Every scratch tree is removed before the verb returns. The diagnosis and the log name `reverted <sha>
      in <top>`.
  security --task <t>                        (scans before its lock; writes only the task note, under the lock)
      The Security check on a serial chain (execute § 3 `security_checks`; legs.md § The task loop's **Security
      check.**): its one scanner, run before the task's review and again before done. Before any scan, read-only:
      t0 is its first line, its deadline t0 + $THREAD_LEG_SECURITY_BUDGET (SECURITY_BUDGET, 420 s); t must be this Leg's
      in_progress claim (`[[t]] is not Leg N's in_progress claim`); the key true (absent, empty or false: `security_checks
      is not true on [[ro]]: nothing to scan`; any other value: `security_checks: must be true or false, got '<v>': fix
      the note`; each exit 1). The tops, security_tops: with `chain_copies:`, each `leg_base` Chain copy with a commit in
      `<base>..HEAD` (primary false: every commit in a copy's window is the chain's own, so untrailered ones count), then
      each primary a task's `Task:` commit strayed into (stray_of; base its `leg_primary_base` sha); in place each
      `leg_base` checkout with the task's own `Task:` commits (primary true). No tops is exit 0, `tops: []`, `clean:
      true`, no scan; off --dry-run the lock step below still runs (the claim and key re-read, no HEAD to check) and
      removes a stale `leg_scan:` and `## Security check`, an earlier run's (say before repair § 7 (c)'s `reset --hard
      <leg_base sha>`). Per top, in order: its HEAD read (HEAD_READ, 5 s); under $THREAD_LEG_SECURITY_FLOOR (SCAN_FLOOR,
      20 s) left is
      `unscanned`, `not scanned: the Security check's <B> s budget ran out`; a copy is scanned in place, a primary in
      scratch_tree (a detached `worktree add` at its HEAD, so his uncommitted edits and untracked files there are never
      touched; dead runs' `leg-security-<pid>-…` trees swept first; its own torn down with `worktree remove --force
      --force`, unlock, rmtree and prune); `security-check.py scan --tree <tree> --base <base> --accepts-from <task
      note>` (run_scan: stdin closed, the rest of the deadline, then SIGINT, SCAN_GRACE 10 s, a kill): rc 0 clean, rc 1
      secret when it names a secret else red, rc 2, a cut or output that does not parse unscanned (`error` its ERROR
      line after `ERROR: security-check: `, or `timed out: the Security check's <B> s budget ran out in <top>`).
      `secrets` {rule, file, line, commit, pushed, pushedWhy}; a primary's null `pushed` is settled in the primary
      itself (settle_pushed: symbolic-ref, then `ls-remote --exit-code origin refs/heads/<branch>` within the deadline,
      `cat-file -e` and `merge-base --is-ancestor`; never a fetch). `uncommitted`: `git status --porcelain=v1 -z
      --untracked-files=all` in the top, at most 50 paths. `rewrite` (a Chain copy's secret only, null on a primary):
      the scan's `rewriteFrom` when no merge sits at or after a secret, base is it or an ancestor, and every commit in
      `rewriteFrom..HEAD` carries `Task: [[t]]` or touches only docs/reviews/; else null with `rewriteWhy` (`origin
      already holds <sha7>` first, for a secret whose `pushed` is true: a hand push of the chain branch is rotated, never
      rewritten by a Leg; `a merge sits at or after it`, `the scan named no commit to rewrite from`, `<sha12> is below
      the task's leg_base`, `<sha12> above it is not this task's (no Task: [[t]] line)`). `ask`:
      shell_safe(security_ask): a primary secret (`… is in <top>'s history, which a Leg never rewrites`, then by
      `pushed`: `, and origin already holds it: rotate it`; `: rotate it,
      and while origin does not hold it you may rewrite it out of that history yourself before the halt is cleared`; or
      the same after `, and whether origin holds it is unknown (<pushedWhy>)`), a scanner-config change and an advisory
      (each naming its `security-accept <kind>:<key>`), never a copy's secret or an unscanned top; null with none.
      shell_safe leaves no backtick, `$`, `\\` or `"`, so repair's record-answer carries it in double quotes. Then
      under the rollout's lock: the claim and the key read again (a change is exit 1, `run security again`) and each
      top's HEAD (5 s each: a move is exit 1, `HEAD moved in <top> since the scan`), both nothing written; then the task
      note: `leg_scan: ["<top>@<head> <verdict>", …]` (after `leg_primary_base` or `leg_base`, replaced each run, and
      removed with no tops) and `## Security check`, one shell_safe line per top that is not clean (`- <top> at
      <head12>: secret: <rule> in
      <file>, commit <sha7>, line <line>[; …]; rewrite from <sha12>` | `; no rewrite point: <why>` | `; a primary
      checkout's history, which a Leg never rewrites`; `: red`; `: unscanned: <error>`), then `Ask: <ask>`; the section
      removed when every top is clean. It renews the Leg lease and writes no Leg log line. done and set-aside read the
      record through covering: a Chain copy's covers only at that copy's HEAD exactly; a primary's at HEAD or an
      ancestor with no task commit above it (its `Task:` commits, or an untrailered one touching only docs/reviews/),
      a peer's later commit kept out (ADR 0040). Prints {verb, rollout, task, tops [{top, primary, base, head, verdict,
      exit, error, secrets, uncommitted, rewrite, rewriteWhy, scan}], ask, clean, dryRun}; exit 0 for any completed run
      (a red one included), 1 a refusal, 5 the lock; --dry-run scans and writes nothing. The budget: the deadline
      holds every call per top but its HEAD read: each is started only with 1 s or more left, its timeout the rest of
      the deadline at most its cap (within: the sweep's list and its teardowns, each only with TEARDOWN s left; the
      scratch add; the scan; settle_pushed's symbolic-ref, ls-remote, cat-file and merge-base; uncommitted_paths;
      rewrite_point's merge-base and log), and one it cannot start reads its budget ran out (`not scanned: …`, a null
      `pushed` or `rewrite` with `not read: …`, `uncommitted` []). Past it run only a cut scan's 10 s grace, its scratch
      tree's teardown (at most TEARDOWN, 50 s; no later top's tree is added), each top's HEAD read (5 s), then the lock
      wait (at most 30 s), 5 s per top of HEAD re-reads and the note's save: 420 + 10 + 50 + 5·N + 30 + 5·N + 5 < 600
      (the Bash tool's foreground cap, legs.md's `timeout: 600000`) for N ≤ 8 tops. The reads before the first scan
      (change_of, stray_of, the copies' rev-list) take git()'s 120 s per call, outside it. A call the tool cuts wrote
      nothing (its writes are all under the lock, after the scans), and the next call sweeps its scratch tree.
  post-items                                 (read-only, no lock)
      The `## Post-rollout` items (the top-level `- ` lines after `Rollout-specific items go here:`), indexed from
      1, each with its pointer (`→ [[f]]`) or null.
  file-followup --title <t> --why <w> [--item <k>]
      A loose open task (follow-on frontmatter: tags, status open, priority, work_depth, projects copied from the
      rollout, contexts, scheduled, due, captured; never rollout:, phase: or owner:), named
      `<project>-followup-<title words>[-<k>]`, and a `## Post-rollout` pointer: item k rewritten, or a new item.
      Logs `follow-on [[f]] (close|post-item <k>)` against the latest Leg, closed or not. After Complete (the note
      read from `Archive/Rollouts/`) it files the task alone: no pointer and no log line, since the archived note's
      committed Completion log is the chain's final record (`pointer: false`); --item there is exit 1.
  close --outcome handoff|complete|stuck|stopped|halt [--reason <r>] [--cwd <dir>] [--disposition <k>=<text>]...
        [--log-line <text>]... [--also <path>]... [--reflection <text>]
      --reflection (close-score.py's one line, legs.md § Complete step 3) is required with --outcome complete and
      refused with any other outcome (usage, exit 2); it is written as the Completion log's `- Reflection: <text>`
      line, cut to 300 characters.
      Refuses handoff, complete and stuck while this Leg owns an in_progress task (stopped and halt leave it claimed
      for the next Leg), handoff with nothing to hand over, and complete unless every counted row is done. Writes the
      close line and prints `progress`, `commit_only` (the cwd's toplevel and every chain checkout: each `leg_base`
      top), `needs_you`, `handover` {title, prompt, tldr, cwd, harness} (handoff only) and `status_line` (every
      outcome but handoff). In a chain with `chain_copies:` the handover's `cwd` is the next row's folder inside its
      copy and its `launch` the copy's launch line, while the close line keeps the Queue folder. complete refuses first
      an Archive name collision and a Post-rollout item with neither a
      pointer nor a --disposition, then (ADR 0055) a `completion_verifier:`, `env_bootstrap:` or `completion_timeout:`
      the completion verify's reader refuses (`completion verify: <why>: fix the note`) and a declared completion
      verify that is not decided (`the completion verify is not decided (<state>, attempt <n>)`: legs.md § Complete
      runs it first); before that, inside the lock, a done row whose `leg_head` entry on a Chain copy is not on its
      primary's local default branch (landed_gate: `[[t]] is not on <d> in <P>: run leg.py land first (legs.md §
      Complete's Land first); nothing written`, or the unresolved branch named); before the lock it asks land.sh's own
      route for each chain checkout (`land.sh
      --route -- <top>`, 60 s): on `landable <d>` it lists the chain's `Task:`-trailered commits that the local
      `refs/remotes/origin/<d>` lacks (no fetch) and, when there are any, files
      `<project>-followup-land-chain-<YYYY-MM-DD>[-<k>]` (act: open a PR from them, or push them; ADR 0028 automates
      only close-out commits); on `not landed: <reason>` it files nothing; on `stuck: <reason>`, a failure or a
      timeout it files the follow-on with every chain commit there and the act prefixed `check the landing route
      (<reason>), then`. A chain checkout that is a Chain copy reads its primary's route instead (the copy's own branch
      reads not landed), its commits those not on the primary's local default branch d plus, when landable, those
      `origin/<d>` lacks, and on `stuck` every chain commit there, as in place (a hand merge into d included: that route
      cannot say what origin has); a commit still off d files the follow-on whatever the route, its act first `merge
      chain/<rollout> into <d> there` (`chain/<rollout> is already on <d>:` when none is off it: by Complete land has
      put them all there, so a copy files only the origin half, as in place; land --retire removes the copy and its
      branch after), and its Chain commits line reads `<copy> (chain/<rollout> of <primary>): <k> not on <d>[; stuck:
      <reason>] → [[f]]`, `all on <d>; stuck: <reason> → [[f]]`, `all on <d>, <k> not on origin/<d> → [[f]]`, `all on
      <d>; not landed: <reason>, nothing filed` or `all on <d>[ and origin/<d>]`. Then
      `status: done`, `completed:`, a `## Completion log` (a line per Leg: launch, begun–closed,
      done and set aside; the decided completion verify's `Completion verify: …` summary when the note declares
      `completion_verifier:`; each --log-line; `Post-rollout items:` with each disposition; a `Chain commits:` line per
      checkout or `Chain commits: none`; `Reflection: <--reflection>`), the move to
      `Archive/Rollouts/` (a git move when `git ls-files --error-unmatch` finds the note, else a rename), and one
      vault commit by pathspec (the archived note,
      the follow-ons this Leg filed, a red completion verify's `completion-red-<rollout>.md` when it sits in the tasks
      root, each --also path, the old path when tracked); with the key declared it prints `completionVerify` {state,
      summary, followup}, and without it the bytes, the pathspec and the JSON are as before. A failed commit is
      `committed: false`, exit 0: the daily sweep commits it.
  handed --started <id> | --manual <why>
      Logs `hand-over: started <id>` or `hand-over: manual (<why>)` on this session's Leg closed with a handoff, and
      prints its status line (a manual one names the next row's folder inside its Chain copy). Idempotent once logged.
  clear-halt --reason <r>
      Logs `halt cleared: <r>` when a halt stands (else exit 1); the halted claim is then inherited by the next Leg.
  copies
      Makes the chain's Chain copies and stamps `chain_copies:` (schedule § Serial path S5; begin runs the same code;
      by hand on status's `chain copy missing` blocker). Refuses (exit 1) a note that is not serial, done, dropped or
      superseded; an incomplete one is allowed (S5 runs it before S6). The checkouts are serial-chains.py's checkouts_of
      over the note's `surfaces:`, every Queue row's cell tokens and launch folder (the vault excluded), each kept when
      it is its own git toplevel (any other gets a WARN and no copy). Per checkout P: its recorded pair, or a new one;
      a missing copy is `git -c core.hooksPath=/dev/null -C P worktree add <C> chain/<rollout>` when that branch exists
      (its commits kept), else `worktree add -b chain/<rollout> <C> refs/heads/<d>`, d P's local default branch
      (origin/HEAD's name, main, master), else from HEAD with a WARN that begin never fast-forwards it, after a
      `worktree prune`; then each `.mcp.json` and `.claude/settings.local.json` P has at its toplevel and in each Queue
      launch folder inside it is symlinked into the copy when the copy lacks it and `git check-ignore` passes in P (the
      launch folders are made in the copy). `chain_copies:` is stamped after `shape:` when the pairs changed, recorded
      pairs kept. Refuses (exit 1, the note unwritten) a malformed key, the copy dir under ~/repos or ~/Projects, two
      entries of one repository (one git common dir), this plugin's own checkout, a copy path held by anything but P's
      worktree on chain/<rollout>, that branch checked out in another worktree, and a git failure. Prints {verb,
      rollout, copies [{checkout, copy, branch, base, made, linked}], warns, stamped, dryRun}; --dry-run makes and
      writes nothing.
  land [--verified <sha40>]... [--red <why>] [--retire]
      ADR 0067 d3, d4: each finished task of a chain with `chain_copies:` onto its primary's local default branch
      (legs.md § The task loop's Land after every `done`, § Complete's Land first, close § Under a Leg's land). The open
      Leg runs it, when it is this session's; with no Leg open, the last Leg, when its session is this one or either is
      `unknown` (handed's rule), so a close runs it after `leg.py close`; anyone else is exit 1, `no Leg of this
      session: run leg.py begin first`. Refuses (exit 1, nothing written) a note that is not serial, a dropped or
      superseded one, a malformed `chain_copies:`, a done or archived note without --retire, and a not-done one with
      it; --red with --verified, or --retire with either, is usage (exit 2). In place (no `chain_copies:`) it is
      `inPlace: true`, `lands: []`, nothing written. A counted row in progress stands every copy (`a row is in
      progress: a land never merges mid-task`) with no git and no repo lock. Else per pair P -> C, one at a time, d
      P's local default branch (default_branch):
        1. stands with no lock: d unresolved, C missing (`leg.py begin remakes it`), C dirty in tracked files;
        2. P's repo lock (The lock, below): past its timeout the copy stands, `another land held <path> past <t>s`;
        3. unl: the done counted rows with a `leg_head` entry on C that refs/heads/<d> in P does not reach (git is the
           truth: a hand merge counts);
        4. d into C, never a rebase (so `leg_head` stays an ancestor), hooks off and never an autostash: `merge
           --ff-only` when the tip is d or behind it, else `merge --no-ff --no-edit -m "🔀 land: merge <d> into
           chain/<rollout>"`; a conflict is aborted (`merge --abort`) and stands, `conflict in <paths>`, and an
           untracked-file refusal stands with git's line; dm is the d sha the tip now holds;
        5. on the first try, when unl is not empty, the actual-claim check (ADR 0067 d4): unl's `leg_claims:` (a row
           done before them: change's paths as `repo:<P>//<path>`), bookkeeping aside, against every other live
           root-level serial note with a `chain_copies:` pair on P, read as a Chain, whose rows are unlanded_done and
           whose `leg_head` on its copy git confirms is off d, their `leg_claims:`; an overlap with a chain that sorts
           first (order_key, rank-led) stands, `[[X]] holds <token> unlanded and <first_by>` (`began first`, `ranks
           above (estate rank <n>)`, `was scheduled first`, or a tie in slug order's words), with
           4's merge kept on chain/<rollout> as --red keeps it, so the copy holds the work other chains landed on d and
           the next land asks for its re-verify; a later chain never blocks, and an unreadable note is a WARN (git's
           merge and the re-run Verify lines are the backstop);
        6. the verify list: an unl row needs its Verify line run again unless dm is in its `leg_head`, or a verified
           tip V for P (a logged `land verified: <P> at <V>`, or this call's --verified <V> when V is the tip, then
           logged once) holds its head and dm and the tip holds V; a list stops the copy as `verify` with `head`,
           `merged` and `verify` [{task, line (its **Verify:** line or null), folder (its launch folder in C)}], the
           merge kept on chain/<rollout>;
        7. d moved to the tip, by where it is checked out: in P, after the in-place peer check (below), P's HEAD read
           again (off d, it stands, `<P> left <d> during the land (its HEAD is now <ref>)`), then d and refs/heads/<br>
           read again, and `merge --ff-only --no-autostash` in P only when d is still dm and strictly behind the
           branch (p39-4: git rewrites ORIG_HEAD on a no-op or refused ff-only): d already the branch is landed (the
           tip) or moved, with no merge; d moved since 4 is moved before anything else, so the re-run can ask for a
           re-verify (a d still behind the branch re-runs, never fast-forwards at once); a branch unreadable or not
           holding d stands, naming it; then live-checkout.sh's overlap mode against refs/heads/<br> (a local change
           or an untracked file in the way stands, `the primary's uncommitted edit on <files>`, with no merge run;
           never a stash; a mode that cannot run is a WARN, and git's refusal stays the guard), landed only when
           refs/heads/<d> is then the tip; nowhere, a compare-and-swap `update-ref`; in another worktree, a stand
           (`<d> is checked out in <wt>`). A CAS failure, a d that moved, or an ff that left d short of the tip,
           re-runs from 4, three tries at most, then stands `<d> kept moving`. A tip already d is `current`, P
           untouched;
        8. the repo lock released.
      Then `leg_landed: <stamp>` (after `leg_claims:`, else `leg_head:`) on each done row whose every `leg_head` entry on
      a copy is on its primary's d (git's read), the task notes first, and the Leg log: a `land:` line per copy landed,
      a `land stood:` line per stand (none when the chain's last land line for P is that same stand) and `land
      verified:`. Every stand exits 0. The in-place peer check, on each try right before the ff in P: every other live
      root-level serial note that works in place (no `chain_copies:`; a malformed key reads as in place, as
      unfinished-rollout.py's copied_of reads it), read as a Chain, with a Leg open or a counted row in progress, whose
      open Leg's write set and launch folders (write_set, write_rows: begin's surface re-check's) or running rows'
      cells, folders and `leg_base` tops name P (or `any`), stands the copy `[[X]] works <P> in place (Leg <n> open |
      [[t]] in progress): a land never moves a checked-out <d> under another chain's live work`; one that cannot be read
      stands it only when its `surfaces:` names P or reads as any, `[[X]] could not be read (<why>) and may work <P> in
      place: fix its note`, else a WARN. No peer check runs for update-ref: no working tree moves. Prints {verb,
      rollout, leg, inPlace, lands [{checkout, copy, branch, default, state (landed, current, verify or stood), head,
      merged, verify, landed (its tasks landed), why, waits}], stamped, warns, dryRun}: `waits` is true on a stand that
      clears by itself (an earlier chain's claim, another land's lock, an in-place peer, P off d mid-land, d kept
      moving), false on any other stand, null otherwise. --dry-run prints each copy's `plan` {unl, claim, bring,
      verify, ff, peer} as state `plan`, takes no lock, and merges, moves and writes nothing.
      --red <why>: logs `land stood: <P>: Verify red after a land merge: <why>` for each copy whose chain branch holds
      commits its d lacks (every copy when none does), runs no git write and keeps the merge (no verified tip, so the
      next land asks again); a closed Leg may run it, and then writes that one line only.
      --retire, after Complete (the archived note is never written): resolves its paths, primes the git env and moves
      the cwd to the first primary (the copy it removes may be the cwd), then per copy, under its repo lock, lands its
      close-out commits by 4 and 7 (the peer check included; a done row off d, or any stand, keeps the copy and its
      branch), removes the copy (`git worktree remove`, never --force; a copy already gone gets `worktree prune`, then 7
      alone when d is an ancestor of the branch) and deletes the branch (`branch --set-upstream-to=<d>`, then `branch
      -d`, never -D; a refusal unsets the upstream and keeps the branch). Prints `retired` [{checkout, copy, branch,
      landed, removed, branchDeleted, why}]; any WARN files one loose follow-on, `<project>-followup-retire-chain-<date>`
      (no pointer), naming each kept copy or branch and the `leg.py land --retire` command that finishes it (once
      [[X]]'s Leg closes, for a peer's stand), printed as `followup`.
  status                                     (read-only, no lock, no git; an archived note is read too; the restart's
                                             surface re-check is one read-only unfinished-rollout.py subprocess)
      The whole chain at a glance, for /thread:status § 5, /thread:repair § 7 and reflect's serial-score.py. A note
      not found, or one that is not serial, is exit 1 (`read it with reconcile-rollout.py status`). It prints `note`
      {status, archived, incomplete (its reason, or null), paused (the `paused:` stamp, `pause_requested`, or null),
      supersededBy}, `progress`, `chain` (the chain state, below), `openLeg` (its number, or null), `halt` {reason,
      leg} (the standing halt), `haltCleared` (every `halt cleared:` line: [{at, reason, leg (the halted Leg it
      cleared)}]), `restarted` and `restart` (below), `restarts` (every `restart:` line, as `restarted` reads one),
      `legs` (one per Leg: n, owner, session, alias, folder, began, closed, closedStamp, outcome (handoff, complete,
      stuck, stopped, halted, lost, or null while open), handover, tookOver, lastAt (its own last line's stamp: a
      taker's `closed: lost` line for it is not its own), and its log lines in order, each with its stamp `at`:
      claimed, done, filed and followOns [{task, at}], took [{task, at, from}], setAside [{task, at, status}], smoke
      [{task, at, result}], reverted [{sha, top, at}]), `rows` (one per Queue row: n, slug,
      state, status, owner, leg, launch, fix (the task its `verifies:` names, a fix task's target), fixes (its
      `fixes:`), held (why next holds it), deps (each depends-on/blocked-by entry resolved through `merged_into:`
      tombstones, rr._fold_unit), dependants (below) and setAside {status, summary, gates, fingerprint
      (rr._block_fingerprint)} for a set-aside row), `smoke` (the smoke list of the Leg that acts next: the open
      one, else Leg last + 1), `fixes` (the not-done fix rows), `next` (the open Leg's next act, else a fresh
      Leg's, each read with the rank's contention, and the open Leg's gated by the Capacity alone, never a quota:
      status runs in another session), `stall`, `hold` (hold_of, below), `rank` {stamp (the estate rank,
      or null), warn (a malformed stamp), key (order_key, as pos read it: a never-begun chain's as begun now), pos,
      lifts, standing [{task, kind, at}], contention {held, land, warns}} (*The rank*; pos and lifts null in place)
      and `needsYou` (needs_you's items, plus a halt, a manual hand-over, a pending or manual restart and a stall). A
      row's `held` carries the rank's reason too. In a terminal chain state (complete, dropped, superseded, incomplete:
      begin refuses each, so no Leg acts next) `restart` and `next` are null and `smoke` is empty. Stamps print raw, as
      the log holds them.
  restarted --leg <N> (--pending | --started <id> | --manual <why>) [--replace]
      Records that /thread:repair is starting Leg N (repair § 7 (e)), so a second repair, or status, sees it:
      `--pending` before its create_thread, then `--started <id>` (the new Session's id) or `--manual <why>` (a
      paste-ready manual handoff). Exactly one form, else usage (exit 2). Its checks, in order, are the complete
      list: the note (begin's refusals, exit 1); the session (`unknown`, no --session and no session env, is exit 1
      naming `--session`, whatever the form: nothing is written); a standing halt (exit 3); Leg N already has a
      `began` line (exit 0, `recorded: false`, `began: true`, nothing written); N is not the last Leg + 1 (exit 1);
      a standing restart (below): the same line again is exit 0 `recorded: false`; a `pending` one whose session is
      this session's (both real ids: `unknown` never matches), met by --started or --manual, is its update and is
      written; any other is exit 3 (`a restart of Leg N stands (<how>, <at>): check that session; --replace once
      it is gone`) unless --replace. It checks nothing else: never the open Leg (a take-over's evidence is the
      caller's: repair § 7 (d)) and never the hand-over. Logs `restart: Leg <N> pending (session <sid>)`,
      `restart: Leg <N> started <id>` or `restart: Leg <N> manual (<why>)` and prints {verb, rollout, leg,
      restarted, recorded: true}.

The Leg log (`## Leg log`, at the note's end: below `## Queue` and `## Post-rollout`, so a queue reader never ranks
it). Its line forms are stable (status and reflect's serial-score.py read them); readers key them by Leg number, never
by position:
  - <stamp> Leg <N> began: leg-<N> session <id|unknown> in <alias> from <folder>[; took over from Leg <K>]
  - <stamp> Leg <N> resumed: session <id>
  - <stamp> Leg <N> smoke: [[t]] pass|fail|not run[: <why>]
  - <stamp> Leg <N> filed [[f]] (verifies [[t]]; cause own|chain [[L]]|outside|drift)
  - <stamp> Leg <N> claimed [[t]]
  - <stamp> Leg <N> took [[t]] (inherited from Leg <K>)
  - <stamp> Leg <N> done [[t]] (verify pass|none[; reviewed <doc>])
  - <stamp> Leg <N> set aside [[t]] (<status>): <reason>
  - <stamp> Leg <N> reverted <sha> in <top>
  - <stamp> Leg <N> closed: handoff to Leg <N+1> in <alias> from <folder> | chain complete | chain stuck: <k> set
    aside | stopped: <reason> | halted: <reason> | lost (taken over by Leg <M>)
  - <stamp> Leg <N> hand-over: started <id> | manual (<why>)
  - <stamp> Leg <N> follow-on [[f]] (close|post-item <k>|land)
  - <stamp> Leg <N> land: [[t1]], [[t2]] on <d> in <P> (<sha12>) | close-outs on <d> in <P> (<sha12>)
  - <stamp> Leg <N> land stood: <P>: <why>
  - <stamp> Leg <N> land verified: <P> at <sha40>
  - <stamp> Leg <N> rank wait: [[t]] on [[X]] (<token>; ranks above it)
  - <stamp> Leg <N> rank retry: [[t]] on [[X]] (<token>; [[X]] ranks above)
  - <stamp> halt cleared: <reason>
  - <stamp> restart: Leg <N> pending (session <sid>) | started <id> | manual (<why>)
A `restart:` line carries no Leg number of its own (it names the Leg to come), so no reader counts it as a Leg. A rank
line stands from its write until a `claimed`, `took` or `set aside` line for its task in the same Leg, or that Leg's
`closed:` line (standing_lines); only a standing line reserves its task's cell or ages its chain.
The Completion log's last line is `- Reflection: <close --reflection's text>`.

The chain, as status reads it (repair and serial-score.py read these; this is their one copy):
- The chain state, the first that matches: `complete` (status: done, live or archived); `dropped`; `superseded`
  (a `superseded_by:`); `incomplete` (`incomplete: true`, or reconcile-rollout.py's incomplete); `paused` (a
  `paused:` or `pause_requested:` stamp); `halted` (a standing halt); `restarting` (a standing restart); `live` (an
  open Leg); `awaiting-successor` (the last Leg closed `handoff to Leg <N+1>`, and no Leg N+1 began); `completable`
  (every counted row done, no Leg open); `stopped` (the last Leg closed `stopped:`); `stalled` (the stall below);
  `not-started` (no Leg began); `stuck` (a fresh Leg's next is `stuck`); else `ready`.
- The stall: {claimed [{task, owner, leg, legOutcome}], why}, the in_progress rows owned `leg-K` by a Leg K that is
  closed or absent (legOutcome `absent`), or null. It is null whenever a Leg is open: a successor between its
  begin and its `claim --inherit`, and a take-over, hold the claim too.
- The restart: what a fresh Leg N (N = the last Leg + 1) would do, from next's plan for it (no cap, no launch
  boundary, an open Leg K read as dead), read with the rank's contention (freshRank, the plan begin's launch check
  reads too, a never-begun chain read as begun now: *The rank*), when that plan is finish, claim, wait (built from its
  row, as a claim) or complete and the chain state is not terminal (complete, dropped, superseded or incomplete); else
  null. The chain state, the stall and the hold read the contention-free plan instead, so a chain whose rows are all
  rank-held reads `ready`, never `stuck`, and its hold stays whole. A paused chain keeps it: what runs once the stamp is
  gone. {leg, title
  (`Leg <N>: <slug>`, at most 60 characters), prompt (the Leg prompt, ` --take-over` on its first line when a Leg
  is open), takeOver, tldr, cwd, harness, launch, task, anyLaunch, blockedBy}. For finish or claim: cwd is the
  row's folder (realpath; inside its Chain copy in a copy chain), harness codex for a `cx-*` alias else claude, launch
  `<alias> from <folder>` (the copy's launch line in a copy chain), task its slug, anyLaunch false. For complete: cwd
  the last Leg's folder (realpath, mapped into its copy; begin accepted it, so it is never this plugin's checkout; the
  vault when no Leg began), harness, launch and task null, anyLaunch true (a Complete Leg works no row, so begin takes
  any cwd but this plugin's checkout). blockedBy, the first that holds, else null:
  `halt`; `restart Leg <N> (<how>)` (a standing restart); `open Leg <K> (session <id>)`; `handover started <id>`
  (the last Leg handed off to a started Session that never began); `chain_copies: <why>: fix the note` (a malformed
  key); `chain copy missing: <C> (leg.py copies --rollout <note> remakes it)` (a copy chain whose cwd is gone); then,
  only when none of those holds, begin's
  surface re-check run read-only for Leg N: `surface held by [[<B>]] (<token>)` on a hit (its causes include (O)'s
  holder half, ADR 0067 d9: an earlier copied chain with no open Leg holding a code file), `surface re-check failed:
  <its line>` when the check fails (ADR 0060). A manual hand-over is null: it waits on Lachy.
- The standing restart (`restarted`): the latest `restart:` line with no `began` line after it, as {leg, how
  (pending, started or manual), started, manual, session (a pending line's), at}, else null.
- The hold (ADR 0060 d1, d2; hold_of, the one copy unfinished-rollout.py loads): what the unfinished chain holds
  against other rollouts, {scope, why, held, released, unlanded, undone, pending, rows, warn, began, open, rank,
  captured, holding}. In every
  chain state but `stuck`, scope `whole`: `held` is the note's whole `surfaces:` (`any` when it reads as any),
  `released` empty.
  `stuck` (no Leg open, no stall, hand-over, restart or halt standing, not completable, nothing claimable: every
  unlanded row is set aside or held behind one), scope `stuck`: `held` is the Surfaces cells of every counted row not
  done (set-aside rows, rows held behind them, a `missing` row) plus any `surfaces:` token that no row's cell names (a
  hand edit, kept), and `released` is the rest of `surfaces:`, done rows still on the next Leg's smoke list included;
  deferred and folded rows are outside the count, so released. A stuck chain fails closed to `whole`, with `warn`
  set, when its Queue has no rows, an unlanded row's cell is empty or holds a token parse_token refuses, or a row
  reads in progress.
  `undone` is the counted, not-done rows' cell tokens in any state (the note's whole claim on those same failures);
  `pending` the done rows of a chain with `chain_copies:` not yet landed (unlanded_done: `leg_claims:`, a non-empty
  `leg_head` and no `leg_landed:`; ADR 0067 d3), by slug; and `unlanded` undone plus pending's cell tokens: what a
  resuming chain's re-check compares against (a parallel resume reads `undone` only). The stuck scope's `held` and
  `released` read `undone`. `rows` is those rows, {slug, state, surfaces, folder} (folder the row's launch folder, so
  its checkout). `began` is the Leg log's first `began:` stamp, raw (null before Leg 1),
  and `open` the open Leg as {n, folder}, else null: the order and the interim mutex of unfinished-rollout.py's
  check_resume read them (ADR 0067 d4). `rank` is the estate rank (serial-chains.py's read_estate_rank, {n, at, ts},
  else null; a malformed stamp also sets `warn`) and `captured` the note's `captured:`, the rank-led order's other
  inputs; `holding` is holder_tokens over the counted rows: each row in progress (its cell, else the note's claim,
  else `any`) and each unlanded_done row (its cell plus its `leg_claims:`, bookkeeping aside), canonical, which
  unfinished-rollout.py's (O) holder half reads (ADR 0067 d9).
- A row's dependants: the counted, not-done rows D with an entry in D's depends-on or blocked-by that resolves
  (rr._fold_unit, through `merged_into:` tombstones) to the row or to a row already found: transitive,
  cycle-guarded, in Queue order, each {slug, state, owner}. repair § 7 (b) defers a set-aside with them (repair § 5's
  closure, read the way next's holds read a dependency).

The status mapping (legs.md § Report): every Leg turn ends `ROLLOUT-STATUS: <slug> merged=<K>/<N> running=<R>
state=<state>[ reason="…"]`, R 1 while this Leg owns an in_progress task. It is never `running`: next --waiting
<r> `waiting reason="<r>"`; handed --started `done reason="handed off to Leg <N+1>"`; handed --manual `halted
reason="manual handoff: Leg <N+1> in <alias> from <folder>"`; complete `done`; stuck `halted reason="awaiting you:
<k> set aside"`; stopped `halted reason="stopped: <r>"`; halt `halted reason="halt: <r>"`; a refused begin `halted
reason="<refusal>"`.

The lock. Every writing verb holds an exclusive fcntl.flock on `<lock dir>/<rollout stem>.lock` for its whole run,
git work included: `<lock dir>` is $THREAD_LEG_LOCK_DIR, else ${XDG_STATE_HOME:-~/.local/state}/thread/legs, outside
the vault (the note cannot be the lock: os.replace swaps its inode). Under it each verb re-reads every note it
changes, validates, and writes each through a temp file in the same directory plus os.replace, task notes first and
the rollout note last. A wait past $THREAD_LEG_LOCK_TIMEOUT seconds (default 30) is exit 5. The read-only verbs take
no lock: os.replace means they never read a torn note, and claim re-validates whatever next proposed. land also takes
each primary checkout's repo lock, an fcntl.flock on `<git rev-parse --path-format=absolute --git-common-dir>/thread/
chain-land.lock` (its directory made when missing), after the rollout's lock, one at a time, each released before the
next and never nested, so two chains in one repo land in turn and no lock cycle forms; a wait past the same timeout
stands that copy (exit 0), never exit 5. claim, and wait's log, also take the machine-wide rank lock (RankLock,
`<lock dir>/rank-claim.lock`), always inside the rollout's lock and never nested with a repo lock, around the
contention read, the plan, the save and the log, so two chains never claim one code file at once; a wait past the same
timeout is exit 5, nothing written. While Capacity is in force a fresh claim also takes the machine-wide trickle claim
lock (reconcile-rollout.py's TRICKLE_LOCK, every lead's `next`'s), inside the rank lock, around only its recount, the
Leg lease, the task note's save and the claims write: never git, gh or a child process (the reads that may run one,
the heat's `notifyutil`, the Mac's boot and wake, the Capacity and Away readings, are taken before it: rr's
capacity_reads), and nothing takes a leg.py lock inside it, so the order is rollout lock, rank lock, trickle lock,
note locks, and no cycle forms with `next` (trickle lock, then note locks). A capacity `wait` takes the trickle lock
alone for its record write, its reads taken first the same way.

The Capacity (ADR 0067 d8; execute away.md § Capacity, its spec). While a fresh capacity.json is in force (rr's
_capacity_state), a Leg's claims count on the Mac behind its Leg lease (at least 1 while it is fresh: an open Leg counts
from its session's start, ADR 0076 d3, read by rr._running_by_rollout), and its fresh claims are gated by the room
(rr.capacity_gate, the one copy of the arithmetic: C, less the count elsewhere, less the places the fair share keeps for
other waiters, less this chain's own places, its claims or 1 for its session, so a session's first claim needs no new
place; waiting Legs with no claim take turns by their waiting records' `since`, p44-2; the Heat hold and the quota hold
too). begin writes the lease before its gate, so its own next reads that place too. leg_gate turns a held `claim` into
the `wait` kinds above, in next, begin's next, wait's poll and status's own next (status: the Capacity alone); begin's
launch check, claim's re-check, close's plans and status's fresh and restart plans are never gated. The Leg lease is
~/.config/thread/leases/<rollout>.json, `{rollout, written_at, by: "leg"}` plus `waiting: true` from `next --waiting`,
written off --dry-run on the open Leg by begin (any begin that runs it), next (its own session only), claim, wait,
smoke, done, security, set-aside and land; close (any outcome) deletes it. It lapses LEG_LEASE_LAPSE (90 min) after its
last write, or LEG_WAIT_LAPSE (180 min) for a waiting one, from the latest boot or wake if later. Under the fallback
nothing is gated and nothing counts; the lease is still written.

The rank (ADR 0067 d9; CONTEXT.md **Estate rank**, **Rank wait**): same-file waits go by rank, wait-die, at claim.
order_key (rank-led: a chain that has begun before one that has not, then the estate rank orient-all stamps, a later
pass first and the lower n first, then the first to begin, or never begun the earlier `captured:`, then slug) is the one
static order begin, land and claim read. rank_contention reads it for a chain with `chain_copies:` against every
unfinished peer with a well-formed `chain_copies:` (other_serial, peer_chain; git-free; an unreadable peer is a WARN
that holds nothing), counting only serial-chains.py's rank_tokens (`repo:` and `any`; vault and `ext:` never wait, d6,
so between copied chains they keep their begin waits, and so does `any`). A holder row of peer X is each row in
progress and each unlanded_done row (holder_tokens). It is running when X has an open Leg and, for an unlanded row,
no third chain that sorts before X has unlanded done rows whose `leg_claims:` meet it (claim_stand's test, one hop,
from the notes). A standing line of X's open Leg reserves its task's cell. pos is each chain's place in the order
among {this chain} and every copied peer, this chain read as begun now when it has no `began:` line (a fresh Leg 1:
begin's launch check and status's freshRank read its order as its claims will); lifts = floor(minutes since its open
Leg's earliest standing line / RANK_AGE_MINUTES = 60) (a dead Leg's lines count nothing, so a fresh Leg starts at 0);
eff = (pos − lifts, −lifts, pos), lower first, a strict total order. A running holder row behind this chain (unlanded, X
sorts after this chain, and this chain's own unlanded rows meet it: its land will stand behind this chain) never holds a
fix row and carries `landFirst`, those own rows. For each candidate row r of this chain (its counted cell tokens, else
the claim, else `any`): a holder row not running is a die when X sorts first (dead when X has no open Leg) and nothing
when X sorts after; a running one is a wait when eff(this) < eff(X), else a die; a reservation is a die when eff(X) <
eff(this); a die wins over a wait, and a dead die over a live one, whatever the peers' order. (H): this chain's first
own unlanded row gets a land wait on an earlier peer C whose unlanded rows meet it, whose open Leg owns no row in
progress, and which either has a standing `rank wait:` line on this chain or a `done` line for one of those rows under
RANK_LAND_MINUTES (15) old with no `land stood:` line after it.
The progress argument: eff is one total order over running chains, so two chains never both wait on each other; a
chain at `wait` owns no row in progress (finish comes first), so every wait ends at a land, and a running holder
finishes first, with no preemption; a holder that is not running is never waited on: one that sorts first sets the
row aside, a chain left with only such rows closes stopped (a stalled retry) and its next begin waits on that holder
by (O)'s holder half, so it is never restarted into the same wait, and one that sorts after holds nothing, its land
standing behind this chain (d4); lands follow order_key: land's claim check never stands on a later chain, and a
`land` wait points only to an earlier chain that is between tasks; every chain at `wait` lands before each round
(legs.md), so the first pending land in the order lands, or its chain closes stopped (landFirst, or the 180-minute
bound, RANK_WAIT_MAX_MINUTES); reservations only set rows aside, and lapse at the claim or the close; begin-time waits
stay unfinished-rollout.py's, and serial_waits' argument proves them acyclic: (O), the holder half included, and an
earlier-ward (Y) point down order_key, a later-ward (Y) lands only on a free chain, (M) only on an open Leg. ADR
0060's yield is decided there, at begin, ahead of rank, and rank orders only the claims after begin.
"""
import argparse
import contextlib
import fcntl
import importlib.util
import json
import os
import posixpath
import re
import shlex
import shutil
import signal
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timedelta
from pathlib import Path
from types import SimpleNamespace

HERE = Path(__file__).resolve().parent
PLUGIN = HERE.parent.parent.parent
RR_SRC = HERE / "reconcile-rollout.py"
SC_SRC = PLUGIN / "skills" / "_shared" / "scripts" / "serial-chains.py"
LAND_SH = PLUGIN / "skills" / "_shared" / "scripts" / "land.sh"
LIVE_CHECKOUT_SH = PLUGIN / "skills" / "_shared" / "scripts" / "live-checkout.sh"
UNFINISHED_PY = PLUGIN / "skills" / "_shared" / "scripts" / "unfinished-rollout.py"
PLUGIN_JSON = PLUGIN / ".claude-plugin" / "plugin.json"
DEFAULT_VAULT = "~/repos/obsidian"
# A Chain copy's gitignored config, linked from its primary checkout (ADR 0067 d2), and the generated launch aliases a
# copy's manual launch line reads (each alias `cd`s into the primary, so a copy's line runs the alias's command without it).
CONFIG_LINKS = (".mcp.json", ".claude/settings.local.json")
DEFAULT_ALIASES = "~/repos/workspaces/_shared/generated/launch-aliases.zsh"

LEG_LOG = "## Leg log"
COMPLETION_LOG = "## Completion log"
POST_ROLLOUT = "## Post-rollout"
QUEUE = "## Queue"
ITEMS_MARK = "Rollout-specific items go here:"
BLOCKER = "## Blocker diagnosis"
GATES_PENDING = "## Gated inputs (awaiting sign-off)"
APPROVED_GATES = "## Approved gates"
NONE_GATE_RE = re.compile(r"^none\.?$")  # execute § 3.7's exact `None`, on _norm_gate's text (task.workflow.js's /^none\.?$/i)
# The Security check on a serial chain (execute § 3 `security_checks`; legs.md § The task loop's **Security check.**):
# `security`'s one budget for every scan it runs, the floor a top needs to start, a cut scan's grace after its SIGINT,
# the scratch tree's name prefix (its pid after it, so a dead run's tree is swept), settle_pushed's ls-remote cap, the
# cap of each short git read inside the deadline, and a top's HEAD read, the one read per top that may run past it.
SECURITY_SECTION = "## Security check"
SECURITY_BUDGET = 420
SCAN_FLOOR = 20
SCAN_GRACE = 10
SCRATCH_PREFIX = "leg-security-"
PUSHED_LS_TIMEOUT = 30
SHORT_READ = 5
HEAD_READ = 5
TEARDOWN = 50   # _teardown's 30 + 10 + 10 s
SCAN_VERDICTS = ("clean", "red", "secret", "unscanned")
SCRATCH_RE = re.compile(rf"^{re.escape(SCRATCH_PREFIX)}(\d+)-")
CAP = 5
OUTCOMES = ("handoff", "complete", "stuck", "stopped", "halt")
TERMINAL = ("complete", "dropped", "superseded", "incomplete")   # the chain states begin refuses for good
REVIEWS = "docs/reviews/"
SET_ASIDE = {"blocked", "review-blocked", "plan-blocked", "gate-pending"}
LAUNCH_RE = re.compile(r"^`([^`]+)`\s+from\s+`([^`]+)`$")
VERIFY_RE = re.compile(r"^\s*\*\*Verify:\*\*.*$", re.M)
LOG_RE = re.compile(r"^- (?P<stamp>\S+) Leg (?P<n>\d+) (?P<rest>.*)$")
CLEARED_RE = re.compile(r"^- (?P<stamp>\S+) halt cleared: (?P<reason>.*)$")
RESTART_RE = re.compile(r"^- (\S+) restart: Leg (\d+) (pending \(session (\S+)\)|started (\S+)|manual \((.*)\))$")
LINK_RE = re.compile(r"\[\[([^\]|#^\\]+)[^\]]*\]\]")
BEGAN_RE = re.compile(r"^began: leg-(\d+) session (\S+) in (\S+) from (.*?)(?:; took over from Leg (\d+))?$")


class Refuse(Exception):
    def __init__(self, code, msg, **extra):
        super().__init__(msg)
        self.code, self.msg, self.extra = code, msg, extra


class Usage(Exception):
    pass


def _load(name, src):
    sys.dont_write_bytecode = True
    spec = importlib.util.spec_from_file_location(name, src)
    if spec is None or spec.loader is None:
        raise Usage(f"cannot load {src}")
    mod = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(mod)
    except Exception as e:  # noqa: BLE001 — any load failure is the same usage error
        raise Usage(f"cannot load {src}: {e}")
    return mod


rr = None
sc = None


# ---- git, with the repo-local env removed ----------------------------------------------------------------------

_ENV = None


def _env():
    global _ENV
    if _ENV is None:
        env = dict(os.environ)
        try:
            names = subprocess.run(["git", "rev-parse", "--local-env-vars"], capture_output=True, text=True,
                                   timeout=30, env={k: v for k, v in env.items() if not k.startswith("GIT_")}).stdout.split()
        except (OSError, subprocess.SubprocessError):
            names = []
        for name in names:
            env.pop(name, None)
        env.setdefault("GIT_TERMINAL_PROMPT", "0")
        _ENV = env
    return _ENV


def git(top, *args, input=None, timeout=120):
    try:
        return subprocess.run(["git", "-C", str(top), *args], env=_env(), capture_output=True, text=True,
                              input=input, timeout=timeout)
    except (OSError, subprocess.SubprocessError) as e:
        return subprocess.CompletedProcess(args, 99, "", str(e))


def git_out(top, *args, timeout=120):
    r = git(top, *args, timeout=timeout)
    return r.stdout.strip() if r.returncode == 0 else None


def toplevel(d):
    if not d or not os.path.isdir(d):
        return None
    top = git_out(d, "rev-parse", "--show-toplevel")
    return os.path.realpath(top) if top else None


def is_ancestor(top, a, b):
    return git(top, "merge-base", "--is-ancestor", a, b).returncode == 0


def _fold(p):
    return os.path.realpath(os.path.expanduser(p)).casefold()


def in_archive(path):
    """True when the note sits in an `Archive/Rollouts/` directory (Complete's destination)."""
    p = path.resolve()
    return p.parent.name == "Rollouts" and p.parent.parent.name == "Archive"


# ---- context and output ----------------------------------------------------------------------------------------

class Ctx:
    def __init__(self, args):
        self.args = args
        vault = args.vault
        if vault is None:
            vault = str(Path(os.path.expanduser(args.tasks_dir)).parent.parent) if args.tasks_dir else DEFAULT_VAULT
        self.vault = Path(os.path.expanduser(vault))
        self.tasks = Path(os.path.expanduser(args.tasks_dir)) if args.tasks_dir else self.vault / "Work" / "Tasks"
        raw = args.rollout
        p = Path(os.path.expanduser(raw))
        if not p.exists() and "/" not in raw:
            p = self.tasks / f"{(rr._wikilink_slug(raw) or raw)}.md"
        # Complete moves the note to Archive/Rollouts/ before the last Leg's /thread:close runs, so a gone live note
        # reads its archived copy (file-followup then writes nothing into it; every other writing verb refuses it:
        # begin as done, the rest through ARCHIVE_REFUSED). A note handed over by its own `Archive/Rollouts/` path is
        # the archived copy too, whichever path the caller held.
        self.archived = in_archive(p)
        if not p.exists():
            alt = self.tasks / "Archive" / "Rollouts" / p.name
            if alt.is_file():
                p, self.archived = alt, True
        self.rollout = p
        self.slug = p.stem
        if args.now:
            try:
                now = datetime.fromisoformat(args.now.replace("Z", "+00:00"))
            except ValueError:
                raise Usage(f"--now {args.now!r} is not an ISO time")
            self.now = now if now.tzinfo else now.astimezone()
        else:
            self.now = datetime.now().astimezone()
        self.stamp = rr._stamp(self.now)
        self.date = self.now.astimezone().date().isoformat()
        self.session = (args.session or os.environ.get("CLAUDE_CODE_SESSION_ID") or os.environ.get("CODEX_THREAD_ID")
                        or "unknown").strip() or "unknown"
        if args.harness:
            self.harness = args.harness
        elif os.environ.get("CODEX_THREAD_ID") and not os.environ.get("CLAUDE_CODE_SESSION_ID"):
            self.harness = "codex"
        else:
            self.harness = "claude"
        self.dry = args.dry_run


def emit(obj):
    print(json.dumps(obj, ensure_ascii=False))


def reason_text(s, cap=110):
    s = re.sub(r"\s+", " ", str(s).replace('"', "'")).strip()
    return s if len(s) <= cap else s[:cap - 1].rstrip() + "…"


def status_line(slug, prog, state, reason=None):
    line = f"ROLLOUT-STATUS: {slug} merged={prog['done']}/{prog['total']} running={prog['running']} state={state}"
    return line + (f' reason="{reason_text(reason, 300)}"' if reason else "")


# ---- the lock and atomic writes --------------------------------------------------------------------------------

def lock_timeout():
    """$THREAD_LEG_LOCK_TIMEOUT seconds (default 30), the rollout lock's and each repo land lock's wait."""
    try:
        return float(os.environ.get("THREAD_LEG_LOCK_TIMEOUT") or "30")
    except ValueError:
        return 30.0


def security_budget():
    """$THREAD_LEG_SECURITY_BUDGET seconds (default SECURITY_BUDGET, 420): `security`'s one deadline for its scratch
    trees, its scans and settle_pushed's ls-remote."""
    try:
        return float(os.environ.get("THREAD_LEG_SECURITY_BUDGET") or SECURITY_BUDGET)
    except ValueError:
        return float(SECURITY_BUDGET)


def security_floor():
    """$THREAD_LEG_SECURITY_FLOOR seconds (default SCAN_FLOOR, 20): what must be left of the budget for `security` to
    start a top's scan; less is `unscanned`, never a scan cut at once."""
    try:
        return float(os.environ.get("THREAD_LEG_SECURITY_FLOOR") or SCAN_FLOOR)
    except ValueError:
        return float(SCAN_FLOOR)


def within(deadline, cap=None):
    """The timeout of a call `security` holds inside its deadline: deadline - now, at most cap; None when under 1 s is
    left, and the caller then never starts the call, so none of them runs past the deadline."""
    left = deadline - time.monotonic()
    if left < 1:
        return None
    return left if cap is None else min(cap, left)


def ran_out(budget):
    """The words a call `security` could not start inside its deadline reads with (within)."""
    return f"the Security check's {budget:g} s budget ran out"


class Lock:
    def __init__(self, ctx):
        d = os.environ.get("THREAD_LEG_LOCK_DIR") or os.path.join(
            os.environ.get("XDG_STATE_HOME") or os.path.expanduser("~/.local/state"), "thread", "legs")
        self.path = os.path.join(os.path.expanduser(d), f"{ctx.slug}.lock")
        self.fd = None
        self.skip = ctx.dry
        self.what = "rollout note locked: another Leg verb"

    def __enter__(self):
        if self.skip:
            return self
        timeout = lock_timeout()
        os.makedirs(os.path.dirname(self.path), exist_ok=True)
        self.fd = os.open(self.path, os.O_RDWR | os.O_CREAT, 0o644)
        deadline = time.monotonic() + timeout
        while True:
            try:
                fcntl.flock(self.fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                return self
            except OSError:
                if time.monotonic() >= deadline:
                    os.close(self.fd)
                    self.fd = None
                    raise Refuse(5, f"{self.what} held {self.path} past {timeout:g}s; "
                                    "nothing written (retry once, then end the turn halted)")
                time.sleep(0.05)

    def __exit__(self, *exc):
        if self.fd is not None:
            os.close(self.fd)  # closing the descriptor is the release (verify-slot.py's rule: never an unlock call)
        return False


def atomic_write(path, text):
    path = Path(path)
    tmp = path.with_name(f".{path.name}.leg-{os.getpid()}.tmp")
    try:
        with open(tmp, "w") as f:
            f.write(text)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    finally:
        if tmp.exists():
            tmp.unlink()


def save(ctx, note):
    if ctx.dry or not note.dirty:
        return
    try:
        note.save()   # under the note's lock, re-applied to a fresh read, renamed into place (Note.save)
    except OSError as e:
        raise Refuse(5, f"cannot write {note.path}: {e}; nothing written: run it again")
    note.dirty = False


# ---- the chain ---------------------------------------------------------------------------------------------------

def split_cells(line):
    cells, cur, i = [], "", 0
    while i < len(line):
        ch = line[i]
        if ch == "\\" and i + 1 < len(line) and line[i + 1] == "|":
            cur += "\\|"
            i += 2
            continue
        if ch == "|":
            cells.append(cur)
            cur = ""
        else:
            cur += ch
        i += 1
    cells.append(cur)
    return [c.strip() for c in cells[1:-1]] if line.strip().startswith("|") else []


def _cells_slug(cells):
    """The task slug a Queue row's cells link, else None."""
    m = LINK_RE.search(cells[1] if len(cells) > 1 else "")
    return rr._wikilink_slug(m.group(1)) if m else None


class Row:
    def __init__(self, i, cells, line_no):
        self.i, self.line_no = i, line_no
        self.cells = cells
        self.slug = _cells_slug(cells)
        lm = LAUNCH_RE.match(cells[2]) if len(cells) > 2 else None
        self.alias, self.folder = (lm.group(1), lm.group(2)) if lm else (None, None)
        self.surfaces_cell = cells[3] if len(cells) > 3 else ""
        self.surfaces = re.findall(r"`([^`]+)`", self.surfaces_cell)
        self.path = self.note = None
        self.state = None  # done | queued | running | set-aside | missing | deferred | other

    @property
    def launch(self):
        return f"{self.alias} from {self.folder}"

    def same_launch(self, alias, folder):
        return self.alias == alias and _fold(self.folder or "") == _fold(folder or "")


def real_gates(gates):
    """The declared gates minus an exact `None`, which declares no gate (the engine's parseGatedInputs reads it so)."""
    return [g for g in gates if not NONE_GATE_RE.match(rr._norm_gate(g))]


def owner_leg(note):
    m = re.fullmatch(r"leg-(\d+)", rr._scalar(note.get("owner")))
    return int(m.group(1)) if m else None


class Chain:
    def __init__(self, ctx):
        self.ctx = ctx
        if not ctx.rollout.is_file():
            raise Refuse(1, f"rollout note not found at {ctx.rollout}")
        try:
            self.note = rr.Note(ctx.rollout)
        except ValueError as e:
            raise Refuse(1, str(e))
        self.linked, self.index = rr._scan(ctx.rollout, ctx.tasks)
        self.linked_keys = {p.stem.lower(): (p, n) for p, n in self.linked}
        self.rows = self._rows()
        self.log = self._log()
        self.legs = self._legs()
        self.contend = {}   # rank_contention's read (ADR 0067 d9); set only by the ctx-level verbs, read by plan_next

    # -- the Queue --
    def _rows(self):
        found = self.note._section_bounds(QUEUE)
        rows = []
        if found is None:
            return rows
        lines, start, end = found
        for k in range(start + 1, end):
            cells = split_cells(lines[k])
            if len(cells) < 3 or not LINK_RE.search(cells[1]):
                continue
            r = Row(len(rows), cells, k)
            if not r.slug:
                continue
            rows.append(r)
            entry = self.linked_keys.get(r.slug.lower())
            if entry is None:
                other = self.index.get(r.slug.lower())
                r.state = "deferred" if other is not None else "missing"
                if other is not None:
                    r.path, r.note = other
                continue
            r.path, r.note = entry
            st = rr._status(r.note)
            if st == "done":
                r.state = "done"
            elif st in ("", "open"):
                r.state = "queued"
            elif st == "in_progress":
                r.state = "running"
            elif st in SET_ASIDE:
                r.state = "set-aside"
            else:
                r.state = "other"
        return rows

    def counted(self):
        """The rows K/N count: every row but one deferred out of the chain, or folded or dropped (status other)."""
        return [r for r in self.rows if r.state not in ("deferred", "other")]

    def row(self, slug):
        for r in self.rows:
            if r.slug.lower() == slug.lower():
                return r
        return None

    # -- the Leg log --
    def _log(self):
        return parse_log(self.note)

    def _legs(self):
        return parse_legs(self.log)

    def open_leg(self):
        live = [n for n, g in self.legs.items() if g["began"] and g["closed"] is None]
        return self.legs[max(live)] if live else None

    def last_n(self):
        return max(self.legs) if self.legs else 0

    def halt(self):
        """The standing halt's reason, or None: the last `closed: halted:` line with no `halt cleared:` after it."""
        last = None
        for e in self.log:
            if e["kind"] == "closed" and e["rest"].split(":", 1)[1].strip().startswith("halted:"):
                last = e
            elif e["kind"] == "halt cleared":
                last = None
        if last is None:
            return None
        return last["rest"].split(":", 1)[1].strip()[len("halted:"):].strip(), last["n"]

    # -- derived --
    def progress(self, leg_n=None):
        rows = self.counted()
        running = 0
        if leg_n is not None:
            running = int(any(r.state == "running" and owner_leg(r.note) == leg_n for r in rows if r.note))
        return {"done": sum(r.state == "done" for r in rows), "total": len(rows), "running": running}

    def fixes(self):
        """(fix row, its verifies: slug) for every row whose note has `verifies:`."""
        out = []
        for r in self.rows:
            if r.note is not None and r.state != "deferred":
                v = rr._wikilink_slug(rr._scalar(r.note.get("verifies")))
                if v:
                    out.append((r, v))
        return out

    def fix_notes(self):
        """(path, note, verifies) for every linked note with `verifies:`, row or not."""
        out = []
        for p, n in self.linked:
            v = rr._wikilink_slug(rr._scalar(n.get("verifies")))
            if v:
                out.append((p, n, v))
        return out

    def open_fix_for(self, slug):
        for p, n, v in self.fix_notes():
            if v.lower() == slug.lower() and rr._status(n) != "done":
                return p.stem
        return None

    def chain_tops(self):
        tops = []
        for r in self.rows:
            if r.note is None or r.state == "deferred":
                continue
            for top, _sha in leg_base(r.note):
                if top not in tops:
                    tops.append(top)
        vault = os.path.realpath(self.ctx.vault)
        return [t for t in tops if t != vault]


KINDS = ("began:", "resumed:", "smoke:", "filed ", "claimed ", "took ", "done ", "set aside ", "reverted ", "closed:",
         "hand-over:", "follow-on ", "land:", "land stood:", "land verified:", "rank wait:", "rank retry:")


def parse_log(note):
    """The `## Leg log` lines, in write order: {pos, n (None for `halt cleared` and `restart`), stamp, rest, kind,
    slug}; a `restart` line adds {leg, how, session, started, manual}. A line of no known form is skipped."""
    found = note._section_bounds(LEG_LOG)
    out = []
    if found is None:
        return out
    lines, start, end = found
    for pos, line in enumerate(lines[start + 1:end]):
        m = LOG_RE.match(line.rstrip())
        if m:
            rest = m.group("rest")
            kind = next((k.rstrip(": ") for k in KINDS if rest.startswith(k)), None)
            if kind is None:
                continue
            lm = LINK_RE.search(rest)
            out.append({"pos": pos, "n": int(m.group("n")), "stamp": m.group("stamp"), "rest": rest, "kind": kind,
                        "slug": rr._wikilink_slug(lm.group(1)) if lm else None})
            continue
        c = CLEARED_RE.match(line.rstrip())
        if c:
            out.append({"pos": pos, "n": None, "stamp": c.group("stamp"), "rest": c.group("reason"),
                        "kind": "halt cleared", "slug": None})
            continue
        r = RESTART_RE.match(line.rstrip())
        if r:
            how = r.group(3).split(" ", 1)[0]
            out.append({"pos": pos, "n": None, "stamp": r.group(1), "rest": r.group(3), "kind": "restart", "slug": None,
                        "leg": int(r.group(2)), "how": how, "session": r.group(4), "started": r.group(5),
                        "manual": r.group(6)})
    return out


def standing_restart(log):
    """The standing restart (the module docstring's `restarted`): the latest `restart:` line with no `began` line
    after it, as {leg, how, started, manual, session, at}, else None."""
    cur = None
    for e in log:
        if e["kind"] == "restart":
            cur = e
        elif e["kind"] == "began":
            cur = None
    if cur is None:
        return None
    return {"leg": cur["leg"], "how": cur["how"], "started": cur["started"], "manual": cur["manual"],
            "session": cur["session"], "at": cur["stamp"]}


def parse_legs(log):
    """Leg number -> {n, began, session (the latest began or resumed id), alias, folder, closed, closedStamp,
    handover, tookOver}."""
    legs = {}
    for e in log:
        if e["n"] is None:
            continue
        leg = legs.setdefault(e["n"], {"n": e["n"], "began": None, "session": None, "alias": None, "folder": None,
                                      "closed": None, "closedStamp": None, "handover": None, "tookOver": None})
        if e["kind"] == "began":
            m = BEGAN_RE.match(e["rest"])
            if m:
                leg.update(began=e["stamp"], session=m.group(2), alias=m.group(3), folder=m.group(4),
                           tookOver=int(m.group(5)) if m.group(5) else None)
        elif e["kind"] == "resumed":
            leg["session"] = e["rest"].split("session", 1)[-1].strip()
        elif e["kind"] == "closed":
            leg["closed"] = e["rest"].split(":", 1)[1].strip()
            leg["closedStamp"] = e["stamp"]
        elif e["kind"] == "hand-over":
            leg["handover"] = e["rest"].split(":", 1)[1].strip()
    return legs


def leg_base(note):
    """[(top, sha)] from the task's `leg_base:` (claim's stamp), through reconcile-rollout.py's one parser of it and of
    done's `leg_head:` (_leg_tops), which a serial chain's completion verify reads (ADR 0055)."""
    return rr._leg_tops(note, "leg_base")


def verify_line(note):
    m = VERIFY_RE.findall(note._body) if note is not None else []
    return m[-1].strip() if m else None


# ---- next ---------------------------------------------------------------------------------------------------------

def holds_of(chain, r):
    """Why next holds row r ([] when it is free): a dependency (depends-on/blocked-by) that is not done, or a done one
    with a not-done fix."""
    why = []
    for dep in rr._dep_entries(r.note):
        ok, w = rr._dep_status(dep, chain.index)
        if not ok:
            why.append(f"depends on [[{dep}]] ({w})")
        else:
            f = chain.open_fix_for(dep)
            if f:
                why.append(f"depends on [[{dep}]] (awaiting fix [[{f}]])")
    return why


def plan_next(chain, leg_n, alias, folder, cap=True, launch=True, dead=()):
    """The Leg's next act (the module docstring's `next`). `dead`: Legs to read as closed (a take-over's). Pure: the rank
    (ADR 0067 d9) is chain.contend, rank_contention's read, which only the ctx-level verbs set ({} reads none)."""
    contend = getattr(chain, "contend", None) or {}
    rank_held, standing = contend.get("held") or {}, contend.get("standing") or {}
    dies = {"live": None, "dead": None}
    held, aside, inherited = [], [], []
    for r in chain.rows:
        if r.state == "running" and r.note is not None:
            k = owner_leg(r.note)
            if k is not None and leg_n is not None and k == leg_n:
                return {"action": "finish", "task": r.slug, "inherit": False, "row": r}
            g = chain.legs.get(k) if k is not None else None
            if k is not None and (g is None or g["closed"] is not None or k in dead):
                inherited.append(r)
        if r.state == "set-aside":
            aside.append({"slug": r.slug, "status": rr._status(r.note)})
    if inherited:
        r = inherited[0]
        return {"action": "finish", "task": r.slug, "inherit": True, "from": owner_leg(r.note), "row": r,
                "held": held, "setAside": aside}
    # Distinct tasks: a task set aside at a gate or handed back, then re-claimed in this Leg, is one fresh claim.
    claims = len({e["slug"].lower() for e in chain.log
                  if e["n"] == leg_n and e["kind"] == "claimed" and e["slug"]}) if leg_n else 0

    def claimable(r):
        if r.note is None or r.state not in ("queued", "running"):
            return False
        return r.state == "queued" or not rr._valued(r.note.get("owner"))

    def choose(cands):
        for r in cands:
            if r.state == "missing":
                held.append({"slug": r.slug, "why": "note not found"})
                continue
            if not claimable(r):
                if r.state == "running" and r.note is not None and owner_leg(r.note) is None:
                    held.append({"slug": r.slug, "why": f"in progress ({rr._scalar(r.note.get('owner'))})"})
                continue
            why = holds_of(chain, r)
            if why:
                held.append({"slug": r.slug, "why": "; ".join(why)})
                continue
            h = rank_held.get(r.slug.lower())
            if h is not None and h["kind"] == "die":
                # A lower-ranked claim sets the row aside to retry later, keeping its rank (ADR 0067 d9).
                held.append({"slug": r.slug, "why": h["why"]})
                k = "dead" if h["dead"] else "live"
                dies[k] = dies[k] or (r, h)
                continue
            if h is not None:
                marked.append(h)   # a higher-ranked claim waits on its row, then goes first
            return r
        return None

    def waiting(kind, r, h, lands=None):
        age = (standing.get(r.slug.lower()) or {}).get("age", 0)
        return {"action": "wait", "task": r.slug, "row": r, "kind": kind, "on": h["on"], "token": h["token"],
                "why": h["why"], "landFirst": list(h.get("landFirst") or []),
                "stalled": bool(h.get("dead")) or age > RANK_WAIT_MAX_MINUTES, "lands": list(lands or []), **base}

    marked = []
    fix_rows = [r for r, _v in chain.fixes()]
    pick = choose(fix_rows)
    is_fix = pick is not None
    if pick is None:
        pick = choose([r for r in chain.rows if r not in fix_rows])
    base = {"held": held, "setAside": aside, "claims": claims}
    if pick is not None:
        if cap and leg_n is not None and claims >= CAP:
            return {"action": "handoff", "reason": f"{CAP} fresh claims", "row": pick, **base}
        if launch and alias is not None and not pick.same_launch(alias, folder):
            return {"action": "handoff", "reason": "Leg boundary: the next row opens in another launch", "row": pick,
                    **base}
        land = contend.get("land")
        if land:
            # (H): an earlier chain is landing work this chain's own unlanded row meets: land after it, then claim.
            why = (f"rank: [[{land['on']}]] ranks above and is landing {', '.join(f'[[{s}]]' for s in land['rows'])} "
                   f"on {land['token']}: this chain lands [[{land['task']}]] after it, then claims")
            return waiting("land", pick, {"on": land["on"], "token": land["token"], "why": why}, land["lands"])
        if marked:
            return dict(waiting("wait", pick, marked[-1]), fix=is_fix)
        return {"action": "claim", "task": pick.slug, "fix": is_fix, "row": pick, **base}
    if dies["live"] is not None:
        return waiting("retry", *dies["live"])
    if dies["dead"] is not None:
        return waiting("retry", *dies["dead"])
    counted = chain.counted()
    if counted and all(r.state == "done" for r in counted):
        return {"action": "complete", **base}
    return {"action": "stuck", **base}


def next_json(plan):
    out = {k: v for k, v in plan.items() if k != "row"}
    r = plan.get("row")
    if r is not None:
        out["next"] = {"task": r.slug, "alias": r.alias, "folder": r.folder}
    return out


# ---- the Capacity and the Leg lease (p36-7, ADR 0067 d8; execute away.md § Capacity) --------------------------

CAPACITY_WAIT_REFRESH = 600   # a capacity wait re-records its waiting record and renews its lease this often (s)


def leg_lease(ctx, leg, waiting=False, strict=False):
    """Write this Leg's lease (the module docstring's *The Leg lease*): rr._lease_write(<rollout>, now, "leg"), with
    `waiting: true` from `next --waiting`, off --dry-run, only for an open Leg (`leg`, my_leg's or the chain's). strict
    (`next`'s rule): only when this session is the Leg's own, both ids known and equal, so an `unknown` caller never
    renews a dead Leg. Best-effort: a write that fails prints rr's one `lease: warning:` line."""
    if ctx.dry or leg is None or leg.get("closed") is not None:
        return
    if strict and (ctx.session == "unknown" or leg.get("session") in (None, "unknown") or leg["session"] != ctx.session):
        return
    rr._lease_write(ctx.slug, ctx.now, "leg", waiting=waiting)


def leg_mine(chain):
    """This chain's own count on the Mac (rr._leg_tasks' rows): its rows in progress owned `leg-<n>`."""
    return sum(1 for r in chain.rows if r.state == "running" and r.note is not None and owner_leg(r.note) is not None)


def leg_gate(ctx, chain, plan, quota=True):
    """(plan, gate): a `claim` plan (a fix task's included) held by the Capacity becomes a `wait` of kind `capacity` or
    `quota` (rr.capacity_gate, read-only and lock-free): {action: wait, kind, task, row, why (the hold's prefix line),
    on: null, token: null, landFirst: [], stalled: false, lands: [], capacity, fix, held, setAside, claims}. Every other
    plan passes untouched, and so does a claim while Capacity is not in force (gate None for a plan it never reads).
    quota: the caller's own Login is read (next, begin, wait); False reads the Capacity alone (status)."""
    if plan.get("action") != "claim":
        return plan, None
    g = rr.capacity_gate(ctx.rollout, ctx.tasks, ctx.now, leg_mine(chain), 1,
                         quota_env=os.environ if quota else None)
    if not g["held"]:
        return plan, g
    r = plan["row"]
    held = {"action": "wait", "task": r.slug, "row": r, "kind": g["kind"], "on": None, "token": None, "why": g["why"],
            "landFirst": [], "stalled": False, "lands": [], "capacity": g["capacity"], "fix": bool(plan.get("fix")),
            **{k: plan[k] for k in ("held", "setAside", "claims") if k in plan}}
    return held, g


# ---- the log writer -----------------------------------------------------------------------------------------------

def log_line(note, line):
    note.apply(_log_line, line)   # journaled, so Note.save re-applies it to a note another writer changed


def _log_line(note, line):
    found = note._section_bounds(LEG_LOG)
    if found is None:
        note.append_section(LEG_LOG, line)
        return
    lines, start, end = found
    filled = [i for i in range(start + 1, end) if lines[i].strip()]
    j = (filled[-1] + 1) if filled else start + 1
    if not filled:
        note._set_body_lines(lines[:start + 1] + ["", line, ""] + lines[end:])
        return
    tail = [""] if j == len(lines) or lines[j].strip() else []
    note._set_body_lines(lines[:j] + [line] + tail + lines[j:])


def leg_line(ctx, n, text):
    return f"- {ctx.stamp} Leg {n} {text}"


# ---- the leg's identity -------------------------------------------------------------------------------------------

def my_leg(ctx, chain, closed_ok=False):
    leg = chain.open_leg()
    if leg is None:
        if closed_ok and chain.legs:
            return chain.legs[chain.last_n()]
        raise Refuse(1, "no Leg has begun (or every Leg is closed): run `leg.py begin` first")
    if ctx.session != "unknown" and leg["session"] not in (None, "unknown") and leg["session"] != ctx.session:
        raise Refuse(1, f"Leg {leg['n']} belongs to session {leg['session']}, not {ctx.session}: "
                        "begin a Leg of your own (`leg.py begin`)")
    return leg


def validate_note(ctx, chain):
    note = chain.note
    if rr._shape(note) != "serial":
        raise Refuse(1, f"{ctx.slug} is not a serial rollout (shape: {rr._scalar(note.get('shape')) or 'parallel'}): "
                        "run it with /thread:execute's queue", reason="not a serial rollout")
    if rr._truthy_flag(note.get("incomplete")):
        raise Refuse(1, f"{ctx.slug} is incomplete (incomplete: true): /thread:schedule never finished it; stamp it "
                        "`status: dropped` to free its tasks", reason="incomplete rollout note")
    why = rr.incomplete(ctx.rollout, note, chain.linked, chain.index)
    if why:
        raise Refuse(1, f"{ctx.slug} is incomplete: {why}", reason="incomplete rollout note")
    st = rr._status(note)
    if st == "dropped" or rr._valued(note.get("superseded_by")):
        word = "dropped" if st == "dropped" else "superseded"
        raise Refuse(1, f"{ctx.slug} is {word}: nothing runs it", reason=f"rollout {word}")
    if st == "done":
        raise Refuse(1, f"{ctx.slug} is done: its chain is complete", reason="chain already complete")
    if rr._valued(note.get("paused")) or rr._truthy_flag(note.get("pause_requested")):
        raise Refuse(1, f"a serial note is never paused: delete its paused: (and pause_requested:) line, then "
                        f"/thread:execute [[{ctx.slug}]]", reason="a serial note is never paused")


def plugin_origin():
    try:
        data = json.loads(PLUGIN_JSON.read_text())
        repo = data.get("repository") if isinstance(data, dict) else None
        if isinstance(repo, dict):
            repo = repo.get("url")
        return sc.norm_origin(repo.strip()) if isinstance(repo, str) and repo.strip() else None
    except (OSError, ValueError):
        return None


def leg_prompt(ctx, n):
    return (f"/thread:execute [[{ctx.slug}]]\nLeg {n} of the serial chain; the brief is the rollout note's "
            f"## Leg log: {os.path.realpath(ctx.rollout)}")


def leg_title(ctx, n):
    title = f"Leg {n}: {ctx.slug}"
    return title if len(title) <= 60 else title[:59].rstrip("-") + "…"


def launch_harness(alias):
    return "codex" if (alias or "").startswith("cx-") else "claude"


# ---- Chain copies (ADR 0067 d2) -------------------------------------------------------------------------------------

def alias_tail(alias):
    """The command a generated launch alias runs after its own `cd` (`alias <a>='cd <dir> && <tail>'` in
    $THREAD_LAUNCH_ALIASES, else DEFAULT_ALIASES), its whole command when it has no `cd` (`alias <a>='<cmd>'`, as
    `cc-steph`), or None when that file or line cannot be read."""
    path = os.environ.get("THREAD_LAUNCH_ALIASES") or DEFAULT_ALIASES
    try:
        text = Path(os.path.expanduser(path)).read_text()
    except (OSError, UnicodeDecodeError):
        return None
    m = re.search(rf"^alias {re.escape(alias)}='(?:cd \S+ && )?(.*)'$", text, re.M)
    return m.group(1) if m and m.group(1) else None


def launch_line(alias, folder, copy=None):
    """A row's launch line: `<alias> from <folder>` in place. In a Chain copy (copy: the folder inside it) the alias's
    own `cd` opens the primary, so the line is paste-ready `cd <copy> && <the alias's command after its cd>` (its whole
    command when it has no `cd`; `claude` and `codex` themselves), or, when that command cannot be read, prose that says
    never to run the alias itself.
    Uses no serial-chains.py: estate-dispatch.py loads this file without it."""
    if copy is None:
        return f"{alias} from {folder}"
    q = shlex.quote(copy)
    if alias in ("claude", "codex"):
        return f"cd {q} && {alias}"
    tail = alias_tail(alias) if alias else None
    if tail is not None:
        return f"cd {q} && {tail}"
    return (f"{alias} from {copy}: cd there, then run {alias}'s command without its cd (`alias {alias}` prints it); "
            f"never {alias} itself, since {alias} itself opens {folder}")


def chain_launch(pairs, alias, folder):
    """A Queue row's launch line in its chain: launch_line with the row's folder mapped into its Chain copy."""
    copy = sc.copy_folder(folder, pairs) if pairs and folder else None
    return launch_line(alias, folder, copy)


def copies_read(chain):
    """The note's `chain_copies:` as (pairs, None): pairs None when the key is absent (the chain works in place); or
    (None, why) when it is malformed."""
    try:
        return sc.read_chain_copies(chain.note), None
    except ValueError as e:
        return None, str(e)


def chain_pairs(chain):
    """copies_read's pairs, or Refuse(1) when `chain_copies:` is malformed."""
    pairs, why = copies_read(chain)
    if why:
        raise Refuse(1, f"chain_copies: {why}: fix the note; nothing written", reason=f"chain_copies: {why}")
    return pairs


def _pair(pairs, path, side=0):
    """The (checkout, copy) pair whose checkout (side 0) or copy (side 1) is path, case-folded, else None."""
    k = os.path.normpath(path).casefold()
    return next(((c, p) for c, p in pairs or [] if (c, p)[side].casefold() == k), None)


def copy_dir(make=True):
    """Where Chain copies live: $THREAD_CHAIN_COPY_DIR (absolute), else ${XDG_STATE_HOME:-~/.local/state}/thread/chains,
    realpath'd, and created when make. Refuse(1) at or under ~/repos or ~/Projects, which every thread walk, rollout-clone
    prefilter, daily-sweep discovery and worktree reaper reads."""
    raw = os.path.expanduser(os.environ.get("THREAD_CHAIN_COPY_DIR") or "")
    if not os.path.isabs(raw):
        raw = os.path.join(os.environ.get("XDG_STATE_HOME") or os.path.expanduser("~/.local/state"), "thread", "chains")
    d = os.path.realpath(raw)
    for walk in ("~/repos", "~/Projects"):
        w = os.path.realpath(os.path.expanduser(walk)).casefold()
        if d.casefold() == w or d.casefold().startswith(w.rstrip("/") + "/"):
            raise Refuse(1, f"the Chain copy dir {d} is at or under {walk}, which every thread walk and worktree reaper "
                            "reads: set THREAD_CHAIN_COPY_DIR outside ~/repos and ~/Projects; nothing written")
    if make:
        os.makedirs(d, exist_ok=True)
    return d


def default_branch(top):
    """A checkout's local default branch, the name d with refs/heads/<d>: origin/HEAD's name first, then main, then
    master, else None (structure-audit's default_base rule, local refs only)."""
    cands = []
    head = git_out(top, "symbolic-ref", "-q", "refs/remotes/origin/HEAD")
    if head and head.startswith("refs/remotes/origin/"):
        cands.append(head[len("refs/remotes/origin/"):])
    for d in cands + ["main", "master"]:
        if git(top, "show-ref", "--verify", "-q", f"refs/heads/{d}").returncode == 0:
            return d
    return None


def _common(top):
    c = git_out(top, "rev-parse", "--path-format=absolute", "--git-common-dir")
    return os.path.realpath(c) if c else None


def wanted_checkouts(ctx, chain, warns):
    """The checkouts a chain copies: serial-chains.py's checkouts_of over the note's `surfaces:`, every Queue row's
    cell tokens and every row's launch folder (the vault excluded), each kept when it is its own git toplevel; any other
    entry is no checkout's index, so it gets no copy, with a WARN."""
    toks = list(sc.read_surfaces(chain.note))
    for r in chain.rows:
        toks += r.surfaces
    out = []
    for e in sc.checkouts_of(toks, [r.folder for r in chain.rows if r.folder], toplevel, os.path.realpath(ctx.vault)):
        p = os.path.realpath(os.path.expanduser(e))
        top = toplevel(p)
        if top == p:
            if p not in out:
                out.append(p)
            continue
        w = (f"WARN: {e} is in no git checkout: no Chain copy (it is no checkout's index)" if top is None else
             f"WARN: {e} is inside {top}, not its toplevel: no Chain copy of its own (it is no checkout's index)")
        if w not in warns:
            warns.append(w)
    return out


def _worktree_branches(top):
    """[(path, branch ref or None)] of a checkout's worktrees (`git worktree list --porcelain`)."""
    out, cur = [], None
    for line in (git_out(top, "worktree", "list", "--porcelain") or "").split("\n") + [""]:
        if line.startswith("worktree "):
            cur = [line[len("worktree "):], None]
        elif line.startswith("branch ") and cur is not None:
            cur[1] = line[len("branch "):]
        elif not line and cur is not None:
            out.append(tuple(cur))
            cur = None
    return out


def _copy_state(P, C, branch):
    """'ok' when C is a worktree of P on branch, 'missing' when there is nothing at C; Refuse(1) otherwise, or when the
    branch is checked out in another worktree."""
    ref = f"refs/heads/{branch}"
    if os.path.lexists(C):
        top = toplevel(C)
        if top != os.path.realpath(C) or _common(C) != _common(P) or git_out(C, "symbolic-ref", "-q", "HEAD") != ref:
            raise Refuse(1, f"{C} exists and is not {P}'s Chain copy on {branch}: move it aside (the next begin remakes "
                            "the copy there), then run again; nothing written")
        return "ok"
    for wt, br in _worktree_branches(P):
        if br == ref and os.path.isdir(wt) and os.path.realpath(wt) != os.path.realpath(C):
            raise Refuse(1, f"{branch} is checked out in {wt}, not in its Chain copy {C}: check it out elsewhere there, "
                            "then run again; nothing written")
    return "missing"


def _make_copy(P, C, branch, warns):
    """git worktree add of C on branch: the existing branch (a remake keeps its commits), else a new one cut from the
    primary's default branch, else from its HEAD with a WARN. Returns the base it was cut from (None for a remake)."""
    git(P, "worktree", "prune")   # a stale admin entry for C (its directory deleted) would refuse the add
    if git(P, "show-ref", "--verify", "-q", f"refs/heads/{branch}").returncode == 0:
        r, base = git(P, "-c", "core.hooksPath=/dev/null", "worktree", "add", "-q", C, branch), None
    else:
        d = default_branch(P)
        if d:
            start, base = f"refs/heads/{d}", d
        else:
            cur = git_out(P, "symbolic-ref", "-q", "--short", "HEAD") or "detached"
            warns.append(f"WARN: {P}: no default branch resolved: its Chain copy is cut from HEAD ({cur}) and begin "
                         "never fast-forwards it")
            start, base = "HEAD", "HEAD"
        r = git(P, "-c", "core.hooksPath=/dev/null", "worktree", "add", "-q", "-b", branch, C, start)
    if r.returncode != 0:
        raise Refuse(1, f"git worktree add {C} failed in {P}: {(r.stderr or r.stdout).strip()[:200]}; the note is "
                        "unwritten: fix it, then run again")
    return base


def link_configs(P, C, rels, make=True):
    """Symlink each CONFIG_LINKS file at each rel (the copy's toplevel, "", and each Queue launch folder inside it) from
    the primary into the copy, when the primary has it, the copy lacks it and git ignores it there (a tracked or
    un-ignored file is the copy's own); each launch folder is made in the copy. The rels linked, in order."""
    linked = []
    for rel in rels:
        if make and rel:
            try:
                os.makedirs(os.path.join(C, rel), exist_ok=True)
            except OSError:
                pass
        for f in CONFIG_LINKS:
            rf = posixpath.join(rel, f) if rel else f
            src, dst = os.path.join(P, rf), os.path.join(C, rf)
            if not os.path.isfile(src) or os.path.lexists(dst):
                continue
            if git(P, "check-ignore", "-q", "--", rf).returncode != 0:
                continue
            if make:
                os.makedirs(os.path.dirname(dst), exist_ok=True)
                os.symlink(src, dst)
            linked.append(rf)
    return linked


def ensure_copies(ctx, chain):
    """The chain's Chain copies (the caller holds the rollout lock): each wanted checkout's recorded pair, or a new one
    (copy_name), made when missing (a remake keeps its branch's commits), its config linked, and the note's
    `chain_copies:` stamped after `shape:` when its pairs changed, recorded pairs kept. --dry-run makes and writes
    nothing. Returns (copies, pairs, stamped, warns), copies one {checkout, copy, branch, base, made, linked} per wanted
    checkout. Refuse(1), the note unwritten: a malformed `chain_copies:`, the copy dir under ~/repos or ~/Projects, two
    entries of one repository, this plugin's own checkout (ruling (c)), a copy path held by something else, the branch
    checked out in another worktree, a git failure."""
    make = not ctx.dry
    warns = []
    recorded = chain_pairs(chain)
    pairs = list(recorded or [])
    wanted = wanted_checkouts(ctx, chain, warns)
    branch = f"chain/{ctx.slug}"
    commons, own = {}, plugin_origin()
    for P in wanted:
        cd = _common(P) or P
        if cd in commons:
            raise Refuse(1, f"{commons[cd]} and {P} are one repository (git common dir {cd}): a chain copies a "
                            "repository once, from its primary checkout; nothing written")
        commons[cd] = P
        url = git_out(P, "remote", "get-url", "origin")
        if own and url and sc.norm_origin(url) == own:
            raise Refuse(1, f"{P} is this plugin's own checkout: there are no serial self-rollouts (ADR 0040); "
                            "nothing written")
    root, plan = None, []
    for P in wanted:
        hit = _pair(pairs, P)
        if hit is None:
            root = root or copy_dir(make)
            hit = (P, os.path.join(root, sc.copy_name(P, ctx.slug, pairs)))
            pairs.append(hit)
        plan.append((P, hit[1], _copy_state(P, hit[1], branch)))
    copies = []
    for P, C, state in plan:
        base = _make_copy(P, C, branch, warns) if state == "missing" and make else None
        rels = [""]
        for r in chain.rows:
            m = sc.copy_folder(r.folder, pairs) if r.folder else None
            if m and (m == C or m.startswith(C.rstrip("/") + "/")):
                rel = m[len(C.rstrip("/")):].lstrip("/")
                if rel not in rels:
                    rels.append(rel)
        linked = link_configs(P, C, rels, make) if (make or state == "ok") else []
        copies.append({"checkout": P, "copy": C, "branch": branch, "base": base, "made": state == "missing",
                       "linked": linked})
    stamped = recorded is None or pairs != list(recorded)
    if stamped and make:
        chain.note.set("chain_copies", sc.fmt_chain_copies(pairs), after=("shape",))
        save(ctx, chain.note)
    return copies, pairs, stamped, warns


def fast_forward(ctx, chain, copies, warns):
    """A fresh Leg's (or a take-over's) copies moved up to their primary's default branch d (`merge --ff-only`), so a
    Leg begun days after its schedule starts from today's base, whatever the primary has checked out (the copy's merge
    reads only refs/heads/<d>; leg.py land keeps that branch current): only when d resolves, the chain branch is a
    strict ancestor of d, the copy is clean (tracked files) and no counted row is in progress. Never the primary.
    ({copy: fast-forwarded}, land_first); each skip but an already-current copy, and a failed merge, is a WARN.
    land_first is True, with a WARN, when a copy's chain branch holds commits d lacks (a land that stood at the last
    close: a diverged branch, or one that already holds d through a kept land merge) and no row is in progress: legs.md
    § Begin 0 then runs leg.py land before the first claim, which merges d in and lands them."""
    out, land_first = {}, False
    running = any(r.state == "running" for r in chain.counted())
    for c in copies:
        P, C, br = c["checkout"], c["copy"], c["branch"]
        out[C] = False
        d = default_branch(P)
        if d is None:
            warns.append(f"WARN: {C}: not fast-forwarded: {P} has no default branch resolved")
            continue
        tip = git_out(P, "rev-parse", "-q", "--verify", f"refs/heads/{br}^{{commit}}")
        dsha = git_out(P, "rev-parse", "-q", "--verify", f"refs/heads/{d}^{{commit}}")
        if not tip or not dsha or tip == dsha:
            continue   # already current, or nothing to read
        if is_ancestor(P, dsha, tip):
            # It holds d, and commits d lacks: a land that stood at the last close (its merge kept), never a skip.
            if not running:
                warns.append(f"WARN: {C}: {br} has commits {d} lacks, not yet landed (run leg.py land before the first "
                             "claim)")
                land_first = True
            continue
        why = None
        if running:
            why = "a row is in progress"
        elif not is_ancestor(P, tip, dsha):
            why = f"{br} has commits {d} lacks (run leg.py land before the first claim: it merges {d} in)"
            land_first = True
        else:
            st = git(C, "status", "--porcelain", "--untracked-files=no")
            if st.returncode != 0 or st.stdout.strip():
                why = "the copy has uncommitted changes" if st.returncode == 0 else "its status cannot be read"
        if why is None:
            r = git(C, "merge", "--ff-only", "--no-autostash", "-q", f"refs/heads/{d}")
            if r.returncode == 0:
                out[C] = True
                continue
            why = f"git merge --ff-only failed: {(r.stderr or r.stdout).strip()[:160]}"
        warns.append(f"WARN: {C}: not fast-forwarded to {d}: {why}")
    return out, land_first


# ---- smoke list ---------------------------------------------------------------------------------------------------

def smoke_list(chain, n):
    out, seen = [], set()

    def add(slug, why):
        r = chain.row(slug)
        key = slug.lower()
        if key in seen:
            for e in out:
                if e["task"].lower() == key and why not in e["why"]:
                    e["why"].append(why)
            return
        seen.add(key)
        note = r.note if r is not None else (chain.index.get(key) or (None, None))[1]
        out.append({"task": r.slug if r else slug, "verify": verify_line(note), "why": [why]})

    # Every done task that no Leg after its finisher has smoke-tested: the previous Leg's, and an earlier Leg's
    # whose successor died, stopped or halted before (or part-way through) its smoke test.
    smoked = {}
    for e in chain.log:
        if e["kind"] == "smoke" and e["slug"]:
            smoked.setdefault(e["slug"].lower(), set()).add(e["n"])
    for r in chain.rows:
        k = rr._scalar(r.note.get("leg")) if r.state == "done" and r.note is not None else ""
        if not k.isdigit() or int(k) >= n:
            continue
        k = int(k)
        if not any(m > k for m in smoked.get(r.slug.lower(), ())):
            add(r.slug, f"done by Leg {k}" + ("" if k == n - 1 else ", never smoke-tested since"))
    for _p, fnote, v in chain.fix_notes():
        r = chain.row(v)
        if rr._status(fnote) != "done" and r is not None and r.state == "done":
            add(r.slug, "a not-done fix verifies it")
    latest = {}
    for e in chain.log:
        if e["kind"] == "smoke" and e["slug"]:
            res = e["rest"].split("]]", 1)[-1].strip()
            latest[e["slug"].lower()] = (e["n"], e["pos"], res)
    for key, (ln, _pos, res) in latest.items():
        if not res.startswith("fail"):
            continue
        # The closed link: a fix filed for t10 (or foo-bar) is never one for t1 (or foo).
        filed = any(e["kind"] == "filed" and e["n"] >= ln and f"(verifies [[{key}]]" in e["rest"].lower() for e in chain.log)
        if not filed:
            r = chain.row(key)
            add(r.slug if r else key, f"failed at Leg {ln}'s smoke test, no fix filed")
    order = {r.slug.lower(): r.i for r in chain.rows}
    return sorted(out, key=lambda e: order.get(e["task"].lower(), len(order)))


def launch_mcp(chain, alias, folder):
    req = []
    for r in chain.rows:
        if r.note is None or r.state == "done" or not r.same_launch(alias, folder):
            continue
        for item in sc.required_mcp(r.note.section_text("## Launch")):
            if item not in req:
                req.append(item)
    return req


# ---- verbs ----------------------------------------------------------------------------------------------------------

def cmd_begin(ctx, a):
    cwd = os.path.realpath(os.path.expanduser(a.cwd or os.getcwd()))
    chain = None
    try:
        chain = Chain(ctx)
        validate_note(ctx, chain)
        top = toplevel(cwd)
        own = plugin_origin()
        if top and own:
            url = git_out(top, "remote", "get-url", "origin")
            if url and sc.norm_origin(url) == own:
                raise Refuse(1, f"{top} is this plugin's own checkout: there are no serial self-rollouts (ADR 0040)",
                             reason="the plugin's own checkout")
        # The Security check's preflight (execute § 3 `security_checks`, rr._security_check, at most 30 s) runs here,
        # read-only and before the lock, so it never holds the rollout lock against another verb's wait; its refusal is
        # raised inside the lock after the halt check, so a standing halt still reads exit 3 first.
        raw = rr._scalar(chain.note.get(rr.SECURITY_CHECKS_KEY))
        sec = rr._security_check(chain.note)
        with Lock(ctx):
            chain = Chain(ctx)
            validate_note(ctx, chain)
            return _begin_locked(ctx, a, chain, cwd, raw, sec)
    except Refuse as e:
        if e.code in (1, 3, 4):
            prog = chain.progress() if chain is not None else {"done": 0, "total": 0, "running": 0}
            e.extra.setdefault("status_line", status_line(ctx.slug, prog, "halted", e.extra.get("reason") or e.msg))
        raise


def _begin_locked(ctx, a, chain, cwd, raw=None, sec=(None, None)):
    halt = chain.halt()
    if halt is not None:
        raise Refuse(3, f"halted at Leg {halt[1]}: {halt[0]}; nothing begins until `leg.py clear-halt --reason <why>`",
                     reason=f"halt: {halt[0]}")
    # The Security check's preflight, read before the lock (cmd_begin): a key changed meanwhile, or one it refused,
    # stops every begin (fresh, take-over, --resume, a silent resume and --dry-run) with nothing written.
    refused = f"security_checks refused on [[{ctx.slug}]]"
    if rr._scalar(chain.note.get(rr.SECURITY_CHECKS_KEY)) != (raw or ""):
        raise Refuse(1, "security_checks changed while begin ran: run begin again; nothing written", reason=refused)
    if sec[1]:
        raise Refuse(1, f"security_checks: {sec[1]}: fix or remove the key, or install gitleaks, then /thread:execute "
                        f"[[{ctx.slug}]] again; nothing written", reason=refused)
    security = sec[0]
    open_leg = chain.open_leg()
    took_over = None
    if open_leg is not None:
        k = open_leg["n"]
        if a.resume is not None:
            if a.resume != k:
                raise Refuse(1, f"--resume {a.resume} names the wrong Leg: Leg {k} is the unclosed one")
            if not ctx.dry:
                log_line(chain.note, leg_line(ctx, k, f"resumed: session {ctx.session}"))
                save(ctx, chain.note)
            return begin_out(ctx, Chain(ctx), k, resumed="logged", security=security)
        if ctx.session != "unknown" and open_leg["session"] == ctx.session:
            return begin_out(ctx, chain, k, resumed="silent", security=security)
        if not a.take_over:
            raise Refuse(3, f"Leg {k} (session {open_leg['session']}) is unclosed: if this conversation ran its "
                            f"begin, `leg.py begin --resume {k}`; if that Leg is dead, `leg.py begin --take-over`",
                         reason=f"Leg {k} unclosed: --resume {k} or --take-over")
        took_over = k
    elif a.resume is not None:
        raise Refuse(1, f"--resume {a.resume}: no Leg is unclosed")
    n = (took_over + 1) if took_over is not None else chain.last_n() + 1
    # The surface re-check (ADR 0060 d3): what this Leg writes, against the places other rollouts hold now.
    held, failed = surface_recheck(ctx, chain, n)
    if failed:
        raise Refuse(3, f"surface re-check failed: {failed}; nothing written: fix what it names, then begin again",
                     reason=f"surface re-check failed: {failed}")
    if held:
        b, tok = held[0]["rollout"], held[0]["token"]
        raise Refuse(3, f"surface held: [[{b}]] holds {tok}, which Leg {n} writes; nothing written: this chain waits "
                        f"its turn: begin again once [[{b}]] lands its rows there (/thread:status [[{b}]])",
                     held=held, reason=f"surface held: [[{b}]] holds {tok}")
    # Chain copies (ADR 0067 d2): a missing copy remade and a newly needed one added before the launch check, so an
    # exit 4's line names a folder that exists. A note with no `chain_copies:` works in place, as before.
    pairs, made, copies, warns = chain_pairs(chain), [], [], []
    if pairs is not None:
        made, pairs, _stamped, warns = ensure_copies(ctx, chain)
        copies = [{"checkout": c["checkout"], "copy": c["copy"], "branch": c["branch"], "made": c["made"],
                   "fastForwarded": False} for c in made]
    # The launch check: the first row this Leg must work, in its Chain copy when it has one. It reads the rank's
    # contention-aware plan (ADR 0067 d9), as status's restart does: a `wait` uses its row, so a first row another chain
    # holds, in another launch, is skipped for the row this Leg claims.
    dead = () if took_over is None else (took_over,)
    chain.contend = rank_contention(ctx, chain, n, dead=dead)
    plan = plan_next(chain, n, None, None, cap=False, launch=False, dead=dead)
    row = plan.get("row") if plan["action"] in ("finish", "claim", "wait") else None
    if row is not None:
        need = launch_harness(row.alias)
        where = (sc.copy_folder(row.folder, pairs) if pairs and row.folder else None) or row.folder
        if _fold(where or "") != cwd.casefold() or need != ctx.harness:
            why = (f"wrong launch: [[{row.slug}]] runs as `{row.alias}` from `{where}` ({need}); this session is "
                   f"{ctx.harness} in {cwd}; nothing written to the Leg log, so start Leg {n} there with the prompt "
                   "below")
            raise Refuse(4, why, launch=chain_launch(pairs, row.alias, row.folder), prompt=leg_prompt(ctx, n),
                         reason=f"wrong launch: run Leg {n} as {row.alias} from {where}")
        alias, folder = row.alias, row.folder
    else:
        # A row-less Leg (complete or stuck) logs its primary folder: the Leg log names Queue folders only.
        alias, folder = ctx.harness, (sc.primary_folder(cwd, pairs) if pairs else None) or cwd
    land_first = False
    if copies and not ctx.dry:
        moved, land_first = fast_forward(ctx, chain, made, warns)
        for c in copies:
            c["fastForwarded"] = moved.get(c["copy"], False)
    if not ctx.dry:
        if took_over is not None:
            log_line(chain.note, leg_line(ctx, took_over, f"closed: lost (taken over by Leg {n})"))
        tail = f"; took over from Leg {took_over}" if took_over is not None else ""
        log_line(chain.note, leg_line(ctx, n, f"began: leg-{n} session {ctx.session} in {alias} from {folder}{tail}"))
        save(ctx, chain.note)
        chain = Chain(ctx)
    return begin_out(ctx, chain, n, resumed=False, took_over=took_over, alias=alias, folder=folder, copies=copies,
                     warns=warns, pairs=pairs, land_first=land_first, security=security)


def begin_out(ctx, chain, n, resumed, took_over=None, alias=None, folder=None, copies=None, warns=None, pairs=None,
              land_first=False, security=None):
    g = chain.legs.get(n) or {}
    alias = g.get("alias") or alias
    folder = g.get("folder") or folder
    chain.contend = rank_contention(ctx, chain, n)
    # Every begin that runs the Leg writes its lease (fresh, take-over, --resume, silent resume), before the gate, so the
    # gate reads this session's own place as every other caller does from here on (ADR 0076 d3, p44-2).
    leg_lease(ctx, chain.legs.get(n))
    plan, _g = leg_gate(ctx, chain, plan_next(chain, n, alias, folder))   # the Capacity (p36-7)
    inherited = [r.slug for r in chain.rows if r.state == "running" and r.note is not None
                 and owner_leg(r.note) not in (None, n)
                 and (chain.legs.get(owner_leg(r.note)) is None or chain.legs[owner_leg(r.note)]["closed"] is not None)]
    fixes = [r.slug for r, _v in chain.fixes() if r.state != "done"]
    if copies is None:   # a resume: the recorded copies, as they are
        pairs = copies_read(chain)[0]
        copies = [{"checkout": c, "copy": p, "branch": f"chain/{ctx.slug}", "made": False, "fastForwarded": False}
                  for c, p in pairs or []]
    cwd = (sc.copy_folder(folder, pairs) if pairs and folder else None) or folder
    out = {"verb": "begin", "rollout": ctx.slug, "leg": n, "owner": f"leg-{n}", "session": ctx.session,
           "harness": ctx.harness, "resumed": resumed, "tookOver": took_over,
           "launch": {"alias": alias, "folder": folder}, "cwd": cwd, "copies": copies, "landFirst": bool(land_first),
           "inherited": inherited,
           "smoke": smoke_list(chain, n), "fixes": fixes, "mcp": launch_mcp(chain, alias, folder),
           "next": next_json(plan), "progress": chain.progress(n), "warns": list(warns or []), "dryRun": ctx.dry}
    if security:
        out["securityCheck"] = security   # only when the note sets `security_checks: true` and its preflight passed
    return out


def cmd_copies(ctx, a):
    """`copies`: make the chain's Chain copies and stamp `chain_copies:` (schedule S5; by hand on status's `chain copy
    missing` blocker). Refuses a note that is not serial, done, dropped or superseded; an incomplete one is allowed."""
    with Lock(ctx):
        chain = Chain(ctx)
        note = chain.note
        if rr._shape(note) != "serial":
            raise Refuse(1, f"{ctx.slug} is not a serial rollout (shape: {rr._scalar(note.get('shape')) or 'parallel'}): "
                            "only a serial chain works in Chain copies")
        st = rr._status(note)
        if st == "done":
            raise Refuse(1, f"{ctx.slug} is done: its chain is complete")
        if st == "dropped" or rr._valued(note.get("superseded_by")):
            raise Refuse(1, f"{ctx.slug} is {'dropped' if st == 'dropped' else 'superseded'}: nothing runs it")
        copies, _pairs, stamped, warns = ensure_copies(ctx, chain)
        return {"verb": "copies", "rollout": ctx.slug, "copies": copies, "warns": warns, "stamped": stamped,
                "dryRun": ctx.dry}


def cmd_next(ctx, a):
    if a.waiting is not None and not a.waiting.strip():
        raise Usage("--waiting needs a reason (`review in flight: [[<t>]]`, `room stop: <text>`)")
    chain = Chain(ctx)
    leg = my_leg(ctx, chain)
    chain.contend = rank_contention(ctx, chain, leg["n"])
    plan, g = leg_gate(ctx, chain, plan_next(chain, leg["n"], leg["alias"], leg["folder"]))
    for w in (g or {}).get("warns") or []:
        print(w, file=sys.stderr)
    # The Leg lease (p36-7): only this session's own Leg renews it, never under --dry-run; --waiting holds it 180 min.
    leg_lease(ctx, leg, waiting=a.waiting is not None, strict=True)
    prog = chain.progress(leg["n"])
    out = {"verb": "next", "rollout": ctx.slug, "leg": leg["n"], **next_json(plan), "progress": prog}
    if a.waiting is not None:
        out["status_line"] = status_line(ctx.slug, prog, "waiting", a.waiting)
    return out


def cmd_wait(ctx, a):
    """`wait --task <t> [--for <s>]` (ADR 0067 d9; legs.md § The task loop's `wait`): the Leg's rank wait on row t. Exit
    1 for a t not in the Queue, or no Leg of this session. When next is no `wait` on t, `cleared: true`, nothing
    logged. Else, unless the hold is stalled at this first check (nothing logged), under the rollout's lock and then the
    rank lock, kind wait or retry logs its `rank wait:` or `rank retry:` line whenever t has no standing line yet or its
    latest standing line is of the other kind, so t's latest line always records the kind it waits as (kind land logs
    nothing). A kind that differs from that latest line is `flipped` (the line it logs is the new kind's), and the call
    polls on: the Leg's `next` already read the new kind, so only a flip during the poll ends the call, and a kind that
    keeps changing between calls never returns at once. It polls read-only every RANK_POLL_SECONDS, recomputing the
    contention and the plan, until it clears, the kind flips from the one this call logged or read, the hold is
    stalled, or --for runs out (--for 0: one check). A Capacity wait (kinds `capacity` and `quota`, p36-7) is
    capacity_wait's: no rank line, its own waiting record instead. waitedMinutes is t's standing line's age, or this
    call's own minutes from its start to its return when that is longer (p41-7)."""
    if a.for_ < 0:
        raise Usage("--for takes seconds, 0 or more")
    chain = Chain(ctx)
    leg = my_leg(ctx, chain)
    r = chain.row(a.task)
    if r is None or r.state == "deferred":
        raise Refuse(1, f"[[{a.task}]] is not a task of this chain's Queue")
    leg_lease(ctx, leg)   # p36-7: every wait renews the Leg lease at its start, off --dry-run
    base_now, t0 = ctx.now, time.monotonic()

    def check():
        ch = Chain(ctx)
        lg = my_leg(ctx, ch)
        ch.contend = rank_contention(ctx, ch, lg["n"])
        return (ch, lg) + (leg_gate(ctx, ch, plan_next(ch, lg["n"], lg["alias"], lg["folder"]))[0],)

    def on_t(p):
        return p["action"] == "wait" and p["task"].lower() == r.slug.lower()

    ch, lg, plan = check()
    out = {"verb": "wait", "rollout": ctx.slug, "leg": lg["n"], "task": r.slug, "kind": None, "cleared": False,
           "flipped": False, "stalled": False, "why": None, "on": None, "token": None, "landFirst": [],
           "waitedMinutes": 0, "lifts": ch.contend.get("lifts", 0), "logged": False, "capacity": None, "warns": [],
           "dryRun": ctx.dry}

    def done(ch, plan, **kw):
        # waitedMinutes (p41-7): t's standing line's age, or this call's own start-to-return minutes when longer; a
        # Capacity wait has no standing line, and a rank wait's line is gone once it clears.
        st = (ch.contend.get("standing") or {}).get(r.slug.lower()) or {}
        own = int((time.monotonic() - t0) // 60)
        out.update(kw, lifts=ch.contend.get("lifts", 0), waitedMinutes=max(int(st.get("age", 0)), own),
                   next=next_json(plan))
        if on_t(plan):
            out.update(kind=plan["kind"], stalled=plan["stalled"], why=plan["why"], on=plan["on"], token=plan["token"],
                       landFirst=plan["landFirst"], capacity=plan.get("capacity"))
        return out

    if not on_t(plan):
        return done(ch, plan, cleared=True)
    kind = plan["kind"]
    if kind in ("capacity", "quota"):
        return capacity_wait(ctx, a, r, kind, check, on_t, done, out, base_now, t0)
    if plan["stalled"]:
        return done(ch, plan)

    def latest(c):
        """The kind of t's latest standing line in c's open Leg, else None."""
        mine = [x for x in standing_lines(c) if x["task"].lower() == r.slug.lower()]
        return mine[-1]["kind"] if mine else None

    prev = latest(ch)
    out["flipped"] = prev is not None and prev != kind and kind in ("wait", "retry")
    if kind in ("wait", "retry") and prev != kind and not ctx.dry:
        with Lock(ctx), RankLock(ctx):
            ch, lg, plan = check()
            if on_t(plan) and plan["kind"] == kind and not plan["stalled"] and latest(ch) != kind:
                text = (f"rank wait: [[{r.slug}]] on [[{plan['on']}]] ({plan['token']}; ranks above it)" if kind == "wait"
                        else f"rank retry: [[{r.slug}]] on [[{plan['on']}]] ({plan['token']}; [[{plan['on']}]] ranks above)")
                log_line(ch.note, leg_line(ctx, lg["n"], text))
                save(ctx, ch.note)
                out["logged"] = True
                ch, lg, plan = check()
    if not on_t(plan):
        return done(ch, plan, cleared=True)
    if plan["kind"] != kind or plan["stalled"]:
        return done(ch, plan, flipped=out["flipped"] or plan["kind"] != kind)
    while True:
        left = a.for_ - (time.monotonic() - t0)
        if left <= 0:
            return done(ch, plan)
        time.sleep(min(RANK_POLL_SECONDS, left))
        ctx.now = base_now + timedelta(seconds=time.monotonic() - t0)
        ch, lg, plan = check()
        if not on_t(plan):
            return done(ch, plan, cleared=True)
        if plan["kind"] != kind or plan["stalled"]:
            return done(ch, plan, flipped=out["flipped"] or plan["kind"] != kind)


def capacity_record(ctx, kind, warns):
    """A Capacity wait's waiting record (p36-7): under the trickle claim lock alone (never with the rollout's lock or
    the rank lock), one fresh rr.capacity_gate read and its claims write: kind `capacity` records this chain waiting
    (want 1) while the gate still holds it, anything else drops its record. Its child-process reads (rr.capacity_reads)
    and this chain's count are taken before the lock. A lock not taken within THREAD_NOTE_LOCK_TIMEOUT (30 s) adds one
    `warns` entry and the wait reads on, read-only. Never under --dry-run."""
    if ctx.dry:
        return
    reads = rr.capacity_reads(ctx.now, quota_env=os.environ)
    mine = leg_mine(Chain(ctx))
    lock = rr._note_lock(lock_path=rr._trickle_paths()[0], label="trickle claim lock")
    try:
        lock.__enter__()
    except OSError as e:
        warns.append(f"{rr.TRICKLE_WARN} {e} — this Leg's waiting record is not written; the wait reads on")
        return
    try:
        g = rr.capacity_gate(ctx.rollout, ctx.tasks, ctx.now, mine, 1, reads=reads)
        w = g["write"]("waiting" if kind == "capacity" and g["held"] and g["kind"] == "capacity" else "drop")
        if w:
            warns.append(w)
    finally:
        lock.__exit__(None, None, None)


def capacity_wait(ctx, a, r, kind, check, on_t, done, out, base_now, t0):
    """`wait`'s Capacity branch (kinds `capacity` and `quota`, p36-7; legs.md § The task loop's `wait`): it logs no rank
    line. At its start (the lease already written) it records its waiting record (kind capacity) or drops it (kind
    quota: capacity_record), then polls read-only every RANK_POLL_SECONDS, the plan and the gate recomputed, re-recording
    and renewing the Leg lease every CAPACITY_WAIT_REFRESH seconds (under TRICKLE_WAIT_TTL, so a lead on an older
    snapshot that dropped the record loses it for at most that long). It ends `cleared: true` once next is no `wait` on
    t (room), `flipped` when the kind changes, or when --for runs out; never `stalled`."""
    warns = out["warns"]
    capacity_record(ctx, kind, warns)
    refreshed = time.monotonic()
    ch, lg, plan = check()
    while True:
        if not on_t(plan):
            return done(ch, plan, cleared=True)
        if plan["kind"] != kind:
            return done(ch, plan, flipped=True)
        left = a.for_ - (time.monotonic() - t0)
        if left <= 0:
            return done(ch, plan)
        time.sleep(min(RANK_POLL_SECONDS, left))
        ctx.now = base_now + timedelta(seconds=time.monotonic() - t0)
        ch, lg, plan = check()
        if on_t(plan) and plan["kind"] == kind and time.monotonic() - refreshed >= CAPACITY_WAIT_REFRESH:
            leg_lease(ctx, lg)
            capacity_record(ctx, kind, warns)
            refreshed = time.monotonic()


def stamp_bases(ctx, chain, row):
    """(bases, primary bases). bases: one `<toplevel>@<sha40>` per checkout the row works (ADR 0067 d2): checkout_of
    each of its `repo:` tokens that is a git toplevel, then the toplevel of its launch folder, where its commits land;
    the vault never. A file token, or a row whose cell names only `ext:` or vault places, so never leaves a code row
    unstamped and unreviewed. In a chain with `chain_copies:` each top is stamped as its copy, `<copy>@<copy HEAD>`,
    and the primary bases are `<checkout>@<checkout HEAD>` beside them (done's stray scan reads them); in place they are
    None. Refuse(1), nothing written: a top with no pair (`leg.py copies` adds it), or a pair whose copy is missing."""
    tops = row_tops(ctx, row)
    pairs = chain_pairs(chain)
    if pairs is None:
        return tops_at(tops), None
    copies = []
    for top in tops:
        hit = _pair(pairs, top)
        if hit is None:
            raise Refuse(1, f"{top} has no Chain copy in chain_copies: run leg.py copies --rollout {ctx.rollout}, then "
                            "claim again; nothing written")
        if toplevel(hit[1]) != os.path.realpath(hit[1]):
            raise Refuse(1, f"{top}'s Chain copy {hit[1]} is missing: leg.py begin remakes it (or leg.py copies "
                            f"--rollout {ctx.rollout}), then claim again; nothing written")
        copies.append(os.path.realpath(hit[1]))
    return tops_at(copies), tops_at(tops)


def unlanded_deps(ctx, chain, row, pairs, bases):
    """A Chain copy's claim (ADR 0067 d2, d3): each dependency of row (depends-on/blocked-by, through `merged_into:`
    tombstones) that another rollout's chain finished, with a `leg_head` commit in this repository (its object is in the
    copy's) that the copy's HEAD lacks. `done` frees the dependant at once, while the work reaches the primary's default
    branch only at its chain's next land (that chain's next `done` or close), and this copy only at a land or a
    fast-forward of its own. [{task, dep, rollout, sha, copy, why}], why the cause: `done on chain/<X>, not yet on <d>:
    it lands at [[<X>]]'s next done or close` (the commit is on that branch here); `on <d>, not yet in <copy>: run
    leg.py land, which brings <d> in`; else `done in <its top> (<sha12>), not in <copy>`."""
    copies = [b.rpartition("@")[0] for b in bases]
    out = []
    for dep in rr._dep_entries(row.note):
        _unit, entry, _folded = rr._fold_unit(dep, chain.index)
        if entry is None or rr._status(entry[1]) != "done":
            continue
        other = rr._wikilink_slug(rr._scalar(entry[1].get("rollout"))) or ""
        if not other or other.lower() == ctx.slug.lower():
            continue
        for top, sha in rr._leg_tops(entry[1], "leg_head"):
            for C in copies:
                if git(C, "cat-file", "-e", f"{sha}^{{commit}}").returncode != 0 or is_ancestor(C, sha, "HEAD"):
                    continue   # another repository's commit, or one this copy holds
                hit = _pair(pairs, C, side=1)
                P = hit[0] if hit else C
                d = default_branch(P)
                dn = d or "its default branch"
                theirs = f"refs/heads/chain/{other}"
                if d and is_ancestor(P, sha, f"refs/heads/{d}"):
                    why = f"on {dn}, not yet in {C}: run leg.py land, which brings {dn} in"
                elif git(P, "rev-parse", "-q", "--verify", theirs).returncode == 0 and is_ancestor(P, sha, theirs):
                    why = f"done on chain/{other}, not yet on {dn}: it lands at [[{other}]]'s next done or close"
                else:
                    why = f"done in {top} ({sha[:12]}), not in {C}"
                out.append({"task": row.slug, "dep": dep, "rollout": other, "sha": sha, "copy": C, "why": why})
    return out


def tops_at(tops):
    """`<top>@<HEAD sha40>` for each top whose HEAD resolves, in order, each once."""
    out = []
    for top in tops:
        sha = git_out(top, "rev-parse", "--verify", "HEAD^{commit}")
        if sha and f"{top}@{sha}" not in out:
            out.append(f"{top}@{sha}")
    return out


def row_tops(ctx, row):
    """The checkouts a row works, in place: each `repo:` token's checkout that is a git toplevel, then its launch
    folder's toplevel; the vault and a path in no checkout never."""
    vault = os.path.realpath(ctx.vault)
    tops = []
    for tok in row.surfaces:
        try:
            c = sc.checkout_of(tok)
        except ValueError:
            continue
        if c is None:
            continue
        p = os.path.realpath(os.path.expanduser(c[1]))
        if toplevel(p) == p:
            tops.append(p)
    if row.folder:
        tops.append(toplevel(os.path.realpath(os.path.expanduser(row.folder))))
    out = []
    for top in tops:
        if top is not None and top != vault and top not in out:
            out.append(top)
    return out


def cmd_claim(ctx, a):
    # The rank lock inside the rollout's (ADR 0067 d9): the contention read, the plan, the save and the log run under it,
    # so two chains never both claim one file. The Capacity (p36-7) is read last: everything slow or refusing (the
    # re-check, the bases' git, the dependency gaps, the gates) runs first, and a fresh claim in force takes the trickle
    # claim lock inside the rank lock around only its recount, the Leg lease, the task note's save and the claims write.
    with Lock(ctx), RankLock(ctx):
        chain = Chain(ctx)
        leg = my_leg(ctx, chain)
        n = leg["n"]
        chain.contend = rank_contention(ctx, chain, n)
        plan = plan_next(chain, n, leg["alias"], leg["folder"])
        want = "finish" if a.inherit else "claim"
        if plan["action"] != want or plan.get("task", "").lower() != a.task.lower() or \
                (a.inherit and not plan.get("inherit")):
            got = f"{plan['action']} {plan.get('task') or ''}".strip()
            raise Refuse(1, f"next is `{got}`, not {'an inherited ' if a.inherit else ''}claim of [[{a.task}]]: "
                            "nothing written")
        row = plan["row"]
        note = rr.Note(row.path)
        note.set("status", "in_progress")
        note.set("owner", f"leg-{n}")
        note.set("leg", str(n), after=("owner",))
        if not rr._valued(note.get("started")):
            note.set("started", ctx.stamp, after=("leg", "owner"))
        for key in ("handed_back", "gates_signed"):
            note.remove(key)
        bases = pbases = None
        if not a.inherit:
            bases, pbases = stamp_bases(ctx, chain, row)
            gaps = unlanded_deps(ctx, chain, row, chain_pairs(chain), bases) if pbases is not None else []
            if gaps:
                # The tail by cause (legs.md § The task loop): a gap on <d> (unlanded_deps' `on <d>, …` why) is this
                # chain's own land away, so land and claim again; any other waits set aside, so it is named first.
                g = next((x for x in gaps if not x["why"].startswith("on ")), gaps[0])
                tail = ("run leg.py land, then claim again" if g["why"].startswith("on ") else
                        f"set it aside (`leg.py set-aside --task {row.slug} --reason \"<this error>\"`) until that work "
                        f"is in {g['copy']}")
                raise Refuse(1, f"[[{row.slug}]] depends on [[{g['dep']}]] ({g['why']}): {tail}; nothing written",
                             unlandedDeps=gaps)
            note.set("leg_base", "[" + ", ".join(f'"{b}"' for b in bases) + "]", after=("started", "leg"))
            if pbases is not None:
                # A Chain copy's claim: the primaries' HEADs too, so done finds a commit that went there instead.
                note.set("leg_primary_base", "[" + ", ".join(f'"{b}"' for b in pbases) + "]", after=("leg_base",))
            # A fresh window holds no scan yet: an earlier claim's Security check records go (an inherited claim keeps
            # them, as it keeps leg_base).
            note.remove("leg_scan")
            note.remove_section(SECURITY_SECTION)
        approved = [rr._norm_gate(l) for l in note.section_text(APPROVED_GATES).split("\n") if l.strip()]
        unapproved = [g for g in real_gates(a.gate) if rr._norm_gate(g) not in approved]
        claim_save(ctx, chain, leg, row, note, fresh=not a.inherit)
        text = (f"took [[{row.slug}]] (inherited from Leg {plan['from']})" if a.inherit else f"claimed [[{row.slug}]]")
        if not ctx.dry:
            log_line(chain.note, leg_line(ctx, n, text))
            save(ctx, chain.note)
        out = {"verb": "claim", "rollout": ctx.slug, "leg": n, "task": row.slug, "inherit": bool(a.inherit),
               "fix": bool(plan.get("fix")), "leg_base": [f"{t}@{s}" for t, s in leg_base(note)] if bases is None else bases,
               "verify": verify_line(note), "unapproved": unapproved, "dryRun": ctx.dry}
        primary = pbases if bases is not None else (
            [f"{t}@{s}" for t, s in rr._leg_tops(note, "leg_primary_base")] if note.get("leg_primary_base") is not None
            else None)
        if primary is not None:
            out["leg_primary_base"] = primary
        return out


def capacity_stand(ctx, chain, n, row, why, capacity, quota=None):
    """claim's Capacity stand (p36-7): exit 3, nothing written to the notes, its turn ends `waiting` on the hold."""
    extra = {"capacity": capacity, "status_line": status_line(ctx.slug, chain.progress(n), "waiting", why)}
    if quota is not None:
        extra["quota"] = quota
    raise Refuse(3, f"{why}: [[{row.slug}]] waits for room on the Mac; nothing written to the notes: run `leg.py next`, "
                    f"then `leg.py wait --task {row.slug}` (legs.md § The task loop's `wait`)", **extra)


def claim_save(ctx, chain, leg, row, note, fresh):
    """claim's write of the task note (p36-7, ADR 0067 d8; the module docstring's claim). A fresh claim reads the
    Capacity, the Away state, the heat and the Mac's boot and wake first (rr.capacity_reads, every read that may run a
    child process), before any lock. While Capacity is in force: the quota hold (the heat aside) stands at once, no lock
    and nothing written; else under the trickle claim lock (a lock not taken within THREAD_NOTE_LOCK_TIMEOUT is exit 5,
    nothing written: a Leg's stamp counts at once, so it never claims unlocked) the recount (rr.capacity_gate, from
    those reads: under the lock only the notes, the leases and the claims file are read): no room writes this chain's
    waiting record and stands (exit 3); room writes the Leg lease, saves the note, then the claims write (its own
    record and wake dropped, a wake for each rollout it keeps places for). --dry-run reads the gate and writes nothing.
    Otherwise (the fallback, or an inherited claim, which is never gated) the lease best-effort, then the save, as
    before."""
    n = leg["n"]
    reads = rr.capacity_reads(ctx.now, quota_env=os.environ) if fresh else None
    state = reads["state"] if reads else None
    if state is None or not state["inForce"]:
        leg_lease(ctx, leg)
        save(ctx, note)
        return
    if rr._quota_held(state) and not reads["heat"]["held"]:
        capacity_stand(ctx, chain, n, row, rr._quota_why(state), None, quota=state["quota"])
    mine = leg_mine(chain)
    if ctx.dry:
        g = rr.capacity_gate(ctx.rollout, ctx.tasks, ctx.now, mine, 1, reads=reads)
        if g["held"]:
            capacity_stand(ctx, chain, n, row, g["why"], g["capacity"], quota=state["quota"] if g["kind"] == "quota" else None)
        return
    lock = rr._note_lock(lock_path=rr._trickle_paths()[0], label="trickle claim lock")
    try:
        lock.__enter__()
    except OSError as e:
        raise Refuse(5, f"{e}: a claim under the Capacity never claims unlocked; nothing written (retry once, then end "
                        "the turn halted)")
    try:
        g = rr.capacity_gate(ctx.rollout, ctx.tasks, ctx.now, mine, 1, reads=reads)
        if g["held"]:
            w = g["write"]("waiting" if g["kind"] == "capacity" else "drop")
            if w:
                print(w, file=sys.stderr)
            capacity_stand(ctx, chain, n, row, g["why"], g["capacity"], quota=state["quota"] if g["kind"] == "quota" else None)
        leg_lease(ctx, leg)
        save(ctx, note)
        w = g["write"]("served")
        if w:
            print(w, file=sys.stderr)
    finally:
        lock.__exit__(None, None, None)


def commits_for(top, base, slug, exclude=()):
    """[(sha, subject, paths)] in base..HEAD (minus what each `exclude` ref reaches) carrying `Task: [[slug]]`, oldest
    first; and the untrailered ones."""
    r = git(top, "log", "--reverse", "--format=%H%x1f%s%x1f%B%x1e", f"{base}..HEAD", *(["--not", *exclude] if exclude else []))
    if r.returncode != 0:
        return None, None
    mine, bare = [], []
    pat = re.compile(rf"^\s*Task:\s*\[\[{re.escape(slug)}(?:[|#][^\]]*)?\]\]\s*$", re.M | re.I)
    any_task = re.compile(r"^\s*Task:\s*\[\[", re.M | re.I)
    for rec in r.stdout.split("\x1e"):
        rec = rec.strip("\n")
        if not rec:
            continue
        sha, subj, body = (rec.split("\x1f") + ["", ""])[:3]
        paths = [p for p in (git_out(top, "diff-tree", "--no-commit-id", "--name-only", "-r", "--root", sha) or "").split("\n") if p]
        if pat.search(body):
            mine.append((sha, subj, paths))
        elif not any_task.search(body):
            bare.append((sha, subj, paths))
    return mine, bare


def trailered_by_any(top, sha, slugs):
    body = git_out(top, "log", "-1", "--format=%B", sha) or ""
    for s in slugs:
        if re.search(rf"^\s*Task:\s*\[\[{re.escape(s)}(?:[|#][^\]]*)?\]\]\s*$", body, re.M | re.I):
            return True
    return False


def change_of(note, slug, only_top=None):
    tops = []
    for top, base in leg_base(note):
        if only_top and os.path.realpath(only_top) != top:
            continue
        head = git_out(top, "rev-parse", "--verify", "HEAD^{commit}")
        mine, bare = commits_for(top, base, slug)
        if mine is None:
            tops.append({"top": top, "base": base, "head": head, "error": f"cannot list {base}..HEAD in {top}",
                         "commits": [], "paths": [], "spec": [], "warns": []})
            continue
        paths = []
        for _sha, _subj, ps in mine:
            for p in ps:
                if not p.startswith(REVIEWS) and p not in paths:
                    paths.append(p)
        # Only the checkout's own line warns: what a land merge brought in (its second parent's side) is another
        # chain's or a peer's, already on the primary's default branch (ADR 0067 d3).
        own = set((git_out(top, "rev-list", "--first-parent", f"{base}..HEAD") or "").split())
        warns = [f"WARN: {sha[:12]} {subj!r} in {top} carries no Task: line"
                 for sha, subj, ps in bare if sha in own and any(not p.startswith(REVIEWS) for p in ps)]
        tops.append({"top": top, "base": base, "head": head,
                     "commits": [{"sha": s, "subject": subj} for s, subj, _ in mine], "paths": paths,
                     "spec": [f":(literal){p}" for p in paths], "warns": warns})
    return tops


def stray_of(ctx, note, slug, pairs):
    """[(primary, copy, [(sha, subject, paths)])]: per `leg_primary_base` entry (a Chain copy's claim), the task's
    `Task:`-trailered commits in `<primary base>..HEAD` that refs/heads/chain/<rollout> does not reach: work that went
    into the primary checkout instead of its Chain copy (a hand merge of the chain branch is never stray). [] in place."""
    out, ref = [], f"refs/heads/chain/{ctx.slug}"
    for top, pbase in rr._leg_tops(note, "leg_primary_base"):
        excl = [ref] if git(top, "show-ref", "--verify", "-q", ref).returncode == 0 else []
        mine, _bare = commits_for(top, pbase, slug, exclude=excl)
        if mine:
            hit = _pair(pairs, top)
            out.append((top, hit[1] if hit else "its Chain copy", mine))
    return out


def task_note(chain, slug):
    r = chain.row(slug)
    if r is None or r.note is None or r.state == "deferred":
        raise Refuse(1, f"[[{slug}]] is not a task of this chain's Queue")
    return r


def cmd_change(ctx, a):
    chain = Chain(ctx)
    r = task_note(chain, a.task)
    tops = change_of(r.note, r.slug, a.top)
    stray = [f"WARN: {sha[:12]} {subj!r} in {top} carries Task: [[{r.slug}]] but is in the primary, not its Chain copy "
             f"{copy}: done refuses it; set-aside --revert reverts it there"
             for top, copy, mine in stray_of(ctx, r.note, r.slug, copies_read(chain)[0]) for sha, subj, _p in mine]
    return {"verb": "change", "rollout": ctx.slug, "task": r.slug, "tops": tops,
            "codeWriting": any(t["commits"] for t in tops), "stray": stray}


def cmd_smoke(ctx, a):
    with Lock(ctx):
        chain = Chain(ctx)
        leg = my_leg(ctx, chain)
        r = task_note(chain, a.task)
        res = a.result.replace("-", " ")
        text = f"smoke: [[{r.slug}]] {res}" + (f": {reason_text(a.why, 200)}" if a.why else "")
        if not ctx.dry:
            log_line(chain.note, leg_line(ctx, leg["n"], text))
            save(ctx, chain.note)
        leg_lease(ctx, leg)
        return {"verb": "smoke", "rollout": ctx.slug, "leg": leg["n"], "task": r.slug, "result": res, "dryRun": ctx.dry}


# ---- names --------------------------------------------------------------------------------------------------------

def kebab(s, words=6):
    w = re.findall(r"[a-z0-9]+", s.lower())
    return "-".join(w[:words]) or "item"


def project_of(ctx, slug=None):
    if slug:
        m = rr.PHASED_STEM_RE.match(slug)
        if m:
            return m.group("slug")
    stem = ctx.slug
    return stem.split("-rollout-", 1)[0] if "-rollout-" in stem else stem


def safe_name(name):
    for _ in range(5):
        new = re.sub(r"-p(?=\d)", "-p-", name).replace("-rollout-", "-roll-out-")
        if new == name:
            break
        name = new
    if rr.PHASED_STEM_RE.match(name) or "-rollout-" in name:
        raise Refuse(1, f"cannot form a safe follow-on name from {name}")
    return name


def free_name(chain, base):
    base = safe_name(base)
    taken = set(chain.index) | {p.stem.lower() for p in chain.ctx.tasks.glob("*.md")}
    name, k = base, 2
    while name.lower() in taken:
        name, k = f"{base}-{k}", k + 1
    return name


def new_task_text(ctx, projects_lines, extra_fm, body):
    fm = ["tags: [task]", "status: open", "priority: normal", "work_depth: shallow", *projects_lines,
          "contexts: []", "scheduled:", "due:", f"captured: {ctx.date}", *extra_fm]
    return "---\n" + "\n".join(fm) + "\n---\n" + body.rstrip("\n") + "\n"


# ---- file-fix -----------------------------------------------------------------------------------------------------

def last_trailered(top, base, slug):
    mine, _ = commits_for(top, base, slug)
    return mine[-1][0] if mine else None


def check_cause(chain, target, a):
    """Validate the cause against git; returns the culprit row (chain) or None. Refuse(1) on a misfit."""
    tops = change_of(target.note, target.slug)
    has_paths = any(t["paths"] for t in tops)
    if a.cause in ("chain", "outside") and not has_paths:
        raise Refuse(1, f"[[{target.slug}]] has no code paths (vault-only work): only own or drift fit")
    if a.cause == "chain":
        if not a.culprit:
            raise Refuse(2, "--cause chain needs --culprit <L>")
        cul = chain.row(a.culprit)
        if cul is None or cul.note is None or cul.state != "done" or cul.slug.lower() == target.slug.lower():
            raise Refuse(1, f"--culprit [[{a.culprit}]] is not a done task of this chain other than [[{target.slug}]]")
        touched = False
        for t in tops:
            if not t["commits"] or not t["paths"]:
                continue
            last = t["commits"][-1]["sha"]  # t's last trailered commit in this checkout
            mine = []
            for top, base in leg_base(cul.note):
                if top == t["top"]:
                    got, _ = commits_for(top, base, cul.slug)
                    mine.extend(got or [])
            hits = [s for s, _j, ps in mine if any(p in t["paths"] for p in ps)]
            touched = touched or bool(hits)
            # A later chain task: one of its commits on t's paths is in <last>..HEAD, never an ancestor of t's own.
            if any(not is_ancestor(t["top"], s, last) for s in hits):
                return cul
        if touched:
            raise Refuse(1, f"[[{cul.slug}]]'s Task: commits on [[{target.slug}]]'s paths all came before "
                            f"[[{target.slug}]]'s last Task: commit: it landed before [[{target.slug}]] passed its own "
                            "Verify, so it is no later chain task that broke it")
        raise Refuse(1, f"[[{cul.slug}]]'s Task: commits touch none of [[{target.slug}]]'s paths: not its culprit")
    if a.culprit:
        raise Refuse(2, "--culprit goes with --cause chain only")
    if a.cause == "outside":
        slugs = [r.slug for r in chain.rows]
        for t in tops:
            last = last_trailered(t["top"], t["base"], target.slug)
            if not last or not t["paths"]:
                continue
            for sha in (git_out(t["top"], "rev-list", f"{last}..HEAD", "--", *t["spec"]) or "").split():
                if not trailered_by_any(t["top"], sha, slugs):
                    return None
            # A land merge on the copy's own line brought other chains' landed work in (ADR 0067 d3): a red after it
            # is outside even when that work touched none of t's paths (the cross-file clash d4's backstop exists for).
            subjects = git_out(t["top"], "log", "--first-parent", "--format=%s", f"{last}..HEAD") or ""
            if any(s.startswith(LAND_MERGE) for s in subjects.split("\n")):
                return None
        raise Refuse(1, f"no commit after [[{target.slug}]]'s last Task: commit touches its paths without a chain "
                        "task's trailer, and no land merge came after it: not an outside cause")
    if a.cause == "drift":
        for t in tops:
            last = last_trailered(t["top"], t["base"], target.slug)
            if last and t["paths"] and git(t["top"], "diff", "--quiet", last, "--", *t["spec"]).returncode != 0:
                raise Refuse(1, f"[[{target.slug}]]'s paths changed in {t['top']} since its last Task: commit: not "
                                "drift; use own, chain or outside")
    return None


def insert_row(chain, row_text):
    if chain.note._section_bounds(QUEUE) is None:
        raise Refuse(1, f"{chain.ctx.slug} has no {QUEUE} table")
    before = next((r.slug for r in chain.rows if r.state == "queued"), None)
    chain.note.apply(_insert_row, row_text, before)   # journaled: re-applied to a note another writer changed


def _insert_row(note, row_text, before):
    """The row before the Queue row linking `before` (the first queued task), else after the table's last row, read
    from the note itself so Note.apply can re-apply it; the rows renumbered."""
    found = note._section_bounds(QUEUE)
    if found is None:
        return
    lines, start, end = found
    table = [k for k in range(start + 1, end) if lines[k].lstrip().startswith("|")]
    at = next((k for k in table if before is not None
               and (_cells_slug(split_cells(lines[k])) or "").lower() == before.lower()), None)
    if at is None:
        at = (table[-1] + 1) if table else end
    lines = lines[:at] + [row_text] + lines[at:]
    n = 0
    for k in range(start + 1, end + 1):
        cells = split_cells(lines[k]) if k < len(lines) else []
        if len(cells) >= 3 and LINK_RE.search(cells[1]):
            n += 1
            lines[k] = re.sub(r"^(\s*\|\s*)[^|]*?(\s*\|)", lambda m: f"{m.group(1)}{n}{m.group(2)}", lines[k], count=1)
    note._set_body_lines(lines)


def cmd_file_fix(ctx, a):
    with Lock(ctx):
        chain = Chain(ctx)
        leg = my_leg(ctx, chain)
        n = leg["n"]
        target = task_note(chain, a.target)
        if target.state != "done":
            raise Refuse(1, f"[[{target.slug}]] is not done: a failing Verify on unfinished work files no fix")
        culprit = check_cause(chain, target, a)
        cause_txt = {"own": "own", "chain": f"chain [[{culprit.slug if culprit else ''}]]", "outside": "outside",
                     "drift": "drift"}[a.cause]
        existing = None
        for p, fnote, v in chain.fix_notes():
            if v.lower() == target.slug.lower() and rr._status(fnote) != "done":
                existing = (p, fnote)
                break
        if existing is not None and chain.row(existing[0].stem) is not None:
            return {"verb": "file-fix", "rollout": ctx.slug, "leg": n, "fix": existing[0].stem, "target": target.slug,
                    "existing": True, "wrote": False, "dryRun": ctx.dry}
        if existing is not None:
            name, path = existing[0].stem, existing[0]
            wrote_note = False
        else:
            desc = target.slug
            m = rr.PHASED_STEM_RE.match(target.slug)
            if m:
                desc = re.sub(r"^\d+-", "", target.slug[m.end():]) or target.slug
            name = free_name(chain, f"{project_of(ctx, target.slug)}-followup-fix-{desc}")
            path = ctx.tasks / f"{name}.md"
            fixes = target.slug if a.cause == "own" else (culprit.slug if a.cause == "chain" else None)
            extra = [f'rollout: "[[{ctx.slug}]]"', f'verifies: "[[{target.slug}]]"']
            if fixes:
                extra.append(f'fixes: "[[{fixes}]]"')
            if leg["alias"] and leg["alias"] not in ("claude", "codex"):
                extra.append(f"launch: {leg['alias']}")
            vl = verify_line(target.note) or "**Verify:** re-run [[%s]]'s Acceptance criteria." % target.slug
            body = (f"\n## Notes\n\nFiled by Leg {n}'s smoke test (execute legs.md § Fix tasks): [[{target.slug}]]'s "
                    f"Verify failed. Cause: {cause_txt}. Evidence: {a.evidence.strip()}\n")
            if a.excerpt:
                body += "\n```\n" + a.excerpt.rstrip("\n")[-2000:] + "\n```\n"
            body += (f"\n## Acceptance criteria\n\n- [[{target.slug}]]'s Verify passes again; [[{target.slug}]] "
                     f"stays done.\n\n{vl}\n")
            text = new_task_text(ctx, rr._fm_block(target.note, "projects"), extra, body)
            if not ctx.dry:
                atomic_write(path, text)
            wrote_note = True
        am = re.search(r"\\?\|([^\]]+)\]\]", target.cells[1])
        short = f"fix {am.group(1).strip() if am else target.slug}"
        row_text = (f"| 0 | [[{name}\\|{short}]] | `{leg['alias']}` from `{leg['folder']}` | {target.surfaces_cell} |")
        insert_row(chain, row_text)
        log_line(chain.note, leg_line(ctx, n, f"filed [[{name}]] (verifies [[{target.slug}]]; cause {cause_txt})"))
        save(ctx, chain.note)
        return {"verb": "file-fix", "rollout": ctx.slug, "leg": n, "fix": name, "target": target.slug,
                "cause": a.cause, "fixes": (target.slug if a.cause == "own" else culprit.slug if culprit else None),
                "existing": existing is not None, "wroteNote": wrote_note, "path": str(path), "dryRun": ctx.dry}


# ---- the Security check (execute § 3 `security_checks`; legs.md § The task loop's **Security check.**) -----------------

def security_on(note):
    """Whether the rollout note's `security_checks:` is on, through rr._scalar, case-folded: True for true, False for
    absent, empty or false. Any other value (a `yes`) is exit 1, `security_checks: must be true or false, got '<v>':
    fix the note`, so `security`, done and set-aside refuse it with that one line (legs.md's **A refused key**), done
    whatever scan the note records."""
    raw = rr._scalar(note.get(rr.SECURITY_CHECKS_KEY))
    if raw.lower() in ("", "false"):
        return False
    if raw.lower() == "true":
        return True
    raise Refuse(1, f"security_checks: must be true or false, got {raw!r}: fix the note")


def scan_records(note):
    """{top: (sha40, verdict)} from the task note's `leg_scan:` items, `"<top>@<sha40> <verdict>"` (`security`'s stamp;
    verdict clean, red, secret or unscanned). Its own parser (rr._leg_tops never reads the key): a malformed item is
    skipped."""
    out = {}
    for item in note.get_list("leg_scan"):
        m = re.fullmatch(r"(.+)@([0-9a-f]{40}) (\S+)", item.strip())
        if m and m.group(3) in SCAN_VERDICTS:
            out[m.group(1)] = (m.group(2), m.group(3))
    return out


def security_tops(ctx, chain, note, slug):
    """The checkouts the task's Security check covers, in order, each {top, primary, base[, error]}: the one list
    `security`, done and set-aside read. With `chain_copies:` (a malformed key is chain_pairs' exit 1): each `leg_base`
    Chain copy holding a commit since its base (`rev-list --count <base>..HEAD` above 0: every commit in a copy's
    window is the chain's own, so an untrailered one counts too; a rev-list that fails is an `error` entry), primary
    false; then each primary a `Task:` commit of the task strayed into (stray_of), primary true, base its
    `leg_primary_base` sha. In place: each `leg_base` checkout where change_of finds the task's own `Task:` commits (its
    `error`, an `error` entry), primary true, base its `leg_base` sha. [] when the task committed nowhere."""
    pairs = chain_pairs(chain)
    out = []
    if pairs is not None:
        for top, base in leg_base(note):
            r = git(top, "rev-list", "--count", f"{base}..HEAD")
            if r.returncode != 0:
                out.append({"top": top, "primary": False, "base": base,
                            "error": f"cannot list {base[:12]}..HEAD in {top}"})
            elif (r.stdout.strip() or "0") != "0":
                out.append({"top": top, "primary": False, "base": base})
        pbases = dict(rr._leg_tops(note, "leg_primary_base"))
        for top, _copy, _mine in stray_of(ctx, note, slug, pairs):
            out.append({"top": top, "primary": True, "base": pbases.get(top)})
        return out
    for t in change_of(note, slug):
        if t.get("error"):
            out.append({"top": t["top"], "primary": True, "base": t["base"], "error": t["error"]})
        elif t["commits"]:
            out.append({"top": t["top"], "primary": True, "base": t["base"]})
    return out


def _chain_excl(ctx, top):
    """refs/heads/chain/<rollout> when top holds it (stray_of's exclusion: a hand merge of the chain is never stray)."""
    ref = f"refs/heads/chain/{ctx.slug}"
    return [ref] if git(top, "show-ref", "--verify", "-q", ref).returncode == 0 else []


def scan_covers(top, sha, slug, primary, exclude=()):
    """Whether a scan recorded at sha still covers the task's commits in top. A Chain copy's (primary false) must be at
    its HEAD exactly: every commit in its window is the chain's own, so any later one is unscanned. A primary's (in
    place, or a copy's stray) sha is HEAD or an ancestor of it, and commits_for finds above it no commit of the task's
    own: no `Task: [[slug]]` commit and no untrailered one touching only docs/reviews/ (its review doc). A peer's later
    commit is not the task's change (ADR 0040). exclude: refs whose commits never count (_chain_excl)."""
    head = git_out(top, "rev-parse", "--verify", "HEAD^{commit}")
    if not head or not sha:
        return False
    if not primary:
        return sha == head
    if sha != head and not is_ancestor(top, sha, "HEAD"):
        return False
    mine, bare = commits_for(top, sha, slug, exclude=exclude)
    if mine is None or mine:
        return False
    return not any(ps and all(p.startswith(REVIEWS) for p in ps) for _sha, _subj, ps in bare)


def covering(ctx, note, entry, slug):
    """The verdict of the task's `leg_scan` record for entry's top (a security_tops entry) when that scan still covers
    the top (scan_covers), else None."""
    rec = scan_records(note).get(entry["top"])
    if rec is None:
        return None
    excl = _chain_excl(ctx, entry["top"]) if entry["primary"] else ()
    return rec[1] if scan_covers(entry["top"], rec[0], slug, entry["primary"], excl) else None


def scan_ask(note):
    """The `Ask: ` line of the task note's `## Security check`, as `security` wrote it, else None."""
    for line in note.section_text(SECURITY_SECTION).split("\n"):
        if line.startswith("Ask: "):
            return line[len("Ask: "):].strip() or None
    return None


def _default_sigint():
    """run_scan's child: SIGINT back to its default before exec. A shell that starts a job in the background starts it
    with SIGINT ignored, and python keeps an inherited ignore, so the cut's SIGINT would never reach the scanner's
    cleanup."""
    signal.signal(signal.SIGINT, signal.SIG_DFL)


def run_scan(argv, timeout):
    """(rc, stdout, stderr, cut): argv run with stdin closed under _env(), for at most timeout seconds, its SIGINT at
    the default (_default_sigint). Past it the scanner gets SIGINT (its subprocess.run kills gitleaks, and its
    `finally` removes its thread-security-* dir), then SCAN_GRACE seconds, then a kill; cut is True then."""
    try:
        p = subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                             text=True, env=_env(), preexec_fn=_default_sigint)
    except OSError as e:
        return 99, "", str(e), False
    try:
        out, err = p.communicate(timeout=timeout)
        return p.returncode, out, err, False
    except subprocess.TimeoutExpired:
        pass
    try:
        p.send_signal(signal.SIGINT)
    except OSError:
        pass
    try:
        out, err = p.communicate(timeout=SCAN_GRACE)
    except subprocess.TimeoutExpired:
        p.kill()
        out, err = p.communicate()
    return p.returncode, out or "", err or "", True


def _teardown(top, wt):
    """Remove a scratch worktree of top: `worktree remove --force --force` (git locks an entry `initializing` while add
    runs), `worktree unlock` when that fails, the directory removed, then `worktree prune`: at most TEARDOWN s."""
    if git(top, "worktree", "remove", "--force", "--force", wt, timeout=30).returncode != 0:
        git(top, "worktree", "unlock", wt, timeout=10)
    shutil.rmtree(wt, ignore_errors=True)
    git(top, "worktree", "prune", timeout=10)


def _pid_alive(pid):
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except OSError:   # another user's process: alive
        return True
    return True


def sweep_scratch(top, deadline):
    """Tear down each of top's registered `leg-security-<pid>-…` worktrees whose pid is dead: a `security` the tool cut
    or killed before its own teardown ran. Inside the deadline: `worktree list` within it (30 s at most), and each
    teardown only while TEARDOWN s are left; the trees it leaves wait for the next run's sweep."""
    t = within(deadline, 30)
    r = git(top, "worktree", "list", "--porcelain", timeout=t) if t else None
    if r is None or r.returncode != 0:
        return
    for line in r.stdout.split("\n"):
        if not line.startswith("worktree "):
            continue
        wt = line[len("worktree "):]
        m = SCRATCH_RE.match(os.path.basename(wt))
        if m and int(m.group(1)) != os.getpid() and not _pid_alive(int(m.group(1))):
            if deadline - time.monotonic() < TEARDOWN:
                return
            _teardown(top, wt)


@contextlib.contextmanager
def scratch_tree(top, deadline, budget):
    """A detached worktree of top at its HEAD, where `security` scans a primary checkout (his uncommitted edits and
    untracked files there are never touched): yields (path, None), or (None, why) when `worktree add` fails (its
    timeout within the deadline) or cannot start (`not scanned: the Security check's <B> s budget ran out`, and no
    tree is made). Dead runs' trees are swept first (sweep_scratch); its own, once its add started, is always torn
    down (_teardown). scratch_diff, set-aside's revert tree, is another."""
    sweep_scratch(top, deadline)
    t = within(deadline)
    if t is None:
        yield None, f"not scanned: {ran_out(budget)}"
        return
    wt = tempfile.mkdtemp(prefix=f"{SCRATCH_PREFIX}{os.getpid()}-")
    os.rmdir(wt)
    try:
        added = git(top, "-c", "core.hooksPath=/dev/null", "worktree", "add", "-q", "--detach", wt, "HEAD", timeout=t)
        if added.returncode != 0:
            last = (added.stderr.strip().splitlines() or [f"exit {added.returncode}"])[-1]
            yield None, f"cannot add a scratch worktree in {top}: {last[:200]}"
        else:
            yield os.path.realpath(wt), None
    finally:
        _teardown(top, wt)


def _origin_head(top, deadline, budget):
    """settle_pushed's one origin read for top: (origin's live head for top's branch, None), ("", None) when origin has
    no such branch, or (None, why). Each of its reads is held inside the deadline (within)."""
    t = within(deadline, SHORT_READ)
    if t is None:
        return None, f"not read: {ran_out(budget)}"
    r = git(top, "symbolic-ref", "-q", "--short", "HEAD", timeout=t)
    branch = r.stdout.strip()
    if r.returncode != 0 or not branch:
        return None, f"{top}'s HEAD is detached"
    t = within(deadline, PUSHED_LS_TIMEOUT)
    if t is None:
        return None, f"not read: {ran_out(budget)}"
    r = git(top, "ls-remote", "--exit-code", "origin", f"refs/heads/{branch}", timeout=t)
    if r.returncode == 2:
        return "", None
    if r.returncode != 0 or not r.stdout.strip():
        return None, f"git ls-remote origin exited {r.returncode}"
    live = r.stdout.split()[0]
    t = within(deadline, SHORT_READ)
    if t is None:
        return None, f"not read: {ran_out(budget)}"
    if git(top, "cat-file", "-e", f"{live}^{{commit}}", timeout=t).returncode != 0:
        return None, f"origin's head {live[:7]} is not held here: fetch it, then run security again"
    return live, None


def settle_pushed(top, secrets, deadline, budget=None):
    """Fill each null `pushed` of a primary checkout's secrets, in the primary itself (the scan ran in a detached
    scratch tree, whose second read gives `HEAD is detached`; a true the scanner read from the remote-tracking refs is
    kept, with no call). Every read is held inside the deadline (within): one it cannot start leaves that `pushed`
    null, `not read: the Security check's <B> s budget ran out`. One origin read for top (_origin_head): `symbolic-ref
    -q --short HEAD` (SHORT_READ, 5 s) failing is null, `<top>'s HEAD is detached`; else `ls-remote --exit-code origin
    refs/heads/<branch>` (PUSHED_LS_TIMEOUT, 30 s): rc 2 is false (origin has no such branch); rc 0 with `<live>` held
    here (`cat-file -e`, 5 s) is `merge-base --is-ancestor <commit> <live>` (5 s): rc 0 true, rc 1 false, else null
    `git merge-base exited <rc>`; rc 0 with `<live>` not held is null `origin's head <sha7> is not held here: fetch
    it, then run security again`; any other rc null `git ls-remote origin exited <rc>`. Writes nothing and fetches
    nothing. Returns secrets."""
    budget = security_budget() if budget is None else budget
    read = None
    for s in secrets:
        if s.get("pushed") is not None:
            continue
        if read is None:
            read = _origin_head(top, deadline, budget)
        live, why = read
        if live is None:
            s["pushed"], s["pushedWhy"] = None, why
            continue
        if live == "":
            s["pushed"], s["pushedWhy"] = False, None
            continue
        t = within(deadline, SHORT_READ)
        if t is None:
            s["pushed"], s["pushedWhy"] = None, f"not read: {ran_out(budget)}"
            continue
        rc = git(top, "merge-base", "--is-ancestor", str(s["commit"]), live, timeout=t).returncode
        if rc in (0, 1):
            s["pushed"], s["pushedWhy"] = rc == 0, None
        else:
            s["pushed"], s["pushedWhy"] = None, f"git merge-base exited {rc}"
    return secrets


def shell_safe(text):
    """text with nothing a double-quoted shell argument expands, so repair's record-answer carries it verbatim: each
    backtick dropped, `"` as `'`, `$` as `?`, `\\` as `/`, and each whitespace run that holds a line break folded to
    one space. Idempotent, and a `security-accept <kind>:<12 hex>` token passes intact. None stays None."""
    if text is None:
        return None
    s = str(text).replace("`", "").replace('"', "'").replace("$", "?").replace("\\", "/")
    return re.sub(r"\s+", lambda m: " " if ("\n" in m.group(0) or "\r" in m.group(0)) else m.group(0), s)


def security_ask(entries):
    """The one question a serial chain's Security check leaves Lachy (`security`'s entries, each with its settled
    secrets and its scan), or None when it has no item: a primary secret (a Leg never rewrites a primary's history,
    so his answer is its rotation, and while origin does not hold it his own rewrite, before the halt is cleared), a
    scanner-config change, an advisory with no fixed release and one the Leg did not move past. A Chain copy's secret
    is never asked (the Leg rewrites it, or halts with its `## Security check` line), nor is an unscanned entry. With
    several entries each item opens `in <top>: `; one item is `<item>?`, several `The Security check found <N> things
    only you can settle: (1) …; (2) …?`. The caller passes it through shell_safe."""
    items = []
    many = len(entries) > 1
    for e in entries:
        pre = f"in {e['top']}: " if many else ""
        scan = e.get("scan") or {}
        if e["primary"]:
            for s in e.get("secrets") or []:
                said = (f"A secret ({s['rule']}) in {s['file']}, commit {str(s['commit'])[:7]}, line {s['line']}, is in "
                        f"{e['top']}'s history, which a Leg never rewrites")
                rewrite = ("rotate it, and while origin does not hold it you may rewrite it out of that history yourself "
                           "before the halt is cleared")
                if s.get("pushed") is True:
                    said += ", and origin already holds it: rotate it"
                elif s.get("pushed") is False:
                    said += f": {rewrite}"
                else:
                    said += f", and whether origin holds it is unknown ({s.get('pushedWhy') or 'not read'}): {rewrite}"
                items.append(pre + said)
        for c in scan.get("configTouched") or []:
            how = "creates or edits" if c.get("cause") == "committed" else "leaves an uncommitted"
            items.append(pre + f"This change {how} {c.get('path')}, the secret scanner's own config: keep it (answer "
                               f"security-accept {c.get('accept')}), or drop the change")
        for adv in scan.get("advisories") or []:
            said = f"{adv.get('ecosystem')} {adv.get('name')} {adv.get('version')} has advisory {adv.get('id')}"
            if adv.get("fixed"):
                items.append(pre + f"{said}, fixed in {', '.join(map(str, adv['fixed']))}, that the Leg did not move "
                                   f"past: keep it (answer security-accept {adv.get('accept')}), or move it to a fixed "
                                   "release")
            else:
                items.append(pre + f"{said} with no fixed release: keep it (answer security-accept {adv.get('accept')}), "
                                   "name another package, or drop the need")
    if not items:
        return None
    if len(items) == 1:
        return items[0] + "?"
    return (f"The Security check found {len(items)} things only you can settle: "
            + "; ".join(f"({i}) {x}" for i, x in enumerate(items, 1)) + "?")


def uncommitted_paths(top, deadline):
    """The paths `git status --porcelain=v1 -z --untracked-files=all` lists in top itself (tracked edits and untracked
    files: a primary's may be his own), at most 50; [] when it cannot run, or cannot start inside the deadline
    (within)."""
    t = within(deadline)
    r = git(top, "status", "--porcelain=v1", "-z", "--untracked-files=all", timeout=t) if t else None
    if r is None or r.returncode != 0:
        return []
    parts, out, i = r.stdout.split("\0"), [], 0
    while i < len(parts) and len(out) < 50:
        rec = parts[i]
        i += 1
        if len(rec) < 4:
            continue
        if rec[0] in "RC":
            i += 1   # a rename's or copy's source path follows it
        if rec[3:] not in out:
            out.append(rec[3:])
    return out


def rewrite_point(top, base, slug, scan, deadline, budget):
    """(rewrite, why) for a Chain copy's secret: the scan's `rewriteFrom` (the first secret commit's parent) when no
    secret's `pushed` is true (the scanner's read: a remote-tracking ref, or origin's live head, holds it), no merge
    sits at or after a secret (`mergeBehind` false), base is that commit or an ancestor of it, and every commit in
    `rewriteFrom..HEAD` carries `Task: [[slug]]` or touches only docs/reviews/; else (None, why): `origin already
    holds <sha7>` (rotated first, never rewritten by a Leg: legs.md § The task loop's **Security check.**), `a merge
    sits at or after it`, `the scan named no commit to rewrite from`, `<sha12> is below the task's leg_base`, `<sha12>
    above it is not this task's (no Task: [[slug]] line)`, or a read that failed or could not start inside the deadline
    (within: `not read: the Security check's <B> s budget ran out`)."""
    for s in scan.get("secrets") or []:
        if isinstance(s, dict) and s.get("pushed") is True:
            return None, f"origin already holds {str(s.get('commit'))[:7]}"
    if scan.get("mergeBehind"):
        return None, "a merge sits at or after it"
    frm = scan.get("rewriteFrom")
    if not frm:
        return None, "the scan named no commit to rewrite from"
    t = within(deadline, SHORT_READ)
    if t is None:
        return None, f"not read: {ran_out(budget)}"
    rc = git(top, "merge-base", "--is-ancestor", base, frm, timeout=t).returncode
    if rc == 1:
        return None, f"{frm[:12]} is below the task's leg_base"
    if rc != 0:
        return None, f"git merge-base exited {rc}"
    t = within(deadline)
    if t is None:
        return None, f"not read: {ran_out(budget)}"
    # One read for the window: each commit's sha, body and paths (renames as both paths, as diff-tree lists them).
    r = git(top, "log", "--no-renames", "--name-only", "--format=%x1e%H%x1f%B%x1f", f"{frm}..HEAD", timeout=t)
    if r.returncode != 0:
        return None, f"cannot list {frm[:12]}..HEAD in {top}"
    pat = re.compile(rf"^\s*Task:\s*\[\[{re.escape(slug)}(?:[|#][^\]]*)?\]\]\s*$", re.M | re.I)
    for rec in r.stdout.split("\x1e"):
        if not rec.strip():
            continue
        sha, body, names = (rec.split("\x1f", 2) + ["", ""])[:3]
        if pat.search(body):
            continue
        paths = [p for p in names.split("\n") if p]
        if paths and all(p.startswith(REVIEWS) for p in paths):
            continue
        return None, f"{sha.strip()[:12]} above it is not this task's (no Task: [[{slug}]] line)"
    return frm, None


def _scan_into(ent, r, tree, deadline, budget):
    """Run security-check.py scan over tree from ent's base (run_scan, the rest of the deadline) and fill ent's
    verdict, exit, error, secrets and scan: rc 0 clean; rc 1 secret when the scan names a secret, else red; rc 2, a cut
    or output that does not parse unscanned, its error the ERROR line after `ERROR: security-check: `, or `timed out:
    the Security check's <B> s budget ran out in <top>`; under 1 s left (within) it never starts, `not scanned: the
    Security check's <B> s budget ran out`."""
    t = within(deadline)
    if t is None:
        ent["error"] = f"not scanned: {ran_out(budget)}"
        return
    argv = [sys.executable, str(rr.SECURITY_CHECK_PY), "scan", "--tree", tree, "--base", ent["base"],
            "--accepts-from", str(r.path)]
    rc, so, se, cut = run_scan(argv, t)
    ent["exit"] = rc
    if cut:
        ent["error"] = f"timed out: {ran_out(budget)} in {ent['top']}"
        return
    scan = None
    if rc in (0, 1) and so.strip():
        try:
            scan = json.loads(so.strip().splitlines()[-1])
        except ValueError:
            scan = None
    if not isinstance(scan, dict):
        pre = "ERROR: security-check: "
        said = [ln.strip() for ln in (se or "").splitlines() if ln.strip().startswith(pre)]
        ent["error"] = (said[-1][len(pre):] if said else
                        f"security-check.py scan exited {rc}" + (" with no result it could read" if rc in (0, 1) else ""))
        return
    ent["scan"] = scan
    ent["secrets"] = [{k: s.get(k) for k in ("rule", "file", "line", "commit", "pushed", "pushedWhy")}
                      for s in scan.get("secrets") or [] if isinstance(s, dict)]
    ent["verdict"] = "clean" if rc == 0 else ("secret" if ent["secrets"] else "red")


def scan_top(r, e, deadline, budget, floor):
    """One security_tops entry scanned: `security`'s per-top step (its docstring is the rule). Its HEAD read (HEAD_READ,
    5 s) is the one call that may run past the deadline; every other is held inside it (within)."""
    top = e["top"]
    ent = {"top": top, "primary": e["primary"], "base": e.get("base"), "head": None, "verdict": "unscanned",
           "exit": None, "error": None, "secrets": [], "uncommitted": [], "rewrite": None, "rewriteWhy": None,
           "scan": None}
    ent["head"] = git_out(top, "rev-parse", "--verify", "HEAD^{commit}", timeout=HEAD_READ)
    if e.get("error"):
        ent["error"] = e["error"]
    elif not ent["base"]:
        ent["error"] = f"no base sha recorded for {top}"
    elif deadline - time.monotonic() < floor:
        ent["error"] = f"not scanned: {ran_out(budget)}"
    elif e["primary"]:
        with scratch_tree(top, deadline, budget) as (wt, why):
            if wt is None:
                ent["error"] = why
            else:
                t = within(deadline, SHORT_READ)
                ent["head"] = (git_out(wt, "rev-parse", "--verify", "HEAD^{commit}", timeout=t) if t else None) \
                    or ent["head"]
                _scan_into(ent, r, wt, deadline, budget)
    else:
        _scan_into(ent, r, top, deadline, budget)
    if ent["primary"] and ent["secrets"]:
        settle_pushed(top, ent["secrets"], deadline, budget)
    ent["uncommitted"] = uncommitted_paths(top, deadline)
    if ent["verdict"] == "secret" and not ent["primary"]:
        ent["rewrite"], ent["rewriteWhy"] = rewrite_point(top, ent["base"], r.slug, ent["scan"], deadline, budget)
    return ent


def security_lines(entries, ask):
    """The `## Security check` section's lines (shell_safe): one per entry that is not clean, then `Ask: <ask>`."""
    lines = []
    for x in entries:
        at = f"- {x['top']} at {(x['head'] or 'no HEAD')[:12]}"
        if x["verdict"] == "clean":
            continue
        if x["verdict"] == "secret":
            found = "; ".join(f"{s['rule']} in {s['file']}, commit {str(s['commit'])[:7]}, line {s['line']}"
                              for s in x["secrets"])
            tail = ("a primary checkout's history, which a Leg never rewrites" if x["primary"] else
                    f"rewrite from {x['rewrite'][:12]}" if x["rewrite"] else f"no rewrite point: {x['rewriteWhy']}")
            lines.append(shell_safe(f"{at}: secret: {found}; {tail}"))
        elif x["verdict"] == "red":
            lines.append(shell_safe(f"{at}: red"))
        else:
            lines.append(shell_safe(f"{at}: unscanned: {x['error']}"))
    if ask:
        lines.append(f"Ask: {ask}")
    return lines


def cmd_security(ctx, a):
    t0 = time.monotonic()
    budget = security_budget()
    deadline = t0 + budget
    chain = Chain(ctx)
    leg = my_leg(ctx, chain)
    n = leg["n"]
    r = task_note(chain, a.task)
    if r.state != "running" or owner_leg(r.note) != n:
        raise Refuse(1, f"[[{r.slug}]] is not Leg {n}'s in_progress claim")
    if not security_on(chain.note):
        raise Refuse(1, f"security_checks is not true on [[{ctx.slug}]]: nothing to scan")
    raw = rr._scalar(chain.note.get(rr.SECURITY_CHECKS_KEY))
    tops = security_tops(ctx, chain, r.note, r.slug)
    out = {"verb": "security", "rollout": ctx.slug, "task": r.slug, "tops": [], "ask": None, "clean": True,
           "dryRun": ctx.dry}
    floor = security_floor()
    entries = [scan_top(r, e, deadline, budget, floor) for e in tops]
    ask = shell_safe(security_ask(entries))
    clean = all(x["verdict"] == "clean" for x in entries)
    if not ctx.dry:
        with Lock(ctx):
            chain = Chain(ctx)
            leg2 = my_leg(ctx, chain)
            r2 = task_note(chain, a.task)
            if leg2["n"] != n or r2.state != "running" or owner_leg(r2.note) != n or \
                    rr._scalar(chain.note.get(rr.SECURITY_CHECKS_KEY)) != raw:
                raise Refuse(1, f"[[{r.slug}]]'s claim or the note's security_checks changed during the scan: run "
                                "security again; nothing written")
            for x in entries:
                if x["head"] is None:
                    continue
                now = git(x["top"], "rev-parse", "--verify", "HEAD^{commit}", timeout=HEAD_READ)
                if now.returncode != 0 or now.stdout.strip() != x["head"]:
                    raise Refuse(1, f"HEAD moved in {x['top']} since the scan: run security again; nothing written")
            note = rr.Note(r2.path)
            if not entries:
                # No tops (no commit since leg_base, say after repair § 7 (c)'s `reset --hard <leg_base sha>`): an
                # earlier run's record and its section are stale, so they go, and done reads no scan.
                note.remove("leg_scan")
            else:
                recs = [f'"{x["top"]}@{x["head"]} {x["verdict"]}"' for x in entries if x["head"]]
                note.set("leg_scan", "[" + ", ".join(recs) + "]", after=("leg_primary_base", "leg_base"))
            if clean:
                note.remove_section(SECURITY_SECTION)
            else:
                note.upsert_section(SECURITY_SECTION, "\n".join(security_lines(entries, ask)))
            save(ctx, note)
            leg_lease(ctx, leg2)
    out.update(tops=entries, ask=ask, clean=clean)
    return out


# ---- done -----------------------------------------------------------------------------------------------------------

def front_matter(path):
    try:
        text = Path(path).read_text()
    except OSError:
        return None
    m = re.match(r"^---\n(.*?)\n---\n", text, re.S)
    if not m:
        return None
    out = {}
    for line in m.group(1).split("\n"):
        mm = re.match(r"^([A-Za-z_]+):\s*(.*?)\s*(?:#.*)?$", line)
        if mm and mm.group(1) not in out:
            out[mm.group(1)] = mm.group(2).strip().strip('"').strip("'")
    return out


def review_fits(doc, t):
    fm = front_matter(doc)
    if fm is None:
        return f"{doc}: no front matter"
    if os.path.realpath(os.path.expanduser(fm.get("repo", ""))) != t["top"]:
        return f"{doc}: repo: {fm.get('repo')!r} is not {t['top']}"
    if fm.get("mode") != "code":
        return f"{doc}: mode: {fm.get('mode')!r}, not code"
    if fm.get("effort") not in ("xhigh", "max"):
        return f"{doc}: effort: {fm.get('effort')!r}, not xhigh or max"
    if fm.get("status") != "consumed":
        return f"{doc}: status: {fm.get('status')!r}, not consumed"
    head = git_out(t["top"], "rev-parse", "--verify", f"{fm.get('head', '')}^{{commit}}") if fm.get("head") else None
    if not head:
        return f"{doc}: head: {fm.get('head')!r} is no commit in {t['top']}"
    if not is_ancestor(t["top"], t["base"], head):
        return f"{doc}: head {head[:12]} does not descend from leg_base {t['base'][:12]}"
    if not is_ancestor(t["top"], head, "HEAD"):
        return f"{doc}: head {head[:12]} is not an ancestor of HEAD"
    if not any(is_ancestor(t["top"], c["sha"], head) for c in t["commits"]):
        return f"{doc}: head {head[:12]} holds none of the task's Task: commits"
    return None


def cmd_done(ctx, a):
    with Lock(ctx):
        chain = Chain(ctx)
        leg = my_leg(ctx, chain)
        n = leg["n"]
        r = task_note(chain, a.task)
        if r.state != "running" or owner_leg(r.note) != n:
            raise Refuse(1, f"[[{r.slug}]] is not Leg {n}'s in_progress claim")
        vl = verify_line(r.note)
        verify = a.verify or "none"
        if vl and verify != "pass":
            raise Refuse(1, f"[[{r.slug}]] has a Verify line: run it green, then `done --verify pass` ({vl})")
        for top, copy, _mine in stray_of(ctx, r.note, r.slug, copies_read(chain)[0]):
            raise Refuse(1, f"[[{r.slug}]] committed in the primary {top}, not its chain copy {copy}: set it aside with "
                            f"--revert, which reverts it there, and redo it in {copy}")
        tops = change_of(r.note, r.slug)
        code = [t for t in tops if t["commits"]]
        cwd_top = toplevel(os.path.realpath(os.path.expanduser(a.cwd or os.getcwd())))
        reviewed = []
        for t in code:
            if t["top"] != cwd_top:
                raise Refuse(1, f"[[{r.slug}]] changed {t['top']}, not this Leg's checkout {cwd_top}: set it aside "
                                f"with --revert (work it from a Leg launched in {t['top']})")
            whys = []
            for doc in a.review:
                why = review_fits(os.path.realpath(os.path.expanduser(doc)), t)
                if why is None:
                    reviewed.append(os.path.realpath(os.path.expanduser(doc)))
                    break
                whys.append(why)
            else:
                raise Refuse(1, f"[[{r.slug}]] wrote code in {t['top']}: it needs a consumed xhigh code review of its "
                                "change (legs.md § Review) before done" + (": " + "; ".join(whys) if whys else ""))
        if security_on(chain.note):
            # The Security check (execute § 3 `security_checks`): done runs no scan; it reads `security`'s latest
            # record, which must be clean and still cover each checkout's commits (a Chain copy's at its HEAD).
            for e in security_tops(ctx, chain, r.note, r.slug):
                if covering(ctx, r.note, e, r.slug) == "clean":
                    continue
                rec = scan_records(r.note).get(e["top"])
                latest = f"{rec[1]} at {rec[0][:12]}" if rec else "none"
                raise Refuse(1, f"[[{r.slug}]]: the Security check (security_checks) has no clean scan covering "
                                f"{e['top']} (a Chain copy's must be at its HEAD; latest: {latest}): run `leg.py security "
                                f"--task {r.slug}` (legs.md § The task loop's Security check)")
        note = rr.Note(r.path)
        note.set("status", "done")
        note.set("completed", ctx.date)
        note.set("leg", str(n), after=("owner",))
        if reviewed:
            note.set("reviewed", "[" + ", ".join(f'"{d}"' for d in reviewed) + "]", after=("leg",))
        if leg_base(note):
            # ADR 0055: per checkout, the task's own newest trailered commit (commits_for lists base..HEAD oldest
            # first), never HEAD, which may be a peer's commit; [] when it committed nowhere. The completion verify's
            # HEAD guard anchors on it.
            heads = [f"{t['top']}@{t['commits'][-1]['sha']}" for t in tops if t["commits"] and not t.get("error")]
            note.set("leg_head", "[" + ", ".join(f'"{h}"' for h in heads) + "]", after=("leg_base",))
            pairs = copies_read(chain)[0]
            if pairs is not None:
                # ADR 0067 d4's actual claims: the files its Task: commits touched, on the primary's paths, that
                # leg.py land checks against other live chains' unlanded files before it lands (bookkeeping aside).
                claims = []
                for t in tops:
                    hit = _pair(pairs, t["top"], side=1)
                    for p in t["paths"]:
                        tok = claim_token(hit[0] if hit else t["top"], p)
                        if not sc.bookkeeping(tok) and sc.fmt_token(tok) not in claims:
                            claims.append(sc.fmt_token(tok))
                note.set("leg_claims", "[" + ", ".join(f'"{c}"' for c in claims) + "]", after=("leg_head",))
        save(ctx, note)
        tail = f"; reviewed {', '.join(reviewed)}" if reviewed else ""
        if not ctx.dry:
            log_line(chain.note, leg_line(ctx, n, f"done [[{r.slug}]] (verify {verify}{tail})"))
            save(ctx, chain.note)
        leg_lease(ctx, leg)
        return {"verb": "done", "rollout": ctx.slug, "leg": n, "task": r.slug, "verify": verify, "reviewed": reviewed,
                "codeWriting": bool(code), "dryRun": ctx.dry}


# ---- set-aside ------------------------------------------------------------------------------------------------------

def plan_revert(ctx, chain, r):
    """Per checkout (top, commits newest-first, paths): the task's trailered commits in each leg_base checkout, then
    those that went into a Chain copy's primary instead (stray_of). Exit 3 when a path to revert is dirty."""
    todo = []
    for t in change_of(r.note, r.slug):
        if t["commits"]:
            todo.append((t["top"], [(c["sha"], None) for c in t["commits"]]))
    for top, _copy, mine in stray_of(ctx, r.note, r.slug, copies_read(chain)[0]):
        todo.append((top, [(sha, ps) for sha, _subj, ps in mine]))
    out = []
    for top, commits in todo:
        paths = []
        for sha, ps in commits:
            if ps is None:
                ps = (git_out(top, "diff-tree", "--no-commit-id", "--name-only", "-r", "--root", sha) or "").split("\n")
            for p in ps:
                if p and p not in paths:
                    paths.append(p)
        spec = [f":(literal){p}" for p in paths]
        dirty = git_out(top, "status", "--porcelain", "--", *spec)
        if dirty:
            raise Refuse(3, f"a path to revert has uncommitted or staged changes in {top}: "
                            f"{dirty.splitlines()[0].strip()} (commit, stash or discard it first); nothing reverted")
        out.append((top, [sha for sha, _ps in reversed(commits)], spec))
    return out


def scratch_diff(top, shas, spec):
    """Revert shas (newest first) in a detached scratch worktree; the diff, or None on a conflict. Always removed."""
    wt = tempfile.mkdtemp(prefix="leg-revert-")
    os.rmdir(wt)
    added = git(top, "-c", "core.hooksPath=/dev/null", "worktree", "add", "-q", "--detach", wt, "HEAD")
    try:
        if added.returncode != 0:
            return None, f"cannot add a scratch worktree: {added.stderr.strip()[:200]}"
        rv = git(wt, "-c", "core.hooksPath=/dev/null", "revert", "--no-commit", "--no-edit", *shas)
        if rv.returncode != 0:
            return None, f"reverting {', '.join(x[:12] for x in shas)} conflicts"
        d = git(wt, "diff", "--cached", "--binary", "HEAD", "--", *spec)
        if d.returncode != 0:
            return None, f"cannot diff the scratch tree: {d.stderr.strip()[:200]}"
        return d.stdout, None
    finally:
        git(top, "worktree", "remove", "--force", wt)
        shutil.rmtree(wt, ignore_errors=True)
        git(top, "worktree", "prune")


def security_gate(ctx, chain, n, r, a):
    """set-aside's Security check gate (execute § 3 `security_checks`; legs.md § The task loop's **Security check.**),
    run after the owner checks and before any write; returns the reason the set-aside records. It reads only this Leg's
    own claim (in progress, owned `leg-<n>`), never a gate set-aside: there a key neither true nor false is security_on's
    exit 1 (`security_checks: must be true or false, got '<v>': fix the note`), and the gate below runs with the key
    true and a non-empty security_tops. A queued or handed-back row, and every row with the key off, keep today's
    path. Refused (exit 1, nothing written): a set-aside without --revert while the task has `Task:` commits
    (change_of) or strays; a top whose latest `leg_scan` record does not cover it (covering: `run leg.py security
    first`), or covers it `unscanned` (close the Leg halt instead: the claim stays), or `secret` in a Chain copy (a
    revert keeps it in the history the next land puts on <d>: rewrite it out first). --scan-ask needs a covering red or
    secret record and the `## Security check`'s `Ask:` line, and records `security check: <that ask>` as the reason,
    so the diagnosis, the `Set-aside:` line and the log line carry it; else exit 1."""
    own = r.state == "running" and owner_leg(r.note) == n
    tops = security_tops(ctx, chain, r.note, r.slug) if own and a.kind != "gate" and security_on(chain.note) else []
    verdicts = []
    if tops:
        pairs = copies_read(chain)[0]
        commits = any(t["commits"] for t in change_of(r.note, r.slug)) or bool(stray_of(ctx, r.note, r.slug, pairs))
        if commits and not a.revert:
            raise Refuse(1, f"[[{r.slug}]] has Task: commits and security_checks is on: set it aside with --revert, after "
                            f"`leg.py security --task {r.slug}`; nothing written")
        for e in tops:
            v = covering(ctx, r.note, e, r.slug)
            if v is None:
                raise Refuse(1, f"run `leg.py security --task {r.slug}` first: {e['top']} has no scan covering its "
                                "commits; nothing written")
            if v == "unscanned":
                raise Refuse(1, f"{e['top']} could not be scanned: close the Leg --outcome halt instead (the claim stays, "
                                "and the next Leg scans again); nothing written")
            if v == "secret" and not e["primary"]:
                hit = _pair(pairs, e["top"], side=1)
                d = (default_branch(hit[0]) if hit else None) or "its primary's default branch"
                raise Refuse(1, f"a secret is in chain/{ctx.slug} in {e['top']}: rewrite it out first (`security` prints "
                                f"`rewrite`): a revert keeps it in the history the next land puts on {d}; nothing "
                                "written")
            verdicts.append(v)
    if not a.scan_ask:
        return a.reason
    ask = scan_ask(r.note) if any(v in ("red", "secret") for v in verdicts) else None
    if not ask:
        raise Refuse(1, "--scan-ask quotes the latest Security check question, and none covers HEAD: give --reason; "
                        "nothing written")
    return f"security check: {ask}"


def cmd_set_aside(ctx, a):
    if a.scan_ask and (not a.revert or a.kind == "gate"):
        raise Usage("--scan-ask takes --revert and a block set-aside: it sets aside a task the Security check found "
                    "red, reverting its commits")
    with Lock(ctx):
        chain = Chain(ctx)
        leg = my_leg(ctx, chain)
        n = leg["n"]
        r = task_note(chain, a.task)
        if r.state not in ("running", "queued"):
            raise Refuse(1, f"[[{r.slug}]] is {rr._status(r.note) or 'open'}: only a claimed or queued task is set aside")
        if r.state == "running" and owner_leg(r.note) not in (None, n):
            raise Refuse(1, f"[[{r.slug}]] is Leg {owner_leg(r.note)}'s claim, not Leg {n}'s")
        kind = a.kind
        gates = real_gates(a.gate)
        if kind == "gate" and not gates:
            raise Refuse(2, "--kind gate needs one --gate per pending gate (`None` is no gate)")
        if kind == "gate" and a.revert:
            raise Refuse(2, "a gate set-aside reverts nothing: gates come before any write")
        reason = security_gate(ctx, chain, n, r, a)
        reverted = []
        if a.revert:
            plans = plan_revert(ctx, chain, r)
            diffs = []
            for top, shas, spec in ([] if ctx.dry else plans):
                diff, why = scratch_diff(top, shas, spec)
                if diff is None:
                    raise Refuse(3, f"{why} in {top}: the checkout is untouched; close the Leg `--outcome halt` and "
                                    "resolve it by hand")
                diffs.append((top, shas, spec, diff))
            if not ctx.dry:
                for top, shas, spec, diff in diffs:
                    if not diff.strip():
                        continue  # the reverted commits' changes are already gone: nothing to commit
                    ap = git(top, "apply", "--index", "-", input=diff)
                    if ap.returncode != 0:
                        raise Refuse(3, f"git apply --index failed in {top}: {ap.stderr.strip()[:200]}")
                    msg = (f"🔧 chore(leg): revert {r.slug}, set aside\n\nTask: [[{r.slug}]]\n"
                           f"Set-aside: {reason_text(reason, 300)}\n")
                    cm = git(top, "-c", "core.hooksPath=/dev/null", "commit", "-q", "-m", msg, "--", *spec)
                    if cm.returncode != 0:
                        raise Refuse(3, f"the revert commit failed in {top}: {cm.stderr.strip()[:200]}")
                    reverted.append((git_out(top, "rev-parse", "HEAD"), top))
        note = rr.Note(r.path)
        note.remove("owner")
        if kind == "gate":
            note.set("status", "gate-pending")
            note.upsert_section(GATES_PENDING, "\n".join(f"- {g.strip()}" for g in gates))
            status = "gate-pending"
        else:
            status = a.status or "blocked"
            note.set("status", status)
            diag = f"Set aside by Leg {n} of [[{ctx.slug}]]: {reason.strip()}"
            if reverted:
                diag += "\n\n" + "\n".join(f"- reverted {sha} in {top}" for sha, top in reverted)
                diag += "\n\nA re-entry restores the work with `git revert <sha>` in that checkout, or starts fresh."
            note.append_run(rr.BLOCKED_SECTIONS.get(status, BLOCKER), diag, ctx.now)
        save(ctx, note)
        if not ctx.dry:
            for sha, top in reverted:
                log_line(chain.note, leg_line(ctx, n, f"reverted {sha} in {top}"))
            log_line(chain.note, leg_line(ctx, n, f"set aside [[{r.slug}]] ({status}): {reason_text(reason, 200)}"))
            save(ctx, chain.note)
        leg_lease(ctx, leg)
        return {"verb": "set-aside", "rollout": ctx.slug, "leg": n, "task": r.slug, "status": status,
                "reverted": [{"sha": s, "top": t} for s, t in reverted], "dryRun": ctx.dry}


# ---- post-items and file-followup ---------------------------------------------------------------------------------------

def post_items(note):
    found = note._section_bounds(POST_ROLLOUT)
    if found is None:
        return []
    lines, start, end = found
    mark = next((k for k in range(start + 1, end) if lines[k].strip() == ITEMS_MARK), None)
    lo = (mark + 1) if mark is not None else start + 1
    items = []
    for k in range(lo, end):
        if re.match(r"^[-*] ", lines[k]):
            text = lines[k][2:].strip()
            pm = re.search(r"→ \[\[([^\]|]+)", text)
            items.append({"k": len(items) + 1, "line": k, "text": text, "pointer": pm.group(1) if pm else None})
    return items


def cmd_post_items(ctx, a):
    chain = Chain(ctx)
    return {"verb": "post-items", "rollout": ctx.slug,
            "items": [{k: v for k, v in i.items() if k != "line"} for i in post_items(chain.note)]}


def set_pointer(note, item_k, name, title):
    note.apply(_set_pointer, item_k, name, title)   # journaled, as log_line


def _set_pointer(note, item_k, name, title):
    found = note._section_bounds(POST_ROLLOUT)
    if found is None:
        note.append_section(POST_ROLLOUT, f"{ITEMS_MARK}\n\n- → [[{name}]]: {title}")
        return
    lines, start, end = found
    items = post_items(note)
    new = f"- → [[{name}]]: {title}"
    if item_k is not None:
        it = next((i for i in items if i["k"] == item_k), None)
        if it is None:
            raise Refuse(1, f"no Post-rollout item {item_k} (there are {len(items)})")
        lines[it["line"]] = new
        note._set_body_lines(lines)
        return
    if items:
        at = items[-1]["line"] + 1
    else:
        mark = next((k for k in range(start + 1, end) if lines[k].strip() == ITEMS_MARK), None)
        if mark is None:
            j = end
            while j > start + 1 and not lines[j - 1].strip():
                j -= 1
            note._set_body_lines(lines[:j] + ["", ITEMS_MARK, "", new] + lines[j:])
            return
        at = mark + 1
        while at < end and not lines[at].strip():
            at += 1
    note._set_body_lines(lines[:at] + [new] + lines[at:])


def write_followup(ctx, chain, name_base, title, body_lines):
    name = free_name(chain, name_base)
    path = ctx.tasks / f"{name}.md"
    body = "\n## Notes\n\n" + "\n".join(body_lines).rstrip() + "\n"
    text = new_task_text(ctx, rr._fm_block(chain.note, "projects"), [], body)
    if not ctx.dry:
        atomic_write(path, text)
    return name, path


def cmd_file_followup(ctx, a):
    with Lock(ctx):
        chain = Chain(ctx)
        leg = my_leg(ctx, chain, closed_ok=True)
        if ctx.archived and a.item is not None:
            raise Refuse(1, f"{ctx.slug} is complete and archived: its Post-rollout items were settled at Complete; "
                            "file the task without --item")
        items = post_items(chain.note)
        if a.item is not None and not any(i["k"] == a.item for i in items):
            raise Refuse(1, f"no Post-rollout item {a.item} (there are {len(items)})")
        item_text = next((i["text"] for i in items if i["k"] == a.item), None)
        where = (f" from its Post-rollout item {a.item}: {item_text}" if a.item is not None
                 else " after its Complete (the archived note holds no pointer to it)" if ctx.archived
                 else " at its close")
        body = [f"# {a.title.strip()}", "", a.why.strip(), "", f"Filed by Leg {leg['n']} of [[{ctx.slug}]]{where}."]
        name, path = write_followup(ctx, chain, f"{project_of(ctx)}-followup-{kebab(a.title)}", a.title, body)
        if not ctx.archived:
            # The archived note is never written: its committed Completion log is the chain's final record.
            set_pointer(chain.note, a.item, name, reason_text(a.title, 120))
            tag = f"post-item {a.item}" if a.item is not None else "close"
            log_line(chain.note, leg_line(ctx, leg["n"], f"follow-on [[{name}]] ({tag})"))
            save(ctx, chain.note)
        return {"verb": "file-followup", "rollout": ctx.slug, "leg": leg["n"], "followup": name, "path": str(path),
                "item": a.item, "pointer": not ctx.archived, "archived": str(ctx.rollout) if ctx.archived else None,
                "dryRun": ctx.dry}


# ---- land (ADR 0067 d3, d4) -------------------------------------------------------------------------------------------

LAND_MERGE = "🔀 land: merge "   # the land merge's subject: `🔀 land: merge <d> into chain/<rollout>` (check_cause reads it)
LAND_TRIES = 3
ROW_IN_PROGRESS = "a row is in progress: a land never merges mid-task"
VERIFIED_RE = re.compile(r"^land verified: (.+) at ([0-9a-f]{40})$")


class RepoLock:
    """A primary checkout's land lock (ADR 0067 d3): an exclusive fcntl.flock on `<git common dir>/thread/chain-land.lock`,
    taken after the rollout's lock, one at a time, each released (its descriptor closed) before the next and never
    nested, so two chains in one repo land in turn and no lock cycle forms. `held` is False past lock_timeout() (that
    copy then stands, exit 0, never 5) or when the common dir cannot be read. --dry-run takes none."""

    def __init__(self, ctx, P):
        common = _common(P)
        self.path = os.path.join(common, "thread", "chain-land.lock") if common else None
        self.skip, self.fd, self.held, self.timeout = ctx.dry, None, False, lock_timeout()

    def __enter__(self):
        if self.skip:
            self.held = True
            return self
        if self.path is None:
            return self
        try:
            os.makedirs(os.path.dirname(self.path), exist_ok=True)
            self.fd = os.open(self.path, os.O_RDWR | os.O_CREAT, 0o644)
        except OSError:
            self.fd = None
            return self
        deadline = time.monotonic() + self.timeout
        while True:
            try:
                fcntl.flock(self.fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                self.held = True
                return self
            except OSError:
                if time.monotonic() >= deadline:
                    os.close(self.fd)
                    self.fd = None
                    return self
                time.sleep(0.05)

    def __exit__(self, *exc):
        if self.fd is not None:
            os.close(self.fd)   # the release, as Lock's
            self.fd = None
        return False


def land_leg(ctx, chain):
    """The Leg a land runs as: the open Leg, when it is this session's (my_leg's rule); with no Leg open, the last one,
    when its session is this one or either is `unknown` (handed's rule), so close § Under a Leg runs it after
    `leg.py close`. Refuse(1) otherwise."""
    leg = chain.open_leg()
    if leg is None and chain.legs:
        leg = chain.legs[chain.last_n()]
    if leg is not None and (ctx.session == "unknown" or leg["session"] in (None, "unknown", ctx.session)):
        return leg
    raise Refuse(1, "no Leg of this session: run leg.py begin first")


def claim_token(P, path):
    """A committed path's actual claim (ADR 0067 d4): `repo:<P>//<path>`, P the primary checkout, so the token reads the
    same from any copy; a path read_list could not read back from a quoted list (a `"`, or a ` #` comment mark) claims
    the whole checkout, `repo:<P>`."""
    if '"' in path or re.search(r"\s#", path):
        return sc.parse_token(f"repo:{P}")
    try:
        return sc.parse_token(f"repo:{P}//{path}")
    except ValueError:
        return sc.parse_token(f"repo:{P}")


def heads_on(note, C):
    """A task's `leg_head` shas whose top is the Chain copy C (case-folded realpaths)."""
    k = _fold(C)
    return [sha for top, sha in rr._leg_tops(note, "leg_head") if _fold(top) == k]


def off_default(chain, P, C, d):
    """unl: the done counted rows with a `leg_head` entry on C that refs/heads/<d> in P does not reach (git is the truth,
    so a hand merge counts as landed)."""
    out = []
    for r in chain.counted():
        if r.state == "done" and r.note is not None and \
                any(not is_ancestor(P, s, f"refs/heads/{d}") for s in heads_on(r.note, C)):
            out.append(r)
    return out


def row_claims(r, pairs):
    """A done row's actual claims: its `leg_claims:` tokens, else (a row done before done stamped them) change's paths
    as `repo:<primary>//<path>`; bookkeeping is never a claim (ADR 0067 d5)."""
    raw = sc.read_list(r.note, "leg_claims")
    toks = []
    if raw is not None:
        for x in raw:
            try:
                toks.append(sc.parse_token(x))
            except ValueError:
                continue
    else:
        for t in change_of(r.note, r.slug):
            hit = _pair(pairs, t["top"], side=1)
            toks += [claim_token(hit[0] if hit else t["top"], p) for p in t["paths"]]
    out = []
    for t in toks:
        if not sc.bookkeeping(t) and t not in out:
            out.append(t)
    return out


def other_serial(ctx):
    """[(path, note)]: every other root-level note in the tasks dir that is `shape: serial`, neither done nor dropped,
    with no `superseded_by:`: the chains land's claim check and in-place peer check read. An unreadable note is
    skipped (no Note), and a frontmatter that never says `serial` is never parsed."""
    out = []
    for path in sorted(ctx.tasks.glob("*.md")):
        if path.stem.lower() == ctx.slug.lower():
            continue
        try:
            text = path.read_text()
        except (OSError, UnicodeDecodeError):
            continue
        m = re.match(r"^---\n(.*?\n)---\n", text, re.S)
        if not m or not re.search(r"^shape:.*serial", m.group(1), re.M | re.I):
            continue
        try:
            note = rr.Note(path, text)
        except ValueError:
            continue
        if rr._shape(note) != "serial" or rr._status(note) in ("done", "dropped") or \
                rr._valued(note.get("superseded_by")):
            continue
        out.append((path, note))
    return out


def peer_chain(ctx, path):
    """Another serial note read as a Chain (unfinished-rollout.py's chain_hold pattern)."""
    return Chain(SimpleNamespace(rollout=path, tasks=ctx.tasks, vault=ctx.vault, slug=path.stem, archived=False))


def claim_stand(ctx, chain, P, d, ours, notes, warns):
    """Step 5, ADR 0067 d4's actual claims: ours (this copy's unlanded rows' claims) against every other live chain with
    a Chain copy of P whose done rows are unlanded (unlanded_done, and git confirms: its `leg_head` on its copy is not on
    refs/heads/<d>), their `leg_claims:`. The why of a stand for the first overlap with a chain that sorts before this
    one (order_key, rank-led: chain_key reads both sides' estate rank and `captured:`), else None: a later chain never
    blocks, and an unreadable note is a WARN (git's merge and the re-run Verify lines stay the backstop)."""
    if not ours:
        return None
    me, best = chain_key(chain), None
    for path, note in notes:
        try:
            pairs = sc.read_chain_copies(note)
        except ValueError:
            continue
        hit = next(((c, p) for c, p in pairs or [] if _fold(c) == _fold(P)), None)
        if hit is None:
            continue
        try:
            X = peer_chain(ctx, path)
        except Exception as e:  # noqa: BLE001 — chain_hold's catch: an unreadable chain is skipped, with a WARN
            why = e.msg if isinstance(e, Refuse) else f"{type(e).__name__}: {e}"
            warns.append(f"WARN: [[{path.stem}]] could not be read ({reason_text(why, 120)}): its unlanded files are not "
                         f"checked against this land in {P}; git's merge is the backstop")
            continue
        key = chain_key(X)
        if not key < me:
            continue
        theirs = []
        for r in X.counted():
            if not unlanded_done(X, r):
                continue
            shas = heads_on(r.note, hit[1])
            if not shas or all(is_ancestor(P, s, f"refs/heads/{d}") for s in shas):
                continue
            for x in sc.read_list(r.note, "leg_claims") or []:
                try:
                    tok = sc.parse_token(x)
                except ValueError:
                    continue
                if not sc.bookkeeping(tok) and tok not in theirs:
                    theirs.append(tok)
        m = sc.overlap_pairs(ours, theirs)
        if m and (best is None or key < best[0]):
            best = (key, path.stem, m[0][1])
    if best is None:
        return None
    return f"[[{best[1]}]] holds {sc.fmt_token(best[2])} unlanded and {first_by(best[0], me)}"


def peer_works(X):
    """What a live in-place chain works (begin's surface re-check reads the same sets): its open Leg's write set and
    launch folders, plus each running row's cell tokens (else the note's claim), folder and a `repo:<top>` per
    `leg_base` top. (tokens, folders)."""
    toks, folders = [], []
    ol = X.open_leg()
    if ol is not None:
        toks += write_set(X, ol["n"])
        folders += [ol["folder"]] + [r.folder for r in write_rows(X, ol["n"])]
    for r in X.counted():
        if r.state != "running":
            continue
        toks += [sc.fmt_token(t) for t in (_cell_tokens(r) or _note_claim(X) or [("any", "")])]
        folders.append(r.folder)
        toks += [f"repo:{top}" for top, _sha in leg_base(r.note)] if r.note is not None else []
    return toks, [f for f in folders if f]


def _is_any(tok):
    try:
        return sc.parse_token(tok)[0] == "any" if isinstance(tok, str) else tok[0] == "any"
    except ValueError:
        return False


def surfaces_may_work(note, P):
    """Whether an unreadable chain's frontmatter `surfaces:` names P, or reads as any (empty, unparseable or `any`)."""
    raw = sc.read_surfaces(note)
    if not raw:
        return True
    try:
        toks = [sc.parse_token(x) for x in raw]
    except ValueError:
        return True
    return any(t[0] == "any" or sc.overlaps(t, ("repo", P)) for t in toks)


def peer_stand(ctx, P, d, notes, warns):
    """Step 7a, the in-place peer check, run right before the fast-forward in P: (why, waits, peer slug) for the first
    live serial chain that works P in place (no `chain_copies:`, or a malformed one, read as in place as
    unfinished-rollout.py's copied_of reads it), else None. Live: a Leg open, or a counted row in progress. A chain that
    cannot be read stands the copy only when its `surfaces:` names P or reads as any (fix its note), else a WARN."""
    vault = os.path.realpath(os.path.expanduser(str(ctx.vault)))
    for path, note in notes:
        try:
            if sc.read_chain_copies(note) is not None:
                continue   # a copy chain is no peer: it meets this one file to file, in claim_stand
        except ValueError:
            pass
        try:
            X = peer_chain(ctx, path)
            ol = X.open_leg()
            run = next((r for r in X.counted() if r.state == "running"), None)
            if ol is None and run is None:
                continue
            toks, folders = peer_works(X)
        except Exception as e:  # noqa: BLE001 — chain_hold's catch
            why = reason_text(e.msg if isinstance(e, Refuse) else f"{type(e).__name__}: {e}", 120)
            if surfaces_may_work(note, P):
                return (f"[[{path.stem}]] could not be read ({why}) and may work {P} in place: fix its note", False,
                        path.stem)
            warns.append(f"WARN: [[{path.stem}]] could not be read ({why}); its surfaces: name no {P}, so this land "
                         "goes on")
            continue
        works = any(_fold(c) == _fold(P) for c in sc.checkouts_of(toks, folders, toplevel, vault)) or \
            any(_is_any(t) for t in toks)
        if works:
            label = f"Leg {ol['n']} open" if ol is not None else f"[[{run.slug}]] in progress"
            return (f"[[{path.stem}]] works {P} in place ({label}): a land never moves a checked-out {d} under another "
                    "chain's live work", True, path.stem)
    return None


def _git_files(stderr):
    """The tab-indented paths of git's `would be overwritten` refusal."""
    return [ln.strip() for ln in (stderr or "").split("\n") if ln.startswith("\t") and ln.strip()]


def bring_in(ctx, P, C, d, br):
    """Step 4: d brought into C, never by rebase, so every `leg_head` stays an ancestor: `merge --ff-only` when the tip is
    d or behind it, nothing when it already holds d, else a `--no-ff` land merge. Hooks off, never an autostash.
    (tip, dm, how, stand): dm the d sha the tip now holds, how none|ff|merge, stand (why, waits) or None. --dry-run
    merges nothing and gives the tip it would start from."""
    tip = git_out(P, "rev-parse", "-q", "--verify", f"refs/heads/{br}^{{commit}}")
    dm = git_out(P, "rev-parse", "-q", "--verify", f"refs/heads/{d}^{{commit}}")
    if not tip or not dm:
        return None, dm, None, (f"cannot read refs/heads/{br} or refs/heads/{d} in {P}", False)
    if tip == dm or is_ancestor(P, dm, tip):
        return tip, dm, "none", None
    how = "ff" if is_ancestor(P, tip, dm) else "merge"
    if ctx.dry:
        return tip, dm, how, None
    if how == "ff":
        r = git(C, "-c", "core.hooksPath=/dev/null", "merge", "--ff-only", "--no-autostash", "-q", f"refs/heads/{d}")
    else:
        r = git(C, "-c", "core.hooksPath=/dev/null", "-c", "merge.autoStash=false", "merge", "--no-ff", "--no-edit",
                "-m", f"{LAND_MERGE}{d} into {br}", f"refs/heads/{d}")
    if r.returncode != 0:
        unmerged = [p for p in (git_out(C, "diff", "--name-only", "--diff-filter=U") or "").split("\n") if p]
        if git(C, "rev-parse", "-q", "--verify", "MERGE_HEAD").returncode == 0:
            git(C, "merge", "--abort")
        if unmerged:
            return None, dm, how, (f"conflict in {', '.join(unmerged)}", False)
        lines = [ln.strip() for ln in (r.stderr or r.stdout).split("\n") if ln.strip()]
        files = _git_files(r.stderr)
        line = (lines[0] if lines else f"exit {r.returncode}") + (f" {', '.join(files)}" if files else "")
        return None, dm, how, (f"git merge refused in {C}: {reason_text(line, 200)}", False)
    return git_out(C, "rev-parse", "--verify", "HEAD^{commit}"), dm, how, None


def overlap_paths(P, ref):
    """live-checkout.sh's overlap mode in P against the full ref <ref> (the paths a fast-forward to it would overwrite):
    ("overlap", paths), ("clear", None), or ("broken", why) on a non-zero exit, a run past 60 s, an OSError or any
    other output."""
    try:
        r = subprocess.run(["bash", str(LIVE_CHECKOUT_SH), "overlap", str(P), ref], env=_env(), capture_output=True,
                           text=True, stdin=subprocess.DEVNULL, timeout=60)
    except subprocess.TimeoutExpired:
        return "broken", "ran past 60 s"
    except OSError as e:
        return "broken", f"failed: {e}"
    if r.returncode != 0:
        return "broken", f"exit {r.returncode}"
    out = r.stdout.rstrip("\n")
    if out == "clear":
        return "clear", None
    if out.startswith("overlap ") and "\n" not in out and out[len("overlap "):].strip():
        return "overlap", out[len("overlap "):]
    return "broken", f'unrecognised output "{reason_text(out, 80)}"'


def ff_primary(ctx, P, d, br, tip, dm, notes, warns):
    """Step 7: d moved to the tip, by where d is checked out: nowhere, a compare-and-swap `update-ref`; in another
    worktree, a stand; in P, after the in-place peer check and a re-read of P's HEAD (P off d stands), d and the branch
    read again, and a merge only when d is still dm and strictly behind the branch, its overlap clear:
      1. d unreadable: moved;
      2. d already the branch: no merge (a no-op ff-only rewrites ORIG_HEAD), landed when it is the tip, else moved;
      3. d moved since step 4 (d != dm): moved, before any overlap is read, so the re-run from step 4 can ask for a
         re-verify against the new d (a d that moved but is still behind the branch re-runs too, never fast-forwards
         at once);
      4. the branch unreadable, or not holding d: a stand naming it (`cannot read refs/heads/<br> in <P>`,
         `refs/heads/<br> does not hold <d> in <P>: no fast-forward`), no merge;
      5. live-checkout.sh's overlap mode against refs/heads/<br>: a dirty or untracked path the ff would overwrite
         stands, `the primary's uncommitted edit on <paths>`, with no merge run, so ORIG_HEAD is untouched (never a
         stash); a mode that cannot run is a WARN and the merge goes on, git's own refusal its only guard;
      6. `merge --ff-only --no-autostash`, hooks off: landed only when d is then the tip. A refusal the overlap cannot
         see (an index.lock, a case-only collision) still stands with git's words, and rewrites ORIG_HEAD.
    The target is the local refs/heads/<br>, not origin, so lc_ff (which merges refs/remotes/origin/<d>) is not used.
    (result, stand): result landed|moved (d moved, or the ff moved d short of the tip: re-run from step 4)|stood|plan,
    stand (why, waits, peer slug or None), or for --dry-run the path it would take."""
    where = next((wt for wt, b in _worktree_branches(P) if b == f"refs/heads/{d}"), None)
    if where is None:
        if ctx.dry:
            return "plan", "update-ref (no worktree has it checked out)"
        r = git(P, "update-ref", "-m", f"land: {br}", f"refs/heads/{d}", tip, dm)
        return ("landed", None) if r.returncode == 0 else ("moved", None)
    if _fold(where) != _fold(P):
        return "stood", (f"{d} is checked out in {where}", False, None)
    peer = peer_stand(ctx, P, d, notes, warns)
    if peer is not None:
        return "stood", peer
    if ctx.dry:
        return "plan", f"merge --ff-only in {P}"
    # The peer check read every serial note: re-read P's branch, so the merge moves d and no branch P switched to.
    head = git_out(P, "symbolic-ref", "-q", "HEAD")
    if head != f"refs/heads/{d}":
        return "stood", (f"{P} left {d} during the land (its HEAD is now {head or 'detached'})", True, None)
    # No merge unless d is strictly behind the branch: git writes ORIG_HEAD on a no-op or refused ff-only.
    cur = git_out(P, "rev-parse", "-q", "--verify", f"refs/heads/{d}^{{commit}}")
    if not cur:
        return "moved", None
    want = git_out(P, "rev-parse", "-q", "--verify", f"refs/heads/{br}^{{commit}}")
    if want and cur == want:
        return ("landed", None) if cur == tip else ("moved", None)
    if cur != dm:
        return "moved", None
    if not want:
        return "stood", (f"cannot read refs/heads/{br} in {P}", False, None)
    if not is_ancestor(P, cur, want):
        return "stood", (f"refs/heads/{br} does not hold {d} in {P}: no fast-forward", False, None)
    kind, said = overlap_paths(P, f"refs/heads/{br}")
    if kind == "overlap":
        return "stood", (f"the primary's uncommitted edit on {said}", False, None)
    if kind == "broken":
        warns.append(f"WARN: {P}: live-checkout.sh overlap {said}: the fast-forward ran with git's own refusal as its "
                     "only guard")
    r = git(P, "-c", "core.hooksPath=/dev/null", "-c", "merge.autoStash=false", "merge", "--ff-only", "--no-autostash",
            "-q", f"refs/heads/{br}")
    now = git_out(P, "rev-parse", "-q", "--verify", f"refs/heads/{d}^{{commit}}")
    if r.returncode == 0:
        return ("landed", None) if now == tip else ("moved", None)   # moved: P switched after the re-read
    if now != dm:
        return "moved", None
    files = _git_files(r.stderr)
    if files:
        return "stood", (f"the primary's uncommitted edit on {', '.join(files)}", False, None)
    line = next((ln.strip() for ln in (r.stderr or r.stdout).split("\n") if ln.strip()), f"exit {r.returncode}")
    return "stood", (f"git merge --ff-only refused in {P}: {reason_text(line, 200)}", False, None)


def verified_tips(chain, P):
    """The verified tips V the Leg log records for P (`land verified: <P> at <V>`, any Leg)."""
    out = []
    for e in chain.log:
        m = VERIFIED_RE.match(e["rest"]) if e["kind"] == "land verified" else None
        if m and _fold(m.group(1)) == _fold(P) and m.group(2) not in out:
            out.append(m.group(2))
    return out


def needs_verify(P, C, r, dm, tip, tips):
    """Step 6: whether an unl row's Verify line runs again: unless dm is already in its `leg_head` (it passed on top of
    that d), or a verified tip V holds its head and dm and the tip holds V."""
    for h in heads_on(r.note, C):
        if is_ancestor(P, dm, h):
            continue
        if any(is_ancestor(P, h, V) and is_ancestor(P, dm, V) and is_ancestor(P, V, tip) for V in tips):
            continue
        return True
    return False


def land_entry(P, C, br):
    return {"checkout": P, "copy": C, "branch": br, "default": None, "state": None, "head": None, "merged": None,
            "verify": None, "landed": [], "why": None, "waits": None}


def land_copy(ctx, chain, P, C, pairs, verified, notes, warns):
    """Steps 1-8 for one pair P -> C (the module docstring's land). (entry, the verified tip it accepted or None)."""
    br = f"chain/{ctx.slug}"
    e = land_entry(P, C, br)
    acc = [None]   # a --verified tip accepted on an earlier try is logged even when a later try stands

    def stand(why, waits):
        e.update(state="stood", why=why, waits=waits)
        return e, acc[0]

    d = default_branch(P)
    e["default"] = d
    if d is None:
        return stand(f"{P} has no default branch resolved (origin/HEAD, main or master)", False)
    if toplevel(C) != os.path.realpath(C):
        return stand(f"its Chain copy {C} is missing: leg.py begin remakes it", False)
    st = git(C, "status", "--porcelain", "--untracked-files=no")
    if st.returncode != 0 or st.stdout.strip():
        return stand(f"its Chain copy {C} has uncommitted changes" if st.returncode == 0
                     else f"its Chain copy {C}'s status cannot be read", False)
    with RepoLock(ctx, P) as lk:
        if not lk.held:
            return stand(f"another land held {lk.path} past {lk.timeout:g}s" if lk.path
                         else f"cannot read {P}'s git common dir", lk.path is not None)
        unl = off_default(chain, P, C, d)
        ours = []
        for r in unl:
            ours += [t for t in row_claims(r, pairs) if t not in ours]
        tips = verified_tips(chain, P)
        for _try in range(LAND_TRIES):
            tip, dm, how, s = bring_in(ctx, P, C, d, br)
            if s is not None:
                return stand(*s)
            e.update(head=tip, merged=dm)
            if tip == dm:
                e["state"] = "current"
                return e, acc[0]
            if tip in verified and tip not in tips:
                tips.append(tip)
                acc[0] = tip
            # Step 5, after step 4's merge: a claim stand keeps that merge on chain/<rollout> (as --red does), so the
            # copy holds the work other chains landed on d and the next land asks for its re-verify.
            why = claim_stand(ctx, chain, P, d, ours, notes, warns) if _try == 0 else None
            if why:
                if ctx.dry:
                    e.update(state="plan", plan={"unl": [r.slug for r in unl], "claim": why, "bring": how,
                                                 "verify": [], "ff": None, "peer": None})
                    return e, None
                return stand(why, True)
            if ctx.dry:   # the plan: nothing merged, moved or written, no lock taken
                res, got = ff_primary(ctx, P, d, br, tip, dm, notes, warns)
                e.update(state="plan", plan={"unl": [r.slug for r in unl], "claim": None, "bring": how,
                                             "verify": [r.slug for r in unl if needs_verify(P, C, r, dm, tip, tips)],
                                             "ff": got if res == "plan" else None,
                                             "peer": got[0] if res == "stood" else None})
                return e, None
            need = [r for r in unl if needs_verify(P, C, r, dm, tip, tips)]
            if need:
                e.update(state="verify", verify=[{"task": r.slug, "line": verify_line(r.note),
                                                  "folder": sc.copy_folder(r.folder, pairs) if r.folder else None}
                                                 for r in need])
                return e, acc[0]
            res, s = ff_primary(ctx, P, d, br, tip, dm, notes, warns)
            if res == "landed":
                e.update(state="landed", landed=[r.slug for r in unl])
                return e, acc[0]
            if res == "stood":
                return stand(s[0], s[1])
        return stand(f"{d} kept moving", True)


def stamp_landed(ctx, chain, pairs):
    """`leg_landed: <stamp>` on each done row, not yet stamped, whose every `leg_head` entry on a Chain copy is on its
    primary's default branch (git's read). The slugs stamped."""
    out = []
    for r in chain.counted():
        if r.state != "done" or r.note is None or rr._valued(r.note.get("leg_landed")):
            continue
        entries = [(hit[0], sha) for top, sha in rr._leg_tops(r.note, "leg_head")
                   for hit in [_pair(pairs, top, side=1)] if hit is not None]
        if not entries:
            continue
        ok = True
        for P, sha in entries:
            d = default_branch(P)
            if not d or not is_ancestor(P, sha, f"refs/heads/{d}"):
                ok = False
                break
        if ok:
            note = rr.Note(r.path)
            note.set("leg_landed", ctx.stamp, after=("leg_claims", "leg_head"))
            save(ctx, note)
            out.append(r.slug)
    return out


def _last_land_line(chain, P):
    """The chain's last `land:` or `land stood:` line for P (its rest), or None."""
    for e in reversed(chain.log):
        if e["kind"] == "land stood" and e["rest"].startswith(f"land stood: {P}: "):
            return e["rest"]
        if e["kind"] == "land" and f" in {P} (" in e["rest"]:
            return e["rest"]
    return None


def stood_line(chain, P, why):
    """`land stood: <P>: <why>`, or None when the chain's last land line for P is that same stand."""
    text = f"land stood: {P}: {reason_text(why, 400)}"
    return None if _last_land_line(chain, P) == text else text


def cmd_land(ctx, a):
    if a.red is not None and a.verified:
        raise Usage("--red goes alone: never with --verified")
    if a.retire and (a.verified or a.red is not None):
        raise Usage("--retire takes neither --verified nor --red")
    if a.red is not None and not a.red.strip():
        raise Usage("--red needs its why")
    for v in a.verified:
        if not re.fullmatch(r"[0-9a-f]{40}", v):
            raise Usage(f"--verified {v!r} is not a full commit sha (40 hex)")
    if a.retire:
        # The copy removed may be this process's cwd: resolve every path, prime git's env, and leave the cwd first.
        ctx.rollout = Path(os.path.realpath(ctx.rollout))
        ctx.tasks = Path(os.path.realpath(ctx.tasks))
        ctx.vault = Path(os.path.realpath(ctx.vault))
        _env()
    with Lock(ctx):
        chain = Chain(ctx)
        note = chain.note
        if rr._shape(note) != "serial":
            raise Refuse(1, f"{ctx.slug} is not a serial rollout (shape: {rr._scalar(note.get('shape')) or 'parallel'}): "
                            "only a serial chain lands")
        st = rr._status(note)
        if st == "dropped" or rr._valued(note.get("superseded_by")):
            raise Refuse(1, f"{ctx.slug} is {'dropped' if st == 'dropped' else 'superseded'}: nothing lands it")
        pairs = chain_pairs(chain)
        done = st == "done" or ctx.archived
        if done and not a.retire:
            raise Refuse(1, f"{ctx.slug} is complete: only `leg.py land --retire` runs after its Complete")
        if a.retire and not done:
            raise Refuse(1, f"{ctx.slug} is not done: `leg.py land --retire` runs only after its Complete")
        leg = land_leg(ctx, chain)
        out = {"verb": "land", "rollout": ctx.slug, "leg": leg["n"], "inPlace": pairs is None, "lands": [],
               "stamped": [], "warns": [], "dryRun": ctx.dry}
        if pairs is None:
            if a.retire:
                out["retired"] = []
            return out
        if a.retire:
            return land_retire(ctx, chain, leg, pairs, out)
        leg_lease(ctx, leg)   # p36-7: an open Leg's land renews its lease (a closed one's never does)
        if a.red is not None:
            return land_red(ctx, chain, leg, pairs, a.red, out)
        return land_all(ctx, chain, leg, pairs, a.verified, out)


def land_all(ctx, chain, leg, pairs, verified, out):
    """Every copy, one at a time, then the stamp and the Leg log (the module docstring's land)."""
    running = next((r for r in chain.counted() if r.state == "running"), None)
    notes = other_serial(ctx) if running is None else []
    lines = []
    for P, C in pairs:
        if running is not None:   # no git and no repo lock
            e, accepted = land_entry(P, C, f"chain/{ctx.slug}"), None
            e.update(state="stood", why=ROW_IN_PROGRESS, waits=False)
        else:
            e, accepted = land_copy(ctx, chain, P, C, pairs, verified, notes, out["warns"])
        out["lands"].append(e)
        if accepted:
            text = f"land verified: {P} at {accepted}"
            if not any(x["kind"] == "land verified" and x["rest"] == text for x in chain.log):
                lines.append(text)
        if e["state"] == "landed":
            what = ", ".join(f"[[{s}]]" for s in e["landed"]) or "close-outs"
            lines.append(f"land: {what} on {e['default']} in {P} ({(e['head'] or '')[:12]})")
        elif e["state"] == "stood":
            text = stood_line(chain, P, e["why"])
            if text:
                lines.append(text)
    if ctx.dry:
        return out
    out["stamped"] = stamp_landed(ctx, chain, pairs)   # the task notes first, the rollout note last
    for text in lines:
        log_line(chain.note, leg_line(ctx, leg["n"], text))
    save(ctx, chain.note)
    return out


def land_red(ctx, chain, leg, pairs, why, out):
    """--red: a land's re-verify went red. `land stood: <P>: Verify red after a land merge: <why>` per copy whose chain
    branch holds commits its default branch lacks (every copy when none does); no git write: the merge stays on
    chain/<rollout> with no verified tip, so the next land asks again."""
    br = f"chain/{ctx.slug}"
    hit = []
    for P, _C in pairs:
        d = default_branch(P)
        tip = git_out(P, "rev-parse", "-q", "--verify", f"refs/heads/{br}^{{commit}}")
        if d and tip and not is_ancestor(P, tip, f"refs/heads/{d}"):
            hit.append(P)
    reason = f"Verify red after a land merge: {why.strip()}"
    for P in hit or [P for P, _C in pairs]:
        e = land_entry(P, dict(pairs).get(P), br)
        e.update(state="stood", why=reason, waits=False)
        out["lands"].append(e)
        text = stood_line(chain, P, reason)
        if text and not ctx.dry:
            log_line(chain.note, leg_line(ctx, leg["n"], text))
    save(ctx, chain.note)
    out["red"] = why.strip()
    return out


def land_retire(ctx, chain, leg, pairs, out):
    """--retire, after Complete (the archived note is never written): per copy, under its repo lock, land its close-out
    commits (steps 4 and 7, the peer check included), remove the copy (`git worktree remove`, never --force) and delete
    its branch (`--set-upstream-to=<d>`, then `branch -d`, never -D). A done row off d, or any stand, keeps both, with a
    WARN; any WARN files one loose follow-on that names the command that finishes it."""
    first = os.path.realpath(pairs[0][0]) if pairs else None
    if first and os.path.isdir(first):
        os.chdir(first)
    br = f"chain/{ctx.slug}"
    notes = other_serial(ctx)
    retired, kept = [], []
    for P0, C0 in pairs:
        P, C = os.path.realpath(P0), os.path.realpath(C0)
        ent = {"checkout": P, "copy": C, "branch": br, "landed": False, "removed": False, "branchDeleted": False,
               "why": None}
        retired.append(ent)
        d = default_branch(P)
        has_branch = git(P, "show-ref", "--verify", "-q", f"refs/heads/{br}").returncode == 0
        exists = os.path.lexists(C0) and toplevel(C) == C
        peer = None
        if d is None:
            ent["why"] = f"{P} has no default branch resolved (origin/HEAD, main or master)"
        else:
            with RepoLock(ctx, P) as lk:
                if not lk.held:
                    ent["why"] = (f"another land held {lk.path} past {lk.timeout:g}s" if lk.path
                                  else f"cannot read {P}'s git common dir")
                elif exists:
                    off = off_default(chain, P, C, d)
                    st = git(C, "status", "--porcelain", "--untracked-files=no")
                    if off:
                        ent["why"] = f"[[{off[0].slug}]] is not on {d} in {P}"
                    elif st.returncode != 0 or st.stdout.strip():
                        ent["why"] = f"its Chain copy {C} has uncommitted changes"
                    else:
                        ent["why"], peer = _retire_land(ctx, P, C, d, br, notes, out["warns"], ent)
                else:
                    git(P, "worktree", "prune")
                    if has_branch:
                        tip = git_out(P, "rev-parse", "-q", "--verify", f"refs/heads/{br}^{{commit}}")
                        dm = git_out(P, "rev-parse", "-q", "--verify", f"refs/heads/{d}^{{commit}}")
                        if tip and dm and (tip == dm or is_ancestor(P, tip, dm)):
                            ent["landed"] = True
                        elif tip and dm and is_ancestor(P, dm, tip):
                            res, s = ff_primary(ctx, P, d, br, tip, dm, notes, out["warns"])
                            if res in ("landed", "plan"):
                                ent["landed"] = res == "landed"
                            else:
                                ent["why"] = s[0] if s else f"{d} moved"
                                peer = s[2] if s else None
                        else:
                            ent["why"] = f"{br} has commits {d} lacks, and its Chain copy is gone"
                    else:
                        ent["landed"] = True
        if ent["why"] is None and not ctx.dry:
            if exists:
                r = git(P, "worktree", "remove", C)
                if r.returncode != 0:
                    ent["why"] = f"git worktree remove refused: {reason_text((r.stderr or r.stdout).strip(), 200)}"
                else:
                    ent["removed"] = True
            if ent["why"] is None and has_branch:
                git(P, "branch", f"--set-upstream-to={d}", br)
                r = git(P, "branch", "-d", br)
                if r.returncode != 0:
                    git(P, "branch", "--unset-upstream", br)
                    ent["why"] = f"git branch -d refused: {reason_text((r.stderr or r.stdout).strip(), 200)}"
                else:
                    ent["branchDeleted"] = True
        if ent["why"] is not None:
            out["warns"].append(f"WARN: {C} (chain/{ctx.slug} of {P}) kept: {ent['why']}")
            kept.append((ent, peer))
    out["retired"] = retired
    out["followup"] = None
    if kept:
        cmd = (f"`python3 {HERE / 'leg.py'} land --retire --rollout {ctx.rollout} --session {ctx.session}` (from "
               "this engine root)")
        body = ["# Retire the serial chain's Chain copies", "",
                f"[[{ctx.slug}]] completed, but `leg.py land --retire` kept these (never `-D`, never `--force`):", ""]
        for ent, peer in kept:
            when = f"once [[{peer}]]'s Leg closes" if peer else "once that is fixed"
            body.append(f"- `{ent['copy']}` (`{br}` of `{ent['checkout']}`): {ent['why']}; {when}, run {cmd}")
        name, _path = write_followup(ctx, chain, f"{project_of(ctx)}-followup-retire-chain-{ctx.date}",
                                     "Retire the serial chain's Chain copies", body)
        out["followup"] = name
    return out


def _retire_land(ctx, P, C, d, br, notes, warns, ent):
    """--retire's land of the close-out commits: steps 4 and 7 (the peer check included), up to three tries. (why or
    None, the peer slug when a peer stood it)."""
    for _try in range(LAND_TRIES):
        tip, dm, _how, s = bring_in(ctx, P, C, d, br)
        if s is not None:
            return s[0], None
        if tip == dm:
            ent["landed"] = True
            return None, None
        res, s = ff_primary(ctx, P, d, br, tip, dm, notes, warns)
        if res == "landed":
            ent["landed"] = True
            return None, None
        if res == "plan":
            return None, None
        if res == "stood":
            return s[0], s[2]
    return f"{d} kept moving", None


# ---- close ----------------------------------------------------------------------------------------------------------

def needs_you(ctx, chain, outcome, reason):
    out = []
    for r in chain.rows:
        if r.state != "set-aside":
            continue
        st = rr._status(r.note)
        if st == "gate-pending":
            for g in r.note.section_text(GATES_PENDING).split("\n"):
                g = re.sub(r"^[-*]\s+", "", g.strip())
                if g:
                    out.append(f"[[{r.slug}]] sign off gated input: {g}")
        else:
            diag = r.note.latest_run_text(rr.BLOCKED_SECTIONS.get(st, BLOCKER)).split("\n")[0]
            out.append(f"[[{r.slug}]] set aside ({st}): {reason_text(diag, 140)}: hand it back with "
                       f"reconcile-rollout.py hand-back --tasks {r.slug}, or defer it")
    if outcome in ("stopped", "halt"):
        word = "stopped" if outcome == "stopped" else "halted"
        out.append(f"[[{ctx.slug}]] {word} ({ctx.date}): {reason_text(reason or '', 140)}: see /thread:status "
                   f"[[{ctx.slug}]], fix it and re-invoke")
    return out


def route(top):
    try:
        r = subprocess.run(["bash", str(LAND_SH), "--route", "--", top], env=_env(), capture_output=True, text=True,
                           timeout=60)
        line = (r.stdout.strip().split("\n") or [""])[-1]
    except subprocess.TimeoutExpired:
        return "stuck", "land.sh --route timed out"
    except OSError as e:
        return "stuck", f"land.sh --route failed: {e}"
    if line.startswith("landable "):
        return "landable", line[len("landable "):].strip()
    if line.startswith("not landed: "):
        return "deferred", line[len("not landed: "):]
    if line.startswith("stuck: "):
        return "stuck", line[len("stuck: "):]
    return "stuck", f"land.sh --route gave no route (rc {r.returncode})"


def chain_commits(chain, top):
    """[(sha, subject, task)] of every chain task's Task: commits in top, deduped, oldest first."""
    seen, out = set(), []
    for r in chain.rows:
        if r.note is None or r.state == "deferred":
            continue
        for t, base in leg_base(r.note):
            if t != top:
                continue
            mine, _ = commits_for(top, base, r.slug)
            for sha, subj, _p in mine or []:
                if sha not in seen:
                    seen.add(sha)
                    out.append((sha, subj, r.slug))
    return out


def land_plan(chain):
    """Per chain checkout: (top, kind, detail, commits needing action, copy). Read-only. In place copy is None. A top
    that is a Chain copy reads its primary's route (the copy's own reads `not landed: on chain/<slug>`): its commits
    are those not on the primary's default branch d, plus, when landable, those origin/<d> lacks, and every one on a
    stuck route (which cannot say what origin has); copy is {checkout, branch, default, offDefault}."""
    plans = []
    pairs = copies_read(chain)[0]
    for top in chain.chain_tops():
        commits = chain_commits(chain, top)
        hit = _pair(pairs, top, side=1)
        if hit is not None:
            P = hit[0]
            kind, detail = route(P)
            d = default_branch(P)
            off = [c for c in commits if not (d and is_ancestor(P, c[0], f"refs/heads/{d}"))]
            gone = []
            if kind == "landable":
                ref = f"refs/remotes/origin/{detail}"
                has_ref = git(P, "rev-parse", "-q", "--verify", ref).returncode == 0
                gone = [c for c in commits if not (has_ref and is_ancestor(P, c[0], ref))]
            # A stuck route cannot say whether origin has them, so every chain commit needs action, as in place.
            need = list(commits) if kind == "stuck" else [c for c in commits if c in off or c in gone]
            plans.append((top, kind, detail, need, {"checkout": P, "branch": f"chain/{chain.ctx.slug}", "default": d,
                                                    "offDefault": off}))
            continue
        kind, detail = route(top)
        if kind == "landable":
            ref = f"refs/remotes/origin/{detail}"
            has_ref = git(top, "rev-parse", "-q", "--verify", ref).returncode == 0
            missing = [c for c in commits if not (has_ref and is_ancestor(top, c[0], ref))]
            plans.append((top, kind, detail, missing, None))
        elif kind == "deferred":
            plans.append((top, kind, detail, [], None))
        else:
            plans.append((top, kind, detail, commits, None))
    return plans


def leg_summary(log, n_now, ctx):
    """The Completion log's line per Leg: its launch, begun–closed, the tasks it finished and set aside."""
    lines, legs = [], parse_legs(log)
    for n in sorted(legs):
        g = legs[n]
        done = [e["slug"] for e in log if e["n"] == n and e["kind"] == "done" and e["slug"]]
        aside = [e["slug"] for e in log if e["n"] == n and e["kind"] == "set aside" and e["slug"]]
        closed = g["closedStamp"] or (ctx.stamp if n == n_now else "?")
        lines.append(f"- Leg {n}: `{g['alias']}` from `{g['folder']}`, {g['began']}–{closed}; done "
                     f"{', '.join(f'[[{s}]]' for s in done) or 'none'}; set aside "
                     f"{', '.join(f'[[{s}]]' for s in aside) or 'none'}")
    return lines


def cmd_close(ctx, a):
    outcome = a.outcome
    if outcome in ("stopped", "halt") and not (a.reason or "").strip():
        raise Usage(f"--outcome {outcome} needs --reason")
    if outcome == "complete" and not (a.reflection or "").strip():
        raise Usage("--outcome complete needs --reflection <close-score.py's line> (legs.md § Complete step 3)")
    if outcome != "complete" and a.reflection is not None:
        raise Usage("--reflection goes with --outcome complete only")
    dispositions = {}
    for d in a.disposition:
        k, sep, text = d.partition("=")
        if not sep or not k.strip().isdigit():
            raise Usage(f"--disposition {d!r}: write <k>=<text>")
        dispositions[int(k)] = text.strip().strip('"')
    plans = None
    if outcome == "complete":
        pre = Chain(ctx)
        plans = land_plan(pre)
    with Lock(ctx):
        chain = Chain(ctx)
        leg = my_leg(ctx, chain)
        n = leg["n"]
        owned = [r.slug for r in chain.rows if r.state == "running" and r.note is not None and owner_leg(r.note) == n]
        if owned and outcome in ("handoff", "complete", "stuck"):
            raise Refuse(1, f"Leg {n} still owns [[{owned[0]}]] (in_progress): finish it (`done`) or set it aside "
                            "first; a Leg closes only between tasks")
        cwd_top = toplevel(os.path.realpath(os.path.expanduser(a.cwd or os.getcwd())))
        commit_only = ([cwd_top] if cwd_top else []) + [t for t in chain.chain_tops() if t != cwd_top]
        out = {"verb": "close", "rollout": ctx.slug, "leg": n, "outcome": outcome, "commit_only": commit_only}
        if outcome == "handoff":
            chain.contend = rank_contention(ctx, chain, n + 1, dead=(n,))   # a fresh Leg's view (ADR 0067 d9)
            plan = plan_next(chain, n + 1, None, None, cap=False, launch=False)
            row = plan.get("row")
            if row is None:
                raise Refuse(1, f"nothing to hand over (next is {plan['action']}): run legs.md § Complete (its close "
                                "--outcome complete takes --reflection), or close --outcome stuck")
            line = f"closed: handoff to Leg {n + 1} in {row.alias} from {row.folder}"
            prog = chain.progress(n)
            pairs = copies_read(chain)[0]   # the next Leg opens in the row's folder inside its Chain copy
            where = (sc.copy_folder(row.folder, pairs) if pairs else None) or os.path.expanduser(row.folder)
            out["handover"] = {
                "title": leg_title(ctx, n + 1), "prompt": leg_prompt(ctx, n + 1),
                "tldr": (f"Leg {n + 1} of the {project_of(ctx)} serial chain. {prog['done']} of {prog['total']} tasks "
                         "are done; it picks up at the next row."),
                "cwd": os.path.realpath(where), "harness": launch_harness(row.alias),
                "launch": chain_launch(pairs, row.alias, row.folder), "task": row.slug}
        elif outcome == "complete":
            plan = plan_next(chain, n, None, None, cap=False, launch=False)
            if plan["action"] != "complete":
                raise Refuse(1, f"the chain is not complete (next is {plan['action']}): close it another way")
            dest = ctx.tasks / "Archive" / "Rollouts" / ctx.rollout.name
            if dest.exists():
                raise Refuse(1, f"archive collision: {dest} exists; nothing written (rename or remove it, then re-run)")
            items = post_items(chain.note)
            lacking = [i["k"] for i in items if i["pointer"] is None and i["k"] not in dispositions]
            if lacking:
                raise Refuse(1, f"Post-rollout item(s) {', '.join(map(str, lacking))} have neither a follow-on pointer "
                                "nor a --disposition: nothing written")
            landed_gate(chain)
            completion_gate(chain)
            line = "closed: chain complete"
        elif outcome == "stuck":
            k = sum(1 for r in chain.rows if r.state == "set-aside")
            line = f"closed: chain stuck: {k} set aside"
        elif outcome == "stopped":
            line = f"closed: stopped: {reason_text(a.reason, 200)}"
        else:
            line = f"closed: halted: {reason_text(a.reason, 200)}"
        if outcome == "complete":
            return _complete(ctx, a, chain, leg, plans, dispositions, items, out, line)
        if not ctx.dry:
            log_line(chain.note, leg_line(ctx, n, line))
            save(ctx, chain.note)
            rr._lease_drop(ctx.slug)   # p36-7: a closed Leg holds no place (a stopped or halted claim counts no more)
        prog = chain.progress(n)
        out["progress"] = prog
        out["needs_you"] = needs_you(ctx, chain, outcome, a.reason)
        if outcome == "stuck":
            out["status_line"] = status_line(ctx.slug, prog, "halted",
                                             f"awaiting you: {sum(1 for r in chain.rows if r.state == 'set-aside')} set aside")
        elif outcome == "stopped":
            out["status_line"] = status_line(ctx.slug, prog, "halted", f"stopped: {a.reason}")
        elif outcome == "halt":
            out["status_line"] = status_line(ctx.slug, prog, "halted", f"halt: {a.reason}")
        out["dryRun"] = ctx.dry
        return out


def landed_gate(chain):
    """complete's refusal (ADR 0067 d3): a done row whose `leg_head` entry on a Chain copy is not on its primary's local
    default branch (git is the truth: a hand merge counts), or a primary whose default branch is unresolved, is exit 1
    with nothing written; legs.md § Complete's Land first runs leg.py land until every copy is landed or current. In
    place it passes."""
    pairs = copies_read(chain)[0]
    if not pairs:
        return
    for r in chain.counted():
        if r.state != "done" or r.note is None:
            continue
        for top, sha in rr._leg_tops(r.note, "leg_head"):
            hit = _pair(pairs, top, side=1)
            if hit is None:
                continue
            P = hit[0]
            d = default_branch(P)
            if d is None:
                raise Refuse(1, f"[[{r.slug}]] cannot land: {P} has no default branch resolved (origin/HEAD, main or "
                                "master): fix that checkout, then run leg.py land (legs.md § Complete's Land first); "
                                "nothing written")
            if not is_ancestor(P, sha, f"refs/heads/{d}"):
                raise Refuse(1, f"[[{r.slug}]] is not on {d} in {P}: run leg.py land first (legs.md § Complete's Land "
                                "first); nothing written")


def completion_gate(chain):
    """complete's refusal (ADR 0055): a `completion_verifier:` its reader refuses, or one whose completion verify is not
    decided (green, flake or red), is exit 1 with nothing written."""
    try:
        verifier, _bootstrap, _timeout = rr._completion_config(chain.note)
    except rr.CompletionValueError as e:
        raise Refuse(1, f"completion verify: {e}: fix the note; nothing written")
    if verifier:
        state, attempt, _last, _streak = rr._completion_state(chain.note)
        if state not in rr.COMPLETION_DECIDED:
            raise Refuse(1, f"the completion verify is not decided ({state}, attempt {attempt}): run legs.md § "
                            "Complete's completion verify first, or remove the note's completion_verifier: to "
                            "complete without it; nothing written")


def completion_of(ctx, chain):
    """The decided completion verify as {state, summary, followup} and the fix task's path to commit (a red's, in the
    tasks root), or (None, None) when the note declares no `completion_verifier:` (completion_gate passed first)."""
    verifier, _bootstrap, _timeout = rr._completion_config(chain.note)
    if not verifier:
        return None, None
    state, _attempt, last, _streak = rr._completion_state(chain.note)
    found = rr._find_note(ctx.tasks, f"{rr.COMPLETION_RED_PREFIX}{ctx.slug}") if state == "red" else None
    followup = found.stem if found else None
    commit = found if found is not None and found.parent == ctx.tasks else None
    return {"state": state, "summary": rr._completion_summary(state, last, verifier, followup),
            "followup": followup}, commit


def _complete(ctx, a, chain, leg, plans, dispositions, items, out, line):
    n = leg["n"]
    completion, red_path = completion_of(ctx, chain)
    written, chain_lines, followups = [], [], []
    # A Chain copy's commits off its primary's default branch need their merge there, whatever its route; leg.py land
    # has put every done task's there before Complete (landed_gate), so a copy files only the origin half, as in place,
    # unless a commit is still off that branch (ADR 0067 d3).
    need = [p for p in plans if p[3] and (p[4] is not None or p[1] != "deferred")]
    land_name = None
    if need:
        body = ["# Land the serial chain's commits", "",
                f"[[{ctx.slug}]] finished, but some of its tasks' `Task:` commits are not on origin. ADR 0028 lands "
                "only close-out commits on its own, so these wait for you:", ""]
        for top, kind, detail, commits, copy in need:
            act = "open a PR from them, or push them"
            if copy is not None:
                P, br, d = copy["checkout"], copy["branch"], copy["default"]
                dn = f"`{d}`" if d else "its default branch"
                tail = (act if kind == "landable" else f"it goes no further: not landed: {detail}" if kind == "deferred"
                        else f"check the landing route ({detail}), then {act}")
                merge = (f"merge `{br}` into {dn} there (with {dn} checked out: `git -C {P} merge {br}`), then"
                         if copy["offDefault"] else f"`{br}` is already on {dn}:")
                body.append(f"- `{top}` (`{br}` of `{P}`): {merge} {tail}")
            else:
                if kind == "stuck":
                    act = f"check the landing route ({detail}), then {act}"
                body.append(f"- `{top}` ({'origin/' + detail if kind == 'landable' else kind}): {act}")
            for sha, subj, task in commits:
                body.append(f"  - `{sha[:12]}` {subj} ([[{task}]])")
        base = f"{project_of(ctx)}-followup-land-chain-{ctx.date}"
        land_name, land_path = write_followup(ctx, chain, base, "Land the serial chain's commits", body)
        written.append(land_path)
        followups.append(land_name)
        set_pointer(chain.note, None, land_name, "land the chain's commits")
        log_line(chain.note, leg_line(ctx, n, f"follow-on [[{land_name}]] (land)"))
    for top, kind, detail, commits, copy in plans:
        if copy is not None:
            head, d, off = f"{top} ({copy['branch']} of {copy['checkout']})", copy["default"], copy["offDefault"]
            dn = d or "its default branch"
            stuck = f"; stuck: {detail}" if kind == "stuck" else ""
            if off:
                chain_lines.append(f"{head}: {len(off)} not on {dn}{stuck} → [[{land_name}]]")
            elif stuck and commits:
                chain_lines.append(f"{head}: all on {dn}{stuck} → [[{land_name}]]")
            elif commits:
                chain_lines.append(f"{head}: all on {dn}, {len(commits)} not on origin/{detail} → [[{land_name}]]")
            elif kind == "deferred":
                chain_lines.append(f"{head}: all on {dn}; not landed: {detail}, nothing filed")
            else:
                chain_lines.append(f"{head}: all on {dn}" + (f" and origin/{detail}" if kind == "landable" else ""))
        elif kind == "landable":
            chain_lines.append(f"{top}: {len(commits)} not on origin/{detail} → [[{land_name}]]" if commits
                               else f"{top}: all on origin/{detail}")
        elif kind == "deferred":
            chain_lines.append(f"{top}: not landed: {detail}, nothing filed")
        else:
            chain_lines.append(f"{top}: stuck: {detail} → [[{land_name}]]" if commits
                               else f"{top}: stuck: {detail}, no chain commits")
    log_line(chain.note, leg_line(ctx, n, line))
    chain.note.set("status", "done")
    chain.note.set("completed", ctx.date, after=("status",))
    items = post_items(chain.note)
    disp = []
    for i in items:
        if i["k"] in dispositions:
            disp.append(f"{i['k']}. {dispositions[i['k']]}")
        elif i["pointer"]:
            disp.append(f"{i['k']}. → [[{i['pointer']}]]")
    # this Leg's earlier follow-ons, filed by file-followup before close
    for e in chain.log:
        if e["n"] == n and e["kind"] == "follow-on" and e["slug"] and e["slug"] not in followups:
            followups.append(e["slug"])
    content = leg_summary(parse_log(chain.note), n, ctx)
    if completion:
        content.append(f"- {completion['summary']}")
    content += [f"- {l.strip()}" if not l.strip().startswith("- ") else l.strip() for l in a.log_line]
    content.append("- Post-rollout items: " + ("; ".join(disp) if disp else "none"))
    if chain_lines:
        content += [f"- Chain commits: {l}" for l in chain_lines]
    else:
        content.append("- Chain commits: none")
    content.append(f"- Reflection: {reason_text(a.reflection, 300)}")
    chain.note.append_section(COMPLETION_LOG, "\n".join(content))
    prog = chain.progress(n)
    out.update(progress=prog, needs_you=[], followups=followups,
               status_line=status_line(ctx.slug, prog, "done"), dryRun=ctx.dry)
    if completion:
        out["completionVerify"] = completion
    if ctx.dry:
        out.update(archived=None, committed=False)
        return out
    save(ctx, chain.note)
    rr._lease_drop(ctx.slug)   # p36-7: the last Leg's close drops its lease
    dest = ctx.tasks / "Archive" / "Rollouts" / ctx.rollout.name
    dest.parent.mkdir(parents=True, exist_ok=True)
    vault = ctx.vault
    tracked = git(vault, "ls-files", "--error-unmatch", "--", str(ctx.rollout)).returncode == 0
    moved = False
    if tracked:
        moved = git(vault, "mv", "--", str(ctx.rollout), str(dest)).returncode == 0
    if not moved:
        os.rename(ctx.rollout, dest)
        tracked = False
    paths = [str(dest)] + [str(ctx.tasks / f"{f}.md") for f in followups if (ctx.tasks / f"{f}.md").exists()]
    paths += [str(red_path)] if red_path is not None and red_path.exists() else []
    paths += [str(Path(os.path.expanduser(p)).resolve()) for p in a.also]
    committed = False
    if toplevel(str(vault)):
        add = git(vault, "add", "--", *paths)
        msg = (f"📝 docs(rollout): {ctx.slug} complete, archived\n\nThe serial chain's last Leg (Leg {n}) ran its "
               "Complete (execute legs.md § Complete).\n")
        if add.returncode == 0:
            cm = git(vault, "-c", "core.hooksPath=/dev/null", "commit", "-q", "-m", msg, "--",
                     *(paths + ([str(ctx.rollout)] if tracked else [])))
            committed = cm.returncode == 0
            if not committed:
                out["commitError"] = (cm.stderr or cm.stdout).strip()[:200]
        else:
            out["commitError"] = add.stderr.strip()[:200]
    out.update(archived=str(dest), committed=committed)
    return out


def cmd_handed(ctx, a):
    if bool(a.started) == bool(a.manual):
        raise Usage("handed takes exactly one of --started <id> and --manual <why>")
    with Lock(ctx):
        chain = Chain(ctx)
        cands = [g for g in chain.legs.values() if (g["closed"] or "").startswith("handoff to Leg")
                 and (ctx.session == "unknown" or g["session"] in (ctx.session, "unknown", None))]
        if not cands:
            raise Refuse(1, "no Leg of this session closed with a handoff: run `leg.py close --outcome handoff` first")
        leg = max(cands, key=lambda g: g["n"])
        n = leg["n"]
        m = re.match(r"handoff to Leg (\d+) in (\S+) from (.*)$", leg["closed"])
        nxt, alias, folder = (int(m.group(1)), m.group(2), m.group(3)) if m else (n + 1, "?", "?")
        pairs = copies_read(chain)[0]   # the Leg log names the Queue folder; the next Leg opens in its Chain copy
        folder = (sc.copy_folder(folder, pairs) if pairs and m else None) or folder
        if leg["handover"] is None and not ctx.dry:
            text = f"hand-over: started {a.started.strip()}" if a.started else f"hand-over: manual ({reason_text(a.manual, 200)})"
            log_line(chain.note, leg_line(ctx, n, text))
            save(ctx, chain.note)
            chain = Chain(ctx)
            leg = chain.legs[n]
        prog = chain.progress(n)
        if (leg["handover"] or "").startswith("started") or (leg["handover"] is None and a.started):
            line = status_line(ctx.slug, prog, "done", f"handed off to Leg {nxt}")
        else:
            line = status_line(ctx.slug, prog, "halted", f"manual handoff: Leg {nxt} in {alias} from {folder}")
        return {"verb": "handed", "rollout": ctx.slug, "leg": n, "handover": leg["handover"], "status_line": line,
                "dryRun": ctx.dry}


def cmd_clear_halt(ctx, a):
    with Lock(ctx):
        chain = Chain(ctx)
        halt = chain.halt()
        if halt is None:
            raise Refuse(1, "no halt stands: nothing to clear")
        if not ctx.dry:
            log_line(chain.note, f"- {ctx.stamp} halt cleared: {reason_text(a.reason, 200)}")
            save(ctx, chain.note)
        return {"verb": "clear-halt", "rollout": ctx.slug, "cleared": halt[0], "leg": halt[1], "dryRun": ctx.dry}


# ---- status and restarted (/thread:status § 5, /thread:repair § 7) ---------------------------------------------------

OUTCOME_WORDS = (("handoff to Leg", "handoff"), ("chain complete", "complete"), ("chain stuck", "stuck"),
                 ("stopped:", "stopped"), ("halted:", "halted"), ("lost", "lost"))


def leg_outcome(closed):
    """A Leg's close line as one word (OUTCOME_WORDS), or None while it is open."""
    if closed is None:
        return None
    return next((w for prefix, w in OUTCOME_WORDS if closed.startswith(prefix)), "other")


def dependants(chain, row):
    """The row's dependants (the module docstring's): transitive, through `merged_into:` tombstones, in Queue order."""
    cands = [r for r in chain.counted() if r.state != "done" and r.note is not None]
    keys, found = {row.slug.lower()}, set()
    grew = True
    while grew:
        grew = False
        for d in cands:
            k = d.slug.lower()
            if k in keys:
                continue
            if any(rr._fold_unit(e, chain.index)[0].lower() in keys for e in rr._dep_entries(d.note)):
                keys.add(k)
                found.add(k)
                grew = True
    return [{"slug": r.slug, "state": r.state, "owner": rr._scalar(r.note.get("owner")) or None}
            for r in chain.rows if r.slug.lower() in found]


def pending_gates(note):
    out = []
    for g in note.section_text(GATES_PENDING).split("\n"):
        g = re.sub(r"^[-*]\s+", "", g.strip())
        if g:
            out.append(g)
    return out


def row_held(chain, r, contend=None):
    """Why next holds row r, or None: its dependencies (holds_of), else the rank's reason (ADR 0067 d9), from contend."""
    if r.state == "missing":
        return "note not found"
    if r.note is None:
        return None
    if r.state == "running" and owner_leg(r.note) is None and rr._valued(r.note.get("owner")):
        return f"in progress ({rr._scalar(r.note.get('owner'))})"
    if r.state == "queued" or (r.state == "running" and not rr._valued(r.note.get("owner"))):
        why = holds_of(chain, r)
        h = ((contend or {}).get("held") or {}).get(r.slug.lower())
        if not why and h is not None:
            why = [h["why"]]
        return "; ".join(why) or None
    return None


def row_json(chain, r, contend=None):
    note = r.note
    out = {"n": r.i + 1, "slug": r.slug, "state": r.state, "status": (rr._status(note) or None) if note else None,
           "owner": (rr._scalar(note.get("owner")) or None) if note else None, "leg": None,
           "launch": r.launch if r.alias else None, "fix": None, "fixes": None, "held": row_held(chain, r, contend),
           "deps": [],
           "dependants": [], "setAside": None}
    if note is None:
        return out
    k = rr._scalar(note.get("leg"))
    out["leg"] = int(k) if k.isdigit() else None
    out["fix"] = rr._wikilink_slug(rr._scalar(note.get("verifies"))) or None
    out["fixes"] = rr._wikilink_slug(rr._scalar(note.get("fixes"))) or None
    out["deps"] = [rr._fold_unit(e, chain.index)[0] for e in rr._dep_entries(note)]
    if r.state not in ("done", "deferred", "other"):
        out["dependants"] = dependants(chain, r)
    if r.state == "set-aside":
        st = rr._status(note)
        if st == "gate-pending":
            gates = pending_gates(note)
            summary = "gated input awaiting sign-off: " + ("; ".join(gates) or "none listed")
        else:
            gates = []
            summary = note.latest_run_text(rr.BLOCKED_SECTIONS.get(st, BLOCKER)).split("\n")[0].strip()
        out["setAside"] = {"status": st, "summary": summary, "gates": gates, "fingerprint": rr._block_fingerprint(note)}
    return out


def legs_json(chain):
    out = []
    for n in sorted(chain.legs):
        g = chain.legs[n]
        own = [e for e in chain.log if e["n"] == n]
        # A lost Leg's `closed: lost` line is its taker's, written at the take-over: never this Leg's own activity.
        mine = [e for e in own if not (e["kind"] == "closed" and e["rest"].split(":", 1)[1].strip().startswith("lost"))]

        def tasks(kind):
            return [{"task": e["slug"], "at": e["stamp"]} for e in own if e["kind"] == kind and e["slug"]]

        took = []
        for e in own:
            m = re.search(r"\(inherited from Leg (\d+)\)", e["rest"]) if e["kind"] == "took" and e["slug"] else None
            if m:
                took.append({"task": e["slug"], "at": e["stamp"], "from": int(m.group(1))})
        aside = []
        for e in own:
            m = re.match(r"^set aside \[\[[^\]]*\]\] \(([^)]*)\)", e["rest"]) if e["kind"] == "set aside" else None
            if m and e["slug"]:
                aside.append({"task": e["slug"], "at": e["stamp"], "status": m.group(1)})
        smoke = [{"task": e["slug"], "at": e["stamp"], "result": e["rest"].split("]]", 1)[-1].strip()}
                 for e in own if e["kind"] == "smoke" and e["slug"]]
        reverted = []
        for e in own:
            m = re.match(r"^reverted (\S+) in (.*)$", e["rest"]) if e["kind"] == "reverted" else None
            if m:
                reverted.append({"sha": m.group(1), "top": m.group(2), "at": e["stamp"]})
        out.append({"n": n, "owner": f"leg-{n}", "session": g["session"], "alias": g["alias"], "folder": g["folder"],
                    "began": g["began"], "closed": g["closed"], "closedStamp": g["closedStamp"],
                    "outcome": leg_outcome(g["closed"]), "handover": g["handover"], "tookOver": g["tookOver"],
                    "lastAt": mine[-1]["stamp"] if mine else None, "claimed": tasks("claimed"), "took": took,
                    "done": tasks("done"), "setAside": aside, "smoke": smoke, "filed": tasks("filed"),
                    "reverted": reverted, "followOns": tasks("follow-on")})
    return out


def cleared_json(chain):
    """Every `halt cleared:` line as {at, reason, leg}: leg is the halted Leg it cleared (the latest `closed: halted:`
    line before it)."""
    out, halted = [], None
    for e in chain.log:
        if e["kind"] == "closed" and leg_outcome(e["rest"].split(":", 1)[1].strip()) == "halted":
            halted = e["n"]
        elif e["kind"] == "halt cleared":
            out.append({"at": e["stamp"], "reason": e["rest"], "leg": halted})
    return out


def stall_of(chain, open_leg):
    """The stall (the module docstring's): claimed rows of a closed or absent Leg, with no Leg open; else None."""
    if open_leg is not None:
        return None
    claimed = []
    for r in chain.rows:
        if r.state != "running" or r.note is None:
            continue
        k = owner_leg(r.note)
        if k is None:
            continue
        g = chain.legs.get(k)
        if g is None or g["closed"] is not None:
            claimed.append({"task": r.slug, "owner": f"leg-{k}", "leg": k,
                            "legOutcome": leg_outcome(g["closed"]) if g else "absent"})
    if not claimed:
        return None
    held = ", ".join(f"[[{c['task']}]] (leg-{c['leg']}, {c['legOutcome']})" for c in claimed)
    return {"claimed": claimed,
            "why": f"no Leg is open, yet {held} is claimed: the next Leg inherits it, and nothing starts that Leg"}


def restart_of(ctx, chain, plan, n, open_leg, halt, restarted):
    """The restart (the module docstring's) from a fresh Leg N's contention-aware plan (status's freshRank), or None. A
    `wait` (ADR 0067 d9) is built from its row, as a claim is."""
    if plan["action"] not in ("finish", "claim", "wait", "complete"):
        return None
    take = open_leg is not None
    first, _, rest = leg_prompt(ctx, n).partition("\n")
    prompt = f"{first} --take-over\n{rest}" if take else f"{first}\n{rest}"
    prog = chain.progress()
    out = {"leg": n, "title": leg_title(ctx, n), "prompt": prompt, "takeOver": take}
    pairs, bad = copies_read(chain)   # a Chain copy's chain opens each Leg in its row's folder inside the copy
    if plan["action"] == "complete":
        last = chain.legs.get(chain.last_n()) if chain.legs else None
        folder = (last or {}).get("folder")
        mapped = sc.copy_folder(folder, pairs) if folder and pairs else None
        cwd = os.path.realpath(mapped or os.path.expanduser(folder)) if folder else os.path.realpath(ctx.vault)
        out.update(tldr=(f"Leg {n} of the {project_of(ctx)} serial chain. All {prog['total']} tasks are done; it runs "
                         "the chain's Complete."),
                   cwd=cwd, harness=None, launch=None, task=None, anyLaunch=True)
    else:
        row = plan["row"]
        lead = "takes over the open Leg and " if take else ""
        mapped = sc.copy_folder(row.folder, pairs) if pairs and row.folder else None
        out.update(tldr=(f"Leg {n} of the {project_of(ctx)} serial chain. {prog['done']} of {prog['total']} tasks are "
                         f"done; it {lead}picks up at the next row."),
                   cwd=os.path.realpath(mapped or os.path.expanduser(row.folder)), harness=launch_harness(row.alias),
                   launch=chain_launch(pairs, row.alias, row.folder), task=row.slug, anyLaunch=False)
    blocked = None
    if halt is not None:
        blocked = "halt"
    elif restarted is not None:
        blocked = f"restart Leg {restarted['leg']} ({restarted['how']})"
    elif take:
        blocked = f"open Leg {open_leg['n']} (session {open_leg['session'] or 'unknown'})"
    elif chain.legs:
        last = chain.legs[chain.last_n()]
        ho = last["handover"] or ""
        if leg_outcome(last["closed"]) == "handoff" and ho.startswith("started "):
            blocked = f"handover started {ho[len('started '):].strip()}"
    if blocked is None and bad:
        blocked = f"chain_copies: {bad}: fix the note"
    elif blocked is None and mapped and not os.path.isdir(out["cwd"]):
        hit = next(((c, p) for c, p in pairs if mapped == p or mapped.startswith(p.rstrip("/") + "/")), None)
        blocked = (f"chain copy missing: {hit[1] if hit else mapped} (leg.py copies --rollout "
                   f"{os.path.realpath(ctx.rollout)} remakes it)")
    out["blockedBy"] = blocked
    return out


def chain_state(chain, inc, paused, superseded, halt, restarted, open_leg, stall, fresh):
    """The chain state (the module docstring's): the first that matches."""
    st = rr._status(chain.note)
    last = chain.legs.get(chain.last_n()) if chain.legs else None
    counted = chain.counted()
    if st == "done":
        return "complete"
    if st == "dropped":
        return "dropped"
    if superseded:
        return "superseded"
    if inc:
        return "incomplete"
    if paused:
        return "paused"
    if halt is not None:
        return "halted"
    if restarted is not None:
        return "restarting"
    if open_leg is not None:
        return "live"
    if last is not None and leg_outcome(last["closed"]) == "handoff":
        return "awaiting-successor"
    if counted and all(r.state == "done" for r in counted):
        return "completable"
    if last is not None and leg_outcome(last["closed"]) == "stopped":
        return "stopped"
    if stall is not None:
        return "stalled"
    if not any(g["began"] for g in chain.legs.values()):
        return "not-started"
    if fresh["action"] == "stuck":
        return "stuck"
    return "ready"


# ---- the hold (ADR 0060) ---------------------------------------------------------------------------------------------

def _cell_tokens(r):
    """A Queue row's Surfaces cell as canonical tokens, or None when the cell is empty or holds a token parse_token
    refuses."""
    if not r.surfaces:
        return None
    try:
        return [sc.parse_token(t) for t in r.surfaces]
    except ValueError:
        return None


def _note_claim(chain):
    """The note's `surfaces:` as canonical tokens, or None (none, or one parse_token refuses: it reads as `any`)."""
    raw = sc.read_surfaces(chain.note)
    if not raw:
        return None
    try:
        return [sc.parse_token(t) for t in raw]
    except ValueError:
        return None


def unlanded_done(chain, r):
    """A Chain copy's done row not yet landed (ADR 0067 d3): the note carries `chain_copies:` (a malformed one reads as
    in place), and r is done, with `leg_claims:` (done's stamp), a non-empty `leg_head` and no `leg_landed:` (land's).
    Pure: hold_of reads it; land and Complete ask git, which counts a hand merge too."""
    if r.state != "done" or r.note is None:
        return False
    try:
        if sc.read_chain_copies(chain.note) is None:
            return False
    except ValueError:
        return False
    return (sc.read_list(r.note, "leg_claims") is not None and bool(rr._leg_tops(r.note, "leg_head"))
            and not rr._valued(r.note.get("leg_landed")))


def leg_claim_tokens(r):
    """A done row's `leg_claims:` as canonical tokens, bookkeeping aside (ADR 0067 d5), a malformed one skipped."""
    out, raw = [], (sc.read_list(r.note, "leg_claims") if r.note is not None else None) or []
    for x in raw:
        try:
            tok = sc.parse_token(x)
        except ValueError:
            continue
        if not sc.bookkeeping(tok) and tok not in out:
            out.append(tok)
    return out


def holder_tokens(chain, r):
    """What row r holds against another chain's claim (ADR 0067 d9): a row in progress its Surfaces cell (else the
    note's claim, else `any`); a done row not yet landed (unlanded_done) that cell plus its `leg_claims:`, bookkeeping
    aside; any other row nothing. Pure: one helper for hold_of's `holding` (begin's (O) holder half reads it) and
    rank_contention's holder rows, so the two count the same tokens."""
    if r.state == "running":
        return list(_cell_tokens(r) or _note_claim(chain) or [("any", "")])
    if unlanded_done(chain, r):
        toks = list(_cell_tokens(r) or _note_claim(chain) or [("any", "")])
        return toks + [t for t in leg_claim_tokens(r) if t not in toks]
    return []


def first_began(chain):
    """The Leg log's first `began:` stamp, raw, or None before Leg 1 (ADR 0067 d4's order reads it)."""
    return next((e["stamp"] for e in chain.log if e["kind"] == "began"), None)


UNDATED = 10 ** 9   # a never-begun chain's missing or malformed `captured:` sorts after every dated one


def _captured_ordinal(captured):
    """A `captured:` value's date as an ordinal (its first 10 characters, YYYY-MM-DD), else UNDATED."""
    s = rr._scalar(captured)[:10] if captured else ""
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", s):
        return UNDATED
    try:
        return datetime.fromisoformat(s).date().toordinal()
    except ValueError:
        return UNDATED


def order_key(slug, began, rank=None, captured=None):
    """ADR 0067 d4's order, rank-led (d9): (tier, unstamped, -rank ts, rank n, t2, case-folded slug). tier 0 is a chain
    that began (its first `began:` stamp parses), 1 one that never began, so a running chain always sorts before an idle
    never-begun one; inside a tier a stamped chain (rank: serial-chains.py's read_estate_rank, {n, at, ts}) sorts before
    every unstamped one, a later pass before an earlier one, then the lower n. t2 is the began stamp in tier 0 (the first
    to begin), and in tier 1 the `captured:` date (the earlier schedule; a missing or malformed one sorts last). Slug
    order breaks what is left. Aging never enters it: begin and land keep one static total order. The one copy:
    unfinished-rollout.py's serial_waits, land's actual-claim check, rank_contention and estate-dispatch.py's rank-stamp
    read it."""
    ts = rr._parse_ts(began) if began else None
    tier, t2 = (0, ts.timestamp()) if ts is not None else (1, _captured_ordinal(captured))
    if rank:
        return (tier, 0, -rank["ts"], rank["n"], t2, slug.casefold())
    return (tier, 1, 0.0, 0, t2, slug.casefold())


def first_by(key_h, key_r):
    """Why H sorts before R in order_key's order, read at the first component that differs: the tier `began first`;
    the stamp, the pass or n `ranks above (estate rank <n>)`; t2 `began first` (tier 0) or `was scheduled first`
    (tier 1); else `comes first by slug (neither has begun | both began at the same stamp)`."""
    i = next((k for k in range(len(key_h)) if key_h[k] != key_r[k]), len(key_h))
    if i == 0:
        return "began first"
    if i in (1, 2, 3):
        return f"ranks above (estate rank {key_h[3]})"
    if i == 4:
        return "began first" if key_h[0] == 0 else "was scheduled first"
    return "comes first by slug (" + ("neither has begun" if key_h[0] == 1 else "both began at the same stamp") + ")"


def chain_rank(chain):
    """The chain's estate rank (serial-chains.py's read_estate_rank), or None: unstamped, or a malformed stamp."""
    return sc.read_estate_rank(chain.note, rr._parse_ts)


def rank_warn(chain):
    """A WARN's text when the note carries an estate rank key that read_estate_rank cannot read, else None."""
    raw = [rr._scalar(chain.note.get(k)) for k in sc.ESTATE_RANK_KEYS]
    if any(raw) and chain_rank(chain) is None:
        return (f"estate_rank: {raw[0] or '<none>'}, estate_rank_at: {raw[1] or '<none>'} is malformed: read as "
                "unstamped (ADR 0067 d9)")
    return None


def chain_key(chain, began=None):
    """order_key of a Chain: its slug, first `began:` (else `began`, the stamp a chain with no `began:` line reads as:
    rank_contention's own fresh-Leg view passes its now), estate rank and `captured:`."""
    return order_key(chain.ctx.slug, first_began(chain) or began, chain_rank(chain), chain.note.get("captured"))


def hold_of(chain, read):
    """What the unfinished chain holds (the module docstring's *The hold*): {scope, why, held, released, unlanded,
    undone, pending, rows, warn, began, open, rank, captured, holding}, tokens in canonical text. Pure: no git, no
    subprocess (unfinished-rollout.py calls it in-process)."""
    fmt = lambda toks: [sc.fmt_token(t) for t in toks]  # noqa: E731
    claim = _note_claim(chain)
    whole = claim if claim is not None else [("any", "")]
    counted = chain.counted()
    undone_rows = [r for r in counted if r.state != "done"]
    pend_rows = [r for r in counted if unlanded_done(chain, r)]
    undone, bad = [], None
    if not chain.rows:
        bad = "its ## Queue has no rows"
    for r in undone_rows:
        toks = _cell_tokens(r)
        if toks is None:
            bad = f"row [[{r.slug}]]'s Surfaces cell is empty or holds a token parse_token refuses"
            break
        undone += [t for t in toks if t not in undone]
    if bad:
        undone = list(whole)
    # A Chain copy's done row still holds its cell until it lands on its primary's default branch (ADR 0067 d3).
    unlanded = list(undone)
    for r in ([] if bad else pend_rows):
        toks = _cell_tokens(r)
        if toks is None:
            unlanded = list(whole)
            break
        unlanded += [t for t in toks if t not in unlanded]
    began = first_began(chain)
    ol = chain.open_leg()
    holding = []
    for r in counted:
        holding += [t for t in holder_tokens(chain, r) if t not in holding]
    rank = chain_rank(chain)
    out = {"scope": "whole", "why": f"chain {read['state']}: it holds its whole claim", "held": fmt(whole),
           "released": [], "unlanded": fmt(unlanded), "undone": fmt(undone), "pending": [r.slug for r in pend_rows],
           "rows": [{"slug": r.slug, "state": r.state, "surfaces": list(r.surfaces), "folder": r.folder}
                    for r in counted if r in undone_rows or r in pend_rows], "warn": rank_warn(chain),
           "began": began, "open": {"n": ol["n"], "folder": ol["folder"]} if ol is not None else None,
           "rank": rank, "captured": rr._scalar(chain.note.get("captured")) or None, "holding": fmt(holding)}
    if read["state"] != "stuck" or claim is None:
        return out
    running = next((r for r in chain.rows if r.state == "running"), None)
    if running is not None:
        bad = f"[[{running.slug}]] reads in progress"
    if bad:
        out["why"] = f"chain stuck, but {bad}: it holds its whole claim"
        out["warn"] = "; ".join(w for w in (out["why"], out["warn"]) if w)
        return out
    cells = []
    for r in chain.rows:
        cells += _cell_tokens(r) or []
    held = list(undone) + [t for t in claim if t not in cells and t not in undone]
    k = sum(r.state == "set-aside" for r in counted)
    out.update(scope="stuck", held=fmt(held), released=fmt([t for t in claim if t not in held]),
               why=f"chain stuck ({k} set aside): it holds only its unlanded rows' surfaces (ADR 0060)")
    return out


# ---- the rank: same-file waits at claim, wait-die (ADR 0067 d9) ----------------------------------------------------

RANK_AGE_MINUTES = 60        # aging: a chain's earliest standing rank line lifts it one place per hour
RANK_LAND_MINUTES = 15       # (H): an earlier chain's `done` line this young, with no stand since, is about to land
RANK_WAIT_MAX_MINUTES = 180  # every wait's bound: past it the hold is stalled, and the Leg closes stopped
RANK_POLL_SECONDS = 15       # `wait`'s read-only poll
RANK_KINDS = {"rank wait": "wait", "rank retry": "retry"}


def _minutes_since(now, stamp):
    """Minutes from a stamp to now (0 for a stamp that will not parse, or one in the future)."""
    ts = rr._parse_ts(stamp) if stamp else None
    return max(0.0, (now - ts).total_seconds() / 60.0) if ts is not None else 0.0


def standing_lines(chain, dead=()):
    """The standing rank lines of chain's open Leg ([] with no open Leg, or when that Leg is in dead): a `rank wait:` or
    `rank retry:` line stands from its write until a `claimed`, `took` or `set aside` line for its task in the same Leg,
    or that Leg's `closed:` line (a closed Leg is no open Leg). [{task, kind (wait | retry), at, on}], in write order."""
    ol = chain.open_leg()
    if ol is None or ol["n"] in dead:
        return []
    out = []
    for e in chain.log:
        if e["n"] != ol["n"] or not e["slug"]:
            continue
        if e["kind"] in RANK_KINDS:
            m = re.search(r" on \[\[([^\]|#]+)", e["rest"])
            out.append({"task": e["slug"], "kind": RANK_KINDS[e["kind"]], "at": e["stamp"],
                        "on": m.group(1) if m else None})
        elif e["kind"] in ("claimed", "took", "set aside"):
            out = [x for x in out if x["task"].lower() != e["slug"].lower()]
    return out


def _lifts(now, lines):
    """Aging: floor(minutes since the earliest standing line / RANK_AGE_MINUTES), else 0."""
    stamps = [ts for ts in (rr._parse_ts(x["at"]) for x in lines) if ts is not None]
    return int(max(0.0, (now - min(stamps)).total_seconds() / 60.0) // RANK_AGE_MINUTES) if stamps else 0


def _meet(A, B):
    """The first (a, b) of A x B that overlap (serial-chains.py's overlaps), else None."""
    return next(((a, b) for a in A for b in B if sc.overlaps(a, b)), None)


def rank_contention(ctx, chain, n, dead=()):
    """The rank's read for Leg n of a chain in Chain copies (ADR 0067 d9; the module docstring's *The rank*): which of
    its rows another copied chain holds or reserves on a code file, and how. ctx-level and git-free: other_serial plus
    peer_chain, kept to peers with a well-formed `chain_copies:`; {} work when this note has none (a chain in place, or a
    malformed key), and an unreadable peer is a WARN that holds nothing. dead: this chain's Legs read as closed (a fresh
    Leg's view), whose standing lines do not count. This chain's order_key reads it as begun at now when it has no
    `began:` line (chain_key's began: a fresh Leg 1, as begin's launch check and status's freshRank read it before the
    line exists); every peer's is its own. {held: {slug: {kind (wait | die), dead, on, token, task, why, landFirst}},
    land: {task, on, token, rows, lands} | None, lifts, pos, key (this chain's, as read), warns, standing: {slug: {task,
    kinds, at, age}}, lines}. A row's die is dead whenever any earlier holder of it with no open Leg holds it, whatever
    the peers' order: it cannot clear until that holder's Leg opens. plan_next reads it as chain.contend; chain_read,
    chain_state, stall_of and hold_of never set it."""
    out = {"held": {}, "land": None, "lifts": 0, "pos": None, "key": None, "warns": [], "standing": {}, "lines": []}
    try:
        if sc.read_chain_copies(chain.note) is None:
            return out
    except ValueError:
        return out
    now = ctx.now
    peers = []
    for path, note in other_serial(ctx):
        try:
            if sc.read_chain_copies(note) is None:
                continue
        except ValueError:
            continue
        try:
            peers.append(peer_chain(ctx, path))
        except Exception as e:  # noqa: BLE001 — chain_hold's catch: an unreadable peer holds nothing here
            why = e.msg if isinstance(e, Refuse) else f"{type(e).__name__}: {e}"
            out["warns"].append(f"WARN: [[{path.stem}]] could not be read ({reason_text(why, 120)}): it holds nothing "
                                "against this chain's claims (ADR 0067 d9); git's merge at landing is the backstop")
    every = [chain] + peers
    # This chain reads as begun: its own contention is always read for a Leg that runs or is about to begin (begin's
    # launch check and status's freshRank run before Leg 1's `began:` line exists), so a never-begun chain's first Leg
    # sees the order its claims read, never tier 1 behind every begun peer whatever its stamp.
    key = {id(C): chain_key(C) for C in peers}
    key[id(chain)] = chain_key(chain, began=rr._stamp(now))
    pos = {id(C): i for i, C in enumerate(sorted(every, key=lambda C: key[id(C)]))}
    lines = {id(C): standing_lines(C, dead if C is chain else ()) for C in every}
    lifts = {id(C): _lifts(now, lines[id(C)]) for C in every}

    def before(A, B):
        return key[id(A)] < key[id(B)]

    def eff(C):
        return (pos[id(C)] - lifts[id(C)], -lifts[id(C)], pos[id(C)])

    def toks(C, r):
        return sc.rank_tokens(holder_tokens(C, r))

    slug_of = lambda C: C.ctx.slug  # noqa: E731
    mine = {r.slug: toks(chain, r) for r in chain.counted() if unlanded_done(chain, r)}
    mine_all = [t for ts in mine.values() for t in ts]

    def not_running(X, h):
        """None while h runs: X has an open Leg and, for an unlanded h, no earlier third chain's unlanded done rows meet
        it by their `leg_claims:` (claim_stand's test, one hop, read from the notes). Else ('dead', None) or ('behind',
        E)."""
        if X.open_leg() is None:
            return ("dead", None)
        if unlanded_done(X, h):
            ht = toks(X, h)
            for E in peers:
                if E is not X and before(E, X) and any(unlanded_done(E, r) and _meet(sc.rank_tokens(leg_claim_tokens(r)), ht)
                                                      for r in E.counted()):
                    return ("behind", E)
        return None

    holders = []
    for X in peers:
        for h in X.counted():
            ht = toks(X, h)
            if ht:
                holders.append((X, h, ht, not_running(X, h)))
    reserves = []
    for X in peers:
        for ln in lines[id(X)]:
            row = X.row(ln["task"])
            if row is not None:
                rt = sc.rank_tokens(_cell_tokens(row) or _note_claim(X) or [("any", "")])
                if rt:
                    reserves.append((X, ln, rt))
    fixes = {r.slug.lower() for r, _v in chain.fixes()}
    held = {}
    for r in chain.counted():
        if r.state == "done":
            continue
        T = sc.rank_tokens(_cell_tokens(r) or _note_claim(chain) or [("any", "")])
        if not T:
            continue
        die = wait = None
        for X, h, ht, nr in holders:
            p = _meet(T, ht)
            if p is None:
                continue
            tok, x = sc.fmt_token(p[1]), slug_of(X)
            base = {"on": x, "token": tok, "task": h.slug, "landFirst": []}
            if nr is not None:
                # A dead holder's die wins over a live one found first (peers come in path order): the row cannot clear
                # until that holder's Leg opens, so a retry on it is stalled, never a 180-minute poll.
                if before(X, chain) and (die is None or (nr[0] == "dead" and not die["dead"])):
                    die = dict(base, kind="die", dead=nr[0] == "dead", why=(
                        f"rank: [[{x}]] holds {tok} with no open Leg; its next Leg finishes or lands it" if nr[0] == "dead"
                        else f"rank: [[{x}]] holds {tok} unlanded behind [[{slug_of(nr[1])}]]; retry later"))
                continue
            behind = unlanded_done(X, h) and before(chain, X) and _meet(mine_all, ht) is not None
            if behind and r.slug.lower() in fixes:
                continue   # a holder behind this chain never holds its fix row: the fix is what lets this chain land
            lf = [s for s, mt in mine.items() if _meet(mt, ht)] if behind else []   # its own rows that land first
            if eff(chain) < eff(X):
                wait = wait or dict(base, kind="wait", dead=False, landFirst=lf, why=(
                    f"rank: [[{x}]] holds {tok} in [[{h.slug}]]; this chain ranks above and waits for it to finish and "
                    "land"))
            elif die is None:
                die = dict(base, kind="die", dead=False, landFirst=lf,
                           why=f"rank: [[{x}]] ranks above and holds {tok}; retry later")
        for X, ln, rt in reserves:
            p = _meet(T, rt)
            if p is not None and die is None and eff(X) < eff(chain):
                tok = sc.fmt_token(p[1])
                die = {"kind": "die", "dead": False, "on": slug_of(X), "token": tok, "task": ln["task"], "landFirst": [],
                       "why": f"rank: [[{slug_of(X)}]] ranks above and reserves {tok}; retry later"}
        if die or wait:
            held[r.slug.lower()] = die or wait
    # (H): this chain's first own row not yet landed, about to stand behind an earlier chain that is landing.
    land = None
    first = next((r for r in chain.rows if r.slug in mine), None)
    for C in (sorted(peers, key=lambda C: key[id(C)]) if first is not None else []):
        ol = C.open_leg()
        if not before(C, chain) or ol is None:
            continue
        crows = [r for r in C.counted() if unlanded_done(C, r) and _meet(toks(C, r), mine[first.slug])]
        if not crows or any(r.state == "running" and r.note is not None and owner_leg(r.note) == ol["n"]
                            for r in C.counted()):
            continue
        waits = any(x["kind"] == "wait" and (x["on"] or "").lower() == ctx.slug.lower() for x in lines[id(C)])
        names = {r.slug.lower() for r in crows}
        fresh = any(e["kind"] == "done" and (e["slug"] or "").lower() in names
                    and _minutes_since(now, e["stamp"]) < RANK_LAND_MINUTES
                    and not any(x["kind"] == "land stood" and x["pos"] > e["pos"] for x in C.log) for e in C.log)
        if waits or fresh:
            ctoks = [t for r in crows for t in toks(C, r)]
            p = _meet(mine[first.slug], ctoks)
            land = {"task": first.slug, "on": slug_of(C), "token": sc.fmt_token(p[1]), "rows": [r.slug for r in crows],
                    "lands": [s for s, mt in mine.items() if _meet(mt, ctoks)]}
            break
    standing = {}
    for ln in lines[id(chain)]:
        s = standing.setdefault(ln["task"].lower(), {"task": ln["task"], "kinds": [], "at": ln["at"],
                                                     "age": _minutes_since(now, ln["at"])})
        s["kinds"].append(ln["kind"])
    out.update(held=held, land=land, lifts=lifts[id(chain)], pos=pos[id(chain)], key=list(key[id(chain)]),
               standing=standing, lines=lines[id(chain)])
    return out


class RankLock(Lock):
    """The machine-wide rank lock (ADR 0067 d9): an exclusive fcntl.flock on `<leg lock dir>/rank-claim.lock`, taken
    inside the rollout's lock (never the other way round, and never nested with land's repo lock) around claim's
    contention read, its plan, its save and its log, and `wait`'s log, so two chains never claim one file at once. A wait
    past the same timeout is exit 5, nothing written. --dry-run takes none."""

    def __init__(self, ctx):
        super().__init__(ctx)
        self.path = os.path.join(os.path.dirname(self.path), "rank-claim.lock")
        self.what = "the rank lock: another chain's claim"


def write_rows(chain, n):
    """The rows Leg n writes (ADR 0060 d3): the counted rows not done, and the done ones on its smoke list (a failed
    smoke files a fix on its target's surfaces), in Queue order. Pure: write_set and unfinished-rollout.py's chain_hold
    (the rows' launch folders) read it."""
    smoke = {e["task"].lower() for e in smoke_list(chain, n)}
    return [r for r in chain.counted() if r.state != "done" or r.slug.lower() in smoke]


def write_set(chain, n):
    """What Leg n writes (ADR 0060 d3): the Surfaces cells of write_rows(chain, n), canonical and deduplicated; a row
    whose cell is empty or malformed gives the note's whole claim (`any` when that reads as any)."""
    out = []
    for r in write_rows(chain, n):
        toks = _cell_tokens(r)
        if toks is None:
            toks = _note_claim(chain) or [("any", "")]
        out += [t for t in toks if t not in out]
    return [sc.fmt_token(t) for t in out]


HELD_RE = re.compile(r"^\[\[([^\]]+)\]\] .*? holds `([^`]+)`")


def surface_recheck(ctx, chain, n):
    """unfinished-rollout.py's `check --shape serial --resume` over write_set(chain, n), read-only (ADR 0060 d3):
    ([{rollout, token}], None) on a hit, ([], None) on none or an empty write set, (None, <why>) when the check
    fails (exit 2, a timeout, an unreadable answer)."""
    toks = write_set(chain, n)
    if not toks:
        return [], None
    cmd = [sys.executable, str(UNFINISHED_PY), "check", "--shape", "serial", "--resume", ctx.slug,
           "--tasks-dir", str(ctx.tasks)]
    for t in toks:
        cmd += ["--surface", t]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=60, stdin=subprocess.DEVNULL)
    except (OSError, subprocess.SubprocessError) as e:
        return None, reason_text(f"{type(e).__name__}: {e}", 160)
    out = r.stdout.strip()
    if r.returncode == 0 and out == "none":
        return [], None
    if r.returncode == 3 and out.startswith("refuse "):
        held = []
        for line in r.stderr.splitlines():
            m = HELD_RE.match(line)
            if m:
                held.append({"rollout": m.group(1), "token": m.group(2)})
        return (held, None) if held else (None, f"no holds line beside `{out}`")
    line = next((x for x in r.stderr.splitlines() if x.startswith("unfinished-rollout:")), "") or out
    return None, reason_text(line or f"exit {r.returncode}", 160)


def chain_read(ctx, chain):
    """The chain's read (the module docstring's *The chain*), the one copy status, hold_of and unfinished-rollout.py's
    in-process load use: {inc, paused, superseded, open_leg, halt, restarted, n_next, fresh, stall, state}. ctx needs
    only `rollout` (unfinished-rollout.py passes a SimpleNamespace)."""
    note = chain.note
    if rr._truthy_flag(note.get("incomplete")):
        inc = "incomplete: true (/thread:schedule never finished it)"
    else:
        inc = rr.incomplete(ctx.rollout, note, chain.linked, chain.index) or None
    if rr._valued(note.get("paused")):
        paused = rr._scalar(note.get("paused"))
    elif rr._truthy_flag(note.get("pause_requested")):
        paused = "pause_requested"
    else:
        paused = None
    superseded = (rr._wikilink_slug(rr._scalar(note.get("superseded_by"))) or rr._scalar(note.get("superseded_by"))) \
        if rr._valued(note.get("superseded_by")) else None
    open_leg = chain.open_leg()
    halt = chain.halt()
    restarted = standing_restart(chain.log)
    n_next = chain.last_n() + 1
    fresh = plan_next(chain, n_next, None, None, cap=False, launch=False,
                      dead=(open_leg["n"],) if open_leg is not None else ())
    stall = stall_of(chain, open_leg)
    state = chain_state(chain, inc, paused, superseded, halt, restarted, open_leg, stall, fresh)
    return {"inc": inc, "paused": paused, "superseded": superseded, "open_leg": open_leg, "halt": halt,
            "restarted": restarted, "n_next": n_next, "fresh": fresh, "stall": stall, "state": state}


def rank_json(chain, contend):
    """status's `rank` block (ADR 0067 d9): {stamp (the estate rank, or null), warn (a malformed stamp), key (order_key,
    as the contention read it: a never-begun chain's as begun now, pos's own), pos, lifts, standing [{task, kind, at}],
    contention {held, land, warns}}; pos and lifts are null in place."""
    contend = contend or {}
    return {"stamp": chain_rank(chain), "warn": rank_warn(chain), "key": contend.get("key") or list(chain_key(chain)),
            "pos": contend.get("pos"), "lifts": contend.get("lifts", 0) if contend.get("pos") is not None else None,
            "standing": [{"task": x["task"], "kind": x["kind"], "at": x["at"]} for x in contend.get("lines") or []],
            "contention": {"held": contend.get("held") or {}, "land": contend.get("land"), "warns": contend.get("warns") or []}}


def cmd_status(ctx, a):
    chain = Chain(ctx)
    note = chain.note
    if rr._shape(note) != "serial":
        raise Refuse(1, f"{ctx.slug} is not a serial rollout (shape: {rr._scalar(note.get('shape')) or 'parallel'}): "
                        "read it with reconcile-rollout.py status")
    read = chain_read(ctx, chain)   # contention-free: the chain state, the stall and the hold never read the rank
    inc, paused, superseded = read["inc"], read["paused"], read["superseded"]
    open_leg, halt, restarted = read["open_leg"], read["halt"], read["restarted"]
    n_next, fresh, stall, state = read["n_next"], read["fresh"], read["stall"], read["state"]
    # begin refuses each terminal state, so no Leg acts next: no restart, no smoke list, no next act.
    ended = state in TERMINAL
    # The rank (ADR 0067 d9): freshRank, a fresh Leg N's plan with the contention read (this chain's open Leg read as
    # dead, no cap, no launch boundary), which the restart and begin's launch check share; the open Leg's own plan.
    dead = (open_leg["n"],) if open_leg is not None else ()
    fresh_contend = {} if ended else rank_contention(ctx, chain, n_next, dead=dead)
    chain.contend = fresh_contend
    fresh_rank = plan_next(chain, n_next, None, None, cap=False, launch=False, dead=dead)
    own_contend = fresh_contend
    if open_leg is not None:
        own_contend = {} if ended else rank_contention(ctx, chain, open_leg["n"])
        chain.contend = own_contend
        own = plan_next(chain, open_leg["n"], open_leg["alias"], open_leg["folder"])
        # The Capacity alone (p36-7): status runs in another session (the Reflection's, /thread:status), so it never
        # reads a Login's quota; it writes no lease.
        own = own if ended else leg_gate(ctx, chain, own, quota=False)[0]
    else:
        own = fresh_rank
    chain.contend = {}
    restart = None if ended else restart_of(ctx, chain, fresh_rank, n_next, open_leg, halt, restarted)
    if restart is not None and restart["blockedBy"] is None:
        # ADR 0060 d3: what the next Leg writes, re-checked against the other rollouts (begin's re-check, read-only).
        held, failed = surface_recheck(ctx, chain, n_next)
        if failed:
            restart["blockedBy"] = f"surface re-check failed: {failed}"
        elif held:
            restart["blockedBy"] = f"surface held by [[{held[0]['rollout']}]] ({held[0]['token']})"
    items = needs_you(ctx, chain, None, None)
    if halt is not None:
        items.append(f"[[{ctx.slug}]] halted at Leg {halt[1]}: {reason_text(halt[0], 140)}: the halt is yours to "
                     f"clear → /thread:repair [[{ctx.slug}]]")
    last = chain.legs.get(chain.last_n()) if chain.legs else None
    if last is not None and leg_outcome(last["closed"]) == "handoff" and (last["handover"] or "").startswith("manual"):
        m = re.match(r"handoff to Leg (\d+) in (\S+) from (.*)$", last["closed"])
        where = chain_launch(copies_read(chain)[0], m.group(2), m.group(3)) if m else "its launch"
        items.append(f"[[{ctx.slug}]] manual hand-over: start Leg {last['n'] + 1} in {where} with the prompt "
                     f"(/thread:status shows it), or /thread:repair [[{ctx.slug}]]")
    if restarted is not None and restarted["how"] in ("pending", "manual"):
        if restarted["how"] == "manual":
            items.append(f"[[{ctx.slug}]] restart of Leg {restarted['leg']} is a manual handoff "
                         f"({reason_text(restarted['manual'] or '', 100)}): paste its prompt in its launch")
        else:
            items.append(f"[[{ctx.slug}]] restart of Leg {restarted['leg']} pending since {restarted['at']} (session "
                         f"{restarted['session']}): wait for it, or /thread:repair [[{ctx.slug}]] once that session is gone")
    if stall is not None:
        items.append(f"[[{ctx.slug}]] stalled: {stall['why']} → /thread:repair [[{ctx.slug}]]")
    fixes = [{"task": r.slug, "verifies": v, "state": r.state} for r, v in chain.fixes() if r.state != "done"]
    return {"verb": "status", "rollout": ctx.slug,
            "note": {"status": rr._status(note) or None, "archived": ctx.archived, "incomplete": inc,
                     "paused": paused, "supersededBy": superseded},
            "progress": chain.progress(open_leg["n"] if open_leg is not None else None), "chain": state,
            "openLeg": open_leg["n"] if open_leg is not None else None,
            "halt": {"reason": halt[0], "leg": halt[1]} if halt is not None else None,
            "haltCleared": cleared_json(chain), "restarted": restarted,
            "restarts": [{"leg": e["leg"], "how": e["how"], "started": e["started"], "manual": e["manual"],
                          "session": e["session"], "at": e["stamp"]} for e in chain.log if e["kind"] == "restart"],
            "legs": legs_json(chain), "rows": [row_json(chain, r, own_contend) for r in chain.rows],
            "smoke": [] if ended else smoke_list(chain, open_leg["n"] if open_leg is not None else n_next),
            "fixes": fixes, "next": None if ended else next_json(own), "stall": stall, "restart": restart,
            "hold": hold_of(chain, read), "rank": rank_json(chain, own_contend), "needsYou": items}


def cmd_restarted(ctx, a):
    forms = [f for f, on in (("pending", a.pending), ("started", a.started is not None),
                              ("manual", a.manual is not None)) if on]
    if len(forms) != 1:
        raise Usage("restarted takes exactly one of --pending, --started <id> and --manual <why>")
    if (a.started is not None and not a.started.strip()) or (a.manual is not None and not a.manual.strip()):
        raise Usage("--started needs the new Session's id, and --manual its reason")
    with Lock(ctx):
        chain = Chain(ctx)
        validate_note(ctx, chain)
        if ctx.session == "unknown":
            raise Refuse(1, "`leg.py restarted` needs this session's id: pass `--session <id>` (no CLAUDE_CODE_SESSION_ID "
                            "or CODEX_THREAD_ID is set); nothing written")
        halt = chain.halt()
        if halt is not None:
            raise Refuse(3, f"halted at Leg {halt[1]}: {halt[0]}; nothing restarts until `leg.py clear-halt --reason <why>`")
        n = a.leg
        g = chain.legs.get(n)
        if g is not None and g["began"]:
            return {"verb": "restarted", "rollout": ctx.slug, "leg": n, "restarted": standing_restart(chain.log),
                    "recorded": False, "began": True, "dryRun": ctx.dry}
        if n != chain.last_n() + 1:
            raise Refuse(1, f"Leg {n} is not the next Leg (Leg {chain.last_n() + 1}): nothing written")
        form = forms[0]
        if form == "pending":
            text = f"restart: Leg {n} pending (session {ctx.session})"
        elif form == "started":
            text = f"restart: Leg {n} started {a.started.strip().split()[0]}"
        else:
            text = f"restart: Leg {n} manual ({reason_text(a.manual, 200)})"
        cur = standing_restart(chain.log)
        if cur is not None:
            same = next((e for e in reversed(chain.log) if e["kind"] == "restart"), None)
            if same is not None and f"restart: Leg {same['leg']} {same['rest']}" == text:
                return {"verb": "restarted", "rollout": ctx.slug, "leg": n, "restarted": cur, "recorded": False,
                        "began": False, "dryRun": ctx.dry}
            update = (cur["how"] == "pending" and form != "pending" and cur["session"] not in (None, "unknown")
                      and cur["session"] == ctx.session)
            if not update and not a.replace:
                raise Refuse(3, f"a restart of Leg {cur['leg']} stands ({cur['how']}, {cur['at']}): check that session; "
                                "--replace once it is gone", restarted=cur)
        if not ctx.dry:
            log_line(chain.note, f"- {ctx.stamp} {text}")
            save(ctx, chain.note)
            chain = Chain(ctx)
        return {"verb": "restarted", "rollout": ctx.slug, "leg": n,
                "restarted": standing_restart(chain.log) if not ctx.dry else None, "recorded": not ctx.dry,
                "dryRun": ctx.dry}


# ---- main -----------------------------------------------------------------------------------------------------------

def engine_guard(note):
    """engine-snapshot.py's guard() for the note, loaded from this tree (ADR 0043): its refusal line, else None."""
    try:
        mod = _load("thread_engine_snapshot", PLUGIN / "skills" / "_shared" / "scripts" / "engine-snapshot.py")
    except Usage:   # only positive evidence refuses
        return None
    return mod.guard(note, PLUGIN, "skills/execute/scripts/leg.py")


class Parser(argparse.ArgumentParser):
    def error(self, message):
        raise Usage(message)


def parser():
    p = Parser(prog="leg.py", description="A serial rollout's Leg bookkeeping (see the module docstring).")
    common = Parser(add_help=False)
    common.add_argument("--rollout", required=True)
    common.add_argument("--tasks-dir")
    common.add_argument("--vault")
    common.add_argument("--now")
    common.add_argument("--session")
    common.add_argument("--harness", choices=("claude", "codex"))
    common.add_argument("--dry-run", action="store_true")
    sub = p.add_subparsers(dest="verb", parser_class=Parser)
    s = sub.add_parser("begin", parents=[common])
    s.add_argument("--cwd")
    g = s.add_mutually_exclusive_group()
    g.add_argument("--take-over", action="store_true")
    g.add_argument("--resume", type=int)
    s = sub.add_parser("next", parents=[common])
    s.add_argument("--waiting")
    s = sub.add_parser("wait", parents=[common])
    s.add_argument("--task", required=True)
    s.add_argument("--for", dest="for_", type=float, default=540.0)
    s = sub.add_parser("claim", parents=[common])
    s.add_argument("--task", required=True)
    s.add_argument("--inherit", action="store_true")
    s.add_argument("--gate", action="append", default=[])
    s = sub.add_parser("change", parents=[common])
    s.add_argument("--task", required=True)
    s.add_argument("--top")
    s = sub.add_parser("smoke", parents=[common])
    s.add_argument("--task", required=True)
    s.add_argument("--result", required=True, choices=("pass", "fail", "not-run"))
    s.add_argument("--why")
    s = sub.add_parser("file-fix", parents=[common])
    s.add_argument("--target", required=True)
    s.add_argument("--cause", required=True, choices=("own", "chain", "outside", "drift"))
    s.add_argument("--culprit")
    s.add_argument("--evidence", required=True)
    s.add_argument("--excerpt")
    s = sub.add_parser("done", parents=[common])
    s.add_argument("--task", required=True)
    s.add_argument("--verify", choices=("pass", "none"))
    s.add_argument("--review", action="append", default=[])
    s.add_argument("--cwd")
    s = sub.add_parser("security", parents=[common])
    s.add_argument("--task", required=True)
    s = sub.add_parser("set-aside", parents=[common])
    s.add_argument("--task", required=True)
    g = s.add_mutually_exclusive_group(required=True)
    g.add_argument("--reason")
    g.add_argument("--scan-ask", action="store_true")
    s.add_argument("--kind", choices=("block", "gate"), default="block")
    s.add_argument("--status", choices=("blocked", "review-blocked", "plan-blocked"))
    s.add_argument("--revert", action="store_true")
    s.add_argument("--gate", action="append", default=[])
    sub.add_parser("post-items", parents=[common])
    s = sub.add_parser("file-followup", parents=[common])
    s.add_argument("--title", required=True)
    s.add_argument("--why", required=True)
    s.add_argument("--item", type=int)
    s = sub.add_parser("close", parents=[common])
    s.add_argument("--outcome", required=True, choices=OUTCOMES)
    s.add_argument("--reason")
    s.add_argument("--cwd")
    s.add_argument("--disposition", action="append", default=[])
    s.add_argument("--log-line", action="append", default=[])
    s.add_argument("--also", action="append", default=[])
    s.add_argument("--reflection")
    s = sub.add_parser("handed", parents=[common])
    s.add_argument("--started")
    s.add_argument("--manual")
    s = sub.add_parser("clear-halt", parents=[common])
    s.add_argument("--reason", required=True)
    sub.add_parser("status", parents=[common])
    sub.add_parser("copies", parents=[common])
    s = sub.add_parser("land", parents=[common])
    s.add_argument("--verified", action="append", default=[])
    s.add_argument("--red")
    s.add_argument("--retire", action="store_true")
    s = sub.add_parser("restarted", parents=[common])
    s.add_argument("--leg", type=int, required=True)
    s.add_argument("--pending", action="store_true")
    s.add_argument("--started")
    s.add_argument("--manual")
    s.add_argument("--replace", action="store_true")
    return p


VERBS = {"begin": cmd_begin, "next": cmd_next, "wait": cmd_wait, "claim": cmd_claim, "change": cmd_change,
         "smoke": cmd_smoke, "file-fix": cmd_file_fix, "done": cmd_done, "security": cmd_security,
         "set-aside": cmd_set_aside, "post-items": cmd_post_items,
         "file-followup": cmd_file_followup, "close": cmd_close, "handed": cmd_handed, "clear-halt": cmd_clear_halt,
         "status": cmd_status, "restarted": cmd_restarted, "copies": cmd_copies, "land": cmd_land}
# The writing verbs an archived (completed) note refuses up front (land but its --retire); begin refuses it as done,
# with its status line.
ARCHIVE_REFUSED = ("claim", "wait", "smoke", "file-fix", "done", "security", "set-aside", "close", "handed",
                   "clear-halt", "restarted", "copies", "land")


def main(argv=None) -> int:
    global rr, sc
    verb = None
    try:
        args = parser().parse_args(argv)
        verb = args.verb
        if not verb:
            raise Usage("name a verb: " + ", ".join(VERBS))
        rr = _load("reconcile_rollout", RR_SRC)
        sc = _load("serial_chains", SC_SRC)
        ctx = Ctx(args)
        if verb != "status":
            refusal = engine_guard(ctx.rollout)
            if refusal:   # ADR 0043: a stamped chain's Legs run on its Engine snapshot; nothing written
                print(refusal, file=sys.stderr)
                return 2
        if ctx.archived and verb in ARCHIVE_REFUSED and not (verb == "land" and args.retire):
            raise Refuse(1, f"{ctx.slug} is complete and archived ({ctx.rollout}): only file-followup and land --retire "
                            "write after Complete, and neither writes into the archived note")
        emit(VERBS[verb](ctx, args))
        return 0
    except Usage as e:
        print(f"leg: {e}", file=sys.stderr)
        return 2
    except Refuse as e:
        if e.code == 2:
            print(f"leg: {e.msg}", file=sys.stderr)
            return 2
        e.extra.pop("reason", None)
        emit({"verb": verb, "exit": e.code, "error": e.msg, **e.extra})
        print(f"leg: {e.msg}", file=sys.stderr)
        return e.code


if __name__ == "__main__":
    sys.exit(main())
