import { describe, expect, it } from "vitest";
import { leaguePoints, scoreStats } from "./scoring";
import { poissonMeanFromLine, propsToStats, invNorm } from "./props";
import { buildConsensus, rankToPoints } from "./consensus";
import { optimalLineup, expectedLineupPoints } from "./lineup";
import { convex } from "./valuation";
import { parsePickName } from "../snapshot";
import { impliedTeamTotal } from "../sources/nflverse";
import { aggregateProps } from "../sources/odds";

const PPR = { pass_yd: 0.04, pass_td: 4, pass_int: -1, rush_yd: 0.1, rush_td: 6, rec: 1, rec_yd: 0.1, rec_td: 6, fum_lost: -2, bonus_rec_te: 0.5 };

describe("scoring", () => {
  it("scores a stat line with league settings", () => {
    expect(scoreStats({ rec: 5, rec_yd: 60, rec_td: 1 }, PPR, "WR")).toBeCloseTo(17);
  });
  it("applies TE premium when the projection lacks it", () => {
    expect(scoreStats({ rec: 4, rec_yd: 40 }, PPR, "TE")).toBeCloseTo(10);
  });
  it("ignores pre-computed totals and falls back to them when needed", () => {
    expect(scoreStats({ rec: 1, pts_ppr: 99 }, PPR, "WR")).toBe(1);
    expect(leaguePoints({ pts_ppr: 8.5 }, PPR, "K", 1)).toBe(8.5);
  });
});

describe("props", () => {
  it("inverts the normal CDF", () => {
    expect(invNorm(0.5)).toBeCloseTo(0, 5);
    expect(invNorm(0.8413)).toBeCloseTo(1, 2);
  });
  it("solves a Poisson mean from an over/under", () => {
    // P(X >= 1) = 0.5  =>  λ = ln 2
    expect(poissonMeanFromLine(0.5, 0.5)).toBeCloseTo(Math.LN2, 3);
  });
  it("converts props to an expected stat line", () => {
    const s = propsToStats(
      [
        { player: "x", market: "player_reception_yds", line: 60.5, overProb: 0.5, books: 5 },
        { player: "x", market: "player_anytime_td", line: null, overProb: 0.4, books: 5 },
      ],
      "WR",
    );
    expect(s.rec_yd).toBeGreaterThan(60.5); // right-skew correction
    expect(s.rec_td! + s.rush_td!).toBeCloseTo(-Math.log(0.6), 5);
  });
  it("de-vigs and aggregates book outcomes", () => {
    const props = aggregateProps({
      id: "e",
      commence_time: "",
      home_team: "A",
      away_team: "B",
      bookmakers: [
        { key: "b1", markets: [{ key: "player_receptions", outcomes: [{ name: "Over", description: "P", price: -110, point: 4.5 }, { name: "Under", description: "P", price: -110, point: 4.5 }] }] },
        { key: "b2", markets: [{ key: "player_receptions", outcomes: [{ name: "Over", description: "P", price: -130, point: 5.5 }, { name: "Under", description: "P", price: 110, point: 5.5 }] }] },
      ],
    });
    expect(props).toHaveLength(1);
    expect(props[0].line).toBe(5);
    expect(props[0].overProb).toBeGreaterThan(0.5);
  });
});

describe("consensus", () => {
  it("weights sources and builds a band", () => {
    const c = buildConsensus(5, "WR", [
      { source: "sleeper", label: "S", points: 10 },
      { source: "odds", label: "V", points: 14 },
    ])!;
    expect(c.median).toBeGreaterThan(12);
    expect(c.floor).toBeLessThan(c.median);
    expect(c.ceiling).toBeGreaterThan(c.median);
  });
  it("maps expert ranks onto the projection curve", () => {
    expect(rankToPoints(2, [20, 18, 15])).toBe(18);
    expect(rankToPoints(1.5, [20, 18, 15])).toBe(19);
  });
});

describe("lineup", () => {
  const c = [
    { id: "q", position: "QB" as const, points: 20 },
    { id: "r1", position: "RB" as const, points: 15 },
    { id: "r2", position: "RB" as const, points: 12 },
    { id: "w1", position: "WR" as const, points: 14 },
    { id: "t", position: "TE" as const, points: 8 },
  ];
  it("fills dedicated slots before flex", () => {
    const lu = optimalLineup(c, ["QB", "RB", "WR", "FLEX"]);
    expect(lu.slots.map((s) => s.playerId)).toEqual(["q", "r1", "w1", "r2"]);
    expect(lu.total).toBe(61);
    expect(lu.bench).toEqual(["t"]);
  });
  it("values bench depth only as injury/bye cover", () => {
    const thin = expectedLineupPoints(c.filter((x) => x.id !== "r2"), ["QB", "RB", "WR"]);
    const deep = expectedLineupPoints(c, ["QB", "RB", "WR"]); // r2 backs up r1
    expect(deep).toBeGreaterThan(thin);
    expect(deep - thin).toBeLessThan(2);
  });
});

describe("valuation helpers", () => {
  it("adds a consolidation premium", () => {
    expect(convex(10000)).toBe(10000);
    expect(convex(5000) * 2).toBeLessThan(10000);
  });
  it("parses pick names from every source", () => {
    expect(parsePickName("2027 Early 1st")).toEqual({ season: 2027, round: 1, tier: "early" });
    expect(parsePickName("2028 2nd")).toEqual({ season: 2028, round: 2, tier: "any" });
    expect(parsePickName("2026 Pick 1.03")).toEqual({ season: 2026, round: 1, tier: "any", slot: 3 });
  });
  it("computes implied team totals", () => {
    expect(impliedTeamTotal(47, -7)).toBe(27);
    expect(impliedTeamTotal(47, 7)).toBe(20);
  });
});
