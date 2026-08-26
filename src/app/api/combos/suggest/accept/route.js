/**
 *
 * POST /api/combos/suggest/accept
 * Body: { name: string, models: string[] }
 *
 * Creates the combo only if no combo with that name already exists.
 * Never silently overwrites a user-authored combo.
 */
import { NextResponse } from "next/server";
import { getCombos, createCombo } from "@/lib/db/index.js";

export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    const { name, models } = await request.json();
    if (!name || !Array.isArray(models) || models.length === 0) {
      return NextResponse.json({ error: "name and models[] required" }, { status: 400 });
    }

    const existing = await getCombos();
    const conflict = existing.find((c) => c.name === name);
    
    if (conflict && conflict.kind !== "auto") {
      return NextResponse.json(
        { error: `A combo named "${name}" already exists. Rename or delete it first.`, conflict: true },
        { status: 409 }
      );
    }
    
    if (conflict && conflict.kind === "auto") {
      const { deleteCombo } = await import("@/lib/db/index.js");
      await deleteCombo(conflict.id);
    }

    const combo = await createCombo({ name, models, kind: "auto" });
    return NextResponse.json({ combo }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
