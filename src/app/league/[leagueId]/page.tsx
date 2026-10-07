"use client";

import { useLeague } from "@/components/LeagueProvider";
import { Grade, Meter, PlayerLine, Section, Stat, fmt, pct } from "@/components/ui";
import type { Position } from "@/lib/types";

const POS: Position[] = ["QB", "RB", "WR", "TE", "K", "DEF"];

export default function Overview() {
  const { snap, an, rosterId } = useLeague();
  const team = snap.teams.find((t) => t.rosterId === rosterId)!;
  const a = an.teams[rosterId];
  const s = a.strategy;
  const L = snap.league;
  const positions = POS.filter((p) => an.demand[p] > 0);
  const ranked = [...snap.teams].sort((x, y) => an.teams[x.rosterId].powerRank - an.teams[y.rosterId].powerRank);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-3">
        <Section title={`${team.teamName}: ${s.label}`} className="lg:col-span-2" right={<span className="text-xs text-muted">posture: {s.posture}</span>}>
          <p className="text-sm">{s.summary}</p>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-muted">
            {s.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Record" value={`${team.record.wins}-${team.record.losses}${team.record.ties ? `-${team.record.ties}` : ""}`} sub={`${fmt(team.record.pointsFor, 1)} PF`} />
            <Stat label="Playoff odds" value={pct(a.playoffOdds)} sub={`${a.projectedWins} proj. wins`} />
            <Stat label="ROS lineup" value={`${a.lineupPpg}`} sub={`pts/wk · ${ordinal(a.nowRank)} of ${L.numTeams}`} />
            {L.type !== "redraft" ? (
              <Stat label="Future value" value={fmt(a.futureValue)} sub={`${ordinal(a.futureRank)}${a.coreAge ? ` · core age ${a.coreAge}` : ""}`} />
            ) : (
              <Stat label={`Week ${L.week}`} value={a.weekProjected} sub="projected" />
            )}
          </div>
          {L.type !== "redraft" && (
            <p className="mt-3 text-xs text-muted">
              Decisions for this team weigh this season {Math.round(s.now * 100)}% and the future {Math.round(s.future * 100)}%. You can override this in Trade Central and Waiver Wizard.
            </p>
          )}
        </Section>
        <Section title="Positional strength">
          <div className="space-y-3">
            {positions.map((p) => {
              const g = a.positions[p];
              return (
                <div key={p}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2">
                      <Grade g={g.grade} /> <span className="font-medium">{p}</span>
                      <span className="text-xs text-muted">
                        {ordinal(g.rank)} · {g.startable} startable / {Math.ceil(g.required)} needed
                      </span>
                    </span>
                    <span className="text-xs">
                      {g.surplus ? <span className="text-accent">surplus</span> : g.need >= 0.6 ? <span className="text-bad">need</span> : null}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-muted">{g.players.slice(0, 4).map((id) => snap.players[id]?.name).join(", ")}</div>
                </div>
              );
            })}
          </div>
        </Section>
      </div>

      <Section title="League power rankings" right={<span className="text-xs text-muted">{fmt(2000)} season simulations · positional ranks colored by tier</span>}>
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>#</th>
                <th>Team</th>
                <th>Record</th>
                <th>PF</th>
                <th>Playoffs</th>
                <th>ROS pts/wk</th>
                {L.type !== "redraft" && <th>Future</th>}
                {positions.map((p) => (
                  <th key={p}>{p}</th>
                ))}
                <th>Window</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((t) => {
                const x = an.teams[t.rosterId];
                return (
                  <tr key={t.rosterId} className={t.rosterId === rosterId ? "bg-accent/5" : ""}>
                    <td>{x.powerRank}</td>
                    <td className="font-medium">
                      {t.teamName}
                      {t.rosterId === snap.myRosterId && <span className="ml-1 text-xs text-accent">(you)</span>}
                    </td>
                    <td>
                      {t.record.wins}-{t.record.losses}
                    </td>
                    <td>{fmt(t.record.pointsFor, 1)}</td>
                    <td className="w-28">
                      <div className="text-xs">{pct(x.playoffOdds)}</div>
                      <Meter value={x.playoffOdds} tone={x.playoffOdds > 0.6 ? "accent" : x.playoffOdds > 0.3 ? "warn" : "bad"} />
                    </td>
                    <td>{x.lineupPpg}</td>
                    {L.type !== "redraft" && <td>{ordinal(x.futureRank)}</td>}
                    {positions.map((p) => (
                      <td key={p}>
                        <RankChip rank={x.positions[p].rank} n={L.numTeams} />
                      </td>
                    ))}
                    <td className="text-xs">{x.strategy.label}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title={`This week's projected lineup (week ${L.week})`}>
        <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
          {a.weekLineup.slots.map((sl, i) => (
            <div key={i} className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2">
                <span className="w-16 text-xs text-muted">{sl.slot.replace("_", " ")}</span>
                <PlayerLine p={sl.playerId ? snap.players[sl.playerId] : undefined} />
              </span>
              <span className="font-mono">{sl.points.toFixed(1)}</span>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}

function RankChip({ rank, n }: { rank: number; n: number }) {
  const t = (rank - 1) / Math.max(1, n - 1);
  const cls = t <= 0.25 ? "bg-accent/25 text-accent" : t <= 0.6 ? "bg-line text-white" : "bg-bad/20 text-bad";
  return <span className={`inline-block w-7 rounded text-center text-xs ${cls}`}>{rank}</span>;
}

function ordinal(n: number) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
