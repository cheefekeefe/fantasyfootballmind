import { NextResponse, type NextRequest } from "next/server";
import { propPullEstimate, pullProps } from "@/lib/load";
import { hasOddsKey } from "@/lib/sources/odds";
import { errMessage } from "@/lib/http";

const user = (req: NextRequest) => req.cookies.get("ffm_user")?.value ?? null;

/** GET: estimated credit cost of a props pull (free). */
export async function GET(req: NextRequest) {
  const league = req.nextUrl.searchParams.get("league");
  if (!league || !hasOddsKey()) return NextResponse.json({ enabled: false });
  try {
    return NextResponse.json({ enabled: true, ...(await propPullEstimate(league, user(req))) });
  } catch (e) {
    return NextResponse.json({ enabled: true, error: errMessage(e) }, { status: 502 });
  }
}

/** POST: spend credits to pull fresh player props for the scoped games. */
export async function POST(req: NextRequest) {
  const league = req.nextUrl.searchParams.get("league");
  if (!league || !hasOddsKey()) return NextResponse.json({ ok: false, error: "ODDS_API_KEY not set" }, { status: 400 });
  try {
    return NextResponse.json({ ok: true, ...(await pullProps(league, user(req))) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: errMessage(e) }, { status: 502 });
  }
}
