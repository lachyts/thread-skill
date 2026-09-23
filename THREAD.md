---
slug: thread-skill
created: 2026-07-14
last_touched: 2026-09-23
state: active
scope: Build + maintain the thread:* plugin — continuity verbs + the wave rollout engine (one system, two lanes)
---

# thread-skill — THREAD

## Where we are

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

- **The stale `thread@thread` 2.3.4 project-scope record at `~`** is still installed. Uninstalling it is
  unsafe as written: all three profiles' `settings.json` are symlinks to `~/.claude/settings.json`, which
  is also the project settings file for `~`. Vault task `thread-skill-stale-project-scope-install`.
- **Protocol 4 intake** from the 2026-09-23 audit:
  - port `defaultBranch` to the redesign's protocol 3 path
  - gate the release on the zero-rounds fail-open bug
  - the pilot requirement notes never close
  - read-only agents read a mutable checkout

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

- `close` § The handoff owns the continuation deletes a *consumed* doc "whoever
  marked it". When the consumer is a live peer session in the **same checkout**
  (observed 2026-09-21: the consumer had marked the doc consumed while still
  running), the originating session's close would pull the file out from under
  it. Guard on `ListAgents` peers sharing the cwd, or accept (history keeps it,
  the consumer already read it)? Proposed as a vault task at close.
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

- **A `cd` in a Bash call moves the session's primary working directory.** Background clean-room
  reviewers resolve `git diff` against that directory. So while a review runs, the lead uses `git -C`
  and absolute paths only. (2026-09-23: one `cd` into the root checkout mid-review would have pointed a
  worktree review at a clean tree. Caught and reverted before the fork started.)
- **`plugin update` at one version is not enough.** The cache follows the version number. A content
  change needs both manifests bumped, then `claude plugin update thread@thread`, then `make
  release-check`. The check compares the cache's `skills/` and `hooks/` with the tree, and it
  resolves the cache via `CLAUDE_CONFIG_DIR`.
- **Two sessions can share one checkout** (a handoff consumer opened in the
  same directory). Every delete-at-close lifecycle here — handoff docs, review
  docs — assumes one writer; a `git rm -f` or a restore in one session lands in
  the other's working tree (the 2026-09-17 review "working-tree incident" is the
  precedent). Check `ListAgents` for a peer in this cwd before deleting or
  restoring anything another session may hold.
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

## Resume instructions

**Read `/Users/lachlants/repos/tools/thread-skill/docs/handoffs/2026-09-23-thread-e2e-baseline.md` first**
(pending): live E2E baseline S1. The shared brief `docs/audits/2026-09-23-rollout-brief.md` carries S2
and the gather draft.

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
