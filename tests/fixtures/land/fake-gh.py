#!/usr/bin/env python3
"""Fake `gh` for tests/land.test.sh. Logs each argv as one line to $LOG_GH and serves only the calls
land.sh makes, from state under $GH_STATE (prs.json newest first, a label marker, a PR counter, the last
hold comment's first three lines in comment.txt, the last created PR's body in body.txt).

Behaviour per call is chosen by environment variables (default in brackets):
  GH_ACCESS  [true]  true | false | null | empty | 404 | hang        GET repos/<o>/<r>
  GH_PROT    [true]  true | false | 404 | hang | holdout             GET repos/<o>/<r>/branches/<b>
  GH_CREATE  [ok]    ok | fail | hang-after-create                   POST repos/<o>/<r>/pulls
  GH_LABELS  [ok]    ok | 404-then-ok | 404 | hang                   POST …/issues/<n>/labels
  GH_LABELCREATE [ok] ok | 422 | hang                                POST …/labels
  GH_UPDATE  [ok]    ok | fail | merge                               PUT  …/pulls/<n>/update-branch
  GH_LIST    [ok]    ok | fail | hang | badjson    (GH_LIST_ALL overrides it for --state all)
  GH_MERGE   [ok]    ok | notallowed | clean | hang                  pr merge <n> --auto --merge
  GH_DIRECT  [ok]    ok | fail                                       pr merge <n> --merge (no --auto)
  GH_DISABLE [ok]    ok | fail                                       pr merge <n> --disable-auto
  GH_COMMENT [ok]    ok | fail                                       POST …/issues/<n>/comments
  GH_LOGIN   [me]    the login `api user` reports and a created PR's author
  GH_CHECKS  [none]  the checks kind for any SHA GH_CHECKS_MAP does not name
  GH_CHECKS_MAP      "<sha>=<kind>[,<sha>=<kind>…]", a full SHA or a prefix of one
                                                                     GET …/commits/<sha>/check-runs, …/status
Checks kinds: none | pending | pass | neutral | fail | fail-notitle | status-fail | status-fail-nodesc |
cancelled | timed_out | startup_failure | status-error | stale | 404 | hang, served as REST JSON (a check
run named `build`, a status context `ci/legacy`); 404 exits 1 with gh's `gh: Not Found (HTTP 404)`.
fail-notitle is a failed run with `output.title: null`, as GitHub Actions reports one; status-fail-nodesc
is a failed status with `description: null`.
`pr list --head <b>` keeps PRs whose headRefName is <b>. A create writes refs/pull/<n>/head on the bare
server; GH_UPDATE=merge really merges server master into the PR's head branch and moves refs/pull/<n>/head;
`--auto` ok sets autoMergeRequest, `--disable-auto` ok clears it, a direct ok marks the PR MERGED.
`pr edit` always fails with the projectCards deprecation error. A hang runs a non-exec `sleep 600 | cat`.
`holdout` prints `false` and leaves a `sleep 600` holding stdout after exiting 0.
"""
import json
import os
import subprocess
import sys
import tempfile

args = sys.argv[1:]
with open(os.environ["LOG_GH"], "a") as f:
    f.write(" ".join(args) + "\n")
st = os.environ["GH_STATE"]
os.makedirs(st, exist_ok=True)
E = os.environ.get
PRS = os.path.join(st, "prs.json")


def hang():
    subprocess.run("sleep 600 | cat", shell=True)
    sys.exit(1)


def die(msg, out=None):
    if out:
        print(out)
    sys.stderr.write(msg + "\n")
    sys.exit(1)


def load():
    try:
        with open(PRS) as fh:
            return json.load(fh)
    except FileNotFoundError:
        return []


def save(prs):
    with open(PRS, "w") as fh:
        json.dump(prs, fh)


def opt(name, default=None):
    return args[args.index(name) + 1] if name in args else default


if args[:2] == ["pr", "list"]:
    state = opt("--state", "open")
    limit = int(opt("--limit", "30"))
    mode = E("GH_LIST", "ok")
    if state == "all":
        mode = E("GH_LIST_ALL", mode)
    if mode == "fail":
        die("gh: Server Error (HTTP 502)")
    if mode == "hang":
        hang()
    if mode == "badjson":
        print("not json")
        sys.exit(0)
    prs = load()
    if state != "all":
        prs = [p for p in prs if p["state"] == state.upper()]
    if "--head" in args:
        prs = [p for p in prs if p.get("headRefName") == opt("--head")]
    print(json.dumps(prs[:limit]))
    sys.exit(0)

def setpr(n, **kv):
    prs = load()
    for p in prs:
        if p["number"] == n:
            p.update(kv)
    save(prs)


