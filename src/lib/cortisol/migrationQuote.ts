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
