#!/usr/bin/env python3
"""A fake `gh` for tests/merge-gate.test.mjs: `gh api -i -H <accept> <endpoint>` in gh's own `-i` shape.

Its argv goes to $MG_LOG, one line per call. The rules endpoint (`…/rules/branches/…`, matched first) is served from
$MG_RULES and the branch endpoint (`…/branches/…`) from $MG_BRANCH. Each is a JSON body file (served as a 200) or one
of: 403 | 404 | 500 (gh's status line, headers, a blank line and an error body on stdout, `gh: <msg> (HTTP <code>)` on
stderr, exit 1), nologin (no status line, exit 4), badjson (a 200 whose body is not JSON), hang (writes its pid to
$MG_PIDS, then execs `sleep 120`). $MG_RULES_NEXT=1 adds a `Link: …; rel="next"` header to the rules response.
"""
import json
import os
import sys

REASONS = {200: "OK", 403: "Forbidden", 404: "Not Found", 500: "Internal Server Error"}


def respond(code, body, extra=()):
    # gh -i: the status line (Fprintln), each header line ending \r\n, a \r\n blank line, then the body.
    out = "HTTP/2.0 %d %s\n" % (code, REASONS[code])
    for h in ("Content-Type: application/json; charset=utf-8", "X-Github-Request-Id: FAKE:0001") + tuple(extra):
        out += h + "\r\n"
    sys.stdout.write(out + "\r\n" + body)
    sys.stdout.flush()


def main():
    log = os.environ.get("MG_LOG")
    if log:
        with open(log, "a") as f:
            f.write(json.dumps(sys.argv[1:]) + "\n")
    endpoint = sys.argv[-1] if len(sys.argv) > 1 else ""
    if "/rules/branches/" in endpoint:
        spec = os.environ.get("MG_RULES", "[]")
        extra = ('Link: <https://api.github.com/x?page=2>; rel="next"',) if os.environ.get("MG_RULES_NEXT") else ()
    elif "/branches/" in endpoint:
        spec, extra = os.environ.get("MG_BRANCH", "404"), ()
    else:
        sys.stderr.write("gh: fake-gh serves no %s\n" % endpoint)
        return 2
    if spec == "hang":
        pids = os.environ.get("MG_PIDS")
        if pids:
            with open(pids, "a") as f:
                f.write("%d\n" % os.getpid())
        os.execvp("sleep", ["sleep", "120"])
    if spec == "nologin":
        sys.stderr.write("To get started with GitHub CLI, please run:  gh auth login\n")
        return 4
    if spec == "badjson":
        respond(200, "<html>not json</html>", extra)
        return 0
    if spec in ("403", "404", "500"):
        code = int(spec)
        msg = {403: "Resource not accessible by integration", 404: "Branch not found", 500: "Server Error"}[code]
        respond(code, json.dumps({"message": msg, "status": spec}))
        sys.stderr.write("gh: %s (HTTP %d)\n" % (msg, code))
        return 1
    with open(spec) as f:
        respond(200, f.read(), extra)
    return 0


if __name__ == "__main__":
    sys.exit(main())
