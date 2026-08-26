import { NextResponse } from "next/server";
import { getSettings, updateSettings } from "@/lib/localDb";
import { autoDetectHeadroomPort, DEFAULT_HEADROOM_URL } from "@/lib/headroom/detect";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const settings = await getSettings();
    const result = await autoDetectHeadroomPort(settings.headroomUrl || DEFAULT_HEADROOM_URL);
    
    if (result.found && result.url !== settings.headroomUrl) {
      await updateSettings({ headroomUrl: result.url });
    }

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
