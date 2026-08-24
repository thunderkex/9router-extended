import { NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";

const execAsync = promisify(exec);

export async function POST(request) {
  try {
    const { id, action } = await request.json();
    if (!id || !action || !["install", "uninstall"].includes(action)) {
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

    const command = action === "install" ? manifest.install_command : manifest.uninstall_command;
    
    if (!command) {
      // Some skills might not have a command, that's fine, just return success
      return NextResponse.json({ success: true, message: "No command required" });
    }

    try {
      const { stdout, stderr } = await execAsync(command);
      return NextResponse.json({ success: true, stdout, stderr });
    } catch (execError) {
      console.error(`Error executing ${action} for ${id}:`, execError);
      return NextResponse.json({ error: execError.message, stderr: execError.stderr }, { status: 500 });
    }

  } catch (error) {
    console.error("Error in skill install API:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
