---
slug: thread-skill
created: 2026-07-14
last_touched: 2026-09-25
state: active
scope: Build + maintain the thread:* plugin — continuity verbs + the wave rollout engine (one system, two lanes)
---

# thread-skill — THREAD

## Where we are

**2026-09-25 (evening): 2.7.0 is released. Nothing is running and no handoff doc is pending.**
- **Landed:** the 2.7 rollout: 4 tasks as PRs #17–#20 on `lachyts/thread-skill` master, 2 waves, 1h 50m,
  with no halts, no gates and nothing parked. The last merge is `393829c`. The source of truth is the
  archived rollout note `[[thread-skill-rollout-2026-09-25]]` (`~/repos/obsidian/Work/Tasks/Archive/Rollouts/`),
  § Completion log.
- **Released:** 2.7.0 is `15638b6` (the manifests bump on top of the rebased local commits `20147f3` and
  `88e59fe`), and it is pushed. `claude plugin update thread@thread` moved 2.6.0 → 2.7.0, and
  `make release-check` was green on `15638b6`. This close deletes the post-rollout handoff doc, which the
  2.7.0 cache holds, so release-check lists that file as stray until the next release. That is expected.
- **This checkout** is level with origin after `git pull --rebase --autostash`: `--ff-only` could not work
  because `42360be` had never been pushed. `make test` was ALL PASS on the rebased tip.
- **Still deferred:** p3-1 and p3-3 wait on design calls, and p4-5 waits for the eval baseline.
- **Open follow-ups** (vault tasks, all `open`):
  - `thread-skill-eval-baseline-then-p4-5` (a spend, USD 5 cap)
  - `thread-skill-e2e-rerun-on-2-6-0` (retarget it to 2.7.0)
  - `thread-skill-retire-rollout-clone` (now unblocked)
  - `thread-skill-protect-master-ci`, `safepoint-uses-handoff-home-resolver`,
    `thread-skill-stale-project-scope-install`
  - filed at this close, from the rollout's proposals: `thread-skill-project-glob-drift-out-of-repo`,
    `thread-skill-open-list-prunes-close-guard`, `vault-area-notes-area-front-matter`,
    `thread-skill-gh-upgrade-and-set-head`

**2026-09-25 (afternoon), superseded that evening (see above): the self-rollout was complete and 2.6.0
released. Nothing was running.**
- **Landed:** 16 tasks as PRs #1–#16 on `lachyts/thread-skill` master, in 7 waves over 37h 22m (wall
  clock, including the two halts that waited on Lachy). The last merge is `4a87a15`. `make test` was
  green after every wave, and everything ran on Opus 5.5 capped at `max_tier: opus`. The source of truth
  is the archived rollout note `[[thread-skill-rollout-2026-09-23]]`
  (`~/repos/obsidian/Work/Tasks/Archive/Rollouts/`): § Notes, and § Completion log for waves → PRs,
  rounds per task and the repair actions.
- **Released:** 2.6.0 is `3a7b9be` (the manifests bump on `4a87a15`). This checkout pulled `--ff-only`
  and is level with origin, so the freeze is over. `make release-check` is green at `3a7b9be` (re-run at
  this close). This close deletes the consumed review doc, which the 2.6.0 cache still holds, so from now
  on release-check lists that file as stray. That is expected (the Makefile's note on deleted tracked
  files).
- **Not landed:**
  - **p2-3 was split** after it plan-blocked twice, into
    `thread-skill-p2-6-close-repo-state-local-only` (local-only repo state plus close's feature-branch
    check) and `thread-skill-p2-7-tool-repo-threads-and-open-save` (tool-repo threads, `open save`, the
    CONTEXT.md Repo thread entry). Both run from the rollout clone. Lachy's decisions are in the p2-3
    note § *Decisions (Lachy, 2026-09-25)*.
  - **p3-1 and p3-3 are deferred** on design calls:
    `thread-skill-p3-1-orient-native-children-one-launch-model`,
    `thread-skill-p3-3-grill-fit-check-in-prompt-composition`.
  - **p4-5 waits for the eval baseline** (`thread-skill-p4-5-trim-descriptions-700-hard-cap`).
- **Open follow-ups** (vault tasks, all `open`):
  - `thread-skill-e2e-rerun-on-2-6-0`
  - `thread-skill-eval-baseline-then-p4-5` (a spend, USD 5 cap)
  - `thread-skill-evals-results-vs-release-check`
  - `thread-skill-orient-nested-project-notes`
  - `safepoint-uses-handoff-home-resolver`
  - `thread-skill-protect-master-ci`
  - `thread-skill-retire-rollout-clone` (only after p2-6 and p2-7 land)
- **Lessons:** the rollout's five are in § Known quirks (protocol 4 intake items 14–17).
- **Next, prepared later on 2026-09-25:** a four-task 2.7 rollout (p2-6, p2-7 and two small fixes). `d59bcb3`
  is pushed, the rollout clone is tidied and green, and the model tier is locked to Opus 5.5. The order
  and the paste-ready lead prompt are in § Resume instructions.

**2026-09-25 (morning), superseded the same day (see above): the self-rollout was ready to resume from
wave 3. Nothing was running; 8 tasks were left.**
- **2026-09-24, before the resume:** Lachy rewrote `origin/master` to `c667e9e` by hand, deleted
  `origin/main`, and added a clone `pre-push` hook that refuses any push to `master`/`main`. He withdrew
  p1-3's gates and deferred p3-1 and p3-3 out of the rollout (rollout note § *Resolved 2026-09-24*).
- **The resume lead (`execute-2026-09-24-a91d0c16`, unattended) finished wave 2 and most of wave 3.** Every
  merge went through `merge-wave.sh`, and `make test` was green on each merged tree:
  - PR #7, p3-4 → `42e9173`
  - PR #6, p1-3 → `b52270d`. p1-3 was approved after 2 review rounds. It also landed the test-side
    `GIT_*` scrub.
  - PR #8, p3-2 → `a65ddbc`
  - PR #9, p2-1 → `d85a3c7`

  The cursor is 2/7, because wave 3 is incomplete.
- **p4-1 did not land.** Its first pass was plan-blocked after 3 rounds on strictness feedback (narrowing,
  per K87), so the lead re-dispatched it. The re-plan was approved in round 2 but returned
  `gate-pending` with 23 phantom gates. The plan's `### Gated inputs` read `None`, and then a `---` and a
  feedback-resolution list followed; the parser reads until the next heading (protocol 4 intake item
  13). The lead halted at 08:37 and did not approve anything. On 2026-09-25 Lachy withdrew the gates
  (rollout note § *Resolved 2026-09-25*), and p4-1 is back to `in_progress`.
- **Left:** p4-1 (the rest of wave 3), then waves 4–7. Wave 4 is p2-2 with p4-2, p4-3 and p4-4, then
  p2-5, p2-3 and p2-4 run one per wave. That is 8 tasks, not the 6 the 2026-09-25 resolution line
  says.
- **Freeze holds:** this THREAD.md edit is uncommitted. Commit it after the 2.6.0 `pull --ff-only`.

**2026-09-24 (small hours), resolved later that day (see above): the self-rollout halted after wave 2.
A test leaked onto GitHub master, and cleaning it up was Lachy's call.**
- **Wave 1 merged:** PRs #1–#5 (p3-5, p1-4, p1-2, p1-1, p3-6). The repo has no CI, so the lead re-ran
  `make test` on the combined tree (`c667e9e`), and it was green. p1-1 consumed the 2.5.2 simplify review doc
  (it reads `consumed` on master; this checkout still has the pending copy until the pull).
- **Wave 2 landed nothing:**
  - p1-3 is `gate-pending`, with PR #6.
  - p3-1 is `plan-blocked` after 3 rounds.
  - p3-4 is approved, but its PR #7 is held unmerged.

  The smart-halt fires because p1-3's and p3-1's files return in later waves. The cursor is 1/7.
