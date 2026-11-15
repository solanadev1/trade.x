export type KellyTier='NO TRADE'|'SCOUT'|'CORE'|'MAX';
export type KellyHistory={n:number;winRate:number;payoffRatio:number};
export type ConvictionInput={emotion:number;absorptionPct:number;freshUnbundled:boolean;inflowScore:number;curvePct:number;forensicPass:boolean;top10Pct:number;sharedParentPct:number;millisecondClusteredPct:number|null;narrative:number};
const clamp=(n:number,lo=0,hi=100)=>Math.max(lo,Math.min(hi,n));
export function convictionScore(e:ConvictionInput){
 if(Object.values(e).some(v=>typeof v==='number'&&!Number.isFinite(v))||!e.forensicPass||e.sharedParentPct>40||e.millisecondClusteredPct===null||e.millisecondClusteredPct>40||!e.freshUnbundled||e.absorptionPct<30)return 0;
 const emotion=clamp(e.emotion)*.5+clamp(e.absorptionPct/30*100)*.5;
 const velocity=clamp(e.inflowScore)*.6+clamp(e.curvePct)*.4;
 const safety=clamp(100-e.top10Pct);
 const magnet=e.curvePct>=75&&e.curvePct<=92&&e.emotion>=55?15:0;
 return Math.round(clamp(emotion*.35+velocity*.25+safety*.2+clamp(e.narrative)*.2+magnet));
}
// Hard ceiling on capital in one position. On a bonding curve the realistic worst case is the whole
// position (rug, failed exit), so position size itself is the risk number, not size x stop distance.
export const MAX_POSITION_FRACTION=.02;
// Size used while there is not yet enough evidence to estimate an edge. It buys data, not profit.
export const PROBE_FRACTION=.0025;
const PRIOR_TRADES=30,PRIOR_PAYOFF=35/15;
// Payoff is taken as observed (capped at 5 so one outlier cannot carry the estimate). The win rate is
// shrunk toward the breakeven rate for that payoff by 30 pseudo-trades, then takes a one-standard-error
// haircut. Zero edge is therefore the default, and a conviction score never adds win probability.
export function shrunkEdge(history:KellyHistory){
 const n=Math.max(0,Math.floor(history.n||0));
 const payoff=n>0?Math.min(5,Number.isFinite(history.payoffRatio)&&history.payoffRatio>0?history.payoffRatio:0):PRIOR_PAYOFF;
 if(payoff<=0)return {p:0,payoff:0,breakeven:1,n};
 const breakeven=1/(1+payoff);
 const mean=(clamp(history.winRate,0,1)*n+breakeven*PRIOR_TRADES)/(n+PRIOR_TRADES);
 const p=Math.max(0,mean-Math.sqrt(mean*(1-mean)/(n+PRIOR_TRADES+1)));
 return {p,payoff,breakeven,n};
}
export function kellySize(bankrollSol:number,score:number,history:KellyHistory,multiplier=.25){
 if(![.25,.5].includes(multiplier))throw new Error('Kelly multiplier must be 0.25 or 0.50');
 const empty={tier:'NO TRADE' as KellyTier,sol:0,fraction:0,fStar:0,pConv:0,payoff:0,multiplier};
 if(!Number.isFinite(bankrollSol)||bankrollSol<=0||!Number.isFinite(score)||score<55)return empty;
 if(!Number.isFinite(history.winRate)||history.winRate<0||history.winRate>1||!Number.isFinite(history.payoffRatio)||history.payoffRatio<0)return empty;
 const edge=shrunkEdge(history),fStar=edge.payoff>0?edge.p-(1-edge.p)/edge.payoff:-1;
 const tier:KellyTier=score<=70?'SCOUT':score<=85?'CORE':'MAX';
 // Score only scales how much of the Kelly fraction is used (50% at 55, 100% at 100).
 const scale=.5+.5*clamp((score-55)/45,0,1);
 let fraction=fStar>0?Math.min(MAX_POSITION_FRACTION,fStar*multiplier*scale):0;
 let label=tier;
 // No measured edge yet: allow a fixed probe so the calibrator can collect outcomes. Once 30 trades
 // exist, a non-positive shrunk edge means no trade at all.
 if(fraction<=0){if(edge.n>=PRIOR_TRADES)return {...empty,fStar,pConv:edge.p,payoff:edge.payoff};fraction=PROBE_FRACTION;label='SCOUT';}
 let sol=bankrollSol*fraction;
 // Fee floor: below 0.05 SOL fixed costs dominate. Never exceed the hard ceiling to reach it.
 if(sol<.05){if(.05>bankrollSol*MAX_POSITION_FRACTION+1e-12)return {...empty,fStar,pConv:edge.p,payoff:edge.payoff};sol=.05;}
 return {tier:label,sol:Math.floor(sol*1e9)/1e9,fraction:sol/bankrollSol,fStar,pConv:edge.p,payoff:edge.payoff,multiplier};
}
export function convictionTip(score:number){if(score<=70)return 500000n;if(score<=85)return 1500000n;return BigInt(Math.round(3000000+Math.min(1,Math.max(0,(score-86)/14))*2000000));}
export function trailingFraction(score:number){return score>=86?.08:.12;}

