import Link from "next/link";
import { getState, getUser, getUserLeagues } from "@/lib/sources/sleeper";
import { errMessage } from "@/lib/http";

export const dynamic = "force-dynamic";

const TYPES = ["Redraft", "Keeper", "Dynasty"];

export default async function Leagues({ searchParams }: { searchParams: Promise<{ username?: string }> }) {
  const { username } = await searchParams;
  if (!username) return <p>Enter a username on the home page.</p>;
  try {
    const user = await getUser(username.trim());
    if (!user) return <Message text={`No Sleeper user named "${username}".`} />;
    const state = await getState();
    const season = Number(state.season);
    let leagues = await getUserLeagues(user.user_id, season);
    if (!leagues.length) leagues = await getUserLeagues(user.user_id, season - 1);
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <h1 className="text-xl font-semibold">{user.display_name}&apos;s leagues</h1>
        {!leagues.length && <Message text="No NFL leagues found for this season." />}
        <div className="space-y-2">
          {leagues.map((l) => (
            <a key={l.league_id} href={`/api/select?league=${l.league_id}&user=${user.user_id}`} className="card flex items-center justify-between hover:border-accent">
              <div>
                <div className="font-medium">{l.name}</div>
                <div className="text-xs text-muted">
                  {l.season} · {l.total_rosters} teams · {TYPES[Number(l.settings.type ?? 0)] ?? "Redraft"} · {l.scoring_settings?.rec ?? 0} PPR
                  {l.roster_positions?.includes("SUPER_FLEX") ? " · Superflex" : ""}
                </div>
              </div>
              <span className="text-accent">Open →</span>
            </a>
          ))}
        </div>
      </div>
    );
  } catch (e) {
    return <Message text={`Couldn't reach Sleeper: ${errMessage(e)}`} />;
  }
}

function Message({ text }: { text: string }) {
  return (
    <div className="card mx-auto max-w-2xl">
      {text}{" "}
      <Link href="/" className="text-accent underline">
        Back
      </Link>
    </div>
  );
}
