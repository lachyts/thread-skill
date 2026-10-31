# Legs — how `/thread:execute` runs a serial rollout

**Plugin root.** This file is read as a file (execute § 2's shape line sends a serial note here), so every command taken from it runs by `${CLAUDE_PLUGIN_ROOT}/skills/_shared/plugin-root.md`. It is read from the chain's engine root, the `root` execute § 1.5 resolved (its Engine snapshot, ADR 0043; `${CLAUDE_PLUGIN_ROOT}/skills/_shared/engine-snapshot.md`), and every `leg.py` command below runs from that root: run from another, `leg.py` refuses with an `engine-snapshot:` line and writes nothing, so re-run it once from the root that line names.

A serial rollout (`shape: serial`, ADR 0040) runs as a chain of **Legs** (CONTEXT.md **Leg**). Each Leg is this session: it works the chain's tasks itself, one at a time, in the launch its rows name, closes, and hands the rest to a fresh Leg. There is no Workflow engine, no task worktree, no Integration and no merge here. The one subagent a Leg spawns is each code-writing task's clean-room review (§ Review).

Every vault and git write a Leg makes goes through `python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/leg.py <verb> --rollout <rollout note>`, except § Complete's own commands: step 1's phase close (`reconcile-project.py --apply` writes the phase notes), and the completion verify (ADR 0055), whose `reconcile-rollout.py completion-verify --run` writes the `## Completion verify log` line, a `completion-red-<rollout>` task, its files under `<git common dir>/thread/`, the Run record's completion-verify and suite lines, and a detached verify tree under `<state>/thread/completion-trees/` (not a task worktree); its read and `--wait` write nothing. leg.py's header states each verb's contract, the `## Leg log` line forms, the status mapping and the lock. Never hand-edit a task's or the rollout note's frontmatter, and never write the `## Leg log` by hand. Below, `leg.py <verb>` is short for that whole command. It prints one JSON line. Its exit codes are 0 ok, 1 a refusal, 2 usage, 3 a stand, 4 wrong launch and 5 the lock held past its timeout, and every refusal writes nothing.

## Entry

execute § 1 resolves the note, execute § 1.5 resolves its engine root (and moves the chain onto a fresh snapshot when its last Leg closed `stopped`: a serial chain's Reinstate) before § 2's gates, and § 2's lineage and version gates run first. § 2's shape line then sends a `shape: serial` note here, in place of execute §§ 2.5–8. A serial note is never paused, so a `paused:` or `pause_requested:` stamp on one is no reinstate: `leg.py begin` refuses it, and prints the remedy.

A Leg runs in this order, and never in another:

1. execute § 4's git-env check (`thread:git-env-check`). Any non-zero exit writes nothing, and the turn ends as § 4 says.
2. `leg.py begin` (§ Begin).
3. The preflight (§ Preflight).
4. The smoke test (§ Smoke test).
5. Finish any inherited claimed task: the task a dead, stopped or halted predecessor left claimed.
6. Work the fix tasks (§ Fix tasks).
7. Claim new tasks one at a time (§ The task loop).

The cap is up to five fresh claims per Leg, fix tasks included. The inherited task never counts, so a Leg holds at most six tasks, and a task re-claimed in the same Leg (after a gate's standing approval or a hand-back) counts once. A Leg closes sooner when its context grows heavy or a task proves large. It closes only between tasks, never mid-task.

## Begin

Run `leg.py begin --cwd "$PWD"`:

- **0.** The Leg has begun, or this session resumed its own unclosed Leg (`resumed: silent`, after a compaction, a lost review notification or a room re-send). The JSON names the Leg, its `owner` (`leg-<N>`), its `inherited` tasks, its `smoke` list, the not-done `fixes`, the `mcp` namespaces this launch needs, and `next`.
- **1.** A refusal: a note that is not serial, an incomplete, dropped, superseded or done note, a paused one (the remedy: delete its `paused:` and `pause_requested:` lines, then `/thread:execute [[<slug>]]`), or a cwd on this plugin's own checkout. Print its `error` and end the turn on its `status_line`. Run no `/thread:close`.
- **3.** An unclosed Leg of another session, or a standing halt. Print its `error` and end on its `status_line`. Two re-runs answer it. `--resume <N>` is allowed only when this conversation ran the `begin` that returned Leg N; it logs `resumed`, and naming the wrong Leg is exit 1. `--take-over` is for a dead Leg only: Lachy said so, or its Session is gone from `list_sessions`. It closes that Leg `lost` and begins the next one, which inherits its claim. A halt stands until `leg.py clear-halt --reason <why>`, which is Lachy's call (or `/thread:repair`, on his word).
- **3, a surface stand** (ADR 0060: the JSON carries `held`, or its `error` starts `surface re-check failed:`). While this chain was stuck it held only its unlanded rows' surfaces, and another chain was scheduled on a place it released; this Leg would write there (an unlanded row, or a smoke row whose failure would file a fix there), so the chain waits its turn. Nothing was written. Print its `error`, push it once (§ Needs you), and end on its `status_line` (`halted reason="surface held: [[<B>]] holds <token>"`, or `surface re-check failed: …`). Never call `create_thread` on it, and run no `/thread:close`. Run `/thread:execute [[<slug>]]` again once [[<B>]] lands its rows there (`/thread:status [[<B>]]`).
- **4.** The wrong launch: this cwd is not the folder of the first row this Leg must work, or a `cx-*` row met a claude session. Nothing was written. Print the JSON's `launch` line and its `prompt` fenced, labelled `manual handoff`, push it once (§ Needs you), and end on its `status_line` (`halted reason="wrong launch: …"`). Never call `create_thread` on exit 4, so a wrong start cannot loop.
- **5.** The lock: § Concurrency.

## Preflight

For each item of begin's `mcp` list (the `**MCP:** required …` items in the `## Launch` of this launch's unlanded rows), make one ToolSearch load (`select:<a tool of that namespace>`) and one cheap authenticated call: a list, a whoami or a read of one record. A namespace that will not load or answer sets aside each task that needs it (`leg.py set-aside --task <t> --reason "preflight: <namespace> did not answer"`), and the chain goes on. Leg 1 runs the preflight alone: its `smoke` list is empty.

## Smoke test

begin's `smoke` list is every done task that no Leg after the one that finished it has smoke-tested, every done task a not-done fix names in `verifies:`, and every task whose latest smoke result is `fail` with no fix filed for it since. The first is the previous Leg's tasks (the inherited task it finished included, so it can hold six), plus any an earlier Leg finished when the Leg after it was lost, stopped or halted before it logged their results: a lost Leg never leaves a base unverified. For each entry, run its `**Verify:**` line from its row's launch folder. With no Verify line, its Acceptance criteria are the check. Record each result with `leg.py smoke --task <t> --result pass|fail|not-run [--why <text>]`. `not run` (a check this launch cannot run) is recorded and never carried.

A failing Verify never reopens a finished task: the task stays `done`. Trace the cause and file a fix task (§ Fix tasks). A failure traced to the inherited task's partial work files no fix: its `fail` is carried to the next Leg's smoke test until a `pass`.

## The task loop

Run `leg.py next`, and act on its `action`:

- `finish` with `inherit: true` → `leg.py claim --task <t> --inherit` (it keeps the task's `leg_base` and `started:`), then work it.
- `finish` → the task this Leg already claimed: go on with it.
- `claim` → `leg.py claim --task <t>`, then work it. A `fix: true` claim is a fix task.
- `handoff` (five fresh claims, or the next row opens in another launch: a Leg boundary) → § Close with `--outcome handoff`.
- `complete` → § Complete.
- `stuck` (only set-aside tasks and their held dependants are left) → § Close with `--outcome stuck`.

Run `next` again after every `done` or `set-aside`.

A re-entered task (claimable again after `/thread:repair`'s hand-back, `/thread:repair` § 7 (b)) carries Lachy's answer as the latest entry of its `## Repair input`: read it before any write, and work the task as he answered.

**Gates, before any write.** Read the claimed task and declare its gated inputs with execute § 3.7's grammar: a spend with its cap, a credential, an irreversible act, or `None`. Pass each to the claim as `--gate <gate>`: claim prints the ones `## Approved gates` does not cover as `unapproved`. For any unapproved gate, run `leg.py set-aside --task <t> --kind gate --gate <gate>… --reason "unapproved gate"`, which makes it `gate-pending` with `## Gated inputs (awaiting sign-off)` and reverts nothing, then `python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/reconcile-rollout.py approve-gates --standing --tasks <t> --rollout <rollout note>`. The standing approval signs a covered spend gate (within its month line, execute § 3.7), and the task then reads claimable again. Exit 3 leaves the rest for Lachy's sign-off. A gate never stops the chain: the task is set aside and the Leg goes on. A gate met mid-work stops before the gated act, and the task is set aside with `--revert`. Nothing external that needs a gate ever happens unsigned.

**`Task:` trailers.** Every commit a task makes in a checkout carries a `Task: [[<slug>]]` line in its message body. `leg.py change --task <t>` reads the task's change from them: the commits in `leg_base..HEAD` that carry its line, and their paths, `docs/reviews/` aside. It WARNs about a commit in that range with no `Task:` line at all, unless it touches only `docs/reviews/`. A task commits only in the checkouts its `leg_base` names, and work elsewhere is set aside.

**Verify.** Run the task's `**Verify:**` line until it is green, before the review and again after any fix.

**Review.** A code-writing task (`leg.py change` prints `codeWriting: true`: trailered commits in a checkout other than the vault) gets exactly one review round. All of its work is committed first, because § Session range reviews commits only. The ask, verbatim: the Skill tool, skill `fresh-review`, args `code xhigh session range on <top> from base <leg_base sha40>, paths set by hand at the resume point: <p1> <p2> …; Leg review (skills/execute/legs.md § Review): one round, no review-ledger.py, no fix re-dispatch`.

- Run Step 1 as `~/.agents/skills/fresh-review/SKILL.md` § Session range, never § Ranged scope. A `<base>...<head>` target selects the ranged scope, which sweeps in peers' and the daily sweep's commits.
- Skip its `sf=` … `[ "$rc" -eq 0 ] || exit 1` lines. A Leg's transcript spans several tasks, so `session-files.py` would return all of them. Set `paths=(…)` and `spec=(…)` from `leg.py change --task <t> --top <top>` (its `paths` and `spec`), then run the block from its `resume point`.
- `~/.agents/skills/fresh-review/SKILL.md` § Step 2, check 3, is skipped: no `review-ledger.py`. The ledger chains every doc in a repo with a 2h gap, so a later task's round would read the earlier task's work as a REGRESSION.
- `~/.agents/skills/fresh-review/SKILL.md` § Step 4, its offer to apply fixes after Lachy picks, is replaced: the Leg judges each finding itself. It fixes the finding with new `Task:` commits, or annotates it as deliberate, with the reason. Step 4's re-dispatch is replaced too: there is no second round, and the Leg re-runs the Verify line green instead. Step 5 runs as written: commit the doc, then mark it consumed.
- The review runs in the background, so the turn ends on `leg.py next --waiting "review in flight: [[<t>]]"`'s `status_line` (§ Report) until its notification arrives. A lost review is re-dispatched once.
- On Codex, fresh-review takes its exit-3 route: `{SCOPE}` is the task's commits by full SHA, and `{PATH_SCOPE}` its paths.

A review that does not converge sets the task aside as `blocked` and reverts its code (`leg.py set-aside --task <t> --revert --reason <why>`). There are four cases: a finding needs Lachy; the Verify is still red after two fix attempts; the review is lost twice, or says "nothing in scope" twice; or the change touches a checkout other than the cwd's.

**Done or set aside.** `leg.py done --task <t> --verify pass --review <abs doc>` stamps it done, with its `leg_head`: per checkout, the task's own newest trailered commit, the anchor of § Complete's HEAD guard (ADR 0055). It refuses (exit 1, nothing written) a code-writing task without a `--review` doc for each touched checkout that is that checkout's, `mode: code`, `effort: xhigh` or `max`, `status: consumed`, with a `head:` between `leg_base` and HEAD that holds a trailered commit; and without `--verify pass` when the note has a Verify line. A task that cannot be finished is set aside: `leg.py set-aside --task <t> --reason <why> [--revert]`.

`--revert` reverts the task's trailered commits in each checkout, newest first, in a scratch worktree, then commits the revert with `Task:` and `Set-aside:` lines. Exit 3 means a path to revert has uncommitted or staged changes, or the revert would conflict. Nothing was touched, so close the Leg with `--outcome halt` (§ Close). Every later `begin` exits 3 until `leg.py clear-halt --reason <why>`, and the next Leg then inherits the halted task. Vault edits are never reverted: the diagnosis lists them. A re-entry (`reconcile-rollout.py hand-back`, or `approve-gates` after a sign-off) leaves the task claimable, and its claim restamps `leg_base`. The diagnosis names each revert, so the re-entry restores the work with `git revert <sha>` or starts fresh.

## Fix tasks

When a smoke Verify of a finished task t fails, trace who broke it, then run `leg.py file-fix --target <t> --cause own|chain|outside|drift [--culprit <L>] --evidence "<line>" [--excerpt "<output>"]`. Every fix task names t in `verifies:`. `verifies:` is never an Escape: it drives the smoke list and the held dependants. `fixes:` names the culprit, and only a culprit inside the chain:

| Cause | When | `fixes:` |
|---|---|---|
| `own` | t's own work is at fault | `[[t]]`, an Escape against t (task-writer § 4, ADR 0037 d7) |
| `chain --culprit L` | a later chain task L broke t | `[[L]]`, an Escape against L |
| `outside` | a peer's or the daily sweep's commit broke it | none |
| `drift` | an external API, account or tool changed | none |

leg.py checks each cause against git, and a cause the evidence does not fit is exit 1 with nothing written. chain needs one of L's `Task:` commits on t's paths to come after t's last `Task:` commit there (L is a later chain task, never one that landed before t passed its own Verify); outside needs an untrailered commit on t's paths after t's last trailered commit; drift needs t's paths unchanged since then. A vault-only task (no paths) takes own or drift only. An outside culprit that is a known task is named in the evidence, never in `fixes:`.

The fix task's Queue row goes ahead of the first queued row, in this Leg's launch, and the Leg works it before any new claim. t stays done. A re-run files nothing new while a not-done fix for t exists. A fix that is itself set aside never stops the chain: later Legs re-run t's Verify (t stays on the smoke list through `verifies:`), and `next` holds every task that depends on t, `depends on [[t]] (awaiting fix [[f]])`.

## Needs you

A Leg never calls the question tool (`AskUserQuestion`, or the harness's own ask tool). A decision that is Lachy's is a needs-you item: a gate to sign, a set-aside to hand back or defer, a halt, a wrong launch or a manual hand-over. Each one gets its line in the report and one push, with execute § 6.5's *Push once* mechanics and its `## Needs-you log` in the rollout note. `leg.py close` prints the open items as `needs_you`.

## Close

ADR 0040's close ritual: stamp each task done or set aside, save the learnings, review any code written, and commit. Tasks are stamped and code is reviewed as each task ends. At the Leg's end, in this order:

1. `leg.py close --outcome handoff|stuck|stopped|halt [--reason <r>] --cwd "$PWD"`, before any `create_thread`, so the successor's `begin` already reads this Leg closed. A Leg that completes the chain closes in § Complete step 4 instead, with `--outcome complete --reflection`: without `--reflection` that outcome is a usage error (exit 2). It refuses handoff and stuck while this Leg owns an in_progress task; stopped and halt leave the task claimed for the next Leg. It prints `progress`, `commit_only`, `needs_you`, `handover` (handoff only) and `status_line` (every outcome but handoff).
2. Push each `needs_you` item once (§ Needs you).
3. `/thread:close`, which runs close § Under a Leg: the close-outs land commit-only in each `commit_only` checkout, step 6 asks nothing, and the hand-over (§ Hand over) runs between sub-step 7 and step 8.
4. `leg.py handed` (§ Hand over) records the hand-over and prints the handoff's status line.
5. close's banner, then the `ROLLOUT-STATUS:` line (§ Report) in the same message, with nothing after it.

Lachy's stop for a Leg ("pause the rollout", "stop the chain") is `--outcome stopped`.

## Hand over

Inside `/thread:close`, after every commit:

- **On the Chorus Stage**, call `create_thread` with `close`'s `handover`: `title` (`Leg <N+1>: <rollout>`, at most 60 characters), `prompt` (its first line `/thread:execute [[<rollout>]]`, then `Leg <N+1> of the serial chain; the brief is the rollout note's ## Leg log: <abs note path>`), `tldr` (one or two plain sentences, no paths) and `cwd` (the next row's launch folder). Pass no `brief`, and leave `report_back` at its default (on). Its `harness` names the next row's harness; Chorus's `create_thread` takes no launch alias or harness, so a claude ↔ `cx-*` boundary is a manual hand-over.
- **In Codex Desktop**, its own `create_thread`, per /thread:handoff § Success contract.
- **After the call:** on `Raised (task_id: …)` or a `threadId`, run `leg.py handed --started <id>`. Otherwise run `leg.py handed --manual "<why>"`: a cross-harness boundary, no host tool, or a `create_thread` error.
- **A manual hand-over** prints the `prompt` as a fenced, paste-ready block and the launch line (`<alias> from <folder>`), labelled `manual handoff`, and pushes it once.

The rollout note and its `## Leg log` are the brief: a Leg writes no handoff doc.

## Report

Every Leg turn ends with `ROLLOUT-STATUS: <slug> merged=<K>/<N> running=<R> state=<state>[ reason="…"]`. K is the done Queue rows, fix rows included; N is every Queue row; R is 1 while this Leg owns an in_progress task, else 0. leg.py prints the exact line (`status_line`): `close`, `handed` and a refused `begin` print theirs, and a `waiting` turn end takes `leg.py next --waiting "<reason>"`'s, with the reason as the table gives it. Whichever verb prints it, it is never `running`: no Stop-hook drive applies to a Leg.

| Turn end | `state` and `reason` | Chorus Close | Stop hook |
|---|---|---|---|
| Mid-Leg, review in flight | `waiting reason="review in flight: [[t]]"` | *nothing yet* | allow |
| Room stop | `waiting reason="room stop: …"` | *nothing yet* | allow |
| Complete, completion verify running | `waiting reason="completion verify in flight"` | *nothing yet* | allow |
| handoff, successor started | `done reason="handed off to Leg <N+1>"` after the banner | *closed*: reports to the origin, archives | allow |
| handoff, manual | `halted reason="manual handoff: Leg <N+1> in <alias> from <folder>"` | demand | allow |
| complete | `done` after the banner | *closed*: the final report | allow |
| stuck | `halted reason="awaiting you: <k> set aside"` | demand | allow |
| stopped | `halted reason="stopped: <reason>"` | demand | allow |
| halt (incl. a second lock timeout) | `halted reason="halt: <reason>"` | demand | allow |
| `begin` refused (exit 1, 3 or 4) | `halted reason="<refusal>"`, no /thread:close | demand | allow |

**Reports to the origin (Chorus ADR 0094).** Every Leg whose Close reads *closed* reports to the origin when it closes, so the origin wakes once per such Leg. A `halted` or `waiting` Leg never reports. Leg 1, started by hand, is the origin, and the last Leg's Completion log is the final report. Off the Stage, each closing Leg pushes its outcome once instead.

## Complete

When `next` says `complete`, run the ceremony in this order (the serial template's § Post-rollout steps name the same order):

**The completion verify (ADR 0055).** A note that declares `completion_verifier:` runs it first, once, on the chain checkout's HEAD, before the note reads done; with no key, the ceremony is as before. Its read: `python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/reconcile-rollout.py completion-verify --rollout <rollout note>`.

- It has no origin read and no git-env canary: the chain never pushes, so its merged main is its checkout's HEAD as `--run` starts, and `--run`'s HEAD guard checks, before anything runs, that this HEAD holds every done task's own commits (their `leg_head`).
- `absent`, `green`, `flake` or `red` → step 1. A `red` filed one fix task, `completion-red-<rollout>`: name it in the Leg's report. The chain still completes, since each task passed its own Leg verify.
- `in-flight` → when a `--run` or `--wait` this session launched is still running (its notification has not arrived), launch nothing. Otherwise (an earlier session's or entry's `--run`, or a killed one whose verify still holds the lock), launch `python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/reconcile-rollout.py completion-verify --rollout <rollout note> --wait` in the background with `timeout: 7200000`. Either way, end the turn on `leg.py next --waiting "completion verify in flight"`'s `status_line` (§ Report).
- `run` or `rerun` → launch `python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/reconcile-rollout.py completion-verify --rollout <rollout note> --run` in the background with `timeout: 7200000`, then end the turn on that same waiting line. On Codex, `--run` and `--wait` run in the foreground.
- **When `--wait` ends:** exit 0 → act on its JSON as on a read, with one difference: still `in-flight` → § Close `--outcome halt --reason "completion verify: in flight past its deadline"`, since no attempt's verify lives that long under ADR 0052, so whatever holds the lock is a process to look at. Exit 1 or 2 → as the read's. 128+n with no line → as `stopped`.
- **When `--run` ends**, by its exit:
  - 0 with `halt: false` → read again. Decided → step 1. `rerun`, or a no-verdict result (`noslot`, `unrun`, `heat`), launches `--run` again at once: a Leg has no heartbeat, and the slot wait is its pause. After `stopped`, § Room stop; under Lachy's stop it is `--outcome stopped`.
  - 0 with `halt: true` → § Close `--outcome halt --reason "completion verify: no verdict in three runs"`.
  - 3 → as `in-flight`: its own run has ended, so the wait is launched.
  - 128+n with no line → as `stopped`.
  - 1 → § Close `--outcome halt --reason "completion verify failed: <its ERROR line after 'ERROR: completion-verify: '>"`, and the Leg's one needs-you push carries the whole ERROR line with its remedy (a HEAD that does not hold the chain's commits: check out their branch, then `leg.py clear-halt`).
  - 2, or the read's exit 1 or 2 → § Close `--outcome halt --reason "completion verify: rollout note unreadable"`, its ERROR line printed and pushed.
  - There is no exit 4: no canary is armed.
- A `--run` or `--wait` end is acted on only while this block is the Leg's current step: one that ends after the Leg moved on to step 1, or closed, runs nothing.

1. **Phases.** execute § 4.5 step 5's ADR 0026 bullet: `python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/reconcile-rollout.py touched-phases --rollout <rollout note>`, then `reconcile-project.py <line> --kinds phase --apply` per line, and a `phase-close-followup-<rollout-slug>` task on a failure. Pass each outcome as `--log-line`, and each phase note it wrote as `--also <path>`. The canary and fold-journals stay parallel-only.
2. **Post-rollout items.** `leg.py post-items` lists them with their indices. File each item that is live work with `leg.py file-followup --item <k> --title <t> --why <w>`, a loose open task whose pointer replaces item k. Give every other item a disposition at the close, `--disposition <k>="<text>"`.
3. **Score.** `python3 ${CLAUDE_PLUGIN_ROOT}/skills/reflect/scripts/close-score.py --rollout <rollout note> --close completion`, with the Bash tool's `timeout: 600000`: its serial path scores the chain through `serial-score.py` and records its one close line in `tunings.jsonl`. Its one stdout line, verbatim, or `not scored: close-score printed nothing`, is the reflection. A non-zero exit never stops the ceremony.
4. **`leg.py close --outcome complete [--disposition …]… [--log-line …]… [--also <path>]… --reflection "<step 3's line>"`.** It refuses, with nothing written, an item with neither a pointer nor a disposition, and an Archive name collision (checked first). When the note declares `completion_verifier:`, it also refuses a completion verify that is not decided ("not decided": run the block above first) and a value its reader refuses; a decided one's `summary` is a Completion log line, and a red's fix task goes in the vault commit. It asks land.sh's own route for each chain checkout (`land.sh --route`, read-only). On `landable <d>`, the chain's commits are only its `Task:`-trailered ones, and when some are missing from `origin/<d>` it files a land follow-on listing them: open a PR from them, or push them, since ADR 0028 lands only close-out commits on its own. On `not landed: <reason>` it files nothing. On `stuck:` it files the follow-on with every chain commit there, and the act starts with checking the landing route. Then it stamps `status: done` and `completed:`, writes the `## Completion log` (a line per Leg, the completion verify's `summary` line when the note declares the key, the phase lines, each item's disposition, the `Chain commits:` lines and `Reflection: <step 3's line>`), moves the note to `Archive/Rollouts/`, and commits by pathspec in the vault. `committed: false` (a peer's `index.lock`, say) is fine: the daily sweep commits it. Then `python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/engine-snapshot.py retire`, best-effort (a failure is a `WARN:` in the report): it spares its own root, and the archived grace keeps this chain's snapshot for step 5's close (engine-snapshot.md § Retirement).
5. `/thread:close` (close § Under a Leg), the banner, then `state=done`. The note is in `Archive/Rollouts/` by now: `leg.py file-followup` finds it there and files a new-task candidate with no pointer (close § Under a Leg).

## A report from a later Leg

A Prompt that starts `[Reported back by Chorus from …` in the Session of a Leg that already closed gets one statement line, `Leg <K> reported: <outcome>`. The Leg runs no tool, prints no status line and asks nothing.

## Room stop

A Chorus room signal (execute § Room stop, item 1, a spread's included) in a Leg: claim nothing new, finish the step in hand (a commit, a `leg.py` verb), and end the turn on `leg.py next --waiting "room stop: <text>"`'s `status_line` (`waiting reason="room stop: …"`). `<text>` opens as execute item 2's line does: `<Login> at its week's line`, `<Login> at its 5-hour line`, or for a spread `<Login> spreading its Rollouts (would reach its 5-hour line ~HH:MM)`, never `at its 5-hour line`. The Stage's re-send re-enters `/thread:execute`, and `begin` resumes this session's Leg silently. A review agent lost to the switch is re-dispatched once. A completion verify's `--run` or `--wait` in flight (§ Complete) is TaskStopped at once by its own task id, as execute § Room stop item 4 does: a `--run` stopped while its verify runs records `stopped`, one stopped before it leaves no line, and the resume's read runs the same attempt, or launches the wait again. The room stop itself writes nothing to the rollout note.

## Concurrency

Every writing `leg.py` verb holds the rollout's lock, a file outside the vault, for its whole run, so two Legs never claim one task and two `begin`s never both begin. A wait past 30 seconds is exit 5 with nothing written: retry the verb once. A second exit 5 ends the turn `halted reason="halt: rollout note locked"`. This Leg's claim stands, and a later same-session `begin` resumes it.

## Don'ts

- Never stamp `paused:` or `pause_requested:` on a serial note: a Leg stops through `leg.py close --outcome stopped`.
- Never call the question tool in a Leg: every decision of Lachy's is a needs-you item (§ Needs you).
- Never make a Workflow call, run `reconcile-rollout.py next`, or open a task worktree for a serial note.
- Never hand-edit a task's or the rollout note's frontmatter or its `## Leg log`: `leg.py` writes them under the lock.
- Never claim past five fresh claims, and never close mid-task.
- Never mark a code-writing task done without its one consumed xhigh review, and never run a second review round.
- Never push a chain's own commits unattended: Complete's land follow-on is where they wait for Lachy (ADR 0028).
- Never skip a declared completion verify or write its `## Completion verify log` by hand: only `--run` records a run, and `leg.py close --outcome complete` refuses an undecided one.
- Never call `create_thread` after `begin` exit 4, and never before `leg.py close`.
