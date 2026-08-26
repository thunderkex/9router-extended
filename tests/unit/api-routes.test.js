import { describe, it, expect } from "vitest";
import { GET as initGet } from "../../src/app/api/init/route.js";
import { GET as suggestGet } from "../../src/app/api/combos/suggest/route.js";
import { POST as acceptPost } from "../../src/app/api/combos/suggest/accept/route.js";
import { NextRequest } from "next/server";

describe("API Integration Verification", () => {
  it("GET /api/init returns status and setup requirements", async () => {
    const res = await initGet();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("initialized", true);
    expect(data).toHaveProperty("needsSetup");
  });

  it("GET /api/combos/suggest computes ranked combo without crashing", async () => {
    const req = new NextRequest("http://localhost:20128/api/combos/suggest?weights=0.5,0.3,0.2");
    const res = await suggestGet(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("models");
    expect(Array.isArray(data.models)).toBe(true);
  });

  it("POST /api/combos/suggest/accept guards against invalid or duplicate combo payloads", async () => {
    const req = new NextRequest("http://localhost:20128/api/combos/suggest/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "" })
    });
    const res = await acceptPost(req);
    expect(res.status).toBe(400);
  });
});
