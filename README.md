# Cortisol.x — Phase 1

Electron + Next.js local Solana shadow research terminal. No signing or transaction submission is implemented.

## Windows
Double-click `First_Time_Setup.bat`. It installs a checksum-verified portable Node.js 22 LTS when Node >=22 is unavailable, runs `npm install`, creates **Cortisol.x** on your actual Windows Desktop (including redirected/OneDrive Desktops), and immediately calls `Launch_Cortisol.bat`. Later launches use the shortcut. The shortcut points to this folder: keep it in place. Setup needs Internet access to nodejs.org, npm and GitHub; failures stop with a visible error.

The launcher builds the app and starts Electron with a loopback-only Next server. Closing Electron terminates the server through concurrently. No administrator installation of Node or manual PATH changes are needed. Native SQLite may require Windows build tools if a prebuilt binary is unavailable for an existing Node version.

Open Settings and paste a mainnet Helius HTTPS RPC URL (or set HELIUS_RPC_URL) including `?api-key=...`. Save & Connect starts Pump program log observation. Optionally set a dashboard passcode. Blank settings preserve saved values. OpenRouter and burner keys are stored for future phases and are unused by this shadow engine.

Development: `npm ci`, `npm run app:start`. Checks: `npm run typecheck`, `npm test`, `npm run build`.

## Data and assumptions
SQLite uses WAL in `data/cortisol.sqlite`. Credentials are AES-GCM encrypted with a local `data/settings.key`; this protects against casual database inspection, not access to the entire user account. Back up both files together. Never commit data/. Dashboard passcodes use salted scrypt and an eight-hour session cookie.

Live data uses confirmed Pump TradeEvent logs. Token decimals are read from the mint account; age uses the oldest available successful bonding-curve signature. The initial real-token reserve is read from Pump Global. Recent observations and entry cooldowns survive restart in SQLite. Provider history retention still determines the accuracy of inferred creation time. Curves require >=20 SOL, <90% completion, a buy within 45 seconds, >=25 swaps and >=12 unique buyers in three minutes. A 25–45% dip with >=30% known seller volume (profile score >=50) can create a 0.1 SOL shadow entry after 600ms. Per-mint entries have a 15-minute cooldown.

Quotes use integer constant-product arithmetic with the specified 1.25% total bonding-curve fee on each leg and 10,000 lamports per-leg tip. They are exact for that model, not a guarantee of executable Pump fees: current creator/dynamic fees, network priority fees and execution ordering can differ. The decoder validates the discriminator and 81-byte base layout, including creator, and rejects identified non-SOL quote curves. Completed curves are quoted through the canonical PumpSwap token/WSOL pool using the official SDK, live reserves and its on-chain fee configuration. Both RPC paths share the HTTP limiter. Unavailable quotes are displayed as unresolved and retried. Grades use the first available sample after five and fifteen minutes; between-threshold results remain unresolved rather than being counted as losses. Pausing stops observation and grading. Startup and reconnection backfill confirmed Pump logs from the persisted checkpoint with a one-minute overlap and event-level deduplication. First startup backfills 15 minutes. Recovery blocks new entries until successful; failures pause the engine rather than silently skipping missing history.

The harvester paginates the full available bonding-curve signature history, fetching confirmed transaction logs and decoding Pump TradeEvents directly. This avoids dependence on Enhanced API swap-event coverage. It requires an observed purchase, a loss on the sale, <15-minute hold, 25–45% drawdown, near-bottom sale and >50% subsequent rebound. Funding checks paginate the full available wallet history; incomplete histories and shared funding parents in the batch are excluded. This is a heuristic and cannot certify absence of developer/Sybil control. CSV rows are wallet candidates only: imported scores are discarded, each wallet’s transaction logs identify traded mints, and scores are rebuilt using the same on-chain exit/rebound and funding checks. Creator wallets, creator-funded wallets and shared funders are excluded. CSV verification requires configured Helius access.

CSV header (last_seen is Unix seconds):
```
wallet,trades_sampled,median_hold_sec,panic_exit_count,rebound_after_exit_count,jeeter_score,funding_parent,last_seen
```

The engine shares a serialized HTTP limiter below eight requests/second. Streaming program logs depend on the Helius plan and may be high volume. This implementation is a Phase 1 research baseline: live Helius access, migration behavior, long-running load, Windows startup, and current protocol fees must be validated before calling it production-ready. No profitability claim is made.

## Auto-seed recent runners
Click **[AUTO-SEED RECENT RUNNERS]** to scan confirmed Pump bonding-curve transactions over a fixed 15-minute window through Helius, sum SOL trade volume per mint, and harvest the top five. Ranking includes buys and sells on bonding curves; it is not a global ranking of migrated tokens across every exchange. Results report failed harvests. Exhaustive historical scans can take considerable time under the eight-request/second cap; the UI remains available while the request runs.

## Verification boundary
Unit tests use synthetic binary fixtures only inside tests. Application data comes from Helius RPC/WebSocket and the PumpSwap SDK through Helius. Live provider retention, network access and Windows execution cannot be guaranteed by code. Credentials must be supplied once in Settings; an installer cannot create a Helius account/key. Grades record the first successfully obtained quote after each deadline, including after downtime, rather than inventing historical reserves. The app remains a shadow research tool, not a live-trading system or a guarantee of profit.
