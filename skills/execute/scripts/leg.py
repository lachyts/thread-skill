#!/usr/bin/env python3
"""leg.py — a serial rollout's Leg bookkeeping (ADR 0040; skills/execute/legs.md is its one caller's protocol).

    python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/leg.py <verb> --rollout <note> [common flags] [verb flags]

A serial rollout (`shape: serial`) runs as a chain of Legs: visible sessions that each work tasks themselves, close
and hand the rest to a fresh successor. This helper does every vault and git write a Leg makes but legs.md §
Complete's own commands (its phase close, `reconcile-project.py --apply`, and its completion verify,
`reconcile-rollout.py completion-verify --run`, ADR 0055), so a Leg never hand-edits frontmatter. Stdlib only,
python >= 3.9, POSIX (fcntl). It loads reconcile-rollout.py as a module (Note, _scan, _queue_state, _dep_status,
incomplete, _stamp, PHASED_STEM_RE, _norm_gate, _fm_block; _leg_tops, the one parser of `leg_base:` and `leg_head:`;
and the completion verify's _completion_config, _completion_state, _completion_summary, _find_note,
COMPLETION_DECIDED, COMPLETION_RED_PREFIX and CompletionValueError), as serial-chains.py and unfinished-rollout.py
do, and serial-chains.py for norm_origin and the surface grammar. begin and status run unfinished-rollout.py's
read-only `check --shape serial --resume` (the surface re-check, ADR 0060), and unfinished-rollout.py loads this file
in turn for hold_of (no recursion: hold_of never spawns).

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
revert; nothing written) · 4 wrong launch (nothing written) · 5 the
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
`cd <copy folder> && <the generated alias's command after its own cd>` (the alias's `cd` opens the primary; read from
$THREAD_LAUNCH_ALIASES, else ~/repos/workspaces/_shared/generated/launch-aliases.zsh), else prose that says never to run
the alias itself. A note with no `chain_copies:` key works every checkout in place, exactly as before; a malformed key is
exit 1 (`chain_copies: <why>: fix the note`) for begin, claim and copies.

Verbs (writing verbs: begin, claim, smoke, file-fix, done, set-aside, file-followup, close, handed, clear-halt,
restarted, copies):
  begin [--cwd <dir>] [--take-over | --resume <N>]
      Refuses (exit 1): a note not found, a non-serial note, an incomplete note (`incomplete: true`, or
      reconcile-rollout.py's incomplete), a dropped or superseded note, a done note, a `paused:` or
      `pause_requested:` stamp (`a serial note is never paused: delete its paused: (and pause_requested:) line, then
      /thread:execute [[<slug>]]`), and a cwd whose checkout's origin is this plugin's own repo (plugin.json's
      repository, norm_origin). A standing halt (the last `closed: halted:` line has no `halt cleared:` line after
      it) is exit 3. An unclosed Leg K: this session's own (its latest began or resumed session id, never `unknown`)
      resumes silently and writes nothing; `--resume K` logs `resumed` (another K is exit 1); `--take-over` closes K
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
      claimable row), and a `cx-*` alias needs codex (any other, claude); a mismatch is exit 4 with the row's launch
      line and the Leg prompt, nothing written to the Leg log. A resume skips the check. In a chain with
      `chain_copies:`, after the re-check and before the launch check, begin runs `copies` (below) under its lock, so a
      deleted copy is remade on its branch and a newly needed checkout gets its pair; the launch check then compares the
      cwd with the row's folder inside its copy, exit 4 naming that folder and the copy's launch line; a row-less Leg
      (complete or stuck) logs the primary folder of its cwd (primary_folder), so the Leg log names Queue folders only;
      and on a fresh Leg or a take-over each copy is fast-forwarded (`merge --ff-only`) to its primary's default branch
      when that branch resolves, the primary has it checked out, the chain branch is a strict ancestor of it, the copy
      is clean and no row is in progress (a skip but an already-current copy, or a failed merge, is a WARN; never the
      primary). Prints `copies` ({checkout, copy, branch, made, fastForwarded}, [] in place), `cwd` (the Leg's launch
      folder inside its copy, else that folder) and `warns`. Prints the Leg, its inherited tasks, its
      smoke list (every done task stamped `leg: K`, K < N, with no `smoke:` line from a Leg after K: the previous
      Leg's, and an earlier Leg's that a lost, stopped or halted Leg never smoke-tested; every done task a not-done
      fix names in `verifies:`; every task whose latest smoke result is `fail` with no fix filed for it since; each
      with its `**Verify:**` line or null), the not-done fix tasks, the required MCP namespaces of this launch's
      unlanded rows (their `## Launch` `**MCP:** required …` items), `next` and `progress`.
  next [--waiting <reason>]                  (read-only, no lock)
      The Leg's next act: `finish` (a task this Leg owns, or an inherited claim of a closed Leg: `inherit: true`),
      else `handoff` at five fresh claims (distinct tasks with a `claimed` line in this Leg, so a task re-claimed
      after a gate or a hand-back counts once; an inherited `took` never counts), else `claim` of the
      first claimable fix task (`verifies:`), else of the first claimable row in Queue order (status open, or
      in_progress with no owner: a hand-back's or a sign-off's re-entry), else `complete` (every counted row done),
      else `stuck`. A claimable row in another launch than the Leg's is a Leg boundary: `handoff`. A row whose
      dependency (depends-on/blocked-by) is not done is held `depends on [[d]] (<why>)`, and one whose done
      dependency has a not-done fix is held `depends on [[d]] (awaiting fix [[f]])`. --waiting adds the turn's
      `status_line`, `state=waiting reason="<reason>"` (a review in flight, a room stop, a completion verify in
      flight: legs.md § Complete and § Report).
  claim --task <t> [--inherit] [--gate <gate>]...
      Re-runs next under the lock: <t> must be what it proposes (with --inherit, an inherited `finish`). Stamps
      `status: in_progress`, `owner: leg-N`, `leg: N`, `started:` (the first wins), consumes `handed_back:` and
      `gates_signed:`, and on a fresh claim `leg_base: ["<toplevel>@<sha40>", …]`: one entry per checkout the row
      works (stamp_bases: the checkout of each `repo:` surface of the row, `repo:<toplevel>//<path>` or bare, that is
      a git toplevel, then its launch folder's toplevel, where its commits land), the vault never, so a file token
      never leaves a code row unstamped (an inherited claim keeps its stamp). In a chain with `chain_copies:` each
      entry is the checkout's copy at its HEAD, and `leg_primary_base: ["<checkout>@<sha40>", …]` (the primaries' HEADs)
      follows it, printed too; a checkout with no pair is exit 1 naming `leg.py copies`, and a pair whose copy is
      missing exit 1 naming begin. Logs `claimed` or `took`.
      Each --gate is compared with the note's `## Approved gates` (reconcile-rollout.py's _norm_gate): the
      unapproved ones are printed for `set-aside --kind gate`. An exact `None` (execute § 3.7's grammar, bullet,
      case and one trailing `.` aside, as the engine's parseGatedInputs reads it) is no gate, never unapproved.
  change --task <t> [--top <toplevel>]       (read-only, no lock)
      Per `leg_base` checkout: the commits in `<sha>..HEAD` whose message has a `Task: [[<t>]]` line, their paths
      minus `docs/reviews/`, the `:(literal)` pathspecs, and a WARN per commit in the range with no `Task:` line at
      all, unless it touches only `docs/reviews/`. `codeWriting` is any such commit. `stray` is one WARN per commit of
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
      trailer; drift needs t's paths unchanged since t's last trailered commit (working tree included). A task
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
      `head:` that descends from the leg_base sha, is an ancestor of HEAD and holds a trailered commit. Stamps
      `status: done`, `completed:`, `leg: N`, `reviewed:` (the docs), keeps `leg_base`, and, when the task has a
      `leg_base` entry, `leg_head: ["<toplevel>@<sha40>", …]` after it (ADR 0055): per checkout, the task's own newest
      `Task:`-trailered commit (change's last commit there, never HEAD, which may be a peer's), a checkout where it
      committed nothing (or whose range could not be listed) left out, so `[]` when it committed nowhere; no key with
      no `leg_base` entry. A serial chain's completion verify anchors its HEAD guard on it. Logs `done`.
  set-aside --task <t> --reason <text> [--kind block|gate] [--status blocked|review-blocked|plan-blocked]
            [--revert] [--gate <gate>]...
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
      runs it first); before the lock it asks land.sh's own route for each chain checkout (`land.sh
      --route -- <top>`, 60 s): on `landable <d>` it lists the chain's `Task:`-trailered commits that the local
      `refs/remotes/origin/<d>` lacks (no fetch) and, when there are any, files
      `<project>-followup-land-chain-<YYYY-MM-DD>[-<k>]` (act: open a PR from them, or push them; ADR 0028 automates
      only close-out commits); on `not landed: <reason>` it files nothing; on `stuck: <reason>`, a failure or a
      timeout it files the follow-on with every chain commit there and the act prefixed `check the landing route
      (<reason>), then`. A chain checkout that is a Chain copy reads its primary's route instead (the copy's own branch
      reads not landed), its commits those not on the primary's local default branch d plus, when landable, those
      `origin/<d>` lacks; any such commit files the follow-on whatever the route, its act first `merge chain/<rollout>
      into <d> there`, last the copy's `worktree remove` and the branch's `branch -d`, and its Chain commits line reads
      `<copy> (chain/<rollout> of <primary>): <k> not on <d> → [[f]]` or `all on <d>[ and origin/<d>]`. Then
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
      Leg's), `stall`, `hold` (hold_of, below) and `needsYou` (needs_you's items, plus a halt, a manual hand-over, a
      pending or manual restart and a stall). In a terminal chain state (complete, dropped, superseded, incomplete: begin refuses
      each, so no Leg acts next) `restart` and `next` are null and `smoke` is empty. Stamps print raw, as the log
      holds them.
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
  - <stamp> halt cleared: <reason>
  - <stamp> restart: Leg <N> pending (session <sid>) | started <id> | manual (<why>)
A `restart:` line carries no Leg number of its own (it names the Leg to come), so no reader counts it as a Leg.
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
  boundary, an open Leg K read as dead), when that plan is finish, claim or complete and the chain state is not
  terminal (complete, dropped, superseded or incomplete); else null. A paused chain keeps it: what runs once the
  stamp is gone. {leg, title
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
  surface re-check run read-only for Leg N: `surface held by [[<B>]] (<token>)` on a hit, `surface re-check failed:
  <its line>` when the check fails (ADR 0060). A manual hand-over is null: it waits on Lachy.
- The standing restart (`restarted`): the latest `restart:` line with no `began` line after it, as {leg, how
  (pending, started or manual), started, manual, session (a pending line's), at}, else null.
- The hold (ADR 0060 d1, d2; hold_of, the one copy unfinished-rollout.py loads): what the unfinished chain holds
  against other rollouts, {scope, why, held, released, unlanded, rows, warn, began, open}. In every chain state but
  `stuck`, scope `whole`: `held` is the note's whole `surfaces:` (`any` when it reads as any), `released` empty.
  `stuck` (no Leg open, no stall, hand-over, restart or halt standing, not completable, nothing claimable: every
  unlanded row is set aside or held behind one), scope `stuck`: `held` is the Surfaces cells of every counted row not
  done (set-aside rows, rows held behind them, a `missing` row) plus any `surfaces:` token that no row's cell names (a
  hand edit, kept), and `released` is the rest of `surfaces:`, done rows still on the next Leg's smoke list included;
  deferred and folded rows are outside the count, so released. A stuck chain fails closed to `whole`, with `warn`
  set, when its Queue has no rows, an unlanded row's cell is empty or holds a token parse_token refuses, or a row
  reads in progress.
  `unlanded` is the counted, not-done rows' cell tokens in any state (the note's whole claim on those same failures):
  what a resuming chain's re-check compares against. `rows` is those rows, {slug, state, surfaces, folder} (folder
  the row's launch folder, so its checkout). `began` is the Leg log's first `began:` stamp, raw (null before Leg 1),
  and `open` the open Leg as {n, folder}, else null: the order and the interim mutex of unfinished-rollout.py's
  check_resume read them (ADR 0067 d4).
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
no lock: os.replace means they never read a torn note, and claim re-validates whatever next proposed.
"""
import argparse
import fcntl
import importlib.util
import json
import os
import posixpath
import re
import shlex
import shutil
import subprocess
import sys
import tempfile
import time
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
PLUGIN = HERE.parent.parent.parent
RR_SRC = HERE / "reconcile-rollout.py"
SC_SRC = PLUGIN / "skills" / "_shared" / "scripts" / "serial-chains.py"
LAND_SH = PLUGIN / "skills" / "_shared" / "scripts" / "land.sh"
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
CAP = 5
OUTCOMES = ("handoff", "complete", "stuck", "stopped", "halt")
TERMINAL = ("complete", "dropped", "superseded", "incomplete")   # the chain states begin refuses for good
REVIEWS = "docs/reviews/"
SET_ASIDE = {"blocked", "review-blocked", "plan-blocked", "gate-pending"}
LAUNCH_RE = re.compile(r"^`([^`]+)`\s+from\s+`([^`]+)`$")
VERIFY_RE = re.compile(r"^\s*\*\*Verify:\*\*.*$", re.M)
MCP_RE = re.compile(r"\*\*MCP:\*\*\s*required\s+(.*?)(?:;\s*optional\b.*)?$", re.I)
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


