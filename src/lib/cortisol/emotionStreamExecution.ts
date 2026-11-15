import type {Trade as EmotionTrade} from './helius';
import type {Curve as EmotionCurve} from './pumpDecoder';
import {PublicKey as EmotionPublicKey} from '@solana/web3.js';
export type EmotionCurveEvent={emotionMint:string;emotionCurve:EmotionCurve;emotionAt:number;emotionSlot:number};
const emotionListeners=new Set<(emotionEvent:EmotionCurveEvent)=>void>();
const emotionTradeListeners=new Set<(emotionTrades:EmotionTrade[])=>void>();
const emotionCurves=new Map<string,EmotionCurveEvent>();
export function emotionOnCurve(emotionCallback:(emotionEvent:EmotionCurveEvent)=>void){emotionListeners.add(emotionCallback);return()=>emotionListeners.delete(emotionCallback);}
export function emotionOnTrades(emotionCallback:(emotionTrades:EmotionTrade[])=>void){emotionTradeListeners.add(emotionCallback);return()=>emotionTradeListeners.delete(emotionCallback);}
export function emotionPublishCurve(emotionEvent:EmotionCurveEvent){const emotionOld=emotionCurves.get(emotionEvent.emotionMint);if(emotionOld&&emotionOld.emotionSlot>emotionEvent.emotionSlot)return;emotionCurves.delete(emotionEvent.emotionMint);emotionCurves.set(emotionEvent.emotionMint,emotionEvent);while(emotionCurves.size>5000)emotionCurves.delete(emotionCurves.keys().next().value!);for(const emotionListener of emotionListeners)emotionListener(emotionEvent);}
export function emotionLatestCurve(emotionMint:string,emotionNow=Date.now()){const emotionCurve=emotionCurves.get(emotionMint);return emotionCurve&&emotionNow-emotionCurve.emotionAt<2000?emotionCurve:undefined;}
export function emotionPublishTrades(emotionTrades:EmotionTrade[]){
 for(const emotionTrade of emotionTrades){if(!emotionTrade.observedAt||emotionTrade.slot===undefined||!emotionTrade.virtualSolRaw||!emotionTrade.virtualTokenRaw||!emotionTrade.realSolRaw||!emotionTrade.emotionRealTokenRaw)continue;
 const emotionOld=emotionCurves.get(emotionTrade.mint);emotionPublishCurve({emotionMint:emotionTrade.mint,emotionAt:emotionTrade.observedAt,emotionSlot:emotionTrade.slot,emotionCurve:{virtualSolReserves:BigInt(emotionTrade.virtualSolRaw),virtualTokenReserves:BigInt(emotionTrade.virtualTokenRaw),realSolReserves:BigInt(emotionTrade.realSolRaw),realTokenReserves:BigInt(emotionTrade.emotionRealTokenRaw),tokenTotalSupply:emotionOld?.emotionCurve.tokenTotalSupply??0n,creator:emotionOld?.emotionCurve.creator??EmotionPublicKey.default,complete:BigInt(emotionTrade.emotionRealTokenRaw)===0n}});
 }
 for(const emotionListener of emotionTradeListeners)emotionListener(emotionTrades);
}
export type EmotionWhale={emotionWallet:string;emotionInitial:number;emotionSold:number;emotionSlot:number};
export function emotionWhaleDump(emotionWhales:EmotionWhale[],emotionTrades:EmotionTrade[]){
 for(const emotionTrade of emotionTrades){const emotionWhale=emotionWhales.find(emotionItem=>emotionItem.emotionWallet===emotionTrade.wallet);if(emotionWhale&&emotionTrade.slot!==undefined&&emotionTrade.slot>emotionWhale.emotionSlot)emotionWhale.emotionSold+=emotionTrade.buy?-emotionTrade.tokens:emotionTrade.tokens;}
 return emotionWhales.filter(emotionWhale=>emotionWhale.emotionInitial>0&&emotionWhale.emotionSold>emotionWhale.emotionInitial*.5).length>=2;
}
