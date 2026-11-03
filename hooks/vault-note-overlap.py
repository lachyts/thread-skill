#!/usr/bin/env python3
"""PreToolUse hook on Edit, Write and MultiEdit: a vault Note overlap is let through, warned and watched (ADR 0067 d6).

This docstring is the one copy of the hook's rules. python >= 3.9 (leg.py's floor; /usr/bin/python3 on this Mac is
3.9.6), stdlib only, POSIX (fcntl). Wired in hooks/hooks.json as `python3 "${CLAUDE_PLUGIN_ROOT}/hooks/
vault-note-overlap.py"` with `"timeout": 5` and no onFailure: a timed-out PreToolUse hook does not block.

What it does. For an edit of a note in the vault (~/repos/obsidian) by a run's task, it records which live run's task
has written the note; when a live task of ANOTHER run is already in it, it lets the edit through and tells the
editing agent which run is in the note, to re-read it before changing it, and to keep that run's lines; and it writes
each warned overlap to the Run record. Nothing is ever held or refused: the hook never prints a permissionDecision.

Fast path (it exits having imported json, os and sys alone; time is loaded by the interpreter itself): a payload that
is not JSON or has no tool_input.file_path; a path outside realpath(~/repos/obsidian), compared case-folded with
realpath on both sides (a relative file_path is joined to the payload's cwd first); and bookkeeping, a path under
Work/Tasks/ (ADR 0059 d2, ADR 0067 d5), .obsidian/, .git/ or .trash/. The note's name is its vault-relative POSIX path.

Who is editing (identity). Three steps, the first that names a run wins; anything else is unidentified and gets no
record and no warning.
1. The agent's transcript, only when the payload's agent_id matches [A-Za-z0-9_-]{1,64}. Claude Code gives every tool
   hook the session's own transcript_path and, inside a subagent, its agent_id (agent_transcript_path is SubagentStop's
   alone today). The first form that exists wins: `agent_transcript_path` (should a later version send it on
   PreToolUse); transcript_path itself when its basename is agent-<id>.jsonl (`direct`); <stem>/subagents/
   agent-<id>.jsonl (`subagents`, an Agent-tool subagent); <stem>/subagents/workflows/*/agent-<id>.jsonl (`workflows`,
   a Workflow agent; one directory level, no recursive walk), <stem> being transcript_path less `.jsonl`. Its first
   user message is the first "type":"user" entry among its first TRANSCRIPT_LINES (5) lines, at most TRANSCRIPT_BYTES
   (2 MB) read; message.content is a string or a list of text parts (a `<system-reminder>` part is skipped).
2. The opener window, opener_links(text): drop a first line that starts with `[Workflow harness` (the harness's
   preamble), strip each line (the harness indents computed text by two spaces), take the first OPENER_LINES (3)
   non-blank lines and return their distinct [[link]] slugs in order (leg.py's LINK_RE grammar; an alias, heading
   or path dropped). Every engine prompt in skills/execute/task.workflow.js puts its task link and then its rollout
   link there: `You're picking up [[t]] from the rollout at [[r]]` (implementer, read-only, planner), `PLAN APPROVED
   for [[t]] (rollout [[r]])`, `REVISION ROUND n: ... for [[t]]` then `(rollout [[r]])` (the reviser, and the plan
   reviser's `PLAN REVISION ROUND`), `INTEGRATION ... for [[t]] (rollout [[r]])`; a signed-gates re-dispatch only
   appends. tests/contracts/note-overlap-opener.test.mjs pins that window against the builders. The pair: the task
   is the first opener link t whose <vault>/Work/Tasks/t.md exists, whose frontmatter `rollout:` (a wikilink or a bare
   slug) names another opener link r, whose <vault>/Work/Tasks/r.md is a file (a live rollout), and which reads live
   (below). The owner is t's `owner:`. No prompt wording is matched, so every engine agent of a task (implementer,
   reviser, integrator, a read-only judge) is its task's run.
3. A serial Leg, when there is no agent_id or the agent's opener names no run (a Leg's own subagent). The hook lists
   <vault>/Work/Tasks once and reads only the notes whose names match reconcile-rollout.py's ROLLOUT_NOTE_NAME_RE,
   skips any whose text lacks `session <session_id>`, and keeps those with `shape: serial`. In `## Leg log` (leg.py's
   LOG_RE, BEGAN_RE, LINK_RE and LEG_LOG, leg.py loaded by path only once a note holds the session; it loads no
   reconcile-rollout.py at import), an open Leg N (no `closed:` line) whose latest `began:` or `resumed:` session is
   session_id is the editor, its task the Leg's latest `claimed [[t]]` or `took [[t]]`, accepted only when t reads
   live with `owner: leg-N` and a `rollout:` naming that note. A done, set-aside or taken-over task fails that check.

The writer record. One JSON file per note in the state dir: THREAD_NOTE_OVERLAP_DIR when it is absolute, else
<XDG_STATE_HOME>/thread/note-writers when XDG_STATE_HOME is absolute, else ~/.local/state/thread/note-writers, outside
the vault so it never syncs. A relative or empty value is ignored and `~` is never expanded: the rule of
reconcile-rollout.py's _note_lock_dir, mirrored (loading that module would spend the budget). The file is <key>.json,
key the first 16 hex of sha1 over the case-folded vault-relative path: {note, writers: [{rollout (lowercased),
task, owner, rolloutLink (the rollout note's name), via (agent | leg), first, last (UTC Z stamps with microseconds),
writes (an int), warned: {"<editor rollout>/<editor task>": <the holder's writes at that warning>}}]}. Each
read-modify-write runs under fcntl.flock on <key>.lock, taken non-blocking with retries for LOCK_WAIT (0.3 s), and the
file is written to a temp file and os.replace'd. When the lock cannot be had (held, or the state dir unusable), the
record is read unlocked (os.replace keeps it whole), the warnings are still computed and sent, and nothing is written.
Dead writers are pruned on every visit, an entry of the editor's own (rollout, task) under another owner is
replaced, and the file is deleted when no writer is left. A sweep runs at most once a day (the mtime of `.swept`), on
a recorded write: it removes record, lock and temp files untouched for STALE_DAYS (14).

Liveness. A writer is live while its task note reads `status: in_progress`, or `status: review` with a `pr:`
(approved and awaiting Integration: neither done nor set aside); the note keeps the `owner:` recorded at its first
write (a Leg take-over writes the next leg-N, which is how a lost Leg shows; a note with no `owner:` on either side
reads as status-only); its `rollout:` names the recorded rollout (a carry or a defer re-points it); and that rollout
note is still directly in Work/Tasks. A missing or archived task note is dead. Statuses read lower-cased, `-` as `_`.
Only the frontmatter's top-level `key: value` lines are read (status, owner, rollout, pr, shape).

The warning. Another run is another rollout: a decided call (ADR 0059 d5's collision was between chains, and each
serial chain is its own rollout note), so two tasks of one rollout in one note are an accepted miss. When a live
writer of another rollout is in the note, the hook prints {"hookSpecificOutput": {"hookEventName": "PreToolUse",
"additionalContext": ...}} naming the note, the holder's task [[t]], its run [[r]] and when it first wrote, saying the
edit was let through, and telling the agent to re-read the note before changing it and to keep the other run's lines;
exit 0. It is sent once per (editor run, holder task) on a note, and again only once the holder's `writes` has grown
since the last warning. The warning arrives beside the tool result, after the edit applied: it guards the next
change, and Claude Code's own stale-read refusal guards a blind overwrite.

The Run record. Each warning is one `note-overlap` line (run_record.py's kind; rollout and task the editing run's;
note, holderRollout, holderTask, holderSince, tool, via) in its reserved overlaps.jsonl, through
RR.emit, run_record.py loaded by path only when a warning fires, stderr silenced (the Stop hook's record_halt
pattern). The events dir is run_record's own chain. The weekly Reflection's span reports them (reflect.py
`noteOverlaps`).

Time limit. The hook keeps its own monotonic budget of BUDGET (2 s) and checks it before the transcript read, the
Leg scan, the lock and the emit; a spent budget stops there and lets the edit through. Every exception is
swallowed: exit 0, nothing on stderr, and stdout holds only the warning.

The debug log, on by default: one JSON line per call, {ts, ms, tool, agent (bool), agentType, session (its first 8
characters), form (agent_transcript_path | direct | subagents | workflows | none | skipped), identity (agent | leg |
none), why (outside-vault | bookkeeping | bad-payload | no-transcript | no-opener-pair | task-not-live | no-open-leg |
leg-claim-not-live | ok), outcome (recorded | warned | silent | lock-busy | budget)}, plus `note` for a vault path.
Unset, the vault-path calls (bookkeeping included, unresolved) go to <state dir>/debug.jsonl, so the first live week
shows whether agent_id arrives in Workflow agents with no settings change. THREAD_NOTE_OVERLAP_DEBUG=<absolute file>
logs every call there, outside-vault ones too (no path); `off` logs nothing; a relative value is ignored. Each file is
capped at DEBUG_CAP (512 KB) with one rotated copy (<file>.1); a log failure is silent. No reader in code: it is
evidence, and the weekly reading never reads it.

Accepted misses: script and shell writes pass no hook; Codex Legs have no Claude Code hooks; two tasks of one rollout
in one note; an unidentified session (an interactive session, a lead's own thread, Codex, scripts); a subagent a task
agent spawns itself (depth 2: no engine opener and no Leg). The weekly reading's cannotShow names them.
"""
import json
import os
import sys
import time   # loaded by the interpreter at start-up: importing it costs nothing

