// Scores a signal the way a real position would have played out, instead of by the best price that
// printed afterwards. Peak-based labels call a trade a winner if price touched a level for one tick;
// this walks the tape in order, enters late, applies the exit rules and subtracts round-trip costs.
export type PathPoint = { timestamp: number; price: number };
export type PathRules = {
  latencyMs: number;      // entry fills at the first trade this long after the signal
  stopPct: number;        // exit when return from entry falls to -stopPct
  armPct: number;         // trailing stop becomes active once return has reached +armPct
  trailPct: number;       // exit when price falls this far below the running peak
  timeStopMs: number;     // exit if the bounce has not reached minBouncePct by this time
  minBouncePct: number;
  costPct: number;        // round trip: protocol fees both ways, price impact, tips, network fees
};
export const DEFAULT_PATH_RULES: PathRules = { latencyMs: 1500, stopPct: 15, armPct: 20, trailPct: 12, timeStopMs: 120000, minBouncePct: 5, costPct: 3.5 };
export type PathGrade = {
  exit: 'NO_ENTRY' | 'STOP' | 'TRAIL' | 'TIME' | 'END';
  netPct: number | null; grossPct: number | null; peakPct: number | null; troughPct: number | null;
  entryPrice: number | null; exitPrice: number | null; heldMs: number | null;
};

export function gradePath(signalAt: number, points: PathPoint[], rules: PathRules = DEFAULT_PATH_RULES): PathGrade {
  const tape = points.filter(point => Number.isFinite(point.price) && point.price > 0 && Number.isFinite(point.timestamp))
    .sort((a, b) => a.timestamp - b.timestamp);
  const start = tape.findIndex(point => point.timestamp >= signalAt + rules.latencyMs);
  if (start < 0) return { exit: 'NO_ENTRY', netPct: null, grossPct: null, peakPct: null, troughPct: null, entryPrice: null, exitPrice: null, heldMs: null };
  const entry = tape[start];
  let peak = entry.price, trough = entry.price;
  const pct = (price: number) => (price / entry.price - 1) * 100;
  const done = (exit: PathGrade['exit'], point: PathPoint): PathGrade => ({
    exit, grossPct: pct(point.price), netPct: pct(point.price) - rules.costPct, peakPct: pct(peak), troughPct: pct(trough),
    entryPrice: entry.price, exitPrice: point.price, heldMs: point.timestamp - entry.timestamp,
  });
  for (let index = start + 1; index < tape.length; index++) {
    const point = tape[index];
    peak = Math.max(peak, point.price); trough = Math.min(trough, point.price);
    // Exits fill at the observed price, so a gap straight through the stop is charged in full.
    if (pct(point.price) <= -rules.stopPct) return done('STOP', point);
    if (pct(peak) >= rules.armPct && point.price <= peak * (1 - rules.trailPct / 100)) return done('TRAIL', point);
    if (point.timestamp - entry.timestamp >= rules.timeStopMs && pct(peak) < rules.minBouncePct) return done('TIME', point);
  }
  return done('END', tape.at(-1)!);
}

// Expectancy with a standard error, so a handful of lucky outcomes cannot pass for an edge.
export function expectancy(netPcts: number[]) {
  const values = netPcts.filter(Number.isFinite), n = values.length;
  if (!n) return { n: 0, meanPct: null, stderrPct: null, lowerPct: null, winRate: null };
  const mean = values.reduce((sum, value) => sum + value, 0) / n;
  const variance = n > 1 ? values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (n - 1) : 0;
  const stderr = n > 1 ? Math.sqrt(variance / n) : null;
  return { n, meanPct: mean, stderrPct: stderr, lowerPct: stderr === null ? null : mean - 2 * stderr, winRate: values.filter(value => value > 0).length / n };
}
