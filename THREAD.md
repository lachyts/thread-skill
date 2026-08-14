---
slug: thread-skill
created: 2026-07-14
last_touched: 2026-08-14
state: active
scope: Build + maintain the thread:* plugin — continuity verbs + the wave rollout engine (one system, two lanes)
---

# thread-skill — THREAD

## Where we are

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
- ADR 0001: the task is the floor; the thread is the upgrade.
- ADR 0002: `next` is a sibling, not a parent.
- Canonical THREAD-template.md home: `~/.agents/skills/thread/THREAD-template.md`
  (harness-neutral; `check-agent-parity.py` pins it).
- Pickup auto-completes the capture task (decided in design interview).
- Stash surfacing: `/weekly` "Stashed threads" pass (decided in design interview).
- Codex `.agents/skills/{thread,close}` adapters kept as their audit-era
  **native translations** (not thinned to pointers as the plan suggested) —
  undoing deliberate Codex-safety work wasn't worth the dedup; only
  `handoff`'s canonical pointer was repointed at this repo.
- Vault project note `Work/Projects/Side projects/Thread Skill.md` is the
  human-facing surface (goal, terminology, wave-sibling framing); its
  `repos:` frontmatter auto-routes tasks captured from this repo's CWD.
- Build lineage: `docs/build-plan.md` (the approved plan, copied in at close).
- Notion handoff destination deleted from close (2026-07-14), not re-routed:
  Notion is a read-only legacy archive (personal → Obsidian migration
  pending); THREAD.md, git-committed by the close flow, is the cold-pickup
  artifact — a Notion page duplicated that guarantee.

## Open questions / decisions pending

- Nit: with Notion gone, close has exactly 4 proposable destination sections,
  so its ">4 sections" menu-merge prose is unreachable — delete on next touch.

## Known quirks (don't re-derive)

- Colon namespace (`thread:defer`) requires plugin packaging; skill frontmatter
  carries the bare `name:` and Claude Code composes the prefix.
- `disable-model-invocation: true` hides a skill from the model's list but
  keeps the `/slash` form — used by `thread:handoff`.
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
- Skills execute from `~/.claude/plugins/cache/thread/thread/<version>/`, not
  the `marketplaces/thread/` clone — `${CLAUDE_PLUGIN_ROOT}` resolves to the
  cache path. The cache is **version-keyed**: `claude plugin marketplace
  update thread` alone only refreshes the clone and never rebuilds the cache.
  Full update flow: bump the version in BOTH `.claude-plugin/plugin.json` and
  `.claude-plugin/marketplace.json` → push → `claude plugin marketplace update
  thread` → `claude plugin update thread@thread` → restart the session to
  apply (verified 2026-07-14 shipping 1.0.1).

## Resume instructions

1. Read this file, then `CONTEXT.md` and the two ADRs.
2. `skills/_shared/task-writer.md` is the single source for task shape —
   never change task behaviour in a route skill directly.
3. Live testing checklist is in the plan's Verification section (plan file:
   `~/.claude/plans/so-i-want-to-rippling-taco.md`, mirrored in repo history).

## Session log

- 2026-08-14 (latest): 2.0.3 shipped — review-loop memory (accumulated feedback with anti-regression framing, anti-goalpost judge discipline, step-back round at 2 rejections, ceiling outcomes persisted to the note); grilled 4 design forks via grill-with-docs; all suites green; capture task done.
- 2026-08-13: 2.0.1 (handoff visible, intent-gated) + 2.0.2 (description trims) shipped; skill-listing budget discovered + bumped to 0.02; giflab rollout landed 6/6 through the merged plugin (first orient→engine loop); Ralph-loop audit → review-loop-memory + package-init-blindness tasks filed.
- 2026-08-12 (merge-day follow-up): merge-day parity follow-up — the 4 reported checker errors (plus 10 same-day drift) diagnosed to NotchBar's Codex hook injection + hardlink/mode drift; checker gained the NotchBar app-managed carve-out, add.md fan-out re-linked, PASS restored. Follow-up: [[notchbar-codex-hooks-follow-up]].
- 2026-07-14: Notion retired ecosystem-wide — handoff destination deleted from close, workspaces + Codex adapter swept, migration task + global memory captured, v1.0.1 shipped (found: plugin cache is version-keyed).
- 2026-07-14 (later): installed as thread@thread + references migrated + vault project note; first live close ran from the plugin itself; verification task scheduled for 2026-07-15.
- 2026-07-14: thread created — v1.0.0 built end-to-end from approved plan.
