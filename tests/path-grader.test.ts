import {test} from 'node:test';import assert from 'node:assert/strict';
import {gradePath,expectancy,DEFAULT_PATH_RULES} from '../src/lib/cortisol/pathGrader';
const tape=(prices:number[],stepMs=5000)=>prices.map((price,i)=>({timestamp:2000+i*stepMs,price}));
test('a one-tick spike is not a win: the trailing exit fills at the price after the peak',()=>{
 const g=gradePath(0,tape([1,2.2,1.0,.5]));
 assert.equal(g.exit,'TRAIL');assert.equal(g.exitPrice,1.0);assert.ok(Math.abs(g.netPct!-(-3.5))<1e-9);assert.ok(Math.abs(g.peakPct!-120)<1e-9);
});
test('stop is charged at the observed price when the tape gaps through it',()=>{
 const g=gradePath(0,tape([1,.98,.6]));assert.equal(g.exit,'STOP');assert.ok(Math.abs(g.grossPct!-(-40))<1e-9);assert.ok(Math.abs(g.netPct!-(-43.5))<1e-9);
});
test('entry waits for latency, a real runner is held, and a dead bounce is timed out',()=>{
 assert.equal(gradePath(0,[{timestamp:500,price:1}]).exit,'NO_ENTRY');
 const late=gradePath(0,[{timestamp:100,price:1},{timestamp:1600,price:1.5},{timestamp:5000,price:1.5}]);assert.equal(late.entryPrice,1.5);assert.ok(Math.abs(late.netPct!+3.5)<1e-9);
 const runner=gradePath(0,tape([1,1.3,1.6,2,2.5,2.4]));assert.equal(runner.exit,'END');assert.ok(runner.netPct!>130);
 const flat=gradePath(0,tape([1,1.01,1.02,1.01,1.0],40000));assert.equal(flat.exit,'TIME');assert.ok(flat.netPct!<0);
 assert.equal(gradePath(0,tape([1,1.01,1.0],40000),{...DEFAULT_PATH_RULES,minBouncePct:0}).exit,'END');
});
test('expectancy reports uncertainty and stays negative-bounded on thin samples',()=>{
 assert.equal(expectancy([]).n,0);assert.equal(expectancy([10]).lowerPct,null);
 const e=expectancy([50,-15,-15,-15]);assert.equal(e.n,4);assert.equal(e.winRate,.25);assert.ok(Math.abs(e.meanPct!-1.25)<1e-9);assert.ok(e.lowerPct!<0);
});