- **The leak:** at 23:41 a p1-3 agent ran `tests/default-branch.test.sh` with `GIT_DIR` set to its worktree's
  gitdir. That reached the clone's shared refs and config, and:
  - it pushed fixture commits `4c4c44b` and `018a60a` (author `t <t@t>`) to `origin/master`;
  - it pushed a stray `origin/main`;
  - it set `core.bare=true` on the clone. The lead reset that to `false`.

  The clone's files and index are still `c667e9e`. The fixture fix is in PR #6.
- **Waiting on Lachy:** rewrite `origin/master` back to `c667e9e`, or go forward-only. Both routes, with
  their exact commands, are in the rollout note's `## Notes` → *Halted after wave 2*.
- **Freeze holds:** this THREAD.md edit is uncommitted. Commit it after the 2.6.0 `pull --ff-only`.

**2026-09-23 (night) — the E2E is recorded; the self-rollout is scheduled and runs unattended from a
clone.**
- **E2E done** (`docs/e2e/2026-09-23-baseline.md`, `status: recorded`). Verbs 1–15 ran: 14 PASS
  and 1 FAIL (verb 7, repair: `in_progress` + a merged PR). The `defaultBranch` proof passed on all
  five points. The leak check was clean. Cleanup was done except the final
  `rm -rf ~/repos/tools/zz-thread-e2e`, which is the rollout lead's first step; the fixture's GitHub
  repo is deleted. The § 5 findings were folded into phase tasks, and the engine fixes went to the
  protocol 4 intake.
- **Roadmap gathered** (Lachy skimmed the Claude-drafted tasks). `[[Thread Skill]]` now has P1 test
  floor and contracts, P2 continuity core, P3 routing and docs coherence and P4 behaviour evals: 20
  tasks, 11 absorbed tasks tombstoned. p4-5 (the description trims and the 700-char cap) is held until
  the eval baseline exists.
- **Rollout** `[[thread-skill-rollout-2026-09-23]]` covers 19 tasks in about 7 waves, continuous
  auto-merge, verifier `make test`. It runs from the GitHub clone `~/repos/tools/thread-skill-rollout`,
  and its **lead session is launched in that clone**. The engine's agents `cd $WT` once and rely on it
  persisting, so worktrees outside the launch tree would fall back to this checkout.
- **Freeze:** don't commit in this checkout until the release's `git pull --ff-only`. Its local
  master must stay a strict ancestor of `origin/master`.
- **Next (human):** release 2.6.0 per the brief § S2 step 6, re-run the E2E with fresh fixtures,
  record the eval baseline, then schedule p4-5.

**2026-09-23 (later) — E2E § 0 is set up. The verbs run in a second session, launched in the
fixture.**
- **Setup:** the setup session (launched here) confirmed 2.5.3 and ran checklist § 0. It created the
  private repo `lachyts/zz-thread-e2e` (`master` only), the checkout `~/repos/tools/zz-thread-e2e`,
  the vault project [[ZZ Thread E2E]] with tasks t1, t2, t3 and cms, and a leak baseline in the
  fixture's `.git/e2e-leak/`.
- **The split:** a session can't `cd` outside its launch directory, so it couldn't run the verbs
  there. Lachy ruled the split, and the verbs session is now live in the fixture.
- **Findings for S2 to file:** the 2.5.2 and 2.5.3 caches both hold a stray copy of the plugin under
  `.claude/worktrees/enabler/`, which `release-check` misses (checklist § 5).
- **S2's own cwd trap:** S2's cleanup would `rm -rf` its own launch directory. The verbs handoff tells
  verb 13 to split S2 from an S3 that runs the rollout from thread-skill.

**2026-09-23 — audit done; 2.5.2 and 2.5.3 shipped; a live E2E baseline and a self-rollout are
next.** A `/thread:orient` audit (`docs/audits/2026-09-23-thread-audit.md`) found the plugin carrying
two eras (master protocol 3 and the paused protocol 4 redesign), 33 open tasks with no phases, and a
test floor that was partly vacuous. Shipped hands-on as the enabler:
- **2.5.2:** `make test` (`tests/run.sh`, a real workflow parse, a contract floor, hermetic).
- **`args.defaultBranch`:** the engine can now roll out repos whose default is not `main`, this one
  included. There is one source for the base, the repo's GitHub default; merge-wave checks every PR
  against it.
- **2.5.3:** `execute` names the read-only agents that read `repoPath`.

Engine work is held for protocol 4. Three clean-room rounds ran plus one simplify pass. The ledger
fired STOP at round 2, so the fix reverted to one source instead of patching a third time. Next: the
pending handoff (a live E2E of every verb, then `/thread:gather` → schedule → execute of this plugin
from a separate clone).

**2026-09-22 — thread 2 closed; rollout redesign remains open.** Lachy designated
**thread 1** as the main project conversation. **thread 3** and Claude's
**Thread rollout redesign native pilot** continue independently. Read the
[thread 2 closeout and Claude agreement](/Users/lachlants/.codex/worktrees/thread-rollout-redesign/thread-skill/docs/implementation/2026-09-22-thread-2-closeout.md)
for the approved A/B/C scope, finite allowances, authority, last observed
preflight state and evidence locations. The completed Codex pilot is retained;
its success is not full release acceptance. Neither candidate is installed or
released. This closeout does not stop peers or change their runtime records.

**2026-09-21 (latest) — the tier ceiling is consumed, corrected and shipped as
2.5.1; the review chain was stopped by the ledger, not by exhaustion.** Three
clean-room rounds ran this session. Round 1 (`7ed7e6f`/`aaa87d`) was **lost** —
killed mid-run when the CLI process exited, no findings, no doc (estate
[[K42]]). Round 2 (`07ddc75`/`e55ab3`) returned 12 findings, all fixed. Round 3
(`c9f09dd`/`df669e`) returned 15 — and `review-ledger.py` fired **STOP** at 60%
regressions, nine of fifteen citing lines the chain itself had added, every
culprit one of its own fix commits. No round 4 was dispatched. Per fresh-review
§ Rounds the response was **revert to the root**: findings 1, 3, 4 and 8 were
resolved by *deleting* a contortion, not adding a layer to it.

Two real engine defects came out of it, both against the documented contract and
both probe-confirmed: `effortTier` keyed off the lagging `capSuppressed` **event**
flag, so a non-plan-gated capped task ran its full Ralph loop at the LOWER effort
row; and the capped retry budget `floor(n/2)` was **1** at the template default,
where a 1-iteration `ralphLoop` fires step (d) at i==1 and blocks *without*
re-running the verifier. The first fix for the second one was itself defective —
`min(n, max(2, floor(n/2)))` handed n=2 a full second budget, worse at that input
than what it replaced — which is what triggered the revert-to-root. The settled
form is a constant, `CAPPED_RETRY_ITERATIONS = 2`: capped implement cost is
exactly `max_iterations + 2` against an uncapped `1 + max_iterations`, at every n,
no edges. ADR 0016 § 2 was amended to match (it had still taught the event-flag
rule the code now contradicts).

Suite 191 assertions / 0 failures, full README § Tests 7/7, every fix
mutation-checked — including the one that halves a *genuine* escalation's budget,
which passed all 184 assertions before Scenario B was added. **2.5.1 is shipped
and verified**: cache byte-identical to the repo by `diff -rq`, suite green from
the cache copy. Tree clean, `origin/master` == HEAD, zero pending review docs.

**2026-09-21 (later) — leftovers handed off; the consumer ran and died mid-batch.**
The first handoff doc under the new contract
(`docs/handoffs/2026-09-21-tier-review-triage-and-ship.md`) briefed a fresh
session on the stale 2026-09-17 tier-ceiling review and the 2.5.0 ship. That
session consumed the review doc (`af0094f`: 12 dispositioned, 6 verified at
HEAD, 4 fixed) and marked the handoff consumed, then ended without closing —
its four-file fix batch (`wave-execute.workflow.js`, `prompt-invariants.test.mjs`,
`schedule/SKILL.md`, `rollout-template.md`; +60/−4) sits **uncommitted** in this
checkout, presumably per K25 with no review round dispatched. The originating
session's close deleted the consumed handoff doc and its own two consumed
review docs. **The 2.5.0 cache dance has not been run** — sessions still load
2.4.0 until push → marketplace update → plugin update → restart.

