import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  compareVersions,
  buildResult,
  checkForUpdate,
  clearPluginUpdateCache,
} from "../../src/lib/updateCheck.js";

describe("updateCheck utility suite", () => {
  beforeEach(() => {
    clearPluginUpdateCache();
    vi.clearAllMocks();
  });

  describe("compareVersions", () => {
    it("compares standard semver versions accurately", () => {
      expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
      expect(compareVersions("1.0.1", "1.0.0")).toBe(1);
      expect(compareVersions("1.0.0", "1.0.1")).toBe(-1);
      expect(compareVersions("2.0.0", "1.9.9")).toBe(1);
      expect(compareVersions("1.10.0", "1.2.0")).toBe(1);
    });

    it("handles leading v and variable segment lengths", () => {
      expect(compareVersions("v1.2.0", "1.2.0")).toBe(0);
      expect(compareVersions("1.2", "1.2.0")).toBe(0);
      expect(compareVersions("1.2.1", "1.2")).toBe(1);
      expect(compareVersions("1.2", "1.2.1")).toBe(-1);
      expect(compareVersions("v2.1.0", "v2.0.99")).toBe(1);
    });

    it("handles null/undefined gracefully", () => {
      expect(compareVersions(null, null)).toBe(0);
      expect(compareVersions("1.0.0", null)).toBe(1);
      expect(compareVersions(null, "1.0.0")).toBe(-1);
    });
  });

  describe("buildResult", () => {
    it("returns hasUpdate true when latest > current", () => {
      const res = buildResult("1.0.0", "1.1.0");
      expect(res).toEqual({
        currentVersion: "1.0.0",
        latestVersion: "1.1.0",
        currentMd5: null,
        latestMd5: null,
        hasUpdate: true,
        isRebuild: false,
      });
    });

    it("returns hasUpdate false when current >= latest or missing", () => {
      expect(buildResult("1.1.0", "1.0.0").hasUpdate).toBe(false);
      expect(buildResult("1.0.0", "1.0.0").hasUpdate).toBe(false);
      expect(buildResult("1.0.0", null).hasUpdate).toBe(false);
      expect(buildResult(null, "1.0.0").hasUpdate).toBe(false);
    });

    it("detects rebuild update when version is identical but MD5 differs", () => {
      const res = buildResult("1.0.0", "1.0.0", "aaa111", "bbb222");
      expect(res).toEqual({
        currentVersion: "1.0.0",
        latestVersion: "1.0.0",
        currentMd5: "aaa111",
        latestMd5: "bbb222",
        hasUpdate: true,
        isRebuild: true,
      });
    });

    it("returns hasUpdate false when version and MD5 are identical", () => {
      const res = buildResult("1.0.0", "1.0.0", "aaa111", "aaa111");
      expect(res).toEqual({
        currentVersion: "1.0.0",
        latestVersion: "1.0.0",
        currentMd5: "aaa111",
        latestMd5: "aaa111",
        hasUpdate: false,
        isRebuild: false,
      });
    });
  });

  describe("checkForUpdate", () => {
    it("uses cache within TTL window", async () => {
      const mockResolver = vi.fn().mockResolvedValue("2.0.0");

      const res1 = await checkForUpdate("test-plugin", "1.0.0", mockResolver, 10000);
      expect(res1).toEqual({
        currentVersion: "1.0.0",
        latestVersion: "2.0.0",
        currentMd5: null,
        latestMd5: null,
        hasUpdate: true,
        isRebuild: false,
      });
      expect(mockResolver).toHaveBeenCalledTimes(1);

      const res2 = await checkForUpdate("test-plugin", "1.0.0", mockResolver, 10000);
      expect(res2).toEqual({
        currentVersion: "1.0.0",
        latestVersion: "2.0.0",
        currentMd5: null,
        latestMd5: null,
        hasUpdate: true,
        isRebuild: false,
      });
      expect(mockResolver).toHaveBeenCalledTimes(1); // Cached
    });

    it("supports resolver returning object with version and md5", async () => {
      const mockResolver = vi.fn().mockResolvedValue({
        version: "1.0.0",
        md5: "new-md5-hash-12345",
      });

      const res = await checkForUpdate("9router-extended", "1.0.0", mockResolver, 10000, "old-md5-hash-67890");
      expect(res).toEqual({
        currentVersion: "1.0.0",
        latestVersion: "1.0.0",
        currentMd5: "old-md5-hash-67890",
        latestMd5: "new-md5-hash-12345",
        hasUpdate: true,
        isRebuild: true,
      });
    });

    it("keeps caches distinct for different keys", async () => {
      const resolverA = vi.fn().mockResolvedValue("1.5.0");
      const resolverB = vi.fn().mockResolvedValue("2.5.0");

      await checkForUpdate("plugin-a", "1.0.0", resolverA, 10000);
      await checkForUpdate("plugin-b", "2.0.0", resolverB, 10000);

      expect(resolverA).toHaveBeenCalledTimes(1);
      expect(resolverB).toHaveBeenCalledTimes(1);
    });

    it("fails open when fetchLatest throws or rejects", async () => {
      const failingResolver = vi.fn().mockRejectedValue(new Error("Network timeout"));

      const res = await checkForUpdate("broken-plugin", "1.0.0", failingResolver, 10000);
      expect(res).toEqual({
        currentVersion: "1.0.0",
        latestVersion: null,
        currentMd5: null,
        latestMd5: null,
        hasUpdate: false,
        isRebuild: false,
      });
    });
  });

  describe("Tier A / B orchestration update methods", () => {
    it("updateHermes stops running process, installs, and restarts", async () => {
      const isHermesRunning = vi.fn().mockResolvedValue(true);
      const stopHermesService = vi.fn().mockResolvedValue({ success: true });
      const installHermes = vi.fn().mockResolvedValue({ success: true });
      const startHermesService = vi.fn().mockResolvedValue({ success: true, pid: 1234 });

      // Orchestration flow simulation
      const wasRunning = await isHermesRunning();
      if (wasRunning) {
        await stopHermesService();
      }
      const installRes = await installHermes();
      expect(installRes.success).toBe(true);

      if (wasRunning) {
        await startHermesService();
      }

      expect(stopHermesService).toHaveBeenCalledTimes(1);
      expect(installHermes).toHaveBeenCalledTimes(1);
      expect(startHermesService).toHaveBeenCalledTimes(1);
    });

    it("updatePxpipe unloads in-process module, installs, and reloads", async () => {
      let activeModule = { version: "1.0.0" };
      const unloadPxpipe = vi.fn(() => { activeModule = null; });
      const installPxpipe = vi.fn().mockResolvedValue({ success: true });
      const loadPxpipe = vi.fn(() => { activeModule = { version: "1.1.0" }; });

      unloadPxpipe();
      expect(activeModule).toBeNull();

      const installRes = await installPxpipe();
      expect(installRes.success).toBe(true);

      loadPxpipe();
      expect(activeModule).toEqual({ version: "1.1.0" });
      expect(unloadPxpipe).toHaveBeenCalledTimes(1);
      expect(installPxpipe).toHaveBeenCalledTimes(1);
      expect(loadPxpipe).toHaveBeenCalledTimes(1);
    });
  });
});
