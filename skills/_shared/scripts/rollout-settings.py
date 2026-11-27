#!/usr/bin/env python3
"""rollout-settings.py — resolve the operator's rollout settings (p15-4; ADR 0032, a Tuning's home).

    python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/rollout-settings.py [--repo <dir>]
    python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/rollout-settings.py declare --key <key>
        (--value '<JSON>' | --remove) --words "<his words, quoted>" --said <YYYY-MM-DD>
        [--source "<where he said it>"] [--repo <dir>] [--config <path>] [--tasks-dir <dir>] [--dry-run]
    python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/rollout-settings.py undo --id <id>
        --words "<his words, quoted>" --said <YYYY-MM-DD> [--source "<where he said it>"]
        [--config <path>] [--tasks-dir <dir>] [--dry-run]

The file is `~/.config/thread/rollouts.toml`, a sibling of ADR 0029's `ladder.toml` (HOME is honoured; there
is no env override). Stdlib only. The first form, the resolver, writes nothing; `declare` and `undo` (Declaring,
below) are the only forms that write. No form makes a network call. This header is the one copy of the file format
and of the writer's rules:

    # ~/.config/thread/rollouts.toml
    schema = 10                  # optional, top-level, before the first table (ADR 0043): the file's schema version

    [defaults]                   # every rollout on this machine
    parallel_ceiling = 4
    max_review_rounds = 4
    max_iterations = 3
    max_plan_rounds = 3
    auto_retries = 2             # execute's automatic retries of a set-aside task (p16-4, ADR 0033); 0 disables
    overtime_runs = 3            # schema 8 (p39-14, ADR 0070 d8): the Overtime, the runs a set-aside task takes by
                                 # itself once its normal budget is spent, before it is taken out; 0: none
    spend_approval_usd = 200     # the standing approval (ADR 0034): a spend gate whose total exposure is at most
                                 # this many US dollars passes without a person, and while the calendar month's
                                 # standing approvals stay within it; 0 (the built-in) is off
    verify_slots = 2             # machine-wide (p23-4): at most this many verifier suites run at once across every
                                 # rollout on this machine (execute's verify-slot.py); [defaults] only
    capacity_max = 6             # machine-wide, schema 4 (p36-7, ADR 0067 d8): the hard maximum of the Mac-wide
                                 # Capacity C that `next` and leg.py read from capacity.json (execute away.md §
                                 # Capacity); [defaults] only
    test_logins = ["dummy"]      # machine-wide, schema 5 (p37-4): the Claude Logins a credential gate may name and
                                 # still be signed by the standing approval; ONE line, [defaults] only, declared
                                 # on his ruling only (Declaring, below)
    fable_ceiling_builder = 60   # machine-wide, schema 10 (p46-10, ADR 0079 d6): a drawn role's Fable ceiling in
                                 # percent, one key per role; [defaults] only; tune.py its one script writer

    [guardrails]                 # the Reflection's bounds, machine-wide only
    tokens_per_merge_pct = 25    # tokens per merge may rise at most +25%
    set_aside_rate_points = 5    # set-aside rate may rise at most +5 points
    conflict_rate_points = 10    # conflict rate may rise at most +10 points
    quota_stalls = 0             # more than this many quota stalls breaches (0 = any stall)
    review_churn_pct = 40        # regression findings over all review findings above this % breaches
    hours_per_task = 1.5         # Throughput (p21-2, ADR 0037 d1): running hours may not exceed this many per task
                                 # whose Slot or lane holding overlaps the scored window, so an overnight run still
                                 # lands by morning

    [repo."lachyts/thread-skill"] # one repo, keyed by its GitHub origin's owner/name
    parallel_ceiling = 5
    inert_paths = ["THREAD.md"]  # schema 2 (p29-3, ADR 0045): this repo's Inert paths; a repo table only
    weight_mem_gb = 1            # schema 6 (p53-3, ADR 0083 DfL 8): a task's estimated Weight in this repo, memory in GB
    weight_cores = 1             # ... and cores; numbers > 0, a repo table only (built-in 3 and 2)
    unreachable_paths = ["skills/codex/**"]  # schema 7 (p52-1, ADR 0081 d1): code no check in the verifier exercises

    [repo."Animately/optimizer"]  # schema 3 (ADR 0063): the repo's test-credential class, ONE line in its repo table
    test_credentials = { file = "~/repos/animately/optimizer/.env.local", keys = [{ name = "STRIPE_SECRET", prefix = "sk_test_" }, { name = "SUPABASE_SERVICE_ROLE_KEY", supabase_project = "geyyptxqiovujgbiecsp" }] }

    [repo."owner/chorus"]         # schema 9 (p56-6): the repo's metered keys, ONE line in its repo table
    metered_keys = { file = "~/.config/chorus/env", keys = [{ name = "CARTESIA_API_KEY", service = "Cartesia" }, { name = "ELEVENLABS_API_KEY", service = "ElevenLabs" }] }

The only top-level keys are `schema`, `defaults`, `guardrails`, `notify` (retired, below) and `repo`. A repo table
holds every rollout key but `verify_slots` and `capacity_max` (SETTING_KEYS: the four Tuning keys, KEYS, plus
`auto_retries`, `spend_approval_usd`, `verify_slots`, `capacity_max` and `overtime_runs`; MACHINE_ONLY: `verify_slots` and
`capacity_max`, which are machine-wide and refused under a `[repo."o/r"]` label), plus `inert_paths`,
`test_credentials`, `weight_mem_gb`, `weight_cores` and `unreachable_paths` (REPO_ONLY: each refused under `[defaults]` with `<key> is per
repo: set it under [repo."owner/name"]`). REPO_ONLY holds `metered_keys` too (p56-6), read only as ONE line inside its
`[repo."o/r"]` table, as `test_credentials` is (below). `[defaults]` also holds `test_logins` and the four
`fable_ceiling_<role>` keys (DEFAULTS_ONLY: machine-wide, refused under a `[repo."o/r"]` label as MACHINE_ONLY's keys
are, and kept out of `settings`). Dotted keys
(`repo."o/r".parallel_ceiling = 5`) and inline tables are read the same as table form, with two exceptions:
`test_credentials` is read only as ONE line inside its `[repo."o/r"]` table, and `test_logins` only from a key line
whose value closes on that line, never from inside an inline table (both below), because inert-paths.py,
reflect's tune.py and `declare` edit this file line by line and treat any other form as a hand edit they refuse.

`inert_paths` (p29-3, ADR 0045; schema 2, the first key above schema 1) is the repo's Inert paths: a list of at most 64
distinct git pathspec globs (matched as `:(glob)<glob>`), empty by default (built-in []), so a repo nobody has checked
always re-runs its verifier. Each glob is refused when it is not a string, is empty or over 200 characters, has leading
or trailing whitespace, holds a control character or a backslash, starts with `/`, `:` (pathspec magic) or `!`, has an
empty, `.` or `..` segment, or ends in `/` (write `dir/**`). It is never stamped on a rollout and is no Tuning key: it
lives only here, written by skills/_shared/scripts/inert-paths.py `record` and `drop` (schedule § 2.9), and read at each
Integration by execute's `lead-integrate.py prepare`, which proves every glob again on the tree being merged. It is not
in `settings`: resolve() reports it as its own top-level `inert_paths` (Output). An older reader (schema 1) ignores
it under a schema-2 file (the schema rule below), so that rollout always re-runs.

`test_credentials` (ADR 0063; schema 3) is the repo's test-credential class: the test-mode and staging keys a credential
gate may name and still be signed by execute's standing approval (`reconcile-rollout.py approve-gates --standing`),
once each key is proved present in `file`. It is one inline table on ONE line inside `[repo."o/r"]`:
`test_credentials = { file = "<path>", keys = [{ name = "<NAME>", prefix = "<prefix>" }, { name = "<NAME>",
supabase_project = "<ref>" }, …] }`, a trailing comment allowed. Every other form is refused at its line with that
remedy (`[repo."o/r"] test_credentials must be one line in that table: …`): the `[repo."o/r".test_credentials]`
sub-table, the dotted forms (top-level or in-table), `repo = {…}` and a value that spans lines. The value
(credential_problem(), the first failure wins; a refused value is described, never echoed) holds exactly `file` and
`keys`; `file` is a string starting `/` or `~/`, at most 300 characters, with no control character and no `(` or `)`
(the annotation that names it ends at a `)`); `keys` is a list of 1 to MAX_CREDENTIAL_KEYS (32) tables, each holding
exactly `name` and one of `prefix` or `supabase_project`; a `name` is an upper-snake env name (CRED_NAME_RE, at least
one `_`) with no LIVE or PROD segment (LIVE_PROD_SEGMENT_RE: a live or production key is never in the class), and no
name twice; a `prefix` is 3 to 40 of A-Z, a-z, 0-9 and `_` (CRED_PREFIX_RE), holds `test` or `sandbox` and no `live`
or `prod`, in any case; a `supabase_project` is a Supabase project ref, 20 lowercase letters (SUPABASE_REF_RE). It is
declared on his ruling only: his hand edit, or an agent's `declare` quoting his words (Declaring, below); no other
writer adds or changes it (a rollout or task stamp would let an agent widen its own approval), inert-paths.py's
`mine`/`others` check refuses an edit whose result resolves another repo table, and tune.py refuses an edit that
changes any repo's `test_credentials`. It is not in `settings`: resolve() reports it as
its own top-level `test_credentials` (Output), null with no class. A schema-2 reader ignores it under a schema-3 file
(the schema rule below), so that rollout asks every credential gate, as before. It is its own switch, independent of
`spend_approval_usd`: a declared class signs at the built-in 0 too.

`metered_keys` (p56-6, ADR 0063's 2026-11-26 amendment; schema 9, the first schema-9 key) is the repo's metered keys:
keys whose only risk is metered spend (a paid voice API with no test mode), which a credential gate may name and still
be signed by execute's standing approval (gated_inputs.py's metered-key reading, its part 7) when each is present in
`file` and a spend gate the standing approval signed on the same task names each key's service. It reads no limit of
its own: it signs only with a spend gate the standing approval signed on this task, earlier or in this pass, so with
`spend_approval_usd` at 0 it signs only on an earlier signing. It is one inline table on ONE line inside
`[repo."o/r"]`, as `test_credentials` is: `metered_keys = { file = "<path>", keys = [{ name = "<NAME>", service =
"<Service>" }, …] }`, a trailing comment allowed; every other form is refused at its line with that remedy
(`[repo."o/r"] metered_keys must be one line in that table: …`). The value (metered_problem(), the first failure wins;
a refused value is described, never echoed) holds exactly `file` and `keys`; `file` is held to `test_credentials`'
rules (a string starting `/` or `~/`, at most 300 characters, no control character, no `(` or `)`); `keys` is a list of
1 to MAX_CREDENTIAL_KEYS (32) tables, each holding exactly `name` and `service`; a `name` is an upper-snake env name
(CRED_NAME_RE) with no LIVE or PROD segment, and no name twice; a `service` is 2 to 40 of A-Z, a-z, 0-9, `.`, `-`, `_`
and single inner spaces, starting and ending on a letter or digit (METERED_SERVICE_RE): the name a task's spend gate
names. A name also in the same repo's `test_credentials` is refused (`… is also in test_credentials (a key is in one
class)`). It is declared on his ruling only: his hand edit, or an agent's `declare --repo <clone> --key metered_keys`
quoting his words (Declaring, below); tune.py refuses an edit that changes any repo's `metered_keys`. It is not in
`settings`: resolve() reports it as its own top-level `metered_keys` (Output), null with none. A schema-8 reader ignores
it under a schema-9 file (the schema rule below), so that rollout asks the metered-key gate, as before; a schema-8 file
that holds it is refused with the raise remedy.

`test_logins` (p37-4, ADR 0034's 2026-11-05 amendment; schema 5, the first schema-5 key) is the operator's declared
test Logins: the Claude Logins (Lachy's dummy Login) a credential gate may name and still be signed by execute's
standing approval (gated_inputs.py's test-Login reading, its part 5), with no limit, ledger or month line.
gated_inputs.py's `sweep` CLI (its part 1: schedule § 3.6, orient reshuffle R3 (c)) reads it too, through
resolve(repo=None) in process, only when a `credential:` gate line naming a Login reaches that reading's step 7, so
schedule and orient record such a gate ahead instead of asking it (p39-3); a file that will not resolve leaves those
hits unread, so they keep the ask (one `gated_inputs: test_logins:` stderr line, exit 1). estate-rank.py's `rank`
(orient-all § 2, schedule's Pre-flight § 1.5) reads it too, through gated_inputs.py's declared_logins() (the same
resolve(repo=None), in process), once per run and only when the note of a graded task gated `credential` alone holds a
Login reading that reaches step 7, to waive that task's sign-off charge (ADR 0034's 2026-11-20 amendment); a file that
will not resolve charges it, with one `test_logins:` line in the rank's warnings[]. It is one
line under `[defaults]` only, `test_logins = ["<name>", …]`, a trailing comment allowed: a value that spans lines is
refused at its line (`[defaults] test_logins must be one line: …`), and so is the key in a `[repo."o/r"]` table
(`… test_logins is machine-wide: set it under [defaults]`). The value (logins_problem(), the first failure wins) is a
list of 1 to MAX_TEST_LOGINS (16) strings, each a Login name (LOGIN_NAME_RE: a letter or digit, then up to 39 of A-Z,
a-z, 0-9, `_` and `-`), never `claude`, `login` or `logins` in any case (RESERVED_LOGIN_NAMES: the reading's own
words), and no name twice ignoring case; an empty list is refused (remove the line to declare none). Built-in []: no
Login is a test Login, so every Login gate asks. It is declared on his ruling only: his hand edit, or an agent's
`declare` quoting his words (Declaring, below); no other writer adds or changes it (an agent that could, on no words
of his, would widen its own approval; ADR 0063 d1's rule and its 2026-11-24 amendment), tune.py refuses an edit whose
result resolves another `test_logins`, and inert-paths.py's check refuses an edit that changes `[defaults]`. It is not
in `settings`:
resolve() reports it as its own top-level `test_logins` (Output). Machine-wide, so resolve(repo=None) reads it and a
serial note (no Project root) signs one too. A schema-4 reader ignores it under a schema-5 file (the schema rule
below), so that rollout asks every Login gate, as before; a pre-P29 reader refuses the `schema` line itself, so the
operator installs the release that knows the key first and runs the reader check below.

`weight_mem_gb` and `weight_cores` (p53-3, ADR 0083 d4 and DfL 8; schema 6, the first schema-6 keys) are the repo's
estimated Weight: what one of its tasks is expected to use at its heaviest, in GB of memory and in cores (WEIGHT_KEYS).
Each is an integer or float, never a boolean, finite and > 0 (a scripts repo's task is about 0.8 GB), refused otherwise
at its line (`[repo."o/r"] <key> must be a number > 0, got <value described>`). They are per repo (a task note has no
field that says what it runs, and a repo's tasks share its verifier), so `[defaults]` refuses them; with no repo table
setting one, its part reads the built-in, WEIGHT_BUILT_IN (3 GB and 2 cores, DfL 8's middle value). They are not in
`settings`: resolve() reports them as its own top-level `weight` (Output), each part with its own source, so a table
setting only one gives mixed sources. execute's `reconcile-rollout.py` reads it as the estimate a task's Weight starts
from until its project and `scope:` have measured runs (`_weight`; execute away.md § Capacity, *A task's Weight*). Each
is an operator's hand edit, a ruled declaration (`declare`, below), or a Reflection's Tuning through tune.py (p53-5:
one whole unit toward its measure); no other writer adds them. A schema-5 reader ignores them under a schema-6 file
(the schema rule below), so its slot-taken records the built-in Weight.

`unreachable_paths` (p52-1, ADR 0081 d1; schema 7, the first schema-7 key) is the repo's Unreachable surface: the
paths whose code no check in its rollouts' verifier exercises (Codex computer use, device-only code). A diff that
touches one is on an Unreachable surface whatever its plan declares: the backstop behind the plan's own declaration
(and the implementer's, for a task with no plan). Its value is a list of git pathspec globs read exactly as
`inert_paths`' (the same glob_problem() rule, at most 64, no glob twice), and a glob holding a `[…]` class that will
not compile (glob_class_problem(): `[b-a]`, a range out of order) is refused too, since the engine compiles each glob
and would refuse the lead's args instead; empty by default (built-in []: no backstop).
It is per repo, so `[defaults]` refuses it. It is never stamped on a rollout and is no Tuning key: an operator's hand
edit or a ruled declaration (`declare`, below), and no other writer adds it. It is not in `settings`: resolve()
reports it as its own top-level `unreachable_paths` (Output). execute's lead passes its value as the engine's
`args.unreachablePaths` (execute § 3),
and the engine marks a task whose code-writing agents report a changed path one of these globs matches. A schema-6
reader ignores it under a schema-7 file (the schema rule below), so that rollout marks only what a task declares.

`fable_ceiling_master_review`, `fable_ceiling_builder`, `fable_ceiling_investigator` and `fable_ceiling_lead` (p46-10,
ADR 0079 decision 6's p46-3 amendment; schema 10, the first schema-10 keys; CEILING_KEYS, each naming its role in
CEILING_ROLES, ladder.py's SHARE_ROLES in order) are each drawn role's Fable ceiling: the most of that role's work, in
percent, its Fable arm may take. Each is an integer from 0 to 100, refused otherwise at its line (`[defaults] <key> must
be an integer from 0 to 100 (a percent), got <value described>`: a boolean, a float or a string included). They are
machine-wide (DEFAULTS_ONLY: one Mac draws every rollout's arms against them), so a `[repo."o/r"]` table refuses them,
and they are not in `settings`: resolve() reports them as its own top-level `fable_ceiling` (Output), {role: {value,
source}}, a role the file does not set reading `{"value": null, "source": "built-in"}`. The seed rule (fable_ceilings(),
its one copy): a role this file sets reads its value; a role it does not set reads ladder.toml's `[share]` value for it,
the seed (ladder.py's header), as written; a role neither names, and a role ladder.toml's `[role]` gives its own model
(never drawn), has no ceiling. So the first landing writes the key, and from then on this file wins: a later `[share]`
edit for that role is not read. ladder.py's engine_view() (the lead's args.ladder.share, and through it the engine's
doubled-review check), reconcile-rollout.py's draws and reflect's span read the ceiling through it. Their one script
writer is skills/reflect/scripts/tune.py (`--ceilings`, `--ceiling-revert` and `--ceiling-yes`, its header: an agreed
move the weekly reading lands at step 14, its declared-risk revert, and Lachy's yes to a decision-task item); a ruled
`declare` writes one too, which tune.py then reads as a hand edit (a stale `from`). They are never stamped on a rollout
or a task. A schema-9 reader ignores them under a schema-10 file (the schema rule below), so a rollout on an older
Engine snapshot keeps drawing on the ladder's `[share]` seed; a schema-9 file that holds one is refused with the raise
remedy.

`[notify]` is retired (ADR 0075 d2: no rollout code notifies Lachy, so nothing reads the ntfy topic it held, ADR 0038
d3). A top-level `notify`, in any form (a table, a scalar, dotted or inline, valid or not), is skipped whole: never
validated, never refused and never resolved, only recorded, so `_validate` returns `retired: ["notify"]`, load_tables
carries it and resolve() reports it as its own top-level `retired` (Output). The CLI writes one stderr line for it,
`WARN: [notify] is retired (ADR 0075)`, and still exits 0; resolve() prints nothing, so its in-process readers stay
quiet. `notify` stays in TOP_KEYS, so a near-miss such as `notfy` is still refused as a typo, and `notify.ntfy_topic`
stays registered in KEY_SCHEMA at schema 1 (K10 freezes that set). An older snapshot's rollout-settings.py still
validates and accepts a valid `[notify]`. `ntfy_topic` was never a rollout key: in `[defaults]` or a repo table it is
an unknown key, refused.

The schema (ADR 0043: two rollouts can run on two Engine snapshots, so an older reader meets a newer file). The
top-level `schema` is an integer >= 1 (a boolean, float or string is refused); an absent line reads as 1. SCHEMA is
this reader's own version, and KEY_SCHEMA registers every key it knows, keyed by (scope, key), with the schema that
introduced it; the scopes are `top` (the top-level keys), `rollout` (a `[defaults]` or `[repo."o/r"]` table),
`guardrails` and `notify` (retired: its one registered key is never read). Under a file whose `schema` is above
SCHEMA, an unknown key (a top-level table included) is ignored and listed in `ignored`, unless it is a near-miss of
a key known at its scope (near_miss(): equal once lower-cased with `_` and `-` dropped, or within
optimal-string-alignment distance 2), which is still refused as a typo. Under any other file an unknown key is
refused, as ever. A known key whose KEY_SCHEMA is above the file's `schema` is refused with `<scope>.<key> is a
schema-<N> key but the file says schema = <M>: raise the file's top-level `schema` line to <N> in the same edit`. A
top-level `schema` needs a P29+ reader: a pre-P29 rollout-settings.py refuses it as an unknown top-level key, so
install a P29+ release before writing one.

Adding a key (the recipe; tests/rollout-settings.test.mjs K10 fails with it): bump SCHEMA; register the key in
KEY_SCHEMA at the new number; keep it no near-miss of any key registered at its scope (K8); and every writer that
adds it to a file whose `schema` is lower raises the file's `schema` line to that number in the same edit: tune.py
does it (raise_schema(), pinned by tests/reflect-tune.test.mjs KT1), and so must a hand edit. The three writers
(tune.py, inert-paths.py and `declare`) share raise_schema_lines() below. A writer that raises the schema runs the
reader check or names why it need not: a
pre-P29 reader refuses any top-level `schema` line and a schema-N reader any known key above N, and a refused file halts
every rollout on the machine at its next `verify-timeout`, so each writer asks every live rollout's engine root to read
the new file first and refuses the write when one cannot: inert-paths.py `record` (its header, and reader_check(), the
check's one copy) raising it to 2, and tune.py, which loads that reader_check(), raising it to 4 for capacity_max,
to 6 for a Weight (p53-5), to 8 for overtime_runs (p39-14; an unattended --auto landing included; its header) or to 10
for a Fable ceiling (p46-10; an unattended --ceilings landing included).
`declare` runs the reader check at every write, raised schema or not.

Repo keys. A repo key must be quoted (`[repo."owner/name"]`) and is an `owner/name` by land.sh's slug rule
(`[A-Za-z0-9][A-Za-z0-9._-]*/[A-Za-z0-9._-]+`, a name that is not all dots), never ending `.git`. It is
matched, ignoring case, against `land.sh --origin-slug <--repo>`: the clone's local `git remote get-url
origin` (no network) in any of the three GitHub URL forms, with a trailing `/` and `.git` stripped. So a
rollout clone (ADR 0042) resolves the same as its in-place checkout. Two repo keys equal ignoring case
are refused as a duplicate. land.sh is run only when the file holds at least one repo table and `--repo`
was given, under ORIGIN_TIMEOUT seconds, in its own process group (killed whole on expiry).

Precedence for each rollout key (the callers apply the first two): task frontmatter → rollout frontmatter →
`[repo."<slug>"]` (source `file:repo`) → `[defaults]` (`file:defaults`) → `built-in`. Guardrail sources are
`file:guardrails` or `built-in`. Built-ins: parallel_ceiling 4, max_review_rounds 4, max_iterations 3,
max_plan_rounds 3, auto_retries 2, spend_approval_usd 0, verify_slots 2, capacity_max 6, overtime_runs 3;
weight_mem_gb 3 and weight_cores 2 (WEIGHT_BUILT_IN); guardrails 25 / 5 / 10 / 0 / 40 / 1.5 (hours_per_task,
a heuristic: Lachy's rollouts.toml sets the real bound). `auto_retries` is no Tuning key:
schedule does not stamp it and a Reflection never proposes it; execute's `lead-integrate.py inputs` and
`reconcile-rollout.py auto-retry` resolve it themselves (p16-4). `overtime_runs` (p39-14, ADR 0070 d8; schema 8) is
one: a set-aside task's Overtime, the runs it takes by itself once `auto_retries` and its round cap are spent, before it
is taken out of its rollout. It is per repo (a repo table may set it), never stamped by schedule, and resolved as
`auto_retries` is, task → rollout → this file → built-in 3, by execute's verdict (`reconcile-rollout.py`'s
_retry_budget). A Tuning moves it only between values >= 1 (tune.py refuses a move to or from 0): 0, no Overtime, is
the operator's hand edit or a ruled declaration. Nor is `spend_approval_usd` (ADR 0034): schedule
shows it but never stamps it on a rollout, and `reconcile-rollout.py approve-gates --standing` resolves it itself (task
`spend_approval_usd:`, then rollout, then this file, then the built-in 0, which is off: the approval lives in this
file, never in the skills, so a fresh install approves nothing). Nor is `verify_slots` (p23-4): machine-wide, so
`[defaults]` only; never stamped on a rollout; execute's `reconcile-rollout.py verify-timeout` reads it at each loop
entry through resolve(repo=None), which validates the whole file. A refused file halts every rollout on this machine at
its next entry (execute's `verify-timeout`), stamped or not, so a new key follows the schema rule above: an older
snapshot reading a file whose `schema` is above its own ignores that key and runs. Nor is `capacity_max` (p36-7, ADR
0067 d8; schema 4): machine-wide, so `[defaults]` only; never stamped on a rollout; `reconcile-rollout.py` (`next`,
`status`, every progress line, mark-started) and leg.py read it through resolve(repo=None), only while a fresh
capacity.json is read, as the hard maximum of the Capacity C (execute away.md § Capacity); one that will not resolve
reads as no Capacity (the Trickle, with a WARN), never open.

Validation (ADR 0016: anything unknown or wrong is refused, never dropped, except a newer file's unknown key under the
schema rule above):
- a `schema` that is not an integer >= 1; a known key whose KEY_SCHEMA is above the file's `schema`;
- an unknown top-level key or table key, `defaults` or `guardrails` that is not a table, a `repo` that is
  not a table, a value under `repo` that is not a table (named by its key: `[repo."o/r"] must be a table`);
- a rollout value that is not an integer >= its MINIMUM: 1 for the four Tuning keys, `verify_slots` and
  `capacity_max`, 0 for
  `auto_retries`, `overtime_runs` and `spend_approval_usd` (a boolean, float or string is refused, and so is 0 for a
  key whose MINIMUM is 1);
- a MACHINE_ONLY key (`verify_slots`, `capacity_max`) in a `[repo."o/r"]` table;
- a `test_credentials` in any form but one line in its repo table, or a value credential_problem() refuses (ADR 0063);
- a `metered_keys` under `[defaults]`, in any form but one line in its repo table, a value metered_problem() refuses, or
  a name also in that repo's `test_credentials` (p56-6);
- a `test_logins` in a repo table, a value that spans lines, or a value logins_problem() refuses (p37-4);
- a `fable_ceiling_<role>` in a repo table, or one that is not an integer from 0 to 100 (a boolean refused; p46-10);
- a `weight_mem_gb` or `weight_cores` under `[defaults]`, or one that is not a finite number > 0 (a boolean refused; p53-3);
- an `unreachable_paths` under `[defaults]`, one `inert_paths` would refuse, or a glob glob_class_problem() refuses (p52-1);
- a guardrail that is not a non-negative integer or float (a boolean is refused; `quota_stalls` is an
  integer >= 0; `hours_per_task` is an integer or float > 0, since a bound of 0 breaches every run);
- a bad or case-duplicate repo key.
No file (nothing at the path, a missing directory on the way, a plain file as a step on the way) gives the
built-ins, and so does an empty or comment-only file. The file is read by ladder.py's read_toml(), so a
dangling symlink, an unsearchable directory, bytes that are not UTF-8 and a TOML syntax error are refused as
ladder.toml's are.

Order of checks: `--repo` (with `~` expanded) is a directory; the file reads and validates; only then, when a
repo table exists and `--repo` was given, land.sh reads the origin; then the values resolve.

Output. Exit 0 and one JSON line on stdout:

    {"path": "<expanded path>", "file": true|false, "repo": "<owner/name>"|null,
     "settings": {"parallel_ceiling": {"value": 4, "source": "built-in"}, "max_review_rounds": {...},
                  "max_iterations": {...}, "max_plan_rounds": {...}, "auto_retries": {...},
                  "spend_approval_usd": {...}, "verify_slots": {...}, "capacity_max": {...},
                  "overtime_runs": {...}},
     "guardrails": {"tokens_per_merge_pct": {"value": 25, "source": "built-in"}, ...},
     "inert_paths": {"value": ["<glob>", ...], "source": "file:repo"|"built-in"},   # built-in []
     "test_credentials": {"value": {"file": "<path>", "keys": [{"name": "<NAME>", "prefix": "<p>"}
                                    | {"name": "<NAME>", "supabase_project": "<ref>"}, ...]} | null,
                          "source": "file:repo"|"built-in"},                        # built-in null: no class
     "metered_keys": {"value": {"file": "<path>", "keys": [{"name": "<NAME>", "service": "<Service>"}, ...]} | null,
                      "source": "file:repo"|"built-in"},                            # built-in null: none (p56-6)
     "test_logins": {"value": ["<name>", ...], "source": "file:defaults"|"built-in"},  # built-in []: none
     "weight": {"mem_gb": {"value": <num>, "source": "file:repo"|"built-in"},       # built-in 3
                "cores": {"value": <num>, "source": "file:repo"|"built-in"}},       # built-in 2
     "unreachable_paths": {"value": ["<glob>", ...], "source": "file:repo"|"built-in"},  # built-in []
     "fable_ceiling": {"master-review": {"value": <0-100>, "source": "file:defaults"}    # p46-10, SHARE_ROLES order;
                                       | {"value": null, "source": "built-in"}, ...},  # null: the ladder's seed rules
     "schema": {"file": <the file's schema, 1 when absent or no file>, "engine": SCHEMA},
     "ignored": ["<scope path of each ignored key>", ...],     # e.g. "defaults.foo", 'repo."o/r".foo', "away"
     "retired": ["notify"] | []}                               # a retired table the file holds (ADR 0075 d2)

The CLI prints resolve()'s object whole (the retired `[notify]` is never read, so no topic reaches stdout).
`test_credentials` is printed whole: key names, prefixes, project refs and a path are no secrets (no value is ever read
here; the standing approval reads the file itself). So is `metered_keys`: key names, services and a path.

`repo` is the origin's owner/name as land.sh printed it (case kept), or null when no repo table could apply:
no `--repo`, no file, no repo table, or no GitHub origin (no repo, no origin, another host: land.sh exit 4).

The resolver's exit codes (the verbs' are under Declaring, below): exit 0 also when the file holds a retired
`[notify]`, with the one WARN line above on stderr. Exit 2 when the file is
refused, `--repo` is not a directory, the origin cannot be read (land.sh will not
start, exits other than 0 or 4, or times out), or on a usage error. Exit 3 when a present file needs tomllib
and this python has none. On failure stdout is empty and stderr carries one line:
`rollout-settings: <path>:<line>: <reason>`, `rollout-settings: <path>: <reason>` when no line applies, or
`rollout-settings: --repo <p>: <reason>`.

Declaring (p56-5; ADR 0063's 2026-11-24 amendment: "Agents make any ruled edit"). When Lachy has ruled on a
declaration in words, an agent writes it into this file with `declare` and reports it; `declare` and `undo` are the
only forms that write, and no agent edits this file any other way (a Tuning stays tune.py's, an Inert path
inert-paths.py's). Every rule of the two verbs is here:
- Ruled. `--words` is his own words, quoted exactly: non-empty once stripped, at most MAX_WORDS (2000) characters, no
  control character. `--said` is the day he said them, a real `YYYY-MM-DD` date in ASCII digits that is not after
  today, held as that date's ISO form. `--source`, optional, is where he said them (a note's link, the grill's
  name), held to the same check as `--words` at MAX_SOURCE (300) characters, since it goes into the log and the
  one-line report. A failure is exit 2, nothing
  written. That his words name the thing declared is the agent's rule (the ADR's Decided for him 1), never checked
  here: a sign-off of one gate, an inference or silence is no ruling, and with no such words the declaration stays
  his question.
- The clock. Today is the machine's local date (`_today()`, the one seam): the day he would name for his own words. It
  is the date in the written comment, the log's `declared` field, and the bound of `--said`. The log's `ts` and the
  id's stamp are UTC, so east of Greenwich an id's date can be a day behind its line's. No flag moves the bound.
- Keys. Every key this reader knows in `[defaults]`, a `[repo."owner/name"]` table or `[guardrails]`, but two
  (UNDECLARABLE): `inert_paths`, whose writer inert-paths.py proves each glob first, and `schema`, which a writer
  raises and nobody declares. The table is derived, never chosen: a guardrail goes to `[guardrails]` and a machine-wide
  key (MACHINE_ONLY, DEFAULTS_ONLY) to `[defaults]`, and both refuse `--repo`; a REPO_ONLY key needs `--repo` (the
  clone whose GitHub origin names its table, matched ignoring case, as the resolver's is); any other rollout key goes
  to `[defaults]` without `--repo` and to the repo's table with it.
- The line. `<key> = <one-line TOML>  # declared <today> by an agent on his words of <said>:
  rollouts.declarations.jsonl <id>`, the TOML rendered from `--value`'s JSON (toml_value(): a string through
  json.dumps, an integer, a finite float, a list, an inline table with bare keys), always ONE line. The comment names
  the line's last declaration and nothing more: the log is the record. tune.py replaces a value in place and keeps
  the line's comment, so a Tuning that later moves a declared Tuning key leaves that comment on a value tune.py
  chose: a later Tuning's value is tune.py's, recorded in tunings.jsonl, `undo` of that id is refused, and the next
  `declare` of the key replaces the line whole.
- The edit (declare_edit(), on the config's realpath, so a symlinked file keeps its link): the key's line is replaced
  whole, else the new line goes after its table's last key, else the table's header is appended with it; `--remove`
  deletes the line. A table or key held in dotted, inline or multi-line form is refused (exit 2: edit it by hand).
  The file's `schema` is raised in the same edit through raise_schema_lines(). No file, or a comment-only one, is
  created or appended to; a missing parent directory is made, and removed again when a failure leaves it empty; an
  existing file keeps its mode. A value already set, or a `--remove` of a key that is not set, is exit 0, `nothing to
  change`, with no log line.
- The write order, each step refusing before the next: the result goes to a temp file in the same directory; that
  file must validate (load_tables(): every value rule stays this reader's one copy, and a refusal prints the reader's
  own reason at the config's path) and must read as the file before with exactly the one key changed, every other
  table, key and repo identical and `schema` only ever raised; the reader check runs at EVERY write, raised schema or
  not (inert-paths.py's reader_check(), its one copy, loaded lazily, its lines led `rollout-settings`; fail closed,
  and there is no `--force`: a root that refuses, times out or has no script is exit 1, while a missing tasks dir or
  an unusable snapshot is a WARN, as there); the real file is read again and must still hold the bytes first read,
  else exit 1, `changed while checking: re-run` (the compare-and-swap; the window between that read and the replace is
  the one tune.py and inert-paths.py have too); ONE line is appended to the log (O_APPEND, one write, its length
  checked, fsync; a failure is exit 1 with this file untouched); then the temp file replaces the real one, and a
  replace that fails is followed by a `void` line.
- The log: `rollouts.declarations.jsonl` beside the config path (declarations_path()), append-only JSON lines, read by
  read_declarations() (a line that is no JSON object with an `id` is skipped with one WARN and matches no id). A line
  holds `id` (`d-<UTC compact>-<4 hex>`), `ts` (UTC), `declared` (the local date), `verb` (`declare`, `remove`, `undo`
  or `void`), `table` (`defaults`, `guardrails` or `repo."owner/name"`), `key`, `value` (the JSON value, null for a
  removal), `was` (the value the table held before, or null), `words`, `said`, `source` (or null), `line` (the line
  written, null when one was removed), `replaced` (the whole line it replaced or removed, comment included, or null),
  on a `remove` line `above` and `below` (the raw lines directly above and below the removed line, `below` null at the
  end of the file), `schema` (`{from, to}`), and `undoes` or `voids` where they apply (a `void` line holds only its
  head, `table`, `key` and `voids`).
- `undo --id <id>` takes back one `declare` or `remove` line, through the same validation, intended result, reader
  check, compare-and-swap and log-then-replace. It needs `--words` and `--said` too: an undo of a ruled removal would
  otherwise widen an approval again on nobody's word. It refuses (exit 2) an unknown id, a voided or already undone
  one, an `undo` or `void` line's own id, a `declare` whose line in the file is no longer byte-equal to the one logged
  (a later declaration, a hand edit or a Tuning moved it), and a `remove` whose key is set again. A `declare` that
  replaced a line puts `replaced` back in its place; one that added a line deletes it; a `remove` puts `replaced` back
  at its old place, the ONE position inside its table whose line above equals `above` and whose line below equals
  `below` (restore_at()), and with no such position, or more than one, after the table's last key, its report ending
  `; restored at the end of [<table>]: the lines around its old place have changed`. The guarantee: with no edit to
  the file between, an undo leaves it byte-identical to before the entry, but for the `schema` line a declare raised
  and a table header it appended (with the blank line above it), which stay: both are valid, and `schema` is never
  lowered.
- The report, one stdout line the agent pastes verbatim where Lachy reads the result: `declared [<table>] <key> =
  <value> in <path> (was: <old line | not set>); his words, <said>: "<words>"[, <source>]; logged <id> in <log>; undo:
  rollout-settings.py undo --id <id> --words "<his words>" --said <YYYY-MM-DD>[ --config <path>]` (`removed [<table>]
  <key> from <path> …` for a removal, `undone <id>: [<table>] <key> in <path> (now: <line | not set>); …` for an undo,
  which offers no undo). The undo hint holds the two placeholders an undo needs filled, his words taking it back and
  their date, and `--config` when the write was given one. `--dry-run` prints the diff and the would-be log line
  instead, the reader check still run, and writes nothing.
- Exit codes: 0 written, nothing to change, or `--dry-run`; 1 the reader check refused or did not run, the file
  changed under it, or the log or the replace failed; 2 usage, no ruling, a refused key or value, a form it will not
  edit, an edit that does not validate, an undo it refuses; 3 tomllib missing. A failure is one stderr line,
  `rollout-settings: <verb>: <reason>`, after the reader check's own lines.

Importable: resolve(repo=None, path=None), BUILT_IN, GUARDRAILS_BUILT_IN, KEYS (the four Tuning keys a rollout note
stamps, which tune.py and score.py read), TUNING_KEYS (p53-5: KEYS, then `capacity_max`, WEIGHT_KEYS and, p39-14,
`overtime_runs`, every key a Tuning may move; run_record.py's TUNING_KEYS is pinned to it), SETTING_KEYS (KEYS plus
`auto_retries`, `spend_approval_usd`, `verify_slots`, `capacity_max` and `overtime_runs`: every key a `settings` object
holds), MACHINE_ONLY, REPO_ONLY,
DEFAULTS_ONLY, CEILING_KEYS, CEILING_ROLES, fable_ceilings(part, ladder) (p46-10: {role: {percent, share, source}}
in SHARE_ROLES order from resolve()'s `fable_ceiling` part and ladder.py's load(), the seed rule's one copy: source
`rollouts` for a role this file sets, percent its value and share percent / 100; else `ladder` for a role the ladder's
`[share]` names, share as written and percent round(100 x share); a role neither names, or one `[role]` gives its own
model, absent), MINIMUM, WEIGHT_KEYS, WEIGHT_BUILT_IN,
GUARDRAIL_KEYS, RETIRED, ORIGIN_TIMEOUT, SCHEMA, KEY_SCHEMA, MAX_INERT_GLOBS,
MAX_CREDENTIAL_KEYS, MAX_TEST_LOGINS, LOGIN_NAME_RE, RESERVED_LOGIN_NAMES, glob_problem(glob),
glob_class_problem(glob) (why a glob's `[…]` class will not compile, or None: unreachable_paths' extra check),
credential_problem(value) (why a test_credentials value is refused, or None), logins_problem(value) (the same for
test_logins), metered_problem(value) (the same for metered_keys, p56-6), METERED_SERVICE_RE,
near_miss(key, known), file_schema(doc), load_tables(path) (the validated tables, None for no
file), raise_schema_lines(lines, need, current) (the top-level `schema` raise the three writers share: `lines` with the
line raised to `need` when it is above `current`, never lowered; an existing top-level line is rewritten in place,
keeping its comment; otherwise `schema = <need>` and a blank line go before the first table header, above the comment
lines directly over it; a SettingsError for a `schema` line it will not edit), default_path(),
SettingsError(reason, line=None, code=2, subject=None); and the writer's (Declaring): DECLARATIONS, MAX_WORDS,
MAX_SOURCE, UNDECLARABLE, toml_value(value), declare_edit(lines, target, label, key, new_line, place=None),
restore_at(lines, at, above, below), declarations_path(config=None), read_declarations(path).
"""
import argparse
import importlib.util
import json
import math
import os
import re
import signal
import subprocess
import sys
import warnings

