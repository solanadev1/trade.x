import {test} from 'node:test';import assert from 'node:assert/strict';
import {kellySize,shrunkEdge,MAX_POSITION_FRACTION,convictionScore,convictionTip,clusteredReceiptPct,trailingFraction} from '../src/lib/cortisol/kelly';
const history={n:0,winRate:.99,payoffRatio:35/15};
test('Kelly shrinks toward no edge, never adds score to win probability, and caps at 2%',()=>{
 assert.equal(kellySize(10,54,history).sol,0);
 // No history: claimed 99% win rate is ignored, only the fixed probe is allowed.
 for(const score of [60,80,95]){const q=kellySize(10,score,history);assert.equal(q.tier,'SCOUT');assert.equal(q.sol,.05);assert.ok(q.fStar<=0);}
 assert.equal(kellySize(.1,100,history).sol,0);
 assert.equal(kellySize(10,60,{n:100,winRate:.1,payoffRatio:.2}).sol,0);
 // Thirty or more trades with no edge: no trade, not even a probe.
 assert.equal(kellySize(10,95,{n:100,winRate:.5,payoffRatio:1}).sol,0);
 const strong={n:200,winRate:.6,payoffRatio:2.5};
 const low=kellySize(1000,60,strong),high=kellySize(1000,95,strong);assert.ok(high.pConv===low.pConv);assert.ok(high.pConv<.6);
 for(const q of [low,high,kellySize(1000,95,strong,.5)])assert.ok(q.sol>0&&q.fraction<=MAX_POSITION_FRACTION+1e-12);
 const thin={n:40,winRate:.5,payoffRatio:2.4};assert.ok(kellySize(1000,60,thin).sol<kellySize(1000,95,thin).sol);
 assert.ok(shrunkEdge({n:10,winRate:1,payoffRatio:5}).p<.5);
 assert.throws(()=>kellySize(10,80,history,1));
});
test('conviction rejects unknown timing, wash parents and weak absorption, adds graduation boost',()=>{const e={emotion:75,absorptionPct:35,freshUnbundled:true,inflowScore:70,curvePct:74,forensicPass:true,top10Pct:20,sharedParentPct:20,millisecondClusteredPct:0,narrative:70};assert.equal(convictionScore({...e,absorptionPct:29}),0);assert.equal(convictionScore({...e,sharedParentPct:41}),0);assert.equal(convictionScore({...e,millisecondClusteredPct:null}),0);assert.ok(convictionScore({...e,curvePct:75})>=convictionScore(e)+15);});
test('receipt clustering uses distinct wallets and does not invent historical precision',()=>{assert.equal(clusteredReceiptPct([{wallet:'a'}]),null);assert.equal(clusteredReceiptPct([{wallet:'a',observedAt:1},{wallet:'a',observedAt:1}]),0);assert.ok(Math.abs(clusteredReceiptPct([{wallet:'a',observedAt:1},{wallet:'b',observedAt:1},{wallet:'c',observedAt:2}])!-200/3)<1e-10);});
test('tips and MAX trailing follow conviction tier',()=>{assert.equal(convictionTip(60),500000n);assert.equal(convictionTip(80),1500000n);assert.equal(convictionTip(86),3000000n);assert.equal(convictionTip(100),5000000n);assert.equal(trailingFraction(90),.08);assert.equal(trailingFraction(80),.12);});
