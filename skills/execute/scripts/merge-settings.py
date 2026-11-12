#!/usr/bin/env python3
"""merge-settings.py — a stuck rollout changes its repo's merge settings, logged with its undo (ADR 0080, p47-9).

    python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/merge-settings.py free --note <task note> --repo <repoPath>
        [--gh-bin gh] [--now <stamp>] [--tasks-dir <dir>]
    python3 … merge-settings.py restore --note <task note> --id <id> [--gh-bin gh] [--now <stamp>] [--tasks-dir <dir>]
    python3 … merge-settings.py dismiss --note <task note> --id <id> [--now <stamp>] [--tasks-dir <dir>]
    python3 … merge-settings.py rows (--tasks-dir <dir> [--rollout <slug>] | --note <task note>) [--unrestored]

The one script that changes a repo's merge settings (ADR 0080 d4): the lead (execute § 4.5 step 1.2's *Settings
repair*), /thread:repair's **settings block** row and the Companion's Upkeep (through /thread:repair) run it, each under
its one lock per origin. No other script or prompt names a call that writes a branch protection or a ruleset
(tests/contracts/merge-settings-guard.test.mjs: its writes live in WRITES and _write_argv alone). This header is the
one copy of its rules; reconcile-rollout.py's MERGE_SETTINGS_SECTION comment holds the `## Merge settings` row grammar.

Runtime: python >= 3.8, the stdlib, and PyYAML when it can be imported (merge-gate.py's pattern: an unreported-context
block reads workflows, so without PyYAML it is left). It loads by path reconcile-rollout.py (the rows, Note,
_settings_block), lead-integrate.py (the verdict, last_integration), skills/_shared/scripts/merge-gate.py (Tree,
_list_workflows, _match, MAX_WORKFLOW_BYTES, its git_env and YAML loader) and run_record.py (through reconcile-rollout).
Every gh call is `gh api …` in its own process group with git_env() plus GH_PROMPT_DISABLED=1 and
GH_NO_UPDATE_NOTIFIER=1, bounded by GH_TIMEOUT (20 s; the whole group is killed on expiry). Its HTTP code is read from
gh's `(HTTP nnn)` text; a timeout, a 5xx or no code at all is transient, any 4xx definitive.

The origin is remote.origin.url as configured (git config, never the insteadOf-expanded URL), in one of the three
GitHub forms land.sh reads (https://github.com/<o>/<r>, git@github.com:<o>/<r>, ssh://git@github.com/<o>/<r>, `.git`
dropped). Anything else is no GitHub origin.

A settings block is reconcile-rollout.py _settings_block's: a task set aside at Integration whose latest block opens
`no-runner:` (a required check no runner will take) or `unreported-context:` (a required context no job reports on
the PR's head). Only the contexts list of a rule is ever edited: `strict` and a ruleset's up-to-date policy are copied
(ADR 0078), and a rule that can still be met is never loosened (ADR 0080 d2).

`free`, in order:
  1. The Engine snapshot guard (ADR 0043): a wrong root exits 2 with its `engine-snapshot:` line.
  2. The note; unreadable: exit 2.
  3. No settings block (a red required check, reasonClass merge-gate, is none): exit 5, no gh call, no row.
  4. Idempotence, with no gh call: a block reading `changed` prints its row and exits 0; `left`, exits 3.
  5. Due: lead-integrate.py's verdict's `settingsBlock`. `due` false: exit 5 (before the settings point a rule can
     still be met: a sleeping runner gets its cool-down retry first), no row. `freeNow` false (a try's
     SETTINGS_RETRY_MIN wait): exit 75, no row: the `tried` row's retry is the wait.
  6. The Run record (ADR 0080 d4): the task's latest `set-aside` line must carry reasonClass = the block's kind and
     setAsideAt integration; else `left` (not-recorded), no gh call.
  7. The environment: gh missing, no GitHub origin, or, for unreported-context, PyYAML missing or an Integration log
     last line with no 40-hex `head=` and `base=`: `left` (unreadable).
  8. The lock, `<note lock dir>/merge-settings-<owner>-<repo>.lock`, polled LOCK_WAIT_S (60 s): not taken is a
     `tried` row (busy), exit 75. Under it the note is read again and step 4 repeated, so a racing caller's row gives
     its exit with no write; a dangling `changing` row of this block is resolved after the reads (live = its after:
     `changed`, no second write; live = its before: `void`, and the write runs again; neither: `void`, then `left`).
  9. The reads: repos/<o>/<r>, user, and for an Organization owner user/memberships/orgs/<org>. Owned is the viewer
     owning the repo, or an active admin membership of its org; else `left` (not-owned). permissions.admin false:
     `left` (no-rights). Then branches/<b>/protection/required_status_checks (a 404 is no classic source),
     rules/branches/<b>?per_page=100 (a 403 naming the plan is no rulesets; 100 or more rules `left` unreadable), and
     rulesets/<id> for each ruleset whose required_status_checks rule names one of the block's contexts (an
     Organization ruleset: `left`, no-change, edit it at the org). <b> is the repo's default branch, percent-encoded.
 10. The decision (below). `left` and `cleared` write nothing to GitHub.
 11. Every Run-record line is checked first (run_record.check): a refusal, MAX_LINE among them, is `left` (no-change,
     `undo too large to record`), no write.
 12. One `changing` row per source, saved before any write: the undo is on the note before the setting moves.
 13. One write per source, then a read-back: equal to its after: `changed`, and a `setting-changed` line; a 403 or
     404: `void`, then `left` (no-rights, gh's text); a transient write that reads back as before: `void`, then
     `tried`; anything else: `void` when live reads as before, then `left` (`write did not take`).
 14. Its events are emitted before the lock is released, so the next caller reads them.
A transient read or fetch writes a `tried` row and exits 8. The SETTINGS_TRIES_MAX-th try of one block (busy or
transient) writes `left` (unreadable) instead.

The decision. First, cleared: when no source requires any of the block's contexts and this rollout's Run record holds
a `setting-changed` line for this repo and branch that removed or replaced one of them (another task's change), a
`cleared <fp>` row, exit 0, no write and no event (its one re-entry meets the freed block); with no such line,
`left` (no-change). Otherwise each context C still required decides, and any `left` leaves the whole block:
  - An app: a source's app_id (classic) or integration_id (ruleset) of ACTIONS_APP_ID (15368) or none acts; any other
    app's check is `left` (no-change, `another app's check`).
  - no-runner: C is removed from every source naming it.
  - unreported-context, with B = origin/<b> after `git fetch origin <b>`, and Hb, H = the `base=` and `head=` of the
    note's `## Integration log` last line (the pair merge-task ran: a lead-written set-aside adds no log line). H is
    fetched from refs/pull/<N>/head when it is not local (absent after that: `left`). Each fetch is bounded to 60 s;
    a failed one is transient.
    * Expansion, GitHub's names for a workflow's jobs at a rev (every rev the decision reads): each job identity (its
      file, through renames, and its job id) gives (combination, exact name) pairs, or goes to U, the unresolvable:
      - a workflow gap (missing, unparseable, over MAX_WORKFLOW_BYTES) or a listing past MAX_WORKFLOWS at any rev it
        reads: `left` (unreadable) at once;
      - combinations: none without strategy.matrix (one empty combination); a matrix is a map whose keys other than
        include and exclude each hold a non-empty list of strings or integers (never a bool: PyYAML reads YAML 1.1,
        so `on`, `yes` and 3.10 may not be GitHub's values); their product, keys in document order, values in list
        order; `exclude`, a list of maps from matrix keys to strings or integers, drops each combination matching
        every key of any row (GitHub's partial match). Any `include` row, more than MAX_COMBINATIONS (256), none left
        after exclude, or any other shape (an expression or fromJSON matrix; a float, null, list or map value; an
        exclude row naming another key) goes to U;
      - names: no `name:` is `<id>`, or `<id> (<v1>, <v2>…)` with a matrix, values in key order; a literal `name:`
        (no `${{`) is itself, or `<name> (<v1>, <v2>…)` with a matrix (GitHub appends the values to a matrix job whose
        name holds no expression); a `name:` whose every expression is `${{ matrix.<k> }}` for a key of its matrix is
        filled, with no suffix; any other expression, a non-string `name:`, a job-level `uses:` (its contexts read
        `a / b`), or a job of a workflow only `workflow_call` triggers (it never reports a plain name), goes to U.
      E(rev) is the set of exact names.
    * C still met: C in E(H) is `left` (a path-filtered or conditional job still named C at the PR's head). merge-gate's
      _match(C, U(rev)), at H or any rev the step below reads, hitting an unresolvable identity is `left` (`cannot be
      expanded`): _match is read only over U and only to leave, so its suffix strip and wildcard never decide that a
      resolvable job still reports C.
    * C in E(Hb): the task's own PR dropped it. Its identity is paired Hb -> H: a rename replaces C with C' (through the
      rename gate); a deletion is `left` (dropping a required job is his call, ADR 0025, ADR 0080 d2); anything else
      is `left` (ambiguous).
    * Else C in E(B): origin/<b> names C since the integration, so the re-entry's `prepare` re-integrates on B and
      that head reports it: `cleared`, no write (with other contexts changed, nothing for this one).
    * Else C left master's workflows. A `setting-changed` line of this rollout on this repo and branch whose
      newContext is C is `left` (required since that task's own rename, which has not reached <b>). Otherwise
      `git log --first-parent -n HISTORY_MAX --find-renames B -- .github/workflows/`, newest first, to the newest
      commit X with C in E(X^) and C not in E(X): a rename pairs X^ -> X and follows C' forward through each later
      walked commit, by the same pairing, to its name at B (a step that loses it is `left`), then the rename gate; a
      deletion (the identity gone at X, and X adds no job identity anywhere) removes C. No such X, or anything else (a
      dropped matrix combination included), is `left`.
    * Pairing, Hb -> H and X^ -> X alike: an identity follows a file rename (`git diff -M --name-status`) and a job id
      rename (the change removes exactly one job id from that file and adds exactly one). With the same combination
      set at both revs, C' is the later name of C's combinations, which must all share one name; with the sets
      differing, C' is defined only when exactly one combination left (C's only) and exactly one arrived. Anything
      else is ambiguous.
    * The rename gate, for every rename-derived edit: commits/<H>/check-runs?check_name=<C'> must hold a run by
      ACTIONS_APP_ID whose latest concluded `success`; else `left` (`<C'> has not passed on the PR's head`). So an
      expansion that named C' wrongly finds no run under that exact name and is never written.
    * The edit: C is replaced by C' at its position, keeping its app_id or integration_id; a source that already
      requires C' has C removed instead.
  - A ruleset edit that would empty its required_status_checks list is `left`: dropping the rule would drop its
    up-to-date policy too (ADR 0078). The last classic context is a write of no checks, strict kept.

The writes (WRITES, rendered by _write_argv, the one place a write's method and its stdin body are spelled): the
classic source's required_status_checks, whose body is {strict, checks: [{context, app_id}]} (never `contexts`; a
GET's null app_id is written -1, GitHub's "any app": an omitted key would let GitHub pick the app that last reported,
another rule), and a ruleset by id, whose body is {rules: [...]} holding every rule of the GET in order, each {type}
plus `parameters` only when the GET's rule carries an object there (so a deletion or non_fast_forward rule never gains
the key), only the required_status_checks rule's checks edited (a null integration_id dropped, a set one kept). Each
row's undo is _undo_text: the before body piped to the same _write_argv call, so the write and its undo cannot drift.
Comparisons read -1 and a null app_id as one value.

Exits of `free`: 0 changed or cleared, now or already; 3 left, now or already; 5 not due, or no settings block (no gh
call, no row: nothing waits on `free`); 8 transient, with a `tried` row; 75 busy (a `tried` row) or a try's retry not
reached (no row); 2 usage, a wrong root, or a note that cannot be read or saved.

`restore --id X` (guarded, under the lock, on Lachy's word only: /thread:repair 3i): ownership and rights read again,
then the live setting of X's source: equal to X's after, its stored before is written through _write_argv, read back,
and `restored X` appended with a `setting-restored` line (exit 0); any other live setting is drift: exit 3, X's undo
printed, nothing written. `dismiss --id X` (guarded): `dismissed X` and a `setting-dismissed` line; the
`setting-changed` line stays. Both exit 0 when X already is. `rows` (read-only, never guarded): one JSON line, {rows:
[…]}, every open `changed` row (neither restored nor dismissed) and every dangling `changing` row (`unconfirmed`), each
with its task, change, before, after and undo; --unrestored adds dismissed ones. `cleared` and `void` rows are never
listed.
"""
import argparse
import importlib.util
import itertools
import json
import os
import re
import secrets
import shlex
import shutil
import signal
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path
from urllib.parse import quote

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent.parent

