#!/usr/bin/env python3
"""merge-gate.py — the facts of a repo's merge gate, for schedule step 2.5 (giflab ADR 0012 d4, ADR 0068).

    python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/merge-gate.py --repo <path> --branch <default>
        [--tree origin/<default>] [--gh-bin gh]

Read-only: python >= 3.8, the stdlib, and PyYAML when it can be imported (next-action.py's pattern). It writes nothing,
records no Run-record line and starts no network call but its two `gh api` GETs. It loads engine-snapshot.py
(git_env()) and rollout-settings.py (_origin_slug, SettingsError) from its own directory by path. This header is the
one copy of its rules; schedule step 2.5 reads its output and decides, and CONTEXT.md's **Merge gate** points here.

Exits. 2 only for a usage error (argparse's own) or a --repo outside a git work tree (`git rev-parse --show-toplevel`
under git_env()), with one `merge-gate: …` line on stderr. Anything else prints one JSON line and exits 0: an
exception the reader did not expect reads `status: unreadable`, why `merge-gate: <Type>: <message>`.

Origin. `land.sh --origin-slug` through rollout-settings.py's _origin_slug. No GitHub origin -> unreadable, why
`no GitHub origin`; its SettingsError (a timeout, a land.sh that will not start, another exit) or an OSError ->
unreadable, why `origin: <the error>`. gh is never called in either case.

The two reads. `gh api -i -H 'Accept: application/vnd.github+json' <endpoint>` for
`repos/<o>/<n>/branches/<branch>` and `repos/<o>/<n>/rules/branches/<branch>`, the branch percent-encoded whole (a
`/` too), each in its own process group with env git_env() plus GH_PROMPT_DISABLED=1 and GH_NO_UPDATE_NOTIFIER=1,
bounded by GH_TIMEOUT (20 s): on expiry the whole group is killed, the pipes closed and the child reaped. The HTTP
code is the first `HTTP/<v> <code>` line of stdout and the body is what follows the first blank line after it; no
status line (gh missing, logged out, no network) is an endpoint error carrying gh's first stderr line or the OSError.
A 200 whose body is not the JSON shape the endpoint gives is an endpoint error too. A rules read whose response names
a next page (`Link: …; rel="next"`) keeps its first page and sets `truncated`.
- Branch (200): `protected: false` holds nothing required, a full read. `protected: true` with a `protection` object
  gives the union of `protection.required_status_checks.contexts` and its `checks[].{context, app_id}`. `protected:
  true` with no `protection` object is a partial read: `branches/<b>: protection not visible to this gh account`.
- Rules (200): every `required_status_checks` rule's `parameters.required_status_checks[].{context,
  integration_id}`; a `workflows` rule goes to `unmatched` as kind required-workflow (path, repositoryId, ref) and a
  `code_scanning` rule as kind code-scanning (tools). Other rule types are ignored.

Status. none: both reads 200, the branch read full, and nothing required (no context, no required workflow, no
code-scanning rule). read: both 200, the branch read full, something required, and the jobs read. partial: the
branch read 200 and the rules read not, or the protection object not visible, or `jobs: null` (the --tree ref is
missing, or PyYAML cannot be imported). unreadable: the branch read not 200 (a 403; a 404, which is also a private
repo this gh account cannot see or a branch not on origin; a 5xx; an error; a timeout), gh missing or logged out, no
GitHub origin or an origin error, or an internal error; `required` still lists what the rules read gave, and no
workflow is read (`jobs: null`). Never `none` on anything less than two clean reads.

`required`: [{context, sources: ["protection" | "ruleset", …], appId?, cut?}], deduplicated, in protection order and
then ruleset order (a context both name carries both sources, its first app id kept).

Workflows are read from --tree (default `origin/<branch>`), never the working tree: `git ls-tree -z --name-only
<tree> -- .github/workflows/`, then `git show <tree>:<path>` of each `*.yml` / `*.yaml`. A file over
MAX_WORKFLOW_BYTES, an unparseable one, or one past MAX_WORKFLOWS gets a why and sets `truncated`. `on:` is normalised
to {event: filters | null} from its string, list or map form (YAML 1.1 reads the key as True, which counts as `on`),
keeping the filters branches, branches-ignore, tags, tags-ignore, paths, paths-ignore and types.

Matching. Each required context with no app id, or the GitHub Actions app's (ACTIONS_APP_ID), is matched to jobs of
every parsed workflow; the first rule that hits wins, and every candidate it hits, across files, is listed:
1. a job whose `name:` equals the context, else one whose id does (a job with no name);
2. the same with a trailing ` (…)` stripped from the context (a matrix job's suffix);
3. a `name:` holding `${{ … }}` and some literal text, read as a wildcard (`.+` per expression);
4. `a / b`: `a` matches a job with a job-level `uses:` by rules 1-3, and `b` a job of its local reusable workflow by
   the same rules.
A context with another app's id goes to `unmatched` as kind app; one nothing matches as kind context, with a why when
a file cap cut the listing.

Closure, per required context, over every parsed workflow and before any cap: its matched jobs; their transitive
`needs:` (a string or a list) within the same workflow, with a cycle guard; and, for a job-level `uses:
./.github/workflows/x.yml`, the callee jobs: on an `a / b` match the job matching `b` and its transitive needs,
otherwise every callee job, with a why saying so. An expanded callee job carries `calledBy: {workflow, job, if?}`
(its caller) and `onFrom: <the caller's workflow>`, and is keyed per caller.

Emission. Jobs follow `required` order, each closure in walk order, deduplicated, at most MAX_JOBS; a context whose
closure did not fit gets `cut: true`, sets `truncated` and gets a why naming the cap. A job record:
{workflow, id, name?, contexts, matched, if?, needs, uses?, calledBy?, onFrom?, prTrigger, pushTrigger, matrix?,
env?, steps, readGaps}
- `contexts`: every required context whose closure holds the job, in `required` order; `matched`: the contexts that
  named it directly.
- `prTrigger` / `pushTrigger`: its own workflow's `on:` holds an event in PR_EVENTS / holds `push`. A callee's are
  read off its caller's `on:` (`onFrom`): its own `on: workflow_call` never sets or clears either.
- `matrix` (strategy.matrix) and `env` are compact JSON. Steps: {name?, run?, uses?, with?, env?, if?, action?,
  runTruncated?}, `with` and `env` compact JSON; `run`, `with` and `env` are each cut at MAX_RUN characters with `…`,
  and any cut sets the step's `runTruncated: true` (and `truncated`).
- A local step action (`uses: ./<dir>`) is expanded one level from `<dir>/action.yml` or `action.yaml` at the tree:
  `action: {path, using, steps?}`, a composite action's `runs.steps` listed with the same fields.
- `readGaps`, the script's own and deterministic, so a job that has one is never read:
  `remote reusable workflow <uses>: not read`; `nested reusable workflow <uses>: not expanded`; `reusable workflow
  <path> at <tree>: missing|unparseable|over <N> bytes`; `step <n> cut at <MAX_RUN> characters` for each cut step
  (`step <n>.<m>` for a composite action's step m); `local action <path>: missing|unparseable|over <N> bytes|no
  runs.using|<using> not read` (a non-composite or unreadable local action); `local action <path> step <m>: nested
  local action not expanded`; `job matrix|env cut at <MAX_RUN> characters`. A remote step action (`owner/repo@ref`,
  `docker://…`) is no read gap: its ref and `with` are the fact. A same-repo reusable workflow written in remote form
  is remote.

Output, one JSON line: {status, repo (owner/name, or null), branch, tree, required, workflows: [{path, name?, on}],
jobs | null, unmatched: [{context?, sources, kind: context | app | required-workflow | code-scanning, appId?, path?,
repositoryId?, ref?, tools?}], truncated, why}. `workflows` lists every workflow holding an output job, callers and
callees alike. With PyYAML not importable: `jobs: null`, `workflows: [{path}]` and a why naming PyYAML.
"""
import argparse
import importlib.util
import json
import os
import re
import signal
import subprocess
import sys
from urllib.parse import quote

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.realpath(__file__))

