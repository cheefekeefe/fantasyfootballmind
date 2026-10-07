"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useLeague } from "./LeagueProvider";

interface Estimate {
  enabled: boolean;
  events?: number;
  markets?: number;
  cost?: number;
  usage?: { remaining: number | null; lastPull: string | null };
  error?: string;
}

/** On-demand Vegas props pull: shows the credit cost first, spends only on click. */
export function PropsPuller() {
  const { snap } = useLeague();
  const router = useRouter();
  const [est, setEst] = useState<Estimate | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (snap.isDemo) return;
    fetch(`/api/props?league=${snap.league.id}`)
      .then((r) => r.json())
      .then(setEst)
      .catch(() => setEst(null));
  }, [snap.isDemo, snap.league.id]);

  if (snap.isDemo || !est) return null;
  if (!est.enabled)
    return <div className="text-xs text-muted">Vegas player props: add a free <code>ODDS_API_KEY</code> (the-odds-api.com) to blend props into projections.</div>;

  const pull = async () => {
    setBusy(true);
    setMsg(null);
    const r = await fetch(`/api/props?league=${snap.league.id}`, { method: "POST" }).then((x) => x.json());
    setBusy(false);
    setMsg(r.ok ? `Pulled ${r.props} props from ${r.events} games.` : `Failed: ${r.error}`);
    router.refresh();
  };
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
      <button className="btn" onClick={pull} disabled={busy || !est.events}>
        {busy ? "Pulling…" : "Pull Vegas props"}
      </button>
      <span>
        {est.events} games × {est.markets} markets ≈ <b className="text-white">{est.cost} credits</b>
        {est.usage?.remaining !== null && est.usage?.remaining !== undefined ? ` · ${est.usage.remaining} left this month` : ""}
        {est.usage?.lastPull ? ` · last pulled ${new Date(est.usage.lastPull).toLocaleString()}` : " · never pulled"}
      </span>
      {msg && <span className="text-accent">{msg}</span>}
    </div>
  );
}
