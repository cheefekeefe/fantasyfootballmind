import { beforeAll, describe, expect, it } from "vitest";
import { loadDemoSnapshot } from "../demo";
import { analyzeLeague, type LeagueAnalysis } from "./analysis";
import { keeperPlan, projectedDraftPool } from "./keepers";
import { evaluateTrade } from "./trade";
import { keeperSurplus, pickValue } from "./valuation";

let an: LeagueAnalysis;
beforeAll(async () => {
  an = analyzeLeague(await loadDemoSnapshot("demo-keeper"), { simulations: 300 });
});

describe("10-keeper, half-PPR league", () => {
  it("reads the format", () => {
    const L = an.ctx.snap.league;
    expect(L.type).toBe("keeper");
    expect(L.maxKeepers).toBe(10);
    expect(L.ppr).toBe(0.5);
    expect(L.tePremium).toBe(0);
  });

  it("sets a keeper line and only counts surplus above it", () => {
    expect(an.ctx.keeperLine).toBeGreaterThan(0);
    const scrub = Object.values(an.ctx.snap.players).find((p) => p.position === "WR" && (p.market.dynasty ?? 0) < an.ctx.keeperLine * 0.5)!;
    expect(keeperSurplus(scrub, an.ctx)).toBe(0);
  });

  it("weights the future meaningfully but less than dynasty", () => {
    for (const t of Object.values(an.teams)) {
      expect(t.strategy.future).toBeGreaterThan(0.15);
      expect(t.strategy.future).toBeLessThan(0.8);
    }
  });

  it("plans keepers and the projected draft pool", () => {
    const plan = keeperPlan(an, 1);
    expect(plan.rows.filter((r) => r.status === "lock" || r.status === "keep")).toHaveLength(10);
    expect(plan.insights.length).toBeGreaterThan(0);
    expect(projectedDraftPool(an, 10)).toHaveLength(10);
  });

  it("values early picks above late picks", () => {
    const picks = an.ctx.snap.teams.flatMap((t) => t.picks).filter((p) => p.round === 1);
    const vals = picks.map((p) => ({ v: pickValue(p, an.ctx), slot: an.ctx.projectedSlot[p.originalRosterId] }));
    const early = vals.find((x) => x.slot === 1)!;
    const late = vals.find((x) => x.slot === 12)!;
    expect(early.v).toBeGreaterThan(late.v);
  });

  it("an 11th keeper-worthy player has no future value to his team", () => {
    const plan = keeperPlan(an, 1);
    const eleventh = plan.rows[10];
    const ev = evaluateTrade(an, { fromRosterId: 1, toRosterId: 2, gives: [{ kind: "player", id: eleventh.playerId }], gets: [] });
    expect(Math.abs(ev.me.futureDelta)).toBeLessThan(1);
  });
});
