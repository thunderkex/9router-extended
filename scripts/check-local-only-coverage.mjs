import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

function walk(dir) {
  let files = [];
  try {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, item.name);
      if (item.isDirectory()) files.push(...walk(full));
      else if (item.name === "route.js") files.push(full);
    }
  } catch (e) {
    console.error(`Failed to read dir: ${dir}`, e);
  }
  return files;
}

const apiDir = path.join(repoRoot, "src", "app", "api");
const routes = walk(apiDir);
const spawnPatterns = [
  /child_process/,
  /installHermes/,
  /installHeadroomExtras/,
  /installPxpipe/,
  /startHermesService/,
  /startHeadroomProxy/,
  /exec\(/,
  /spawn\(/,
  /execSync\(/,
  /execAsync\(/,
  /stopHermesService/,
  /stopHeadroomProxy/,
  /restartHermesService/,
  /updateHermes/,
  /updateHeadroom/,
  /updatePxpipe/,
  /updateCloudflared/,
];

const guardPath = path.join(repoRoot, "src", "dashboardGuard.js");
const guardContent = fs.readFileSync(guardPath, "utf8");
const localOnlyMatch = guardContent.match(/const LOCAL_ONLY_PATHS = \[([\s\S]*?)\];/);
const localPaths = localOnlyMatch
  ? (localOnlyMatch[1].match(/"([^"]+)"/g) || []).map((s) => s.replace(/"/g, ""))
  : [];

console.log("Registered LOCAL_ONLY_PATHS in dashboardGuard.js:", localPaths);

const findings = [];
const appDir = path.join(repoRoot, "src", "app");
for (const r of routes) {
  const code = fs.readFileSync(r, "utf8");
  if (code.includes("local-only-exempt")) continue;
  const rel = "/" + path.relative(appDir, path.dirname(r)).replace(/\\/g, "/");
  for (const p of spawnPatterns) {
    if (p.test(code)) {
      findings.push({ route: rel, file: r, pattern: p.toString() });
      break;
    }
  }
}

console.log("\nSpawn-capable routes found:");
let hasUncovered = false;
for (const f of findings) {
  const covered = localPaths.some((lp) => f.route === lp || f.route.startsWith(lp));
  console.log((covered ? "✅" : "❌") + " " + f.route + " (" + f.pattern + ")");
  if (!covered) hasUncovered = true;
}

if (hasUncovered) {
  console.error("\n❌ Found uncovered spawn-capable routes!");
  process.exit(1);
} else {
  console.log("\n✅ All spawn-capable routes covered in LOCAL_ONLY_PATHS.");
}
