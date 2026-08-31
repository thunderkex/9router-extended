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

export function findHermesBinary() {
  try {
    const out = execSync(`${WHICH_CMD} hermes`, {
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
      env: { ...process.env, PATH: HERMES_EXTENDED_PATH },
    }).toString().trim();
    if (out) {
      const firstLine = out.split(/\r?\n/)[0].trim();
      if (firstLine && fs.existsSync(firstLine)) return firstLine;
    }
  } catch { /* ignore */ }

  const directCandidates = [
    path.join(getHermesHomeDir(), "bin", IS_WIN ? "hermes.exe" : "hermes"),
    path.join(getHermesHomeDir(), "bin", IS_WIN ? "hermes.bat" : "hermes"),
    path.join(getHermesHomeDir(), "bin", IS_WIN ? "hermes.cmd" : "hermes"),
    path.join(os.homedir(), ".local", "bin", IS_WIN ? "hermes.exe" : "hermes"),
  ];

  for (const candidate of directCandidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch { /* ignore */ }
  }

  return null;
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
    const match = out.match(/(\d+\.\d+(\.\d+)?(-[a-zA-Z0-9.]+)?)/);
    return match ? match[1] : (out.split(/\r?\n/)[0].trim() || null);
  } catch {
    return null;
  }
}
