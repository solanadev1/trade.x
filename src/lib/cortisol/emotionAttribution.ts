import {db as emotionDb} from './phaseDb';
emotionDb.exec(`CREATE TABLE IF NOT EXISTS emotion_fill_attribution(
 emotion_order TEXT PRIMARY KEY,emotion_position TEXT NOT NULL,emotion_side TEXT NOT NULL,
 emotion_paper INTEGER NOT NULL,emotion_expected_sol REAL,emotion_expected_tokens TEXT,
 emotion_actual_sol REAL,emotion_actual_tokens TEXT,emotion_network_fee_sol REAL,
 emotion_tip_sol REAL,emotion_protocol_fee_estimate_sol REAL,emotion_status TEXT NOT NULL,
 emotion_created INTEGER NOT NULL,emotion_confirmed INTEGER);
 CREATE INDEX IF NOT EXISTS emotion_fill_time ON emotion_fill_attribution(emotion_confirmed);`);
export function emotionExpectFill(emotionOrder:string,emotionPosition:string,emotionSide:string,emotionPaper:boolean,emotionSol:number|null,emotionTokens:bigint|null,emotionTip:bigint,emotionProtocolFee:number|null=null){
 emotionDb.prepare(`INSERT OR IGNORE INTO emotion_fill_attribution VALUES(?,?,?,?,?,?,NULL,NULL,NULL,?,?, 'EXPECTED',?,NULL)`).run(emotionOrder,emotionPosition,emotionSide,+emotionPaper,emotionSol,emotionTokens?.toString()??null,Number(emotionTip)/1e9,emotionProtocolFee,Date.now());
}
export function emotionConfirmFill(emotionOrder:string,emotionSol:number,emotionTokens:bigint,emotionNetworkFee:number,emotionFailed:boolean,emotionNow=Date.now()){
 if(!Number.isFinite(emotionSol)||!Number.isFinite(emotionNetworkFee)||emotionNetworkFee<0)throw new Error('Emotion invalid fill attribution');
 return emotionDb.prepare(`UPDATE emotion_fill_attribution SET emotion_actual_sol=?,emotion_actual_tokens=?,emotion_network_fee_sol=?,emotion_tip_sol=CASE WHEN ? THEN 0 ELSE emotion_tip_sol END,emotion_status=?,emotion_confirmed=? WHERE emotion_order=? AND emotion_confirmed IS NULL`).run(emotionSol,emotionTokens.toString(),emotionNetworkFee,+emotionFailed,emotionFailed?'FAILED':'CONFIRMED',emotionNow,emotionOrder).changes>0;
}
export function emotionNetAttribution(emotionSince=Date.now()-3600000){
 // Emotion wallet deltas already include fees, tips, rent and slippage; never subtract them twice.
 const emotionRows=emotionDb.prepare(`SELECT emotion_position,SUM(emotion_actual_sol) emotion_net_sol,SUM(emotion_network_fee_sol) emotion_gas_sol,SUM(CASE WHEN emotion_status='FAILED' THEN -emotion_actual_sol ELSE 0 END) emotion_failed_cost_sol,COUNT(*) emotion_fills FROM emotion_fill_attribution WHERE emotion_paper=0 AND emotion_confirmed IS NOT NULL AND emotion_position IN (SELECT emotion_position FROM emotion_fill_attribution WHERE emotion_confirmed>=?) GROUP BY emotion_position HAVING emotion_position IN (SELECT position_id FROM active_positions WHERE status='CLOSED') AND (SUM(CASE WHEN emotion_side='BUY' AND emotion_status='CONFIRMED' THEN 1 ELSE 0 END)=1 OR (SUM(CASE WHEN emotion_side='BUY' AND emotion_status='FAILED' THEN 1 ELSE 0 END)>0 AND SUM(CASE WHEN emotion_side<>'BUY' THEN 1 ELSE 0 END)=0))`).all(emotionSince) as {emotion_position:string;emotion_net_sol:number;emotion_gas_sol:number;emotion_failed_cost_sol:number;emotion_fills:number}[];
 return {emotionPositions:emotionRows,emotionNetSol:emotionRows.reduce((emotionSum,emotionRow)=>emotionSum+emotionRow.emotion_net_sol,0),emotionWinRate:emotionRows.length?emotionRows.filter(emotionRow=>emotionRow.emotion_net_sol>0).length/emotionRows.length:null,emotionSamples:emotionRows.length};
}
export function emotionFailureAllowance(){const emotionRow=emotionDb.prepare(`SELECT COALESCE(SUM(CASE WHEN emotion_status='FAILED' THEN -emotion_actual_sol ELSE 0 END)/NULLIF(COUNT(*),0),0) emotion_cost FROM emotion_fill_attribution WHERE emotion_paper=0 AND emotion_confirmed>=?`).get(Date.now()-86400000) as {emotion_cost:number};return Math.max(0,emotionRow.emotion_cost);}
