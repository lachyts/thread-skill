#!/usr/bin/env python3
"""PreToolUse hook on Bash: a command making a commit on the Primary checkout's default branch is refused (ADR 0078 d3).

This docstring is the one copy of the hook's rules. python >= 3.9 (leg.py's floor), stdlib only. Wired in
hooks/hooks.json as `python3 "${CLAUDE_PLUGIN_ROOT}/hooks/primary-commit-guard.py"` with `"timeout": 10` and no
onFailure: a timed-out or failed PreToolUse hook does not block. On native Windows engine-snapshot.py cannot load (it
imports fcntl), so the hook lets everything through there (docs/windows-setup.md).

What it does. It prints {"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny",
"permissionDecisionReason": ...}} when the Bash command would make a commit on the default branch of the Primary, the
reason naming the command, the branch, the checkout and the remedy (a branch or a worktree, or land.sh). Otherwise it
prints nothing. It always exits 0, nothing reaches stderr, and any exception lets the command through: it refuses only
on positive evidence, so a command it cannot read runs.

Fast path: a payload that is not a Bash call, or a command that does not hold the text `git`, exits before any parsing.

Reading the command. The text is split the way the shell would split it (Scan): separators, subshells, `$(...)` and
backticks (their commands are read too), quotes, escapes, line continuations, comments, redirects and heredoc bodies,
which are no commands. A word holding an expansion is unreadable, except $HOME and an unquoted leading ~. From each
simple command, leading shell keywords (LEADERS), assignments and the wrappers (WRAPPERS) are dropped. Only a command
whose first word is git, or a path ending /git, counts; `echo git commit` or a commit message's text never does.

Which checkout. The directory starts at the payload's cwd and follows the command's own `cd` and `pushd`, a subshell's
ending with it, and then git's `-C` flags, relative to it. An unreadable or absent directory (`cd "$WT"`, `cd -`,
`popd`, a relative path with no cwd) is no evidence: the commands that use it are let through until a later absolute
cd. A call that moves the repo itself (GIT_DIR or GIT_WORK_TREE on the command, --git-dir or --work-tree) is let
through too. The call's checkout is its directory's `rev-parse --show-toplevel`; a linked worktree is its own toplevel,
and so is any other repo.

The Primary. engine-snapshot.py's git_primary(), loaded from this hook's own tree: the plugin's own checkout, its main
checkout when this hook runs from a snapshot, none on a version-cache install (nothing is refused). Only that one
checkout is guarded, whichever repo the session sits in.

The default branch. Origin's: refs/remotes/origin/HEAD, read locally, else default-branch.sh (one ls-remote, at most
5 s, never a guessed name). No answer means nothing is refused.

Which branch. HEAD's branch at the time of the call, except that the command's own earlier `git checkout` or
`git switch` in the Primary moves it first (git checkout -b x && git commit is the remedy, and git checkout master &&
git commit is the fault). A create names its branch; `git checkout <word>` is that branch when it exists here or on
origin, a detached HEAD for any other revision, and moves nothing for a path (nor does any checkout with `--`); an
unreadable target, `-` or --detach is no branch. `git rebase <upstream> <branch>` names its own target, and leaves
HEAD on it.
A detached HEAD is no branch, so it is let through.

What makes a commit. git commit, merge, cherry-pick, am, rebase, revert and pull (a merging or rebasing one). Each
form in SPARED makes none and is let through, read only from the flags before a `--`: an abort, a quit, a dry run,
help, --no-commit or --squash (the later commit is the one refused), and --ff-only (the Primary only ever
fast-forwards, ADR 0078 d3), so `git pull --ff-only` always passes while a bare `git pull` is refused even under
pull.ff=only.

Accepted misses. A script that runs git inside itself is never seen by a Bash hook (land.sh and primary-refresh.py
under primary-hold.sh, by design, and any other). Codex Legs have no Claude Code hooks (p45-3's repair is their
backstop). A git alias, git run through `bash -c`, `eval`, `xargs` or a wrapper other than WRAPPERS, a repo moved by
an exported GIT_DIR, plumbing that moves a branch (update-ref), and `git commit` or `--continue` while a rebase holds
HEAD detached (one the guard let start can only be one it could not read).
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.realpath(__file__))
ENGINE = os.path.join(HERE, "..", "skills", "_shared", "scripts", "engine-snapshot.py")
ROOT = os.path.realpath(os.path.join(HERE, ".."))

GIT_TIMEOUT = 3
REMOTE_TIMEOUT = 5
LEADERS = ("if", "then", "elif", "else", "while", "until", "do", "!", "{", "time")
WRAPPERS = ("command", "builtin", "exec", "nohup", "env")
ASSIGN_RE = re.compile(r"([A-Za-z_][A-Za-z0-9_]*)\+?=")
REPO_ENV = ("GIT_DIR", "GIT_WORK_TREE")
REPO_FLAGS = ("--git-dir", "--work-tree")
GIT_VALUE_FLAGS = ("-c", "--namespace", "--config-env")
SWITCHERS = ("checkout", "switch")
CREATE_FLAGS = {"checkout": ("-b", "-B", "--orphan"), "switch": ("-c", "-C", "--create", "--force-create", "--orphan")}
REBASE_VALUE_FLAGS = ("--onto", "-s", "--strategy", "-X", "--strategy-option", "-x", "--exec")
HELP = ("--help", "-h")
ABORT = ("--abort", "--quit")
SPARED = {
    "commit": HELP + ("--dry-run",),
    "merge": HELP + ABORT + ("--ff-only", "--no-commit", "--squash"),
    "cherry-pick": HELP + ABORT + ("--no-commit", "-n"),
    "revert": HELP + ABORT + ("--no-commit", "-n"),
    "am": HELP + ABORT + ("--show-current-patch",),
    "rebase": HELP + ABORT + ("--show-current-patch", "--edit-todo"),
    "pull": HELP + ("--ff-only", "--dry-run"),
}


# ---- reading the shell text --------------------------------------------------------------------------------------

class Scan:
    """The shell text as events in `out`: a simple command's words (None for one holding an expansion), and "(" and
    ")" around a subshell or substitution."""

    def __init__(self, text):
        self.s, self.i, self.out, self.docs = text, 0, [], []

    def at(self, k=0):
        j = self.i + k
        return self.s[j] if j < len(self.s) else ""

    def sub(self):
        """The commands up to a closing `)`, self.i past the opening one."""
        self.out.append("(")
        self.words(")")
        self.out.append(")")

    def backtick(self):
        chars = []
        j = self.i + 1
        while j < len(self.s) and self.s[j] != "`":
            if self.s[j] == "\\":
                j += 1
            chars.append(self.s[j:j + 1])
            j += 1
        self.i = j + 1
        inner = Scan("".join(chars))
        inner.words(None)
        self.out += ["("] + inner.out + [")"]

    def dollar(self, add):
        """One `$` form, self.i on the `$`; False when its value cannot be read from the text."""
        n = self.at(1)
        if n == "(":
            self.i += 2
            self.sub()
            return False
        if n == "'":
            j = self.i + 2
            while j < len(self.s) and self.s[j] != "'":
                j += 2 if self.s[j] == "\\" else 1
            self.i = j + 1
            return False
        if n == "{":
            end = self.s.find("}", self.i)
            name = self.s[self.i + 2:end] if end > 0 else None
            self.i = end + 1 if end > 0 else len(self.s)
        elif n.isalpha() or n == "_":
            j = self.i + 1
            while j < len(self.s) and (self.s[j].isalnum() or self.s[j] == "_"):
                j += 1
            name, self.i = self.s[self.i + 1:j], j
        elif n and n in "?!$@*#-0123456789":
            name, self.i = None, self.i + 2
        else:
            add("$")
            self.i += 1
            return True
        if name == "HOME":
            add(os.path.expanduser("~"))
            return True
        return False

    def dquote(self, add):
        """A double-quoted span, self.i past the opening quote; False when it held an expansion or never closed."""
        add("")
        known = True
        while self.i < len(self.s):
            c = self.s[self.i]
            if c == '"':
                self.i += 1
                return known
            if c == "\\" and self.at(1) and self.at(1) in '$`"\\\n':
                if self.at(1) != "\n":
                    add(self.at(1))
                self.i += 2
            elif c == "`":
                known = False
                self.backtick()
            elif c == "$":
                known = self.dollar(add) and known
            else:
                add(c)
                self.i += 1
        return False

    def redirect(self):
        """One redirect operator, self.i on it; True when a target word follows, to be dropped."""
        for op in ("<<<", "<<-", "<<", ">>", ">&", "<&", ">|", "<>", "<", ">"):
            if self.s.startswith(op, self.i):
                break
        self.i += len(op)
        if op in ("<<", "<<-"):
            while self.at() and self.at() in " \t":
                self.i += 1
            start = self.i
            while self.at() and self.at() not in " \t\n;&|<>()":
                self.i += 1
            self.docs.append((re.sub(r"['\"\\]", "", self.s[start:self.i]), op == "<<-"))
            return False
        if op in ("<", ">") and self.at() == "(":
            self.i += 1
            self.sub()
            return False
        return True

    def heredocs(self):
        """The pending heredoc bodies, self.i at the start of the line after their command."""
        for delim, tabs in self.docs:
            while self.i < len(self.s):
                nl = self.s.find("\n", self.i)
                end = len(self.s) if nl < 0 else nl
                line = self.s[self.i:end]
                self.i = end + 1
                if (line.lstrip("\t") if tabs else line) == delim:
                    break
        self.docs = []

    def words(self, closer):
        """Commands until `closer` (consumed) or the end of the text."""
        cmd, buf, known, drop = [], None, True, False

        def add(text):
            nonlocal buf
            buf = (buf or []) + [text]

        def end_word():
            nonlocal buf, known, drop
            if buf is not None:
                if drop:
                    drop = False
                else:
                    cmd.append("".join(buf) if known else None)
            buf, known = None, True

        def end_cmd():
            nonlocal cmd
            end_word()
            if cmd:
                self.out.append(cmd)
            cmd = []

        while self.i < len(self.s):
            c = self.s[self.i]
            if c in " \t":
                end_word()
                self.i += 1
            elif c == "\n":
                end_cmd()
                self.i += 1
                self.heredocs()
            elif c == "#" and buf is None:
                nl = self.s.find("\n", self.i)
                self.i = len(self.s) if nl < 0 else nl
            elif c == "&" and self.at(1) == ">":
                end_word()
                self.i += 1
            elif c in ";&|":
                end_cmd()
                self.i += 1
            elif c == "(":
                end_cmd()
                self.i += 1
                self.sub()
            elif c == ")":
                end_cmd()
                self.i += 1
                if closer == ")":
                    return
            elif c in "<>":
                if buf is not None and known and "".join(buf).isdigit():
                    buf = None
                end_word()
                drop = self.redirect()
            elif c == "\\":
                if self.at(1) != "\n":
                    add(self.at(1))
                self.i += 2
            elif c == "'":
                end = self.s.find("'", self.i + 1)
                add(self.s[self.i + 1:] if end < 0 else self.s[self.i + 1:end])
                known = known and end >= 0
                self.i = len(self.s) if end < 0 else end + 1
            elif c == '"':
                self.i += 1
                known = self.dquote(add) and known
            elif c == "`":
                add("")
                known = False
                self.backtick()
            elif c == "$":
                known = self.dollar(add) and known
                if buf is None:
                    add("")
            elif c == "~" and buf is None and (not self.at(1) or self.at(1) in "/ \t\n;&|)"):
                add(os.path.expanduser("~"))
                self.i += 1
            else:
                add(c)
                self.i += 1
        end_cmd()


# ---- what the command does ----------------------------------------------------------------------------------------

def step(cwd, word):
    """A directory from `cwd` by `word`; None when either cannot be read."""
    if word is None or (cwd is None and not os.path.isabs(word)):
        return None
    return os.path.normpath(os.path.join(cwd or "", word))


def cd_to(cwd, argv):
    args = [a for a in argv[1:] if a is None or a == "-" or not a.startswith("-")]
    if not args:
        return os.path.expanduser("~")
    return None if args[0] == "-" else step(cwd, args[0])


def command_of(words):
    """(argv, moved): a simple command less its leading keywords, assignments and wrappers; moved when an assignment
    moves git's repo."""
    i, moved = 0, False
    while i < len(words):
        w = words[i]
        m = ASSIGN_RE.match(w) if w else None
        if w in LEADERS or w in WRAPPERS:
            i += 1
        elif m:
            moved = moved or m.group(1) in REPO_ENV
            i += 1
        else:
            break
    return words[i:], moved