OPENER_LINES = 3
TRANSCRIPT_LINES = 5
TRANSCRIPT_BYTES = 2 * 1024 * 1024
BUDGET = 2.0
LOCK_WAIT = 0.3
STALE_DAYS = 14
DEBUG_CAP = 512 * 1024
VAULT = "~/repos/obsidian"
BOOKKEEPING = ("work/tasks/", ".obsidian/", ".git/", ".trash/")
TOOLS = ("Edit", "Write", "MultiEdit")
FM_KEYS = ("status", "owner", "rollout", "pr", "shape")
HARNESS_PREFIX = "[Workflow harness"
AGENT_ID_RE_SRC = r"[A-Za-z0-9_-]{1,64}"
SESSION_RE_SRC = r"[A-Za-z0-9_.:-]{1,128}"
LINK_RE_SRC = r"\[\[([^\]|#^\\]+)[^\]]*\]\]"   # leg.py's LINK_RE (tests/vault-note-overlap.test.sh pins the two)
ROLLOUT_NOTE_NAME_RE_SRC = r"-rollout-\d{4}-\d\d-\d\d(?:-\d+)?\.md\Z"   # reconcile-rollout.py's ROLLOUT_NOTE_NAME_RE
KEY_FILE_RE_SRC = r"[0-9a-f]{16}\.(?:json|lock)(?:\.\d+\.tmp)?\Z"
HERE = os.path.dirname(os.path.abspath(__file__))
LEG_PY = os.path.join(HERE, "..", "skills", "execute", "scripts", "leg.py")
RUN_RECORD_PY = os.path.join(HERE, "..", "skills", "_shared", "scripts", "run_record.py")

