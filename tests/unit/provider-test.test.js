/**
 * Unit tests for testUtils.js P0 fixes:
 * - refreshOAuthToken reuses refreshProviderCredentials (no hand-rolled fetch)
 * - isUnrecoverableRefreshError classifies permanent vs transient failures
 * - testSingleConnection retries transient results before writing to DB
 * - Kiro live-probe via resolveKiroModels
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Module mocks (must be before any import of the module under test) ---

vi.mock("open-sse/services/oauthCredentialManager.js", () => ({
  refreshProviderCredentials: vi.fn(),
  shouldRefreshCredentials: vi.fn(() => false),
}));

vi.mock("open-sse/services/kiroModels.js", () => ({
  resolveKiroModels: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnectionById: vi.fn(),
  updateProviderConnection: vi.fn(),
}));

vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: vi.fn(async () => ({ connectionProxyEnabled: false })),
}));

vi.mock("@/lib/network/proxyTest", () => ({
  testProxyUrl: vi.fn(async () => ({ ok: true })),
}));

// Stub out the heavy provider-config imports testUtils.js pulls in at module level.
vi.mock("open-sse/config/providerModels.js", () => ({ getDefaultModel: vi.fn(() => "stub-model") }));
vi.mock("open-sse/config/providers.js", () => ({
  resolveOllamaLocalHost: vi.fn(),
  PROVIDERS: {},
  PROVIDER_OAUTH: {},
}));
vi.mock("@/shared/constants/providers", () => ({
  isOpenAICompatibleProvider: vi.fn(() => false),
  isAnthropicCompatibleProvider: vi.fn(() => false),
}));
vi.mock("@/lib/oauth/constants/oauth", () => ({
  KILOCODE_CONFIG: { apiBaseUrl: "https://kilocode.example" },
  KIMCHI_CONFIG: { validationUrl: "https://kimchi.example" },
}));
vi.mock("@/shared/utils/clineAuth", () => ({ buildClineHeaders: vi.fn(() => ({})) }));

import {
  refreshProviderCredentials,
  shouldRefreshCredentials,
} from "open-sse/services/oauthCredentialManager.js";
import { resolveKiroModels } from "open-sse/services/kiroModels.js";
import { getProviderConnectionById, updateProviderConnection } from "@/lib/localDb";
import { isUnrecoverableRefreshError } from "open-sse/services/tokenRefresh.js";

// Import after mocks are set up.
const { testSingleConnection } = await import(
  "../../src/app/api/providers/[id]/test/testUtils.js"
);

// ---------------------------------------------------------------------------

function makeKiroConn(overrides = {}) {
  return {
    id: "conn-kiro-1",
    provider: "kiro",
    authType: "oauth",
    accessToken: "at-valid",
    refreshToken: "rt-valid",
    testStatus: "active",
    providerSpecificData: {},
    ...overrides,
  };
}

describe("isUnrecoverableRefreshError", () => {
  it("true for invalid_grant", () => {
    expect(isUnrecoverableRefreshError({ error: "invalid_grant" })).toBe(true);
  });
  it("true for refresh_token_reused", () => {
    expect(isUnrecoverableRefreshError({ error: "refresh_token_reused" })).toBe(true);
  });
  it("falsy for null (network error)", () => {
    expect(isUnrecoverableRefreshError(null)).toBeFalsy();
  });
  it("falsy for object without recognised error field", () => {
    expect(isUnrecoverableRefreshError({ status: 500 })).toBeFalsy();
  });
});

describe("refreshOAuthToken — no hand-rolled fetch", () => {
  it("delegates to refreshProviderCredentials for kiro", async () => {
    refreshProviderCredentials.mockResolvedValueOnce({ accessToken: "new-at" });
    // Call via testSingleConnection path indirectly — or just verify the mock
    // is the only fetch path by checking no raw fetch calls happen.
    // We do this by ensuring refreshProviderCredentials is called when token is expired.
    shouldRefreshCredentials.mockReturnValueOnce(true);
    getProviderConnectionById.mockResolvedValueOnce(makeKiroConn());
    resolveKiroModels.mockResolvedValueOnce({ models: [{ id: "m1" }] });
    updateProviderConnection.mockResolvedValueOnce();

    await testSingleConnection("conn-kiro-1");

    expect(refreshProviderCredentials).toHaveBeenCalledWith("kiro", expect.any(Object), console);
  });

  it("delegates to refreshProviderCredentials for claude", async () => {
    shouldRefreshCredentials.mockReturnValueOnce(true);
    refreshProviderCredentials.mockResolvedValueOnce({ accessToken: "new-at-claude" });
    getProviderConnectionById.mockResolvedValueOnce({
      ...makeKiroConn(),
      provider: "claude",
      testStatus: "active",
    });
    updateProviderConnection.mockResolvedValueOnce();

    await testSingleConnection("conn-kiro-1");

    expect(refreshProviderCredentials).toHaveBeenCalledWith("claude", expect.any(Object), console);
  });
});

describe("testSingleConnection — transient failure handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retries once on transient and writes active when retry succeeds", async () => {
    // Token expired → refresh → network error (transient) on first call,
    // then succeeds on retry.
    shouldRefreshCredentials
      .mockReturnValueOnce(true)  // first testOAuthConnection call
      .mockReturnValueOnce(true); // retry call

    refreshProviderCredentials
      .mockRejectedValueOnce(new Error("ECONNRESET")) // first attempt: network error
      .mockResolvedValueOnce({ accessToken: "new-at" }); // retry: success

    resolveKiroModels.mockResolvedValue({ models: [{ id: "m1" }] });

    getProviderConnectionById.mockResolvedValue(makeKiroConn());
    updateProviderConnection.mockResolvedValue();

    const result = await testSingleConnection("conn-kiro-1");

    // Should have retried and succeeded.
    expect(updateProviderConnection).toHaveBeenCalledWith(
      "conn-kiro-1",
      expect.objectContaining({ testStatus: "active" })
    );
    expect(result.valid).toBe(true);
  });

  it("preserves existing testStatus when both attempts are transient", async () => {
    // Both attempts: refresh throws network error → transient → valid: null
    shouldRefreshCredentials.mockReturnValue(true);
    refreshProviderCredentials.mockRejectedValue(new Error("ETIMEDOUT"));

    getProviderConnectionById.mockResolvedValue(makeKiroConn({ testStatus: "active" }));
    updateProviderConnection.mockResolvedValue();

    await testSingleConnection("conn-kiro-1");

    // Must NOT write "error" — must preserve "active"
    expect(updateProviderConnection).toHaveBeenCalledWith(
      "conn-kiro-1",
      expect.objectContaining({ testStatus: "active" })
    );
  });

  it("writes error when refresh returns unrecoverable error", async () => {
    shouldRefreshCredentials.mockReturnValue(true);
    // refreshProviderCredentials returns an object with error field (unrecoverable)
    refreshProviderCredentials.mockResolvedValue({ error: "invalid_grant" });

    getProviderConnectionById.mockResolvedValue(makeKiroConn({ testStatus: "active" }));
    updateProviderConnection.mockResolvedValue();

    const result = await testSingleConnection("conn-kiro-1");

    expect(result.valid).toBe(false);
    expect(updateProviderConnection).toHaveBeenCalledWith(
      "conn-kiro-1",
      expect.objectContaining({ testStatus: "error" })
    );
  });
});

describe("Kiro live-probe", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("valid:true when resolveKiroModels returns models (token not expired)", async () => {
    shouldRefreshCredentials.mockReturnValue(false); // not expired
    resolveKiroModels.mockResolvedValue({ models: [{ id: "claude-opus-5" }] });

    getProviderConnectionById.mockResolvedValue(makeKiroConn());
    updateProviderConnection.mockResolvedValue();

    const result = await testSingleConnection("conn-kiro-1");

    expect(resolveKiroModels).toHaveBeenCalled();
    expect(result.valid).toBe(true);
  });

  it("valid:null (transient) when resolveKiroModels returns null even though token not expired", async () => {
    // Simulates: token not expired client-side but server-side revoked (§1.1 first bullet)
    shouldRefreshCredentials.mockReturnValue(false);
    resolveKiroModels.mockResolvedValue(null);

    getProviderConnectionById.mockResolvedValue(makeKiroConn({ testStatus: "active" }));
    updateProviderConnection.mockResolvedValue();

    await testSingleConnection("conn-kiro-1");

    // Transient → preserve existing status
    expect(updateProviderConnection).toHaveBeenCalledWith(
      "conn-kiro-1",
      expect.objectContaining({ testStatus: "active" })
    );
  });
});
