// Trade evaluation from BOTH managers' points of view.
//
// A trade is judged the way a real GM would judge it, not by summing a value chart:
//  1. Rebuild each roster after the deal (forced drops when over the roster limit, free-agent
//     pickups when spots open up, IR stashes).
//  2. Re-optimize each starting lineup for the rest of the season -> change in projected
//     starting points (NOW). Depth only counts when it actually covers injuries/byes.
//  3. Re-value each team's long-term assets with a consolidation premium -> change in FUTURE.
//     Keeper leagues only count players who'd make the keeper cut.
//  4. Blend NOW and FUTURE with each team's own strategy weights (contender vs rebuild...).
//  5. Separately report raw market fairness and the odds the other manager says yes.

import type { DraftPick, PlayerRecord, Position, Team } from "../types";
import { SKILL_POSITIONS } from "../types";
import type { LeagueAnalysis, Strategy } from "./analysis";
import { candidates, ordinal, teamFutureValue, teamNowPoints } from "./analysis";
import { expectedLineupPoints, optimalLineup } from "./lineup";
import { convex, effectivePpg, futureValue, isLongHorizon, marketValue, pickLabel, pickValue, positionalDemand, selectKeepers } from "./valuation";

export type Asset =
  | { kind: "player"; id: string }
  | { kind: "pick"; season: number; round: number; originalRosterId: number };

export const assetKey = (a: Asset) => (a.kind === "player" ? `p:${a.id}` : `k:${a.season}:${a.round}:${a.originalRosterId}`);

export interface TradeProposal {
  /** The proposing team ("you"). */
  fromRosterId: number;
  toRosterId: number;
  gives: Asset[];
  gets: Asset[];
}

export interface AssetView {
  key: string;
  asset: Asset;
  label: string;
  position?: Position;
  team?: string | null;
  age?: number | null;
  injury?: string | null;
  market: number;
  future: number;
  rosPpg?: number;
}

export interface PositionChange {
  position: Position;
  rankBefore: number;
  rankAfter: number;
  scoreBefore: number;
  scoreAfter: number;
}

export interface SideEval {
  rosterId: number;
  teamName: string;
  strategy: Strategy;
  gives: AssetView[];
  gets: AssetView[];
  drops: string[];
  adds: string[];
  nowDelta: number;
  ppgDelta: number;
  weekDelta: number;
  futureDelta: number;
  /** Strategy-weighted change in team value (the number that drives the grade). */
  contextDelta: number;
  marketGive: number;
  marketGet: number;
  positions: PositionChange[];
  grade: string;
  verdict: string;
  reasons: string[];
  warnings: string[];
}

export interface TradeEvaluation {
  proposal: TradeProposal;
  me: SideEval;
  them: SideEval;
  /** Market fairness from the proposer's view: +0.2 = you receive 20% more market value. */
  fairness: number;
  acceptance: { probability: number; label: string };
  headline: string;
}

export interface EvalOptions {
  /** Skip the expensive narrative pieces (used by the trade finder's search). */
  light?: boolean;
  /** Override the proposer's NOW/FUTURE weights (UI strategy slider). */
  myWeights?: { now: number; future: number };
}

// ---- Asset helpers -----------------------------------------------------------------------

export function findPick(teams: Team[], a: Extract<Asset, { kind: "pick" }>): DraftPick | undefined {
  for (const t of teams) {
    const p = t.picks.find((x) => x.season === a.season && x.round === a.round && x.originalRosterId === a.originalRosterId);
    if (p) return p;
  }
  return undefined;
}

export function assetOwner(an: LeagueAnalysis, a: Asset): number | undefined {
  const teams = an.ctx.snap.teams;
  if (a.kind === "player") return teams.find((t) => [...t.players, ...t.reserve, ...t.taxi].includes(a.id))?.rosterId;
  return findPick(teams, a)?.ownerRosterId;
}