_RES = {}


class Spent(Exception):
    """The budget ran out: stop and let the edit through."""


def _re(src):
    if src not in _RES:
        import re
        _RES[src] = re.compile(src)
    return _RES[src]


def _load(name, path):
    import importlib.util
    sys.dont_write_bytecode = True
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def stamp(t=None):
    t = time.time() if t is None else t
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(t)) + ".%06dZ" % int((t % 1) * 1e6)


# ---- links and frontmatter -------------------------------------------------------------------------------------

def slug_of(inner):
    """A link's (or a frontmatter value's) note name: quotes and brackets dropped, the alias, a heading or block anchor,
    a table's escaping backslash and any path dropped, `.md` cut (reconcile-rollout.py's _wikilink_slug)."""
    if not isinstance(inner, str):
        return None
    s = inner.strip().strip('"').strip("'").strip().replace("[[", "").replace("]]", "").strip()
    for ch in "|#^":
        s = s.split(ch, 1)[0]
    s = s.rstrip().rstrip("\\").split("/")[-1].strip()
    if s.endswith(".md"):
        s = s[:-3]
    return s or None


def opener_links(text):
    """The distinct [[link]] slugs, in order, of the opener window: the first OPENER_LINES non-blank lines of the
    computed text, a first line that starts with the harness's preamble dropped and each line stripped."""
    if not isinstance(text, str):
        return []
    lines = text.split("\n")
    if lines and lines[0].lstrip().startswith(HARNESS_PREFIX):
        lines = lines[1:]
    window = [l.strip() for l in lines if l.strip()][:OPENER_LINES]
    out = []
    for line in window:
        for m in _re(LINK_RE_SRC).finditer(line):
            s = slug_of(m.group(1))
            if s and s not in out:
                out.append(s)
    return out


