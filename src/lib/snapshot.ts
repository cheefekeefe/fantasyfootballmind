// Turns raw upstream data (Sleeper + every projection/value/Vegas source) into one
// LeagueSnapshot in league-specific scoring. Pure function: the live loader and the demo
// fixture both go through it.

import type {
  DraftPick,
  LeagueSettings,
  LeagueSnapshot,
  LeagueType,
  MarketValueSource,
  NflGame,
  PickValue,
  PlayerRecord,
  Position,
  ProjectionInput,
  SourceStatus,
  StatLine,
  Team,
  UsageTrend,
} from "./types";
import { POSITIONS } from "./types";
import type {
  SleeperDraft,
  SleeperLeague,
  SleeperMatchup,
  SleeperPlayer,
  SleeperProjectionRow,
  SleeperRoster,
  SleeperTradedPick,
  SleeperUser,
} from "./sources/sleeper";
import { avatarUrl } from "./sources/sleeper";
import type { DpPickRow, DpPlayerRow, FantasyCalcRow, IdMapRow } from "./sources/values";
import { dpValueFromEcr } from "./sources/values";
import type { EspnProjection } from "./sources/espn";
import type { GameLine, PlayerProp } from "./sources/odds";
import type { FpRankRow } from "./sources/fantasypros";
import { leaguePoints, scoreStats } from "./engine/scoring";
import { vegasStatLine } from "./engine/props";
import { buildConsensus, rankToPoints } from "./engine/consensus";
import { impliedTeamTotal } from "./sources/nflverse";
import { normName, normTeam } from "./teams";
import { isStartingSlot } from "./engine/lineup";

export interface RawInputs {
  state: { season: number; week: number; seasonType?: string };
  league: SleeperLeague;
  users: SleeperUser[];
  rosters: SleeperRoster[];
  tradedPicks: SleeperTradedPick[];
  drafts: SleeperDraft[];
  matchups: Record<number, SleeperMatchup[]>;
  players: Record<string, SleeperPlayer>;
  sleeperWeek: SleeperProjectionRow[];
  sleeperSeason: SleeperProjectionRow[];
  sleeperStats: SleeperProjectionRow[];
  trending: { player_id: string; count: number }[];
  espnWeek?: EspnProjection[];
  fantasyCalcDynasty?: FantasyCalcRow[];
  fantasyCalcRedraft?: FantasyCalcRow[];
  dynastyProcess?: { players: DpPlayerRow[]; picks: DpPickRow[] };
  idMap?: IdMapRow[];
  schedule?: NflGame[];
  usage?: { byGsis: Record<string, UsageTrend>; snapsByPfr: Record<string, { pct: number; last3: number }> };
  gameLines?: GameLine[];
  props?: PlayerProp[];
  fpWeekly?: FpRankRow[];
  sources: SourceStatus[];
  myUserId?: string | null;
  isDemo?: boolean;
}

const LEAGUE_TYPES: LeagueType[] = ["redraft", "keeper", "dynasty"];
const REG_SEASON_WEEKS = 18;

export function buildLeagueSettings(raw: RawInputs): LeagueSettings {
  const l = raw.league;
  const s = l.settings ?? {};
  const scoring = l.scoring_settings ?? {};
  const slots = l.roster_positions ?? [];
  const type = LEAGUE_TYPES[Number(s.type ?? 0)] ?? "redraft";
  const playoffWeekStart = Number(s.playoff_week_start) || 15;
  const qbSlots = slots.filter((x) => x === "QB").length;
  const deadline = Number(s.trade_deadline);
  return {
    id: l.league_id,
    name: l.name,
    season: Number(l.season),
    week: Math.max(1, Math.min(raw.state.week || 1, REG_SEASON_WEEKS)),
    lastRegularSeasonWeek: playoffWeekStart - 1,
    type,
    numTeams: l.total_rosters || raw.rosters.length,
    starterSlots: slots.filter(isStartingSlot),
    benchSlots: slots.filter((x) => x === "BN").length,
    irSlots: Number(s.reserve_slots ?? 0),
    taxiSlots: Number(s.taxi_slots ?? 0),
    scoring,
    superflex: slots.includes("SUPER_FLEX") || qbSlots >= 2,
    ppr: scoring.rec ?? 0,
    tePremium: scoring.bonus_rec_te ?? 0,
    maxKeepers: type === "keeper" ? Number(s.max_keepers ?? 0) : type === "dynasty" ? 99 : 0,
    playoffWeekStart,
    playoffTeams: Number(s.playoff_teams) || 6,
    waiverType: s.waiver_type === 2 ? "faab" : s.waiver_type === 1 ? "reverse_standings" : "rolling",
    waiverBudget: Number(s.waiver_budget ?? 100),
    tradeDeadlineWeek: Number.isFinite(deadline) && deadline > 0 && deadline < 99 ? deadline : null,
    draftRounds: Number(s.draft_rounds) || (type === "dynasty" ? 4 : 15),
    status: l.status,
  };
}

