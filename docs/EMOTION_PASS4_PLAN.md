# Emotion Pass 4 execution plan

## Emotion baseline

Pass 3 and its execution follow-up add stream-triggered exits, a RAM-only sell ladder before submission, separate per-position sell locks, cost-aware sizing, and confirmed cash-flow attribution. A slower reconciliation/RPC recovery loop remains necessary when stream messages or confirmations are missing. No live-funded execution was used for verification.

## Emotion implementation order

1. **Emotion secret and signer boundary.** Replace the adjacent plaintext encryption key with Windows OS-protected storage and an explicit unlocked session. Provide an atomic migration and recoverable backup procedure. Keep vault keys outside the application. Limit the burner bankroll; reject unknown programs, destinations, approvals, authority changes and unsolicited transfers before signing. Enforce the same checks on refreshed RAM transactions.
2. **Emotion authentication and circuit breakers.** Require a fresh local passcode plus separate-device TOTP for withdrawal/export/destination changes and sensitive security changes. Add enrollment verification, replay protection, throttling and session expiry. Do not provide autonomous sweeping. Persist a signing latch for unauthorized instructions or the daily drawdown cap. Starting the scanner must not reset it. Clear prepared transactions when locked. Define a separate, explicit emergency-exit policy so disabling signing does not silently leave exposure unmanaged.
3. **Emotion entry-path and regime separation.** Remove OpenRouter calls from individual entry decisions. Run the regime task every 15 minutes with a strict JSON schema, fixed spending cap and conservative stale-response behavior. Use only complete confirmed live cash-flow histories from `emotion_fill_attribution` for realized-performance scoring. Keep paper outcomes, shadow outcomes and unrealized mark-to-market separate. AI may select bounded settings; it cannot sign, move funds, override safety gates or promote unvalidated thresholds automatically.
4. **Emotion execution reliability.** Persist early-wallet identities and reconcile their balances after reconnects. Refresh RAM exit transactions before expiry, invalidate on every fill/balance/mode change, and validate exact sell amounts. Add explicit transaction rejection/expiry tests and prevent repeated failed-sell gas loops. Benchmark stream receipt, decision, submission and confirmation separately. Test a bounded emergency minimum-output policy using replay before relaxing slippage protection. Calibrate fees and rent per token program rather than relying on a single conservative allowance.
5. **Emotion evidence and screening.** Add the passive wallet ledger, measured local top-holder lookups, creation-slot evidence, size-distribution features and normalized launch-name tracking. Treat weak heuristics as scored evidence until holdout results justify a hard veto. Verify creation age rather than treating first observation as launch. Add the three-loss size reduction and restore it only after a confirmed net winner. Use observed auction percentiles with cost/EV caps; never promise universal priority.
6. **Emotion replay and external signals.** Write compressed, rotated event files with sequence, slot and receipt timing. Build deterministic replay of the same decision functions, including reconnect gaps, partial fills, fees, rejected bundles and blockhash expiry. Add an authenticated, replay-protected signal inbox for the screening service; external watch signals must pass local safety checks and cannot place orders directly.
7. **Emotion release gates.** Run TypeScript, all unit/integration tests, the production build, Windows secret-storage tests and replay benchmarks. Require explicit paper/live separation. Report measured net expectancy, uncertainty, drawdown, failure costs and latency percentiles. Commit each reviewable stage; do not claim verified edge from compilation or unit tests alone.

## Emotion edge priorities and unresolved tradeoffs

- Measure realized returns after all costs before increasing size. Current Kelly forecasts remain assumptions, not a calibrated guarantee.
- Fix latency tails and request-queue contention before optimizing average timing.
- Model missed fills and failed-transaction gas; profitable quoted trades can be losing executable trades.
- Calibrate tips against landed outcomes and actual auction prices, bounded by the trade's net EV.
- Prefer conservative cost estimates until sufficient live attribution exists. Historical net payoff ratios are not gross-return forecasts.
- Minimum-output protection and emergency fill probability compete. A signed quote can become unfillable during a crash; widening slippage can sharply reduce returns.
- Separate live, paper, shadow and incomplete legacy histories to prevent misleading win rates.
- Measure false positives from same-slot, uniform-size and duplicate-name heuristics before blocking trades.
- Prevent lookahead, correlated-wallet double counting and repeated adaptive tuning on the same observations.
- Test correlated exposure, liquidity capacity and the three-loss rule against a fixed-size baseline.
- Keep AI off the order path; allow only bounded, independently validated regime changes.
- Harden the signer and credentials before expanding autonomous capabilities.

The live screening service protocol, Windows credential API behavior and two-factor enrollment require their own integration verification. They are not certified by the Linux build.
