"use client";

import { useLeague } from "./LeagueProvider";

/** Lets the user override how much their team values this season vs. the future. */
export function StrategyControl() {
  const { an, rosterId, weights, weightOverride, setWeightOverride, snap } = useLeague();
  if (snap.league.type === "redraft") return null;
  const s = an.teams[rosterId].strategy;
  const v = Math.round(weights.now * 100);
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <span className="text-muted">Priorities:</span>
      <span className="text-xs">Future</span>
      <input type="range" min={0} max={100} step={5} value={v} onChange={(e) => setWeightOverride({ now: Number(e.target.value) / 100, future: 1 - Number(e.target.value) / 100 })} />
      <span className="text-xs">This season</span>
      <span className="font-mono text-xs text-muted">
        {v}/{100 - v}
      </span>
      {weightOverride ? (
        <button className="text-xs text-accent underline" onClick={() => setWeightOverride(null)}>
          reset to {s.label.toLowerCase()} ({Math.round(s.now * 100)}/{Math.round(s.future * 100)})
        </button>
      ) : (
        <span className="text-xs text-muted">(auto: {s.label.toLowerCase()})</span>
      )}
    </div>
  );
}
