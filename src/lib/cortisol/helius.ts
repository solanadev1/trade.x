import { getConfig } from '../db/cortisolDb';
export class TokenBucket {
  private next = 0;
  private chain: Promise<unknown> = Promise.resolve();
  acquire() {
    const task = this.chain.then(async () => { const wait = Math.max(0, this.next - Date.now()); if (wait) await new Promise(r => setTimeout(r, wait)); this.next = Date.now() + 126; });
    this.chain = task.catch(() => {}); return task;
  }
}
export const limiter = new TokenBucket();
export function rpcUrl() {
  const url = new URL(getConfig('helius_rpc_url') || process.env.HELIUS_RPC_URL || '');
  if (url.protocol !== 'https:' || !(url.hostname === 'helius-rpc.com' || url.hostname.endsWith('.helius-rpc.com')) || !url.searchParams.get('api-key')) throw new Error('Use an HTTPS Helius RPC URL with an api-key parameter');
  return url;
}
export async function heliusFetch(url: string, init?: RequestInit) {
  for (let attempt = 0; attempt < 3; attempt++) {
    await limiter.acquire();
    const r = await fetch(url, { ...init, signal: AbortSignal.timeout(15000) });
    if (r.status === 429 || r.status >= 500) { await new Promise(resolve => setTimeout(resolve, 1000 * 2 ** attempt)); continue; }
    if (!r.ok) throw new Error(`Helius HTTP ${r.status}`);
    return r.json();
  }
  throw new Error('Helius rate limit or service unavailable');
}
export async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const data = await heliusFetch(rpcUrl().toString(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  if (data.error) throw new Error(`RPC ${data.error.code}: ${data.error.message}`);
  return data.result as T;
}
export async function enhancedHistory(address: string, before?: string): Promise<EnhancedTx[]> {
  const key = rpcUrl().searchParams.get('api-key');
  const url = new URL(`https://api-mainnet.helius-rpc.com/v0/addresses/${address}/transactions`);
  url.searchParams.set('api-key', key!); url.searchParams.set('limit', '100'); if (before) url.searchParams.set('before', before);
  return heliusFetch(url.toString());
}
export type EnhancedTx = { signature: string; timestamp: number; transactionError: unknown; source: string; tokenTransfers?:{mint:string;fromUserAccount:string;toUserAccount:string;tokenAmount:number}[]; feePayer: string; nativeTransfers: { fromUserAccount: string; toUserAccount: string; amount: number }[]; events?: { swap?: { nativeInput?: { account: string; amount: string }; nativeOutput?: { account: string; amount: string }; tokenInputs: TokenFlow[]; tokenOutputs: TokenFlow[] } } };
type TokenFlow = { mint: string; userAccount: string; rawTokenAmount: { tokenAmount: string; decimals: number } };
export type Trade = { slot?:number; virtualSolRaw?:string; virtualTokenRaw?:string; realSolRaw?:string; signature: string; mint: string; wallet: string; buy: boolean; sol: number; tokens: number; price: number; timestamp: number };
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
