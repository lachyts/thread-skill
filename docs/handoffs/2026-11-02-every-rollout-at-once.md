---
thread: every-rollout-at-once
written: 2026-11-02
status: pending
---

**Run from:** `/Users/lachlants/repos/tools/thread-skill`

# Spike: every project's rollout runs at once

## 1. Done and verified

The 2026-11-02 `/thread:orient-all` pass (ops-workspace session) is the evidence:

- 28 serial batches were planned. After the contacts-admin chain was repaired, 5 chains were written: `seo-rollout-2026-11-02`, `giflab-rollout-2026-11-02-2`, `mac-data-mcp-rollout-2026-11-02`, `narcissus-rollout-2026-11-02` and `audio-intake-rollout-2026-11-02`. The other 23 were refused or never tried.
- **SEO's claim on `repo:/Users/lachlants/repos/workspaces` blocked 17 projects.** That repo is a monorepo of shared scripts, knowledge and launchers: Chorus, Smart Slider, agent-stable, event-scanner, Obsidian Vault, quote-videos, method, next-action, reference-loop, taste, apartment, AVP show, health-check, website, bake-off, morning commands and shared-skills. Most of them touch one or two unrelated files there.
- **Narcissus's default `vault` claim blocked 7 vault-only chains.** Its tasks declare no `surfaces:`, so the claim defaults to the whole vault. The blocked chains were Ikeda, personal admin, fresh-review, news scan, culture queue, health admin and house-dance. Ikeda's real claim was a single note.
- **The fork reports show why claims widen.** Each fork added body-named paths at S2, and `serial-chains.py` widens every path inside a git checkout to the checkout's toplevel. The reason is in CONTEXT.md **Surface**: "since its index and HEAD are what Legs share".
- Pre-check script used: `serial-chains.py plan` + `unfinished-rollout.py check --shape serial`. Its output was saved at `/var/folders/6n/k70dh8f52jj583xk107m50jh0000gn/T/orient-all.meCYo7Q3md/serial-precheck.txt`, which is OS temp and may be gone. The pre-check undercounts, because forks add the paths a task's body names.

## 2. What remains

1. **Research spike, read-only on the running rollouts.** Work out how every project's rollout can run at the same time, with a clash only when two runs edit the same file or note. Cover:
   - **Serial chains:** give each chain its own working copy (a worktree or clone per chain, as parallel rollouts' clones do, ADR 0042), so file-level claims are safe. Work out how a Leg lands its commits from that copy: today it is commit-only in the cwd checkout, with land.sh and the land-chain follow-on.
   - **Claim granularity:** file- or note-level tokens in place of the checkout toplevel and the whole-vault default. Work out how a task that names no paths gets its claim: an agent reading the task at schedule, or a narrow default that is checked at claim time.
   - **Parallel rollouts:** the "at most one unfinished parallel rollout per repo" rule (ADR 0027, 0030, 0042). Two projects' parallel rollouts on one monorepo, such as workspaces, need separate clones or a shared Integration lane. Work out what serialises merges per repo and whether that can stay while the runs themselves go side by side.
   - **The vault:** two chains writing different notes at once; Obsidian Sync and the vault's git commits by pathspec.
   - **Capacity:** an automatic governor (RAM, CPU, Claude quota / Login), in place of surface refusals, as the real limit. Look at what Chorus already measures.
   - **Same-file waits:** when two runs want the same file, the one orient-all ranks higher goes first.
2. **Write the ADR**, superseding ADR 0040's ruling "a chain that writes a repo checkout owns that checkout", and amending the one-parallel-rollout-per-repo rule as far as the spike supports. Update CONTEXT.md **Surface**, **Rollout** and **Serial rollout**. Do this on a checkout current with origin: the local checkout was ahead 1 and behind 93 on 2026-11-02.
3. **Plan the build** as Thread Skill's next phase: `/thread:orient Thread Skill`, or write phased task notes directly per that skill.

## 3. Decisions settled

Grilled with Lachy on 2026-11-02 (`/grill-with-docs`):

- **A clash is only two runs editing the same file or note.** Sharing a repo, a monorepo or the vault never blocks. This covers both shapes (serial chains and parallel rollouts). Goal, in his words: "We should be able to run a rollout for each project at exactly the same time, assuming we have resources and RAM ready to go, but the workspace shouldn't block that."
- **Spike first, then build.** It is Thread Skill's next phase, and quality wins over speed.

Decided for him (technical; list these back to him so he can overturn them):

- Each chain gets its own working copy, so the claim can narrow to files.
- Capacity is an automatic governor, not a question for Lachy.
- Same-file contention is ordered by orient-all's rank.

## 4. Gotchas found the hard way

- `unfinished-rollout.py` does not count a rollout whose tasks are all merged but whose ceremony never ran (`WARN: … not counted as unfinished`). contacts-admin and mac-data-mcp 2026-10-29 are both in that state.
- A task that declares no `surfaces:` silently claims the whole vault. A pre-check from `serial-chains.py plan` alone misses the body-named paths a schedule fork adds at S2.
- A serial row launched from the vault cannot finish a code task: `leg.py done` refuses code commits outside the Leg's cwd checkout. That is why contacts-admin's performer-alias task was deferred, and it is filed as `contacts-admin-followup-thread-schedule-serial-row-gives-a`. Per-chain copies should design for it.
- Live rollouts are running today: the chorus, event-scanner and giflab parallel rollouts, the serial Legs above, and `thread-skill-rollout-2026-10-31`, whose lead holds this plugin's primary checkout (ADR 0031). The spike must not change any live rollout note or the plugin's installed behaviour mid-run.

## 5. Suggested skills

`superpowers:brainstorming` or `grill-with-docs` (only if a new fork reaches Lachy), `anthropic-skills:deep-research` for prior art (multi-agent repo isolation, git worktrees at scale, file-lock schedulers), then `/thread:orient Thread Skill` for the build plan.

## 6. Paste-ready prompt

```
You're continuing "Spike: every project's rollout runs at once" mid-stream — a live handoff, not a cold pickup.
Run from: /Users/lachlants/repos/tools/thread-skill — launch the session there; a cd from another launch directory is reset.
Read first: /Users/lachlants/repos/tools/thread-skill/docs/handoffs/2026-11-02-every-rollout-at-once.md (absolute path) — then mark it consumed: set `status: consumed` in its front matter (no commit; your thread:close deletes it).
Context: Today's orient-all pass refused 23 of 28 serial chains. Claims widen to a whole checkout (the workspaces monorepo) or to the whole vault, so one chain blocks every other project. Lachy ruled that a clash is only two runs editing the same file or note, for both shapes, and wants a spike first, then the build as Thread Skill's next phase. Decided for him: per-chain working copies, an automatic capacity governor, and orient-all's rank to order same-file waits.
Also read: docs/adr/0040-a-rollout-is-parallel-or-serial.md (Build-grill rulings), docs/adr/0042-a-parallel-rollout-always-runs-from-its-clone.md, CONTEXT.md **Surface**, skills/_shared/scripts/serial-chains.py and unfinished-rollout.py headers.
Suggested skills: anthropic-skills:deep-research, grill-with-docs (only for a new fork), /thread:orient Thread Skill.
Gates: if the spike finds that "same files only" cannot be made safe for some surface (the vault under Obsidian Sync, a shared Integration lane), report it with evidence to Lachy via grill-me rather than widening the claim yourself.
Next move: bring a checkout current with origin (local was ahead 1, behind 93; a rollout lead holds the primary checkout, so use a worktree), then run the spike's research across the six items in the doc's § 2.1.
```
