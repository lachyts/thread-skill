# Native review-path preparation

Three archival definition templates for the separate
[six-child check](../../handoffs/2026-09-23-claude-review-path-check.md).
The coordinator copies them, byte-for-byte, only to the new private check
directory's `.claude/agents/` before a fresh Claude session starts there. That
directory's `preparation.json` pins source commits and these exact bytes.
No user-level agent, shared profile, installed skill or old evidence is changed.

`max` is the supported label observed in the earlier Claude 2.1.280 check. The
fresh native check must establish the actual runtime and capability list again.
If it no longer names the maximum, report a preparation mismatch before dispatch;
do not silently relabel an old template or lower the binding. Startup availability
and actual wrapper/fork effort are untested until the new native check runs.

All three wrappers allow Skill so the exact resolved review route can invoke
the unmodified built-in. The built-in command level is always xhigh; a maximum
reasoning definition does not authorise `/code-review ultra`. Both wrapper and
fork spend the same pair reservation. The templates are not a second reviewer
implementation and must not be used to replace the built-in.

At close, remove a temporary project definition only if its current hash still
matches the manifest. Keep these archival copies, native evidence and spending
record. A resumed session cannot restart the six-slot allowance.
