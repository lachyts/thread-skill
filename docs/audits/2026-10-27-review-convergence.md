# Audit — why the clean-room review loop doesn't converge (2026-10-27)

Subject: narcissus-avp PR #65 (`fix/exclusive-spikes-and-glossary`), landed through `/thread:close`'s
own-branch loop (close § Land the own branch, ADR 0028). Merged 2026-10-27 09:45 AEDT (`f783392`) after
Lachy's round-10 call. Rebuilt from git history (every review doc and its Disposition, blame on every
cited line) and the session transcript (16 review dispatches, one per doc, none missing).

## The rounds

P = the earlier probe-branch rounds (same branch; PR #65's first commit is `a9a76ba`), L = landing
loop. Diff and fix sizes exclude `docs/reviews/`; fix code excludes `*.md`. Severity is estimated
(H = crash, data loss or wrong result in normal use; M = wrong behaviour on an edge or debug path;
L = docs, comments, naming, style, perf nit): the `xhigh` cell emits none.

| Rd | Mode | Head | Branch diff | n | H/M/L | Fixed / deferred | Fix code after | Regr (prev round / any review fix) |
|---|---|---|---|---|---|---|---|---|
| P1 | code | a9a76ba | 6f +62/−22 | 14 | 1/5/8 | 11 / 3 | +46/−22 | – |
| P2 | code | 8732e2a | 15f +627/−44 | 15 | 3/10/2 | 13 / 2 | +307/−142 | 3 / 3 |
| P3 | code | 55fda0f | 15f +804/−56 | 15 | 2/9/4 | 8 / 6 (+1 reverted) | +71/−17 | 13 / 13 (ledger STOP) |
| L1 | code | f52fe66 | 17f +928/−60 | 15 | 3/6/6 | 12 / 3 | +126/−54 | 3 / 9 |
| L2 | code | d379ded | 19f +1008/−66 | 14 | 0/7/7 | 9 / 4 | +79/−40 | 3 / 9 |
| L3s | simplify | 394dc11 | 20f +1049/−68 | 21 | 0/1/20 | 12 / 9 | +48/−63 | 2 / 15 |
| L4 | code | f4d5a9a | 21f +1041/−75 | 15 | 0/8/7 | 10 / 5 | +73/−77 | 1 / 10 |
| L5 | code | 9d68640 | 21f +1065/−103 | 11 | 0/6/5 | 8 / 3 | +24/−8 | 1 / 10 |
| L6s | simplify | e84dce8 | 22f +1082/−104 | 20 | 0/0/20 | 7 / 13 | +23/−25 | 1 / 11 |
| L7 | code | 5a355fc | 22f +1086/−110 | 11 | 1/3/7 | 5 / 6 | +22/−12 | 0 / 7 |
| L8 | code | 5529f81 | 22f +1097/−110 | 10 | 0/5/5 | 7 / 3 | +34/−10 | 2 / 9 |
| L9s | simplify | f238d04 | 22f +1123/−112 | 22 | 0/0/22 | 2 / 20 | +5/−3 | 2 / 16 |
| L10 | code | d4984b8 | 22f +1127/−114 | 15 | 1/7/7 | held → 6 / 9 | +22/−5 | 0 / 12 |
| L11 | code | 33bc7b1 | 22f +1149/−119 | 13 | 0/5/8 | 5 / 8 | +29/−15 | 3 / 11 |
| L12 | code | 8b61527 | 22f +1163/−119 | 8 | 0/6/2 | 5 / 3 | +16/−7 | 1 / 3 |
| L13 | code | c90568d | 22f +1174/−121 | 10 | 0/3/7 | 0 / 9 | merged | 2 / 7 |

New scope landed only twice: the mesh probe (`8732e2a`, +524, between P1 and P2) and Lachy's pbxproj
migration (`f52fe66`, +59, just before L1). Every other commit was a fix (one, `28fe70b`, a
finding-driven refactor).

## The diagnosis, tested

1. **The clean bar is unreachable at `xhigh` on this diff: confirmed.** Code rounds returned 15, 14,
   15, 11, 11, 10, 15, 13, 8, 10 and never 0; 8 of 13 code rounds hit the cell's cap of 15 exactly.
   Fix spans shrank from +126 to +5…+29 lines while findings held near 12, so the count measures the
   reviewer's appetite over a 1,000-line diff, not what is left to fix. Outside calibration agrees:
   Anthropic reports 7.5 findings on average for PRs over 1,000 lines, and Google's median change is
   24 lines. Only about **5 of the 185 landing findings were high** (3 in L1, then L7#1 and L10#1); 66%
   were low; L11–L13 had none. Two standing rules push the loop on: "a round returning exactly its cap
   is truncated, run one more", and "buy coverage with more rounds", so a large diff at `xhigh` is told
   to keep going every time it hits 15.
2. **The stop rule only catches a loop reviewing its own fixes: confirmed, with a twist.** 70% of
   landing findings (129/185) cite lines last written by *some* earlier review-fix commit, but only
   0–3 per round cite the *previous* round's fixes, and the chain was re-based at L5 after a 3-hour
   gap, so the ledger's ratio sat at 13–24% and said CONTINUE every time. Three things it cannot
   see: **recurrence** (the probe/plane-fallback item came back in 10 of 13 landing rounds; the
   duplicated `GeometrySource` decode 9 times; `launchArgsApplied` 9 times, all marked Deliberate each
   time), **reversals** (six pairs: dropped faces block `located` at L12 → too strict at L13; the ε
   consumer gate added at L8 → "delete it" at L9s; dial resets added at L2 → removed at L7; the
   billboard toggle fixed, reverted and re-fixed across P2/P3/L1/L6s/L10), and **plateau** (counts flat
   for ten rounds).
3. **No size gate, no scope freeze: half confirmed.** The branch reached 928 lines across 17 files
   *before* the landing loop began (the probe feature was added between probe rounds 1 and 2); during
   the loop it grew only by its own fixes (928 → 1,174). So scope creep inside the landing loop was
   small. The size at entry was the problem: Google calls 1,000 lines "usually too large", and
   SmartBear's defect-detection data falls off past 400.
4. **No severity floor for triage: confirmed.** 95 of 185 landing findings were deferred or marked
   Deliberate, so the agent did defer, but nothing told it which findings had to block. It still fixed
   the rest, adding +5…+126 lines a round, and those lines were the next round's material (the chains
   L10#7 → L11#1 → L12#1/#6 and L7#1 → L8 → L9s → L10#15 → L11#8/#9).
5. **Round recording isn't enforced, and the Reflection couldn't see it anyway: confirmed, and worse
   than stated.** `reviews.jsonl` (`~/repos/workspaces/_shared/state/thread-events/`) holds P1–P3 and
   none of the 13 landing rounds: `review-round.py` is a prose step, so it was skipped. And even if it
   had run, the weekly reading's `freshReview` (`skills/reflect/scripts/reflect.py`) reports only
   rounds with `regression > 0`, there is no per-landing grouping, no branch field, no disposition
   counts. A loop of honest originals is invisible by construction.

## Causes the diagnosis missed

6. **Deliberate items are re-raised because the reviewer is forbidden from seeing them.**
   `reviewer-prompt.md`: "Do not read anything under `docs/reviews/`". Every landing round reviewed
   the whole `origin/main...HEAD` branch, clean-room, so last round's dispositions were invisible and
   came straight back. The probe rounds 2–3 used incremental ranges instead. Every tool surveyed
   (Anthropic Code Review, Cursor Bugbot, PR-Agent, CodeRabbit, Greptile) de-duplicates against earlier
   runs and re-reviews only what changed.
7. **Two engines, two stop rules.** The rollout engine caps master review at `max_review_rounds`
   (built-in 4) and sets a task aside; close's own-branch loop has no cap (ADR 0028 d3) and never adopted
   fresh-review's "the named test is the gate".
8. **The ledger goes blind once a branch merges.** It walks `git log -- docs/reviews/` without
   `--full-history`; on a merged branch whose docs were added and deleted, history simplification
   drops them. On narcissus-avp today it sees 5 doc commits of 39.

## Other repos

Every repo with Claude review loops shows it; PR #65 is the long tail, not an outlier. Since
2026-09-15, outside PR #65: 114 multi-round loops (plus 33 single rounds) across chorus, thread-skill,
workspaces, murmur, obsidian, audio-intake, narcissus-echo, event-scanner, video-watchlist and others.

- **No Claude round has ever come back empty.** 0 of 452 Claude rounds returned zero findings; the
  lowest was 2. All 5 loops that reached a zero round ran on Codex (27 of its 30 rounds were zero). So
  close's clean bar, "no accepted finding", has only ever been met by marking findings deliberate.
- **Loops end on the ledger, not on clean.** 89 of 114 (78%) ended on a ledger STOP, 68 of them at
  round 2; 7 (6%) ended clean; 12 merged their last round's fixes unreviewed; 40 kept reviewing after
  the STOP fired.
- **The counts are pinned at the cap.** Of 282 Claude `xhigh` code rounds, 120 returned exactly 15 and
  171 returned 14 or more (median 14). A 77-line diff (thread-skill PR #168) went 15, 15, 15. Counts
  fell across a loop in 27% of loops, plateaued in 36%, rose in 23%. Even at `high`, before 2026-09-20,
  only 5 of 27 loops fell.
- **Size barely predicts it** (Spearman 0.25 for start size against rounds or total findings, an
  estimate): at `xhigh` the reviewer fills its cap on small diffs too, so size is not the main lever
  here, though it is in the human literature.
- **Recording.** One `reviews.jsonl` exists, 94 rows from 2026-10-16: about 18% of ~482 rounds, 93% of
  rounds since 10-17, but not PR #65's 13. Every row has `rollout: null`.
- **Parser gaps.** The ledger counts simplify tables numbered A1/S1/E1 as zero findings (four docs, 74
  findings undercounted), and its chain split cut PR #65's loop into five chains.

## Proposals, ranked by impact

1. **A clean round means no open blocking finding** *(ADR: amends ADR 0028 d2 and d3)*. The lead
   classifies each finding against a written test. Blocking: a crash, data loss, a wrong result or
   a security hole on a path the branch ships in normal use, or the named test failing. Everything
   else is non-blocking. Each blocking row cites its clause; non-blocking rows are filed, not fixed
   on the branch. The lead does the grading because a reviewer's self-rated severity is "nearly
   random" (Greptile). On PR #65 this ends the loop after L1's three highs are fixed and their
   re-review comes back without one (about L2), instead of L13. Across the estate it makes landing
   reachable at all.
2. **Later rounds review the fixes, and repeats don't count** *(skill rule)*. Round 1 reviews the whole
   branch. Every later round targets `<last reviewed head>..HEAD` (the fix range) with the branch as
   context, which is where regressions live. The lead marks a finding that restates an earlier
   round's deliberate or filed one as RECURRING (same file, same concern), and it never blocks
   without new evidence. The reviewer still never reads `docs/reviews/`, so the clean room holds.
3. **A non-convergence stop that lands rather than loops** *(ADR: amends ADR 0028 d3)*. Three triggers:
   (a) a budget of 3 code rounds after round 1; (b) a plateau, meaning blocking findings not falling
   over two rounds; (c) a reversal, meaning a finding that asks to undo an earlier round's fix, which
   is never fixed without outside evidence (a test, the spec, a rig run). At any stop, no open
   blocking finding queues the merge with the filed follow-ups. Open blocking findings hold the PR
   with a `Needs your call:`. The landing loop drops "a full-cap round means one more round". The
   rollout engine already caps at 4.
4. **Record every round mechanically, and read it weekly** *(skill + script)*. `review-ledger.py`, already
   a mandatory step each round, writes the `review-round` line itself. That line gains branch, blocking,
   filed, fixed, recurring, reversal, and diff lines and files. The weekly Reflection reports each
   landing: rounds, findings per round, blocking found, accept rate, and how it ended. Today it reports
   only rounds with regressions. Ledger bugs fixed along the way: `--full-history` for merged
   branches, and the A1/S1/E1 simplify tables.
5. **Size at entry** *(skill rule, no hard gate)*. The landing row records the branch's size. Over 400
   changed lines, close says so. The cross-repo data says size is not what keeps `xhigh` at its cap,
   so splitting a branch is not forced; proposal 1 is what makes a large branch land.

## Best practice (sourced)

- **Approve on "better", block only the top tier.** Google: approve once a change "definitely improves
  the overall code health"; label minor points `Nit:`, which never block; "LGTM with comments" is
  normal ([standard](https://google.github.io/eng-practices/review/reviewer/standard.html),
  [comments](https://google.github.io/eng-practices/review/reviewer/comments.html)). Conventional
  Comments' `(blocking)`/`(non-blocking)` and Gerrit's −2 vs −1 say the same
  ([conventionalcomments.org](https://conventionalcomments.org/),
  [Gerrit labels](https://gerrit-review.googlesource.com/Documentation/config-labels.html)).
- **The stop state is "no open blocking finding".** Anthropic Code Review classes findings Important /
  Nit / Pre-existing, never blocks on Nits, and skips re-review when no Important finding is open
  ([docs](https://code.claude.com/docs/en/code-review)).
- **Re-review only what changed, and de-duplicate.** Anthropic's later reviews focus on changes since
  the last review and read replies to earlier findings; CodeRabbit's re-review is incremental; Bugbot
  drops bugs posted in earlier runs; PR-Agent feeds prior findings back so they aren't re-raised
  reworded ([CodeRabbit](https://docs.coderabbit.ai/guides/commands),
  [Bugbot](https://cursor.com/blog/building-bugbot),
  [PR-Agent config](https://github.com/qodo-ai/pr-agent/blob/main/pr_agent/settings/configuration.toml)).
- **Self-rated severity is unreliable; filters need evidence or consensus.** Greptile found an LLM's
  own 1–10 severity "nearly random" ([blog](https://greptile.com/blog/make-llms-shut-up)); Bugbot keeps
  only bugs several shuffled passes agree on; the Claude Code code-review plugin drops findings scored
  under 80 ([README](https://github.com/anthropics/claude-code/blob/main/plugins/code-review/README.md)).
  Identical LLM review runs disagree: about half of Snyk's LLM findings appeared in 1 of 5 identical
  scans ([Snyk](https://snyk.io/blog/snyk-vulnbench-js-1-0-llm-security-review-repeatability/)).
- **LLM precision is low and loops without outside signal don't settle.** SWR-Bench's best setting:
  16.65% precision ([arXiv 2509.01494](https://arxiv.org/html/2509.01494v2)). Self-correction without
  external feedback stalls or degrades (Huang et al., [arXiv 2310.01798](https://arxiv.org/html/2310.01798);
  Kamoi et al., [TACL 2024](https://aclanthology.org/2024.tacl-1.78)); Self-Refine caps at 4 rounds with
  non-monotonic gains ([arXiv 2303.17651](https://arxiv.org/html/2303.17651)); models flip answers 46%
  of the time when challenged ([arXiv 2311.08596](https://arxiv.org/abs/2311.08596)), which is what a
  reversal across rounds looks like.
- **Size is the strongest lever.** Google: ~100 lines reasonable, 1,000 usually too large, one thing per
  change ([small CLs](https://google.github.io/eng-practices/review/developer/small-cls.html)); at Google
  comments per change peak at ~12.5 for ~1,250-line changes, for the whole review
  ([Sadowski et al. 2018](https://storage.googleapis.com/gweb-research2023-media/pubtools/4476.pdf));
  Microsoft: more files, lower share of useful comments
  ([Bosu et al. 2015](https://www.microsoft.com/en-us/research/?p=168510)).
- **Deferred work is filed, not lost.** Google's pushback guidance: cleanup that can't be done now
  becomes a bug the author files
  ([pushback](https://google.github.io/eng-practices/review/reviewer/pushback.html)). A gate whose alarms
  are mostly noise gets ignored; quarantine it like a flaky test
  ([Google testing blog](https://testing.googleblog.com/2016/05/flaky-tests-at-google-and-how-we.html)).

Not verified at source: Graphite Diamond's figures, Bugbot's 80%, Anthropic's "<1% incorrect" (self-
reported), Cisco study details beyond SmartBear's page.

## Ruling and what was built (2026-10-27)

Lachy ruled on proposal 1: **serious only**. "Land when no serious finding is open, and wait for my
call only when one is." The rest were technical calls, built as ADR 0058. Three of them differ
from the proposals above, and each is listed here so it can be overturned:

- **Every round still reviews the whole branch** (proposal 2 said fix range only). With only
  serious findings blocking, a second full look is a second independent sample for serious bugs,
  and the noise it re-raises cannot hold the merge. A fix-range review would also make the
  ledger's ratio meaningless and break the clean round's digest check. The "repeats don't count"
  half of proposal 2 is built.
- **No plateau stop** (proposal 3b). The budget of four code rounds bounds the same loop with
  less mechanism. Reversals are built as proposed (3c): the earlier fix stands.
- **The ledger's regression stop no longer ends a landing**, nor any chain. It is the agent's to
  resolve: revert to the root, never a third patch. This absorbs the stop-rule part of vault task
  p30-2 ("a review STOP is the agent's to resolve"), with one change made by Lachy's ruling: a
  serious finding still open at the budget does go to him.

Proposal 4 is built as proposed, except that the recording hook is land.sh (`--queue`/`--hold`
run `review-round.py --branch-docs`), not the ledger: the ledger stays read-only. Proposal 5
is built as the size on the landing row and in the Run record, with no warning.

Two refinements came from the build's own review rounds (agents-config 228d39b/1cacbe #5 and #9).
Data loss and security holes now block on any path the change ships, not only normal-use paths;
Lachy's option named them without that qualifier. A full-cap round with no blocking finding now
earns one more code round, once, because its cut tail may hold a blocking finding.
