import {test} from 'node:test';import assert from 'node:assert/strict';
import {isTokenAliveAndLiquid} from '../src/lib/cortisol/attentionGate';
import {decodePumpCurve,roundTripQuote} from '../src/lib/cortisol/pumpDecoder';
test('heartbeat, migration and velocity boundaries fail closed',()=>{const m={ageSec:100,volSolLast15m:10,secondsSinceLastBuy:44,tradesLast3m:25,uniqueBuyersLast3m:12,realSolReserves:20,bondingProgress:89};assert.ok(isTokenAliveAndLiquid(m));for(const patch of [{secondsSinceLastBuy:45},{bondingProgress:90},{uniqueBuyersLast3m:11},{realSolReserves:19},{tradesLast3m:NaN}])assert.equal(isTokenAliveAndLiquid({...m,...patch}),false);});
test('binary layout and round-trip costs',()=>{const b=Buffer.alloc(81);Buffer.from([23,183,248,55,96,216,172,96]).copy(b);[1_000_000_000_000_000n,50_000_000_000n,500_000_000_000_000n,30_000_000_000n,1_000_000_000_000_000n].forEach((v,i)=>b.writeBigUInt64LE(v,8+i*8));const c=decodePumpCurve(b);assert.equal(c.realSolReserves,30_000_000_000n);const q=roundTripQuote(c,100_000_000n);assert.ok(q.cost<=100_000_000n);assert.ok(q.netPct< -2.4);assert.throws(()=>decodePumpCurve(Buffer.alloc(81)));});

test('creator occupies bytes 49–80; truncated and malformed accounts are rejected',()=>{
 const b=Buffer.alloc(81);Buffer.from([23,183,248,55,96,216,172,96]).copy(b);
 b.writeBigUInt64LE(123n,8);b.writeBigUInt64LE(456n,16);b.writeBigUInt64LE(78n,24);b.writeBigUInt64LE(90n,32);b.writeBigUInt64LE(999n,40);b[48]=1;b.fill(7,49,81);
 const c=decodePumpCurve(b);assert.equal(c.virtualTokenReserves,123n);assert.equal(c.virtualSolReserves,456n);assert.equal(c.realTokenReserves,78n);assert.equal(c.realSolReserves,90n);assert.equal(c.tokenTotalSupply,999n);assert.equal(c.complete,true);assert.deepEqual(c.creator.toBuffer(),Buffer.alloc(32,7));
 assert.throws(()=>decodePumpCurve(b.subarray(0,80)));b[48]=2;assert.throws(()=>decodePumpCurve(b));
});
