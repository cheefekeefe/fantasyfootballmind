// Team context: how strong each roster is (now and later), where it is thin or deep,
// its playoff odds, and therefore what its manager *should* be doing (contend, push chips
// in, hold, retool, rebuild).

import type { DraftPick, LeagueSnapshot, PlayerRecord, Position, Team, TeamWindow } from "../types";
import { SKILL_POSITIONS } from "../types";
import { expectedLineupPoints, optimalLineup, type LineupCandidate, type LineupResult } from "./lineup";
import { buildContext, convex, effectivePpg, futureValue, isLongHorizon, pickValue, selectKeepers, positionalDemand, type ValuationContext } from "./valuation";

export interface PositionGroup {
  position: Position;
  /** Starter-weighted ppg at the position (dedicated slots + flex share). */
  score: number;
  rank: number;
  /** Players at the position that are startable-caliber in this league. */
  startable: number;
  required: number;
  /** 0 (no need) .. 1 (dire need). */
  need: number;
  surplus: boolean;
  grade: string;
  players: string[];
}

export interface Strategy {
  window: TeamWindow;
  label: string;
  posture: "buyer" | "seller" | "hold";
  /** Weights used to blend NOW (this season) and FUTURE value for this team. */
  now: number;
  future: number;
  summary: string;
  reasons: string[];
}

export interface TeamAnalysis {
  rosterId: number;
  lineupPpg: number;
  weekLineup: LineupResult;
  weekProjected: number;
  positions: Record<Position, PositionGroup>;
  futureValue: number;
  futureRank: number;
  nowRank: number;
  powerRank: number;
  /** Value-weighted age of the 8 most valuable players. */
  coreAge: number | null;
  playoffOdds: number;
  projectedWins: number;
  expectedFinish: number;
  strategy: Strategy;
}

export interface LeagueAnalysis {
  ctx: ValuationContext;
  teams: Record<number, TeamAnalysis>;
  starterLine: Record<Position, number>;
  demand: Record<Position, number>;
}

const STRATEGY_WEIGHTS: Record<TeamWindow, { now: number; future: number; label: string; posture: Strategy["posture"] }> = {
  contender: { now: 0.7, future: 0.3, label: "Contender", posture: "buyer" },
  "win-now": { now: 0.6, future: 0.4, label: "Win-now", posture: "buyer" },
  fringe: { now: 0.45, future: 0.55, label: "Fringe", posture: "hold" },
  retool: { now: 0.3, future: 0.7, label: "Retool", posture: "seller" },
  rebuild: { now: 0.12, future: 0.88, label: "Rebuilding", posture: "seller" },
};

export function weightsFor(window: TeamWindow, leagueType: LeagueSnapshot["league"]["type"], keepers?: number, starters?: number): { now: number; future: number } {
  if (leagueType === "redraft") return { now: 1, future: 0 };
  const w = STRATEGY_WEIGHTS[window];
  if (leagueType === "keeper") {
    // Keeper leagues: the future matters in proportion to how much of a lineup you can keep.
    const share = Math.min(1, (keepers ?? 0) / Math.max(1, starters ?? 9));
    const future = Math.round(w.future * (0.25 + 0.6 * share) * 100) / 100;
    return { now: 1 - future, future };
  }
  return { now: w.now, future: w.future };
}

export function candidates(ids: string[], ctx: ValuationContext, mode: "ros" | "week"): LineupCandidate[] {
  const out: LineupCandidate[] = [];
  for (const id of ids) {
    const p = ctx.snap.players[id];
    if (!p) continue;
    out.push({ id, position: p.position, points: mode === "week" ? p.week?.median ?? 0 : effectivePpg(p, ctx) });
  }
  return out;
}

/** Projected starting-lineup points for the rest of the season (playoff weeks weighted by odds). */
export function teamNowPoints(ids: string[], ctx: ValuationContext, playoffOdds: number): number {
  const ppg = expectedLineupPoints(candidates(ids, ctx, "ros"), ctx.snap.league.starterSlots);
  const weeks = ctx.regularWeeksLeft + ctx.playoffWeeks * Math.min(1, playoffOdds + 0.1) * 1.5;
  return ppg * weeks;
}

