#!/usr/bin/env python3
"""Fake `gh` for tests/land.test.sh. Logs each argv as one line to $LOG_GH and serves only the calls
land.sh makes, from state under $GH_STATE (prs.json newest first, a label marker, a PR counter).

Behaviour per call is chosen by environment variables (default in brackets):
  GH_ACCESS  [true]  true | false | null | empty | 404 | hang        GET repos/<o>/<r>
  GH_PROT    [true]  true | false | 404 | hang | holdout             GET repos/<o>/<r>/branches/<b>
  GH_CREATE  [ok]    ok | fail | hang-after-create                   POST repos/<o>/<r>/pulls
  GH_LABELS  [ok]    ok | 404-then-ok | 404 | hang                   POST …/issues/<n>/labels
  GH_LABELCREATE [ok] ok | 422 | hang                                POST …/labels
  GH_UPDATE  [ok]    ok | fail                                       PUT  …/pulls/<n>/update-branch
  GH_LIST    [ok]    ok | fail | hang | badjson    (GH_LIST_ALL overrides it for --state all)
  GH_MERGE   [ok]    ok | notallowed | clean | hang                  pr merge <n> --auto --merge
`pr edit` always fails with the projectCards deprecation error. A hang runs a non-exec `sleep 40 | cat`.
`holdout` prints `false` and leaves a `sleep 40` holding stdout after exiting 0.
"""
import json
import os
import subprocess
import sys

args = sys.argv[1:]
with open(os.environ["LOG_GH"], "a") as f:
    f.write(" ".join(args) + "\n")
st = os.environ["GH_STATE"]
os.makedirs(st, exist_ok=True)
E = os.environ.get
PRS = os.path.join(st, "prs.json")


def hang():
    subprocess.run("sleep 40 | cat", shell=True)
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
    print(json.dumps(prs[:limit]))
    sys.exit(0)

if args[:2] == ["pr", "merge"]:
    n = int(args[2])
    mode = E("GH_MERGE", "ok")
    if mode == "hang":
        hang()
    if mode == "notallowed":
        die("GraphQL: Auto merge is not allowed for this repository (enablePullRequestAutoMerge)")
    if mode == "clean":
        die("GraphQL: Pull request Pull request is in clean status (enablePullRequestAutoMerge)")
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
parts = ep.split("/")
owner, name, rest = parts[1], parts[2], parts[3:]

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
        subprocess.Popen(["sleep", "40"])
        sys.exit(0)
    print(mode)
    sys.exit(0)

if method == "POST" and rest == ["pulls"]:
    mode = E("GH_CREATE", "ok")
    if mode == "fail":
        die("gh: Validation Failed (HTTP 422)")
    head = fields["head"]
    oid = subprocess.run(["git", "--git-dir", os.path.join(E("SRV"), owner, name + ".git"), "rev-parse",
                          "refs/heads/" + head], capture_output=True, text=True).stdout.strip()
    prs = load()
    n = max([p["number"] for p in prs] + [0]) + 1
    url = "https://github.com/%s/%s/pull/%d" % (owner, name, n)
    prs.insert(0, {"number": n, "url": url, "state": "OPEN", "headRefName": head, "headRefOid": oid,
                   "isCrossRepository": False, "title": fields.get("title"),
                   "base": fields.get("base")})
    save(prs)
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
    print('{"message":"Updating pull request branch."}')
    sys.exit(0)

die("fake gh: unhandled api: %s %s" % (method, ep))
