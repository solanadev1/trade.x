import {canonicalPumpPoolPda} from '@pump-fun/pump-swap-sdk';
import {emotionWindow,emotionDnaProfiles,emotionFlowRatio} from '../db/cortisolDb';
import {emotionTapeSignals} from './forensicCollector';
import {emotionZScores,emotionWeightAdjustment,learnEmotionOutcomes,type EmotionFeatures} from './calibrator';
import {synthesizeEmotionConviction,emotionBuySizeDecay,emotionSecondWave} from './convictionEngine';
import {curveStream} from './curveStream';
import {orderflowEvidence,publishSignal} from './convictionEngine';
import {startWarmer,prepareAta} from './executionWarm';
import {historicalGrade} from './historicalGrade';
import {calibratedThresholds} from './calibrator';
import {collectForensics} from './forensicCollector';
import {aiSentimentGate} from './aiSentimentGate';
import {enterPosition,managePositions} from './executionEngine';
import {logRadar,metric} from './phaseDb';
import { historicalTrades, decodeTradeLogs } from './history';
import { migratedSellQuote } from './migrationQuote';
import { mintMetadata, initialRealReserves } from './chainMetadata';
import WebSocket from 'ws';
import { randomUUID } from 'crypto';
import { PublicKey } from '@solana/web3.js';
import { db } from '../db/cortisolDb';
import { rpcUrl, rpc, type Trade } from './helius';
import { PUMP_PROGRAM, curveAddress, decodePumpCurve, bondingProgress, tokenPriceSol, buyQuote, sellQuote } from './pumpDecoder';
import { isTokenAliveAndLiquid } from './attentionGate';
class Recorder {
 metadata=new Map<string,Awaited<ReturnType<typeof mintMetadata>>>(); initial?:bigint; reconnect?:ReturnType<typeof setTimeout>;
 constructor(){db.exec('CREATE TABLE IF NOT EXISTS recorder_state (id INTEGER PRIMARY KEY, payload TEXT NOT NULL)');const row=db.prepare('SELECT payload FROM recorder_state WHERE id=1').get() as {payload:string}|undefined;if(row){const saved=JSON.parse(row.payload);this.trades=new Map(saved.trades);this.cooldown=new Map(saved.cooldown);this.checkpoint=saved.checkpoint??0;}}
 persist(){db.prepare('INSERT OR REPLACE INTO recorder_state VALUES(1,?)').run(JSON.stringify({trades:[...this.trades],cooldown:[...this.cooldown],checkpoint:this.checkpoint}));}
 checkpoint=0; recovering=false; generation=0;
 merge(trades:Trade[]){emotionObserveSkipped(trades);emotionFlagStreamScalps(trades);for(const t of trades){const list=this.trades.get(t.mint)??[];if(!list.some(x=>x.signature===t.signature)){list.push(t);list.sort((a,b)=>a.timestamp-b.timestamp);this.trades.set(t.mint,list);}}}
 async recover(generation:number){this.recovering=true;const until=Date.now();try{const trades=await historicalTrades(PUMP_PROGRAM.toBase58(),this.checkpoint?Math.max(0,this.checkpoint-60000):until-900000,until);if(generation!==this.generation)return;this.merge(trades);this.checkpoint=until;this.persist();}catch(e){this.error=`Backfill failed: ${e instanceof Error?e.message:String(e)}`;if(generation===this.generation){this.running=false;this.socket?.close();}}finally{if(generation===this.generation)this.recovering=false;}}
 socket?:WebSocket; timer?:ReturnType<typeof setInterval>; running=false; error=''; busy=false; dropped=0;
 trades=new Map<string,Trade[]>(); cooldown=new Map<string,number>();
 start(){this.stop();startWarmer();const url=rpcUrl();url.protocol='wss:';this.running=true;const generation=++this.generation;this.socket=new WebSocket(url.toString());
 this.socket.on('open',()=>{void this.recover(generation);this.error='';this.socket!.send(JSON.stringify({jsonrpc:'2.0',id:1,method:'logsSubscribe',params:[{mentions:[PUMP_PROGRAM.toBase58()]},{commitment:'confirmed'}]}));});
 this.socket.on('error',()=>{this.error='WebSocket connection failed';});
 this.socket.on('close',()=>{if(this.running){this.error='Connection lost; retrying';this.reconnect=setTimeout(()=>{if(this.running)this.start();},5000);}});
 this.socket.on('message',raw=>{try{const msg=JSON.parse(raw.toString());if(msg.error){this.error=msg.error.message;return;}const v=msg.params?.result?.value;if(!v||v.err)return;
 this.merge(decodeTradeLogs(v.logs,v.signature).map(t=>({...t,observedAt:Date.now()})));void this.tick();
 }catch{this.error='Malformed stream event ignored';}});
 this.timer=setInterval(()=>{if(this.socket?.readyState!==WebSocket.OPEN&&!this.recovering){void this.recover(this.generation).then(()=>this.tick());}else void this.tick();},3000);}
 stop(){this.generation++;this.running=false;clearTimeout(this.reconnect);this.persist();if(this.timer)clearInterval(this.timer);this.socket?.removeAllListeners();this.socket?.on('error',()=>{});this.socket?.close();}
 async curve(mint:string){return curveStream.read(mint);}
 async tick(){if(this.busy||!this.running||this.recovering)return;this.busy=true;try{
 await managePositions();this.initial??=await initialRealReserves();const now=Date.now();await emotionGradeSkipped(now);const emotionRunners=await emotionWatchRunners(now);
 for(const emotionRunner of emotionRunners){const emotionRecovered=await historicalTrades(curveAddress(emotionRunner.emotion_mint).toBase58(),Math.max(emotionRunner.emotion_started,now-180000),now);this.merge(emotionRecovered);}
 for(const [mint,stored]of this.trades){try{const emotionEvaluation=emotionBeginEvaluation(mint,stored,now);const list=stored.filter(t=>t.timestamp>now-900000);this.trades.set(mint,list);if(!list.length){this.trades.delete(mint);continue;}if(list.at(-1)!.timestamp<now-45000)continue;const recent=list.filter(t=>t.timestamp>now-180000);const buys=recent.filter(t=>t.buy);if(recent.length<25||new Set(buys.map(t=>t.wallet)).size<12||!buys.length)continue;
 const metadata=this.metadata.get(mint)??await mintMetadata(mint);this.metadata.set(mint,metadata);const c=await this.curve(mint);if(!isTokenAliveAndLiquid({ageSec:Math.max(0,(now-metadata.createdAt)/1000),volSolLast15m:list.reduce((s,t)=>s+t.sol,0),secondsSinceLastBuy:(now-buys.at(-1)!.timestamp)/1000,tradesLast3m:recent.length,uniqueBuyersLast3m:new Set(buys.map(t=>t.wallet)).size,realSolReserves:Number(c.realSolReserves)/1e9,bondingProgress:bondingProgress(c,this.initial)}))continue;
 const emotionRunner=emotionRunners.find(emotionItem=>emotionItem.emotion_mint===mint);
 let emotionReentry=false;
 if(emotionRunner){const emotionHolders=await emotionHolderCount(mint);const emotionPrice=tokenPriceSol(c,metadata.decimals);const emotionPeak=Math.max(emotionRunner.emotion_peak,emotionPrice);const emotionFlowNow=emotionFlowRatio(recent,now);const emotionWave=emotionSecondWave(emotionPeak,emotionPrice,emotionRunner.emotion_holders,emotionHolders,emotionFlowNow.emotionAbsorbSol,!!emotionRunner.emotion_consumed);db.prepare('UPDATE emotion_second_wave SET emotion_peak=?,emotion_holders=?,emotion_consumed=? WHERE emotion_position=?').run(emotionPeak,emotionHolders,+emotionWave.emotionConsume,emotionRunner.emotion_position);emotionReentry=emotionWave.emotionTrigger;if(emotionReentry)logRadar(mint,'Emotion Second-Wave Re-Entry','Emotion first 40–55% shakeout with rising unique holders and Apex absorption');}
 const peak=Math.max(...recent.map(t=>t.price*10**(metadata.decimals-6))),price=tokenPriceSol(c,metadata.decimals),drop=(1-price/peak)*100;if(!emotionReentry&&(drop<25||drop>45||now-(this.cooldown.get(mint)??0)<900000))continue;
 const sells=recent.filter(t=>!t.buy),volume=sells.reduce((s,t)=>s+t.sol,0);const known=sells.filter(t=>db.prepare('SELECT wallet FROM jeeter_profiles WHERE wallet=? AND jeeter_score>=50').get(t.wallet)).reduce((s,t)=>s+t.sol,0);if(!volume||known/volume<0.3)continue;
 void prepareAta(mint).catch(()=>{});const thresholds=calibratedThresholds();const forensics=await collectForensics(mint,recent,thresholds.minExhaustionDecayPct);const emotionIntensity=Math.min(100,known/volume*40+Math.min(100,drop/45*100)*.3+Math.max(0,forensics.decayPct)*.3);const flow=await orderflowEvidence(recent,forensics.bundledWallets);const emotionFeatures:EmotionFeatures={emotionExhaustion:forensics.emotionPain.emotionExhaustionScore,emotionAbsorption:flow.absorptionPct,emotionApexRatio:forensics.emotionFlow.emotionAbsorbSol/(forensics.emotionFlow.emotionDumpSol||1),emotionBuyVelocity:recent.filter(emotionTrade=>emotionTrade.buy&&emotionTrade.timestamp>=now-10000).length/10};if(emotionEvaluation)db.prepare('UPDATE emotion_skip_learning SET emotion_features=? WHERE emotion_id=? AND emotion_started=?').run(JSON.stringify(emotionFeatures),emotionEvaluation,now);publishSignal(mint,bondingProgress(c,this.initial),emotionIntensity,flow,forensics.status==='PASS',forensics.top10Pct,0,metric('bankroll',metric('paper_cash',10)));const score=Math.min(100,known/volume*50+Math.min(25,recent.length/2)+Math.max(0,forensics.decayPct)/4);const emotionSynthesis=synthesizeEmotionConviction(score,forensics,forensics.status==='PASS'&&Date.now()-flow.measuredAt<=10000&&flow.sharedParentPct<=40,emotionWeightAdjustment(emotionFeatures));const emotionQuant=emotionReentry&&emotionSynthesis.emotionScore>0?Math.max(95,emotionSynthesis.emotionScore):emotionSynthesis.emotionScore;const emotionDecay=emotionBuySizeDecay(list,emotionDnaProfiles(),await emotionSolUsd(),now);logRadar(mint,'Emotion quant signals',JSON.stringify({emotionQuant,emotionScalp:emotionSynthesis.emotionScalp,emotionDecay}));
 if(thresholds.eligible&&forensics.status==='PASS'&&emotionQuant>=78&&known/volume*100>=thresholds.minJeeterVolPct&&(emotionReentry||(drop>=thresholds.optimalDrawdownMin&&drop<=thresholds.optimalDrawdownMax))&&recent.length>=thresholds.minTrades3m&&!metric('halted')){try{const snippets=db.prepare('SELECT body FROM social_snippets WHERE mint=? AND observed_at>? ORDER BY observed_at DESC LIMIT 20').all(mint,Date.now()-900000) as {body:string}[];const verdict=await aiSentimentGate(mint,emotionQuant,forensics.status,snippets.map(s=>s.body),{emotionZScores:emotionZScores(emotionFeatures),emotionExhaustion:emotionFeatures.emotionExhaustion,emotionDumpSol:forensics.emotionFlow.emotionDumpSol,emotionApexAbsorbSol:forensics.emotionFlow.emotionAbsorbSol,emotionDumpToAbsorption:forensics.emotionFlow.emotionDumpToAbsorption,emotionQuantScore:emotionQuant});if(verdict.classification==='ORGANIC_JEET_PANIC'&&verdict.panic_score>=78){const signal=publishSignal(mint,bondingProgress(c,this.initial),emotionIntensity,flow,true,forensics.top10Pct,verdict.narrative_score??0,metric('bankroll',metric('paper_cash',10)),verdict.emotionSource==='QUANT_TIMEOUT'?emotionQuant:Math.min(emotionQuant,verdict.panic_score));if(signal.sol>0){await enterPosition(mint,signal.score);if(emotionEvaluation)db.prepare("UPDATE emotion_skip_learning SET emotion_status='TAKEN' WHERE emotion_id=?").run(emotionEvaluation);}}}catch(e){logRadar(mint,'GATED',e instanceof Error?e.message:String(e));}}
 await new Promise(r=>setTimeout(r,600));if(!this.running)break;const fresh=await this.curve(mint);if(fresh.complete||bondingProgress(fresh,this.initial)>=90)continue;const q=buyQuote(fresh,100_000_000n);
 db.prepare(`INSERT INTO dip_events(event_id,mint,timestamp,drawdown_pct,drop_speed_sec,trades_last_3m,vol_sol_last_3m,known_jeeter_vol_pct,price_at_bottom,outcome,entry_price,tokens_raw,entry_lamports) VALUES(?,?,?,?,?,?,?,?,?,'PENDING',?,?,?)`).run(randomUUID(),mint,Date.now(),drop,Math.round((now-recent[0].timestamp)/1000),recent.length,recent.reduce((s,t)=>s+t.sol,0),known/volume*100,price,Number(q.cost)/Number(q.tokens)*10**metadata.decimals/1e9,q.tokens.toString(),q.cost.toString());db.prepare('UPDATE dip_events SET exhaustion_decay_pct=? WHERE mint=? AND timestamp>=?').run(forensics.decayPct,mint,now);this.cooldown.set(mint,now);
 }catch(e){this.error=e instanceof Error?e.message:String(e);}}
 const pending=db.prepare("SELECT * FROM dip_events WHERE outcome='PENDING' AND grade15_pnl IS NULL").all() as {event_id:string;mint:string;timestamp:number;tokens_raw:string;entry_lamports:string;grade5_pnl:number|null}[];
 for(const e of pending){try{const meta=this.metadata.get(e.mint)??await mintMetadata(e.mint);this.metadata.set(e.mint,meta);const c=await this.curve(e.mint);const quote=c.complete?await migratedSellQuote(e.mint,BigInt(e.tokens_raw)):{proceeds:sellQuote(c,BigInt(e.tokens_raw)),price:tokenPriceSol(c,meta.decimals)};const proceeds=quote.proceeds;const pnl=Number(proceeds-BigInt(e.entry_lamports))/Number(e.entry_lamports)*100;const age=Date.now()-e.timestamp;
 db.prepare('UPDATE dip_events SET grading_error=NULL,pnl_pct=?,last_price=?,last_quote_at=? WHERE event_id=?').run(pnl,quote.price,Date.now(),e.event_id);
 if(age>=300000&&e.grade5_pnl===null){const grade=await historicalGrade(e.mint,e.timestamp+300000,BigInt(e.tokens_raw),BigInt(e.entry_lamports),meta.decimals,async()=>quote);db.prepare('UPDATE dip_events SET grade5_pnl=?,price_5m_later=? WHERE event_id=?').run(grade.pnl,grade.price,e.event_id);}
 if(age>=900000){const grade=await historicalGrade(e.mint,e.timestamp+900000,BigInt(e.tokens_raw),BigInt(e.entry_lamports),meta.decimals,async()=>quote);const pnl=grade.pnl;db.prepare('UPDATE dip_events SET grade15_pnl=?,price_15m_later=?,outcome=?,grading_error=? WHERE event_id=?').run(pnl,grade.price,pnl>=35?'BOUNCE_WIN':pnl<=-15?'BLEED_LOSS':'PENDING',pnl>-15&&pnl<35?'15m finished between thresholds':null,e.event_id);}
 }catch{db.prepare('UPDATE dip_events SET grading_error=? WHERE event_id=?').run('Unable to grade curve; migrated or unavailable',e.event_id);}}
 }catch(e){this.error=e instanceof Error?e.message:'Engine error';}finally{if(this.socket?.readyState===WebSocket.OPEN)this.checkpoint=Date.now();this.persist();this.busy=false;}}
 status(){return {running:this.running,error:this.error,recovering:this.recovering,stream:curveStream.status(),logsConnected:this.socket?.readyState===WebSocket.OPEN,observed:this.trades.size};}
}
const g=globalThis as typeof globalThis &{recorder?:Recorder};export const recorder=g.recorder??=new Recorder();

