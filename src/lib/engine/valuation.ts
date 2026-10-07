// League-aware valuation primitives shared by every engine.
//
// Two currencies, deliberately kept separate until a team's strategy blends them:
//  - NOW: projected starting-lineup points for the rest of this season (incl. playoffs),
//    computed on the actual roster so depth, byes and positional fit are accounted for.
//  - FUTURE: long-term asset value (dynasty market values, draft picks, keeper slots) with
//    a consolidation premium so four quarters never equal a dollar.
// `pointsToValue` converts NOW points into the same units as FUTURE value, calibrated from
// this league's own market (redraft values vs points above replacement).

import type { DraftPick, LeagueSnapshot, PickValue, PlayerRecord, Position } from "../types";
import { SKILL_POSITIONS } from "../types";

export interface ValuationContext {
  snap: LeagueSnapshot;
  rosteredIds: Set<string>;
  freeAgents: PlayerRecord[];
  /** Weeks left including this week (regular season). */
  regularWeeksLeft: number;
  playoffWeeks: number;
  /** Per-position waiver-level ppg (what you can replace a player with for free). */
  replacementPpg: Record<Position, number>;
  /** Value units per projected season point above replacement. */
  pointsToValue: number;
  /** Max players on the active roster (starters + bench). */
  rosterLimit: number;
  /** Projected draft slot (1..N, 1 = first pick) for each roster's next draft. */
  projectedSlot: Record<number, number>;
  /** First season that still has an undrafted rookie draft. */
  nextDraftSeason: number;
  /** Memo for pick values (cleared whenever projected slots change). */
  pickCache: Map<string, number>;
  /**
   * Keeper leagues: keeper value of the last player kept league-wide (numTeams x maxKeepers).
   * Keeping someone only helps by how much he beats what the draft gives you anyway.
   */
  keeperLine: number;
  /** Keeper values of every player, best first (drives keeper-league pick values). */
  keeperCurve: number[];
}

export const CONSOLIDATION_EXPONENT = 1.25;

/** Star premium: 10000 -> 10000, 5000 -> ~4200, 2500 -> ~1770. */
export function convex(v: number): number {
  if (v <= 0) return 0;
  return 10000 * Math.pow(v / 10000, CONSOLIDATION_EXPONENT);
}

/** Per-week expected points over the rest of the season (accounts for byes & injuries). */
export function effectivePpg(p: PlayerRecord, ctx: ValuationContext): number {
  const weeks = ctx.regularWeeksLeft + ctx.playoffWeeks;
  if (weeks <= 0) return p.ros.ppg;
  return p.ros.total / weeks;
}

/** Leagues where next year and beyond matter a lot: dynasty, or keeper leagues keeping a real core. */
export function isLongHorizon(L: { type: string; maxKeepers: number }): boolean {
  return L.type === "dynasty" || (L.type === "keeper" && L.maxKeepers >= 5);
}

/** Share of each flex slot a position typically fills (used to size positional demand). */
const FLEX_SHARE: Record<string, Partial<Record<Position, number>>> = {
  FLEX: { RB: 0.45, WR: 0.45, TE: 0.1 },
  WRRB_FLEX: { RB: 0.5, WR: 0.5 },
  REC_FLEX: { WR: 0.8, TE: 0.2 },
  SUPER_FLEX: { QB: 0.85, RB: 0.05, WR: 0.07, TE: 0.03 },
};

/** Starters per team at each position, with flex slots split fractionally. */
export function positionalDemand(slots: string[]): Record<Position, number> {
  const d: Record<Position, number> = { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DEF: 0 };
  for (const s of slots) {
    if (s in d) d[s as Position] += 1;
    else for (const [pos, share] of Object.entries(FLEX_SHARE[s] ?? {})) d[pos as Position] += share!;
  }
  return d;
}

