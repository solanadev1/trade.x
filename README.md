# Cortisol.x — Phase 1

Electron + Next.js local Solana shadow research terminal. Paper mode is the default; explicitly enabled Phase 3 live mode signs and submits burner-wallet transactions.

## Local browser mode on Windows

Double-click **Launch_Cortisol_Browser.bat**. It uses Node.js >=22 (including the portable Node installed by the original setup), installs missing dependencies with Electron binary download disabled, builds the app, starts a server bound only to `127.0.0.1`, and opens your default browser. It never launches Electron or invokes PowerShell. If Node is missing, it opens the official Node.js download page.

Keep the launcher window open while using the app; closing it stops monitoring. Use Ctrl+C in that window to stop the server. Closing only the browser tab does not stop the engine. Existing settings and data in this same extracted folder are preserved. Windows Smart App Control remains enabled and may still block scripts or native dependencies; browser mode is not a security bypass.

## Windows desktop mode
Double-click `First_Time_Setup.bat`. It installs a checksum-verified portable Node.js 22 LTS when Node >=22 is unavailable, runs `npm install`, creates **Cortisol.x** on your actual Windows Desktop (including redirected/OneDrive Desktops), and immediately calls `Launch_Cortisol.bat`. Later launches use the shortcut. The shortcut points to this folder: keep it in place. Setup needs Internet access to nodejs.org, npm and GitHub; failures stop with a visible error.

The launcher builds the app and starts Electron with a loopback-only Next server. Electron owns its hidden Next.js child process and terminates it on close. No administrator installation of Node or manual PATH changes are needed. Native SQLite may require Windows build tools if a prebuilt binary is unavailable for an existing Node version.

Open Settings and paste a mainnet Helius HTTPS RPC URL (or set HELIUS_RPC_URL) including `?api-key=...`. Save & Connect starts Pump program log observation. Optionally set a dashboard passcode. Blank settings preserve saved values. OpenRouter and burner keys configure the Phase 2 AI gate and Phase 3 live execution.

Development: `npm ci`, `npm run app:start`. Checks: `npm run typecheck`, `npm test`, `npm run build`.

## Data and assumptions
SQLite uses WAL in `data/cortisol.sqlite`. Credentials are AES-GCM encrypted with a local `data/settings.key`; this protects against casual database inspection, not access to the entire user account. Back up both files together. Never commit data/. Dashboard passcodes use salted scrypt and an eight-hour session cookie.

Live data uses confirmed Pump TradeEvent logs. Token decimals are read from the mint account; age uses the oldest available successful bonding-curve signature. The initial real-token reserve is read from Pump Global. Recent observations and entry cooldowns survive restart in SQLite. Provider history retention still determines the accuracy of inferred creation time. Curves require >=20 SOL, <90% completion, a buy within 45 seconds, >=25 swaps and >=12 unique buyers in three minutes. A 25–45% dip with >=30% known seller volume (profile score >=50) can create a 0.1 SOL shadow entry after 600ms. Per-mint entries have a 15-minute cooldown.

Quotes use integer constant-product arithmetic with the specified 1.25% total bonding-curve fee on each leg and 10,000 lamports per-leg tip. They are exact for that model, not a guarantee of executable Pump fees: current creator/dynamic fees, network priority fees and execution ordering can differ. The decoder validates the discriminator and 81-byte base layout, including creator, and rejects identified non-SOL quote curves. Completed curves are quoted through the canonical PumpSwap token/WSOL pool using the official SDK, live reserves and its on-chain fee configuration. Both RPC paths share the HTTP limiter. Unavailable quotes are displayed as unresolved and retried. Grades use the first available sample after five and fifteen minutes; between-threshold results remain unresolved rather than being counted as losses. Pausing stops observation and grading. Startup and reconnection backfill confirmed Pump logs from the persisted checkpoint with a one-minute overlap and event-level deduplication. First startup backfills 15 minutes. Recovery blocks new entries until successful; failures pause the engine rather than silently skipping missing history.

The harvester paginates the full available bonding-curve signature history, fetching confirmed transaction logs and decoding Pump TradeEvents directly. This avoids dependence on Enhanced API swap-event coverage. It requires an observed purchase, a loss on the sale, <15-minute hold, 25–45% drawdown, near-bottom sale and >50% subsequent rebound. Funding checks paginate the full available wallet history; incomplete histories and shared funding parents in the batch are excluded. This is a heuristic and cannot certify absence of developer/Sybil control. CSV rows are wallet candidates only: imported scores are discarded, each wallet’s transaction logs identify traded mints, and scores are rebuilt using the same on-chain exit/rebound and funding checks. Creator wallets, creator-funded wallets and shared funders are excluded. CSV verification requires configured Helius access.