try:
    import yaml
    LOADER = getattr(yaml, "CSafeLoader", None) or yaml.SafeLoader
except ImportError:
    yaml = None
    LOADER = None


def _load(name, filename):
    spec = importlib.util.spec_from_file_location(name, os.path.join(HERE, filename))
    if spec is None or spec.loader is None:
        raise ImportError("no loader for %s" % filename)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


ES = _load("thread_engine_snapshot", "engine-snapshot.py")
RS = _load("thread_rollout_settings", "rollout-settings.py")

GH_TIMEOUT = 20               # seconds per gh api call; the whole group dies on expiry
GIT_TIMEOUT = 60              # seconds per local git read
MAX_WORKFLOWS = 64
MAX_WORKFLOW_BYTES = 262144
MAX_JOBS = 64
MAX_RUN = 2000
ACTIONS_APP_ID = 15368        # GitHub Actions' app id: a required check it reports is a workflow job
PR_EVENTS = ("pull_request", "pull_request_target", "merge_group")
ON_FILTERS = ("branches", "branches-ignore", "tags", "tags-ignore", "paths", "paths-ignore", "types")
STATUS_RE = re.compile(r"HTTP/\S+\s+(\d{3})\b")
STRIP_SUFFIX_RE = re.compile(r"\s\([^()]*\)\Z")
EXPR_RE = re.compile(r"\$\{\{.*?\}\}")
NEXT_LINK_RE = re.compile(r'^link:.*rel="next"', re.I)


