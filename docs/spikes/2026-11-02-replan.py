# Re-run each orient-all serial batch through origin's serial-chains.py plan (read-only), then pairwise overlaps.
# Each hit pair is labelled by its widest hit: `checkout` (a bare repo: token, a whole vault or any, on either side),
# `folder` (a folder token) or `file`. The last line counts the chains, those with any clash, and the checkout-wide
# ones: chains whose own side of a hit is a whole checkout (ADR 0067 d4: only same-file overlaps should remain).
import json, subprocess, sys, importlib.util, itertools
sys.dont_write_bytecode = True  # import serial-chains without leaving __pycache__ in skills/
ARGS = sys.argv[1]; SC = "skills/_shared/scripts/serial-chains.py"
spec = importlib.util.spec_from_file_location("sc", SC); sc = importlib.util.module_from_spec(spec); spec.loader.exec_module(sc)
rows = []
for line in open(ARGS):
    if "|" not in line: continue
    n, proj, rest = [x.strip() for x in line.split("|", 2)]
    r = subprocess.run(["python3", SC, "plan"] + rest.split(" ", 1)[:1] + [rest.split(" ", 1)[1]], capture_output=True, text=True)
    if r.returncode != 0:
        rows.append((proj, None, (r.stdout + r.stderr).strip()[:300])); continue
    d = json.loads(r.stdout)
    for i, c in enumerate(d["chains"]):
        rows.append((f"{proj}#{i}", c["surfaces"], ""))
for p, s, e in rows: print(p, s if s is not None else "ERR " + e)


def width(t):
    """2 for a whole place (a bare repo: token, the whole vault, any), 1 for a folder, 0 for a file."""
    kind, value = sc.parse_token(t)
    if kind == "any" or (kind == "vault" and not value):
        return 2
    if kind == "repo":
        _top, rel, is_dir = sc.repo_parts(value)
        return 2 if rel is None else 1 if is_dir else 0
    if kind == "vault":
        return 0 if value.lower().endswith(".md") else 1
    return 0


LABELS = ("file", "folder", "checkout")
print("\nOVERLAPS")
ok = [(p, s) for p, s, _ in rows if s]
blk, wide = {}, set()
for (a, sa), (b, sb) in itertools.combinations(ok, 2):
    hits = [(x, y) for x in sa for y in sb if sc.overlaps(sc.parse_token(x), sc.parse_token(y))]
    if hits:
        blk.setdefault(a, set()).add(b); blk.setdefault(b, set()).add(a)
        top = max(hits, key=lambda h: max(width(h[0]), width(h[1])))
        if any(width(x) == 2 for x, _ in hits):
            wide.add(a)
        if any(width(y) == 2 for _, y in hits):
            wide.add(b)
        print(a, "<->", b, LABELS[max(width(top[0]), width(top[1]))], top)
print("\nchains", len(ok), "with any clash", len(blk), f"(checkout-wide {len(wide)})")