if args[:2] == ["pr", "merge"]:
    n = int(args[2])
    if "--disable-auto" in args:
        if E("GH_DISABLE", "ok") == "fail":
            die("GraphQL: Could not disable auto-merge (disablePullRequestAutoMerge)")
        setpr(n, autoMergeRequest=None)
        sys.exit(0)
    if "--auto" not in args:
        if E("GH_DIRECT", "ok") == "fail":
            die("GraphQL: Base branch was modified. Review and try the merge again. (mergePullRequest)")
        setpr(n, state="MERGED")
        sys.exit(0)
    mode = E("GH_MERGE", "ok")
    if mode == "hang":
        hang()
    if mode == "notallowed":
        die("GraphQL: Auto merge is not allowed for this repository (enablePullRequestAutoMerge)")
    if mode == "clean":
        die("GraphQL: Pull request Pull request is in clean status (enablePullRequestAutoMerge)")
    setpr(n, autoMergeRequest={"mergeMethod": "MERGE"})
    sys.exit(0)

if args[:2] == ["pr", "edit"]:
    die("GraphQL: Projects (classic) is being deprecated in favor of the new Projects experience, "
        "see: https://github.blog/changelog/2024-05-23-sunset-notice-projects-classic/. "
        "(repository.pullRequest.projectCards)")

if args[:1] != ["api"]:
    die("fake gh: unhandled: " + " ".join(args))

method, ep, fields = "GET", None, {}
i = 1
while i < len(args):
    a = args[i]
    if a in ("--method", "-X"):
        method = args[i + 1]
        i += 2
    elif a in ("-f", "-F", "--raw-field", "--field"):
        k, _, v = args[i + 1].partition("=")
        fields[k] = v
        i += 2
    elif a in ("--jq", "-q", "-H"):
        i += 2
    else:
        if ep is None:
            ep = a
        i += 1
if ep == "user":
    print(E("GH_LOGIN", "me"))
    sys.exit(0)
parts = ep.split("?")[0].split("/")
owner, name, rest = parts[1], parts[2], parts[3:]
GIT_DIR = os.path.join(E("SRV", ""), owner, name + ".git")


def srvgit(*a):
    return subprocess.run(["git", "--git-dir", GIT_DIR] + list(a), capture_output=True, text=True)


CHECK_RUN = {"id": 1, "name": "build", "html_url": "https://github.com/%s/%s/actions/runs/1" % (owner, name)}
KINDS = {
    "pending": ({"status": "in_progress", "conclusion": None, "output": {"title": None}}, None),
    "pass": ({"status": "completed", "conclusion": "success", "output": {"title": "All good"}}, None),
    "neutral": ({"status": "completed", "conclusion": "neutral", "output": {"title": "Nothing to do"}}, None),
    "fail": ({"status": "completed", "conclusion": "failure", "output": {"title": "Tests failed"}}, None),
    "fail-notitle": ({"status": "completed", "conclusion": "failure", "output": {"title": None}}, None),
    "cancelled": ({"status": "completed", "conclusion": "cancelled", "output": {"title": "Cancelled"}}, None),
    "timed_out": ({"status": "completed", "conclusion": "timed_out", "output": {"title": "Timed out"}}, None),
    "startup_failure": ({"status": "completed", "conclusion": "startup_failure", "output": {"title": None}}, None),
    "stale": ({"status": "completed", "conclusion": "stale", "output": {"title": None}}, None),
    "status-fail": (None, {"state": "failure", "description": "2 tests failed"}),
    "status-fail-nodesc": (None, {"state": "failure", "description": None}),
    "status-error": (None, {"state": "error", "description": "runner lost"}),
    "none": (None, None),
}


def checks_kind(sha):
    for pair in [x for x in E("GH_CHECKS_MAP", "").split(",") if "=" in x]:
        k, _, v = pair.partition("=")
        if k and (sha.startswith(k) or k.startswith(sha)):
            return v
    return E("GH_CHECKS", "none")


if method == "GET" and rest[:1] == ["commits"] and rest[2:] in (["check-runs"], ["status"]):
    kind = checks_kind(rest[1])
    if kind == "hang":
        hang()
    if kind == "404":
        die("gh: Not Found (HTTP 404)")
    if kind not in KINDS:
        die("fake gh: unknown checks kind " + kind)
    run, status = KINDS[kind]
    if rest[2] == "check-runs":
        runs = [dict(CHECK_RUN, **run)] if run else []
        print(json.dumps({"total_count": len(runs), "check_runs": runs}))
    else:
        sts = [dict({"context": "ci/legacy", "target_url": "https://ci.example/1"}, **status)] if status else []
        print(json.dumps({"state": sts[0]["state"] if sts else "pending", "statuses": sts}))
    sys.exit(0)

