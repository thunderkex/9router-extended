import os from "os";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { existsSync } from "fs";
import { cleanupProviderConnections, getSettings, updateSettings, getApiKeys } from "@/lib/localDb";
import {
  enableTunnel, enableTailscale,
  isTunnelManuallyDisabled, isTunnelReconnecting, isTailscaleReconnecting,
  getTunnelService, getTailscaleService, setTunnelUnexpectedExitCallback,
  killCloudflared, isCloudflaredRunning, ensureCloudflared,
  isTailscaleRunning, isTailscaleRunningStrict, isDaemonAlive, startFunnel,
  checkInternet,
  RESTART_COOLDOWN_MS, NETWORK_SETTLE_MS,
  WATCHDOG_INTERVAL_MS, NETWORK_CHECK_INTERVAL_MS, VIRTUAL_IFACE_REGEX,
} from "@/lib/tunnel";
import { getMitmStatus, startMitm, loadEncryptedPassword, initDbHooks, restoreToolDNS, removeAllDNSEntriesSync } from "@/mitm/manager";
import { syncToJson as syncMitmAliasCache } from "@/lib/mitmAliasCache";
import { killAllBridges } from "@/lib/mcp/stdioSseBridge";

// Inject correct paths and DB hooks into manager.js (CJS) from ESM context
(function bootstrapMitm() {
  if (!process.env.MITM_SERVER_PATH) {
    try {
      const thisFile = fileURLToPath(import.meta.url);
      const appSrc = dirname(dirname(thisFile));
      const candidate = join(appSrc, "mitm", "server.js");
      if (existsSync(candidate)) process.env.MITM_SERVER_PATH = candidate;
    } catch { /* ignore */ }
  }
  try { initDbHooks(getSettings, updateSettings); } catch { /* ignore */ }
})();

process.setMaxListeners(20);

// Defer heavy startup work so the first HTTP request (login → dashboard) isn't
// starved by DB cleanup, cloudflared download, lsof/DNS probes and OAuth pings.
const STARTUP_DEFER_MS = 3000;

// Survive Next.js hot reload
const g = global.__appSingleton ??= {
  signalHandlersRegistered: false,
  watchdogInterval: null,
  networkMonitorInterval: null,
  lastNetworkFingerprint: null,
  lastWatchdogTick: Date.now(),
  lastOnline: null,
  mitmStartInProgress: false,
  tunnelAutoResumed: false,
  tailscaleAutoResumed: false,
  headroomAutoResumed: false,
  hermesAutoResumed: false,
  lastAutoUpdateAt: {},
};

export async function initializeApp() {
  try {
    // Register cleanup + exit-respawn callback immediately so signals and
    // unexpected cloudflared exits are handled even during the deferred window.
    if (!g.signalHandlersRegistered) {
      const cleanup = () => {
        try { removeAllDNSEntriesSync(); } catch { /* best effort */ }
        try { killAllBridges(); } catch { /* best effort */ }
        killCloudflared();
        process.exit();
      };
      process.on("SIGINT", cleanup);
      process.on("SIGTERM", cleanup);
      process.on("exit", () => { try { removeAllDNSEntriesSync(); } catch { /* ignore */ } });
      g.signalHandlersRegistered = true;
    }

    setTunnelUnexpectedExitCallback(() => {
      safeRestartTunnel("unexpected-exit").catch(() => {});
    });

    // Defer the heavy work — nothing here blocks incoming requests.
    setTimeout(() => {
      runHeavyStartup().catch((e) => console.error("[InitApp] deferred startup failed:", e.message));
    }, STARTUP_DEFER_MS);
  } catch (error) {
    console.error("[InitApp] Error:", error);
  }
}