def _name_ok(name):
    return isinstance(name, str) and bool(name) and not name.startswith(".") and not any(c in name for c in "/\\\x00")


def _scalar(raw):
    """A frontmatter scalar: an inline ` # comment` dropped, quotes and whitespace stripped (reconcile-rollout.py's)."""
    s = _re(r"\s+#.*$|^#(\s.*)?$").sub("", raw.strip()).strip()
    return s.strip('"').strip("'").strip()


def frontmatter_of(lines):
    """FM_KEYS from the top-level `key: value` lines between the opening and closing `---` ({} with none)."""
    if not lines or lines[0].strip() != "---":
        return {}
    out = {}
    for line in lines[1:]:
        if line.strip() == "---":
            return out
        if not line[:1].isalpha():
            continue
        k, sep, v = line.partition(":")
        k = k.strip()
        if sep and k in FM_KEYS and k not in out:
            out[k] = _scalar(v)
    return {}


def read_frontmatter(path, cache):
    """The note's frontmatter (cached per call), or None when it cannot be read (missing, archived)."""
    if path not in cache:
        try:
            with open(path, encoding="utf-8", errors="replace") as f:
                head = f.read(65536)
            cache[path] = frontmatter_of(head.split("\n"))
        except OSError:
            cache[path] = None
    return cache[path]


def _status(fm):
    return fm.get("status", "").lower().replace("-", "_")


def live(tasks, task, owner, rollout_link, cache):
    """The liveness rule (the docstring's): status, owner, rollout and the rollout note directly in Work/Tasks."""
    if not (_name_ok(task) and _name_ok(rollout_link)):
        return False
    fm = read_frontmatter(os.path.join(tasks, task + ".md"), cache)
    if not fm:
        return False
    st = _status(fm)
    if not (st == "in_progress" or (st == "review" and fm.get("pr"))):
        return False
    cur = fm.get("owner", "")
    if owner and cur and cur != owner:
        return False
    named = slug_of(fm.get("rollout", ""))
    if not named or named.casefold() != rollout_link.casefold():
        return False
    return os.path.isfile(os.path.join(tasks, rollout_link + ".md"))


# ---- who is editing ---------------------------------------------------------------------------------------------

def find_transcript(payload, aid):
    """(path, form) of the agent's own transcript, or (None, "none")."""
    atp = payload.get("agent_transcript_path")
    if isinstance(atp, str) and atp and os.path.isfile(atp):
        return atp, "agent_transcript_path"
    tp = payload.get("transcript_path")
    if not isinstance(tp, str) or not tp:
        return None, "none"
    name = "agent-%s.jsonl" % aid
    if os.path.basename(tp) == name and os.path.isfile(tp):
        return tp, "direct"
    stem = tp[:-6] if tp.endswith(".jsonl") else tp
    direct = os.path.join(stem, "subagents", name)
    if os.path.isfile(direct):
        return direct, "subagents"
    wf = os.path.join(stem, "subagents", "workflows")
    try:
        runs = sorted(os.listdir(wf))
    except OSError:
        runs = []
    for run in runs:
        p = os.path.join(wf, run, name)
        if os.path.isfile(p):
            return p, "workflows"
    return None, "none"


