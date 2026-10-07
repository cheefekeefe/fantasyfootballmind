// The Odds API (https://the-odds-api.com) — Vegas game lines and player props.
// Requires ODDS_API_KEY. Player props are billed per market per event, so responses are
// cached to disk for several hours; the market list is intentionally small.

import { cachedFetch } from "../http";
import { TEAM_FULL_NAMES } from "../teams";

const BASE = "https://api.the-odds-api.com/v4/sports/americanfootball_nfl";

export const PROP_MARKETS = [
  "player_pass_yds",
  "player_pass_tds",
  "player_pass_interceptions",
  "player_rush_yds",
  "player_receptions",
  "player_reception_yds",
  "player_anytime_td",
] as const;
export type PropMarket = (typeof PROP_MARKETS)[number];

interface OddsOutcome {
  name: string;
  description?: string;
  price: number;
  point?: number;
}
interface OddsEvent {
  id: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers?: { key: string; markets: { key: string; outcomes: OddsOutcome[] }[] }[];
}

export interface GameLine {
  eventId: string;
  kickoff: string;
  home: string;
  away: string;
  /** Home spread (negative = home favored), consensus median across books. */
  homeSpread: number | null;
  total: number | null;
}

export interface PlayerProp {
  player: string;
  market: PropMarket;
  /** Consensus line (median across books); null for yes/no markets. */
  line: number | null;
  /** No-vig probability of the Over (or "Yes" for anytime TD), averaged across books. */
  overProb: number;
  books: number;
}

export const hasOddsKey = () => Boolean(process.env.ODDS_API_KEY);

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** American odds -> implied probability (with vig). */
export function impliedProb(price: number): number {
  return price < 0 ? -price / (-price + 100) : 100 / (price + 100);
}

export async function getGameLines(): Promise<GameLine[]> {
  const key = process.env.ODDS_API_KEY;
  if (!key) throw new Error("missing ODDS_API_KEY");
  const events = await cachedFetch<OddsEvent[]>(
    `${BASE}/odds?apiKey=${key}&regions=us&markets=spreads,totals&oddsFormat=american`,
    { ttlMinutes: 120, disk: true },
  );
  return events.map((e) => {
    const spreads: number[] = [];
    const totals: number[] = [];
    for (const b of e.bookmakers ?? []) {
      for (const m of b.markets) {
        if (m.key === "spreads") {
          const h = m.outcomes.find((o) => o.name === e.home_team);
          if (h?.point !== undefined) spreads.push(h.point);
        } else if (m.key === "totals") {
          const o = m.outcomes.find((x) => x.name === "Over");
          if (o?.point !== undefined) totals.push(o.point);
        }
      }
    }
    return {
      eventId: e.id,
      kickoff: e.commence_time,
      home: TEAM_FULL_NAMES[e.home_team] ?? e.home_team,
      away: TEAM_FULL_NAMES[e.away_team] ?? e.away_team,
      homeSpread: median(spreads),
      total: median(totals),
    };
  });
}

/** Fetch props for the given events (normally this week's games). */
export async function getPlayerProps(eventIds: string[]): Promise<PlayerProp[]> {
  const key = process.env.ODDS_API_KEY;
  if (!key) throw new Error("missing ODDS_API_KEY");
  const markets = PROP_MARKETS.join(",");
  const results = await Promise.allSettled(
    eventIds.map((id) =>
      cachedFetch<OddsEvent>(`${BASE}/events/${id}/odds?apiKey=${key}&regions=us&markets=${markets}&oddsFormat=american`, {
        ttlMinutes: 360,
        disk: true,
      }),
    ),
  );
  const props: PlayerProp[] = [];
  for (const r of results) {
    if (r.status === "fulfilled") props.push(...aggregateProps(r.value));
  }
  return props;
}

/** Collapse every book's outcomes into one consensus line + no-vig probability per player/market. */
export function aggregateProps(event: OddsEvent): PlayerProp[] {
  const acc = new Map<string, { player: string; market: PropMarket; lines: number[]; probs: number[] }>();
  for (const b of event.bookmakers ?? []) {
    for (const m of b.markets) {
      const market = m.key as PropMarket;
      if (!PROP_MARKETS.includes(market)) continue;
      // Group this book's outcomes by player.
      const byPlayer = new Map<string, OddsOutcome[]>();
      for (const o of m.outcomes) {
        const player = o.description ?? o.name;
        byPlayer.set(player, [...(byPlayer.get(player) ?? []), o]);
      }
      for (const [player, outs] of byPlayer) {
        const k = `${player}|${market}`;
        const entry = acc.get(k) ?? { player, market, lines: [], probs: [] };
        if (market === "player_anytime_td") {
          const yes = outs.find((o) => o.name === "Yes" || o.name === player);
          const no = outs.find((o) => o.name === "No");
          if (!yes) continue;
          // Books often post only "Yes"; strip a typical ~7% hold in that case.
          const p = no ? impliedProb(yes.price) / (impliedProb(yes.price) + impliedProb(no.price)) : impliedProb(yes.price) / 1.07;
          entry.probs.push(p);
        } else {
          const over = outs.find((o) => o.name === "Over");
          const under = outs.find((o) => o.name === "Under");
          if (!over || over.point === undefined) continue;
          const po = impliedProb(over.price);
          const pu = under ? impliedProb(under.price) : 1 - po + 0.045;
          entry.lines.push(over.point);
          entry.probs.push(po / (po + pu));
        }
        acc.set(k, entry);
      }
    }
  }
  return [...acc.values()]
    .filter((e) => e.probs.length)
    .map((e) => ({
      player: e.player,
      market: e.market,
      line: median(e.lines),
      overProb: e.probs.reduce((a, b) => a + b, 0) / e.probs.length,
      books: e.probs.length,
    }));
}