HERE = os.path.dirname(os.path.abspath(__file__))
LAND_SH = os.path.join(HERE, "land.sh")

# The four Tuning keys a rollout note stamps (a Reflection proposes them; TUNING_KEYS, below, adds the rest).
KEYS = ("parallel_ceiling", "max_review_rounds", "max_iterations", "max_plan_rounds")
# Every rollout key a table may hold and `settings` reports: the Tuning keys plus execute's automatic-retry budget,
# the standing approval's limit in US dollars (ADR 0034), the machine's verify slots (p23-4) and the hard maximum of
# the Mac-wide Capacity (p36-7, ADR 0067 d8), then the Overtime (p39-14, ADR 0070 d8): the runs a set-aside task takes
# by itself past its spent budget; of these capacity_max and overtime_runs are Reflection-tunable (TUNING_KEYS).
SETTING_KEYS = KEYS + ("auto_retries", "spend_approval_usd", "verify_slots", "capacity_max", "overtime_runs")
# Machine-wide keys: valid under [defaults] only, refused in a [repo."o/r"] table (a verify slot, and the Capacity, are
# shared by every rollout on the machine, whatever its repo).
MACHINE_ONLY = ("verify_slots", "capacity_max")
# Per-repo keys (p29-3): valid in a [repo."o/r"] table only, refused under [defaults], and kept out of `settings`
# (resolve() reports each as its own top-level field). `inert_paths` is a repo's Inert paths (ADR 0045);
# `test_credentials` its test-credential class (ADR 0063), one line in its table.
# `weight_mem_gb` and `weight_cores` (p53-3, ADR 0083 DfL 8) its estimated Weight, numbers > 0.
# `unreachable_paths` (p52-1, ADR 0081 d1) its Unreachable surface, globs read as inert_paths' are.
# `metered_keys` (p56-6, ADR 0063's 2026-11-26 amendment) its metered keys, one line in its table as test_credentials is.
REPO_ONLY = ("inert_paths", "test_credentials", "weight_mem_gb", "weight_cores", "unreachable_paths", "metered_keys")
# A task's estimated Weight (p53-3): the repo's two keys, and the built-in middle value of each (3 GB and 2 cores).
WEIGHT_KEYS = ("weight_mem_gb", "weight_cores")
WEIGHT_BUILT_IN = {"weight_mem_gb": 3, "weight_cores": 2}
# Every key a Reflection's Tuning may move (p53-5; run_record.py's TUNING_KEYS is pinned to this tuple): the four a
# rollout note stamps, then the machine-wide capacity_max and a repo's Weight estimates, which no note stamps, then
# overtime_runs (p39-14, ADR 0070 d8), which tune.py moves only between values >= 1.
TUNING_KEYS = KEYS + ("capacity_max",) + WEIGHT_KEYS + ("overtime_runs",)
# Each drawn role's Fable ceiling in percent (p46-10, ADR 0079 decision 6), one key per role: CEILING_ROLES maps each key
# to its role, in ladder.py's SHARE_ROLES order (tests/rollout-settings.test.mjs pins the two equal).
CEILING_KEYS = ("fable_ceiling_master_review", "fable_ceiling_builder", "fable_ceiling_investigator", "fable_ceiling_lead")
CEILING_ROLES = {"fable_ceiling_master_review": "master-review", "fable_ceiling_builder": "builder",
                 "fable_ceiling_investigator": "investigator", "fable_ceiling_lead": "lead"}
