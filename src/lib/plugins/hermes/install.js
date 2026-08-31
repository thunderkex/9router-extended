import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { HERMES_PLUGIN_DIR, HERMES_INSTALL_LOG } from "./paths.js";
import { findHermesBinary, getHermesVersion, HERMES_EXTENDED_PATH } from "./detect.js";

const INSTALL_TIMEOUT_MS = 5 * 60 * 1000;
const IS_WIN = process.platform === "win32";

let installInFlight = null;

function ensureDir() {
  if (!fs.existsSync(HERMES_PLUGIN_DIR)) fs.mkdirSync(HERMES_PLUGIN_DIR, { recursive: true });
}

export function getInstallInfo() {
  const binary = findHermesBinary();
  if (!binary) {
    return { installed: false, version: null, path: null };
  }
  const version = getHermesVersion(binary);
  return { installed: true, version, path: binary };
}

export function isInstalling() {
  return installInFlight !== null;
}

export function installHermes() {
  if (installInFlight) return installInFlight;
  installInFlight = runInstall().finally(() => {
    installInFlight = null;
  });
  return installInFlight;
}

async function runInstall() {
  ensureDir();
  const outFd = fs.openSync(HERMES_INSTALL_LOG, "a");
  fs.writeSync(outFd, `\n[${new Date().toISOString()}] Starting official Hermes Agent installation\n`);

  await new Promise((resolve, reject) => {
    let child;
    if (IS_WIN) {
      const psScript = "iex (irm https://hermes-agent.nousresearch.com/install.ps1)";
      child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", psScript], {
        stdio: ["ignore", outFd, outFd],
        windowsHide: true,
        env: { ...process.env, PATH: HERMES_EXTENDED_PATH },
      });
    } else {
      const shScript = "curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash";
      child = spawn("bash", ["-c", shScript], {
        stdio: ["ignore", outFd, outFd],
        windowsHide: true,
        env: { ...process.env, PATH: HERMES_EXTENDED_PATH },
      });
    }

    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch { /* ignore */ }
      reject(new Error("Hermes installer timed out after 5 minutes — see install.log"));
    }, INSTALL_TIMEOUT_MS);

    child.once("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });

    child.once("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`Hermes installer exited with code ${code} — see install.log`));
    });
  }).finally(() => {
    fs.closeSync(outFd);
  });

  const info = getInstallInfo();
  if (!info.installed) {
    throw new Error("Hermes install finished but binary was not found — see install.log");
  }

  // Windows fix: patch shutdown watchdog if present to avoid AttributeError on start_unix_server
  if (IS_WIN && info.path) {
    try {
      const hermesHome = path.dirname(path.dirname(info.path));
      const watchdogPath = path.join(hermesHome, "hermes-agent", "gateway", "shutdown_watchdog.py");
      if (fs.existsSync(watchdogPath)) {
        let code = fs.readFileSync(watchdogPath, "utf8");
        if (!code.includes("os.name == 'posix'") && !code.includes('os.name == "posix"')) {
          code = code.replace(
            "asyncio.start_unix_server",
            "None if os.name != 'posix' else asyncio.start_unix_server"
          );
          fs.writeFileSync(watchdogPath, code, "utf8");
        }
      }
    } catch {
      // non-fatal patch attempt
    }
  }

  return info;
}

export function getInstallLogTail(maxLines = 200) {
  try {
    if (!fs.existsSync(HERMES_INSTALL_LOG)) return "";
    const lines = fs.readFileSync(HERMES_INSTALL_LOG, "utf8").split(/\r?\n/).filter(Boolean);
    return lines.slice(-maxLines).join("\n");
  } catch {
    return "";
  }
}
