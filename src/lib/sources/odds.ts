// The Odds API (https://the-odds-api.com): Vegas player props. Requires ODDS_API_KEY.
//
// Credits are precious on the free tier (500/month), so:
//  - the event list comes from the free /events endpoint (0 credits)
//  - game spreads/totals come from nflverse (free) instead of the Odds API
//  - props are only pulled when the user clicks "Pull Vegas props" (POST /api/props),
//    scoped to the games that matter (default: your players + your opponent's), and cached
//    to disk; normal page loads read that cache and never spend credits.
// Cost per pull = number of games x number of markets (1 region).

import { promises as fs } from "node:fs";
import path from "node:path";
import { cachedFetch } from "../http";
import { TEAM_FULL_NAMES } from "../teams";

const BASE = "https://api.the-odds-api.com/v4/sports/americanfootball_nfl";

export const ALL_PROP_MARKETS = [
  "player_pass_yds",
  "player_pass_tds",
  "player_pass_interceptions",
  "player_rush_yds",
  "player_receptions",
  "player_reception_yds",
  "player_anytime_td",
] as const;
export type PropMarket = (typeof ALL_PROP_MARKETS)[number];

/** Highest-signal markets by default; override with ODDS_PROP_MARKETS=comma,separated. */
const DEFAULT_MARKETS: PropMarket[] = ["player_pass_yds", "player_rush_yds", "player_reception_yds", "player_anytime_td"];

export function propMarkets(): PropMarket[] {
  const env = process.env.ODDS_PROP_MARKETS?.split(",").map((m) => m.trim()) ?? [];
  const valid = env.filter((m): m is PropMarket => (ALL_PROP_MARKETS as readonly string[]).includes(m));
  return valid.length ? valid : DEFAULT_MARKETS;
}

interface OddsOutcome {
  name: string;
  description?: string;
  price: number;
  point?: number;
}
export interface OddsEvent {
  id: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers?: { key: string; markets: { key: string; outcomes: OddsOutcome[] }[] }[];
}

export interface OddsEventInfo {
  id: string;
  kickoff: string;
  home: string;
  away: string;
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

const USAGE_FILE = path.join(process.cwd(), ".cache", "odds-usage.json");
export interface OddsUsage {
  remaining: number | null;
  used: number | null;
  lastPull: string | null;
  lastPullCost: number | null;
  events: number;
}

export async function readOddsUsage(): Promise<OddsUsage> {
  try {
    return JSON.parse(await fs.readFile(USAGE_FILE, "utf8")) as OddsUsage;
  } catch {
    return { remaining: null, used: null, lastPull: null, lastPullCost: null, events: 0 };
  }
}

async function writeOddsUsage(u: OddsUsage) {
  try {
    await fs.mkdir(path.dirname(USAGE_FILE), { recursive: true });
    await fs.writeFile(USAGE_FILE, JSON.stringify(u));
  } catch {
    // read-only FS
  }
}

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

/** Upcoming NFL events. This endpoint is free (0 credits). */
export async function getEvents(): Promise<OddsEventInfo[]> {
  const key = process.env.ODDS_API_KEY;
  if (!key) throw new Error("missing ODDS_API_KEY");
  const events = await cachedFetch<OddsEvent[]>(`${BASE}/events?apiKey=${key}`, { ttlMinutes: 180, disk: true });
  return events.map((e) => ({
    id: e.id,
    kickoff: e.commence_time,
    home: TEAM_FULL_NAMES[e.home_team] ?? e.home_team,
    away: TEAM_FULL_NAMES[e.away_team] ?? e.away_team,
  }));
}

function propsUrl(eventId: string, key: string) {
  return `${BASE}/events/${eventId}/odds?apiKey=${key}&regions=us&markets=${propMarkets().join(",")}&oddsFormat=american`;
}

/**
 * Props for the given events. With `spend: false` (normal page loads) only cached pulls are
 * returned and no credits are used.
 */
export async function getPlayerProps(eventIds: string[], spend: boolean): Promise<{ props: PlayerProp[]; cached: number }> {
  const key = process.env.ODDS_API_KEY;
  if (!key) throw new Error("missing ODDS_API_KEY");
  let remaining: number | null = null;
  let used: number | null = null;
  const results = await Promise.allSettled(
    eventIds.map((id) =>
      cachedFetch<OddsEvent>(propsUrl(id, key), {
        ttlMinutes: 60 * 24 * 4, // lines for a game stay useful until kickoff; re-pull on demand
        disk: true,
        cacheOnly: !spend,
        force: spend,
        onResponse: (res) => {
          const r = Number(res.headers.get("x-requests-remaining"));
          const u = Number(res.headers.get("x-requests-used"));
          if (Number.isFinite(r)) remaining = remaining === null ? r : Math.min(remaining, r);
          if (Number.isFinite(u)) used = used === null ? u : Math.max(used, u);
        },
      }),
    ),
  );
  const props: PlayerProp[] = [];
  let cached = 0;
  for (const r of results) {
    if (r.status === "fulfilled") {
      cached++;
      props.push(...aggregateProps(r.value));
    }
  }
  if (spend) {
    await writeOddsUsage({
      remaining,
      used,
      lastPull: new Date().toISOString(),
      lastPullCost: eventIds.length * propMarkets().length,
      events: eventIds.length,
    });
  }
  return { props, cached };
}

/** Collapse every book's outcomes into one consensus line + no-vig probability per player/market. */
export function aggregateProps(event: OddsEvent): PlayerProp[] {
  const acc = new Map<string, { player: string; market: PropMarket; lines: number[]; probs: number[] }>();
  for (const b of event.bookmakers ?? []) {
    for (const m of b.markets) {
      const market = m.key as PropMarket;
      if (!ALL_PROP_MARKETS.includes(market)) continue;
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
