import { NextResponse } from "next/server";
import { isAutoStartEnabled, enableAutoStart, disableAutoStart } from "@/lib/autostart.js";

export const dynamic = "force-dynamic";

export async function GET() {
  const enabled = isAutoStartEnabled();
  return NextResponse.json({ enabled });
}

export async function POST(request) {
  try {
    const { enable } = await request.json();
    const success = enable ? enableAutoStart() : disableAutoStart();
    return NextResponse.json({ success, enabled: isAutoStartEnabled() });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
