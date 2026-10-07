// Line-Up Guru: the best lineup for THIS week, given every projection source, Vegas game
// environment, injuries, and your matchup. Underdogs should chase ceiling; heavy favorites
// should protect their floor. We compute both and recommend whichever maximizes win odds.

import type { NflGame, PlayerRecord, SlotName } from "../types";
import type { LeagueAnalysis } from "./analysis";
import { eligible, isStartingSlot, optimalLineup, type LineupCandidate, type LineupResult } from "./lineup";
import { normCdf } from "./props";

export type LineupMode = "median" | "ceiling" | "floor";

export interface PlayerWeekRow {
  playerId: string;
  currentSlot: SlotName | null;
  recommendedSlot: SlotName | null;
  median: number;
  floor: number;
  ceiling: number;
  game: NflGame | null;
  flags: { level: "bad" | "warn" | "good" | "info"; text: string }[];
}

export interface LineupAdvice {
  week: number;
  rosterId: number;
  current: { slots: { slot: SlotName; playerId: string | null; points: number }[]; total: number };
  optimal: LineupResult;
  recommended: LineupResult;
  mode: LineupMode;
  modeReason: string;
  swaps: { slot: SlotName; out: string | null; in: string | null; gain: number }[];
  opponent: { rosterId: number; teamName: string; projected: number; lineup: LineupResult } | null;
  winProbability: number | null;
  winProbabilityCurrent: number | null;
  rows: PlayerWeekRow[];
  closeCalls: { starter: string; bench: string; slot: SlotName; diff: number }[];
}

function sdOf(p: PlayerRecord): number {
  const w = p.week;
  if (!w) return 0;
  return Math.max(0, (w.ceiling - w.floor) / (2 * 0.84));
}

function scoreFor(p: PlayerRecord, mode: LineupMode): number {
  const w = p.week;
  if (!w) return 0;
  if (mode === "ceiling") return w.median + 0.6 * (w.ceiling - w.median);
  if (mode === "floor") return w.median - 0.4 * (w.median - w.floor);
  return w.median;
}

function lineupDist(an: LeagueAnalysis, lu: { slots: { playerId: string | null }[] }) {
  let mean = 0;
  let varSum = 0;
  for (const s of lu.slots) {
    const p = s.playerId ? an.ctx.snap.players[s.playerId] : undefined;
    if (!p) continue;
    mean += p.week?.median ?? 0;
    varSum += sdOf(p) ** 2;
  }
  return { mean, sd: Math.sqrt(varSum) };
}

function winProb(a: { mean: number; sd: number }, b: { mean: number; sd: number }) {
  const sd = Math.sqrt(a.sd ** 2 + b.sd ** 2) || 1;
  return normCdf((a.mean - b.mean) / sd);
}

