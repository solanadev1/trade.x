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
