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
export function kellySize(bankrollSol:number,score:number,history:KellyHistory,multiplier=.25){
 if(![.25,.5].includes(multiplier))throw new Error('Kelly multiplier must be 0.25 or 0.50');
 const empty={tier:'NO TRADE' as KellyTier,sol:0,fraction:0,fStar:0,pConv:0,payoff:0,multiplier};
 if(!Number.isFinite(bankrollSol)||bankrollSol<=0||!Number.isFinite(score)||score<55)return empty;
 const p=history.n>=30?history.winRate:.42;
 const b=history.payoffRatio;
 if(!Number.isFinite(p)||p<0||p>1||!Number.isFinite(b)||b<=0)return empty;
 const pConv=clamp(p+(clamp(score)-50)/100*.35,.01,.99),fStar=pConv-(1-pConv)/b;
 if(fStar<=0)return {...empty,fStar,pConv,payoff:b};
 const [tier,lo,hi]:[KellyTier,number,number]=score<=70?['SCOUT',.0075,.015]:score<=85?['CORE',.02,.04]:['MAX',.05,.08];
 const fraction=clamp(fStar*multiplier,lo,hi),sol=Math.max(.05,bankrollSol*fraction);
 // Never increase a small bankroll above its tier ceiling to meet the fee floor.
 if(sol>bankrollSol*Math.min(hi,.08)+1e-12)return {...empty,fStar,pConv,payoff:b};
 return {tier,sol:Math.floor(sol*1e9)/1e9,fraction:sol/bankrollSol,fStar,pConv,payoff:b,multiplier};
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
 if(emotionNetWin<=0||emotionEv<=0)continue;
 const emotionF=emotionBase.pConv-(1-emotionBase.pConv)/(emotionNetWin/emotionNetLoss);
 if(emotionSol>emotionBankroll*Math.min(.08,Math.max(0,emotionF*emotionMultiplier))+1e-12)continue;
 emotionBest={...emotionBase,sol:emotionSol,fraction:emotionSol/emotionBankroll,fStar:emotionF,emotionTip,emotionCostRate,emotionNetWin,emotionNetLoss,emotionEv};
 }catch{continue;}}
 return emotionBest;
}
