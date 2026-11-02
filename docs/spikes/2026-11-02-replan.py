# Re-run each orient-all serial batch through origin's serial-chains.py plan (read-only), then pairwise overlaps.
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
print("\nOVERLAPS")
git = sc.Git() if hasattr(sc, "Git") else None
ok = [(p, s) for p, s, _ in rows if s]
blk = {}
for (a, sa), (b, sb) in itertools.combinations(ok, 2):
    hits = [(x, y) for x in sa for y in sb if sc.overlaps(sc.parse_token(x), sc.parse_token(y))]
    if hits:
        blk.setdefault(a, set()).add(b); blk.setdefault(b, set()).add(a)
        print(a, "<->", b, hits[0])
print("\nchains", len(ok), "with any clash", len(blk))