try:
    import fcntl
except ImportError:   # no fcntl (Windows): no lock
    fcntl = None


def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, str(path))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


LEAD = _load("thread_lead_integrate_ms", HERE / "lead-integrate.py")
rr = LEAD.rr
MG = _load("thread_merge_gate_ms", ROOT / "skills" / "_shared" / "scripts" / "merge-gate.py")

ACTIONS_APP_ID = MG.ACTIONS_APP_ID
GH_TIMEOUT = 20
FETCH_TIMEOUT = 60
LOCK_WAIT_S = 60
LOCK_WAIT_ENV = "THREAD_MERGE_SETTINGS_LOCK_S"   # tests only: shortens the lock's poll; it never lengthens it
MAX_COMBINATIONS = 256
HISTORY_MAX = 50
MAX_RULES = 100
SCRIPT_REL = "skills/execute/scripts/merge-settings.py"
SHA40 = re.compile(r"[0-9a-f]{40}\Z")
HTTP_RE = re.compile(r"\(HTTP (\d{3})\)|\bHTTP (\d{3})\b")
MATRIX_EXPR = re.compile(r"\$\{\{\s*matrix\.([A-Za-z_][A-Za-z0-9_-]*)\s*\}\}")
GITHUB_URL_RE = re.compile(r"^(?:https://github\.com/|git@github\.com:|ssh://git@github\.com/)([^/\s]+)/([^/\s]+?)(?:\.git)?/*$")

# The one write table (ADR 0080 d4): each source's method and endpoint. _write_argv renders a write and its undo from it.
WRITES = {"protection": ("PATCH", "repos/{repo}/branches/{branch}/protection/required_status_checks"),
          "ruleset": ("PUT", "repos/{repo}/rulesets/{id}")}


def _write_argv(source, **where):
    """gh's argv (after `gh`) for one write of `source`, its body on stdin: the only place a write is spelled."""
    method, template = WRITES[source]
    return ["api", "--method", method, template.format(**where), "--input", "-"]


