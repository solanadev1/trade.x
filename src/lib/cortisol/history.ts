import { createHash } from 'crypto';
import { PublicKey } from '@solana/web3.js';
import { rpc, type Trade } from './helius';
import { PUMP_PROGRAM } from './pumpDecoder';
const discriminator = createHash('sha256').update('event:TradeEvent').digest().subarray(0,8);
export function decodeTradeLogs(logs: string[], signature: string): Trade[] {
 const result:Trade[]=[]; const stack:string[]=[];
 for(let index=0;index<logs.length;index++){
  const line=logs[index],invoke=line.match(/^Program (\w+) invoke/);
  if(invoke)stack.push(invoke[1]);
  if(/^Program \w+ (success|failed)/.test(line))stack.pop();
  if(stack.at(-1)!==PUMP_PROGRAM.toBase58()||!line.startsWith('Program data: '))continue;
  const b=Buffer.from(line.slice(14),'base64');if(b.length<97||!b.subarray(0,8).equals(discriminator)||b[56]>1)continue;
  const sol=Number(b.readBigUInt64LE(40))/1e9,tokens=Number(b.readBigUInt64LE(48))/1e6;
  if(!tokens||!sol)continue;
  result.push({...(b.length>=129?{virtualSolRaw:b.readBigUInt64LE(97).toString(),virtualTokenRaw:b.readBigUInt64LE(105).toString(),realSolRaw:b.readBigUInt64LE(113).toString()}:{}),signature:`${signature}:${index}`,mint:new PublicKey(b.subarray(8,40)).toBase58(),wallet:new PublicKey(b.subarray(57,89)).toBase58(),buy:b[56]===1,sol,tokens,price:sol/tokens,timestamp:Number(b.readBigInt64LE(89))*1000});
 }return result;
}
export async function historicalTrades(address:string,since=0,until=Date.now(),ammMint?:string):Promise<Trade[]>{
 let before:string|undefined;const trades:Trade[]=[];const cursors=new Set<string>();
 while(true){
  const rows=await rpc<{signature:string;blockTime:number|null;err:unknown}[]>('getSignaturesForAddress',[address,{limit:1000,...(before?{before}:{})}]);
  if(!rows.length)break;
  for(const row of rows){if(row.err||row.blockTime!==null&&(row.blockTime*1000<since||row.blockTime*1000>until))continue;
   const tx=await rpc<{slot:number;meta:{err:unknown;logMessages:string[]|null}|null}|null>('getTransaction',[row.signature,{encoding:'json',commitment:'confirmed',maxSupportedTransactionVersion:0}]);
   if(!tx?.meta)throw new Error('Historical transaction unavailable; recovery cannot be marked complete');
   if(!tx.meta.err&&ammMint)trades.push(...decodeAmmLogs(tx.meta.logMessages??[],row.signature,ammMint,address).filter(t=>t.timestamp>=since&&t.timestamp<=until));
   if(!tx.meta.err)trades.push(...decodeTradeLogs(tx.meta.logMessages??[],row.signature).filter(t=>t.timestamp>=since&&t.timestamp<=until).map(t=>({...t,slot:tx.slot})));
  }
  if(rows.some(r=>r.blockTime!==null&&r.blockTime*1000<since))break;
  const next=rows.at(-1)!.signature;if(cursors.has(next))throw new Error('History cursor stalled');cursors.add(next);before=next;
 }
 return trades.sort((a,b)=>a.timestamp-b.timestamp||a.signature.localeCompare(b.signature));
}
export function rankRunners(trades:Trade[]){const volumes=new Map<string,number>();for(const t of trades)volumes.set(t.mint,(volumes.get(t.mint)??0)+t.sol);return [...volumes].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).slice(0,5).map(([mint,volumeSol])=>({mint,volumeSol}));}

export function decodeAmmLogs(logs:string[],signature:string,mint:string,pool:string):Trade[]{
 const program='pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA',stack:string[]=[],result:Trade[]=[];
 const buyId=createHash('sha256').update('event:BuyEvent').digest().subarray(0,8),sellId=createHash('sha256').update('event:SellEvent').digest().subarray(0,8);
 for(let i=0;i<logs.length;i++){const line=logs[i],invoke=line.match(/^Program (\w+) invoke/);if(invoke)stack.push(invoke[1]);if(/^Program \w+ (success|failed)/.test(line))stack.pop();if(stack.at(-1)!==program||!line.startsWith('Program data: '))continue;const b=Buffer.from(line.slice(14),'base64');if(b.length<184)continue;const buy=b.subarray(0,8).equals(buyId);if(!buy&&!b.subarray(0,8).equals(sellId))continue;if(new PublicKey(b.subarray(120,152)).toBase58()!==pool)continue;const tokens=Number(b.readBigUInt64LE(16))/1e6,sol=Number(b.readBigUInt64LE(64))/1e9;if(tokens>0&&sol>0)result.push({signature:`${signature}:${i}`,mint,wallet:new PublicKey(b.subarray(152,184)).toBase58(),buy,sol,tokens,price:sol/tokens,timestamp:Number(b.readBigInt64LE(8))*1000});}
 return result;
}
