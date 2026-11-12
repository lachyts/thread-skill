#!/usr/bin/env python3
"""gated_inputs.py — the gated-input sweep and the standing approval's readings (ADR 0008, ADR 0034, ADR 0038, ADR
0063).

    python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/gated_inputs.py sweep <note>...
    python3 -I ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/gated_inputs.py exposure - <<'EOF'
    <one gate>
    EOF

The single home of the readings of free text (and the one env-file read) the gate path needs. Stdlib only; it writes
nothing and makes no network call; the sweep CLI alone also reads `~/.config/thread/rollouts.toml`'s `[defaults]
test_logins` through rollout-settings.py's resolve(repo=None), only when a reading needs it (part 1), with no git and
no bytecode.

1. The sweep (schedule § 3.6; orient reshuffle R3 through it). `sweep(text)` finds every hit of the SPEND,
   CREDENTIAL and IRREVERSIBLE lists in a task note's body. A word matches case-insensitively where a word starts
   (the lookbehind `(?<![A-Za-z0-9_])`, so `max_budget_usd` never hits `budget`); `AUD` is a whole, case-sensitive
   word, so "audit" and "audio" never flag. The currency amount marker replaces the old literal `$` (which hit
   every shell variable):
     - `US$` at a word start, anywhere in the body (code spans included), with or without a number after it;
     - `A$`, `AU$`, `NZ$`, `C$` or `CA$` at a word start, then at most one space, then a digit, anywhere;
     - a bare `$` with no letter, digit, `_` or `$` before it, then at most one space, then a digit, in prose
       only: fenced code blocks and inline backtick spans are masked before this one pattern runs.
   So `${CLAUDE_PLUGIN_ROOT}`, `$HOME`, `$WT`, `$?`, `$(…)` and a shell `"$1"` in code never flag, and `sub-$5` does.
   The marker reports as the word `$ amount`. OLD_SPEND is the list before ADR 0034 (literal `$` included), kept for
   the honest controls in tests/gated-inputs.test.mjs. The output is the RECALL FLOOR for schedule § 3.6, never its
   verdict: a hit whose context names nothing the task pays for or authorises is dismissed there, and listed.

   Every gate kind is read the same way (p51-3, ADR 0034's 2026-11-12 amendment): by what the gate is called and by
   the thing itself, as spend reads its words and an amount. A note names a credential by the account it signs in to
   and an irreversible act by what it does, seldom by the kind's own name: the three gates signed mid-run that p51-3
   traced (chorus p84-7's "Cartesia and ElevenLabs", smart-slider p8-1's "Stripe test mode … no live keys", thread-skill
   p33-4's "a scratch GitHub repo") hit no word of OLD_CREDENTIAL or OLD_IRREVERSIBLE, the lists before it, kept for
   the honest controls. So CREDENTIAL is OLD_CREDENTIAL plus CREDENTIAL_THINGS, each reported by its own word:
     - `env key`: an upper-snake env name ending `_KEY`, `_TOKEN`, `_SECRET`, `_PAT` or `_PASSWORD`, case-sensitive
       (`CARTESIA_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`; `FAL_KEY` too, whatever its prefix);
     - `key prefix`: `sk_`, `pk_` or `rk_` then `test_` or `live_`, case-sensitive;
     - `test mode`, `live mode` (a space or a `-`), `live key(s)` and `service role` (a space or a `-`), any case;
     - `.env` as a word (`.env.local` holds it; `.environment` does not), case-sensitive;
     - SERVICES: an outside service's name, whole and case-sensitive (`Stripe`, `Supabase`, `PostHog`, `Cartesia`,
       `ElevenLabs`, …), each reported as its name. Never Claude or Codex: the agents run on those Logins.
   IRREVERSIBLE is IRREVERSIBLE_WORDS (OLD_IRREVERSIBLE) plus IRREVERSIBLE_THINGS, any case, each an act on a live
   thing the run cannot take back: `scratch repo` (`scratch`, at most two words, then repo, repos or repository),
   `gh repo` (`gh repo create` or `delete`), `force-push` (`force push`, `force-push`, `push --force`), `drop table`,
   `to production` (deploy, push, publish, promote, release or migrate, in any form, at most two words, then `to
   production`) and `delete the` (delete in any form, an optional article, at most two words, then a repo, repository,
   user, account, bucket or database, plural allowed). The credential and test-Login readings' deny list (parts 4 and
   5) reads IRREVERSIBLE_WORDS alone, unchanged. Accepted residual: a gate whose note names neither (smart-slider
   p8-2's staging key, reached only through its dependency's hook) is still first seen at the plan gate; the
   Reflection counts each gate signed mid-run whose note the sweep does hit as a miss (reflect.py's `sweepMiss`).

   The `login` field (p39-3: schedule § 3.6 and orient reshuffle R3 (c) record a declared test Login ahead instead of
   asking it). `sweep(text, logins)`, with `logins` a list (possibly empty) of declared test Logins, gives each
   credential hit whose source line is a Login gate a `"login": login_reading(<that line>, logins)` field (part 5's
   {names, why}). The source line is the whole text line holding the hit's start. It is a Login gate when, its
   leading `>` blockquote markers (BLOCKQUOTE_RE) and its trailing `(approved …)` suffix (APPROVED_SUFFIX_RE, any case:
   reconcile-rollout.py's GATE_ANNOT_RE, copied, since reconcile-rollout loads this module) stripped and then its outer
   whitespace (a CR too), gate_kind() reads `credential` and has_login_phrase() holds. Every other hit carries no
   `login` key and keeps schedule's rule (fail closed): prose, a `- Planner:` line, a numbered `1. credential:` line,
   a gate with no Login word, and every spend and irreversible hit. So with a list, every Login-gate credential hit
   carries one; with None (the default), none does, and the output is the one-argument shape.

   CLI: `sweep <note>...` reads only the body below each note's frontmatter and prints one JSON line per note,
   {"slug", "spend": [{"word", "at"}], "credential": [{"word", "at"[, "login"]}], "irreversible": [...]}, hits in text
   order; `at` is the hit with up to 40 characters either side, newlines folded to spaces. Each note is swept first
   with `[]`: a Login reading that stops at steps 1-6 already holds its final why, since those steps never read
   `logins`. Only when one reading reaches step 7 (NO_LOGINS_WHY) does the CLI read the declared test Logins, at most
   once per process, reused for later notes: rollouts.toml's `[defaults] test_logins` through rollout-settings.py
   (loaded from beside this file) and its resolve(repo=None), in process, with no git, no subprocess and no bytecode
   written. A non-empty list re-sweeps that note with it; `[]` (the built-in, or no file) leaves the first sweep, its
   hits reading NO_LOGINS_WHY. A note that needs no declaration never triggers the read, and prints the same under any.
   A read that fails (a refused file, no tomllib, a loader failure) prints that note, and every later one that needs
   the declaration, in the one-argument shape with no `login` key, so every hit keeps the ask, and writes one
   `gated_inputs: test_logins: <why>` line on stderr, the first time only (the why in reconcile-rollout.py's
   _machine_settings words). A note it cannot read prints one `gated_inputs: <path>: <reason>` line on stderr and the
   run goes on. Stderr follows note order: the `test_logins` line is written while sweeping the first note that needs
   the declaration, after the lines of the notes before it and before those of the notes after it. The exit is 1 when
   any stderr line was written (an unreadable note, or test Logins a note needed and could not read), every readable
   note still printed; else 0; usage 2.

2. The exposure reading (execute's standing approval, `reconcile-rollout.py approve-gates --standing`).
   `exposure(gate)` returns {"usd": Decimal | None, "why": str}, the full reading; None means it cannot price the
   gate. It fails closed: the rules run in order and the first failure gives `why`. `covered(gate, limit)` reads the
   gate with the standing reading below and adds the limit: covered iff limit > 0 and usd <= limit (inclusive). The
   rules, in order:
     1. Kind: the text before the first `:`, case-insensitive. Only `spend` can be covered ("not a spend gate").
     2. USD amount tokens over the whole gate, code spans included: a marker (`US$`, `USD`, or a `$` with no
        letter, digit or `_` before it, so `A$` is never USD), at most one space, then a number; or a number, at
        most one space, then `USD`. A number is `\\d+` or `\\d{1,3}(,\\d{3})+` with an optional `.\\d+`, read whole.
        A token starts at a word boundary, so `max_budget_usd=5` and `total_cost_usd` are no tokens.
     3. The cap clause: the word-bounded `cap` or `capped`, an optional `at` or `of`, an optional `:`, then one USD
        token. Exactly one ("no cap clause", "<n> cap clauses").
     4. Each token's tail, the cap's first: a letter, digit, `_`, `.digit` or `,digit` straight after the number
        ("malformed amount"); a magnitude word after it ("magnitude word"); a dash, `to` or `or`, then another
        number ("range").
     5. The clause, from the cap amount's end to the first `,` `;` `:` `—` `–` ` and `, a `.` not followed by a
        digit, or the gate's end. The recognised phrases: totals (`total`, `in total`, `one-off`, `one off`,
        `once`, `overall`) and monthly periods (`per (calendar )?month`, `a`/`each`/`every (calendar )?month`,
        `/month`, `/mo`, `monthly`) count x1; one `per Login|account|seat|user` with exactly one count phrase
        (`across N <unit>s`, `for N <unit>s`, `× N`, `x N`, `xN`; N digits >= 1 or a number word one to ten) counts
        xN. A per-unit token with no count asks ("per-Login cap with no Login count"), two ask ("more than one
        per-unit token"), and a count whose noun is another unit asks ("count unit does not match the per-unit
        token"; Login and account are one unit, as p18-7's "per Login (per account)" reads). The leftover is read
        against a reject list, not a whitelist (LEFTOVER_RES): any digit, number word, MULTIPLIER_WORDS word, any
        `per`, `each` or `every` whatever follows it (PER_EACH_EVERY_RE: a word on the cap itself is a rate on the
        cap, `cap US$0.10 per GB`, `cap US$5 each for the images`), `/` + letter, unit noun, period adverb,
        currency, WIDENING word or `before` asks ("unrecognised clause: <leftover>"); any other word passes. An
        empty clause is a total.
     6. Currency, whole gate: a non-USD amount (`A$`, `AU$`, `NZ$`, `C$`, `CA$`, `€`, `£`, `¥`, `AUD`, `NZD`, `CAD`,
        `EUR`, `GBP`, `JPY` beside a number, or `minor units` after one), a currency word (dollar, bucks, euro,
        pound, cent), a number word beside a currency, or a magnitude before a code ("non-USD or ambiguous
        currency").
     7. Multipliers, periods and widening words outside the clause (code spans included; `_` is a word
        character, so `per_call_cap` never matches): (i) a `per`/`each` rate (RATE_RE, below); (ii) a
        plural Logins/accounts/seats/users; (iii) `every`/`a`/`an` directly before a UNIT_NOUNS noun; (iv) `night(s)`
        or a PERIOD_ADVERBS word; (v) `/` + a unit noun; (vi) `×`, `x` + digit, digit + `x`, a MULTIPLIER_WORDS word
        (`times`, `twice`, `double`, `triple`, `apiece`); (vii) `%`; (viii) a WIDENING word; (ix), last, a per-unit
        word (PER_UNIT_OUTSIDE_RE, p37-4): `per`/`each`, up to three SEP-joined letter-words, then a singular Login,
        account, seat or user (an `'s` allowed: `per the dummy Login`, `each new Login`, `per-Login`), or
        `every`/`a`/`an` directly before one, or a `/` before one ("per-<unit> cap with no <unit> count", the unit as
        the gate writes it). It fires only where nothing earlier did, so relaxing per/each never lets a per-Login
        reading through; `every signed-in Claude Login` (p18-7) still passes, since `every` needs adjacency.
        The rate reading (RATE_RE, p37-4), 7(i)'s alone, never rule 5's: outside the clause `per` or `each` at a word
        start is a rate only before a unit, never in prose (`per the task note`, `per the brief`, `per ADR 0038`).
        `per` is a rate when SEP (whitespace, or a `-` or `/` with optional spaces) then a RATE_UNITS noun
        (UNIT_NOUNS plus month, time, image, token, invocation, iteration, attempt, probe, push, item, task, eval,
        case, commit, PR, file, page, prompt, query, message, step, batch, job, model, character, word, second,
        generation, render, video, clip and frame; each may be plural) or a digit follows (`per run`, `per-run`,
        `per-Login`, `Per day`, `per 1,000 tokens`, `per 1k`). `each` is a rate on the same terms, or before `of`,
        or before a non-letter, non-digit character or the gate's end after optional spaces (`one call each —`, `3
        each,`, `each --max-cost-usd 4`, `each $5`), or straight after a digit and one space (`US$5 each for the
        runs`). It reads the whole gate with only the clause blanked, so the lookbehind sees the digit before an
        `each`. The match is the word alone, so a why lists `per`/`each` as the gate writes it.
        WIDENING is one list for rules 5 and 7, so the two readings never disagree: words that say the cap is not
        the ceiling (`plus` or a bare `+` with no amount after it; `excluding`, `exclusive of`, `excl`, `ex`;
        `tax(es)`, `VAT`, `GST`; `fee(s)`; `overage(s)`; `soft`; `uncapped`; `no hard limit|cap`; `exceed`;
        `initially`, `to start`, `for now`; `or more`, `at least`, `minimum`; `approx(imately)`, `roughly`).
        `plus US$30` is an amount, summed by rule 9. `before` is rule 5's alone, since p18-7's probe reads
        "stopping before any Turn" outside its clause.
     8. A bare number outside the clause, code spans and amount tokens (no letter, digit, `_`, `.`, `,` or `-`
        before it): "a number outside the cap clause".
     9. The value: the cap amount × the clause multiplier, plus every other USD token (each once), in Decimal.

   The cap-only reading (p37-4, ADR 0034's 2026-11-05 amendment: unpriceable never means asked) prices a gate from
   its cap when the full reading refuses it: rules 1-4 and 6 run exactly as above (rule 4 over every token, the
   cap's first; currency over the whole gate); rule 5 reads the leftover against CAP_ONLY_LEFTOVER_RES, which is
   LEFTOVER_RES without a digit, a number word or a bare unit noun, its multiplier widened to `x 3`, `x3` and `3x`,
   its `/` unit to `/` before a digit (`/1k`), its widening word to any `plus` or `+` (an amount after it inside the
   clause is a second amount the clause cannot read), plus `%`, a recurring unit (`a`/`an` directly before a
   UNIT_NOUNS noun: `a day`) and a per-unit noun (Login, account, seat or user, singular or plural); any `per`, `each`
   or `every` asks there as in rule 5 (`per GB`, `per developer`, `each for the images`, `per big run`); the
   per-unit/count whitelist runs first, as in rule 5, and the why stays `unrecognised clause: <leftover>`; outside
   the clause only 7(ii) (plurals) and 7(ix) (per-unit words) ask; the rest of rule 7, and rule 8, are waived; the
   value is rule 9's (the cap times the clause's count, plus every other USD amount the gate names, so it never reads
   below the full reading: `US$500 — cap 1 USD` and `US$500 per run — cap 1 USD` both read 501).
   `standing_exposure(gate)` -> {"usd", "why", "capOnly"} is the standing reading covered() and the CLI apply: the
   full reading when it prices (capOnly ""); else the cap-only reading when that prices (capOnly the full reading's
   why); else {None, the cap-only reading's why, ""}, which for a rule 1-4 or 6 failure, and most rule 5 failures, is
   the full reading's why.

   Accepted residuals (pinned in the tests; the first two are named in ADR 0034 § Consequences, *A fail-closed
   reading*, the rest in its 2026-11-05 amendment): a number word outside the clause with no Login/account/seat/user
   noun ("seven Turns") is not counted; `every`/`a`/`an` before a noun not on UNIT_NOUNS (`every push`, `every image`)
   reads x1, safe because the cap is the task's total ceiling (the engine's GATED_INPUTS_CHECK, task.workflow.js) and
   the annotation records "total exposure"; digits inside code spans. In the cap-only reading, outside the clause,
   widening words, `%`, multipliers, periods, rates that are no per-unit word and bare numbers are waived (`soft
   probe`, `3 runs`, `plus 20%`, `×3`, `every push`, `each night`); inside it, digits, number words and bare unit nouns
   that are no per-unit noun are waived (`for 3 runs`, `10k tokens`, `for both probes` read as the cap): the cap is the
   implementer's ceiling all the same. Outside the clause, a `per`/`each` rate RATE_RE cannot see (a unit not straight
   after it, or one off RATE_UNITS: `per generated image`, `each such call`) reads x1 in the full reading, the value
   the cap-only reading gives anyway; inside the clause any `per`, `each` or `every` asks in both readings.

   CLI (ADR 0038): `exposure -` reads ONE gate on stdin and prints standing_exposure()'s {usd, why} as one JSON line,
   {"usd": "<amount>" | null, "why": "<reason>"}, the amount as format_usd writes it, never its capOnly, then exits 0:
   a gate whose cap reads prints its cap-only amount with why "", so the plan judge, which bounces only a null "usd",
   never bounces it on wording alone (p37-4). The plan judge runs
   it on each top-level spend gate the engine parsed, the gate on stdin through a quoted heredoc (`<<'EOF'`), never as
   a shell argument, where `$` and backticks would expand. stdin is decoded as UTF-8 whatever the locale (bad UTF-8:
   exit 1) and split on newlines, a trailing CR dropped; exactly one non-blank line is a gate. Two or more print
   {"usd": null, "why": "stdin holds <n> lines: pass one gate"} and exit 0; none exits 2 ("no gate on stdin"). A gate
   passed as an argument, or `exposure` with no `-`, is a usage error (exit 2). The output is UTF-8, never
   ASCII-escaped.

3. `annotation(date, usd, limit, source)` is the `## Approved gates` suffix a standing approval writes:
   `(approved <date> under the standing approval: total exposure US$<x>, limit US$<t> from <source>)`. It begins
   `(approved `, holds no `)` and goes last on the line, so the engine's normalizeGate and reconcile-rollout.py's
   GATE_ANNOT_RE strip it and the gate still matches its declaration.

4. The test-credential reading (ADR 0063): a credential gate the standing approval may sign, because it names only
   keys of the repo's declared test-credential class (rollout-settings.py's `test_credentials`, `cls` below: {file,
   keys: [{name, prefix | supabase_project}]}, or None) and each is present, with its declared form, in the declared
   file, which the rollout's `env_bootstrap` copies into the task tree with a plain `cp`. Every why is fixed text that
   names a key, a token of the gate, a prefix, a ref or the file, never a value from the file or an exception's text.
   - `gate_kind(gate)`: a list marker stripped, the text before the first `:`, lower-cased ("" with no colon).
     exposure()'s rule 1 reads it.
   - `credential_reading(gate, cls)` -> {"names": [...] | None, "why"}: fail closed, the first failure wins, the rules
     reading only the text after the first `:`. The class-independent steps run first, so a gate no class could ever
     sign says why:
       1. The kind is `credential` ("not a credential gate").
       2. The deny rules, case-insensitive; the first match in text order (the longest at one place) gives `deny word:
          <the match through the end of its letters, a leading _ dropped>`: (a) `live` or `prod` at a word start or
          after `_` (DENY_LIVE_PROD_RE: `sk_live_`, `STRIPE_LIVE_KEY`, `SUPABASE_PROD_KEY`, `Production`, `livemode`);
          (b) IRREVERSIBLE_WORDS (never the things the sweep reads); (c) DENY_NOUNS at a word start (password,
          passphrase, private key, ssh, oauth, api key, access key, access, token, secret, 1password, keychain,
          cookie).
       3. A mode word (MODE_RE): `test`, `test-mode`, `testmode`, `staging` or `sandbox` at a word start, not followed
          by a letter or digit ("no test-mode, staging or sandbox word").
       4. The class is set ("no test-credential class for this repo (set test_credentials in its
          [repo."owner/name"] table in ~/.config/thread/rollouts.toml)").
       5. Every upper-snake env token (ENV_TOKEN_RE) is a declared name ("<TOKEN> is not a declared test
          credential"), and there is at least one ("it names no declared test credential").
       6. Every prefix token (PREFIX_TOKEN_RE: lower-case word characters ending `_`, e.g. `sk_test_`) is the declared
          prefix of a key it names ("<token> is not the declared prefix of a key it names").
       7. Every bare token of exactly 20 lowercase letters (REF_TOKEN_RE) is the declared `supabase_project` of a key
          it names ("<token> is not the declared Supabase project of a key it names").
     names are the env tokens in text order, each once. The deny list is a reject list, not a whitelist (as
     exposure()'s leftover is): a second credential named in prose with no env token or deny word (`the GitHub PAT`)
     passes; the annotation names only the proved keys and the file, and any other use is a review failure (ADR 0063
     residual i). Known false asks, pinned: Stripe's own "API keys" and "secret key", `STRIPE_PRODUCT_ID`, "lives".
   - `read_env(path)` -> ({name: value}, None) or (None, why): `~` expanded; os.path.isfile, else "<path> is not a
     regular file" and it is never opened; os.open with O_RDONLY|O_NONBLOCK|O_NOCTTY|O_CLOEXEC (each flag through
     getattr(os, ..., 0), so a FIFO swapped in after the check never blocks); fstat S_ISREG, else the same why; at
     most MAX_ENV_BYTES + 1 bytes read in a loop, and above MAX_ENV_BYTES (1 MiB) "<path> is over 1 MiB"; the fd
     closed in `finally`; not UTF-8 "<path> is not UTF-8"; any OSError "cannot read <path>". The dotenv parse: CR
     dropped; blank and `#` lines skipped; an optional `export `, then `NAME\\s*=\\s*VALUE`; a quoted value is its
     inside (an unclosed quote reads as absent); an unquoted value has ` #…` dropped and is stripped; the last
     assignment wins; an empty value reads as absent.
   - `env_proof(cls, names)` -> {"ok", "why"}: every missing name listed ("<NAME> is not set in <file>", joined by
     `; `); then each key in turn: a prefix key's value starts with its prefix ("<NAME> in <file> does not start with
     <prefix>"); a supabase key's value is a three-part JWT whose base64url payload is a JSON object ("<NAME> in
     <file> is not a legacy JWT service key, so its project cannot be proved": Supabase's newer `sb_secret_` keys
     carry no project ref, so a project on them always asks) whose `ref` is the declared project ("<NAME> in <file>
     is not a key for Supabase project <ref>"). <file> is the class's file as declared.
   - `bootstrap_refreshes(cmd, file)` -> {"ok", "why"}: the rollout's `env_bootstrap` copies `file` into the task tree
     with a plain, unconditional `cp`, so the implementer's re-run after a sign-off brings in the file's current keys.
     Tokenised by _shell_tokens as the shell reads it (an unclosed quote or a trailing backslash: "the rollout's
     env_bootstrap is not one shell command"): quotes and backslashes removed; an unquoted operator is its own token
     whatever touches it (`)&&cp` is `)`, `&&`, `cp`), longest first, and a newline separates as `;` does; a `#`
     that starts a word comments to the line's end. Simple commands split at operators made only of `&|;()`; any
     other operator is a redirection, and its target and a bare fd digit before it are no operands. A word counts as
     what the shell passes: a `~` that starts it unquoted (before `/` or its end) and a `$HOME` or `${HOME}` outside
     single quotes read as HOME, and nothing else expands. A command names the file when one of its words equals the
     file's `~`-expanded path exactly (`.env.local.bak` never counts), so `cp ~/x` serves a class that declares
     `/Users/<me>/x`, and the reverse. A quoted `~` or a single-quoted `$HOME` never names it: the shell copies a
     path that does not exist and, under `|| true`, the stale copy stays. With no command naming it, a word that
     spells the file so (`"~/…"`, `'$HOME/…'`) gives "the rollout's env_bootstrap may not refresh <file> into the
     task tree: it names the file with a quoted ~ or a single-quoted $HOME, which the shell never expands", and
     otherwise "the rollout's env_bootstrap does not provide <file>". Every command that names it
     must pass, each failure prefixed "the rollout's env_bootstrap may not refresh <file> into the task tree: ": its
     first word is `cp` ("it names the file outside a plain cp"); no option before `--` is `--no-clobber`,
     `--interactive`, `--update[=…]` or a single-dash cluster holding n, u or i ("its cp skips an existing copy (-n,
     -u or -i)"); the file is not its last operand ("its cp writes the file instead of reading it"); and when `&&` or
     `||` (through any `(` or `)`) join it to the command before, that command, and each one before it along the
     same `&&`/`||` chain, does not start with `[`, `[[` or `test` ("its copy runs only after a test").
   - `credential_covered(gate, cls, bootstrap)` -> {"covered", "names", "why"}: credential_reading, then
     bootstrap_refreshes, then env_proof.
   - `credential_annotation(date, names, file, source)`: the `## Approved gates` suffix, `(approved <date> under the
     standing approval: test credential K1, K2 present in <file>, class from <source>)`, the file as declared; it
     raises ValueError on a `)` in any part, as annotation() does.

5. The test-Login reading (p37-4, ADR 0034's 2026-11-05 amendment): a credential gate the standing approval may sign
   because it names only Claude Logins the operator declared as test Logins (rollout-settings.py's `[defaults]
   test_logins`, schema 5, operator-only: `logins` below, a list of names, or None). Machine-wide, so a Leg's serial
   note signs one too. It reads no limit, ledger, month line or file.
   - `has_login_phrase(gate)`: true when the text after the first `:` holds a `Login` or `Logins` word (any case) and
     no upper-snake env token (ENV_TOKEN_RE). Such a gate takes this reading, never the class one of 4; a gate with
     an env token keeps 4's path, which needs one, so no gate routed here could have signed there.
   - `login_reading(gate, logins)` -> {"names": [...] | None, "why"}: fail closed, the first failure wins, reading only
     the text after the first `:`. In order:
       1. The kind is `credential` ("not a credential gate").
       2. The deny rules, each why `deny word: <match>`, the first in text order: DENY_LIVE_PROD_RE, except a `live`
          directly followed (whitespace or `-`) by probe, run or test, plural allowed (`a live probe on the dummy
          Login`; `livemode` and `live Stripe` still deny); IRREVERSIBLE_WORDS; DENY_NOUNS, unchanged.
       3. No upper-snake env token ("an env key beside a Login: <TOKEN>").
       4. No other credential noun: `account(s)`, `key(s)`, `credential(s)`, `API` (any case), `PAT(s)` (case
          sensitive), `.env` ("another credential beside the Login: <match>").
       5. Nothing joined beside the Login, the first in text order: no `@` (ADDRESS_RE: an address or handle, another
          account to sign in as; "an address beside the Login: <the token holding it>"), and no conjunction that
          joins a second thing (CONJUNCTION_RE: `and`, `or`, `plus`, `as well as`, `along with`, `together with`, any
          case, or `&`, `+`, `;`; "something joined to the Login: <match>"), whatever the second thing is.
       6. No plural `Logins` ("more than one Login: Logins"); every `Login` word ends a `<name> (Claude )?Login('s)?`
          phrase, the name `[A-Za-z0-9][A-Za-z0-9_-]{0,39}` and the leftmost one winning, so `the Claude Login` names
          `the` ("a Login it cannot name"); at least one phrase ("it names no Login").
       7. `logins` is set and non-empty (NO_LOGINS_WHY: "no test Logins declared (set [defaults] test_logins in
          ~/.config/thread/rollouts.toml)").
       8. Each named Login is declared, ignoring case ("<name> is not a declared test Login").
     Steps 1-6 need no `logins`, so a gate no declaration could sign says why without the settings being read. names
     are the named Logins in text order, each once, in their declared spelling. Known false asks, pinned (fail
     closed): `access to the dummy Claude Login` (`deny word: access`), `the dummy Claude Login's session token`
     (`deny word: token`), any API, account, key, PAT or `.env` on the gate's line, a `live` before anything but a
     probe, run or test, and any conjunction or `+` (two declared Logins joined by `and` ask: list them with a comma or
     `then`). The accepted residual (as ADR 0063's residual i is for the class): the deny list and steps 3-5 are a
     reject list, not a whitelist, so a second thing named in plain prose with no deny word, env key, credential noun,
     `@` or conjunction (`the dummy Login, to push to the npm registry`, `the dummy Login, then Lachy's Gmail`) passes;
     the annotation names only the Login, and any other use is a review failure.
   - `login_annotation(date, names, source)`: the `## Approved gates` suffix, `(approved <date> under the standing
     approval: test Login <n1, n2>, from <source>)`; it raises ValueError on a `)` in any part, as annotation() does.
   The sweep (part 1's `login` field, p39-3) is the second reader of login_reading, beside the standing approval:
   schedule § 3.6 and orient reshuffle R3 (c) record ahead a credential hit whose reading names only declared Logins.
   A record ahead is only a hint, never a grant: the stop re-reads the plan's declared gate in full and asks then.

Importable (reconcile-rollout.py loads it with importlib, beside rollout-settings.py): sweep, hits, body_of, SPEND,
OLD_SPEND, CREDENTIAL, IRREVERSIBLE, OLD_CREDENTIAL, OLD_IRREVERSIBLE, IRREVERSIBLE_WORDS, CREDENTIAL_THINGS,
IRREVERSIBLE_THINGS, SERVICES, UNIT_NOUNS, PERIOD_ADVERBS, RATE_UNITS, RATE_RE, CAP_ONLY_LEFTOVER_RES,
PER_UNIT_OUTSIDE_RE, exposure, standing_exposure, covered, annotation, format_usd, gate_kind, credential_reading,
read_env, env_proof, bootstrap_refreshes, credential_covered, credential_annotation, MAX_ENV_BYTES, DENY_NOUNS,
has_login_phrase, login_reading, login_annotation, NO_LOGINS_WHY, APPROVED_SUFFIX_RE.
"""
import base64
import binascii
import importlib.util
import json
import os
import re
import stat
import sys
from decimal import Decimal, ROUND_HALF_UP

