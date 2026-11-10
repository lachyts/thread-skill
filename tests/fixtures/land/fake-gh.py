#!/usr/bin/env python3
"""Fake `gh` for tests/land.test.sh and tests/land-carrier.test.sh. Logs each argv as one line to $LOG_GH and serves
only the calls land.sh and land-carrier.py make, from state under $GH_STATE (prs.json newest first, a label marker, a PR
counter, the last comment's first three lines in comment.txt, every comment in comments/<o>/<r>/<n>.json, the last
created PR's body in body.txt, the runs a rerun asked for in reruns.txt).

Behaviour per call is chosen by environment variables (default in brackets):
  GH_ACCESS  [true]  true | false | null | empty | 404 | hang        GET repos/<o>/<r>
  GH_AUTOMERGE [true] true | false                                   GET repos/<o>/<r> without --jq: allow_auto_merge
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
  GH_COMMENTS [ok]   ok | fail                                       GET  …/issues/<n>/comments
  GH_LOGIN   [me]    the login `api user` reports and a created PR's author
  GH_SEARCH  [none]  none | prs | fail | hang                        search prs
  GH_PULL    [ok]    ok | fail                                       GET  …/pulls/<n> (an entry with hang: "pull" hangs)
  GH_COMMIT  [ok]    ok | fail                                       GET  …/commits/<sha>, …/compare/<a>...<b>
  GH_RERUN   [ok]    ok | fail                                       POST …/actions/runs/<run>/rerun-failed-jobs
  GH_PUTMERGE [ok]   ok | fail                                       PUT  …/pulls/<n>/merge
  GH_PATCH   [ok]    ok | fail                                       PATCH …/pulls/<n>
  GH_JOBS            "<run>:<conclusion>:<failed steps, |-separated>[;…]", the checks kind `jobs`
  GH_STEPS   [Run tests]  the single-run kinds' failed steps, |-separated (empty: no failed step)
  GH_SNAP    [unset] a file each PUT, POST, PATCH and `pr merge` first copies to $GH_STATE/snaps/<seq>-<verb>.json
  GH_CHECKS  [none]  the checks kind for any SHA GH_CHECKS_MAP does not name
  GH_CHECKS_MAP      "<sha>=<kind>[,<sha>=<kind>…]", a full SHA or a prefix of one
                                                                     GET …/commits/<sha>/check-runs, …/status
Checks kinds: none | pending | pass | neutral | fail | fail-notitle | status-fail | status-fail-nodesc |
cancelled | timed_out | startup_failure | action_required | status-error | stale | jobs | 404 | hang, served as REST
JSON (a check run named `build`, a GitHub Actions job of run 1, or one job per GH_JOBS entry, id run*10+i, named
job<i>; a status context `ci/legacy`); 404 exits 1 with gh's `gh: Not Found (HTTP 404)`.
fail-notitle is a failed run with `output.title: null`, as GitHub Actions reports one; status-fail-nodesc
is a failed status with `description: null`. `actions/runs/<run>/jobs` serves that run's GH_JOBS entries, else for run
1 one job with the conclusion of the single-run kind last served for it and GH_STEPS as failed steps (failure,
timed_out and startup_failure).
`pr list --head <b>` keeps PRs whose headRefName is <b>; `-R <o>/<r>` keeps PRs whose `repo` is that, when they have
one. A create records `repo` and writes refs/pull/<n>/head on the bare server; GH_UPDATE=merge really merges the
server's base branch into the PR's head branch as GitHub's update-branch does (committer GitHub
<noreply@github.com>) and moves refs/pull/<n>/head; an `expected_head_sha` that is not the server head is a 422.
`--auto` ok sets autoMergeRequest, `--disable-auto` ok clears it, a direct ok (or PUT merge) marks the PR MERGED.
`search prs` with GH_SEARCH=prs serves prs.json's open PRs by GH_LOGIN, filtered by --label (the entry's `labels`) and
--head (a prefix of headRefName). Optional prs.json fields: repo, labels (the label POST appends `landing`), draft,
strict [true], base [master], mergeableState (a string, or a list read one per GET, the last kept), hang.
GET pulls/<n> serves the REST shape: the head sha read live from the server; mergeable_state pinned, else computed
(base not in head: dirty on a merge-tree conflict, else behind when strict; base in head: clean when the head's checks
kind is pass, neutral or none, else unstable).
`pr edit` always fails with the projectCards deprecation error. A hang writes its pid to $GH_STATE/hang.pid, then runs
a non-exec `sleep 120 | cat`. `holdout` prints `false` and leaves a `sleep 120` holding stdout after exiting 0.
"""
import json
import os
import shutil
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
    with open(os.path.join(st, "hang.pid"), "w") as fh:
        fh.write("%d\n" % os.getpid())
    subprocess.run("sleep 120 | cat", shell=True)
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


