// ESPN fantasy projections (keyless public "league defaults" endpoint used by espn.com).
// We map ESPN stat ids to Sleeper stat keys so projections are re-scored with league settings.

import { cachedFetch } from "../http";
import type { StatLine } from "../types";

const PRO_TEAMS: Record<number, string> = {
  1: "ATL", 2: "BUF", 3: "CHI", 4: "CIN", 5: "CLE", 6: "DAL", 7: "DEN", 8: "DET", 9: "GB", 10: "TEN",
  11: "IND", 12: "KC", 13: "LV", 14: "LAR", 15: "MIA", 16: "MIN", 17: "NE", 18: "NO", 19: "NYG", 20: "NYJ",
  21: "PHI", 22: "ARI", 23: "PIT", 24: "LAC", 25: "SF", 26: "SEA", 27: "TB", 28: "WAS", 29: "CAR", 30: "JAX",
  33: "BAL", 34: "HOU",
};
const POS: Record<number, string> = { 1: "QB", 2: "RB", 3: "WR", 4: "TE", 5: "K", 16: "DEF" };

// ESPN stat id -> Sleeper stat key
const STAT_MAP: Record<string, string> = {
  "0": "pass_att",
  "1": "pass_cmp",
  "3": "pass_yd",
  "4": "pass_td",
  "19": "pass_2pt",
  "20": "pass_int",
  "23": "rush_att",
  "24": "rush_yd",
  "25": "rush_td",
  "26": "rush_2pt",
  "53": "rec",
  "42": "rec_yd",
  "43": "rec_td",
  "44": "rec_2pt",
  "58": "rec_tgt",
  "72": "fum_lost",
};

export interface EspnProjection {
  espnId: string;
  name: string;
  position: string;
  team: string | null;
  /** ESPN default PPR points (used for K/DEF where we can't rescore reliably). */
  pprPoints: number;
  stats: StatLine;
}

interface EspnStatEntry {
  seasonId: number;
  scoringPeriodId: number;
  statSourceId: number;
  statSplitTypeId: number;
  appliedTotal?: number;
  stats?: Record<string, number>;
}

interface EspnPlayersResponse {
  players?: {
    id: number;
    player?: { id: number; fullName: string; defaultPositionId: number; proTeamId: number; stats?: EspnStatEntry[] };
  }[];
}

export async function getEspnWeekProjections(season: number, week: number): Promise<EspnProjection[]> {
  const filter = {
    players: {
      limit: 1200,
      sortPercOwned: { sortPriority: 1, sortAsc: false },
      filterSlotIds: { value: [0, 2, 4, 6, 17, 16] },
      filterStatsForSourceIds: { value: [1] },
      filterStatsForSplitTypeIds: { value: [1] },
    },
  };
  const url = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/segments/0/leaguedefaults/3?scoringPeriodId=${week}&view=kona_player_info`;
  const data = await cachedFetch<EspnPlayersResponse>(url, {
    ttlMinutes: 120,
    headers: { "X-Fantasy-Filter": JSON.stringify(filter), Accept: "application/json" },
  });
  const out: EspnProjection[] = [];
  for (const row of data.players ?? []) {
    const p = row.player;
    if (!p) continue;
    const position = POS[p.defaultPositionId];
    if (!position) continue;
    const entry = p.stats?.find(
      (s) => s.statSourceId === 1 && s.statSplitTypeId === 1 && s.scoringPeriodId === week && s.seasonId === season,
    );
    if (!entry) continue;
    const stats: StatLine = {};
    for (const [k, v] of Object.entries(entry.stats ?? {})) {
      const key = STAT_MAP[k];
      if (key) stats[key] = v;
    }
    out.push({
      espnId: String(p.id),
      name: p.fullName,
      position,
      team: PRO_TEAMS[p.proTeamId] ?? null,
      pprPoints: entry.appliedTotal ?? 0,
      stats,
    });
  }
  return out;
}