export function viewAsset(an: LeagueAnalysis, a: Asset, ownerRosterId?: number): AssetView {
  const ctx = an.ctx;
  if (a.kind === "player") {
    const p = ctx.snap.players[a.id];
    if (!p) return { key: assetKey(a), asset: a, label: `Unknown player ${a.id}`, market: 0, future: 0 };
    return {
      key: assetKey(a),
      asset: a,
      label: p.name,
      position: p.position,
      team: p.team,
      age: p.age,
      injury: p.injuryStatus,
      market: marketValue(p, ctx),
      future: futureValue(p, ctx),
      rosPpg: Math.round(effectivePpg(p, ctx) * 10) / 10,
    };
  }
  const pick = findPick(ctx.snap.teams, a) ?? { ...a, ownerRosterId: ownerRosterId ?? a.originalRosterId };
  const v = pickValue(pick, ctx);
  return { key: assetKey(a), asset: a, label: pickLabel(pick, ctx, ownerRosterId ?? pick.ownerRosterId), market: v, future: v };
}

// ---- Team state & value ----------------------------------------------------------------

interface TeamState {
  active: string[];
  reserve: string[];
  taxi: string[];
  picks: DraftPick[];
}

function stateOf(t: Team): TeamState {
  return { active: [...t.players], reserve: [...t.reserve], taxi: [...t.taxi], picks: [...t.picks] };
}

function keepScore(p: PlayerRecord, an: LeagueAnalysis, w: { now: number; future: number }): number {
  const ctx = an.ctx;
  const weeks = ctx.regularWeeksLeft + ctx.playoffWeeks;
  const nowV = Math.max(0, effectivePpg(p, ctx) - ctx.replacementPpg[p.position] * 0.8) * weeks * ctx.pointsToValue;
  return w.now * nowV + w.future * convex(futureValue(p, ctx)) + 1;
}

/** Apply a trade to one team's state; returns forced drops and FA adds. */
function applyTrade(
  an: LeagueAnalysis,
  team: Team,
  outgoing: Asset[],
  incoming: Asset[],
  w: { now: number; future: number },
  reservedFAs: Set<string>,
): { state: TeamState; drops: string[]; adds: string[] } {
  const ctx = an.ctx;
  const L = ctx.snap.league;
  const st = stateOf(team);
  const outIds = new Set(outgoing.filter((a) => a.kind === "player").map((a) => (a as { id: string }).id));
  const outPicks = new Set(outgoing.filter((a) => a.kind === "pick").map(assetKey));
  const beforeCount = st.active.length;
  st.active = st.active.filter((id) => !outIds.has(id));
  st.reserve = st.reserve.filter((id) => !outIds.has(id));
  st.taxi = st.taxi.filter((id) => !outIds.has(id));
  st.picks = st.picks.filter((p) => !outPicks.has(assetKey({ kind: "pick", season: p.season, round: p.round, originalRosterId: p.originalRosterId })));
  for (const a of incoming) {
    if (a.kind === "pick") {
      const pk = findPick(ctx.snap.teams, a) ?? { ...a, ownerRosterId: team.rosterId };
      st.picks.push({ ...pk, ownerRosterId: team.rosterId });
      continue;
    }
    const p = ctx.snap.players[a.id];
    const irEligible = p && ["ir", "pup", "out", "sus"].includes((p.injuryStatus ?? "").toLowerCase());
    if (irEligible && st.reserve.length < L.irSlots) st.reserve.push(a.id);
    else st.active.push(a.id);
  }
  const drops: string[] = [];
  const adds: string[] = [];
  const limit = Math.max(ctx.rosterLimit, beforeCount); // leagues sometimes run over; don't punish that
  if (st.active.length > limit) {
    const incomingIds = new Set(incoming.filter((a) => a.kind === "player").map((a) => (a as { id: string }).id));
    const ranked = st.active
      .filter((id) => !incomingIds.has(id))
      .map((id) => ({ id, s: ctx.snap.players[id] ? keepScore(ctx.snap.players[id], an, w) : 0 }))
      .sort((a, b) => a.s - b.s);
    while (st.active.length > limit && ranked.length) {
      const d = ranked.shift()!;
      st.active = st.active.filter((id) => id !== d.id);
      drops.push(d.id);
    }
  } else if (st.active.length < beforeCount) {
    // Open roster spots get filled from waivers.
    // K/DEF are streamed week to week, not used to fill open roster spots.
    const fas = ctx.freeAgents
      .filter((p) => !reservedFAs.has(p.id) && p.position !== "K" && p.position !== "DEF")
      .map((p) => ({ id: p.id, s: keepScore(p, an, w) }))
      .sort((a, b) => b.s - a.s);
    while (st.active.length < beforeCount && fas.length) {
      const f = fas.shift()!;
      st.active.push(f.id);
      adds.push(f.id);
      reservedFAs.add(f.id);
    }
  }
  return { state: st, drops, adds };
}

