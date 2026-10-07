/**
 * Diagnose a live Sleeper league from your machine: prints how the app reads the league's
 * settings, which sources are reachable, and a short analysis.
 *
 * Usage: npm run check-league -- <league_id> [sleeper_username]
 */
import { loadSnapshot } from "../src/lib/load";
import { analyzeLeague } from "../src/lib/engine/analysis";
import { getUser } from "../src/lib/sources/sleeper";

async function main() {
  const [leagueId, username] = process.argv.slice(2);
  if (!leagueId) throw new Error("usage: npm run check-league -- <league_id> [sleeper_username]");
  const userId = username ? (await getUser(username))?.user_id ?? null : null;
  const t0 = Date.now();
  const snap = await loadSnapshot(leagueId, userId);
  const L = snap.league;
  console.log(`\n${L.name} (${L.season}, week ${L.week}) loaded in ${Date.now() - t0}ms`);
  console.log(`type=${L.type} maxKeepers=${L.maxKeepers} teams=${L.numTeams} ppr=${L.ppr} tePremium=${L.tePremium} superflex=${L.superflex}`);
  console.log(`starters: ${L.starterSlots.join(" ")} | bench ${L.benchSlots} | IR ${L.irSlots} | taxi ${L.taxiSlots}`);
  console.log(`waivers=${L.waiverType} budget=${L.waiverBudget} deadline=${L.tradeDeadlineWeek ?? "none"} playoffs=${L.playoffTeams} teams from week ${L.playoffWeekStart} draftRounds=${L.draftRounds}`);
  console.log(`scoring: ${Object.entries(L.scoring).filter(([, v]) => v !== 0).map(([k, v]) => `${k}=${v}`).join(" ")}`);
  console.log("\nsources:");
  for (const s of snap.sources) console.log(`  ${s.ok ? "OK  " : "--  "} ${s.label}: ${s.detail}`);
  const projected = Object.values(snap.players).filter((p) => p.week && p.week.inputs.length);
  console.log(`\nplayers: ${Object.keys(snap.players).length} (${projected.length} with week ${L.week} projections), picks tracked: ${snap.teams.reduce((a, t) => a + t.picks.length, 0)}`);
  const an = analyzeLeague(snap);
  console.log("\nteams:");
  for (const t of snap.teams) {
    const a = an.teams[t.rosterId];
    console.log(`  ${t.rosterId === snap.myRosterId ? "*" : " "} ${t.teamName.padEnd(24)} ${t.record.wins}-${t.record.losses}  odds ${(a.playoffOdds * 100).toFixed(0).padStart(3)}%  ROS ${a.lineupPpg} ppg  ${a.strategy.label}`);
  }
  if (L.type !== "keeper" && L.type !== "dynasty") console.log("\nNote: Sleeper reports this league as redraft. If you keep players, set the format on the Keepers tab.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