def first_user_text(path):
    """The first user message's text among the transcript's first TRANSCRIPT_LINES lines, or None."""
    try:
        with open(path, "rb") as f:
            left = TRANSCRIPT_BYTES
            for _ in range(TRANSCRIPT_LINES):
                raw = f.readline(left)
                if not raw:
                    return None
                left -= len(raw)
                try:
                    d = json.loads(raw)
                except ValueError:
                    continue
                if not isinstance(d, dict) or d.get("type") != "user":
                    continue
                content = (d.get("message") or {}).get("content")
                if isinstance(content, str):
                    return content
                if isinstance(content, list):
                    parts = [p.get("text") for p in content if isinstance(p, dict) and p.get("type") == "text"
                             and isinstance(p.get("text"), str)]
                    parts = [p for p in parts if not p.lstrip().startswith("<system-reminder>")]
                    return "\n".join(parts)
                return None
    except OSError:
        return None
    return None


def pick_pair(links, tasks, cache):
    """(identity, why): the first opener link t whose note's rollout: names another opener link r (a live rollout
    note) and which reads live; why no-opener-pair or task-not-live when none does."""
    why = "no-opener-pair"
    folded = [l.casefold() for l in links]
    for t in links:
        if not _name_ok(t):
            continue
        fm = read_frontmatter(os.path.join(tasks, t + ".md"), cache)
        if not fm:
            continue
        r = slug_of(fm.get("rollout", ""))
        if not r or r.casefold() == t.casefold() or r.casefold() not in folded or not _name_ok(r):
            continue
        r = links[folded.index(r.casefold())]
        if not os.path.isfile(os.path.join(tasks, r + ".md")):
            continue
        owner = fm.get("owner", "")
        if not live(tasks, t, owner, r, cache):
            why = "task-not-live"
            continue
        return {"rollout": r.lower(), "task": t, "owner": owner, "rolloutLink": r, "via": "agent"}, "ok"
    return None, why


def _leg_log(lines, leg):
    """The `## Leg log` section's lines (to the next `## ` heading)."""
    out, inside = [], False
    for line in lines:
        if line.rstrip() == leg.LEG_LOG:
            inside = True
            continue
        if inside and line.startswith("## "):
            break
        if inside:
            out.append(line.rstrip())
    return out


def leg_identity(sid, tasks, cache, spend):
    """(identity, why) for a serial Leg's session: no-open-leg or leg-claim-not-live when none."""
    if not isinstance(sid, str) or sid == "unknown" or not _re(SESSION_RE_SRC).fullmatch(sid):
        return None, "no-open-leg"
    try:
        names = sorted(os.listdir(tasks))
    except OSError:
        return None, "no-open-leg"
    needle = "session " + sid
    why = "no-open-leg"
    leg = None
    for name in names:
        if not _re(ROLLOUT_NOTE_NAME_RE_SRC).search(name):
            continue
        spend()
        path = os.path.join(tasks, name)
        try:
            with open(path, encoding="utf-8", errors="replace") as f:
                text = f.read()
        except OSError:
            continue
        if needle not in text:
            continue
        lines = text.split("\n")
        if frontmatter_of(lines).get("shape", "").lower() != "serial":
            continue
        if leg is None:
            leg = _load("thread_leg_constants", LEG_PY)
        legs = {}
        for line in _leg_log(lines, leg):
            m = leg.LOG_RE.match(line)
            if not m:
                continue
            g = legs.setdefault(int(m.group("n")), {"session": None, "began": False, "closed": False, "task": None})
            rest = m.group("rest")
            if rest.startswith("began:"):
                b = leg.BEGAN_RE.match(rest)
                if b:
                    g["began"], g["session"] = True, b.group(2)
            elif rest.startswith("resumed:"):
                g["session"] = rest.split("session", 1)[-1].strip()
            elif rest.startswith("closed:"):
                g["closed"] = True
            elif rest.startswith("claimed ") or rest.startswith("took "):
                lm = leg.LINK_RE.search(rest)
                if lm:
                    g["task"] = slug_of(lm.group(1))
        mine = [n for n, g in legs.items() if g["began"] and not g["closed"] and g["session"] == sid]
        if not mine:
            continue
        n = max(mine)
        t = legs[n]["task"]
        stem = name[:-3]
        owner = "leg-%d" % n
        fm = read_frontmatter(os.path.join(tasks, t + ".md"), cache) if _name_ok(t) else None
        if not fm or fm.get("owner", "") != owner or not live(tasks, t, owner, stem, cache):
            why = "leg-claim-not-live"
            continue
        return {"rollout": stem.lower(), "task": t, "owner": owner, "rolloutLink": stem, "via": "leg"}, "ok"
    return None, why


