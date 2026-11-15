import Database from 'better-sqlite3';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

const dir = process.env.CORTISOL_DATA_DIR || join(process.cwd(), 'data');
mkdirSync(dir, { recursive: true, mode: 0o700 });
const globals = globalThis as typeof globalThis & { cortisolDb?: Database.Database };
export const db = globals.cortisolDb ??= new Database(join(dir, 'cortisol.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');
db.exec(`
CREATE TABLE IF NOT EXISTS app_config (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS jeeter_profiles (
wallet TEXT PRIMARY KEY, trades_sampled INTEGER NOT NULL, median_hold_sec REAL NOT NULL,
panic_exit_count INTEGER NOT NULL, rebound_after_exit_count INTEGER NOT NULL, jeeter_score REAL NOT NULL CHECK(jeeter_score BETWEEN 0 AND 100), funding_parent TEXT, last_seen INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS dip_events (
event_id TEXT PRIMARY KEY, mint TEXT NOT NULL, timestamp INTEGER NOT NULL, drawdown_pct REAL NOT NULL,
drop_speed_sec INTEGER NOT NULL, trades_last_3m INTEGER NOT NULL, vol_sol_last_3m REAL NOT NULL,
known_jeeter_vol_pct REAL NOT NULL, price_at_bottom REAL NOT NULL,
price_5m_later REAL, price_15m_later REAL, outcome TEXT NOT NULL CHECK(outcome IN ('BOUNCE_WIN','BLEED_LOSS','PENDING')),
entry_price REAL NOT NULL, tokens_raw TEXT NOT NULL, entry_lamports TEXT NOT NULL,
pnl_pct REAL, last_price REAL, last_quote_at INTEGER, grade5_pnl REAL, grade15_pnl REAL, grading_error TEXT);
CREATE INDEX IF NOT EXISTS dip_time ON dip_events(timestamp);
CREATE TABLE IF NOT EXISTS watched_mints (mint TEXT PRIMARY KEY, added_at INTEGER NOT NULL);
`);
const keyPath = join(dir, 'settings.key');
if (!existsSync(keyPath)) writeFileSync(keyPath, randomBytes(32), { mode: 0o600, flag: 'wx' });
const encryptionKey = readFileSync(keyPath);
export function getConfig(key: string): string {
  const row = db.prepare('SELECT value FROM app_config WHERE key=?').get(key) as { value: string } | undefined;
  if (!row) return '';
  const [iv, tag, body] = row.value.split('.');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey, Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(tag, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(body, 'hex')), decipher.final()]).toString();
}
export function setConfig(key: string, value: string) {
  const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv);
  const body = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  db.prepare('INSERT OR REPLACE INTO app_config(key,value) VALUES (?,?)').run(key, `${iv.toString('hex')}.${cipher.getAuthTag().toString('hex')}.${body.toString('hex')}`);
}
export function publicConfig() {
  return { helius_configured: !!getConfig('helius_rpc_url'), openrouter_configured: !!getConfig('openrouter_api_key'), burner_configured: !!getConfig('burner_private_key'), passcode_configured: !!getConfig('dashboard_passcode'), dry_run_mode: getConfig('dry_run_mode')!=='false' };
}

export type EmotionTrade = {
  signature: string; wallet: string; mint: string; buy: boolean;
  sol: number; tokens: number; price: number; timestamp: number; observedAt?: number;
};
export type EmotionDna = {
  emotionWallet: string; emotionTrades: number; emotionExits: number;
  emotionHoldSum: number; emotionLossExits: number; emotionGreenBuys: number;
  emotionBuys: number; emotionEntrySol: number; emotionEntryTokens: number;
  emotionRealizedSol: number; emotionCapitulationSum: number;
  emotionHerdTriggers: number; emotionHerdOpportunities: number;
  emotionLastSeen: number;
};
export type EmotionPosition = {
  emotionWallet: string; emotionTokens: number; emotionCostSol: number;
  emotionOpenedAt: number; emotionEntryPrice: number;
};
export type EmotionProfile = EmotionDna & {
  emotionHoldSeconds: number; emotionLossRate: number; emotionAverageEntry: number;
  emotionCopyHerdScore: number; emotionCapitulation: number | null;
  emotionClass: 'Emotional Retail Gamblers' | 'Apex Sharks' | 'Emotion Unclassified';
};
db.exec(`
CREATE TABLE IF NOT EXISTS wallet_dna_windows (
 emotion_mint TEXT PRIMARY KEY, emotion_as_of INTEGER NOT NULL, emotion_profiles TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS wallet_dna (
 emotion_wallet TEXT PRIMARY KEY, emotion_hold_sec REAL NOT NULL,
 emotion_loss_rate REAL NOT NULL, emotion_average_entry REAL NOT NULL,
 emotion_realized_sol REAL NOT NULL, emotion_copy_herd_score REAL NOT NULL,
 emotion_class TEXT NOT NULL, emotion_samples INTEGER NOT NULL,
 emotion_profile TEXT NOT NULL, emotion_updated_at INTEGER NOT NULL
);
`);
const emotionGlobal = globalThis as typeof globalThis & {
  emotionDnaQueue?: Map<string, { emotionAsOf: number; emotionProfiles: EmotionDna[] }>;
  emotionDnaTimer?: ReturnType<typeof setInterval>;
  emotionDnaError?: string;
};
const emotionQueue = emotionGlobal.emotionDnaQueue ??= new Map();