class UsageError(Exception):
    pass


# ---- git and gh --------------------------------------------------------------------------------------------------

def _git(top, *args):
    """(rc, stdout bytes, stderr text) of a read-only git call in `top` under git_env()."""
    try:
        p = subprocess.run(["git", "-C", top] + list(args), env=ES.git_env(), stdin=subprocess.DEVNULL,
                           capture_output=True, timeout=GIT_TIMEOUT)
    except subprocess.TimeoutExpired:
        return 124, b"", "timed out after %ss" % GIT_TIMEOUT
    except OSError as e:
        return 127, b"", str(e.strerror or e)
    return p.returncode, p.stdout, p.stderr.decode("utf-8", "replace")


def _toplevel(repo):
    rc, out, _err = _git(repo, "rev-parse", "--show-toplevel")
    top = out.decode("utf-8", "replace").strip()
    if rc != 0 or not top:
        raise UsageError("--repo %s: not a git work tree" % repo)
    return top


def gh_get(gh_bin, endpoint):
    """(code | None, body text | None, error | None, headers [str]) of one `gh api -i` GET."""
    env = dict(ES.git_env())
    env["GH_PROMPT_DISABLED"] = "1"
    env["GH_NO_UPDATE_NOTIFIER"] = "1"
    argv = [gh_bin, "api", "-i", "-H", "Accept: application/vnd.github+json", endpoint]
    try:
        p = subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env,
                             start_new_session=True)
    except OSError as e:
        return None, None, "gh will not start: %s" % (e.strerror or e), []
    try:
        out, err = p.communicate(timeout=GH_TIMEOUT)
    except subprocess.TimeoutExpired:
        # Kill the whole group before draining: a grandchild holding a pipe would hang communicate().
        try:
            os.killpg(p.pid, signal.SIGKILL)
        except OSError:
            pass
        for f in (p.stdout, p.stderr):
            try:
                f.close()
            except OSError:
                pass
        p.wait()
        return None, None, "gh api timed out after %ss" % GH_TIMEOUT, []
    text = out.decode("utf-8", "replace")
    lines = text.split("\n")
    at = next((i for i, l in enumerate(lines) if STATUS_RE.match(l.strip())), None)
    if at is None:
        first = next((l.strip() for l in err.decode("utf-8", "replace").splitlines() if l.strip()), "")
        return None, None, first or "gh exit %d with no response" % p.returncode, []
    code = int(STATUS_RE.match(lines[at].strip()).group(1))
    headers, body_at = [], len(lines)
    for i in range(at + 1, len(lines)):
        if not lines[i].strip():
            body_at = i + 1
            break
        headers.append(lines[i].strip())
    return code, "\n".join(lines[body_at:]), None, headers


