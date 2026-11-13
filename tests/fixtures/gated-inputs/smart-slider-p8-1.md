<!-- Provenance (p51-3): copied byte for byte from the vault note Work/Tasks/smart-slider-p8-1-credit-packs-on-the-slider.md at vault commit b72670f7, its first commit: its prompt block, its Stripe test-mode default and its **Verify:** line, as /thread:schedule swept them for smart-slider-rollout-2026-10-28 (the engine-written `## Gated inputs (awaiting sign-off)` below them left out). Its credential gates (Stripe test-mode keys, the staging Supabase service-role key) were signed mid-run (Watch 4fe713ab). Never edit these lines. -->

```
Read ADR-0012/0013 and strategy/CONTEXT.md in ~/repos/workspaces/animately-workspace. In ~/repos/animately/optimizer, audit the existing credit + Stripe flow (checkout, webhooks, public.payments, credit balance) and decide reuse vs rebuild. Build: a sign-in-at-paywall step inside the Smart Slider embed, a credit balance, a 'spend N credits' hook any paid feature can call, and pack price/size read from config (feature-flag ready). Free slider path untouched. Stripe test mode end to end.
```

- Stripe **test mode only**; no live keys, no production promotion in this rollout.

**Verify:** a test-mode purchase from the embed lands a paid row in public.payments and credits on the account; a stubbed paid feature spends them; the free path still works signed out.
