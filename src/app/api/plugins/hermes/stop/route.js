import { NextResponse } from "next/server";
import { stopHermesService } from "@/lib/plugins/hermes/process.js";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const result = stopHermesService();
    const status = result.stopped ? 200 : 409;
    return NextResponse.json({ ...result }, { status });
  } catch (error) {
    return NextResponse.json({ error: error.message, code: error.code || null }, { status: 500 });
  }
}
