import { cookies } from "next/headers";
import Link from "next/link";
import { loadSnapshot } from "@/lib/load";
import { slimSnapshot } from "@/lib/slim";
import { errMessage } from "@/lib/http";
import { LeagueProvider } from "@/components/LeagueProvider";
import { Nav } from "@/components/Nav";

export const dynamic = "force-dynamic";

export default async function LeagueLayout({ children, params }: { children: React.ReactNode; params: Promise<{ leagueId: string }> }) {
  const { leagueId } = await params;
  const user = (await cookies()).get("ffm_user")?.value ?? null;
  let snap;
  try {
    snap = await loadSnapshot(leagueId, user);
  } catch (e) {
    return (
      <div className="card mx-auto max-w-xl space-y-2">
        <div className="font-semibold">Couldn&apos;t load league {leagueId}</div>
        <div className="text-sm text-muted">{errMessage(e)}</div>
        <Link href="/" className="text-accent underline">
          Back
        </Link>
      </div>
    );
  }
  return (
    <LeagueProvider snapshot={slimSnapshot(snap)}>
      <Nav />
      {children}
    </LeagueProvider>
  );
}
