import { NextResponse } from "next/server";
import { testSingleConnection } from "./testUtils.js";
import { getProviderConnectionById } from "@/lib/localDb";
import { probeProviderModels } from "@/lib/routing/modelProbe";

// POST /api/providers/[id]/test - Test connection
export async function POST(request, { params }) {
  try {
    const { id } = await params;
    const result = await testSingleConnection(id);

    if (result.error === "Connection not found") {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }

    if (result.valid) {
      getProviderConnectionById(id).then((conn) => {
        if (conn) probeProviderModels(conn, { force: true }).catch(() => {});
      }).catch(() => {});
    }

    return NextResponse.json({
      valid: result.valid,
      error: result.error,
      refreshed: result.refreshed || false,
    });
  } catch (error) {
    console.log("Error testing connection:", error);
    return NextResponse.json({ error: "Test failed" }, { status: 500 });
  }
}
