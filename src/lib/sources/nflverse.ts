// nflverse open data (keyless, GitHub-hosted):
//  - schedule with Vegas closing/current spreads + totals for every game (byes, opponents,
//    implied team totals)
//  - weekly player stats (targets, target share, carries, air yards, fantasy points)
//  - weekly snap counts

import { cachedFetch, parseCsv, num } from "../http";
import { normTeam } from "../teams";
import type { NflGame, UsageTrend } from "../types";

const RELEASES = "https://github.com/nflverse/nflverse-data/releases/download";

export async function getSchedule(season: number): Promise<NflGame[]> {
  const text = await cachedFetch<string>("https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv", {
    ttlMinutes: 180,
    parse: "text",
    disk: true,
    timeoutMs: 45000,
  });
  return scheduleFromCsv(text, season);
}

export function scheduleFromCsv(text: string, season: number): NflGame[] {
  const games: NflGame[] = [];
  for (const r of parseCsv(text)) {
    if (Number(r.season) !== season || r.game_type !== "REG") continue;
    const week = Number(r.week);
    const home = normTeam(r.home_team)!;
    const away = normTeam(r.away_team)!;
    // nflverse spread_line is positive when the HOME team is favored.
    const spreadLine = num(r.spread_line);
    const total = num(r.total_line);
    const kickoff = r.gameday ? `${r.gameday}T${r.gametime || "13:00"}:00` : null;
    const homeSpread = spreadLine === null ? null : -spreadLine;
    const mk = (team: string, opp: string, isHome: boolean, spread: number | null): NflGame => ({
      week,
      team,
      opponent: opp,
      home: isHome,
      kickoff,
      spread,
      total,
      impliedTotal: impliedTeamTotal(total, spread),
    });
    games.push(mk(home, away, true, homeSpread));
    games.push(mk(away, home, false, homeSpread === null ? null : -homeSpread));
  }
  return games;
}

/** Team implied total = total/2 - spread/2 (spread negative when favored). */
export function impliedTeamTotal(total: number | null, spread: number | null): number | null {
  if (total === null) return null;
  return Math.round((total / 2 - (spread ?? 0) / 2) * 10) / 10;
}

interface WeekRow {
  week: number;
  targetShare: number | null;
  carries: number;
  airYardsShare: number | null;
  ppr: number;
}

/**
 * Usage trends keyed by GSIS id (nflverse player_id). Snap% is keyed by PFR id and merged
 * by the caller through the ID map.
 */
export async function getUsage(season: number): Promise<{ byGsis: Record<string, UsageTrend>; snapsByPfr: Record<string, { pct: number; last3: number }> }> {
  const [statsText, snapsText] = await Promise.all([
    cachedFetch<string>(`${RELEASES}/stats_player/stats_player_week_${season}.csv`, {
      ttlMinutes: 180,
      parse: "text",
      disk: true,
      timeoutMs: 45000,
    }),
    cachedFetch<string>(`${RELEASES}/snap_counts/snap_counts_${season}.csv`, {
      ttlMinutes: 180,
      parse: "text",
      disk: true,
      timeoutMs: 45000,
    }).catch(() => ""),
  ]);
  return { byGsis: usageFromCsv(statsText), snapsByPfr: snapsFromCsv(snapsText) };
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined);
const round = (x: number | undefined, d = 3) => (x === undefined ? undefined : Math.round(x * 10 ** d) / 10 ** d);

export function usageFromCsv(text: string): Record<string, UsageTrend> {
  const byPlayer = new Map<string, WeekRow[]>();
  for (const r of parseCsv(text)) {
    if (!r.player_id || r.season_type !== "REG") continue;
    if (!["QB", "RB", "WR", "TE"].includes(r.position)) continue;
    const list = byPlayer.get(r.player_id) ?? [];
    list.push({
      week: Number(r.week),
      targetShare: num(r.target_share),
      carries: num(r.carries) ?? 0,
      airYardsShare: num(r.air_yards_share),
      ppr: num(r.fantasy_points_ppr) ?? 0,
    });
    byPlayer.set(r.player_id, list);
  }
  const out: Record<string, UsageTrend> = {};
  for (const [id, rows] of byPlayer) {
    rows.sort((a, b) => a.week - b.week);
    const last3 = rows.slice(-3);
    const ts = rows.map((r) => r.targetShare).filter((x): x is number => x !== null);
    const ts3 = last3.map((r) => r.targetShare).filter((x): x is number => x !== null);
    const ay = rows.map((r) => r.airYardsShare).filter((x): x is number => x !== null);
    out[id] = {
      games: rows.length,
      targetShare: round(avg(ts)),
      targetShareLast3: round(avg(ts3)),
      airYardsShare: round(avg(ay)),
      carriesPerGame: round(avg(rows.map((r) => r.carries)), 1),
      carriesLast3: round(avg(last3.map((r) => r.carries)), 1),
      ppgActual: round(avg(rows.map((r) => r.ppr)), 1),
      ppgLast3: round(avg(last3.map((r) => r.ppr)), 1),
    };
  }
  return out;
}

export function snapsFromCsv(text: string): Record<string, { pct: number; last3: number }> {
  if (!text) return {};
  const by = new Map<string, { week: number; pct: number }[]>();
  for (const r of parseCsv(text)) {
    if (r.game_type !== "REG" || !r.pfr_player_id) continue;
    const pct = num(r.offense_pct);
    if (pct === null || !["QB", "RB", "WR", "TE"].includes(r.position)) continue;
    const list = by.get(r.pfr_player_id) ?? [];
    list.push({ week: Number(r.week), pct });
    by.set(r.pfr_player_id, list);
  }
  const out: Record<string, { pct: number; last3: number }> = {};
  for (const [id, rows] of by) {
    rows.sort((a, b) => a.week - b.week);
    out[id] = {
      pct: round(avg(rows.map((r) => r.pct)))!,
      last3: round(avg(rows.slice(-3).map((r) => r.pct)))!,
    };
  }
  return out;
}
