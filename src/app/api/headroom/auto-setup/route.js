import { NextResponse } from "next/server";
import { getSettings, updateSettings } from "@/lib/localDb";
import { findPython310, findAvailablePort, autoDetectHeadroomPort, DEFAULT_HEADROOM_URL } from "@/lib/headroom/detect";
import { installHeadroomExtras, startHeadroomProxy, getManagedPid } from "@/lib/headroom/process";

export const dynamic = "force-dynamic";

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const extras = Array.isArray(body?.extras) ? body.extras : [];
    
    // Step 1: Check Python >= 3.10
    const py = findPython310();
    if (!py) {
      return NextResponse.json({
        error: "Python >= 3.10 is required to install Headroom automatically. Please install Python 3.10+ and recheck.",
        code: "NO_PYTHON"
      }, { status: 400 });
    }

    // Step 2: Install headroom-ai[proxy,...extras]
    await installHeadroomExtras(extras);

    // Step 3: Check if already running or detect available port
    const settings = await getSettings();
    let port = 8787;
    const runningProbe = await autoDetectHeadroomPort(settings.headroomUrl);
    
    if (runningProbe.found) {
      port = runningProbe.port;
    } else {
      port = await findAvailablePort(8787);
    }

    const boundUrl = `http://localhost:${port}`;

    // Step 4: Start Proxy if not already managed
    let startResult = {};
    if (!getManagedPid() && !runningProbe.found) {
      startResult = await startHeadroomProxy({
        port,
        codeAware: settings.headroomCodeAware === true,
        kompress: settings.headroomKompress !== false,
      });
      if (startResult.port) port = startResult.port;
    }

    const finalUrl = `http://localhost:${port}`;

    // Step 5: Auto-enable in settings
    await updateSettings({
      headroomUrl: finalUrl,
      headroomEnabled: true,
    });

    return NextResponse.json({
      success: true,
      url: finalUrl,
      port,
      installed: true,
      running: true,
      enabled: true,
      ...startResult,
    });
  } catch (error) {
    console.error("[headroom] Auto-setup failed:", error);
    return NextResponse.json({
      error: error.message || "Auto-setup failed",
      code: error.code || "SETUP_FAILED"
    }, { status: 500 });
  }
}
