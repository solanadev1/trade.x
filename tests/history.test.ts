import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'crypto';
import { PublicKey } from '@solana/web3.js';
import { decodeTradeLogs, rankRunners } from '../src/lib/cortisol/history';
import { PUMP_PROGRAM } from '../src/lib/cortisol/pumpDecoder';
function event(){const b=Buffer.alloc(129);createHash('sha256').update('event:TradeEvent').digest().copy(b,0,0,8);new PublicKey('So11111111111111111111111111111111111111112').toBuffer().copy(b,8);b.writeBigUInt64LE(2_000_000_000n,40);b.writeBigUInt64LE(4_000_000n,48);b[56]=1;Buffer.alloc(32,3).copy(b,57);b.writeBigInt64LE(1700000000n,89);return `Program data: ${b.toString('base64')}`;}
test('history decoder restores parent program context after CPI and preserves multiple events',()=>{const logs=[`Program ${PUMP_PROGRAM} invoke [1]`,'Program 11111111111111111111111111111111 invoke [2]','Program 11111111111111111111111111111111 success',event(),event(),`Program ${PUMP_PROGRAM} success`];const trades=decodeTradeLogs(logs,'signature');assert.equal(trades.length,2);assert.notEqual(trades[0].signature,trades[1].signature);assert.equal(trades[0].sol,2);assert.equal(trades[0].tokens,4);assert.equal(trades[0].timestamp,1700000000000);assert.deepEqual(decodeTradeLogs([event()],'signature'),[]);});
test('runner ranking sums buys and sells, sorts by SOL volume and caps at five',()=>{const base=decodeTradeLogs([`Program ${PUMP_PROGRAM} invoke [1]`,event()],'s')[0];const trades=Array.from({length:7},(_,i)=>({...base,mint:`mint${i}`,sol:i+1}));trades.push({...base,mint:'mint0',sol:100,buy:false});const ranked=rankRunners(trades);assert.equal(ranked.length,5);assert.deepEqual(ranked[0],{mint:'mint0',volumeSol:101});assert.equal(ranked[1].mint,'mint6');});
