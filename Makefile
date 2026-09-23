# thread plugin — test and release checks. `make test` is also the self-rollout verifier.
.PHONY: test release-check

test:
	@bash tests/run.sh

# After `claude plugin update thread@thread`: both manifests agree, and the version-keyed cache the
# engine and hooks run from (${CLAUDE_PLUGIN_ROOT}) holds exactly what this tree ships. A same-version
# content change never refreshes the cache (THREAD.md § Known quirks) — bump, then run this.
CONFIG := $(or $(CLAUDE_CONFIG_DIR),$(HOME)/.claude)
CACHE := $(CONFIG)/plugins/cache/thread/thread
release-check:
	@v=$$(python3 -c 'import json; print(json.load(open(".claude-plugin/plugin.json"))["version"])'); \
	m=$$(python3 -c 'import json; print([p["version"] for p in json.load(open(".claude-plugin/marketplace.json"))["plugins"] if p["name"] == "thread"][0])'); \
	[ "$$v" = "$$m" ] || { echo "FAIL - plugin.json $$v != marketplace.json $$m"; exit 1; }; \
	for sub in skills hooks; do [ -d "$(CACHE)/$$v/$$sub" ] || { echo "FAIL - no $(CACHE)/$$v/$$sub (run the plugin update)"; exit 1; }; done; \
	d=$$(diff -rq -x .DS_Store -x __pycache__ "$(CACHE)/$$v/skills" skills 2>&1; diff -rq -x .DS_Store -x __pycache__ "$(CACHE)/$$v/hooks" hooks 2>&1); \
	[ -z "$$d" ] || { echo "FAIL - cache $$v differs from the tree:"; echo "$$d"; exit 1; }; \
	echo "release-check: $$v — manifests agree, cache $(CACHE)/$$v matches skills/ and hooks/"
