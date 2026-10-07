"use client";

import { useMemo, useState } from "react";
import { useLeague } from "@/components/LeagueProvider";
import { PlayerLine, Section, pct, signed } from "@/components/ui";
import { PropsPuller } from "@/components/PropsPuller";
import { adviseLineup } from "@/lib/engine/lineupGuru";
import type { SourceId } from "@/lib/types";

const FLAG_CLS = { bad: "bg-bad/15 text-bad", warn: "bg-warn/15 text-warn", good: "bg-accent/15 text-accent", info: "bg-line text-muted" } as const;

export default function LineupGuru() {
  const { snap, an, rosterId, name } = useLeague();
  const advice = useMemo(() => adviseLineup(an, rosterId), [an, rosterId]);
  const [showAll, setShowAll] = useState(false);
  const L = snap.league;

  // Which sources actually projected someone on this roster (for table columns).
  const sourceCols = useMemo(() => {
    const seen = new Map<SourceId, string>();
    for (const r of advice.rows) for (const i of snap.players[r.playerId]?.week?.inputs ?? []) if (!seen.has(i.source)) seen.set(i.source, i.label);
    return [...seen.entries()];
  }, [advice, snap.players]);

  const rows = showAll ? advice.rows : advice.rows.filter((r) => r.recommendedSlot || r.currentSlot || r.median >= 4);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-3">
        <Section title={`Week ${advice.week} matchup`} className="lg:col-span-2">
          {advice.opponent ? (
            <div className="flex flex-wrap items-center gap-6">
              <div>
                <div className="text-xs text-muted">You (recommended lineup)</div>
                <div className="text-2xl font-semibold">{advice.recommended.total.toFixed(1)}</div>
                <div className="text-xs text-muted">current lineup {advice.current.total.toFixed(1)}</div>
              </div>
              <div className="text-muted">vs</div>
              <div>
                <div className="text-xs text-muted">{advice.opponent.teamName}</div>
                <div className="text-2xl font-semibold">{advice.opponent.projected.toFixed(1)}</div>
                <div className="text-xs text-muted">their optimal lineup</div>
              </div>
              <div className="ml-auto text-right">
                <div className="text-xs text-muted">Win probability</div>
                <div className="text-2xl font-semibold text-accent">{pct(advice.winProbability ?? 0)}</div>
                {advice.winProbabilityCurrent !== null && <div className="text-xs text-muted">{pct(advice.winProbabilityCurrent)} with your current lineup</div>}
              </div>
            </div>
          ) : (
            <div className="text-sm text-muted">No matchup scheduled this week.</div>
          )}
          <p className="mt-3 text-sm">
            <span className="mr-2 rounded bg-accent/15 px-2 py-0.5 text-xs uppercase text-accent">{advice.mode} mode</span>
            {advice.modeReason}
          </p>
        </Section>
        <Section title="Make these moves">
          {advice.swaps.length === 0 ? (
            <div className="text-sm text-accent">Your Sleeper lineup already matches the recommendation. ✔</div>
          ) : (
            <ul className="space-y-2 text-sm">
              {advice.swaps.map((s, i) => (
                <li key={i} className="rounded-lg border border-line p-2">
                  <div className="text-xs text-muted">{s.slot.replace("_", " ")}</div>
                  <div>
                    <span className="text-bad">Bench {s.out ? name(s.out) : "(empty)"}</span> → <span className="text-accent">Start {s.in ? name(s.in) : "—"}</span>
                    <span className="ml-1 text-xs text-muted">({signed(s.gain)} pts)</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {advice.closeCalls.length > 0 && (
            <div className="mt-4">
              <div className="mb-1 text-xs uppercase text-muted">Close calls (within 1.5 pts)</div>
              <ul className="space-y-1 text-xs">
                {advice.closeCalls.map((c, i) => (
                  <li key={i}>
                    {name(c.starter)} over {name(c.bench)} <span className="text-muted">by {c.diff}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Section>
      </div>

      <Section
        title="Every source, one table"
        right={
          <label className="flex items-center gap-2 text-xs text-muted">
            <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> show deep bench
          </label>
        }
      >
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>Slot</th>
                <th>Player</th>
                <th>Game</th>
                {sourceCols.map(([id, label]) => (
                  <th key={id}>{label}</th>
                ))}
                <th>Consensus</th>
                <th>Floor–Ceiling</th>
                <th>Usage</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const p = snap.players[r.playerId];
                const g = r.game;
                const moved = r.recommendedSlot !== r.currentSlot && (r.recommendedSlot || r.currentSlot);
                return (
                  <tr key={r.playerId} className={r.recommendedSlot ? "" : "opacity-60"}>
                    <td className="text-xs">
                      <div className={r.recommendedSlot ? "font-semibold text-accent" : "text-muted"}>{r.recommendedSlot?.replace("_", " ") ?? "BN"}</div>
                      {moved && <div className="text-[10px] text-warn">now: {r.currentSlot ?? "BN"}</div>}
                    </td>
                    <td>
                      <PlayerLine p={p} />
                    </td>
                    <td className="text-xs">
                      {p.byeWeek === L.week ? (
                        <span className="text-bad">BYE</span>
                      ) : g ? (
                        <>
                          <div>
                            {g.home ? "vs" : "@"} {g.opponent}
                          </div>
                          <div className="text-muted">
                            {g.spread !== null ? `${g.spread > 0 ? "+" : ""}${g.spread}` : ""} · o/u {g.total ?? "?"} · TT {g.impliedTotal ?? "?"}
                          </div>
                        </>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    {sourceCols.map(([id]) => {
                      const inp = p.week?.inputs.find((i) => i.source === id);
                      return (
                        <td key={id} className="text-xs" title={inp?.note}>
                          {inp ? inp.points.toFixed(1) : <span className="text-muted">—</span>}
                        </td>
                      );
                    })}
                    <td className="font-semibold">{r.median.toFixed(1)}</td>
                    <td className="w-36">
                      <RangeBar floor={r.floor} median={r.median} ceiling={r.ceiling} />
                    </td>
                    <td className="text-xs text-muted">
                      {p.usage?.snapPct !== undefined && <div>snap {pct(p.usage.snapPctLast3 ?? p.usage.snapPct)}</div>}
                      {p.usage?.targetShare !== undefined && p.usage.targetShare > 0.02 && <div>tgt {pct(p.usage.targetShareLast3 ?? p.usage.targetShare)}</div>}
                      {p.usage?.carriesPerGame !== undefined && p.usage.carriesPerGame >= 3 && <div>{p.usage.carriesLast3 ?? p.usage.carriesPerGame} car/g</div>}
                      {p.ecr?.weeklyPos && <div>ECR {p.position}{p.ecr.weeklyPos}</div>}
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        {r.flags.map((f) => (
                          <span key={f.text} className={`rounded px-1.5 py-0.5 text-[10px] ${FLAG_CLS[f.level]}`}>
                            {f.text}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="mt-3">
          <PropsPuller />
        </div>
        <p className="mt-2 text-xs text-muted">
          Consensus weights: Vegas props 1.4 · FantasyPros ECR 1.2 · Sleeper 1.0 · ESPN 0.85 (lone outliers trimmed). All points use your league&apos;s scoring. Floor and ceiling are the 20th and 80th
          percentiles.
        </p>
      </Section>

      {advice.opponent && (
        <Section title={`${advice.opponent.teamName}'s projected lineup`}>
          <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
            {advice.opponent.lineup.slots.map((s, i) => (
              <div key={i} className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2">
                  <span className="w-16 text-xs text-muted">{s.slot.replace("_", " ")}</span>
                  <PlayerLine p={s.playerId ? snap.players[s.playerId] : undefined} />
                </span>
                <span className="font-mono">{s.points.toFixed(1)}</span>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

function RangeBar({ floor, median, ceiling }: { floor: number; median: number; ceiling: number }) {
  const max = 40;
  const l = (floor / max) * 100;
  const w = ((ceiling - floor) / max) * 100;
  const m = (median / max) * 100;
  return (
    <div>
      <div className="relative h-2 rounded bg-line">
        <div className="absolute h-2 rounded bg-accent/30" style={{ left: `${l}%`, width: `${Math.min(100 - l, w)}%` }} />
        <div className="absolute h-2 w-0.5 bg-accent" style={{ left: `${Math.min(99, m)}%` }} />
      </div>
      <div className="mt-0.5 text-[10px] text-muted">
        {floor.toFixed(1)} – {ceiling.toFixed(1)}
      </div>
    </div>
  );
}
