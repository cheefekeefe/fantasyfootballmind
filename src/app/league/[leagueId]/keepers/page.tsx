"use client";

import { useMemo } from "react";
import { useLeague } from "@/components/LeagueProvider";
import { PlayerLine, Section, fmt } from "@/components/ui";
import { keeperPlan, projectedDraftPool, type KeeperStatus } from "@/lib/engine/keepers";
import type { LeagueType } from "@/lib/types";

const STATUS_CLS: Record<KeeperStatus, string> = {
  lock: "bg-accent/20 text-accent",
  keep: "bg-wr/20 text-wr",
  bubble: "bg-warn/20 text-warn",
  release: "bg-line text-muted",
};

function FormatControl() {
  const { sleeperFormat, format, setFormat, snap } = useLeague();
  const L = snap.league;
  const set = (type: LeagueType, maxKeepers: number) => setFormat({ type, maxKeepers });
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <span className="text-muted">
        Sleeper reports: <b className="text-white">{sleeperFormat.type}</b>
        {sleeperFormat.type === "keeper" ? ` (${sleeperFormat.maxKeepers} keepers)` : ""}
      </span>
      <span className="text-muted">· Use:</span>
      <select className="input" value={L.type} onChange={(e) => set(e.target.value as LeagueType, L.maxKeepers || 10)}>
        <option value="redraft">Redraft</option>
        <option value="keeper">Keeper</option>
        <option value="dynasty">Dynasty</option>
      </select>
      {L.type === "keeper" && (
        <label className="flex items-center gap-2">
          <input type="number" min={1} max={30} className="input w-20" value={L.maxKeepers} onChange={(e) => set("keeper", Math.max(1, Number(e.target.value) || 1))} />
          keepers / team
        </label>
      )}
      {format && (
        <button className="text-xs text-accent underline" onClick={() => setFormat(null)}>
          reset to Sleeper settings
        </button>
      )}
    </div>
  );
}

export default function Keepers() {
  const { snap, an, rosterId } = useLeague();
  const L = snap.league;
  const plan = useMemo(() => (L.type === "keeper" ? keeperPlan(an, rosterId) : null), [an, rosterId, L.type]);
  const pool = useMemo(() => (L.type === "keeper" ? projectedDraftPool(an, 25) : []), [an, L.type]);

  return (
    <div className="space-y-4">
      <Section title="League format">
        <FormatControl />
        <p className="mt-2 text-xs text-muted">
          If your league keeps players but Sleeper has it set up differently, set the real format here. This is saved in this browser and applies to every page: trades, waivers and team
          windows.
        </p>
      </Section>

      {!plan ? (
        <div className="card text-sm text-muted">Keeper planning applies to keeper leagues. Set the format above if your league keeps players.</div>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-3">
            <Section title={`Your keeper class: ${ordinal(plan.leagueRank)} of ${L.numTeams}`} className="lg:col-span-2">
              <ul className="list-disc space-y-1.5 pl-5 text-sm">
                {plan.insights.map((i) => (
                  <li key={i}>{i}</li>
                ))}
              </ul>
            </Section>
            <Section title="Keeper line">
              <div className="text-2xl font-semibold">{fmt(plan.line)}</div>
              <p className="mt-1 text-xs text-muted">
                Value of the {L.numTeams * L.maxKeepers}th best player league-wide ({L.numTeams} teams × {L.maxKeepers} keepers). That&apos;s roughly what the first pick of next
                year&apos;s draft gets you, so a keeper is only worth what he adds above it.
              </p>
              <div className="mt-3 text-sm">
                {plan.worthy} keeper-worthy players for {plan.slots} slots
              </div>
            </Section>
          </div>

          <Section title="Your roster ranked as keepers">
            <table className="tbl">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Player</th>
                  <th>Status</th>
                  <th>Keeper value</th>
                  <th>Surplus over line</th>
                  <th>This season</th>
                </tr>
              </thead>
              <tbody>
                {plan.rows.slice(0, L.maxKeepers + 6).map((r) => {
                  const p = snap.players[r.playerId];
                  return (
                    <tr key={r.playerId} className={r.rank === L.maxKeepers ? "border-b-2 border-accent" : ""}>
                      <td>{r.rank}</td>
                      <td>
                        <PlayerLine p={p} />
                      </td>
                      <td>
                        <span className={`rounded px-1.5 py-0.5 text-[10px] uppercase ${STATUS_CLS[r.status]}`}>{r.status}</span>
                      </td>
                      <td>
                        {fmt(r.keeperValue)}
                        {r.adjusted < r.keeperValue && (
                          <span className="ml-1 text-xs text-warn" title="Discounted: more keepers at this position than you can start">
                            → {fmt(r.adjusted)}
                          </span>
                        )}
                      </td>
                      <td className={r.surplus > 0 ? "text-accent" : "text-muted"}>{fmt(r.surplus)}</td>
                      <td className="text-xs text-muted">{p.ros.ppg} ppg ROS</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Section>

          <div className="grid gap-4 lg:grid-cols-2">
            <Section title="League keeper classes">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Team</th>
                    <th>Worthy</th>
                    <th>Surplus</th>
                    <th>Window</th>
                  </tr>
                </thead>
                <tbody>
                  {snap.teams
                    .map((t) => ({ t, k: keeperPlan(an, t.rosterId) }))
                    .sort((a, b) => b.k.totalSurplus - a.k.totalSurplus)
                    .map(({ t, k }) => (
                      <tr key={t.rosterId} className={t.rosterId === rosterId ? "bg-accent/5" : ""}>
                        <td>{t.teamName}</td>
                        <td className={k.worthy > L.maxKeepers ? "text-warn" : ""}>
                          {k.worthy}/{L.maxKeepers}
                        </td>
                        <td>{fmt(k.totalSurplus)}</td>
                        <td className="text-xs">{an.teams[t.rosterId].strategy.label}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
              <p className="mt-2 text-xs text-muted">Teams above {L.maxKeepers} worthy players will lose value at the keeper deadline, so they&apos;re motivated sellers.</p>
            </Section>
            <Section title="Projected to hit next year's draft">
              <div className="space-y-1">
                {pool.map((x) => (
                  <div key={x.playerId} className="flex items-center justify-between text-sm">
                    <PlayerLine p={snap.players[x.playerId]} sub={`not a top-${L.maxKeepers} keeper for ${snap.teams.find((t) => t.rosterId === x.ownerRosterId)?.teamName}`} />
                    <span className="text-xs text-muted">{fmt(x.keeperValue)}</span>
                  </div>
                ))}
              </div>
            </Section>
          </div>
        </>
      )}
    </div>
  );
}

function ordinal(n: number) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