def _read(gh_bin, slug, kind, branch, why):
    """One endpoint: (json | None, ok, next_page). `kind` is `branches` or `rules/branches`; a failure appends a why."""
    label = "%s/%s" % (kind, branch)
    code, body, error, headers = gh_get(gh_bin, "repos/%s/%s/%s" % (slug, kind, quote(branch, safe="")))
    if code is None:
        why.append("%s: %s" % (label, error))
        return None, False, False
    if code != 200:
        why.append("%s: HTTP %d" % (label, code))
        return None, False, False
    try:
        data = json.loads(body)
    except ValueError:
        why.append("%s: HTTP 200 but the body is not JSON" % label)
        return None, False, False
    want = dict if kind == "branches" else list
    if not isinstance(data, want):
        why.append("%s: HTTP 200 but the body is not a JSON %s" % (label, "object" if want is dict else "array"))
        return None, False, False
    return data, True, any(NEXT_LINK_RE.match(h) for h in headers)


# ---- the required checks -----------------------------------------------------------------------------------------

def _add_required(required, context, source, app_id):
    if not isinstance(context, str) or not context:
        return
    for r in required:
        if r["context"] == context:
            if source not in r["sources"]:
                r["sources"].append(source)
            if "appId" not in r and isinstance(app_id, int) and not isinstance(app_id, bool):
                r["appId"] = app_id
            return
    entry = {"context": context, "sources": [source]}
    if isinstance(app_id, int) and not isinstance(app_id, bool):
        entry["appId"] = app_id
    required.append(entry)


def _from_branch(data, branch, required, why):
    """The protection's required contexts; returns whether the read is full."""
    if not data.get("protected"):
        return True
    prot = data.get("protection")
    if not isinstance(prot, dict):
        why.append("branches/%s: protection not visible to this gh account" % branch)
        return False
    rsc = prot.get("required_status_checks")
    if isinstance(rsc, dict):
        checks = [c for c in (rsc.get("checks") or []) if isinstance(c, dict)]
        apps = {c.get("context"): c.get("app_id") for c in checks}
        for c in rsc.get("contexts") or []:
            _add_required(required, c, "protection", apps.get(c))
        for c in checks:
            _add_required(required, c.get("context"), "protection", c.get("app_id"))
    return True


def _from_rules(data, required, unmatched):
    for rule in data:
        if not isinstance(rule, dict):
            continue
        params = rule.get("parameters") if isinstance(rule.get("parameters"), dict) else {}
        kind = rule.get("type")
        if kind == "required_status_checks":
            for c in params.get("required_status_checks") or []:
                if isinstance(c, dict):
                    _add_required(required, c.get("context"), "ruleset", c.get("integration_id"))
        elif kind == "workflows":
            for w in params.get("workflows") or []:
                if isinstance(w, dict):
                    entry = {"sources": ["ruleset"], "kind": "required-workflow", "path": w.get("path")}
                    for k, out in (("repository_id", "repositoryId"), ("ref", "ref")):
                        if w.get(k) is not None:
                            entry[out] = w.get(k)
                    unmatched.append(entry)
        elif kind == "code_scanning":
            tools = [t.get("tool") for t in params.get("code_scanning_tools") or [] if isinstance(t, dict)]
            unmatched.append({"sources": ["ruleset"], "kind": "code-scanning", "tools": tools})


# ---- the workflows at the tree -----------------------------------------------------------------------------------

def _scalar(v):
    """A YAML scalar as the workflow wrote it: a string as is, a bool as `true`/`false`, anything else as text."""
    if isinstance(v, str):
        return v
    if isinstance(v, bool):
        return "true" if v else "false"
    return _compact(v) if isinstance(v, (dict, list)) else str(v)


def _compact(v):
    return v if isinstance(v, str) else json.dumps(v, separators=(",", ":"), ensure_ascii=False, default=str)


def _cut(s):
    """(text, was cut)."""
    return (s[:MAX_RUN] + "…", True) if len(s) > MAX_RUN else (s, False)


def _norm_on(raw):
    if isinstance(raw, str):
        return {raw: None}
    if isinstance(raw, list):
        return {str(e): None for e in raw if isinstance(e, (str, int))}
    if isinstance(raw, dict):
        out = {}
        for event, filters in raw.items():
            kept = {k: filters[k] for k in ON_FILTERS if isinstance(filters, dict) and k in filters}
            out[str(event)] = kept or None
        return out
    return {}


