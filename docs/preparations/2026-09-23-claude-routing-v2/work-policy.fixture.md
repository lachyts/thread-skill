# Claude routing work policy

- Observed bindings: claude-opus-5-5 high, xhigh and max; claude-fable-5-1 max (Claude Code 2.1.280, 2026-09-23).
- Requested, resolved and runtime-observed model/effort are separate evidence; a requested or resolved setting is not an observation.
- Routing: normal work uses high for easy tasks and xhigh for hard tasks; the first substantive quality failure uses the same model's supported maximum.
- Recovery: only a failed maximum-effort quality correction may select available Fable at its supported maximum; verified Fable unavailability retains Opus maximum within remaining allowance.
- Infrastructure, missing authority, quota and schema failures do not count as quality failures.
- Calls and verifier reservations share the original task pool; spent, refused and interrupted reservations stay spent, and transitions never renew allowance.
- The maximum-effort capability probes used synthetic selectors; they do not prove a genuine quality-failure/correction transition, dependency release or ownership recovery.
