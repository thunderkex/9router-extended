import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import {
  HERMES_HOME_DIR,
  HERMES_PLUGIN_DIR,
  HERMES_PID_FILE,
  HERMES_SERVICE_LOG,
} from "./paths.js";
import { findHermesBinary, HERMES_EXTENDED_PATH } from "./detect.js";
import { getInstallInfo, isInstalling } from "./install.js";

const STARTUP_TIMEOUT_MS = 5000;

function ensureDir() {
  if (!fs.existsSync(HERMES_PLUGIN_DIR)) fs.mkdirSync(HERMES_PLUGIN_DIR, { recursive: true });
}

function readPid() {
  try {
    if (fs.existsSync(HERMES_PID_FILE)) {
      const pid = parseInt(fs.readFileSync(HERMES_PID_FILE, "utf8"), 10);
      if (!Number.isNaN(pid) && isPidAlive(pid)) return pid;
    }
  } catch { /* ignore */ }

  // Fallback to native Hermes gateway.pid in HERMES_HOME_DIR
  try {
    const nativePidPath = path.join(HERMES_HOME_DIR, "gateway.pid");
    if (fs.existsSync(nativePidPath)) {
      const content = fs.readFileSync(nativePidPath, "utf8");
      try {
        const json = JSON.parse(content);
        if (json?.pid && isPidAlive(json.pid)) return json.pid;
      } catch {
        const pid = parseInt(content, 10);
        if (!Number.isNaN(pid) && isPidAlive(pid)) return pid;
      }
    }
  } catch { /* ignore */ }

  return null;
}

function writePid(pid) {
  ensureDir();
  fs.writeFileSync(HERMES_PID_FILE, String(pid));
}

function clearPid() {
  try {
    if (fs.existsSync(HERMES_PID_FILE)) fs.unlinkSync(HERMES_PID_FILE);
  } catch { /* ignore */ }
}

export function isPidAlive(pid) {
  if (!pid || typeof pid !== "number") return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function getManagedPid() {
  const pid = readPid();
  return pid && isPidAlive(pid) ? pid : null;
}

// Start Hermes in headless / service daemon mode
export async function startHermesService({ args = [] } = {}) {
  const binary = findHermesBinary();
  if (!binary) {
    const err = new Error("Hermes Agent CLI is not installed");
    err.code = "NOT_INSTALLED";
    throw err;
  }

  const existing = getManagedPid();
  if (existing) {
    return { pid: existing, alreadyRunning: true };
  }

  ensureDir();
  const outFd = fs.openSync(HERMES_SERVICE_LOG, "a");

  // Default arguments: run gateway/daemon/server if provided, or default non-interactive service
  const runArgs = args.length > 0 ? args : ["gateway"];
  const child = spawn(binary, runArgs, {
    stdio: ["ignore", outFd, outFd],
    detached: process.platform !== "win32",
    windowsHide: true,
    env: { ...process.env, PATH: HERMES_EXTENDED_PATH },
  });

  if (!child.pid) {
    fs.closeSync(outFd);
    const err = new Error("Failed to spawn Hermes service process");
    err.code = "SPAWN_FAILED";
    throw err;
  }

  child.unref();
  writePid(child.pid);

  await new Promise((resolve, reject) => {
    const startupTimer = setTimeout(() => {
      if (isPidAlive(child.pid)) resolve();
      else reject(new Error("Hermes service exited during startup — see service.log"));
    }, STARTUP_TIMEOUT_MS);

    child.once("exit", (code) => {
      clearTimeout(startupTimer);
      clearPid();
      fs.closeSync(outFd);
      const e = new Error(`Hermes service exited early (code=${code}) — see service.log`);
      e.code = "EARLY_EXIT";
      reject(e);
    });
  });

  fs.closeSync(outFd);
  return { pid: child.pid, alreadyRunning: false };
}

export function stopHermesService() {
  const pid = getManagedPid();
  if (!pid) return { stopped: false, reason: "not_running" };

  try {
    process.kill(pid, "SIGTERM");
    setTimeout(() => {
      if (isPidAlive(pid)) {
        try {
          process.kill(pid, "SIGKILL");
        } catch { /* already gone */ }
      }
    }, 2000);
    clearPid();
    return { stopped: true, pid };
  } catch (e) {
    clearPid();
    const err = new Error(`Failed to stop Hermes service: ${e.message}`);
    err.code = "STOP_FAILED";
    throw err;
  }
}

export async function restartHermesService(opts = {}) {
  const pid = getManagedPid();
  if (pid) {
    try {
      process.kill(pid, "SIGTERM");
    } catch { /* already gone */ }
    for (let i = 0; i < 30 && isPidAlive(pid); i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (isPidAlive(pid)) {
      try {
        process.kill(pid, "SIGKILL");
      } catch { /* ignore */ }
    }
    clearPid();
  }
  return startHermesService(opts);
}

export function getHermesLogsTail(maxLines = 100) {
  try {
    if (!fs.existsSync(HERMES_SERVICE_LOG)) return "";
    const lines = fs.readFileSync(HERMES_SERVICE_LOG, "utf8").split(/\r?\n/).filter(Boolean);
    return lines.slice(-maxLines).join("\n");
  } catch {
    return "";
  }
}

export function getHermesServiceStatus() {
  const install = getInstallInfo();
  const pid = getManagedPid();
  const running = !!pid;
  let uptimeMs = 0;

  if (running && fs.existsSync(HERMES_PID_FILE)) {
    try {
      const stats = fs.statSync(HERMES_PID_FILE);
      uptimeMs = Math.max(0, Date.now() - stats.mtimeMs);
    } catch { /* ignore */ }
  }

  return {
    installed: install.installed,
    installing: isInstalling(),
    version: install.version,
    path: install.path,
    running,
    pid,
    uptimeMs,
  };
}
