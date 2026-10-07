// Core domain types shared by the data layer, the decision engines and the UI.
// Everything the engines need is captured in a serializable LeagueSnapshot so the
// heavy logic can run on the server or in the browser (the trade machine is interactive).

export type Position = "QB" | "RB" | "WR" | "TE" | "K" | "DEF";
export const POSITIONS: Position[] = ["QB", "RB", "WR", "TE", "K", "DEF"];
export const SKILL_POSITIONS: Position[] = ["QB", "RB", "WR", "TE"];

export type LeagueType = "redraft" | "keeper" | "dynasty";

/** A starting slot as Sleeper names it (QB, RB, FLEX, SUPER_FLEX, REC_FLEX, WRRB_FLEX, K, DEF...). */
export type SlotName = string;

export type SourceId =
  | "sleeper"
  | "espn"
  | "fantasycalc"
  | "dynastyprocess"
  | "nflverse"
  | "odds"
  | "fantasypros"
  | "demo";

export type SourceKind = "league" | "projections" | "values" | "vegas" | "experts" | "usage";

export interface SourceStatus {
  id: SourceId;
  label: string;
  kinds: SourceKind[];
  ok: boolean;
  /** Short human readable status, e.g. "412 players" or "missing ODDS_API_KEY". */
  detail: string;
  requiresKey?: boolean;
  fetchedAt?: string;
}

/** A raw stat line keyed by Sleeper stat keys (pass_yd, rec, rush_td, ...). */
export type StatLine = Record<string, number>;

export interface ProjectionInput {
  source: SourceId;
  label: string;
  points: number;
  stats?: StatLine;
  note?: string;
}

export interface WeekProjection {
  week: number;
  /** One entry per source that projected the player. */
  inputs: ProjectionInput[];
  /** Weighted consensus (median-like) projection in league scoring. */
  median: number;
  floor: number;
  ceiling: number;
  /** 0..1, how much the sources agree (1 = identical). */
  agreement: number;
}

export interface UsageTrend {
  games: number;
  snapPct?: number;
  snapPctLast3?: number;
  targetShare?: number;
  targetShareLast3?: number;
  carriesPerGame?: number;
  carriesLast3?: number;
  airYardsShare?: number;
  ppgActual?: number;
  ppgLast3?: number;
}

export interface MarketValueSource {
  source: SourceId;
  label: string;
  dynasty?: number;
  redraft?: number;
  trend30?: number;
}

export interface PlayerRecord {
  id: string;
  name: string;
  position: Position;
  team: string | null;
  age: number | null;
  yearsExp: number | null;
  injuryStatus: string | null;
  byeWeek: number | null;
  /** Market values on a common 0..~10500 scale (top asset ≈ 10000). */
  market: {
    dynasty: number | null;
    redraft: number | null;
    sources: MarketValueSource[];
    trend30?: number;
  };
  /** Expert consensus ranks when available. */
  ecr?: { weekly?: number; weeklyPos?: number; ros?: number; dynasty?: number; dynastyPos?: number };
  /** Projection for the current week in league scoring. */
  week: WeekProjection | null;
  /** Rest-of-season outlook in league scoring. */
  ros: { ppg: number; games: number; total: number; actualPpg?: number; gamesPlayed?: number };
  usage?: UsageTrend;
  /** Sleeper trending adds over the last 24h. */
  trendingAdds?: number;
}

export interface DraftPick {
  season: number;
  round: number;
  /** roster_id of the team whose pick this originally was (drives projected slot). */
  originalRosterId: number;
  ownerRosterId: number;
  /** Known slot (1..numTeams) if the draft order is set. */
  slot?: number;
}

export interface TeamRecord {
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
}

export interface Team {
  rosterId: number;
  ownerId: string | null;
  ownerName: string;
  teamName: string;
  avatar: string | null;
  players: string[];
  starters: string[];
  reserve: string[];
  taxi: string[];
  record: TeamRecord;
  faabRemaining: number | null;
  waiverPosition: number | null;
  picks: DraftPick[];
  /** Per-week actual scores for completed weeks (for variance / luck). */
  weeklyScores: number[];
}

export interface NflGame {
  week: number;
  team: string;
  opponent: string;
  home: boolean;
  kickoff: string | null;
  /** Spread from this team's perspective (negative = favored). */
  spread: number | null;
  total: number | null;
  impliedTotal: number | null;
}

export interface LeagueSettings {
  id: string;
  name: string;
  season: number;
  /** Current NFL week (the week lineups are being set for). */
  week: number;
  lastRegularSeasonWeek: number;
  type: LeagueType;
  numTeams: number;
  starterSlots: SlotName[];
  benchSlots: number;
  irSlots: number;
  taxiSlots: number;
  scoring: Record<string, number>;
  superflex: boolean;
  /** Points per reception for RB/WR. */
  ppr: number;
  /** Extra points per reception for TEs. */
  tePremium: number;
  maxKeepers: number;
  playoffWeekStart: number;
  playoffTeams: number;
  waiverType: "faab" | "rolling" | "reverse_standings";
  waiverBudget: number;
  tradeDeadlineWeek: number | null;
  draftRounds: number;
  status: string;
}

/** A market value for a draft pick, by season/round and optionally tier or exact slot. */
export interface PickValue {
  source: SourceId;
  season: number;
  round: number;
  tier: "early" | "mid" | "late" | "any";
  slot?: number;
  value: number;
}

export interface LeagueSnapshot {
  generatedAt: string;
  isDemo: boolean;
  league: LeagueSettings;
  teams: Team[];
  players: Record<string, PlayerRecord>;
  /** Remaining regular season matchups: week -> list of [rosterId, rosterId]. */
  schedule: Record<number, [number, number][]>;
  /** NFL games keyed by `${week}:${team}`. */
  nflGames: Record<string, NflGame>;
  pickValues: PickValue[];
  sources: SourceStatus[];
  /** roster_id of the connected user's team, if known. */
  myRosterId: number | null;
}

export type TeamWindow = "contender" | "win-now" | "fringe" | "retool" | "rebuild";
