// Score any raw stat line (Sleeper stat keys) with a league's Sleeper scoring_settings.

import type { Position, StatLine } from "../types";

// Keys that are metadata / pre-computed totals rather than scorable stats.
const NON_SCORING = new Set(["gp", "gs", "pts_ppr", "pts_half_ppr", "pts_std", "adp_ppr", "adp_std", "adp_half_ppr", "pos_rank_ppr"]);

const PTS_ALLOW_BUCKETS: [string, number, number][] = [
  ["pts_allow_0", 0, 0],
  ["pts_allow_1_6", 1, 6],
  ["pts_allow_7_13", 7, 13],
  ["pts_allow_14_20", 14, 20],
  ["pts_allow_21_27", 21, 27],
  ["pts_allow_28_34", 28, 34],
  ["pts_allow_35p", 35, 999],
];

export function scoreStats(stats: StatLine, scoring: Record<string, number>, position: Position | string): number {
  let pts = 0;
  for (const [k, v] of Object.entries(stats)) {
    if (NON_SCORING.has(k) || !Number.isFinite(v)) continue;
    const w = scoring[k];
    if (w) pts += w * v;
  }
  // Position reception bonuses (TE premium etc.) are often absent from projection stat lines.
  const rec = stats.rec ?? 0;
  if (position === "TE" && scoring.bonus_rec_te && stats.bonus_rec_te === undefined) pts += rec * scoring.bonus_rec_te;
  if (position === "RB" && scoring.bonus_rec_rb && stats.bonus_rec_rb === undefined) pts += rec * scoring.bonus_rec_rb;
  if (position === "WR" && scoring.bonus_rec_wr && stats.bonus_rec_wr === undefined) pts += rec * scoring.bonus_rec_wr;
  // Team defense points-allowed tiers from a single "pts_allow" projection.
  if (position === "DEF" && stats.pts_allow !== undefined && stats.pts_allow_0 === undefined) {
    const pa = stats.pts_allow;
    const bucket = PTS_ALLOW_BUCKETS.find(([, lo, hi]) => pa >= lo && pa <= hi + 0.999);
    if (bucket && scoring[bucket[0]]) pts += scoring[bucket[0]];
  }
  return Math.round(pts * 100) / 100;
}

/** Pick the pre-computed total that best matches the league's PPR value. */
export function precomputedPoints(stats: StatLine, ppr: number): number | null {
  const key = ppr >= 0.75 ? "pts_ppr" : ppr >= 0.25 ? "pts_half_ppr" : "pts_std";
  const v = stats[key] ?? stats.pts_ppr ?? stats.pts_half_ppr ?? stats.pts_std;
  return v === undefined ? null : v;
}

/**
 * League points for a projection row. Uses the stat line when it is rich enough, otherwise
 * falls back to the source's own pre-computed totals (common for K/DEF).
 */
export function leaguePoints(stats: StatLine, scoring: Record<string, number>, position: Position | string, ppr: number): number {
  const scored = scoreStats(stats, scoring, position);
  const pre = precomputedPoints(stats, ppr);
  if (pre === null) return scored;
  if (position === "K" || position === "DEF") return scored > 0.5 ? scored : pre;
  return scored === 0 && pre > 0 ? pre : scored;
}
