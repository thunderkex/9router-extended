/**
 *
 * GET /api/init → { needsSetup: boolean, initialized: boolean }
 *   needsSetup=true when no provider connections exist (fresh install).
 *   The dashboard can redirect to /setup on first load when needsSetup=true.
 */
import { NextResponse } from "next/server";
import { getProviderConnections } from "@/lib/db/index.js";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const connections = await getProviderConnections();
    return NextResponse.json({ initialized: true, needsSetup: connections.length === 0 });
  } catch {
    // Fail-open: DB not ready yet — don't block the dashboard
    return NextResponse.json({ initialized: true, needsSetup: false });
  }
}
