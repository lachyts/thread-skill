# thread plugin — test and release checks. `make test` is also the self-rollout verifier.
.PHONY: test release-check

test:
	@bash tests/run.sh

# After `claude plugin update thread@thread`: both manifests agree, and the version-keyed cache the
# engine and hooks run from (${CLAUDE_PLUGIN_ROOT}) holds exactly what this tree ships. A same-version
# content change never refreshes the cache (THREAD.md § Known quirks) — bump, then run this.
# - The version rule lives in the contract test (tests/contracts/manifest.test.mjs, "same version");
#   its own output is printed on failure, so a malformed SKILL.md shows as that, not as a version claim.
# - The stray check exists because the E2E found a full nested plugin copy (.claude/worktrees/enabler/,
#   git-ignored in the tree) in the 2.5.2 and 2.5.3 caches: every cache file must be in `git ls-files`.
# - .DS_Store and anything under __pycache__/ are exempt everywhere.
# - Cache-only files are reported once, by the stray check (the diff's cache-side `Only in` lines are
#   dropped); tree-side `Only in`, differing files and a missing cache sub-dir still fail the diff.
# - A file tracked at release time but deleted since (a consumed review doc, say) reads as stray, so run
#   this right after the plugin update, on the released commit.
CONFIG := $(or $(CLAUDE_CONFIG_DIR),$(HOME)/.claude)
CACHE := $(CONFIG)/plugins/cache/thread/thread
release-check:
	@o=$$(node --test --test-name-pattern='same version' tests/contracts/manifest.test.mjs 2>&1) || { echo "FAIL - manifest contract (same version) failed:"; echo "$$o"; exit 1; }; \
	v=$$(node -p 'require("./.claude-plugin/plugin.json").version') || exit 1; \
	c="$(CACHE)/$$v"; \
	[ -d "$$c" ] || { echo "FAIL - no $$c (run the plugin update)"; exit 1; }; \
	d=$$(for sub in skills hooks; do diff -rq -x .DS_Store -x __pycache__ "$$c/$$sub" $$sub 2>&1; done | P="Only in $$c/" awk 'index($$0, ENVIRON["P"]) != 1'); \
	[ -z "$$d" ] || { echo "FAIL - cache $$v differs from the tree:"; echo "$$d"; exit 1; }; \
	s=$$({ git -c core.quotePath=false ls-files; cd "$$c" && find . -name __pycache__ -prune -o ! -type d ! -name .DS_Store -print; } | awk '!/^\.\//{t[$$0]=1; next} !(substr($$0,3) in t){print substr($$0,3)}' | LC_ALL=C sort); \
	[ -z "$$s" ] || { echo "FAIL - cache $$v holds files this tree does not track:"; echo "$$s"; exit 1; }; \
	echo "release-check: $$v — manifests agree, cache $$c matches skills/ and hooks/ and holds nothing untracked"
