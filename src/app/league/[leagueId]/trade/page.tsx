"use client";

import { useEffect, useMemo, useState } from "react";
import { useLeague } from "@/components/LeagueProvider";
import { StrategyControl } from "@/components/StrategyControl";
import { TradeCard } from "@/components/trade/TradeCard";
import { TradeMachine, type MachineState } from "@/components/trade/TradeMachine";
import { useTradeSearch } from "@/components/trade/useTradeSearch";
import { PlayerLine, Section, fmt } from "@/components/ui";
import type { Asset } from "@/lib/engine/trade";
import { tradeBlock, tradeTargets, type FindOptions } from "@/lib/engine/tradeFinder";
import { pickLabel, pickValue } from "@/lib/engine/valuation";

type Tab = "ideas" | "block" | "targets" | "machine" | "picks";

export default function TradeCentral() {
  const { snap, an, rosterId, weights, weightOverride } = useLeague();
  const [tab, setTab] = useState<Tab>("ideas");
  const [machine, setMachine] = useState<MachineState>({ partner: null, gives: [], gets: [] });
  const [partnerFilter, setPartnerFilter] = useState<number | 0>(0);
  const [focus, setFocus] = useState<{ label: string; opts: FindOptions } | null>(null);
  const search = useTradeSearch(snap);

  const block = useMemo(() => tradeBlock(an, rosterId, weightOverride ?? undefined), [an, rosterId, weightOverride]);
  const targets = useMemo(() => tradeTargets(an, rosterId, weightOverride ?? undefined, 30), [an, rosterId, weightOverride]);

  const { run } = search;
  useEffect(() => {
    run(rosterId, { myWeights: weightOverride ?? undefined, partnerRosterId: partnerFilter || undefined, ...(focus?.opts ?? {}) });
  }, [run, rosterId, weightOverride, partnerFilter, focus]);

  const openInMachine = (partner: number, gives: Asset[], gets: Asset[]) => {
    setMachine({ partner, gives, gets });
    setTab("machine");
  };

  const findFor = (label: string, opts: FindOptions) => {
    setFocus({ label, opts });
    setTab("ideas");
  };

  const L = snap.league;
  const tabs: [Tab, string][] = [
    ["ideas", "Trade ideas"],
    ["block", "Trade block"],
    ["targets", "Targets"],
    ["machine", "Trade machine"],
    ...(L.type !== "redraft" ? ([["picks", "Draft picks"]] as [Tab, string][]) : []),
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1">
          {tabs.map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)} className={`rounded-lg px-3 py-1.5 text-sm ${tab === k ? "bg-accent text-ink" : "bg-panel2 text-muted hover:text-white"}`}>
              {label}
            </button>
          ))}
        </div>
        <StrategyControl />
      </div>

      {tab === "ideas" && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <select className="input" value={partnerFilter} onChange={(e) => setPartnerFilter(Number(e.target.value))}>
              <option value={0}>All teams</option>
              {snap.teams
                .filter((t) => t.rosterId !== rosterId)
                .map((t) => (
                  <option key={t.rosterId} value={t.rosterId}>
                    {t.teamName} ({an.teams[t.rosterId].strategy.label})
                  </option>
                ))}
            </select>
            {focus && (
              <span className="rounded-full bg-accent/15 px-3 py-1 text-xs text-accent">
                {focus.label}{" "}
                <button className="ml-1 underline" onClick={() => setFocus(null)}>
                  clear
                </button>
              </span>
            )}
            <span className="text-xs text-muted">
              Offers that improve your team by your goals ({Math.round(weights.now * 100)}% now / {Math.round(weights.future * 100)}% future) and that the other manager has a real chance of accepting.
            </span>
          </div>
          {search.loading && <div className="card animate-pulse text-sm text-muted">Searching thousands of trade combinations across the league…</div>}
          {search.error && <div className="card text-bad">{search.error}</div>}
          {!search.loading && search.ideas?.length === 0 && (
            <div className="card text-sm text-muted">No realistic win-win deals found with these settings. Try another partner, or adjust your priorities.</div>
          )}
          {!search.loading &&
            search.ideas?.map((i, n) => (
              <TradeCard key={n} ev={i.evaluation} onOpen={() => openInMachine(i.evaluation.proposal.toRosterId, i.evaluation.proposal.gives, i.evaluation.proposal.gets)} />
            ))}
        </div>
      )}

      {tab === "block" && (
        <Section title="Your trade block" right={<span className="text-xs text-muted">Players worth more on the market than to your lineup</span>}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Player</th>
                <th>Market</th>
                <th>Value to you</th>
                <th>Why sell</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {block
                .filter((b) => b.keepRatio < 0.95)
                .slice(0, 15)
                .map((b) => (
                  <tr key={b.playerId}>
                    <td>
                      <PlayerLine p={snap.players[b.playerId]} sub={`${snap.players[b.playerId].ros.ppg} ppg ROS`} />
                    </td>
                    <td>{fmt(b.market)}</td>
                    <td>
                      {fmt(b.valueToMe)} <span className="text-xs text-muted">({Math.round(b.keepRatio * 100)}%)</span>
                    </td>
                    <td className="text-xs text-muted">{b.reasons.join(" · ") || "Market values him more than your lineup does"}</td>
                    <td>
                      <button className="btn" onClick={() => findFor(`Selling ${snap.players[b.playerId].name}`, { sellAsset: { kind: "player", id: b.playerId } })}>
                        Find deals
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </Section>
      )}

      {tab === "targets" && (
        <Section title="Targets around the league" right={<span className="text-xs text-muted">Worth more to you than to their current manager</span>}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Player</th>
                <th>Owner</th>
                <th>Gain to you</th>
                <th>Cost to them</th>
                <th>Why</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {targets.map((t) => {
                const owner = snap.teams.find((x) => x.rosterId === t.ownerRosterId)!;
                return (
                  <tr key={t.playerId}>
                    <td>
                      <PlayerLine p={snap.players[t.playerId]} sub={`${snap.players[t.playerId].ros.ppg} ppg ROS · market ${fmt(t.market)}`} />
                    </td>
                    <td className="text-sm">
                      {owner.teamName}
                      <div className="text-xs text-muted">{an.teams[owner.rosterId].strategy.label}</div>
                    </td>
                    <td className="text-accent">{fmt(t.gainToMe)}</td>
                    <td>{fmt(t.costToThem)}</td>
                    <td className="text-xs text-muted">{t.reasons.join(" · ")}</td>
                    <td>
                      <button
                        className="btn"
                        onClick={() =>
                          findFor(`Acquiring ${snap.players[t.playerId].name}`, { targetAsset: { kind: "player", id: t.playerId }, partnerRosterId: t.ownerRosterId, maxPerPartner: 5 })
                        }
                      >
                        Build offer
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Section>
      )}

      {tab === "machine" && <TradeMachine state={machine} setState={setMachine} />}

      {tab === "picks" && <PickBoard />}
    </div>
  );
}

function PickBoard() {
  const { snap, an, rosterId } = useLeague();
  const seasons = [...new Set(snap.teams.flatMap((t) => t.picks.map((p) => p.season)))].sort();
  return (
    <div className="space-y-4">
      <Section title="Pick capital by team" right={<span className="text-xs text-muted">Next draft&apos;s slots are projected from simulated final standings</span>}>
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>Team</th>
                <th>Proj. slot</th>
                {seasons.map((s) => (
                  <th key={s}>{s}</th>
                ))}
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {snap.teams.map((t) => {
                const total = t.picks.reduce((a, p) => a + pickValue(p, an.ctx), 0);
                return (
                  <tr key={t.rosterId} className={t.rosterId === rosterId ? "bg-accent/5" : ""}>
                    <td className="font-medium">{t.teamName}</td>
                    <td>{an.ctx.projectedSlot[t.rosterId]}</td>
                    {seasons.map((s) => (
                      <td key={s} className="text-xs">
                        {t.picks
                          .filter((p) => p.season === s)
                          .map((p) => (
                            <div key={`${p.round}-${p.originalRosterId}`}>
                              {pickLabel(p, an.ctx, t.rosterId).replace(`${s} `, "")} <span className="text-muted">{fmt(pickValue(p, an.ctx))}</span>
                            </div>
                          ))}
                      </td>
                    ))}
                    <td>{fmt(total)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}
