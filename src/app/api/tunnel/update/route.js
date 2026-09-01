import { NextResponse } from "next/server";
import { isCloudflaredRunning, ensureCloudflared, BIN_PATH } from "@/lib/tunnel/cloudflare/cloudflared.js";
import { disableTunnel, enableTunnel } from "@/lib/tunnel/cloudflare/manager.js";
import { getTunnelStatus } from "@/lib/tunnel/cloudflare/manager.js";
import fs from "fs";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST() {
  try {
    const wasRunning = isCloudflaredRunning();
    if (wasRunning) {
      await disableTunnel();
    }

    if (fs.existsSync(BIN_PATH)) {
      try { fs.unlinkSync(BIN_PATH); } catch { /* ignore */ }
    }

    await ensureCloudflared();

    if (wasRunning) {
      await enableTunnel();
    }

    const status = await getTunnelStatus();
    return NextResponse.json({ success: true, ...status });
  } catch (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}
