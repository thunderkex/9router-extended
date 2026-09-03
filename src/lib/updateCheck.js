import https from "https";
import http from "http";
import crypto from "crypto";
import fs from "fs";
import path from "path";

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

  // Strip leading 'v' and suffix metadata (e.g. v1.2.3-extended -> 1.2.3)
  const cleanA = String(a).trim().replace(/^v/i, "").split("-")[0];
  const cleanB = String(b).trim().replace(/^v/i, "").split("-")[0];

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

/**
 * Build update result checking both version and MD5.
 */
export function buildResult(currentVersion, latestVersion, currentMd5 = null, latestMd5 = null) {
  if (!currentVersion && !currentMd5) {
    return {
      currentVersion: currentVersion || null,
      latestVersion: latestVersion || null,
      currentMd5: currentMd5 || null,
      latestMd5: latestMd5 || null,
      hasUpdate: false,
      isRebuild: false,
    };
  }

  const semverDiff = (latestVersion && currentVersion) ? compareVersions(latestVersion, currentVersion) : 0;
  const isHigherVersion = semverDiff > 0;

  const normCurrentMd5 = currentMd5 ? String(currentMd5).toLowerCase().trim() : null;
  const normLatestMd5 = latestMd5 ? String(latestMd5).toLowerCase().trim() : null;
  const hasMd5 = Boolean(normCurrentMd5 && normLatestMd5);
  const isMd5Different = hasMd5 && normCurrentMd5 !== normLatestMd5;

  // If higher version -> standard version upgrade
  // If same version (or no version change) but MD5 differs -> rebuild update
  const isRebuild = isMd5Different && semverDiff === 0;
  const hasUpdate = isHigherVersion || (isMd5Different && semverDiff >= 0);

  return {
    currentVersion: currentVersion || null,
    latestVersion: latestVersion || null,
    currentMd5: normCurrentMd5,
    latestMd5: normLatestMd5,
    hasUpdate,
    isRebuild,
  };
}

/**
 * Check if an update is available with in-memory caching.
 * @param {string} key - plugin id, e.g. "9router-extended", "headroom", "pxpipe"
 * @param {string} currentVersion - installed version string
 * @param {() => Promise<string|object|null>} fetchLatest - resolver function returning version or { version, md5 }
 * @param {number} ttlMs - cache time to live (default 1h)
 * @param {string|null} currentMd5 - local build MD5 hash
 */
export async function checkForUpdate(key, currentVersion, fetchLatest, ttlMs = 3600000, currentMd5 = null) {
  const cached = cache.get(key);
  if (cached && Date.now() - cached.fetchedAt < ttlMs) {
    const val = cached.value;
    const latestVersion = typeof val === "object" && val !== null ? val.version : val;
    const latestMd5 = typeof val === "object" && val !== null ? val.md5 : null;
    return buildResult(currentVersion, latestVersion, currentMd5, latestMd5);
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

  const val = latest ?? cached?.value ?? null;
  const latestVersion = typeof val === "object" && val !== null ? val.version : val;
  const latestMd5 = typeof val === "object" && val !== null ? val.md5 : null;

  return buildResult(currentVersion, latestVersion, currentMd5, latestMd5);
}

/**
 * Generic HTTP/HTTPS fetch helper with redirect following and timeout.
 */
export function fetchUrl(url, options = {}, redirectCount = 0) {
  return new Promise((resolve) => {
    if (redirectCount > 5) {
      return resolve({ ok: false, status: 0, headers: {}, data: "" });
    }

    try {
      const parsedUrl = new URL(url);
      const isHttps = parsedUrl.protocol === "https:";
      const client = isHttps ? https : http;

      const reqOptions = {
        method: options.method || "GET",
        headers: {
          "User-Agent": "9router-update-checker",
          Accept: options.accept || "application/json, text/plain, */*",
          ...(options.headers || {}),
        },
        timeout: options.timeout || 6000,
      };

      const req = client.request(parsedUrl, reqOptions, (res) => {
        // Handle HTTP redirects (301, 302, 307, 308)
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const redirectUrl = new URL(res.headers.location, url).toString();
          res.resume();
          return resolve(fetchUrl(redirectUrl, options, redirectCount + 1));
        }

        let raw = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          raw += chunk;
          if (raw.length > 500000) req.destroy();
        });

        res.on("end", () => {
          const ok = res.statusCode >= 200 && res.statusCode < 300;
          resolve({
            ok,
            status: res.statusCode,
            headers: res.headers,
            data: raw,
          });
        });
      });

      req.on("error", () => resolve({ ok: false, status: 0, headers: {}, data: "" }));
      req.on("timeout", () => {
        req.destroy();
        resolve({ ok: false, status: 0, headers: {}, data: "" });
      });

      req.end();
    } catch {
      resolve({ ok: false, status: 0, headers: {}, data: "" });
    }
  });
}

/**
 * Generic HTTPS JSON GET helper
 */
export async function fetchJson(url, options = {}) {
  const res = await fetchUrl(url, { ...options, accept: "application/json" });
  if (!res.ok) return null;
  try {
    return JSON.parse(res.data);
  } catch {
    return null;
  }
}

/**
 * Generic HTTPS Text GET helper
 */
export async function fetchText(url, options = {}) {
  const res = await fetchUrl(url, { ...options, accept: "text/plain" });
  if (!res.ok) return null;
  return res.data?.trim() || null;
}

