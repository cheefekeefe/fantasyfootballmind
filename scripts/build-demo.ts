/**
 * Builds data/demo-raw.json: a realistic 12-team dynasty league for demo mode and tests.
 *
 * Real inputs: DynastyProcess values + pick values + ID map, the nflverse schedule (with
 * Vegas spreads/totals), nflverse weekly stats for completed weeks.
 * Synthesized: league rosters (seeded snake draft), Sleeper-style projections (built from
 * real production + market value), a handful of simulated player props.
 *
 * Usage: npm run demo:build
 */
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { parseCsv, num } from "../src/lib/http";
import { normTeam } from "../src/lib/teams";
import { scheduleFromCsv, usageFromCsv, snapsFromCsv } from "../src/lib/sources/nflverse";
import type { RawInputs } from "../src/lib/snapshot";
import type { SleeperPlayer, SleeperProjectionRow, SleeperRoster, SleeperMatchup } from "../src/lib/sources/sleeper";
import type { PlayerProp } from "../src/lib/sources/odds";
import type { DpPlayerRow, DpPickRow, IdMapRow } from "../src/lib/sources/values";

const SEASON = 2026;
const WEEK = 5;
const DP = "https://raw.githubusercontent.com/dynastyprocess/data/master/files";
const NFLV = "https://github.com/nflverse/nflverse-data/releases/download";

async function text(url: string) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.text();
}

function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(20261007);
const jitter = (pct: number) => 1 + (rand() * 2 - 1) * pct;

const TEAM_NAMES = [
  ["you", "Your Team"],
  ["gridiron_gurus", "Gridiron Gurus"],
  ["taxi_squad_kings", "Taxi Squad Kings"],
  ["the_waiver_hawks", "Waiver Hawks"],
  ["handcuff_heroes", "Handcuff Heroes"],
  ["late_round_qbs", "Late Round QBs"],
  ["zero_rb_zealots", "Zero RB Zealots"],
  ["bye_week_blues", "Bye Week Blues"],
  ["sunday_scaries", "Sunday Scaries"],
  ["pick_hoarders", "Pick Hoarders"],
  ["flex_appeal", "Flex Appeal"],
  ["the_commish", "The Commish"],
];

