"use client";

import type { SideEval, TradeEvaluation } from "@/lib/engine/trade";
import { useLeague } from "../LeagueProvider";
import { Grade, PosBadge, fmt, pct, signed } from "../ui";

export function AssetList({ side, which }: { side: SideEval; which: "gives" | "gets" }) {
  const list = side[which];
  return (
    <ul className="space-y-1">
      {list.map((a) => (
        <li key={a.key} className="flex items-center justify-between gap-2 text-sm">
          <span className="flex items-center gap-2">
            {a.position ? <PosBadge pos={a.position} /> : <PosBadge pos="PICK" />}
            <span className="font-medium">{a.label}</span>
            {a.injury && <span className="text-[10px] font-bold text-bad">{a.injury}</span>}
            {a.age ? <span className="text-xs text-muted">{a.age.toFixed(0)}y</span> : null}
          </span>
          <span className="text-xs text-muted">
            {a.rosPpg !== undefined ? `${a.rosPpg} ppg · ` : ""}
            {fmt(a.market)}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function SidePanel({ side, title }: { side: SideEval; title: string }) {
  const { snap } = useLeague();
  const isRedraft = snap.league.type === "redraft";
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <Grade g={side.grade} />
        <div>
          <div className="text-sm font-semibold">{title}</div>
          <div className="text-xs text-muted">
            {side.verdict} · {side.strategy.label} lens
          </div>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2 text-center text-xs">
        <div className="rounded bg-panel2 p-1.5">
          <div className="text-muted">Lineup / wk</div>
          <div className={side.ppgDelta >= 0 ? "text-accent" : "text-bad"}>{signed(side.ppgDelta)}</div>
        </div>
        <div className="rounded bg-panel2 p-1.5">
          <div className="text-muted">This week</div>
          <div className={side.weekDelta >= 0 ? "text-accent" : "text-bad"}>{signed(side.weekDelta)}</div>
        </div>
        <div className="rounded bg-panel2 p-1.5">
          <div className="text-muted">{isRedraft ? "Team value" : "Future value"}</div>
          <div className={(isRedraft ? side.contextDelta : side.futureDelta) >= 0 ? "text-accent" : "text-bad"}>
            {signed(isRedraft ? side.contextDelta : side.futureDelta, 0)}
          </div>
        </div>
      </div>
      <ul className="space-y-0.5 text-xs">
        {side.reasons.map((r) => (
          <li key={r} className="text-white/80">
            • {r}
          </li>
        ))}
        {side.warnings.map((r) => (
          <li key={r} className="text-warn">
            ⚠ {r}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function TradeCard({ ev, onOpen }: { ev: TradeEvaluation; onOpen?: () => void }) {
  return (
    <div className="card space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm">
          <span className="font-semibold">With {ev.them.teamName}</span>
          <span className="ml-2 text-xs text-muted">{ev.headline}</span>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span title="Chance the other manager accepts, from their roster needs and the market">
            Acceptance: <b className={ev.acceptance.probability >= 0.5 ? "text-accent" : "text-warn"}>{pct(ev.acceptance.probability)}</b> ({ev.acceptance.label})
          </span>
          <span title="Market value balance (FantasyCalc/DynastyProcess consensus with a consolidation premium)">
            Market: <b>{signed(ev.fairness * 100, 0)}%</b>
          </span>
          {onOpen && (
            <button className="btn" onClick={onOpen}>
              Open in machine
            </button>
          )}
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-lg border border-line p-2">
          <div className="mb-1 text-xs uppercase text-bad">You give</div>
          <AssetList side={ev.me} which="gives" />
        </div>
        <div className="rounded-lg border border-line p-2">
          <div className="mb-1 text-xs uppercase text-accent">You get</div>
          <AssetList side={ev.me} which="gets" />
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <SidePanel side={ev.me} title="For you" />
        <SidePanel side={ev.them} title={`For ${ev.them.teamName}`} />
      </div>
    </div>
  );
}
