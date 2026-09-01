import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import { getHermesHomeDir } from "./paths.js";

const IS_WIN = process.platform === "win32";
const WHICH_CMD = IS_WIN ? "where" : "which";

const EXTRA_BINS = IS_WIN
  ? [
      path.join(os.homedir(), ".hermes", "bin"),
      path.join(os.homedir(), ".local", "bin"),
      path.join(os.homedir(), "AppData", "Roaming", "npm"),
      path.join(os.homedir(), "AppData", "Local", "Programs", "hermes"),
      `${process.env.LOCALAPPDATA || ""}\\Programs\\Python\\Python313\\Scripts`,
      `${process.env.LOCALAPPDATA || ""}\\Programs\\Python\\Python312\\Scripts`,
      `${process.env.LOCALAPPDATA || ""}\\Programs\\Python\\Python311\\Scripts`,
      `${process.env.LOCALAPPDATA || ""}\\Programs\\Python\\Python310\\Scripts`,
      `${process.env.APPDATA || ""}\\Python\\Python313\\Scripts`,
    ]
  : [
      path.join(os.homedir(), ".hermes", "bin"),
      path.join(os.homedir(), ".local", "bin"),
      "/usr/local/bin",
      "/opt/homebrew/bin",
      "/usr/bin",
      "/bin",
    ];

export const HERMES_EXTENDED_PATH = [...EXTRA_BINS, process.env.PATH || ""].filter(Boolean).join(path.delimiter);

const DETECT_CACHE_TTL_MS = 60000;
let cachedHermesBinary = undefined;
let lastHermesBinaryCheck = 0;

export function clearHermesBinaryCache() {
  cachedHermesBinary = undefined;
  lastHermesBinaryCheck = 0;
}

export function findHermesBinary(force = false) {
  const now = Date.now();
  if (!force && cachedHermesBinary !== undefined && (now - lastHermesBinaryCheck < DETECT_CACHE_TTL_MS)) {
    return cachedHermesBinary;
  }

  let resolved = null;
  try {
    const out = execSync(`${WHICH_CMD} hermes`, {
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
      env: { ...process.env, PATH: HERMES_EXTENDED_PATH },
    }).toString().trim();
    if (out) {
      const firstLine = out.split(/\r?\n/)[0].trim();
      if (firstLine && fs.existsSync(firstLine)) resolved = firstLine;
    }
  } catch { /* ignore */ }

  if (!resolved) {
    const directCandidates = [
      path.join(getHermesHomeDir(), "bin", IS_WIN ? "hermes.exe" : "hermes"),
      path.join(getHermesHomeDir(), "bin", IS_WIN ? "hermes.bat" : "hermes"),
      path.join(getHermesHomeDir(), "bin", IS_WIN ? "hermes.cmd" : "hermes"),
      path.join(os.homedir(), ".local", "bin", IS_WIN ? "hermes.exe" : "hermes"),
    ];

    for (const candidate of directCandidates) {
      try {
        if (fs.existsSync(candidate)) {
          resolved = candidate;
          break;
        }
      } catch { /* ignore */ }
    }
  }

  cachedHermesBinary = resolved;
  lastHermesBinaryCheck = now;
  return resolved;
}

export function getHermesVersion(binaryPath = null) {
  const bin = binaryPath || findHermesBinary();
  if (!bin) return null;
  try {
    const out = execSync(`"${bin}" --version`, {
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
      env: { ...process.env, PATH: HERMES_EXTENDED_PATH },
    }).toString().trim();
    
    // Check for CalVer date pattern in parentheses e.g. "Hermes Agent v0.21.0 (2026.8.31)"
    const calverMatch = out.match(/\((202\d\.\d+\.\d+)\)/);
    if (calverMatch) return calverMatch[1];

    const match = out.match(/(\d+\.\d+(\.\d+)?(-[a-zA-Z0-9.]+)?)/);
    return match ? match[1] : (out.split(/\r?\n/)[0].trim() || null);
  } catch {
    return null;
  }
}