export function emotionBeginEvaluation(emotionMint:string,emotionTrades:Trade[],emotionNow=Date.now()){
 const emotionExisting=db.prepare("SELECT emotion_id FROM emotion_skip_learning WHERE emotion_mint=? AND emotion_status='SKIPPED' AND emotion_deadline>?").get(emotionMint,emotionNow) as {emotion_id:string}|undefined;
 if(emotionExisting)return emotionExisting.emotion_id;
 const emotionSnapshot=emotionWindow(emotionTrades).emotionTrades.filter(emotionTrade=>emotionTrade.timestamp<=emotionNow);
 const emotionLatest=emotionSnapshot.at(-1);if(!emotionLatest)return null;
 const emotionFlow=emotionFlowRatio(emotionSnapshot,emotionNow);
 const emotionFeatures:EmotionFeatures={emotionExhaustion:0,emotionAbsorption:0,emotionApexRatio:emotionFlow.emotionAbsorbSol/(emotionFlow.emotionDumpSol||1),emotionBuyVelocity:emotionSnapshot.filter(emotionTrade=>emotionTrade.buy&&emotionTrade.timestamp>=emotionNow-10000).length/10};
 const emotionId=randomUUID();db.prepare("INSERT INTO emotion_skip_learning(emotion_id,emotion_mint,emotion_started,emotion_deadline,emotion_entry,emotion_peak,emotion_features,emotion_trades,emotion_status) VALUES(?,?,?,?,?,?,?,?,'SKIPPED')").run(emotionId,emotionMint,emotionNow,emotionNow+300000,emotionLatest.price,emotionLatest.price,JSON.stringify(emotionFeatures),JSON.stringify(emotionSnapshot));return emotionId;
}
export function emotionObserveSkipped(emotionTrades:Trade[]){
 const emotionStatement=db.prepare("UPDATE emotion_skip_learning SET emotion_peak=MAX(emotion_peak,?) WHERE emotion_mint=? AND emotion_status='SKIPPED' AND emotion_started<=? AND emotion_deadline>=?");
 db.transaction(()=>{for(const emotionTrade of emotionTrades)if(Number.isFinite(emotionTrade.price)&&emotionTrade.price>0)emotionStatement.run(emotionTrade.price,emotionTrade.mint,emotionTrade.timestamp,emotionTrade.timestamp);})();
}
export async function emotionGradeSkipped(emotionNow=Date.now()){
 const emotionRows=db.prepare("SELECT * FROM emotion_skip_learning WHERE emotion_status='SKIPPED' AND emotion_deadline<=? ORDER BY emotion_deadline LIMIT 10").all(emotionNow) as {emotion_id:string;emotion_mint:string;emotion_started:number;emotion_deadline:number;emotion_entry:number;emotion_peak:number}[];
 for(const emotionRow of emotionRows){try{
 const emotionBefore=await historicalTrades(curveAddress(emotionRow.emotion_mint).toBase58(),0,emotionRow.emotion_started);const emotionSnapshot=emotionWindow(emotionBefore.slice(-1000));db.prepare('UPDATE emotion_skip_learning SET emotion_trades=? WHERE emotion_id=?').run(JSON.stringify(emotionSnapshot.emotionTrades),emotionRow.emotion_id);
 const emotionHistory=await historicalTrades(curveAddress(emotionRow.emotion_mint).toBase58(),emotionRow.emotion_started,emotionRow.emotion_deadline);
 const emotionAmm=await historicalTrades(canonicalPumpPoolPda(new PublicKey(emotionRow.emotion_mint)).toBase58(),emotionRow.emotion_started,emotionRow.emotion_deadline,emotionRow.emotion_mint);
 const emotionPeak=Math.max(emotionRow.emotion_peak,...emotionHistory.concat(emotionAmm).map(emotionTrade=>emotionTrade.price));
 const emotionMiss=emotionPeak>emotionRow.emotion_entry*2;
 db.prepare("UPDATE emotion_skip_learning SET emotion_peak=?,emotion_false_negative=?,emotion_status='GRADED' WHERE emotion_id=? AND emotion_status='SKIPPED'").run(emotionPeak,+emotionMiss,emotionRow.emotion_id);
 if(emotionMiss)logRadar(emotionRow.emotion_mint,'Emotion False Negative','Emotion skipped token exceeded +100% within five minutes');
 }catch(emotionError){logRadar(emotionRow.emotion_mint,'Emotion learning pending',String(emotionError));}}
 learnEmotionOutcomes();
}
db.exec(`CREATE TABLE IF NOT EXISTS emotion_stream_scalps(emotion_signature TEXT PRIMARY KEY,emotion_mint TEXT NOT NULL,emotion_observed INTEGER NOT NULL);CREATE TABLE IF NOT EXISTS emotion_second_wave(emotion_position TEXT PRIMARY KEY,emotion_mint TEXT NOT NULL,emotion_started INTEGER NOT NULL,emotion_peak REAL NOT NULL,emotion_holders INTEGER,emotion_consumed INTEGER NOT NULL DEFAULT 0)`);
async function emotionWatchRunners(emotionNow:number){
 const emotionClosed=db.prepare("SELECT position_id,mint FROM active_positions WHERE status='CLOSED' AND realized_sol>sol_invested AND token_amount_raw<>'0'").all() as {position_id:string;mint:string}[];
 for(const emotionPosition of emotionClosed)db.prepare('INSERT OR IGNORE INTO emotion_second_wave(emotion_position,emotion_mint,emotion_started,emotion_peak) VALUES(?,?,?,0)').run(emotionPosition.position_id,emotionPosition.mint,emotionNow);
 return db.prepare('SELECT * FROM emotion_second_wave WHERE emotion_consumed=0').all() as {emotion_position:string;emotion_mint:string;emotion_started:number;emotion_peak:number;emotion_holders:number|null;emotion_consumed:number}[];
}
async function emotionHolderCount(emotionMint:string){const emotionOwners=new Set<string>();let emotionPrevious='';for(let emotionPage=1;;emotionPage++){const emotionResponse=await rpc<{token_accounts:{address:string;owner:string;amount:number|string}[]}>('getTokenAccounts',{mint:emotionMint,page:emotionPage,limit:1000,displayOptions:{showZeroBalance:false}} as unknown as unknown[]);const emotionAccounts=emotionResponse.token_accounts;if(!Array.isArray(emotionAccounts))throw new Error('Emotion holder data unavailable');for(const emotionAccount of emotionAccounts)if(BigInt(emotionAccount.amount)>0n&&emotionAccount.owner!==curveAddress(emotionMint).toBase58())emotionOwners.add(emotionAccount.owner);if(emotionAccounts.length<1000)break;const emotionLast=emotionAccounts.at(-1)!.address;if(emotionLast===emotionPrevious)throw new Error('Emotion holder pagination stalled');emotionPrevious=emotionLast;}return emotionOwners.size;}

