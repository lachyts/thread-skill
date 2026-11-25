# 0063 — A declared test credential signs itself

Date: 2026-11-01
Status: accepted (implemented by p34-8, `thread-skill-p34-8-standing-approval-for-test-credentials`; amends ADR 0034
decisions 1 and 2, where credential gates never passed the standing approval, and ADR 0008)
*(Amended 2026-11-05 by p37-4, ADR 0034's amendment of that date: a declared test Login (`[defaults] test_logins`,
schema 5, operator-only by this ADR's d1 rule) signs a credential gate that names only it. It is machine-wide, so
(vii) "A Leg never signs one" holds for classes only.)*
*(Amended 2026-11-24 by p56-5, the Amendment at the end: an agent writes a declaration Lachy has ruled on in words,
through `rollout-settings.py declare`, and reports it. Decision 1's "No automated writer adds or changes it" holds
from then on for a declaration he has not ruled on.)*
*(Amended 2026-11-26 by p56-6, the second Amendment at the end: a repo's declared metered keys (`metered_keys`, schema
9), keys whose only risk is metered spend, sign a credential gate with the spend gate the standing approval signed on
the same task that names each key's service.)*

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
   an agent could then widen its own approval. No automated writer adds or changes it *(2026-11-24, p56-5: but
   `rollout-settings.py declare`, for a declaration he has ruled on; the Amendment below)*: inert-paths.py's
   `mine`/`others` check refuses an edit that resolves another repo table, and tune.py refuses an edit that changes any repo's
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
   `-n`, `-u` or `-i`, not the file as the destination, not `ln`, `rsync` or an `if` block. Its words are read as the
   shell passes them: `~/…`, `$HOME/…` and `${HOME}/…` name the declared file whichever form the class declares, and
   a quoted `~` or a single-quoted `$HOME` never does (the shell copies a path that does not exist and, under
   p8-1's `2>/dev/null || true`, the stale copy stays), so it asks. The refresh mechanism
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
   irreversible or bounced gate. Likewise the class resolves only for a credential gate that passes the reading's
   class-independent steps (decision 2): a gate no class could ever sign asks with its why, so a refused
   rollouts.toml never turns that ASK into an error. A covered credential gate gets no ledger read, month line,
   Needs-you line or spend lock. Its annotation is `(approved <date> under the standing approval: test credential K1,
   K2 present in <file>, class from <source>)`, which GATE_ANNOT_RE and the engine's normalizeGate strip like any
   sign-off.

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
  widen its own approval. The class lives where only Lachy writes. *(2026-11-24, p56-5: and where an agent writes
  only his quoted ruling; the Amendment below.)*
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
   over-charged the same way. *(2026-11-20, p48-3: a declared test Login is no longer over-charged (ADR 0034's
   2026-11-20 amendment); the class still is.)*
9. *(ix)* A task holding the recorded line is never asked ahead again (decision 6, rule b), so a live credential added
   to its body later reaches Lachy mid-run, never ahead. Nothing is signed unproved; the ask only moves.
10. *(x)* A schema-2 Engine snapshot ignores the key (ADR 0043), so its rollouts ask every credential gate, as before.
11. *(xi)* The lead reads the declared env file in process. No value ever reaches stdout, a note or the Run record.
12. *(xii)* *(2026-11-24, p56-5.)* Nothing proves the words an agent quotes to `declare` are Lachy's, or that they
    name the thing declared: an invented or stretched ruling widens that agent's own approval, which is what decision
    1 kept out. The log line and the reported `declared` line are how he sees it; it is a review failure, undone
    from the log.

## Amendment (2026-11-24, p56-5: an agent writes a ruled declaration)

At the orient grill of 2026-11-24 Lachy was asked who makes the edits to `~/.config/thread/rollouts.toml` that he
has already ruled on. He took the widest option: **"Agents make any ruled edit"**. Whenever he has ruled on a
declaration in words, an agent writes it into the file and reports it: a declaration he has already agreed to no
longer waits on his own hand edit. The same day, under this ruling, the orient session declared the dummy Login a
test Login.

**What it reverses.** Decision 1's "No automated writer adds or changes it", and the same rule as ADR 0034's
2026-11-05 amendment applies it to `test_logins` ("no agent or script writes it"), for a declaration he has ruled
on. The rule was there so an agent could never widen its own approval. A quoted ruling keeps that: the approval is
still his, and the agent only carries it into the file.

**What stands.** A stamp on a rollout or task note is still never the class, since agents write those on no word of
his. tune.py still refuses a Tuning whose result changes `test_credentials` or `test_logins`, and inert-paths.py
still refuses an edit that changes another table. A declaration he has not ruled on is still his question, a
needs-you item or an ask ahead, never an agent's inference.

## Decided for him (overturnable)

1. **Ruled means his own words.** Quoted exactly, with the date he said them, and naming the thing declared, or
   said of it where `--source` shows that. A sign-off of one gate, a gate's wording, an agent's inference, a
   pattern in his past answers or his silence is no ruling. `declare` checks that the words and a date that is not
   in the future are there; that they name the thing is the agent's rule, since his ruling of 23 Nov on the voice
   keys reads "I shouldn't be asked about this", which names nothing by itself.
2. **Every agent edit is reported where he reads the result.** The `declared` line `declare` prints goes verbatim
   into the agent's reply, confirm batch or report; a rollout's task agent puts it in its task note and its final
   output, which the lead carries.
3. **One writer.** `rollout-settings.py declare`, and no agent edits the file any other way. A Tuning stays tune.py's
   and an Inert path inert-paths.py's.
4. **It covers every key of the file but two.** `inert_paths`, whose writer proves each glob first, and `schema`,
   which a writer raises and nobody declares.
5. **The reader check runs at every write, and there is no `--force`.** A refused file halts every rollout on the
   machine, so one live rollout whose engine root cannot read the edited file blocks the declaration until it
   finishes. His hand edit remains.
6. **The log sits beside the file and is written first.** `rollouts.declarations.jsonl` holds the key, the value, his
   quoted words, their date and the line it replaced. A replace that fails after the log line is voided there.
7. **`undo` needs his words too.** An undo of a ruled removal would otherwise widen an approval on nobody's word. It
   never lowers `schema`, and it puts a removed line back at its old place, or at the end of its table when the
   lines around that place have changed.
8. **Dates are the machine's local date,** the day he would name for his own words. The log's `ts` and its ids are
   UTC.
9. **A line's comment names its last declaration only.** The log is the record. A Tuning that later moves a declared
   Tuning key keeps the comment while the value is tune.py's, recorded in tunings.jsonl.

## Amendment (2026-11-26, p56-6: a metered key signs with its spend)

[[chorus-p113-3-the-voice-says-pr]] sat set aside from 20 to 23 Nov waiting for Lachy, though its US$3 spend gate was
already signed under the standing approval (limit US$200). What held it was its separate credential gate for
`CARTESIA_API_KEY` and `ELEVENLABS_API_KEY`. The class of decision 1 signs only a test-mode key: the gate must carry a
test, staging or sandbox word and no "API key" noun. Cartesia and ElevenLabs have no test mode, and Chorus uses the same
keys every day, so the class could never sign them. His ruling, on 2026-11-23: **"I shouldn't be asked about this."**

**The rule.** A third class beside the test credential and the test Login: the **metered key**, a key whose only risk is
metered spend. A repo declares them in one line of its `[repo."owner/name"]` table, `metered_keys = { file = "<path>",
keys = [{ name = "<NAME>", service = "<Service>" }, …] }` (schema 9), each key with the service its spend gate names.
`approve-gates --standing` signs a credential gate when every env name in it is a declared metered key, each present in
the declared file; no live or production word, irreversible word or other kind of credential (password, private key,
SSH, OAuth, keychain, cookie) is in it, while "API key", "token" and "secret" stay deny words for the other two classes
only; no other listed service is named beside the keys; and a spend gate the standing approval signed on the same task,
earlier or in the same pass, names each key's service. It reads no limit of its own: it signs only with a spend gate
the standing approval signed on this task, earlier or in this pass, so with `spend_approval_usd` at 0 it signs only on
an earlier signing. Its annotation names the keys, the file and the spend gate it rode on. Schedule § 3.6 and orient's
reshuffle R3 (c) record such a credential ahead, with a metered-key Planner line and, when the note holds none, the
spend Planner line. It is declared on his ruling only, by the 2026-11-24 amendment: Chorus's two voice keys are an
agent's `declare` after this lands, quoting his words of 23 Nov.

**What stands.** Decision 5, "the class is its own switch", is about the test-credential class and is unchanged: a
metered key is no switch of its own, and no limit either. A key is in one class: a name in both `test_credentials` and
`metered_keys` refuses the file. Decision 7 stands for metered keys too: a Leg resolves no repo table.

**Named residuals.**

a. *The serial path.* A `shape: serial` chain's Leg resolves no repo table (decision 7), so a paid probe routed serial
   is still asked ahead at schedule S4 and held by p56-3's unsigned hold. Follow-up: a serial note resolves its repo's
   metered keys.
b. *No Planner line.* A brief with no sweep hit gets no Planner line, so nothing tells its planner to name env keys and
   the service. Its gate signs when its words do, and asks once otherwise. Its second shape is a `credential` the
   Readiness grade names with no sweep hit: schedule § 1.5 asks it ahead, since `preflight --ask-gates` reads no
   settings. Follow-up: § 1.5 does not ask a grade-named credential the repo's metered keys cover.
c. *No `env_bootstrap` check.* Presence in the declared file is proved, not its copy into the task tree: a metered
   file that is a repo-local `.env` the bootstrap does not copy signs, then fails at the build, as p8-1 did.
d. *A service outside SERVICES*, or a second credential named in plain prose with no env token or deny word, is not
   seen (residual (i)'s shape).
e. *estate-rank's charge.* A metered-key gate is still charged a sign-off (residual (viii)).

### Decided for him (p56-6, overturnable)

a. **Recorded whether or not the brief names a spend.** A note that names the service but pays for nothing gets
   `plan_approval: required` and two Planner lines it may not need; its plan declares no gate, and nothing stops.
b. **The spend Planner line is written with the metered-key one** when the note holds none: the key signs only with a
   priced spend gate.
c. **A service is declared per key**, never derived from the env name: the rule needs the service a spend gate must
   name, and a declared word is one he ruled on.
d. **The service match ignores case and inner spaces or hyphens** (`Eleven Labs` names `ElevenLabs`; `Cartesian` never
   names `Cartesia`).
e. **Eight deny nouns, and the service guard.** A key of another kind, or another listed service's key beside the
   declared ones, asks; the guard reads any case, so a gate holding the verb "replicate" asks too.
f. **A spend gate signed by hand does not carry the key**: the note's rule is "a spend gate the standing approval
   signed", and the ASK says so.
g. **No `env_bootstrap` check** (residual c): Chorus reads its env file in place.
h. **Routing reads the settings** for a credential gate with an env token, no metered deny word and no mode word, so
   under a refused file its slug exits 1, as every other reader of that file does.
i. **No limit of its own.** Turning the standing approval off stops a metered key only where no earlier standing
   signing carries it; re-reading the limit for a rider would ask the incident's own state whenever the limit moved
   after the spend was signed.
j. **The serial path stays off** (residual a), a decision of its own.
k. **The grade-named credential** (residual b's second shape) is its own task: a grade names a kind, never a key.