def git_out(top, *args):
    r = git(top, *args)
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

class Lock:
    def __init__(self, ctx):
        d = os.environ.get("THREAD_LEG_LOCK_DIR") or os.path.join(
            os.environ.get("XDG_STATE_HOME") or os.path.expanduser("~/.local/state"), "thread", "legs")
        self.path = os.path.join(os.path.expanduser(d), f"{ctx.slug}.lock")
        self.fd = None
        self.skip = ctx.dry

    def __enter__(self):
        if self.skip:
            return self
        raw = os.environ.get("THREAD_LEG_LOCK_TIMEOUT") or "30"
        try:
            timeout = float(raw)
        except ValueError:
            timeout = 30.0
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
                    raise Refuse(5, f"rollout note locked: another Leg verb held {self.path} past {timeout:g}s; "
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
         "hand-over:", "follow-on ")


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
    """The Leg's next act (the module docstring's `next`). `dead`: Legs to read as closed (a take-over's)."""
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
            return r
        return None

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
        return {"action": "claim", "task": pick.slug, "fix": is_fix, "row": pick, **base}
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
    $THREAD_LAUNCH_ALIASES, else DEFAULT_ALIASES), or None when that file or line cannot be read."""
    path = os.environ.get("THREAD_LAUNCH_ALIASES") or DEFAULT_ALIASES
    try:
        text = Path(os.path.expanduser(path)).read_text()
    except (OSError, UnicodeDecodeError):
        return None
    m = re.search(rf"^alias {re.escape(alias)}='cd \S+ && (.*)'$", text, re.M)
    return m.group(1) if m else None


def launch_line(alias, folder, copy=None):
    """A row's launch line: `<alias> from <folder>` in place. In a Chain copy (copy: the folder inside it) the alias's
    own `cd` opens the primary, so the line is paste-ready `cd <copy> && <the alias's command after its cd>` (`claude`
    and `codex` themselves), or, when that command cannot be read, prose that says never to run the alias itself.
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
    Leg begun days after its schedule starts from today's base: only when d resolves, the primary has d checked out,
    the chain branch is a strict ancestor of d, the copy is clean (tracked files) and no counted row is in progress.
    Never the primary. {copy: fast-forwarded}; each skip but an already-current copy, and a failed merge, is a WARN."""
    out = {}
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
        if not tip or not dsha or tip == dsha or is_ancestor(P, dsha, tip):
            continue   # already current (it holds d), or nothing to read
        why = None
        if running:
            why = "a row is in progress"
        elif git_out(P, "symbolic-ref", "-q", "HEAD") != f"refs/heads/{d}":
            why = f"{P} does not have {d} checked out"
        elif not is_ancestor(P, tip, dsha):
            why = f"{br} has commits {d} lacks (Complete's merge joins them)"
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
    return out


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
        for line in r.note.section_text("## Launch").split("\n"):
            m = MCP_RE.search(line)
            if m:
                for item in re.findall(r"`([^`]+)`", m.group(1)) or [x.strip() for x in m.group(1).split(",")]:
                    if item and item not in req:
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
        with Lock(ctx):
            chain = Chain(ctx)
            validate_note(ctx, chain)
            return _begin_locked(ctx, a, chain, cwd)
    except Refuse as e:
        if e.code in (1, 3, 4):
            prog = chain.progress() if chain is not None else {"done": 0, "total": 0, "running": 0}
            e.extra.setdefault("status_line", status_line(ctx.slug, prog, "halted", e.extra.get("reason") or e.msg))
        raise


def _begin_locked(ctx, a, chain, cwd):
    halt = chain.halt()
    if halt is not None:
        raise Refuse(3, f"halted at Leg {halt[1]}: {halt[0]}; nothing begins until `leg.py clear-halt --reason <why>`",
                     reason=f"halt: {halt[0]}")
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
            return begin_out(ctx, Chain(ctx), k, resumed="logged")
        if ctx.session != "unknown" and open_leg["session"] == ctx.session:
            return begin_out(ctx, chain, k, resumed="silent")
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
    # The launch check: the first row this Leg must work, in its Chain copy when it has one.
    plan = plan_next(chain, n, None, None, cap=False, launch=False, dead=() if took_over is None else (took_over,))
    row = plan.get("row") if plan["action"] in ("finish", "claim") else None
    if row is not None:
        need = launch_harness(row.alias)
        where = (sc.copy_folder(row.folder, pairs) if pairs and row.folder else None) or row.folder
        if _fold(where or "") != cwd.casefold() or need != ctx.harness:
            why = (f"wrong launch: [[{row.slug}]] runs as `{row.alias}` from `{where}` ({need}); this session is "
                   f"{ctx.harness} in {cwd}; nothing written, so start Leg {n} there with the prompt below")
            raise Refuse(4, why, launch=chain_launch(pairs, row.alias, row.folder), prompt=leg_prompt(ctx, n),
                         reason=f"wrong launch: run Leg {n} as {row.alias} from {where}")
        alias, folder = row.alias, row.folder
    else:
        # A row-less Leg (complete or stuck) logs its primary folder: the Leg log names Queue folders only.
        alias, folder = ctx.harness, (sc.primary_folder(cwd, pairs) if pairs else None) or cwd
    if copies and not ctx.dry:
        moved = fast_forward(ctx, chain, made, warns)
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
                     warns=warns, pairs=pairs)


def begin_out(ctx, chain, n, resumed, took_over=None, alias=None, folder=None, copies=None, warns=None, pairs=None):
    g = chain.legs.get(n) or {}
    alias = g.get("alias") or alias
    folder = g.get("folder") or folder
    plan = plan_next(chain, n, alias, folder)
    inherited = [r.slug for r in chain.rows if r.state == "running" and r.note is not None
                 and owner_leg(r.note) not in (None, n)
                 and (chain.legs.get(owner_leg(r.note)) is None or chain.legs[owner_leg(r.note)]["closed"] is not None)]
    fixes = [r.slug for r, _v in chain.fixes() if r.state != "done"]
    if copies is None:   # a resume: the recorded copies, as they are
        pairs = copies_read(chain)[0]
        copies = [{"checkout": c, "copy": p, "branch": f"chain/{ctx.slug}", "made": False, "fastForwarded": False}
                  for c, p in pairs or []]
    cwd = (sc.copy_folder(folder, pairs) if pairs and folder else None) or folder
    return {"verb": "begin", "rollout": ctx.slug, "leg": n, "owner": f"leg-{n}", "session": ctx.session,
            "harness": ctx.harness, "resumed": resumed, "tookOver": took_over,
            "launch": {"alias": alias, "folder": folder}, "cwd": cwd, "copies": copies, "inherited": inherited,
            "smoke": smoke_list(chain, n), "fixes": fixes, "mcp": launch_mcp(chain, alias, folder),
            "next": next_json(plan), "progress": chain.progress(n), "warns": list(warns or []), "dryRun": ctx.dry}


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
    plan = plan_next(chain, leg["n"], leg["alias"], leg["folder"])
    prog = chain.progress(leg["n"])
    out = {"verb": "next", "rollout": ctx.slug, "leg": leg["n"], **next_json(plan), "progress": prog}
    if a.waiting is not None:
        out["status_line"] = status_line(ctx.slug, prog, "waiting", a.waiting)
    return out


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
    with Lock(ctx):
        chain = Chain(ctx)
        leg = my_leg(ctx, chain)
        n = leg["n"]
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
            note.set("leg_base", "[" + ", ".join(f'"{b}"' for b in bases) + "]", after=("started", "leg"))
            if pbases is not None:
                # A Chain copy's claim: the primaries' HEADs too, so done finds a commit that went there instead.
                note.set("leg_primary_base", "[" + ", ".join(f'"{b}"' for b in pbases) + "]", after=("leg_base",))
        approved = [rr._norm_gate(l) for l in note.section_text(APPROVED_GATES).split("\n") if l.strip()]
        unapproved = [g for g in real_gates(a.gate) if rr._norm_gate(g) not in approved]
        save(ctx, note)
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
        warns = [f"WARN: {sha[:12]} {subj!r} in {top} carries no Task: line"
                 for sha, subj, ps in bare if any(not p.startswith(REVIEWS) for p in ps)]
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
        raise Refuse(1, f"no commit after [[{target.slug}]]'s last Task: commit touches its paths without a chain "
                        "task's trailer: not an outside cause")
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
        save(ctx, note)
        tail = f"; reviewed {', '.join(reviewed)}" if reviewed else ""
        if not ctx.dry:
            log_line(chain.note, leg_line(ctx, n, f"done [[{r.slug}]] (verify {verify}{tail})"))
            save(ctx, chain.note)
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


def cmd_set_aside(ctx, a):
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
                           f"Set-aside: {reason_text(a.reason, 300)}\n")
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
            diag = f"Set aside by Leg {n} of [[{ctx.slug}]]: {a.reason.strip()}"
            if reverted:
                diag += "\n\n" + "\n".join(f"- reverted {sha} in {top}" for sha, top in reverted)
                diag += "\n\nA re-entry restores the work with `git revert <sha>` in that checkout, or starts fresh."
            note.append_run(rr.BLOCKED_SECTIONS.get(status, BLOCKER), diag, ctx.now)
        save(ctx, note)
        if not ctx.dry:
            for sha, top in reverted:
                log_line(chain.note, leg_line(ctx, n, f"reverted {sha} in {top}"))
            log_line(chain.note, leg_line(ctx, n, f"set aside [[{r.slug}]] ({status}): {reason_text(a.reason, 200)}"))
            save(ctx, chain.note)
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
    are those not on the primary's default branch d, plus, when landable, those origin/<d> lacks; copy is {checkout,
    branch, default, offDefault}."""
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
            need = [c for c in commits if c in off or c in gone]
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
    # A Chain copy's commits always need their merge into the primary, whatever its route (ADR 0067 d2, d3 proposed).
    need = [p for p in plans if p[3] and (p[4] is not None or p[1] != "deferred")]
    land_name = None
    if need:
        body = ["# Land the serial chain's commits", "",
                f"[[{ctx.slug}]] finished, but some of its tasks' `Task:` commits are not on origin (from a Chain copy, "
                "not yet on its primary's default branch either). ADR 0028 lands only close-out commits on its own, so "
                "these wait for you:", ""]
        for top, kind, detail, commits, copy in need:
            act = "open a PR from them, or push them"
            if copy is not None:
                P, br, d = copy["checkout"], copy["branch"], copy["default"]
                dn = f"`{d}`" if d else "its default branch"
                tail = (act if kind == "landable" else f"it goes no further: not landed: {detail}" if kind == "deferred"
                        else f"check the landing route ({detail}), then {act}")
                body.append(f"- `{top}` (`{br}` of `{P}`): merge `{br}` into {dn} there (with {dn} checked out: "
                            f"`git -C {P} merge {br}`), then {tail}; then `git -C {P} worktree remove {top}` and "
                            f"`git -C {P} branch -d {br}`")
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
            if off:
                chain_lines.append(f"{head}: {len(off)} not on {dn} → [[{land_name}]]")
            elif commits:
                chain_lines.append(f"{head}: all on {dn}, {len(commits)} not on origin/{detail} → [[{land_name}]]")
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


