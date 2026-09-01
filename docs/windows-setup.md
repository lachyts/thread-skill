# Windows setup (native)

Minimal footprint for running the continuity verbs (chiefly `/thread:next`, `/thread:close`, `/thread:orient`) on a native-Windows Claude Code machine. Decided 2026-08-18: no personal-config transport to Windows (standalone skills and global CLAUDE.md stay Mac-only) and no workspaces clone. The plugin plus the synced vault is the whole footprint. Do not fork skill bodies for Windows: one canonical version per skill, and any local patch of the installed plugin is overwritten on the next update.

## Minimal install

1. **Prerequisites**: Git for Windows (provides the Git Bash that Claude Code's Bash tool uses), `gh` CLI authenticated as `lachyts` (this repo is private), Claude Code, Obsidian with Obsidian Sync.
2. **Vault**: synced via Obsidian Sync into `C:\Users\<you>\repos\obsidian`. The skills hardcode `~/repos/obsidian`, and both Git Bash `~` and Python `expanduser` resolve to the user profile, so that location makes every path work unmodified. Vault filenames must stay NTFS-legal (no `? * : " < > |`, no trailing space or dot, titles short enough for MAX_PATH); the Mac side was swept clean 2026-08-18.
3. **Plugin**: `claude plugin marketplace add lachyts/thread-skill` (or `/plugin marketplace add lachyts/thread-skill` in-app), then install the `thread` plugin. Update later via `claude plugin marketplace update thread` plus a plugin update.
4. **Optional, python3**: the plugin's Stop hook runs `python3 .../wave-stop-driver.py` at every session end. Without `python3` on PATH the hook errors harmlessly but noisily. To quiet it: install Python, then in the Python install dir run `mklink python3.exe python.exe` (Windows installers ship only `python.exe`).
5. **Optional, Defender**: exclude the vault directory from real-time scanning if Obsidian Sync or vault indexing feels slow. Your admin shell, your call.

### What degrades, deliberately

Features of `close`/`orient` that read `~/repos/workspaces` (shared threads, the workspace registry) are absent. Project `THREAD.md` handling still works in whatever repo you are in, and vault captures sync back to the Mac. If a verb ever genuinely needs it, clone `lachyts/claude-workspaces` to `C:\Users\<you>\repos\workspaces` and it lights up; do not pre-provision.

`close`'s process-observation capture (category 7, thread-skill ADR 0012) also NOOPs on Windows: it resolves a project directory under `~/Projects` and creates METHOD.md from the template at `~/.agents/skills/method/METHOD-template.md`, and neither surface exists there. Observations that would have qualified are simply not captured — do not substitute a local ledger; the METHOD.md contract is Mac-side.

## Full system (only if Windows use grows)

The rollout engine (`split`/`schedule`/`execute`/`status`/`repair`) additionally requires `python3` (no longer optional), the workspaces clone above, and target repos under `~/repos/`. All path resolution already goes through `expanduser` / Git Bash `~`, so mirroring the Mac's `~/repos` layout needs no skill changes.

Known risk on native Windows, first run: the Stop hook command references `${CLAUDE_PLUGIN_ROOT}`. If it fails to expand under the Windows hook runner, report it back rather than patching locally; the fix belongs in `hooks/hooks.json` in this repo.
