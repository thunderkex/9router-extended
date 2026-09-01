import { NextResponse } from "next/server";
import { updatePxpipe } from "@/lib/pxpipe/service.js";
import { getPxpipeStatus } from "@/lib/pxpipe/service.js";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST() {
  try {
    const res = await updatePxpipe();
    const status = await getPxpipeStatus();
    return NextResponse.json({ ...res, ...status });
  } catch (error) {
    return NextResponse.json(
      { error: error.message, code: error.code || null },
      { status: 500 }
    );
  }
}