CSV header (last_seen is Unix seconds):
```
wallet,trades_sampled,median_hold_sec,panic_exit_count,rebound_after_exit_count,emotion_index,funding_parent,last_seen
```

The engine shares a serialized HTTP limiter below eight requests/second. Streaming program logs depend on the Helius plan and may be high volume. This implementation is a Phase 1 research baseline: live Helius access, migration behavior, long-running load, Windows startup, and current protocol fees must be validated before calling it production-ready. No profitability claim is made.

## Auto-seed recent runners
Click **[AUTO-SEED RECENT RUNNERS]** to scan confirmed Pump bonding-curve transactions over a fixed 15-minute window through Helius, sum SOL trade volume per mint, and harvest the top five. Ranking includes buys and sells on bonding curves; it is not a global ranking of migrated tokens across every exchange. Results report failed harvests. Exhaustive historical scans can take considerable time under the eight-request/second cap; the UI remains available while the request runs.

## Verification boundary
Unit tests use synthetic binary fixtures only inside tests. Application data comes from Helius RPC/WebSocket and the PumpSwap SDK through Helius. Live provider retention, network access and Windows execution cannot be guaranteed by code. Credentials must be supplied once in Settings; an installer cannot create a Helius account/key. Grades use nearby historical swap candles; empty windows fall back to an observed quote. The app includes opt-in live execution; neither paper outcomes nor backtests guarantee profit.

## Phase 2 / 3

Paper mode remains the default. The command bar now exposes live-mode confirmation, emergency flatten, AI budget and the 24h drawdown lock. The OCO manager runs independently of scanner pause; keep the app running for monitoring. Live mode uses the configured burner and requires typing `ENABLE LIVE JITO EXECUTION`. Mode changes are rejected while any position is active.

The calibrator uses chronological training/validation samples, includes unresolved outcomes conservatively, and requires at least 20 training and 10 validation matches with a positive EV and 2.2 profit/loss expectancy ratio. It cannot establish predictive certainty. Until sufficient data exists, shadow logging continues but new execution entries remain gated. Historical samples predating exhaustion measurements do not qualify for those thresholds.

Forensics fetches full available history, owner-aggregated holder balances, major-seller funding/transfers, creation-slot inventory, creator ownership and fresh-buyer exhaustion confirmation. Missing evidence rejects entry. Exhaustive scans may take substantially longer than a trading opportunity lasts. Fresh buyers require no earlier observed token trade; they are not asserted to be independently controlled people.

Configure an OpenRouter model ID and key in Settings. Add recent social evidence for a mint using the radar control. The AI gate requires score >=78 and forensic PASS, reserves a conservative maximum cost before calling, records returned provider cost/token usage, and retains reservations when billing is uncertain (including aborted calls). The $200 gate includes outstanding reservations. The 800ms deadline covers response-body parsing; sub-500ms responses depend on the provider and cannot be guaranteed. Untrusted comments are evidence, never execution instructions. A FUNDAMENTAL_RUG verdict persists a blacklist entry.

Paper execution uses conviction-adjusted fractional Kelly sizing against the virtual SOL balance (initially 10 SOL), waits 600ms, and applies curve impact, 125 bps fees and conviction-tier tips plus modeled priority/base fees. Live mode sizes against the burner SOL balance, uses official Pump/PumpSwap SDK builders with Token/Token-2022 ownership, enforceable 250bps bounds, compute-budget instructions, simulation and Jito tips. Graduated-coin routes can fall back to Jupiter swap instructions if a Jupiter API key is configured. Submission errors fall back to RPC with the same signed bytes. Durable order records reconcile confirmed token/SOL balance deltas after restart; an unknown submission is never blindly replaced with a new transaction.

OCO exits trigger at -15% net, sell 60% at +35%, then protect the remainder at entry +2% and a 12% trailing price stop (8% for MAX conviction). Portfolio equity snapshots include cash and marked remaining positions. A 5% 24h equity decline prevents entries for 12h. Emergency flatten persists a buy halt and retries open-position exits through the monitor; pending orders must reconcile before liquidation. It cannot guarantee immediate fills during network outages or absent liquidity.

