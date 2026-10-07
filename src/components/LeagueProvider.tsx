"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { LeagueSnapshot } from "@/lib/types";
import { analyzeLeague, type LeagueAnalysis } from "@/lib/engine/analysis";

export interface Weights {
  now: number;
  future: number;
}

interface LeagueCtx {
  snap: LeagueSnapshot;
  an: LeagueAnalysis;
  rosterId: number;
  setRosterId: (id: number) => void;
  /** Effective NOW/FUTURE weights for the selected team (strategy or user override). */
  weights: Weights;
  weightOverride: Weights | null;
  setWeightOverride: (w: Weights | null) => void;
  name: (id: string) => string;
}

const Ctx = createContext<LeagueCtx | null>(null);

export function LeagueProvider({ snapshot, children }: { snapshot: LeagueSnapshot; children: React.ReactNode }) {
  const an = useMemo(() => analyzeLeague(snapshot), [snapshot]);
  const fallback = snapshot.myRosterId ?? snapshot.teams[0]?.rosterId ?? 1;
  const [rosterId, setRosterIdState] = useState<number>(fallback);
  const [weightOverride, setWeightOverride] = useState<Weights | null>(null);
  const key = `ffm:team:${snapshot.league.id}`;

  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem(key));
      if (saved && snapshot.teams.some((t) => t.rosterId === saved)) setRosterIdState(saved);
    } catch {
      // storage unavailable
    }
  }, [key, snapshot.teams]);

  const setRosterId = (id: number) => {
    setRosterIdState(id);
    setWeightOverride(null);
    try {
      localStorage.setItem(key, String(id));
    } catch {
      // ignore
    }
  };

  const strategy = an.teams[rosterId]?.strategy;
  const value: LeagueCtx = {
    snap: snapshot,
    an,
    rosterId,
    setRosterId,
    weights: weightOverride ?? { now: strategy?.now ?? 0.5, future: strategy?.future ?? 0.5 },
    weightOverride,
    setWeightOverride,
    name: (id) => snapshot.players[id]?.name ?? id,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLeague(): LeagueCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useLeague outside LeagueProvider");
  return c;
}
