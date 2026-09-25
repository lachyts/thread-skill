# thread plugin — test and release checks, and behaviour evals (a human step). `make test` is also the self-rollout verifier.
.PHONY: test release-check evals

test:
	@bash tests/run.sh

# After `claude plugin update thread@thread`: both manifests agree, and the version-keyed cache the
# engine and hooks run from (${CLAUDE_PLUGIN_ROOT}) holds exactly what this tree ships. A same-version
# content change never refreshes the cache (THREAD.md § Known quirks) — bump, then run this.
# - The version rule lives in the contract test (tests/contracts/manifest.test.mjs, "same version");
#   its own output is printed on failure, so a malformed SKILL.md shows as that, not as a version claim.
# - The stray check exists because the E2E found a full nested plugin copy (.claude/worktrees/enabler/,
#   git-ignored in the tree) in the 2.5.2 and 2.5.3 caches: every cache file must be in `git ls-files`.
# - It first refuses while evals/results/ (git-ignored `make evals` output) holds files, with the stray
#   check's exemptions: the `./` directory source copies it into the cache, transcripts and all. The
#   message is path-free because it runs before the version is read.
# - .DS_Store and anything under __pycache__/ are exempt everywhere.
# - Cache-only files are reported once, by the stray check (the diff's cache-side `Only in` lines are
#   dropped); tree-side `Only in`, differing files and a missing cache sub-dir still fail the diff.
# - A file tracked at release time but deleted since (a consumed review doc, say) reads as stray, so run
#   this right after the plugin update, on the released commit.
CONFIG := $(or $(CLAUDE_CONFIG_DIR),$(HOME)/.claude)
CACHE := $(CONFIG)/plugins/cache/thread/thread
release-check:
	@f=$$(find evals/results -name __pycache__ -prune -o ! -type d ! -name .DS_Store -print 2>/dev/null); \
	[ -z "$$f" ] || { echo "FAIL - evals/results/ holds $$(printf "%s\n" "$$f" | wc -l | tr -d " ") file(s) of make evals output: clear it first (rm -rf evals/results) and re-run this check. It holds:"; printf "%s\n" "$$f" | sed "s|^evals/results/*||; s|/.*||" | LC_ALL=C sort -u | sed "s|^|  evals/results/|"; echo "If it was there during the plugin update, the cache copied it too: the stray check will then name those files, and a same-version update never refreshes the cache (bump both manifests, then update)."; exit 1; }; \
	o=$$(node --test --test-name-pattern='same version' tests/contracts/manifest.test.mjs 2>&1) || { echo "FAIL - manifest contract (same version) failed:"; echo "$$o"; exit 1; }; \
	v=$$(node -p 'require("./.claude-plugin/plugin.json").version') || exit 1; \
	c="$(CACHE)/$$v"; \
	[ -d "$$c" ] || { echo "FAIL - no $$c (run the plugin update)"; exit 1; }; \
	d=$$(for sub in skills hooks; do diff -rq -x .DS_Store -x __pycache__ "$$c/$$sub" $$sub 2>&1; done | P="Only in $$c/" awk 'index($$0, ENVIRON["P"]) != 1'); \
	[ -z "$$d" ] || { echo "FAIL - cache $$v differs from the tree:"; echo "$$d"; exit 1; }; \
	s=$$({ git -c core.quotePath=false ls-files; cd "$$c" && find . -name __pycache__ -prune -o ! -type d ! -name .DS_Store -print; } | awk '!/^\.\//{t[$$0]=1; next} !(substr($$0,3) in t){print substr($$0,3)}' | LC_ALL=C sort); \
	[ -z "$$s" ] || { echo "FAIL - cache $$v holds files this tree does not track:"; echo "$$s"; exit 1; }; \
	echo "release-check: $$v — manifests agree, cache $$c matches skills/ and hooks/ and holds nothing untracked"

# Behaviour evals: `claude plugin eval .` scores the evals/ suite. Every run makes real model calls on
# Lachy's account, is nondeterministic and spawns nested claude sessions, so it is a human step, never
# part of `make test` (the self-rollout verifier) or of a bare `make` (this target stays last, and test
# is the default goal). tests/contracts/evals-structure.test.mjs checks the suite's shape there for free.
# - --ablation none: a no-plugin arm can never fire a thread skill, so its delta means nothing here and
#   it would double the cost. Every Skill grader sets `arm: both`.
# - Record a scored baseline in docs/evals/ before changing any skill description.
# - Results land in the git-ignored evals/results/<timestamp>/. Clear it before `claude plugin update`:
#   the `./` directory source copies ignored files into the version cache. `make release-check` refuses
#   while it holds output, and its stray check fails on any copy that reached the cache.
# - Override e.g. `make evals EVAL_ARGS="--runs 3 --no-publish"`. An override replaces the whole
#   default, so repeat `--ablation none --max-cost-usd 5` to keep them.
EVAL_ARGS ?= --ablation none --runs 1 --max-cost-usd 5 --no-publish --threshold 0
evals:
	claude plugin eval . $(EVAL_ARGS)
