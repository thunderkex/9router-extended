import { describe, it, expect } from "vitest";
import {
  HERMES_HOME_DIR,
  HERMES_CONFIG_PATH,
  HERMES_ENV_PATH,
  HERMES_PLUGIN_DIR,
  HERMES_PID_FILE,
  HERMES_SERVICE_LOG,
  HERMES_INSTALL_LOG,
  getHermesHomeDir,
  getHermesConfigPath,
  getHermesEnvPath,
} from "@/lib/plugins/hermes/paths.js";
import { findHermesBinary, getHermesVersion } from "@/lib/plugins/hermes/detect.js";
import { getInstallInfo, isInstalling, getInstallLogTail } from "@/lib/plugins/hermes/install.js";
import { getHermesServiceStatus, isPidAlive, getHermesLogsTail } from "@/lib/plugins/hermes/process.js";

describe("Hermes Plugin Subsystem", () => {
  it("exports correct hermes directory and config paths", () => {
    expect(HERMES_HOME_DIR).toBeDefined();
    expect(HERMES_CONFIG_PATH).toContain("config.yaml");
    expect(HERMES_ENV_PATH).toContain(".env");
    expect(HERMES_PLUGIN_DIR).toContain("plugins");
    expect(HERMES_PID_FILE).toContain("service.pid");
    expect(HERMES_SERVICE_LOG).toContain("service.log");
    expect(HERMES_INSTALL_LOG).toContain("install.log");

    expect(getHermesHomeDir()).toBe(HERMES_HOME_DIR);
    expect(getHermesConfigPath()).toBe(HERMES_CONFIG_PATH);
    expect(getHermesEnvPath()).toBe(HERMES_ENV_PATH);
  });

  it("handles detection gracefully when not installed", () => {
    const bin = findHermesBinary();
    // In CI / dev without hermes installed, should return string or null without throwing
    expect(bin === null || typeof bin === "string").toBe(true);

    const version = getHermesVersion("non-existent-binary-xyz");
    expect(version).toBeNull();
  });

  it("reports install and service status correctly", () => {
    const installInfo = getInstallInfo();
    expect(installInfo).toHaveProperty("installed");
    expect(installInfo).toHaveProperty("version");
    expect(installInfo).toHaveProperty("path");

    expect(isInstalling()).toBe(false);

    const status = getHermesServiceStatus();
    expect(status).toHaveProperty("installed", installInfo.installed);
    expect(status).toHaveProperty("running");
    expect(status).toHaveProperty("pid");
    expect(status).toHaveProperty("uptimeMs");

    expect(isPidAlive(null)).toBe(false);
    expect(isPidAlive(-1)).toBe(false);

    const installLogs = getInstallLogTail();
    expect(typeof installLogs).toBe("string");

    const serviceLogs = getHermesLogsTail();
    expect(typeof serviceLogs).toBe("string");
  });
});
