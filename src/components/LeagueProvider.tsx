"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { LeagueSnapshot, LeagueType } from "@/lib/types";
import { analyzeLeague, type LeagueAnalysis } from "@/lib/engine/analysis";

export interface Weights {
  now: number;
  future: number;
}

export interface FormatOverride {
  type: LeagueType;
  maxKeepers: number;
}

interface LeagueCtx {
  snap: LeagueSnapshot;
  /** The format as Sleeper reports it (before any user override). */
  sleeperFormat: FormatOverride;
  format: FormatOverride | null;
  setFormat: (f: FormatOverride | null) => void;
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

export function LeagueProvider({ snapshot: raw, children }: { snapshot: LeagueSnapshot; children: React.ReactNode }) {
  // Sleeper's league "type" doesn't always match how a league is run (e.g. a redraft-typed
  // league keeping players manually), so the format can be overridden locally.
  const fmtKey = `ffm:fmt:${raw.league.id}`;
  const [format, setFormatState] = useState<FormatOverride | null>(null);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(fmtKey);
      if (saved) setFormatState(JSON.parse(saved) as FormatOverride);
    } catch {
      // ignore
    }
  }, [fmtKey]);
  const setFormat = (f: FormatOverride | null) => {
    setFormatState(f);
    try {
      if (f) localStorage.setItem(fmtKey, JSON.stringify(f));
      else localStorage.removeItem(fmtKey);
    } catch {
      // ignore
    }
  };
  const snapshot = useMemo(
    () => (format ? { ...raw, league: { ...raw.league, type: format.type, maxKeepers: format.type === "keeper" ? format.maxKeepers : format.type === "dynasty" ? 99 : 0 } } : raw),
    [raw, format],
  );
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
    sleeperFormat: { type: raw.league.type, maxKeepers: raw.league.maxKeepers },
    format,
    setFormat,
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
