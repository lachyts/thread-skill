# Shared assertions for tests/*.test.sh. Source it from the repo root: `. tests/lib/assert.sh`.
fail=0
ok() { if [ "$1" = "$2" ]; then echo "ok   - $3"; else echo "FAIL - $3: expected [$2] got [$1]"; fail=1; fi; }
has() { case "$1" in *"$2"*) ok y y "$3";; *) ok n y "$3";; esac; }
