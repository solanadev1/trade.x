export type MintMetrics = {
  ageSec: number; volSolLast15m: number; secondsSinceLastBuy: number;
  tradesLast3m: number; uniqueBuyersLast3m: number; realSolReserves: number; bondingProgress: number;
};
export function isTokenAliveAndLiquid(m: MintMetrics): boolean {
  if (Object.values(m).some(v => !Number.isFinite(v) || v < 0)) return false;
  return (m.ageSec < 21600 || m.volSolLast15m > 50) && m.secondsSinceLastBuy < 45 &&
    m.tradesLast3m >= 25 && m.uniqueBuyersLast3m >= 12 && m.realSolReserves >= 20 && m.bondingProgress < 90;
}

import type {Trade as EmotionTrade} from './helius';
const emotionStream=new Map<string,EmotionTrade>();
const emotionLaunches=new Map<string,number>();
export function emotionRegisterLaunch(emotionMint:string,emotionCreated:number){emotionLaunches.set(emotionMint,emotionCreated);}
export function emotionObserveStream(emotionTrades:EmotionTrade[],emotionNow=Date.now()){
 for(const emotionTrade of emotionTrades)if(emotionTrade.observedAt!==undefined&&Math.abs(emotionNow-emotionTrade.timestamp)<30000&&emotionTrade.sol>0)emotionStream.set(`${emotionTrade.signature}:${emotionTrade.mint}:${emotionTrade.wallet}:${emotionTrade.buy}:${emotionTrade.tokens}`,emotionTrade);
 for(const [emotionKey,emotionTrade] of emotionStream)if((emotionTrade.observedAt??0)<emotionNow-30000)emotionStream.delete(emotionKey);
 for(const [emotionMint,emotionCreated] of emotionLaunches)if(emotionNow-emotionCreated>600000)emotionLaunches.delete(emotionMint);
}
export function emotionStreamTrades(emotionMint?:string,emotionNow=Date.now()){return [...emotionStream.values()].filter(emotionTrade=>(!emotionMint||emotionTrade.mint===emotionMint)&&(emotionTrade.observedAt??0)>=emotionNow-30000).sort((emotionA,emotionB)=>emotionA.timestamp-emotionB.timestamp);}
export function emotionAttentionDrain(emotionMint:string,emotionNow=Date.now()){
 const emotionBuys=emotionStreamTrades(undefined,emotionNow).filter(emotionTrade=>emotionTrade.buy);
 const emotionRecent=emotionBuys.filter(emotionTrade=>(emotionTrade.observedAt??0)>emotionNow-5000);
 const emotionTotal=emotionRecent.reduce((emotionSum,emotionTrade)=>emotionSum+emotionTrade.sol,0);
 const emotionOwn=emotionBuys.filter(emotionTrade=>emotionTrade.mint===emotionMint);
 const emotionLast=Math.max(0,...emotionOwn.map(emotionTrade=>emotionTrade.observedAt??0));
 const emotionVolumes=new Map<string,number>();for(const emotionTrade of emotionRecent)emotionVolumes.set(emotionTrade.mint,(emotionVolumes.get(emotionTrade.mint)??0)+emotionTrade.sol);
 const emotionLeader=[...emotionVolumes].filter(([emotionToken])=>emotionToken!==emotionMint&&emotionLaunches.has(emotionToken)&&emotionNow-emotionLaunches.get(emotionToken)!<=600000).sort((emotionA,emotionB)=>emotionB[1]-emotionA[1])[0];
 const emotionShare=emotionLeader&&emotionTotal>0?emotionLeader[1]/emotionTotal:0;
 return {emotionExit:emotionLast>0&&emotionNow-emotionLast>=5000&&emotionShare>.3,emotionShare,emotionLeader:emotionLeader?.[0]??null,emotionSolPerSecond:emotionTotal/5};
}
