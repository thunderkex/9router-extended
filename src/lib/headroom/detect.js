import { execFileSync, execSync } from "child_process";
import fs from "fs";
import path from "path";
import net from "net";

// Extras that improve headroom compression quality. `proxy` is the base;
// `code` adds tree-sitter AST compression; `ml` adds Kompress-v2 HF model.
// Other `[all]` extras (image, voice, otel, reports, evals, ...) are not
// useful for the 9router proxy use case, so we don't track them here.
export const HEADROOM_COMPRESSION_EXTRAS = ["code", "ml"];

// Marker packages that each extra pulls in. Detected from `pip list --format=json`
// so one call can answer both the installed version and active extras.
export const EXTRA_MARKERS = {
  code: ["tree-sitter", "tree-sitter-language-pack"],
  ml: ["torch", "huggingface-hub"],
};

const HEADROOM_PIP_TIMEOUT_MS = 8000;

const IS_WIN = process.platform === "win32";
const WHICH_CMD = IS_WIN ? "where" : "which";

// Extra bin dirs often missing from a packaged/launchd PATH (Python installs headroom here).
const EXTRA_BINS = IS_WIN
  ? [
      ...(process.env.LOCALAPPDATA
        ? [process.env.LOCALAPPDATA, path.join(process.env.LOCALAPPDATA, "Python")]
            .flatMap((root) => {
              try {
                return fs.readdirSync(root, { withFileTypes: true })
                  .filter((entry) => entry.isDirectory() && entry.name.toLowerCase().startsWith("python"))
                  .map((entry) => path.join(root, entry.name, "Scripts"));
              } catch {
                return [];
              }
            })
        : []),
      `${process.env.LOCALAPPDATA || ""}\\Programs\\Python\\Python313\\Scripts`,
      `${process.env.LOCALAPPDATA || ""}\\Programs\\Python\\Python312\\Scripts`,
      `${process.env.LOCALAPPDATA || ""}\\Programs\\Python\\Python311\\Scripts`,
      `${process.env.LOCALAPPDATA || ""}\\Programs\\Python\\Python310\\Scripts`,
      `${process.env.APPDATA || ""}\\Python\\Python313\\Scripts`,
    ]
  : [
      "/usr/local/bin",
      "/opt/homebrew/bin",
      "/Library/Frameworks/Python.framework/Versions/3.13/bin",
      "/Library/Frameworks/Python.framework/Versions/3.12/bin",
      "/Library/Frameworks/Python.framework/Versions/3.11/bin",
      "/Library/Frameworks/Python.framework/Versions/3.10/bin",
      `${process.env.HOME || ""}/.local/bin`,
      "/usr/bin",
      "/bin",
    ];

const EXTENDED_PATH = [...EXTRA_BINS, process.env.PATH || ""].filter(Boolean).join(path.delimiter);
const PYTHON_CANDIDATES = ["python3.13", "python3.12", "python3.11", "python3.10", "python3", "python"];
const MIN_VERSION = [3, 10];
const HEADROOM_HEALTH_TIMEOUT_MS = 1500;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"]);

export const DEFAULT_HEADROOM_URL = process.env.HEADROOM_URL || "http://localhost:8787";

const DETECT_CACHE_TTL_MS = 60000;
let cachedHeadroomBinary = undefined;
let lastHeadroomBinaryCheck = 0;

export function clearHeadroomBinaryCache() {
  cachedHeadroomBinary = undefined;
  lastHeadroomBinaryCheck = 0;
}

// Detect whether the headroom CLI is installed and where its binary lives.
export function findHeadroomBinary(force = false) {
  const now = Date.now();
  if (!force && cachedHeadroomBinary !== undefined && (now - lastHeadroomBinaryCheck < DETECT_CACHE_TTL_MS)) {
    return cachedHeadroomBinary;
  }

  let resolved = null;
  try {
    const out = execSync(`${WHICH_CMD} headroom`, {
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
      env: { ...process.env, PATH: EXTENDED_PATH },
    }).toString().trim();
    // Windows `where` may return multiple lines — take the first.
    resolved = out ? out.split(/\r?\n/)[0].trim() : null;
  } catch {
    resolved = null;
  }

  cachedHeadroomBinary = resolved;
  lastHeadroomBinaryCheck = now;
  return resolved;
}

// Find a Python interpreter >= 3.10 (headroom-ai requires it). Returns null if none.
// `python3`, `python3.13`, `python` can point at different envs on any OS. Prefer
// the interpreter that can also see the installed `headroom-ai` package so the
// dashboard probes and install action operate on the same interpreter as the CLI.
// Falls back to the first version-eligible candidate when headroom-ai is not yet
// installed anywhere (needed for the initial install).
// Interpreters to probe, most specific first: the python next to the headroom
// binary (guaranteed to have headroom-ai), then full paths from EXTRA_BINS, then
// bare names resolved via PATH.
function pythonCandidates() {
  const list = [];
  const bin = findHeadroomBinary();
  if (bin) {
    const dir = path.dirname(bin);
    const names = IS_WIN ? ["python.exe", "python3.exe"] : ["python3", "python3.13", "python"];
    for (const n of names) list.push(path.join(dir, n));
  }
  for (const dir of EXTRA_BINS) {
    if (!dir) continue;
    for (const n of PYTHON_CANDIDATES) list.push(path.join(dir, IS_WIN ? `${n}.exe` : n));
  }
  list.push(...PYTHON_CANDIDATES);
  return list;
}

