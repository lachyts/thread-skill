# thread plugin — test and release checks, and behaviour evals (a human step). `make test` is the full suite (the self-rollout's completion verifier); `make test-fast` is the fast tier (ADR 0073 d1), and its verifier runs it light, as `THREAD_SKIP_SLOW=1 make test-fast` (CLAUDE.md's Verifier:, ADR 0084 d3).
.PHONY: test test-fast release-check evals

test:
	@bash tests/run.sh

# The fast tier: the always-run checks, then only the test files the diff from THREAD_VERIFY_BASE reaches
# (tests/fast-tier.map), or the full suite when a changed path is not in the map. With THREAD_SKIP_SLOW=1 (the
# self-rollout's verifier and GitHub's PR check) it leaves the Slow tier out unless the diff edits a SLOW suite.
test-fast:
	@bash tests/run.sh --fast

# After `claude plugin update thread@thread`: both manifests agree, and the version-keyed cache the
# engine and hooks run from (${CLAUDE_PLUGIN_ROOT}) holds exactly what this tree ships. A same-version
# content change never refreshes the cache (THREAD.md § Known quirks) — bump, then run this.
# - The version rule lives in the contract test (tests/contracts/manifest.test.mjs, "same version");
#   its own output is printed on failure, so a malformed SKILL.md shows as that, not as a version claim.
# - The stray check exists because the E2E found a full nested plugin copy (.claude/worktrees/enabler/,
#   git-ignored in the tree) in the 2.5.2 and 2.5.3 caches: every cache file must be in `git ls-files`.
# - release-check first refuses while evals/results/ (git-ignored `make evals` output) holds files, with
#   the RC_SKIP exemptions: the `./` directory source copies it into the cache, transcripts and all.
#   It lists top-level entries only (run dirs, or a file directly under evals/results/), never nested
#   files. It runs before the version is read, so its remedy for an already-copied cache names
#   $(CACHE)/<version>/evals/results with the version as a placeholder. Deleting that dir is the fix, not
#   a bump (the old version dir, copy and all, stays on disk); the cache diff covers only skills/ and
#   hooks/, so the stray check then passes at the same version.
# - RC_SKIP holds the exemptions every walk shares (.DS_Store, and anything under __pycache__/), so the
#   three walks cannot disagree on them.
# - The cache diff walks every file on disk under skills/ and hooks/, untracked and git-ignored ones
#   included (the stray check reads `git ls-files`), with `find -L`, which follows a symlinked dir into
#   its files as `diff -r` did. Each entry, by type: a link that resolves to nothing is followed hop by
#   hop (32 or more hops is a loop), else compared by its readlink text, so an identical dangling link
#   passes; any other non-regular entry (fifo, socket, device) is `Not a regular file` and never opened;
#   a regular file the cache lacks is `Only in <dir>: <name>`, one whose cache entry is not a regular
#   file differs without a cmp, and the rest go through `cmp -s`, so cmp only ever reads two regular files.
# - A missing cache sub-dir (`No <dir>`) fails the cache diff, and so does any error a walk prints (a
#   tree sub-dir missing or unreadable, GNU find's loop error): its stderr is captured too.
# - A dir loop fails on BSD and GNU alike. GNU find reports it as an error. BSD find lists the loop dir
#   without entering it and exits 0, so a `-type d` pass takes each dir's physical path and names a dir
#   whose physical path equals one of its logical ancestors' (equal, not merely under: a link to `.`
#   loops onto its parent). That probe runs `CDPATH= cd -P`, as the stray check's cd does, so a CDPATH
#   the caller exports neither prints a line into the probe's output nor sends cd elsewhere (bash's sh
#   fails the cd outright). A link-only loop is the 32-hop case above.
# - Report lines go through printf, never echo: dash's and macOS sh's echo expand backslashes (a `\c` in
#   a name cut the FAIL output short). A name holding a newline is unsupported.
# - The stray check fails when the cache walk errors (an unreadable dir), reads `git ls-files -s -z`, so
#   no name is C-quoted, and checks a cache path under a tracked symlink (a symlinked dir the update
#   copied as a real dir) against the tree's path through that link instead of calling it stray: its own
#   files pass, and an extra file in it is still stray.
# - Cache-only files are reported by the stray check, never the cache diff. Neither check reports a file
#   still in the index but deleted from the working tree.
# - release-check never calls diff, so it never parses diff's human-readable output: GNU diffutils 3.12
#   (ubuntu-latest, 2026-11-08) shell-quotes a path holding a space in its `Only in` lines, which broke
#   the old filter. tests/release-check.test.sh puts a recording `diff` first on PATH to pin this.
# - A file tracked at release time but deleted since (a consumed review doc, say) reads as stray, so run
#   this right after the plugin update, on the released commit.
CONFIG := $(or $(CLAUDE_CONFIG_DIR),$(HOME)/.claude)
CACHE := $(CONFIG)/plugins/cache/thread/thread
RC_SKIP := -name __pycache__ -prune -o -name .DS_Store -o
release-check:
	@f=$$(find evals/results $(RC_SKIP) ! -type d -print 2>/dev/null); \
	[ -z "$$f" ] || { printf '%s\n' "FAIL - evals/results/ holds $$(printf '%s\n' "$$f" | wc -l | tr -d " ") file(s) of make evals output: record anything you need in docs/evals/ (or move evals/results out of the tree), then rm -rf evals/results and re-run this check. It holds:"; \
	  printf '%s\n' "$$f" | sed "s|^evals/results/*||; s|/.*||" | LC_ALL=C sort -u | sed "s|^|  evals/results/|"; \
	  printf '%s\n' "If it was there during the plugin update, the cache copied it too and the stray check will name those files. A same-version update never refreshes the cache, so delete that copy directly: rm -rf \"$(CACHE)/<version>/evals/results\""; exit 1; }; \
	o=$$(node --test --test-name-pattern='same version' tests/contracts/manifest.test.mjs 2>&1) || { printf '%s\n' "FAIL - manifest contract (same version) failed:" "$$o"; exit 1; }; \
	v=$$(node -p 'require("./.claude-plugin/plugin.json").version') || exit 1; \
	c="$(CACHE)/$$v"; \
	[ -d "$$c" ] || { printf '%s\n' "FAIL - no $$c (run the plugin update)"; exit 1; }; \
	d=$$({ for sub in skills hooks; do [ -d "$$c/$$sub" ] || { printf '%s\n' "No $$c/$$sub"; continue; }; \
	  find -L $$sub $(RC_SKIP) -type d -exec sh -c 'for x; do p=$$(CDPATH= cd -P -- "$$x" && pwd -P) && printf "%s\n" "$$x" "$$p"; done' sh {} + | awk 'NR % 2 { l = $$0; next } { ph[l] = $$0; n = split(l, c, "/"); a = c[1]; for (i = 2; i <= n; i++) { if ((a in ph) && ph[a] == $$0) { print "Symlink loop: " l; break } a = a "/" c[i] } }'; \
	  find -L $$sub $(RC_SKIP) ! -type d -print | LC_ALL=C sort | while IFS= read -r f; do \
	    if [ -L "$$f" ] && [ ! -e "$$f" ]; then \
	      t=$$f; n=0; while [ -L "$$t" ] && [ $$n -lt 32 ]; do r=$$(readlink "$$t"); if [ "$${r#/}" = "$$r" ]; then t=$${t%/*}/$$r; else t=$$r; fi; n=$$((n + 1)); done; \
	      if [ $$n -ge 32 ]; then printf 'Symlink loop: %s\n' "$$f"; \
	      elif [ -L "$$c/$$f" ]; then [ "$$(readlink "$$c/$$f")" = "$$(readlink "$$f")" ] || printf 'Files %s and %s differ\n' "$$c/$$f" "$$f"; \
	      elif [ -e "$$c/$$f" ]; then printf 'Files %s and %s differ\n' "$$c/$$f" "$$f"; \
	      else printf 'Only in %s: %s\n' "$${f%/*}" "$${f##*/}"; fi; \
	    elif [ ! -f "$$f" ]; then printf 'Not a regular file: %s\n' "$$f"; \
	    elif [ ! -e "$$c/$$f" ] && [ ! -L "$$c/$$f" ]; then printf 'Only in %s: %s\n' "$${f%/*}" "$${f##*/}"; \
	    elif [ ! -f "$$c/$$f" ] || ! cmp -s "$$c/$$f" "$$f"; then printf 'Files %s and %s differ\n' "$$c/$$f" "$$f"; fi; \
	  done; done; } 2>&1); \
	[ -z "$$d" ] || { printf '%s\n' "FAIL - cache $$v differs from the tree:" "$$d"; exit 1; }; \
	cf=$$(CDPATH= cd "$$c" && find . $(RC_SKIP) ! -type d -print) || { printf '%s\n' "FAIL - cannot walk the cache $$c: the stray check needs every dir in it readable"; exit 1; }; \
	s=$$({ git ls-files -s -z | tr '\0' '\n'; printf '%s\n' "$$cf"; } | awk '!/^\.\//{ n = substr($$0, index($$0, "\t") + 1); t[n] = 1; if ($$1 == "120000") k[n] = 1; next } { p = substr($$0, 3); if (p in t) next; m = split(p, c, "/"); a = c[1]; for (i = 2; i <= m; i++) { if (a in k) { print "L" p; next } a = a "/" c[i] } print "S" p }' | \
	  while IFS= read -r x; do p=$${x#?}; if [ "$${x#L}" = "$$x" ] || { [ ! -e "$$p" ] && [ ! -L "$$p" ]; }; then printf '%s\n' "$$p"; fi; done | LC_ALL=C sort); \
	[ -z "$$s" ] || { printf '%s\n' "FAIL - cache $$v holds files this tree does not track:" "$$s"; exit 1; }; \
	printf '%s\n' "release-check: $$v — manifests agree, cache $$c matches skills/ and hooks/ and holds nothing untracked"

# Behaviour evals: `claude plugin eval .` scores the evals/ suite. Every run makes real model calls on
# Lachy's account, is nondeterministic and spawns nested claude sessions, so it is a human step, never
# part of `make test` or `make test-fast` (the self-rollout's verifiers) or of a bare `make` (this
# target stays last, and test is the default goal). tests/contracts/evals-structure.test.mjs checks the
# suite's shape there for free.
# - The recipe line has three parts. The CLI keeps a repeated option's last value, so the order is the
#   design:
#   1. Defaults, first, so EVAL_ARGS may override them: --runs 1, --max-cost-usd 30, --threshold 0.
#      30 is a ceiling, never a target: the first full Opus run cost about $0.29 a case at --runs 1
#      (docs/evals/2026-10-16-release-4-0.md); scale by cases × runs when raising it.
#      --threshold 0 keeps a sub-1.0 case from failing the run.
#   2. $(EVAL_ARGS), empty by default: e.g. `make evals EVAL_ARGS="--case status-*"`, or
#      `EVAL_ARGS="--runs 3 --max-cost-usd 90"` to raise the defaults.
#   3. Locks, last, so a repeated --ablation, --model or --judge-model in EVAL_ARGS loses to them. A
#      different option given on the command line on purpose (say --publish-report) is the operator's
#      own act; the contract keeps every forbidden flag out of the EVAL_ARGS default:
#      - --ablation none: a no-plugin arm can never fire a thread skill, so its delta means nothing here
#        and it would double the cost. Every Skill grader sets `arm: both`.
#      - --model opus --judge-model opus: every case and every LLM grader on Opus (the operator's Opus
#        lock). `claude plugin eval` judges with Haiku by default. Three lifecycle cases missed under
#        Haiku and passed with Opus model and judge in the 3.1.0 record
#        (docs/evals/2026-10-15-release-3-1.md), but that run changed both together, so the misses are
#        not explained.
#      - --no-publish: the HTML report stays local.
#      - --keep-temp: every run keeps its sandbox, so a record can read each run's trace: the case
#        model's resolved id and the loaded plugins (its init event), and the run's turns, which explain
#        a miss. The results hold each judge grader's vote tally (a grader passes a run when at least 2
#        of its 3 votes are PASS) but no rationale and no judge model id, so no trace confirms the judge's
#        model. A boolean has no off switch, so it sits with the locks.
#        docs/evals/2026-10-28-handoff-ends-with-next.md passed it through this recipe on Claude Code
#        2.1.311 and read sixteen kept sandboxes, each loading thread 5.0.0.
#   tests/contracts/evals-structure.test.mjs holds the evals recipe to exactly this one line.
# - Record a scored baseline in docs/evals/ before changing any skill description.
# - Results land in the git-ignored evals/results/<timestamp>/. Record what you need in docs/evals/, then
#   clear it before `claude plugin update`: the `./` directory source copies ignored files into the
#   version cache. `make release-check` refuses while it holds output, and its stray check fails on any
#   copy that reached the cache. The kept sandboxes land outside the tree (/private/tmp/e-<id> in the
#   records so far, each result's `tracePath`), so neither release-check nor the plugin cache sees them:
#   remove them by their literal paths once the record has read them.
EVAL_ARGS ?=
evals:
	claude plugin eval . --runs 1 --max-cost-usd 30 --threshold 0 $(EVAL_ARGS) --ablation none --model opus --judge-model opus --no-publish --keep-temp
