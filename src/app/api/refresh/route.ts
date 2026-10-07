import { NextResponse, type NextRequest } from "next/server";
import { loadSnapshot } from "@/lib/load";
import { errMessage } from "@/lib/http";

export async function POST(req: NextRequest) {
  const league = req.nextUrl.searchParams.get("league");
  if (!league) return NextResponse.json({ ok: false }, { status: 400 });
  try {
    await loadSnapshot(league, req.cookies.get("ffm_user")?.value ?? null, true);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: errMessage(e) }, { status: 502 });
  }
}