/** Fallback dynasty value from production + age when no market source covers a player. */
const PEAK: Record<Position, [number, number]> = { QB: [24, 33], RB: [22, 26], WR: [23, 29], TE: [24, 30], K: [22, 38], DEF: [0, 99] };
export function ageMultiplier(pos: Position, age: number | null): number {
  if (age === null) return 1;
  const [lo, hi] = PEAK[pos];
  if (age < lo) return 1.05;
  if (age <= hi) return 1;
  const over = age - hi;
  const rate = pos === "RB" ? 0.22 : pos === "QB" ? 0.1 : 0.15;
  return Math.max(0.1, 1 - rate * over);
}

export function buildContext(snap: LeagueSnapshot): ValuationContext {
  const L = snap.league;
  const rosteredIds = new Set<string>();
  for (const t of snap.teams) for (const id of [...t.players, ...t.reserve, ...t.taxi]) rosteredIds.add(id);
  const freeAgents = Object.values(snap.players).filter((p) => !rosteredIds.has(p.id) && p.team);
  const regularWeeksLeft = Math.max(0, L.lastRegularSeasonWeek - L.week + 1);
  const playoffStart = Math.max(L.week, L.playoffWeekStart);
  const playoffWeeks = Math.max(0, Math.min(18, L.playoffWeekStart + 2) - playoffStart + 1);

  const ctx: ValuationContext = {
    snap,
    rosteredIds,
    freeAgents,
    regularWeeksLeft,
    playoffWeeks,
    replacementPpg: { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DEF: 0 },
    pointsToValue: 40,
    rosterLimit: L.starterSlots.length + L.benchSlots,
    projectedSlot: {},
    nextDraftSeason: Math.min(L.season + 1, ...snap.teams.flatMap((t) => t.picks.map((p) => p.season))),
    pickCache: new Map(),
    keeperLine: 0,
    keeperCurve: [],
  };

  // Replacement = the 3rd-best free agent at each position (what a savvy manager can actually get).
  for (const pos of Object.keys(ctx.replacementPpg) as Position[]) {
    const fa = freeAgents
      .filter((p) => p.position === pos)
      .map((p) => effectivePpg(p, ctx))
      .sort((a, b) => b - a);
    ctx.replacementPpg[pos] = fa[2] ?? fa[fa.length - 1] ?? 0;
  }

  // Calibrate points -> value on the league's top assets.
  const pool = Object.values(snap.players)
    .filter((p) => SKILL_POSITIONS.includes(p.position))
    .map((p) => ({ p, v: p.market.redraft ?? p.market.dynasty ?? 0 }))
    .filter((x) => x.v > 0)
    .sort((a, b) => b.v - a.v)
    .slice(0, 120);
  let vSum = 0;
  let ptsSum = 0;
  for (const { p, v } of pool) {
    const vorp = Math.max(0, p.ros.ppg - ctx.replacementPpg[p.position]) * 17;
    if (vorp <= 0) continue;
    vSum += v;
    ptsSum += vorp;
  }
  if (ptsSum > 0) ctx.pointsToValue = vSum / ptsSum;

  if (L.type === "keeper" && L.maxKeepers > 0) {
    ctx.keeperCurve = Object.values(snap.players)
      .filter((p) => SKILL_POSITIONS.includes(p.position))
      .map((p) => keeperValue(p, ctx))
      .sort((a, b) => b - a);
    ctx.keeperLine = ctx.keeperCurve[Math.min(ctx.keeperCurve.length - 1, L.numTeams * L.maxKeepers - 1)] ?? 0;
  }
  return ctx;
}

/**
 * Next-season worth of a player in a no-cost keeper league: mostly his dynasty market value
 * (which prices next year and beyond), tempered by this year's production adjusted for age.
 */
export function keeperValue(p: PlayerRecord, ctx: ValuationContext): number {
  if (p.position === "K" || p.position === "DEF") return 0;
  const dyn = futureValue(p, ctx);
  const red = p.market.redraft;
  if (red === null) return dyn;
  return Math.round(0.7 * dyn + 0.3 * red * ageMultiplier(p.position, p.age === null ? null : p.age + 1));
}

