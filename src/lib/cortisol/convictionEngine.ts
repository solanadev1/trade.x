import {db} from './phaseDb';import {getConfig} from '../db/cortisolDb';import {rpc,type Trade} from './helius';import {fundingParent} from './fundingCache';import {convictionScore,kellySize,clusteredReceiptPct,type KellyHistory} from './kelly';
db.exec('CREATE TABLE IF NOT EXISTS conviction_signals(mint TEXT PRIMARY KEY,curve_pct REAL,emotion_index REAL,absorption_pct REAL,conviction REAL,tier TEXT,size_sol REAL,f_star REAL,updated_at INTEGER,narrative REAL)');
export function rollingHistory():KellyHistory{const rows=db.prepare("SELECT realized_sol,sol_invested FROM active_positions WHERE status='CLOSED' AND token_amount_raw<>'0' AND is_dry_run=? ORDER BY opened_at DESC LIMIT 200").all(+(getConfig('dry_run_mode')!=='false')) as {realized_sol:number;sol_invested:number}[];const returns=rows.filter(r=>r.sol_invested>0).map(r=>(r.realized_sol-r.sol_invested)/r.sol_invested),wins=returns.filter(v=>v>0),losses=returns.filter(v=>v<0);return {n:returns.length,winRate:returns.length?wins.length/returns.length:.42,payoffRatio:wins.length&&losses.length?(wins.reduce((s,v)=>s+v,0)/wins.length)/(-losses.reduce((s,v)=>s+v,0)/losses.length):returns.length<30?35/15:0};}
export function sizing(bankroll:number,score:number){return kellySize(bankroll,score,rollingHistory(),Number(getConfig('kelly_multiplier')||.25));}
export async function orderflowEvidence(trades:Trade[],bundledWallets:string[]){
 const now=Date.now(),recent=trades.filter(t=>t.timestamp>=now-180000),sells=recent.filter(t=>!t.buy&&t.timestamp>=now-60000);
 const dump=sells.reduce<Trade|null>((best,t)=>!best||t.sol>best.sol?t:best,null);if(!dump)return {measuredAt:now,millisecondClusteredPct:null,absorptionPct:0,freshUnbundled:false,sharedParentPct:100,inflowScore:0};
 const buyers=[...new Set(recent.filter(t=>t.buy).map(t=>t.wallet))],parents=new Map<string,number>();let unknown=false;
 for(const wallet of buyers){const funding=await fundingParent(wallet);if(funding.established)continue;if(!funding.parent)unknown=true;else parents.set(funding.parent,(parents.get(funding.parent)??0)+1);}
 const eligible=new Set<string>();for(const wallet of new Set(recent.filter(t=>t.buy&&t.timestamp>=dump.timestamp&&t.timestamp<=dump.timestamp+3000).map(t=>t.wallet))){if(bundledWallets.includes(wallet)||recent.some(t=>t.wallet===wallet&&t.timestamp<dump.timestamp))continue;const balance=await rpc<{value:number}>('getBalance',[wallet,{commitment:'confirmed'}]);if(balance.value>5e9)eligible.add(wallet);}
 const panic=sells.filter(t=>t.timestamp>=dump.timestamp-3000&&t.timestamp<=dump.timestamp).reduce((s,t)=>s+t.sol,0);
 const absorbed=recent.filter(t=>t.buy&&eligible.has(t.wallet)&&t.timestamp>=dump.timestamp&&t.timestamp<=dump.timestamp+3000).reduce((s,t)=>s+t.sol,0);
 const latest=recent.filter(t=>t.timestamp>=now-3000),net=latest.reduce((s,t)=>s+(t.buy?t.sol:-t.sol),0);
 return {measuredAt:now,millisecondClusteredPct:clusteredReceiptPct(recent.filter(t=>t.buy)),absorptionPct:panic?absorbed/panic*100:0,freshUnbundled:eligible.size>0&&!unknown,sharedParentPct:buyers.length?Math.max(0,...parents.values())/buyers.length*100:100,inflowScore:Math.max(0,Math.min(100,net/Math.max(.01,panic)*100))};
}
export function publishSignal(mint:string,curvePct:number,emotion:number,evidence:Awaited<ReturnType<typeof orderflowEvidence>>,forensicPass:boolean,top10Pct:number,narrative:number,bankroll:number,emotionOverride?:number){const score=!forensicPass||Date.now()-evidence.measuredAt>10000?0:emotionOverride!==undefined?Math.max(0,Math.min(100,emotionOverride)):convictionScore({emotion,...evidence,curvePct,forensicPass,top10Pct,narrative});const kelly=sizing(bankroll,score);db.prepare('INSERT OR REPLACE INTO conviction_signals VALUES(?,?,?,?,?,?,?,?,?,?)').run(mint,curvePct,emotion,evidence.absorptionPct,score,kelly.tier,kelly.sol,kelly.fStar,Date.now(),narrative);return {score,...kelly};}

