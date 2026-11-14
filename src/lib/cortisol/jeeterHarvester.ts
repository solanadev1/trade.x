import { account } from './chainMetadata';
import { historicalTrades, rankRunners } from './history';
import { PUMP_PROGRAM } from './pumpDecoder';
import { curveAddress, decodePumpCurve } from './pumpDecoder';
import { PublicKey } from '@solana/web3.js';
import { db } from '../db/cortisolDb';
import { allEnhancedHistory, enhancedHistory, enhancedTrades, type Trade } from './helius';
const save = db.prepare(`INSERT INTO jeeter_profiles VALUES (@wallet,@trades_sampled,@median_hold_sec,@panic_exit_count,@rebound_after_exit_count,@jeeter_score,@funding_parent,@last_seen)
ON CONFLICT(wallet) DO UPDATE SET trades_sampled=excluded.trades_sampled, median_hold_sec=excluded.median_hold_sec, panic_exit_count=excluded.panic_exit_count, rebound_after_exit_count=excluded.rebound_after_exit_count, jeeter_score=excluded.jeeter_score, funding_parent=excluded.funding_parent, last_seen=excluded.last_seen`);
const validWallet = (s: string) => new PublicKey(s).toBase58();
function csvRows(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], cell = '', quoted = false;
  for (let i=0;i<text.length;i++) { const c=text[i]; if (c==='"') { if (quoted && text[i+1]==='"') { cell+='"'; i++; } else quoted=!quoted; }
    else if (c===',' && !quoted) { row.push(cell.trim()); cell=''; } else if ((c==='\n'||c==='\r') && !quoted) { if (c==='\r' && text[i+1]==='\n') i++; row.push(cell.trim()); if (row.some(Boolean)) rows.push(row); row=[]; cell=''; } else cell+=c; }
  if (quoted) throw new Error('CSV contains an unclosed quote');
  row.push(cell.trim()); if (row.some(Boolean)) rows.push(row); return rows;
}
export async function ingestJeeterCsv(text: string) {
  const rows = csvRows(text.replace(/^\uFEFF/, '')); const header = rows.shift()?.map(key=>key==='emotion_index'?'jeeter_score':key);
  const required = ['wallet','trades_sampled','median_hold_sec','panic_exit_count','rebound_after_exit_count','jeeter_score','funding_parent','last_seen'];
  if (!header || required.some(k => !header.includes(k))) throw new Error(`CSV headers required: ${required.join(',')}`);
  if (rows.length > 10000) throw new Error('Maximum 10,000 rows per import');
  const entries = rows.map((row, i) => {
    const values = Object.fromEntries(header.map((k, j) => [k, row[j] ?? '']));
    const n = (k: string) => { if (!values[k]) throw new Error(`Missing ${k} in row ${i+2}`); const v=Number(values[k]); if (!Number.isFinite(v)||v<0) throw new Error(`Invalid ${k} in row ${i+2}`); return v; };
    const score = n('jeeter_score'), samples=n('trades_sampled'), panic=n('panic_exit_count'), rebounds=n('rebound_after_exit_count'), last=n('last_seen');
    if (score>100 || ![samples,panic,rebounds,last].every(Number.isInteger) || panic>samples || rebounds>panic || !samples || last>Date.now()/1000+60) throw new Error(`Invalid counts, timestamp or score in row ${i+2}`);
    return { wallet: validWallet(values.wallet), trades_sampled:samples, median_hold_sec:n('median_hold_sec'), panic_exit_count:panic, rebound_after_exit_count:rebounds, jeeter_score:score, funding_parent: values.funding_parent ? validWallet(values.funding_parent) : null, last_seen:last };
  });
  const wallets=[...new Set(entries.map(e=>e.wallet))];
  const mints=new Set<string>();
  for(const wallet of wallets){const history=await historicalTrades(wallet);for(const t of history)mints.add(t.mint);}
  // Imported claims never become trusted scores: rebuild them from chain evidence.
  db.transaction(()=>{for(const wallet of wallets)db.prepare('DELETE FROM jeeter_profiles WHERE wallet=?').run(wallet);})();
  for(const mint of mints)await harvestMintJeeters(mint);
  const indexed=wallets.filter(w=>db.prepare('SELECT wallet FROM jeeter_profiles WHERE wallet=?').get(w)).length;
  return {indexed,excluded:wallets.length-indexed,note:'CSV wallets verified against available on-chain purchases, exits, rebounds and funding history. Supplied scores were not trusted.'};
}

