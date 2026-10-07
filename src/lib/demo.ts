// Demo mode: a realistic offline league (see scripts/build-demo.ts) run through the exact
// same snapshot pipeline as a live Sleeper league.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { buildSnapshot, type RawInputs } from "./snapshot";
import type { LeagueSnapshot } from "./types";

let cached: LeagueSnapshot | null = null;

export async function loadDemoRaw(): Promise<RawInputs> {
  return JSON.parse(await readFile(path.join(process.cwd(), "data", "demo-raw.json"), "utf8")) as RawInputs;
}

export async function loadDemoSnapshot(): Promise<LeagueSnapshot> {
  if (cached) return cached;
  // Pin "now" to the fixture's week so ages and labels stay stable.
  cached = buildSnapshot(await loadDemoRaw(), new Date("2026-10-07T12:00:00Z"));
  return cached;
}