class Tree:
    """The workflows (and local actions) at one tree, each file read and parsed at most once."""

    def __init__(self, top, rev):
        self.top, self.rev = top, rev
        self.files = {}   # path -> {"doc": dict} | {"gap": "missing" | "unparseable" | "over N bytes"}

    def blob(self, path):
        """(bytes, None) of `git show <tree>:<path>`, or (None, its gap)."""
        rc, out, _err = _git(self.top, "show", "%s:%s" % (self.rev, path))
        if rc != 0:
            return None, "missing"
        if len(out) > MAX_WORKFLOW_BYTES:
            return None, "over %d bytes" % MAX_WORKFLOW_BYTES
        return out, None

    def load(self, path):
        if path in self.files:
            return self.files[path]
        raw, gap = self.blob(path)
        doc = None
        if raw is not None:
            try:
                doc = yaml.load(raw.decode("utf-8"), Loader=LOADER)
            except (UnicodeDecodeError, yaml.YAMLError):
                gap = "unparseable"
            if gap is None and not isinstance(doc, dict):
                gap = "unparseable"
        self.files[path] = {"gap": gap} if gap else {"doc": doc}
        return self.files[path]

    def workflow(self, path):
        """{"on": {...}, "name"?, "jobs": {id: dict}} or {"gap": …}."""
        f = self.load(path)
        if "gap" in f:
            return f
        if "wf" not in f:
            doc = f["doc"]
            on = doc.get("on", doc.get(True))
            jobs = doc.get("jobs") if isinstance(doc.get("jobs"), dict) else {}
            wf = {"on": _norm_on(on), "jobs": {str(k): v for k, v in jobs.items() if isinstance(v, dict)}}
            if isinstance(doc.get("name"), str):
                wf["name"] = doc["name"]
            f["wf"] = wf
        return f["wf"]


def _list_workflows(top, rev, why, state):
    rc, out, err = _git(top, "ls-tree", "-z", "--name-only", rev, "--", ".github/workflows/")
    if rc != 0:
        why.append("tree %s: ls-tree failed: %s" % (rev, err.strip().splitlines()[0] if err.strip() else rc))
        return None
    paths = [p for p in out.decode("utf-8", "replace").split("\0") if p.endswith((".yml", ".yaml"))]
    if len(paths) > MAX_WORKFLOWS:
        why.append("%d workflows at %s: only the first %d read (MAX_WORKFLOWS)" % (len(paths), rev, MAX_WORKFLOWS))
        state["truncated"] = state["listingCut"] = True
        paths = paths[:MAX_WORKFLOWS]
    return paths


def _local_callee(uses):
    """The repo path of a local reusable workflow (`./.github/workflows/x.yml`), else None."""
    if isinstance(uses, str) and uses.startswith("./"):
        return uses[2:].split("@", 1)[0]
    return None


# ---- matching ----------------------------------------------------------------------------------------------------

def _wildcard(name):
    parts = EXPR_RE.split(name)
    return re.compile(".+".join(re.escape(p) for p in parts) + r"\Z", re.S)


def _name(cand):
    """A candidate's `name:` when it is a string, else None (the check is then named by the job id)."""
    name = cand[2].get("name")
    return name if isinstance(name, str) else None


def _match(context, cands):
    """Rules 1-3 over `cands` [(key, id, job)]: the hits of the first rule that hits."""
    targets = [context]
    stripped = STRIP_SUFFIX_RE.sub("", context)
    if stripped != context:
        targets.append(stripped)
    for t in targets:
        hits = [c for c in cands if _name(c) == t]
        if hits:
            return hits
        hits = [c for c in cands if _name(c) is None and c[1] == t]
        if hits:
            return hits
    # A name that is only expressions would match every context: a wildcard needs some literal text.
    return [c for c in cands if _name(c) and EXPR_RE.search(_name(c)) and EXPR_RE.sub("", _name(c)).strip()
            and _wildcard(_name(c)).match(context)]