/**
 * Long-term asset value. Dynasty: every asset counts, with a consolidation premium and
 * diminishing weight for roster depth beyond the core. Keeper: only the best `maxKeepers`
 * players carry over. Redraft: nothing carries over.
 */
export function teamFutureValue(ids: string[], picks: DraftPick[], ctx: ValuationContext): number {
  const L = ctx.snap.league;
  if (L.type === "redraft") return 0;
  const ps = ids.map((id) => ctx.snap.players[id]).filter((p): p is PlayerRecord => Boolean(p));
  let total = 0;
  if (L.type === "keeper") {
    for (const k of selectKeepers(ps, ctx).slice(0, Math.max(0, L.maxKeepers))) total += k.surplus;
  } else {
    const vals = ps.map((p) => futureValue(p, ctx)).sort((a, b) => b - a);
    const core = L.starterSlots.length + 3;
    vals.forEach((v, i) => {
      const w = i < core ? 1 : Math.max(0.15, Math.pow(0.8, i - core + 1));
      total += convex(v) * w;
    });
  }
  for (const pk of picks) total += convex(pickValue(pk, ctx)) * 0.95;
  return total;
}

export function analyzeLeague(snap: LeagueSnapshot, opts: { simulations?: number } = {}): LeagueAnalysis {
  const ctx = buildContext(snap);
  const L = snap.league;
  const demand = positionalDemand(L.starterSlots);

  // League-wide "starter line" per position: ppg of the last startable player.
  const starterLine = {} as Record<Position, number>;
  for (const pos of Object.keys(demand) as Position[]) {
    const rostered = snap.teams
      .flatMap((t) => t.players)
      .map((id) => snap.players[id])
      .filter((p) => p && p.position === pos)
      .map((p) => effectivePpg(p, ctx))
      .sort((a, b) => b - a);
    const n = Math.max(1, Math.round(demand[pos] * L.numTeams));
    starterLine[pos] = rostered[n - 1] ?? 0;
  }

  const base = snap.teams.map((t) => {
    const ros = candidates(t.players, ctx, "ros");
    const lineupPpg = expectedLineupPoints(ros, L.starterSlots);
    const weekLineup = optimalLineup(candidates(t.players, ctx, "week"), L.starterSlots);
    const positions = positionGroups(t, ctx, demand, starterLine);
    return { t, lineupPpg, weekLineup, positions, fv: 0, coreAge: coreAge(t, ctx) };
  });

  // Rank positions across the league.
  for (const pos of Object.keys(demand) as Position[]) {
    const sorted = [...base].sort((a, b) => b.positions[pos].score - a.positions[pos].score);
    sorted.forEach((b, i) => {
      const g = b.positions[pos];
      g.rank = i + 1;
      const pct = L.numTeams > 1 ? i / (L.numTeams - 1) : 0;
      const thin = g.startable < Math.ceil(g.required) + (g.required >= 1 ? 1 : 0);
      g.need = demand[pos] === 0 ? 0 : Math.min(1, Math.round((pct * 0.85 + (thin ? 0.25 : 0)) * 100) / 100);
      g.surplus = pct <= 0.34 && g.startable > Math.ceil(g.required);
      g.grade = gradeFromPct(pct);
    });
  }

  const sim = simulateSeason(snap, ctx, base.map((b) => ({ rosterId: b.t.rosterId, lineupPpg: b.lineupPpg, team: b.t })), opts.simulations ?? 2000);

  // Projected next-draft slot: worst projected finish picks first. Needed before pick values.
  const byFinish = [...base].sort((a, b) => sim[b.t.rosterId].expectedFinish - sim[a.t.rosterId].expectedFinish);
  byFinish.forEach((b, i) => (ctx.projectedSlot[b.t.rosterId] = i + 1));
  ctx.pickCache.clear();
  for (const b of base) b.fv = teamFutureValue([...b.t.players, ...b.t.reserve, ...b.t.taxi], b.t.picks, ctx);

  const nowRank = rankBy(base, (b) => b.lineupPpg);
  const futRank = rankBy(base, (b) => b.fv);
  const z = zScorer(base.map((b) => b.lineupPpg));
  const zw = zScorer(base.map((b) => sim[b.t.rosterId].expectedWins));
  const power = rankBy(base, (b) => z(b.lineupPpg) + zw(sim[b.t.rosterId].expectedWins));

  const teams: Record<number, TeamAnalysis> = {};
  for (const b of base) {
    const s = sim[b.t.rosterId];
    const analysis: TeamAnalysis = {
      rosterId: b.t.rosterId,
      lineupPpg: round1(b.lineupPpg),
      weekLineup: b.weekLineup,
      weekProjected: round1(b.weekLineup.total),
      positions: b.positions,
      futureValue: Math.round(b.fv),
      futureRank: futRank.get(b.t.rosterId)!,
      nowRank: nowRank.get(b.t.rosterId)!,
      powerRank: power.get(b.t.rosterId)!,
      coreAge: b.coreAge,
      playoffOdds: s.playoffOdds,
      projectedWins: s.expectedWins,
      expectedFinish: s.expectedFinish,
      strategy: undefined as unknown as Strategy,
    };
    analysis.strategy = classify(analysis, snap);
    teams[b.t.rosterId] = analysis;
  }
  return { ctx, teams, starterLine, demand };
}

