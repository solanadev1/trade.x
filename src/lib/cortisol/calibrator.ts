import {emotionWindow,type EmotionTrade} from '../db/cortisolDb';
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

export type EmotionFeatures = { emotionExhaustion: number; emotionAbsorption: number; emotionApexRatio: number; emotionBuyVelocity: number };
export const emotionFeatureNames = ['emotionExhaustion','emotionAbsorption','emotionApexRatio','emotionBuyVelocity'] as const;
db.exec(`
CREATE TABLE IF NOT EXISTS emotion_skip_learning(
 emotion_id TEXT PRIMARY KEY, emotion_mint TEXT NOT NULL, emotion_started INTEGER NOT NULL,
 emotion_deadline INTEGER NOT NULL, emotion_entry REAL NOT NULL, emotion_peak REAL NOT NULL,
 emotion_features TEXT NOT NULL, emotion_trades TEXT NOT NULL,
 emotion_status TEXT NOT NULL, emotion_false_negative INTEGER, emotion_learned INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS emotion_skip_deadline ON emotion_skip_learning(emotion_status,emotion_deadline);
CREATE TABLE IF NOT EXISTS emotion_z_weights(emotion_key TEXT PRIMARY KEY,emotion_weight REAL NOT NULL);
`);
export function emotionZScores(emotionInput:EmotionFeatures) {
 const emotionRows=db.prepare("SELECT emotion_features FROM emotion_skip_learning WHERE emotion_status='GRADED' ORDER BY emotion_started DESC LIMIT 500").all() as {emotion_features:string}[];
 const emotionHistory=emotionRows.map(emotionRow=>JSON.parse(emotionRow.emotion_features) as EmotionFeatures);
 const emotionResult={} as EmotionFeatures;
 for(const emotionKey of emotionFeatureNames){const emotionValues=emotionHistory.map(emotionSample=>emotionSample[emotionKey]).filter(Number.isFinite);
 const emotionMean=emotionValues.reduce((emotionSum,emotionValue)=>emotionSum+emotionValue,0)/(emotionValues.length||1);
 const emotionVariance=emotionValues.reduce((emotionSum,emotionValue)=>emotionSum+(emotionValue-emotionMean)**2,0)/Math.max(1,emotionValues.length-1);
 emotionResult[emotionKey]=emotionValues.length>=20&&emotionVariance>0?Math.max(-3,Math.min(3,(emotionInput[emotionKey]-emotionMean)/Math.sqrt(emotionVariance))):0;
 }return emotionResult;
}
export function emotionWeightAdjustment(emotionFeatures:EmotionFeatures){const emotionZ=emotionZScores(emotionFeatures);let emotionAdjustment=0;for(const emotionKey of emotionFeatureNames){const emotionRow=db.prepare('SELECT emotion_weight FROM emotion_z_weights WHERE emotion_key=?').get(emotionKey) as {emotion_weight:number}|undefined;emotionAdjustment+=(emotionRow?.emotion_weight??0)*emotionZ[emotionKey];}return Math.max(-10,Math.min(10,emotionAdjustment));}
export function learnEmotionOutcomes(){
 // Emotion updates consume both missed runners and non-runners, never only successful skips.
 db.transaction(()=>{const emotionRows=db.prepare("SELECT emotion_id,emotion_features,emotion_false_negative,emotion_trades FROM emotion_skip_learning WHERE emotion_status='GRADED' AND emotion_learned=0 ORDER BY emotion_started").all() as {emotion_id:string;emotion_features:string;emotion_false_negative:number;emotion_trades:string}[];
 for(const emotionRow of emotionRows){const emotionFeatures=JSON.parse(emotionRow.emotion_features) as EmotionFeatures;const emotionWindowResult=emotionWindow(JSON.parse(emotionRow.emotion_trades) as EmotionTrade[]);const emotionExits=emotionWindowResult.emotionProfiles.reduce((emotionSum,emotionProfile)=>emotionSum+emotionProfile.emotionExits,0);const emotionLosses=emotionWindowResult.emotionProfiles.reduce((emotionSum,emotionProfile)=>emotionSum+emotionProfile.emotionLossExits,0);const emotionConfidence=Math.min(1,emotionWindowResult.emotionTrades.length/1000)*(.5+.5*emotionLosses/Math.max(1,emotionExits));const emotionZ=emotionZScores(emotionFeatures);const emotionPrediction=1/(1+Math.exp(-emotionWeightAdjustment(emotionFeatures)/10));
 for(const emotionKey of emotionFeatureNames){const emotionOld=(db.prepare('SELECT emotion_weight FROM emotion_z_weights WHERE emotion_key=?').get(emotionKey) as {emotion_weight:number}|undefined)?.emotion_weight??0;
 const emotionNext=Math.max(-2,Math.min(2,emotionOld*.999+.02*emotionConfidence*(emotionRow.emotion_false_negative-emotionPrediction)*emotionZ[emotionKey]));db.prepare('INSERT OR REPLACE INTO emotion_z_weights VALUES(?,?)').run(emotionKey,emotionNext);}
 db.prepare('UPDATE emotion_skip_learning SET emotion_learned=1 WHERE emotion_id=?').run(emotionRow.emotion_id);
 }}).immediate();
}