export function emotionWindow(emotionInput: EmotionTrade[]) {
  const emotionSeen = new Map<string, EmotionTrade>();
  for (const emotionTrade of emotionInput) {
    if (![emotionTrade.sol, emotionTrade.tokens, emotionTrade.price, emotionTrade.timestamp].every(Number.isFinite) ||
        emotionTrade.sol <= 0 || emotionTrade.tokens <= 0 || emotionTrade.price <= 0) continue;
    emotionSeen.set(emotionTrade.signature, emotionTrade);
  }
  const emotionTrades = [...emotionSeen.values()].sort((emotionA, emotionB) =>
    emotionA.timestamp - emotionB.timestamp || emotionA.signature.localeCompare(emotionB.signature)).slice(-1000);
  if (new Set(emotionTrades.map(emotionTrade => emotionTrade.mint)).size > 1) throw new Error('Emotion window must contain one mint');
  const emotionProfiles = new Map<string, EmotionDna>();
  const emotionPositions = new Map<string, EmotionPosition>();
  let emotionPreviousPrice: number | undefined;
  for (let emotionIndex = 0; emotionIndex < emotionTrades.length; emotionIndex++) {
    const emotionTrade = emotionTrades[emotionIndex];
    const emotionProfile = emotionProfiles.get(emotionTrade.wallet) ?? {
      emotionWallet: emotionTrade.wallet, emotionTrades: 0, emotionExits: 0,
      emotionHoldSum: 0, emotionLossExits: 0, emotionGreenBuys: 0, emotionBuys: 0,
      emotionEntrySol: 0, emotionEntryTokens: 0, emotionRealizedSol: 0,
      emotionCapitulationSum: 0, emotionHerdTriggers: 0, emotionHerdOpportunities: 0, emotionLastSeen: 0,
    };
    emotionProfile.emotionTrades++;
    emotionProfile.emotionLastSeen = Math.max(emotionProfile.emotionLastSeen, emotionTrade.timestamp);
    const emotionPosition = emotionPositions.get(emotionTrade.wallet);
    if (emotionTrade.buy) {
      emotionProfile.emotionBuys++;
      if (emotionPreviousPrice !== undefined && emotionTrade.price > emotionPreviousPrice) emotionProfile.emotionGreenBuys++;
      emotionProfile.emotionEntrySol += emotionTrade.sol;
      emotionProfile.emotionEntryTokens += emotionTrade.tokens;
      const emotionTokens = (emotionPosition?.emotionTokens ?? 0) + emotionTrade.tokens;
      const emotionCostSol = (emotionPosition?.emotionCostSol ?? 0) + emotionTrade.sol;
      emotionPositions.set(emotionTrade.wallet, {
        emotionWallet: emotionTrade.wallet, emotionTokens, emotionCostSol,
        emotionOpenedAt: ((emotionPosition?.emotionOpenedAt ?? 0) * (emotionPosition?.emotionTokens ?? 0) +
          emotionTrade.timestamp * emotionTrade.tokens) / emotionTokens,
        emotionEntryPrice: emotionCostSol / emotionTokens,
      });
      if (emotionTrade.timestamp + 10000 <= (emotionTrades.at(-1)?.timestamp ?? 0)) {
        emotionProfile.emotionHerdOpportunities++;
        const emotionFollowers = new Set(emotionTrades.slice(emotionIndex + 1).filter(emotionNext =>
          emotionNext.buy && emotionNext.wallet !== emotionTrade.wallet &&
          emotionNext.timestamp >= emotionTrade.timestamp + 1000 &&
          emotionNext.timestamp <= emotionTrade.timestamp + 10000 && emotionNext.price >= emotionTrade.price
        ).map(emotionNext => emotionNext.wallet));
        if (emotionFollowers.size >= 3) emotionProfile.emotionHerdTriggers++;
      }
    } else if (emotionPosition && emotionPosition.emotionTokens + 1e-8 >= emotionTrade.tokens) {
      const emotionCost = emotionPosition.emotionEntryPrice * emotionTrade.tokens;
      const emotionPnl = emotionTrade.sol - emotionCost;
      const emotionDrawdown = 1 - emotionTrade.price / emotionPosition.emotionEntryPrice;
      emotionProfile.emotionExits++;
      emotionProfile.emotionHoldSum += Math.max(0, (emotionTrade.timestamp - emotionPosition.emotionOpenedAt) / 1000);
      emotionProfile.emotionRealizedSol += emotionPnl;
      if (emotionPnl < 0 && emotionDrawdown >= .25 && emotionDrawdown <= .40) {
        emotionProfile.emotionLossExits++;
        emotionProfile.emotionCapitulationSum += emotionDrawdown;
      }
      emotionPosition.emotionTokens = Math.max(0, emotionPosition.emotionTokens - emotionTrade.tokens);
      emotionPosition.emotionCostSol = emotionPosition.emotionTokens * emotionPosition.emotionEntryPrice;
      if (emotionPosition.emotionTokens <= 1e-8) emotionPositions.delete(emotionTrade.wallet);
    } else if (!emotionTrade.buy) {
      // Emotion inventory with an unobserved cost basis is excluded, never assigned a zero cost.
      emotionPositions.delete(emotionTrade.wallet);
    }
    emotionProfiles.set(emotionTrade.wallet, emotionProfile);
    emotionPreviousPrice = emotionTrade.price;
  }
  return { emotionTrades, emotionProfiles: [...emotionProfiles.values()], emotionPositions: [...emotionPositions.values()] };
}