# ---- the sweep -------------------------------------------------------------------------------------------------

WS = r"(?<![A-Za-z0-9_])"          # a word start
CONTEXT = 40                        # characters of context either side of a hit
MARKER_WORD = "$ amount"            # how the currency amount marker reports


def _word(phrase):
    """A list entry matched case-insensitively at a word start; its spaces match any run of whitespace."""
    return (phrase, re.compile(WS + r"\s+".join(re.escape(p) for p in phrase.split(" ")), re.I), False)


# The currency amount marker: (word, regex, prose_only). The bare `$` runs on prose only (code masked).
MARKER = (
    (MARKER_WORD, re.compile(WS + r"US\$"), False),
    (MARKER_WORD, re.compile(WS + r"(?:AU|NZ|CA|A|C)\$ ?\d"), False),
    (MARKER_WORD, re.compile(r"(?<![A-Za-z0-9_$])\$ ?\d"), True),
)
SPEND = (
    _word("credits"), _word("paid API"), *MARKER, _word("budget"), _word("billable"), _word("API cost"),
    _word("credit"), _word("usage credits"), _word("extra usage"), _word("fast mode"), _word("per month"),
    ("AUD", re.compile(WS + r"AUD(?![A-Za-z0-9_])"), False), _word("max_budget"),
)
# The spend list before ADR 0034, its literal `$` included: the honest controls' baseline.
OLD_SPEND = (
    _word("credits"), _word("paid API"), ("$", re.compile(r"\$"), False), _word("budget"), _word("billable"),
    _word("API cost"),
)
# The credential and irreversible lists before p51-3: each kind's own names alone. IRREVERSIBLE_WORDS is also the
# credential and test-Login readings' deny list (parts 4 and 5), which the things below never widen.
OLD_CREDENTIAL = (_word("API key"), _word("token"), _word("secret"), _word("credential"), _word("prod access"))
IRREVERSIBLE_WORDS = (_word("irreversible"), _word("cannot be undone"), _word("delete production"), _word("wipe"))
OLD_IRREVERSIBLE = IRREVERSIBLE_WORDS