# ---- the writer record -------------------------------------------------------------------------------------------

def state_dir():
    """THREAD_NOTE_OVERLAP_DIR, else XDG_STATE_HOME/thread/note-writers, else ~/.local/state/thread/note-writers; a
    relative or empty value ignored (reconcile-rollout.py's _note_lock_dir rule)."""
    def absolute(v):
        return v if v and os.path.isabs(v) else None
    return absolute(os.environ.get("THREAD_NOTE_OVERLAP_DIR")) or os.path.join(
        absolute(os.environ.get("XDG_STATE_HOME")) or os.path.join(os.path.expanduser("~"), ".local", "state"),
        "thread", "note-writers")


def note_key(rel):
    import hashlib
    return hashlib.sha1(rel.casefold().encode("utf-8")).hexdigest()[:16]


def _lock(path):
    """An fd holding an exclusive flock on path, or None: non-blocking, retried for LOCK_WAIT."""
    import fcntl
    try:
        fd = os.open(path, os.O_RDWR | os.O_CREAT, 0o644)
    except OSError:
        return None
    deadline = time.monotonic() + LOCK_WAIT
    while True:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            try:
                os.utime(fd)   # the sweep reads a lock's mtime as its last use
            except (OSError, NotImplementedError):
                pass
            return fd
        except BlockingIOError:
            if time.monotonic() >= deadline:
                os.close(fd)
                return None
            time.sleep(0.02)
        except OSError:
            os.close(fd)
            return None


def _writer_ok(w):
    return isinstance(w, dict) and all(isinstance(w.get(k), str) for k in ("rollout", "task", "owner", "rolloutLink",
                                                                           "first")) \
        and isinstance(w.get("writes"), int) and isinstance(w.get("warned"), dict)


def read_record(path):
    try:
        with open(path, encoding="utf-8") as f:
            d = json.load(f)
    except (OSError, ValueError):
        return []
    ws = d.get("writers") if isinstance(d, dict) else None
    return [w for w in ws if _writer_ok(w)] if isinstance(ws, list) else []


def write_record(path, rel, writers):
    if not writers:
        try:
            os.unlink(path)
        except OSError:
            pass
        return
    tmp = "%s.%d.tmp" % (path, os.getpid())
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump({"note": rel, "writers": writers}, f, ensure_ascii=False, sort_keys=True)
        os.replace(tmp, path)
    except OSError:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def visit(state, rel, editor, tasks, cache, spend):
    """The record's read-modify-write for one identified edit: (holders to warn, written). Unwritten when the lock
    could not be had or the write failed: the holders still come from the unlocked read."""
    key = note_key(rel)
    path = os.path.join(state, key + ".json")
    fd = None
    spend()
    try:
        os.makedirs(state, exist_ok=True)
        fd = _lock(os.path.join(state, key + ".lock"))
    except OSError:
        fd = None
    try:
        now = stamp()
        mine_key = (editor["rollout"], editor["task"].lower())
        seen = editor["rollout"] + "/" + editor["task"].lower()
        writers, warn, mine = [], [], None
        for w in read_record(path):
            if not live(tasks, w["task"], w["owner"], w["rolloutLink"], cache):
                continue
            if (w["rollout"].lower(), w["task"].lower()) == mine_key:
                if mine is not None or w["owner"] != editor["owner"]:
                    continue   # another owner's entry for this run: replaced
                mine = w
            elif w["rollout"].lower() != editor["rollout"]:
                prev = w["warned"].get(seen)
                if not isinstance(prev, int) or w["writes"] > prev:
                    warn.append(dict(w))
                    w["warned"][seen] = w["writes"]
            writers.append(w)
        if mine is None:
            mine = dict(editor, first=now, last=now, writes=0, warned={})
            writers.append(mine)
        mine["last"], mine["writes"] = now, mine["writes"] + 1
        written = False
        if fd is not None:
            try:
                write_record(path, rel, writers)
                written = True
            except OSError:
                pass
            sweep(state, spend)
        return warn, written
    finally:
        if fd is not None:
            os.close(fd)


