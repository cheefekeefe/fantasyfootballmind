// Lineup solving: who starts where, and how much a roster is expected to score.

import type { Position, SlotName } from "../types";

export const SLOT_ELIGIBILITY: Record<string, Position[]> = {
  QB: ["QB"],
  RB: ["RB"],
  WR: ["WR"],
  TE: ["TE"],
  K: ["K"],
  DEF: ["DEF"],
  FLEX: ["RB", "WR", "TE"],
  WRRB_FLEX: ["RB", "WR"],
  REC_FLEX: ["WR", "TE"],
  SUPER_FLEX: ["QB", "RB", "WR", "TE"],
};

export const isStartingSlot = (s: SlotName) => !["BN", "IR", "TAXI"].includes(s);

export const eligible = (slot: SlotName, pos: Position) => (SLOT_ELIGIBILITY[slot] ?? []).includes(pos);

export interface LineupCandidate {
  id: string;
  position: Position;
  points: number;
}

export interface LineupResult {
  slots: { slot: SlotName; playerId: string | null; points: number }[];
  total: number;
  bench: string[];
}

/** Fill restrictive slots first, then flexes. Exact whenever flex eligibility sets are nested (standard Sleeper setups). */
export function slotOrder(slots: SlotName[]): number[] {
  return slots
    .map((s, i) => ({ i, n: SLOT_ELIGIBILITY[s]?.length ?? 99 }))
    .sort((a, b) => a.n - b.n || a.i - b.i)
    .map((x) => x.i);
}

export function optimalLineup(candidates: LineupCandidate[], slots: SlotName[]): LineupResult {
  const starting = slots.filter(isStartingSlot);
  const pool = [...candidates].sort((a, b) => b.points - a.points);
  const used = new Set<string>();
  const out: LineupResult["slots"] = starting.map((slot) => ({ slot, playerId: null, points: 0 }));
  for (const i of slotOrder(starting)) {
    const slot = starting[i];
    const pick = pool.find((c) => !used.has(c.id) && eligible(slot, c.position));
    if (pick) {
      used.add(pick.id);
      out[i] = { slot, playerId: pick.id, points: pick.points };
    }
  }
  return {
    slots: out,
    total: Math.round(out.reduce((a, s) => a + s.points, 0) * 100) / 100,
    bench: pool.filter((c) => !used.has(c.id)).map((c) => c.id),
  };
}

/**
 * Expected lineup points including the value of depth: each starter is available with
 * probability `availability` (injuries, illness, game-time decisions); otherwise the best
 * eligible bench player fills in. This is what makes a strong bench worth something without
 * letting depth masquerade as star power.
 */
export function expectedLineupPoints(candidates: LineupCandidate[], slots: SlotName[], availability = 0.9): number {
  const lu = optimalLineup(candidates, slots);
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const bench = lu.bench.map((id) => byId.get(id)!).filter(Boolean);
  let total = 0;
  const benchUse = new Map<string, number>();
  for (const s of lu.slots) {
    if (!s.playerId) continue;
    // Best bench sub, discounted if already the sub for other slots.
    let best = 0;
    let bestId: string | null = null;
    for (const b of bench) {
      if (!eligible(s.slot, b.position)) continue;
      const v = b.points * Math.pow(0.5, benchUse.get(b.id) ?? 0);
      if (v > best) {
        best = v;
        bestId = b.id;
      }
    }
    if (bestId) benchUse.set(bestId, (benchUse.get(bestId) ?? 0) + 1);
    total += availability * s.points + (1 - availability) * best;
  }
  return total;
}
