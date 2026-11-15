import { Connection, PublicKey } from '@solana/web3.js';
import { NATIVE_MINT } from '@solana/spl-token';
import BN from 'bn.js';
import { OnlinePumpAmmSdk, canonicalPumpPoolPda, buyQuoteInput, sellBaseInput } from '@pump-fun/pump-swap-sdk';
import { limiter, rpcUrl } from './helius';
export async function migratedSellQuote(mint:string,tokens:bigint){
 const connection=new Connection(rpcUrl().toString(),{commitment:'confirmed',disableRetryOnRateLimit:true,fetch:async(input,init)=>{await limiter.acquire();return fetch(input, {...init,signal:AbortSignal.timeout(15000)});}});
 const sdk=new OnlinePumpAmmSdk(connection),key=new PublicKey(mint);
 const state=await sdk.swapSolanaState(canonicalPumpPoolPda(key),PublicKey.default);
 const p=state.pool;if(!p.baseMint.equals(key)||!p.quoteMint.equals(NATIVE_MINT))throw new Error('Expected canonical token/WSOL migration pool');
 const quote=sellBaseInput({base:new BN(tokens.toString()),slippage:0,baseReserve:state.poolBaseAmount,quoteReserve:state.poolQuoteAmount,virtualQuoteReserves:p.virtualQuoteReserves,feeBucketsTotal:p.protocolFees.add(p.creatorFees),globalConfig:state.globalConfig,baseMintAccount:state.baseMintAccount,baseMint:key,coinCreator:p.coinCreator,creator:p.creator,feeConfig:state.feeConfig,quoteMint:p.quoteMint,isMayhemMode:p.isMayhemMode,creatorFeeBps:p.creatorFeeBps,quoteTransferFee:state.quoteTransferFee});
 return {proceeds:BigInt(quote.uiQuote.toString())-10_000n,price:Number(state.poolQuoteAmount.toString())/Number(state.poolBaseAmount.toString())*10**state.baseMintAccount.decimals/1e9};
}

export async function migratedBuyQuote(mint:string,budget:bigint,executionCost=1500000n){
 if(budget<=executionCost)throw new Error('Insufficient paper budget');
 const connection=new Connection(rpcUrl().toString(),{commitment:'confirmed',disableRetryOnRateLimit:true,fetch:async(input,init)=>{await limiter.acquire();return fetch(input,{...init,signal:AbortSignal.timeout(15000)});}});
 const sdk=new OnlinePumpAmmSdk(connection),key=new PublicKey(mint),state=await sdk.swapSolanaState(canonicalPumpPoolPda(key),PublicKey.default),p=state.pool;
 if(!p.baseMint.equals(key)||!p.quoteMint.equals(NATIVE_MINT))throw new Error('Unsupported paper pool');
 const q=buyQuoteInput({quote:new BN((budget-executionCost).toString()),slippage:0,baseReserve:state.poolBaseAmount,quoteReserve:state.poolQuoteAmount,virtualQuoteReserves:p.virtualQuoteReserves,globalConfig:state.globalConfig,baseMintAccount:state.baseMintAccount,baseMint:key,coinCreator:p.coinCreator,creator:p.creator,feeConfig:state.feeConfig,quoteMint:p.quoteMint,isMayhemMode:p.isMayhemMode,creatorFeeBps:p.creatorFeeBps,quoteTransferFee:state.quoteTransferFee});
 return {tokens:BigInt(q.base.toString()),cost:budget};
}

import {type Curve as EmotionCurve,bondingProgress as emotionBondingProgress} from './pumpDecoder';
export function emotionCurveTarget(emotionCurve:EmotionCurve,emotionInitial:bigint,emotionTargetBps:number){
 if(emotionInitial<=0n||!Number.isInteger(emotionTargetBps)||emotionTargetBps<0||emotionTargetBps>10000)throw new Error('Emotion invalid magnet target');
 const emotionRemaining=emotionInitial*BigInt(10000-emotionTargetBps)/10000n;
 const emotionTokens=emotionCurve.realTokenReserves>emotionRemaining?emotionCurve.realTokenReserves-emotionRemaining:0n;
 return emotionTokenCost(emotionCurve,emotionTokens);
}
function emotionTokenCost(emotionCurve:EmotionCurve,emotionTokens:bigint){
 if(emotionCurve.complete||emotionTokens===0n)return {emotionTokens:0n,emotionNetLamports:0n,emotionFeeLamports:0n,emotionGrossLamports:0n};
 if(emotionTokens>=emotionCurve.virtualTokenReserves)throw new Error('Emotion magnet exceeds curve depth');
 const emotionDenominator=emotionCurve.virtualTokenReserves-emotionTokens;
 const emotionNetLamports=(emotionCurve.virtualSolReserves*emotionTokens+emotionDenominator-1n)/emotionDenominator;
 const emotionFeeLamports=(emotionNetLamports*125n+9999n)/10000n;
 return {emotionTokens,emotionNetLamports,emotionFeeLamports,emotionGrossLamports:emotionNetLamports+emotionFeeLamports};
}
export function emotionCurveMagnets(emotionCurve:EmotionCurve,emotionInitial:bigint,emotionKingMarketCapSol:number|null){
 // Emotion King of the Hill is a configured SOL market-cap target, never an invented fixed completion threshold.
 let emotionKing:ReturnType<typeof emotionTokenCost>|null=null;
 if(emotionKingMarketCapSol!==null&&Number.isFinite(emotionKingMarketCapSol)&&emotionKingMarketCapSol>0&&!emotionCurve.complete){
 const emotionTargetLamports=BigInt(Math.ceil(emotionKingMarketCapSol*1e9));
 const emotionReached=(emotionTokens:bigint)=>{const emotionQuote=emotionTokenCost(emotionCurve,emotionTokens);return (emotionCurve.virtualSolReserves+emotionQuote.emotionNetLamports)*emotionCurve.tokenTotalSupply>=emotionTargetLamports*(emotionCurve.virtualTokenReserves-emotionTokens);};
 let emotionLow=0n,emotionHigh=emotionCurve.realTokenReserves;
 if(emotionReached(emotionHigh)){while(emotionLow<emotionHigh){const emotionMid=(emotionLow+emotionHigh)/2n;if(emotionReached(emotionMid))emotionHigh=emotionMid;else emotionLow=emotionMid+1n;}emotionKing=emotionTokenCost(emotionCurve,emotionLow);}
 }

 return {emotionProgress:emotionBondingProgress(emotionCurve,emotionInitial),emotionKing,emotion85:emotionCurveTarget(emotionCurve,emotionInitial,8500),emotion95:emotionCurveTarget(emotionCurve,emotionInitial,9500),emotion97:emotionCurveTarget(emotionCurve,emotionInitial,9700)};
}