def sweep(state, spend):
    """At most once a day (the mtime of .swept): remove record, lock and temp files untouched for STALE_DAYS."""
    marker = os.path.join(state, ".swept")
    now = time.time()
    try:
        if now - os.stat(marker).st_mtime < 86400:
            return
    except OSError:
        pass
    try:
        spend()
    except Spent:
        return
    try:
        with open(marker, "a"):
            pass
        os.utime(marker)
        names = os.listdir(state)
    except OSError:
        return
    for name in names:
        if not _re(KEY_FILE_RE_SRC).match(name):
            continue
        p = os.path.join(state, name)
        try:
            if now - os.stat(p).st_mtime > STALE_DAYS * 86400:
                os.unlink(p)
        except OSError:
            pass


# ---- the warning and the Run record -----------------------------------------------------------------------------

def warning_text(rel, holders):
    parts = ["Note overlap (ADR 0067 d6): another run is in `%s`." % rel]
    for h in holders:
        parts.append("[[%s]] of run [[%s]] has written it since %s." % (h["task"], h["rolloutLink"], h["first"]))
    parts.append("Your edit was let through; re-read the note before you change it again, and keep the other "
                 "run's lines.")
    return " ".join(parts)


def emit(editor, holders, rel, tool):
    """One note-overlap line per warned holder (best-effort and silent: stderr silenced, nothing raises)."""
    saved = sys.stderr
    try:
        with open(os.devnull, "w") as quiet:
            sys.stderr = quiet
            RR = _load("thread_run_record", RUN_RECORD_PY)
            for h in holders:
                fields = {"note": rel[:400], "holderRollout": h["rollout"].lower(), "holderTask": h["task"].lower(),
                          "holderSince": h["first"], "via": editor["via"]}
                if tool in TOOLS:
                    fields["tool"] = tool
                RR.emit(editor["rollout"], "note-overlap", editor["task"], fields)
    except Exception:  # noqa: BLE001 — recording never changes the hook's answer
        pass
    finally:
        sys.stderr = saved


# ---- the debug log ----------------------------------------------------------------------------------------------

def debug_target():
    """(file, every call) or (None, False): `off` logs nothing; an absolute file logs every call; else the default."""
    v = os.environ.get("THREAD_NOTE_OVERLAP_DEBUG")
    if v == "off":
        return None, False
    if v and os.path.isabs(v):
        return v, True
    return os.path.join(state_dir(), "debug.jsonl"), False


def debug(call, t0):
    try:
        target, every = debug_target()
        if target is None or (not every and call.get("note") is None):
            return
        line = {"ts": stamp(), "ms": int((time.monotonic() - t0) * 1000)}
        for k in ("tool", "agent", "agentType", "session", "form", "identity", "why", "outcome"):
            line[k] = call.get(k)
        if call.get("note") is not None:
            line["note"] = call["note"]
        data = (json.dumps(line, ensure_ascii=False) + "\n").encode("utf-8")
        os.makedirs(os.path.dirname(target), exist_ok=True)
        try:
            if os.path.getsize(target) >= DEBUG_CAP:
                os.replace(target, target + ".1")
        except OSError:
            pass
        fd = os.open(target, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o644)
        try:
            os.write(fd, data)
        finally:
            os.close(fd)
    except Exception:  # noqa: BLE001 — a log failure is silent
        pass