# Machine-wide keys kept out of `settings` (p37-4): valid under [defaults] only, refused in a repo table, and reported
# by resolve() as their own top-level field. `test_logins` is the operator's declared test Logins, one line; the
# CEILING_KEYS (p46-10) each drawn role's Fable ceiling, reported as `fable_ceiling`.
DEFAULTS_ONLY = ("test_logins",) + CEILING_KEYS
MAX_TEST_LOGINS = 16
LOGIN_NAME_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{0,39}\Z")
RESERVED_LOGIN_NAMES = ("claude", "login", "logins")
MAX_INERT_GLOBS = 64
# test_credentials (ADR 0063): at most 32 keys; a name is an upper-snake env name with at least one `_`; a prefix is 3 to
# 40 word characters; a Supabase project ref is 20 lowercase letters. A name with a LIVE or PROD segment is refused.
MAX_CREDENTIAL_KEYS = 32
CRED_NAME_RE = re.compile(r"[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\Z")
CRED_PREFIX_RE = re.compile(r"[A-Za-z0-9_]{3,40}\Z")
SUPABASE_REF_RE = re.compile(r"[a-z]{20}\Z")
LIVE_PROD_SEGMENT_RE = re.compile(r"(?:^|_)(?:LIVE|PROD)")
# metered_keys (p56-6): a service is 2 to 40 of A-Z, a-z, 0-9, `.`, `-`, `_` and single inner spaces, starting and
# ending on a letter or digit (the name a task's spend gate names).
METERED_SERVICE_RE = re.compile(r"[A-Za-z0-9](?:[A-Za-z0-9._-]| (?! ))*[A-Za-z0-9]\Z")
BUILT_IN = {"parallel_ceiling": 4, "max_review_rounds": 4, "max_iterations": 3, "max_plan_rounds": 3, "auto_retries": 2,
            "overtime_runs": 3, "spend_approval_usd": 0, "verify_slots": 2, "capacity_max": 6}
