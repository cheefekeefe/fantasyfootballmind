// Trade Central's idea engine:
//  - Trade block: your players who are worth more on the market than to YOUR team.
//  - Targets: players on other teams worth more to you than to their current manager.
//  - Packages: concrete offers that improve your team by your goals AND have a realistic
//    chance of being accepted by theirs.

import type { PlayerRecord, Team } from "../types";
import type { LeagueAnalysis } from "./analysis";
import { assetKey, evaluateTrade, rosterChangeDelta, viewAsset, type Asset, type EvalOptions, type TradeEvaluation } from "./trade";
import { convex, effectivePpg, futureValue, marketValue, pickValue } from "./valuation";

export interface BlockCandidate {
  playerId: string;
  market: number;
  valueToMe: number;
  /** valueToMe / market (lower = better trade chip). */
  keepRatio: number;
  reasons: string[];
}

export interface TargetCandidate {
  playerId: string;
  ownerRosterId: number;
  gainToMe: number;
  costToThem: number;
  market: number;
  score: number;
  reasons: string[];
}

export interface TradeIdea {
  evaluation: TradeEvaluation;
  score: number;
}

/** Value lost if the player left (his spot refilled from waivers). */
export function marginalValue(an: LeagueAnalysis, team: Team, playerId: string, w?: { now: number; future: number }): number {
  return -rosterChangeDelta(an, team, [{ kind: "player", id: playerId }], [], w ?? an.teams[team.rosterId].strategy);
}

/** Value gained if the player joined (dropping your least valuable player if needed). */
export function additionValue(an: LeagueAnalysis, team: Team, playerId: string, w?: { now: number; future: number }): number {
  return rosterChangeDelta(an, team, [], [{ kind: "player", id: playerId }], w ?? an.teams[team.rosterId].strategy);
}

export function tradeBlock(an: LeagueAnalysis, rosterId: number, w?: { now: number; future: number }): BlockCandidate[] {
  const ctx = an.ctx;
  const team = ctx.snap.teams.find((t) => t.rosterId === rosterId)!;
  const ta = an.teams[rosterId];
  const out: BlockCandidate[] = [];
  const ros = new Set(ta.weekLineup.slots.map((s) => s.playerId));
  for (const id of [...team.players, ...team.taxi]) {
    const p = ctx.snap.players[id];
    if (!p || p.position === "K" || p.position === "DEF") continue;
    const market = convex(marketValue(p, ctx));
    if (market < 400) continue;
    const valueToMe = Math.max(0, marginalValue(an, team, id, w));
    const keepRatio = valueToMe / market;
    const reasons: string[] = [];
    const g = ta.positions[p.position];
    if (g.surplus) reasons.push(`Surplus at ${p.position}: you're ${ordinalShort(g.rank)} in the league with depth to spare`);
    if (!ros.has(id)) reasons.push("Not in your optimal starting lineup");
    reasons.push(...sellSignals(p, an, ta.strategy.window));
    if (keepRatio < 0.6) reasons.push("Worth noticeably more on the market than to your lineup");
    out.push({ playerId: id, market: Math.round(market), valueToMe: Math.round(valueToMe), keepRatio: Math.round(keepRatio * 100) / 100, reasons });
  }
  return out.sort((a, b) => a.keepRatio - b.keepRatio || b.market - a.market);
}

function sellSignals(p: PlayerRecord, an: LeagueAnalysis, window: string): string[] {
  const r: string[] = [];
  const L = an.ctx.snap.league;
  if (L.type === "dynasty" && p.age) {
    const cliff = p.position === "RB" ? 26.5 : p.position === "WR" ? 29 : p.position === "TE" ? 30 : 33;
    if (p.age >= cliff && (window === "rebuild" || window === "retool")) r.push(`Age ${p.age}: sell before the age cliff while contenders still pay for production`);
  }
  if (p.ros.actualPpg !== undefined && (p.ros.gamesPlayed ?? 0) >= 3 && p.ros.actualPpg > p.ros.ppg * 1.25 && p.ros.actualPpg - p.ros.ppg > 2.5) {
    r.push(`Sell-high: scoring ${p.ros.actualPpg} ppg vs ${p.ros.ppg} projected going forward`);
  }
  if ((p.market.trend30 ?? 0) > 400) r.push(`Market value up ${p.market.trend30} over 30 days`);
  return r;
}

function buySignals(p: PlayerRecord, an: LeagueAnalysis): string[] {
  const r: string[] = [];
  if (p.ros.actualPpg !== undefined && (p.ros.gamesPlayed ?? 0) >= 3 && p.ros.ppg > p.ros.actualPpg * 1.25 && p.ros.ppg - p.ros.actualPpg > 2.5) {
    r.push(`Buy-low: ${p.ros.actualPpg} ppg so far, projected ${p.ros.ppg} going forward`);
  }
  if ((p.market.trend30 ?? 0) < -400) r.push(`Market value down ${Math.abs(p.market.trend30!)} over 30 days`);
  const u = p.usage;
  if (u?.targetShareLast3 && u.targetShare && u.targetShareLast3 - u.targetShare > 0.04) r.push(`Target share rising (${pct(u.targetShare)} → ${pct(u.targetShareLast3)} last 3)`);
  if (u?.snapPctLast3 && u.snapPct && u.snapPctLast3 - u.snapPct > 0.08) r.push(`Snap share rising (${pct(u.snapPct)} → ${pct(u.snapPctLast3)} last 3)`);
  void an;
  return r;
}

