import { PublicKey } from '@solana/web3.js';
export const PUMP_PROGRAM = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
const DISCRIMINATOR = Buffer.from([23,183,248,55,96,216,172,96]);
// Legacy standard reserve, retained for explicit standalone calculations.
export const INITIAL_REAL_TOKENS = 793_100_000_000_000n;
export type Curve = { virtualTokenReserves: bigint; virtualSolReserves: bigint; realTokenReserves: bigint; realSolReserves: bigint; tokenTotalSupply: bigint; complete: boolean; creator: PublicKey };
export function curveAddress(mint: string) { return PublicKey.findProgramAddressSync([Buffer.from('bonding-curve'), new PublicKey(mint).toBuffer()], PUMP_PROGRAM)[0]; }
export function decodePumpCurve(data: Buffer): Curve {
  if (data.length < 81 || !data.subarray(0,8).equals(DISCRIMINATOR)) throw new Error('Invalid Pump bonding curve account');
  if (data[48] > 1) throw new Error('Invalid curve completion flag');
  if (data.length >= 115 && !new PublicKey(data.subarray(83,115)).equals(PublicKey.default) && !new PublicKey(data.subarray(83,115)).equals(new PublicKey('So11111111111111111111111111111111111111112'))) throw new Error('Non-SOL quote curves require a different denomination');
  const c = { virtualTokenReserves: data.readBigUInt64LE(8), virtualSolReserves: data.readBigUInt64LE(16), realTokenReserves: data.readBigUInt64LE(24), realSolReserves: data.readBigUInt64LE(32), tokenTotalSupply: data.readBigUInt64LE(40), complete: data[48] === 1, creator: new PublicKey(data.subarray(49,81)) };
  if (!c.virtualTokenReserves || !c.virtualSolReserves) throw new Error('Empty virtual reserves');
  return c;
}
export function tokenPriceSol(c: Curve, decimals = 6) { return Number(c.virtualSolReserves) / Number(c.virtualTokenReserves) * 10 ** decimals / 1e9; }
export function bondingProgress(c: Curve, initial = INITIAL_REAL_TOKENS) { return c.complete ? 100 : Math.max(0, Math.min(100, Number(initial - c.realTokenReserves) / Number(initial) * 100)); }
const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;
export function buyQuote(c: Curve, budget: bigint, feeBps = 125, tip = 10_000n) {
  if (c.complete || budget <= tip || (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > 10000)) throw new Error('Curve unavailable or invalid quote budget/fee');
  const available = budget - tip;
  const net = available * 10_000n / BigInt(10_000 + feeBps);
  const tokens = c.virtualTokenReserves * net / (c.virtualSolReserves + net);
  if (tokens <= 0n || tokens >= c.realTokenReserves) throw new Error('Insufficient curve token depth');
  const sol = ceilDiv(c.virtualSolReserves * tokens, c.virtualTokenReserves - tokens);
  const fee = ceilDiv(sol * BigInt(feeBps), 10_000n);
  const cost = sol + fee + tip;
  if (cost > budget) throw new Error('Quote exceeds budget');
  return { tokens, cost, curveAfter: { ...c, virtualSolReserves: c.virtualSolReserves + sol, virtualTokenReserves: c.virtualTokenReserves - tokens, realSolReserves: c.realSolReserves + sol, realTokenReserves: c.realTokenReserves - tokens } };
}
export function sellQuote(c: Curve, tokens: bigint, feeBps = 125, tip = 10_000n) {
  if (c.complete || tokens <= 0n || (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > 10000)) throw new Error('Curve unavailable or invalid quote');
  const gross = tokens * c.virtualSolReserves / (c.virtualTokenReserves + tokens);
  if (gross > c.realSolReserves) throw new Error('Insufficient SOL depth');
  return gross - ceilDiv(gross * BigInt(feeBps), 10_000n) - tip;
}
export function roundTripQuote(c: Curve, budget: bigint, feeBps = 125, tip = 10_000n) {
  const buy = buyQuote(c, budget, feeBps, tip); const proceeds = sellQuote(buy.curveAfter, buy.tokens, feeBps, tip);
  return { ...buy, proceeds, netPct: Number(proceeds - buy.cost) / Number(buy.cost) * 100 };
}
