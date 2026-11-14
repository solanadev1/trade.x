import {test} from 'node:test';import assert from 'node:assert/strict';
import {kellySize,convictionScore,convictionTip,clusteredReceiptPct,trailingFraction} from '../src/lib/cortisol/kelly';
const history={n:0,winRate:.99,payoffRatio:35/15};
test('Kelly applies prior, tier limits, fee floor and hard 8% ceiling',()=>{
 assert.equal(kellySize(10,54,history).sol,0);
 for(const [score,lo,hi] of [[60,.0075,.015],[80,.02,.04],[95,.05,.08]]){const q=kellySize(10,score,history);assert.ok(q.sol>=10*lo&&q.sol<=10*hi);assert.ok(q.pConv<.99);}
 assert.equal(kellySize(.1,100,history).sol,0);
 assert.equal(kellySize(10,60,{n:100,winRate:.1,payoffRatio:.2}).sol,0);
 const quarter=kellySize(10,80,{n:100,winRate:.5,payoffRatio:1},.25),half=kellySize(10,80,{n:100,winRate:.5,payoffRatio:1},.5);assert.ok(half.sol>=quarter.sol);assert.ok(half.sol<=.4);
 assert.throws(()=>kellySize(10,80,history,1));
});
test('conviction rejects unknown timing, wash parents and weak absorption, adds graduation boost',()=>{const e={emotion:75,absorptionPct:35,freshUnbundled:true,inflowScore:70,curvePct:74,forensicPass:true,top10Pct:20,sharedParentPct:20,millisecondClusteredPct:0,narrative:70};assert.equal(convictionScore({...e,absorptionPct:29}),0);assert.equal(convictionScore({...e,sharedParentPct:41}),0);assert.equal(convictionScore({...e,millisecondClusteredPct:null}),0);assert.ok(convictionScore({...e,curvePct:75})>=convictionScore(e)+15);});
test('receipt clustering uses distinct wallets and does not invent historical precision',()=>{assert.equal(clusteredReceiptPct([{wallet:'a'}]),null);assert.equal(clusteredReceiptPct([{wallet:'a',observedAt:1},{wallet:'a',observedAt:1}]),0);assert.ok(Math.abs(clusteredReceiptPct([{wallet:'a',observedAt:1},{wallet:'b',observedAt:1},{wallet:'c',observedAt:2}])!-200/3)<1e-10);});
test('tips and MAX trailing follow conviction tier',()=>{assert.equal(convictionTip(60),500000n);assert.equal(convictionTip(80),1500000n);assert.equal(convictionTip(86),3000000n);assert.equal(convictionTip(100),5000000n);assert.equal(trailingFraction(90),.08);assert.equal(trailingFraction(80),.12);});