function positionGroups(t: Team, ctx: ValuationContext, demand: Record<Position, number>, line: Record<Position, number>): Record<Position, PositionGroup> {
  const out = {} as Record<Position, PositionGroup>;
  for (const pos of Object.keys(demand) as Position[]) {
    const ps = t.players
      .map((id) => ctx.snap.players[id])
      .filter((p) => p && p.position === pos)
      .map((p) => ({ id: p.id, ppg: effectivePpg(p, ctx) }))
      .sort((a, b) => b.ppg - a.ppg);
    const req = demand[pos];
    let score = 0;
    const whole = Math.floor(req);
    for (let i = 0; i < whole; i++) score += ps[i]?.ppg ?? 0;
    score += (req - whole) * (ps[whole]?.ppg ?? 0);
    out[pos] = {
      position: pos,
      score: round1(score),
      rank: 0,
      startable: ps.filter((p) => p.ppg >= line[pos] * 0.9 && p.ppg > 0).length,
      required: Math.round(req * 100) / 100,
      need: 0,
      surplus: false,
      grade: "C",
      players: ps.map((p) => p.id),
    };
  }
  return out;
}

function coreAge(t: Team, ctx: ValuationContext): number | null {
  const ps = [...t.players, ...t.taxi]
    .map((id) => ctx.snap.players[id])
    .filter((p) => p && SKILL_POSITIONS.includes(p.position) && p.age)
    .map((p) => ({ age: p.age!, v: futureValue(p, ctx) }))
    .sort((a, b) => b.v - a.v)
    .slice(0, 8);
  const w = ps.reduce((a, p) => a + p.v, 0);
  if (!w) return null;
  return round1(ps.reduce((a, p) => a + p.age * p.v, 0) / w);
}

