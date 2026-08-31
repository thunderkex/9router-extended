import { NextResponse } from "next/server";
import path from "path";
import fsSync from "fs";
import { syncEccSkills } from "../../../../../scripts/sync-ecc-skills.js";
import { clearSkillIndexCache, getSkillIndex } from "@/skills/autoRouter.js";

export async function POST() {
  try {
    const result = await syncEccSkills();

    clearSkillIndexCache();
    const index = await getSkillIndex();

    return NextResponse.json({
      success: true,
      skillsCount: index.skills ? index.skills.length : 0,
      total: result.total,
      updated: result.updated,
      skipped: result.skipped,
    });
  } catch (error) {
    console.error("Failed to sync ECC skills:", error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || "Failed to execute sync",
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
