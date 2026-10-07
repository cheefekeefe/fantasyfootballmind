import Link from "next/link";

export default function Home() {
  return (
    <div className="mx-auto max-w-2xl space-y-8 py-10">
      <div className="space-y-3">
        <h1 className="text-3xl font-bold">Run your team like a GM.</h1>
        <p className="text-muted">
          Connect your Sleeper league. FantasyFootballMind pulls projections, trade-market values, expert consensus, usage
          trends and Vegas lines, then judges every decision against <em>your</em> roster, standing and window: contend, push
          chips in, retool or rebuild.
        </p>
      </div>
      <form action="/leagues" className="card flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="flex flex-1 flex-col gap-1 text-sm">
          Sleeper username
          <input name="username" required placeholder="e.g. sleeperuser123" className="input" autoComplete="off" />
        </label>
        <button className="btn-primary" type="submit">
          Find my leagues
        </button>
      </form>
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          ["Trade Central", "Trade block, targets, ready-made offers, and a trade machine that grades every deal from both sides."],
          ["Line-Up Guru", "Every projection source plus Vegas in one view, with win probability and ceiling or floor plays."],
          ["Waiver Wire Wizard", "Free agents ranked by what they add to your roster, with FAAB bids and drop suggestions."],
        ].map(([t, d]) => (
          <div key={t} className="card">
            <div className="font-semibold">{t}</div>
            <p className="mt-1 text-sm text-muted">{d}</p>
          </div>
        ))}
      </div>
      <p className="text-sm text-muted">
        No league handy?{" "}
        <Link className="text-accent underline" href="/league/demo">
          Open the demo dynasty league
        </Link>{" "}
        (real players, values, schedule and Vegas lines; simulated rosters).
      </p>
    </div>
  );
}