**2026-09-21 — v2.5.0: handoff docs are durable, and a pending one owns the
continuation (ADR 0017, amends 0011).** Picked up from the deferred capture
`thread-handoff-durable-lifecycle`. Part 1: `thread:handoff` always writes and
commits `<home>/docs/handoffs/<date>-<slug>.md` — `<home>` the unit directory
(project dir under `~/Projects`, workspace dir under `~/repos/workspaces`, else
the git toplevel) — never OS temp; front matter `thread`/`written`/`status`;
the consumer marks it `consumed` at pickup (paste prompt, or `thread:open`'s new
handoff-doc mode) and its close `git rm -f`s it. Part 2: close § The handoff owns
the continuation — scope test ("would the next session, working from this doc, do
it?"), refresh-don't-restate for the mid-session-then-superseded case, no
annotation, no asking; all tests on disk (one-directory `find`, awk front matter,
consumed = delete whoever marked it); legacy docs without front matter are
counted and untouched. Verified by a five-then-nine-rep close rig (controls
proposed all four candidates; every treatment rep proposed exactly the two loose
ends). Two xhigh clean-room rounds (14 + 15 findings, all dispositioned in
`docs/reviews/2026-09-21-*`); round 2 was 53% about round 1's fixes, so the chain
stopped by METHOD K27 and the rig gated the ship. Stop hook message aligned
(`session_safepoint.py`, fixtures 38/0); Codex adapter stub's OS-temp line
dropped. Manifests re-synced at 2.5.0 (they had drifted 2.4.0 / 2.3.5).

**2026-08-29 — v2.2.0: close saves autonomously; vault tasks stay gated (ADR 0011).**
Lachy called out the close menu as rubber-stamp theatre — he ticks every
memory suggestion unread, so the gate filtered nothing while the memory
estate rotted un-pruned (ops index in ALERT, global triage 65 days overdue).
Grilled six rulings (ADR 0011): the menu survives only for vault tasks;
memory/thread/knowledge auto-execute behind a four-verb save-time triage
(`ADD | UPDATE | SUPERSEDE | NOOP`, NOOP a success state) and a frontmatter
contract (`captured` / `last_confirmed` / `status: provisional|active|
superseded` / `provenance` / `permanent`). The safety moved downstream: a
weekly autonomous **memory curator** (new `~/.agents/skills/memory-curator`,
launchd Sunday 09:30, archive-first — never deletes) prunes/merges/demotes on
*observed* usage from a new daily transcript recall harvest
(`_shared/scripts/memory-recall-harvest.py`); `/memory-triage` retired.
Close's dangling doctrine pointers repaired to
`claude-base-instructions.md § Claude memory management`; project-area file
canonically `AGENTS.md`. The frontmatter contract is a cross-repo interface —
change close and the curator in lockstep.

**2026-08-18: Windows minimal footprint; 2.1.0 finally through the cache.**
The Windows machine (native Windows, user `lachl`, rarely used) requested a
Mac bootstrap that would have re-created infrastructure that already exists:
`~/.claude` is already the private `lachyts/claude-config` repo (allowlist
gitignore, daily-sweep pushed), and its `skills/` entries are Mac-absolute
symlinks whose real bodies live in `lachyts/agents-config`. Grilled twice:
first the transport got corrected, then Lachy called overkill and the scope
collapsed to the three verbs he actually uses there (next/close/orient).
Rulings: plugin + Obsidian-synced vault is the whole Windows footprint; no
personal-config transport (standalone skills and global CLAUDE.md stay
Mac-only); no workspaces clone (shared-thread/registry features degrade
deliberately; clone only when a verb complains); no Windows fork of skill
bodies (a rewrite costs more than the two-command install and drifts
forever); no machine.json indirection (all 46 hardcoded paths resolve via
`expanduser` / Git Bash `~` once the vault syncs to
`C:\Users\lachl\repos\obsidian`). `docs/windows-setup.md` written
full-system (4307eee) then slimmed to the minimal path (118ae5a). Same
session: wave-skill's local clone deleted (the archived `lachyts/wave-skill`
tombstone remains; losslessly verified first); the vault swept NTFS-legal
for Obsidian Sync to Windows (11 renames incl. `*Active* Supplement
Protocol` with 18 wikilink updates; over-length titles shortened with
original phrasing preserved in bodies); and the 08-14 ship-pending item
closed: marketplace + plugin updated 2.0.3 → 2.1.0 on the Mac (session
restart applies). Windows plugin install in flight at close.