def flags_of(args):
    """The readable words before a `--`."""
    return [a for a in (args[:args.index("--")] if "--" in args else args) if a]


def git_op(argv, cwd):
    """(directory, verb, args) for a git call that makes a commit or may move HEAD, else None."""
    here, i = cwd, 1
    while i < len(argv):
        w = argv[i]
        if w is None:
            return None
        if w == "-C":
            here = step(here, argv[i + 1] if i + 1 < len(argv) else None)
            i += 2
        elif w.split("=", 1)[0] in REPO_FLAGS:
            return None
        elif w in GIT_VALUE_FLAGS:
            i += 2
        elif w.startswith("-"):
            i += 1
        else:
            break
    if i >= len(argv):
        return None
    verb, args = argv[i], argv[i + 1:]
    if verb in SWITCHERS:
        return here, verb, args
    if verb in SPARED and not any(f.split("=", 1)[0] in SPARED[verb] for f in flags_of(args)):
        return here, verb, args
    return None


def plan(events, cwd):
    """The git calls that matter, in order, each with the directory it runs in."""
    ops, stack = [], []
    for ev in events:
        if ev == "(":
            stack.append(cwd)
        elif ev == ")":
            if stack:
                cwd = stack.pop()
        else:
            argv, moved = command_of(ev)
            head = argv[0] if argv else None
            if head in ("cd", "pushd"):
                cwd = cd_to(cwd, argv)
            elif head == "popd":
                cwd = None
            elif head and not moved and os.path.basename(head) == "git":
                op = git_op(argv, cwd)
                if op:
                    ops.append(op)
    return ops