async function main() {
  console.log("downloading sources…");
  const [vp, vk, ids, games, weekly, snaps] = await Promise.all([
    text(`${DP}/values-players.csv`),
    text(`${DP}/values-picks.csv`),
    text(`${DP}/db_playerids.csv`),
    text("https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv"),
    text(`${NFLV}/stats_player/stats_player_week_${SEASON}.csv`),
    text(`${NFLV}/snap_counts/snap_counts_${SEASON}.csv`),
  ]);

  const idRows = parseCsv(ids);
  const clean = (v: string) => (v && v !== "NA" ? v : null);
  const idMap: IdMapRow[] = idRows
    .filter((r) => clean(r.sleeper_id))
    .map((r) => ({
      sleeper: clean(r.sleeper_id),
      fantasypros: clean(r.fantasypros_id),
      espn: clean(r.espn_id),
      gsis: clean(r.gsis_id),
      pfr: clean(r.pfr_id),
      name: r.name,
      position: r.position,
      team: clean(r.team),
      birthdate: clean(r.birthdate),
    }));
  const byFp = new Map(idMap.filter((m) => m.fantasypros).map((m) => [m.fantasypros!, m]));
  const byGsis = new Map(idMap.filter((m) => m.gsis).map((m) => [m.gsis!, m]));
  const draftYear = new Map(idRows.map((r) => [clean(r.sleeper_id), num(r.draft_year)]));

  const dpPlayers: DpPlayerRow[] = parseCsv(vp).map((r) => ({
    name: r.player,
    pos: r.pos,
    team: r.team || null,
    age: num(r.age),
    ecr1qb: num(r.ecr_1qb),
    ecr2qb: num(r.ecr_2qb),
    ecrPos: num(r.ecr_pos),
    value1qb: num(r.value_1qb),
    value2qb: num(r.value_2qb),
    fpId: r.fp_id,
  }));
  const dpPicks: DpPickRow[] = parseCsv(vk).map((r) => ({ name: r.player, ecr1qb: num(r.ecr_1qb), ecr2qb: num(r.ecr_2qb) }));

  // ---- Weekly actuals (nflverse) ----
  type Actual = Record<string, number>;
  const actualByWeek = new Map<string, Map<number, Actual>>(); // sleeperId -> week -> stats
  const weeklyRows = parseCsv(weekly).filter((r) => r.season_type === "REG");
  for (const r of weeklyRows) {
    const m = byGsis.get(r.player_id);
    if (!m?.sleeper) continue;
    const s: Actual = {
      pass_yd: num(r.passing_yards) ?? 0,
      pass_td: num(r.passing_tds) ?? 0,
      pass_int: num(r.passing_interceptions) ?? 0,
      rush_yd: num(r.rushing_yards) ?? 0,
      rush_td: num(r.rushing_tds) ?? 0,
      rush_att: num(r.carries) ?? 0,
      rec: num(r.receptions) ?? 0,
      rec_tgt: num(r.targets) ?? 0,
      rec_yd: num(r.receiving_yards) ?? 0,
      rec_td: num(r.receiving_tds) ?? 0,
      fum_lost: (num(r.rushing_fumbles_lost) ?? 0) + (num(r.receiving_fumbles_lost) ?? 0) + (num(r.sack_fumbles_lost) ?? 0),
      fgm: num(r.fg_made) ?? 0,
      xpm: num(r.pat_made) ?? 0,
      pts_ppr: num(r.fantasy_points_ppr) ?? 0,
    };
    if (r.position === "K") s.pts_ppr = (num(r.fg_made) ?? 0) * 3.3 + (num(r.pat_made) ?? 0);
    const wk = Number(r.week);
    if (!actualByWeek.has(m.sleeper)) actualByWeek.set(m.sleeper, new Map());
    actualByWeek.get(m.sleeper)!.set(wk, s);
  }

  const schedule = scheduleFromCsv(games, SEASON);
  const gameOf = (team: string | null, week: number) => schedule.find((g) => g.team === team && g.week === week);

  // ---- Player universe ----
  const players: Record<string, SleeperPlayer> = {};
  const value = new Map<string, number>();
  for (const d of dpPlayers) {
    const m = byFp.get(d.fpId);
    if (!m?.sleeper) continue;
    const team = normTeam(d.team ?? m.team);
    const dy = draftYear.get(m.sleeper);
    players[m.sleeper] = {
      player_id: m.sleeper,
      full_name: d.name,
      position: d.pos,
      team,
      birth_date: m.birthdate,
      age: d.age,
      years_exp: dy ? SEASON - dy : null,
      injury_status: null,
      active: true,
    };
    value.set(m.sleeper, d.value1qb ?? 0);
  }
  // Kickers from actual stats
  const kickers = new Set(weeklyRows.filter((r) => r.position === "K").map((r) => r.player_id));
  for (const g of kickers) {
    const m = byGsis.get(g);
    const r = weeklyRows.find((x) => x.player_id === g)!;
    if (!m?.sleeper) continue;
    players[m.sleeper] = { player_id: m.sleeper, full_name: r.player_display_name, position: "K", team: normTeam(r.team), active: true, injury_status: null };
  }
  // Team defenses
  const nflTeams = [...new Set(schedule.map((g) => g.team))];
  for (const t of nflTeams) players[t] = { player_id: t, first_name: t, last_name: "D/ST", position: "DEF", team: t, active: true };

  // A few realistic injury designations (seeded).
  const skill = Object.values(players).filter((p) => ["QB", "RB", "WR", "TE"].includes(p.position ?? ""));
  const statuses = ["Questionable", "Questionable", "Questionable", "Questionable", "Out", "Out", "IR", "Doubtful"];
  for (const s of statuses) {
    const p = skill[Math.floor(rand() * Math.min(skill.length, 260))];
    if (!p.injury_status) p.injury_status = s;
  }

  // ---- Projections ----
  const POS_CURVE: Record<string, [number, number]> = { QB: [11, 12], RB: [4.5, 15], WR: [4.5, 14], TE: [3.5, 11] };
  const TEMPLATE: Record<string, Record<string, number>> = {
    QB: { pass_yd: 235, pass_td: 1.6, pass_int: 0.7, rush_yd: 18, rush_td: 0.15, fum_lost: 0.1 },
    RB: { rush_yd: 55, rush_td: 0.42, rec: 2.6, rec_yd: 20, rec_td: 0.1, rush_att: 13, fum_lost: 0.05 },
    WR: { rec: 4.8, rec_yd: 60, rec_td: 0.38, rush_yd: 2, rec_tgt: 7.2 },
    TE: { rec: 4, rec_yd: 42, rec_td: 0.3, rec_tgt: 5.6 },
  };
  const pprOf = (s: Record<string, number>) =>
    (s.pass_yd ?? 0) * 0.04 + (s.pass_td ?? 0) * 4 - (s.pass_int ?? 0) + (s.rush_yd ?? 0) * 0.1 + (s.rush_td ?? 0) * 6 + (s.rec ?? 0) + (s.rec_yd ?? 0) * 0.1 + (s.rec_td ?? 0) * 6 - (s.fum_lost ?? 0) * 2;

  const sleeperSeason: SleeperProjectionRow[] = [];
  const sleeperWeek: SleeperProjectionRow[] = [];
  const sleeperStats: SleeperProjectionRow[] = [];
  const perGame = new Map<string, Record<string, number>>();

  for (const p of Object.values(players)) {
    const pos = p.position!;
    const act = actualByWeek.get(p.player_id);
    const weeksPlayed = act ? [...act.keys()].filter((w) => w < WEEK) : [];
    // Season-to-date actual totals
    if (act && weeksPlayed.length) {
      const tot: Record<string, number> = { gp: weeksPlayed.length };
      for (const w of weeksPlayed) for (const [k, v] of Object.entries(act.get(w)!)) if (k !== "pts_ppr") tot[k] = (tot[k] ?? 0) + v;
      sleeperStats.push({ player_id: p.player_id, stats: tot });
    }
    if (pos === "K" || pos === "DEF") {
      const base = pos === "K" ? 8 : 7;
      const g = gameOf(p.team, WEEK);
      const opp = g ? gameOf(g.opponent, WEEK) : undefined;
      const env = pos === "K" ? (g?.impliedTotal ?? 22) / 22 : 22 / Math.max(14, opp?.impliedTotal ?? 22);
      perGame.set(p.player_id, { pts_ppr: base * jitter(0.15) });
      sleeperSeason.push({ player_id: p.player_id, stats: { pts_ppr: base * 17, pts_half_ppr: base * 17, pts_std: base * 17, gp: 17 } });
      if (g) {
        const pts = Math.round(base * env * jitter(0.12) * 10) / 10;
        sleeperWeek.push({ player_id: p.player_id, week: WEEK, team: p.team, opponent: g.opponent, stats: { pts_ppr: pts, pts_half_ppr: pts, pts_std: pts } });
      }
      continue;
    }
    const v = value.get(p.player_id) ?? 0;
    const [b, span] = POS_CURVE[pos];
    let ppg = b + span * Math.pow(v / 10000, 0.75);
    // Rookies/young stashes project lower now than their dynasty value implies.
    if ((p.years_exp ?? 3) === 0) ppg *= 0.78;
    let tmpl = { ...TEMPLATE[pos] };
    if (act && weeksPlayed.length >= 2) {
      const avg: Record<string, number> = {};
      for (const w of weeksPlayed) for (const [k, x] of Object.entries(act.get(w)!)) avg[k] = (avg[k] ?? 0) + x / weeksPlayed.length;
      const actualPpg = avg.pts_ppr;
      ppg = 0.55 * ppg + 0.45 * actualPpg;
      delete avg.pts_ppr;
      if (pprOf(avg) > 2) tmpl = avg;
    }
    ppg *= jitter(0.06);
    const scale = ppg / Math.max(1, pprOf(tmpl));
    const pg: Record<string, number> = {};
    for (const [k, x] of Object.entries(tmpl)) pg[k] = Math.round(x * scale * 100) / 100;
    perGame.set(p.player_id, pg);
    const gp = 17;
    const seasonStats: Record<string, number> = { gp };
    for (const [k, x] of Object.entries(pg)) seasonStats[k] = Math.round(x * gp * 10) / 10;
    sleeperSeason.push({ player_id: p.player_id, stats: seasonStats });

    const g = gameOf(p.team, WEEK);
    if (g && !["Out", "IR"].includes(p.injury_status ?? "")) {
      const env = Math.pow((g.impliedTotal ?? 22.5) / 22.5, 0.7) * jitter(0.08);
      const wk: Record<string, number> = {};
      for (const [k, x] of Object.entries(pg)) wk[k] = Math.round(x * env * 100) / 100;
      sleeperWeek.push({ player_id: p.player_id, week: WEEK, team: p.team, opponent: g.opponent, stats: wk });
    }
  }

  // Simulated Vegas props for the top ~90 skill players with a game this week.
  const props: PlayerProp[] = [];
  const topSkill = sleeperWeek
    .filter((r) => ["QB", "RB", "WR", "TE"].includes(players[r.player_id]?.position ?? ""))
    .sort((a, b) => pprOf(b.stats) - pprOf(a.stats))
    .slice(0, 90);
  for (const r of topSkill) {
    const p = players[r.player_id];
    const s = r.stats;
    const name = p.full_name!;
    const mk = (market: PlayerProp["market"], mean: number, sdPct: number) => {
      const line = Math.max(0.5, Math.floor(mean * jitter(sdPct)) + 0.5);
      props.push({ player: name, market, line, overProb: 0.5 + (rand() - 0.5) * 0.12, books: 6 });
    };
    if (p.position === "QB") {
      mk("player_pass_yds", s.pass_yd ?? 0, 0.06);
      mk("player_pass_tds", s.pass_td ?? 0, 0.1);
      if ((s.rush_yd ?? 0) > 10) mk("player_rush_yds", s.rush_yd ?? 0, 0.1);
    } else {
      if ((s.rush_yd ?? 0) > 15) mk("player_rush_yds", s.rush_yd ?? 0, 0.1);
      if ((s.rec ?? 0) > 1.5) mk("player_receptions", s.rec ?? 0, 0.1);
      if ((s.rec_yd ?? 0) > 12) mk("player_reception_yds", s.rec_yd ?? 0, 0.1);
      const tdl = (s.rush_td ?? 0) + (s.rec_td ?? 0);
      props.push({ player: name, market: "player_anytime_td", line: null, overProb: Math.min(0.8, (1 - Math.exp(-tdl)) * jitter(0.12)), books: 6 });
    }
  }

  // ---- League + snake draft ----
  const order = Object.values(players)
    .filter((p) => ["QB", "RB", "WR", "TE"].includes(p.position!) && p.team)
    .map((p) => ({ id: p.player_id, pos: p.position!, v: (value.get(p.player_id) ?? 0) * jitter(0.18) }))
    .sort((a, b) => b.v - a.v);
  const N = 12;
  const rosters: SleeperRoster[] = TEAM_NAMES.map((_, i) => ({
    roster_id: i + 1,
    owner_id: `user_${i + 1}`,
    players: [],
    starters: [],
    reserve: [],
    taxi: [],
    settings: { wins: 0, losses: 0, ties: 0, fpts: 0, fpts_decimal: 0, fpts_against: 0, fpts_against_decimal: 0, waiver_budget_used: Math.floor(rand() * 40), waiver_position: i + 1 },
  }));
  const posCount = (r: SleeperRoster, pos: string) => r.players!.filter((id) => players[id].position === pos).length;
  const caps: Record<string, number> = { QB: 3, RB: 8, WR: 9, TE: 3 };
  for (let round = 0; round < 22; round++) {
    const seq = round % 2 === 0 ? rosters : [...rosters].reverse();
    for (const r of seq) {
      const idx = order.findIndex((o) => posCount(r, o.pos) < caps[o.pos]);
      if (idx < 0) continue;
      r.players!.push(order[idx].id);
      order.splice(idx, 1);
    }
  }
  // K + DEF
  const ks = Object.values(players).filter((p) => p.position === "K").map((p) => p.player_id);
  const defs = [...nflTeams];
  for (const r of rosters) {
    r.players!.push(ks.splice(Math.floor(rand() * ks.length), 1)[0]);
    r.players!.push(defs.splice(Math.floor(rand() * defs.length), 1)[0]);
  }
  // IR stash
  for (const r of rosters) {
    const ir = r.players!.find((id) => players[id].injury_status === "IR");
    if (ir) {
      r.reserve = [ir];
      r.players = r.players!.filter((x) => x !== ir);
    }
  }

  // ---- Schedule (round robin) & results for completed weeks ----
  const rosterPositions = ["QB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX", "FLEX", "K", "DEF", ...Array(14).fill("BN")];
  const startingSlots = rosterPositions.filter((s) => s !== "BN");
  const elig: Record<string, string[]> = { FLEX: ["RB", "WR", "TE"] };
  const teamIds = rosters.map((r) => r.roster_id);
  const matchups: Record<number, SleeperMatchup[]> = {};
  const lastReg = 14;
  const scoreLineup = (r: SleeperRoster, week: number) => {
    // Manager starts the best players by projected per-game value, scored with actual stats.
    const pool = r.players!
      .map((id) => {
        const pg = perGame.get(id) ?? {};
        return { id, pos: players[id].position!, proj: pprOf(pg) || pg.pts_ppr || 0 };
      })
      .sort((a, b) => b.proj - a.proj);
    const used = new Set<string>();
    let total = 0;
    const starters: string[] = [];
    for (const slot of startingSlots) {
      const okPos = elig[slot] ?? [slot];
      const c = pool.find((x) => !used.has(x.id) && okPos.includes(x.pos));
      if (!c) continue;
      used.add(c.id);
      starters.push(c.id);
      const a = actualByWeek.get(c.id)?.get(week);
      let pts = a ? a.pts_ppr + (players[c.id].position === "TE" ? 0.5 * (a.rec ?? 0) : 0) : 0;
      if (players[c.id].position === "DEF") pts = 7 * jitter(0.6);
      total += pts;
    }
    return { total: Math.round(total * 100) / 100, starters };
  };
  for (let w = 1; w <= lastReg; w++) {
    const arr = [...teamIds];
    const fixed = arr.shift()!;
    const rot = arr.map((_, i) => arr[(i + w - 1) % arr.length]);
    const circle = [fixed, ...rot];
    const ms: SleeperMatchup[] = [];
    for (let i = 0; i < N / 2; i++) {
      const a = circle[i];
      const b = circle[N - 1 - i];
      const mid = i + 1;
      for (const rid of [a, b]) {
        const r = rosters[rid - 1];
        const res = w < WEEK ? scoreLineup(r, w) : { total: 0, starters: [] as string[] };
        ms.push({ roster_id: rid, matchup_id: mid, points: w < WEEK ? res.total : 0, starters: res.starters });
      }
    }
    matchups[w] = ms;
    if (w < WEEK) {
      for (let mid = 1; mid <= N / 2; mid++) {
        const [x, y] = ms.filter((m) => m.matchup_id === mid);
        const rx = rosters[x.roster_id - 1].settings;
        const ry = rosters[y.roster_id - 1].settings;
        if (x.points! > y.points!) {
          rx.wins!++;
          ry.losses!++;
        } else {
          ry.wins!++;
          rx.losses!++;
        }
        for (const [r, m, o] of [
          [rx, x, y],
          [ry, y, x],
        ] as const) {
          const pf = (r.fpts ?? 0) + (r.fpts_decimal ?? 0) / 100 + m.points!;
          const pa = (r.fpts_against ?? 0) + (r.fpts_against_decimal ?? 0) / 100 + o.points!;
          r.fpts = Math.floor(pf);
          r.fpts_decimal = Math.round((pf - Math.floor(pf)) * 100);
          r.fpts_against = Math.floor(pa);
          r.fpts_against_decimal = Math.round((pa - Math.floor(pa)) * 100);
        }
      }
    }
  }
  // Current starters = last week's lineup choice (so Line-Up Guru has something to improve on).
  for (const r of rosters) {
    const lu = scoreLineup(r, WEEK - 1).starters;
    // Simulate a lazy manager: leave one injured/bye player in the lineup if present.
    r.starters = lu;
  }

  // A few traded picks
  const tradedPicks = [
    { season: "2027", round: 1, roster_id: 7, previous_owner_id: 7, owner_id: 10 },
    { season: "2027", round: 2, roster_id: 1, previous_owner_id: 1, owner_id: 4 },
    { season: "2027", round: 2, roster_id: 5, previous_owner_id: 5, owner_id: 1 },
    { season: "2028", round: 1, roster_id: 3, previous_owner_id: 3, owner_id: 10 },
    { season: "2027", round: 3, roster_id: 12, previous_owner_id: 12, owner_id: 1 },
  ];

  const raw: RawInputs = {
    state: { season: SEASON, week: WEEK, seasonType: "regular" },
    league: {
      league_id: "demo",
      name: "Demo Dynasty League (12-team, PPR, TE+)",
      season: String(SEASON),
      status: "in_season",
      total_rosters: N,
      roster_positions: rosterPositions,
      scoring_settings: {
        pass_yd: 0.04, pass_td: 4, pass_int: -1, pass_2pt: 2, rush_yd: 0.1, rush_td: 6, rush_2pt: 2,
        rec: 1, rec_yd: 0.1, rec_td: 6, rec_2pt: 2, fum_lost: -2, bonus_rec_te: 0.5,
        fgm: 3.3, xpm: 1,
      },
      settings: { type: 2, playoff_week_start: 15, playoff_teams: 6, waiver_type: 2, waiver_budget: 100, reserve_slots: 2, taxi_slots: 3, draft_rounds: 4, trade_deadline: 11 },
    },
    users: TEAM_NAMES.map(([u, team], i) => ({ user_id: `user_${i + 1}`, username: u, display_name: u, avatar: null, metadata: { team_name: team } })),
    rosters,
    tradedPicks,
    drafts: [{ draft_id: "demo-2027", season: "2027", status: "pre_draft", type: "linear", settings: { rounds: 4 }, draft_order: null }],
    matchups,
    players,
    sleeperWeek,
    sleeperSeason,
    sleeperStats,
    trending: topSkill.slice(40, 60).map((r, i) => ({ player_id: r.player_id, count: 400 + i * 150 })),
    dynastyProcess: { players: dpPlayers, picks: dpPicks },
    idMap,
    schedule,
    usage: { byGsis: usageFromCsv(weekly), snapsByPfr: snapsFromCsv(snaps) },
    props,
    sources: [
      { id: "demo", label: "Demo league (simulated Sleeper league + projections)", kinds: ["league", "projections"], ok: true, detail: "12 teams, week 5, 2026" },
      { id: "dynastyprocess", label: "DynastyProcess (FantasyPros dynasty ECR)", kinds: ["values", "experts"], ok: true, detail: `${dpPlayers.length} players, ${dpPicks.length} picks (real data)` },
      { id: "nflverse", label: "nflverse (schedule, Vegas lines, usage)", kinds: ["vegas", "usage"], ok: true, detail: "real 2026 data" },
      { id: "odds", label: "Vegas player props (simulated in demo)", kinds: ["vegas", "projections"], ok: true, detail: `${props.length} simulated props` },
      { id: "fantasycalc", label: "FantasyCalc (trade market)", kinds: ["values"], ok: false, detail: "live mode only" },
      { id: "espn", label: "ESPN projections", kinds: ["projections"], ok: false, detail: "live mode only" },
      { id: "fantasypros", label: "FantasyPros weekly ECR", kinds: ["experts"], ok: false, requiresKey: true, detail: "live mode + API key" },
    ],
    myUserId: "user_1",
    isDemo: true,
  };

  // Keep the fixture compact: only players we actually reference.
  const keep = new Set<string>([...rosters.flatMap((r) => [...r.players!, ...r.reserve!]), ...sleeperWeek.map((r) => r.player_id), ...sleeperSeason.map((r) => r.player_id)]);
  raw.players = Object.fromEntries(Object.entries(players).filter(([id]) => keep.has(id)));
  const keepGsis = new Set(raw.idMap!.filter((m) => m.sleeper && keep.has(m.sleeper)).map((m) => m.gsis));
  raw.idMap = raw.idMap!.filter((m) => m.sleeper && keep.has(m.sleeper));
  raw.usage!.byGsis = Object.fromEntries(Object.entries(raw.usage!.byGsis).filter(([g]) => keepGsis.has(g)));
  const keepPfr = new Set(raw.idMap.map((m) => m.pfr));
  raw.usage!.snapsByPfr = Object.fromEntries(Object.entries(raw.usage!.snapsByPfr).filter(([p]) => keepPfr.has(p)));

  const out = path.join(process.cwd(), "data", "demo-raw.json");
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(raw));
  console.log(`wrote ${out}: ${Object.keys(raw.players).length} players, ${props.length} props`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
