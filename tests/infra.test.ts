import {test} from 'node:test';import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {TokenBucket} from '../src/lib/cortisol/helius';
import {reconnectDelay,guardSocket} from '../src/lib/cortisol/socketHealth';
import {fundingFromTransaction} from '../src/lib/cortisol/fundingCache';
import {validTipAccounts} from '../src/lib/cortisol/executionWarm';
import {recorder} from '../src/lib/cortisol/shadowRecorder';

test('hot lane overtakes queued bulk work and bulk never spends the hot reserve',async()=>{
 const bucket=new TokenBucket(50,4,2);const order:string[]=[];
 // Burst is 4 with 2 reserved: only two bulk calls pass immediately.
 const bulk=[1,2,3,4,5].map(i=>bucket.acquire('bulk').then(()=>order.push(`bulk${i}`)));
 await new Promise(r=>setImmediate(r));
 assert.deepEqual(order,['bulk1','bulk2']);
 const started=Date.now();await bucket.acquire('hot');await bucket.acquire('hot');
 assert.ok(Date.now()-started<15,'hot lane must be served from the reserve without waiting');
 const hot=bucket.acquire('hot').then(()=>order.push('hot'));
 await Promise.all([...bulk,hot]);
 assert.ok(order.indexOf('hot')<order.indexOf('bulk3'),'hot request queued after bulk must still run first');
 assert.deepEqual(bucket.queued(),{hot:0,bulk:0});
});
test('reconnect backoff starts sub-second, doubles with jitter and is capped',()=>{
 assert.equal(reconnectDelay(0,250,8000,()=>1),250);assert.equal(reconnectDelay(0,250,8000,()=>0),125);
 assert.equal(reconnectDelay(3,250,8000,()=>1),2000);assert.equal(reconnectDelay(40,250,8000,()=>1),8000);
});
test('socket guard terminates a silent peer and a stale busy subscription',async()=>{
 class Fake extends EventEmitter{readyState=1;pings=0;terminated=false;ping(){this.pings++;}terminate(){this.terminated=true;this.readyState=3;}}
 const dead=new Fake();guardSocket(dead as never,{pingMs:10});await new Promise(r=>setTimeout(r,35));
 assert.equal(dead.pings,1);assert.equal(dead.terminated,true);
 const alive=new Fake();alive.ping=function(){this.pings++;this.emit('pong');};const release=guardSocket(alive as never,{pingMs:10});await new Promise(r=>setTimeout(r,45));
 assert.ok(alive.pings>=2);assert.equal(alive.terminated,false);release();
 const stale=new Fake();stale.ping=function(){this.pings++;this.emit('pong');};guardSocket(stale as never,{pingMs:10,staleMs:5,lastData:()=>Date.now()-1000});await new Promise(r=>setTimeout(r,25));
 assert.equal(stale.terminated,true);
});
test('first funder is read from the oldest transaction balance change',()=>{
 const tx=(err:unknown,pre:number[],post:number[],keys:string[])=>({meta:{err,preBalances:pre,postBalances:post},transaction:{message:{accountKeys:keys.map(pubkey=>({pubkey}))}}});
 assert.deepEqual(fundingFromTransaction('W',tx(null,[5e9,0],[3e9,2e9],['P','W'])),{parent:'P',fundingSol:2});
 assert.deepEqual(fundingFromTransaction('W',tx(null,[5e9],[4e9],['W'])),{parent:null,fundingSol:null});
 assert.deepEqual(fundingFromTransaction('W',tx({e:1},[5e9,0],[3e9,2e9],['P','W'])),{parent:null,fundingSol:null});
 assert.deepEqual(fundingFromTransaction('W',null),{parent:null,fundingSol:null});
});
test('tip account cache rejects malformed addresses',()=>{
 assert.deepEqual(validTipAccounts(['11111111111111111111111111111111','not-a-key',5]),['11111111111111111111111111111111']);
 assert.deepEqual(validTipAccounts(null),[]);
});
test('a reconnect gap blocks signals until the window is refilled or backfilled',()=>{
 const now=Date.now();recorder.gapAt=now;recorder.healed.clear();
 assert.equal(recorder.gapped('mintA',now+1000),true);
 recorder.healed.set('mintA',now);assert.equal(recorder.gapped('mintA',now+1000),false);
 assert.equal(recorder.gapped('mintB',now+179000),true);assert.equal(recorder.gapped('mintB',now+181000),false);
 recorder.trades.set('busy',Array.from({length:3},(_,i)=>({signature:`s${i}`,mint:'busy',wallet:'w',buy:true,sol:1,tokens:1,price:1,timestamp:now-1000})));
 assert.deepEqual(recorder.backfillTargets(now),['busy']);recorder.trades.delete('busy');recorder.gapAt=0;
});