/**
 * Choose keepers the way a manager would: best value first, but a keeper beyond what you can
 * start at a position (e.g. a 3rd QB in a 1QB league) is discounted, because next year you'd
 * rather spend that slot elsewhere and draft depth.
 */
export function selectKeepers(players: PlayerRecord[], ctx: ValuationContext): { p: PlayerRecord; value: number; adjusted: number; surplus: number }[] {
  const demand = positionalDemand(ctx.snap.league.starterSlots);
  const count: Partial<Record<Position, number>> = {};
  const scored = players
    .filter((p) => p.position !== "K" && p.position !== "DEF")
    .map((p) => ({ p, value: keeperValue(p, ctx) }))
    .sort((a, b) => b.value - a.value)
    .map((x) => {
      const n = (count[x.p.position] = (count[x.p.position] ?? 0) + 1);
      const useful = Math.ceil(demand[x.p.position]) + (x.p.position === "QB" || x.p.position === "TE" ? 0 : 1);
      const factor = n <= useful ? 1 : x.p.position === "QB" || x.p.position === "TE" ? 0.35 : 0.6;
      const adjusted = Math.round(x.value * factor);
      return { ...x, adjusted, surplus: Math.max(0, convex(adjusted) - convex(ctx.keeperLine)) };
    });
  return scored.sort((a, b) => b.adjusted - a.adjusted);
}

/** Keeper surplus: how much better than the keeper line (what the draft would hand you). */
export function keeperSurplus(p: PlayerRecord, ctx: ValuationContext): number {
  return Math.max(0, convex(keeperValue(p, ctx)) - convex(ctx.keeperLine));
}

/** Long-term value of a player (dynasty market, else production x age fallback). */
export function futureValue(p: PlayerRecord, ctx: ValuationContext): number {
  if (p.market.dynasty !== null) return p.market.dynasty;
  const vorp = Math.max(0, p.ros.ppg - ctx.replacementPpg[p.position]) * 17;
  const cap = p.position === "K" || p.position === "DEF" ? 400 : 10000;
  return Math.min(cap, Math.round(vorp * ctx.pointsToValue * 0.8 * ageMultiplier(p.position, p.age)));
}

/** Market value appropriate to the league type (what the trade market would say). */
export function marketValue(p: PlayerRecord, ctx: ValuationContext): number {
  const t = ctx.snap.league.type;
  const ros = Math.max(0, p.ros.total - ctx.replacementPpg[p.position] * p.ros.games) * ctx.pointsToValue;
  const redraft = p.market.redraft ?? Math.min(10000, ros);
  if (t === "redraft") return Math.round(redraft);
  if (t === "keeper") return Math.round(0.6 * redraft + 0.4 * keeperValue(p, ctx));
  return Math.round(futureValue(p, ctx));
}

const tierOfSlot = (slot: number, n: number): PickValue["tier"] => (slot <= n / 3 ? "early" : slot > (2 * n) / 3 ? "late" : "mid");

/** Market value of a draft pick in this league. */
export function pickValue(pick: DraftPick, ctx: ValuationContext): number {
  const key = `${pick.season}:${pick.round}:${pick.originalRosterId}:${pick.slot ?? ""}`;
  let v = ctx.pickCache.get(key);
  if (v === undefined) ctx.pickCache.set(key, (v = computePickValue(pick, ctx)));
  return v;
}

