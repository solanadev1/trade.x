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
 merge(trades:Trade[]){for(const t of trades){const list=this.trades.get(t.mint)??[];if(!list.some(x=>x.signature===t.signature)){list.push(t);list.sort((a,b)=>a.timestamp-b.timestamp);this.trades.set(t.mint,list);}}}
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
 await managePositions();this.initial??=await initialRealReserves();const now=Date.now();for(const [mint,stored]of this.trades){try{const list=stored.filter(t=>t.timestamp>now-900000);this.trades.set(mint,list);if(!list.length){this.trades.delete(mint);continue;}if(list.at(-1)!.timestamp<now-45000)continue;const recent=list.filter(t=>t.timestamp>now-180000);const buys=recent.filter(t=>t.buy);if(recent.length<25||new Set(buys.map(t=>t.wallet)).size<12||!buys.length)continue;
 const metadata=this.metadata.get(mint)??await mintMetadata(mint);this.metadata.set(mint,metadata);const c=await this.curve(mint);if(!isTokenAliveAndLiquid({ageSec:Math.max(0,(now-metadata.createdAt)/1000),volSolLast15m:list.reduce((s,t)=>s+t.sol,0),secondsSinceLastBuy:(now-buys.at(-1)!.timestamp)/1000,tradesLast3m:recent.length,uniqueBuyersLast3m:new Set(buys.map(t=>t.wallet)).size,realSolReserves:Number(c.realSolReserves)/1e9,bondingProgress:bondingProgress(c,this.initial)}))continue;
 const peak=Math.max(...recent.map(t=>t.price*10**(metadata.decimals-6))),price=tokenPriceSol(c,metadata.decimals),drop=(1-price/peak)*100;if(drop<25||drop>45||now-(this.cooldown.get(mint)??0)<900000)continue;
 const sells=recent.filter(t=>!t.buy),volume=sells.reduce((s,t)=>s+t.sol,0);const known=sells.filter(t=>db.prepare('SELECT wallet FROM jeeter_profiles WHERE wallet=? AND jeeter_score>=50').get(t.wallet)).reduce((s,t)=>s+t.sol,0);if(!volume||known/volume<0.3)continue;
 void prepareAta(mint).catch(()=>{});const thresholds=calibratedThresholds();const forensics=await collectForensics(mint,recent,thresholds.minExhaustionDecayPct);const emotionIntensity=Math.min(100,known/volume*40+Math.min(100,drop/45*100)*.3+Math.max(0,forensics.decayPct)*.3);const flow=await orderflowEvidence(recent,forensics.bundledWallets);publishSignal(mint,bondingProgress(c,this.initial),emotionIntensity,flow,forensics.status==='PASS',forensics.top10Pct,0,metric('bankroll',metric('paper_cash',10)));const score=Math.min(100,known/volume*50+Math.min(25,recent.length/2)+Math.max(0,forensics.decayPct)/4);logRadar(mint,forensics.status,`Score ${score.toFixed(1)}: ${forensics.reason}`);
 if(thresholds.eligible&&forensics.status==='PASS'&&score>=78&&known/volume*100>=thresholds.minJeeterVolPct&&drop>=thresholds.optimalDrawdownMin&&drop<=thresholds.optimalDrawdownMax&&recent.length>=thresholds.minTrades3m&&!metric('halted')){try{const snippets=db.prepare('SELECT body FROM social_snippets WHERE mint=? AND observed_at>? ORDER BY observed_at DESC LIMIT 20').all(mint,Date.now()-900000) as {body:string}[];const verdict=await aiSentimentGate(mint,score,forensics.status,snippets.map(s=>s.body));if(verdict.classification==='ORGANIC_JEET_PANIC'&&verdict.panic_score>=78){const signal=publishSignal(mint,bondingProgress(c,this.initial),emotionIntensity,flow,true,forensics.top10Pct,verdict.narrative_score??0,metric('bankroll',metric('paper_cash',10)));if(signal.sol>0)await enterPosition(mint,signal.score);}}catch(e){logRadar(mint,'GATED',e instanceof Error?e.message:String(e));}}
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
