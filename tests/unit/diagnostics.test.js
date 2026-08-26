import { describe, it, expect } from "vitest";
import { DiagCode, classify, buildDiagnosticBody } from "../../src/lib/proxy/diagnostics.js";

describe("Proxy Diagnostics", () => {
  it("classifies HTTP 401 as AUTH_FAILED", () => {
    const diag = classify({ status: 401, message: "Unauthorized", provider: "openai" });
    expect(diag.code).toBe(DiagCode.AUTH_FAILED);
    expect(diag.hint).toBeDefined();
  });

  it("classifies HTTP 429 as RATE_LIMITED", () => {
    const diag = classify({ status: 429, message: "Too many requests", provider: "anthropic" });
    expect(diag.code).toBe(DiagCode.RATE_LIMITED);
  });

  it("classifies context length exceeded messages", () => {
    const diag = classify({
      message: "maximum context length is 8192 tokens exceeded",
      provider: "openai"
    });
    expect(diag.code).toBe(DiagCode.CONTEXT_TOO_LONG);
  });

  it("classifies model not found", () => {
    const diag = classify({
      status: 404,
      message: "The model `gpt-5` does not exist",
      provider: "openai"
    });
    expect(diag.code).toBe(DiagCode.MODEL_NOT_FOUND);
  });

  it("builds valid OpenAI-compatible error diagnostic body", () => {
    const diag = classify({ status: 402, message: "Quota exceeded", provider: "gemini" });
    const body = buildDiagnosticBody(diag);
    expect(body.error).toBeDefined();
    expect(body.error.message).toBe("Quota exceeded");
    expect(body.error.code).toBe(DiagCode.QUOTA_EXHAUSTED ?? DiagCode.QUOTA_EXCEEDED);
    expect(body.error.diagnostic).toBeDefined();
    expect(body.error.diagnostic.provider).toBe("gemini");
    expect(body.error.diagnostic.hint).toBeDefined();
  });
});