export type EmotionPassOne = {
 emotionPain:{emotionExhaustionScore:number};
 emotionTape:{emotionAbsorptions:{emotionDeltaMs:number}[];emotionApexBuys:{emotionCopyHerdScore:number}[]};
 emotionClusters:{emotionStealthWhaleAccumulation:boolean;emotionWashTrading:boolean};
 emotionFlow:{emotionDumpSol:number;emotionAbsorbSol:number;emotionDumpToAbsorption:number|null};
};
export function synthesizeEmotionConviction(emotionBase:number,emotionEvidence:EmotionPassOne,emotionSafe:boolean,emotionAdjustment=0){
 const emotionScalp=emotionEvidence.emotionTape.emotionApexBuys.some(emotionBuy=>emotionBuy.emotionCopyHerdScore>=60);
 const emotionFloor=emotionEvidence.emotionTape.emotionAbsorptions.some(emotionAbsorption=>emotionAbsorption.emotionDeltaMs>0&&emotionAbsorption.emotionDeltaMs<400);
 const emotionMaximum=emotionEvidence.emotionPain.emotionExhaustionScore>=90&&(emotionFloor||emotionEvidence.emotionClusters.emotionStealthWhaleAccumulation);
 if(!emotionSafe||emotionEvidence.emotionClusters.emotionWashTrading)return {emotionScore:0,emotionScalp:false,emotionMaximum:false};
 return {emotionScore:emotionMaximum?100:Math.min(100,Math.max(emotionScalp?95:0,emotionBase+emotionAdjustment)),emotionScalp,emotionMaximum};
}
export function emotionBuySizeDecay(emotionTrades:Trade[],emotionProfiles:import('../db/cortisolDb').EmotionProfile[],emotionSolUsd:number|null,emotionNow=Date.now()){
 const emotionCurrent=emotionTrades.filter(emotionTrade=>emotionTrade.buy&&emotionTrade.timestamp>emotionNow-10000&&emotionTrade.timestamp<=emotionNow);
 const emotionPrior=emotionTrades.filter(emotionTrade=>emotionTrade.buy&&emotionTrade.timestamp>emotionNow-20000&&emotionTrade.timestamp<=emotionNow-10000);
 const emotionMedian=(emotionValues:number[])=>{const emotionSorted=[...emotionValues].sort((emotionA,emotionB)=>emotionA-emotionB);return emotionSorted.length?(emotionSorted[Math.floor((emotionSorted.length-1)/2)]+emotionSorted[Math.floor(emotionSorted.length/2)])/2:null;};
 const emotionMedianSol=emotionMedian(emotionCurrent.map(emotionTrade=>emotionTrade.sol)),emotionPriorMedian=emotionMedian(emotionPrior.map(emotionTrade=>emotionTrade.sol));
 const emotionGamblers=new Set(emotionProfiles.filter(emotionProfile=>emotionProfile.emotionClass==='Emotional Retail Gamblers').map(emotionProfile=>emotionProfile.emotionWallet));
 const emotionShare=(emotionWindow:Trade[])=>{const emotionWallets=new Set(emotionWindow.map(emotionTrade=>emotionTrade.wallet));return emotionWallets.size?[...emotionWallets].filter(emotionWallet=>emotionGamblers.has(emotionWallet)).length/emotionWallets.size:0;};
 const emotionSorted=[...emotionTrades].filter(emotionTrade=>emotionTrade.timestamp>=emotionNow-20000&&emotionTrade.timestamp<=emotionNow).sort((emotionA,emotionB)=>emotionA.timestamp-emotionB.timestamp);
 const emotionUp=emotionSorted.length>=2&&emotionSorted.at(-1)!.price>emotionSorted[0].price;
 const emotionMedianUsd=emotionSolUsd!==null&&Number.isFinite(emotionSolUsd)&&emotionSolUsd>0&&emotionMedianSol!==null?emotionMedianSol*emotionSolUsd:null;
 const emotionDecay=emotionPriorMedian&&emotionMedianSol!==null?Math.max(0,1-emotionMedianSol/emotionPriorMedian):0;
 return {emotionBuySizeDecay:emotionUp&&emotionCurrent.length>=10&&emotionCurrent.length>=emotionPrior.length*.8&&emotionDecay>=.25&&emotionMedianUsd!==null&&emotionMedianUsd>=50&&emotionMedianUsd<=100&&emotionShare(emotionCurrent)>=.5&&emotionShare(emotionCurrent)>emotionShare(emotionPrior),emotionMedianUsd,emotionMedianSol,emotionDecay,emotionBuysPerSecond:emotionCurrent.length/10,emotionGamblerShare:emotionShare(emotionCurrent),emotionPriceRising:emotionUp};
}
export function emotionSecondWave(emotionPeak:number,emotionPrice:number,emotionPreviousHolders:number|null,emotionHolders:number,emotionApexAbsorbSol:number,emotionConsumed:boolean){const emotionDrawdown=emotionPeak>0?(1-emotionPrice/emotionPeak)*100:0;return {emotionDrawdown,emotionConsume:!emotionConsumed&&emotionDrawdown>=40,emotionTrigger:!emotionConsumed&&emotionDrawdown>=40&&emotionDrawdown<=55&&emotionPreviousHolders!==null&&emotionHolders>emotionPreviousHolders&&emotionApexAbsorbSol>0};}
