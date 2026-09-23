# Windows setup (native)

Minimal footprint for running the continuity verbs (chiefly `/thread:next`, `/thread:close`, `/thread:orient`) on a native-Windows Claude Code machine. Decided 2026-08-18: no personal-config transport to Windows (standalone skills and global CLAUDE.md stay Mac-only) and no workspaces clone. The plugin plus the synced vault is the whole footprint. Do not fork skill bodies for Windows: one canonical version per skill, and any local patch of the installed plugin is overwritten on the next update.

## Minimal install

1. **Prerequisites**: Git for Windows (provides the Git Bash that Claude Code's Bash tool uses), `gh` CLI authenticated as `lachyts` (this repo is private), Claude Code, Obsidian with Obsidian Sync.
2. **Vault**: synced via Obsidian Sync into `C:\Users\<you>\repos\obsidian`. The skills hardcode `~/repos/obsidian`, and both Git Bash `~` and Python `expanduser` resolve to the user profile, so that location makes every path work unmodified. Vault filenames must stay NTFS-legal (no `? * : " < > |`, no trailing space or dot, titles short enough for MAX_PATH); the Mac side was swept clean 2026-08-18.

   > **Warning:** Windows paths are case-insensitive, so a *parent* folder named `Obsidian` shadows the vault silently. With the vault at `~/repos/Obsidian/obsidian`, `~/repos/obsidian` resolves to that parent: nothing errors, and the skills write `Work/Tasks/*.md` outside the vault, where they never sync. Check in Git Bash: `ls -a ~/repos/obsidian/.obsidian` must succeed, because the vault root holds `.obsidian/`; if `~/repos/obsidian` exists without it, something is shadowing the vault. Fix: move the vault so `~/repos/obsidian` *is* the vault root.

   1. **Sync other file types**: in Obsidian **Settings → Sync → Selective sync**, turn on syncing of all other file types (the toggle label varies by Obsidian version). Obsidian Sync skips `.js` by default, so `_System/views/*.js` never arrive and every `dv.view()` widget in the daily notes fails with `Dataview: custom view not found for '_System/views/day-tracking.js'`, even though the plugins are installed and DataviewJS is on. Check: `ls ~/repos/obsidian/_System/views/*.js` lists files.
3. **Plugin**: `claude plugin marketplace add lachyts/thread-skill` (or `/plugin marketplace add lachyts/thread-skill` in-app), then install the `thread` plugin. Update later via `claude plugin marketplace update thread` plus a plugin update.
4. **Optional, python3**: the plugin's Stop hook runs `python3 .../wave-stop-driver.py` at every session end. Without `python3` on PATH the hook errors harmlessly but noisily. To quiet it: install Python, then in the Python install dir run `mklink python3.exe python.exe` (Windows installers ship only `python.exe`).
5. **Optional, Defender**: exclude the vault directory from real-time scanning if Obsidian Sync or vault indexing feels slow. Your admin shell, your call.

### What degrades, deliberately

Features of `close`/`orient` that read `~/repos/workspaces` (shared threads, the workspace registry) are absent. Project `THREAD.md` handling still works in whatever repo you are in, and vault captures sync back to the Mac. If a verb ever genuinely needs it, clone `lachyts/claude-workspaces` to `C:\Users\<you>\repos\workspaces` and it lights up; do not pre-provision.

The process-observation capture (category 7, thread-skill ADR 0012, 0015) **NOOPs at every altitude on Windows**, and the skill bodies enforce it rather than this page asserting it: `close`, `stash` and `defer` each carry the clause "On Windows (no `~/.agents` tree — the method contract and template are not shipped there) the category-7 scan NOOPs at every altitude; never hand-roll a row or a ledger" in their scan step. The mechanism is the no-personal-config-transport rule above — the `method` skill's capture contract and its `METHOD-template.md` live in the Mac-only `~/.agents` tree — so a Windows agent can neither read the routing test nor create a ledger at project, seat or estate. Do not fork the contract and do not substitute a local ledger: an observation that would have qualified is simply not captured, and the METHOD.md *write* contract stays Mac-side. The seat (`~/repos/workspaces/<workspace>/knowledge/METHOD.md`) and estate (`~/repos/workspaces/_shared/knowledge/METHOD.md`) files remain readable doctrine once the workspaces clone exists — read them, never write them.

## Full system (only if Windows use grows)

The rollout engine (`split`/`schedule`/`execute`/`status`/`repair`) additionally requires `python3` (no longer optional), the workspaces clone above, and target repos under `~/repos/`. All path resolution already goes through `expanduser` / Git Bash `~`, so mirroring the Mac's `~/repos` layout needs no skill changes.

Known risk on native Windows, first run: the Stop hook command references `${CLAUDE_PLUGIN_ROOT}`. If it fails to expand under the Windows hook runner, report it back rather than patching locally; the fix belongs in `hooks/hooks.json` in this repo.