def row_held(chain, r):
    if r.state == "missing":
        return "note not found"
    if r.note is None:
        return None
    if r.state == "running" and owner_leg(r.note) is None and rr._valued(r.note.get("owner")):
        return f"in progress ({rr._scalar(r.note.get('owner'))})"
    if r.state == "queued" or (r.state == "running" and not rr._valued(r.note.get("owner"))):
        return "; ".join(holds_of(chain, r)) or None
    return None


def row_json(chain, r):
    note = r.note
    out = {"n": r.i + 1, "slug": r.slug, "state": r.state, "status": (rr._status(note) or None) if note else None,
           "owner": (rr._scalar(note.get("owner")) or None) if note else None, "leg": None,
           "launch": r.launch if r.alias else None, "fix": None, "fixes": None, "held": row_held(chain, r), "deps": [],
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
    """The restart (the module docstring's) from a fresh Leg N's plan, or None."""
    if plan["action"] not in ("finish", "claim", "complete"):
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


def hold_of(chain, read):
    """What the unfinished chain holds (the module docstring's *The hold*): {scope, why, held, released, unlanded,
    rows, warn}, tokens in canonical text. Pure: no git, no subprocess (unfinished-rollout.py calls it in-process)."""
    fmt = lambda toks: [sc.fmt_token(t) for t in toks]  # noqa: E731
    claim = _note_claim(chain)
    whole = claim if claim is not None else [("any", "")]
    counted = chain.counted()
    unl_rows = [r for r in counted if r.state != "done"]
    unlanded, bad = [], None
    if not chain.rows:
        bad = "its ## Queue has no rows"
    for r in unl_rows:
        toks = _cell_tokens(r)
        if toks is None:
            bad = f"row [[{r.slug}]]'s Surfaces cell is empty or holds a token parse_token refuses"
            break
        unlanded += [t for t in toks if t not in unlanded]
    if bad:
        unlanded = list(whole)
    began = next((e["stamp"] for e in chain.log if e["kind"] == "began"), None)
    ol = chain.open_leg()
    out = {"scope": "whole", "why": f"chain {read['state']}: it holds its whole claim", "held": fmt(whole),
           "released": [], "unlanded": fmt(unlanded),
           "rows": [{"slug": r.slug, "state": r.state, "surfaces": list(r.surfaces), "folder": r.folder}
                    for r in unl_rows], "warn": None,
           "began": began, "open": {"n": ol["n"], "folder": ol["folder"]} if ol is not None else None}
    if read["state"] != "stuck" or claim is None:
        return out
    running = next((r for r in chain.rows if r.state == "running"), None)
    if running is not None:
        bad = f"[[{running.slug}]] reads in progress"
    if bad:
        out["why"] = f"chain stuck, but {bad}: it holds its whole claim"
        out["warn"] = out["why"]
        return out
    cells = []
    for r in chain.rows:
        cells += _cell_tokens(r) or []
    held = list(unlanded) + [t for t in claim if t not in cells and t not in unlanded]
    k = sum(r.state == "set-aside" for r in counted)
    out.update(scope="stuck", held=fmt(held), released=fmt([t for t in claim if t not in held]),
               why=f"chain stuck ({k} set aside): it holds only its unlanded rows' surfaces (ADR 0060)")
    return out


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


def cmd_status(ctx, a):
    chain = Chain(ctx)
    note = chain.note
    if rr._shape(note) != "serial":
        raise Refuse(1, f"{ctx.slug} is not a serial rollout (shape: {rr._scalar(note.get('shape')) or 'parallel'}): "
                        "read it with reconcile-rollout.py status")
    read = chain_read(ctx, chain)
    inc, paused, superseded = read["inc"], read["paused"], read["superseded"]
    open_leg, halt, restarted = read["open_leg"], read["halt"], read["restarted"]
    n_next, fresh, stall, state = read["n_next"], read["fresh"], read["stall"], read["state"]
    own = plan_next(chain, open_leg["n"], open_leg["alias"], open_leg["folder"]) if open_leg is not None else fresh
    # begin refuses each terminal state, so no Leg acts next: no restart, no smoke list, no next act.
    ended = state in TERMINAL
    restart = None if ended else restart_of(ctx, chain, fresh, n_next, open_leg, halt, restarted)
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
            "legs": legs_json(chain), "rows": [row_json(chain, r) for r in chain.rows],
            "smoke": [] if ended else smoke_list(chain, open_leg["n"] if open_leg is not None else n_next),
            "fixes": fixes, "next": None if ended else next_json(own), "stall": stall, "restart": restart,
            "hold": hold_of(chain, read), "needsYou": items}


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
    s = sub.add_parser("set-aside", parents=[common])
    s.add_argument("--task", required=True)
    s.add_argument("--reason", required=True)
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
    s = sub.add_parser("restarted", parents=[common])
    s.add_argument("--leg", type=int, required=True)
    s.add_argument("--pending", action="store_true")
    s.add_argument("--started")
    s.add_argument("--manual")
    s.add_argument("--replace", action="store_true")
    return p


VERBS = {"begin": cmd_begin, "next": cmd_next, "claim": cmd_claim, "change": cmd_change, "smoke": cmd_smoke,
         "file-fix": cmd_file_fix, "done": cmd_done, "set-aside": cmd_set_aside, "post-items": cmd_post_items,
         "file-followup": cmd_file_followup, "close": cmd_close, "handed": cmd_handed, "clear-halt": cmd_clear_halt,
         "status": cmd_status, "restarted": cmd_restarted, "copies": cmd_copies}
# The writing verbs an archived (completed) note refuses up front; begin refuses it as done, with its status line.
ARCHIVE_REFUSED = ("claim", "smoke", "file-fix", "done", "set-aside", "close", "handed", "clear-halt", "restarted",
                   "copies")


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
        if ctx.archived and verb in ARCHIVE_REFUSED:
            raise Refuse(1, f"{ctx.slug} is complete and archived ({ctx.rollout}): only file-followup writes after "
                            "Complete, and it writes nothing into the archived note")
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