def snap(verb):
    src = E("GH_SNAP")
    if not src or not os.path.isfile(src):
        return
    d = os.path.join(st, "snaps")
    os.makedirs(d, exist_ok=True)
    seq = len(os.listdir(d)) + 1
    shutil.copyfile(src, os.path.join(d, "%03d-%s.json" % (seq, verb)))


def repo_of(p):
    if p.get("repo"):
        return p["repo"]
    parts = (p.get("url") or "").split("/")
    return "/".join(parts[3:5]) if len(parts) > 4 else ""


if args[:2] == ["search", "prs"]:
    mode = E("GH_SEARCH", "none")
    if mode == "fail":
        die("gh: HTTP 401: Bad credentials (https://api.github.com/search/issues)")
    if mode == "hang":
        hang()
    prs = []
    if mode == "prs":
        label, head = opt("--label"), opt("--head")
        for p in load():
            if p.get("state") != "OPEN" or (p.get("author") or {}).get("login") != E("GH_LOGIN", "me"):
                continue
            if label and label not in (p.get("labels") or []):
                continue
            if head and not (p.get("headRefName") or "").startswith(head):
                continue
            r = repo_of(p)
            prs.append({"repository": {"name": r.split("/")[-1], "nameWithOwner": r}, "number": p["number"],
                        "url": p["url"]})
    print(json.dumps(prs[:int(opt("--limit", "30"))]))
    sys.exit(0)

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
    if "-R" in args:
        prs = [p for p in prs if not p.get("repo") or p["repo"] == opt("-R")]
    print(json.dumps(prs[:limit]))
    sys.exit(0)

def setpr(n, **kv):
    prs = load()
    for p in prs:
        if p["number"] == n:
            p.update(kv)
    save(prs)


if args[:2] == ["pr", "merge"]:
    snap("pr-merge")
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

method, ep, fields, jq = "GET", None, {}, False
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
    elif a in ("--jq", "-q"):
        jq = True
        i += 2
    elif a == "-H":
        i += 2
    elif a == "--paginate":
        i += 1
    else:
        if ep is None:
            ep = a
        i += 1
if ep == "user":
    print(E("GH_LOGIN", "me"))
    sys.exit(0)
if method != "GET":
    snap(method.lower())
parts = ep.split("?")[0].split("/")
owner, name, rest = parts[1], parts[2], parts[3:]
SLUG = owner + "/" + name
GIT_DIR = os.path.join(E("SRV", ""), owner, name + ".git")


def srvgit(*a, env=None):
    return subprocess.run(["git", "--git-dir", GIT_DIR] + list(a), capture_output=True, text=True, env=env)


def srvsha(ref):
    r = srvgit("rev-parse", "-q", "--verify", ref + "^{commit}")
    return r.stdout.strip() if r.returncode == 0 else ""


def find_pr(n):
    for p in load():
        if p["number"] == n and (not p.get("repo") or p["repo"] == SLUG):
            return p
    return None


def head_sha(p):
    return srvsha("refs/heads/" + p["headRefName"]) or p.get("headRefOid") or ""


def body_text():
    body = fields.get("body", "")
    if body.startswith("@"):
        body = open(body[1:]).read()
    return body


CHECK_RUN = {"id": 1, "name": "build", "html_url": "https://github.com/%s/%s/actions/runs/1" % (owner, name),
             "details_url": "https://github.com/%s/%s/actions/runs/1/job/1" % (owner, name),
             "app": {"slug": "github-actions"}}
