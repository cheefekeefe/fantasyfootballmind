"use client";

import { useMemo, useState } from "react";
import { useLeague } from "@/components/LeagueProvider";
import { StrategyControl } from "@/components/StrategyControl";
import { PlayerLine, Section, fmt, pct, signed } from "@/components/ui";
import { waiverReport, type WaiverCategory } from "@/lib/engine/waivers";

const CAT_CLS: Record<WaiverCategory, string> = {
  "plug-and-play": "bg-accent/20 text-accent",
  "upside stash": "bg-wr/20 text-wr",
  handcuff: "bg-te/20 text-te",
  streamer: "bg-k/20 text-k",
  depth: "bg-line text-muted",
};

export default function WaiverWizard() {
  const { snap, an, rosterId, weightOverride, name } = useLeague();
  const report = useMemo(() => waiverReport(an, rosterId, weightOverride ?? undefined, 40), [an, rosterId, weightOverride]);
  const [cat, setCat] = useState<WaiverCategory | "all">("all");
  const L = snap.league;
  const recs = report.recs.filter((r) => cat === "all" || r.category === cat);
  const cats = [...new Set(report.recs.map((r) => r.category))];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-muted">
          {L.waiverType === "faab" ? (
            <>
              FAAB remaining: <b className="text-white">${report.budgetRemaining}</b> of ${L.waiverBudget}
            </>
          ) : (
            <>Waivers: {L.waiverType.replace("_", " ")}</>
          )}{" "}
          · {an.ctx.regularWeeksLeft} regular-season weeks left · ranked by value added to <b className="text-white">your</b> roster
        </div>
        <StrategyControl />
      </div>

      <div className="flex flex-wrap gap-1">
        {(["all", ...cats] as const).map((c) => (
          <button key={c} onClick={() => setCat(c)} className={`rounded-lg px-3 py-1 text-xs capitalize ${cat === c ? "bg-accent text-ink" : "bg-panel2 text-muted"}`}>
            {c}
          </button>
        ))}
      </div>

      <Section title="Waiver targets">
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>#</th>
                <th>Player</th>
                <th>Type</th>
                <th>This week</th>
                <th>ROS / wk</th>
                <th>Team value</th>
                <th>Claim</th>
                <th>Why</th>
              </tr>
            </thead>
            <tbody>
              {recs.map((r, i) => {
                const p = snap.players[r.playerId];
                return (
                  <tr key={r.playerId}>
                    <td>{i + 1}</td>
                    <td>
                      <PlayerLine
                        p={p}
                        sub={`wk ${p.week?.median.toFixed(1) ?? "–"} · ROS ${p.ros.ppg} ppg${p.market.dynasty ? ` · dyn ${fmt(p.market.dynasty)}` : ""}${p.usage?.snapPctLast3 !== undefined ? ` · snap ${pct(p.usage.snapPctLast3)}` : ""}`}
                      />
                    </td>
                    <td>
                      <span className={`rounded px-1.5 py-0.5 text-[10px] uppercase ${CAT_CLS[r.category]}`}>{r.category}</span>
                    </td>
                    <td className={r.weekGain > 0 ? "text-accent" : "text-muted"}>{signed(r.weekGain)}</td>
                    <td className={r.rosPpgGain > 0 ? "text-accent" : "text-muted"}>{signed(r.rosPpgGain)}</td>
                    <td>{fmt(r.contextGain)}</td>
                    <td className="text-xs">
                      <div className="font-medium">{r.claimAdvice}</div>
                      {r.dropCandidate && <div className="text-muted">drop: {name(r.dropCandidate)}</div>}
                    </td>
                    <td className="max-w-md text-xs text-muted">{r.reasons.join(" · ")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title={`One-week streamers (week ${L.week})`}>
          {Object.keys(report.streamers).length === 0 && <div className="text-sm text-muted">No free agent projects better than your starters at QB/TE/K/DEF this week.</div>}
          <div className="space-y-3">
            {Object.entries(report.streamers).map(([pos, list]) => (
              <div key={pos}>
                <div className="mb-1 text-xs uppercase text-muted">{pos}</div>
                {list!.map((s) => (
                  <div key={s.playerId} className="flex items-center justify-between text-sm">
                    <PlayerLine p={snap.players[s.playerId]} sub={s.note} />
                    <span className="font-mono">{s.median.toFixed(1)}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </Section>
        <Section title="Drop candidates" right={<span className="text-xs text-muted">Least valuable to your team right now</span>}>
          {report.dropCandidates.map((d) => {
            const p = snap.players[d.playerId];
            return (
              <div key={d.playerId} className="flex items-center justify-between py-1 text-sm">
                <PlayerLine p={p} sub={`ROS ${p?.ros.ppg ?? 0} ppg${p?.market.dynasty ? ` · dyn ${fmt(p.market.dynasty)}` : ""}`} />
                <span className="text-xs text-muted">value {fmt(d.valueToMe)}</span>
              </div>
            );
          })}
        </Section>
      </div>
    </div>
  );
}
