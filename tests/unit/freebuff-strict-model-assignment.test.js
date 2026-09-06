/**
 * Freebuff features — strict-model-assignment filter
 *
 * The Freebuff session lock is per (token, model). When a session is active on
 * one model, requesting a different model from the same account returns
 * "model_locked" (409). To avoid this, an admin can pin each account to a
 * single model via `providerStrategies[freebuff].strictModelAssignment =
 * true` + per-connection `providerSpecificData.assignedModel`.
 *
 * `filterConnectionsForModel` is the engine-side gate that hides connections
 * whose assigned model doesn't match the requested model. This test pins
 * the contract: pass-through for non-freebuff providers, no-op when strict
 * mode is off, exact match when strict mode is on, and legacy `freebuffModel`
 * field is honored for backward compatibility.
 */

import { describe, it, expect } from "vitest";
import { filterConnectionsForModel } from "../../src/sse/services/auth.js";

const MODEL = "deepseek/deepseek-v4-flash";
const OTHER = "mimo/mimo-v2.5";

const conn = (id, data) => ({ id, providerSpecificData: data });

describe("filterConnectionsForModel", () => {
  it("passes through unchanged for non-freebuff providers", () => {
    const connections = [
      conn("a", { assignedModel: OTHER }),
      conn("b", { assignedModel: MODEL }),
    ];
    const result = filterConnectionsForModel("claude", connections, MODEL, {});
    expect(result).toBe(connections);
  });

  it("passes through unchanged for freebuff when strict mode is off", () => {
    const connections = [
      conn("a", { assignedModel: OTHER }),
      conn("b", { assignedModel: MODEL }),
    ];
    const result = filterConnectionsForModel("freebuff", connections, MODEL, {
      providerStrategies: { freebuff: { fallbackStrategy: "round-robin" } },
    });
    expect(result).toBe(connections);
  });

  it("passes through unchanged when no model is requested", () => {
    const connections = [conn("a", { assignedModel: OTHER })];
    const result = filterConnectionsForModel(
      "freebuff",
      connections,
      null,
      { providerStrategies: { freebuff: { strictModelAssignment: true } } },
    );
    expect(result).toBe(connections);
  });

  it("keeps only connections whose assignedModel matches", () => {
    const connections = [
      conn("a", { assignedModel: OTHER }),
      conn("b", { assignedModel: MODEL }),
      conn("c", { assignedModel: MODEL }),
    ];
    const result = filterConnectionsForModel(
      "freebuff",
      connections,
      MODEL,
      { providerStrategies: { freebuff: { strictModelAssignment: true } } },
    );
    expect(result.map((c) => c.id)).toEqual(["b", "c"]);
  });

  it("excludes connections with no assignedModel under strict mode", () => {
    const connections = [
      conn("a", { foo: "bar" }),
      conn("b", { assignedModel: MODEL }),
    ];
    const result = filterConnectionsForModel(
      "freebuff",
      connections,
      MODEL,
      { providerStrategies: { freebuff: { strictModelAssignment: true } } },
    );
    expect(result.map((c) => c.id)).toEqual(["b"]);
  });

  it("falls back to legacy freebuffModel when assignedModel is absent", () => {
    const connections = [
      conn("a", { freebuffModel: MODEL }),
      conn("b", { freebuffModel: OTHER }),
    ];
    const result = filterConnectionsForModel(
      "freebuff",
      connections,
      MODEL,
      { providerStrategies: { freebuff: { strictModelAssignment: true } } },
    );
    expect(result.map((c) => c.id)).toEqual(["a"]);
  });

  it("treats assignedModel=null as unassigned under strict mode", () => {
    const connections = [
      conn("a", { assignedModel: null }),
      conn("b", { assignedModel: MODEL }),
    ];
    const result = filterConnectionsForModel(
      "freebuff",
      connections,
      MODEL,
      { providerStrategies: { freebuff: { strictModelAssignment: true } } },
    );
    expect(result.map((c) => c.id)).toEqual(["b"]);
  });
});