def _case(word, pattern):
    """A list entry matched case-sensitively, as `pattern` spells it (a service's name, an env key, a key prefix)."""
    return (word, re.compile(pattern), False)


def _anycase(word, pattern):
    """A list entry matched in any case, as `pattern` spells it."""
    return (word, re.compile(pattern, re.I), False)


WE_ = r"(?![A-Za-z0-9_])"           # a word end (the sweep's; the exposure reading's WE is the same pattern)
# The outside services a task's run signs in to (p51-3), each a whole, case-sensitive name: the account the credential
# gate is for. Never a model provider's own Login (Claude, Codex): the agents run on those.
SERVICES = ("Stripe", "Supabase", "PostHog", "Cartesia", "ElevenLabs", "Eleven Labs", "Replicate", "fal.ai", "Twilio",
            "SendGrid", "Mailgun", "Cloudflare", "Vercel", "Netlify", "Firebase", "AWS", "Sentry", "Ahrefs", "Apify",
            "Deepgram", "AssemblyAI", "Google Ads", "Shopify", "PayPal", "Paddle", "OpenAI API", "Gemini API")
CREDENTIAL_THINGS = (
    _case("env key", WS + r"[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*_(?:KEY|TOKEN|SECRET|PAT|PASSWORD)" + WE_),
    _case("key prefix", WS + r"(?:sk|pk|rk)_(?:test|live)_"),
    _anycase("test mode", WS + r"test[- ]mode" + WE_),
    _anycase("live mode", WS + r"live[- ]mode" + WE_),
    _anycase("live keys", WS + r"live\s+keys?" + WE_),
    _anycase("service role", WS + r"service[- ]role" + WE_),
    _case(".env", r"(?<![A-Za-z0-9_.])\.env(?![A-Za-z0-9_])"),
    *(_case(s, WS + r"\s+".join(re.escape(p) for p in s.split(" ")) + WE_) for s in SERVICES),
)
IRREVERSIBLE_THINGS = (
    _anycase("scratch repo", WS + r"scratch\s+(?:[A-Za-z0-9-]+\s+){0,2}repo(?:s|sitory|sitories)?" + WE_),
    _anycase("gh repo", WS + r"gh\s+repo\s+(?:create|delete)" + WE_),
    _anycase("force-push", WS + r"(?:force[- ]push|push\s+--force)"),
    _anycase("drop table", WS + r"drop\s+table" + WE_),
    _anycase("to production", WS + r"(?:deploy|push|publish|promot|releas|migrat)[a-z]*\s+(?:[A-Za-z0-9-]+\s+){0,2}"
             r"to\s+production" + WE_),
    _anycase("delete the", WS + r"delet(?:e|es|ed|ing)\s+(?:(?:a|an|the|its|that)\s+)?(?:[A-Za-z0-9-]+\s+){0,2}"
             r"(?:repo|repository|user|account|bucket|database)s?" + WE_),
)
# Every gate kind is read the same way (p51-3): by what the gate is called and by the thing itself, as spend reads
# its words and the currency amount marker.
CREDENTIAL = OLD_CREDENTIAL + CREDENTIAL_THINGS
IRREVERSIBLE = IRREVERSIBLE_WORDS + IRREVERSIBLE_THINGS