export function playerFlags(p: PlayerRecord, an: LeagueAnalysis): PlayerWeekRow["flags"] {
  const snap = an.ctx.snap;
  const week = snap.league.week;
  const flags: PlayerWeekRow["flags"] = [];
  const st = (p.injuryStatus ?? "").toLowerCase();
  if (p.byeWeek === week) flags.push({ level: "bad", text: "BYE" });
  if (["out", "ir", "pup", "sus", "na"].includes(st)) flags.push({ level: "bad", text: p.injuryStatus! });
  else if (st === "doubtful") flags.push({ level: "bad", text: "Doubtful" });
  else if (st === "questionable") flags.push({ level: "warn", text: "Questionable: have a pivot ready" });
  const g = p.team ? snap.nflGames[`${week}:${p.team}`] : undefined;
  if (g) {
    if (g.impliedTotal !== null) {
      if (g.impliedTotal >= 27) flags.push({ level: "good", text: `Shootout spot: team implied ${g.impliedTotal}` });
      else if (g.impliedTotal <= 18.5 && p.position !== "DEF") flags.push({ level: "warn", text: `Low team total: ${g.impliedTotal}` });
    }
    if (g.spread !== null) {
      if (p.position === "RB" && g.spread <= -6.5) flags.push({ level: "good", text: `${Math.abs(g.spread)}-pt favorite: run-heavy script` });
      if ((p.position === "WR" || p.position === "QB") && g.spread >= 6.5) flags.push({ level: "info", text: `${g.spread}-pt underdog: pass-heavy script` });
      if (p.position === "DEF" && g.spread <= -7) flags.push({ level: "good", text: "Big favorite: sacks/turnovers likely" });
    }
    if (g.kickoff) {
      const d = new Date(g.kickoff);
      const day = d.getUTCDay();
      if (day === 4) flags.push({ level: "info", text: "Thursday game: lock before kickoff" });
      if (day === 1) flags.push({ level: "info", text: "Monday night: late-swap flexibility" });
    }
  }
  const w = p.week;
  if (w) {
    const vegas = w.inputs.find((i) => i.source === "odds");
    if (vegas && w.median > 3 && vegas.points > w.median * 1.12) flags.push({ level: "good", text: `Vegas props are higher (${vegas.points})` });
    if (vegas && w.median > 3 && vegas.points < w.median * 0.88) flags.push({ level: "warn", text: `Vegas props are lower (${vegas.points})` });
    if (w.inputs.length >= 2 && w.agreement < 0.75) flags.push({ level: "info", text: "Sources disagree: wide range of outcomes" });
  }
  const u = p.usage;
  if (u?.snapPctLast3 !== undefined && u.snapPct !== undefined && u.snapPctLast3 - u.snapPct >= 0.1) flags.push({ level: "good", text: "Snap share trending up" });
  if (u?.snapPctLast3 !== undefined && u.snapPct !== undefined && u.snapPct - u.snapPctLast3 >= 0.1) flags.push({ level: "warn", text: "Snap share trending down" });
  return flags;
}

