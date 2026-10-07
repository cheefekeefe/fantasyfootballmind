// Demo mode: a realistic offline league (see scripts/build-demo.ts) run through the exact
// same snapshot pipeline as a live Sleeper league.
//   /league/demo         12-team dynasty, PPR, TE premium
//   /league/demo-keeper  12-team, half PPR, 10 no-cost keepers

import { readFile } from "node:fs/promises";
import path from "node:path";
import { buildSnapshot, type RawInputs } from "./snapshot";
import type { LeagueSnapshot } from "./types";

const cached = new Map<string, LeagueSnapshot>();

export const DEMO_IDS = ["demo", "demo-keeper"];

export async function loadDemoRaw(variant = "demo"): Promise<RawInputs> {
  const raw = JSON.parse(await readFile(path.join(process.cwd(), "data", "demo-raw.json"), "utf8")) as RawInputs;
  if (variant === "demo-keeper") {
    const { bonus_rec_te: _te, ...scoring } = raw.league.scoring_settings;
    raw.league = {
      ...raw.league,
      league_id: "demo-keeper",
      name: "Demo Keeper League (12-team, 0.5 PPR, 10 keepers)",
      scoring_settings: { ...scoring, rec: 0.5 },
      settings: { ...raw.league.settings, type: 1, max_keepers: 10, draft_rounds: 15, taxi_slots: 0 },
    };
    raw.tradedPicks = raw.tradedPicks.filter((t) => t.season === "2027");
  }
  return raw;
}

export async function loadDemoSnapshot(variant = "demo"): Promise<LeagueSnapshot> {
  const hit = cached.get(variant);
  if (hit) return hit;
  // Pin "now" to the fixture's week so ages and labels stay stable.
  const snap = buildSnapshot(await loadDemoRaw(variant), new Date("2026-10-07T12:00:00Z"));
  cached.set(variant, snap);
  return snap;
}