async function runHeavyStartup() {
  await cleanupProviderConnections();
  const settings = await getSettings();

  // Auto-resume tunnel (once per process)
  if (settings.tunnelEnabled && !g.tunnelAutoResumed) {
    g.tunnelAutoResumed = true;
    console.log("[InitApp] Tunnel was enabled, auto-resuming...");
    safeRestartTunnel("startup").catch((e) => console.log("[InitApp] Tunnel resume failed:", e.message));
  }

  // Auto-resume tailscale (once per process)
  if (settings.tailscaleEnabled && !g.tailscaleAutoResumed) {
    g.tailscaleAutoResumed = true;
    console.log("[InitApp] Tailscale was enabled, auto-resuming...");
    safeRestartTailscale("startup").catch((e) => console.log("[InitApp] Tailscale resume failed:", e.message));
  }

  if (settings.tunnelEnabled) ensureCloudflared().catch(() => {});

  if (settings.mitmEnabled) {
    // Sync mitmAlias DB → JSON cache so standalone MITM server can read it.
    syncMitmAliasCache().catch(() => {});
    autoStartMitm(settings);
  }

  configureTunnelMonitoring(settings);

  if (hasQuotaAutoPingEnabled(settings)) {
    import("@/shared/services/quotaAutoPing")
      .then(({ startQuotaAutoPing }) => startQuotaAutoPing())
      .catch((e) => console.log("[AutoPing] scheduler start failed:", e.message));
  }

  // Proactive OAuth token refresh (e.g. grok-cli ~6h TTL). Module is idempotent
  // and also started from custom-server.js when that entry is used.
  import("@/sse/services/backgroundTokenRefresh.js")
    .then(({ startBackgroundTokenRefresh }) => startBackgroundTokenRefresh())
    .catch((e) => console.log("[BackgroundTokenRefresh] scheduler start failed:", e.message));

  // Auto-start Headroom proxy if enabled and binary installed
  if (settings.headroomEnabled && settings.headroomAutoStart !== false && !g.headroomAutoResumed) {
    g.headroomAutoResumed = true;
    autoStartHeadroom(settings).catch((e) => console.log("[InitApp] Headroom auto-start failed:", e.message));
  }

  // Auto-start Hermes Agent service if enabled and CLI installed
  if (settings.hermesServiceAutoStart !== false && !g.hermesAutoResumed) {
    g.hermesAutoResumed = true;
    autoStartHermes(settings).catch((e) => console.log("[InitApp] Hermes auto-start failed:", e.message));
  }
}

async function autoStartHeadroom(settings) {
  try {
    const { findHeadroomBinary, isLoopbackHeadroomUrl, DEFAULT_HEADROOM_URL } = await import("@/lib/headroom/detect.js");
    const { getManagedPid, startHeadroomProxy } = await import("@/lib/headroom/process.js");

    const binary = findHeadroomBinary();
    if (!binary) return;

    const url = settings.headroomUrl || DEFAULT_HEADROOM_URL;
    if (!isLoopbackHeadroomUrl(url)) return;

    const existing = getManagedPid();
    if (existing) return;

    let port = 8787;
    try {
      const u = new URL(url);
      const p = parseInt(u.port, 10);
      if (p > 0 && p < 65536) port = p;
    } catch { /* ignore */ }

    console.log("[InitApp] Headroom proxy is enabled, auto-starting...");
    const res = await startHeadroomProxy({
      port,
      codeAware: settings.headroomCodeAware === true,
      kompress: settings.headroomKompress !== false,
    });
    console.log(`[InitApp] Headroom proxy auto-started (PID ${res.pid}, port ${res.port})`);
  } catch (err) {
    console.log("[InitApp] Headroom auto-start error:", err.message);
  }
}

async function autoStartHermes(settings) {
  try {
    const { findHermesBinary } = await import("@/lib/plugins/hermes/detect.js");
    const { getManagedPid, startHermesService } = await import("@/lib/plugins/hermes/process.js");

    const binary = findHermesBinary();
    if (!binary) return;

    const existing = getManagedPid();
    if (existing) return;

    console.log("[InitApp] Hermes Agent CLI detected, auto-starting gateway service...");
    const res = await startHermesService({ args: ["gateway"] });
    console.log(`[InitApp] Hermes Agent service auto-started (PID ${res.pid})`);
  } catch (err) {
    console.log("[InitApp] Hermes auto-start error:", err.message);
  }
}

