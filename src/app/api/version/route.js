import pkg from "../../../../package.json" with { type: "json" };
import { checkForUpdate, fetchGitHubExtendedLatest } from "@/lib/updateCheck.js";
import { UPDATER_CONFIG } from "@/shared/constants/config.js";

const EXTENDED_REPO = UPDATER_CONFIG.githubRepo || "thunderkex/9router-extended";

export async function GET() {
  const currentVersion = pkg.version;
  const isBun = typeof process !== "undefined" && Boolean(process.versions?.bun);
  const updateCmd = isBun
    ? `bun add -g ${UPDATER_CONFIG.tarballUrl}`
    : UPDATER_CONFIG.installCmd;

  const result = await checkForUpdate(
    "9router-extended",
    currentVersion,
    () => fetchGitHubExtendedLatest(EXTENDED_REPO)
  );

  return Response.json({
    ...result,
    isExtended: true,
    repo: EXTENDED_REPO,
    updateCmd,
    tarballUrl: UPDATER_CONFIG.tarballUrl,
  });
}
