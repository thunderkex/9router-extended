import { NextResponse } from "next/server";
import { installHermes } from "@/lib/plugins/hermes/install.js";
import { getHermesServiceStatus } from "@/lib/plugins/hermes/process.js";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST() {
  try {
    const info = await installHermes();
    const status = getHermesServiceStatus();
    return NextResponse.json({ ...info, ...status });
  } catch (error) {
    return NextResponse.json(
      { error: error.message, code: error.code || null },
      { status: 500 }
    );
  }
}