function hasQuotaAutoPingEnabled(settings) {
  return [settings?.claudeAutoPing, settings?.codexAutoPing]
    .some((config) => Object.values(config?.connections || {}).some(Boolean));
}

async function autoStartMitm(settings) {
  if (g.mitmStartInProgress) return;
  g.mitmStartInProgress = true;
  try {
    if (!settings.mitmEnabled) return;
    const mitmStatus = await getMitmStatus();
    if (mitmStatus.running) return;

    const password = await loadEncryptedPassword();
    if (!password && process.platform !== "win32") {
      console.log("[InitApp] MITM was enabled but no saved password found, skipping auto-start");
      return;
    }

    const keys = await getApiKeys();
    const activeKey = keys.find(k => k.isActive !== false);

    console.log("[InitApp] MITM was enabled, auto-starting...");
    await startMitm(activeKey?.key || "sk_9router", password);
    console.log("[InitApp] MITM auto-started");
    try {
      await restoreToolDNS(password);
      console.log("[InitApp] DNS restored from saved state");
    } catch (e) {
      console.log("[InitApp] DNS restore failed:", e.message);
    }
  } catch (err) {
    console.log("[InitApp] MITM auto-start failed:", err.message);
  } finally {
    g.mitmStartInProgress = false;
  }
}

// Cooldown only applies to repeating watchdog ticks (anti hammer-loop).
// Network/exit events are one-shot transitions → bypass to recover fast.
const FORCE_RESTART_REASONS = /^(startup|netchange|sleep|sleep\+netchange|online|unexpected-exit)$/;

// ─── Safe restart (4 guards: spawn / cooldown / alive / internet) ────────────

async function safeRestartTunnel(reason) {
  const svc = getTunnelService();
  const settings = await getSettings();
  if (!settings.tunnelEnabled) return;
  if (svc.cancelToken.cancelled) return;
  if (svc.spawnInProgress) return;

  const force = FORCE_RESTART_REASONS.test(reason);

  // Process alive = trust cloudflared (self-reconnects via --retries 99, keeps same URL).
  // Killing a live process on network change drops the tunnel and rotates the quick-tunnel URL.
  if (isCloudflaredRunning()) return;

  if (!force && Date.now() - svc.lastRestartAt < RESTART_COOLDOWN_MS) {
    console.log(`[Tunnel] degraded but cooldown active, skip (${reason})`);
    return;
  }
  if (!await checkInternet()) return;

  console.log(`[Tunnel] safeRestart (${reason}) — tunnel unreachable${force ? " [force]" : ""}`);
  try {
    await enableTunnel();
    svc.lastRestartAt = Date.now();
    console.log("[Tunnel] restart success");
  } catch (err) {
    if (!/cloudflared killed|tunnel cancelled/.test(err.message)) {
      console.log("[Tunnel] restart failed:", err.message);
    }
  }
}

