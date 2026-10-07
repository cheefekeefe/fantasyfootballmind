"use client";

import { useLeague } from "@/components/LeagueProvider";
import { Section, fmt } from "@/components/ui";

export default function Sources() {
  const { snap, an } = useLeague();
  const ctx = an.ctx;
  return (
    <div className="space-y-4">
      <Section title="Data sources" right={<span className="text-xs text-muted">snapshot built {new Date(snap.generatedAt).toLocaleString()}</span>}>
        <table className="tbl">
          <thead>
            <tr>
              <th>Status</th>
              <th>Source</th>
              <th>Feeds</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {snap.sources.map((s) => (
              <tr key={s.id}>
                <td>{s.ok ? <span className="text-accent">● live</span> : <span className={s.requiresKey ? "text-warn" : "text-bad"}>● {s.requiresKey ? "needs key" : "offline"}</span>}</td>
                <td className="font-medium">{s.label}</td>
                <td className="text-xs text-muted">{s.kinds.join(", ")}</td>
                <td className="text-xs">{s.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 text-xs text-muted">
          Optional keys go in <code>.env.local</code>: <code>ODDS_API_KEY</code> (Vegas player props) and <code>FANTASYPROS_API_KEY</code> (weekly expert consensus). Everything else is
          keyless.
        </p>
      </Section>

      <Section title="League calibration">
        <div className="grid gap-4 text-sm sm:grid-cols-3">
          <div>
            <div className="text-xs uppercase text-muted">Waiver replacement level (pts/wk)</div>
            {Object.entries(ctx.replacementPpg).map(([pos, v]) => (
              <div key={pos}>
                {pos}: {v.toFixed(1)}
              </div>
            ))}
          </div>
          <div>
            <div className="text-xs uppercase text-muted">Starter line (last startable player)</div>
            {Object.entries(an.starterLine)
              .filter(([pos]) => an.demand[pos as keyof typeof an.demand] > 0)
              .map(([pos, v]) => (
                <div key={pos}>
                  {pos}: {v.toFixed(1)} <span className="text-xs text-muted">({an.demand[pos as keyof typeof an.demand].toFixed(2)} starters/team)</span>
                </div>
              ))}
          </div>
          <div>
            <div className="text-xs uppercase text-muted">Exchange rate</div>
            <div>1 season point above replacement ≈ {fmt(ctx.pointsToValue, 1)} value</div>
            <div className="mt-2 text-xs text-muted">
              Calibrated from this league&apos;s market values, so &ldquo;points now&rdquo; and &ldquo;long-term value&rdquo; can be compared in one currency.
            </div>
          </div>
        </div>
      </Section>

      <Section title="How the brain works">
        <ol className="list-decimal space-y-2 pl-5 text-sm text-white/85">
          <li>
            <b>Everything in your scoring.</b> Raw stat lines from Sleeper, ESPN and Vegas props are re-scored with your league&apos;s exact settings (PPR, TE premium, bonuses).
            Expert ranks are converted into points on the same curve.
          </li>
          <li>
            <b>Consensus with uncertainty.</b> Sources are blended with trust weights (betting markets highest). Disagreement widens the floor–ceiling band.
          </li>
          <li>
            <b>Roster-aware value.</b> A player&apos;s worth to a team is the change in its optimal starting lineup for the rest of the season (with injury and bye cover from the bench), not
            his raw projection. Depth only counts when it would actually play.
          </li>
          <li>
            <b>Team window.</b> A {fmt(2000)}-run season simulation on your real schedule gives playoff odds. Combined with lineup strength, long-term assets and core age, each team is
            classified as contender, win-now, fringe, retool or rebuild, which sets how much it should care about this season vs. the future.
          </li>
          <li>
            <b>Two-sided trades.</b> Every deal is re-run on both rosters (forced drops, open spots, IR), graded by each manager&apos;s own goals, checked against the market, and given an
            acceptance probability.
          </li>
          <li>
            <b>Keepers &amp; picks.</b> Keeper leagues only value the players who would make your keeper cut. Draft picks use market pick values, with next year&apos;s slot projected
            from simulated standings.
          </li>
        </ol>
      </Section>
    </div>
  );
}