class Gate:
    """Matching and closures over the parsed workflows of one Tree."""

    def __init__(self, tree, paths, why, state):
        self.tree, self.why = tree, why
        self.cands = []   # (key, id, job) of every job of every parsed workflow; key (path, id, None)
        for p in paths:
            wf = tree.workflow(p)
            if "gap" in wf:
                self.why.append("%s at %s: %s" % (p, tree.rev, wf["gap"]))
                state["truncated"] = state["listingCut"] = True
                continue
            for jid, job in wf["jobs"].items():
                self.cands.append(((p, jid, None), jid, job))

    def job(self, key):
        path, jid, _caller = key
        return self.tree.workflow(path)["jobs"][jid]

    def callee_cands(self, key, callee):
        wf = self.tree.workflow(callee)
        if "gap" in wf:
            return None
        return [((callee, jid, (key[0], key[1])), jid, job) for jid, job in wf["jobs"].items()]

    def match(self, context):
        """[(key, b-hits | None)] for the first rule that hits: b-hits (a list, empty when no callee job matches `b`)
        only on an `a / b` match of a local reusable workflow's caller, else None."""
        hits = _match(context, self.cands)
        if hits:
            return [(c[0], None) for c in hits]
        callers = [c for c in self.cands if isinstance(c[2].get("uses"), str)]
        pos = context.find(" / ")
        while pos >= 0:
            a, b = context[:pos], context[pos + 3:]
            ahits = _match(a, callers)
            if ahits:
                out = []
                for c in ahits:
                    callee = _local_callee(c[2]["uses"])
                    inner = self.callee_cands(c[0], callee) if callee else None
                    if inner is None:
                        out.append((c[0], None))
                        continue
                    bhits = _match(b, inner)
                    if not bhits:
                        self.why.append("%s: no job of %s matches `%s`; every job of it is listed"
                                        % (context, callee, b))
                    out.append((c[0], [h[0] for h in bhits]))
                return out
            pos = context.find(" / ", pos + 1)
        return []

    def closure(self, context, hits):
        """The walk-ordered keys of a context's closure, and the keys it named directly."""
        order, seen, direct = [], set(), []

        def visit(key, bhits=None):
            if key in seen:
                return
            seen.add(key)
            order.append(key)
            path, _jid, caller = key
            job = self.job(key)
            if caller is None:
                callee = _local_callee(job.get("uses"))
                if callee:
                    inner = self.callee_cands(key, callee)
                    if inner is not None:
                        if bhits:
                            for k in bhits:   # an `a / b` match: the job matching b and its needs
                                visit(k)
                        else:
                            if bhits is None and inner:   # [] already has match()'s why
                                self.why.append("%s: %s job %s calls %s; every job of it is listed"
                                                % (context, path, key[1], callee))
                            for c in inner:
                                visit(c[0])
            jobs = self.tree.workflow(path)["jobs"]
            needs = job.get("needs")
            for n in ([needs] if isinstance(needs, str) else needs if isinstance(needs, list) else []):
                if isinstance(n, str) and n in jobs:
                    visit((path, n, caller))

        for key, bhits in hits:
            direct.append(key)
            if bhits:
                direct.extend(bhits)
            visit(key, bhits)
        return order, direct


# ---- job records -------------------------------------------------------------------------------------------------

def _step(raw, label, gaps, state, action_of=None):
    """One step record; a cut appends a gap named by `label` (`step <n>` or `step <n>.<m>`)."""
    s, cut = {}, False
    for k in ("name", "run", "uses", "with", "env", "if"):
        if raw.get(k) is None:
            continue
        v = _compact(raw[k]) if k in ("with", "env") else _scalar(raw[k])
        if k in ("run", "with", "env"):
            v, c = _cut(v)
            cut = cut or c
        s[k] = v
    if cut:
        s["runTruncated"] = True
        gaps.append("%s cut at %d characters" % (label, MAX_RUN))
        state["truncated"] = True
    if action_of is not None and isinstance(raw.get("uses"), str) and raw["uses"].startswith("./"):
        action_of(raw["uses"], s, label, gaps)
    return s


