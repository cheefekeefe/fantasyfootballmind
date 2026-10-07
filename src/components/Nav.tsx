"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { useLeague } from "./LeagueProvider";

export function Nav() {
  const { snap, an, rosterId, setRosterId } = useLeague();
  const path = usePathname();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const base = `/league/${snap.league.id}`;
  const tabs = [
    ["Overview", base],
    ["Trade Central", `${base}/trade`],
    ["Line-Up Guru", `${base}/lineup`],
    ["Waiver Wizard", `${base}/waivers`],
    ["Sources", `${base}/sources`],
  ];
  const s = an.teams[rosterId]?.strategy;
  const L = snap.league;
  const refresh = async () => {
    setBusy(true);
    await fetch(`/api/refresh?league=${L.id}`, { method: "POST" }).catch(() => undefined);
    router.refresh();
    setTimeout(() => setBusy(false), 800);
  };
  return (
    <div className="mb-6 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-xl font-semibold">{L.name}</div>
          <div className="text-xs text-muted">
            {L.season} · Week {L.week} · {L.numTeams} teams · {L.type} · {L.ppr} PPR{L.tePremium ? ` · TE+${L.tePremium}` : ""}
            {L.superflex ? " · Superflex" : ""}
            {L.type === "keeper" ? ` · ${L.maxKeepers} keepers` : ""} · {L.starterSlots.join(" ")}
            {snap.isDemo && <span className="ml-2 rounded bg-warn/20 px-1.5 text-warn">DEMO</span>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted">Viewing as</label>
          <select className="input" value={rosterId} onChange={(e) => setRosterId(Number(e.target.value))}>
            {snap.teams.map((t) => (
              <option key={t.rosterId} value={t.rosterId}>
                {t.teamName}
                {t.rosterId === snap.myRosterId ? " (you)" : ""}
              </option>
            ))}
          </select>
          {s && <span className="rounded-full border border-accent/50 px-2 py-0.5 text-xs text-accent">{s.label}</span>}
          {!snap.isDemo && (
            <button className="btn" onClick={refresh} disabled={busy}>
              {busy ? "Refreshing…" : "Refresh data"}
            </button>
          )}
        </div>
      </div>
      <nav className="flex gap-1 overflow-x-auto border-b border-line">
        {tabs.map(([label, href]) => {
          const active = href === base ? path === base : path.startsWith(href);
          return (
            <Link key={href} href={href} className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm ${active ? "border-accent text-accent" : "border-transparent text-muted hover:text-white"}`}>
              {label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
