# FantasyFootballMind

A fantasy football **GM brain** for Sleeper leagues. It pulls in every reputable source it can reach (projections, trade-market values, expert consensus, usage trends, Vegas lines and player props), re-scores everything in *your* league's scoring, and makes every recommendation through the lens of *your* roster, standing and competitive window.

| Module | What it does |
| --- | --- |
| **Trade Central** | Trade block (players worth more on the market than to your lineup), targets (players worth more to you than to their manager), ready-made offers that help you **and** have a realistic chance of being accepted, an interactive trade machine that grades both sides and suggests how to get a deal done, and draft-pick values with projected slots. Dynasty, keeper and redraft aware. |
| **Line-Up Guru** | Every source's projection for every player in one table, plus the Vegas game environment (spread, total, implied team total), usage trends, injury and bye flags, floor and ceiling, and your win probability. It recommends ceiling plays when you're the underdog and floor plays when you're the favorite. |
| **Keepers** | For keeper leagues (e.g. 10 no-cost keepers): your projected keepers, the bubble, the league-wide *keeper line* (what the draft gives you anyway), positional logjams, which teams have more keepers than slots (motivated sellers), and which good players will hit next year's draft. You can override the league format if Sleeper has it set differently. |
| **Waiver Wire Wizard** | Free agents ranked by what they add to *your* roster this week and for the rest of the season, plus stash and handcuff value. Includes FAAB bid ranges (or waiver-priority advice), drop candidates, and one-week K/DEF/QB/TE streamers. |

## Quick start

```bash
npm install
npm run dev          # http://localhost:3000
```

Enter your Sleeper username, pick a league, and you're in. Or open **/league/demo** for a realistic offline 12-team dynasty league. It uses real players, values, schedule and Vegas lines with simulated rosters, so you can try every feature without a league.

Check how the app reads your league (settings, scoring, source health, team windows):

```bash
npm run check-league -- <league_id> [sleeper_username]
```

Optional API keys go in `.env.local` (see `.env.example`):

| Key | Unlocks |
| --- | --- |
| `ODDS_API_KEY` | [The Odds API](https://the-odds-api.com) **player props** (pass/rush/rec yards, TDs) converted into projections. Game spreads/totals already come free from nflverse. Props are only pulled when you click **Pull Vegas props** in Line-Up Guru, scoped to your game and your opponent's games, using 4 markets by default. That's about 30–50 credits per pull, so the free tier (500/month) covers roughly 2–3 pulls a week. Credits left are shown after each pull. |
| `FANTASYPROS_API_KEY` | [FantasyPros](https://api.fantasypros.com) weekly expert consensus rankings (ECR), converted to points. |

## Data sources

| Source | Key? | Feeds |
| --- | --- | --- |
| **Sleeper** | no | League settings and scoring, rosters, matchups, traded picks, drafts, player DB, weekly + season projections, season stats, trending adds |
| **ESPN** | no | Weekly projections (re-scored with your settings) |
| **FantasyCalc** | no | Dynasty + redraft trade values from millions of real trades, configured for your format (1QB/SF, teams, PPR), including picks |
| **DynastyProcess** | no | FantasyPros dynasty ECR-based values, rookie pick values, cross-site player ID map |
| **nflverse** | no | Full schedule with Vegas spreads/totals (byes, opponents, implied team totals), weekly target share / air yards / carries, snap counts |
| **The Odds API** | yes | Live lines + player props |
| **FantasyPros** | yes | Weekly ECR |

The **Sources** tab shows the live status of each source. Any optional source can fail without breaking the app.

## How it thinks

1. **Everything in your scoring.** Raw stat lines (Sleeper, ESPN, Vegas props) are re-scored with your exact `scoring_settings` (PPR, TE premium, bonuses). Expert ranks are mapped onto the projection curve to become points.
2. **Consensus with uncertainty.** Sources are weighted (Vegas 1.4, FantasyPros 1.2, Sleeper 1.0, ESPN 0.85), lone outliers are trimmed, and source disagreement widens the floor–ceiling band.
3. **Roster-aware value.** A player's worth to a team is the change in its *optimal starting lineup* over the rest of the season. Bench depth counts only as injury and bye cover. Replacement level is the actual best free agent in *your* league.
4. **Team window.** A Monte Carlo simulation of the rest of the season on your real schedule gives playoff odds. Combined with lineup rank, long-term asset rank and value-weighted core age, each team is classified as **contender / win-now / fringe / retool / rebuild**. That sets how much it weighs this season vs. the future (overridable with a slider).
5. **Two currencies.** NOW = projected starting points this season (playoff weeks weighted by odds). FUTURE = dynasty market value with a consolidation premium (two 5,000s < one 10,000) and diminishing weight for depth. A per-league exchange rate, calibrated from market values vs. points above replacement, puts them in one unit.
6. **Two-sided trades.** Each deal is re-run on both rosters: forced drops when over the limit, free-agent pickups when spots open, and IR stashes. Each side is graded by its own strategy, checked against market fairness, and given an acceptance probability that includes an endowment-effect penalty.
7. **Keepers & picks.** In keeper leagues a player's future worth is his *surplus over the keeper line*: the value of the last player kept league-wide (teams × keepers), which is what the draft hands you anyway. Only your best N keepers count, with extra QBs/TEs (or RBs/WRs beyond what you can start) discounted. How much a team weighs the future scales with keeper count vs. lineup size. Keeper-league picks are worth the player available at that slot after all keepers, minus a last-round pick. Dynasty picks use FantasyCalc/DynastyProcess pick values. Next year's slot is projected from simulated standings.

## Project layout

```
src/lib/sources/     one adapter per upstream source (all cached)
src/lib/snapshot.ts  raw data -> LeagueSnapshot in league scoring (pure)
src/lib/load.ts      live loader (parallel fetch + per-source status)
src/lib/engine/      scoring, props, consensus, lineup, valuation, analysis,
                     trade, tradeFinder, lineupGuru, waivers (all pure, unit-tested)
src/app/             Next.js pages (engines run client-side; trade search in a Web Worker)
scripts/build-demo.ts regenerates data/demo-raw.json
```

```bash
npm test             # vitest: engine unit tests + full demo-league integration tests
npm run lint         # typecheck
npm run demo:build   # rebuild the demo fixture from the latest public data
```

## Limitations & notes

- Keeper value assumes no keeper cost (round or salary). Sleeper doesn't store costs.
- The demo at `/league/demo-keeper` mirrors a 12-team, 0.5 PPR, 10-keeper league.
- KeepTradeCut has no public API (scraping violates its terms), so it is not included. FantasyCalc covers the crowd-sourced market.
- Lineup solving is exact for standard Sleeper flex setups (FLEX ⊂ SUPER_FLEX). Unusual combos of non-nested flex slots are solved greedily.
- IDP slots are not modeled yet.
