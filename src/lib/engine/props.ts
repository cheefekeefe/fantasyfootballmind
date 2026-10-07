// Convert Vegas player props into an expected stat line.
// Prop lines are (roughly) medians with a price; we de-vig the price and shift the line to
// an expected value using a stat-appropriate distribution.

import type { Position, StatLine } from "../types";
import type { PlayerProp, PropMarket } from "../sources/odds";

/** Inverse standard normal CDF (Acklam's approximation). */
export function invNorm(p: number): number {
  const q = Math.min(Math.max(p, 1e-6), 1 - 1e-6);
  const a = [-39.6968302866538, 220.946098424521, -275.928510446969, 138.357751867269, -30.6647980661472, 2.50662827745924];
  const b = [-54.4760987982241, 161.585836858041, -155.698979859887, 66.8013118877197, -13.2806815528857];
  const c = [-0.00778489400243029, -0.322396458041136, -2.40075827716184, -2.54973253934373, 4.37466414146497, 2.93816398269878];
  const d = [0.00778469570904146, 0.32246712907004, 2.445134137143, 3.75440866190742];
  const pl = 0.02425;
  if (q < pl) {
    const t = Math.sqrt(-2 * Math.log(q));
    return (((((c[0] * t + c[1]) * t + c[2]) * t + c[3]) * t + c[4]) * t + c[5]) / ((((d[0] * t + d[1]) * t + d[2]) * t + d[3]) * t + 1);
  }
  if (q > 1 - pl) return -invNorm(1 - q);
  const t = q - 0.5;
  const r = t * t;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * t) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

export function normCdf(x: number): number {
  // Abramowitz-Stegun 7.1.26
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x * x) / 2);
  return x >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

/** P(X >= k) for Poisson(λ). */
function poissonTail(lambda: number, k: number): number {
  let term = Math.exp(-lambda);
  let cdf = 0;
  for (let i = 0; i < k; i++) {
    cdf += term;
    term *= lambda / (i + 1);
  }
  return 1 - cdf;
}

/** Solve λ so that P(X > line) = p for a count stat (line is usually x.5). */
export function poissonMeanFromLine(line: number, pOver: number): number {
  const k = Math.floor(line) + 1;
  let lo = 0.001;
  let hi = 30;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (poissonTail(mid, k) < pOver) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

// Weekly standard deviation as a fraction of the line for yardage props, plus a small
// right-skew correction (the mean of a yardage distribution sits above its median).
const YARD_MODEL: Partial<Record<PropMarket, { cv: number; skew: number; key: string }>> = {
  player_pass_yds: { cv: 0.22, skew: 0.01, key: "pass_yd" },
  player_rush_yds: { cv: 0.45, skew: 0.04, key: "rush_yd" },
  player_reception_yds: { cv: 0.55, skew: 0.06, key: "rec_yd" },
};

export function propsToStats(props: PlayerProp[], position: Position): StatLine {
  const s: StatLine = {};
  for (const p of props) {
    const ym = YARD_MODEL[p.market];
    if (ym && p.line !== null) {
      s[ym.key] = Math.max(0, p.line * (1 + ym.skew) + invNorm(p.overProb) * ym.cv * p.line);
      continue;
    }
    switch (p.market) {
      case "player_pass_tds":
        if (p.line !== null) s.pass_td = poissonMeanFromLine(p.line, p.overProb);
        break;
      case "player_pass_interceptions":
        if (p.line !== null) s.pass_int = poissonMeanFromLine(p.line, p.overProb);
        break;
      case "player_receptions":
        if (p.line !== null) s.rec = poissonMeanFromLine(p.line, p.overProb);
        break;
      case "player_anytime_td": {
        // P(>=1 TD) = 1 - e^-λ  =>  λ = -ln(1 - p). Split rushing vs receiving by position.
        const lambda = -Math.log(1 - Math.min(p.overProb, 0.95));
        const rushShare = position === "QB" ? 1 : position === "RB" ? 0.75 : position === "WR" ? 0.04 : 0;
        s.rush_td = lambda * rushShare;
        s.rec_td = lambda * (1 - rushShare);
        break;
      }
    }
  }
  return s;
}

/**
 * Overlay prop-derived stats on a baseline stat line (e.g. Sleeper's). Stats Vegas doesn't
 * price (2pt, fumbles, bonuses) come from the baseline.
 */
export function vegasStatLine(base: StatLine, props: PlayerProp[], position: Position): StatLine {
  const fromProps = propsToStats(props, position);
  return { ...stripTotals(base), ...fromProps };
}

function stripTotals(s: StatLine): StatLine {
  const { pts_ppr: _a, pts_half_ppr: _b, pts_std: _c, ...rest } = s;
  return rest;
}
