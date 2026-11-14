import {canonicalPumpPoolPda} from '@pump-fun/pump-swap-sdk';import {PublicKey} from '@solana/web3.js';
import {historicalTrades} from './history';import {curveAddress} from './pumpDecoder';import type {Trade} from './helius';
export function nearestCandle(trades:Trade[],target:number,windowMs=30000){return trades.filter(t=>Math.abs(t.timestamp-target)<=windowMs).sort((a,b)=>Math.abs(a.timestamp-target)-Math.abs(b.timestamp-target)||a.timestamp-b.timestamp)[0]??null;}
export async function historicalGrade(mint:string,target:number,tokens:bigint,cost:bigint,decimals:number,fallback:()=>Promise<{price:number;proceeds:bigint}>){
 const trades=await historicalTrades(curveAddress(mint).toBase58(),target-30000,target+30000);const amm=await historicalTrades(canonicalPumpPoolPda(new PublicKey(mint)).toBase58(),target-30000,target+30000,mint);const candle=nearestCandle([...trades,...amm],target);
 if(!candle){const q=await fallback();return {...q,pnl:Number(q.proceeds-cost)/Number(cost)*100,source:'FIRST_AVAILABLE_QUOTE'};}
 const price=candle.price*10**(decimals-6);let gross:bigint;
 if(candle.virtualSolRaw&&candle.virtualTokenRaw){gross=tokens*BigInt(candle.virtualSolRaw)/(BigInt(candle.virtualTokenRaw)+tokens);if(candle.realSolRaw&&gross>BigInt(candle.realSolRaw))throw new Error('Historical curve insufficient exit liquidity');}
 else gross=BigInt(Math.floor(Number(tokens)/10**decimals*price*1e9));
 const proceeds=gross-(gross*125n+9999n)/10000n-10000n;return {price,proceeds,pnl:Number(proceeds-cost)/Number(cost)*100,source:'HISTORICAL_SWAP'};
}
