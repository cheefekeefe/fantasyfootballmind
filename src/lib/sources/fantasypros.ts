// FantasyPros expert consensus rankings (ECR). Requires FANTASYPROS_API_KEY.
// Weekly ECR aggregates 100+ experts; we convert ranks into points (see engine/consensus.ts).

import { cachedFetch } from "../http";

export interface FpRankRow {
  fpId: string;
  name: string;
  position: string;
  team: string | null;
  rankEcr: number;
  posRank: number | null;
  rankStd: number | null;
}

interface FpResponse {
  players?: {
    player_id: number | string;
    player_name: string;
    player_position_id: string;
    player_team_id?: string;
    rank_ecr: number | string;
    pos_rank?: string;
    rank_std?: number | string;
  }[];
}

export const hasFantasyProsKey = () => Boolean(process.env.FANTASYPROS_API_KEY);

const FP_POS = ["QB", "RB", "WR", "TE", "K", "DST"];

export async function getFantasyProsRanks(opts: {
  season: number;
  week: number;
  type: "weekly" | "ros";
  scoring: "STD" | "HALF" | "PPR";
}): Promise<FpRankRow[]> {
  const key = process.env.FANTASYPROS_API_KEY;
  if (!key) throw new Error("missing FANTASYPROS_API_KEY");
  const all = await Promise.all(
    FP_POS.map((position) => {
      const scoring = ["QB", "K", "DST"].includes(position) ? "STD" : opts.scoring;
      const week = opts.type === "weekly" ? `&week=${opts.week}` : "";
      return cachedFetch<FpResponse>(
        `https://api.fantasypros.com/public/v2/json/nfl/${opts.season}/consensus-rankings?position=${position}&type=${opts.type}&scoring=${scoring}${week}`,
        { ttlMinutes: 120, headers: { "x-api-key": key } },
      ).catch(() => ({ players: [] }) as FpResponse);
    }),
  );
  return all.flatMap((r) =>
    (r.players ?? []).map((p) => ({
      fpId: String(p.player_id),
      name: p.player_name,
      position: p.player_position_id === "DST" ? "DEF" : p.player_position_id,
      team: p.player_team_id ?? null,
      rankEcr: Number(p.rank_ecr),
      posRank: p.pos_rank ? Number(String(p.pos_rank).replace(/\D/g, "")) || null : null,
      rankStd: p.rank_std === undefined ? null : Number(p.rank_std),
    })),
  );
}