KINDS = {
    "pending": ({"status": "in_progress", "conclusion": None, "output": {"title": None}}, None),
    "pass": ({"status": "completed", "conclusion": "success", "output": {"title": "All good"}}, None),
    "neutral": ({"status": "completed", "conclusion": "neutral", "output": {"title": "Nothing to do"}}, None),
    "fail": ({"status": "completed", "conclusion": "failure", "output": {"title": "Tests failed"}}, None),
    "fail-notitle": ({"status": "completed", "conclusion": "failure", "output": {"title": None}}, None),
    "cancelled": ({"status": "completed", "conclusion": "cancelled", "output": {"title": "Cancelled"}}, None),
    "timed_out": ({"status": "completed", "conclusion": "timed_out", "output": {"title": "Timed out"}}, None),
    "startup_failure": ({"status": "completed", "conclusion": "startup_failure", "output": {"title": None}}, None),
    "action_required": ({"status": "completed", "conclusion": "action_required", "output": {"title": None}}, None),
    "stale": ({"status": "completed", "conclusion": "stale", "output": {"title": None}}, None),
    "status-fail": (None, {"state": "failure", "description": "2 tests failed"}),
    "status-fail-nodesc": (None, {"state": "failure", "description": None}),
    "status-error": (None, {"state": "error", "description": "runner lost"}),
    "none": (None, None),
    "jobs": (None, None),
}
PASS = ("success", "neutral", "skipped")


def checks_kind(sha):
    for pair in [x for x in E("GH_CHECKS_MAP", "").split(",") if "=" in x]:
        k, _, v = pair.partition("=")
        if k and (sha.startswith(k) or k.startswith(sha)):
            return v
    return E("GH_CHECKS", "none")


def gh_jobs():
    """GH_JOBS as [(run, conclusion, [failed steps]), …]."""
    out = []
    for item in [x for x in E("GH_JOBS", "").split(";") if x]:
        run, conc, steps = (item.split(":", 2) + ["", ""])[:3]
        out.append((int(run), conc, [s for s in steps.split("|") if s]))
    return out


def job_runs():
    runs = []
    for i, (run, conc, _) in enumerate(gh_jobs()):
        done = conc != "pending"
        runs.append({"id": run * 10 + i, "name": "job%d" % i, "status": "completed" if done else "in_progress",
                     "conclusion": conc if done else None, "output": {"title": None},
                     "html_url": "https://github.com/%s/%s/actions/runs/%d/job/%d" % (owner, name, run, run * 10 + i),
                     "details_url": "https://github.com/%s/%s/actions/runs/%d/job/%d" % (owner, name, run, run * 10 + i),
                     "app": {"slug": "github-actions"}})
    return runs


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
        if kind == "jobs":
            runs = job_runs()
        else:
            runs = [dict(CHECK_RUN, **run)] if run else []
            if run:
                os.makedirs(os.path.join(st, "runs"), exist_ok=True)
                with open(os.path.join(st, "runs", "1.kind"), "w") as fh:
                    fh.write(kind)
        print(json.dumps({"total_count": len(runs), "check_runs": runs}))
    else:
        sts = [dict({"context": "ci/legacy", "target_url": "https://ci.example/1"}, **status)] if status else []
        print(json.dumps({"state": sts[0]["state"] if sts else "pending", "statuses": sts}))
    sys.exit(0)

if method == "GET" and rest[:2] == ["actions", "runs"] and rest[3:] == ["jobs"]:
    run = int(rest[2])
    listed = [(i, r, c, s) for i, (r, c, s) in enumerate(gh_jobs()) if r == run]
    jobs = []
    if listed:
        for i, r, c, s in listed:
            jobs.append({"id": r * 10 + i, "name": "job%d" % i, "status": "completed" if c != "pending" else "in_progress",
                         "conclusion": c if c != "pending" else None,
                         "steps": [{"name": "Set up job", "conclusion": "success"}]
                         + [{"name": x, "conclusion": "failure"} for x in s]})
    else:
        try:
            kind = open(os.path.join(st, "runs", "%d.kind" % run)).read().strip()
        except OSError:
            kind = ""
        if kind in KINDS and KINDS[kind][0]:
            conc = KINDS[kind][0]["conclusion"] or None
            steps = [x for x in E("GH_STEPS", "Run tests").split("|") if x] \
                if conc in ("failure", "timed_out", "startup_failure") else []
            jobs.append({"id": 1, "name": "build", "status": "completed" if conc else "in_progress", "conclusion": conc,
                         "steps": [{"name": "Set up job", "conclusion": "success"}]
                         + [{"name": x, "conclusion": "failure"} for x in steps]})
    print(json.dumps({"total_count": len(jobs), "jobs": jobs}))
    sys.exit(0)

if method == "POST" and rest[:2] == ["actions", "runs"] and rest[3:] == ["rerun-failed-jobs"]:
    if E("GH_RERUN", "ok") == "fail":
        die("gh: This workflow run cannot be rerun (HTTP 403)")
    with open(os.path.join(st, "reruns.txt"), "a") as fh:
        fh.write(rest[2] + "\n")
    sys.exit(0)