FENCE_RE = re.compile(r"^\s*(?:```|~~~)")
INLINE_CODE_RE = re.compile(r"(`+)(?:(?!\1).)+?\1")


def _mask_code(text):
    """The text with fenced blocks (fence lines included) and inline backtick spans blanked to spaces, so every
    offset still points at the same character of the original."""
    out, fenced = [], False
    for line in text.split("\n"):
        if FENCE_RE.match(line):
            fenced = not fenced
            out.append(" " * len(line))
        elif fenced:
            out.append(" " * len(line))
        else:
            out.append(INLINE_CODE_RE.sub(lambda m: " " * len(m.group(0)), line))
    return "\n".join(out)


def _context(text, a, b):
    return re.sub(r"\s*\n\s*", " ", text[max(0, a - CONTEXT):b + CONTEXT]).strip()


def _found(text, words):
    """Every hit of a word list in the text, sorted: [(start, word, end)]. One hit per position per word: the marker's
    three patterns share the word `$ amount`, so a position two of them match reports once."""
    masked = None
    found = {}
    for word, regex, prose_only in words:
        hay = text
        if prose_only:
            if masked is None:
                masked = _mask_code(text)
            hay = masked
        for m in regex.finditer(hay):
            found.setdefault((m.start(), word), m.end())
    return [(a, w, b) for (a, w), b in sorted(found.items())]


def hits(text, words):
    """Every hit of a word list in the text, in text order: [{"word", "at"}] (_found())."""
    return [{"word": w, "at": _context(text, a, b)} for a, w, b in _found(text, words)]


# A `## Approved gates` suffix, `(approved …)` in any case, last on the line: reconcile-rollout.py's GATE_ANNOT_RE,
# copied (same pattern and flags, pinned in tests/gated-inputs.test.mjs), since reconcile-rollout loads this module.
APPROVED_SUFFIX_RE = re.compile(r"\s*\(approved [^)]*\)\s*$", re.I)
BLOCKQUOTE_RE = re.compile(r"^(?:\s*>)+\s*")


def _login_gate(line):
    """The line as a Login gate (module docstring, 1: its `>` markers, its `(approved …)` suffix and its outer
    whitespace stripped), or None when it is none: gate_kind() must read `credential` and has_login_phrase() hold."""
    gate = APPROVED_SUFFIX_RE.sub("", BLOCKQUOTE_RE.sub("", line)).strip()
    return gate if gate_kind(gate) == "credential" and has_login_phrase(gate) else None


def sweep(text, logins=None):
    """{spend, credential, irreversible}: each list's hits in the text (hits()). With `logins` a list (possibly empty:
    the declared test Logins), each credential hit whose source line, the whole text line holding its start, is a
    Login gate (_login_gate()) also carries "login": login_reading(<that line, stripped>, logins); with None (the
    default), none does, and the output is the one-argument shape."""
    credential = []
    for a, w, b in _found(text, CREDENTIAL):
        hit = {"word": w, "at": _context(text, a, b)}
        if logins is not None:
            start, end = text.rfind("\n", 0, a) + 1, text.find("\n", a)
            gate = _login_gate(text[start:] if end < 0 else text[start:end])
            if gate is not None:
                hit["login"] = login_reading(gate, logins)
        credential.append(hit)
    return {"spend": hits(text, SPEND), "credential": credential, "irreversible": hits(text, IRREVERSIBLE)}


def body_of(text):
    """A note's body: the text below its YAML frontmatter (the whole text when it has none)."""
    m = re.match(r"^---\n.*?\n---\n", text, re.S)
    return text[m.end():] if m else text


# ---- the exposure reading --------------------------------------------------------------------------------------

UNIT_NOUNS = ("Login", "account", "seat", "user", "run", "turn", "call", "request", "session", "minute", "hour",
              "day", "night", "week", "fortnight", "quarter", "year")
PERIOD_ADVERBS = ("daily", "nightly", "weekly", "fortnightly", "hourly", "quarterly", "yearly", "annually")
PER_UNITS = ("Login", "account", "seat", "user")
COUNT_WORDS = ("one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten")
NUMBER_WORDS = COUNT_WORDS + ("eleven", "twelve", "twenty", "hundred", "thousand", "dozen", "both", "all", "several",
                              "multiple")
CURRENCY_NUMBER_WORDS = COUNT_WORDS + ("eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen",
                                       "eighteen", "nineteen", "twenty", "thirty", "forty", "fifty", "sixty", "seventy",
                                       "eighty", "ninety", "hundred", "thousand", "million", "billion", "dozen")
NON_USD_CODES = ("AUD", "NZD", "CAD", "EUR", "GBP", "JPY")
MAGNITUDES = ("k", "m", "bn", "mn", "thousand", "million", "billion", "grand")
MULTIPLIER_WORDS = ("times", "twice", "double", "triple", "apiece")   # rules 5 and 7 share it
# Login and account are one unit (p18-7's "per Login (per account)"), so a per-account cap counts across N Logins.
SAME_UNIT = {"login": "login", "account": "login", "seat": "seat", "user": "user"}

WE = r"(?![A-Za-z0-9_])"            # a word end


def _alt(words):
    return "(?:" + "|".join(re.escape(w) for w in words) + ")"


NUM = r"(?:\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)"
TOKEN_RES = (
    re.compile(WS + r"(?:US\$|USD|\$) ?(?P<num>" + NUM + ")", re.I),
    re.compile(WS + r"(?P<num>" + NUM + r") ?USD" + WE, re.I),
)
CAP_RE = re.compile(WS + r"cap(?:ped)?" + WE + r"\s*(?:(?:at|of)" + WE + r"\s*)?(?::\s*)?", re.I)
CODE_SPAN_RE = re.compile(r"`[^`]*`")
CLAUSE_END_RE = re.compile(r"[,;:—–]| and |\.(?!\d)")
TAIL_MALFORMED_RE = re.compile(r"[A-Za-z0-9_]|[.,]\d")
TAIL_MAGNITUDE_RE = re.compile(r"\s*" + _alt(MAGNITUDES) + WE, re.I)
TAIL_RANGE_RE = re.compile(r"\s*(?:[-–—]|(?:to|or)" + WE + r")\s*(?:US\$|USD|\$)?\s?\d[\d,.]*", re.I)

UNIT_RE = _alt(UNIT_NOUNS) + r"s?"
TOTAL_RES = [re.compile(WS + p + WE, re.I) for p in (r"in\s+total", r"total", r"one[- ]off", r"once", r"overall")]
MONTH_RES = [re.compile(p, re.I) for p in (
    WS + r"per\s+(?:calendar\s+)?month" + WE, WS + r"(?:a|each|every)\s+(?:calendar\s+)?month" + WE,
    r"/month" + WE, r"/mo" + WE, WS + r"monthly" + WE)]