# ---- the judgement ------------------------------------------------------------------------------------------------

def load_engine():
    import importlib.util
    sys.dont_write_bytecode = True
    spec = importlib.util.spec_from_file_location("thread_engine_snapshot", ENGINE)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def default_branch(eng, primary):
    head = eng.git_out(primary, "symbolic-ref", "-q", "refs/remotes/origin/HEAD", timeout=GIT_TIMEOUT)
    if head:
        return head.replace("refs/remotes/origin/", "", 1)
    rc, out, _ = eng.run_group(["bash", os.path.join(ROOT, eng.DEFAULT_BRANCH_REL), primary], eng.remote_env(primary),
                               REMOTE_TIMEOUT)
    return out.strip() if rc == 0 else ""


def switched(eng, primary, verb, args):
    """The branch HEAD holds after a checkout or switch in the Primary: a name, "" for none that can be named, None
    when the call moves nothing."""
    if verb == "checkout" and "--" in args:
        return None
    for i, a in enumerate(args):
        if a is None:
            return ""
        if a in CREATE_FLAGS[verb]:
            return (args[i + 1] if i + 1 < len(args) else "") or ""
        if a in ("--detach", "-d", "-"):
            return ""
        if a.startswith("-"):
            continue
        for prefix in ("refs/heads/", "refs/remotes/origin/"):   # a branch on origin alone: git creates it, named a
            if eng.git(primary, "show-ref", "--verify", "-q", prefix + a, timeout=GIT_TIMEOUT).returncode == 0:
                return a
        if verb == "switch" or eng.git(primary, "rev-parse", "--verify", "-q", a + "^{commit}",
                                       timeout=GIT_TIMEOUT).returncode == 0:
            return ""
        return None
    return None


