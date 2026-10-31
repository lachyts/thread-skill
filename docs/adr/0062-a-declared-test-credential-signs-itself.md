# 0062 — A declared test credential signs itself

Date: 2026-11-01
Status: accepted (implemented by p34-8, `thread-skill-p34-8-standing-approval-for-test-credentials`; amends ADR 0034
decisions 1 and 2, where credential gates never passed the standing approval, and ADR 0008)

## Context

On 2026-10-28 `smart-slider-rollout-2026-10-28` paused its whole queue for about seven hours. Its task
`smart-slider-p8-1-credit-packs-on-the-slider` declared two credential gates in its approved plan:

- `credential: Stripe test-mode keys STRIPE_SECRET (sk_test_) and STRIPE_PUBLISHABLE_KEY (pk_test_) in the task tree's .env.local`
- `credential: staging Supabase SUPABASE_SERVICE_ROLE_KEY (project geyyptxqiovujgbiecsp) in the task tree's .env.local`

The rollout note itself said "Stripe test mode only", so the gates were low-stakes. ADR 0034's standing approval
signs spend gates only, so both went to Lachy, the four dependants waited, and the needs-you push reached nobody.
Lachy: "I shouldn't have to answer this gate. This gate should automatically be answered."

After his sign-off the implementer found the keys were not local: neither the task tree's `.env.local` nor the source
file the rollout's `env_bootstrap` copies held any of the three, so p8-1 blocked again at its Stripe check. An
approval that never checks presence moves the failure past the build. A credential that is approved but absent must
be caught at the stop, before any build.

## Decision

1. **The class lives only in the operator file, as one line.** A repo's *test-credential class* is the repo-only key
   `test_credentials` in `~/.config/thread/rollouts.toml` (schema 3), written as ONE inline-table line inside its
   `[repo."owner/name"]` table:

   ```toml
   schema = 3

   [repo."Animately/optimizer"]
   test_credentials = { file = "~/repos/animately/optimizer/.env.local", keys = [{ name = "STRIPE_SECRET", prefix = "sk_test_" }, { name = "STRIPE_PUBLISHABLE_KEY", prefix = "pk_test_" }, { name = "SUPABASE_SERVICE_ROLE_KEY", supabase_project = "geyyptxqiovujgbiecsp" }] }
   ```

   rollout-settings.py's header is the one copy of the rules. `file` is an absolute or `~/` path. Each key has a
   `name`, an upper-snake env name with no LIVE or PROD segment, and one proof form: a `prefix` holding `test` or
   `sandbox` and no `live` or `prod`, or a `supabase_project` ref. Every other form is refused at its line with the
   remedy: the `[repo."o/r".test_credentials]` sub-table, the dotted forms, `repo = {…}` and a value spanning lines.
   The reason is that inert-paths.py and tune.py edit this file line by line, and both treat a key under a
   three-segment table as a hand edit they refuse. The one-line form is an ordinary single-segment key to both: they
   keep it byte-identical and insert after it. It is never a rollout or task stamp, because agents write those, and
   an agent could then widen its own approval. No automated writer adds or changes it: inert-paths.py's `mine`/`others`
   check refuses an edit that resolves another repo table, and tune.py refuses an edit that changes any repo's
   `test_credentials`. Built-in: no class, which is off.

2. **The reading.** `gated_inputs.credential_reading(gate, cls)` fails closed; the first failure wins, and it reads
   only the text after the first `:`. The class-independent steps run first, so a gate no class could ever sign says
   why:
   1. the kind is `credential`;
   2. the deny rules: `live` or `prod` at a word start or after `_`, the sweep's IRREVERSIBLE list, and the nouns
      password, passphrase, private key, ssh, oauth, api key, access key, access, token, secret, 1password, keychain
      and cookie at a word start; the why quotes the whole word (`deny word: production`, `deny word: live`,
      `deny word: PRODUCT`);
   3. a mode word: `test`, `test-mode`, `testmode`, `staging` or `sandbox`;
   4. the class is set;
   5. every upper-snake env token is a declared name, and there is at least one;
   6. every prefix token (`sk_test_`) is the declared prefix of a key the gate names;
   7. every 20-letter project ref is the declared project of a key the gate names.

   No fixed gate form is enforced: task.workflow.js keeps its bytes, so no resume cache is invalidated. The wording
   is guided instead (decision 6).

3. **The value proof.** The declared file's values prove the keys: `env_proof` reads the file with a hardened open
   (isfile, then an `O_NONBLOCK` open, then fstat S_ISREG, then a 1 MiB cap), and each named key must be present with
   its declared prefix, or be a Supabase JWT whose `ref` is the declared project. A missing key is an `ASK:` naming
   it (`STRIPE_SECRET is not set in <file>`), at the gate-pending stop, after plan approval and before any build:
   p8-1's second failure is caught there. Every why is fixed text naming a key, a token, a prefix, a ref or the file;
   no value from the file and no exception text ever reaches stdout, a note or the Run record.