// ─── Local Build Info & MD5 Resolution ─────────────────────────────────────────

let cachedLocalMd5 = null;

export function getLocalAppMd5() {
  if (cachedLocalMd5) return cachedLocalMd5;

  if (process.env.APP_BUILD_MD5 || process.env.NINEROUTER_MD5) {
    cachedLocalMd5 = (process.env.APP_BUILD_MD5 || process.env.NINEROUTER_MD5).trim();
    return cachedLocalMd5;
  }

  const candidatePaths = [
    path.join(process.cwd(), "build-info.json"),
    path.join(process.cwd(), "src", "shared", "constants", "build-info.json"),
    path.join(process.cwd(), ".next-cli-build", "build-info.json"),
    path.join(process.cwd(), "cli", "app", "build-info.json"),
  ];

  for (const p of candidatePaths) {
    try {
      if (fs.existsSync(p)) {
        const content = JSON.parse(fs.readFileSync(p, "utf8"));
        const hash = content.md5 || content.buildMd5;
        if (hash && typeof hash === "string") {
          cachedLocalMd5 = hash.trim().toLowerCase();
          return cachedLocalMd5;
        }
      }
    } catch { /* continue */ }
  }

  // Fallback: generate deterministic hash from runtime build files or package.json
  try {
    const buildIdCandidates = [
      path.join(process.cwd(), ".next-cli-build", "BUILD_ID"),
      path.join(process.cwd(), ".next", "BUILD_ID"),
      path.join(process.cwd(), "custom-server.js"),
      path.join(process.cwd(), "package.json"),
    ];

    for (const bp of buildIdCandidates) {
      if (fs.existsSync(bp)) {
        const fileData = fs.readFileSync(bp);
        cachedLocalMd5 = crypto.createHash("md5").update(fileData).digest("hex");
        return cachedLocalMd5;
      }
    }
  } catch { /* ignore */ }

  return null;
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
    const rawPkg = await fetchJson(`https://raw.githubusercontent.com/${repo}/extended/package.json`);
    if (rawPkg?.version) {
      return rawPkg.version;
    }
  }
  return tag ? tag.replace(/^v/i, "") : null;
}

/**
 * Resolver for 9Router Extended checking version and MD5 build checksum.
 */
export async function fetchGitHubExtendedLatest(repo = "thunderkex/9router-extended") {
  let latestVersion = null;
  let latestMd5 = null;

  // 1. Try to fetch direct release .tgz.md5 asset
  const directMd5 = await fetchText(`https://github.com/${repo}/releases/latest/download/9router-extended.tgz.md5`);
  if (directMd5) {
    const match = directMd5.match(/[a-f0-9]{32}/i);
    if (match) latestMd5 = match[0].toLowerCase();
  }

  // 2. Fetch latest GitHub release metadata
  const releaseData = await fetchJson(`https://api.github.com/repos/${repo}/releases/latest`);
  if (releaseData) {
    if (releaseData.tag_name) {
      latestVersion = releaseData.tag_name.replace(/^v/i, "");
    }

    // Inspect release assets for md5 files if not already found
    if (!latestMd5 && Array.isArray(releaseData.assets)) {
      const md5Asset = releaseData.assets.find(a =>
        a.name === "9router-extended.tgz.md5" ||
        a.name === "9router-latest.tgz.md5" ||
        a.name.endsWith(".md5")
      );
      if (md5Asset?.browser_download_url) {
        const assetMd5 = await fetchText(md5Asset.browser_download_url);
        if (assetMd5) {
          const match = assetMd5.match(/[a-f0-9]{32}/i);
          if (match) latestMd5 = match[0].toLowerCase();
        }
      }
    }
  }

  // 3. Check raw build-info.json from repository branch
  if (!latestMd5) {
    const rawBuildInfo = await fetchJson(`https://raw.githubusercontent.com/${repo}/extended/build-info.json`)
      || await fetchJson(`https://raw.githubusercontent.com/${repo}/master/build-info.json`);
    if (rawBuildInfo) {
      if (rawBuildInfo.version && !latestVersion) latestVersion = rawBuildInfo.version;
      if (rawBuildInfo.md5) latestMd5 = String(rawBuildInfo.md5).trim().toLowerCase();
    }
  }

  // 4. Fallback: HEAD request on tarball to extract S3 ETag (S3 standard upload ETag is the MD5)
  if (!latestMd5) {
    const headRes = await fetchUrl(`https://github.com/${repo}/releases/latest/download/9router-extended.tgz`, { method: "HEAD" });
    const etag = headRes?.headers?.etag;
    if (etag) {
      const cleanEtag = etag.replace(/^W\//i, "").replace(/["']/g, "").trim();
      const match = cleanEtag.match(/^[a-f0-9]{32}$/i);
      if (match) latestMd5 = match[0].toLowerCase();
    }
  }

  // 5. Fallback for version from raw package.json
  if (!latestVersion) {
    const rawPkg = await fetchJson(`https://raw.githubusercontent.com/${repo}/extended/package.json`)
      || await fetchJson(`https://raw.githubusercontent.com/${repo}/master/package.json`);
    if (rawPkg?.version) {
      latestVersion = rawPkg.version;
    }
  }

  if (!latestVersion && !latestMd5) {
    return null;
  }

  return {
    version: latestVersion,
    md5: latestMd5,
  };
}
