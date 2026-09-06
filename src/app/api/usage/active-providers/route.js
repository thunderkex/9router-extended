import { NextResponse } from "next/server";
import { getActiveProvidersInPeriod } from "@/lib/usageDb";

const VALID_PERIODS = new Set(["today", "24h", "7d", "30d", "60d", "all"]);

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const period = searchParams.get("period") || "today";

    if (!VALID_PERIODS.has(period)) {
      return NextResponse.json({ error: "Invalid period" }, { status: 400 });
    }

    const activeProviders = await getActiveProvidersInPeriod(period);
    return NextResponse.json({ period, activeProviders });
  } catch (error) {
    console.error("[API] Failed to get active providers:", error);
    return NextResponse.json({ error: "Failed to fetch active providers" }, { status: 500 });
  }
}
