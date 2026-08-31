import { NextResponse } from "next/server";
import { restartHermesService } from "@/lib/plugins/hermes/process.js";

export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    let body = {};
    try {
      body = await request.json();
    } catch { /* empty body ok */ }
    const result = await restartHermesService(body);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return NextResponse.json({ error: error.message, code: error.code || null }, { status: 500 });
  }
}
