"use client";

import type { PlayerRecord, Position } from "@/lib/types";

const POS_STYLE: Record<Position, string> = {
  QB: "bg-qb/15 text-qb",
  RB: "bg-rb/15 text-rb",
  WR: "bg-wr/15 text-wr",
  TE: "bg-te/15 text-te",
  K: "bg-k/15 text-k",
  DEF: "bg-def/15 text-def",
};

export function PosBadge({ pos }: { pos: Position | string }) {
  return <span className={`inline-block w-9 rounded px-1 text-center text-[10px] font-bold ${POS_STYLE[pos as Position] ?? "bg-line text-muted"}`}>{pos}</span>;
}

export function Injury({ status }: { status: string | null | undefined }) {
  if (!status) return null;
  const s = status.toLowerCase();
  const cls = s === "questionable" ? "text-warn" : "text-bad";
  const short = s === "questionable" ? "Q" : s === "doubtful" ? "D" : s === "out" ? "O" : status.toUpperCase();
  return <span className={`ml-1 text-[10px] font-bold ${cls}`} title={status}>{short}</span>;
}

export function PlayerLine({ p, sub }: { p: PlayerRecord | undefined; sub?: React.ReactNode }) {
  if (!p) return <span className="text-muted">—</span>;
  return (
    <span className="inline-flex items-center gap-2">
      <PosBadge pos={p.position} />
      <span>
        <span className="font-medium">{p.name}</span>
        <Injury status={p.injuryStatus} />
        <span className="ml-1 text-xs text-muted">
          {p.team ?? "FA"}
          {p.age ? ` · ${p.age.toFixed(0)}y` : ""}
        </span>
        {sub && <span className="block text-xs text-muted">{sub}</span>}
      </span>
    </span>
  );
}

export function Grade({ g }: { g: string }) {
  const c = g.startsWith("A") ? "bg-accent text-ink" : g.startsWith("B") ? "bg-accent/40" : g.startsWith("C") ? "bg-warn/40" : "bg-bad/60";
  return <span className={`inline-flex h-8 min-w-8 items-center justify-center rounded-md px-1.5 text-sm font-black ${c}`}>{g}</span>;
}

export function Section({ title, right, children, className = "" }: { title: React.ReactNode; right?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="font-semibold">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

export function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
      <div className="text-xl font-semibold">{value}</div>
      {sub && <div className="text-xs text-muted">{sub}</div>}
    </div>
  );
}

export function Meter({ value, max = 1, tone = "accent" }: { value: number; max?: number; tone?: "accent" | "warn" | "bad" }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const bg = tone === "accent" ? "bg-accent" : tone === "warn" ? "bg-warn" : "bg-bad";
  return (
    <div className="h-1.5 w-full rounded bg-line">
      <div className={`h-1.5 rounded ${bg}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export const fmt = (n: number, d = 0) => n.toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d });
export const signed = (n: number, d = 1) => `${n > 0 ? "+" : ""}${n.toFixed(d)}`;
export const pct = (x: number) => `${Math.round(x * 100)}%`;
