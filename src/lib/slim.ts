import type { LeagueSnapshot } from "./types";

/** Drop raw stat lines from projection inputs before shipping the snapshot to the browser. */
export function slimSnapshot(s: LeagueSnapshot): LeagueSnapshot {
  const players: LeagueSnapshot["players"] = {};
  for (const [id, p] of Object.entries(s.players)) {
    players[id] = p.week ? { ...p, week: { ...p.week, inputs: p.week.inputs.map(({ stats: _s, ...rest }) => rest) } } : p;
  }
  return { ...s, players };
}
