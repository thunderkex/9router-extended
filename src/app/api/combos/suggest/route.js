/**
 *
 * GET /api/combos/suggest
 *   Returns a suggested combo model list based on active minimal-token health & latency scoring.
 *   Tests available models for connected providers with minimal token usage to ensure suggestions work.
 *   Never auto-overwrites an existing combo — requires explicit Accept from the user.
 */
import { NextResponse } from "next/server";
import { getProviderConnections } from "@/lib/db/index.js";
import { buildAutoCombo } from "@/lib/routing/health.js";
import { probeAllActiveConnections } from "@/lib/routing/modelProbe.js";
import { analyzePromptContext } from "@/lib/routing/modelRanking.js";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const url = new URL(request.url);

    // Support either individual weights or comma-separated "weights=0.4,0.3,0.2,0.1"
    let wR = 0.4;
    let wL = 0.3;
    let wC = 0.2;
    let wQ = 0.1;

    const weightsParam = url.searchParams.get("weights");
    if (weightsParam) {
      const parts = weightsParam.split(",").map((p) => parseFloat(p.trim()));
      if (parts.length === 4 && parts.every((n) => !isNaN(n))) {
        [wR, wL, wC, wQ] = parts;
      } else if (parts.length === 3 && parts.every((n) => !isNaN(n))) {
        [wR, wL, wC] = parts;
      }
    } else {
      if (url.searchParams.has("reliability")) wR = parseFloat(url.searchParams.get("reliability") || "0.4");
      if (url.searchParams.has("latency")) wL = parseFloat(url.searchParams.get("latency") || "0.3");
      if (url.searchParams.has("cost")) wC = parseFloat(url.searchParams.get("cost") || "0.2");
      if (url.searchParams.has("quality")) wQ = parseFloat(url.searchParams.get("quality") || "0.1");
    }

    const force = url.searchParams.get("force") === "true" || url.searchParams.get("force") === "1";
    const skipTest = process.env.NODE_ENV === "test"
      || url.searchParams.get("test") === "false"
      || url.searchParams.get("test") === "0";
    const promptText = url.searchParams.get("prompt") || "";

    const connections = await getProviderConnections();
    const activeConnections = connections.filter((c) => c && c.isActive !== false);

    let testedModels = [];
    let summary = { total: 0, working: 0, failed: 0 };

    if (!skipTest && activeConnections.length > 0) {
      const baseUrl = url.origin || `http://127.0.0.1:${process.env.PORT || 20128}`;
      const probeResult = await probeAllActiveConnections({
        connections: activeConnections,
        baseUrl,
        force,
        maxConcurrency: 3,
        timeoutMs: 10000,
      });
      testedModels = probeResult.testedModels || [];
      summary = probeResult.summary || summary;
    }

    const limit = parseInt(url.searchParams.get("limit") || url.searchParams.get("count") || "7", 10);

    const promptContext = promptText ? analyzePromptContext(promptText) : null;

    const models = await buildAutoCombo(
      activeConnections,
      { reliability: wR, latency: wL, cost: wC, quality: wQ },
      {},
      testedModels,
      promptContext,
      limit
    );

    return NextResponse.json({
      models,
      tested: testedModels,
      summary,
      weights: { reliability: wR, latency: wL, cost: wC, quality: wQ },
      context: promptContext,
    });
  } catch (e) {
    console.error("[suggest] ERROR:", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
