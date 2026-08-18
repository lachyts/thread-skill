# Windows setup (native, not WSL)

Install the thread plugin on a native-Windows Claude Code machine. The skills hardcode `~/repos/obsidian` and `~/repos/workspaces`, but every path goes through Git Bash `~` or Python `expanduser`, both of which resolve to `C:\Users\<you>` on Windows. Mirror the Mac's `~/repos/...` layout there and the skill bodies and scripts work unmodified. No forked Windows variant exists or should exist: one canonical version per skill.

## 1. Prerequisites

- **Git for Windows**: provides the Git Bash that Claude Code's Bash tool uses. Confirm `git --version` and that `echo ~` in Git Bash prints `/c/Users/<you>`.
- **gh CLI, authenticated as `lachyts`**: `gh auth login`. Needed twice over: this repo is private (marketplace add pulls it over authenticated git), and the rollout engine creates PRs via `gh`.
- **Claude Code** for Windows.
- **Python 3 with a `python3` shim on PATH**: the Stop hook and reconcile script are invoked as `python3 ...`. Windows installers (python.org, winget) ship only `python.exe`. Create the shim in the Python install dir from an elevated prompt:

  ```
  mklink python3.exe python.exe
  ```

  (or copy `python.exe` to `python3.exe`). Verify in Git Bash: `python3 --version`.
- **Obsidian with Obsidian Sync** signed in to the vault's account.

## 2. Mirror the repos layout

Everything lives under `C:\Users\<you>\repos\`, so `~/repos/...` resolves identically to the Mac.

1. Create the folder: `mkdir C:\Users\<you>\repos`
2. **Vault**: in Obsidian, create/open a vault at `C:\Users\<you>\repos\obsidian` and connect it to the remote vault via Obsidian Sync. The vault has no git remote by design (git is a Mac-local backup only); Sync is the transport. Wait for the initial sync to finish before running any thread verb: `Work/Tasks/` and `Work/Projects/` must exist.
3. **Workspaces**: `git clone https://github.com/lachyts/claude-workspaces.git C:\Users\<you>\repos\workspaces`
4. Code repos the rollout engine will operate on go under `C:\Users\<you>\repos\<name>` as usual.

## 3. Install the plugin

From Claude Code on the Windows machine:

```
claude plugin marketplace add lachyts/thread-skill
```

(or `/plugin marketplace add lachyts/thread-skill` in-app), then install the `thread` plugin from that marketplace. The private repo is fetched with the git credentials from step 1.

To pick up new versions later: `claude plugin marketplace update thread`, then update the plugin.

## 4. Verify

Run through in order; each step gates the next.

1. `python3 --version` in Git Bash prints a version.
2. `gh auth status` shows `lachyts` logged in.
3. `ls ~/repos/obsidian/Work/Tasks` in Git Bash lists task notes (vault synced, path resolves).
4. `/thread:open` lists threads (vault + workspaces reads work).
5. End a session and confirm the Stop hook runs without error. This is the one known risk on native Windows: the hook command is `python3 "${CLAUDE_PLUGIN_ROOT}/hooks/wave-stop-driver.py"`, and if `${CLAUDE_PLUGIN_ROOT}` fails to expand under the Windows hook runner, the hook errors visibly. If that happens, report it back rather than patching locally; the fix belongs in `hooks/hooks.json` in this repo.
6. Full-engine check when first needed: run a small `/thread:schedule` + `/thread:execute` rollout and confirm `git worktree` and `gh pr` behave.

## Known limitations

- `/thread:*` verbs that shell out to macOS-only tooling in *task content* (e.g. `sips`, `osascript` inside a dispatched task) will fail on Windows; that is task-level, not engine-level.
- The Mac's 11am vault git-backup sweep does not exist on Windows. Obsidian Sync is the only vault safety net there; do not rely on vault git history on the Windows side.