# The least valid value of each rollout key: a round cap is >= 1; `auto_retries: 0` disables automatic retries;
# `overtime_runs: 0` gives no Overtime (a spent budget is a take-out at once); `spend_approval_usd: 0` turns the standing
# approval off.
MINIMUM = {"parallel_ceiling": 1, "max_review_rounds": 1, "max_iterations": 1, "max_plan_rounds": 1, "auto_retries": 0,
           "spend_approval_usd": 0, "verify_slots": 1, "capacity_max": 1, "overtime_runs": 0}
# review_churn_pct (p21-3, ADR 0037 d1): Review churn's absolute bound, a non-negative number like the rates.
# hours_per_task (p21-2): the Throughput Guardrail's absolute bound, skills/reflect/scripts/score.py's built-in too.
GUARDRAIL_KEYS = ("tokens_per_merge_pct", "set_aside_rate_points", "conflict_rate_points", "quota_stalls",
                  "review_churn_pct", "hours_per_task")
GUARDRAILS_BUILT_IN = {"tokens_per_merge_pct": 25, "set_aside_rate_points": 5, "conflict_rate_points": 10,
                       "quota_stalls": 0, "review_churn_pct": 40, "hours_per_task": 1.5}
# A retired top-level table (ADR 0075 d2 retires [notify]): skipped whole, in any form, and reported in `retired`.
RETIRED = ("notify",)
TABLES = ("defaults", "guardrails", "notify", "repo")
TOP_KEYS = ("schema",) + TABLES
# The schema (ADR 0043; the header's schema rule and add-a-key recipe). SCHEMA is this reader's version; KEY_SCHEMA
# registers every key it knows, by (scope, key), at the schema that introduced it. K10 freezes the schema-1 set.
SCHEMA = 10
KEY_SCHEMA = {}
KEY_SCHEMA.update({("top", k): 1 for k in TOP_KEYS})
KEY_SCHEMA.update({("rollout", k): 1 for k in SETTING_KEYS if k not in ("capacity_max", "overtime_runs")})
KEY_SCHEMA.update({("guardrails", k): 1 for k in GUARDRAIL_KEYS})
KEY_SCHEMA[("notify", "ntfy_topic")] = 1   # retired (ADR 0075 d2), still registered: K10 freezes the schema-1 set
KEY_SCHEMA[("rollout", "inert_paths")] = 2   # p29-3 (ADR 0045): the first schema-2 key
KEY_SCHEMA[("rollout", "test_credentials")] = 3   # ADR 0063: the first schema-3 key
KEY_SCHEMA[("rollout", "capacity_max")] = 4   # p36-7 (ADR 0067 d8): the first schema-4 key
KEY_SCHEMA[("rollout", "test_logins")] = 5   # p37-4 (ADR 0034's 2026-11-05 amendment): the first schema-5 key
KEY_SCHEMA[("rollout", "weight_mem_gb")] = 6   # p53-3 (ADR 0083 DfL 8): the first schema-6 keys
KEY_SCHEMA[("rollout", "weight_cores")] = 6
KEY_SCHEMA[("rollout", "unreachable_paths")] = 7   # p52-1 (ADR 0081 d1): the first schema-7 key
KEY_SCHEMA[("rollout", "overtime_runs")] = 8   # p39-14 (ADR 0070 d8): the first schema-8 key
KEY_SCHEMA[("rollout", "metered_keys")] = 9   # p56-6 (ADR 0063's 2026-11-26 amendment): the first schema-9 key
KEY_SCHEMA.update({("rollout", k): 10 for k in CEILING_KEYS})   # p46-10 (ADR 0079 d6): the first schema-10 keys
ORIGIN_TIMEOUT = 20  # seconds for land.sh --origin-slug (one local git call); the whole group dies on expiry

# land.sh's origin_slug rule, so a key can only ever equal a slug land.sh prints.
SLUG_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]*/[A-Za-z0-9._-]+\Z")

# One TOML key segment (bare, "basic" or 'literal'), as ladder.py's _SEG; a dotted key is segments joined by `.`.
_SEG = r'(?:[A-Za-z0-9_-]+|"(?:[^"\\]|\\.)*"|\'[^\']*\')'
_DOTTED = _SEG + r"(?:\s*\.\s*" + _SEG + r")*"
_SEG_RE = re.compile(_SEG)
_AOT_RE = re.compile(r"\[\[\s*(" + _DOTTED + r")\s*\]\]\s*(?:#.*)?\Z")
_TABLE_RE = re.compile(r"\[\s*(" + _DOTTED + r")\s*\]\s*(?:#.*)?\Z")
_KEY_RE = re.compile(r"(" + _DOTTED + r")\s*=")


def default_path():
    return os.path.expanduser("~/.config/thread/rollouts.toml")


class SettingsError(Exception):
    """A refusal: str() is `<subject>[:<line>]: <reason>`; the CLI prefixes `rollout-settings: `."""

    def __init__(self, reason, line=None, code=2, subject=None):
        Exception.__init__(self, reason)
        self.reason = reason
        self.line = line
        self.code = code
        self.subject = subject

    def __str__(self):
        where = self.subject or ""
        if self.line is not None:
            where = "%s:%d" % (where, self.line)
        return "%s: %s" % (where, self.reason) if where else self.reason


