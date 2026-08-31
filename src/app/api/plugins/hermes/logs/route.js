import { NextResponse } from "next/server";
import { getHermesLogsTail } from "@/lib/plugins/hermes/process.js";
import { getInstallLogTail } from "@/lib/plugins/hermes/install.js";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type") || "service";
    const maxLines = parseInt(searchParams.get("lines") || "100", 10);

    const logs = type === "install" ? getInstallLogTail(maxLines) : getHermesLogsTail(maxLines);
    return NextResponse.json({ type, logs });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
