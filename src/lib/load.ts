// Live data loader: pulls every source in parallel, records per-source health, and builds
// the LeagueSnapshot. Any optional source can fail without breaking the app.

import "server-only";
import { buildSnapshot, type RawInputs } from "./snapshot";
import type { LeagueSnapshot, SourceStatus } from "./types";
import * as sleeper from "./sources/sleeper";
import { getDynastyProcess, getFantasyCalc, getIdMap } from "./sources/values";
import { getEspnWeekProjections } from "./sources/espn";
import { getSchedule, getUsage } from "./sources/nflverse";
import { getGameLines, getPlayerProps, hasOddsKey } from "./sources/odds";
import { getFantasyProsRanks, hasFantasyProsKey } from "./sources/fantasypros";
import { errMessage } from "./http";
import { loadDemoSnapshot } from "./demo";

async function settle<T>(p: Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  try {
    return { ok: true, value: await p };
  } catch (e) {
    return { ok: false, error: errMessage(e) };
  }
}

const snapCache = new Map<string, { at: number; snap: Promise<LeagueSnapshot> }>();
const SNAP_TTL_MS = 5 * 60_000;

/** Cached for a few minutes; `force` re-pulls (upstream responses keep their own TTLs). */
export function loadSnapshot(leagueId: string, myUserId?: string | null, force = false): Promise<LeagueSnapshot> {
  if (leagueId === "demo") return loadDemoSnapshot();
  const key = `${leagueId}:${myUserId ?? ""}`;
  const hit = snapCache.get(key);
  if (!force && hit && Date.now() - hit.at < SNAP_TTL_MS) return hit.snap;
  const snap = loadLive(leagueId, myUserId);
  snapCache.set(key, { at: Date.now(), snap });
  snap.catch(() => snapCache.delete(key));
  return snap;
}

