// Keeper planner for no-cost keeper leagues: who you'd keep, who's on the bubble, how your
// keeper class compares to the league's, and which good players will hit next year's draft.

import type { LeagueAnalysis } from "./analysis";
import { selectKeepers } from "./valuation";

export type KeeperStatus = "lock" | "keep" | "bubble" | "release";

export interface KeeperRow {
  playerId: string;
  keeperValue: number;
  /** Value after discounting positional redundancy (e.g. a 3rd QB). */
  adjusted: number;
  surplus: number;
  rank: number;
  status: KeeperStatus;
}

export interface KeeperPlan {
  rosterId: number;
  slots: number;
  line: number;
  rows: KeeperRow[];
  totalSurplus: number;
  leagueRank: number;
  /** Players with positive keeper surplus. */
  worthy: number;
  insights: string[];
}

function rowsFor(an: LeagueAnalysis, rosterId: number): KeeperRow[] {
  const ctx = an.ctx;
  const K = ctx.snap.league.maxKeepers;
  const t = ctx.snap.teams.find((x) => x.rosterId === rosterId)!;
  const ps = [...t.players, ...t.reserve, ...t.taxi].map((id) => ctx.snap.players[id]).filter(Boolean);
  return selectKeepers(ps, ctx)
    .map((k) => ({ playerId: k.p.id, keeperValue: k.value, adjusted: k.adjusted, surplus: Math.round(k.surplus) }))
    .map((r, i) => ({
      ...r,
      rank: i + 1,
      status: (i < Math.max(1, K - 2) && r.surplus > 0 ? "lock" : i < K ? "keep" : i < K + 3 ? "bubble" : "release") as KeeperStatus,
    }));
}

export function keeperPlan(an: LeagueAnalysis, rosterId: number): KeeperPlan {
  const ctx = an.ctx;
  const L = ctx.snap.league;
  const K = L.maxKeepers;
  const rows = rowsFor(an, rosterId);
  const totals = ctx.snap.teams
    .map((t) => ({ id: t.rosterId, s: rowsFor(an, t.rosterId).slice(0, K).reduce((a, r) => a + r.surplus, 0) }))
    .sort((a, b) => b.s - a.s);
  const totalSurplus = totals.find((x) => x.id === rosterId)!.s;
  const worthy = rows.filter((r) => r.surplus > 0).length;
  const name = (id: string) => ctx.snap.players[id]?.name ?? id;
  const insights: string[] = [];
  const window = an.teams[rosterId].strategy;

  if (worthy > K) {
    const extras = rows.filter((r) => r.surplus > 0).slice(K);
    insights.push(
      `You have ${worthy} keeper-worthy players but only ${K} slots. ${extras.map((r) => name(r.playerId)).join(", ")} ${extras.length === 1 ? "has" : "have"} no value to you next season, so package ${extras.length === 1 ? "him" : "them"} with a keeper into one better keeper, or sell for points now.`,
    );
  } else if (worthy < K) {
    insights.push(
      `Only ${worthy} of your ${K} keeper slots hold a player above the keeper line. The rest will be filled by players you could draft anyway. Target young players above the line; teams with too many keepers must give theirs away.`,
    );
  }
  const bubble = rows.filter((r) => r.status === "bubble" || (r.status === "keep" && r.surplus === 0));
  const redundant = rows.filter((r) => r.adjusted < r.keeperValue && r.keeperValue > ctx.keeperLine);
  if (redundant.length)
    insights.push(
      `Positional logjam: ${redundant.map((r) => name(r.playerId)).join(", ")} ${redundant.length === 1 ? "is" : "are"} worth keeping on paper, but you can't start ${redundant.length === 1 ? "him" : "them"} next to your other keepers. Trade from this surplus before the keeper deadline.`,
    );
  if (bubble.length) insights.push(`Bubble: ${bubble.slice(0, 4).map((r) => name(r.playerId)).join(", ")}. Their future value is near zero, so judge them on this season's points only.`);
  const surplusTeams = ctx.snap.teams
    .filter((t) => t.rosterId !== rosterId)
    .map((t) => ({ t, extra: rowsFor(an, t.rosterId).filter((r) => r.surplus > 0).length - K }))
    .filter((x) => x.extra > 0)
    .sort((a, b) => b.extra - a.extra);
  if (surplusTeams.length) {
    insights.push(
      `Teams with more keeper-worthy players than slots (natural trade partners): ${surplusTeams
        .slice(0, 4)
        .map((x) => `${x.t.teamName} (+${x.extra})`)
        .join(", ")}.`,
    );
  }
  if (window.posture === "buyer") insights.push("As a buyer, you can rent players who won't make your keeper list. Their cost to you is this season only.");
  if (window.posture === "seller") insights.push("As a seller, trade non-keepers who still score now to contenders for players or picks that improve next year's keeper class.");

  return { rosterId, slots: K, line: Math.round(ctx.keeperLine), rows, totalSurplus, leagueRank: totals.findIndex((x) => x.id === rosterId) + 1, worthy, insights };
}

/** Good players projected to be thrown back into next year's draft (not in their team's top K). */
export function projectedDraftPool(an: LeagueAnalysis, limit = 30) {
  const K = an.ctx.snap.league.maxKeepers;
  const pool: { playerId: string; ownerRosterId: number; keeperValue: number }[] = [];
  for (const t of an.ctx.snap.teams) {
    for (const r of rowsFor(an, t.rosterId).slice(K)) pool.push({ playerId: r.playerId, ownerRosterId: t.rosterId, keeperValue: r.keeperValue });
  }
  return pool.sort((a, b) => b.keeperValue - a.keeperValue).slice(0, limit);
}