# ---- the call ---------------------------------------------------------------------------------------------------

def handle(payload, call, t0):
    """Everything after the payload parsed; fills `call` for the debug log and returns the stdout text, or None."""
    def spend():
        if time.monotonic() - t0 >= BUDGET:
            raise Spent()

    tool = payload.get("tool_name")
    call["tool"] = tool if isinstance(tool, str) else None
    aid = payload.get("agent_id")
    call["agent"] = isinstance(aid, str) and bool(aid)
    at = payload.get("agent_type")
    call["agentType"] = at if isinstance(at, str) else None
    sid = payload.get("session_id")
    call["session"] = sid[:8] if isinstance(sid, str) else None
    ti = payload.get("tool_input")
    fp = ti.get("file_path") if isinstance(ti, dict) else None
    if not isinstance(fp, str) or not fp:
        call["why"] = "bad-payload"
        return None
    if not os.path.isabs(fp):
        cwd = payload.get("cwd")
        if not isinstance(cwd, str) or not os.path.isabs(cwd):
            call["why"] = "bad-payload"
            return None
        fp = os.path.join(cwd, fp)
    vault = os.path.realpath(os.path.expanduser(VAULT))
    rp = os.path.realpath(fp)
    if not rp.casefold().startswith(vault.casefold() + os.sep):
        call["why"] = "outside-vault"
        return None
    rel = rp[len(vault) + 1:].replace(os.sep, "/")
    call["note"] = rel
    if any(rel.casefold().startswith(b) for b in BOOKKEEPING):
        call["why"] = "bookkeeping"
        return None

    tasks = os.path.join(vault, "Work", "Tasks")
    cache = {}
    try:
        ident, why = None, None
        if isinstance(aid, str) and _re(AGENT_ID_RE_SRC).fullmatch(aid):
            spend()
            path, call["form"] = find_transcript(payload, aid)
            text = first_user_text(path) if path else None
            if text is None:
                why = "no-transcript"
            else:
                ident, why = pick_pair(opener_links(text), tasks, cache)
        if ident is None:
            spend()
            ident, leg_why = leg_identity(sid, tasks, cache, spend)
            if why is None or leg_why == "leg-claim-not-live" or ident is not None:
                why = leg_why
        call["why"] = why
        if ident is None:
            return None
        call["identity"] = ident["via"]
        holders, written = visit(state_dir(), rel, ident, tasks, cache, spend)
        call["outcome"] = "recorded" if written else "lock-busy"
        if not holders:
            return None
        if written:
            call["outcome"] = "warned"
        try:
            spend()
            emit(ident, holders, rel, call["tool"])
        except Spent:
            call["outcome"] = "budget"
        return json.dumps({"hookSpecificOutput": {"hookEventName": "PreToolUse",
                                                  "additionalContext": warning_text(rel, holders)}})
    except Spent:
        call["outcome"] = "budget"
        return None


def main():
    t0 = time.monotonic()
    call = {"tool": None, "agent": False, "agentType": None, "session": None, "form": "skipped", "identity": "none",
            "why": None, "outcome": "silent", "note": None}
    out = None
    try:
        sys.stderr = open(os.devnull, "w")   # left so to the exit: nothing ever reaches stderr
        try:
            payload = json.loads(sys.stdin.read())
        except ValueError:
            payload = None
        if not isinstance(payload, dict):
            call["why"] = "bad-payload"
        else:
            out = handle(payload, call, t0)
    except Exception:  # noqa: BLE001 — the hook never blocks an edit and never speaks on stderr
        out = None
    debug(call, t0)
    if out:
        try:
            sys.stdout.write(out + "\n")
            sys.stdout.flush()
        except Exception:  # noqa: BLE001
            pass


if __name__ == "__main__":
    main()
