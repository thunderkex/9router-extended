/**
 * Memory budget CI gate
 *
 * Production targets (standalone server process, not this test runner):
 *   • Idle RSS < 50 MB
 *   • RSS under 10 concurrent streams < 80 MB
 *
 * What this test actually gates:
 *   1. Stream overhead: 10 concurrent TransformStream drains must not grow
 *      RSS by more than 20 MB (catches buffer-accumulation regressions).
 *   2. Stream delta: RSS increase attributable to the streams stays < 20 MB.
 *
 * The absolute 50/80 MB targets apply to the production server process.
 * Vitest itself costs ~60-80 MB on startup (V8 + ESM loader), so asserting
 * an absolute idle RSS here would be a test-runner artifact, not a server
 * regression. The production idle budget is verified by the Docker health
 * check and the manual Raspberry Pi pass.
 *
 * ponytail: wire absolute RSS assertions against the real server process
 * (e.g. via /proc/self/status or a sidecar) when E2E infra exists.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { setSession, getSession, cacheSize } from "../src/lib/session/cache.js";

// Force GC before measuring so we don't count prior-test residue.
function gcIfAvailable() {
  if (typeof globalThis.gc === "function") globalThis.gc();
}

function rssBytes() {
  return process.memoryUsage().rss;
}

const MB = 1024 * 1024;

// Simulate one incremental SSE stream: push N chunks through a
// TransformStream and drain, never accumulating the full body.
async function simulateStream({ chunks = 100, chunkSize = 1024 } = {}) {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const reader = readable.getReader();

  const produce = (async () => {
    const chunk = new Uint8Array(chunkSize);
    for (let i = 0; i < chunks; i++) await writer.write(chunk);
    await writer.close();
  })();

  const consume = (async () => {
    while (true) {
      const { done } = await reader.read();
      if (done) break;
    }
  })();

  await Promise.all([produce, consume]);
}

describe("memory budget", () => {
  beforeAll(() => {
    gcIfAvailable();
  });

  it("10 concurrent streams add < 20 MB RSS (no buffer accumulation)", async () => {
    gcIfAvailable();
    const before = rssBytes();

    // 10 concurrent streams, each 100 × 1 KB = 100 KB per stream = 1 MB total data
    await Promise.all(Array.from({ length: 10 }, () => simulateStream()));

    gcIfAvailable();
    const after = rssBytes();
    const delta = after - before;

    expect(
      delta,
      `Stream RSS delta ${(delta / MB).toFixed(1)} MB exceeds 20 MB — possible buffer accumulation`
    ).toBeLessThan(20 * MB);
  });

  it("500 concurrent streams add < 30 MB RSS (scale check)", async () => {
    gcIfAvailable();
    const before = rssBytes();

    await Promise.all(Array.from({ length: 500 }, () => simulateStream({ chunks: 10, chunkSize: 512 })));

    gcIfAvailable();
    const after = rssBytes();
    const delta = after - before;

    expect(
      delta,
      `500-stream RSS delta ${(delta / MB).toFixed(1)} MB exceeds 30 MB`
    ).toBeLessThan(30 * MB);
  });

  it("500 session cache entries add < 2 MB RSS", () => {
    gcIfAvailable();
    const before = rssBytes();

    for (let i = 0; i < 500; i++) {
      setSession(`session-${i}`, {
        skillSetHash: `hash-${i % 10}`,
        compiledPromptHash: `compiled-${i}`,
        failoverCount: 0,
      });
    }

    gcIfAvailable();
    const after = rssBytes();
    const delta = after - before;

    expect(cacheSize()).toBeGreaterThanOrEqual(500);
    expect(
      delta,
      `Session cache RSS delta ${(delta / MB).toFixed(1)} MB exceeds 2 MB`
    ).toBeLessThan(2 * MB);
  });
});