Overdue shadow grades select the nearest confirmed Pump/PumpSwap swap within ±30 seconds of the 5m/15m deadline, using curve reserves for impact where the event supplies them. The first available quote is used only when the searched window has no swaps; history retrieval errors remain retryable. A swap candle is not an executable historical order-book snapshot.

Deterministic tests cover forensic boundaries, calibration, budget/timeout/JSON gates, fill math, OCO transitions, circuit locks, nearest-candle selection and SQL transaction rollback. No live-money test is run by `npm test`.


## Dedicated port and silent native launch

Cortisol uses **http://127.0.0.1:4317** in all launch modes. PumpStation can keep port 3000. The browser launcher checks 4317 and never kills another application. Native Electron owns a hidden Next.js process (`windowsHide: true`) and also refuses to attach to another process already using its port. Closing the app terminates its own server. After First_Time_Setup.bat installs and builds the app, the Desktop shortcut runs Launch_Silent.vbs, which launches Electron without CMD, PowerShell or a browser. The initial setup displays install/build progress. Smart App Control remains enabled; silent startup is not a signing or trust bypass. Launch_Cortisol_Browser.bat remains available.

## Conviction and fractional Kelly

The three-panel terminal displays the emotion scanner, conviction tape, and execution/risk controls. CSV exports use `emotion_index`; imports accept that alias and the original internal score column. Existing SQLite tables and names remain compatible.

Conviction combines exhaustion/qualified three-second absorption (35%), net inflow and curve progress (25%), verified ownership/funding concentration (20%), and the AI narrative/catalyst score (20%). A +15 boost applies to emotional shakeouts in the 75–92% zone. The existing <90% entry migration gate remains in force. Absorbers must have >5 SOL, be absent from prior observed recent trading and the creation-slot inventory, and absorb >=30% of the panic window. More than 40% shared-funder or clustered-receipt buyers rejects the signal. Solana's trade-event timestamps have second precision: the millisecond heuristic uses local WebSocket receipt times, not invented on-chain millisecond timestamps. Historical-only receipts are unknown and fail this gate until the live observation window warms up. Signals based on evidence taking more than ten seconds to collect fail closed.

Quarter Kelly is the default; Half Kelly is selectable. The conservative win-rate prior is 0.42 until 30 closed positions; observed net realized returns supply payoff ratios, with the 35/15 research prior used before sufficient outcomes exist. Conviction adjusts p before `f*=p-(1-p)/b`. Nonpositive edge or conviction below 55 rejects entry. Positive-edge tiers clamp fractional Kelly to 0.75–1.5%, 2–4%, or 5–8% of available bankroll. A 0.05 SOL minimum never overrides a tier ceiling or the absolute 8% cap; undersized bankrolls are rejected. The statistical calibrator, forensics, AI budget, max-three-position and drawdown gates still apply.

Jito tips are 0.0005 SOL for SCOUT, 0.0015 for CORE, and 0.003–0.005 for MAX. The blockhash warmer refreshes every 2 seconds with stale-cache rejection. ATA instructions are prepared for active candidate mints and invalidated on burner changes. Curve `accountSubscribe` updates complement program `logsSubscribe`; disconnected or stale account caches fall back to rate-limited HTTP. SDK state, simulation, cold cache misses and network delivery still require RPC time. No sub-150ms end-to-end latency, zero-RPC execution or guaranteed block inclusion is claimed.


## Windows installer and application icon

The **Build Windows Application** GitHub Actions workflow produces `Cortisol.x-Setup-0.1.0.exe`, available in the `Cortisol.x-Windows-Installer` artifact for that run. The installer bundles Electron, the standalone Next.js server and a matching Node.js runtime. It installs for the current Windows user, adds Desktop and Start menu entries, and launches the native application. No separate Node/npm setup is needed for the packaged installer. Builds are unsigned unless a signing certificate is supplied separately.

Packaged settings and SQLite data live in Electron's per-user application data directory, outside the installation folder, and survive uninstall/reinstall. Source-folder launches continue using their existing `data` directory. To move an existing source-folder database into the installed app, close both applications and copy the entire `data` directory contents (including `settings.key`) into the packaged app's user-data directory; never copy a database while the engine is running.

The generated Cortisol.x mark is included in the application window, browser titlebar/favicon, Windows installer, and shortcuts. Source installs can refresh their shortcuts and icon by rerunning First_Time_Setup.bat. Developers on Windows x64 can build the installer with `npm ci` followed by `npm run dist:win`.