async function safeRestartTailscale(reason) {
  const svc = getTailscaleService();
  const settings = await getSettings();
  if (!settings.tailscaleEnabled) return;
  if (svc.cancelToken.cancelled) return;
  if (svc.spawnInProgress) return;

  // Tailscale daemon is OS-level with built-in reconnect; trust it when running (even on netchange).
  // Startup uses strict probe — cached state is cold after process/dev reload.
  const running = reason === "startup" ? await isTailscaleRunningStrict() : isTailscaleRunning();
  if (running) return;

  // Daemon alive but funnel dropped → recover funnel only; never full-restart (preserves login/daemon).
  if (isDaemonAlive() && svc.activeLocalPort) {
    try {
      await startFunnel(svc.activeLocalPort);
      svc.lastRestartAt = Date.now();
      console.log("[Tailscale] funnel re-established (daemon alive)");
    } catch (err) {
      console.log("[Tailscale] funnel recovery failed:", err.message);
    }
    return;
  }

  const force = FORCE_RESTART_REASONS.test(reason);
  if (!force && Date.now() - svc.lastRestartAt < RESTART_COOLDOWN_MS) {
    console.log(`[Tailscale] degraded but cooldown active, skip (${reason})`);
    return;
  }
  if (!await checkInternet()) return;

  console.log(`[Tailscale] safeRestart (${reason}) — daemon not running${force ? " [force]" : ""}`);
  try {
    await enableTailscale();
    svc.lastRestartAt = Date.now();
    console.log("[Tailscale] restart success");
  } catch (err) {
    console.log("[Tailscale] restart failed:", err.message);
  }
}

// ─── Watchdog: 60s tick check all monitored services ─────────────────────────

async function safeRestartHeadroom(reason) {
  try {
    const settings = await getSettings();
    if (!settings.headroomEnabled || settings.headroomAutoStart === false) return;
    const { findHeadroomBinary, isLoopbackHeadroomUrl, DEFAULT_HEADROOM_URL } = await import("@/lib/headroom/detect.js");
    const { getManagedPid, isHeadroomRunning } = await import("@/lib/headroom/process.js");
    const binary = findHeadroomBinary();
    if (!binary) return;
    const url = settings.headroomUrl || DEFAULT_HEADROOM_URL;
    if (!isLoopbackHeadroomUrl(url)) return;

    const running = await isHeadroomRunning(url);
    if (!running && !getManagedPid()) {
      console.log(`[Headroom] safeRestart (${reason}) — process died, restarting...`);
      await autoStartHeadroom(settings);
    }
  } catch (e) {
    console.log("[Headroom] safeRestart failed:", e.message);
  }
}

async function safeRestartHermes(reason) {
  try {
    const settings = await getSettings();
    if (settings.hermesServiceAutoStart === false) return;
    const { findHermesBinary } = await import("@/lib/plugins/hermes/detect.js");
    const { getManagedPid } = await import("@/lib/plugins/hermes/process.js");
    const binary = findHermesBinary();
    if (!binary) return;

    if (!getManagedPid()) {
      console.log(`[Hermes] safeRestart (${reason}) — process died, restarting...`);
      await autoStartHermes(settings);
    }
  } catch (e) {
    console.log("[Hermes] safeRestart failed:", e.message);
  }
}

const AUTO_UPDATE_COOLDOWN_MS = 6 * 60 * 60 * 1000; // 6 hours

