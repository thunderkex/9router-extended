import { NextResponse } from "next/server";
import { getHermesServiceStatus } from "@/lib/plugins/hermes/process.js";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const status = getHermesServiceStatus();
    return NextResponse.json(status);
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