export function findPython310() {
  let fallback = null;
  for (const candidate of pythonCandidates()) {
    try {
      const ver = execSync(`${candidate} --version`, {
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true,
        env: { ...process.env, PATH: EXTENDED_PATH },
      }).toString().trim();
      const match = ver.match(/(\d+)\.(\d+)/);
      if (!match) continue;
      const [major, minor] = [parseInt(match[1], 10), parseInt(match[2], 10)];
      if (!(major > MIN_VERSION[0] || (major === MIN_VERSION[0] && minor >= MIN_VERSION[1]))) continue;
      if (!fallback) fallback = candidate;
      try {
        execFileSync(candidate, ["-m", "pip", "show", "headroom-ai"], {
          stdio: ["ignore", "pipe", "ignore"],
          windowsHide: true,
          timeout: HEADROOM_PIP_TIMEOUT_MS,
          env: { ...process.env, PATH: EXTENDED_PATH },
        });
        return candidate;
      } catch {
        // Keep scanning until an interpreter that sees headroom-ai is found.
      }
    } catch {
      // candidate not present, try next
    }
  }
  return fallback;
}

// Probe whether a Headroom proxy is reachable at the given URL by hitting /health.
export async function probeProxyRunning(url) {
  if (!url) return false;
  const base = String(url).replace(/\/$/, "");
  try {
    const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(HEADROOM_HEALTH_TIMEOUT_MS) });
    return res.ok;
  } catch {
    return false;
  }
}

/** Check if a TCP port is available to bind on localhost. */
export async function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.on("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => {
      server.close(() => resolve(true));
    });
  });
}

/** Find the first available port starting from startPort. */
export async function findAvailablePort(startPort = 8787, maxTries = 20) {
  for (let port = startPort; port < startPort + maxTries; port++) {
    if (await isPortAvailable(port)) return port;
  }
  return startPort;
}

/** Scan common ports to see if a Headroom instance is already running. */
export async function autoDetectHeadroomPort(preferredUrl = null) {
  const candidatePorts = [8787, 8788, 8789, 8790, 8791];
  
  if (preferredUrl) {
    try {
      const u = new URL(preferredUrl);
      const p = parseInt(u.port, 10);
      if (p && !candidatePorts.includes(p)) candidatePorts.unshift(p);
    } catch {}
  }

  for (const port of candidatePorts) {
    const testUrl = `http://localhost:${port}`;
    if (await probeProxyRunning(testUrl)) {
      return { found: true, port, url: testUrl };
    }
  }
  return { found: false, port: null, url: "http://localhost:8787" };
}

export function isLoopbackHeadroomUrl(url) {
  try {
    const parsed = new URL(url);
    return LOOPBACK_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

// Aggregate status for the dashboard: installed, running, python interpreter.
export async function getHeadroomStatus(url) {
  const path = findHeadroomBinary();
  const python = findPython310();
  const installed = Boolean(path);
  let running = await probeProxyRunning(url);
  let detectedPort = null;
  let activeUrl = url;

  // If not running on configured URL, auto-probe other standard ports
  if (!running && (!url || isLoopbackHeadroomUrl(url))) {
    const detected = await autoDetectHeadroomPort(url);
    if (detected.found) {
      running = true;
      activeUrl = detected.url;
      detectedPort = detected.port;
    }
  }

  const localUrl = isLoopbackHeadroomUrl(activeUrl);
  const extrasStatus = installed ? getInstalledHeadroomExtras(python) : { installed: false, version: null, extras: { code: false, ml: false } };
  return {
    installed,
    path,
    running,
    python,
    localUrl,
    activeUrl,
    detectedPort,
    canStart: installed && localUrl,
    version: extrasStatus.version,
    extras: extrasStatus.extras,
  };
}

// Parse installed headroom-ai version + which compression extras are
// actually installed (detected via marker package presence). One `pip list`
// call is enough to answer both questions.
//
// Returns: { installed: bool, version: string|null, extras: { code, ml } }
export function getInstalledHeadroomExtras(python) {
  const py = python || findPython310();
  if (!py) return { installed: false, version: null, extras: { code: false, ml: false } };
  try {
    const out = execFileSync(py, ["-m", "pip", "list", "--format=json", "--disable-pip-version-check"], {
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
      timeout: HEADROOM_PIP_TIMEOUT_MS,
      env: { ...process.env, PATH: EXTENDED_PATH },
    }).toString();
    const packages = JSON.parse(out);
    const names = new Set(packages.map((p) => String(p.name || "").toLowerCase()));
    const installed = names.has("headroom-ai");
    if (!installed) return { installed: false, version: null, extras: { code: false, ml: false } };
    const version = packages.find((p) => p.name?.toLowerCase() === "headroom-ai")?.version || null;
    const extras = {};
    for (const extra of HEADROOM_COMPRESSION_EXTRAS) {
      extras[extra] = EXTRA_MARKERS[extra].some((m) => names.has(m));
    }
    return { installed: true, version, extras };
  } catch {
    return { installed: false, version: null, extras: { code: false, ml: false } };
  }
}
