import { NextResponse } from "next/server";
import { updateHeadroom } from "@/lib/headroom/process.js";
import { getHeadroomStatus } from "@/lib/headroom/detect.js";
import { getSettings } from "@/lib/localDb";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request) {
  try {
    let extras = ["ml", "code"];
    try {
      const body = await request.json();
      if (Array.isArray(body?.extras)) {
        extras = body.extras;
      }
    } catch { /* ignore */ }

    const settings = await getSettings();
    const res = await updateHeadroom({
      extras,
      port: settings.headroomPort || 8787,
      codeAware: settings.headroomCodeAware === true,
      kompress: settings.headroomKompress !== false,
    });

    const status = await getHeadroomStatus(settings.headroomUrl);
    return NextResponse.json({ ...res, ...status });
  } catch (error) {
    return NextResponse.json(
      { error: error.message, code: error.code || null },
      { status: 500 }
    );
  }
}