function emotionRank(emotionProfiles: EmotionDna[]): EmotionProfile[] {
  const emotionEligible = emotionProfiles.filter(emotionProfile => emotionProfile.emotionExits >= 5)
    .sort((emotionA, emotionB) => emotionA.emotionRealizedSol - emotionB.emotionRealizedSol || emotionA.emotionWallet.localeCompare(emotionB.emotionWallet));
  const emotionBottom = new Set(emotionEligible.slice(0, Math.floor(emotionEligible.length * .2)).map(emotionProfile => emotionProfile.emotionWallet));
  const emotionTop = new Set(emotionEligible.length >= 100 ? emotionEligible.slice(-Math.floor(emotionEligible.length * .01)).map(emotionProfile => emotionProfile.emotionWallet) : []);
  return emotionProfiles.map(emotionProfile => ({ ...emotionProfile,
    emotionHoldSeconds: emotionProfile.emotionExits ? emotionProfile.emotionHoldSum / emotionProfile.emotionExits : 0,
    emotionLossRate: emotionProfile.emotionExits ? emotionProfile.emotionLossExits / emotionProfile.emotionExits : 0,
    emotionAverageEntry: emotionProfile.emotionEntryTokens ? emotionProfile.emotionEntrySol / emotionProfile.emotionEntryTokens : 0,
    emotionCopyHerdScore: emotionProfile.emotionHerdOpportunities ? 100 * emotionProfile.emotionHerdTriggers / emotionProfile.emotionHerdOpportunities : 0,
    emotionCapitulation: emotionProfile.emotionLossExits ? emotionProfile.emotionCapitulationSum / emotionProfile.emotionLossExits : null,
    emotionClass: emotionTop.has(emotionProfile.emotionWallet) && emotionProfile.emotionRealizedSol > 0 ? 'Apex Sharks' :
      emotionBottom.has(emotionProfile.emotionWallet) && emotionProfile.emotionRealizedSol < 0 && emotionProfile.emotionLossExits > 0 &&
      emotionProfile.emotionGreenBuys / Math.max(1, emotionProfile.emotionBuys) >= .5 ? 'Emotional Retail Gamblers' : 'Emotion Unclassified',
  }));
}

export function emotionDnaProfiles(): EmotionProfile[] {
  const emotionWindows = new Map<string, EmotionDna[]>();
  for (const emotionRow of db.prepare('SELECT emotion_mint, emotion_profiles FROM wallet_dna_windows').all() as { emotion_mint: string; emotion_profiles: string }[]) {
    emotionWindows.set(emotionRow.emotion_mint, JSON.parse(emotionRow.emotion_profiles));
  }
  for (const [emotionMint, emotionPending] of emotionQueue) emotionWindows.set(emotionMint, emotionPending.emotionProfiles);
  const emotionMerged = new Map<string, EmotionDna>();
  for (const emotionProfiles of emotionWindows.values()) for (const emotionProfile of emotionProfiles) {
    const emotionExisting = emotionMerged.get(emotionProfile.emotionWallet);
    if (!emotionExisting) { emotionMerged.set(emotionProfile.emotionWallet, { ...emotionProfile }); continue; }
    for (const emotionKey of Object.keys(emotionProfile) as (keyof EmotionDna)[]) {
      if (emotionKey === 'emotionWallet') continue;
      emotionExisting[emotionKey] = emotionKey === 'emotionLastSeen' ? Math.max(emotionExisting[emotionKey], emotionProfile[emotionKey]) : emotionExisting[emotionKey] + emotionProfile[emotionKey];
    }
  }
  return emotionRank([...emotionMerged.values()]);
}

