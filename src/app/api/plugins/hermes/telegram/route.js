import { NextResponse } from "next/server";
import { getTelegramConfig, saveTelegramConfig } from "@/lib/plugins/hermes/telegram.js";
import { restartHermesService, getHermesServiceStatus } from "@/lib/plugins/hermes/process.js";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const config = getTelegramConfig();
    return NextResponse.json(config);
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const updated = saveTelegramConfig(body);

    let restarted = false;
    const status = getHermesServiceStatus();
    if (status.running && body.autoRestart !== false) {
      try {
        await restartHermesService({ args: ["gateway"] });
        restarted = true;
      } catch (err) {
        return NextResponse.json({
          success: true,
          config: updated,
          restarted: false,
          warning: `Saved configuration, but failed to restart Hermes gateway: ${err.message}`,
        });
      }
    }

    return NextResponse.json({
      success: true,
      config: updated,
      restarted,
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
