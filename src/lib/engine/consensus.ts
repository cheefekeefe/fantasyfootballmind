// Blend multiple projections into one consensus with a floor/ceiling band.

import type { Position, ProjectionInput, SourceId, WeekProjection } from "../types";

/** Relative trust per source. Betting markets are the sharpest single signal when present. */
export const SOURCE_WEIGHTS: Partial<Record<SourceId, number>> = {
  odds: 1.4,
  fantasypros: 1.2,
  sleeper: 1.0,
  espn: 0.85,
  demo: 1.0,
};

/** Typical week-to-week coefficient of variation by position (from historical weekly scoring). */
export const POSITION_CV: Record<Position, number> = {
  QB: 0.38,
  RB: 0.5,
  WR: 0.56,
  TE: 0.6,
  K: 0.45,
  DEF: 0.65,
};

export function buildConsensus(week: number, position: Position, inputs: ProjectionInput[]): WeekProjection | null {
  const usable = inputs.filter((i) => Number.isFinite(i.points));
  if (!usable.length) return null;
  let wSum = 0;
  let mean = 0;
  for (const i of usable) {
    const w = SOURCE_WEIGHTS[i.source] ?? 1;
    wSum += w;
    mean += w * i.points;
  }
  mean /= wSum;
  // Down-weight a lone outlier: if one source sits >45% away from the others' mean, trim it by half.
  if (usable.length >= 3) {
    let adj = 0;
    let adjW = 0;
    for (const i of usable) {
      const others = usable.filter((o) => o !== i);
      const om = others.reduce((a, o) => a + o.points, 0) / others.length;
      const outlier = om > 1 && Math.abs(i.points - om) / om > 0.45;
      const w = (SOURCE_WEIGHTS[i.source] ?? 1) * (outlier ? 0.5 : 1);
      adj += w * i.points;
      adjW += w;
    }
    mean = adj / adjW;
  }
  const spread = usable.length > 1 ? Math.sqrt(usable.reduce((a, i) => a + (i.points - mean) ** 2, 0) / usable.length) : 0;
  const sd = Math.sqrt((POSITION_CV[position] * mean) ** 2 + spread ** 2);
  const agreement = mean > 0 ? Math.max(0, 1 - spread / mean) : 1;
  const r = (x: number) => Math.round(x * 10) / 10;
  return {
    week,
    inputs: usable,
    median: r(mean),
    // 20th / 80th percentiles; fantasy scoring is right-skewed so the ceiling stretches further.
    floor: r(Math.max(0, mean - 0.84 * sd * 0.9)),
    ceiling: r(mean + 0.84 * sd * 1.15),
    agreement: Math.round(agreement * 100) / 100,
  };
}

/**
 * Turn an expert positional rank into a points estimate by reading it off the curve of the
 * other sources' projections at that position (rank 1 => best projected score, etc.).
 */
export function rankToPoints(rank: number, sortedPositionPoints: number[]): number | null {
  if (!sortedPositionPoints.length || rank < 1) return null;
  const idx = rank - 1;
  if (idx >= sortedPositionPoints.length - 1) return sortedPositionPoints[sortedPositionPoints.length - 1];
  const lo = Math.floor(idx);
  const frac = idx - lo;
  return sortedPositionPoints[lo] * (1 - frac) + sortedPositionPoints[lo + 1] * frac;
}
