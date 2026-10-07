// Runs the expensive trade search off the main thread.
import { analyzeLeague, type LeagueAnalysis } from "../lib/engine/analysis";
import { findTrades, type FindOptions } from "../lib/engine/tradeFinder";
import type { LeagueSnapshot } from "../lib/types";

let cache: { snap: LeagueSnapshot; an: LeagueAnalysis } | null = null;

self.onmessage = (e: MessageEvent<{ id: number; snap: LeagueSnapshot; rosterId: number; opts: FindOptions }>) => {
  const { id, snap, rosterId, opts } = e.data;
  try {
    const key = (s: LeagueSnapshot) => `${s.league.id}|${s.generatedAt}|${s.league.type}|${s.league.maxKeepers}`;
    if (!cache || key(cache.snap) !== key(snap)) cache = { snap, an: analyzeLeague(snap) };
    const ideas = findTrades(cache.an, rosterId, opts);
    (self as unknown as Worker).postMessage({ id, ideas });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
