import { NextResponse } from "next/server";
import { startHermesService } from "@/lib/plugins/hermes/process.js";

export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    let body = {};
    try {
      body = await request.json();
    } catch { /* empty body ok */ }
    const result = await startHermesService(body);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    const status = error.code === "NOT_INSTALLED" ? 400 : 500;
    return NextResponse.json({ error: error.message, code: error.code || null }, { status });
  }
}