if method == "GET" and rest[:1] == ["commits"] and len(rest) == 2:
    if E("GH_COMMIT", "ok") == "fail":
        die("gh: Server Error (HTTP 502)")
    sha = srvsha(rest[1])
    if not sha:
        die("gh: No commit found for SHA: %s (HTTP 422)" % rest[1])
    r = srvgit("log", "-1", "--format=%P%n%ce", sha).stdout.split("\n")
    print(json.dumps({"sha": sha, "parents": [{"sha": x} for x in r[0].split()],
                      "commit": {"committer": {"email": r[1] if len(r) > 1 else ""}}}))
    sys.exit(0)

if method == "GET" and rest[:1] == ["compare"]:
    if E("GH_COMMIT", "ok") == "fail":
        die("gh: Server Error (HTTP 502)")
    a, _, b = "/".join(rest[1:]).partition("...")
    sa, sb = srvsha(a) or srvsha("refs/heads/" + a), srvsha(b) or srvsha("refs/heads/" + b)
    if not sa or not sb:
        die("gh: Not Found (HTTP 404)")
    anc = lambda x, y: srvgit("merge-base", "--is-ancestor", x, y).returncode == 0
    status = "identical" if sa == sb else "behind" if anc(sb, sa) else "ahead" if anc(sa, sb) else "diverged"
    print(json.dumps({"status": status}))
    sys.exit(0)

if method == "GET" and rest[:1] == ["issues"] and rest[2:] == ["comments"]:
    if E("GH_COMMENTS", "ok") == "fail":
        die("gh: Server Error (HTTP 502)")
    try:
        cs = json.load(open(os.path.join(st, "comments", owner, name, rest[1] + ".json")))
    except FileNotFoundError:
        cs = []
    print(json.dumps([{"id": c["id"], "user": c["user"], "body": c["body"]} for c in cs]))
    sys.exit(0)

if method == "POST" and rest[:1] == ["issues"] and rest[2:] == ["comments"]:
    if E("GH_COMMENT", "ok") == "fail":
        die("gh: Resource not accessible by integration (HTTP 403)")
    body = body_text()
    with open(os.path.join(st, "comment.txt"), "w") as fh:
        fh.write("\n".join(body.split("\n")[:3]) + "\n")
    d = os.path.join(st, "comments", owner, name)
    os.makedirs(d, exist_ok=True)
    f = os.path.join(d, rest[1] + ".json")
    try:
        cs = json.load(open(f))
    except FileNotFoundError:
        cs = []
    cid = max([c["id"] for c in cs] + [0]) + 1
    p = find_pr(int(rest[1]))
    cs.append({"id": cid, "user": {"login": E("GH_LOGIN", "me")}, "body": body, "head": head_sha(p) if p else ""})
    json.dump(cs, open(f, "w"))
    print(json.dumps({"id": cid}))
    sys.exit(0)

if method == "GET" and not rest:
    mode = E("GH_ACCESS", "true")
    if mode == "hang":
        hang()
    if mode == "404":
        die("gh: Not Found (HTTP 404)")
    if jq:
        print("" if mode == "empty" else mode)
    else:
        perms = {} if mode == "empty" else {"push": {"true": True, "false": False}.get(mode)}
        print(json.dumps({"full_name": SLUG, "allow_auto_merge": E("GH_AUTOMERGE", "true") == "true",
                          "permissions": perms}))
    sys.exit(0)

if method == "GET" and rest[:1] == ["branches"]:
    mode = E("GH_PROT", "true")
    if mode == "hang":
        hang()
    if mode == "404":
        die("gh: Branch not found (HTTP 404)")
    if mode == "holdout":
        print("false", flush=True)
        subprocess.Popen(["sleep", "120"])
        sys.exit(0)
    print(mode)
    sys.exit(0)

