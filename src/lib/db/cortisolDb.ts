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