**2026-08-14 (later) — v2.1.0: orient launches its own batches (ADR 0010).**
Lachy challenged the SEO orient's paste hand-off believing the cc-* lane had
been retired into the engine. The docs won the factual half: the lane was
never retired (ADR 0009 kept it; the 2026-08-10 mis-routings were the thing
fixed), both SEO batches genuinely fail the fit test, and "run them as
Workflows inside the parent" is impossible — subagents inherit the parent's
MCP config and can never load a different scoped profile. The residue was
real though: the repair-autonomy principle ("never hand him commands to
type") generalises, and the tooling gap ADR 0003 was written against had
closed — `cmux workspace create --cwd … --command` delivers programmatic
scoped-session launch. Two grilled rulings: (1) orient launches batches
itself via cmux with the *expanded* profile alias (emission survives only as
the no-cmux fallback); (2) the steering answer alone authorises — no
per-batch confirm, accepted knowing batches run
`--dangerously-skip-permissions` unreviewed. Live-proven same-day: the SEO
p4/p5 batches fired as cmux workspaces 38/39, prompts verified
in-transcript. Orient §7 rewritten (write + stamp + launch + verify +
fallback), Don'ts gained the no-in-session-Workflow rule, glossary "Dispatch
artefact" updated, memory generalised. **2.1.0 is committed but not yet
shipped through the cache** — needs push → marketplace update → plugin
update → session restart (same dance as ever).

**2026-08-14 — v2.0.3: the review loop has a memory.** The Ralph-loop audit's
review-loop gap closed hands-on (grilled via plan mode, not the self-rollout
the capture's Launch block sketched): the review loop now accumulates
feedback like the plan loop, but with review semantics — the reviser gets the
latest round as its work order plus earlier rounds as ANTI-REGRESSION
constraints (fixes already committed on the branch must not regress), and the
judge gets the same history plus an anti-goalpost discipline (new objections
must come from new commits; round-1-visible nitpicks don't reject). After 2
rejections the round-3+ reviser upgrades to a **step-back round**: licence to
restructure, deviating from the approved plan where the accumulated feedback
demands it — deviations always declared (grilled decision: brief is contract,
plan is reference). Both ceiling outcomes now persist: `approvedAtCeiling`
appends the grouped history under `## Review history (approved at ceiling)`
(the p6-2 auditability gap), and `## Review-blocked feedback` upgrades from
final-round bullets to the full grouped history (legacy results fall back).
`STEP_BACK_AFTER = 2` is an engine constant, deliberately not rollout config
(EFFORT-matrix stance). Glossary gained accumulated feedback / step-back
round / ceiling approval. No ADR — prompt shapes are cheap to reverse.
Remaining from the audit: `thread-schedule-package-init-fileset-blindness` —
run it as a one-task self-rollout from a FRESH session (the version-keyed
cache means only a restart loads 2.0.3): the first live exercise of the
review-loop memory.

**2026-08-13 — v2.0.2 shipped; the merged plugin is live-proven.** The
giflab-rollout-2026-08-12 ran end-to-end on thread 2.0.x — the first
orient-originated rollout ever to reach the engine: 6/6 PRs merged
(giflab #64–#69), one designed gate pause (spend sign-off, amended live via
grill: cap $10→$50, subscription-CLI Claude arms), zero escalations/blocks.
2.0.2 = execute+gather description trims for the skill-listing budget (see
Known quirks); paired with user-settings `skillListingBudgetFraction: 0.02`.
Post-rollout Ralph-loop audit found the review loop has no cross-round
memory (plan loop accumulates feedback; review loop hands revisers only the
latest rejection) and no re-plan lever — three-fix task filed:
vault `thread-execute-review-loop-memory` (scheduled 2026-08-14), plus
`thread-schedule-package-init-fileset-blindness` from the wave-2
`__init__.py` merge-conflict incident. Both are wave-shaped; a two-task
self-rollout is the natural vehicle.

**2026-08-12 — v2.0.1: handoff becomes model-invocable.** Grilled same day as
the merge: the `disable-model-invocation: true` flag on handoff was inherited
from the flat-skill Pocock port (build-plan said "keeps", no rationale ever
recorded), and the asymmetry was backwards — close auto-commits two repos and
is visible; handoff writes only a temp file and was the one hidden route.
Flag dropped; description + body now gate on explicit fork intent or router
dispatch, with a hard no-proactive rule (context-feels-long → recommend
`next`, never self-fire). Decided: visible/explicit-intent over
visible/proactive and keep-hidden. No ADR — one-line reversible flag, stance
recorded here + CONTEXT.md § Handoff.

**2026-08-12 — v2.0.0: thread absorbs wave (ADR 0009).** The wave plugin
(`lachyts/wave-skill`, v1.4.1) merged in with full git history; all six
rollout verbs renamed `/wave:*` → `/thread:*`; "wave" is now a glossary
object, not a namespace (`wave:` frontmatter, `WAVE-STATUS:`, engine
internals unchanged). Behavioural changes from the same grill interview:
the execution-fit test got one canonical home
(`skills/_shared/execution-fit.md`) and decides the lane HARD (orient never
offers cc-* batches for wave-shaped clusters — closes the 08-10
GifLab/Smart Slider leak); schedule's <3-task floor is gone (shape decides,
not count — one-task rollouts are valid); the session-lane fallback names
its owners (defer / open's ## Launch). Wave ADRs renumbered 0004–0008;
wave's THREAD.md preserved at docs/wave-THREAD-archive.md; wave-skill
pinned at wave--v1.4.1 and archived. Live rollout notes (protocol_version:
3, incl. the open giflab-rollout-2026-08-12) remain executable unchanged.

Previous state: v1.0.1 built AND installed 2026-07-14 (`thread@thread`, user scope, GitHub
marketplace from `lachyts/thread-skill`). All six members live; flat skills
retired; workspace references migrated; vault project note [[Thread Skill]]
created. Same-day follow-up: Notion retired ecosystem-wide — close's
cross-machine-handoff destination deleted; plugin + Codex adapter +
workspaces instruction surfaces swept; shipped as 1.0.1 (session restart
applies it). Remaining: the live end-to-end verification checklist (fresh
session) — tracked by the vault task `thread-plugin-live-verification`,
scheduled 2026-07-15.

## What's been built / decided

- Plugin scaffold mirroring wave: manifests, CONTEXT.md, docs/adr/, README.
- Decisions live in `docs/adr/` — read the directory, never a remembered
  subset. ADR 0001 (the task is the floor; the thread is the upgrade) and
  ADR 0002 (`next` is a sibling, not a parent) shaped this scaffold; 0009
  (thread absorbs wave), 0010 (orient launches its own batches) and 0011
  (close saves autonomously) govern current behaviour.
- Canonical THREAD-template.md home: `~/.agents/skills/thread/THREAD-template.md`
  (harness-neutral; `check-agent-parity.py` pins it).
- Pickup auto-completes the capture task (decided in design interview).
- Stash surfacing: `/weekly` "Stashed threads" pass (decided in design interview).
- Codex `.agents/skills/{thread,close}` adapters kept as their audit-era
  **native translations** (not thinned to pointers as the plan suggested) —
  undoing deliberate Codex-safety work wasn't worth the dedup; only
  `handoff`'s canonical pointer was repointed at this repo.
- Vault project note `Work/Projects/AI/Thread Skill.md` is the
  human-facing surface (goal, terminology, wave-sibling framing); its
  `repos:` frontmatter auto-routes tasks captured from this repo's CWD.
- Build lineage: `docs/build-plan.md` (the approved plan, copied in at close).
- **2026-09-25, the model tier is locked:** Opus 5.5 is the top tier until Lachy edits
  `~/.agents/AGENTS.md` § Model tier by hand (`~/.agents` commit `10ceaf6`). Rollouts of this plugin set
  `max_tier: opus` and stamp no `model: fable`. schedule's text still calls `max_tier` a quota switch
  ("leave it commented out"); the AGENTS.md section is the explicit operator instruction ADR 0016 asks
  for. This repo's `fable-first-model-stance` memory is marked overridden.
- **2026-09-25, the close peer guard (p2-4, PR #16):** a consumed handoff doc is deleted at the
  marker's own close, or by any later close once its mtime is 24 h old and no listed peer sits in its
  `<home>` or `Run from:` directory (`skills/_shared/handoff-lifecycle.md` § Close-out). `ListAgents`
  rows carry no cwd as of 2026-09-25, so on Claude the 24 h floor is the whole guard, and close skips
  the listing. This resolves the 2026-09-21 open question on deleting from under a live peer.
- **2026-09-24, the leak cleanup:** it took the rewrite route. `origin/master` was force-pushed back to
  `c667e9e` with a lease, `origin/main` was deleted, and a clone-local `pre-push` guard refuses
  `master`/`main` pushes (rollout note § *Resolved 2026-09-24*). A rollout lead never approves gates. It
  halts on `gate-pending` and parks the decision in the rollout note (p1-3 on 2026-09-24, p4-1 on
  2026-09-25; both were withdrawn by Lachy, not approved).
- **2026-09-23:**
  - **Tests:** `make test` is the one test entrypoint and the self-rollout verifier. New suites join by
    filename. `make release-check` verifies the version-keyed cache after a release.
  - **Base branch:** the rollout base is the repo's GitHub default. The argument is
    `defaultBranch`, never `baseBranch`, which protocol 4 owns. The resolver stops rather than assume
    `main`.
  - **Engine work:** held for protocol 4 except that enabler.
  - **Self-rollouts:** a self-rollout of this plugin runs from a GitHub-origin clone under `~/repos`,
    never the live checkout.
  - **Three test layers:** contract tests, `claude plugin eval` behaviour evals, and a live E2E checklist
    (`docs/e2e/`).
- Notion handoff destination deleted from close (2026-07-14), not re-routed:
  Notion is a read-only legacy archive (personal → Obsidian migration
  pending); THREAD.md, git-committed by the close flow, is the cold-pickup
  artifact — a Notion page duplicated that guarantee.

## Open questions / decisions pending

- **`lachyts/thread-skill` has no CI and no branch protection.** The rollout clone's `pre-push` hook is a
  local guard only. Vault task `thread-skill-protect-master-ci`.
- **The stale `thread@thread` 2.3.4 project-scope record at `~`** is still installed. Uninstalling it is
  unsafe as written: all three profiles' `settings.json` are symlinks to `~/.claude/settings.json`, which
  is also the project settings file for `~`. Vault task `thread-skill-stale-project-scope-install`.
  Related, not yet investigated: `check-agent-parity.py`'s skill-packages check still takes thread 2.3.4
  (`e586b19`) as the selected release, so it reports the 2.6.0 cache and this checkout as drift. A release
  here doesn't update that selection (seen 2026-09-25).
- **Protocol 4 intake** from the 2026-09-23 audit:
  - port `defaultBranch` to the redesign's protocol 3 path
  - gate the release on the zero-rounds fail-open bug
  - the pilot requirement notes never close
  - read-only agents read a mutable checkout
  - scrub `GIT_*` for the verifier and agents (the 2026-09-23 self-rollout leak; vault task
    `thread-rollout-v4-scrub-git-env`)
  - `parseGatedInputs` reads past a thematic break, so p4-1's feedback list became 23 gates on
    2026-09-24 (intake item 13)
  - items 14–17 from the rest of the self-rollout: the lessons are in § Known quirks
  - from the 2.7 rollout: `skills/execute/scripts/merge-wave.sh:102` reads the branch with
    `git rev-parse --abbrev-ref HEAD`, which has the ambiguous-ref bug p2-6 fixed in `repo-state.sh`
    (a tag named `master` gives `heads/master`)
  - from the 2.7 rollout: a verifier red on the base branch, outside a task's `touches:`, blocks the
    implementer. p2-7's capped retry then widened scope into `skills/execute/tests/`. Re-run the verifier
    on base before blocking. The first pass's `## Blocker diagnosis` also stays on the note after a
    successful retry.

  Vault task `thread-rollout-v4-intake-2026-09-23-audit`, owned by thread 1.
- **Two tier-ceiling gaps deferred from the 2026-09-21 round-3 review** (held for protocol 4 since the
  2026-09-23 audit; the redesign already carries most of gap 1)
  (`docs/reviews/2026-09-21-c9f09dd-df669e.md`, findings 12 and 14). Both are
  pre-existing — neither was introduced by that chain — and both were left
  alone deliberately because `review-ledger.py` fired STOP on that round
  (60% regressions, culprits the chain's own fix commits), so a fourth patch
  round was the wrong move. Recorded here because the review doc is deleted at
  close-out.
  1. **`/thread:status` and `/thread:repair` never mention `tier_capped`.**
     ADR 0016 § 3 names those two skills as the consumers of the durable
     marker — the whole justification for stamping it on the note rather than
     leaving it in the workflow return — but `grep -rn 'tier_capped' skills/`
     matches only schedule, execute and `reconcile-wave.py`. So a capped
     rollout's blocked tasks get triaged by `/thread:repair` as genuine walls,
     which is exactly the failure mode ADR 0016 § 3 exists to prevent. Fix is
     two conductor-skill edits; needs a decision on the triage wording.
  2. **A capped run that goes green on its first pass records nothing.**
     `escalate()` is never called, so `capSuppressed` stays false, so
     `tierCapped` is false and reconcile stamps no marker. That task ran a full
     Ralph loop at the higher EFFORT row on the capped model — a materially
     different profile from an uncapped opus success — and the note cannot be
     told apart from one afterwards. Auditing which tasks in a rollout ran
     ceilinged is impossible once the lead session ends. Fix needs a new result
     field (the run was capped) distinct from the existing one (an escalation
     was suppressed), plus a reconcile change: a design decision, not a cleanup.

- **Chorus Suggestion-card seam (estate METHOD K40, 2026-09-21).** The Stage's
  Suggestion card (chorus ADR 0036) has a **Keep** that writes a vault task
  directly — the Host writes it, so close's ADR 0017 rule never gets a vote —
  and a **Start** that carries no pointer to the pending handoff doc. Handed to
  this thread as findings-not-spec; the seam is deliberately undecided: does
  the Stage learn what a handoff doc is, or does `thread:handoff` emit a
  Suggestion? Owner is this thread.
- Does `${CLAUDE_PLUGIN_ROOT}` expand in the Stop-hook command under the
  native-Windows hook runner? The first Windows session end answers it; if it
  fails, the fix lands in `hooks/hooks.json` here, never a local patch.
- Windows install verification pending: marketplace add (gh auth), first
  `/thread:next` (vault path resolution), Stop-hook noise (python3 shim is
  the optional quieting fix).

## Known quirks (don't re-derive)

- **A `cd` in a Bash call moves the session's working directory, but only inside the launch tree.**
  - Inside the tree, it moves. Background clean-room reviewers resolve `git diff` against that
    directory, so while a review runs the lead uses `git -C` and absolute paths only. (2026-09-23: one
    `cd` into the root checkout mid-review would have pointed a worktree review at a clean tree. Caught
    and reverted before the fork started.)
  - A `cd` outside the tree is reset by the harness: `Shell cwd was reset to <launch dir>`. So work
    that needs the CWD-bound verbs against another repo needs a session **launched there**:
    open/close thread lookup, stash/defer routing, and handoff's `<home>`. The engine is exempt,
    because it anchors on `repoPath`. (2026-09-23: this forced the E2E's S1 split.)
- **`plugin update` at one version is not enough.** The cache follows the version number. A content
  change needs both manifests bumped, then `claude plugin update thread@thread`, then `make
  release-check`. The check compares the cache's `skills/` and `hooks/` with the tree, and it
  resolves the cache via `CLAUDE_CONFIG_DIR`.
- **Two sessions can share one checkout** (a handoff consumer opened in the
  same directory). Every delete-at-close lifecycle here — handoff docs, review
  docs — assumes one writer; a `git rm -f` or a restore in one session lands in
  the other's working tree (the 2026-09-17 review "working-tree incident" is the
  precedent). Check `ListAgents` for a peer in this cwd before deleting or
  restoring anything another session may hold. Since 2.6.0, close's peer guard
  enforces this for consumed docs (§ What's been built, 2026-09-25). Its 24 h
  floor reads the file's mtime, so a pull that rewrites the doc resets it: at the
  2026-09-25 close the 2.6.0 pull made a review doc consumed two days earlier
  read `keep fresh`.
- **The plugin cache stays on the old version until the dance is run.** A
  `/thread:handoff` invoked from a session launched with `--plugin-dir` on this
  repo loads the working-tree text (2.5.0 seen 2026-09-21); an installed-plugin
  session loads the cached 2.4.0 text until the restart.
- Colon namespace (`thread:defer`) requires plugin packaging; skill frontmatter
  carries the bare `name:` and Claude Code composes the prefix.
- `disable-model-invocation: true` hides a skill from the model's list but
  keeps the `/slash` form. No skill here carries it any more (handoff dropped
  it at 2.0.1); `skills/execute/SKILL.md` warns against ever adding one.
- `AskUserQuestion` requires ≥2 options per question — a close destination
  section with a single candidate can't be its own menu question; merge
  single-candidate sections into one combined multiSelect.
- A plugin installed **mid-session** hot-registers member *names* into the
  running session's skill list, but descriptions only index at session start —
  members render bare (`thread:close`) until a fresh session. Files were
  verified well-formed; don't debug this again.
- NotchBar's AgentStatus (Bartender) rewrites the direct `~/.codex/hooks.json`
  on its own schedule, injecting notify handlers tagged
  `# notchbar-agents-codex-hook` into every event (including a `Stop`) and
  flipping `features.codex_hooks` in the direct config only.
  `check-agent-parity.py` treats both as app-managed (carve-out added
  2026-08-12, same precedent as its `node_repl` fields). Codex `hooks.state`
  `trusted_hash` values are Codex-internal — they match no derivable
  serialisation of the hook; never hand-author trust entries.
- **Skill-listing budget silently drops descriptions.** Claude Code caps the
  model-facing skill listing at `skillListingBudgetFraction` (default 0.01 =
  1% of context) with a 1536-char per-description cap; over budget, whole
  descriptions vanish and skills render as bare names — killing their
  natural-language triggering (7 of 13 thread skills were bare pre-fix).
  User settings carry `0.02` since 2026-08-13; keep SKILL.md descriptions
  ~600–700 chars (2.0.2 trimmed execute+gather; `schedule` is the next trim
  candidate). Files can be perfectly valid YAML and still render bare —
  check the budget before debugging frontmatter.
- **Vault filenames must stay NTFS-legal** (no `? * : " < > |`, no trailing
  space/dot, basenames within MAX_PATH) or Obsidian Sync silently refuses
  them on Windows. Capture titles become filenames, so task-writer is a
  producer of this risk (sanitisation task proposed and declined 2026-08-18;
  vault swept clean same day, link-safety verified before each rename).
- **A backgrounded clean-room review does not survive the CLI process
  exiting.** Round 1 of the 2026-09-21 tier-ceiling chain was dispatched
  `run_in_background: true`, the process restarted mid-run, and the task
  notification read "no completion record was found" — no findings, no review
  doc, ~5 minutes of engine time for nothing. fresh-review's never-blocking rule
  ("dispatch, keep working, findings land in `docs/reviews/` if you're gone by
  then") assumes the session outlives the agent. Re-dispatching in the
  background worked twice afterwards, both returning synchronously through the
  wrapper's Skill call. Estate [[K42]] holds the general form.
- **The version-keyed cache no longer governs this plugin — corrected
  2026-09-21.** The old rule (skills execute from
  `~/.claude/plugins/cache/thread/thread/<version>/`; bump both manifests →
  push → `claude plugin marketplace update thread` → `claude plugin update
  thread@thread` → restart) was verified 2026-07-14 shipping 1.0.1 and is kept
  here only so the next reader does not re-derive it from a stale memory.
  Since the marketplace was re-registered as a **`directory` source pointing at
  this repo** (`extraKnownMarketplaces.thread` →
  `{"source":"directory","path":"/Users/lachlants/repos/tools/thread-skill"}`,
  `installLocation` = the repo itself), a session loads the skills from the
  **working tree**. Evidence, 2026-09-21: the newest cache dir anywhere is
  `2.3.4` (there has never been a 2.4.0 or 2.5.0, in either
  `~/.claude/plugins/` or `~/.claude-profiles/animately/plugins/`), that tree's
  `skills/handoff/SKILL.md` has **zero** occurrences of `docs/handoffs`, yet a
  session started at 2.5.0 lists `thread:handoff` with the full durable-doc
  description. So: **a committed change is live in the next session with no
  cache dance at all**, and `claude plugin list` reporting `2.3.4` is stale
  registry metadata from the last explicit update (2026-09-14), not what runs.
  Caveat on scope: what is verified is that the *skill text the model sees*
  comes from the repo. `${CLAUDE_PLUGIN_ROOT}` was not separately probed, so a
  skill that shells out to `${CLAUDE_PLUGIN_ROOT}/scripts/...` may still
  resolve into the 2.3.4 cache — check that before assuming scripts are live.
  Still bump both manifests on a release: the version is the record, and a
  github-sourced install elsewhere would need it.
- **The hazard that correction creates.** The version-keyed cache was an
  accidental safety barrier: nothing shipped until two manifests were bumped
  and the plugin updated. With a directory source there is no barrier, so
  **uncommitted, half-finished edits in this working tree are live in every new
  session across the estate** — a SKILL.md mid-rewrite, a `workflow.js` with a
  syntax error, a prompt with a contradiction. The guard is behavioural: land
  skill edits in one write rather than leaving them open across a break, and
  `git stash` before stepping away from a partial edit. (This is not
  hypothetical — the 2026-09-21 session began with four modified skill files
  sitting in the tree.) Verify a release two ways, not one: the repo tree AND
  `~/.claude/plugins/cache/thread/thread/<version>/`, which `claude plugin
  update thread@thread` still rebuilds and which `${CLAUDE_PLUGIN_ROOT}` may
  resolve to for script paths. **The version-keyed half of the old rule is
  still live, and this is where it bites**: changing content *under an
  already-cached version number* does NOT refresh the cache. Measured
  2026-09-21 — 2.5.0 was cached, four skill files were then fixed and pushed
  still at 2.5.0, and the cache kept serving the defective engine
  (`CAPPED_RETRY_ITERATIONS` absent from the cached copy while the repo had
  it). A content change that matters therefore needs a version BUMP, not just
  a re-run of the update; `diff -rq <cache>/skills skills` is the check.

- **A `cd` into an additional working directory moves the session's primary working directory**; it is
  not reset. Seen 2026-09-23 in a rollout lead (`cd ~/repos/obsidian/...`), where the engine's launch
  tree follows it, and again 2026-09-25 in a plain close session. Any session launched here with the
  vault as an additional directory uses absolute paths and `git -C` for vault work and never `cd`s
  there.
- **Tests that run git must be `GIT_*`-safe.** An exported `GIT_DIR` that points at a linked worktree's
  gitdir reaches the shared refs and config through commondir. On 2026-09-23 this happened with
  `tests/default-branch.test.sh`: its `git init --bare` set `core.bare=true` on the main checkout, its
  commits landed on the shared `master`, and its `git push origin` went to the real GitHub remote. p1-3's
  PR #6 landed on 2026-09-24 (`b52270d`). `tests/run.sh`, `default-branch.test.sh` and
  `handoff-scan.test.sh` now run `unset $(git rev-parse --local-env-vars)`, which is git's own list of 15
  variables. The engine-side scrub for the verifier and agents is still protocol 4.
- **A plan's `### Gated inputs` must be its last section**, until protocol 4 fixes the parser (intake item
  13). `parseGatedInputs` ends the section only at a heading. A `---` and a bullet list after `None` are
  read as declared gates, and the task pauses at `gate-pending` (p4-1, 2026-09-24).
- **The Workflow tool's task output file is a JSON envelope.** The engine's return value is its `result`
  field, a JSON string. A lead extracts it (`json.load(f)["result"]`) into a file before
  `reconcile-wave.py reconcile --result`; the file as a whole is not the result.
- **Implementers may rebase a reused in-flight branch** onto the new base, even though the worktree
  prompt says the reuse arms must not. p1-3's PR #6 branch got new hashes on 2026-09-24. This is
  harmless under squash-merge, and the `pre-push` guard covers only `master`/`main`.
- **This repo has no required checks.** `merge-wave.sh` reports "no required checks" and squash-merges
  anyway. Nothing verifies the combined tree unless the lead re-runs `make test` on the merged base, and
  nothing refuses a stray push to `master`.
- **`make release-check` (p1-1's recipe) is exact, so it is only meaningful right after a release.** It
  was green at 2.6.0 (`3a7b9be`). It fails if anything sits under this checkout's `.claude/worktrees/`
  during the plugin update, or once a file tracked at release time is deleted (the consumed review doc
  this 2026-09-25 close removed). Run it right after `claude plugin update`, on the released commit.
  This file's older release-check descriptions predate p1-1's recipe. At 2.7.0 (`15638b6`) the expected
  stray is the post-rollout handoff doc that the 2.7.0 close deleted.
- **A skill's text is rendered from the tree as it stood when the session started, not at invocation.**
  The directory-source marketplace loads skill text from this working tree. Seen 2026-09-25: after
  `git pull --rebase` brought p2-7 in, `/thread:close` still rendered the 2.6.0 body, with no rung 3 (tool-repo
  threads) and no repo-state step, although the source SKILL.md had both. After a pull or release
  mid-session, read the SKILL.md from source with `sed` (as for the `$N` quirk below), or restart.
  `claude plugin update` also says "Restart to apply changes".
- **Invoking a skill with arguments rewrites `$0`, `$1`, `$2`… in its body.** Claude Code substitutes the
  whitespace-split arguments, 0-based, into the SKILL.md text before the model sees it, and that includes
  shell and awk variables. Seen 2026-09-25: `/thread:close` with a one-sentence argument rendered the
  handoff-scan snippet with `$0` → `Active`, `$1` → `thread:` and `$2` → the THREAD.md path, so
  `print $2` read `print ~/repos/tools/thread-skill/THREAD.md`. A bare `/thread:close` later that day
  rendered the same snippet intact, so only an invocation with arguments triggers it. The tests extract the snippets from the
  source files, so `make test` cannot see it. Until it is fixed, run an embedded snippet from the source
  (`sed -n '/^# thread:handoff-scan/,/^# end thread:handoff-scan/p' skills/close/SKILL.md`), never the
  rendered text. `skills/execute/SKILL.md:177` (the default-branch resolver's awk `$2`) is exposed too,
  but that has not been probed.
- **Self-rollout lessons, 2026-09-23 to 2026-09-25** (protocol 4 intake items 14–17, vault task
  `thread-rollout-v4-intake-2026-09-23-audit`):
  - **`resume-filter` misses archived notes.** The daily sweep moves `done` task notes to
    `Work/Tasks/Archive/`. `resume-filter` looks only in `Work/Tasks/`, prints "note not found …
    including for dispatch", and so listed p2-1 and p3-2, both merged, for re-dispatch. `status`
    resolves the archive. Until it is fixed, check a resume list against `/thread:status` before
    dispatching.
  - **A second `plan-blocked` loses its feedback.** `reconcile` appends `## Plan-blocked feedback` once
    per heading, so a re-dispatched task that blocks again keeps only the first pass (p4-1 on 2026-09-24,
    p2-3 on 2026-09-25). The lead copies the second pass into the note by hand. Vault task
    `thread-skill-plan-blocked-feedback-append-once`.
  - **Attaching the last plan converges a re-dispatch.** A re-dispatch re-plans from scratch. With its
    approved plan added to the note as a reference (and the resolution list moved above
    `### Gated inputs`), p4-1 converged in one plan round. The engine does not do this yet.
  - **The cold-resume flush can merge an unreviewed PR.** Execute § 4.5 *Cold resume* re-runs
    `merge-wave.sh` on the next wave's open PRs. On 2026-09-25 p2-4's PR #16 was open with its review
    round 2 failed, and a literal flush would have merged it unreviewed. Flush only PRs whose note is at
    `status: review`.
  - **A lapsed account comes back as `blocked`.** When the animately account lapsed mid-review ("Your
    organization has disabled Claude subscription access for Claude Code"), the engine returned
    `blocked` with a transient-infrastructure diagnosis. After the move to another account,
    `resumeFromRunId` on the same run replayed the cached stages and re-ran only the failed review.

## Resume instructions

**Now (from 2026-09-25, evening): 2.7.0 is released. Nothing is running and no handoff doc is pending.**
- **Order** (the rest of the 2.7 plan, unchanged):
  1. The eval baseline (Lachy's USD 5 spend, `thread-skill-eval-baseline-then-p4-5`), then schedule p4-5.
     release-check now refuses a non-empty `evals/results/`, so record a paid run in `docs/evals/` and
     clear the directory before the next release.
  2. The E2E, once, on 2.7.0. Retarget `thread-skill-e2e-rerun-on-2-6-0` first, so one live pass covers
     both releases.
  3. Retire the rollout clone (`thread-skill-retire-rollout-clone`, now unblocked). It is clean at
     `393829c`, with the four 2.7 task worktrees still under `.claude/worktrees/`.
  - Any time alongside: the `$N` snippet fix (hands-on, because it needs a live probe),
    `thread-skill-protect-master-ci` (Lachy's call), the p3-1 and p3-3 design calls,
    `safepoint-uses-handoff-home-resolver` (in the workspaces repo), the stale 2.3.4 install, and the four
    follow-ups filed at the 2.7.0 close (§ Where we are).
- **Run embedded snippets from the source SKILL.md with `sed`** (§ Known quirks: the `$N` entry, and skill
  text rendered at session start).

**Superseded 2026-09-25 (evening): run the 2.7 rollout.** The order and the paste-ready lead prompt are in
`20147f3`. The rollout ran as planned.
- The instructions below predate this and are kept for history.

**Superseded 2026-09-25 (afternoon): the self-rollout was ready to resume. Nothing was running.**
- **Resume:** launch a fresh lead in `~/repos/tools/thread-skill-rollout` and run
  `/thread:execute [[thread-skill-rollout-2026-09-23]]`. With the cursor at 2/7, it re-dispatches p4-1
  (gates withdrawn), then runs waves 4–7. That is 8 tasks left.
- **Lead rules** (rollout note § *Resolved 2026-09-24* and § *Resolved 2026-09-25*):
  - never approve gates;
  - never push or reset `master`/`main`;
  - never point `GIT_DIR` at the clone;
  - make no commits in this checkout;
  - park anything only Lachy can decide.
- **When it's done,** release 2.6.0 (brief § S2 step 6). Pull here first (`git pull --ff-only`, and this
  file's uncommitted edit rides along), then bump, then run the cache dance.
- The instructions below predate this and are kept for history.

**Superseded 2026-09-24: the self-rollout was HALTED after wave 2, waiting on one decision.**
- **Read first:** `[[thread-skill-rollout-2026-09-23]]` § Notes → *Halted after wave 2*. It has the leak,
  the parked tasks and the exact commands for both routes.
- **Decide:** (a) rewrite `origin/master` to `c667e9e` and delete `origin/main`, or (b) go forward-only.
  Then re-invoke `/thread:execute [[thread-skill-rollout-2026-09-23]]` from a session launched in
  `~/repos/tools/thread-skill-rollout`, never from here. The cold resume merges PR #7, re-dispatches p3-1
  and p1-3, and continues from wave 3.
- **Don't** approve p1-3's gates once anything has merged on top of `018a60a`. **Don't** hand-edit a task
  back to `in_progress`: that is the verb 7 gap, and resume would re-dispatch merged work.
- **When it's done,** release 2.6.0 (brief § S2 step 6). Pull here first (`git pull --ff-only`, and this
  file's uncommitted edit rides along), then bump, then run the cache dance.
- The older instructions below predate this and are kept for history.

**The live E2E baseline is running.**
- **The S1 verbs session is live**, launched in `~/repos/tools/zz-thread-e2e` (peer `zz-thread-e2e-0b`).
  It consumed `docs/handoffs/2026-09-23-thread-e2e-verbs-1-13.md` and runs verbs 1–13.
- **The live record** is `docs/e2e/2026-09-23-baseline.md`, which that session edits and commits.
- **Pick up S2 from** the handoff its verb 13 writes into `~/repos/tools/zz-thread-e2e/docs/handoffs/`.
  - Don't start S2 from here. The shared brief `docs/audits/2026-09-23-rollout-brief.md` § S2 carries
    the rest, and the gather draft.
  - Expect S2 to split: S2 in the fixture, then S3 here for the `rm -rf` and the rollout.
- **Pending deletion:** the next close here deletes the consumed verbs doc, once no peer holds it.

**Rollout redesign, 22 September 2026:** coordination now belongs to **thread 1**.
Read the [thread 2 handback](/Users/lachlants/.codex/worktrees/thread-rollout-redesign/thread-skill/docs/implementation/2026-09-22-thread-2-closeout.md)
and the current records owned by thread 3 and the native Claude pilot before
acting. Their work continues independently; do not duplicate dispatch, reuse the
completed Codex pools, or infer release readiness. The instructions below describe
the earlier released 2.5.1 checkpoint, not completion of the protocol 4 candidate.

0. **Nothing is half-done — the tree is clean and 2.5.1 is shipped.** The
   2026-09-21 four-file batch was reviewed, corrected across two rounds and
   committed; the cache dance ran and was verified (`diff -rq` against the
   2.5.1 cache, suite green from the cache copy). A session restart is all that
   is needed for 2.5.1 to load. Do **not** open a new `/code-review` chain on
   the tier ceiling: `review-ledger.py` stopped the last one at 60%
   regressions. The shipped code at `6b8188c` has had no clean-room pass —
   `/simplify` is the engine that has never run on it and is the honest way to
   close that gap. Start from § Open questions, which carries the two deferred
   findings.
1. Read this file, then `CONTEXT.md` and the ADRs in `docs/adr/` — the whole
   directory, not a subset. The rollout lane, orient's self-launching and
   close's autonomy each rest on an ADR added after v1.0.0.
2. `skills/_shared/task-writer.md` is the single source for task shape —
   never change task behaviour in a route skill directly.
3. Automated checks are `README.md` § Tests. A live end-to-end checklist is
   written from the current specs — `task-writer.md` § 3b (a `defer` is not
   done until the target day note carries its `## To do` line; the TaskNotes
   agenda is secondary discovery) plus each route's SKILL.md.
   `docs/build-plan.md` § Verification is the historical v1.0.0 checklist: it
   predates § 3b and passes a defer that writes only `scheduled:`. Don't
   route live testing through it.

## Session log

- 2026-09-25 (evening): picked up the post-rollout handoff. Rebased this checkout onto `393829c` (`--autostash`; `--ff-only` was impossible with `42360be` unpushed), and `make test` was ALL PASS. Released 2.7.0 (`15638b6`, pushed, plugin updated, release-check green). The close deleted the consumed handoff doc, filed four rollout follow-ups, added two protocol 4 intake items and the render-at-session-start quirk.
- 2026-09-25 (later): prepared the 2.7 rollout. Pushed `d59bcb3`. Tidied the clone: removed p2-4's merged worktree and branch, fast-forwarded to `d59bcb3`, and `make test` is ALL PASS. Locked Opus 5.5 as the top tier in `~/.agents/AGENTS.md` (`10ceaf6`); the 2026-09-23 rule had lived only in memories this session never loaded. Wrote the lead prompt into Resume. A bare `/thread:close` confirmed that the `$N` quirk needs arguments.
- 2026-09-25 (afternoon): close-out after the 2.6.0 release (`3a7b9be`, release-check green). Folded in the uncommitted 2026-09-25 resume edit, rewrote Where we are and Resume to the finished state, moved the peer-guard question to decided (p2-4), added the five rollout lessons (intake items 14–17) and the skill-argument `$N` quirk to Known quirks, and deleted the consumed 2.5.2 simplify review doc. Remaining: p2-6, p2-7, p3-1, p3-3, p4-5 and seven follow-up tasks.
- 2026-09-25 (morning to midday): self-rollout lead `execute-2026-09-25-a809daf4`. p4-1 converged with its last plan attached (#10). Waves 4–5 merged (#11–#15). p2-3 plan-blocked twice, and Lachy's decisions deferred and split it (p2-6, p2-7), so wave 6 closed empty. Wave 7's p2-4 (#16) survived an account lapse via `resumeFromRunId`. Completed 37h 22m after dispatch.
- 2026-09-24 (morning): self-rollout resume lead (unattended, `execute-2026-09-24-a91d0c16`). Finished wave 2: #7 (p3-4) and #6 (p1-3, the test-side `GIT_*` scrub). Merged #8 (p3-2) and #9 (p2-1) in wave 3, leaving `master` at `d85a3c7`, green. p4-1 was plan-blocked, re-dispatched, then came back with 23 phantom gates (the parser reads past `---`, intake item 13). The lead halted for Lachy, who withdrew the gates on 2026-09-25. Cursor 2/7, 8 tasks left.
- 2026-09-24: self-rollout lead (unattended). Step 0 done (zz-thread-e2e removed). Wave 1 merged 5/5 (#1–#5), and the combined tree was green. Wave 2 halted: a p1-3 agent's `GIT_DIR` experiment leaked fixture commits onto GitHub master and pushed a stray `origin/main`. p1-3 is gate-pending on the repair, p3-1 is plan-blocked, and p3-4 is approved and held. The cleanup decision is Lachy's.
- 2026-09-23 (later): E2E setup. Checklist § 0 is done: fixture repo and GitHub repo, the vault fixture, and the leak baseline. A `cd` outside the launch directory gets reset, so S1 split into this setup session and a verbs session launched in the fixture (Lachy's ruling). § 5 records the stray worktree copy in the plugin caches. The cd quirk is corrected.
- 2026-09-23: /thread:orient audit. Shipped 2.5.2 (make test, the contract floor, args.defaultBranch; one source for the base after the ledger STOP) and 2.5.3 (execute names the read-only agents). Wrote the E2E checklist, the rollout brief and the S1 handoff. Engine defects held for protocol 4. Stale 2.3.4 install left pending (settings symlink hazard).
- 2026-09-22: Closed only thread 2 and saved its Claude-pilot agreement/status/evidence handback; thread 1 now leads, thread 3 and Claude continue independently, rollout redesign remains open.
- 2026-09-21 (latest): consumed the stale 2026-09-17 tier-ceiling review and two further clean-room rounds (12 + 15 findings); round 1 lost to a CLI restart; round 3 hit the ledger's STOP at 60% regressions, so no round 4 — reverted to the root instead (retry budget is now a constant, not arithmetic over max_iterations). Two real engine defects fixed (effort keyed off a lagging event flag; a 1-iteration retry loop at the template default), ADR 0016 §2 amended, Scenarios F and G added, 191 assertions. Shipped 2.5.1 and verified the cache byte-identical — the version-keyed cache is still live and a same-version content change does NOT refresh it. Two findings deferred to § Open questions + vault tasks.
- 2026-09-21 (later): handed the leftovers off via the first ADR 0017 doc; the consumer consumed the 2026-09-17 round-2 review (af0094f) and left its four-file fix batch uncommitted, no close; this close deleted the consumed handoff doc + the two consumed 2026-09-21 review docs; concurrent-checkout hazard logged (open question + estate METHOD row); ship still pending the cache dance.
- 2026-09-21: 2.5.0 — durable handoff lifecycle in `thread:handoff` (docs/handoffs, never temp; pending→consumed→deleted) + close's handoff-owns-the-continuation rule (ADR 0017 amends 0011); `thread:open` handoff-doc pickup; two xhigh rounds consumed, K27 stop, rig-gated; hook + Codex stub aligned; manifests 2.5.0. Ship pending: push → marketplace update → plugin update → restart.
- 2026-09-01: 2.3.1 — phantom-gate footnote fix (ADR 0013): parseGatedInputs reads only list items ("- "/"* "/"+ "/numbered), prose in "### Gated inputs" is commentary; a section with no items and no "None" fails closed to plan-blocked (self-healing re-plan, same door as missing); planner/judge/reviser prompts hardened to bullets-only. Live trigger: chorus-rollout wave 2's planner footnote paused a fully signed-off task at gate-pending. Prompt bytes changed — in-flight resume caches re-run (clean, not corrupt). Shipped through the cache; restart applies.
- 2026-08-31: 2.2.1 — docs-only patch shipping the 2026-08-30 doc-audit remediation through the cache (0ee53f6): repair's model-facing description now matches the ADR 0009 glossary (engine, not wave, holds merge authority); THREAD.md resume instructions point at all of docs/adr/; build-plan.md stamped historical.
- 2026-08-29: 2.2.0 — close de-gated (ADR 0011): menu only for vault tasks; four-verb save-time triage + provisional/provenance frontmatter; weekly memory-curator system + daily recall harvest built on the workspaces side; /memory-triage retired; doctrine pointers repaired; ">4 sections" dead prose deleted (open-question nit resolved). Curator dry-run clean (byte-identical restore) → 7 spec fixes; inaugural live launchd run OK (archived 1 · merged 2 · demoted 3 · 47 index lines repaired; decay correctly gated by legacy grace) after one exit-127 fix (launchd PATH omits ~/.local/bin — runner resolves CLAUDE_BIN). 2.2.0 shipped through the cache; restart applies.
- 2026-08-18: Windows scope grilled down to a next/close/orient minimal footprint (plugin + synced vault; personal-config transport killed; no workspaces clone; no fork; no machine.json); docs/windows-setup.md added then slimmed; wave-skill local clone deleted (archived tombstone kept); vault NTFS-filename sweep (11 renames, 18 wikilinks updated); 2.1.0 shipped through the cache (restart applies); Windows install in flight.
- 2026-08-14 (later): 2.1.0 — orient self-launches its batches via `cmux workspace create` (ADR 0010: steering answer = sole authorisation, emission = no-cmux fallback); rulings grilled off the SEO orient paste-hand-off challenge; live-proven by firing the SEO p4/p5 batches (workspaces 38/39); wave-repair-autonomy memory generalised. Ship pending: cache dance + restart.
- 2026-08-14: 2.0.3 shipped — review-loop memory (accumulated feedback with anti-regression framing, anti-goalpost judge discipline, step-back round at 2 rejections, ceiling outcomes persisted to the note); grilled 4 design forks via grill-with-docs; all suites green; capture task done.
- 2026-08-13: 2.0.1 (handoff visible, intent-gated) + 2.0.2 (description trims) shipped; skill-listing budget discovered + bumped to 0.02; giflab rollout landed 6/6 through the merged plugin (first orient→engine loop); Ralph-loop audit → review-loop-memory + package-init-blindness tasks filed.
- 2026-08-12 (merge-day follow-up): merge-day parity follow-up — the 4 reported checker errors (plus 10 same-day drift) diagnosed to NotchBar's Codex hook injection + hardlink/mode drift; checker gained the NotchBar app-managed carve-out, add.md fan-out re-linked, PASS restored. Follow-up: [[notchbar-codex-hooks-follow-up]].
- 2026-07-14: Notion retired ecosystem-wide — handoff destination deleted from close, workspaces + Codex adapter swept, migration task + global memory captured, v1.0.1 shipped (found: plugin cache is version-keyed).
- 2026-07-14 (later): installed as thread@thread + references migrated + vault project note; first live close ran from the plugin itself; verification task scheduled for 2026-07-15.
- 2026-07-14: thread created — v1.0.0 built end-to-end from approved plan.