export function teamValue(an: LeagueAnalysis, rosterId: number, st: TeamState, w: { now: number; future: number }) {
  const ctx = an.ctx;
  const odds = an.teams[rosterId]?.playoffOdds ?? 0.5;
  const now = teamNowPoints(st.active, ctx, odds);
  const future = teamFutureValue([...st.active, ...st.reserve, ...st.taxi], st.picks, ctx);
  return { now, future, total: w.now * now * ctx.pointsToValue + w.future * future };
}

// Memoize the pre-trade value per team (the trade finder evaluates thousands of deals).
const baseCache = new WeakMap<LeagueAnalysis, Map<string, ReturnType<typeof teamValue>>>();
function baseValue(an: LeagueAnalysis, team: Team, w: { now: number; future: number }) {
  let m = baseCache.get(an);
  if (!m) baseCache.set(an, (m = new Map()));
  const k = `${team.rosterId}:${w.now.toFixed(3)}:${w.future.toFixed(3)}`;
  let v = m.get(k);
  if (!v) m.set(k, (v = teamValue(an, team.rosterId, stateOf(team), w)));
  return v;
}

/** Change in a team's strategy-weighted value from adding/removing assets (FA fill / forced drops included). */
export function rosterChangeDelta(an: LeagueAnalysis, team: Team, outgoing: Asset[], incoming: Asset[], w: { now: number; future: number }): number {
  const before = baseValue(an, team, w);
  const after = applyTrade(an, team, outgoing, incoming, w, new Set());
  return teamValue(an, team.rosterId, after.state, w).total - before.total;
}

// ---- Positional ranks ------------------------------------------------------------------

function positionScores(an: LeagueAnalysis, ids: string[]): Record<Position, number> {
  const ctx = an.ctx;
  const demand = positionalDemand(ctx.snap.league.starterSlots);
  const out = {} as Record<Position, number>;
  for (const pos of Object.keys(demand) as Position[]) {
    const ppgs = ids
      .map((id) => ctx.snap.players[id])
      .filter((p) => p && p.position === pos)
      .map((p) => effectivePpg(p, ctx))
      .sort((a, b) => b - a);
    const req = demand[pos];
    const whole = Math.floor(req);
    let s = 0;
    for (let i = 0; i < whole; i++) s += ppgs[i] ?? 0;
    s += (req - whole) * (ppgs[whole] ?? 0);
    out[pos] = Math.round(s * 10) / 10;
  }
  return out;
}

function positionChanges(an: LeagueAnalysis, rosterId: number, after: string[], partnerId: number, partnerAfter: string[]): PositionChange[] {
  const mine = positionScores(an, after);
  const partner = positionScores(an, partnerAfter);
  const out: PositionChange[] = [];
  for (const pos of Object.keys(mine) as Position[]) {
    if (an.demand[pos] === 0) continue;
    const before = an.teams[rosterId].positions[pos];
    const others = Object.values(an.teams)
      .filter((t) => t.rosterId !== rosterId)
      .map((t) => (t.rosterId === partnerId ? partner[pos] : t.positions[pos].score));
    const rankAfter = 1 + others.filter((s) => s > mine[pos]).length;
    if (Math.abs(mine[pos] - before.score) < 0.05) continue;
    out.push({ position: pos, rankBefore: before.rank, rankAfter, scoreBefore: before.score, scoreAfter: mine[pos] });
  }
  return out;
}

