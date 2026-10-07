"use client";

import { useMemo, useState } from "react";
import { assetKey, evaluateTrade, viewAsset, type Asset, type TradeEvaluation } from "@/lib/engine/trade";
import { pickLabel, pickValue } from "@/lib/engine/valuation";
import { useLeague } from "../LeagueProvider";
import { Injury, PosBadge, fmt, pct, signed } from "../ui";
import { SidePanel } from "./TradeCard";

export interface MachineState {
  partner: number | null;
  gives: Asset[];
  gets: Asset[];
}

function teamAssets(rosterId: number, ctxSnap: ReturnType<typeof useLeague>): Asset[] {
  const t = ctxSnap.snap.teams.find((x) => x.rosterId === rosterId)!;
  const players: Asset[] = [...t.players, ...t.reserve, ...t.taxi].map((id) => ({ kind: "player", id }));
  const picks: Asset[] = t.picks.map((p) => ({ kind: "pick", season: p.season, round: p.round, originalRosterId: p.originalRosterId }));
  return [...players, ...picks];
}

export function TradeMachine({ state, setState }: { state: MachineState; setState: (s: MachineState) => void }) {
  const league = useLeague();
  const { snap, an, rosterId, weights, weightOverride } = league;
  const partners = snap.teams.filter((t) => t.rosterId !== rosterId);
  const partner = state.partner && state.partner !== rosterId ? state.partner : partners[0]?.rosterId ?? null;

  const ev: TradeEvaluation | null = useMemo(() => {
    if (!partner || (!state.gives.length && !state.gets.length)) return null;
    return evaluateTrade(an, { fromRosterId: rosterId, toRosterId: partner, gives: state.gives, gets: state.gets }, { myWeights: weightOverride ?? undefined });
  }, [an, rosterId, partner, state.gives, state.gets, weightOverride]);

  const toggle = (list: "gives" | "gets", a: Asset) => {
    const k = assetKey(a);
    const cur = state[list];
    const next = cur.some((x) => assetKey(x) === k) ? cur.filter((x) => assetKey(x) !== k) : [...cur, a];
    setState({ ...state, partner, [list]: next });
  };

  // "Balance it": try single additions from either side that make it a win for you AND acceptable for them.
  const suggestions = useMemo(() => {
    if (!ev || !partner) return [];
    const out: { label: string; side: "gives" | "gets"; asset: Asset; ev: TradeEvaluation }[] = [];
    const tryAdd = (side: "gives" | "gets", pool: Asset[]) => {
      for (const a of pool) {
        if (state[side].some((x) => assetKey(x) === assetKey(a))) continue;
        const v = viewAsset(an, a);
        if (v.market < 50) continue;
        const next = { ...state, [side]: [...state[side], a] };
        const e2 = evaluateTrade(an, { fromRosterId: rosterId, toRosterId: partner, gives: next.gives, gets: next.gets }, { light: true, myWeights: weightOverride ?? undefined });
        if (e2.me.contextDelta > 0 && e2.acceptance.probability >= 0.45) out.push({ label: v.label, side, asset: a, ev: e2 });
      }
    };
    if (ev.acceptance.probability < 0.45) tryAdd("gives", teamAssets(rosterId, league));
    if (ev.me.contextDelta <= 0) tryAdd("gets", teamAssets(partner, league));
    return out.sort((a, b) => b.ev.me.contextDelta * b.ev.acceptance.probability - a.ev.me.contextDelta * a.ev.acceptance.probability).slice(0, 4);
  }, [ev, partner, an, rosterId, state, weightOverride, league]);

  if (!partner) return <div className="text-sm text-muted">No trade partners.</div>;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm text-muted">Trade with</label>
        <select className="input" value={partner} onChange={(e) => setState({ partner: Number(e.target.value), gives: state.gives, gets: [] })}>
          {partners.map((t) => (
            <option key={t.rosterId} value={t.rosterId}>
              {t.teamName} ({an.teams[t.rosterId].strategy.label})
            </option>
          ))}
        </select>
        <button className="btn" onClick={() => setState({ partner, gives: [], gets: [] })}>
          Clear
        </button>
        <span className="text-xs text-muted">
          Your lens: {Math.round(weights.now * 100)}% this season / {Math.round(weights.future * 100)}% future
        </span>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <AssetPicker title="Your roster: select what you give" rosterId={rosterId} selected={state.gives} onToggle={(a) => toggle("gives", a)} />
        <AssetPicker title={`${snap.teams.find((t) => t.rosterId === partner)!.teamName}: select what you get`} rosterId={partner} selected={state.gets} onToggle={(a) => toggle("gets", a)} />
      </div>

      {ev && (
        <div className="card space-y-4 border-accent/40">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="font-semibold">{ev.headline}</div>
            <div className="flex gap-4 text-sm">
              <span>
                They accept: <b className={ev.acceptance.probability >= 0.5 ? "text-accent" : "text-warn"}>{pct(ev.acceptance.probability)}</b>{" "}
                <span className="text-muted">({ev.acceptance.label})</span>
              </span>
              <span>
                Market balance: <b>{signed(ev.fairness * 100, 0)}%</b> <span className="text-muted">({fmt(ev.me.marketGet)} in vs {fmt(ev.me.marketGive)} out)</span>
              </span>
            </div>
          </div>
          <div className="grid gap-6 md:grid-cols-2">
            <SidePanel side={ev.me} title="For you" />
            <SidePanel side={ev.them} title={`For ${ev.them.teamName}`} />
          </div>
          {suggestions.length > 0 && (
            <div className="rounded-lg border border-line p-3">
              <div className="mb-2 text-sm font-medium">Ways to get this done</div>
              <div className="flex flex-wrap gap-2">
                {suggestions.map((s) => (
                  <button key={s.side + assetKey(s.asset)} className="btn" onClick={() => setState({ ...state, partner, [s.side]: [...state[s.side], s.asset] })}>
                    {s.side === "gives" ? "Add from you: " : "Ask for: "} {s.label}
                    <span className="text-xs text-muted">
                      ({pct(s.ev.acceptance.probability)} accept, you {s.ev.me.grade})
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AssetPicker({ title, rosterId, selected, onToggle }: { title: string; rosterId: number; selected: Asset[]; onToggle: (a: Asset) => void }) {
  const { snap, an } = useLeague();
  const [q, setQ] = useState("");
  const t = snap.teams.find((x) => x.rosterId === rosterId)!;
  const sel = new Set(selected.map(assetKey));
  const ids = [...t.players, ...t.reserve, ...t.taxi]
    .map((id) => snap.players[id])
    .filter(Boolean)
    .filter((p) => !q || p.name.toLowerCase().includes(q.toLowerCase()))
    .map((p) => ({ p, v: viewAsset(an, { kind: "player", id: p.id }) }))
    .sort((a, b) => b.v.market - a.v.market);
  return (
    <div className="card">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-sm font-medium">{title}</div>
        <input className="input w-32" placeholder="filter" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="max-h-96 space-y-0.5 overflow-y-auto pr-1">
        {ids.map(({ p, v }) => {
          const a: Asset = { kind: "player", id: p.id };
          const on = sel.has(assetKey(a));
          return (
            <button key={p.id} onClick={() => onToggle(a)} className={`flex w-full items-center justify-between rounded px-2 py-1 text-left text-sm ${on ? "bg-accent/20" : "hover:bg-panel2"}`}>
              <span className="flex items-center gap-2">
                <PosBadge pos={p.position} />
                {p.name}
                <Injury status={p.injuryStatus} />
                {t.taxi.includes(p.id) && <span className="text-[10px] text-muted">TAXI</span>}
                {t.reserve.includes(p.id) && <span className="text-[10px] text-muted">IR</span>}
              </span>
              <span className="text-xs text-muted">
                {v.rosPpg} ppg · {fmt(v.market)}
              </span>
            </button>
          );
        })}
        {t.picks.length > 0 && <div className="pt-2 text-xs uppercase text-muted">Draft picks</div>}
        {t.picks.map((pk) => {
          const a: Asset = { kind: "pick", season: pk.season, round: pk.round, originalRosterId: pk.originalRosterId };
          const on = sel.has(assetKey(a));
          return (
            <button key={assetKey(a)} onClick={() => onToggle(a)} className={`flex w-full items-center justify-between rounded px-2 py-1 text-left text-sm ${on ? "bg-accent/20" : "hover:bg-panel2"}`}>
              <span className="flex items-center gap-2">
                <PosBadge pos="PICK" />
                {pickLabel(pk, an.ctx, rosterId)}
              </span>
              <span className="text-xs text-muted">{fmt(pickValue(pk, an.ctx))}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
