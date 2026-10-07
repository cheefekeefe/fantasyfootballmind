import { NextResponse, type NextRequest } from "next/server";

/** Remember which Sleeper user is "me", then open the league. */
export function GET(req: NextRequest) {
  const league = req.nextUrl.searchParams.get("league");
  const user = req.nextUrl.searchParams.get("user");
  if (!league || !/^\d+$/.test(league)) return NextResponse.redirect(new URL("/", req.url));
  const res = NextResponse.redirect(new URL(`/league/${league}`, req.url));
  if (user && /^\d+$/.test(user)) res.cookies.set("ffm_user", user, { maxAge: 60 * 60 * 24 * 365, sameSite: "lax", path: "/" });
  return res;
}