function classify(a: TeamAnalysis, snap: LeagueSnapshot): Strategy {
  const L = snap.league;
  const n = L.numTeams;
  const reasons: string[] = [];
  const preseason = L.week <= 1;
  const odds = a.playoffOdds;
  let window: TeamWindow;
  if (preseason) {
    window = a.nowRank <= Math.ceil(n * 0.25) ? "contender" : a.nowRank <= Math.ceil(n * 0.5) ? "win-now" : a.nowRank <= Math.ceil(n * 0.7) ? "fringe" : "rebuild";
  } else if (odds >= 0.75) window = "contender";
  else if (odds >= 0.5) window = "win-now";
  else if (odds >= 0.3) window = "fringe";
  else if (odds >= 0.12) window = "retool";
  else window = "rebuild";
  reasons.push(`${Math.round(odds * 100)}% playoff odds (${a.projectedWins.toFixed(1)} projected wins)`);
  reasons.push(`Starting lineup ranks ${ordinal(a.nowRank)} of ${n} for the rest of the season`);

  if (L.type !== "redraft") {
    reasons.push(`Long-term asset value ranks ${ordinal(a.futureRank)} of ${n}`);
    // Dynasty nuance: an old contender should push chips in now; a young, asset-rich
    // non-contender should retool rather than tear down.
    if (isLongHorizon(L) && a.coreAge !== null) {
      reasons.push(`Core age ${a.coreAge}`);
      if ((window === "contender" || window === "win-now") && a.coreAge >= 27.3) {
        window = "win-now";
        reasons.push("Aging core: the window is now, so convert future assets into points");
      }
      if (window === "rebuild" && a.futureRank <= Math.ceil(n / 3)) {
        window = "retool";
        reasons.push("Young, valuable core: retool on the fly instead of a teardown");
      }
      if (window === "fringe" && a.futureRank <= Math.ceil(n / 4) && a.coreAge < 25.5) {
        window = "retool";
        reasons.push("Elite young core: avoid paying future value for a fringe playoff run");
      }
    }
  }
  if (L.tradeDeadlineWeek && L.week > L.tradeDeadlineWeek) reasons.push(`Trade deadline (week ${L.tradeDeadlineWeek}) has passed`);

  const w = weightsFor(window, L.type, L.maxKeepers, L.starterSlots.length);
  const base = STRATEGY_WEIGHTS[window];
  const summaries: Record<TeamWindow, string> = {
    contender: "Title favorite. Buy weekly points, consolidate depth into stars, and protect your starters' floors.",
    "win-now": "Playoff team with a closing or open window. Buy upgrades at your weakest starting spots, paying with future assets you won't miss.",
    fringe: "On the bubble. Make only trades that help both now and later. Don't mortgage the future for a long shot.",
    retool: "Not a title team this year. Sell aging producers at peak value and target young starters who return value next year.",
    rebuild: "Sell vets with expiring windows to contenders for picks and young upside. Points this season don't matter much.",
  };
  return { window, label: base.label, posture: base.posture, now: w.now, future: w.future, summary: summaries[window], reasons };
}

// ---- Season simulation -----------------------------------------------------------------

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rng: () => number) {
  const u = Math.max(rng(), 1e-12);
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function zScorer(xs: number[]) {
  const m = xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, xs.length)) || 1;
  return (x: number) => (x - m) / sd;
}

interface SimResult {
  playoffOdds: number;
  expectedWins: number;
  expectedFinish: number;
}

/** Weekly team mean by week, honoring byes and injuries. */
function weeklyMeans(team: Team, ctx: ValuationContext, weeks: number[]): Record<number, number> {
  const out: Record<number, number> = {};
  const L = ctx.snap.league;
  for (const w of weeks) {
    const cands: LineupCandidate[] = [];
    for (const id of team.players) {
      const p = ctx.snap.players[id];
      if (!p) continue;
      let pts: number;
      if (w === L.week) pts = p.week?.median ?? 0;
      else if (p.byeWeek === w) pts = 0;
      else {
        const st = (p.injuryStatus ?? "").toLowerCase();
        const out = (st === "ir" || st === "pup") && w < L.week + 4;
        pts = out ? 0 : p.ros.ppg;
      }
      cands.push({ id, position: p.position, points: pts });
    }
    out[w] = expectedLineupPoints(cands, L.starterSlots, w === L.week ? 0.97 : 0.9);
  }
  return out;
}