export function queueEmotionWindow(emotionMint: string, emotionTrades: EmotionTrade[]) {
  const emotionResult = emotionWindow(emotionTrades);
  if (emotionResult.emotionTrades.some(emotionTrade => emotionTrade.mint !== emotionMint)) throw new Error('Emotion mint mismatch');
  const emotionAsOf = emotionResult.emotionTrades.at(-1)?.timestamp ?? 0;
  const emotionStored = db.prepare('SELECT emotion_as_of FROM wallet_dna_windows WHERE emotion_mint=?').get(emotionMint) as { emotion_as_of: number } | undefined;
  if (emotionAsOf >= Math.max(emotionStored?.emotion_as_of ?? 0, emotionQueue.get(emotionMint)?.emotionAsOf ?? 0)) {
    emotionQueue.set(emotionMint, { emotionAsOf, emotionProfiles: emotionResult.emotionProfiles });
  }
  return emotionResult;
}

export function flushEmotionDna() {
  if (!emotionQueue.size) return;
  db.transaction(() => {
    for (const [emotionMint, emotionPending] of emotionQueue) db.prepare('INSERT OR REPLACE INTO wallet_dna_windows VALUES(?,?,?)')
      .run(emotionMint, emotionPending.emotionAsOf, JSON.stringify(emotionPending.emotionProfiles));
    const emotionProfiles = emotionDnaProfiles();
    db.prepare('DELETE FROM wallet_dna').run();
    const emotionStatement = db.prepare('INSERT INTO wallet_dna VALUES(?,?,?,?,?,?,?,?,?,?)');
    for (const emotionProfile of emotionProfiles) emotionStatement.run(emotionProfile.emotionWallet,
      emotionProfile.emotionHoldSeconds, emotionProfile.emotionLossRate, emotionProfile.emotionAverageEntry,
      emotionProfile.emotionRealizedSol, emotionProfile.emotionCopyHerdScore, emotionProfile.emotionClass,
      emotionProfile.emotionTrades, JSON.stringify(emotionProfile), emotionProfile.emotionLastSeen);
  }).immediate();
  emotionQueue.clear();
  emotionGlobal.emotionDnaError = undefined;
}

export function emotionFlowRatio(emotionTrades: EmotionTrade[], emotionNow = Date.now()) {
  const emotionProfiles = new Map(emotionDnaProfiles().map(emotionProfile => [emotionProfile.emotionWallet, emotionProfile]));
  let emotionDumpSol = 0, emotionAbsorbSol = 0;
  for (const emotionTrade of emotionTrades) {
    if (emotionTrade.timestamp < emotionNow - 60000 || emotionTrade.timestamp > emotionNow) continue;
    const emotionClass = emotionProfiles.get(emotionTrade.wallet)?.emotionClass;
    if (!emotionTrade.buy && emotionClass === 'Emotional Retail Gamblers') emotionDumpSol += emotionTrade.sol;
    if (emotionTrade.buy && emotionClass === 'Apex Sharks') emotionAbsorbSol += emotionTrade.sol;
  }
  return { emotionDumpSol, emotionAbsorbSol, emotionDumpToAbsorption: emotionAbsorbSol > 0 ? emotionDumpSol / emotionAbsorbSol : null,
    emotionAsOf: emotionNow, emotionQueueError: emotionGlobal.emotionDnaError ?? null };
}
if (!emotionGlobal.emotionDnaTimer && process.env.NEXT_PHASE !== 'phase-production-build') {
  emotionGlobal.emotionDnaTimer = setInterval(() => {
    try { flushEmotionDna(); } catch (emotionError) { emotionGlobal.emotionDnaError = `Emotion DNA flush failed: ${String(emotionError)}`; }
  }, 2000);
  emotionGlobal.emotionDnaTimer.unref();
  process.once('exit', () => { try { flushEmotionDna(); } catch { /* Emotion pending data remains unflushed on abrupt shutdown. */ } });
}
