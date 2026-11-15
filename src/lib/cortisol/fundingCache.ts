import { db } from '../db/cortisolDb';
import { rpc } from './helius';

// A wallet's first funding source never changes, so it is resolved once and kept. Resolution walks the
// signature list (1 credit per 1,000 signatures) to the oldest transaction and reads one transaction,
// instead of paging the wallet's entire enhanced history (100 credits per page).
db.exec(`CREATE TABLE IF NOT EXISTS wallet_funding(
 wallet TEXT PRIMARY KEY, parent TEXT, funding_sol REAL, established INTEGER NOT NULL,
 signatures INTEGER NOT NULL, checked_at INTEGER NOT NULL)`);

export type Funding = { parent: string | null; fundingSol: number | null; established: boolean; signatures: number };
type Row = { parent: string | null; funding_sol: number | null; established: number; signatures: number; checked_at: number };
type ParsedTx = {
  meta: { err: unknown; preBalances: number[]; postBalances: number[] } | null;
  transaction: { message: { accountKeys: ({ pubkey: string } | string)[] } };
} | null;

export const FUNDING_MAX_PAGES = 3;
const pending = new Map<string, Promise<Funding>>();

export function fundingFromTransaction(wallet: string, tx: ParsedTx): { parent: string | null; fundingSol: number | null } {
  if (!tx?.meta || tx.meta.err) return { parent: null, fundingSol: null };
  const keys = tx.transaction.message.accountKeys.map(key => typeof key === 'string' ? key : key.pubkey);
  const index = keys.indexOf(wallet);
  if (index < 0) return { parent: null, fundingSol: null };
  const delta = tx.meta.postBalances[index] - tx.meta.preBalances[index];
  const payer = keys[0];
  if (!(delta > 0) || !payer || payer === wallet) return { parent: null, fundingSol: null };
  return { parent: payer, fundingSol: delta / 1e9 };
}

async function resolve(wallet: string): Promise<Funding> {
  let before: string | undefined, oldest: string | undefined, signatures = 0;
  for (let page = 0; page < FUNDING_MAX_PAGES; page++) {
    const rows = await rpc<{ signature: string; err: unknown }[]>('getSignaturesForAddress', [wallet, { limit: 1000, ...(before ? { before } : {}) }]);
    signatures += rows.length;
    const success = rows.filter(row => !row.err).at(-1);
    if (success) oldest = success.signature;
    if (rows.length < 1000) {
      if (!oldest) return { parent: null, fundingSol: null, established: false, signatures };
      const tx = await rpc<ParsedTx>('getTransaction', [oldest, { encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 0 }]);
      return { ...fundingFromTransaction(wallet, tx), established: false, signatures };
    }
    before = rows.at(-1)!.signature;
  }
  // Thousands of transactions: an established wallet, not a freshly funded sybil. Its origin is not chased.
  return { parent: null, fundingSol: null, established: true, signatures };
}

export function fundingParent(wallet: string): Promise<Funding> {
  const row = db.prepare('SELECT parent,funding_sol,established,signatures,checked_at FROM wallet_funding WHERE wallet=?').get(wallet) as Row | undefined;
  // A resolved parent or an established verdict is permanent. An unresolved young wallet is retried hourly.
  if (row && (row.parent || row.established || Date.now() - row.checked_at < 3600000)) {
    return Promise.resolve({ parent: row.parent, fundingSol: row.funding_sol, established: !!row.established, signatures: row.signatures });
  }
  let task = pending.get(wallet);
  if (!task) {
    task = resolve(wallet).then(result => {
      db.prepare('INSERT OR REPLACE INTO wallet_funding VALUES(?,?,?,?,?,?)').run(wallet, result.parent, result.fundingSol, +result.established, result.signatures, Date.now());
      return result;
    }).finally(() => pending.delete(wallet));
    pending.set(wallet, task);
  }
  return task;
}
