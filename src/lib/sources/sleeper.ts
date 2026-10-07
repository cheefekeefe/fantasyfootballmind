// Sleeper API adapter. Public, keyless, read-only. Docs: https://docs.sleeper.com
// The projections/stats endpoints (api.sleeper.com) are undocumented but are what the
// Sleeper app itself uses; they return raw stat lines we re-score with league settings.

import { cachedFetch } from "../http";

const V1 = "https://api.sleeper.app/v1";
const API = "https://api.sleeper.com";

export interface SleeperState {
  week: number;
  display_week?: number;
  season: string;
  season_type: string;
  leg?: number;
}

export interface SleeperUser {
  user_id: string;
  username?: string;
  display_name: string;
  avatar: string | null;
  metadata?: { team_name?: string };
}

export interface SleeperLeague {
  league_id: string;
  name: string;
  season: string;
  status: string;
  total_rosters: number;
  roster_positions: string[];
  scoring_settings: Record<string, number>;
  settings: Record<string, number | undefined>;
  previous_league_id?: string | null;
  draft_id?: string | null;
  avatar?: string | null;
}

export interface SleeperRoster {
  roster_id: number;
  owner_id: string | null;
  co_owners?: string[] | null;
  players: string[] | null;
  starters: string[] | null;
  reserve: string[] | null;
  taxi: string[] | null;
  settings: Record<string, number | undefined>;
  metadata?: Record<string, string> | null;
}

export interface SleeperMatchup {
  roster_id: number;
  matchup_id: number | null;
  points: number | null;
  starters?: string[];
  players?: string[];
}

export interface SleeperTradedPick {
  season: string;
  round: number;
  roster_id: number;
  previous_owner_id: number;
  owner_id: number;
}

export interface SleeperDraft {
  draft_id: string;
  season: string;
  status: string;
  type: string;
  settings: { rounds?: number; teams?: number };
  draft_order: Record<string, number> | null;
  slot_to_roster_id?: Record<string, number> | null;
}

export interface SleeperPlayer {
  player_id: string;
  full_name?: string;
  first_name?: string;
  last_name?: string;
  position: string | null;
  fantasy_positions?: string[] | null;
  team: string | null;
  age?: number | null;
  birth_date?: string | null;
  years_exp?: number | null;
  injury_status?: string | null;
  status?: string | null;
  active?: boolean;
  search_rank?: number | null;
  depth_chart_order?: number | null;
}

export interface SleeperProjectionRow {
  player_id: string;
  week?: number | null;
  team?: string | null;
  opponent?: string | null;
  stats: Record<string, number>;
  player?: { position?: string; first_name?: string; last_name?: string; team?: string };
}

export const getState = () => cachedFetch<SleeperState>(`${V1}/state/nfl`, { ttlMinutes: 30 });

export const getUser = (usernameOrId: string) =>
  cachedFetch<SleeperUser | null>(`${V1}/user/${encodeURIComponent(usernameOrId)}`, { ttlMinutes: 60 });

export const getUserLeagues = (userId: string, season: number | string) =>
  cachedFetch<SleeperLeague[]>(`${V1}/user/${userId}/leagues/nfl/${season}`, { ttlMinutes: 30 });

export const getLeague = (id: string) => cachedFetch<SleeperLeague>(`${V1}/league/${id}`, { ttlMinutes: 15 });
export const getRosters = (id: string) => cachedFetch<SleeperRoster[]>(`${V1}/league/${id}/rosters`, { ttlMinutes: 5 });
export const getLeagueUsers = (id: string) => cachedFetch<SleeperUser[]>(`${V1}/league/${id}/users`, { ttlMinutes: 60 });
export const getMatchups = (id: string, week: number) =>
  cachedFetch<SleeperMatchup[]>(`${V1}/league/${id}/matchups/${week}`, { ttlMinutes: 10 });
export const getTradedPicks = (id: string) =>
  cachedFetch<SleeperTradedPick[]>(`${V1}/league/${id}/traded_picks`, { ttlMinutes: 30 });
export const getLeagueDrafts = (id: string) =>
  cachedFetch<SleeperDraft[]>(`${V1}/league/${id}/drafts`, { ttlMinutes: 60 });

/** The full player DB is ~5MB; Sleeper asks callers to fetch it at most once a day. */
export const getAllPlayers = () =>
  cachedFetch<Record<string, SleeperPlayer>>(`${V1}/players/nfl`, { ttlMinutes: 60 * 12, disk: true, timeoutMs: 60000 });

export const getTrending = (type: "add" | "drop", hours = 24, limit = 100) =>
  cachedFetch<{ player_id: string; count: number }[]>(
    `${V1}/players/nfl/trending/${type}?lookback_hours=${hours}&limit=${limit}`,
    { ttlMinutes: 30 },
  );

const POS_QS = ["QB", "RB", "WR", "TE", "K", "DEF"].map((p) => `position[]=${p}`).join("&");

export const getWeekProjections = (season: number, week: number) =>
  cachedFetch<SleeperProjectionRow[]>(
    `${API}/projections/nfl/${season}/${week}?season_type=regular&${POS_QS}`,
    { ttlMinutes: 60 },
  );

/** Full-season projection (stat totals incl. `gp` when available). */
export const getSeasonProjections = (season: number) =>
  cachedFetch<SleeperProjectionRow[]>(`${API}/projections/nfl/${season}?season_type=regular&${POS_QS}`, {
    ttlMinutes: 60 * 6,
  });

/** Season-to-date actual stat totals. */
export const getSeasonStats = (season: number) =>
  cachedFetch<SleeperProjectionRow[]>(`${API}/stats/nfl/${season}?season_type=regular&${POS_QS}`, {
    ttlMinutes: 60,
  });

export function avatarUrl(avatar: string | null | undefined): string | null {
  if (!avatar) return null;
  return avatar.startsWith("http") ? avatar : `https://sleepercdn.com/avatars/thumbs/${avatar}`;
}
