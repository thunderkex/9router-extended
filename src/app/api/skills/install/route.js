import { NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import { clearPluginUpdateCache } from "@/lib/updateCheck.js";

const execAsync = promisify(exec);

export async function POST(request) {
  try {
    const { id, action } = await request.json();
    if (!id || !action || !["install", "uninstall", "update"].includes(action)) {
      return NextResponse.json({ error: "Invalid parameters" }, { status: 400 });
    }

    const manifestPath = path.join(process.cwd(), "skills", id, "manifest.json");
    let manifest;
    try {
      const content = await fs.readFile(manifestPath, "utf-8");
      manifest = JSON.parse(content);
    } catch (e) {
      return NextResponse.json({ error: "Skill not found or invalid manifest" }, { status: 404 });
    }

    let command = action === "uninstall" ? manifest.uninstall_command : manifest.install_command;
    if (action === "update") {
      if (manifest.update_command) {
        command = manifest.update_command;
      } else if (id === "graphify") {
        command = "uv tool upgrade graphifyy";
      } else if (id === "mcp-inspector") {
        command = "npm install -g @modelcontextprotocol/inspector@latest";
      }
    }
    
    if (!command) {
      if (action === "update") {
        // For prompt/rule-based skills without CLI commands, update manifest version to latest
        try {
          const repoMap = {
            "caveman": "JuliusBrussee/caveman",
            "ponytail": "DietrichGebert/ponytail",
            "rtk": "rtk-ai/rtk",
            "commit-lint": "conventional-changelog/commitlint",
            "watermarks-remover": "guillaumemeyer/watermarks-remover",
            "taste-skill": "Leonxlnx/taste-skill",
          };
          const repo = repoMap[id];
          if (repo) {
            const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
              headers: { "User-Agent": "9Router-App" }
            });
            if (res.ok) {
              const data = await res.json();
              const latestTag = (data.tag_name || "").replace(/^v/, "");
              if (latestTag) {
                manifest.version = latestTag;
                await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");
              }
            }
          }
        } catch (e) {
          console.warn(`Failed to sync prompt skill version for ${id}:`, e.message);
        }
        clearPluginUpdateCache(id);
        return NextResponse.json({ success: true, message: `Synced ${id} to latest version` });
      }
      return NextResponse.json({ success: true, message: "No command required" });
    }

    try {
      console.log(`[plugin-update] Executing ${action} for skill '${id}' using command: ${command}`);
      const { stdout, stderr } = await execAsync(command);
      clearPluginUpdateCache(id);
      return NextResponse.json({ success: true, action, stdout, stderr });
    } catch (execError) {
      console.error(`Error executing ${action} for ${id}:`, execError);
      return NextResponse.json({ error: execError.message, stderr: execError.stderr }, { status: 500 });
    }

  } catch (error) {
    console.error("Error in skill install API:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
