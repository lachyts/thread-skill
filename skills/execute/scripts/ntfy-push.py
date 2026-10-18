#!/usr/bin/env python3
"""ntfy-push.py — the needs-you push's ntfy fallback (execute § 6.5 *The ntfy fallback*; ADR 0038 decision 3).

    python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/ntfy-push.py [--server URL] [--timeout SECONDS] <<'NEEDS_YOU_ITEM'
    <the one-line push message>
    NEEDS_YOU_ITEM

The execute lead runs it when `PushNotification` reports Remote Control inactive or an error, or when there is no push
tool (a Codex run, or ToolSearch cannot load it), with the same one-line message the push carried. It exists so the
lead never hand-builds JSON from a free-text message (gates carry quotes) and never handles the topic. python >= 3.8
syntax, stdlib plus curl. It writes nothing.

--server   the ntfy server, default https://ntfy.sh. It must start with http:// or https://. The seam for tests and
           for a self-hosted server.
--timeout  an integer from 1 to 600, default 20: curl's -m, which bounds the whole operation, DNS and TLS included. A
           backstop, subprocess.run(timeout=SECONDS + 5), kills a curl that outlives it.

Stdin is the message, exactly one line: one trailing newline (the heredoc's) is stripped, and any other \\n or \\r is
refused, so a stray newline never reaches the ntfy body unnoticed. An empty message is refused. Its length is not
policed: § 6.5 already cuts it to 200 characters.

The topic is `[notify] ntfy_topic` in ~/.config/thread/rollouts.toml, read through rollout-settings.py's resolve()
(repo=None, so git and land.sh never run). It travels only in the request body, so it never appears in a command line,
a URL, a curl error line, stdout or a transcript.

The publish is one JSON body, {"topic", "message", "title": "thread: needs you", "priority": 4}, json.dumps'd
(ASCII-escaped) and POSTed to --server with `curl -fsS -m <timeout> -H 'Content-Type: application/json' --data-binary
@- <server>`, the JSON on curl's stdin, never in argv, the URL or a header: python's own HTTPS to ntfy is flaky on this
Mac, and headers are latin-1, so an em dash in a Title header would break. curl's response body is discarded.

Order of checks: the arguments (exit 2), then stdin (exit 2), then the settings (exit 2 or 3), then the topic (exit 4),
then curl (exit 0 or 1).

Exit codes:
  0  sent. One stdout line, `ntfy-push: sent`, without the topic.
  4  no topic set. One stdout line, `ntfy-push: no [notify] ntfy_topic in <path>: fallback skipped`; no request made.
  1  delivery failed: curl exited non-zero, its -m bound was reached, the backstop fired, or curl cannot start. One
     stderr line, `ntfy-push: delivery failed: <reason>`, no traceback.
  2  a usage error, an empty or multi-line message, or a refused rollouts.toml (rollout-settings' own line, printed
     as `rollout-settings: <reason>`).
  3  rollouts.toml is present and this python has no tomllib, as the resolver reports it.
Any exit but 0 is logged `push failed:` by the lead (§ 6.5), so no report claims Lachy was told.
"""
import argparse
import importlib.util
import json
import os
import subprocess
import sys

# Set before any importlib load (rollout-settings.py, and through it ladder.py), as tune.py's _load does: a run
# without -B never writes a __pycache__ into the plugin directory.
sys.dont_write_bytecode = True

HERE = os.path.dirname(os.path.abspath(__file__))
SHARED = os.path.join(os.path.dirname(os.path.dirname(HERE)), "_shared", "scripts")
DEFAULT_SERVER = "https://ntfy.sh"
DEFAULT_TIMEOUT = 20
TIMEOUT_RANGE = (1, 600)
BACKSTOP = 5  # seconds past --timeout before the backstop kills curl
TITLE = "thread: needs you"
PRIORITY = 4  # ntfy's "high"


class Refused(Exception):
    def __init__(self, line, code):
        Exception.__init__(self, line)
        self.line = line
        self.code = code


class _Parser(argparse.ArgumentParser):
    def error(self, message):  # argparse's default prints multi-line usage; keep failures to one line
        raise Refused("ntfy-push: %s" % message, 2)


def _server(value):
    if not (value.startswith("http://") or value.startswith("https://")):
        raise argparse.ArgumentTypeError("must start with http:// or https://, got %s" % json.dumps(value))
    return value


def _timeout(value):
    try:
        n = int(value)
    except ValueError:
        n = None
    if n is None or str(n) != value.strip() or not TIMEOUT_RANGE[0] <= n <= TIMEOUT_RANGE[1]:
        raise argparse.ArgumentTypeError("must be an integer from %d to %d, got %s" % (TIMEOUT_RANGE + (json.dumps(value),)))
    return n


def _args(argv):
    parser = _Parser(prog="ntfy-push", description="Publish one needs-you item to the [notify] ntfy topic.")
    parser.add_argument("--server", type=_server, default=DEFAULT_SERVER, help="the ntfy server (default %(default)s)")
    parser.add_argument("--timeout", type=_timeout, default=DEFAULT_TIMEOUT,
                        help="curl's -m in seconds, %d to %d (default %%(default)s)" % TIMEOUT_RANGE)
    return parser.parse_args(argv)


def _message(raw):
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        raise Refused("ntfy-push: the message is not UTF-8", 2)
    if text.endswith("\n"):
        text = text[:-1]
    if "\n" in text or "\r" in text:
        raise Refused("ntfy-push: the message must be one line", 2)
    if not text.strip():
        raise Refused("ntfy-push: the message is empty", 2)
    return text


def _settings():
    spec = importlib.util.spec_from_file_location("thread_rollout_settings", os.path.join(SHARED, "rollout-settings.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    try:
        return mod.resolve(repo=None)
    except mod.SettingsError as e:
        raise Refused("rollout-settings: %s" % e, e.code)


def _one_line(text):
    lines = [l.strip() for l in text.splitlines() if l.strip()]
    return lines[-1] if lines else ""


def _send(server, timeout, body):
    """curl the body to the server; None when sent, else the one-line reason it was not."""
    cmd = ["curl", "-fsS", "-m", str(timeout), "-H", "Content-Type: application/json", "--data-binary", "@-", server]
    try:
        p = subprocess.run(cmd, input=body, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout + BACKSTOP)
    except subprocess.TimeoutExpired:  # run() has already killed curl
        return "curl still running after %ds: killed" % (timeout + BACKSTOP)
    except OSError as e:
        return "cannot run curl: %s" % (e.strerror or e)
    if p.returncode != 0:
        said = _one_line(p.stderr.decode("utf-8", "replace"))
        return "curl exit %d%s" % (p.returncode, ": " + said if said else "")
    return None


def main(argv):
    try:
        args = _args(argv)
        message = _message(sys.stdin.buffer.read())
        out = _settings()
    except Refused as e:
        sys.stderr.write(e.line + "\n")
        return e.code
    topic = out["notify"]["ntfy_topic"]["value"]
    if topic is None:
        sys.stdout.write("ntfy-push: no [notify] ntfy_topic in %s: fallback skipped\n" % out["path"])
        return 4
    body = json.dumps({"topic": topic, "message": message, "title": TITLE, "priority": PRIORITY}).encode("ascii")
    reason = _send(args.server, args.timeout, body)
    if reason is not None:
        sys.stderr.write("ntfy-push: delivery failed: %s\n" % reason)
        return 1
    sys.stdout.write("ntfy-push: sent\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