def _action(tree, state):
    def expand(uses, rec, label, gaps):
        d = uses[2:].split("@", 1)[0].rstrip("/")
        f = None
        for name in ("action.yml", "action.yaml"):
            f = tree.load("%s/%s" % (d, name) if d else name)
            if f.get("gap") != "missing":
                break
        path = d or "."
        if "gap" in f:
            gaps.append("local action %s: %s" % (path, f["gap"]))
            rec["action"] = {"path": path}
            return
        runs = f["doc"].get("runs") if isinstance(f["doc"].get("runs"), dict) else {}
        using = _scalar(runs.get("using")) if runs.get("using") is not None else ""
        rec["action"] = {"path": path, "using": using}
        if using != "composite":
            gaps.append("local action %s: %s" % (path, "%s not read" % using if using else "no runs.using"))
            return
        steps = []
        for m, raw in enumerate(runs.get("steps") or [], 1):
            if not isinstance(raw, dict):
                continue
            if isinstance(raw.get("uses"), str) and raw["uses"].startswith("./"):
                gaps.append("local action %s step %d: nested local action not expanded" % (path, m))
            steps.append(_step(raw, "%s.%d" % (label, m), gaps, state))
        rec["action"]["steps"] = steps
    return expand


def _record(gate, key, contexts, matched, state):
    path, jid, caller = key
    job = gate.job(key)
    tree = gate.tree
    rec = {"workflow": path, "id": jid}
    if isinstance(job.get("name"), str):
        rec["name"] = job["name"]
    rec["contexts"] = contexts
    rec["matched"] = matched
    if job.get("if") is not None:
        rec["if"] = _scalar(job["if"])
    needs = job.get("needs")
    rec["needs"] = [needs] if isinstance(needs, str) else [n for n in needs if isinstance(n, str)] \
        if isinstance(needs, list) else []
    gaps = []
    uses = job.get("uses")
    if isinstance(uses, str):
        rec["uses"] = uses
        callee = _local_callee(uses)
        if caller is not None:
            gaps.append("nested reusable workflow %s: not expanded" % uses)
        elif callee is None:
            gaps.append("remote reusable workflow %s: not read" % uses)
        else:
            wf = tree.workflow(callee)
            if "gap" in wf:
                gaps.append("reusable workflow %s at %s: %s" % (callee, tree.rev, wf["gap"]))
    if caller is not None:
        cjob = gate.job((caller[0], caller[1], None))
        called = {"workflow": caller[0], "job": caller[1]}
        if cjob.get("if") is not None:
            called["if"] = _scalar(cjob["if"])
        rec["calledBy"] = called
        rec["onFrom"] = caller[0]
    on = tree.workflow(caller[0] if caller is not None else path)["on"]
    rec["prTrigger"] = any(e in on for e in PR_EVENTS)
    rec["pushTrigger"] = "push" in on
    strategy = job.get("strategy") if isinstance(job.get("strategy"), dict) else {}
    for field, raw in (("matrix", strategy.get("matrix")), ("env", job.get("env"))):
        if raw is None:
            continue
        v, cut = _cut(_compact(raw))
        rec[field] = v
        if cut:
            gaps.append("job %s cut at %d characters" % (field, MAX_RUN))
            state["truncated"] = True
    expand = _action(tree, state)
    rec["steps"] = [_step(raw, "step %d" % n, gaps, state, expand)
                    for n, raw in enumerate(job.get("steps") or [], 1) if isinstance(raw, dict)]
    rec["readGaps"] = gaps
    return rec