PER_UNIT_RE = re.compile(WS + r"per\s+(?P<unit>" + _alt(PER_UNITS) + ")" + WE, re.I)
COUNT_N = r"(?P<n>[1-9]\d*|" + _alt(COUNT_WORDS) + ")"
COUNT_RES = [re.compile(p, re.I) for p in (
    WS + r"(?:across|for)\s+" + COUNT_N + r"\s+(?P<unit>" + _alt(PER_UNITS) + r")s?" + WE,
    r"×\s*" + COUNT_N + WE,
    WS + r"x ?" + COUNT_N + WE)]
# Words that say the cap is not the ceiling: a soft or open-ended cap, a cap before tax, fees or overage, an opening
# amount (ADR 0034: anything it cannot price asks). One list for rule 5 (inside the clause) and rule 7 (outside it),
# so the two fail-closed readings never disagree. `plus` or a bare `+` widens only with no amount after it: `plus
# US$30` is an amount, summed by rule 9, and `plus 20%` or `plus 30 more` keep their own rule's why.
WIDENING = (r"(?:" + WS + r"plus" + WE + r"|\+)(?!\s*(?:US\$|USD|\$)?\s?\d)|" + WS + r"(?:" + "|".join((
    r"excluding", r"exclusive\s+of", r"excl", r"ex", r"tax(?:es)?", r"VAT", r"GST", r"fees?", r"overages?", r"soft",
    r"uncapped", r"no\s+hard\s+(?:limit|cap)", r"exceed(?:s|ed|ing)?", r"initially", r"to\s+start", r"for\s+now",
    r"or\s+more", r"at\s+least", r"minimum", r"approx(?:imately)?", r"roughly")) + r")" + WE)
MULTIPLIER = r"×|" + WS + r"x\d|" + WS + _alt(MULTIPLIER_WORDS) + WE
# Do 2 (p37-4): outside the cap clause, `per` or `each` is a rate only before a unit, never in prose ("per the task
# note", "per ADR 0038"); on the cap itself any per/each/every still asks (PER_EACH_EVERY_RE).
# RATE_UNITS is UNIT_NOUNS plus the nouns spend is counted in; each may be plural (`s`, `es`, `queries`). SEP joins a
# rate word to its unit: whitespace, or a `-` or `/` with optional spaces around it (`per run`, `per-run`, `per/run`).
RATE_UNITS = UNIT_NOUNS + ("month", "time", "image", "token", "invocation", "iteration", "attempt", "probe", "push",
                           "item", "task", "eval", "case", "commit", "PR", "file", "page", "prompt", "query", "message",
                           "step", "batch", "job", "model", "character", "word", "second", "generation", "render",
                           "video", "clip", "frame")
RATE_UNIT = ("(?:" + "|".join("quer(?:y|ies)" if u == "query" else re.escape(u) + "(?:e?s)?" for u in RATE_UNITS)
             + ")" + WE)
SEP = r"(?:\s+|\s*[-/]\s*)"
# The match is the word alone (lookarounds hold the rest), so a why lists `per`/`each` as the gate writes it. `each` is
# a rate before a unit or a digit, before `of`, before a non-letter, non-digit character or the gate's end (`one call
# each —`, `3 each,`, `each --max-cost-usd 4`), or straight after a digit and one space (`US$5 each for the runs`).
# RATE_RE is rule 7(i)'s alone, read over the whole gate with only the clause blanked, so its `(?<=\d\s)` lookbehind
# sees the digit before it. Inside the clause any `per`/`each`/`every` asks (PER_EACH_EVERY_RE, below): a word on the
# cap itself is a rate on the cap whatever follows it (`cap US$0.10 per GB`, `cap US$5 each for the images`).
RATE_RE = re.compile(
    WS + r"per" + WE + r"(?=" + SEP + r"(?:" + RATE_UNIT + r"|\d))"
    + r"|" + WS + r"each" + WE + r"(?=" + SEP + r"(?:" + RATE_UNIT + r"|\d)|\s+of" + WE + r"|\s*(?:[^\sA-Za-z0-9]|\Z))"
    + r"|(?<=\d\s)each" + WE, re.I)
# Rule 5's per/each/every, in both clause readings: any of the three words on the cap asks (the reading before p37-4,
# kept: only the prose `per` outside the clause needed relaxing, and the Steer gate's clause is empty).
PER_EACH_EVERY_RE = re.compile(WS + _alt(("per", "each", "every")) + WE, re.I)
LEFTOVER_RES = (
    ("a digit", re.compile(r"\d")),
    ("a number word", re.compile(WS + _alt(NUMBER_WORDS) + WE, re.I)),
    ("a multiplier", re.compile(MULTIPLIER, re.I)),
    ("per/each/every", PER_EACH_EVERY_RE),
    ("a / unit", re.compile(r"/\s?[A-Za-z]")),
    ("a unit noun", re.compile(WS + UNIT_RE + WE, re.I)),
    ("a period adverb", re.compile(WS + _alt(PERIOD_ADVERBS) + WE, re.I)),
    ("a currency", re.compile(r"[$€£¥]|" + WS + _alt(("USD",) + NON_USD_CODES) + WE, re.I)),
    # `before` is the clause's alone: p18-7's probe reads "stopping before any Turn" outside its clause.
    ("a widening word", re.compile(WIDENING + "|" + WS + r"before" + WE, re.I)),
)
# The cap-only reading's rule 5 (p37-4): LEFTOVER_RES without a digit, a number word or a bare unit noun, so prose
# beside a readable cap (`(Haiku 4.5)`, `for the 3 probes`) reads as the cap. What still asks is a word that changes
# what the cap is: a multiplier (`x 3`, `3x` too), `%`, any `per`, `each` or `every` (`per day`, `per GB`, `each`,
# `every run`), a recurring unit (`a day`, `an hour`), a `/` unit (`/1k` too), a per-unit noun (Login, account, seat,
# user), a period adverb, a currency (a second amount the clause cannot read) or a widening word (any `plus` or `+`
# too: an amount after it inside the clause is a second amount).
CAP_ONLY_LEFTOVER_RES = (
    ("a multiplier", re.compile(MULTIPLIER + r"|" + WS + r"x ?\d|\d ?x" + WE, re.I)),
    ("a percentage", re.compile(r"%")),
    ("per/each/every", PER_EACH_EVERY_RE),
    ("a / unit", re.compile(r"/\s?[A-Za-z0-9]")),
    ("a recurring unit", re.compile(WS + r"(?:a|an)\s+" + UNIT_RE + WE, re.I)),
    ("a per-unit noun", re.compile(WS + _alt(PER_UNITS) + r"s?" + WE, re.I)),
    ("a period adverb", re.compile(WS + _alt(PERIOD_ADVERBS) + WE, re.I)),
    ("a currency", re.compile(r"[$€£¥]|" + WS + _alt(("USD",) + NON_USD_CODES) + WE, re.I)),
    ("a widening word", re.compile(WIDENING + r"|" + WS + r"plus" + WE + r"|\+|" + WS + r"before" + WE, re.I)),
)
CURRENCY_MARK = r"(?:US\$|USD" + WE + r"|\$|" + WS + _alt(NON_USD_CODES) + WE + ")"
CURRENCY_RES = (
    re.compile(WS + r"(?:AU|NZ|CA|A|C)\$\s?\d|[€£¥]\s?\d|\d\s?[€£¥]"),
    re.compile(WS + _alt(NON_USD_CODES) + r"\s?\d|\d\s?" + _alt(NON_USD_CODES) + WE, re.I),
    re.compile(r"\d[\d,.]*\s*minor\s+units" + WE, re.I),
    re.compile(WS + r"(?:dollars?|bucks|euros?|pounds?|cents?)" + WE, re.I),
    re.compile(WS + _alt(CURRENCY_NUMBER_WORDS) + r"\s?" + CURRENCY_MARK + "|"
               + r"(?:US\$|" + WS + r"USD|" + WS + _alt(NON_USD_CODES) + r"|\$)\s?" + _alt(CURRENCY_NUMBER_WORDS) + WE, re.I),
    re.compile(r"\d[\d,.]*\s?" + _alt(MAGNITUDES) + r"\s?" + WS + _alt(("USD",) + NON_USD_CODES) + WE, re.I),
)
# 7(ix) (p37-4): a per-unit word outside the clause, last, so relaxing per/each never lets a per-Login reading through:
# `per`/`each`, up to three SEP-joined words, then a singular Login, account, seat or user (`per the dummy Login`, `each
# new Login`, `per-Login`); `every`/`a`/`an` directly before one; a `/` before one. Its why names the unit as written.
PER_UNIT_OUTSIDE_RE = re.compile(
    r"(?:" + WS + r"(?:per|each)(?:" + SEP + r"[A-Za-z]+){0,3}" + SEP + r"|" + WS + r"(?:every|a|an)\s+|/\s?)"
    + r"(?P<unit>" + _alt(PER_UNITS) + r")(?:'s)?" + WE, re.I)
OUTSIDE_RES = (
    ("per/each outside the cap clause", RATE_RE),
    ("plural unit outside the cap clause", re.compile(WS + _alt(("Logins", "accounts", "seats", "users")) + WE, re.I)),
    # (iii) stays a list, never a blanket `every`: p18-7's probe reads "every signed-in Claude Login" and must pass
    # (ADR 0034 decision 1). Accepted residual: `every`/`a`/`an` before a noun NOT on UNIT_NOUNS (`every push`, `every
    # image`) reads x1. That is safe because the cap is the task's total ceiling, never a target (the engine's
    # GATED_INPUTS_CHECK, task.workflow.js), and the annotation records "total exposure", so per-item spend above it
    # is a review failure, never an approved spend. tests/gated-inputs.test.mjs pins it as accepted.
    ("recurring unit outside the cap clause", re.compile(WS + r"(?:every|a|an)\s+" + UNIT_RE + WE, re.I)),
    ("period outside the cap clause", re.compile(WS + r"(?:nights?|" + _alt(PERIOD_ADVERBS) + ")" + WE, re.I)),
    ("per-unit slash outside the cap clause", re.compile(r"/\s?" + UNIT_RE + WE, re.I)),
    ("multiplier outside the cap clause", re.compile(MULTIPLIER + r"|\dx" + WE, re.I)),
    ("percentage outside the cap clause", re.compile(r"%")),
    ("widening word outside the cap clause", re.compile(WIDENING, re.I)),
    (None, PER_UNIT_OUTSIDE_RE),   # 7(ix): `per-<unit> cap with no <unit> count`
)
# The cap-only reading runs only these outside the clause: a plural unit (ii) and a per-unit word (ix).
CAP_ONLY_OUTSIDE = (OUTSIDE_RES[1], OUTSIDE_RES[-1])
BARE_NUMBER_RE = re.compile(r"(?<![A-Za-z0-9_.,\-])\d+")


