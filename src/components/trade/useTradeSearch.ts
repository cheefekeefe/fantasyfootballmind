"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FindOptions, TradeIdea } from "@/lib/engine/tradeFinder";
import type { LeagueSnapshot } from "@/lib/types";

/** Runs findTrades in a Web Worker so the page stays responsive. */
export function useTradeSearch(snap: LeagueSnapshot) {
  const worker = useRef<Worker | null>(null);
  const seq = useRef(0);
  const [state, setState] = useState<{ loading: boolean; ideas: TradeIdea[] | null; error: string | null }>({ loading: false, ideas: null, error: null });

  useEffect(() => {
    worker.current = new Worker(new URL("../../workers/trade.worker.ts", import.meta.url));
    worker.current.onmessage = (e: MessageEvent<{ id: number; ideas?: TradeIdea[]; error?: string }>) => {
      if (e.data.id !== seq.current) return; // stale
      setState({ loading: false, ideas: e.data.ideas ?? null, error: e.data.error ?? null });
    };
    return () => worker.current?.terminate();
  }, []);

  const run = useCallback(
    (rosterId: number, opts: FindOptions) => {
      if (!worker.current) return;
      seq.current += 1;
      setState((s) => ({ ...s, loading: true, error: null }));
      worker.current.postMessage({ id: seq.current, snap, rosterId, opts });
    },
    [snap],
  );
  return { ...state, run };
}