def read_jobs(top, rev, required, unmatched, why, state):
    """(jobs, workflows) for the required contexts, or (None, workflows) when the tree or PyYAML is missing."""
    rc, _out, _err = _git(top, "rev-parse", "--verify", "--quiet", "%s^{tree}" % rev)
    if rc != 0:
        why.append("tree %s: not found in the repo (fetch origin first)" % rev)
        return None, []
    paths = _list_workflows(top, rev, why, state)
    if paths is None:
        return None, []
    if yaml is None:
        why.append("PyYAML is not importable: workflows listed by path only (python3 -m pip install pyyaml)")
        return None, [{"path": p} for p in paths]
    tree = Tree(top, rev)
    gate = Gate(tree, paths, why, state)
    closures = []   # (required entry, order, direct)
    for r in required:
        app = r.get("appId")
        if app is not None and app != ACTIONS_APP_ID:
            unmatched.append({"context": r["context"], "sources": r["sources"], "kind": "app", "appId": app})
            continue
        hits = gate.match(r["context"])
        if not hits:
            entry = {"context": r["context"], "sources": r["sources"], "kind": "context"}
            unmatched.append(entry)
            if state.get("listingCut"):
                why.append("%s: no job matched, and a file cap cut the workflow listing" % r["context"])
            continue
        order, direct = gate.closure(r["context"], hits)
        closures.append((r, order, direct))
    contexts, matched = {}, {}
    for r, order, direct in closures:
        for k in order:
            contexts.setdefault(k, []).append(r["context"])
        for k in direct:
            if r["context"] not in matched.setdefault(k, []):
                matched[k].append(r["context"])
    emitted, jobs = set(), []
    for r, order, _direct in closures:
        for k in order:
            if k in emitted:
                continue
            if len(jobs) >= MAX_JOBS:
                if not r.get("cut"):
                    r["cut"] = True
                    state["truncated"] = True
                    why.append("%s: its closure did not fit MAX_JOBS (%d jobs)" % (r["context"], MAX_JOBS))
                continue
            emitted.add(k)
            jobs.append(_record(gate, k, contexts[k], matched.get(k, []), state))
    workflows, seen = [], set()
    for j in jobs:
        for p in (j["workflow"], j.get("onFrom")):
            if p and p not in seen:
                seen.add(p)
                wf = tree.workflow(p)
                w = {"path": p}
                if "name" in wf:
                    w["name"] = wf["name"]
                w["on"] = wf["on"]
                workflows.append(w)
    return jobs, workflows


# ---- the gate ----------------------------------------------------------------------------------------------------

def gate(repo, top, branch, rev, gh_bin):
    why, state = [], {"truncated": False}
    out = {"status": "unreadable", "repo": None, "branch": branch, "tree": rev, "required": [], "workflows": [],
           "jobs": None, "unmatched": [], "truncated": False, "why": why}

    def done(status):
        out["status"] = status
        out["truncated"] = state["truncated"]
        return out

    try:
        slug = RS._origin_slug(repo)
    except RS.SettingsError as e:
        why.append("origin: %s" % e)
        return done("unreadable")
    except OSError as e:
        why.append("origin: %s" % (e.strerror or e))
        return done("unreadable")
    if slug is None:
        why.append("no GitHub origin")
        return done("unreadable")
    out["repo"] = slug
    required, unmatched = out["required"], out["unmatched"]
    bdata, b_ok, _ = _read(gh_bin, slug, "branches", branch, why)
    rdata, r_ok, more = _read(gh_bin, slug, "rules/branches", branch, why)
    full = _from_branch(bdata, branch, required, why) if b_ok else False
    if r_ok:
        _from_rules(rdata, required, unmatched)
        if more:
            why.append("rules/branches/%s: more than one page; only the first read" % branch)
            state["truncated"] = True
    if not b_ok:
        return done("unreadable")
    if not (required or unmatched):
        out["jobs"] = []   # nothing to read
        return done("none" if r_ok and full else "partial")
    jobs, workflows = read_jobs(top, rev, required, unmatched, why, state)
    out["jobs"], out["workflows"] = jobs, workflows
    return done("read" if r_ok and full and jobs is not None else "partial")


def main(argv=None):
    ap = argparse.ArgumentParser(prog="merge-gate.py", description="The facts of a repo's merge gate (read-only).")
    ap.add_argument("--repo", required=True)
    ap.add_argument("--branch", required=True)
    ap.add_argument("--tree", default=None)
    ap.add_argument("--gh-bin", default="gh")
    args = ap.parse_args(argv)
    if not args.branch.strip():
        ap.error("--branch is empty")
    repo = os.path.expanduser(args.repo)
    rev = args.tree or "origin/%s" % args.branch
    try:
        top = _toplevel(repo)
    except UsageError as e:
        sys.stderr.write("merge-gate: %s\n" % e)
        return 2
    try:
        out = gate(repo, top, args.branch, rev, args.gh_bin)
    except Exception as e:  # the guard: a fact reader never stops a schedule
        out = {"status": "unreadable", "repo": None, "branch": args.branch, "tree": rev, "required": [],
               "workflows": [], "jobs": None, "unmatched": [], "truncated": False,
               "why": ["merge-gate: %s: %s" % (type(e).__name__, e)]}
    sys.stdout.write(json.dumps(out, separators=(",", ":")) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
