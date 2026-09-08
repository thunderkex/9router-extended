import { NextResponse } from "next/server";
import { getSettings, updateSettings } from "@/lib/localDb";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const settings = await getSettings();
    return NextResponse.json({
      enabled: !!settings.autoPlanEnabled,
      mode: settings.autoPlanMode || "auto",
      planComboId: settings.autoPlanComboId || null,
      codeComboId: settings.autoCodeComboId || null,
      complexityThreshold: settings.autoPlanComplexityThreshold !== undefined ? Number(settings.autoPlanComplexityThreshold) : 6,
      smartClassify: !!settings.autoPlanSmartClassify,
      maxPlanTokens: settings.autoPlanMaxTokens || 800,
      timeoutMs: settings.autoPlanTimeoutMs || 15000,
      showPlanInResponse: !!settings.autoPlanShowInResponse,
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PATCH(request) {
  try {
    const body = await request.json();
    const delta = {};

    if (body.enabled !== undefined) delta.autoPlanEnabled = !!body.enabled;
    if (body.mode !== undefined) delta.autoPlanMode = body.mode;
    if (body.planComboId !== undefined) delta.autoPlanComboId = body.planComboId;
    if (body.codeComboId !== undefined) delta.autoCodeComboId = body.codeComboId;
    if (body.complexityThreshold !== undefined) delta.autoPlanComplexityThreshold = Number(body.complexityThreshold);
    if (body.smartClassify !== undefined) delta.autoPlanSmartClassify = !!body.smartClassify;
    if (body.maxPlanTokens !== undefined) delta.autoPlanMaxTokens = Number(body.maxPlanTokens);
    if (body.timeoutMs !== undefined) delta.autoPlanTimeoutMs = Number(body.timeoutMs);
    if (body.showPlanInResponse !== undefined) delta.autoPlanShowInResponse = !!body.showPlanInResponse;

    const updated = await updateSettings(delta);
    return NextResponse.json({
      enabled: !!updated.autoPlanEnabled,
      mode: updated.autoPlanMode || "auto",
      planComboId: updated.autoPlanComboId || null,
      codeComboId: updated.autoCodeComboId || null,
      complexityThreshold: updated.autoPlanComplexityThreshold !== undefined ? Number(updated.autoPlanComplexityThreshold) : 6,
      smartClassify: !!updated.autoPlanSmartClassify,
      maxPlanTokens: updated.autoPlanMaxTokens || 800,
      timeoutMs: updated.autoPlanTimeoutMs || 15000,
      showPlanInResponse: !!updated.autoPlanShowInResponse,
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
