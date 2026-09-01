import { NextResponse } from "next/server";
import { updateHermes } from "@/lib/plugins/hermes/process.js";
import { getHermesServiceStatus } from "@/lib/plugins/hermes/process.js";
import { clearPluginUpdateCache } from "@/lib/updateCheck.js";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST() {
  try {
    const res = await updateHermes();
    clearPluginUpdateCache("hermes");
    const status = getHermesServiceStatus();
    return NextResponse.json({ ...res, ...status });
  } catch (error) {
    return NextResponse.json(
      { error: error.message, code: error.code || null },
      { status: 500 }
    );
  }
}