function computePickValue(pick: DraftPick, ctx: ValuationContext): number {
  const L = ctx.snap.league;
  if (L.type === "redraft") return 0;
  const n = L.numTeams;
  const slot = pick.slot ?? (pick.season === ctx.nextDraftSeason ? ctx.projectedSlot[pick.originalRosterId] : undefined);

  if (L.type === "keeper") {
    // A keeper-league pick buys the player available at that spot once every team's keepers
    // are gone; its worth is how much better that player is than a last-round pick.
    const kept = n * L.maxKeepers;
    const curve = ctx.keeperCurve;
    if (!curve.length) return 0;
    const at = (overall: number) => curve[Math.min(curve.length - 1, Math.max(0, Math.round(overall) - 1))] ?? 0;
    const overall = kept + (pick.round - 1) * n + (slot ?? (n + 1) / 2);
    const lastPick = kept + L.draftRounds * n;
    const v = Math.max(0, at(overall) - at(lastPick));
    return Math.round(v * Math.pow(0.85, Math.max(0, pick.season - L.season - 1)));
  }

  const rows = ctx.snap.pickValues;
  const bySource = new Map<string, number[]>();
  const add = (src: string, v: number) => bySource.set(src, [...(bySource.get(src) ?? []), v]);
  const seasons = [...new Set(rows.map((r) => r.season))].sort((a, b) => a - b);
  for (const src of new Set(rows.map((r) => r.source))) {
    const mine = rows.filter((r) => r.source === src);
    const v = lookupPick(mine, pick.season, pick.round, slot, n);
    if (v !== null) add(src, v);
    else if (seasons.length) {
      // Beyond the published horizon: take the furthest season's generic pick, discounted 10%/yr.
      const last = Math.max(...mine.map((r) => r.season));
      const base = lookupPick(mine, last, pick.round, undefined, n);
      if (base !== null) add(src, base * Math.pow(0.9, pick.season - last));
    }
  }
  const vals = [...bySource.values()].map((v) => v[0]);
  if (vals.length) return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
  // No market data at all: generic curve (1st ~ 3000, halving each round).
  return Math.round(3000 * Math.pow(0.45, pick.round - 1) * Math.pow(0.9, Math.max(0, pick.season - L.season - 1)));
}

function lookupPick(rows: PickValue[], season: number, round: number, slot: number | undefined, n: number): number | null {
  const same = rows.filter((r) => r.season === season && r.round === round);
  if (!same.length) {
    // Missing deeper rounds: extrapolate from the deepest round we have (~45% per round).
    const deeper = rows.filter((r) => r.season === season && r.round < round).sort((a, b) => b.round - a.round)[0];
    if (!deeper) return null;
    const base = lookupPick(rows, season, deeper.round, slot, n);
    return base === null ? null : base * Math.pow(0.45, round - deeper.round);
  }
  if (slot !== undefined) {
    const exact = same.find((r) => r.slot !== undefined && Math.abs(r.slot - Math.round((slot * 12) / n)) === 0);
    if (exact) return exact.value;
    const tier = same.find((r) => r.tier === tierOfSlot(slot, n) && r.slot === undefined);
    if (tier) return tier.value;
  }
  const any = same.find((r) => r.tier === "any" && r.slot === undefined);
  if (any) return any.value;
  // Average of the slot-level rows if only those exist.
  const slots = same.filter((r) => r.slot !== undefined);
  if (slots.length) return slots.reduce((a, r) => a + r.value, 0) / slots.length;
  const tiers = same.filter((r) => r.tier !== "any");
  return tiers.length ? tiers.reduce((a, r) => a + r.value, 0) / tiers.length : null;
}

export function pickLabel(p: DraftPick, ctx: ValuationContext, ownerRosterId?: number): string {
  const n = ctx.snap.league.numTeams;
  const ord = ["", "1st", "2nd", "3rd", "4th", "5th", "6th", "7th"][p.round] ?? `R${p.round}`;
  const orig = ctx.snap.teams.find((t) => t.rosterId === p.originalRosterId);
  const via = ownerRosterId !== undefined && p.originalRosterId !== ownerRosterId && orig ? ` (via ${orig.teamName})` : "";
  if (p.slot) return `${p.season} ${p.round}.${String(p.slot).padStart(2, "0")}${via}`;
  const proj = ctx.projectedSlot[p.originalRosterId];
  if (proj && p.season === ctx.nextDraftSeason) {
    const tier = tierOfSlot(proj, n);
    return `${p.season} ${tier[0].toUpperCase()}${tier.slice(1)} ${ord}${via}`;
  }
  return `${p.season} ${ord}${via}`;
}
