import fs from "fs";
import path from "path";
import os from "os";
import { execSync } from "child_process";

const APP_NAME = "9router";
const APP_LABEL = "com.9router.autostart";

function getCliJsPath(cliPath) {
  if (cliPath) {
    const resolved = path.resolve(cliPath);
    if (fs.existsSync(resolved)) return resolved;
  }
  if (process.argv[1]) {
    const resolved = path.resolve(process.argv[1]);
    if (path.basename(resolved) === "cli.js" && fs.existsSync(resolved)) {
      return resolved;
    }
  }

  // Common global or local candidates
  const candidates = [
    path.join(process.cwd(), "cli", "cli.js"),
    path.join(process.cwd(), "cli.js"),
    path.join(os.homedir(), ".bun", "install", "global", "node_modules", "9router", "cli.js"),
    path.join(process.env.APPDATA || "", "npm", "node_modules", "9router", "cli.js"),
    "/usr/local/lib/node_modules/9router/cli.js",
    "/usr/lib/node_modules/9router/cli.js"
  ];

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }

  return null;
}

export function isAutoStartEnabled() {
  const platform = process.platform;
  try {
    if (platform === "darwin") {
      const plistPath = path.join(os.homedir(), "Library", "LaunchAgents", `${APP_LABEL}.plist`);
      return fs.existsSync(plistPath);
    } else if (platform === "win32") {
      const startupPath = path.join(
        process.env.APPDATA || "",
        "Microsoft",
        "Windows",
        "Start Menu",
        "Programs",
        "Startup",
        `${APP_NAME}.vbs`
      );
      return fs.existsSync(startupPath);
    } else if (platform === "linux") {
      const desktopPath = path.join(os.homedir(), ".config", "autostart", `${APP_NAME}.desktop`);
      return fs.existsSync(desktopPath);
    }
  } catch {
    return false;
  }
  return false;
}

export function enableAutoStart(cliPath) {
  const platform = process.platform;
  if (!["darwin", "win32", "linux"].includes(platform)) return false;
  try {
    if (platform === "darwin") return enableMacOS(cliPath);
    if (platform === "win32") return enableWindows(cliPath);
    if (platform === "linux") return enableLinux(cliPath);
  } catch {
    return false;
  }
  return false;
}

export function disableAutoStart() {
  const platform = process.platform;
  try {
    if (platform === "darwin") return disableMacOS();
    if (platform === "win32") return disableWindows();
    if (platform === "linux") return disableLinux();
  } catch {
    return false;
  }
  return false;
}

function enableMacOS(cliPath) {
  const launchAgentsDir = path.join(os.homedir(), "Library", "LaunchAgents");
  const plistPath = path.join(launchAgentsDir, `${APP_LABEL}.plist`);
  if (!fs.existsSync(launchAgentsDir)) fs.mkdirSync(launchAgentsDir, { recursive: true });

  const nodePath = process.execPath;
  const routerScript = getCliJsPath(cliPath);
  if (!routerScript) return false;

  const launchPath = `${path.dirname(nodePath)}:/usr/local/bin:/usr/bin:/bin`;
  const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${APP_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${nodePath}</string>
        <string>${routerScript}</string>
        <string>--tray</string>
        <string>--skip-update</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>${launchPath}</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <false/>
    <key>StandardOutPath</key>
    <string>/tmp/9router.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/9router.error.log</string>
</dict>
</plist>`;
  fs.writeFileSync(plistPath, plistContent);
  try { execSync(`launchctl unload "${plistPath}"`, { stdio: "ignore" }); } catch {}
  try { execSync(`launchctl load -w "${plistPath}"`, { stdio: "ignore" }); } catch {}
  return true;
}

function disableMacOS() {
  const plistPath = path.join(os.homedir(), "Library", "LaunchAgents", `${APP_LABEL}.plist`);
  try { execSync(`launchctl unload "${plistPath}"`, { stdio: "ignore" }); } catch {}
  if (fs.existsSync(plistPath)) fs.unlinkSync(plistPath);
  return true;
}

function enableWindows(cliPath) {
  const startupDir = path.join(
    process.env.APPDATA || "",
    "Microsoft",
    "Windows",
    "Start Menu",
    "Programs",
    "Startup"
  );
  const vbsPath = path.join(startupDir, `${APP_NAME}.vbs`);
  if (!fs.existsSync(startupDir)) return false;

  const nodePath = process.execPath;
  const routerScript = getCliJsPath(cliPath);
  if (!routerScript) return false;

  const vbsContent = `Set WshShell = CreateObject("WScript.Shell")
WshShell.Run """${nodePath}"" ""${routerScript}"" --tray --skip-update", 0, False
`;
  fs.writeFileSync(vbsPath, vbsContent);
  return true;
}

function disableWindows() {
  const vbsPath = path.join(
    process.env.APPDATA || "",
    "Microsoft",
    "Windows",
    "Start Menu",
    "Programs",
    "Startup",
    `${APP_NAME}.vbs`
  );
  if (fs.existsSync(vbsPath)) fs.unlinkSync(vbsPath);
  return true;
}

function enableLinux(cliPath) {
  const autostartDir = path.join(os.homedir(), ".config", "autostart");
  const desktopPath = path.join(autostartDir, `${APP_NAME}.desktop`);
  if (!fs.existsSync(autostartDir)) {
    try { fs.mkdirSync(autostartDir, { recursive: true }); } catch { return false; }
  }
  const nodePath = process.execPath;
  const routerScript = getCliJsPath(cliPath);
  if (!routerScript) return false;

  const desktopContent = `[Desktop Entry]
Type=Application
Name=9Router
Comment=9Router API Proxy
Exec=${nodePath} ${routerScript} --tray --skip-update
Hidden=false
NoDisplay=false
X-GNOME-Autostart-enabled=true
`;
  fs.writeFileSync(desktopPath, desktopContent);
  return true;
}

function disableLinux() {
  const desktopPath = path.join(os.homedir(), ".config", "autostart", `${APP_NAME}.desktop`);
  if (fs.existsSync(desktopPath)) fs.unlinkSync(desktopPath);
  return true;
}
