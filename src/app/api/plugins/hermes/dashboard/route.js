import { NextResponse } from "next/server";
import { spawn, execSync } from "child_process";
import http from "http";
import { findHermesBinary, HERMES_EXTENDED_PATH } from "@/lib/plugins/hermes/detect.js";

export const dynamic = "force-dynamic";

const DASHBOARD_PORT = 9119;
const DASHBOARD_HOST = "127.0.0.1";

async function isPortOpen(port = DASHBOARD_PORT, host = DASHBOARD_HOST, timeoutMs = 1000) {
  return new Promise((resolve) => {
    const req = http.get(`http://${host}:${port}/`, { timeout: timeoutMs }, (res) => {
      resolve(true);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function getPortStatus(port = DASHBOARD_PORT, host = DASHBOARD_HOST, timeoutMs = 1000) {
  return new Promise((resolve) => {
    const req = http.get(`http://${host}:${port}/`, { timeout: timeoutMs }, (res) => {
      let body = "";
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => {
        const isHeadless = body.includes("Headless backend (hermes serve)") || body.includes("web UI disabled");
        resolve({
          running: true,
          mode: isHeadless ? "serve" : "dashboard",
          statusCode: res.statusCode,
        });
      });
    });
    req.on("error", () => resolve({ running: false, mode: null, statusCode: null }));
    req.on("timeout", () => {
      req.destroy();
      resolve({ running: false, mode: null, statusCode: null });
    });
  });
}

function killProcessesOnPort(port = DASHBOARD_PORT) {
  try {
    if (process.platform === "win32") {
      const netstat = execSync("netstat -ano -p tcp", { encoding: "utf8" });
      const pids = new Set();
      for (const line of netstat.split("\n")) {
        if (line.includes(`:${port}`) && line.toUpperCase().includes("LISTENING")) {
          const parts = line.trim().split(/\s+/);
          const pid = parseInt(parts[parts.length - 1], 10);
          if (pid && pid > 0) pids.add(pid);
        }
      }
      for (const pid of pids) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          try {
            execSync(`taskkill /F /PID ${pid}`);
          } catch { /* ignore */ }
        }
      }
    } else {
      try {
        execSync(`lsof -t -i:${port} | xargs kill -9`);
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
}

export async function GET() {
  const binary = findHermesBinary();
  if (!binary) {
    return NextResponse.json({
      installed: false,
      running: false,
      mode: null,
      url: `http://${DASHBOARD_HOST}:${DASHBOARD_PORT}`,
      port: DASHBOARD_PORT,
    });
  }

  const status = await getPortStatus(DASHBOARD_PORT, DASHBOARD_HOST, 800);
  return NextResponse.json({
    installed: true,
    running: status.running,
    mode: status.mode,
    url: `http://${DASHBOARD_HOST}:${DASHBOARD_PORT}`,
    port: DASHBOARD_PORT,
  });
}

export async function POST(request) {
  const binary = findHermesBinary();
  if (!binary) {
    return NextResponse.json({ error: "Hermes CLI is not installed" }, { status: 400 });
  }

  let body = {};
  try {
    body = await request.json();
  } catch { /* ignore empty */ }

  const action = body.action || "start"; // 'start' | 'stop' | 'toggle'
  const mode = body.mode || "dashboard"; // 'dashboard' (Full Web UI) | 'serve' (Headless JSON-RPC/API)

  const currentStatus = await getPortStatus(DASHBOARD_PORT, DASHBOARD_HOST, 800);
  const isRunning = currentStatus.running;

  if (action === "stop" || (action === "toggle" && isRunning)) {
    killProcessesOnPort(DASHBOARD_PORT);
    try {
      const stopChild = spawn(binary, ["dashboard", "--stop"], {
        detached: process.platform !== "win32",
        windowsHide: true,
        stdio: "ignore",
        env: { ...process.env, PATH: HERMES_EXTENDED_PATH },
      });
      await new Promise((resolve) => {
        stopChild.on("close", resolve);
        setTimeout(resolve, 1000);
      });
    } catch { /* ignore */ }

    killProcessesOnPort(DASHBOARD_PORT);

    return NextResponse.json({
      success: true,
      stopped: true,
      running: false,
      url: `http://${DASHBOARD_HOST}:${DASHBOARD_PORT}`,
    });
  }

  // If already running in the EXACT requested mode, return immediately
  if (isRunning && currentStatus.mode === mode) {
    return NextResponse.json({
      success: true,
      alreadyRunning: true,
      mode,
      url: `http://${DASHBOARD_HOST}:${DASHBOARD_PORT}`,
    });
  }

  // If running in a different mode, stop previous instance first
  if (isRunning) {
    killProcessesOnPort(DASHBOARD_PORT);
    try {
      const stopChild = spawn(binary, ["dashboard", "--stop"], {
        detached: process.platform !== "win32",
        windowsHide: true,
        stdio: "ignore",
        env: { ...process.env, PATH: HERMES_EXTENDED_PATH },
      });
      await new Promise((resolve) => {
        stopChild.on("close", resolve);
        setTimeout(resolve, 1000);
      });
    } catch { /* ignore */ }
    killProcessesOnPort(DASHBOARD_PORT);
    await new Promise((r) => setTimeout(r, 400));
  }

  try {
    const runArgs = mode === "serve"
      ? ["serve", "--port", String(DASHBOARD_PORT), "--host", DASHBOARD_HOST]
      : ["dashboard", "--port", String(DASHBOARD_PORT), "--host", DASHBOARD_HOST, "--no-open", "--skip-build"];

    const child = spawn(binary, runArgs, {
      detached: process.platform !== "win32",
      windowsHide: true,
      stdio: "ignore",
      env: { ...process.env, PATH: HERMES_EXTENDED_PATH },
    });

    child.unref();

    for (let i = 0; i < 25; i++) {
      await new Promise((r) => setTimeout(r, 200));
      const chk = await getPortStatus(DASHBOARD_PORT, DASHBOARD_HOST, 400);
      if (chk.running) {
        return NextResponse.json({
          success: true,
          started: true,
          mode: chk.mode,
          url: `http://${DASHBOARD_HOST}:${DASHBOARD_PORT}`,
        });
      }
    }

    return NextResponse.json({
      success: true,
      started: true,
      mode,
      url: `http://${DASHBOARD_HOST}:${DASHBOARD_PORT}`,
      warning: "Server launched, UI may take a few moments to initialize.",
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