async function checkPluginAutoUpdates() {
  try {
    const settings = await getSettings();
    const now = Date.now();

    // Headroom auto-update
    if (settings.headroomAutoUpdate) {
      const last = g.lastAutoUpdateAt["headroom"] || 0;
      if (now - last > AUTO_UPDATE_COOLDOWN_MS) {
        g.lastAutoUpdateAt["headroom"] = now;
        const { checkForUpdate, fetchPyPiLatest } = await import("@/lib/updateCheck.js");
        const { getHeadroomVersion } = await import("@/lib/headroom/detect.js");
        const cur = await getHeadroomVersion();
        if (cur) {
          const up = await checkForUpdate("headroom", cur, () => fetchPyPiLatest("headroom-ai"));
          if (up.updateAvailable) {
            console.log(`[AutoUpdate] Updating headroom ${cur} -> ${up.latestVersion}...`);
            const { updateHeadroom } = await import("@/lib/headroom/process.js");
            await updateHeadroom();
          }
        }
      }
    }

    // Hermes auto-update
    if (settings.hermesAutoUpdate) {
      const last = g.lastAutoUpdateAt["hermes"] || 0;
      if (now - last > AUTO_UPDATE_COOLDOWN_MS) {
        g.lastAutoUpdateAt["hermes"] = now;
        const { checkForUpdate, fetchGitHubReleaseLatest } = await import("@/lib/updateCheck.js");
        const { getHermesVersion } = await import("@/lib/plugins/hermes/detect.js");
        const cur = await getHermesVersion();
        if (cur) {
          const up = await checkForUpdate("hermes", cur, () => fetchGitHubReleaseLatest("NousResearch/hermes-agent"));
          if (up.hasUpdate) {
            console.log(`[AutoUpdate] Updating hermes ${cur} -> ${up.latestVersion}...`);
            const { updateHermes } = await import("@/lib/plugins/hermes/process.js");
            await updateHermes();
          }
        }
      }
    }

    // Pxpipe auto-update
    if (settings.pxpipeAutoUpdate) {
      const last = g.lastAutoUpdateAt["pxpipe"] || 0;
      if (now - last > AUTO_UPDATE_COOLDOWN_MS) {
        g.lastAutoUpdateAt["pxpipe"] = now;
        const { checkForUpdate, fetchNpmLatest } = await import("@/lib/updateCheck.js");
        const { getPxpipeStatus } = await import("@/lib/pxpipe/service.js");
        const stat = getPxpipeStatus();
        if (stat.installed && stat.version) {
          const up = await checkForUpdate("pxpipe", stat.version, () => fetchNpmLatest("pxpipe-proxy"));
          if (up.updateAvailable) {
            console.log(`[AutoUpdate] Updating pxpipe ${stat.version} -> ${up.latestVersion}...`);
            const { updatePxpipe } = await import("@/lib/pxpipe/service.js");
            await updatePxpipe();
          }
        }
      }
    }

    // Graphify auto-update
    if (settings.graphifyAutoUpdate) {
      const last = g.lastAutoUpdateAt["graphify"] || 0;
      if (now - last > AUTO_UPDATE_COOLDOWN_MS) {
        g.lastAutoUpdateAt["graphify"] = now;
        const { checkForUpdate, fetchPyPiLatest } = await import("@/lib/updateCheck.js");
        const { execSync, exec } = await import("child_process");
        const { promisify } = await import("util");
        const execAsync = promisify(exec);
        let cur = null;
        try {
          const out = execSync("uv tool list", { stdio: ["ignore", "pipe", "ignore"], windowsHide: true }).toString();
          const m = out.match(/graphifyy\s+v?([0-9.]+)/i);
          cur = m ? m[1] : null;
        } catch {}
        if (cur) {
          const up = await checkForUpdate("graphify", cur, () => fetchPyPiLatest("graphifyy"));
          if (up.hasUpdate) {
            console.log(`[AutoUpdate] Updating graphify ${cur} -> ${up.latestVersion}...`);
            await execAsync("uv tool upgrade graphifyy");
          }
        }
      }
    }

    // MCP Inspector auto-update
    if (settings.mcpInspectorAutoUpdate) {
      const last = g.lastAutoUpdateAt["mcp-inspector"] || 0;
      if (now - last > AUTO_UPDATE_COOLDOWN_MS) {
        g.lastAutoUpdateAt["mcp-inspector"] = now;
        const { checkForUpdate, fetchNpmLatest } = await import("@/lib/updateCheck.js");
        const { execSync, exec } = await import("child_process");
        const { promisify } = await import("util");
        const execAsync = promisify(exec);
        let cur = null;
        try {
          const out = execSync("npm list -g @modelcontextprotocol/inspector --json", { stdio: ["ignore", "pipe", "ignore"], windowsHide: true }).toString();
          cur = JSON.parse(out).dependencies?.["@modelcontextprotocol/inspector"]?.version || null;
        } catch {}
        if (cur) {
          const up = await checkForUpdate("mcp-inspector", cur, () => fetchNpmLatest("@modelcontextprotocol/inspector"));
          if (up.hasUpdate) {
            console.log(`[AutoUpdate] Updating mcp-inspector ${cur} -> ${up.latestVersion}...`);
            await execAsync("npm install -g @modelcontextprotocol/inspector@latest");
          }
        }
      }
    }
  } catch (e) {
    console.log("[AutoUpdate] Check error:", e.message);
  }
}