// ---- Grading -----------------------------------------------------------------------------

function grade(r: number): { grade: string; verdict: string } {
  if (r >= 0.3) return { grade: "A+", verdict: "Smash accept" };
  if (r >= 0.18) return { grade: "A", verdict: "Big win" };
  if (r >= 0.1) return { grade: "A-", verdict: "Clear win" };
  if (r >= 0.05) return { grade: "B+", verdict: "Solid win" };
  if (r >= 0.015) return { grade: "B", verdict: "Slight edge" };
  if (r >= -0.03) return { grade: "C", verdict: "Roughly even" };
  if (r >= -0.08) return { grade: "C-", verdict: "Slight loss" };
  if (r >= -0.15) return { grade: "D", verdict: "Losing deal" };
  return { grade: "F", verdict: "Decline" };
}

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

export function acceptanceLabel(p: number): string {
  if (p >= 0.65) return "Likely accepts";
  if (p >= 0.45) return "Coin flip";
  if (p >= 0.25) return "Needs a sweetener";
  return "Likely rejects";
}

// ---- Main evaluation -------------------------------------------------------------------

export function evaluateTrade(an: LeagueAnalysis, proposal: TradeProposal, opts: EvalOptions = {}): TradeEvaluation {
  const ctx = an.ctx;
  const snap = ctx.snap;
  const A = snap.teams.find((t) => t.rosterId === proposal.fromRosterId)!;
  const B = snap.teams.find((t) => t.rosterId === proposal.toRosterId)!;
  const wA = opts.myWeights ?? an.teams[A.rosterId].strategy;
  const wB = an.teams[B.rosterId].strategy;
  const reserved = new Set<string>();

  const aAfter = applyTrade(an, A, proposal.gives, proposal.gets, wA, reserved);
  const bAfter = applyTrade(an, B, proposal.gets, proposal.gives, wB, reserved);

  const side = (team: Team, w: { now: number; future: number }, after: ReturnType<typeof applyTrade>, gives: Asset[], gets: Asset[], partner: Team, partnerAfter: ReturnType<typeof applyTrade>): SideEval => {
    const before = baseValue(an, team, w);
    const aft = teamValue(an, team.rosterId, after.state, w);
    const giveViews = gives.map((a) => viewAsset(an, a, team.rosterId));
    const getViews = gets.map((a) => viewAsset(an, a, partner.rosterId));
    const marketGive = giveViews.reduce((s, v) => s + convex(v.market), 0);
    const marketGet = getViews.reduce((s, v) => s + convex(v.market), 0);
    const nowDelta = aft.now - before.now;
    const futureDelta = aft.future - before.future;
    const contextDelta = aft.total - before.total;
    const scale = Math.max(1500, (marketGive + marketGet) / 2);
    const g = grade(contextDelta / scale);
    const strategy = an.teams[team.rosterId].strategy;
    const res: SideEval = {
      rosterId: team.rosterId,
      teamName: team.teamName,
      strategy,
      gives: giveViews,
      gets: getViews,
      drops: after.drops,
      adds: after.adds,
      nowDelta: Math.round(nowDelta * 10) / 10,
      ppgDelta: 0,
      weekDelta: 0,
      futureDelta: Math.round(futureDelta),
      contextDelta: Math.round(contextDelta),
      marketGive: Math.round(marketGive),
      marketGet: Math.round(marketGet),
      positions: [],
      grade: g.grade,
      verdict: g.verdict,
      reasons: [],
      warnings: [],
    };
    if (!opts.light) {
      const L = snap.league;
      const ppgBefore = an.teams[team.rosterId].lineupPpg;
      const ppgAfter = expectedLineupPoints(candidates(after.state.active, ctx, "ros"), L.starterSlots);
      res.ppgDelta = Math.round((ppgAfter - ppgBefore) * 10) / 10;
      const weekAfter = optimalLineup(candidates(after.state.active, ctx, "week"), L.starterSlots).total;
      res.weekDelta = Math.round((weekAfter - an.teams[team.rosterId].weekProjected) * 10) / 10;
      res.positions = positionChanges(an, team.rosterId, after.state.active, partner.rosterId, partnerAfter.state.active);
      narrate(an, res, team, w);
    }
    return res;
  };

  const me = side(A, wA, aAfter, proposal.gives, proposal.gets, B, bAfter);
  const them = side(B, wB, bAfter, proposal.gets, proposal.gives, A, aAfter);
  const fairness = (me.marketGet - me.marketGive) / Math.max(1, me.marketGet, me.marketGive);
  const scaleB = Math.max(1500, (them.marketGive + them.marketGet) / 2);
  // Managers weigh their own team's needs and the "market" when they decide; they also
  // overvalue what they already own (endowment effect), hence the negative intercept.
  const p = sigmoid(6 * (0.6 * (them.contextDelta / scaleB) + 0.4 * -fairness) - 0.35);
  const acceptance = { probability: Math.round(p * 100) / 100, label: acceptanceLabel(p) };

  let headline: string;
  if (me.contextDelta > 0 && them.contextDelta > 0) headline = "Win-win: both rosters get better by their own goals";
  else if (me.contextDelta > 0) headline = p >= 0.45 ? "Good for you and plausibly acceptable" : "Good for you, but they'll probably balk";
  else if (them.contextDelta > 0) headline = "Helps them more than you";
  else headline = "Neither side clearly improves";
  if (snap.league.tradeDeadlineWeek && snap.league.week > snap.league.tradeDeadlineWeek) {
    me.warnings.unshift(`Your league's trade deadline (week ${snap.league.tradeDeadlineWeek}) has passed`);
  }
  return { proposal, me, them, fairness: Math.round(fairness * 100) / 100, acceptance, headline };
}

