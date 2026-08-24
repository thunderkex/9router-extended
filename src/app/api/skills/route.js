import { NextResponse } from "next/server";
import { getSkillManifests, createCustomSkill, deleteCustomSkill } from "@/lib/skillsRegistry";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const manifests = await getSkillManifests();
    return NextResponse.json(manifests);
  } catch (error) {
    console.log("Error loading skills:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const body = await req.json();
    if (!body || !body.id || !body.name) {
      return NextResponse.json({ error: "Missing required skill fields (id, name)" }, { status: 400 });
    }
    const result = await createCustomSkill(body);
    return NextResponse.json(result);
  } catch (error) {
    console.error("Error creating skill:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(req) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "Missing skill id" }, { status: 400 });
    }
    await deleteCustomSkill(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting skill:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}


