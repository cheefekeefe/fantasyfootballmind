import { beforeAll, describe, expect, it } from "vitest";
import { loadDemoRaw } from "../demo";
import { buildSnapshot, type RawInputs } from "../snapshot";
import { analyzeLeague, type LeagueAnalysis } from "./analysis";
import { evaluateTrade } from "./trade";
import { findTrades, tradeBlock } from "./tradeFinder";
import { adviseLineup } from "./lineupGuru";
import { waiverReport } from "./waivers";
import type { LeagueSnapshot } from "../types";

let raw: RawInputs;
let snap: LeagueSnapshot;
let an: LeagueAnalysis;
const NOW = new Date("2026-10-07T12:00:00Z");

beforeAll(async () => {
  raw = await loadDemoRaw();
  snap = buildSnapshot(raw, NOW);
  an = analyzeLeague(snap, { simulations: 500 });
});

const topPlayer = (rosterId: number) => {
  const t = snap.teams.find((x) => x.rosterId === rosterId)!;
  return [...t.players].sort((a, b) => (snap.players[b].market.dynasty ?? 0) - (snap.players[a].market.dynasty ?? 0))[0];
};

describe("demo league pipeline", () => {
  it("builds a snapshot with projections, values and picks", () => {
    expect(snap.teams).toHaveLength(12);
    expect(snap.myRosterId).toBe(1);
    const projected = Object.values(snap.players).filter((p) => p.week && p.week.median > 0);
    expect(projected.length).toBeGreaterThan(200);
    expect(Object.values(snap.players).some((p) => p.week?.inputs.some((i) => i.source === "odds"))).toBe(true);
    expect(snap.teams[0].picks.length).toBeGreaterThan(0);
    expect(snap.pickValues.length).toBeGreaterThan(0);
  });

  it("classifies every team and sums playoff odds to playoff spots", () => {
    const total = Object.values(an.teams).reduce((a, t) => a + t.playoffOdds, 0);
    expect(total).toBeCloseTo(snap.league.playoffTeams, 0);
    for (const t of Object.values(an.teams)) expect(t.strategy.now + t.strategy.future).toBeCloseTo(1);
  });

  it("giving away a star for nothing is graded as a loss for you and a win for them", () => {
    const id = topPlayer(1);
    const ev = evaluateTrade(an, { fromRosterId: 1, toRosterId: 2, gives: [{ kind: "player", id }], gets: [] });
    expect(ev.me.contextDelta).toBeLessThan(0);
    expect(ev.them.contextDelta).toBeGreaterThan(0);
    expect(ev.me.grade).toMatch(/[DF]/);
    expect(ev.fairness).toBeLessThan(0);
  });

  it("is symmetric in market fairness", () => {
    const a = topPlayer(1);
    const b = topPlayer(2);
    const x = evaluateTrade(an, { fromRosterId: 1, toRosterId: 2, gives: [{ kind: "player", id: a }], gets: [{ kind: "player", id: b }] });
    const y = evaluateTrade(an, { fromRosterId: 2, toRosterId: 1, gives: [{ kind: "player", id: b }], gets: [{ kind: "player", id: a }] });
    expect(x.fairness).toBeCloseTo(-y.fairness, 2);
    expect(x.me.contextDelta).toBeCloseTo(y.them.contextDelta, 0);
  });

  it("rebuilding teams value picks more than contenders do", () => {
    const sorted = Object.values(an.teams).sort((p, q) => q.playoffOdds - p.playoffOdds);
    const contender = sorted[0];
    const rebuilder = sorted[sorted.length - 1];
    const pick = snap.teams.find((t) => t.rosterId === contender.rosterId)!.picks.find((p) => p.round === 1)!;
    const asset = { kind: "pick" as const, season: pick.season, round: pick.round, originalRosterId: pick.originalRosterId };
    // Same pick, valued by each team's strategy weights.
    const forContender = evaluateTrade(an, { fromRosterId: rebuilder.rosterId, toRosterId: contender.rosterId, gives: [], gets: [asset] }).me.contextDelta;
    expect(forContender).toBeGreaterThan(0);
    expect(rebuilder.strategy.future).toBeGreaterThan(contender.strategy.future);
  });

  it("finds trade ideas that help you and are plausibly acceptable", () => {
    const ideas = findTrades(an, 1, { limit: 5 });
    expect(ideas.length).toBeGreaterThan(0);
    for (const i of ideas) {
      expect(i.evaluation.me.contextDelta).toBeGreaterThan(0);
      expect(i.evaluation.acceptance.probability).toBeGreaterThanOrEqual(0.4);
      expect(i.evaluation.me.reasons.length).toBeGreaterThan(0);
    }
    expect(tradeBlock(an, 1).length).toBeGreaterThan(0);
  });

  it("recommends a lineup at least as good as the current one", () => {
    const a = adviseLineup(an, 1);
    expect(a.optimal.total).toBeGreaterThanOrEqual(a.current.total - 0.01);
    expect(a.winProbability).not.toBeNull();
    expect(a.winProbability!).toBeGreaterThanOrEqual(a.winProbabilityCurrent! - 0.01);
  });

  it("produces waiver recommendations with FAAB bids within budget", () => {
    const r = waiverReport(an, 1);
    expect(r.recs.length).toBeGreaterThan(0);
    for (const rec of r.recs) {
      expect(snap.players[rec.playerId].position).not.toMatch(/^(K|DEF)$/);
      if (rec.faab) expect(rec.faab.high).toBeLessThanOrEqual(r.budgetRemaining!);
    }
  });

  it("redraft leagues ignore the future; keeper leagues only count keepers", () => {
    const redraft = buildSnapshot({ ...raw, league: { ...raw.league, settings: { ...raw.league.settings, type: 0 } } }, NOW);
    const anR = analyzeLeague(redraft, { simulations: 200 });
    expect(anR.teams[1].futureValue).toBe(0);
    expect(anR.teams[1].strategy.now).toBe(1);

    const keeper = buildSnapshot({ ...raw, league: { ...raw.league, settings: { ...raw.league.settings, type: 1, max_keepers: 3 } } }, NOW);
    const anK = analyzeLeague(keeper, { simulations: 200 });
    // Dropping the 10th best asset doesn't change keeper value at all.
    const t = keeper.teams[0];
    const tenth = [...t.players].sort((a, b) => (keeper.players[b].market.dynasty ?? 0) - (keeper.players[a].market.dynasty ?? 0))[9];
    const ev = evaluateTrade(anK, { fromRosterId: 1, toRosterId: 2, gives: [{ kind: "player", id: tenth }], gets: [] });
    expect(Math.abs(ev.me.futureDelta)).toBeLessThan(1);
  });
});