def _ladder():
    spec = importlib.util.spec_from_file_location("thread_ladder", os.path.join(HERE, "ladder.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _unquote(seg):
    if seg[:1] == '"':
        try:
            return json.loads(seg)
        except ValueError:
            return seg[1:-1]
    if seg[:1] == "'":
        return seg[1:-1]
    return seg


def _segments(dotted):
    return tuple(_unquote(m.group(0)) for m in _SEG_RE.finditer(dotted))


class _Lines:
    """Where each key sits in the file, by a line scan (tomllib reports no positions for semantic errors).

    The twin of ladder.py's _Index, generalised to nested paths: `lines` maps a key path (a tuple, e.g.
    ("repo", "o/r", "parallel_ceiling")) to the first line it appears on. A `[a."b"]` or `[[a."b"]]` header
    records its path and each prefix; a key records its path relative to the current table, each dotted
    prefix included. Keys inside an inline table are not scanned: they fall back to the line of the key
    their `{` opens on (line_of's nearest recorded prefix). Only a line that starts outside every value is
    read as a header or a key; the rest of each line is scanned as TOML values, as _Index scans it, so
    strings and comments count for nothing and multi-line strings and arrays carry over to the next line.
    `one_line` maps a key path to its line only for a single-segment key under a two-segment table header
    (`[repo."o/r"]`) whose value closes on that same line (no bracket or multi-line string left open after the
    scan): the one form `test_credentials` is read in (ADR 0063). `closes` maps a key path to its line for any key
    whose value closes on the line it opens (under any table header, a dotted key's whole path included): the one-line
    rule `test_logins` is held to (p37-4). `lines` and `line_of` are unchanged by either.

    Why a copy and not a share (unlike read_toml): _Index's value scan carries the ladder's own hooks inside
    its loop (the `rung = [` array and each inline rung's `{` line, which its refusals cite), and its records
    are flat (top-level names, per-[[rung]] keys) where this one is path-keyed. Sharing it would mean
    re-cutting the ladder's line attribution, which tests/ladder.test.mjs pins line by line, to serve a second
    file. The copied part is only the string/comment/bracket skip (_scan, _close_multiline); a fix to one of
    them belongs in both, and tests/rollout-settings.test.mjs pins this copy's lines on its own.
    """

    def __init__(self, text):
        self.lines = {}
        self.one_line = {}
        self.closes = {}
        self._table = ()
        self._string = None
        self._brackets = []
        for n, line in enumerate(text.split("\n"), 1):
            self._line(n, line.strip())

    def _record(self, path, n):
        for i in range(1, len(path) + 1):
            self.lines.setdefault(path[:i], n)

    def line_of(self, path):
        """The path's own line, else its nearest recorded prefix's, else None."""
        for i in range(len(path), 0, -1):
            if path[:i] in self.lines:
                return self.lines[path[:i]]
        return None

    def _line(self, n, s):
        if self._string is None and not self._brackets:
            if not s or s.startswith("#"):
                return
            m = _AOT_RE.match(s) or _TABLE_RE.match(s)
            if m:
                self._table = _segments(m.group(1))
                self._record(self._table, n)
                return
            m = _KEY_RE.match(s)
            if m:
                segs = _segments(m.group(1))
                self._record(self._table + segs, n)
                self._scan(s[m.end():])
                if self._string is None and not self._brackets:
                    self.closes.setdefault(self._table + segs, n)
                if len(self._table) == 2 and len(segs) == 1 and self._string is None and not self._brackets:
                    self.one_line[self._table + segs] = n
                return
        self._scan(s)

    def _scan(self, s):
        i = 0
        while i < len(s):
            if self._string:
                i = self._close_multiline(s, i)
                continue
            c = s[i]
            if c == "#":
                return
            if s.startswith('"""', i) or s.startswith("'''", i):
                self._string = s[i:i + 3]
                i += 3
                continue
            if c == '"':
                i += 1
                while i < len(s) and s[i] != '"':
                    i += 2 if s[i] == "\\" else 1
                i += 1
                continue
            if c == "'":
                end = s.find("'", i + 1)
                i = len(s) if end < 0 else end + 1
                continue
            if c in "[{":
                self._brackets.append(c)
            elif c in "]}" and self._brackets:
                self._brackets.pop()
            i += 1

    def _close_multiline(self, s, i):
        quote = self._string[0]
        while i < len(s):
            if quote == '"' and s[i] == "\\":
                i += 2
            elif s.startswith(self._string, i):
                while i < len(s) and s[i] == quote:
                    i += 1
                self._string = None
                return i
            else:
                i += 1
        return len(s)


def _describe(value):
    if isinstance(value, bool):
        return "a boolean (%s)" % ("true" if value else "false")
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        return "a float (%r)" % value
    if isinstance(value, str):
        return "a string (%s)" % json.dumps(value)
    if isinstance(value, list):
        return "an array"
    if isinstance(value, dict):
        return "a table"
    return "a date or time"


def _osa(a, b):
    """The optimal-string-alignment distance (Levenshtein plus adjacent transpositions)."""
    d = [[0] * (len(b) + 1) for _ in range(len(a) + 1)]
    for i in range(len(a) + 1):
        d[i][0] = i
    for j in range(len(b) + 1):
        d[0][j] = j
    for i in range(1, len(a) + 1):
        for j in range(1, len(b) + 1):
            cost = 0 if a[i - 1] == b[j - 1] else 1
            d[i][j] = min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
            if i > 1 and j > 1 and a[i - 1] == b[j - 2] and a[i - 2] == b[j - 1]:
                d[i][j] = min(d[i][j], d[i - 2][j - 2] + 1)
    return d[len(a)][len(b)]


def near_miss(key, known):
    """The known key `key` is a near-miss of (equal once lower-cased with `_` and `-` dropped, or within optimal-string-
    alignment distance 2), else None: a typo of a known key is refused even under a newer file's schema."""
    squash = lambda s: s.lower().replace("_", "").replace("-", "")   # noqa: E731
    for k in known:
        if k != key and (squash(k) == squash(key) or _osa(k, key) <= 2):
            return k
    return None


def glob_problem(glob):
    """Why `glob` is no valid Inert-paths glob (the header's rule), or None."""
    if not isinstance(glob, str):
        return "is not a string (got %s)" % _describe(glob)
    if not glob:
        return "is empty"
    if len(glob) > 200:
        return "is %d characters (at most 200)" % len(glob)
    if glob != glob.strip():
        return "has leading or trailing whitespace"
    if any(ord(c) < 32 or ord(c) == 127 for c in glob):
        return "holds a control character"
    if "\\" in glob:
        return "holds a backslash"
    if glob[0] in "/:!":
        return "starts with %s (a glob is repo-relative, with no pathspec magic or negation)" % json.dumps(glob[0])
    if glob.endswith("/"):
        return "ends in / (write %s)" % json.dumps(glob + "**")
    if any(seg in ("", ".", "..") for seg in glob.split("/")):
        return "has an empty, . or .. segment"
    return None


def glob_class_problem(glob):
    """Why a `[…]` class in `glob` cannot be read (a range out of order, `[b-a]`), or None: `unreachable_paths`' check
    beyond glob_problem() (p52-1). Each class is found and built as inert-paths.py's _seg_re builds it, and the engine's
    unreachableGlobRe is that builder's port, so a glob this passes compiles in the engine too: the file, never the
    engine's args refusal, names the bad glob. A class git would read as matching nothing is refused, never matched."""
    for seg in glob.split("/"):
        i = 0
        while i < len(seg):
            j = seg.find("]", i + 2) if seg[i] == "[" else -1
            if j >= 0:
                body = seg[i + 1:j]
                if body[:1] in ("!", "^"):
                    body = "^" + body[1:]
                try:
                    with warnings.catch_warnings():
                        warnings.simplefilter("ignore")   # a `[` in a class is Python's "possible nested set"
                        re.compile("[" + body.replace("\\", "\\\\") + "]")
                except re.error as e:
                    return "holds the class %s, which cannot be read as one (%s)" % (json.dumps(seg[i:j + 1]), e.msg)
                i = j
            i += 1
    return None


def credential_problem(value):
    """Why a `test_credentials` value is no valid test-credential class (the header's rules, the first failure wins), or
    None. A refused value is described, never echoed."""
    if not isinstance(value, dict):
        return "must be an inline table { file = \"…\", keys = [ … ] }, got %s" % _describe(value)
    for key in value:
        if key not in ("file", "keys"):
            return "holds an unknown key %s (it holds exactly file and keys)" % json.dumps(key)
    for key in ("file", "keys"):
        if key not in value:
            return "has no %s (it holds exactly file and keys)" % key
    path = value["file"]
    if not isinstance(path, str):
        return "file must be a string, got %s" % _describe(path)
    if not (path.startswith("/") or path.startswith("~/")):
        return "file must be an absolute path (starting / or ~/)"
    if len(path) > 300:
        return "file is %d characters (at most 300)" % len(path)
    if any(ord(c) < 32 or ord(c) == 127 for c in path):
        return "file holds a control character"
    if "(" in path or ")" in path:
        return "file holds a ( or ) (the approval's annotation names it and ends at a ))"
    keys = value["keys"]
    if not isinstance(keys, list):
        return "keys must be a list of 1 to %d tables, got %s" % (MAX_CREDENTIAL_KEYS, _describe(keys))
    if not keys:
        return "keys is empty (it lists 1 to %d keys)" % MAX_CREDENTIAL_KEYS
    if len(keys) > MAX_CREDENTIAL_KEYS:
        return "keys holds %d entries (at most %d)" % (len(keys), MAX_CREDENTIAL_KEYS)
    names = set()
    for n, entry in enumerate(keys, 1):
        where = "keys entry %d" % n
        if not isinstance(entry, dict):
            return "%s must be a table { name = \"…\", prefix = \"…\" }, got %s" % (where, _describe(entry))
        for key in entry:
            if key not in ("name", "prefix", "supabase_project"):
                return "%s holds an unknown key %s (it holds name and one of prefix or supabase_project)" % (
                    where, json.dumps(key))
        if "name" not in entry:
            return "%s has no name" % where
        if ("prefix" in entry) == ("supabase_project" in entry):
            return "%s must hold exactly one of prefix or supabase_project" % where
        name = entry["name"]
        if not isinstance(name, str) or not CRED_NAME_RE.match(name):
            return ("%s: name must be an upper-snake env name (A-Z, 0-9 and _, with at least one _), got %s"
                    % (where, _describe(name) if not isinstance(name, str) else "a string of another form"))
        if LIVE_PROD_SEGMENT_RE.search(name):
            return "%s: name holds a LIVE or PROD segment (a live or production key is never a test credential)" % where
        if name in names:
            return "%s: its name is listed twice" % where
        names.add(name)
        if "prefix" in entry:
            prefix = entry["prefix"]
            if not isinstance(prefix, str) or not CRED_PREFIX_RE.match(prefix):
                return ("%s: prefix must be 3 to 40 of A-Z, a-z, 0-9 and _, got %s"
                        % (where, _describe(prefix) if not isinstance(prefix, str) else "a string of another form"))
            low = prefix.lower()
            if "live" in low or "prod" in low:
                return "%s: prefix holds live or prod (a live or production key is never a test credential)" % where
            if "test" not in low and "sandbox" not in low:
                return "%s: prefix holds no test or sandbox (a test credential's prefix says it is one)" % where
        else:
            ref = entry["supabase_project"]
            if not isinstance(ref, str) or not SUPABASE_REF_RE.match(ref):
                return ("%s: supabase_project must be a Supabase project ref (20 lowercase letters), got %s"
                        % (where, _describe(ref) if not isinstance(ref, str) else "a string of another form"))
    return None


def metered_problem(value):
    """Why a `metered_keys` value is no valid set of metered keys (the header's rules, the first failure wins), or None.
    A refused value is described, never echoed."""
    if not isinstance(value, dict):
        return "must be an inline table { file = \"…\", keys = [ … ] }, got %s" % _describe(value)
    for key in value:
        if key not in ("file", "keys"):
            return "holds an unknown key %s (it holds exactly file and keys)" % json.dumps(key)
    for key in ("file", "keys"):
        if key not in value:
            return "has no %s (it holds exactly file and keys)" % key
    path = value["file"]
    if not isinstance(path, str):
        return "file must be a string, got %s" % _describe(path)
    if not (path.startswith("/") or path.startswith("~/")):
        return "file must be an absolute path (starting / or ~/)"
    if len(path) > 300:
        return "file is %d characters (at most 300)" % len(path)
    if any(ord(c) < 32 or ord(c) == 127 for c in path):
        return "file holds a control character"
    if "(" in path or ")" in path:
        return "file holds a ( or ) (the approval's annotation names it and ends at a ))"
    keys = value["keys"]
    if not isinstance(keys, list):
        return "keys must be a list of 1 to %d tables, got %s" % (MAX_CREDENTIAL_KEYS, _describe(keys))
    if not keys:
        return "keys is empty (it lists 1 to %d keys)" % MAX_CREDENTIAL_KEYS
    if len(keys) > MAX_CREDENTIAL_KEYS:
        return "keys holds %d entries (at most %d)" % (len(keys), MAX_CREDENTIAL_KEYS)
    names = set()
    for n, entry in enumerate(keys, 1):
        where = "keys entry %d" % n
        if not isinstance(entry, dict):
            return "%s must be a table { name = \"…\", service = \"…\" }, got %s" % (where, _describe(entry))
        for key in entry:
            if key not in ("name", "service"):
                return "%s holds an unknown key %s (it holds exactly name and service)" % (where, json.dumps(key))
        for key in ("name", "service"):
            if key not in entry:
                return "%s has no %s (it holds exactly name and service)" % (where, key)
        name = entry["name"]
        if not isinstance(name, str) or not CRED_NAME_RE.match(name):
            return ("%s: name must be an upper-snake env name (A-Z, 0-9 and _, with at least one _), got %s"
                    % (where, _describe(name) if not isinstance(name, str) else "a string of another form"))
        if LIVE_PROD_SEGMENT_RE.search(name):
            return "%s: name holds a LIVE or PROD segment (a live or production key is never a metered key)" % where
        if name in names:
            return "%s: its name is listed twice" % where
        names.add(name)
        service = entry["service"]
        if not isinstance(service, str) or len(service) > 40 or not METERED_SERVICE_RE.match(service):
            return ("%s: service must be 2 to 40 of A-Z, a-z, 0-9, ., - and _ with single inner spaces, starting and "
                    "ending on a letter or digit, got %s"
                    % (where, _describe(service) if not isinstance(service, str) else "a string of another form"))
    return None


def logins_problem(value):
    """Why a `test_logins` value is no valid list of test Logins (the header's rules, the first failure wins), or
    None."""
    if not isinstance(value, list):
        return "must be a list of 1 to %d Login names, got %s" % (MAX_TEST_LOGINS, _describe(value))
    if not value:
        return "is empty (it lists 1 to %d Login names; remove the line to declare none)" % MAX_TEST_LOGINS
    if len(value) > MAX_TEST_LOGINS:
        return "holds %d names (at most %d)" % (len(value), MAX_TEST_LOGINS)
    seen = set()
    for name in value:
        if not isinstance(name, str):
            return "holds a name that is not a string (got %s)" % _describe(name)
        if not LOGIN_NAME_RE.match(name):
            return ("holds %s, which is not a Login name (a letter or digit, then up to 39 of A-Z, a-z, 0-9, _ and -)"
                    % json.dumps(name))
        if name.lower() in RESERVED_LOGIN_NAMES:
            return "holds the reserved name %s (claude, login and logins never name a Login)" % json.dumps(name)
        if name.lower() in seen:
            return "lists the name %s twice (ignoring case)" % json.dumps(name)
        seen.add(name.lower())
    return None


def file_schema(doc):
    """The file's top-level `schema` (1 when absent), or None when it is not an integer >= 1."""
    raw = (doc or {}).get("schema", 1)
    if isinstance(raw, bool) or not isinstance(raw, int) or raw < 1:
        return None
    return raw


def _validate(text, doc, path):
    """{"defaults": {...}, "guardrails": {...}, "repo": {slug: {...}}, "schema": N, "ignored": [...], "retired": [...]}
    from a parsed file, or SettingsError. A retired table (RETIRED) is skipped whole, never validated."""
    idx = _Lines(text)

    def refuse(reason, at):
        raise SettingsError(reason, line=idx.line_of(at), subject=path)

    schema = file_schema(doc)
    if schema is None:
        refuse("schema must be an integer >= 1 (the file's schema version), got %s" % _describe(doc.get("schema")),
               ("schema",))
    ignored = []

    def unknown(scope, key, label, at, why):
        """Ignore a newer file's unknown key (the schema rule), else refuse it with `why`."""
        known = tuple(k for (sc, k) in KEY_SCHEMA if sc == scope)
        miss = near_miss(key, known)
        if schema > SCHEMA and miss is None:
            ignored.append(label)
            return
        if miss is not None and schema > SCHEMA:
            why += " (a near-miss of %s, so it is refused even under a newer schema)" % json.dumps(miss)
        refuse(why, at)

    def newer(scope, key, at):
        """Refuse a known key the file's `schema` is too old for."""
        n = KEY_SCHEMA.get((scope, key), 1)
        if n > schema:
            refuse("%s.%s is a schema-%d key but the file says schema = %d: raise the file's top-level `schema` line to "
                   "%d in the same edit" % (scope, key, n, schema, n), at)

    for key in list(doc):
        if key not in TOP_KEYS:
            unknown("top", key, key, (key,),
                    "unknown top-level key %s (rollouts.toml holds only a top-level schema and [defaults], [guardrails], "
                    "[notify] and [repo.\"owner/name\"] tables)" % json.dumps(key))
        else:
            newer("top", key, (key,))

    def rollout_table(table, label, at):
        kept = {}
        for key, value in table.items():
            if key not in SETTING_KEYS + REPO_ONLY + DEFAULTS_ONLY:
                unknown("rollout", key, ".".join(json.dumps(a) if "/" in a else a for a in at + (key,)), at + (key,),
                        "%s: unknown key %s (a rollout table holds %s)" % (
                            label, json.dumps(key), ", ".join(SETTING_KEYS + REPO_ONLY + DEFAULTS_ONLY)))
                continue
            newer("rollout", key, at + (key,))
            if key in MACHINE_ONLY + DEFAULTS_ONLY and at[0] == "repo":
                refuse("%s %s is machine-wide: set it under [defaults]" % (label, key), at + (key,))
            if key == "test_logins":
                # p37-4: one line under [defaults], the declared test Logins, declared on his ruling only.
                if at + (key,) not in idx.closes:
                    refuse("%s test_logins must be one line: test_logins = [\"<name>\", …]" % label, at + (key,))
                why = logins_problem(value)
                if why:
                    refuse("%s test_logins %s" % (label, why), at + (key,))
                kept[key] = list(value)
                continue
            if key in CEILING_KEYS:
                # p46-10: a drawn role's Fable ceiling, an integer percent (MINIMUM never sees it).
                if isinstance(value, bool) or not isinstance(value, int) or not 0 <= value <= 100:
                    refuse("%s %s must be an integer from 0 to 100 (a percent), got %s" % (label, key, _describe(value)),
                           at + (key,))
                kept[key] = value
                continue
            if key in REPO_ONLY:
                if at[0] != "repo":
                    refuse("%s is per repo: set it under [repo.\"owner/name\"]" % key, at + (key,))
                if key == "test_credentials":
                    # ADR 0063: one line in its repo table, the only form inert-paths.py and tune.py edit around.
                    if at + (key,) not in idx.one_line:
                        refuse("%s test_credentials must be one line in that table: test_credentials = { file = \"…\", "
                               "keys = [ … ] } (inert-paths.py and tune.py edit this file line by line)" % label,
                               at + (key,))
                    why = credential_problem(value)
                    if why:
                        refuse("%s test_credentials: %s" % (label, why), at + (key,))
                    kept[key] = {"file": value["file"],
                                 "keys": [{k: entry[k] for k in ("name", "prefix", "supabase_project") if k in entry}
                                          for entry in value["keys"]]}
                    continue
                if key == "metered_keys":
                    # p56-6: one line in its repo table, as test_credentials is, for the same line-by-line writers.
                    if at + (key,) not in idx.one_line:
                        refuse("%s metered_keys must be one line in that table: metered_keys = { file = \"…\", "
                               "keys = [ { name = \"…\", service = \"…\" }, … ] } (inert-paths.py and tune.py edit "
                               "this file line by line)" % label, at + (key,))
                    why = metered_problem(value)
                    if why:
                        refuse("%s metered_keys: %s" % (label, why), at + (key,))
                    kept[key] = {"file": value["file"],
                                 "keys": [{"name": entry["name"], "service": entry["service"]} for entry in value["keys"]]}
                    continue
                if key in WEIGHT_KEYS:
                    # p53-3: the repo's estimated Weight, a finite number > 0 (a float: a scripts repo is ~0.8 GB).
                    if (isinstance(value, bool) or not isinstance(value, (int, float)) or not value > 0
                            or (isinstance(value, float) and not math.isfinite(value))):
                        refuse("%s %s must be a number > 0, got %s" % (label, key, _describe(value)), at + (key,))
                    kept[key] = value
                    continue
                if not isinstance(value, list):
                    refuse("%s %s must be a list of git pathspec globs, got %s" % (label, key, _describe(value)),
                           at + (key,))
                if len(value) > MAX_INERT_GLOBS:
                    refuse("%s %s holds %d globs (at most %d)" % (label, key, len(value), MAX_INERT_GLOBS), at + (key,))
                for glob in value:
                    if not isinstance(glob, str):
                        refuse("%s %s: each glob must be a string, got %s" % (label, key, _describe(glob)), at + (key,))
                    why = glob_problem(glob) or (glob_class_problem(glob) if key == "unreachable_paths" else None)
                    if why:
                        refuse("%s %s: the glob %s %s" % (label, key, json.dumps(glob), why), at + (key,))
                if len(set(value)) != len(value):
                    dup = next(g for g in value if value.count(g) > 1)
                    refuse("%s %s: the glob %s is listed twice" % (label, key, json.dumps(dup)), at + (key,))
                kept[key] = list(value)
                continue
            if isinstance(value, bool) or not isinstance(value, int) or value < MINIMUM[key]:
                refuse("%s %s must be an integer >= %d, got %s" % (label, key, MINIMUM[key], _describe(value)), at + (key,))
            kept[key] = value
        if "metered_keys" in kept and "test_credentials" in kept:
            # p56-6: a key is in one class, never both.
            test = {k["name"] for k in kept["test_credentials"]["keys"]}
            both = next((k["name"] for k in kept["metered_keys"]["keys"] if k["name"] in test), None)
            if both is not None:
                refuse("%s metered_keys: %s is also in test_credentials (a key is in one class)" % (label, both),
                       at + ("metered_keys",))
        return kept

    out = {"defaults": {}, "guardrails": {}, "repo": {}, "schema": schema, "ignored": ignored,
           "retired": [k for k in RETIRED if k in doc]}
    defaults = doc.get("defaults", {})
    if not isinstance(defaults, dict):
        refuse("defaults must be a table ([defaults]), got %s" % _describe(defaults), ("defaults",))
    out["defaults"] = rollout_table(defaults, "[defaults]", ("defaults",))

    guardrails = doc.get("guardrails", {})
    if not isinstance(guardrails, dict):
        refuse("guardrails must be a table ([guardrails]), got %s" % _describe(guardrails), ("guardrails",))
    kept = {}
    for key, value in guardrails.items():
        at = ("guardrails", key)
        if key not in GUARDRAIL_KEYS:
            unknown("guardrails", key, "guardrails." + key, at,
                    "[guardrails]: unknown key %s (guardrails are %s)" % (json.dumps(key), ", ".join(GUARDRAIL_KEYS)))
            continue
        newer("guardrails", key, at)
        kept[key] = value
        if key == "quota_stalls":
            if isinstance(value, bool) or not isinstance(value, int) or value < 0:
                refuse("[guardrails] quota_stalls must be an integer >= 0, got %s" % _describe(value), at)
        elif key == "hours_per_task":
            if (isinstance(value, bool) or not isinstance(value, (int, float)) or not value > 0
                    or (isinstance(value, float) and not math.isfinite(value))):
                refuse("[guardrails] hours_per_task must be a number > 0, got %s" % _describe(value), at)
        elif (isinstance(value, bool) or not isinstance(value, (int, float)) or value < 0
              or (isinstance(value, float) and not math.isfinite(value))):
            refuse("[guardrails] %s must be a non-negative number, got %s" % (key, _describe(value)), at)
    out["guardrails"] = kept

    repos = doc.get("repo", {})
    if not isinstance(repos, dict):
        refuse("repo must be a table of tables ([repo.\"owner/name\"]), got %s" % _describe(repos), ("repo",))
    seen = {}  # lowered slug -> the key as written
    for slug, table in repos.items():
        at = ("repo", slug)
        label = "[repo.%s]" % json.dumps(slug)
        if not isinstance(table, dict):  # `repo."o/r" = 5`, or a rollout key written straight under `[repo]`
            refuse("%s must be a table, got %s (a repo's keys go under [repo.\"owner/name\"])"
                   % (label, _describe(table)), at)
        if slug.lower().endswith(".git"):
            refuse("%s: a repo key never ends .git (write the origin's owner/name)" % label, at)
        if not SLUG_RE.match(slug) or not slug.split("/", 1)[1].strip("."):
            refuse("%s: a repo key is a GitHub owner/name ([A-Za-z0-9][A-Za-z0-9._-]*/[A-Za-z0-9._-]+, "
                   "a name that is not all dots)" % label, at)
        first = seen.get(slug.lower())
        if first is not None:
            first_line = idx.line_of(("repo", first))
            where = ", first at line %d" % first_line if first_line is not None else ""
            refuse("duplicate repo %s (same as %s%s, ignoring case)" % (json.dumps(slug), json.dumps(first), where), at)
        seen[slug.lower()] = slug
        out["repo"][slug.lower()] = rollout_table(table, label, at)
    return out


def load_tables(path):
    """The validated tables of the file at `path` (_validate's dict), or None when there is no file. SettingsError."""
    ladder = _ladder()
    try:
        read = ladder.read_toml(path)
    except ladder.LadderError as e:
        raise SettingsError(e.reason, line=e.line, code=e.code, subject=path)
    return None if read is None else _validate(read[0], read[1], path)


def _key_line_re(key):
    return re.compile(r"^(\s*(?:%s|\"%s\"|'%s')\s*=\s*)([^\s#]+)(.*)$" % (key, key, key))


def raise_schema_lines(lines, need, current):
    """`lines` with the top-level `schema` raised to `need` when it is above `current` (the file's, else 1): the
    header's rule. Never lowers it; a SettingsError for a schema line it will not edit."""
    if need <= current:
        return lines
    first = next((i for i, line in enumerate(lines)
                  if _AOT_RE.match(line.strip()) or _TABLE_RE.match(line.strip())), len(lines))
    for i in range(first):
        s = lines[i].strip()
        if not s or s.startswith("#"):
            continue
        m = _KEY_RE.match(s)
        if m and _segments(m.group(1)) == ("schema",):
            mm = _key_line_re("schema").match(lines[i])
            if not mm:
                raise SettingsError("cannot read the top-level schema line (line %d): edit it by hand" % (i + 1))
            return lines[:i] + [mm.group(1) + str(need) + mm.group(3)] + lines[i + 1:]
    at = first
    while at > 0 and lines[at - 1].strip().startswith("#"):
        at -= 1   # the comment lines directly over the header stay with it
    return lines[:at] + ["schema = %d" % need, ""] + lines[at:]


def _git_env():
    """The caller's env minus git's repo-local names (GIT_DIR & co.), as unfinished-rollout.py's git_env()."""
    try:
        names = subprocess.run(["git", "rev-parse", "--local-env-vars"], capture_output=True, text=True,
                               stdin=subprocess.DEVNULL, timeout=ORIGIN_TIMEOUT).stdout.split()
    except (OSError, subprocess.SubprocessError):
        names = []  # land.sh scrubs them again itself
    env = dict(os.environ)
    for name in names:
        env.pop(name, None)
    return env


def _origin_slug(repo):
    """land.sh --origin-slug <repo>: the owner/name, or None when the directory has no GitHub origin (exit 4)."""
    subject = "--repo %s" % repo
    try:
        p = subprocess.Popen(["bash", LAND_SH, "--origin-slug", repo], stdin=subprocess.DEVNULL,
                             stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=_git_env(),
                             start_new_session=True, text=True)
    except OSError as e:
        raise SettingsError("cannot read its origin (land.sh will not start: %s)" % (e.strerror or e), subject=subject)
    try:
        out, _err = p.communicate(timeout=ORIGIN_TIMEOUT)
    except subprocess.TimeoutExpired:
        # Kill the whole group before draining: a grandchild git holding the pipe would hang communicate().
        try:
            os.killpg(p.pid, signal.SIGKILL)
        except OSError:
            pass
        for f in (p.stdout, p.stderr):
            try:
                f.close()
            except OSError:
                pass
        p.wait()
        raise SettingsError("reading its origin timed out after %ss" % ORIGIN_TIMEOUT, subject=subject)
    if p.returncode == 4:
        return None
    slug = out.strip()
    if p.returncode != 0 or not slug:
        raise SettingsError("cannot read its origin (land.sh exit %d)" % p.returncode, subject=subject)
    return slug


def resolve(repo=None, path=None):
    """The resolved settings (the CLI's JSON object). Raises SettingsError (with .line, .code, .subject)."""
    if repo is not None:
        repo = os.path.expanduser(repo)
        if not os.path.isdir(repo):
            raise SettingsError("not a directory", subject="--repo %s" % repo)
    path = default_path() if path is None else path
    ladder = _ladder()
    try:
        read = ladder.read_toml(path)
    except ladder.LadderError as e:
        raise SettingsError(e.reason, line=e.line, code=e.code, subject=path)
    tables = (_validate(read[0], read[1], path) if read is not None
              else {"defaults": {}, "guardrails": {}, "repo": {}, "schema": 1, "ignored": [], "retired": []})

    slug, overrides = None, {}
    if repo is not None and tables["repo"]:
        slug = _origin_slug(repo)
        if slug is not None:
            overrides = tables["repo"].get(slug.lower(), {})

    settings = {}
    for key in SETTING_KEYS:
        if key in overrides:
            settings[key] = {"value": overrides[key], "source": "file:repo"}
        elif key in tables["defaults"]:
            settings[key] = {"value": tables["defaults"][key], "source": "file:defaults"}
        else:
            settings[key] = {"value": BUILT_IN[key], "source": "built-in"}
    guardrails = {}
    for key in GUARDRAIL_KEYS:
        if key in tables["guardrails"]:
            guardrails[key] = {"value": tables["guardrails"][key], "source": "file:guardrails"}
        else:
            guardrails[key] = {"value": GUARDRAILS_BUILT_IN[key], "source": "built-in"}
    inert = ({"value": list(overrides["inert_paths"]), "source": "file:repo"} if "inert_paths" in overrides
             else {"value": [], "source": "built-in"})
    creds = overrides.get("test_credentials")
    creds = ({"value": {"file": creds["file"], "keys": [dict(k) for k in creds["keys"]]}, "source": "file:repo"}
             if creds is not None else {"value": None, "source": "built-in"})
    metered = overrides.get("metered_keys")
    metered = ({"value": {"file": metered["file"], "keys": [dict(k) for k in metered["keys"]]}, "source": "file:repo"}
               if metered is not None else {"value": None, "source": "built-in"})
    logins = ({"value": list(tables["defaults"]["test_logins"]), "source": "file:defaults"}
              if "test_logins" in tables["defaults"] else {"value": [], "source": "built-in"})
    weight = {}
    for key in WEIGHT_KEYS:
        part = key[len("weight_"):]
        weight[part] = ({"value": overrides[key], "source": "file:repo"} if key in overrides
                        else {"value": WEIGHT_BUILT_IN[key], "source": "built-in"})
    unreachable = ({"value": list(overrides["unreachable_paths"]), "source": "file:repo"}
                   if "unreachable_paths" in overrides else {"value": [], "source": "built-in"})
    ceiling = {CEILING_ROLES[key]: ({"value": tables["defaults"][key], "source": "file:defaults"}
                                    if key in tables["defaults"] else {"value": None, "source": "built-in"})
               for key in CEILING_KEYS}
    return {"path": path, "file": read is not None, "repo": slug, "settings": settings, "guardrails": guardrails,
            "inert_paths": inert, "test_credentials": creds, "metered_keys": metered, "test_logins": logins,
            "weight": weight,
            "unreachable_paths": unreachable, "fable_ceiling": ceiling,
            "schema": {"file": tables["schema"], "engine": SCHEMA}, "ignored": list(tables["ignored"]),
            "retired": list(tables["retired"])}


def fable_ceilings(part, ladder):
    """Each drawn role's Fable ceiling (p46-10, the header's seed rule: its one copy), {role: {percent, share, source}}
    in SHARE_ROLES order. `part` is resolve()'s `fable_ceiling`; `ladder` is ladder.py's load() (its `share`, the seed,
    and its `roles`). A role this file sets reads source `rollouts`, percent its value and share percent / 100; a role it
    does not set and the ladder's `[share]` names reads source `ladder`, share as written and percent round(100 x
    share); a role neither names, and one the ladder's `[role]` gives its own model (never drawn), is absent."""
    part = part if isinstance(part, dict) else {}
    seed = (ladder or {}).get("share") or {}
    own = (ladder or {}).get("roles") or {}
    out = {}
    for key in CEILING_KEYS:
        role = CEILING_ROLES[key]
        if role in own:
            continue
        v = (part.get(role) or {}).get("value")
        if isinstance(v, int) and not isinstance(v, bool):
            out[role] = {"percent": v, "share": v / 100.0, "source": "rollouts"}
        elif isinstance(seed.get(role), (int, float)) and not isinstance(seed.get(role), bool):
            out[role] = {"percent": int(round(100 * seed[role])), "share": seed[role], "source": "ladder"}
    return out


# ---- declaring: an agent writes a ruled declaration (p56-5; ADR 0063's 2026-11-24 amendment) -------------------------
# The header's Declaring section is the one copy of these rules. tempfile, difflib, datetime, stat, secrets and
# unicodedata are imported inside the functions that use them, so a script that loads this module as a reader pays
# nothing for the writer.

DECLARATIONS = "rollouts.declarations.jsonl"
MAX_WORDS = 2000    # his quoted words, in characters
MAX_SOURCE = 300    # where he said them
# The keys `declare` never writes, each with who writes it instead.
UNDECLARABLE = {
    "inert_paths": "inert-paths.py `record` and `drop` write it, proving each glob first (schedule § 2.9)",
    "schema": "the writer that adds a newer key raises it in the same edit",
}
_BARE_KEY_RE = re.compile(r"[A-Za-z0-9_-]+\Z")
_SAID_RE = re.compile(r"([0-9]{4})-([0-9]{2})-([0-9]{2})\Z")   # ASCII digits only: \d takes any Unicode digit
_ABSENT = object()   # a key that is not set, where None could be a value
_NO_TABLES = {"defaults": {}, "guardrails": {}, "repo": {}, "schema": 1, "ignored": [], "retired": []}


class _Stop(Exception):
    """A verb's refusal: one `rollout-settings: <verb>: <reason>` line and its exit code."""

    def __init__(self, reason, code):
        Exception.__init__(self, reason)
        self.reason = reason
        self.code = code


def _today():
    """Today, the machine's LOCAL date: the day Lachy would name for his own words (the header's clock rule). The one
    seam every date a verb writes or bounds goes through."""
    import datetime
    return datetime.date.today()


def _ruling_text(flag, raw, limit, missing):
    """`raw`, stripped, when it can stand in the log and the one-line report: non-empty (else a _Stop(2) saying
    `missing`), at most `limit` characters, and no control character or line separator. --words and --source both go
    through it."""
    import unicodedata
    text = (raw or "").strip()
    if not text:
        raise _Stop(missing, 2)
    if len(text) > limit:
        raise _Stop("%s is %d characters (at most %d)" % (flag, len(text), limit), 2)
    if any(unicodedata.category(c) in ("Cc", "Zl", "Zp") for c in text):
        raise _Stop("%s holds a control character (one line of plain text only)" % flag, 2)
    return text


def _ruling(a):
    """(words, said, source) from a verb's flags, or a _Stop(2): the header's rule for what counts as ruled."""
    import datetime
    words = _ruling_text("--words", a.words, MAX_WORDS,
                         "no ruling: --words \"<his words, quoted>\" is required (a declaration is written only on "
                         "his words; with none it stays his question)")
    if not a.said:
        raise _Stop("no ruling: --said <YYYY-MM-DD> is required (the day he said them)", 2)
    m = _SAID_RE.match(a.said)
    try:
        said = datetime.date(*(int(g) for g in m.groups())) if m else None
    except ValueError:
        said = None
    if said is None:
        raise _Stop("--said %s is no date (YYYY-MM-DD, the day he said them)" % a.said, 2)
    today = _today()
    if said > today:
        raise _Stop("--said %s is after today (%s, this machine's date): words he has not said yet are no ruling"
                    % (a.said, today.isoformat()), 2)
    source = None
    if a.source is not None:
        source = _ruling_text("--source", a.source, MAX_SOURCE,
                              "--source is empty (leave it out, or say where he said it)")
    return words, said.isoformat(), source


def toml_value(value):
    """The ONE-line TOML for a JSON value: a string through json.dumps, an integer, a finite float, a list, or an
    inline table with bare keys. A ValueError saying why a value has none (null, a float that is not finite, a table
    key that is no bare key, a string that is no Unicode text)."""
    if value is None:
        raise ValueError("null has no TOML form (--remove takes a key out)")
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ValueError("a float that is not finite")
        return repr(value)
    if isinstance(value, str):
        try:
            value.encode("utf-8")
        except UnicodeEncodeError:
            raise ValueError("a string that is no Unicode text (a lone surrogate)")
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value, list):
        return "[" + ", ".join(toml_value(v) for v in value) + "]"
    if isinstance(value, dict):
        parts = []
        for k, v in value.items():
            if not _BARE_KEY_RE.match(k):
                raise ValueError("a table key %s that is no bare TOML key" % json.dumps(k))
            parts.append("%s = %s" % (k, toml_value(v)))
        return "{ " + ", ".join(parts) + " }" if parts else "{}"
    raise ValueError("a value of no TOML type")


def _same(a, b):
    """Two JSON values equal by value AND type (True is not 1, 25 is not 25.0), whatever a table's key order."""
    return json.dumps(a, sort_keys=True) == json.dumps(b, sort_keys=True)


def _table_scan(lines, target, label):
    """Where the table `target` sits in `lines` (("defaults",), ("guardrails",) or ("repo", slug), the slug matched
    ignoring case): {"header": its header's index or None, "name": the header's segments as written, "end": the index
    of the next header (len(lines) with none), "last": the index of the last line of its last key (its header's with no
    key), "keys": {key: [first line, last line]}, "outside": for each line, whether it starts outside every value}.
    tune.py's _edit_table scan for one table, reading only the lines that start outside every value (the _Lines scan),
    so a key-shaped line inside a multi-line value is no key and a key whose value spans lines is known by its span.
    A _Stop(2) for a form no line edit is safe on: the table's keys set in dotted or inline-table form."""
    def same(table):
        if len(table) != len(target) or table[0] != target[0]:
            return False
        return len(target) == 1 or table[1].lower() == target[1].lower()

    scan = _Lines("")
    table, header, name, end, open_key = (), None, None, None, None
    keys, outside = {}, []
    for i, line in enumerate(lines):
        out = scan._string is None and not scan._brackets
        outside.append(out)
        s = line.strip()
        scan._line(i + 1, s)
        if not out:
            if open_key is not None:
                keys[open_key][1] = i
            continue
        open_key = None
        if not s or s.startswith("#"):
            continue
        m = _AOT_RE.match(s) or _TABLE_RE.match(s)
        if m:
            table = _segments(m.group(1))
            if header is not None and end is None:
                end = i
            if header is None and same(table):
                header, name = i, table
            continue
        m = _KEY_RE.match(s)
        if not m:
            continue
        segs = _segments(m.group(1))
        path = table + segs
        if path[0] != target[0]:
            continue
        if header is not None and end is None and len(segs) == 1:
            keys[segs[0]] = [i, i]
            open_key = segs[0]
        elif len(path) < len(target) or same(path[:len(target)]):
            raise _Stop("%s is set in dotted or inline-table form in the config: edit it by hand" % label, 2)
    last = max([span[1] for span in keys.values()] + [header]) if header is not None else None
    return {"header": header, "name": name, "end": len(lines) if end is None else end, "last": last, "keys": keys,
            "outside": outside}


def restore_at(lines, at, above, below):
    """The ONE index inside the table's span (`at`, _table_scan's) where a removed line goes back between the raw
    lines `above` and `below` (`below` None: it was the file's last line), or None when no index or more than one fits:
    the lines around its old place were edited since, or repeat (two blank pairs)."""
    if at["header"] is None or not isinstance(above, str):
        return None
    hits = []
    for p in range(at["header"] + 1, at["end"] + 1):
        if lines[p - 1] != above:
            continue
        if p < len(lines):
            fits = below is not None and lines[p] == below and at["outside"][p]
        else:
            fits = below is None
        if fits:
            hits.append(p)
    return hits[0] if len(hits) == 1 else None


def declare_edit(lines, target, label, key, new_line, place=None):
    """`lines` edited for ONE key of the table `target` (the third line editor of this file, beside tune.py's
    _edit_table and inert-paths.py's edit_inert): {"lines": the result, "replaced": the key's old line whole (comment
    included) or None, "above" and "below": the raw lines around a deleted line (`below` None at the end of the file),
    "placed": "old" or "end" for an insert given `place`}.
    - `new_line` a string: the key's line is replaced whole by it; with no such line it is inserted after the table's
      last key (at `place`, an (above, below) pair, when restore_at() finds that place); with no table, the header
      `label` is appended with it.
    - `new_line` None: the key's line is deleted.
    A _Stop(2) for a form it will not edit: the table in dotted or inline form (_table_scan), or the key's value
    spanning lines."""
    lines = list(lines)
    at = _table_scan(lines, target, label)
    out = {"replaced": None, "above": None, "below": None, "placed": None}
    span = at["keys"].get(key)
    if span is not None:
        if span[0] != span[1]:
            raise _Stop("the %s line in %s spans lines (line %d): edit it by hand" % (key, label, span[0] + 1), 2)
        i = span[0]
        out["replaced"] = lines[i]
        if new_line is None:
            out["above"] = lines[i - 1]   # its table's header is above it, so i >= 1
            out["below"] = lines[i + 1] if i + 1 < len(lines) else None
            del lines[i]
        else:
            lines[i] = new_line
    elif new_line is not None:
        pos = restore_at(lines, at, place[0], place[1]) if place else None
        if place:
            out["placed"] = "end" if pos is None else "old"
        if at["header"] is None:
            if lines and lines[-1].strip():
                lines.append("")
            lines.extend([label, new_line])
        else:
            lines.insert(at["last"] + 1 if pos is None else pos, new_line)
    out["lines"] = lines
    return out


def declarations_path(config=None):
    """The declarations log: rollouts.declarations.jsonl beside the config path (the default path's with none)."""
    config = os.path.expanduser(config or default_path())
    return os.path.join(os.path.dirname(os.path.abspath(config)), DECLARATIONS)


def read_declarations(path):
    """(entries, skipped): the log's lines in file order, each a JSON object with a string `id`; a line that is
    anything else is skipped and counted, so it never matches an id. No file is ([], 0); another OSError is raised."""
    try:
        with open(path, "rb") as f:
            data = f.read()
    except FileNotFoundError:
        return [], 0
    entries, skipped = [], 0
    for raw in data.split(b"\n"):
        if not raw.strip():
            continue
        try:
            d = json.loads(raw.decode("utf-8"))
        except ValueError:   # a UnicodeDecodeError is one
            d = None
        if not isinstance(d, dict) or not isinstance(d.get("id"), str):
            skipped += 1
            continue
        entries.append(d)
    return entries, skipped


def _reader_check(new_file, tasks_dir):
    """(refusals, warnings): every live rollout's engine root asked to read `new_file`, through inert-paths.py's
    reader_check(), the check's one copy, its lines led `rollout-settings`; there is no --force, so no line offers one.
    Loaded lazily and only here: inert-paths.py loads this file as its own module instance, so it is no cycle. No
    bytecode is written beside the scripts."""
    sys.dont_write_bytecode = True
    spec = importlib.util.spec_from_file_location("thread_inert_paths", os.path.join(HERE, "inert-paths.py"))
    if spec is None or spec.loader is None:
        raise ImportError("no loader for inert-paths.py")
    ip = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(ip)
    return ip.reader_check(new_file, tasks_dir or ip.ES.DEFAULT_TASKS_DIR, who="rollout-settings", force=False)


def _raw(path):
    """The file's bytes, None with nothing at the path."""
    try:
        with open(path, "rb") as f:
            return f.read()
    except (FileNotFoundError, NotADirectoryError):
        return None


def _declare_read(config):
    """What a verb reads before it edits: {"config", "real" (the realpath it edits), "raw" (its bytes, None for no
    file: the compare-and-swap's side), "text", "before" (the validated tables), "doc"}. A SettingsError when the file
    as it stands is refused; a _Stop(1) when it changed between the two reads."""
    real = os.path.realpath(config)
    ladder = _ladder()
    try:
        read = ladder.read_toml(config)
    except ladder.LadderError as e:
        raise SettingsError(e.reason, line=e.line, code=e.code, subject=config)
    before = _validate(read[0], read[1], config) if read is not None else dict(_NO_TABLES)
    try:
        raw = _raw(real)
    except OSError as e:
        raise _Stop("cannot read %s: %s" % (config, e.strerror or e), 1)
    if (raw is None) != (read is None) or (raw is not None and raw != read[0].encode("utf-8")):
        raise _Stop("%s changed while it was read: re-run" % config, 1)
    return {"config": config, "real": real, "raw": raw, "text": read[0] if read else "", "before": before,
            "doc": read[1] if read else {}}


def _split(text):
    """(lines, trailing): the text's lines without its final newline, and whether it had one (an empty text: yes)."""
    lines = text.split("\n") if text else []
    trailing = not lines or lines[-1] == ""
    return (lines[:-1] if lines and trailing else lines), trailing


def _unintended(before, after, target, key, expect):
    """Why `after` is not `before` with exactly `key` of the table `target` at `expect` (_ABSENT: not set), or None:
    every other table, key and repo identical, and `schema` only ever raised."""
    b = {k: dict(before[k]) for k in ("defaults", "guardrails", "repo")}
    a = {k: dict(after[k]) for k in ("defaults", "guardrails", "repo")}
    if target[0] == "repo":
        mine_b, mine_a = dict(b["repo"].pop(target[1].lower(), {})), dict(a["repo"].pop(target[1].lower(), {}))
    else:
        mine_b, mine_a = b[target[0]], a[target[0]]
    mine_b.pop(key, None)
    got = mine_a.pop(key, _ABSENT)
    if not _same(mine_b, mine_a):
        return "another key of its table changes"
    if not _same(b, a):
        return "another table changes"
    if after["schema"] < before["schema"]:
        return "the schema is lowered"
    if after["ignored"] != before["ignored"] or after["retired"] != before["retired"]:
        return "what is ignored or retired changes"
    if (got is _ABSENT) != (expect is _ABSENT) or (got is not _ABSENT and not _same(got, expect)):
        return "%s reads %s" % (key, "not set" if got is _ABSENT else json.dumps(got, ensure_ascii=False))
    return None


def _new_entry(verb):
    """A log line's head: its `id` (`d-<UTC compact>-<4 hex>`) and `ts`, both UTC, and `declared`, the local date."""
    import datetime
    import secrets
    now = datetime.datetime.now(datetime.timezone.utc)
    return {"id": "d-%s-%s" % (now.strftime("%Y%m%dT%H%M%SZ"), secrets.token_hex(2)),
            "ts": now.strftime("%Y-%m-%dT%H:%M:%SZ"), "declared": _today().isoformat(), "verb": verb}


def _append_log(path, entry):
    """ONE line appended to the declarations log: O_APPEND, one os.write, its length checked, fsync. A log whose last
    line is torn (no final newline) gets a newline first, in the same write. An OSError on any failure."""
    data = (json.dumps(entry, ensure_ascii=False) + "\n").encode("utf-8")
    fd = os.open(path, os.O_RDWR | os.O_APPEND | os.O_CREAT, 0o644)
    try:
        size = os.fstat(fd).st_size
        if size and os.pread(fd, 1, size - 1) != b"\n":
            data = b"\n" + data
        n = os.write(fd, data)
        if n != len(data):
            raise OSError("a short write (%d of %d bytes)" % (n, len(data)))
        os.fsync(fd)
    finally:
        os.close(fd)


def _declare_write(read, new_lines, trailing, target, key, expect, entry, tasks_dir, dry_run):
    """The write both verbs share, in the header's order: the temp file beside the real one; the reader's validation
    and the intended result (exactly the one key changed); the reader check, at every write; the compare-and-swap; the
    ONE log line; the replace, voided in the log when it fails. `entry` is the log line less its `schema`. True when
    written, False on --dry-run (the diff and the would-be line printed, nothing left behind). A _Stop otherwise,
    nothing written but what its reason names."""
    import difflib
    import stat
    import tempfile
    config, real = read["config"], read["real"]
    log = declarations_path(config)
    new_text = "\n".join(new_lines) + ("\n" if trailing and new_lines else "")
    made, tmp, done = [], None, False
    try:
        d, missing = os.path.dirname(real), []
        while d and not os.path.exists(d):
            missing.append(d)
            if os.path.dirname(d) == d:
                break
            d = os.path.dirname(d)
        for d in reversed(missing):
            os.mkdir(d)
            made.append(d)
        fd, tmp = tempfile.mkstemp(dir=os.path.dirname(real), prefix="." + os.path.basename(real) + ".", suffix=".tmp")
        with os.fdopen(fd, "wb") as f:
            f.write(new_text.encode("utf-8"))
        os.chmod(tmp, stat.S_IMODE(os.stat(real).st_mode) if read["raw"] is not None else 0o644)
        try:
            after = load_tables(tmp)
        except SettingsError as e:
            e.subject = config   # the reader's own reason, at the config's path: the temp file is gone by then
            raise _Stop("the edit does not validate (%s): nothing written" % e, e.code)
        why = _unintended(read["before"], after, target, key, expect)
        if why:
            raise _Stop("the edit resolves another result than intended (%s): nothing written" % why, 2)
        try:
            refusals, warns = _reader_check(tmp, tasks_dir)
        except Exception as e:   # fail closed: a check that will not load or run refuses the write
            raise _Stop("the reader check did not run (%s: %s): nothing written" % (type(e).__name__, e), 1)
        for line in warns + refusals:
            sys.stderr.write(line + "\n")
        if refusals:
            raise _Stop("nothing written: a live rollout's engine cannot read the new file", 1)
        entry = dict(entry)
        undoes = entry.pop("undoes", None)   # the line's tail, after its schema
        entry["schema"] = {"from": read["before"]["schema"], "to": after["schema"]}
        if undoes is not None:
            entry["undoes"] = undoes
        if dry_run:
            for line in difflib.unified_diff(read["text"].split("\n"), new_text.split("\n"), config,
                                             config + " (declared)", lineterm=""):
                print(line)
            print("would log in %s: %s" % (log, json.dumps(entry, ensure_ascii=False)))
            return False
        if _raw(real) != read["raw"]:
            raise _Stop("%s changed while checking: re-run" % config, 1)
        try:
            _append_log(log, entry)
        except (OSError, ValueError) as e:
            raise _Stop("the log line could not be written (%s): nothing declared, rollouts.toml is unchanged"
                        % (getattr(e, "strerror", None) or e), 1)
        try:
            os.replace(tmp, real)
        except OSError as e:
            void = dict(_new_entry("void"), table=entry["table"], key=key, voids=entry["id"])
            try:
                _append_log(log, void)
                tail = "; %s voided by %s" % (entry["id"], void["id"])
            except (OSError, ValueError):
                tail = ""
                sys.stderr.write("rollout-settings: the void line could not be written either: %s claims %s, but "
                                 "rollouts.toml lacks it\n" % (log, entry["id"]))
            raise _Stop("rollouts.toml was not written (%s): nothing declared%s" % (e.strerror or e, tail), 1)
        done = True
        return True
    except OSError as e:
        raise _Stop("cannot write next to %s: %s" % (real, e.strerror or e), 1)
    finally:
        if not done:
            if tmp:
                try:
                    os.unlink(tmp)
                except OSError:
                    pass
            for d in reversed(made):
                try:
                    os.rmdir(d)
                except OSError:
                    pass


def _placement(key, repo):
    """(target, scope) for a key `declare` writes: its table is derived, never chosen. A guardrail goes to
    [guardrails], a machine-wide key (MACHINE_ONLY, DEFAULTS_ONLY) to [defaults], and both refuse --repo; a REPO_ONLY
    key needs --repo; any other rollout key goes to [defaults] without --repo and to the repo's table with it. `scope`
    is the key's KEY_SCHEMA scope. A _Stop(2) for a key it never writes (UNDECLARABLE), an unknown key (its near-miss
    named), a --repo that is no directory or has no GitHub origin: all before the file is read."""
    if key in UNDECLARABLE:
        raise _Stop("%s is never declared: %s" % (key, UNDECLARABLE[key]), 2)
    known = SETTING_KEYS + REPO_ONLY + DEFAULTS_ONLY + GUARDRAIL_KEYS
    if key not in known:
        miss = near_miss(key, known + ("schema",))
        raise _Stop("unknown key %s%s: declare writes %s" % (
            json.dumps(key), " (a near-miss of %s)" % json.dumps(miss) if miss else "",
            ", ".join(k for k in known if k not in UNDECLARABLE)), 2)
    machine = key in GUARDRAIL_KEYS + MACHINE_ONLY + DEFAULTS_ONLY
    if repo is None:
        if key in REPO_ONLY:
            raise _Stop("%s is per repo: it needs --repo <dir> (the clone whose GitHub origin names its table)" % key, 2)
        return (("guardrails",) if key in GUARDRAIL_KEYS else ("defaults",)), \
            ("guardrails" if key in GUARDRAIL_KEYS else "rollout")
    if machine:
        raise _Stop("%s is machine-wide: it takes no --repo" % key, 2)
    repo = os.path.expanduser(repo)
    if not os.path.isdir(repo):
        raise _Stop("--repo %s is not a directory" % repo, 2)
    slug = _origin_slug(repo)   # a SettingsError, exit 2, when the origin cannot be read
    if slug is None:
        raise _Stop("--repo %s has no GitHub origin (land.sh exit 4): no repo table can be named" % repo, 2)
    return ("repo", slug), "rollout"


def _label(target, name=None):
    """A table's header text, its repo key as written (`name`, the header's segments) when it has one."""
    return "[%s]" % target[0] if target[0] != "repo" else "[repo.%s]" % json.dumps((name or target)[1])


def _said_of(words, said, source):
    return "his words, %s: \"%s\"%s" % (said, words, ", %s" % source if source else "")


def cmd_declare(a):
    if (a.value is None) == (not a.remove):
        raise _Stop("give exactly one of --value and --remove (--value '<JSON>' sets the key, --remove takes it out)", 2)
    words, said, source = _ruling(a)
    value = None
    if not a.remove:
        def constant(name):
            raise ValueError("%s is no value a settings file holds" % name)
        try:
            value = json.loads(a.value, parse_constant=constant)
        except (ValueError, RecursionError) as e:
            raise _Stop("--value is not JSON (%s)" % e, 2)
        try:
            rendered = toml_value(value)
        except (ValueError, RecursionError) as e:
            raise _Stop("--value %s: %s" % ("null" if value is None else "has no one-line TOML form", e), 2)
    target, scope = _placement(a.key, a.repo)
    config = os.path.expanduser(a.config or default_path())
    read = _declare_read(config)
    lines, trailing = _split(read["text"])
    label = _label(target)
    at = _table_scan(lines, target, label)
    label = _label(target, at["name"])
    table = read["before"]["repo"].get(target[1].lower(), {}) if target[0] == "repo" else read["before"][target[0]]
    current = table.get(a.key, _ABSENT)
    if (a.remove and current is _ABSENT) or (not a.remove and current is not _ABSENT and _same(current, value)):
        print("rollout-settings: nothing to change: %s %s %s in %s" % (
            label, a.key, "is not set" if a.remove else "is already %s" % rendered, config))
        return 0
    entry = _new_entry("remove" if a.remove else "declare")
    new_line = None if a.remove else "%s = %s  # declared %s by an agent on his words of %s: %s %s" % (
        a.key, rendered, entry["declared"], said, DECLARATIONS, entry["id"])
    ed = declare_edit(lines, target, label, a.key, new_line)
    try:
        new_lines = raise_schema_lines(ed["lines"], 1 if a.remove else KEY_SCHEMA.get((scope, a.key), 1),
                                       read["before"]["schema"])
    except SettingsError as e:
        raise _Stop(str(e), 2)
    entry.update({"table": label[1:-1], "key": a.key, "value": value, "was": None if current is _ABSENT else current,
                  "words": words, "said": said, "source": source, "line": new_line, "replaced": ed["replaced"]})
    if a.remove:
        entry.update({"above": ed["above"], "below": ed["below"]})
    if not _declare_write(read, new_lines, trailing, target, a.key, _ABSENT if a.remove else value, entry, a.tasks_dir,
                          a.dry_run):
        return 0
    log = declarations_path(config)
    was = "not set" if ed["replaced"] is None else ed["replaced"].strip()
    undo = "undo: rollout-settings.py undo --id %s --words \"<his words>\" --said <YYYY-MM-DD>%s" % (
        entry["id"], " --config %s" % a.config if a.config else "")
    if a.remove:
        print("removed %s %s from %s (was: %s); %s; logged %s in %s; %s"
              % (label, a.key, config, was, _said_of(words, said, source), entry["id"], log, undo))
    else:
        print("declared %s %s = %s in %s (was: %s); %s; logged %s in %s; %s"
              % (label, a.key, rendered, config, was, _said_of(words, said, source), entry["id"], log, undo))
    return 0


def cmd_undo(a):
    words, said, source = _ruling(a)
    config = os.path.expanduser(a.config or default_path())
    log = declarations_path(config)
    try:
        entries, skipped = read_declarations(log)
    except OSError as e:
        raise _Stop("cannot read %s: %s" % (log, e.strerror or e), 1)
    if skipped:
        sys.stderr.write("WARN: rollout-settings: %s: %d line(s) that are no log line, skipped\n" % (log, skipped))
    e = next((d for d in entries if d["id"] == a.id), None)
    if e is None:
        raise _Stop("%s is no declaration in %s" % (a.id, log), 2)
    if e.get("verb") not in ("declare", "remove"):
        raise _Stop("%s is %s line: only a declare or a remove is undone" % (
            a.id, {"undo": "an undo", "void": "a void"}.get(e.get("verb"), "no declare or remove")), 2)
    voided = {d.get("voids") for d in entries if d.get("verb") == "void"}
    if a.id in voided:
        raise _Stop("%s was voided (its write never reached rollouts.toml): nothing to undo" % a.id, 2)
    by = next((d["id"] for d in entries if d.get("verb") == "undo" and d.get("undoes") == a.id
               and d["id"] not in voided), None)
    if by is not None:
        raise _Stop("%s is already undone (by %s)" % (a.id, by), 2)
    key, name, replaced = e.get("key"), e.get("table"), e.get("replaced")
    target = None
    if name in ("defaults", "guardrails"):
        target = (name,)
    elif isinstance(name, str) and name.startswith("repo."):
        try:
            slug = json.loads(name[len("repo."):])
            target = ("repo", slug) if isinstance(slug, str) and SLUG_RE.match(slug) else None
        except ValueError:
            target = None
    known = SETTING_KEYS + REPO_ONLY + DEFAULTS_ONLY + GUARDRAIL_KEYS
    removal = e["verb"] == "remove"
    if (target is None or key not in known or key in UNDECLARABLE
            or not (isinstance(replaced, str) if removal else replaced is None or isinstance(replaced, str))
            or (isinstance(replaced, str) and ("\n" in replaced or "\r" in replaced))
            or (not removal and not isinstance(e.get("line"), str))):
        raise _Stop("%s's log line cannot be read back (its table, key or lines): edit the file by hand" % a.id, 2)
    scope = "guardrails" if key in GUARDRAIL_KEYS else "rollout"
    read = _declare_read(config)
    lines, trailing = _split(read["text"])
    at = _table_scan(lines, target, _label(target))
    label = _label(target, at["name"])
    table = read["before"]["repo"].get(target[1].lower(), {}) if target[0] == "repo" else read["before"][target[0]]
    span = at["keys"].get(key)
    if removal:
        if span is not None or key in table:
            raise _Stop("%s is set again in %s since %s removed it: left alone (declare --remove takes it out)"
                        % (key, label, a.id), 2)
        new_line, place, expect = replaced, (e.get("above"), e.get("below")), e.get("was")
    else:
        if span is None or span[0] != span[1] or lines[span[0]] != e["line"]:
            raise _Stop("the %s line in %s has changed since %s (a later declaration, a hand edit or a Tuning moved "
                        "it): left alone; declare the key again to replace it" % (key, label, a.id), 2)
        new_line, place = replaced, None
        expect = _ABSENT if replaced is None else e.get("was")
    ed = declare_edit(lines, target, label, key, new_line, place)
    try:
        new_lines = raise_schema_lines(ed["lines"], 1 if new_line is None else KEY_SCHEMA.get((scope, key), 1),
                                       read["before"]["schema"])
    except SettingsError as err:
        raise _Stop(str(err), 2)
    entry = _new_entry("undo")
    entry.update({"table": label[1:-1], "key": key, "value": None if expect is _ABSENT else expect,
                  "was": table.get(key), "words": words, "said": said, "source": source, "line": new_line,
                  "replaced": ed["replaced"], "undoes": a.id})
    if not _declare_write(read, new_lines, trailing, target, key, expect, entry, a.tasks_dir, a.dry_run):
        return 0
    print("undone %s: %s %s in %s (now: %s); %s; logged %s in %s%s" % (
        a.id, label, key, config, "not set" if new_line is None else new_line.strip(), _said_of(words, said, source),
        entry["id"], log,
        "; restored at the end of %s: the lines around its old place have changed" % label
        if ed["placed"] == "end" else ""))
    return 0


def _declare_main(argv):
    """`declare` and `undo`, the only forms that write (the header's Declaring section). Exit 0 written, nothing to
    change, or --dry-run; 1 the reader check refused or did not run, the file changed under it, or the log or the
    replace failed; 2 usage, no ruling, a refused key, value or form, an edit that does not validate, an undo it
    refuses; 3 tomllib missing."""
    sys.dont_write_bytecode = True   # ladder.py and inert-paths.py are loaded by path: no __pycache__ beside them
    verb = argv[0]

    class Parser(argparse.ArgumentParser):
        def error(self, message):
            sys.stderr.write("rollout-settings: %s: %s\n" % (verb, message))
            sys.exit(2)

    p = Parser(prog="rollout-settings %s" % verb, allow_abbrev=False,
               description="Write a declaration Lachy has ruled on into the rollout settings, or take one back.")
    if verb == "declare":
        p.add_argument("--key", required=True)
        p.add_argument("--value")
        p.add_argument("--remove", action="store_true")
        p.add_argument("--repo")
    else:
        p.add_argument("--id", required=True)
    p.add_argument("--words")
    p.add_argument("--said")
    p.add_argument("--source")
    p.add_argument("--config")
    p.add_argument("--tasks-dir")
    p.add_argument("--dry-run", action="store_true")
    a = p.parse_args(argv[1:])
    try:
        return (cmd_declare if verb == "declare" else cmd_undo)(a)
    except _Stop as e:
        sys.stderr.write("rollout-settings: %s: %s\n" % (verb, e.reason))
        return e.code
    except SettingsError as e:
        sys.stderr.write("rollout-settings: %s: %s\n" % (verb, e))
        return e.code


class _Parser(argparse.ArgumentParser):
    def error(self, message):  # argparse's default prints multi-line usage; keep failures to one line
        sys.stderr.write("rollout-settings: %s\n" % message)
        sys.exit(2)


def main(argv):
    if argv and argv[0] in ("declare", "undo"):   # the two verbs that write; every other argv is the resolver's
        return _declare_main(argv)
    parser = _Parser(prog="rollout-settings",
                     description="Print the operator's rollout settings (%s) as JSON." % default_path())
    parser.add_argument("--repo", help="a directory in the clone whose GitHub origin picks a [repo.\"owner/name\"] table")
    args = parser.parse_args(argv)
    try:
        out = resolve(repo=args.repo)
    except SettingsError as e:
        sys.stderr.write("rollout-settings: %s\n" % e)
        return e.code
    if "notify" in out["retired"]:
        sys.stderr.write("WARN: [notify] is retired (ADR 0075)\n")
    sys.stdout.write(json.dumps(out) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
