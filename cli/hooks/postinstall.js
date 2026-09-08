#!/usr/bin/env node

// Postinstall: warm-up SQLite deps into ~/.9router/runtime so the first
// `9router` start doesn't need network. Failure here is non-fatal —
// cli.js will retry at runtime if anything is missing.
const path = require("path");
const fs = require("fs");
const { ensureSqliteRuntime } = require("./sqliteRuntime");
const { ensureTrayRuntime } = require("./trayRuntime");

try {
  ensureSqliteRuntime({ silent: false });
  console.log("[9router] runtime SQLite deps ready");
} catch (e) {
  console.warn(`[9router] runtime warm-up skipped: ${e.message}`);
}

try {
  ensureTrayRuntime({ silent: false });
} catch (e) {
  console.warn(`[9router] tray runtime skipped: ${e.message}`);
}

// Stamp install time into build-info.json so update checker can compare
// against remote asset upload time to detect same-version rebuilds.
try {
  const buildInfoPath = path.join(__dirname, "..", "app", "build-info.json");
  if (fs.existsSync(buildInfoPath)) {
    const info = JSON.parse(fs.readFileSync(buildInfoPath, "utf8"));
    // Only update installTime, preserve existing md5/version/buildTime
    info.installTime = new Date().toISOString();
    fs.writeFileSync(buildInfoPath, JSON.stringify(info, null, 2) + "\n");
  }
} catch { /* non-fatal */ }

process.exit(0);
