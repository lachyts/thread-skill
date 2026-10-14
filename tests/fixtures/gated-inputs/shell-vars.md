<!-- Synthetic (tests/gated-inputs.test.mjs): its only dollar signs are shell variables, never an amount. -->

# A task that only names shell variables

Run ${CLAUDE_PLUGIN_ROOT}/skills/x.py from $HOME, then check `"$WT"` and `echo $?`.

The helper prints $(git rev-parse HEAD), and the wrapper passes `"$1"` through.

```bash
echo "$1"
cd "$WT"
```
