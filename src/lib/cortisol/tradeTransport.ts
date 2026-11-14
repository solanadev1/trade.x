import {recentBlockhash,startWarmer,prepareAta,cachedAta} from './executionWarm';
import {convictionTip} from './kelly';
import {jupiterInstructions} from './jupiterFallback';
import {Connection,Keypair,PublicKey,ComputeBudgetProgram,SystemProgram,TransactionMessage,VersionedTransaction,TransactionInstruction} from '@solana/web3.js';
import {TOKEN_PROGRAM_ID,TOKEN_2022_PROGRAM_ID,NATIVE_MINT} from '@solana/spl-token';
import {OnlinePumpSdk,PUMP_SDK,getBuyTokenAmountFromSolAmount,getSellSolAmountFromTokenAmount} from '@pump-fun/pump-sdk';
import {OnlinePumpAmmSdk,PUMP_AMM_SDK,canonicalPumpPoolPda,buyQuoteInput,sellBaseInput} from '@pump-fun/pump-swap-sdk';
import BN from 'bn.js';import bs58 from 'bs58';
import {getConfig} from '../db/cortisolDb';import {rpcUrl,limiter} from './helius';import {db,metric} from './phaseDb';
export const EXECUTION_COST=1_500_000n;
export function connection(){return new Connection(rpcUrl().toString(),{commitment:'confirmed',disableRetryOnRateLimit:true,fetch:async(input,init)=>{await limiter.acquire();return fetch(input,{...init,signal:AbortSignal.timeout(15000)});}});}
export function burner(){const text=getConfig('burner_private_key');if(!text)throw new Error('Burner key required');const bytes=text.startsWith('[')?Uint8Array.from(JSON.parse(text)):bs58.decode(text);return Keypair.fromSecretKey(bytes);}
export async function buildSwap(mint:string,side:'BUY'|'SELL',amount:bigint){
 startWarmer();await prepareAta(mint);const conn=connection(),user=burner().publicKey,key=new PublicKey(mint),cached=cachedAta(mint,user.toBase58()),mintInfo=cached?{owner:cached.program}:await conn.getAccountInfo(key);if(!mintInfo||![TOKEN_PROGRAM_ID.toBase58(),TOKEN_2022_PROGRAM_ID.toBase58()].includes(mintInfo.owner.toBase58()))throw new Error('Unsupported mint');
 const online=new OnlinePumpSdk(conn);const state=await online.fetchBuyState(key,user,mintInfo.owner);
 if(!state.bondingCurve.complete){const global=await online.fetchGlobal(),feeConfig=await online.fetchFeeConfig();const common={global,feeConfig,quoteMint:state.quoteMint,mintSupply:state.bondingCurve.tokenTotalSupply,bondingCurve:state.bondingCurve,amount:new BN(amount.toString())};
 if(side==='BUY'){const tokens=getBuyTokenAmountFromSolAmount(common);const ixs=await PUMP_SDK.buyInstructions({...state,global,mint:key,user,amount:tokens.muln(9750).divn(10000),solAmount:new BN(amount.toString()),slippage:0,tokenProgram:mintInfo.owner});return cached?[cached.instruction,...ixs]:ixs;}
 const sol=getSellSolAmountFromTokenAmount(common);return PUMP_SDK.sellInstructions({...state,global,mint:key,user,amount:new BN(amount.toString()),solAmount:sol.muln(9750).divn(10000),slippage:0,tokenProgram:mintInfo.owner,mayhemMode:state.bondingCurve.isMayhemMode});
 }
 try{const amm=new OnlinePumpAmmSdk(conn),s=await amm.swapSolanaState(canonicalPumpPoolPda(key),user);if(!s.pool.quoteMint.equals(NATIVE_MINT))throw new Error('Non-SOL pool');const p=s.pool;const common={slippage:0,baseReserve:s.poolBaseAmount,quoteReserve:s.poolQuoteAmount,virtualQuoteReserves:p.virtualQuoteReserves,feeBucketsTotal:p.protocolFees.add(p.creatorFees),globalConfig:s.globalConfig,baseMintAccount:s.baseMintAccount,baseMint:key,coinCreator:p.coinCreator,creator:p.creator,feeConfig:s.feeConfig,quoteMint:p.quoteMint,isMayhemMode:p.isMayhemMode,creatorFeeBps:p.creatorFeeBps,quoteTransferFee:s.quoteTransferFee};
 if(side==='BUY'){const quote=buyQuoteInput({...common,quote:new BN(amount.toString())});return PUMP_AMM_SDK.buyInstructions(s,quote.base.muln(9750).divn(10000),new BN(amount.toString()));}
 const quote=sellBaseInput({...common,base:new BN(amount.toString())});return PUMP_AMM_SDK.sellInstructions(s,new BN(amount.toString()),quote.uiQuote.muln(9750).divn(10000));}catch{return jupiterInstructions(mint,side,amount);}
}
async function jito(method:string,params:unknown[]){const response=await fetch('https://mainnet.block-engine.jito.wtf/api/v1/bundles',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(5000)});if(!response.ok)throw new Error(`Jito HTTP ${response.status}`);const result=await response.json();if(result.error)throw new Error('Jito rejected request');return result.result;}
export async function submitOrder(orderId:string,ixs:TransactionInstruction[]){
 const order=db.prepare('SELECT execution_orders.side,active_positions.cortisol_score FROM execution_orders JOIN active_positions USING(position_id) WHERE order_id=?').get(orderId) as {side:string;cortisol_score:number};if(order.side==='BUY'&&metric('halted'))throw new Error('Emergency halt');
 const conn=connection(),wallet=burner(),tips=await jito('getTipAccounts',[]);if(!Array.isArray(tips)||!tips.length)throw new Error('No Jito tip accounts');const block=await recentBlockhash();
 const message=new TransactionMessage({payerKey:wallet.publicKey,recentBlockhash:block.blockhash,instructions:[ComputeBudgetProgram.setComputeUnitLimit({units:300000}),ComputeBudgetProgram.setComputeUnitPrice({microLamports:100000}),...ixs,SystemProgram.transfer({fromPubkey:wallet.publicKey,toPubkey:new PublicKey(tips[0]),lamports:convictionTip(order.cortisol_score)})]}).compileToV0Message();const tx=new VersionedTransaction(message);tx.sign([wallet]);
 const simulation=await conn.simulateTransaction(tx,{sigVerify:false,commitment:'confirmed'});if(simulation.value.err)throw new Error(`Simulation rejected: ${JSON.stringify(simulation.value.err)}`);
 const signature=bs58.encode(tx.signatures[0]),raw=Buffer.from(tx.serialize()).toString('base64');db.prepare("UPDATE execution_orders SET signature=?,raw_transaction=?,block_height=?,status='SUBMITTED' WHERE order_id=?").run(signature,raw,block.lastValidBlockHeight,orderId);
 if(order.side==='BUY'&&metric('halted'))throw new Error('Emergency halt before broadcast');
 try{await jito('sendBundle',[[raw],{encoding:'base64'}]);}catch{await conn.sendRawTransaction(tx.serialize(),{skipPreflight:false,maxRetries:0});}
 // Confirmation is reconciled independently from submission, including after restart.
 return signature;
}