export async function harvestMintJeeters(address: string) {
  const mint = validWallet(address); const trades: Trade[]=[];
  trades.push(...await historicalTrades(curveAddress(mint).toBase58()));
  trades.sort((a,b)=>a.timestamp-b.timestamp);
  const candidates = new Map<string, { holds: number[]; panic: number; rebound: number; samples:number }>();
  const holdings = new Map<string, { tokens:number; cost:number; time:number }>();
  for(let i=0;i<trades.length;i++) {
    const t=trades[i]; const h=holdings.get(t.wallet);
    if(t.buy) { holdings.set(t.wallet,{tokens:(h?.tokens??0)+t.tokens,cost:(h?.cost??0)+t.sol,time:h?.time??t.timestamp}); continue; }
    if(!h || h.tokens<t.tokens*0.999) { holdings.delete(t.wallet); continue; }
    const hold=(t.timestamp-h.time)/1000, cost=h.cost/h.tokens*t.tokens;
    const recent=trades.slice(0,i+1).filter(v=>v.timestamp>=t.timestamp-60000);
    const peak=Math.max(...recent.map(v=>v.price)); const drop=(1-t.price/peak)*100;
    const future=trades.slice(i+1).filter(v=>v.timestamp<=t.timestamp+900000);
    const bottom=Math.min(t.price,...future.filter(v=>v.timestamp<=t.timestamp+30000).map(v=>v.price));
    const rebound=future.some(v=>v.price>=t.price*1.5);
    const p=candidates.get(t.wallet)??{holds:[],panic:0,rebound:0,samples:0}; p.samples++;
    if(hold<900 && hold>=0 && t.sol<cost && drop>=25 && drop<=45 && t.price<=bottom*1.05) {p.holds.push(hold); p.panic++; if(rebound)p.rebound++;}
    candidates.set(t.wallet,p); const remaining=h.tokens-t.tokens; if(remaining<0.000001) holdings.delete(t.wallet); else holdings.set(t.wallet,{...h,tokens:remaining,cost:h.cost-cost});
  }
  const eligible=[...candidates].filter(([,p])=>p.rebound>0).sort((a,b)=>b[1].rebound-a[1].rebound);
  const funded: { wallet:string; parent:string; p:typeof eligible[number][1] }[]=[];
  for(const [wallet,p] of eligible) {
    const oldest = await allEnhancedHistory(wallet);
    const incoming=oldest.sort((a,b)=>a.timestamp-b.timestamp).flatMap(tx=>(tx.transactionError?[]:tx.nativeTransfers??[]).filter(n=>n.toUserAccount===wallet && n.fromUserAccount!==wallet));
    if(incoming.length) funded.push({wallet,parent:incoming[0].fromUserAccount,p});
  }
  const curve=await account(curveAddress(mint).toBase58());const creator=decodePumpCurve(Buffer.from(curve.data[0],'base64')).creator.toBase58();
  const safe=funded.filter(e=>funded.filter(f=>f.parent===e.parent).length===1 && e.parent!==creator && e.wallet!==creator && !db.prepare('SELECT wallet FROM jeeter_profiles WHERE funding_parent=? AND wallet<>?').get(e.parent,e.wallet));
  db.transaction(()=>{for(const {wallet,parent,p} of safe){const h=p.holds.sort((a,b)=>a-b); const mid=Math.floor(h.length/2); const median=h.length%2?h[mid]:(h[mid-1]+h[mid])/2;
    save.run({wallet,trades_sampled:p.samples,median_hold_sec:median,panic_exit_count:p.panic,rebound_after_exit_count:p.rebound,jeeter_score:Math.min(100,100*(p.rebound/p.samples)*Math.min(1,p.samples/5)),funding_parent:parent,last_seen:Math.floor(Date.now()/1000)});}})();
  return { indexed:safe.length, trades:trades.length, candidates:eligible.length, note:'Full available confirmed transaction logs paginated through Helius. Missing funding history is excluded; shared funders are a heuristic, not proof of independence.' };
}

export async function autoSeedRecentRunners(){
 const until=Date.now(),since=until-15*60*1000;
 const runners=rankRunners(await historicalTrades(PUMP_PROGRAM.toBase58(),since,until));
 let indexed=0;const failures:{mint:string;error:string}[]=[];
 for(const runner of runners){try{indexed+=(await harvestMintJeeters(runner.mint)).indexed;}catch(e){failures.push({mint:runner.mint,error:e instanceof Error?e.message:String(e)});}}
 return {indexed,runners,failures,note:`Ranked ${runners.length} recent Pump bonding-curve runners by confirmed 15-minute SOL volume through Helius. ${failures.length} harvests failed.`};
}
