import { checkForUpdate, fetchGitHubReleaseLatest } from "@/lib/updateCheck.js";
import { BIN_PATH } from "@/lib/tunnel/cloudflare/cloudflared.js";
import { execSync } from "child_process";
import fs from "fs";

export function getCloudflaredInstalledVersion() {
  try {
    if (!fs.existsSync(BIN_PATH)) return null;
    const out = execSync(`"${BIN_PATH}" --version`, {
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    }).toString().trim();
    // e.g. "cloudflared version 2024.6.1 (built 2024-06-07-...)"
    const match = out.match(/version\s+([0-9.]+)/i);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

export async function checkCloudflaredUpdate() {
  const current = getCloudflaredInstalledVersion();
  return checkForUpdate(
    "cloudflared",
    current,
    () => fetchGitHubReleaseLatest("cloudflare/cloudflared")
  );
}
