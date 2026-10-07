// Trade-market value sources.
//  - FantasyCalc: values computed from millions of real Sleeper/MFL trades, configurable by
//    league format (QBs, teams, PPR). Includes draft picks. Keyless.
//  - DynastyProcess: open data built from FantasyPros dynasty expert consensus (ECR), plus
//    rookie pick ECR. Keyless (GitHub). Also ships a cross-site player ID map.

import { cachedFetch, parseCsv, num } from "../http";

export interface FantasyCalcRow {
  player: {
    id: number;
    name: string;
    sleeperId?: string | null;
    position: string;
    maybeTeam?: string | null;
    maybeAge?: number | null;
  };
  value: number;
  redraftValue?: number;
  overallRank?: number;
  positionRank?: number;
  trend30Day?: number;
}

export interface FantasyCalcParams {
  dynasty: boolean;
  numQbs: 1 | 2;
  numTeams: number;
  ppr: number;
}

export const getFantasyCalc = (p: FantasyCalcParams) =>
  cachedFetch<FantasyCalcRow[]>(
    `https://api.fantasycalc.com/values/current?isDynasty=${p.dynasty}&numQbs=${p.numQbs}&numTeams=${p.numTeams}&ppr=${p.ppr}`,
    { ttlMinutes: 60 * 6 },
  );

const DP = "https://raw.githubusercontent.com/dynastyprocess/data/master/files";

export interface DpPlayerRow {
  name: string;
  pos: string;
  team: string | null;
  age: number | null;
  ecr1qb: number | null;
  ecr2qb: number | null;
  ecrPos: number | null;
  value1qb: number | null;
  value2qb: number | null;
  fpId: string;
}

export interface DpPickRow {
  name: string; // "2027 Early 1st", "2027 1st", "2026 Pick 1.01"
  ecr1qb: number | null;
  ecr2qb: number | null;
}

export async function getDynastyProcess(): Promise<{ players: DpPlayerRow[]; picks: DpPickRow[] }> {
  const [p, k] = await Promise.all([
    cachedFetch<string>(`${DP}/values-players.csv`, { ttlMinutes: 60 * 12, parse: "text", disk: true }),
    cachedFetch<string>(`${DP}/values-picks.csv`, { ttlMinutes: 60 * 12, parse: "text", disk: true }),
  ]);
  return {
    players: parseCsv(p).map((r) => ({
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
    })),
    picks: parseCsv(k).map((r) => ({ name: r.player, ecr1qb: num(r.ecr_1qb), ecr2qb: num(r.ecr_2qb) })),
  };
}

/** DynastyProcess' own ECR -> value curve (value = 10500 * e^(-0.0235 * ecr)). */
export const dpValueFromEcr = (ecr: number) => Math.round(10500 * Math.exp(-0.0235 * ecr));

export interface IdMapRow {
  sleeper: string | null;
  fantasypros: string | null;
  espn: string | null;
  gsis: string | null;
  pfr: string | null;
  name: string;
  position: string;
  team: string | null;
  birthdate: string | null;
}

/** Cross-site player ID map (Sleeper, FantasyPros, ESPN, GSIS/nflverse, PFR...). */
export async function getIdMap(): Promise<IdMapRow[]> {
  const text = await cachedFetch<string>(`${DP}/db_playerids.csv`, { ttlMinutes: 60 * 24, parse: "text", disk: true });
  const clean = (v: string) => (v && v !== "NA" ? v : null);
  return parseCsv(text).map((r) => ({
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
}