async function loadLive(leagueId: string, myUserId?: string | null): Promise<LeagueSnapshot> {
  const now = new Date().toISOString();

  const [state, league, users, rosters, tradedPicks, drafts, players] = await Promise.all([
    sleeper.getState(),
    sleeper.getLeague(leagueId),
    sleeper.getLeagueUsers(leagueId),
    sleeper.getRosters(leagueId),
    sleeper.getTradedPicks(leagueId).catch(() => []),
    sleeper.getLeagueDrafts(leagueId).catch(() => []),
    sleeper.getAllPlayers(),
  ]);
  if (!league) throw new Error(`League ${leagueId} not found on Sleeper`);

  const season = Number(league.season);
  // In the offseason Sleeper's state can point to week 0/the next season.
  const week = Number(state.season) === season && state.season_type === "regular" ? Math.max(1, state.week) : state.season_type === "post" ? 18 : 1;
  const lastReg = (Number(league.settings.playoff_week_start) || 15) - 1;

  const weeks: number[] = [];
  for (let w = 1; w <= lastReg; w++) weeks.push(w);
  const matchupResults = await Promise.all(weeks.map((w) => sleeper.getMatchups(leagueId, w).catch(() => [])));
  const matchups = Object.fromEntries(weeks.map((w, i) => [w, matchupResults[i]]));

  const rosterCount = league.total_rosters || rosters.length;
  const slots = league.roster_positions ?? [];
  const superflex = slots.includes("SUPER_FLEX") || slots.filter((s) => s === "QB").length >= 2;
  const ppr = league.scoring_settings?.rec ?? 0;

  const [sWeek, sSeason, sStats, trending, espn, fcDyn, fcRed, dp, idMap, schedule, usage, fp] = await Promise.all([
    settle(sleeper.getWeekProjections(season, week)),
    settle(sleeper.getSeasonProjections(season)),
    settle(sleeper.getSeasonStats(season)),
    settle(sleeper.getTrending("add", 24, 200)),
    settle(getEspnWeekProjections(season, week)),
    settle(getFantasyCalc({ dynasty: true, numQbs: superflex ? 2 : 1, numTeams: rosterCount, ppr })),
    settle(getFantasyCalc({ dynasty: false, numQbs: superflex ? 2 : 1, numTeams: rosterCount, ppr })),
    settle(getDynastyProcess()),
    settle(getIdMap()),
    settle(getSchedule(season)),
    settle(getUsage(season)),
    hasFantasyProsKey()
      ? settle(getFantasyProsRanks({ season, week, type: "weekly", scoring: ppr >= 0.75 ? "PPR" : ppr >= 0.25 ? "HALF" : "STD" }))
      : Promise.resolve({ ok: false as const, error: "add FANTASYPROS_API_KEY to enable" }),
  ]);

  // Vegas: game lines + props for this week's games only (props cost API credits).
  let lines: Awaited<ReturnType<typeof getGameLines>> | undefined;
  let props: Awaited<ReturnType<typeof getPlayerProps>> | undefined;
  let oddsStatus: SourceStatus;
  if (hasOddsKey()) {
    const gl = await settle(getGameLines());
    if (gl.ok) {
      lines = gl.value;
      const horizon = Date.now() + 7 * 864e5;
      const thisWeek = lines.filter((l) => new Date(l.kickoff).getTime() < horizon);
      const pr = await settle(getPlayerProps(thisWeek.map((l) => l.eventId)));
      props = pr.ok ? pr.value : undefined;
      oddsStatus = {
        id: "odds",
        label: "The Odds API (Vegas)",
        kinds: ["vegas", "projections"],
        ok: true,
        requiresKey: true,
        detail: `${lines.length} games, ${props?.length ?? 0} player props${pr.ok ? "" : ` (props failed: ${pr.error})`}`,
        fetchedAt: now,
      };
    } else oddsStatus = { id: "odds", label: "The Odds API (Vegas)", kinds: ["vegas", "projections"], ok: false, requiresKey: true, detail: gl.error };
  } else {
    oddsStatus = { id: "odds", label: "The Odds API (Vegas props)", kinds: ["vegas", "projections"], ok: false, requiresKey: true, detail: "add ODDS_API_KEY to enable player props" };
  }

  const status = (id: SourceStatus["id"], label: string, kinds: SourceStatus["kinds"], r: { ok: boolean; error?: string }, okDetail: string, requiresKey = false): SourceStatus => ({
    id,
    label,
    kinds,
    ok: r.ok,
    detail: r.ok ? okDetail : (r as { error: string }).error,
    requiresKey,
    fetchedAt: now,
  });

  const sources: SourceStatus[] = [
    { id: "sleeper", label: "Sleeper (league + projections)", kinds: ["league", "projections"], ok: sWeek.ok, detail: sWeek.ok ? `${sWeek.value.length} week ${week} projections` : `league OK; projections: ${sWeek.error}`, fetchedAt: now },
    status("espn", "ESPN projections", ["projections"], espn, espn.ok ? `${espn.value.length} players` : ""),
    status("fantasycalc", "FantasyCalc (trade market)", ["values"], fcDyn, fcDyn.ok ? `${fcDyn.value.length} assets` : ""),
    status("dynastyprocess", "DynastyProcess (FantasyPros dynasty ECR)", ["values", "experts"], dp, dp.ok ? `${dp.value.players.length} players, ${dp.value.picks.length} picks` : ""),
    status("nflverse", "nflverse (schedule, Vegas lines, usage)", ["vegas", "usage"], schedule, schedule.ok ? `${schedule.value.length / 2} games${usage.ok ? ", usage OK" : ""}` : ""),
    oddsStatus,
    status("fantasypros", "FantasyPros weekly ECR", ["experts"], fp, fp.ok ? `${fp.value.length} ranked players` : "", true),
  ];

  const raw: RawInputs = {
    state: { season, week, seasonType: state.season_type },
    league,
    users,
    rosters,
    tradedPicks,
    drafts,
    matchups,
    players,
    sleeperWeek: sWeek.ok ? sWeek.value : [],
    sleeperSeason: sSeason.ok ? sSeason.value : [],
    sleeperStats: sStats.ok ? sStats.value : [],
    trending: trending.ok ? trending.value : [],
    espnWeek: espn.ok ? espn.value : undefined,
    fantasyCalcDynasty: fcDyn.ok ? fcDyn.value : undefined,
    fantasyCalcRedraft: fcRed.ok ? fcRed.value : undefined,
    dynastyProcess: dp.ok ? dp.value : undefined,
    idMap: idMap.ok ? idMap.value : undefined,
    schedule: schedule.ok ? schedule.value : undefined,
    usage: usage.ok ? usage.value : undefined,
    gameLines: lines,
    props,
    fpWeekly: fp.ok ? fp.value : undefined,
    sources,
    myUserId,
  };
  return buildSnapshot(raw);
}