export function adviseLineup(an: LeagueAnalysis, rosterId: number): LineupAdvice {
  const snap = an.ctx.snap;
  const L = snap.league;
  const team = snap.teams.find((t) => t.rosterId === rosterId)!;
  const players = team.players.map((id) => snap.players[id]).filter((p): p is PlayerRecord => Boolean(p));
  const slots = L.starterSlots;
  const cands = (mode: LineupMode): LineupCandidate[] => players.map((p) => ({ id: p.id, position: p.position, points: scoreFor(p, mode) }));

  const optimal = optimalLineup(cands("median"), slots);

  // Current Sleeper lineup (starters array aligns with starting slots).
  const current = {
    slots: slots.map((slot, i) => {
      const id = team.starters[i] ?? null;
      const p = id ? snap.players[id] : undefined;
      return { slot, playerId: id && p ? id : null, points: p?.week?.median ?? 0 };
    }),
    total: 0,
  };
  current.total = Math.round(current.slots.reduce((a, s) => a + s.points, 0) * 10) / 10;

  // Opponent
  const pair = (snap.schedule[L.week] ?? []).find(([a, b]) => a === rosterId || b === rosterId);
  const oppId = pair ? (pair[0] === rosterId ? pair[1] : pair[0]) : null;
  let opponent: LineupAdvice["opponent"] = null;
  if (oppId !== null) {
    const ot = snap.teams.find((t) => t.rosterId === oppId);
    const lu = an.teams[oppId]?.weekLineup;
    if (ot && lu) opponent = { rosterId: oppId, teamName: ot.teamName, projected: lu.total, lineup: lu };
  }

  let mode: LineupMode = "median";
  let modeReason = "No matchup found, so this is the highest-median lineup.";
  let recommended = optimal;
  let wp: number | null = null;
  if (opponent) {
    const oppDist = lineupDist(an, opponent.lineup);
    const base = winProb(lineupDist(an, optimal), oppDist);
    const alt: [LineupMode, LineupResult][] = [
      ["ceiling", optimalLineup(cands("ceiling"), slots)],
      ["floor", optimalLineup(cands("floor"), slots)],
    ];
    wp = base;
    modeReason = `You're ${Math.round(base * 100)}% to win with the highest-median lineup.`;
    for (const [m, lu] of alt) {
      const p = winProb(lineupDist(an, lu), oppDist);
      if (p > (wp ?? 0) + 0.005) {
        wp = p;
        mode = m;
        recommended = lu;
      }
    }
    if (mode === "ceiling") modeReason = `You're the underdog (${Math.round(base * 100)}%). Higher-variance plays raise your odds to ${Math.round(wp * 100)}%.`;
    if (mode === "floor") modeReason = `You're the favorite (${Math.round(base * 100)}%). Safer floors raise your odds to ${Math.round(wp * 100)}%.`;
    // Report the recommended lineup's points as medians (not mode-weighted scores).
    recommended = {
      ...recommended,
      slots: recommended.slots.map((s) => ({ ...s, points: s.playerId ? snap.players[s.playerId]?.week?.median ?? 0 : 0 })),
    };
    recommended.total = Math.round(recommended.slots.reduce((a, s) => a + s.points, 0) * 10) / 10;
  }
  const wpCurrent = opponent ? winProb(lineupDist(an, current), lineupDist(an, opponent.lineup)) : null;

  // Swaps: compare current vs recommended slot by slot (order-insensitive per slot type).
  const swaps: LineupAdvice["swaps"] = [];
  const recIds = new Set(recommended.slots.map((s) => s.playerId).filter(Boolean));
  const curIds = new Set(current.slots.map((s) => s.playerId).filter(Boolean));
  const outs = current.slots.filter((s) => !s.playerId || !recIds.has(s.playerId));
  const ins = recommended.slots.filter((s) => s.playerId && !curIds.has(s.playerId));
  for (const o of outs) {
    const i = ins.find((x) => x.playerId && eligible(o.slot, snap.players[x.playerId]!.position));
    if (!i) continue;
    ins.splice(ins.indexOf(i), 1);
    swaps.push({ slot: o.slot, out: o.playerId, in: i.playerId, gain: Math.round((i.points - o.points) * 10) / 10 });
  }

  const slotOf = new Map<string, SlotName>();
  recommended.slots.forEach((s) => s.playerId && slotOf.set(s.playerId, s.slot));
  const curSlot = new Map<string, SlotName>();
  current.slots.forEach((s) => s.playerId && curSlot.set(s.playerId, s.slot));

  const rows: PlayerWeekRow[] = players
    .map((p) => ({
      playerId: p.id,
      currentSlot: curSlot.get(p.id) ?? null,
      recommendedSlot: slotOf.get(p.id) ?? null,
      median: p.week?.median ?? 0,
      floor: p.week?.floor ?? 0,
      ceiling: p.week?.ceiling ?? 0,
      game: p.team ? snap.nflGames[`${L.week}:${p.team}`] ?? null : null,
      flags: playerFlags(p, an),
    }))
    .sort((a, b) => (a.recommendedSlot ? 0 : 1) - (b.recommendedSlot ? 0 : 1) || b.median - a.median);

  // Close calls: bench players within 1.5 pts of a starter they could replace.
  const closeCalls: LineupAdvice["closeCalls"] = [];
  for (const s of recommended.slots) {
    if (!s.playerId) continue;
    for (const benchId of recommended.bench) {
      const b = snap.players[benchId];
      if (!b || !eligible(s.slot, b.position)) continue;
      const diff = s.points - (b.week?.median ?? 0);
      if (diff >= 0 && diff <= 1.5 && (b.week?.median ?? 0) > 0) closeCalls.push({ starter: s.playerId, bench: benchId, slot: s.slot, diff: Math.round(diff * 10) / 10 });
    }
  }
  closeCalls.sort((a, b) => a.diff - b.diff);

  return {
    week: L.week,
    rosterId,
    current,
    optimal,
    recommended,
    mode,
    modeReason,
    swaps,
    opponent,
    winProbability: wp === null ? null : Math.round(wp * 1000) / 1000,
    winProbabilityCurrent: wpCurrent === null ? null : Math.round(wpCurrent * 1000) / 1000,
    rows,
    closeCalls: closeCalls.slice(0, 6),
  };
}

export { isStartingSlot };
