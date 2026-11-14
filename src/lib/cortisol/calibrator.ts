import {db} from './phaseDb';
export type Sample={timestamp:number;drawdown_pct:number;known_jeeter_vol_pct:number;trades_last_3m:number;outcome:string;grade15_pnl:number|null;exhaustion_decay_pct?:number|null};
export type Thresholds={minJeeterVolPct:number;optimalDrawdownMin:number;optimalDrawdownMax:number;minExhaustionDecayPct:number;minTrades3m:number;ev:number;expectancyRatio:number;eligible:boolean;samples:number};
export function calibrate(samples:Sample[]):Thresholds{
 const baseline:Thresholds={minJeeterVolPct:30,optimalDrawdownMin:25,optimalDrawdownMax:45,minExhaustionDecayPct:55,minTrades3m:25,ev:0,expectancyRatio:0,eligible:false,samples:samples.length};
 // Keep unresolved/missing outcomes in the denominator and conservatively assign -15%.
 // Chronological holdout prevents choosing thresholds on the same data used to qualify them.
 const ordered=[...samples].sort((a,b)=>a.timestamp-b.timestamp);if(ordered.length<40)return baseline;
 const split=Math.floor(ordered.length*.7),train=ordered.slice(0,split),validation=ordered.slice(split);
 const evaluate=(rows:Sample[],t:Thresholds)=>{const selected=rows.filter(r=>r.known_jeeter_vol_pct>=t.minJeeterVolPct&&r.drawdown_pct>=t.optimalDrawdownMin&&r.drawdown_pct<=t.optimalDrawdownMax&&r.trades_last_3m>=t.minTrades3m&&(r.exhaustion_decay_pct??0)>=t.minExhaustionDecayPct);const values=selected.map(r=>r.grade15_pnl??-15);const gain=values.reduce((s,v)=>s+Math.max(0,v),0),loss=values.reduce((s,v)=>s+Math.max(0,-v),0);return {count:values.length,ev:values.reduce((s,v)=>s+v,0)/(values.length||1),ratio:loss?gain/loss:gain?Infinity:0};};
 let best=baseline;
 for(const minJeeterVolPct of [30,45,60,75])for(const optimalDrawdownMin of [25,30,35])for(const optimalDrawdownMax of [35,40,45])for(const minTrades3m of [25,40,60])for(const minExhaustionDecayPct of [55,65,75]){
 if(optimalDrawdownMin>=optimalDrawdownMax)continue;const t={...baseline,minJeeterVolPct,optimalDrawdownMin,optimalDrawdownMax,minTrades3m,minExhaustionDecayPct};const a=evaluate(train,t);if(a.count>=20&&a.ratio>=2.2&&a.ev>best.ev)best={...t,ev:a.ev,expectancyRatio:a.ratio};}
 const held=evaluate(validation,best);return {...best,eligible:held.count>=10&&held.ratio>=2.2&&held.ev>0,ev:held.ev,expectancyRatio:held.ratio,samples:held.count};
}
export function calibratedThresholds(){const columns=db.prepare('PRAGMA table_info(dip_events)').all() as {name:string}[];if(!columns.some(c=>c.name==='exhaustion_decay_pct'))db.exec('ALTER TABLE dip_events ADD COLUMN exhaustion_decay_pct REAL');return calibrate(db.prepare('SELECT * FROM dip_events WHERE timestamp<? ORDER BY timestamp').all(Date.now()-900000) as Sample[]);}
