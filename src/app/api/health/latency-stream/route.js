/**
 *
 * GET /api/health/latency-stream
 *
 * Pushes { providers: { [providerId]: { p50: number, p95: number, successRate: number, circuitState: string } } }
 * whenever the health store emits an update. Clients subscribe once and get
 * live sparkline data without polling.
 *
 * Falls back to a 30s keepalive ping if no updates arrive.
 */
import { healthEmitter, getProviderHealthSnapshot } from "@/lib/routing/health.js";

export const dynamic = "force-dynamic";

export async function GET() {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;

      function send(data) {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      }

      function onUpdate() {
        send(getProviderHealthSnapshot());
      }

      // Initial snapshot
      send(getProviderHealthSnapshot());

      healthEmitter.on("update", onUpdate);

      // Keepalive every 30s
      const ka = setInterval(() => {
        if (closed) { clearInterval(ka); return; }
        try { controller.enqueue(encoder.encode(": keepalive\n\n")); } catch { closed = true; clearInterval(ka); }
      }, 30_000);

      // Cleanup when client disconnects
      return () => {
        closed = true;
        clearInterval(ka);
        healthEmitter.off("update", onUpdate);
      };
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