export function simulateSeason(
  snap: LeagueSnapshot,
  ctx: ValuationContext,
  teams: { rosterId: number; lineupPpg: number; team: Team }[],
  runs: number,
): Record<number, SimResult> {
  const L = snap.league;
  const weeks: number[] = [];
  for (let w = L.week; w <= L.lastRegularSeasonWeek; w++) weeks.push(w);
  const means = new Map(teams.map((t) => [t.rosterId, weeklyMeans(t.team, ctx, weeks)]));
  const sd = new Map(
    teams.map((t) => {
      const hist = t.team.weeklyScores.filter((x) => x > 0);
      const m = hist.reduce((a, b) => a + b, 0) / Math.max(1, hist.length);
      const hsd = hist.length >= 4 ? Math.sqrt(hist.reduce((a, b) => a + (b - m) ** 2, 0) / (hist.length - 1)) : 0;
      const model = 0.19 * t.lineupPpg;
      return [t.rosterId, hist.length >= 4 ? 0.5 * hsd + 0.5 * model : model];
    }),
  );
  const ids = teams.map((t) => t.rosterId);
  const rng = mulberry32(L.week * 7919 + ids.length);
  const playoffs = new Map(ids.map((id) => [id, 0]));
  const winsAcc = new Map(ids.map((id) => [id, 0]));
  const finishAcc = new Map(ids.map((id) => [id, 0]));

  for (let r = 0; r < runs; r++) {
    const wins = new Map(teams.map((t) => [t.rosterId, t.team.record.wins + t.team.record.ties * 0.5]));
    const pf = new Map(teams.map((t) => [t.rosterId, t.team.record.pointsFor]));
    for (const w of weeks) {
      let pairs = snap.schedule[w];
      if (!pairs || !pairs.length) {
        // No published schedule: random pairings.
        const shuffled = [...ids].sort(() => rng() - 0.5);
        pairs = [];
        for (let i = 0; i + 1 < shuffled.length; i += 2) pairs.push([shuffled[i], shuffled[i + 1]]);
      }
      for (const [a, b] of pairs) {
        if (!means.has(a) || !means.has(b)) continue;
        const sa = means.get(a)![w] + gaussian(rng) * sd.get(a)!;
        const sb = means.get(b)![w] + gaussian(rng) * sd.get(b)!;
        pf.set(a, pf.get(a)! + sa);
        pf.set(b, pf.get(b)! + sb);
        if (sa > sb) wins.set(a, wins.get(a)! + 1);
        else wins.set(b, wins.get(b)! + 1);
      }
    }
    const order = [...ids].sort((x, y) => wins.get(y)! - wins.get(x)! || pf.get(y)! - pf.get(x)!);
    order.forEach((id, i) => {
      if (i < L.playoffTeams) playoffs.set(id, playoffs.get(id)! + 1);
      winsAcc.set(id, winsAcc.get(id)! + wins.get(id)!);
      finishAcc.set(id, finishAcc.get(id)! + i + 1);
    });
  }
  const out: Record<number, SimResult> = {};
  for (const id of ids) {
    out[id] = {
      playoffOdds: Math.round((playoffs.get(id)! / runs) * 1000) / 1000,
      expectedWins: round1(winsAcc.get(id)! / runs),
      expectedFinish: round1(finishAcc.get(id)! / runs),
    };
  }
  return out;
}

// ---- helpers ---------------------------------------------------------------------------

function rankBy<T extends { t: Team }>(xs: T[], f: (x: T) => number): Map<number, number> {
  const sorted = [...xs].sort((a, b) => f(b) - f(a));
  return new Map(sorted.map((x, i) => [x.t.rosterId, i + 1]));
}

function gradeFromPct(pct: number): string {
  if (pct <= 0.1) return "A+";
  if (pct <= 0.25) return "A";
  if (pct <= 0.4) return "B";
  if (pct <= 0.6) return "C";
  if (pct <= 0.8) return "D";
  return "F";
}

export function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

const round1 = (x: number) => Math.round(x * 10) / 10;
