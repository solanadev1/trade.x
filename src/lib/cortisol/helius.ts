import { getConfig, setConfig } from '../db/cortisolDb';
export type RpcLane = 'hot' | 'bulk';
// Token bucket with two lanes. Hot lane (execution, exits, live curve reads) always drains first and
// owns a reserve of tokens that bulk work (history crawls, forensics, grading) may never spend.
export class TokenBucket {
  private tokens: number;
  private last = Date.now();
  private hot: (() => void)[] = [];
  private bulk: (() => void)[] = [];
  private timer?: ReturnType<typeof setTimeout>;
  constructor(private ratePerSec = 8, private burst = 4, private hotReserve = 2) { this.tokens = burst; }
  acquire(lane: RpcLane = 'bulk') {
    return new Promise<void>(resolve => { (lane === 'hot' ? this.hot : this.bulk).push(resolve); this.drain(); });
  }
  queued() { return { hot: this.hot.length, bulk: this.bulk.length }; }
  private drain() {
    const now = Date.now();
    this.tokens = Math.min(this.burst, this.tokens + Math.max(0, now - this.last) / 1000 * this.ratePerSec);
    this.last = now;
    for (;;) {
      if (this.hot.length && this.tokens >= 1) { this.tokens--; this.hot.shift()!(); continue; }
      if (!this.hot.length && this.bulk.length && this.tokens >= 1 + this.hotReserve) { this.tokens--; this.bulk.shift()!(); continue; }
      break;
    }
    clearTimeout(this.timer); this.timer = undefined;
    if (!this.hot.length && !this.bulk.length) return;
    const need = (this.hot.length ? 1 : 1 + this.hotReserve) - this.tokens;
    this.timer = setTimeout(() => this.drain(), Math.max(1, Math.ceil(need / this.ratePerSec * 1000)));
  }
}
export const limiter = new TokenBucket();

// Helius credit meter. Bulk work stops at the daily budget; the hot lane is never blocked by it.
const CREDIT_COST: Record<string, number> = { getAsset: 10, getTokenAccounts: 10, getProgramAccounts: 10, enhanced: 100 };
const credits = { day: '', used: 0, flushed: 0 };
const creditDay = () => new Date().toISOString().slice(0, 10);
function creditBudget() { const n = Number(getConfig('helius_daily_credit_budget')); return Number.isFinite(n) && n > 0 ? n : 33000; }
function loadCredits() {
  const day = creditDay(); if (credits.day === day) return;
  credits.day = day; credits.used = 0;
  try { const saved = getConfig('helius_credit_meter'); if (saved.startsWith(day + ':')) credits.used = Number(saved.slice(day.length + 1)) || 0; } catch { /* meter restarts at zero */ }
}
function spendCredits(cost: number, lane: RpcLane) {
  loadCredits();
  if (lane === 'bulk' && credits.used + cost > creditBudget()) throw new Error('Helius daily credit budget reached; bulk crawl paused until UTC midnight');
  credits.used += cost;
  if (Date.now() - credits.flushed > 5000) { credits.flushed = Date.now(); try { setConfig('helius_credit_meter', `${credits.day}:${credits.used}`); } catch { /* best effort */ } }
}
export function creditStatus() { loadCredits(); return { day: credits.day, used: credits.used, budget: creditBudget(), queue: limiter.queued() }; }

