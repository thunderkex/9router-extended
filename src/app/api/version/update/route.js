import { NextResponse } from "next/server";
import { killAppProcesses, spawnUpdaterAndExit } from "@/lib/appUpdater";
import { enableAutoStart, disableAutoStart } from "@/lib/autostart.js";

export async function POST(request) {
  if (process.env.NODE_ENV !== "production") {
    return NextResponse.json(
      { success: false, message: "Update is only available in production build (9router CLI)" },
      { status: 403 }
    );
  }

  let customInstallCmd = null;
  let autoStart = null;

  try {
    const body = await request.json();
    if (body?.installCmd) {
      customInstallCmd = body.installCmd;
    }
    if (typeof body?.autoStart === "boolean") {
      autoStart = body.autoStart;
    }
  } catch {
    // optional body
  }

  // If user made a choice about auto startup during update, apply it
  if (autoStart === true) {
    try { enableAutoStart(); } catch {}
  } else if (autoStart === false) {
    try { disableAutoStart(); } catch {}
  }

  try {
    // Kill sibling processes (cloudflared, MITM, stray next-server) to release file locks on Windows
    await killAppProcesses();
  } catch { /* best effort */ }

  // Schedule detached updater then exit current server process
  spawnUpdaterAndExit(undefined, customInstallCmd);

  return NextResponse.json({ success: true, message: "Updater started. This app will exit shortly." });
}