function startWatchdog() {
  if (g.watchdogInterval) return;
  g.watchdogInterval = setInterval(() => {
    safeRestartTunnel("watchdog").catch(() => {});
    safeRestartTailscale("watchdog").catch(() => {});
    safeRestartHeadroom("watchdog").catch(() => {});
    safeRestartHermes("watchdog").catch(() => {});
    checkPluginAutoUpdates().catch(() => {});
  }, WATCHDOG_INTERVAL_MS);
  if (g.watchdogInterval.unref) g.watchdogInterval.unref();
}

function stopWatchdog() {
  if (!g.watchdogInterval) return;
  clearInterval(g.watchdogInterval);
  g.watchdogInterval = null;
}

// ─── Network monitor: detect IPv4 fingerprint change + sleep/wake ────────────

function getNetworkFingerprint() {
  const interfaces = os.networkInterfaces();
  const active = [];
  for (const [name, addrs] of Object.entries(interfaces)) {
    if (!addrs) continue;
    if (VIRTUAL_IFACE_REGEX.test(name)) continue;
    for (const addr of addrs) {
      if (!addr.internal && addr.family === "IPv4") {
        active.push(`${name}:${addr.address}`);
      }
    }
  }
  return active.sort().join("|");
}

function startNetworkMonitor() {
  if (g.networkMonitorInterval) return;

  g.lastNetworkFingerprint = getNetworkFingerprint();
  g.lastWatchdogTick = Date.now();
  g.lastOnline = null;

  g.networkMonitorInterval = setInterval(async () => {
    try {
      const now = Date.now();
      const elapsed = now - g.lastWatchdogTick;
      g.lastWatchdogTick = now;

      const currentFingerprint = getNetworkFingerprint();
      const networkChanged = currentFingerprint !== g.lastNetworkFingerprint;
      const wasSleep = elapsed > NETWORK_CHECK_INTERVAL_MS * 6;
      if (networkChanged) g.lastNetworkFingerprint = currentFingerprint;

      // Real reachability check (TCP 1.1.1.1:443) — not just interface presence
      const online = await checkInternet();
      const wasOffline = g.lastOnline === false;
      g.lastOnline = online;

      if (!online) return; // no internet → idle, don't restart

      const onlineEdge = wasOffline; // offline → online transition
      if (!networkChanged && !wasSleep && !onlineEdge) return;

      // Wait for DHCP/DNS to settle before probing
      await new Promise((r) => setTimeout(r, NETWORK_SETTLE_MS));

      const reason = onlineEdge ? "online"
        : wasSleep && networkChanged ? "sleep+netchange"
        : wasSleep ? "sleep" : "netchange";
      safeRestartTunnel(reason).catch(() => {});
      safeRestartTailscale(reason).catch(() => {});
    } catch (err) {
      console.log("[NetworkMonitor] error:", err.message);
    }
  }, NETWORK_CHECK_INTERVAL_MS);

  if (g.networkMonitorInterval.unref) g.networkMonitorInterval.unref();
}


function stopNetworkMonitor() {
  if (!g.networkMonitorInterval) return;
  clearInterval(g.networkMonitorInterval);
  g.networkMonitorInterval = null;
  g.lastNetworkFingerprint = null;
  g.lastOnline = null;
}

export function configureTunnelMonitoring(settings) {
  if (
    settings?.tunnelEnabled ||
    settings?.tailscaleEnabled ||
    settings?.headroomAutoUpdate ||
    settings?.hermesAutoUpdate ||
    settings?.pxpipeAutoUpdate
  ) {
    startWatchdog();
    startNetworkMonitor();
    return;
  }
  stopWatchdog();
  stopNetworkMonitor();
}

export default initializeApp;