export function rpcUrl() {
  const url = new URL(getConfig('helius_rpc_url') || process.env.HELIUS_RPC_URL || '');
  if (url.protocol !== 'https:' || !(url.hostname === 'helius-rpc.com' || url.hostname.endsWith('.helius-rpc.com')) || !url.searchParams.get('api-key')) throw new Error('Use an HTTPS Helius RPC URL with an api-key parameter');
  return url;
}
export async function heliusFetch(url: string, init?: RequestInit, lane: RpcLane = 'bulk', cost = 1) {
  for (let attempt = 0; attempt < 3; attempt++) {
    spendCredits(cost, lane);
    await limiter.acquire(lane);
    const r = await fetch(url, { ...init, signal: AbortSignal.timeout(lane === 'hot' ? 4000 : 15000) });
    if (r.status === 429 || r.status >= 500) { await new Promise(resolve => setTimeout(resolve, (lane === 'hot' ? 150 : 1000) * 2 ** attempt)); continue; }
    if (!r.ok) throw new Error(`Helius HTTP ${r.status}`);
    return r.json();
  }
  throw new Error('Helius rate limit or service unavailable');
}
export async function rpc<T>(method: string, params: unknown[], lane: RpcLane = 'bulk'): Promise<T> {
  const data = await heliusFetch(rpcUrl().toString(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }, lane, CREDIT_COST[method] ?? 1);
  if (data.error) throw new Error(`RPC ${data.error.code}: ${data.error.message}`);
  return data.result as T;
}
export async function enhancedHistory(address: string, before?: string): Promise<EnhancedTx[]> {
  const key = rpcUrl().searchParams.get('api-key');
  const url = new URL(`https://api-mainnet.helius-rpc.com/v0/addresses/${address}/transactions`);
  url.searchParams.set('api-key', key!); url.searchParams.set('limit', '100'); if (before) url.searchParams.set('before', before);
  return heliusFetch(url.toString(), undefined, 'bulk', CREDIT_COST.enhanced);
}
export type EnhancedTx = { signature: string; timestamp: number; transactionError: unknown; source: string; tokenTransfers?:{mint:string;fromUserAccount:string;toUserAccount:string;tokenAmount:number}[]; feePayer: string; nativeTransfers: { fromUserAccount: string; toUserAccount: string; amount: number }[]; events?: { swap?: { nativeInput?: { account: string; amount: string }; nativeOutput?: { account: string; amount: string }; tokenInputs: TokenFlow[]; tokenOutputs: TokenFlow[] } } };
type TokenFlow = { mint: string; userAccount: string; rawTokenAmount: { tokenAmount: string; decimals: number } };
export type Trade = { emotionRealTokenRaw?:string; observedAt?:number; slot?:number; virtualSolRaw?:string; virtualTokenRaw?:string; realSolRaw?:string; signature: string; mint: string; wallet: string; buy: boolean; sol: number; tokens: number; price: number; timestamp: number };
export function enhancedTrades(tx: EnhancedTx, mint: string): Trade[] {
  if (tx.transactionError || tx.source !== 'PUMP_FUN') return [];
  const swap = tx.events?.swap; if (!swap) return [];
  const buy = !!swap.nativeInput;
  const native = buy ? swap.nativeInput : swap.nativeOutput;
  const flows = buy ? swap.tokenOutputs : swap.tokenInputs;
  const flow = flows?.find(f => f.mint === mint && f.userAccount === native?.account);
  if (!native || !flow) return [];
  const sol = Number(native.amount) / 1e9;
  const tokens = Number(flow.rawTokenAmount.tokenAmount) / 10 ** flow.rawTokenAmount.decimals;
  if (!(sol > 0 && tokens > 0)) return [];
  return [{ signature: tx.signature, mint, wallet: flow.userAccount, buy, sol, tokens, price: sol / tokens, timestamp: tx.timestamp * 1000 }];
}

export async function allEnhancedHistory(address: string): Promise<EnhancedTx[]> {
  const result: EnhancedTx[] = []; const seen = new Set<string>(); let before: string | undefined;
  while (true) {
    const batch = await enhancedHistory(address, before);
    if (!batch.length) return result;
    for (const tx of batch) if (!seen.has(tx.signature)) { seen.add(tx.signature); result.push(tx); }
    const next = batch.at(-1)!.signature;
    if (next === before) throw new Error('Helius history pagination did not advance');
    before = next;
  }
}