function normalizedScale(values: number[]): number {
  const max = Math.max(0, ...values);
  return max > 0 ? 10000 / max : 1;
}

function playerName(p: SleeperPlayer): string {
  if (p.position === "DEF") return `${p.first_name ?? p.team ?? p.player_id} ${p.last_name ?? "D/ST"}`.trim();
  return p.full_name ?? `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim();
}

function ageFrom(p: SleeperPlayer, today: Date): number | null {
  if (p.birth_date) {
    const b = new Date(p.birth_date);
    if (!Number.isNaN(b.getTime())) return Math.round(((today.getTime() - b.getTime()) / (365.25 * 864e5)) * 10) / 10;
  }
  return p.age ?? null;
}

/** Games a player is expected to miss given an injury designation (current week counts as 1). */
function injuryGamesLost(status: string | null): number {
  switch ((status ?? "").toLowerCase()) {
    case "ir":
    case "pup":
      return 5;
    case "sus":
      return 2;
    case "out":
      return 1;
    case "doubtful":
      return 0.75;
    case "questionable":
      return 0.25;
    default:
      return 0;
  }
}

export function buildSnapshot(raw: RawInputs, now = new Date()): LeagueSnapshot {
  const league = buildLeagueSettings(raw);
  const { scoring, ppr, week, season } = league;

  // ---- NFL schedule, byes, Vegas game lines ---------------------------------------------
  const nflGames: Record<string, NflGame> = {};
  for (const g of raw.schedule ?? []) nflGames[`${g.week}:${g.team}`] = g;
  for (const gl of raw.gameLines ?? []) {
    // Live Odds API lines override nflverse for the current week.
    for (const [team, opp, isHome] of [
      [gl.home, gl.away, true],
      [gl.away, gl.home, false],
    ] as [string, string, boolean][]) {
      const key = `${week}:${team}`;
      const spread = gl.homeSpread === null ? null : isHome ? gl.homeSpread : -gl.homeSpread;
      if (nflGames[key] || raw.schedule === undefined) {
        nflGames[key] = {
          week,
          team,
          opponent: opp,
          home: isHome,
          kickoff: gl.kickoff,
          spread,
          total: gl.total,
          impliedTotal: impliedTeamTotal(gl.total, spread),
        };
      }
    }
  }
  const teamsWithGames = new Map<string, Set<number>>();
  for (const g of Object.values(nflGames)) {
    if (!teamsWithGames.has(g.team)) teamsWithGames.set(g.team, new Set());
    teamsWithGames.get(g.team)!.add(g.week);
  }
  const byeWeek = (team: string | null): number | null => {
    if (!team) return null;
    const weeks = teamsWithGames.get(team);
    if (!weeks || weeks.size < 10) return null;
    for (let w = 1; w <= REG_SEASON_WEEKS; w++) if (!weeks.has(w)) return w;
    return null;
  };

  // ---- Who matters: rostered + anyone with projections, values or buzz -------------------
  const rostered = new Set<string>();
  for (const r of raw.rosters) for (const id of [...(r.players ?? []), ...(r.reserve ?? []), ...(r.taxi ?? [])]) rostered.add(id);

  const weekRows = new Map(raw.sleeperWeek.map((r) => [r.player_id, r]));
  const seasonRows = new Map(raw.sleeperSeason.map((r) => [r.player_id, r]));
  const statRows = new Map(raw.sleeperStats.map((r) => [r.player_id, r]));
  const trending = new Map(raw.trending.map((t) => [t.player_id, t.count]));

  // ID map lookups
  const bySleeper = new Map<string, IdMapRow>();
  const fpToSleeper = new Map<string, string>();
  const espnToSleeper = new Map<string, string>();
  const gsisToSleeper = new Map<string, string>();
  for (const m of raw.idMap ?? []) {
    if (!m.sleeper) continue;
    bySleeper.set(m.sleeper, m);
    if (m.fantasypros) fpToSleeper.set(m.fantasypros, m.sleeper);
    if (m.espn) espnToSleeper.set(m.espn, m.sleeper);
    if (m.gsis) gsisToSleeper.set(m.gsis, m.sleeper);
  }

  // Market values
  const fcDyn = new Map<string, FantasyCalcRow>();
  const fcRed = new Map<string, FantasyCalcRow>();
  const fcDynScale = normalizedScale((raw.fantasyCalcDynasty ?? []).filter((r) => r.player.position !== "PICK").map((r) => r.value));
  const fcRedScale = normalizedScale((raw.fantasyCalcRedraft ?? []).map((r) => r.value));
  for (const r of raw.fantasyCalcDynasty ?? []) if (r.player.sleeperId) fcDyn.set(String(r.player.sleeperId), r);
  for (const r of raw.fantasyCalcRedraft ?? []) if (r.player.sleeperId) fcRed.set(String(r.player.sleeperId), r);
  const dpRows = new Map<string, DpPlayerRow>();
  for (const r of raw.dynastyProcess?.players ?? []) {
    const sid = fpToSleeper.get(r.fpId);
    if (sid) dpRows.set(sid, r);
  }
  const dpScale = normalizedScale((raw.dynastyProcess?.players ?? []).map((r) => (league.superflex ? r.value2qb : r.value1qb) ?? 0));

  const candidates = new Set<string>(rostered);
  for (const id of [...weekRows.keys(), ...seasonRows.keys(), ...fcDyn.keys(), ...fcRed.keys(), ...dpRows.keys(), ...trending.keys()]) {
    candidates.add(id);
  }

  // ---- Remaining weeks ------------------------------------------------------------------
  const lastWeek = Math.min(REG_SEASON_WEEKS, league.playoffWeekStart + 2);
  const remainingWeeks: number[] = [];
  for (let w = week; w <= lastWeek; w++) remainingWeeks.push(w);

  const players: Record<string, PlayerRecord> = {};

  for (const id of candidates) {
    const sp = raw.players[id];
    if (!sp || !sp.position) continue;
    const position = (sp.position === "DST" ? "DEF" : sp.position) as Position;
    if (!POSITIONS.includes(position)) continue;
    const team = normTeam(sp.team);
    const isRostered = rostered.has(id);
    if (!team && !isRostered && !fcDyn.has(id) && !dpRows.has(id)) continue;

    const wk = weekRows.get(id);
    const ssn = seasonRows.get(id);
    const st = statRows.get(id);

    // Season-to-date production in league scoring.
    let actualPpg: number | undefined;
    let gamesPlayed: number | undefined;
    if (st?.stats) {
      const gp = st.stats.gp ?? 0;
      if (gp > 0) {
        gamesPlayed = gp;
        actualPpg = Math.round((leaguePoints(st.stats, scoring, position, ppr) / gp) * 10) / 10;
      }
    }

    const seasonPts = ssn?.stats ? leaguePoints(ssn.stats, scoring, position, ppr) : null;
    const seasonGp = ssn?.stats?.gp && ssn.stats.gp > 0 ? ssn.stats.gp : 17;
    const seasonPpg = seasonPts !== null ? seasonPts / seasonGp : null;
    const weekPts = wk?.stats ? leaguePoints(wk.stats, scoring, position, ppr) : null;

    const inputs: ProjectionInput[] = [];
    if (weekPts !== null) inputs.push({ source: raw.isDemo ? "demo" : "sleeper", label: raw.isDemo ? "Sleeper (demo)" : "Sleeper", points: round1(weekPts), stats: wk?.stats });

    players[id] = {
      id,
      name: playerName(sp),
      position,
      team,
      age: position === "DEF" ? null : ageFrom(sp, now),
      yearsExp: sp.years_exp ?? null,
      injuryStatus: sp.injury_status ?? null,
      byeWeek: byeWeek(team),
      market: { dynasty: null, redraft: null, sources: [] },
      week: null,
      ros: { ppg: 0, games: 0, total: 0, actualPpg, gamesPlayed },
      trendingAdds: trending.get(id),
      // stash raw numbers for the second pass
      ...({ _inputs: inputs, _seasonPpg: seasonPpg, _weekPts: weekPts } as object),
    } as PlayerRecord;
  }

  // ---- ESPN projections -----------------------------------------------------------------
  for (const e of raw.espnWeek ?? []) {
    const sid = e.position === "DEF" ? e.team ?? undefined : espnToSleeper.get(e.espnId);
    const p = sid ? players[sid] : undefined;
    if (!p) continue;
    const hasStats = Object.keys(e.stats).length > 0;
    const pts = p.position === "K" || p.position === "DEF" || !hasStats ? e.pprPoints : scoreStats(e.stats, scoring, p.position);
    inputsOf(p).push({ source: "espn", label: "ESPN", points: round1(pts), stats: hasStats ? e.stats : undefined });
  }

  // ---- Vegas player props -----------------------------------------------------------------
  if (raw.props?.length) {
    const byName = new Map<string, PlayerProp[]>();
    for (const pr of raw.props) {
      const k = normName(pr.player);
      byName.set(k, [...(byName.get(k) ?? []), pr]);
    }
    const nameIndex = new Map<string, PlayerRecord[]>();
    for (const p of Object.values(players)) {
      if (p.position === "K" || p.position === "DEF") continue;
      const k = normName(p.name);
      nameIndex.set(k, [...(nameIndex.get(k) ?? []), p]);
    }
    for (const [k, props] of byName) {
      const matches = (nameIndex.get(k) ?? []).filter((p) => p.team && nflGames[`${week}:${p.team}`]);
      if (matches.length !== 1) continue; // ambiguous or unmatched names are skipped
      const p = matches[0];
      const base = weekRows.get(p.id)?.stats ?? {};
      const informative = props.filter((x) => x.market !== "player_pass_interceptions");
      if (!informative.length) continue;
      const line: StatLine = vegasStatLine(base, props, p.position);
      const pts = scoreStats(line, scoring, p.position);
      inputsOf(p).push({
        source: "odds",
        label: raw.isDemo ? "Vegas props (simulated)" : "Vegas props",
        points: round1(pts),
        stats: line,
        note: props.map((x) => `${x.market.replace("player_", "")}${x.line !== null ? ` ${x.line}` : ""} (${Math.round(x.overProb * 100)}%)`).join(", "),
      });
    }
  }

  // ---- FantasyPros weekly ECR -> points via the other sources' positional curve -----------
  if (raw.fpWeekly?.length) {
    const curve = new Map<Position, number[]>();
    for (const p of Object.values(players)) {
      const ins = inputsOf(p);
      if (!ins.length) continue;
      const avg = ins.reduce((a, i) => a + i.points, 0) / ins.length;
      curve.set(p.position, [...(curve.get(p.position) ?? []), avg]);
    }
    for (const arr of curve.values()) arr.sort((a, b) => b - a);
    for (const r of raw.fpWeekly) {
      const sid = r.position === "DEF" ? normTeam(r.team) ?? undefined : fpToSleeper.get(r.fpId);
      const p = sid ? players[sid] : undefined;
      if (!p || !r.posRank) continue;
      const pts = rankToPoints(r.posRank, curve.get(p.position) ?? []);
      p.ecr = { ...p.ecr, weekly: r.rankEcr, weeklyPos: r.posRank };
      if (pts !== null) inputsOf(p).push({ source: "fantasypros", label: "FantasyPros ECR", points: round1(pts), note: `${p.position}${r.posRank} (ECR ${r.rankEcr})` });
    }
  }

  // ---- Consensus, ROS, market values, usage ---------------------------------------------
  for (const p of Object.values(players)) {
    const extra = p as unknown as { _inputs: ProjectionInput[]; _seasonPpg: number | null; _weekPts: number | null };
    const onBye = p.byeWeek === week;
    const status = (p.injuryStatus ?? "").toLowerCase();
    const ruledOut = ["out", "ir", "pup", "sus", "na"].includes(status);
    let wp = buildConsensus(week, p.position, extra._inputs);
    if (wp && (onBye || ruledOut)) wp = { ...wp, median: 0, floor: 0, ceiling: 0 };
    p.week = wp;

    // Per-game ROS rate: blend this week's consensus, the season projection and actual production.
    const parts: [number, number][] = [];
    if (wp && !onBye && !ruledOut) parts.push([extraConsensus(extra._inputs), 0.4]);
    if (extra._seasonPpg !== null) parts.push([extra._seasonPpg, 0.35]);
    if (p.ros.actualPpg !== undefined && (p.ros.gamesPlayed ?? 0) >= 2) parts.push([p.ros.actualPpg, 0.25 * Math.min(1, (p.ros.gamesPlayed ?? 0) / 6)]);
    const wSum = parts.reduce((a, [, w]) => a + w, 0);
    const ppg = wSum ? parts.reduce((a, [v, w]) => a + v * w, 0) / wSum : 0;
    const byeLeft = p.byeWeek !== null && p.byeWeek >= week && p.byeWeek <= lastWeek ? 1 : 0;
    const games = Math.max(0, remainingWeeks.length - byeLeft - injuryGamesLost(p.injuryStatus));
    p.ros = { ...p.ros, ppg: round1(ppg), games: round1(games), total: round1(ppg * games) };

    // Market values
    const sources: MarketValueSource[] = [];
    const fcd = fcDyn.get(p.id);
    const fcr = fcRed.get(p.id);
    if (fcd || fcr) {
      sources.push({
        source: "fantasycalc",
        label: "FantasyCalc",
        dynasty: fcd ? Math.round(fcd.value * fcDynScale) : undefined,
        redraft: fcr ? Math.round(fcr.value * fcRedScale) : undefined,
        trend30: fcd?.trend30Day !== undefined ? Math.round(fcd.trend30Day * fcDynScale) : undefined,
      });
    }
    const dp = dpRows.get(p.id);
    if (dp) {
      const v = league.superflex ? dp.value2qb : dp.value1qb;
      if (v !== null) sources.push({ source: "dynastyprocess", label: "DynastyProcess (FantasyPros ECR)", dynasty: Math.round(v * dpScale) });
      p.ecr = { ...p.ecr, dynasty: (league.superflex ? dp.ecr2qb : dp.ecr1qb) ?? undefined, dynastyPos: dp.ecrPos ?? undefined };
    }
    const dyn = sources.map((s) => s.dynasty).filter((x): x is number => x !== undefined);
    const red = sources.map((s) => s.redraft).filter((x): x is number => x !== undefined);
    p.market = {
      dynasty: dyn.length ? Math.round(dyn.reduce((a, b) => a + b, 0) / dyn.length) : null,
      redraft: red.length ? Math.round(red.reduce((a, b) => a + b, 0) / red.length) : null,
      sources,
      trend30: sources.find((s) => s.trend30 !== undefined)?.trend30,
    };

    // Usage (nflverse)
    const ids = bySleeper.get(p.id);
    if (raw.usage && ids) {
      const u = ids.gsis ? raw.usage.byGsis[ids.gsis] : undefined;
      const sn = ids.pfr ? raw.usage.snapsByPfr[ids.pfr] : undefined;
      if (u || sn) p.usage = { ...(u ?? { games: 0 }), snapPct: sn?.pct, snapPctLast3: sn?.last3 };
    }
    if (!p.age && ids?.birthdate && p.position !== "DEF") {
      const b = new Date(ids.birthdate);
      p.age = Math.round(((now.getTime() - b.getTime()) / (365.25 * 864e5)) * 10) / 10;
    }
    delete (p as unknown as Record<string, unknown>)._inputs;
    delete (p as unknown as Record<string, unknown>)._seasonPpg;
    delete (p as unknown as Record<string, unknown>)._weekPts;
  }

  // Drop irrelevant free agents to keep the snapshot small.
  for (const [id, p] of Object.entries(players)) {
    if (rostered.has(id)) continue;
    const relevant = p.ros.ppg >= 2 || (p.market.dynasty ?? 0) >= 300 || (p.trendingAdds ?? 0) > 0 || (p.week?.median ?? 0) >= 2;
    if (!relevant || !p.team) delete players[id];
  }

  // ---- Teams ----------------------------------------------------------------------------
  const userById = new Map(raw.users.map((u) => [u.user_id, u]));
  const completedWeeks = Object.keys(raw.matchups)
    .map(Number)
    .filter((w) => w < week)
    .sort((a, b) => a - b);
  const picksByRoster = buildPicks(raw, league);

  const teams: Team[] = raw.rosters
    .map((r) => {
      const u = r.owner_id ? userById.get(r.owner_id) : undefined;
      const s = r.settings ?? {};
      const fpts = Number(s.fpts ?? 0) + Number(s.fpts_decimal ?? 0) / 100;
      const fpa = Number(s.fpts_against ?? 0) + Number(s.fpts_against_decimal ?? 0) / 100;
      return {
        rosterId: r.roster_id,
        ownerId: r.owner_id,
        ownerName: u?.display_name ?? `Team ${r.roster_id}`,
        teamName: u?.metadata?.team_name || u?.display_name || `Team ${r.roster_id}`,
        avatar: avatarUrl(u?.avatar),
        players: (r.players ?? []).filter((id) => !(r.reserve ?? []).includes(id) && !(r.taxi ?? []).includes(id)),
        starters: (r.starters ?? []).filter((x) => x && x !== "0"),
        reserve: r.reserve ?? [],
        taxi: r.taxi ?? [],
        record: {
          wins: Number(s.wins ?? 0),
          losses: Number(s.losses ?? 0),
          ties: Number(s.ties ?? 0),
          pointsFor: round1(fpts),
          pointsAgainst: round1(fpa),
        },
        faabRemaining: league.waiverType === "faab" ? league.waiverBudget - Number(s.waiver_budget_used ?? 0) : null,
        waiverPosition: s.waiver_position !== undefined ? Number(s.waiver_position) : null,
        picks: picksByRoster.get(r.roster_id) ?? [],
        weeklyScores: completedWeeks.map((w) => raw.matchups[w]?.find((m) => m.roster_id === r.roster_id)?.points ?? 0),
      };
    })
    .sort((a, b) => a.rosterId - b.rosterId);

  // ---- Remaining head-to-head schedule ---------------------------------------------------
  const schedule: Record<number, [number, number][]> = {};
  for (const [wStr, ms] of Object.entries(raw.matchups)) {
    const w = Number(wStr);
    if (w < week || w > league.lastRegularSeasonWeek) continue;
    const byMatch = new Map<number, number[]>();
    for (const m of ms) {
      if (m.matchup_id === null || m.matchup_id === undefined) continue;
      byMatch.set(m.matchup_id, [...(byMatch.get(m.matchup_id) ?? []), m.roster_id]);
    }
    schedule[w] = [...byMatch.values()].filter((x) => x.length === 2).map((x) => [x[0], x[1]] as [number, number]);
  }

  const mine = raw.myUserId
    ? raw.rosters.find((r) => r.owner_id === raw.myUserId || (r.co_owners ?? []).includes(raw.myUserId!))
    : undefined;

  return {
    generatedAt: now.toISOString(),
    isDemo: Boolean(raw.isDemo),
    league,
    teams,
    players,
    schedule,
    nflGames,
    pickValues: buildPickValues(raw, league, fcDynScale, dpScale),
    sources: raw.sources,
    myRosterId: mine?.roster_id ?? null,
  };
}

function inputsOf(p: PlayerRecord): ProjectionInput[] {
  return (p as unknown as { _inputs: ProjectionInput[] })._inputs;
}

function extraConsensus(inputs: ProjectionInput[]): number {
  return buildConsensus(0, "WR", inputs)?.median ?? 0;
}

const round1 = (x: number) => Math.round(x * 10) / 10;

/**
 * Future draft pick ownership: every team starts with its own picks, then Sleeper's
 * traded_picks list moves them around.
 */
function buildPicks(raw: RawInputs, league: LeagueSettings): Map<number, DraftPick[]> {
  const out = new Map<number, DraftPick[]>();
  if (league.type === "redraft") return out;
  const seasons = new Set<number>();
  const currentDraft = raw.drafts.find((d) => Number(d.season) === league.season);
  if (currentDraft && currentDraft.status !== "complete") seasons.add(league.season);
  const horizon = league.type === "dynasty" ? 3 : 1;
  for (let i = 1; i <= horizon; i++) seasons.add(league.season + i);
  // Picks traded further out than the default horizon still exist.
  for (const tp of raw.tradedPicks) if (Number(tp.season) > league.season) seasons.add(Number(tp.season));

  const rounds = league.draftRounds;
  const owner = new Map<string, number>();
  for (const s of seasons) for (const r of raw.rosters) for (let rd = 1; rd <= rounds; rd++) owner.set(`${s}:${rd}:${r.roster_id}`, r.roster_id);
  for (const tp of raw.tradedPicks) {
    const k = `${tp.season}:${tp.round}:${tp.roster_id}`;
    if (owner.has(k)) owner.set(k, tp.owner_id);
  }
  // Known draft slots
  const slotOf = new Map<string, number>();
  for (const d of raw.drafts) {
    if (d.status === "complete" || !d.draft_order) continue;
    const userSlot = d.draft_order;
    for (const r of raw.rosters) {
      if (r.owner_id && userSlot[r.owner_id]) slotOf.set(`${d.season}:${r.roster_id}`, userSlot[r.owner_id]);
    }
    for (const [slot, rid] of Object.entries(d.slot_to_roster_id ?? {})) slotOf.set(`${d.season}:${rid}`, Number(slot));
  }
  for (const [k, ownerId] of owner) {
    const [season, round, orig] = k.split(":").map(Number);
    const list = out.get(ownerId) ?? [];
    list.push({ season, round, originalRosterId: orig, ownerRosterId: ownerId, slot: slotOf.get(`${season}:${orig}`) });
    out.set(ownerId, list);
  }
  for (const list of out.values()) list.sort((a, b) => a.season - b.season || a.round - b.round || a.originalRosterId - b.originalRosterId);
  return out;
}

/** Parse pick names like "2027 Early 1st", "2027 1st", "2026 Pick 1.01", "2027 Round 2". */
export function parsePickName(name: string): Omit<PickValue, "source" | "value"> | null {
  const m1 = name.match(/(\d{4})\s+Pick\s+(\d+)\.(\d+)/i);
  if (m1) return { season: Number(m1[1]), round: Number(m1[2]), tier: "any", slot: Number(m1[3]) };
  const m2 = name.match(/(\d{4})\s+(?:(Early|Mid|Late)\s+)?(\d)(?:st|nd|rd|th)/i);
  if (m2) {
    const tier = (m2[2]?.toLowerCase() ?? "any") as PickValue["tier"];
    return { season: Number(m2[1]), round: Number(m2[3]), tier };
  }
  const m3 = name.match(/(\d{4})\s+Round\s+(\d+)/i);
  if (m3) return { season: Number(m3[1]), round: Number(m3[2]), tier: "any" };
  return null;
}

function buildPickValues(raw: RawInputs, league: LeagueSettings, fcScale: number, dpScale: number): PickValue[] {
  const out: PickValue[] = [];
  for (const r of raw.dynastyProcess?.picks ?? []) {
    const parsed = parsePickName(r.name);
    const ecr = league.superflex ? r.ecr2qb : r.ecr1qb;
    if (!parsed || ecr === null) continue;
    out.push({ ...parsed, source: "dynastyprocess", value: Math.round(dpValueFromEcr(ecr) * dpScale) });
  }
  for (const r of raw.fantasyCalcDynasty ?? []) {
    if (r.player.position !== "PICK") continue;
    const parsed = parsePickName(r.player.name);
    if (parsed) out.push({ ...parsed, source: "fantasycalc", value: Math.round(r.value * fcScale) });
  }
  return out;
}