def rebase_names(args):
    """The branch a `git rebase` names: a name, "" when it cannot be read, None when it names none."""
    positional, skip = [], False
    for a in args[:args.index("--")] if "--" in args else args:
        if skip:
            skip = False
        elif a in REBASE_VALUE_FLAGS:
            skip = True
        elif a is None or not a.startswith("-"):
            positional.append(a)
    at = 0 if "--root" in args else 1
    if len(positional) <= at:
        return None
    return positional[at] or ""


def refusal(ops, eng):
    """The refusal text for the first call that would commit on the Primary's default branch, else None."""
    primary = eng.git_primary()[0]
    if not primary:
        return None
    tops, branch, default = {}, None, None
    for d, verb, args in ops:
        if d is None:
            continue
        if d not in tops:
            top = eng.git_out(d, "rev-parse", "--show-toplevel", timeout=GIT_TIMEOUT)
            tops[d] = eng.real(top) if top else None
        if tops[d] != primary:
            continue
        if verb in SWITCHERS:
            after = switched(eng, primary, verb, args)
            branch = branch if after is None else after
            continue
        if default is None:
            default = default_branch(eng, primary)
            if not default:
                return None
        named = rebase_names(args) if verb == "rebase" else None
        if named is not None:
            branch = named
        if branch is None:
            branch = eng.git_out(primary, "symbolic-ref", "--short", "-q", "HEAD", timeout=GIT_TIMEOUT) or ""
        if branch == default:
            return ("Refused (ADR 0078 d3, hooks/primary-commit-guard.py): `git %s` would make a commit on `%s` in the "
                    "Primary checkout %s, the copy every session loads the plugin from. Nothing commits there: it only "
                    "fast-forwards. Do this on a branch or in a worktree (`git switch -c <name>`, `git worktree add`) "
                    "and land it by PR; a close-out's paths go through %s."
                    % (verb, default, primary, os.path.join(ROOT, "skills", "_shared", "scripts", "land.sh")))
    return None


def decide(raw):
    payload = json.loads(raw)
    if payload.get("tool_name") != "Bash":
        return None
    command = payload.get("tool_input", {}).get("command")
    if not isinstance(command, str) or "git" not in command:
        return None
    cwd = payload.get("cwd")
    scan = Scan(command)
    scan.words(None)
    ops = plan(scan.out, cwd if isinstance(cwd, str) and os.path.isabs(cwd) else None)
    if all(verb in SWITCHERS for _, verb, _ in ops):
        return None
    why = refusal(ops, load_engine())
    if not why:
        return None
    return json.dumps({"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny",
                                              "permissionDecisionReason": why}})


def main():
    out = None
    try:
        sys.stderr = open(os.devnull, "w")   # left so to the exit: nothing ever reaches stderr
        out = decide(sys.stdin.read())
    except Exception:  # noqa: BLE001 — the hook refuses only on positive evidence, and never speaks on stderr
        out = None
    if out:
        try:
            sys.stdout.write(out + "\n")
            sys.stdout.flush()
        except Exception:  # noqa: BLE001
            pass


if __name__ == "__main__":
    main()
