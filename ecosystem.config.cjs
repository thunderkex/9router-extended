const path = require("path");
const fs = require("fs");
const os = require("os");

/**
 * Dynamically resolves the best entry point for 9Router:
 * 1. Local workspace `cli/cli.js` (if running from git repo)
 * 2. Local `cli.js` (if running inside packaged dir)
 * 3. Bun global installation in user's home directory
 * 4. Fallback to global CLI binary on PATH
 */
function resolveScriptPath() {
  const candidates = [
    path.join(__dirname, "cli", "cli.js"),
    path.join(__dirname, "cli.js"),
    path.join(os.homedir(), ".bun", "install", "global", "node_modules", "9router", "cli.js"),
    path.join(process.env.APPDATA || "", "npm", "node_modules", "9router", "cli.js"),
  ];

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return "9router";
}

module.exports = {
  apps: [
    {
      name: "9router",
      script: resolveScriptPath(),
      args: "--log --skip-update",
      env: {
        NODE_ENV: "production",
        PORT: process.env.PORT || "20128",
        HOST: process.env.HOST || "0.0.0.0",
      },
      autorestart: true,
      restart_delay: 2000,
      max_memory_restart: "1G",
      kill_timeout: 3000,
      watch: false,
    },
  ],
};
