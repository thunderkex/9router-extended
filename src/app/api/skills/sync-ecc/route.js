import { NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs/promises";
import { clearSkillIndexCache, getSkillIndex } from "@/skills/autoRouter.js";

const execAsync = promisify(exec);

export async function POST() {
  try {
    const scriptPath = path.join(process.cwd(), "scripts", "sync-ecc-skills.js");
    const { stdout, stderr } = await execAsync(`node "${scriptPath}"`);

    clearSkillIndexCache();
    const index = await getSkillIndex();

    return NextResponse.json({
      success: true,
      skillsCount: index.skills ? index.skills.length : 0,
      output: stdout,
      error: stderr || null,
    });
  } catch (error) {
    console.error("Failed to sync ECC skills:", error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || "Failed to execute sync script",
      },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    const index = await getSkillIndex();
    return NextResponse.json({
      success: true,
      skillsCount: index.skills ? index.skills.length : 0,
      skills: (index.skills || []).map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        triggersCount: (s.triggers || []).length,
      })),
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