if method == "GET" and rest[:1] == ["pulls"] and len(rest) == 2:
    n = int(rest[1])
    p = find_pr(n)
    if p and p.get("hang") == "pull":
        hang()
    if E("GH_PULL", "ok") == "fail":
        die("gh: Server Error (HTTP 502)")
    if not p:
        die("gh: Not Found (HTTP 404)")
    base = p.get("base") or "master"
    head = head_sha(p)
    btip = srvsha("refs/heads/" + base)
    ms = p.get("mergeableState")
    if isinstance(ms, list):
        cur = ms[0] if ms else "unknown"
        if len(ms) > 1:
            setpr(n, mergeableState=ms[1:])
        ms = cur
    if not ms:
        if btip and head and srvgit("merge-base", "--is-ancestor", btip, head).returncode != 0:
            if srvgit("merge-tree", "--write-tree", head, btip).returncode == 1:
                ms = "dirty"
            elif p.get("strict", True):
                ms = "behind"
        if not ms:
            kind = checks_kind(head)
            if kind == "jobs":
                ms = "clean" if all(c in PASS for _, c, _ in gh_jobs()) else "unstable"
            else:
                ms = "clean" if kind in ("pass", "neutral", "none") else "unstable"
    state = p.get("state")
    hrepo = None if p.get("headRepoGone") else {"full_name": ("fork/" + name) if p.get("isCrossRepository") else SLUG}
    print(json.dumps({
        "number": n, "html_url": p["url"], "state": "open" if state == "OPEN" else "closed",
        "merged": state == "MERGED", "draft": bool(p.get("draft")),
        "user": {"login": (p.get("author") or {}).get("login")},
        "head": {"ref": p["headRefName"], "sha": head, "repo": hrepo},
        "base": {"ref": base, "sha": btip, "repo": {"full_name": SLUG}},
        "auto_merge": {"merge_method": "merge"} if p.get("autoMergeRequest") else None,
        "mergeable_state": ms, "labels": [{"name": x} for x in (p.get("labels") or [])],
    }))
    sys.exit(0)

if method == "PUT" and rest[:1] == ["pulls"] and rest[2:] == ["merge"]:
    if E("GH_PUTMERGE", "ok") == "fail":
        die("gh: Base branch was modified. Review and try the merge again. (HTTP 405)")
    n = int(rest[1])
    p = find_pr(n)
    if not p:
        die("gh: Not Found (HTTP 404)")
    if fields.get("sha") and fields["sha"] != head_sha(p):
        die("gh: Head branch was modified. Review and try the merge again. (HTTP 409)")
    setpr(n, state="MERGED")
    print(json.dumps({"merged": True, "sha": head_sha(p)}))
    sys.exit(0)

if method == "PATCH" and rest[:1] == ["pulls"] and len(rest) == 2:
    if E("GH_PATCH", "ok") == "fail":
        die("gh: Validation Failed (HTTP 422)")
    n = int(rest[1])
    if fields.get("state") in ("open", "closed"):
        setpr(n, state=fields["state"].upper())
    print("{}")
    sys.exit(0)

if method == "POST" and rest == ["pulls"]:
    mode = E("GH_CREATE", "ok")
    if mode == "fail":
        die("gh: Validation Failed (HTTP 422)")
    body = body_text()
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
                   "autoMergeRequest": None, "repo": SLUG})
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
    p = find_pr(int(rest[1]))
    if p is not None and "landing" not in (p.get("labels") or []):
        setpr(p["number"], labels=(p.get("labels") or []) + ["landing"])
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
    n = int(rest[1])
    pr = find_pr(n) or [p for p in load() if p["number"] == n][0]
    if fields.get("expected_head_sha") and fields["expected_head_sha"] != head_sha(pr):
        die("gh: expected head sha didn't match current head ref. (HTTP 422)")
    if E("GH_UPDATE", "ok") == "merge":
        head = pr["headRefName"]
        with tempfile.TemporaryDirectory() as tdir:
            c = os.path.join(tdir, "c")
            env = {k: v for k, v in os.environ.items() if k not in ("GIT_DIR", "GIT_WORK_TREE")}
            menv = dict(env, GIT_COMMITTER_NAME="GitHub", GIT_COMMITTER_EMAIL="noreply@github.com")
            for cmd, e in ((["git", "clone", "-q", "-b", head, GIT_DIR, c], env),
                           (["git", "-C", c, "merge", "-q", "--no-ff", "--no-edit", "origin/" + (pr.get("base") or "master")], menv),
                           (["git", "-C", c, "push", "-q", "origin", "HEAD:refs/heads/" + head], env)):
                r = subprocess.run(cmd, capture_output=True, text=True, env=e)
                if r.returncode:
                    die("fake gh: update-branch merge failed: " + r.stderr.strip())
        oid = srvgit("rev-parse", "refs/heads/" + head).stdout.strip()
        srvgit("update-ref", "refs/pull/%d/head" % n, oid)
        setpr(n, headRefOid=oid)
    print('{"message":"Updating pull request branch."}')
    sys.exit(0)

die("fake gh: unhandled api: %s %s" % (method, ep))
