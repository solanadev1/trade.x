import { db } from '../db/cortisolDb';
db.exec(`
CREATE TABLE IF NOT EXISTS system_metrics(key TEXT PRIMARY KEY,value REAL NOT NULL);
CREATE TABLE IF NOT EXISTS ai_requests(id TEXT PRIMARY KEY,reserved_usd REAL NOT NULL,cost_usd REAL,prompt_tokens INTEGER,completion_tokens INTEGER,status TEXT NOT NULL,created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS mint_blacklist(mint TEXT PRIMARY KEY,reason TEXT NOT NULL,created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS radar(id INTEGER PRIMARY KEY AUTOINCREMENT,mint TEXT,stage TEXT NOT NULL,message TEXT NOT NULL,created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS social_snippets(mint TEXT NOT NULL,source TEXT NOT NULL,body TEXT NOT NULL,observed_at INTEGER NOT NULL,PRIMARY KEY(mint,source,body));
CREATE TABLE IF NOT EXISTS active_positions(position_id TEXT PRIMARY KEY,mint TEXT NOT NULL,is_dry_run INTEGER NOT NULL,entry_price_sol REAL NOT NULL,sol_invested REAL NOT NULL,token_amount_raw TEXT NOT NULL,remaining_pct REAL NOT NULL,highest_price_sol REAL NOT NULL,stop_loss_price_sol REAL NOT NULL,tp1_hit INTEGER NOT NULL,cortisol_score REAL NOT NULL,opened_at INTEGER NOT NULL,status TEXT NOT NULL,current_price_sol REAL,net_pnl_pct REAL,remaining_tokens_raw TEXT NOT NULL,realized_sol REAL NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS execution_orders(order_id TEXT PRIMARY KEY,position_id TEXT NOT NULL,side TEXT NOT NULL,raw_transaction TEXT,signature TEXT,block_height INTEGER,status TEXT NOT NULL,created_at INTEGER NOT NULL,error TEXT);
CREATE TABLE IF NOT EXISTS portfolio_snapshots(timestamp INTEGER PRIMARY KEY,equity_sol REAL NOT NULL,is_dry_run INTEGER NOT NULL);
`);
export function metric(key:string,fallback=0){return (db.prepare('SELECT value FROM system_metrics WHERE key=?').get(key) as {value:number}|undefined)?.value??fallback;}
export function setMetric(key:string,value:number){db.prepare('INSERT OR REPLACE INTO system_metrics VALUES(?,?)').run(key,value);}
export function logRadar(mint:string,stage:string,message:string){db.prepare('INSERT INTO radar(mint,stage,message,created_at) VALUES(?,?,?,?)').run(mint,stage,message,Date.now());}
export {db};