def _dec(num):
    return Decimal(num.replace(",", ""))


def _tokens(gate):
    """Every USD amount token, sorted, overlaps dropped: [(start, end, num_end, Decimal)]."""
    found = []
    for regex in TOKEN_RES:
        for m in regex.finditer(gate):
            found.append((m.start(), m.end(), m.end("num"), _dec(m.group("num"))))
    out, last = [], -1
    for t in sorted(found):
        if t[0] >= last:
            out.append(t)
            last = t[1]
    return out


def _blank(text, spans):
    """The text with each (a, b) span blanked to spaces (offsets kept)."""
    chars = list(text)
    for a, b in spans:
        for i in range(max(0, a), min(len(chars), b)):
            chars[i] = " "
    return "".join(chars)


def _none(why):
    return {"usd": None, "why": why}


def _clause(clause, cap_only=False):
    """(multiplier, why): the clause read against the whitelist (rule 5); multiplier None when it asks. The leftover is
    read against LEFTOVER_RES, or CAP_ONLY_LEFTOVER_RES for the cap-only reading."""
    spans = []
    for regex in TOTAL_RES + MONTH_RES:
        spans += [m.span() for m in regex.finditer(_blank(clause, spans))]
    rest = _blank(clause, spans)
    per = list(PER_UNIT_RE.finditer(rest))
    mult = 1
    if per:
        counts = [m for regex in COUNT_RES for m in regex.finditer(rest)]
        if not counts:
            unit = per[0].group("unit")
            return None, f"per-{unit} cap with no {unit} count"
        if len(per) > 1:
            return None, "more than one per-unit token"
        if len(counts) > 1:
            return None, "more than one count phrase"
        noun = counts[0].groupdict().get("unit")
        if noun and SAME_UNIT[noun.lower()] != SAME_UNIT[per[0].group("unit").lower()]:
            return None, "count unit does not match the per-unit token"
        n = counts[0].group("n")
        mult = int(n) if n.isdigit() else COUNT_WORDS.index(n.lower()) + 1
        rest = _blank(rest, [per[0].span(), counts[0].span()])
    left = re.sub(r"\s+", " ", rest).strip()
    for _label, regex in (CAP_ONLY_LEFTOVER_RES if cap_only else LEFTOVER_RES):
        if regex.search(rest):
            return None, f"unrecognised clause: {left}"
    return mult, ""


def exposure(gate):
    """{"usd": Decimal | None, "why": str} for one declared gate: the full reading (module docstring, 2: rules 1-9)."""
    return _reading(gate, False)


def _reading(gate, cap_only):
    """The full reading (rules 1-9), or with `cap_only` the cap-only one: rules 1-4 and 6 unchanged, rule 5 against
    CAP_ONLY_LEFTOVER_RES, rule 7 only (ii) and (ix), rule 8 skipped, rule 9 unchanged (module docstring, 2)."""
    gate = re.sub(r"^\s*[-*]\s+", "", str(gate or "")).strip()
    if gate_kind(gate) != "spend":
        return _none("not a spend gate")
    tokens = _tokens(gate)
    by_start = {t[0]: t for t in tokens}
    caps = []
    for m in CAP_RE.finditer(gate):
        if m.end() in by_start:
            caps.append(by_start[m.end()])
    if not caps:
        return _none("no cap clause")
    if len(caps) > 1:
        return _none(f"{len(caps)} cap clauses")
    cap = caps[0]
    for t in [cap] + [t for t in tokens if t is not cap]:
        tail = gate[t[2]:]
        if TAIL_MALFORMED_RE.match(tail):
            return _none(f"malformed amount: {gate[t[0]:t[2] + 1].strip()}")
        if TAIL_MAGNITUDE_RE.match(tail):
            return _none(f"magnitude word: {gate[t[0]:t[2]]}{TAIL_MAGNITUDE_RE.match(tail).group(0)}")
        if TAIL_RANGE_RE.match(tail):
            return _none(f"range: {gate[t[0]:t[2]]}{TAIL_RANGE_RE.match(tail).group(0)}")
    end = CLAUSE_END_RE.search(gate, cap[1])
    clause_end = end.start() if end else len(gate)
    mult, why = _clause(gate[cap[1]:clause_end], cap_only)
    if mult is None:
        return _none(why)
    for regex in CURRENCY_RES:
        m = regex.search(gate)
        if m:
            return _none(f"non-USD or ambiguous currency: {m.group(0).strip()}")
    outside = _blank(gate, [(cap[1], clause_end)])
    for entry in OUTSIDE_RES:
        if cap_only and entry not in CAP_ONLY_OUTSIDE:
            continue
        label, regex = entry
        found = list(regex.finditer(outside))
        if found:
            if label is None:   # 7(ix): the unit as the gate writes it
                unit = found[0].group("unit")
                return _none(f"per-{unit} cap with no {unit} count")
            return _none(f"{label}: {', '.join(m.group(0).strip() for m in found)}")
    if not cap_only:
        plain = _blank(outside, [m.span() for m in CODE_SPAN_RE.finditer(outside)] + [(t[0], t[1]) for t in tokens])
        bare = BARE_NUMBER_RE.search(plain)
        if bare:
            return _none(f"a number outside the cap clause: {bare.group(0)}")
    usd = cap[3] * mult + sum((t[3] for t in tokens if t is not cap), Decimal(0))
    return {"usd": usd, "why": ""}


def standing_exposure(gate):
    """{"usd": Decimal | None, "why": str, "capOnly": str}: the standing reading (module docstring, 2). The full
    reading when it prices (capOnly ""); else the cap-only reading when that prices, capOnly then the full reading's
    why; else None with the cap-only reading's why (for a rule 1-4 or 6 failure, and most rule 5 failures, the full
    reading's why too)."""
    full = exposure(gate)
    if full["usd"] is not None:
        return {"usd": full["usd"], "why": "", "capOnly": ""}
    cap = _reading(gate, True)
    if cap["usd"] is not None:
        return {"usd": cap["usd"], "why": "", "capOnly": full["why"]}
    return {"usd": None, "why": cap["why"], "capOnly": ""}


def covered(gate, limit):
    """{"covered": bool, "usd": Decimal | None, "why": str, "capOnly": str}: standing_exposure(gate) against the
    standing approval's limit (an int >= 0; 0 is off). Covered iff limit > 0 and usd <= limit, inclusive. capOnly is
    the full reading's why when the gate was priced from its cap alone, else ""."""
    out = standing_exposure(gate)
    ok = out["usd"] is not None and limit > 0 and out["usd"] <= Decimal(limit)
    return {"covered": ok, "usd": out["usd"], "why": out["why"], "capOnly": out["capOnly"]}