if method == "POST" and rest[:1] == ["issues"] and rest[2:] == ["comments"]:
    if E("GH_COMMENT", "ok") == "fail":
        die("gh: Resource not accessible by integration (HTTP 403)")
    body = fields.get("body", "")
    if body.startswith("@"):
        body = open(body[1:]).read()
    with open(os.path.join(st, "comment.txt"), "w") as fh:
        fh.write("\n".join(body.split("\n")[:3]) + "\n")
    print('{"id": 1}')
    sys.exit(0)

if method == "GET" and not rest:
    mode = E("GH_ACCESS", "true")
    if mode == "hang":
        hang()
    if mode == "404":
        die("gh: Not Found (HTTP 404)")
    print("" if mode == "empty" else mode)
    sys.exit(0)

if method == "GET" and rest[:1] == ["branches"]:
    mode = E("GH_PROT", "true")
    if mode == "hang":
        hang()
    if mode == "404":
        die("gh: Branch not found (HTTP 404)")
    if mode == "holdout":
        print("false", flush=True)
        subprocess.Popen(["sleep", "600"])
        sys.exit(0)
    print(mode)
    sys.exit(0)

if method == "POST" and rest == ["pulls"]:
    mode = E("GH_CREATE", "ok")
    if mode == "fail":
        die("gh: Validation Failed (HTTP 422)")
    body = fields.get("body", "")
    if body.startswith("@"):
        body = open(body[1:]).read()
    with open(os.path.join(st, "body.txt"), "w") as fh:
        fh.write(body)
    head = fields["head"]
    oid = srvgit("rev-parse", "refs/heads/" + head).stdout.strip()
    prs = load()
    n = max([p["number"] for p in prs] + [0]) + 1
    url = "https://github.com/%s/%s/pull/%d" % (owner, name, n)
    prs.insert(0, {"number": n, "url": url, "state": "OPEN", "headRefName": head, "headRefOid": oid,
                   "isCrossRepository": False, "title": fields.get("title"),
                   "base": fields.get("base"), "author": {"login": E("GH_LOGIN", "me")},
                   "autoMergeRequest": None})
    save(prs)
    if oid:
        srvgit("update-ref", "refs/pull/%d/head" % n, oid)
    if mode == "hang-after-create":
        hang()
    print("%d\t%s" % (n, url))
    sys.exit(0)

if method == "POST" and rest[:1] == ["issues"] and rest[2:] == ["labels"]:
    mode = E("GH_LABELS", "ok")
    if mode == "hang":
        hang()
    marker = os.path.join(st, "label-created")
    if mode == "404" or (mode == "404-then-ok" and not os.path.exists(marker)):
        die("gh: Label does not exist (HTTP 404)", out='{"message":"Not Found"}')
    print('[{"name":"landing"}]')
    sys.exit(0)

if method == "POST" and rest == ["labels"]:
    mode = E("GH_LABELCREATE", "ok")
    if mode == "hang":
        hang()
    open(os.path.join(st, "label-created"), "w").close()
    if mode == "422":
        die("gh: Validation Failed (HTTP 422)",
            out='{"message":"Validation Failed","errors":[{"resource":"Label","code":"already_exists","field":"name"}]}')
    print('{"name":"landing"}')
    sys.exit(0)

if method == "PUT" and rest[:1] == ["pulls"] and rest[2:] == ["update-branch"]:
    if E("GH_UPDATE", "ok") == "fail":
        die("gh: merge conflict between base and head (HTTP 422)")
    if E("GH_UPDATE", "ok") == "merge":
        n = int(rest[1])
        pr = [p for p in load() if p["number"] == n][0]
        head = pr["headRefName"]
        with tempfile.TemporaryDirectory() as tdir:
            c = os.path.join(tdir, "c")
            env = {k: v for k, v in os.environ.items() if k not in ("GIT_DIR", "GIT_WORK_TREE")}
            for cmd in (["git", "clone", "-q", "-b", head, GIT_DIR, c],
                        ["git", "-C", c, "merge", "-q", "--no-ff", "--no-edit", "origin/master"],
                        ["git", "-C", c, "push", "-q", "origin", "HEAD:refs/heads/" + head]):
                r = subprocess.run(cmd, capture_output=True, text=True, env=env)
                if r.returncode:
                    die("fake gh: update-branch merge failed: " + r.stderr.strip())
        oid = srvgit("rev-parse", "refs/heads/" + head).stdout.strip()
        srvgit("update-ref", "refs/pull/%d/head" % n, oid)
        setpr(n, headRefOid=oid)
    print('{"message":"Updating pull request branch."}')
    sys.exit(0)

die("fake gh: unhandled api: %s %s" % (method, ep))