4. **The bootstrap refresh, and the mechanism it relies on.** The proof reads the source file, never the task tree's
   copy, so the copy must be refreshed from it. `bootstrap_refreshes` requires the rollout's `env_bootstrap` to copy
   the declared file with a plain, unconditional `cp`: not a guarded copy (`[ -f … ] ||`, `test -f … &&`), not
   `-n`, `-u` or `-i`, not the file as the destination, not `ln`, `rsync` or an `if` block. The refresh mechanism
   exists already: `worktreeSetup` in task.workflow.js renders `envBootstrapStep` after the worktree arms and the
   toplevel check, so it runs on a reused tree too, and `branchTreeSetup(…, true)` does the same for the seeded
   reviser and the integrator. After a sign-off, the resumed call replays the plan gate from its cache and dispatches
   the implementer fresh, which re-runs `env_bootstrap` in the task tree before it builds. So when Lachy adds a missing
   key to the source and the gate is then signed, the plain `cp` brings the key into the tree.
   tests/approved-gates-resume.test.mjs's S-plan-env pins it.

5. **The class is its own switch.** It is independent of `spend_approval_usd`: a credential gate on a note the plan
   judge never bounced never resolves the spend limit, so a declared class signs at the built-in 0 too. The limit
   resolves lazily, at a slug's first gate that is not such a credential gate, or at the first gate of a bounced note,
   which keeps today's path. A refused `spend_approval_usd:` stamp therefore errors only a slug that holds a spend,
   irreversible or bounced gate. A covered credential gate gets no ledger read, month line, Needs-you line or spend
   lock. Its annotation is `(approved <date> under the standing approval: test credential K1, K2 present in <file>,
   class from <source>)`, which GATE_ANNOT_RE and the engine's normalizeGate strip like any sign-off.

6. **Recorded, never asked, at schedule and orient.** When the class is set, schedule § 3.6 and orient's reshuffle
   R3 (c) record a credential hit whose context names only test-mode or staging use of declared keys: `plan_approval:
   required` plus a test-credential Planner line under `## Decisions (recorded <date>)`, which tells the planner how
   to word the gate so the reading can read it. Asking it ahead would skip the stop's presence check, which is
   exactly how p8-1 failed. A later sweep of that task hits the sweep words inside the Planner line itself, so two
   rules close the loop: (a) a hit inside the recorded test-credential Planner line is dismissed and listed as
   `swept, dismissed: [[task]] <word> (the recorded test-credential Planner line)`; (b) a task that already holds
   that line is recorded, never asked.

7. **The serial path is excluded.** A Leg calls the same `approve-gates --standing`, but a serial rollout note has no
   `Project root:` line, so no repo table resolves and the class is off. Schedule's § Serial path keeps the ask-ahead
   for every credential.

## Considered options

- **A rollout-note stamp written at schedule time.** Rejected: agents write rollout and task notes, so an agent could
  widen its own approval. The class lives where only Lachy writes.
- **An enforced fixed gate form**, as ADR 0038 did for spend. Rejected: it changes task.workflow.js's bytes and so
  every in-flight resume cache. A fail-closed reader plus a recorded Planner line gets the same effect.
- **An engine judge hook** pricing credentials at the plan judge. Rejected for the same reason, and because the
  proof needs the operator file and the env file, which the lead reads, not the engine.
- **The `[repo."o/r".test_credentials]` sub-table, with both writers taught to read it.** Rejected: two writers'
  line-by-line editing would have to change, and each change risks the files they already keep. The one-line form
  needs no writer change.
- **Proving the task tree's copy instead of the source.** Rejected: the tree may not exist yet at the stop, and a
  stale copy is exactly what the refresh replaces.
- **Gating the class on `spend_approval_usd > 0`.** Rejected: the two approvals are unrelated, and the built-in 0
  would silently switch the class off.

## Consequences

Accepted residuals:

1. *(i)* The deny list is a reject list, not a whitelist, as `exposure()`'s leftover is. A second credential named in
   prose with no env token and no deny word passes the reading: `credential: test-mode STRIPE_SECRET (sk_test_) and
   the GitHub PAT in the task tree's .env.local` reads `names: ["STRIPE_SECRET"]` (`PAT` has no underscore, so it is
   no env token). The annotation names only the proved keys and the file, and that is the boundary: any other use is
   a review failure.
2. *(ii)* Known false asks: Stripe's own "API keys" and "secret key", `STRIPE_PRODUCT_ID` (`deny word: PRODUCT`), and
   "lives". The recorded Planner line words around them; a planner that ignores it gets Lachy's hand sign-off, which
   is the outcome before this ADR.
3. *(iii)* The Supabase proof reads legacy JWT service keys only. Supabase's newer `sb_secret_` keys carry no project
   ref, so a project on the new key format always asks (`… is not a legacy JWT service key, so its project cannot be
   proved`).
4. *(iv)* The bootstrap shape check is narrow: `ln -s`, `rsync` and guarded copies all ask. The README tells Lachy to
   use a plain `cp`.
5. *(v)* A key removed from the source between the approval and the implementer's start is not caught; the
   implementer blocks, as before.
6. *(vi)* Execute § 4.5 step 1.2 judges each gate-pending key once per session. After a missing-key `ASK:`, the gate
   needs a sign-off by hand, a *Reinstate* or a new session.
7. *(vii)* A Leg never signs one (decision 7). A task orient records and then routes serial is asked mid-run in its
   Leg.
8. *(viii)* estate-rank charges a sign-off for every gate kind (ADR 0034 residual x), so an in-class credential is
   over-charged the same way.
9. *(ix)* A task holding the recorded line is never asked ahead again (decision 6, rule b), so a live credential added
   to its body later reaches Lachy mid-run, never ahead. Nothing is signed unproved; the ask only moves.
10. *(x)* A schema-2 Engine snapshot ignores the key (ADR 0043), so its rollouts ask every credential gate, as before.
11. *(xi)* The lead reads the declared env file in process. No value ever reaches stdout, a note or the Run record.
