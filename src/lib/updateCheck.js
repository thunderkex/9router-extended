import https from "https";

// Cache in-memory generic, keyed per plugin
const cache = (global.__pluginUpdateCache ??= new Map());

export function clearPluginUpdateCache(key = null) {
  if (key) {
    cache.delete(key);
  } else {
    cache.clear();
  }
}

/**
 * Compare two semver-like version strings.
 * Returns 1 if a > b, -1 if a < b, 0 if equal.
 */
export function compareVersions(a, b) {
  if (!a && !b) return 0;
  if (!a) return -1;
  if (!b) return 1;

  // Strip leading 'v' if present (e.g., v1.2.3 -> 1.2.3)
  const cleanA = String(a).trim().replace(/^v/i, "");
  const cleanB = String(b).trim().replace(/^v/i, "");

  const pa = cleanA.split(".").map((part) => {
    const num = parseInt(part, 10);
    return Number.isNaN(num) ? 0 : num;
  });
  const pb = cleanB.split(".").map((part) => {
    const num = parseInt(part, 10);
    return Number.isNaN(num) ? 0 : num;
  });

  const maxLen = Math.max(pa.length, pb.length, 3);
  for (let i = 0; i < maxLen; i++) {
    const numA = pa[i] || 0;
    const numB = pb[i] || 0;
    if (numA > numB) return 1;
    if (numA < numB) return -1;
  }
  return 0;
}

export function buildResult(currentVersion, latestVersion) {
  if (!currentVersion || !latestVersion) {
    return { currentVersion: currentVersion || null, latestVersion: latestVersion || null, hasUpdate: false };
  }
  return {
    currentVersion,
    latestVersion,
    hasUpdate: compareVersions(latestVersion, currentVersion) > 0,
  };
}

/**
 * Check if an update is available with in-memory caching.
 * @param {string} key - plugin id, e.g. "9router", "headroom", "pxpipe", "cloudflared", "tailscale", "graphify", "mcp-inspector"
 * @param {string} currentVersion - installed version string
 * @param {() => Promise<string|null>} fetchLatest - resolver function
 * @param {number} ttlMs - cache time to live (default 1h)
 */
export async function checkForUpdate(key, currentVersion, fetchLatest, ttlMs = 3600000) {
  const cached = cache.get(key);
  if (cached && Date.now() - cached.fetchedAt < ttlMs) {
    return buildResult(currentVersion, cached.value);
  }

  let latest = null;
  try {
    latest = await fetchLatest();
  } catch {
    latest = null;
  }

  if (latest) {
    cache.set(key, { value: latest, fetchedAt: Date.now() });
  }

  return buildResult(currentVersion, latest ?? cached?.value ?? null);
}

/**
 * Generic HTTPS JSON GET helper
 */
export function fetchJson(url, options = {}) {
  return new Promise((resolve) => {
    try {
      const parsedUrl = new URL(url);
      const req = https.get(
        parsedUrl,
        {
          headers: {
            "User-Agent": "9router-update-checker",
            Accept: "application/json",
            ...(options.headers || {}),
          },
          timeout: options.timeout || 5000,
        },
        (res) => {
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => {
            try {
              if (res.statusCode >= 200 && res.statusCode < 300) {
                resolve(JSON.parse(data));
              } else {
                resolve(null);
              }
            } catch {
              resolve(null);
            }
          });
        }
      );
      req.on("error", () => resolve(null));
      req.on("timeout", () => {
        req.destroy();
        resolve(null);
      });
    } catch {
      resolve(null);
    }
  });
}

// ─── Preset Resolvers per Plugin/Skill ────────────────────────────────────────

export async function fetchNpmLatest(packageName) {
  const encoded = encodeURIComponent(packageName).replace(/^%40/, "@");
  const data = await fetchJson(`https://registry.npmjs.org/${encoded}/latest`);
  return data?.version || null;
}

export async function fetchPyPiLatest(packageName) {
  const data = await fetchJson(`https://pypi.org/pypi/${encodeURIComponent(packageName)}/json`);
  return data?.info?.version || null;
}

export async function fetchGitHubReleaseLatest(repo) {
  const data = await fetchJson(`https://api.github.com/repos/${repo}/releases/latest`);
  let tag = data?.tag_name || null;
  if (!tag) {
    const tags = await fetchJson(`https://api.github.com/repos/${repo}/tags`);
    if (Array.isArray(tags) && tags.length > 0) {
      tag = tags[0]?.name || null;
    }
  }
  if (!tag) {
    // Fallback: check package.json from raw repo branch
    const rawPkg = await fetchJson(`https://raw.githubusercontent.com/${repo}/extended/package.json`);
    if (rawPkg?.version) {
      return rawPkg.version;
    }
  }
  return tag ? tag.replace(/^v/i, "") : null;
}

export async function fetchGitHubExtendedLatest(repo = "thunderkex/9router-extended") {
  // 1. Check raw package.json from extended branch if repo is 9router or 9router-extended
  const rawPkg = await fetchJson(`https://raw.githubusercontent.com/${repo}/extended/package.json`);
  if (rawPkg?.version) {
    return rawPkg.version;
  }
  const rawPkgMain = await fetchJson(`https://raw.githubusercontent.com/${repo}/master/package.json`);
  if (rawPkgMain?.version) {
    return rawPkgMain.version;
  }
  // 2. Check releases
  return fetchGitHubReleaseLatest(repo);
}