def format_usd(value):
    """An amount as the annotation writes it: whole when integral, else to 2 dp."""
    d = Decimal(value)
    if d == d.to_integral_value():
        return str(int(d))
    return str(d.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def annotation(date, usd, limit, source):
    """The standing approval's `## Approved gates` suffix (module docstring, 3). Raises ValueError on a `)` in any
    part: the engine's normalizeGate strips only an annotation with none."""
    text = (f"(approved {date} under the standing approval: total exposure US${format_usd(usd)}, "
            f"limit US${format_usd(limit)} from {source})")
    if text.count(")") != 1:
        raise ValueError(f"an annotation part holds a ')': {date!r}, {source!r}")
    return text


# ---- the test-credential reading (ADR 0063) ---------------------------------------------------------------------

def gate_kind(gate):
    """The gate's kind: a list marker stripped, the text before the first `:`, lower-cased ("" with no colon)."""
    gate = re.sub(r"^\s*[-*]\s+", "", str(gate or "")).strip()
    return gate.split(":", 1)[0].strip().lower() if ":" in gate else ""


DENY_LIVE_PROD_RE = re.compile(r"(?:(?<![A-Za-z0-9_])|_)(?:live|prod)[A-Za-z]*", re.I)
DENY_NOUNS = ("password", "passphrase", "private key", "ssh", "oauth", "api key", "access key", "access", "token",
              "secret", "1password", "keychain", "cookie")
DENY_RES = (DENY_LIVE_PROD_RE,) + tuple(
    re.compile(WS + r"\s+".join(re.escape(p) for p in phrase.split(" ")) + r"[A-Za-z]*", re.I)
    for phrase in tuple(w for w, _r, _p in IRREVERSIBLE_WORDS) + DENY_NOUNS)
MODE_RE = re.compile(WS + r"(?:test-mode|testmode|test|staging|sandbox)(?![A-Za-z0-9])", re.I)
ENV_TOKEN_RE = re.compile(r"(?<![A-Za-z0-9_])[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+(?![A-Za-z0-9_])")
PREFIX_TOKEN_RE = re.compile(r"(?<![A-Za-z0-9_])[a-z][a-z0-9]*(?:_[a-z0-9]+)*_(?![A-Za-z0-9_])")
REF_TOKEN_RE = re.compile(r"(?<![A-Za-z0-9_])[a-z]{20}(?![A-Za-z0-9_])")
NO_CLASS_WHY = ("no test-credential class for this repo (set test_credentials in its [repo.\"owner/name\"] table in "
                "~/.config/thread/rollouts.toml)")
MAX_ENV_BYTES = 1 << 20
ENV_LINE_RE = re.compile(r"(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\Z")


def _cred_none(why):
    return {"names": None, "why": why}


def credential_reading(gate, cls):
    """{"names": [...] | None, "why"}: the test-credential reading of one gate (module docstring, 4)."""
    gate = re.sub(r"^\s*[-*]\s+", "", str(gate or "")).strip()
    if gate_kind(gate) != "credential":
        return _cred_none("not a credential gate")
    text = gate.split(":", 1)[1]
    found = []
    for regex in DENY_RES:
        found += [(m.start(), -len(m.group(0)), m.group(0)) for m in regex.finditer(text)]
    if found:
        word = re.sub(r"\s+", " ", min(found)[2]).lstrip("_")
        return _cred_none(f"deny word: {word}")
    if not MODE_RE.search(text):
        return _cred_none("no test-mode, staging or sandbox word")
    if not cls:
        return _cred_none(NO_CLASS_WHY)
    declared = {k["name"]: k for k in cls["keys"]}
    names = []
    for m in ENV_TOKEN_RE.finditer(text):
        if m.group(0) not in declared:
            return _cred_none(f"{m.group(0)} is not a declared test credential")
        if m.group(0) not in names:
            names.append(m.group(0))
    if not names:
        return _cred_none("it names no declared test credential")
    prefixes = {declared[n]["prefix"] for n in names if "prefix" in declared[n]}
    for m in PREFIX_TOKEN_RE.finditer(text):
        if m.group(0) not in prefixes:
            return _cred_none(f"{m.group(0)} is not the declared prefix of a key it names")
    refs = {declared[n]["supabase_project"] for n in names if "supabase_project" in declared[n]}
    for m in REF_TOKEN_RE.finditer(text):
        if m.group(0) not in refs:
            return _cred_none(f"{m.group(0)} is not the declared Supabase project of a key it names")
    return {"names": names, "why": ""}


def _parse_env(text):
    """{name: value} from a dotenv text (module docstring, 4: read_env)."""
    out = {}
    for line in text.replace("\r", "").split("\n"):
        s = line.strip()
        if not s or s.startswith("#"):
            continue
        m = ENV_LINE_RE.match(s)
        if not m:
            continue
        raw = m.group(2)
        if raw[:1] in ("'", '"'):
            end = raw.find(raw[0], 1)
            out[m.group(1)] = None if end < 0 else raw[1:end]
        else:
            out[m.group(1)] = re.split(r"\s#", raw, maxsplit=1)[0].strip()
    return {k: v for k, v in out.items() if v}


def read_env(path):
    """({name: value}, None) or (None, why): the declared env file, read safely (module docstring, 4)."""
    real = os.path.expanduser(path)
    if not os.path.isfile(real):
        return None, f"{path} is not a regular file"
    flags = os.O_RDONLY
    for flag in ("O_NONBLOCK", "O_NOCTTY", "O_CLOEXEC"):
        flags |= getattr(os, flag, 0)
    fd, chunks, size = None, [], 0
    try:
        fd = os.open(real, flags)
        if not stat.S_ISREG(os.fstat(fd).st_mode):
            return None, f"{path} is not a regular file"
        while size <= MAX_ENV_BYTES:
            chunk = os.read(fd, MAX_ENV_BYTES + 1 - size)
            if not chunk:
                break
            chunks.append(chunk)
            size += len(chunk)
    except OSError:
        return None, f"cannot read {path}"
    finally:
        if fd is not None:
            os.close(fd)
    if size > MAX_ENV_BYTES:
        return None, f"{path} is over 1 MiB"
    try:
        text = b"".join(chunks).decode("utf-8")
    except UnicodeDecodeError:
        return None, f"{path} is not UTF-8"
    return _parse_env(text), None


def _jwt_payload(value):
    """A three-part JWT's payload as a dict, or None (no JWT, bad base64url, or a payload that is no JSON object)."""
    parts = value.split(".")
    if len(parts) != 3 or not all(re.fullmatch(r"[A-Za-z0-9_-]+", p) for p in parts):
        return None
    try:
        payload = json.loads(base64.urlsafe_b64decode(parts[1] + "=" * (-len(parts[1]) % 4)).decode("utf-8"))
    except (binascii.Error, ValueError):
        return None
    return payload if isinstance(payload, dict) else None


def env_proof(cls, names):
    """{"ok", "why"}: each named key present in the class's file with its declared form (module docstring, 4)."""
    env, why = read_env(cls["file"])
    if why:
        return {"ok": False, "why": why}
    path = cls["file"]
    declared = {k["name"]: k for k in cls["keys"]}
    missing = [n for n in names if n not in env]
    if missing:
        return {"ok": False, "why": "; ".join(f"{n} is not set in {path}" for n in missing)}
    for n in names:
        key = declared.get(n)
        if key is None:
            return {"ok": False, "why": f"{n} is not a declared test credential"}
        if "prefix" in key:
            if not env[n].startswith(key["prefix"]):
                return {"ok": False, "why": f"{n} in {path} does not start with {key['prefix']}"}
            continue
        payload = _jwt_payload(env[n])
        if payload is None:
            return {"ok": False, "why": f"{n} in {path} is not a legacy JWT service key, so its project cannot be proved"}
        if payload.get("ref") != key["supabase_project"]:
            return {"ok": False, "why": f"{n} in {path} is not a key for Supabase project {key['supabase_project']}"}
    return {"ok": True, "why": ""}


def _no(why):
    return {"ok": False, "why": why}


SHELL_OPS = ("&>>", "<<-", "&&", "||", ";;", "<<", ">>", "<&", ">&", "<>", ">|", "&>", "&", "|", ";", "(", ")", "<", ">")
SHELL_NAME_CHARS = frozenset("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_")


def _shell_tokens(cmd):
    """The env_bootstrap's tokens as the shell reads them (module docstring, 4: bootstrap_refreshes): [(kind, text,
    value)], kind "op" for an unquoted operator (SHELL_OPS, longest first; a newline reads as `;`) and "word" for a
    word. A word's text is its quotes removed; its value is what the shell passes for it: also a `~` that starts it
    unquoted, before `/`, a blank, an operator or the end, and a `$HOME` or `${HOME}` outside single quotes, each
    expanded to HOME. A `#` that starts a word comments to the line's end. Raises ValueError on an unclosed quote or a
    trailing backslash."""
    home, toks, n, i = os.path.expanduser("~"), [], len(cmd), 0
    text, value, started = [], [], False

    def home_len(j):   # the length of a `$HOME` or `${HOME}` at j, else 0
        if cmd.startswith("${HOME}", j):
            return 7
        return 5 if cmd.startswith("$HOME", j) and (j + 5 >= n or cmd[j + 5] not in SHELL_NAME_CHARS) else 0

    def put(t, v=None):
        text.append(t)
        value.append(t if v is None else v)

    while i < n:
        c = cmd[i]
        if c == "\\":
            if i + 1 >= n:
                raise ValueError("a trailing backslash")
            if cmd[i + 1] != "\n":   # a backslash-newline joins the lines
                put(cmd[i + 1])
                started = True
            i += 2
        elif c == "'":
            j = cmd.find("'", i + 1)
            if j < 0:
                raise ValueError("no closing quotation")
            put(cmd[i + 1:j])
            started, i = True, j + 1
        elif c == '"':
            started, i = True, i + 1
            while True:
                if i >= n:
                    raise ValueError("no closing quotation")
                c = cmd[i]
                if c == '"':
                    i += 1
                    break
                if c == "\\" and i + 1 < n and cmd[i + 1] in '$`"\\\n':
                    if cmd[i + 1] != "\n":
                        put(cmd[i + 1])
                    i += 2
                elif c == "$" and home_len(i):
                    put(cmd[i:i + home_len(i)], home)
                    i += home_len(i)
                else:
                    put(c)
                    i += 1
        elif c == "$" and home_len(i):
            put(cmd[i:i + home_len(i)], home)
            started, i = True, i + home_len(i)
        elif c == "~" and not started and (i + 1 >= n or cmd[i + 1] == "/" or cmd[i + 1].isspace()
                                           or cmd[i + 1] in "&|;()<>"):
            put("~", home)
            started, i = True, i + 1
        elif c == "#" and not started:
            j = cmd.find("\n", i)
            i = n if j < 0 else j
        elif c.isspace() or c in "&|;()<>":
            if started:
                toks.append(("word", "".join(text), "".join(value)))
                text, value, started = [], [], False
            if c == "\n":
                toks.append(("op", ";", ";"))
                i += 1
            elif c.isspace():
                i += 1
            else:
                op = next(o for o in SHELL_OPS if cmd.startswith(o, i))
                toks.append(("op", op, op))
                i += len(op)
        else:
            put(c)
            started, i = True, i + 1
    if started:
        toks.append(("word", "".join(text), "".join(value)))
    return toks


def bootstrap_refreshes(cmd, file):
    """{"ok", "why"}: the rollout's env_bootstrap copies `file` with a plain, unconditional cp (module docstring, 4)."""
    if not cmd:
        return _no(f"the rollout's env_bootstrap does not provide {file}")
    try:
        tokens = _shell_tokens(cmd)
    except ValueError:
        return _no("the rollout's env_bootstrap is not one shell command")
    path = os.path.expanduser(file)
    home = os.path.expanduser("~").rstrip("/")
    spellings = {path}
    if home and path.startswith(home + "/"):
        rest = path[len(home) + 1:]
        spellings |= {"~/" + rest, "$HOME/" + rest, "${HOME}/" + rest}
    # Simple commands: (words, the separator operators before it), each redirection, its target and a bare fd digit
    # before it dropped (none of them is an operand). A word is its value: what the shell passes.
    commands, words, seps, target, quoted = [], [], [], False, False
    for kind, text, value in tokens:
        if kind == "op" and all(c in "&|;()" for c in value):
            if words:
                commands.append((words, seps))
                words, seps = [], []
            seps.append(value)
            target = False
            continue
        if target:
            target = False
            continue
        if kind == "op":   # a redirection: its target is the next word
            if words and words[-1].isdigit():
                words.pop()
            target = True
            continue
        quoted = quoted or (value != path and text in spellings)
        words.append(value)
    if words:
        commands.append((words, seps))
    pre = f"the rollout's env_bootstrap may not refresh {file} into the task tree: "
    named = [n for n, (w, _s) in enumerate(commands) if path in w]
    if not named:
        if quoted:
            return _no(pre + "it names the file with a quoted ~ or a single-quoted $HOME, which the shell never expands")
        return _no(f"the rollout's env_bootstrap does not provide {file}")
    for n in named:
        w, seps = commands[n]
        if w[0] != "cp":
            return _no(pre + "it names the file outside a plain cp")
        operands, opts_done = [], False
        for word in w[1:]:
            if not opts_done and word == "--":
                opts_done = True
            elif not opts_done and word.startswith("-") and word != "-":
                if (word in ("--no-clobber", "--interactive", "--update") or word.startswith("--update=")
                        or (not word.startswith("--") and set(word[1:]) & set("nui"))):
                    return _no(pre + "its cp skips an existing copy (-n, -u or -i)")
            else:
                operands.append(word)
        if operands and operands[-1] == path:
            return _no(pre + "its cp writes the file instead of reading it")
        # Joined by && or || (through any parenthesis) to a test, directly or along the chain before it.
        k = n
        while k > 0 and any(sep in ("&&", "||") for sep in commands[k][1]):
            k -= 1
            if commands[k][0][0] in ("[", "[[", "test"):
                return _no(pre + "its copy runs only after a test")
    return {"ok": True, "why": ""}


def credential_covered(gate, cls, bootstrap):
    """{"covered", "names", "why"}: credential_reading, then bootstrap_refreshes, then env_proof (module docstring,
    4); covered only when all three pass."""
    reading = credential_reading(gate, cls)
    if reading["names"] is None:
        return {"covered": False, "names": None, "why": reading["why"]}
    for check in (lambda: bootstrap_refreshes(bootstrap, cls["file"]), lambda: env_proof(cls, reading["names"])):
        r = check()
        if not r["ok"]:
            return {"covered": False, "names": reading["names"], "why": r["why"]}
    return {"covered": True, "names": reading["names"], "why": ""}


def credential_annotation(date, names, file, source):
    """The standing approval's `## Approved gates` suffix for a declared test credential (module docstring, 4). Raises
    ValueError on a `)` in any part: the engine's normalizeGate strips only an annotation with none."""
    text = (f"(approved {date} under the standing approval: test credential {', '.join(names)} present in {file}, "
            f"class from {source})")
    if text.count(")") != 1:
        raise ValueError(f"an annotation part holds a ')': {date!r}, {file!r}, {source!r}")
    return text


# ---- the test-Login reading (p37-4, ADR 0034's 2026-11-05 amendment) ---------------------------------------------

NO_LOGINS_WHY = "no test Logins declared (set [defaults] test_logins in ~/.config/thread/rollouts.toml)"
LOGIN_WORD_RE = re.compile(WS + r"Logins?(?:'s)?" + WE, re.I)
LOGIN_NAME = r"[A-Za-z0-9][A-Za-z0-9_-]{0,39}"
# A `<name> (Claude )?Login('s)?` phrase; the leftmost name wins, so `the Claude Login` names `the`.
LOGIN_PHRASE_RE = re.compile(r"(?<![A-Za-z0-9_-])(?P<name>" + LOGIN_NAME + r")\s+(?:Claude\s+)?(?P<login>Login(?:'s)?)"
                             + WE, re.I)
# A `live` directly before a probe, run or test (`a live probe on the dummy Login`) is no deny word here.
LIVE_USE_RE = re.compile(r"(?:\s+|-)(?:probe|run|test)s?" + WE, re.I)
OTHER_CREDENTIAL_RES = (re.compile(WS + r"(?:accounts?|keys?|credentials?|API)" + WE, re.I),
                        re.compile(WS + r"PATs?" + WE), re.compile(r"\.env" + WE))
# Step 5: nothing joined beside the Login. An `@` (an address or handle: another account to sign in as) or a
# conjunction that joins a second thing to the Login asks, whatever the second thing is (`the dummy Login and Lachy's
# Gmail`), so a gate signed here grants the Login alone. A second thing in plain prose with neither (`the dummy Login,
# to push to the npm registry`) still passes: an accepted residual (module docstring, 5).
ADDRESS_RE = re.compile(r"[^\s,;()\[\]<>'\"`]*@[^\s,;()\[\]<>'\"`]*")
CONJUNCTION_RE = re.compile(WS + r"(?:and|or|plus|as\s+well\s+as|along\s+with|together\s+with)" + WE + r"|[&+;]",
                            re.I)


def has_login_phrase(gate):
    """True when the text after the gate's first `:` holds a `Login` or `Logins` word (any case) and no upper-snake env
    token (module docstring, 5): the gate takes the test-Login reading, never the class one."""
    gate = re.sub(r"^\s*[-*]\s+", "", str(gate or "")).strip()
    if ":" not in gate:
        return False
    text = gate.split(":", 1)[1]
    return bool(LOGIN_WORD_RE.search(text)) and not ENV_TOKEN_RE.search(text)


def login_reading(gate, logins):
    """{"names": [...] | None, "why"}: the test-Login reading of one gate (module docstring, 5). Fail closed, the first
    failure wins, reading only the text after the first `:`; steps 1-6 need no `logins` (None or a list of declared
    names). names are the declared spellings of the Logins it names, in text order, each once."""
    gate = re.sub(r"^\s*[-*]\s+", "", str(gate or "")).strip()
    if gate_kind(gate) != "credential":
        return _cred_none("not a credential gate")
    text = gate.split(":", 1)[1]
    found = []
    for i, regex in enumerate(DENY_RES):
        for m in regex.finditer(text):
            if i == 0 and m.group(0).lstrip("_").lower() == "live" and LIVE_USE_RE.match(text, m.end()):
                continue   # `live probe`, `live-run`, `live tests`
            found.append((m.start(), -len(m.group(0)), m.group(0)))
    if found:
        word = re.sub(r"\s+", " ", min(found)[2]).lstrip("_")
        return _cred_none(f"deny word: {word}")
    env = ENV_TOKEN_RE.search(text)
    if env:
        return _cred_none(f"an env key beside a Login: {env.group(0)}")
    other = [m for regex in OTHER_CREDENTIAL_RES for m in regex.finditer(text)]
    if other:
        return _cred_none(f"another credential beside the Login: {min(other, key=lambda m: m.start()).group(0)}")
    joined = [(m.start(), "an address beside the Login: " + m.group(0).rstrip(".")) for m in ADDRESS_RE.finditer(text)]
    joined += [(m.start(), "something joined to the Login: " + re.sub(r"\s+", " ", m.group(0)))
               for m in CONJUNCTION_RE.finditer(text)]
    if joined:
        return _cred_none(min(joined)[1])
    words = list(LOGIN_WORD_RE.finditer(text))
    plural = next((m for m in words if re.match(r"Logins" + WE, m.group(0), re.I)), None)
    if plural:
        return _cred_none(f"more than one Login: {plural.group(0)}")
    phrases = list(LOGIN_PHRASE_RE.finditer(text))
    ends = {m.end("login") for m in phrases}
    if any(m.end() not in ends for m in words):
        return _cred_none("a Login it cannot name")
    if not phrases:
        return _cred_none("it names no Login")
    named = []
    for m in phrases:
        if m.group("name").lower() not in [n.lower() for n in named]:
            named.append(m.group("name"))
    if not logins:
        return _cred_none(NO_LOGINS_WHY)
    declared = {n.lower(): n for n in logins}
    names = []
    for n in named:
        if n.lower() not in declared:
            return _cred_none(f"{n} is not a declared test Login")
        names.append(declared[n.lower()])
    return {"names": names, "why": ""}


def login_annotation(date, names, source):
    """The standing approval's `## Approved gates` suffix for a declared test Login (module docstring, 5): `(approved
    <date> under the standing approval: test Login <n1, n2>, from <source>)`. Raises ValueError on a `)` in any part,
    as annotation() does."""
    text = f"(approved {date} under the standing approval: test Login {', '.join(names)}, from {source})"
    if text.count(")") != 1:
        raise ValueError(f"an annotation part holds a ')': {date!r}, {names!r}, {source!r}")
    return text


# ---- CLI --------------------------------------------------------------------------------------------------------

USAGE = ("usage: gated_inputs.py sweep <note>...\n"
         "       gated_inputs.py exposure - <<'EOF'   (one gate on stdin, then EOF on its own line)\n")


def _exposure_cli():
    """`exposure -` (module docstring, 2: CLI): one gate on stdin, one JSON line on stdout."""
    try:
        text = sys.stdin.buffer.read().decode("utf-8")
    except UnicodeDecodeError as e:
        sys.stderr.write(f"gated_inputs: exposure: stdin is not UTF-8: {e}\n")
        return 1
    lines = [l[:-1] if l.endswith("\r") else l for l in text.split("\n")]
    gates = [l for l in lines if l.strip()]
    if not gates:
        sys.stderr.write("gated_inputs: exposure: no gate on stdin\n" + USAGE)
        return 2
    if len(gates) > 1:
        out = {"usd": None, "why": f"stdin holds {len(gates)} lines: pass one gate"}
    else:
        # The standing reading's {usd, why}, never capOnly: a gate whose cap reads prints its amount, so the plan judge
        # never bounces it on wording alone (p37-4).
        r = standing_exposure(gates[0])
        out = {"usd": None if r["usd"] is None else format_usd(r["usd"]), "why": r["why"]}
    sys.stdout.buffer.write((json.dumps(out, ensure_ascii=False) + "\n").encode("utf-8"))
    sys.stdout.buffer.flush()
    return 0


def _declared_logins():
    """(logins, None) or (None, why): the machine's declared test Logins, rollouts.toml's `[defaults] test_logins`
    through rollout-settings.py's resolve(repo=None), loaded from beside this file as reconcile-rollout.py's
    _settings_module loads it, the why in _machine_settings' words. The sweep CLI's alone (module docstring, 1): it
    turns bytecode writing off for the process first, so the loads leave no __pycache__ beside the scripts, and with
    no repo resolve() runs no git and no subprocess."""
    sys.dont_write_bytecode = True
    try:
        spec = importlib.util.spec_from_file_location(
            "thread_rollout_settings", os.path.join(os.path.dirname(os.path.abspath(__file__)), "rollout-settings.py"))
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
    except Exception as e:
        return None, f"rollout-settings.py would not load: {e}"
    try:
        return list(mod.resolve(repo=None)["test_logins"]["value"]), None
    except mod.SettingsError as e:
        return None, str(e)
    except Exception as e:
        return None, f"rollout-settings.py failed: {e}"


def _sweep_cli(paths):
    """`sweep <note>...` (module docstring, 1: CLI): one JSON line per readable note; the declared test Logins are read
    only when a note's Login reading reaches step 7, once per process."""
    code, declared, told = 0, None, False
    for path in paths:
        try:
            with open(os.path.expanduser(path), encoding="utf-8") as f:
                text = f.read()
        except (OSError, UnicodeDecodeError) as e:
            sys.stderr.write(f"gated_inputs: {path}: {e}\n")
            code = 1
            continue
        body = body_of(text)
        out = sweep(body, [])   # steps 1-6 never read `logins`, so a reading that stops there is already final
        if any(h.get("login", {}).get("why") == NO_LOGINS_WHY for h in out["credential"]):
            if declared is None:
                declared = _declared_logins()
            logins, why = declared
            if logins is None:   # unread: today's shape, no `login` key, so every hit keeps the ask
                out = sweep(body)
                if not told:
                    sys.stderr.write(f"gated_inputs: test_logins: {why}\n")
                    told = True
                code = 1
            elif logins:
                out = sweep(body, logins)
        slug = os.path.splitext(os.path.basename(path))[0]
        sys.stdout.write(json.dumps({"slug": slug, **out}, ensure_ascii=False) + "\n")
    return code


def main(argv):
    if argv[:1] == ["exposure"]:
        if argv != ["exposure", "-"]:
            sys.stderr.write(USAGE)
            return 2
        return _exposure_cli()
    if len(argv) < 2 or argv[0] != "sweep":
        sys.stderr.write(USAGE)
        return 2
    return _sweep_cli(argv[1:])


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