def _canon(body):
    return json.dumps(body, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def _undo_text(source, before, **where):
    """The one command that writes `before` back: its body piped to the same _write_argv call as the change."""
    return "printf '%s' " + shlex.quote(_canon(before)) + " | gh " + " ".join(map(shlex.quote, _write_argv(source, **where)))


def _where(source, repo, branch, rid=None):
    return {"repo": repo, "branch": quote(branch, safe="")} if source == "protection" else {"repo": repo, "id": rid}


class Leave(Exception):
    def __init__(self, cause, why):
        super().__init__(why)
        self.cause, self.why = cause, why


class Transient(Exception):
    pass


class Usage(Exception):
    pass


# ---- gh and git ----------------------------------------------------------------------------------------------------

def _env():
    env = dict(MG.ES.git_env())
    env["GH_PROMPT_DISABLED"] = "1"
    env["GH_NO_UPDATE_NOTIFIER"] = "1"
    return env


def _gh(gh_bin, argv, body=None):
    """(rc, http code | None, stdout, stderr text) of one gh call in its own process group, bounded by GH_TIMEOUT. rc
    None: gh would not start or timed out (stderr says which)."""
    try:
        p = subprocess.Popen([gh_bin] + list(argv), stdin=subprocess.PIPE if body is not None else subprocess.DEVNULL,
                             stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=_env(), start_new_session=True)
    except OSError as e:
        return None, None, "", "gh will not start: %s" % (e.strerror or e)
    try:
        out, err = p.communicate(input=body.encode("utf-8") if body is not None else None, timeout=GH_TIMEOUT)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(p.pid, signal.SIGKILL)
        except OSError:
            pass
        for f in (p.stdin, p.stdout, p.stderr):
            try:
                if f is not None:
                    f.close()
            except OSError:
                pass
        p.wait()
        return None, None, "", "gh api timed out after %ss" % GH_TIMEOUT
    err_text = err.decode("utf-8", "replace")
    m = HTTP_RE.search(err_text)
    code = int(m.group(1) or m.group(2)) if m else (200 if p.returncode == 0 else None)
    return p.returncode, code, out.decode("utf-8", "replace"), err_text


def _first_line(text):
    return next((l.strip() for l in (text or "").splitlines() if l.strip()), "")


def _get(gh_bin, endpoint):
    """('ok', data) | ('http', code, text): one GET; a timeout, a 5xx or no HTTP code raises Transient."""
    rc, code, out, err = _gh(gh_bin, ["api", endpoint])
    if rc == 0:
        try:
            return "ok", json.loads(out)
        except ValueError:
            raise Transient("%s: gh exited 0 with no JSON" % endpoint)
    text = _first_line(err) or "gh exited %s" % rc
    if code is None or code >= 500:
        raise Transient("%s: %s" % (endpoint, text))
    return "http", code, text


def _git(top, *args, timeout=FETCH_TIMEOUT):
    """(rc, stdout text, stderr text) of a git call in `top` under git_env(), bounded."""
    try:
        p = subprocess.run(["git", "-C", str(top)] + list(args), env=MG.ES.git_env(), stdin=subprocess.DEVNULL,
                           capture_output=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        return 124, "", "timed out after %ss" % timeout
    except OSError as e:
        return 127, "", str(e.strerror or e)
    return p.returncode, p.stdout.decode("utf-8", "replace"), p.stderr.decode("utf-8", "replace")


def _origin(repo):
    """The <owner>/<repo> of remote.origin.url as configured, in a GitHub form, else None."""
    rc, out, _err = _git(repo, "config", "--get", "remote.origin.url", timeout=20)
    m = GITHUB_URL_RE.match(out.strip()) if rc == 0 else None
    return "%s/%s" % (m.group(1), m.group(2)) if m else None


# ---- the lock ------------------------------------------------------------------------------------------------------

class SettingsLock:
    """The per-origin merge-settings lock (outermost: note locks and the Run record's flock go inside it)."""

    def __init__(self, repo_slug):
        self.path = rr._note_lock_dir() / ("merge-settings-%s.lock" % repo_slug.replace("/", "-"))
        self.fh, self.ok = None, False

    def __enter__(self):
        if fcntl is None:
            self.ok = True
            return self
        try:
            wait = min(LOCK_WAIT_S, float(os.environ.get(LOCK_WAIT_ENV) or LOCK_WAIT_S))
        except ValueError:
            wait = LOCK_WAIT_S
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.fh = open(self.path, "a")
        deadline = time.monotonic() + wait
        while True:
            try:
                fcntl.flock(self.fh, fcntl.LOCK_EX | fcntl.LOCK_NB)
                self.ok = True
                return self
            except BlockingIOError:
                if time.monotonic() >= deadline:
                    return self
                time.sleep(0.1)

    def __exit__(self, *exc):
        if self.fh is not None:
            self.fh.close()
        return False


# ---- the bodies ----------------------------------------------------------------------------------------------------

def _app(v):
    """An app id as one value: -1 and None both read as None (any app)."""
    return None if v is None or v == -1 else v


def _classic_body(rsc):
    """The classic source's write body from its GET: {strict, checks: [{context, app_id}]}, a null app_id as -1."""
    checks = rsc.get("checks")
    if not isinstance(checks, list):
        checks = [{"context": c, "app_id": None} for c in rsc.get("contexts") or [] if isinstance(c, str)]
    out = []
    for c in checks:
        if not isinstance(c, dict) or not isinstance(c.get("context"), str):
            raise Leave("unreadable", "branch protection's required checks hold an entry with no context")
        app = c.get("app_id")
        out.append({"context": c["context"], "app_id": -1 if app is None else app})
    if not isinstance(rsc.get("strict"), bool):
        raise Leave("unreadable", "branch protection's required checks carry no strict flag")
    return {"strict": rsc["strict"], "checks": out}


def _rules_body(rules):
    """A ruleset's write body from its GET's rules, in order: each {type}, plus `parameters` only when the GET carries
    an object there; within the required_status_checks rule's checks a null integration_id is dropped."""
    out = []
    for r in rules:
        if not isinstance(r, dict) or not isinstance(r.get("type"), str):
            raise Leave("unreadable", "a ruleset rule with no type")
        item = {"type": r["type"]}
        if isinstance(r.get("parameters"), dict):
            params = json.loads(json.dumps(r["parameters"]))
            if r["type"] == "required_status_checks":
                checks = []
                for c in params.get("required_status_checks") or []:
                    if not isinstance(c, dict) or not isinstance(c.get("context"), str):
                        raise Leave("unreadable", "a ruleset's required check with no context")
                    c = dict(c)
                    if c.get("integration_id") is None:
                        c.pop("integration_id", None)
                    checks.append(c)
                params["required_status_checks"] = checks
            item["parameters"] = params
        out.append(item)
    return {"rules": out}


def _same(a, b):
    """Two bodies read alike: a classic app_id of -1 and null are one value."""
    def norm(x):
        if isinstance(x, dict) and "checks" in x and "strict" in x:
            return {"strict": x["strict"], "checks": [{"context": c["context"], "app_id": _app(c.get("app_id"))}
                                                      for c in x["checks"]]}
        return x
    return _canon(norm(a)) == _canon(norm(b))


def _source_checks(source, body):
    """[(context, app)] a body requires."""
    if source == "protection":
        return [(c["context"], _app(c.get("app_id"))) for c in body["checks"]]
    out = []
    for r in body["rules"]:
        if r["type"] == "required_status_checks":
            for c in (r.get("parameters") or {}).get("required_status_checks") or []:
                out.append((c["context"], _app(c.get("integration_id"))))
    return out


def _edit(source, body, changes):
    """`body` with each (C, C' | None) applied at its position: C' None removes C; a C' the body already requires
    removes C too. Returns (after, [(C, C' | None) as applied])."""
    after = json.loads(json.dumps(body))
    applied = []

    def apply(lst):
        names = {c["context"] for c in lst}
        out = []
        for c in lst:
            hit = next((x for x in changes if x[0] == c["context"]), None)
            if hit is None:
                out.append(c)
                continue
            new = hit[1]
            if new is None or new in names:
                applied.append((hit[0], None))
                continue
            applied.append(hit)
            out.append(dict(c, context=new))
        return out
    if source == "protection":
        after["checks"] = apply(after["checks"])
    else:
        for r in after["rules"]:
            if r["type"] == "required_status_checks":
                params = r.setdefault("parameters", {})
                params["required_status_checks"] = apply(params.get("required_status_checks") or [])
                if not params["required_status_checks"]:
                    raise Leave("no-change", "removing it would empty a ruleset's required checks: dropping the rule "
                                             "would drop its up-to-date policy too (ADR 0078)")
    return after, list(dict.fromkeys(applied))


# ---- the workflow expansion -----------------------------------------------------------------------------------------

def _val(v):
    return v if isinstance(v, str) else str(v)


def _scalar_ok(v):
    return (isinstance(v, str) or (isinstance(v, int) and not isinstance(v, bool)))


def _expand(jid, job, callee_only):
    """[(combination, name)] for one job identity, or None (U). A combination is a tuple of (key, value)."""
    if callee_only or job.get("uses") is not None:
        return None
    name = job.get("name")
    if name is not None and not isinstance(name, str):
        return None
    strategy = job.get("strategy")
    if strategy is not None and not isinstance(strategy, dict):
        return None
    matrix = strategy.get("matrix") if isinstance(strategy, dict) else None
    if matrix is None:
        combos, keys = [()], []
    else:
        if not isinstance(matrix, dict) or "include" in matrix:
            return None
        keys = [k for k in matrix if k not in ("include", "exclude")]
        if not keys or not all(isinstance(k, str) for k in keys):
            return None
        lists = []
        for k in keys:
            vs = matrix[k]
            if not isinstance(vs, list) or not vs or not all(_scalar_ok(v) for v in vs):
                return None
            lists.append(vs)
        size = 1
        for vs in lists:
            size *= len(vs)
        if size > MAX_COMBINATIONS:
            return None
        combos = [tuple(zip(keys, vals)) for vals in itertools.product(*lists)]
        exclude = matrix.get("exclude")
        if exclude is not None:
            if not isinstance(exclude, list):
                return None
            for row in exclude:
                if not isinstance(row, dict) or not row or not all(k in keys and _scalar_ok(v) for k, v in row.items()):
                    return None
            combos = [c for c in combos
                      if not any(all(_val(dict(c)[k]) == _val(v) for k, v in row.items()) for row in exclude)]
        if not combos:
            return None
    out = []
    for combo in combos:
        values = dict(combo)
        suffix = " (%s)" % ", ".join(_val(v) for _k, v in combo) if matrix is not None else ""
        if name is None:
            out.append((combo, jid + suffix))
        elif "${{" not in name:
            out.append((combo, name + suffix))
        else:
            if "${{" in MATRIX_EXPR.sub("", name) or any(k not in values for k in MATRIX_EXPR.findall(name)):
                return None
            out.append((combo, MATRIX_EXPR.sub(lambda m: _val(values[m.group(1)]), name)))
    return out


class Rev:
    """The expansion of every workflow at one rev: idents {(file, job): [(combo, name)]}, unres [(key, id, job)] (U),
    names {name: [(file, job)]}."""

    def __init__(self, top, rev):
        self.rev = rev
        tree = MG.Tree(str(top), rev)
        why, state = [], {}
        paths = MG._list_workflows(str(top), rev, why, state)
        if paths is None:
            raise Transient("cannot list the workflows at %s: %s" % (rev[:12], "; ".join(why)))
        if state.get("listingCut"):
            raise Leave("unreadable", "the workflows at %s: %s" % (rev[:12], "; ".join(why)))
        self.idents, self.unres, self.names, self.files = {}, [], {}, {}
        for p in paths:
            wf = tree.workflow(p)
            if "gap" in wf:
                raise Leave("unreadable", "%s at %s: %s" % (p, rev[:12], wf["gap"]))
            on = wf.get("on") or {}
            callee_only = bool(on) and set(on) == {"workflow_call"}
            self.files[p] = list(wf["jobs"])
            for jid, job in wf["jobs"].items():
                pairs = _expand(jid, job, callee_only)
                if pairs is None:
                    self.unres.append(((p, jid, None), jid, job))
                    continue
                self.idents[(p, jid)] = pairs
                for _c, n in pairs:
                    self.names.setdefault(n, []).append((p, jid))

    def has(self, name):
        return name in self.names

    def unresolved_hit(self, context):
        hits = MG._match(context, self.unres)
        return hits[0] if hits else None


# ---- the decision ---------------------------------------------------------------------------------------------------

class Decider:
    """The unreported-context decision for one block (the header's rules)."""

    def __init__(self, top, gh_bin, slug, branch, base_rev, head_rev, pr_n):
        self.top, self.gh_bin, self.slug, self.branch = top, gh_bin, slug, branch
        self.hb, self.h, self.pr_n = base_rev, head_rev, pr_n
        self.revs = {}
        self.b = None

    def rev(self, sha):
        if sha not in self.revs:
            self.revs[sha] = Rev(self.top, sha)
        return self.revs[sha]

    def fetch(self):
        rc, _o, err = _git(self.top, "fetch", "--quiet", "origin",
                           "+refs/heads/%s:refs/remotes/origin/%s" % (self.branch, self.branch))
        if rc != 0:
            raise Transient("git fetch origin %s: %s" % (self.branch, _first_line(err) or "exit %d" % rc))
        rc, out, _e = _git(self.top, "rev-parse", "--verify", "-q", "refs/remotes/origin/%s^{commit}" % self.branch)
        if rc != 0 or not SHA40.match(out.strip()):
            raise Transient("origin/%s: unreadable after the fetch" % self.branch)
        self.b = out.strip()
        for sha in (self.h, self.hb):
            if _git(self.top, "cat-file", "-e", sha + "^{commit}")[0] == 0:
                continue
            if self.pr_n:
                rc, _o, err = _git(self.top, "fetch", "--quiet", "origin", "refs/pull/%s/head" % self.pr_n)
                if rc != 0 and "couldn't find remote ref" not in err:
                    raise Transient("git fetch origin refs/pull/%s/head: %s" % (self.pr_n, _first_line(err) or rc))
            if _git(self.top, "cat-file", "-e", sha + "^{commit}")[0] != 0:
                raise Leave("unreadable", "integrated %s %s not on origin" %
                            ("head" if sha == self.h else "base", sha[:12]))

    def met(self, c, revs):
        """Leave when C can still be met: an exact name at H, or an unresolvable identity _match hits at any rev."""
        if self.rev(self.h).has(c):
            raise Leave("no-change", "a path-filtered or conditional job still named %s at the PR's head" % json.dumps(c))
        for sha in revs:
            hit = self.rev(sha).unresolved_hit(c)
            if hit is not None:
                raise Leave("no-change", "job %s in %s cannot be expanded and may report %s" %
                            (hit[1], hit[0][0], json.dumps(c)))

    def renames(self, a, b):
        """{old path: new path} of the workflow files `git diff -M` reads as renamed from a to b."""
        rc, out, err = _git(self.top, "diff", "-M", "--name-status", a, b, "--", ".github/workflows/")
        if rc != 0:
            raise Transient("git diff %s %s: %s" % (a[:12], b[:12], _first_line(err) or rc))
        out_map = {}
        for line in out.splitlines():
            parts = line.split("\t")
            if len(parts) == 3 and parts[0].startswith("R"):
                out_map[parts[1]] = parts[2]
        return out_map

    def pair(self, c, a, b):
        """('rename', C') | ('deleted', None) | ('ambiguous', why) for context C named at rev a, paired to rev b."""
        ra, rb = self.rev(a), self.rev(b)
        owners = ra.names.get(c) or []
        if len(set(owners)) != 1:
            return "ambiguous", "%d job identities are named %s at %s" % (len(set(owners)), json.dumps(c), a[:12])
        f, jid = owners[0]
        moved = self.renames(a, b)
        f2 = moved.get(f, f)
        later_ids = rb.files.get(f2)
        if later_ids is None:
            return "deleted", None
        if jid not in later_ids:
            gone = [j for j in ra.files.get(f, []) if j not in later_ids]
            came = [j for j in later_ids if j not in ra.files.get(f, [])]
            if gone == [jid] and len(came) == 1:
                jid2 = came[0]
            else:
                return ("deleted", None) if not came else ("ambiguous", "job %s in %s: no one-for-one id rename" % (jid, f))
        else:
            jid2 = jid
        if (f2, jid2) not in rb.idents:
            return "ambiguous", "job %s in %s cannot be expanded at %s" % (jid2, f2, b[:12])
        before = ra.idents[(f, jid)]
        after = rb.idents[(f2, jid2)]
        mine = [combo for combo, n in before if n == c]
        set_a, set_b = {combo for combo, _n in before}, {combo for combo, _n in after}
        if set_a == set_b:
            later = {n for combo, n in after if combo in mine}
            if len(later) != 1:
                return "ambiguous", "%s's combinations take %d names at %s" % (json.dumps(c), len(later), b[:12])
            return "rename", later.pop()
        left, arrived = set_a - set_b, set_b - set_a
        if len(left) == 1 and len(arrived) == 1 and set(mine) == left:
            combo = arrived.pop()
            return "rename", next(n for cb, n in after if cb == combo)
        if mine and set(mine) <= left and not arrived:
            return "ambiguous", "a dropped matrix combination of job %s in %s" % (jid, f)
        return "ambiguous", "job %s in %s: %d combinations left and %d arrived" % (jid, f, len(left), len(arrived))

    def adds_identity(self, a, b):
        """Whether rev b adds any job identity over rev a (file renames followed)."""
        moved = self.renames(a, b)
        had = {(moved.get(f, f), j) for f, js in self.rev(a).files.items() for j in js}
        return any((f, j) not in had for f, js in self.rev(b).files.items() for j in js)

    def gate(self, new):
        """The rename gate: C' passed on H by GitHub Actions, or Leave."""
        kind, *rest = _get(self.gh_bin, "repos/%s/commits/%s/check-runs?check_name=%s&per_page=100" %
                           (self.slug, self.h, quote(new, safe="")))
        if kind != "ok":
            raise Leave("unreadable", "check runs of %s on the PR's head: HTTP %s %s" % (json.dumps(new), rest[0], rest[1]))
        runs = [r for r in (rest[0] or {}).get("check_runs") or []
                if isinstance(r, dict) and r.get("name") == new and ((r.get("app") or {}).get("id") == ACTIONS_APP_ID)]
        latest = max(runs, key=lambda r: (str(r.get("completed_at") or r.get("started_at") or ""), r.get("id") or 0),
                     default=None)
        if latest is None or latest.get("status") not in (None, "completed") or latest.get("conclusion") != "success":
            raise Leave("no-change", "%s has not passed on the PR's head" % json.dumps(new))

    def history(self):
        rc, out, err = _git(self.top, "log", "--first-parent", "-n", str(HISTORY_MAX), "--find-renames", "--format=%H",
                            self.b, "--", ".github/workflows/")
        if rc != 0:
            raise Transient("git log %s: %s" % (self.b[:12], _first_line(err) or rc))
        return [l.strip() for l in out.splitlines() if SHA40.match(l.strip())]

    def parent(self, sha):
        rc, out, _e = _git(self.top, "rev-parse", "--verify", "-q", sha + "^1")
        return out.strip() if rc == 0 and SHA40.match(out.strip()) else None

    def decide(self, c, renamed_by):
        """('remove', None) | ('replace', C') | ('cleared', why) for one context, else Leave."""
        self.met(c, [self.h])
        if self.rev(self.hb).has(c):
            self.met(c, [self.hb])
            kind, val = self.pair(c, self.hb, self.h)
            if kind == "rename":
                self.gate(val)
                return "replace", val
            if kind == "deleted":
                raise Leave("no-change", "deleted by this task's own PR: dropping a required job is his call (ADR 0025, "
                                         "ADR 0080 d2)")
            raise Leave("no-change", "the task's own PR dropped it: %s" % val)
        if self.rev(self.b).has(c):
            return "cleared", "origin/%s names it since the integration" % self.branch
        if c in renamed_by:
            raise Leave("no-change", "required since [[%s]]'s own rename, which has not reached %s" %
                        (renamed_by[c], self.branch))
        self.met(c, [self.hb, self.b])
        walked = self.history()
        for i, x in enumerate(walked):
            xp = self.parent(x)
            if xp is None:
                continue
            if not self.rev(xp).has(c) or self.rev(x).has(c):
                continue
            self.met(c, [xp, x])
            kind, val = self.pair(c, xp, x)
            if kind == "deleted":
                if self.adds_identity(xp, x):
                    raise Leave("no-change", "its job went at %s, which adds another job: a move, not a deletion" % x[:12])
                return "remove", None
            if kind != "rename":
                raise Leave("no-change", "it left the workflows at %s: %s" % (x[:12], val))
            name = val
            for y in reversed(walked[:i]):
                yp = self.parent(y)
                if yp is None or not self.rev(yp).has(name):
                    raise Leave("no-change", "%s, its new name, is lost before %s" % (json.dumps(name), y[:12]))
                if self.rev(y).has(name):
                    continue
                k2, v2 = self.pair(name, yp, y)
                if k2 != "rename":
                    raise Leave("no-change", "%s, its new name, is lost at %s" % (json.dumps(name), y[:12]))
                name = v2
            if not self.rev(self.b).has(name):
                raise Leave("no-change", "%s, its new name, is not on origin/%s" % (json.dumps(name), self.branch))
            self.gate(name)
            return "replace", name
        raise Leave("no-change", "no rename or deletion of %s in origin/%s's last %d workflow commits" %
                    (json.dumps(c), self.branch, HISTORY_MAX))


# ---- the note's rows ------------------------------------------------------------------------------------------------

def _stamp(now):
    return rr._settings_stamp(now)


def _save(note):
    note.save()


def _row(note, now, text):
    rr._append_settings_rows(note, ["- %s %s" % (_stamp(now), text)])


def _recorded_lines(rollout):
    try:
        lines, _bad = rr._record_lines(rr._run_record().record_path(rollout))
        return lines
    except Exception:  # noqa: BLE001 — no record reads as no line
        return []


def _changes_of(d):
    """(contexts removed or replaced, contexts added) by one setting-changed line, from its before and after too."""
    gone, added = set(), set()
    if isinstance(d.get("context"), str):
        gone.add(d["context"])
    if isinstance(d.get("newContext"), str):
        added.add(d["newContext"])
    try:
        src = d.get("source")
        b, a = json.loads(d.get("before") or "null"), json.loads(d.get("after") or "null")
        if isinstance(b, dict) and isinstance(a, dict) and src in WRITES:
            bn = {c for c, _app in _source_checks(src, b)}
            an = {c for c, _app in _source_checks(src, a)}
            gone |= bn - an
            added |= an - bn
    except (ValueError, KeyError, TypeError, AttributeError):
        pass
    return gone, added


class Run:
    """One `free` run's state: the note, the block, the writers of its rows and events."""

    def __init__(self, args, path, note, block, now):
        self.args, self.path, self.note, self.block, self.now = args, path, note, block, now
        self.slug = path.stem
        self.rollout = rr._note_rollout(note)
        self.repo = None
        self.emits = []

    def fp(self):
        return self.block["fingerprint"]

    def emit(self, kind, fields):
        if self.rollout:
            rr._event(self.rollout, kind, self.slug.lower(), fields, ts=self.now.isoformat())

    def leave(self, cause, why, rows=()):
        why = " ".join(str(why).split()) or cause
        lines = list(rows) + ["- %s left %s: %s: %s" % (_stamp(self.now), self.fp(), cause, why)]
        self.note = rr.Note(self.path)
        rr._append_settings_rows(self.note, lines)
        _save(self.note)
        self.emit("setting-left", {"repo": self.repo or str(self.args.repo), "block": self.block["kind"],
                                   "cause": cause, "why": why[:2000], "fingerprint": self.fp()})
        print("[[%s]]: left %s: %s" % (self.slug, cause, why))
        return 3

    def tried(self, kind, text, rc):
        text = " ".join(str(text).split())
        if self.block.get("tries", 0) + 1 >= rr.SETTINGS_TRIES_MAX:
            why = ("settings lock busy %d times" % rr.SETTINGS_TRIES_MAX if kind == "busy"
                   else "%s (%d tries)" % (text, rr.SETTINGS_TRIES_MAX))
            return self.leave("unreadable", why)
        self.note = rr.Note(self.path)
        _row(self.note, self.now, "tried %s: %s: %s" % (self.fp(), kind, text))
        _save(self.note)
        print("[[%s]]: tried (%s): %s" % (self.slug, kind, text))
        return rc


def _settled_exit(block, slug):
    """Step 4: the exit of a block a row already settled, or None."""
    if block["state"] == "changed":
        print("[[%s]]: already %s" % (slug, block["row"] or "changed"))
        return 0
    if block["state"] == "left":
        print("[[%s]]: already left: %s: %s" % (slug, block["cause"], block["why"]))
        return 3
    return None


def _recorded(rollout, slug, kind):
    for d in reversed(_recorded_lines(rollout)):
        if d.get("kind") == "set-aside" and d.get("task") == slug.lower():
            return d.get("reasonClass") == kind and d.get("setAsideAt") == "integration"
    return False


def _owned(gh_bin, repo):
    """(owner, branch) of a repo Lachy owns with admin rights, else Leave (or Transient)."""
    kind, *rest = _get(gh_bin, "repos/%s" % repo)
    if kind != "ok":
        raise Leave("unreadable", "repos/%s: HTTP %s %s" % (repo, rest[0], rest[1]))
    data = rest[0] if isinstance(rest[0], dict) else {}
    owner = data.get("owner") or {}
    login, otype, branch = owner.get("login"), owner.get("type"), data.get("default_branch")
    if not isinstance(login, str) or not isinstance(branch, str) or not branch:
        raise Leave("unreadable", "repos/%s: no owner or default branch" % repo)
    kind, *rest = _get(gh_bin, "user")
    viewer = rest[0].get("login") if kind == "ok" and isinstance(rest[0], dict) else None
    if not isinstance(viewer, str) or not viewer:
        raise Leave("unreadable", "user: %s" % ("HTTP %s %s" % (rest[0], rest[1]) if kind != "ok" else "no login"))
    if otype == "Organization":
        kind, *rest = _get(gh_bin, "user/memberships/orgs/%s" % login)
        m = rest[0] if kind == "ok" and isinstance(rest[0], dict) else {}
        if not (m.get("state") == "active" and m.get("role") == "admin"):
            raise Leave("not-owned", "%s is owned by the organisation %s, where %s is no active admin" % (repo, login, viewer))
    elif login.lower() != viewer.lower():
        raise Leave("not-owned", "%s is owned by %s, not by %s" % (repo, login, viewer))
    if not (data.get("permissions") or {}).get("admin"):
        raise Leave("no-rights", "this gh token has no admin rights on %s" % repo)
    return login, branch


def _read_sources(gh_bin, repo, branch, contexts):
    """{key: (source, rid, body)} of every source that may require the contexts: the classic one (key `protection`)
    and each repository ruleset naming one of them (key `ruleset <id>`)."""
    enc = quote(branch, safe="")
    out = {}
    kind, *rest = _get(gh_bin, "repos/%s/branches/%s/protection/required_status_checks" % (repo, enc))
    if kind == "ok":
        out["protection"] = ("protection", None, _classic_body(rest[0] if isinstance(rest[0], dict) else {}))
    elif rest[0] != 404:
        raise Leave("unreadable", "branch protection of %s: HTTP %s %s" % (branch, rest[0], rest[1]))
    kind, *rest = _get(gh_bin, "repos/%s/rules/branches/%s?per_page=%d" % (repo, enc, MAX_RULES))
    if kind == "ok":
        rules = rest[0]
        if not isinstance(rules, list) or len(rules) >= MAX_RULES:
            raise Leave("unreadable", "rules/branches/%s: not a whole list of rules" % branch)
    elif rest[0] == 403 and "Upgrade to GitHub Pro" in rest[1]:
        rules = []
    else:
        raise Leave("unreadable", "rules/branches/%s: HTTP %s %s" % (branch, rest[0], rest[1]))
    ids = []
    for r in rules:
        if not isinstance(r, dict) or r.get("type") != "required_status_checks":
            continue
        names = {c.get("context") for c in ((r.get("parameters") or {}).get("required_status_checks") or [])
                 if isinstance(c, dict)}
        if not names & set(contexts):
            continue
        if r.get("ruleset_source_type") == "Organization":
            raise Leave("no-change", "ruleset %s is the organisation's: edit it at the org" % r.get("ruleset_id"))
        rid = r.get("ruleset_id")
        if not isinstance(rid, int) or isinstance(rid, bool):
            raise Leave("unreadable", "rules/branches/%s: a required-checks rule with no ruleset id" % branch)
        if rid not in ids:
            ids.append(rid)
    for rid in ids:
        kind, *rest = _get(gh_bin, "repos/%s/rulesets/%d" % (repo, rid))
        if kind != "ok" or not isinstance(rest[0], dict) or not isinstance(rest[0].get("rules"), list):
            raise Leave("unreadable", "rulesets/%d: %s" % (rid, "HTTP %s %s" % (rest[0], rest[1]) if kind != "ok"
                                                           else "no rules"))
        out["ruleset %d" % rid] = ("ruleset", rid, _rules_body(rest[0]["rules"]))
    return out


def _live(gh_bin, repo, branch, source, rid):
    """A source's live body, read again (the read-back), or Transient; a source gone reads None."""
    if source == "protection":
        kind, *rest = _get(gh_bin, "repos/%s/branches/%s/protection/required_status_checks" % (repo, quote(branch, safe="")))
        return _classic_body(rest[0]) if kind == "ok" and isinstance(rest[0], dict) else None
    kind, *rest = _get(gh_bin, "repos/%s/rulesets/%d" % (repo, rid))
    return _rules_body(rest[0]["rules"]) if kind == "ok" and isinstance((rest[0] or {}).get("rules"), list) else None


def _write(gh_bin, source, where, body):
    """(rc, code, gh's text) of one write."""
    rc, code, _out, err = _gh(gh_bin, _write_argv(source, **where), body=_canon(body))
    return rc, code, _first_line(err)


# ---- free ------------------------------------------------------------------------------------------------------------

def _verdict(path, note, repo, now):
    ro = LEAD._rollout_note_of(path, note)
    inp = LEAD.task_inputs(path, note, repo=str(repo))
    return LEAD.auto_retry_verdict(path, note, inp, ro, now)


def cmd_free(args):
    now = args.now_dt
    path = Path(os.path.expanduser(args.note))
    try:
        note = rr.Note(path)
    except (OSError, ValueError) as e:
        print("ERROR: merge-settings free: cannot read %s: %s" % (path, e), file=sys.stderr)
        return 2
    slug = path.stem
    block = rr._settings_block(note)
    if block is None:
        print("[[%s]]: no settings block (not set aside at Integration on no-runner or unreported-context): nothing to "
              "free" % slug)
        return 5
    settled = _settled_exit(block, slug)
    if settled is not None:
        return settled
    verdict = _verdict(path, note, args.repo, now)
    sb = verdict.get("settingsBlock") or {}
    if not sb.get("due"):
        print("[[%s]]: not due: %s" % (slug, verdict.get("autoRetryWhy") or "before the settings point"))
        return 5
    if not sb.get("freeNow"):
        print("[[%s]]: a try's retry is not reached: retries at %s" % (slug, verdict.get("autoRetryAfter")))
        return 75
    run = Run(args, path, note, block, now)
    run.repo = _origin(args.repo)
    if not _recorded(run.rollout, slug, block["kind"]):
        return run.leave("not-recorded", "no set-aside line in the Run record of [[%s]] names this %s block at Integration"
                         % (run.rollout, block["kind"]))
    if shutil.which(args.gh_bin) is None:
        return run.leave("unreadable", "gh not found (%s)" % args.gh_bin)
    if run.repo is None:
        return run.leave("unreadable", "no GitHub origin in %s" % args.repo)
    pair = None
    if block["kind"] == "unreported-context":
        if MG.yaml is None:
            return run.leave("unreadable", "PyYAML cannot be imported, so the workflows cannot be read")
        last = LEAD.last_integration(note) or {}
        if not (SHA40.match(last.get("head") or "") and SHA40.match(last.get("base") or "")):
            return run.leave("unreadable", "the Integration log's last line gives no 40-hex head= and base=")
        pr_n = last.get("pr") if re.fullmatch(r"[1-9][0-9]*", last.get("pr") or "") else None
        if pr_n is None:
            m = rr.PR_URL_RE.match(rr._pr(note))
            pr_n = m.group(2) if m else None
        pair = (last["base"], last["head"], pr_n)
    with SettingsLock(run.repo) as lock:
        if not lock.ok:
            return run.tried("busy", "the merge-settings lock of %s is held" % run.repo, 75)
        try:
            run.note = rr.Note(path)
        except (OSError, ValueError) as e:
            print("ERROR: merge-settings free: cannot read %s: %s" % (path, e), file=sys.stderr)
            return 2
        block = rr._settings_block(run.note)
        if block is None:
            print("[[%s]]: no settings block now: nothing to free" % slug)
            return 5
        run.block = block
        settled = _settled_exit(block, slug)
        if settled is not None:
            return settled
        try:
            return _free_locked(run, pair)
        except Leave as e:
            return run.leave(e.cause, e.why)
        except Transient as e:
            return run.tried("transient", str(e), 8)


def _free_locked(run, pair):
    args, block, now = run.args, run.block, run.now
    gh_bin, repo = args.gh_bin, run.repo
    owner, branch = _owned(gh_bin, repo)
    contexts = block["contexts"]
    if not contexts:
        raise Leave("unreadable", "the set-aside reason names no context it could parse")
    sources = _read_sources(gh_bin, repo, branch, contexts)
    pre = []   # rows to write before any decision
    if block["pending"]:
        all_rows = rr._settings_rows(run.note)
        closed = {x["id"] for x in all_rows if x["verb"] in ("changed", "void")}
        for row in [r for r in all_rows if r["verb"] == "changing" and r["fp"] == block["fingerprint"]
                    and r["id"] not in closed]:
            pid = row["id"]
            live = _live(gh_bin, repo, branch, row["source"], int(row["ruleset"]) if row["ruleset"] else None)
            try:
                b, a = json.loads(row["before"] or "null"), json.loads(row["after"] or "null")
            except ValueError:
                b = a = None
            if live is not None and a is not None and _same(live, a):
                run.note = rr.Note(run.path)
                _row(run.note, now, "changed %s" % pid)
                _save(run.note)
                run.emit("setting-changed", _changed_fields(row, block))
                print("[[%s]]: confirmed %s (its write had landed)" % (run.slug, pid))
                return 0
            if live is not None and b is not None and _same(live, b):
                pre.append("- %s void %s: the write did not take; written again" % (_stamp(now), pid))
            else:
                return run.leave("no-change", "the live setting is neither the before nor the after of %s" % pid,
                                 rows=["- %s void %s: the live setting moved since" % (_stamp(now), pid)])
    required = {}
    for key, (source, rid, body) in sources.items():
        for c, app in _source_checks(source, body):
            required.setdefault(c, []).append((key, app))
    live_ctx = [c for c in contexts if c in required]
    lines = [d for d in _recorded_lines(run.rollout) if d.get("kind") == "setting-changed" and d.get("repo") == repo
             and d.get("branch") == branch]
    if not live_ctx:
        if any(c in _changes_of(d)[0] for d in lines for c in contexts):
            return _cleared(run, pre, "another task's change freed it (no source requires %s)" %
                            ", ".join(map(json.dumps, contexts)))
        raise Leave("no-change", "no source requires %s, and no change of this rollout freed it" %
                    ", ".join(map(json.dumps, contexts)))
    for c in live_ctx:
        bad = [app for _k, app in required[c] if app not in (None, ACTIONS_APP_ID)]
        if bad:
            raise Leave("no-change", "another app's check: %s is required from app %s" % (json.dumps(c), bad[0]))
    changes, cleared = [], []
    if block["kind"] == "no-runner":
        changes = [(c, None) for c in live_ctx]
    else:
        renamed_by = {}
        for d in lines:
            for n in _changes_of(d)[1]:
                renamed_by.setdefault(n, d.get("task") or "?")
        dec = Decider(args.repo, gh_bin, repo, branch, pair[0], pair[1], pair[2])
        dec.fetch()
        for c in live_ctx:
            kind, val = dec.decide(c, {k: v for k, v in renamed_by.items() if v != run.slug.lower()})
            if kind == "cleared":
                cleared.append(val)
            else:
                changes.append((c, val))
    if not changes:
        return _cleared(run, pre, "; ".join(dict.fromkeys(cleared)))
    plan = []
    for key, (source, rid, body) in sources.items():
        mine = [x for x in changes if any(k == key for k, _a in required.get(x[0], []))]
        if not mine:
            continue
        after, applied = _edit(source, body, mine)
        where = _where(source, repo, branch, rid)
        plan.append({"key": key, "source": source, "rid": rid, "before": body, "after": after, "applied": applied,
                     "where": where, "id": secrets.token_hex(6)})
    records = []
    for p in plan:
        fields = _plan_fields(p, repo, branch, block)
        try:
            rr._run_record().check(run.rollout, "setting-changed", run.slug.lower(), fields)
        except Exception as e:  # noqa: BLE001 — run_record.Refused, MAX_LINE among them
            raise Leave("no-change", "undo too large to record (%s)" % e)
        records.append(fields)
    rows = list(pre)
    for p in plan:
        rows += ["- %s changing %s %s: %s %s@%s%s: %s" % (_stamp(now), p["id"], block["fingerprint"], p["source"], repo,
                                                         branch, " ruleset %d" % p["rid"] if p["rid"] else "",
                                                         _change_text(p["applied"])),
                 "  %s before: %s" % (p["id"], _canon(p["before"])),
                 "  %s after: %s" % (p["id"], _canon(p["after"])),
                 "  %s undo: %s" % (p["id"], _undo_text(p["source"], p["before"], **p["where"]))]
    run.note = rr.Note(run.path)
    rr._append_settings_rows(run.note, rows)
    _save(run.note)
    out_rows, left = [], None
    for p, fields in zip(plan, records):
        wrc, code, text = _write(gh_bin, p["source"], p["where"], p["after"])
        try:
            live = _live(gh_bin, repo, branch, p["source"], p["rid"])
        except Transient:
            live = None
        if live is not None and _same(live, p["after"]):
            out_rows.append("- %s changed %s" % (_stamp(now), p["id"]))
            run.emits.append(fields)
            continue
        if wrc != 0 and code in (403, 404):
            out_rows.append("- %s void %s: %s" % (_stamp(now), p["id"], text))
            left = left or ("no-rights", text or "HTTP %s" % code)
        elif wrc != 0 and (code is None or code >= 500) and live is not None and _same(live, p["before"]):
            out_rows.append("- %s void %s: %s" % (_stamp(now), p["id"], text or "transient"))
            left = left or ("transient", text or "the write failed transiently")
        else:
            if live is not None and _same(live, p["before"]):
                out_rows.append("- %s void %s: write did not take" % (_stamp(now), p["id"]))
            left = left or ("no-change", "write did not take (%s)" % (text or "read back as neither"))
    for fields in run.emits:
        run.emit("setting-changed", fields)
    if left is not None and left[0] == "transient":
        run.note = rr.Note(run.path)
        rr._append_settings_rows(run.note, out_rows)
        _save(run.note)
        run.block = rr._settings_block(run.note) or run.block
        return run.tried("transient", left[1], 8)
    if left is not None:
        return run.leave(left[0], left[1], rows=out_rows)
    run.note = rr.Note(run.path)
    rr._append_settings_rows(run.note, out_rows)
    _save(run.note)
    for p in plan:
        print("[[%s]]: merge setting changed for you (%s %s@%s%s: %s); undo: %s" % (
            run.slug, p["source"], repo, branch, " ruleset %d" % p["rid"] if p["rid"] else "", _change_text(p["applied"]),
            _undo_text(p["source"], p["before"], **p["where"])))
    return 0


def _change_text(applied):
    return "; ".join("%s %s" % ("replaced", json.dumps(c) + " -> " + json.dumps(n)) if n is not None
                     else "removed %s" % json.dumps(c) for c, n in applied)


def _plan_fields(p, repo, branch, block):
    first = p["applied"][0] if p["applied"] else (None, None)
    fields = {"id": p["id"], "repo": repo, "branch": branch, "source": p["source"], "block": block["kind"],
              "change": "replaced" if first[1] is not None else "removed", "context": first[0] or "?",
              "before": _canon(p["before"]), "after": _canon(p["after"]),
              "undo": _undo_text(p["source"], p["before"], **p["where"]), "fingerprint": block["fingerprint"]}
    if p["rid"]:
        fields["rulesetId"] = p["rid"]
    if first[1] is not None:
        fields["newContext"] = first[1]
    return fields


def _changed_fields(row, block):
    fields = {"id": row["id"], "repo": row["repo"], "branch": row["branch"], "source": row["source"],
              "block": block["kind"], "change": row["change"] or "removed", "context": row["context"] or "?",
              "before": row["before"] or "", "after": row["after"] or "", "undo": row["undo"] or "",
              "fingerprint": block["fingerprint"]}
    if row["ruleset"]:
        fields["rulesetId"] = int(row["ruleset"])
    if row["newContext"]:
        fields["newContext"] = row["newContext"]
    return fields


def _cleared(run, pre, why):
    run.note = rr.Note(run.path)
    rr._append_settings_rows(run.note, list(pre) + ["- %s cleared %s: %s" % (_stamp(run.now), run.fp(), why)])
    _save(run.note)
    print("[[%s]]: cleared: %s" % (run.slug, why))
    return 0


# ---- restore, dismiss, rows ------------------------------------------------------------------------------------------

def _find(note, rid):
    rows = rr._settings_rows(note)
    row = next((r for r in rows if r["verb"] == "changing" and r["id"] == rid), None)
    return row, rows


def cmd_restore(args):
    now = args.now_dt
    path = Path(os.path.expanduser(args.note))
    try:
        note = rr.Note(path)
    except (OSError, ValueError) as e:
        print("ERROR: merge-settings restore: cannot read %s: %s" % (path, e), file=sys.stderr)
        return 2
    row, rows = _find(note, args.id)
    if row is None or not row["source"]:
        print("ERROR: merge-settings restore: no change %s on [[%s]]" % (args.id, path.stem), file=sys.stderr)
        return 2
    if any(r["verb"] == "restored" and r["id"] == args.id for r in rows):
        print("[[%s]]: %s already restored" % (path.stem, args.id))
        return 0
    with SettingsLock(row["repo"]) as lock:
        if not lock.ok:
            print("[[%s]]: the merge-settings lock of %s is held: run it again" % (path.stem, row["repo"]))
            return 75
        try:
            _owner, _branch = _owned(args.gh_bin, row["repo"])
            rid = int(row["ruleset"]) if row["ruleset"] else None
            live = _live(args.gh_bin, row["repo"], row["branch"], row["source"], rid)
            before, after = json.loads(row["before"]), json.loads(row["after"])
            if live is None or not _same(live, after):
                print("[[%s]]: the live setting of %s is not the one it changed to: nothing written; its undo: %s" %
                      (path.stem, args.id, row["undo"]))
                return 3
            where = _where(row["source"], row["repo"], row["branch"], rid)
            _write(args.gh_bin, row["source"], where, before)
            live = _live(args.gh_bin, row["repo"], row["branch"], row["source"], rid)
            if live is None or not _same(live, before):
                print("[[%s]]: the restore of %s did not read back: nothing recorded; its undo: %s" %
                      (path.stem, args.id, row["undo"]))
                return 3
        except Leave as e:
            print("[[%s]]: not restored: %s: %s" % (path.stem, e.cause, e.why))
            return 3
        except Transient as e:
            print("[[%s]]: not restored (transient): %s" % (path.stem, e))
            return 8
        note = rr.Note(path)
        _row(note, now, "restored %s" % args.id)
        _save(note)
        rollout = rr._note_rollout(note)
        if rollout:
            rr._event(rollout, "setting-restored", path.stem.lower(), {"id": args.id}, ts=now.isoformat())
    print("[[%s]]: restored %s" % (path.stem, args.id))
    return 0


def cmd_dismiss(args):
    now = args.now_dt
    path = Path(os.path.expanduser(args.note))
    try:
        note = rr.Note(path)
    except (OSError, ValueError) as e:
        print("ERROR: merge-settings dismiss: cannot read %s: %s" % (path, e), file=sys.stderr)
        return 2
    row, rows = _find(note, args.id)
    if row is None:
        print("ERROR: merge-settings dismiss: no change %s on [[%s]]" % (args.id, path.stem), file=sys.stderr)
        return 2
    if any(r["verb"] == "dismissed" and r["id"] == args.id for r in rows):
        print("[[%s]]: %s already dismissed" % (path.stem, args.id))
        return 0
    _row(note, now, "dismissed %s" % args.id)
    _save(note)
    rollout = rr._note_rollout(note)
    if rollout:
        rr._event(rollout, "setting-dismissed", path.stem.lower(), {"id": args.id}, ts=now.isoformat())
    print("[[%s]]: dismissed %s: the change stays, its Run record line kept" % (path.stem, args.id))
    return 0


def _open_rows(path, note, unrestored):
    rows = rr._settings_rows(note)
    out = []
    for r in rows:
        if r["verb"] != "changing" or not r["id"]:
            continue
        verbs = {x["verb"] for x in rows if x["id"] == r["id"] and x["verb"] != "changing"}
        if "restored" in verbs or "void" in verbs:
            continue
        if "dismissed" in verbs:
            if not unrestored:
                continue
            state = "dismissed"
        else:
            state = "changed" if "changed" in verbs else "unconfirmed"
        out.append({"task": path.stem, "id": r["id"], "state": state, "stamp": r["stamp"], "source": r["source"],
                    "repo": r["repo"], "branch": r["branch"], "ruleset": int(r["ruleset"]) if r["ruleset"] else None,
                    "change": r["text"].split(": ", 2)[-1] if r["text"] else "", "context": r["context"],
                    "newContext": r["newContext"], "before": r["before"], "after": r["after"], "undo": r["undo"]})
    return out


def cmd_rows(args):
    out = []
    if args.note:
        path = Path(os.path.expanduser(args.note))
        try:
            out = _open_rows(path, rr.Note(path), args.unrestored)
        except (OSError, ValueError) as e:
            print("ERROR: merge-settings rows: cannot read %s: %s" % (path, e), file=sys.stderr)
            return 2
    else:
        d = Path(os.path.expanduser(args.tasks_dir))
        if not d.is_dir():
            print("ERROR: merge-settings rows: no tasks dir at %s" % d, file=sys.stderr)
            return 2
        want = None
        if args.rollout:   # a slug, a wikilink or the rollout note's path
            want = (Path(args.rollout).stem if args.rollout.endswith(".md")
                    else rr._wikilink_slug(args.rollout) or args.rollout).lower()
        for path in sorted(d.glob("*.md")):
            try:
                text = path.read_text()
            except OSError:
                continue
            if "\n" + rr.MERGE_SETTINGS_SECTION not in text:
                continue
            try:
                note = rr.Note(path, text)
            except ValueError:
                continue
            if want and (rr._note_rollout(note) or "").lower() != want:
                continue
            out += _open_rows(path, note, args.unrestored)
    print(json.dumps({"rows": out}, ensure_ascii=False))
    return 0


# ---- main -------------------------------------------------------------------------------------------------------------

def _guard(note, tasks_dir):
    """engine-snapshot.py's guard_task() for the note's rollout, loaded from this tree: its refusal, else None."""
    try:
        es = _load("thread_engine_snapshot_ms", ROOT / "skills" / "_shared" / "scripts" / "engine-snapshot.py")
    except Exception:  # noqa: BLE001 — only positive evidence refuses
        return None
    return es.guard_task(note, es.ROOT, SCRIPT_REL, tasks_dir)


def main(argv=None):
    p = argparse.ArgumentParser(description="ADR 0080: a stuck rollout changes its repo's merge settings, logged with its undo.")
    sub = p.add_subparsers(dest="cmd", required=True)
    fr = sub.add_parser("free", help="free a due settings block: the smallest change of the merge setting that asks for it")
    fr.add_argument("--note", required=True)
    fr.add_argument("--repo", required=True)
    rs = sub.add_parser("restore", help="write a change's before back (on Lachy's word)")
    rs.add_argument("--note", required=True)
    rs.add_argument("--id", required=True)
    dm = sub.add_parser("dismiss", help="keep a change (on Lachy's word); its Run record line stays")
    dm.add_argument("--note", required=True)
    dm.add_argument("--id", required=True)
    for sp in (fr, rs, dm):
        sp.add_argument("--gh-bin", default="gh")
        sp.add_argument("--now", default=None)
        sp.add_argument("--tasks-dir", default=None, help="the vault's task notes (the Engine snapshot guard)")
    ro = sub.add_parser("rows", help="the open changed-for-you rows, read-only JSON")
    src = ro.add_mutually_exclusive_group(required=True)
    src.add_argument("--tasks-dir")
    src.add_argument("--note")
    ro.add_argument("--rollout", default=None)
    ro.add_argument("--unrestored", action="store_true")
    args = p.parse_args(argv)
    if args.cmd == "rows":
        if args.rollout and not args.tasks_dir:
            p.error("--rollout goes with --tasks-dir")
        return cmd_rows(args)
    if getattr(args, "id", None) is not None and not re.fullmatch(r"[0-9a-f]{12}", args.id):
        print("ERROR: merge-settings %s: usage: --id %r is not a 12-hex change id" % (args.cmd, args.id), file=sys.stderr)
        return 2
    args.now_dt = rr._parse_ts(args.now) if args.now else datetime.now().astimezone()
    if args.now_dt is None:
        print("ERROR: merge-settings %s: usage: --now %r is not a stamp" % (args.cmd, args.now), file=sys.stderr)
        return 2
    if args.cmd == "free":
        args.repo = Path(os.path.expanduser(args.repo))
    refusal = _guard(os.path.expanduser(args.note), args.tasks_dir)
    if refusal:   # ADR 0043: before any read; nothing written
        print(refusal, file=sys.stderr)
        return 2
    try:
        return {"free": cmd_free, "restore": cmd_restore, "dismiss": cmd_dismiss}[args.cmd](args)
    except OSError as e:
        print("ERROR: merge-settings %s: %s" % (args.cmd, e), file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