export function tradeTargets(an: LeagueAnalysis, rosterId: number, w?: { now: number; future: number }, limit = 40): TargetCandidate[] {
  const ctx = an.ctx;
  const me = ctx.snap.teams.find((t) => t.rosterId === rosterId)!;
  const mine = an.teams[rosterId];
  // Pre-filter by a cheap heuristic so we only run full roster evaluations on plausible names.
  const pool: { p: PlayerRecord; owner: Team }[] = [];
  for (const t of ctx.snap.teams) {
    if (t.rosterId === rosterId) continue;
    for (const id of [...t.players, ...t.taxi]) {
      const p = ctx.snap.players[id];
      if (!p || p.position === "K" || p.position === "DEF") continue;
      if (marketValue(p, ctx) < 500) continue;
      pool.push({ p, owner: t });
    }
  }
  const quick = pool
    .map((x) => {
      const need = mine.positions[x.p.position]?.need ?? 0;
      const weights = w ?? mine.strategy;
      const nowish = Math.max(0, effectivePpg(x.p, ctx) - an.starterLine[x.p.position] * 0.9) * (ctx.regularWeeksLeft + 2) * ctx.pointsToValue;
      return { ...x, q: (weights.now * nowish * (0.5 + need) + weights.future * convex(futureValue(x.p, ctx))) };
    })
    .sort((a, b) => b.q - a.q)
    .slice(0, 90);

  const out: TargetCandidate[] = [];
  for (const { p, owner } of quick) {
    const gainToMe = additionValue(an, me, p.id, w);
    if (gainToMe <= 0) continue;
    const costToThem = Math.max(0, marginalValue(an, owner, p.id));
    const market = convex(marketValue(p, ctx));
    const reasons: string[] = [];
    const need = mine.positions[p.position];
    if (need.need >= 0.5) reasons.push(`Fills your ${p.position} need (you rank ${ordinalShort(need.rank)})`);
    const theirs = an.teams[owner.rosterId];
    if (theirs.positions[p.position].surplus) reasons.push(`${owner.teamName} is deep at ${p.position}`);
    if (theirs.strategy.posture === "seller" && (p.age ?? 0) >= 26) reasons.push(`${owner.teamName} is ${theirs.strategy.label.toLowerCase()}: a vet like this is a natural sell for them`);
    if (theirs.strategy.posture === "buyer" && costToThem < market * 0.5) reasons.push(`Barely moves the needle for ${owner.teamName}'s lineup`);
    reasons.push(...buySignals(p, an));
    // Arbitrage first (worth more to you than to them), impact as the tie-breaker.
    const score = gainToMe - costToThem + 0.25 * gainToMe;
    out.push({ playerId: p.id, ownerRosterId: owner.rosterId, gainToMe: Math.round(gainToMe), costToThem: Math.round(costToThem), market: Math.round(market), score: Math.round(score), reasons });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

function combos<T>(xs: T[], maxSize: number): T[][] {
  const out: T[][] = [];
  const rec = (start: number, cur: T[]) => {
    if (cur.length) out.push([...cur]);
    if (cur.length === maxSize) return;
    for (let i = start; i < xs.length; i++) {
      cur.push(xs[i]);
      rec(i + 1, cur);
      cur.pop();
    }
  };
  rec(0, []);
  return out;
}

export interface FindOptions {
  partnerRosterId?: number;
  /** Only ideas that acquire this asset. */
  targetAsset?: Asset;
  /** Only ideas that move this asset. */
  sellAsset?: Asset;
  myWeights?: { now: number; future: number };
  maxPerPartner?: number;
  limit?: number;
  minAcceptance?: number;
}

export function findTrades(an: LeagueAnalysis, rosterId: number, opts: FindOptions = {}): TradeIdea[] {
  const ctx = an.ctx;
  const me = ctx.snap.teams.find((t) => t.rosterId === rosterId)!;
  const w = opts.myWeights;
  const evalOpts: EvalOptions = { light: true, myWeights: w };
  const minAccept = opts.minAcceptance ?? 0.4;
  // Their side must not be a clear loss by their own goals; managers rarely accept those.
  const theirsOk = (ev: TradeEvaluation) => ev.them.contextDelta >= -0.08 * Math.max(1500, (ev.them.marketGive + ev.them.marketGet) / 2);

  const block = tradeBlock(an, rosterId, w);
  const targets = tradeTargets(an, rosterId, w, 60);
  const L = ctx.snap.league;
  const myPicks: Asset[] =
    L.type === "redraft"
      ? []
      : [...me.picks]
          .map((p) => ({ a: { kind: "pick", season: p.season, round: p.round, originalRosterId: p.originalRosterId } as Asset, v: pickValue(p, ctx) }))
          .sort((a, b) => b.v - a.v)
          .slice(0, 4)
          .map((x) => x.a);

  const partners = ctx.snap.teams.filter((t) => t.rosterId !== rosterId && (!opts.partnerRosterId || t.rosterId === opts.partnerRosterId));
  const ideas: TradeIdea[] = [];
  const mvCache = new Map<string, number>();
  const mv = (a: Asset) => {
    const k = assetKey(a);
    let v = mvCache.get(k);
    if (v === undefined) mvCache.set(k, (v = convex(viewAsset(an, a).market)));
    return v;
  };

  for (const partner of partners) {
    let gets: Asset[] = targets.filter((t) => t.ownerRosterId === partner.rosterId).slice(0, 5).map((t) => ({ kind: "player", id: t.playerId }) as Asset);
    if (opts.targetAsset) gets = [opts.targetAsset];
    if (!gets.length) continue;

    // What I can offer: trade-block players, players at positions THEY need where I'm deep, picks.
    const theirNeeds = an.teams[partner.rosterId].positions;
    const needFits = me.players
      .map((id) => ctx.snap.players[id])
      .filter((p) => p && theirNeeds[p.position]?.need >= 0.55 && an.teams[rosterId].positions[p.position].surplus)
      .map((p) => p.id);
    const giveIds = [...new Set([...block.slice(0, 7).map((b) => b.playerId), ...needFits.slice(0, 2)])];
    let gives: Asset[] = [...giveIds.map((id) => ({ kind: "player", id }) as Asset), ...myPicks];
    if (opts.sellAsset) gives = [opts.sellAsset, ...gives.filter((g) => assetKey(g) !== assetKey(opts.sellAsset!))];

    const getCombos = opts.targetAsset ? [gets] : combos(gets, 2);
    const giveCombos = combos(gives, 2).filter((c) => !opts.sellAsset || c.some((g) => assetKey(g) === assetKey(opts.sellAsset!)));
    const local: TradeIdea[] = [];
    for (const g of getCombos) {
      const getM = g.reduce((s, a) => s + mv(a), 0);
      for (const give of giveCombos) {
        const giveM = give.reduce((s, a) => s + mv(a), 0);
        if (giveM <= 0 || getM <= 0) continue;
        const ratio = getM / giveM;
        if (ratio > 1.6 || ratio < 0.6) continue; // obviously lopsided by market, skip
        const ev = evaluateTrade(an, { fromRosterId: rosterId, toRosterId: partner.rosterId, gives: give, gets: g }, evalOpts);
        if (ev.me.contextDelta <= 0) continue;
        let best = ev;
        if (ev.acceptance.probability < minAccept || !theirsOk(ev)) {
          // Try a small sweetener (a mid/late pick or low-value bench piece) to get them over the line.
          const sweeteners = [...myPicks.slice(1), ...block.slice(8, 14).map((b) => ({ kind: "player", id: b.playerId }) as Asset)].filter(
            (s) => !give.some((x) => assetKey(x) === assetKey(s)),
          );
          for (const s of sweeteners) {
            const ev2 = evaluateTrade(an, { fromRosterId: rosterId, toRosterId: partner.rosterId, gives: [...give, s], gets: g }, evalOpts);
            if (ev2.me.contextDelta > 0 && ev2.acceptance.probability >= minAccept && theirsOk(ev2)) {
              best = ev2;
              break;
            }
          }
          if (best === ev) continue;
        }
        const score = best.me.contextDelta * best.acceptance.probability;
        local.push({ evaluation: best, score });
      }
    }
    // Keep the best few per partner, each built around a different target.
    local.sort((a, b) => b.score - a.score);
    const seen = new Set<string>();
    let kept = 0;
    for (const idea of local) {
      const key = idea.evaluation.proposal.gets.map(assetKey).sort().join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      ideas.push(idea);
      if (++kept >= (opts.maxPerPartner ?? 3)) break;
    }
  }
  ideas.sort((a, b) => b.score - a.score);
  // Diversity: don't let one of your assets headline every idea.
  const uses = new Map<string, number>();
  const top: TradeIdea[] = [];
  for (const idea of ideas) {
    const keys = idea.evaluation.proposal.gives.map(assetKey);
    if (!opts.sellAsset && keys.some((k) => (uses.get(k) ?? 0) >= 2)) continue;
    keys.forEach((k) => uses.set(k, (uses.get(k) ?? 0) + 1));
    top.push(idea);
    if (top.length >= (opts.limit ?? 12)) break;
  }
  // Re-run the winners with full narrative.
  return top.map((i) => ({ ...i, evaluation: evaluateTrade(an, i.evaluation.proposal, { myWeights: w }) }));
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
function ordinalShort(n: number) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