let emotionUsdCache:{emotionAt:number;emotionUsd:number}|undefined;
async function emotionSolUsd(){if(emotionUsdCache&&Date.now()-emotionUsdCache.emotionAt<60000)return emotionUsdCache.emotionUsd;try{const emotionAsset=await rpc<{token_info?:{price_info?:{price_per_token?:number}}}>('getAsset',{id:'So11111111111111111111111111111111111111112'} as unknown as unknown[]);const emotionUsd=emotionAsset.token_info?.price_info?.price_per_token;if(typeof emotionUsd==='number'&&Number.isFinite(emotionUsd)&&emotionUsd>0){emotionUsdCache={emotionAt:Date.now(),emotionUsd};return emotionUsd;}}catch{}return null;}

function emotionFlagStreamScalps(emotionTrades:Trade[]){const emotionSignals=emotionTapeSignals(emotionTrades,emotionDnaProfiles());for(const emotionBuy of emotionSignals.emotionApexBuys){const emotionTrade=emotionTrades.find(emotionItem=>emotionItem.signature===emotionBuy.emotionSignature);if(!emotionTrade)continue;const emotionInserted=db.prepare('INSERT OR IGNORE INTO emotion_stream_scalps VALUES(?,?,?)').run(emotionBuy.emotionSignature,emotionTrade.mint,Date.now());if(emotionInserted.changes)logRadar(emotionTrade.mint,'Emotion immediate high-conviction scalp',JSON.stringify(emotionBuy));}}
