import path from "path";
import os from "os";
import fs from "fs";
import { DATA_DIR } from "../../dataDir.js";

function resolveHermesHomeDir() {
  const dotHermes = path.join(os.homedir(), ".hermes");
  if (fs.existsSync(dotHermes)) return dotHermes;

  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
    const appDataHermes = path.join(localAppData, "hermes");
    if (fs.existsSync(appDataHermes)) return appDataHermes;
  }

  return dotHermes;
}

export const HERMES_HOME_DIR = resolveHermesHomeDir();
export const HERMES_CONFIG_PATH = path.join(HERMES_HOME_DIR, "config.yaml");
export const HERMES_ENV_PATH = path.join(HERMES_HOME_DIR, ".env");

export const HERMES_PLUGIN_DIR = path.join(DATA_DIR, "plugins", "hermes");
export const HERMES_PID_FILE = path.join(HERMES_PLUGIN_DIR, "service.pid");
export const HERMES_SERVICE_LOG = path.join(HERMES_PLUGIN_DIR, "service.log");
export const HERMES_INSTALL_LOG = path.join(HERMES_PLUGIN_DIR, "install.log");

export function getHermesHomeDir() {
  return resolveHermesHomeDir();
}

export function getHermesConfigPath() {
  const home = resolveHermesHomeDir();
  return path.join(home, "config.yaml");
}

export function getHermesEnvPath() {
  const home = resolveHermesHomeDir();
  return path.join(home, ".env");
}
