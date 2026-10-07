// Waiver Wire Wizard: every free agent scored against YOUR roster: who'd start for you
// this week, who improves you for the rest of the season, who's a stash given your window,
// who to drop, and what to bid.

import type { PlayerRecord, Position } from "../types";
import type { LeagueAnalysis } from "./analysis";
import { candidates } from "./analysis";
import { expectedLineupPoints, optimalLineup } from "./lineup";
import { rosterChangeDelta } from "./trade";
import { convex, effectivePpg, futureValue, keeperSurplus } from "./valuation";

export type WaiverCategory = "plug-and-play" | "upside stash" | "handcuff" | "streamer" | "depth";

export interface WaiverRec {
  playerId: string;
  category: WaiverCategory;
  weekGain: number;
  rosPpgGain: number;
  contextGain: number;
  dropCandidate: string | null;
  faab: { low: number; high: number } | null;
  claimAdvice: string;
  score: number;
  reasons: string[];
}

export interface WaiverReport {
  rosterId: number;
  budgetRemaining: number | null;
  waiverType: string;
  recs: WaiverRec[];
  streamers: Partial<Record<Position, { playerId: string; median: number; note: string }[]>>;
  dropCandidates: { playerId: string; valueToMe: number }[];
}

export function waiverReport(an: LeagueAnalysis, rosterId: number, w?: { now: number; future: number }, limit = 30): WaiverReport {
  const ctx = an.ctx;
  const snap = ctx.snap;
  const L = snap.league;
  const team = snap.teams.find((t) => t.rosterId === rosterId)!;
  const ta = an.teams[rosterId];
  const weights = w ?? ta.strategy;
  const slots = L.starterSlots;

  const weekBase = optimalLineup(candidates(team.players, ctx, "week"), slots).total;
  const rosBase = expectedLineupPoints(candidates(team.players, ctx, "ros"), slots);

  // Cheap pre-filter, then full roster-aware evaluation on the shortlist.
  // K/DEF are handled as one-week streamers below, not as roster upgrades.
  const fas = ctx.freeAgents.filter(
    (p) =>
      p.position !== "K" &&
      p.position !== "DEF" &&
      (!["ir", "out", "pup", "sus"].includes((p.injuryStatus ?? "").toLowerCase()) || (p.market.dynasty ?? 0) > 1500),
  );
  const shortlist = fas
    .map((p) => ({
      p,
      q:
        weights.now * Math.max(0, effectivePpg(p, ctx) - ctx.replacementPpg[p.position] * 0.7) * 20 +
        weights.future * convex(futureValue(p, ctx)) / 100 +
        Math.max(0, (p.week?.median ?? 0) - (an.starterLine[p.position] ?? 0) * 0.8) * 5 +
        Math.min(30, (p.trendingAdds ?? 0) / 1000),
    }))
    .sort((a, b) => b.q - a.q)
    .slice(0, 80)
    .map((x) => x.p);

  // Players I'd drop first (least valuable to my team).
  const dropCandidates = team.players
    .map((id) => ({ playerId: id, valueToMe: -rosterChangeDelta(an, team, [{ kind: "player", id }], [], weights) }))
    .sort((a, b) => a.valueToMe - b.valueToMe)
    .slice(0, 5)
    .map((d) => ({ ...d, valueToMe: Math.round(d.valueToMe) }));

  const myStartingRBs = ta.weekLineup.slots
    .map((s) => (s.playerId ? snap.players[s.playerId] : undefined))
    .filter((p): p is PlayerRecord => Boolean(p) && p!.position === "RB");

  const recs: WaiverRec[] = [];
  for (const p of shortlist) {
    const contextGain = rosterChangeDelta(an, team, [], [{ kind: "player", id: p.id }], weights);
    const withP = [...team.players, p.id];
    const weekGain = optimalLineup(candidates(withP, ctx, "week"), slots).total - weekBase;
    const rosGain = expectedLineupPoints(candidates(withP, ctx, "ros"), slots) - rosBase;
    const reasons: string[] = [];
    let category: WaiverCategory = "depth";
    const need = ta.positions[p.position];

    if (weekGain >= 0.5) {
      category = "plug-and-play";
      reasons.push(`Starts for you this week (+${weekGain.toFixed(1)} pts over your current best lineup)`);
    }
    if (rosGain >= 0.3) reasons.push(`+${rosGain.toFixed(1)} starting pts/week for the rest of the season`);
    if (need.need >= 0.6) reasons.push(`${p.position} is a weak spot for you (${ordinal(need.rank)} of ${L.numTeams})`);
    const handcuffFor = p.position === "RB" ? myStartingRBs.find((r) => r.team && r.team === p.team) : undefined;
    if (handcuffFor) {
      if (category === "depth") category = "handcuff";
      reasons.push(`Handcuff to your starter ${handcuffFor.name}`);
    }
    if (L.type === "keeper" && keeperSurplus(p, ctx) > 0) {
      if (category === "depth") category = "upside stash";
      reasons.push(`Keeper candidate: projects above your league's keeper line for next season`);
    } else if (L.type === "dynasty" && (p.market.dynasty ?? 0) >= 1200 && weekGain < 0.5) {
      if (category === "depth") category = "upside stash";
      reasons.push(`Dynasty market value ${p.market.dynasty?.toLocaleString()}: a stash that holds value`);
    }
    if ((p.age ?? 99) <= 23 && p.yearsExp !== null && p.yearsExp <= 1 && category === "depth") {
      category = "upside stash";
      reasons.push("Young player with a path to a bigger role");
    }
    const u = p.usage;
    if (u?.snapPctLast3 !== undefined && u.snapPct !== undefined && u.snapPctLast3 - u.snapPct >= 0.08) reasons.push(`Snap share rising: ${pct(u.snapPct)} → ${pct(u.snapPctLast3)} last 3`);
    if (u?.targetShareLast3 !== undefined && u.targetShare !== undefined && u.targetShareLast3 - u.targetShare >= 0.04) reasons.push(`Target share rising: ${pct(u.targetShare)} → ${pct(u.targetShareLast3)}`);
    if (u?.carriesLast3 !== undefined && u.carriesPerGame !== undefined && u.carriesLast3 - u.carriesPerGame >= 3) reasons.push(`Carries rising: ${u.carriesPerGame} → ${u.carriesLast3} per game`);
    if ((p.trendingAdds ?? 0) >= 1000) reasons.push(`${p.trendingAdds!.toLocaleString()} Sleeper adds in 24h: expect competition`);
    if (p.byeWeek === L.week) reasons.push("On bye this week");

    const score = contextGain + Math.max(0, weekGain) * ctx.pointsToValue * weights.now * 2;
    // Skip noise: players who neither help now, nor hold value, nor protect a starter.
    if (!handcuffFor && (score < 15 || (category === "depth" && rosGain < 0.1 && weekGain < 0.1))) continue;
    recs.push({
      playerId: p.id,
      category,
      weekGain: round1(weekGain),
      rosPpgGain: round1(rosGain),
      contextGain: Math.round(contextGain),
      dropCandidate: team.players.length >= ctx.rosterLimit ? dropCandidates[0]?.playerId ?? null : null,
      faab: null,
      claimAdvice: "",
      score: Math.round(score),
      reasons,
    });
  }
  recs.sort((a, b) => b.score - a.score);
  const top = recs.slice(0, limit);

  // FAAB / priority advice
  const budget = team.faabRemaining;
  const best = top[0]?.score ?? 1;
  const seasonFactor = 0.55 + 0.45 * Math.min(1, ctx.regularWeeksLeft / 13);
  const aggression = ta.strategy.posture === "buyer" ? 1.15 : ta.strategy.posture === "seller" ? 0.85 : 1;
  for (const r of top) {
    const p = snap.players[r.playerId];
    const competition = 1 + Math.min(0.6, (p.trendingAdds ?? 0) / 40000);
    const rel = Math.max(0, r.score / Math.max(1, best));
    if (L.waiverType === "faab" && budget !== null) {
      const share = Math.pow(rel, 1.6) * 0.32 * seasonFactor * aggression * competition;
      const mid = budget * share;
      r.faab = { low: Math.max(0, Math.floor(mid * 0.75)), high: Math.min(budget, Math.max(1, Math.ceil(mid * 1.2))) };
      r.claimAdvice = r.faab.high <= 1 ? "Minimum bid or pick up after waivers clear" : `Bid $${r.faab.low}–$${r.faab.high} of your $${budget}`;
    } else {
      r.claimAdvice =
        rel >= 0.6 && r.category === "plug-and-play"
          ? `Worth your waiver priority${team.waiverPosition ? ` (#${team.waiverPosition})` : ""}`
          : "Don't burn priority. Grab him after waivers clear if he's still there";
    }
  }

  // Streamers for one-week plays at K / DEF / QB / TE.
  const streamers: WaiverReport["streamers"] = {};
  for (const pos of ["DEF", "K", "QB", "TE"] as Position[]) {
    if (!slots.some((s) => s === pos || (pos === "QB" && s === "SUPER_FLEX"))) continue;
    const myBest = Math.max(0, ...team.players.map((id) => snap.players[id]).filter((p) => p?.position === pos && p.byeWeek !== L.week).map((p) => p.week?.median ?? 0));
    const list = ctx.freeAgents
      .filter((p) => p.position === pos && (p.week?.median ?? 0) > myBest)
      .sort((a, b) => (b.week?.median ?? 0) - (a.week?.median ?? 0))
      .slice(0, 5)
      .map((p) => {
        const g = p.team ? snap.nflGames[`${L.week}:${p.team}`] : undefined;
        const opp = g ? snap.nflGames[`${L.week}:${g.opponent}`] : undefined;
        const note = g
          ? pos === "DEF"
            ? `vs ${g.opponent} (opp. implied ${opp?.impliedTotal ?? "?"})`
            : `${g.home ? "vs" : "@"} ${g.opponent}, team implied ${g.impliedTotal ?? "?"}`
          : "";
        return { playerId: p.id, median: p.week?.median ?? 0, note };
      });
    if (list.length) streamers[pos] = list;
  }

  return { rosterId, budgetRemaining: budget, waiverType: L.waiverType, recs: top, streamers, dropCandidates };
}

const round1 = (x: number) => Math.round(x * 10) / 10;
const pct = (x: number) => `${Math.round(x * 100)}%`;
function ordinal(n: number) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