function narrate(an: LeagueAnalysis, s: SideEval, team: Team, w: { now: number; future: number }) {
  const ctx = an.ctx;
  const L = ctx.snap.league;
  const st = s.strategy;
  const fmt = (x: number, d = 1) => `${x > 0 ? "+" : ""}${x.toFixed(d)}`;
  const n = L.numTeams;

  if (Math.abs(s.ppgDelta) >= 0.2) {
    s.reasons.push(`${fmt(s.ppgDelta)} projected starting points per week for the rest of the season (${fmt(s.nowDelta, 0)} total)`);
  } else s.reasons.push("Starting lineup is essentially unchanged this season");
  if (Math.abs(s.weekDelta) >= 0.5) s.reasons.push(`${fmt(s.weekDelta)} points in this week's optimal lineup`);

  for (const c of s.positions) {
    if (c.rankBefore === c.rankAfter && Math.abs(c.scoreAfter - c.scoreBefore) < 1) continue;
    const dir = c.rankAfter < c.rankBefore ? "improves" : c.rankAfter > c.rankBefore ? "drops" : "holds";
    s.reasons.push(`${c.position} room ${dir}: ${ordinal(c.rankBefore)} → ${ordinal(c.rankAfter)} of ${n}`);
    const need = an.teams[team.rosterId].positions[c.position];
    if (c.rankAfter < c.rankBefore && need.need >= 0.6) s.reasons.push(`Addresses a real need at ${c.position}`);
    if (c.rankAfter > c.rankBefore && need.need >= 0.5) s.warnings.push(`Weakens ${c.position}, which is already a weak spot`);
  }

  if (L.type !== "redraft" && Math.abs(s.futureDelta) >= 150) {
    const good = s.futureDelta > 0;
    const flavor =
!good && st.future >= 0.6 ? ` (a steep price for a ${st.label.toLowerCase()} team)` : !good && st.now >= 0.6 ? " (an acceptable price for a team in win-now mode)" : good && st.now >= 0.6 ? " (nice bonus, but points matter more to you right now)" : "";
    s.reasons.push(`${good ? "Gains" : "Costs"} ${Math.abs(s.futureDelta).toLocaleString()} in long-term asset value${flavor}`);
  }

  // Age profile
  const ages = (vs: AssetView[]) => vs.filter((v) => v.position && SKILL_POSITIONS.includes(v.position) && v.age).map((v) => ({ a: v.age!, w: Math.max(1, v.future) }));
  const avgAge = (xs: { a: number; w: number }[]) => xs.reduce((s2, x) => s2 + x.a * x.w, 0) / Math.max(1, xs.reduce((s2, x) => s2 + x.w, 0));
  const gi = ages(s.gets);
  const go = ages(s.gives);
  if (isLongHorizon(L) && gi.length && go.length) {
    const d = avgAge(gi) - avgAge(go);
    if (Math.abs(d) >= 1.5) {
      s.reasons.push(`${d < 0 ? "Gets younger" : "Gets older"} by ${Math.abs(d).toFixed(1)} years (value-weighted)`);
      if (d > 0 && st.window === "rebuild") s.warnings.push("Adds age to a rebuilding roster");
    }
  }

  // Consolidation
  const best = [...s.gets, ...s.gives].sort((a, b) => b.market - a.market)[0];
  if (best && s.gets.includes(best) && s.gives.length > s.gets.length) s.reasons.push(`Consolidation: you land the best asset in the deal (${best.label})`);
  if (best && s.gives.includes(best) && s.gets.length > s.gives.length) {
    s.reasons.push(`Depth-for-star: you give up the best asset in the deal (${best.label})`);
  }

  // Keeper logic
  if (L.type === "keeper" && L.maxKeepers > 0) {
    const keepIds = selectKeepers(
      [...team.players, ...team.reserve, ...team.taxi, ...s.gets.filter((g) => g.asset.kind === "player").map((g) => (g.asset as { id: string }).id)]
        .filter((id) => !s.gives.some((g) => g.asset.kind === "player" && (g.asset as { id: string }).id === id))
        .map((id) => ctx.snap.players[id])
        .filter(Boolean),
      ctx,
    )
      .slice(0, L.maxKeepers)
      .map((k) => k.p.id);
    for (const g of s.gets) {
      if (g.asset.kind !== "player") continue;
      const id = (g.asset as { id: string }).id;
      s.reasons.push(keepIds.includes(id) ? `${g.label} would be one of your ${L.maxKeepers} keepers` : `${g.label} wouldn't make your keeper list, so he's a rental for this season`);
    }
    for (const g of s.gives) {
      if (g.asset.kind !== "player") continue;
      const id = (g.asset as { id: string }).id;
      const wasKeeper = selectKeepers(
        [...team.players, ...team.reserve, ...team.taxi].map((x) => ctx.snap.players[x]).filter(Boolean),
        ctx,
      )
        .slice(0, L.maxKeepers)
        .some((k) => k.p.id === id);
      if (wasKeeper) s.warnings.push(`${g.label} is currently one of your projected keepers`);
    }
  }

  for (const g of s.gets) {
    if (g.injury && !["questionable"].includes(g.injury.toLowerCase())) s.warnings.push(`${g.label} is currently ${g.injury}`);
    if (g.asset.kind === "pick" && /Early 1st/.test(g.label)) s.reasons.push(`${g.label} projects as a premium pick`);
  }
  if (s.drops.length) s.warnings.push(`Roster crunch: you'd need to drop ${s.drops.map((id) => ctx.snap.players[id]?.name ?? id).join(", ")}`);
  if (s.adds.length) s.reasons.push(`Frees ${s.adds.length} roster spot${s.adds.length > 1 ? "s" : ""} (e.g. pick up ${s.adds.map((id) => ctx.snap.players[id]?.name).join(", ")})`);

  // Window fit
  if (st.posture === "seller" && s.gets.some((g) => g.asset.kind === "pick")) s.reasons.push(`Fits a ${st.label.toLowerCase()} plan: turning points into picks`);
  if (st.posture === "buyer" && s.ppgDelta > 0.5 && s.futureDelta < 0) s.reasons.push(`Fits a ${st.label.toLowerCase()} plan: future value for points now`);
  if (w.now >= 0.6 && s.ppgDelta < -0.5) s.warnings.push("Makes you weaker this season while you're in a window to win");
}