export function clusteredReceiptPct(buys:{wallet:string;observedAt?:number}[]){
 if(!buys.length||buys.some(t=>t.observedAt===undefined))return null;
 const wallets=new Set(buys.map(t=>t.wallet));const buckets=new Map<number,Set<string>>();
 for(const t of buys){const group=buckets.get(t.observedAt!)??new Set<string>();group.add(t.wallet);buckets.set(t.observedAt!,group);}
 return Math.max(...[...buckets.values()].map(group=>group.size>1?group.size:0))/wallets.size*100;
}

export function emotionEvAllocation(emotionBankroll:number,emotionScore:number,emotionHistory:KellyHistory,emotionSharkRatio:number,emotionZEdge:number,emotionMultiplier=.25){
 const emotionValid=[emotionBankroll,emotionScore,emotionSharkRatio,emotionZEdge].every(Number.isFinite)&&emotionSharkRatio>=0;
 const emotionEdge=emotionValid?Math.max(-5,Math.min(5,Math.log1p(emotionSharkRatio)*2+emotionZEdge)):0;
 const emotionAdjusted=emotionValid&&emotionScore>=55?Math.max(55,Math.min(100,emotionScore+emotionEdge)):0;
 const emotionAllocation=kellySize(emotionBankroll,emotionAdjusted,emotionHistory,emotionMultiplier);
 const emotionEv=emotionAllocation.pConv*emotionAllocation.payoff-(1-emotionAllocation.pConv);
 // Emotion bids are capped by bankroll and estimated edge; auction inclusion cannot be guaranteed.
 const emotionCeiling=Math.max(0,Math.min(.02,emotionBankroll*.001,emotionAllocation.sol*Math.max(0,emotionEv)*.05));
 const emotionDesired=emotionScore>=90?Number(convictionTip(emotionAdjusted))/1e9*(1+Math.max(0,emotionEdge)):Number(convictionTip(emotionScore))/1e9;
 const emotionTip=BigInt(Math.floor(Math.min(emotionCeiling,emotionDesired)*1e9));
 return {...emotionAllocation,emotionEv,emotionAdjusted,emotionTip:emotionAllocation.sol>0&&emotionTip>=1000n?emotionTip:0n,sol:emotionTip>=1000n?emotionAllocation.sol:0};
}

import {roundTripQuote as emotionRoundTripQuote,type Curve as EmotionCurve} from './pumpDecoder';
export function emotionCostAdjustedKelly(emotionBankroll:number,emotionScore:number,emotionHistory:KellyHistory,emotionSharkRatio:number,emotionZEdge:number,emotionCurve:EmotionCurve,emotionFailureSol=0,emotionMultiplier=.25){
 const emotionBase=emotionEvAllocation(emotionBankroll,emotionScore,emotionHistory,emotionSharkRatio,emotionZEdge,emotionMultiplier);
 const emotionEmpty={...emotionBase,sol:0,emotionTip:0n,emotionCostRate:0,emotionNetWin:0,emotionNetLoss:0,emotionEv:0};
 if(emotionBase.sol<=0||!Number.isFinite(emotionFailureSol)||emotionFailureSol<0||emotionCurve.complete)return emotionEmpty;
 let emotionBest=emotionEmpty;
 // Emotion search recomputes reserve impact and fixed costs at each candidate before accepting its Kelly bound.
 for(let emotionStep=1;emotionStep<=80;emotionStep++){
 const emotionSol=Math.floor(emotionBase.sol*emotionStep/80*1e9)/1e9;if(emotionSol<.05)continue;
 const emotionTip=BigInt(Math.floor(Math.min(Number(emotionBase.emotionTip),emotionSol*.01*1e9)));
 if(emotionTip<1000n)continue;
 try{const emotionBudget=BigInt(Math.floor(emotionSol*1e9));const emotionQuote=emotionRoundTripQuote(emotionCurve,emotionBudget,125,emotionTip+35000n);
 const emotionCostRate=(Number(emotionQuote.cost-emotionQuote.proceeds)/1e9+emotionFailureSol+.00203928)/emotionSol;
 const emotionNetWin=.15*emotionHistory.payoffRatio-emotionCostRate,emotionNetLoss=.15+emotionCostRate;
 const emotionEv=emotionBase.pConv*emotionNetWin-(1-emotionBase.pConv)*emotionNetLoss;
 if(emotionBase.fStar>0&&(emotionNetWin<=0||emotionEv<=0))continue;if(emotionBase.fStar<=0&&emotionCostRate>.1)continue;
 const emotionF=emotionBase.pConv-(1-emotionBase.pConv)/(emotionNetWin/emotionNetLoss);
 if(emotionSol>Math.max(emotionBankroll*Math.min(MAX_POSITION_FRACTION,Math.max(0,emotionF*emotionMultiplier)),emotionBase.fStar<=0?emotionBase.sol:0)+1e-12)continue;
 emotionBest={...emotionBase,sol:emotionSol,fraction:emotionSol/emotionBankroll,fStar:emotionF,emotionTip,emotionCostRate,emotionNetWin,emotionNetLoss,emotionEv};
 }catch{continue;}}
 return emotionBest;
}
