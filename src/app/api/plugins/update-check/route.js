import { NextResponse } from "next/server";
import { checkForUpdate, fetchNpmLatest, fetchPyPiLatest, fetchGitHubReleaseLatest } from "@/lib/updateCheck.js";
import { getInstallInfo as getHermesInstallInfo } from "@/lib/plugins/hermes/install.js";
import { getInstalledHeadroomExtras, findPython310 } from "@/lib/headroom/detect.js";
import { getInstallInfo as getPxpipeInstallInfo } from "@/lib/pxpipe/install.js";
import { getCloudflaredInstalledVersion } from "@/lib/tunnel/cloudflare/version.js";
import { execSync } from "child_process";
import fs from "fs/promises";
import path from "path";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const plugin = searchParams.get("plugin");

  if (!plugin) {
    return NextResponse.json({ error: "Missing plugin parameter" }, { status: 400 });
  }

  let result = null;

  switch (plugin) {
    case "hermes": {
      const info = getHermesInstallInfo();
      // Hermes agent uses custom installer. Check github repo nousresearch/hermes-agent
      result = await checkForUpdate(
        "hermes",
        info.version,
        () => fetchGitHubReleaseLatest("NousResearch/hermes-agent")
      );
      break;
    }
    case "headroom": {
      const py = findPython310();
      const status = py ? getInstalledHeadroomExtras(py) : { installed: false, version: null };
      result = await checkForUpdate(
        "headroom",
        status.version,
        () => fetchPyPiLatest("headroom-ai")
      );
      break;
    }
    case "pxpipe": {
      const info = getPxpipeInstallInfo();
      result = await checkForUpdate(
        "pxpipe",
        info.version,
        () => fetchNpmLatest("pxpipe-proxy")
      );
      break;
    }
    case "cloudflared": {
      const current = getCloudflaredInstalledVersion();
      result = await checkForUpdate(
        "cloudflared",
        current,
        () => fetchGitHubReleaseLatest("cloudflare/cloudflared")
      );
      break;
    }
    case "mcp-inspector": {
      let current = null;
      try {
        const out = execSync("npm list -g @modelcontextprotocol/inspector --json", {
          stdio: ["ignore", "pipe", "ignore"],
          windowsHide: true,
          timeout: 5000,
        }).toString().trim();
        const parsed = JSON.parse(out);
        current = parsed.dependencies?.["@modelcontextprotocol/inspector"]?.version || null;
      } catch {}
      result = await checkForUpdate(
        "mcp-inspector",
        current,
        () => fetchNpmLatest("@modelcontextprotocol/inspector")
      );
      break;
    }
    case "graphify": {
      let current = null;
      try {
        const out = execSync("uv tool list", {
          stdio: ["ignore", "pipe", "ignore"],
          windowsHide: true,
          timeout: 5000,
        }).toString().trim();
        const m = out.match(/graphifyy\s+v?([0-9.]+)/i);
        current = m ? m[1] : null;
      } catch {}
      if (!current) {
        try {
          const out2 = execSync("graphify --version", {
            stdio: ["ignore", "pipe", "ignore"],
            windowsHide: true,
            timeout: 5000,
          }).toString().trim();
          const m2 = out2.match(/([0-9.]+)/);
          current = m2 ? m2[1] : null;
        } catch {}
      }
      result = await checkForUpdate(
        "graphify",
        current,
        () => fetchPyPiLatest("graphifyy")
      );
      break;
    }
    case "caveman": {
      const manifestPath = path.join(process.cwd(), "skills", "caveman", "manifest.json");
      let current = null;
      try {
        const d = JSON.parse(await fs.readFile(manifestPath, "utf-8"));
        current = d.version || null;
      } catch {}
      result = await checkForUpdate(
        "caveman",
        current,
        () => fetchGitHubReleaseLatest("JuliusBrussee/caveman")
      );
      break;
    }
    case "ponytail": {
      const manifestPath = path.join(process.cwd(), "skills", "ponytail", "manifest.json");
      let current = null;
      try {
        const d = JSON.parse(await fs.readFile(manifestPath, "utf-8"));
        current = d.version || null;
      } catch {}
      result = await checkForUpdate(
        "ponytail",
        current,
        () => fetchGitHubReleaseLatest("DietrichGebert/ponytail")
      );
      break;
    }
    case "rtk": {
      const manifestPath = path.join(process.cwd(), "skills", "rtk", "manifest.json");
      let current = null;
      try {
        const d = JSON.parse(await fs.readFile(manifestPath, "utf-8"));
        current = d.version || null;
      } catch {}
      result = await checkForUpdate(
        "rtk",
        current,
        () => fetchGitHubReleaseLatest("rtk-ai/rtk")
      );
      break;
    }
    case "commit-lint": {
      const manifestPath = path.join(process.cwd(), "skills", "commit-lint", "manifest.json");
      let current = null;
      try {
        const d = JSON.parse(await fs.readFile(manifestPath, "utf-8"));
        current = d.version || null;
      } catch {}
      result = await checkForUpdate(
        "commit-lint",
        current,
        () => fetchGitHubReleaseLatest("conventional-changelog/commitlint")
      );
      break;
    }
    case "watermarks-remover": {
      const manifestPath = path.join(process.cwd(), "skills", "watermarks-remover", "manifest.json");
      let current = null;
      try {
        const d = JSON.parse(await fs.readFile(manifestPath, "utf-8"));
        current = d.version || null;
      } catch {}
      result = await checkForUpdate(
        "watermarks-remover",
        current,
        () => fetchGitHubReleaseLatest("guillaumemeyer/watermarks-remover")
      );
      break;
    }
    case "taste-skill": {
      const manifestPath = path.join(process.cwd(), "skills", "taste-skill", "manifest.json");
      let current = null;
      try {
        const d = JSON.parse(await fs.readFile(manifestPath, "utf-8"));
        current = d.version || null;
      } catch {}
      result = await checkForUpdate(
        "taste-skill",
        current,
        () => fetchGitHubReleaseLatest("Leonxlnx/taste-skill")
      );
      break;
    }
    default: {
      return NextResponse.json({ error: `Unknown or unversioned plugin: ${plugin}` }, { status: 404 });
    }
  }

  return NextResponse.json(result);
}
