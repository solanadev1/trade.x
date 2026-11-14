export type MintMetrics = {
  ageSec: number; volSolLast15m: number; secondsSinceLastBuy: number;
  tradesLast3m: number; uniqueBuyersLast3m: number; realSolReserves: number; bondingProgress: number;
};
export function isTokenAliveAndLiquid(m: MintMetrics): boolean {
  if (Object.values(m).some(v => !Number.isFinite(v) || v < 0)) return false;
  return (m.ageSec < 21600 || m.volSolLast15m > 50) && m.secondsSinceLastBuy < 45 &&
    m.tradesLast3m >= 25 && m.uniqueBuyersLast3m >= 12 && m.realSolReserves >= 20 && m.bondingProgress < 90;
}
